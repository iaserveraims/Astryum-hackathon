/**
 * /api/strategy-assistant — Strategy agent (Fix 2): regex → LLM + metrics calculator.
 *
 * The LLM INTERPRETS natural language (amount, target USD, risk intent) and PRESENTS
 * a neutral, honest metrics table. It does NOT compute the numbers — those come from
 * StrategyMetricsService (tested KineticIsoMath) computed here with LIVE rates — and
 * it does NOT build or sign the payload. It compiles parameters the user REVIEWS and
 * SIGNS in the existing prepare→sign modal (the tested path of firma is untouched:
 * this endpoint has NO tools and never returns a signable payload).
 */

import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ethers } from 'ethers';
import {
  buildStrategyAssistantSystemPrompt,
  buildMoneyFlowComposerSystemPrompt,
  buildTransferComposerSystemPrompt,
  type TransferWalletSummary,
} from '../config/strategyAssistantPrompt';
import { StrategyMetricsService, StrategyRatesInput, StrategyMetrics } from '../services/StrategyMetricsService';
import { getProtocolAddresses } from '../config/protocolAddresses';
import { createFTSOPriceProvider } from '../engines/normalisation/NormalisationEngine';
import {
  extractCmfBlock,
  extractFencedBlock,
  parseCmfDraft,
  finalizeCmfDraft,
  validateCmfInvariants,
  violationFeedback,
} from '../services/MoneyFlowComposer';
import { translateCmfToEvmRules } from '../canonical/moneyflow/CanonicalEvmTranslator';
import type { CanonicalMoneyFlow } from '../canonical/moneyflow/CanonicalMoneyFlow';

const router = Router();
const MODEL =
  process.env.STRATEGY_ASSISTANT_MODEL || process.env.PRODUCT_ASSISTANT_MODEL || 'claude-opus-4-8';
const FLARE_CHAIN_ID = 14;
const MANTISSA = 1e18;
// Kinetic is a Benqi-style fork: rates are per SECOND (*RatePerTimestamp);
// supplyRatePerBlock() does not exist (verified on-chain 2026-07-14).
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

function flareProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(
    process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
    { name: 'flare', chainId: FLARE_CHAIN_ID },
    { staticNetwork: true },
  );
}

/**
 * Best-effort LIVE Kinetic ISO rates for the metrics table. Returns null when the
 * Flare env / RPC isn't available — the agent then asks for the amount or says it
 * can't compute right now (never invents numbers).
 */
async function readKineticLiveRates(): Promise<StrategyRatesInput | null> {
  try {
    const k = getProtocolAddresses().kinetic;
    if (!k.isoComptroller || !k.isoKFxrp || !k.isoKUsdt0) return null;
    const provider = flareProvider();
    const priceProvider = await createFTSOPriceProvider();
    const fxrpPriceUSD = await priceProvider.getPriceUSD('XRP');
    if (!(fxrpPriceUSD > 0)) return null;

    const comptroller = new ethers.Contract(
      k.isoComptroller,
      ['function markets(address) view returns (bool isListed, uint256 collateralFactorMantissa)'],
      provider,
    );
    const market = await comptroller.markets(k.isoKFxrp);
    if (!market[0]) return null;
    const collateralFactor = Number(market[1]) / MANTISSA;

    const annualise = async (addr: string, fn: string): Promise<number | null> => {
      try {
        const c = new ethers.Contract(addr, [`function ${fn}() view returns (uint256)`], provider);
        const r: bigint = await c[fn]();
        const v = (Number(r) / 1e18) * SECONDS_PER_YEAR * 100;
        return Number.isFinite(v) && v >= 0 ? v : null;
      } catch {
        return null;
      }
    };
    const borrowAprPct = await annualise(k.isoKUsdt0, 'borrowRatePerTimestamp');
    const supplyAprPct = await annualise(k.isoKFxrp, 'supplyRatePerTimestamp');

    return { fxrpPriceUSD, collateralFactor, borrowAprPct, supplyAprPct };
  } catch {
    return null;
  }
}

const BodySchema = z.object({
  message: z.string().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(6000) }))
    .max(20)
    .optional(),
  /** The XRP amount the user stated (the frontend parses it from the chat). */
  amountXrp: z.number().positive().optional(),
  /** Optional target USD the user wants to draw ("I need $200"). */
  targetUsd: z.number().positive().optional(),
  /**
   * 'carry' (default) = the metrics-table strategy chat, unchanged.
   * 'moneyflow' (F1) = compose_moneyflow: the LLM drafts a CMF the user
   * reviews in the modal — zod-gated server-side, never persisted here.
   */
  mode: z.enum(['carry', 'moneyflow']).default('carry'),
  /**
   * The user's linked wallets (label + address + rail) so the transfer
   * compiler can resolve "mi Xaman"/"mi MetaMask" to an address. Sent by the
   * frontend from its own authed wallet list — the addresses are the user's
   * own public data; the SIWE gate protects the route.
   */
  wallets: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        address: z.string().min(1).max(64),
        rail: z.enum(['evm', 'xrpl']),
      }),
    )
    .max(20)
    .optional(),
  /**
   * True when the previous assistant turn was a transfer proposal/question —
   * keeps a transfer conversation in the compiler (a "5 XRP" follow-up has no
   * verb to regex) without re-triggering it on every later strategy question.
   */
  transferThread: z.boolean().optional(),
});

/* ── Simple wallet-to-wallet transfers, compiled by the agent ──────────────
 * The LLM COMPILES {from, to, amount, asset}; the payload itself still comes
 * from the tested POST /wallet-transfer/prepare when the user clicks
 * "Preparar" in the modal, and the user signs in their own wallet. This route
 * keeps returning NO signable payload (invariant #8). */

const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_ADDR_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const anyAddress = z
  .string()
  .trim()
  .refine((a) => EVM_ADDR_RE.test(a) || XRPL_ADDR_RE.test(a), 'not an address');

const TransferDraftSchema = z.object({
  fromAddress: anyAddress.nullish(),
  toAddress: anyAddress.nullish(),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/)
    .refine((s) => parseFloat(s) > 0, 'amount must be positive')
    .nullish(),
  asset: z.enum(['XRP', 'FLR', 'FXRP']).nullish(),
});

export interface CompiledTransfer {
  fromAddress: string | null;
  toAddress: string | null;
  amount: string | null;
  asset: 'XRP' | 'FLR' | 'FXRP' | null;
}

/** Cheap pre-filter — only messages that look like a payment reach the compiler. */
const TRANSFER_HINT_RE =
  /\b(env[ií]a|env[ií]ame|env[ií]ale|manda|m[áa]ndale|transfiere|transferir|transferencia|mueve|p[áa]same|p[áa]sale|send|transfer|move|pay)\b/i;

// POST /api/strategy-assistant/chat — SSE stream. SIWE-gated at the mount.
router.post('/chat', async (req: Request, res: Response) => {
  const parse = BodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }
  const { message, history = [], amountXrp, targetUsd, mode, wallets, transferThread } = parse.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ASSISTANT_UNAVAILABLE', message: 'Strategy assistant is not configured.' });
    return;
  }

  // F1 — compose_moneyflow: separate cage, non-streaming (the cmf block must
  // be validated server-side BEFORE the user sees a proposal, so we don't
  // stream raw JSON at them). The carry mode below stays exactly as it was.
  if (mode === 'moneyflow') {
    // Cast: with strict off, zod infers history items as all-optional.
    return composeMoneyFlow(res, apiKey, message, history as ChatTurn[], req.siwe?.sessionId);
  }

  // Simple wallet-to-wallet transfers ("envía 5 XRP de mi Xaman a mi
  // MetaMask") — cheap regex gate on the CURRENT message only (regexing
  // history would re-fire the compiler on every later strategy question),
  // plus the frontend's transferThread flag so a "5 XRP" follow-up with no
  // verb stays in the transfer conversation. Then ONE non-streaming call
  // that either compiles the parameters or answers NO_TRANSFER (→ the
  // strategy chat below takes over). The compiled fields pre-fill the tested
  // prepare→review→sign modal; this route still returns NO signable payload.
  if (TRANSFER_HINT_RE.test(message) || transferThread === true) {
    const handled = await composeTransfer(
      res,
      apiKey,
      message,
      history as ChatTurn[],
      (wallets ?? []) as TransferWalletSummary[],
    );
    if (handled) return;
  }

  // REAL metrics when we know the amount and the live rates resolve. Numbers come
  // from StrategyMetricsService (tested math) — never from the LLM. The structured
  // `metrics` is sent to the frontend (in the done event) so it renders a proper
  // HTML table + a "Preparar" button per option; the text stream is the LLM's
  // conversational layer.
  let table: string | undefined;
  let metrics: StrategyMetrics | undefined;
  if (amountXrp && amountXrp > 0) {
    const rates = await readKineticLiveRates();
    if (rates) {
      try {
        metrics = StrategyMetricsService.computeCarryOptions(amountXrp, rates, { targetUsd });
        table = StrategyMetricsService.toContextTable(metrics);
      } catch {
        metrics = undefined;
        table = undefined;
      }
    }
  }

  const system = buildStrategyAssistantSystemPrompt(table);
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-18).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = new Anthropic({ apiKey });
  try {
    // NO tools → the LLM interprets + presents; it never builds or signs a payload.
    const stream = client.messages.stream({ model: MODEL, max_tokens: 1500, system, messages });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done', hasTable: !!table, metrics: metrics ?? null })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err?.message ?? 'assistant error' })}\n\n`);
  } finally {
    res.end();
  }
});

type ChatTurn = { role: 'user' | 'assistant'; content: string };

/**
 * Transfer compiler: ONE non-streaming call. The LLM either answers
 * NO_TRANSFER / no block (→ returns false, nothing written — the strategy
 * chat takes over) or emits a ```transfer block that is zod-gated here. The
 * compiled parameters go to the frontend in the done event; the unsigned
 * payload itself is built later by POST /wallet-transfer/prepare when the
 * user opens the modal — never here, never signed (invariant #8).
 */
async function composeTransfer(
  res: Response,
  apiKey: string,
  message: string,
  history: ChatTurn[],
  wallets: TransferWalletSummary[],
): Promise<boolean> {
  const client = new Anthropic({ apiKey });
  const system = buildTransferComposerSystemPrompt(wallets);
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  let text: string;
  try {
    const reply = await client.messages.create({ model: MODEL, max_tokens: 600, system, messages });
    text = reply.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  } catch {
    return false; // compiler unavailable → let the strategy chat answer
  }

  const { prose, raw } = extractFencedBlock(text, 'transfer');
  if (!raw || /^\s*NO_TRANSFER\s*$/.test(text.trim())) return false;

  let transfer: CompiledTransfer | null = null;
  let transferIssues: Array<{ code: string; message: string }> | null = null;
  try {
    const parsed = TransferDraftSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      const d = parsed.data;
      // The source can ONLY be one of the user's linked wallets — an invented
      // or external "from" is dropped and the modal's source picker takes over.
      const from =
        d.fromAddress && wallets.some((w) => w.address.toLowerCase() === d.fromAddress!.toLowerCase())
          ? d.fromAddress
          : null;
      // "Never invent addresses" enforced in CODE, not just in the cage: the
      // destination must be one of the user's wallets or appear verbatim in
      // the user's own words. Anything else is dropped — the card shows the
      // field as "to choose" and the user types it themselves.
      const saidByUser = [message, ...history.filter((h) => h.role === 'user').map((h) => h.content)]
        .join('\n')
        .toLowerCase();
      const to =
        d.toAddress &&
        (wallets.some((w) => w.address.toLowerCase() === d.toAddress!.toLowerCase()) ||
          saidByUser.includes(d.toAddress.toLowerCase()))
          ? d.toAddress
          : null;
      transfer = {
        fromAddress: from,
        toAddress: to,
        amount: d.amount ?? null,
        asset: d.asset ?? null,
      };
    } else {
      transferIssues = parsed.error.issues
        .slice(0, 4)
        .map((i) => ({ code: 'invalid_transfer_field', message: `${i.path.join('.')}: ${i.message}` }));
    }
  } catch {
    transferIssues = [{ code: 'invalid_transfer_block', message: 'El bloque de transferencia no es JSON válido.' }];
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'delta', text: prose })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: 'done', mode: 'transfer', transfer, transferIssues })}\n\n`);
  res.end();
  return true;
}

/**
 * compose_moneyflow (F1): the LLM drafts a CMF inside a ```cmf block; the
 * server extracts + zod-validates it (ONE retry with the validation feedback
 * — an invalid draft is discarded, never repaired silently), stamps
 * version/id/origin ('ai_copilot'), and dry-run translates so the frontend
 * shows the exact AutomationRules before anything persists. This endpoint
 * writes NOTHING: activation happens later through POST /api/rules after the
 * user edits + confirms in the modal.
 */
async function composeMoneyFlow(
  res: Response,
  apiKey: string,
  message: string,
  history: ChatTurn[],
  conversationRef?: string,
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const client = new Anthropic({ apiKey });
  const system = buildMoneyFlowComposerSystemPrompt();
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-18).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message },
  ];

  const askModel = async (extra: Anthropic.MessageParam[]): Promise<string> => {
    // NO tools, no streaming — the reply is prose + at most one ```cmf block.
    const reply = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system,
      messages: [...messages, ...extra],
    });
    return reply.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  };

  try {
    let text = await askModel([]);
    let { prose, raw } = extractCmfBlock(text);
    let cmf: CanonicalMoneyFlow | null = null;
    let cmfIssues: Array<{ code: string; message: string }> | null = null;
    let rulesPreview: unknown[] | null = null;
    let translationNotes: string[] | null = null;

    // Validation gate with ONE retry (design: "si no valida, se descarta y se repregunta").
    for (let attempt = 0; raw && attempt < 2; attempt++) {
      const parsed = parseCmfDraft(raw);
      let feedback: string | null = null;

      if (!parsed.ok) {
        feedback = parsed.feedback;
      } else {
        const candidate = finalizeCmfDraft(parsed.draft, conversationRef);
        const violations = validateCmfInvariants(candidate);
        const translation = translateCmfToEvmRules(candidate);
        if (violations.length === 0 && translation.ok) {
          cmf = candidate;
          cmfIssues = null;
          rulesPreview = translation.rules;
          translationNotes = translation.notes;
          break;
        }
        const allIssues = [...violations, ...(translation.ok ? [] : translation.errors)];
        cmfIssues = allIssues.map(({ code, message: m }) => ({ code, message: m }));
        feedback = violationFeedback(allIssues);
      }

      if (attempt === 0 && feedback) {
        const retryText = await askModel([
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: `${feedback}. Reemite el bloque \`\`\`cmf corregido (solo los campos permitidos; si falta un dato, pídelo en vez de inventarlo).`,
          },
        ]);
        text = retryText;
        const extracted = extractCmfBlock(retryText);
        prose = extracted.prose;
        raw = extracted.raw;
        if (!raw) break; // the model chose to ask instead of re-emitting — fine
      } else if (!parsed.ok) {
        // Second failure on shape → no proposal; surface the reason honestly.
        cmfIssues = [{ code: 'invalid_cmf_block', message: parsed.feedback }];
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'delta', text: prose })}\n\n`);
    res.write(
      `data: ${JSON.stringify({
        type: 'done',
        mode: 'moneyflow',
        cmf,
        cmfIssues,
        rulesPreview,
        translationNotes,
      })}\n\n`,
    );
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err?.message ?? 'assistant error' })}\n\n`);
  } finally {
    res.end();
  }
}

export default router;

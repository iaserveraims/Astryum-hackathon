/**
 * /api/product-assistant — Product Assistant (Component 3)
 *
 * A conversational manual + GPS of the Astryum app for non-crypto users. It ONLY
 * knows the app (concepts, navigation, strategies) and, for anonymous callers,
 * sees NOTHING of the user.
 *
 * Design (build spec C3 + F29a), still the INVERSE of the personal agents in
 * agent.ts / aiChat.ts (no tools, no execution) but now with an OPTIONAL
 * read-only lens onto the caller's own account:
 *   - PUBLIC: no requireSiweAuth. It needs no login because it never REQUIRES
 *     user data — auth is optional, additive only.
 *   - OPTIONAL user context (F29a): if a valid `Authorization: Bearer <jwt>`
 *     arrives, we resolve userId (same `verifyToken` requireSiweAuth uses) and
 *     append a small READ-ONLY snapshot of the user's own account (net worth,
 *     health factor, positions, active rules) to the system prompt — built from
 *     the SAME server-side engines /api/portfolio and /api/risk already use
 *     (PortfolioEngine + RiskEngine), never a new data path. No token, or an
 *     invalid/expired one, or ANY failure while reading ⇒ behaves exactly like
 *     before (anonymous cage, no context). This never blocks or slows down the
 *     chat into an error — best-effort only.
 *   - NO tools, ever: the LLM is called with system + messages only, with or
 *     without user context, so it structurally cannot build payloads or reach
 *     the signing path (invariants #1 / #7 hold). With user data, the system
 *     prompt explicitly restates that it may only DESCRIBE, never recommend or
 *     act — the cage does not relax just because real numbers are in context.
 *   - STATELESS: reuses ONLY the SSE streaming mechanics of agent.ts — no DB
 *     persistence, no conversation storage. Multi-turn is client-driven via
 *     `history`. The optional userId is resolved per-request, never stored.
 *   - RATE-LIMITED: the endpoint is public and spends Astryum's own Anthropic
 *     key, so a small in-process limiter caps per-IP and global daily usage,
 *     unchanged by the auth addition.
 *   - KEY: always Astryum's env key (invariant #2, server-side), logged-in or
 *     not. The "user brings their own key" future only applies elsewhere.
 */

import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { buildProductAssistantSystemPrompt } from '../config/productAssistantPrompt';
import { createSlidingWindowLimiter } from '../middleware/slidingWindowRateLimit';
import { verifyToken } from '../services/SiweAuth';
import { prisma } from '../database/prismaClient';
import { PortfolioEngine } from '../engines/portfolio/PortfolioEngine';
import { RiskEngine } from '../engines/risk/RiskEngine';

const router = Router();

// Model: default to the latest capable model; a deployment can switch to a cheaper
// tier (e.g. claude-haiku-4-5) via env if cost/latency matter for this help chat.
const MODEL = process.env.PRODUCT_ASSISTANT_MODEL || 'claude-opus-4-8';

// Rate limiting — the endpoint is PUBLIC and spends Astryum's Anthropic key, so a
// per-IP sliding window + global daily cap bound the spend. Extracted + unit-tested.
const limiter = createSlidingWindowLimiter({
  perKeyMax: Number(process.env.PRODUCT_ASSISTANT_IP_MAX || 20),
  windowMs: Number(process.env.PRODUCT_ASSISTANT_IP_WINDOW_MS || 5 * 60_000),
  dailyMax: Number(process.env.PRODUCT_ASSISTANT_DAILY_MAX || 5000),
});

function clientIp(req: Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

// Max size of the injected user-data block (F29a) — keeps the addition small
// and bounded regardless of how many positions a wallet holds.
const USER_CONTEXT_MAX_CHARS = 1200;

/**
 * F29a — best-effort, READ-ONLY snapshot of the caller's OWN account, built
 * from the same engines /api/portfolio (PortfolioEngine) and /api/risk
 * (RiskEngine) already expose, so this is not a new data path. Returns null
 * (no context appended, cage behaves exactly like the anonymous path) if the
 * user has no EVM wallet on file or if ANY step fails — a slow/down RPC or
 * DefiLlama call must never break the chat.
 */
async function buildReadOnlyUserContext(userId: string): Promise<string | null> {
  try {
    const wallets = await prisma.wallet.findMany({
      where: { userId, ecosystem: 'evm' },
      orderBy: [{ isPrimary: 'desc' }, { lastActivity: 'desc' }],
      select: { id: true, address: true, chainId: true },
    });
    if (wallets.length === 0) return null;

    const primary = wallets[0];
    const chainId = primary.chainId ?? 14; // Flare default — same as /api/portfolio & /api/risk
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(primary.address, chainId);
    const risk = RiskEngine.getInstance().evaluateSnapshot(snapshot);
    const ruleCount = await prisma.automationRule.count({
      where: { walletId: { in: wallets.map((w) => w.id) }, enabled: true },
    });

    const positions =
      snapshot.positions
        .slice(0, 8)
        .map((p) => `${p.protocolId} ${p.kind} ${p.asset} $${Math.round(p.amountUSD)}`)
        .join(', ') || 'ninguna';

    const hfLine =
      risk.healthFactor !== undefined
        ? `- Health factor: ${risk.healthFactor.toFixed(2)} (nivel ${risk.riskLevel})` +
          (risk.liquidationPriceUSD !== undefined
            ? ` · Precio de liquidación: $${Math.round(risk.liquidationPriceUSD)}`
            : '')
        : `- Health factor: sin deuda activa (nivel ${risk.riskLevel})`;

    const block = [
      'DATOS REALES DEL USUARIO (solo lectura, para responder preguntas sobre SU cuenta; nunca recomiendes acciones ni prometas rendimientos):',
      `- Net worth: $${Math.round(snapshot.netWorthUSD)} · Collateral $${Math.round(snapshot.collateralUSD)} · Debt $${Math.round(snapshot.debtUSD)}`,
      hfLine,
      `- Posiciones: ${positions}`,
      `- Reglas activas: ${ruleCount}`,
    ].join('\n');

    return block.length > USER_CONTEXT_MAX_CHARS ? block.slice(0, USER_CONTEXT_MAX_CHARS) : block;
  } catch {
    return null;
  }
}

const ChatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  // Prior turns, supplied by the client (stateless server). Bounded.
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) }))
    .max(20)
    .optional(),
});

// POST /api/product-assistant/chat — SSE stream of the assistant's reply.
router.post('/chat', async (req: Request, res: Response) => {
  const rl = limiter.check(clientIp(req), Date.now());
  if (rl.limited) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    res.status(429).json({ error: 'RATE_LIMITED', retryAfter: rl.retryAfter });
    return;
  }

  const parse = ChatBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }
  const { message, history = [] } = parse.data;

  // Always Astryum's own key, logged-in or not (server-side, invariant #2).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ASSISTANT_UNAVAILABLE', message: 'Product assistant is not configured.' });
    return;
  }

  // Optional auth (F29a): the route stays PUBLIC (no requireSiweAuth), but if a
  // valid Bearer token is present we resolve userId the same way requireSiweAuth
  // does, so we can ground answers in the caller's REAL read-only data. No
  // header, malformed header, or an invalid/expired token ⇒ userId stays
  // undefined and the chat is byte-for-byte the anonymous path below.
  let userId: string | undefined;
  const authHeader = req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      try {
        userId = (await verifyToken(token)).userId;
      } catch {
        /* invalid/expired token — stay anonymous, cage untouched */
      }
    }
  }

  // Cage (always) + product manual, plus — ONLY for a resolved, logged-in
  // caller — a compact read-only account snapshot. The jaula does not relax:
  // the extra paragraph reiterates that real data may only be DESCRIBED, never
  // acted on. buildReadOnlyUserContext is best-effort and never throws.
  let system = buildProductAssistantSystemPrompt();
  if (userId) {
    const userContext = await buildReadOnlyUserContext(userId);
    if (userContext) {
      system +=
        `\n\n${userContext}\n\n` +
        'Con estos datos reales SOLO puedes DESCRIBIR la situación del usuario y explicar conceptos: nunca recomiendes acciones, nunca dictes qué hacer, nunca prometas rendimientos. ' +
        'Cualquier acción (preparar, proteger, deshacer) se hace desde las superficies de la app (Earn, Portfolio, Wallets); la firma siempre ocurre en la propia wallet del usuario, nunca aquí.';
    }
  }

  // Stateless: build the messages array from the client-supplied history + the new
  // message. No DB persistence, no conversation storage — only `system` above
  // ever changes based on who is asking.
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
    // NO `tools` → the model cannot build payloads or touch the signing path,
    // logged-in or not. `system` = cage + manual, plus the optional read-only
    // user snapshot assembled above.
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err?.message ?? 'assistant error' })}\n\n`);
  } finally {
    res.end();
  }
});

export default router;

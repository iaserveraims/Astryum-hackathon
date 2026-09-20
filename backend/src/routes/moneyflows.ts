/**
 * /api/moneyflows — CanonicalMoneyFlow endpoints (F1, estrategia conjunta).
 *
 * READ/TRANSLATE ONLY. This module NEVER creates rules, never prepares, never
 * signs: the create button keeps going through the existing SIWE+step-up-gated
 * POST /api/rules (one call per translated rule) so the agent gains no new
 * path toward a wallet. What lives here:
 *
 *   POST /translate — deterministic dry-run: validated CMF in → AutomationRule
 *                     payloads out (or readable errors). No DB writes.
 *   GET  /?address= — list a wallet's rules GROUPED by canonicalRef so a flow
 *                     can be shown/paused/deleted as a unit.
 *   GET  /capability — the honest per-chain matrix (the UI/agent read it,
 *                     they never guess).
 *   POST /:ref/pause · /:ref/resume · DELETE /:ref — flow-level revocation
 *                     (guardarraíl: revocación del dueño instantánea). These
 *                     flip/delete the flow's OWN AutomationRules only — pure
 *                     vigilancia; no signed anything is touched because in
 *                     sign-at-trigger mode nothing signed exists to revoke.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import { canonicalMoneyFlowSchema } from '../canonical/moneyflow/CanonicalMoneyFlow';
import { translateCmfToEvmRules } from '../canonical/moneyflow/CanonicalEvmTranslator';
import { FLARE_EVM_CAPABILITY, XRPL_CAPABILITY } from '../canonical/moneyflow/ChainCapability';

const router = Router();

// ── Ownership (productizer 13-sep) ───────────────────────────────────────────
// A public address is not a key. The wallet lookups here used to match the
// address ALONE, so any session could list, pause, resume or delete another
// user's flows by typing their address. Every lookup is now the session user's
// wallet rows for that address (same predicate as routes/rules.ts); a foreign
// address reads as an empty list and a foreign flow as 404 — indistinguishable
// from one that does not exist.

function sessionUserId(req: Request): string | null {
  return req.siwe?.userId ?? null;
}

/** The session user's wallet ids for `address` (case-insensitive, like rules). */
async function sessionWalletIds(userId: string, address: string): Promise<string[]> {
  const wallets = await prisma.wallet.findMany({
    where: { userId, address: { equals: address, mode: 'insensitive' } },
    select: { id: true },
  });
  return wallets.map((w) => w.id);
}

const translateBodySchema = z.object({
  cmf: canonicalMoneyFlowSchema,
  chainId: z.number().int().positive().default(14),
  /** XRPL only: compile 'transfer' to the COUNCIL rail (quorum signs). */
  governed: z.boolean().default(false),
});

// POST /api/moneyflows/translate — CMF → rule payloads (dry-run, no writes).
// chainId 1440002 compiles through the XRPL translator (M4, 2026-08-16);
// anything else keeps the Flare/EVM path. Price floors need a LIVE read to
// become drop-from-baseline rules — the route reads it (best-effort) so the
// translator stays pure; a failed read surfaces as its readable error.
router.post('/translate', asyncHandler(async (req: Request, res: Response) => {
  const parsed = translateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_cmf', issues: parsed.error.issues });
  }
  if (parsed.data.chainId === 1440002) {
    const { translateCmfToXrplRules } = await import('../canonical/moneyflow/CanonicalXrplTranslator');
    let prices: Record<string, number> | undefined;
    const priceSymbols = parsed.data.cmf.steps
      .map((s) => s.trigger)
      .filter((t) => t.kind === 'price')
      .map((t) => (t as { asset: { symbol: string } }).asset.symbol.toUpperCase());
    if (priceSymbols.length > 0) {
      try {
        const { createFTSOPriceProvider } = await import('../engines/normalisation/NormalisationEngine');
        const provider = await createFTSOPriceProvider();
        prices = {};
        for (const sym of [...new Set(priceSymbols)]) {
          const p = await provider.getPriceUSD(sym);
          if (p > 0) prices[sym] = p; // 0 = failed read — never a baseline
        }
      } catch {
        /* provider unavailable — the translator says so, readably */
      }
    }
    const result = translateCmfToXrplRules(parsed.data.cmf, {
      governed: parsed.data.governed,
      ...(prices ? { prices } : {}),
    });
    if (!result.ok) {
      return res.status(422).json({ error: 'cmf_not_translatable', errors: result.errors });
    }
    return res.json(result);
  }
  const result = translateCmfToEvmRules(parsed.data.cmf, { chainId: parsed.data.chainId });
  if (!result.ok) {
    return res.status(422).json({ error: 'cmf_not_translatable', errors: result.errors });
  }
  return res.json(result);
}));

// GET /api/moneyflows?address= — the wallet's rules grouped by canonicalRef.
// The address can be EVM (0x…) or XRPL (r…): the strategies page lists flows
// for whatever wallet is active, and the EVM-only regex used to 400 every
// XRPL wallet (console spam, 2026-07-19). Same loose schema as the flow-level
// routes; unknown addresses simply return an empty list.
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'missing_session' });
  const parsed = z.object({ address: z.string().min(4).max(64) }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const walletIds = await sessionWalletIds(userId, parsed.data.address);
  const rules = await prisma.automationRule.findMany({
    where: { walletId: { in: walletIds }, canonicalRef: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  const byRef = new Map<string, typeof rules>();
  for (const r of rules) {
    const ref = r.canonicalRef as string;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref)!.push(r);
  }
  const flows = [...byRef.entries()].map(([canonicalRef, flowRules]) => ({
    canonicalRef,
    // Rule names are `${cmf.name} · L${level}` — the shared prefix is the flow name.
    name: flowRules[0].name.replace(/ · L\d+$/, ''),
    enabled: flowRules.some((r) => r.enabled),
    rules: flowRules,
  }));
  return res.json({ count: flows.length, flows });
}));

// GET /api/moneyflows/capability — what each chain's translator compiles TODAY.
router.get('/capability', (_req: Request, res: Response) => {
  return res.json({ chains: [FLARE_EVM_CAPABILITY, XRPL_CAPABILITY] });
});

// GET /api/moneyflows/apy-markets — the curated markets an APY rule can watch
// (addresses stay server-side; the UI never hardcodes a contract).
router.get('/apy-markets', asyncHandler(async (_req: Request, res: Response) => {
  const { knownApyMarkets, readSupplyAprs } = await import('../services/flare/MarketRatesService');
  const markets = knownApyMarkets();
  // Best-effort live rate so the creator shows the CURRENT number with source.
  const rates = await readSupplyAprs(markets.map((m) => m.address)).catch(() => ({} as Record<string, number>));
  return res.json({
    markets: markets.map((m) => ({
      ...m,
      supplyAprPct: rates[m.address.toLowerCase()] ?? null,
      source: 'supplyRatePerTimestamp (live, per-second rate, simple APR)',
    })),
  });
}));

/** Resolve the flow's rule ids, scoped to the SESSION USER's wallet rows for
 *  the named address — a canonicalRef never operates on rules that hang off
 *  someone else's wallet, whatever address the caller names. */
async function flowRuleIds(canonicalRef: string, address: string, userId: string): Promise<string[]> {
  const walletIds = await sessionWalletIds(userId, address);
  if (walletIds.length === 0) return [];
  const rules = await prisma.automationRule.findMany({
    where: { canonicalRef, walletId: { in: walletIds } },
    select: { id: true, expiresAt: true },
  });
  return rules.map((r) => r.id);
}

const flowBodySchema = z.object({ address: z.string().min(4).max(64) });

// POST /api/moneyflows/:ref/pause — instant, owner-side, whole flow.
router.post('/:ref/pause', asyncHandler(async (req: Request, res: Response) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'missing_session' });
  const parsed = flowBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  const ids = await flowRuleIds(req.params.ref, parsed.data.address, userId);
  if (ids.length === 0) return res.status(404).json({ error: 'flow_not_found' });
  await prisma.automationRule.updateMany({ where: { id: { in: ids } }, data: { enabled: false } });
  return res.json({ ok: true, paused: ids.length });
}));

// POST /api/moneyflows/:ref/resume — re-arm the flow; expired rules stay off
// (renewal = a new create, so the TTL clamp always re-runs).
router.post('/:ref/resume', asyncHandler(async (req: Request, res: Response) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'missing_session' });
  const parsed = flowBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  const ids = await flowRuleIds(req.params.ref, parsed.data.address, userId);
  if (ids.length === 0) return res.status(404).json({ error: 'flow_not_found' });
  const result = await prisma.automationRule.updateMany({
    where: { id: { in: ids }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    data: { enabled: true },
  });
  if (result.count === 0) {
    return res.status(409).json({
      error: 'flow_expired',
      detail: 'Every rule in this flow is past its TTL — create the flow again to renew it (the 90-day clamp re-runs).',
    });
  }
  return res.json({ ok: true, resumed: result.count, expiredSkipped: ids.length - result.count });
}));

// DELETE /api/moneyflows/:ref?address= — remove the whole flow.
router.delete('/:ref', asyncHandler(async (req: Request, res: Response) => {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'missing_session' });
  const parsed = flowBodySchema.safeParse({ address: req.query.address });
  if (!parsed.success) return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  const ids = await flowRuleIds(req.params.ref, parsed.data.address, userId);
  if (ids.length === 0) return res.status(404).json({ error: 'flow_not_found' });
  await prisma.automationRule.deleteMany({ where: { id: { in: ids } } });
  return res.status(200).json({ ok: true, deleted: ids.length });
}));

export default router;

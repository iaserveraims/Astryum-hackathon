import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';

const router = Router();
// Rules are chain-agnostic (A.1): a wallet is an EVM 0x address OR an XRPL
// classic address. The old EVM-only regex silently made every XRPL rule
// impossible (400 before the wallet lookup) — same failure class as F1.
const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid_wallet');
const xrplAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, 'invalid_wallet');
const walletAddress = z.union([evmAddress, xrplAddress]);

// Trigger schema covers V1 trigger catalog
const triggerSchema = z.discriminatedUnion('type', [
  // HF is a ratio where 1.0 = liquidation; a threshold ≤1 can never protect and
  // one above 3 fires on every tick. LTV lives on the wire as a 0–1 ratio: an
  // unbounded number let "30" (meaning 30%) save a rule that could never fire.
  z.object({ type: z.literal('HF_BELOW'), threshold: z.number().gt(1).lte(3) }),
  z.object({ type: z.literal('HF_CRITICAL') }),
  z.object({ type: z.literal('LTV_ABOVE'), threshold: z.number().gt(0).lte(1) }),
  z.object({ type: z.literal('LIQUIDATION_DISTANCE_USD'), minBuffer: z.number() }),
  z.object({ type: z.literal('OUT_OF_RANGE'), positionId: z.string().optional() }),
  z.object({ type: z.literal('OUT_OF_RANGE_DURATION'), minutes: z.number(), positionId: z.string().optional() }),
  z.object({ type: z.literal('PRICE_DROP_PCT'), asset: z.string(), pct: z.number() }),
  z.object({ type: z.literal('REWARD_THRESHOLD'), minUSD: z.number() }),
  z.object({ type: z.literal('IDLE_BALANCE'), asset: z.string(), minUSD: z.number() }),
  z.object({ type: z.literal('TIME_TRIGGER'), cron: z.string() }),
  // Governed rotation trigger: live supply APY of a venue below thresholdPct
  // (MarketRatesService reads it per tick; missing data never fires).
  z.object({
    type: z.literal('APY_BELOW'),
    market: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'market must be an EVM address'),
    thresholdPct: z.number().positive(),
  }),
]);

const actionSchema = z.object({
  kind: z.enum([
    'supply', 'borrow', 'repay', 'withdraw',
    'addCollateral', 'addLiquidity', 'exitLP',
    'harvest', 'stake', 'unstake', 'swap',
    // Flare demo automations: FTSO compound (claimRewards) + delegation actions.
    // Additive — existing kinds are unchanged.
    'claimRewards', 'delegate', 'undelegate', 'wrap', 'unwrap',
    // XRPL savings-escrow (B.1): the rule prepares nothing server-side — the
    // trigger notifies and the user composes+signs the EscrowCreate in the
    // Savings surface (N1). params: { amountDrops, lockDays }.
    'escrow',
    // Governed MoneyFlows (sign-at-trigger with N signers): the trigger COMPOSES
    // a council proposal into the inbox — the QUORUM signs it; the rule itself
    // holds zero authority. 'councilPayment' = an XRPL Payment from the council
    // account (params: { council?, destination, amountDrops, memo? }) — live on
    // mainnet today. 'councilOrder' = a LegacyVault order via the FDC bridge
    // (params: { council?, orderAction, orderParams }) — gated by the deployed
    // Legacy stack (legacyStackConfig()).
    'councilPayment', 'councilOrder',
  ]).optional(),
  protocolId: z.string().optional(),
  positionId: z.string().optional(),
  params: z.record(z.unknown()).optional(),
});

const createRuleSchema = z.object({
  walletAddress,
  // 14 (Flare) for EVM rules; 1440002 (XRPL pseudo-id) for XRPL rules.
  chainId: z.number().int().positive().default(14),
  name: z.string().min(1),
  trigger: triggerSchema,
  action: actionSchema.optional().default({}),
  cooldownMinutes: z.number().int().nonnegative().default(15),
  maxValueUSD: z.number().positive().default(10_000),
  enabled: z.boolean().default(true),
  // CanonicalMoneyFlow link (F1): rules compiled from one CMF share its id so
  // the flow can be listed/paused/deleted as a unit. Optional — template and
  // manual rules carry no ref.
  canonicalRef: z.string().min(8).max(64).optional(),
  // Enforced TTL (ISO datetime). MoneyFlow-origin (canonicalRef) and council
  // rules ALWAYS get one — defaulted and clamped to ≤90 days server-side.
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

/** TTL guardrail: a rule that runs forever is a blank check to the future. */
const MAX_TTL_DAYS = 90;

/**
 * Resolve the enforced expiry for a rule. MoneyFlow-origin (canonicalRef) and
 * council-kind rules ALWAYS expire: absent → now+90d; provided → clamped to
 * ≤ now+90d. Other rules keep their provided value (clamped) or none (legacy
 * manual/template behaviour, unchanged).
 */
export function resolveRuleExpiry(input: {
  expiresAt?: string;
  canonicalRef?: string;
  actionKind?: string;
  now?: Date;
}): Date | null {
  const now = input.now ?? new Date();
  const cap = new Date(now.getTime() + MAX_TTL_DAYS * 24 * 60 * 60 * 1000);
  const mandatory = Boolean(input.canonicalRef) || input.actionKind === 'councilPayment' || input.actionKind === 'councilOrder';
  if (!input.expiresAt) return mandatory ? cap : null;
  const provided = new Date(input.expiresAt);
  if (Number.isNaN(provided.getTime()) || provided.getTime() <= now.getTime()) {
    // Born-expired or unparseable: fall back to the cap when mandatory, else drop it.
    return mandatory ? cap : null;
  }
  return provided.getTime() > cap.getTime() ? cap : provided;
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({ address: walletAddress }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const wallets = await prisma.wallet.findMany({
    // Case-insensitive: rows may hold the EIP-55 checksummed form while the
    // caller sends lowercase (or vice versa) — same wallet either way.
    where: { address: { equals: parsed.data.address, mode: 'insensitive' } },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);
  const rules = await prisma.automationRule.findMany({
    where: { walletId: { in: walletIds } },
    orderBy: { createdAt: 'desc' },
  });
  return res.json({ count: rules.length, rules });
}));

router.post('/', async (req: Request, res: Response) => {
  const parsed = createRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    let wallet = await prisma.wallet.findFirst({
      where: { address: parsed.data.walletAddress, chainId: parsed.data.chainId },
    });
    if (!wallet) {
      // Wallet rows keep their connect-time chainId (EVM connects store 1/null;
      // SIWE stores no row on 14). The RULE's chain scope does NOT live here:
      // it is the Protocol row resolved below (slug@chainId) — the engine tick
      // reads rule.protocol.chainId first (fix 2026-07-25; wallet.chainId is
      // only the fallback for protocol-less rules). So an address registered
      // under ANOTHER chain row is still this user's wallet. Case-insensitive:
      // EIP-55 vs lowercase storage.
      wallet = await prisma.wallet.findFirst({
        where: { address: { equals: parsed.data.walletAddress, mode: 'insensitive' } },
      });
    }
    if (!wallet) return res.status(404).json({ error: 'wallet_not_registered' });

    const protoId = parsed.data.action.protocolId;
    const protocol = protoId
      ? await prisma.protocol.findFirst({ where: { slug: protoId, chainId: parsed.data.chainId } })
      : null;

    const rule = await prisma.automationRule.create({
      data: {
        walletId: wallet.id,
        protocolId: protocol?.id,
        name: parsed.data.name,
        trigger: parsed.data.trigger as object,
        action: parsed.data.action as object,
        canonicalRef: parsed.data.canonicalRef,
        enabled: parsed.data.enabled,
        cooldownMinutes: parsed.data.cooldownMinutes,
        maxValueUSD: parsed.data.maxValueUSD,
        expiresAt: resolveRuleExpiry({
          expiresAt: parsed.data.expiresAt,
          canonicalRef: parsed.data.canonicalRef,
          actionKind: parsed.data.action.kind,
        }),
      },
    });
    return res.status(201).json(rule);
  } catch (err) {
    return res.status(500).json({
      error: 'create_rule_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  const partialSchema = createRuleSchema.partial().omit({ walletAddress: true });
  const parsed = partialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const data: Record<string, unknown> = { ...parsed.data };
    if (typeof data.expiresAt === 'string') {
      // Same 90-day clamp as creation — a PATCH cannot mint a longer TTL.
      data.expiresAt = resolveRuleExpiry({
        expiresAt: data.expiresAt,
        canonicalRef: 'patched-rule', // force the mandatory clamp path
      });
    }
    const updated = await prisma.automationRule.update({
      where: { id: req.params.id },
      data: data as any,
    });
    return res.json(updated);
  } catch (err) {
    return res.status(404).json({ error: 'rule_not_found', message: err instanceof Error ? err.message : String(err) });
  }
});

router.post('/:id/enable', async (req: Request, res: Response) => {
  try {
    const r = await prisma.automationRule.update({
      where: { id: req.params.id },
      data: { enabled: true },
    });
    return res.json(r);
  } catch {
    return res.status(404).json({ error: 'rule_not_found' });
  }
});

router.post('/:id/disable', async (req: Request, res: Response) => {
  try {
    const r = await prisma.automationRule.update({
      where: { id: req.params.id },
      data: { enabled: false },
    });
    return res.json(r);
  } catch {
    return res.status(404).json({ error: 'rule_not_found' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.automationRule.delete({ where: { id: req.params.id } });
    return res.status(204).end();
  } catch {
    return res.status(404).json({ error: 'rule_not_found' });
  }
});

router.get('/:id/runs', asyncHandler(async (req: Request, res: Response) => {
  const runs = await prisma.automationRun.findMany({
    where: { ruleId: req.params.id },
    orderBy: { triggeredAt: 'desc' },
    take: 50,
  });
  return res.json({ count: runs.length, runs });
}));

export default router;

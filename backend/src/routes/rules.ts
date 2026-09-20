import { Router, Request, Response } from 'express';
import { isValidClassicAddress } from 'xrpl';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import {
  isSessionRevoked,
  isTransactionBusy,
  respondBusyRetry,
  respondSessionRevoked,
  withLiveSession,
} from '../services/identity/liveSession';

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
  // Price protection (M3): pct = drop from baselineUsd that fires. The
  // baseline is the price the owner saw at rule creation — it lives IN the
  // rule (deterministic, auditable); without it the evaluator never fires.
  z.object({
    type: z.literal('PRICE_DROP_PCT'),
    asset: z.string().min(1),
    pct: z.number().gt(0).lte(100),
    baselineUsd: z.number().positive().optional(),
  }),
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
    // Personal «domiciliación» (M1, sign-at-trigger with ONE signer): the tick
    // validates and nudges; the Payment is composed FRESH at signing time
    // (POST /:id/scheduled-payment/prepare) and the OWNER signs it in Xaman.
    // params: { destination, amountDrops, memo?, destinationTag? }.
    'scheduledPayment',
    // W5/B7 — Ethereum repay for the FXRP/RLUSD Morpho market (M1 pattern):
    // the tick validates the LIVE position (emRepayFireCheck) and nudges; the
    // repay legs are composed FRESH by POST /eth-morpho/prepare at the signing
    // door and the OWNER signs on chain 1. params: { mode?: 'partial'|'full' }.
    'emRepay',
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
  const mandatory =
    Boolean(input.canonicalRef) ||
    input.actionKind === 'councilPayment' ||
    input.actionKind === 'councilOrder' ||
    // A standing payment order that never expires is the blank check this
    // guardrail exists for — the personal kind expires like the governed ones.
    input.actionKind === 'scheduledPayment';
  if (!input.expiresAt) return mandatory ? cap : null;
  const provided = new Date(input.expiresAt);
  if (Number.isNaN(provided.getTime()) || provided.getTime() <= now.getTime()) {
    // Born-expired or unparseable: fall back to the cap when mandatory, else drop it.
    return mandatory ? cap : null;
  }
  return provided.getTime() > cap.getTime() ? cap : provided;
}

// ── Ownership ────────────────────────────────────────────────────────────────
// Every route is scoped to the session user (requireSiweAuth sets req.siwe).
// A rule belongs to whoever owns its wallet row; anyone else gets the same 404
// as a missing id, so rule ids and addresses cannot be probed.

function sessionUserId(req: Request): string | null {
  return (req as Request & { siwe?: { userId?: string } }).siwe?.userId ?? null;
}

/** Wallet ids the user owns — optionally only the rows for one address. */
async function sessionWalletIds(userId: string, address?: string): Promise<string[]> {
  const wallets = await prisma.wallet.findMany({
    where: {
      userId,
      // Case-insensitive: rows may hold the EIP-55 checksummed form while the
      // caller sends lowercase (or vice versa) — same wallet either way.
      ...(address ? { address: { equals: address, mode: 'insensitive' as const } } : {}),
    },
    select: { id: true },
  });
  return wallets.map((w) => w.id);
}

/** The rule (with its wallet), only if the wallet belongs to the user. */
async function findOwnedRule(id: string, userId: string) {
  const rule = await prisma.automationRule.findUnique({
    where: { id },
    include: { wallet: { select: { address: true, userId: true } } },
  });
  if (!rule || rule.wallet?.userId !== userId) return null;
  return rule;
}

// ── Council membership (productizer-it6) ─────────────────────────────────────
//
// WHAT FAILED IN SILENCE: a 'councilPayment' / 'councilOrder' rule carries a
// free `params.council`, and this router only asked that the rule's WALLET be
// the caller's. On fire, AutomationEngine → composeCouncilRuleTx →
// createCouncilProposalFromRule created a proposal on THAT council with the
// caller as proposer — no membership check at all. It walked around the
// 403 NOT_A_COUNCIL_MEMBER that `POST /api/council/proposals` enforces: a
// stranger could pin any council's Sequence for 7 days (renewable), drop a
// phishing payment into a family's inbox and hold proposer powers on it.
//
// The floor is the SAME predicate that door asks (`sessionIsCouncilMember`),
// fed with the signer list read OFF THE LEDGER — never one the caller supplies.
// The council is resolved exactly as composeCouncilRuleTx resolves it
// (`params.council ?? wallet address`), so what is checked here is what fires.
//
// it. 17 (finding 2.1b) — CLOSED: that helper no longer reads the `wallet`
// table. Membership is a PROVEN address (a signature-backed `WalletBinding`, or
// the address this session logged in with), because a watch-only import proves
// nothing — and a council's signer addresses are public on the ledger, so
// declaring one was enough to propose on that council's behalf and pin its
// Sequence for seven days. The session address is forwarded from the route.

const COUNCIL_KINDS = new Set(['councilPayment', 'councilOrder']);
const COUNCIL_READ_TIMEOUT_MS = 4_000;

function isCouncilKind(kind: unknown): boolean {
  return typeof kind === 'string' && COUNCIL_KINDS.has(kind);
}

/** Key-order-insensitive JSON form (undefined props dropped, as JSON does). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * True when a PATCH re-sends the council action the rule ALREADY holds.
 * RuleEditModal clones the action to change only the cooldown/name; the seat
 * check is about the council the rule would propose on, and an identical
 * action (same kind, same params — hence the same `params.council ?? wallet`
 * resolution, the wallet being immutable on PATCH) proposes on the same one.
 * Re-reading the SignerList there only turned a slow ledger into a 502 on a
 * harmless edit. The stored action is normalised through the SAME schema the
 * incoming one went through, so keys the schema strips are not a "change".
 * Anything that differs — kind, council, destination, amount — re-checks.
 */
function isUnchangedCouncilAction(incoming: z.infer<typeof actionSchema>, stored: unknown): boolean {
  const normalised = actionSchema.safeParse(stored);
  if (!normalised.success || !isCouncilKind(normalised.data.kind)) return false;
  return canonicalJson(incoming) === canonicalJson(normalised.data);
}

/** null = the session sits on the council this action would propose on. */
async function councilMembershipRefusal(
  userId: string,
  params: Record<string, unknown> | undefined,
  walletAddress: string,
  // it. 17 (finding 2.1b): membership is now read from PROVEN addresses — a
  // signature-backed binding, or the address this very session logged in with.
  // The `wallet` table never proved anything (a watch-only import carries
  // `ownershipProof: 'none'`), which is how a stranger could declare a
  // council's public signer address and propose on its behalf. Passing the
  // session address keeps a member who signed in with their signer key from
  // having to re-bind.
  sessionWalletAddress?: string | null,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const council = String(params?.council ?? walletAddress);
  if (!isValidClassicAddress(council)) {
    return {
      status: 400,
      body: {
        error: 'invalid_council',
        detail: `A council rule needs an XRPL council account: params.council is missing and the rule's wallet (${walletAddress}) is not an r-address.`,
      },
    };
  }
  const [{ xrplProvider }, { sessionIsCouncilMember, PROVE_MEMBERSHIP_HINT }] = await Promise.all([
    import('../integrations/providers/chain/XRPLProvider'),
    import('./councilProposals'),
  ]);
  let signerCouncil: Awaited<ReturnType<typeof xrplProvider.getSignerCouncil>>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    signerCouncil = await Promise.race([
      xrplProvider.getSignerCouncil(council),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`signer list ${council} timed out after ${COUNCIL_READ_TIMEOUT_MS}ms`)), COUNCIL_READ_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    return {
      status: 502,
      body: {
        error: 'COUNCIL_READ_FAILED',
        detail:
          'XRPL could not be read, so we could not check that you sit on this council. Nothing was saved — try again in a moment. ' +
          `(${(e as Error).message})`,
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!signerCouncil) {
    return {
      status: 409,
      body: { error: 'NOT_A_COUNCIL', detail: `${council} has no SignerList — it is not a council account` },
    };
  }
  if (!(await sessionIsCouncilMember(userId, { signerList: signerCouncil.signers }, sessionWalletAddress ?? null))) {
    return {
      status: 403,
      body: {
        error: 'NOT_A_COUNCIL_MEMBER',
        // it. 19 (2.3b): the hint travels, so someone who DOES sit on the list
        // and only ever registered the address learns the one thing that fixes
        // it — signing it once — instead of reading a flat no.
        detail:
          'You do not hold a seat on this council, so a rule of yours cannot propose on its behalf. Only a member of its ' +
          `signer list can create a council rule — a proposal holds the account's only Sequence for days. ${PROVE_MEMBERSHIP_HINT}`,
      },
    };
  }
  return null;
}

router.use((req: Request, res: Response, next) => {
  if (!sessionUserId(req)) {
    res.status(401).json({ error: 'missing_siwe_session' });
    return;
  }
  next();
});

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({ address: walletAddress }).safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const walletIds = await sessionWalletIds(sessionUserId(req)!, parsed.data.address);
  // Not the caller's wallet: same answer as an unknown one.
  if (walletIds.length === 0) return res.status(404).json({ error: 'wallet_not_registered' });
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
  // A rule can only bind to one of the caller's OWN wallet rows — never to
  // another user's row for the same address.
  const userId = sessionUserId(req)!;
  try {
    let wallet = await prisma.wallet.findFirst({
      where: { userId, address: parsed.data.walletAddress, chainId: parsed.data.chainId },
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
        where: { userId, address: { equals: parsed.data.walletAddress, mode: 'insensitive' } },
      });
    }
    if (!wallet) return res.status(404).json({ error: 'wallet_not_registered' });

    // A council rule proposes on a council's behalf when it fires: only a
    // member of that council may create one (see councilMembershipRefusal).
    if (isCouncilKind(parsed.data.action.kind)) {
      const refusal = await councilMembershipRefusal(
        userId,
        parsed.data.action.params,
        wallet.address,
        req.siwe?.walletAddress ?? null,
      );
      if (refusal) return res.status(refusal.status).json(refusal.body);
    }

    const protoId = parsed.data.action.protocolId;
    const protocol = protoId
      ? await prisma.protocol.findFirst({ where: { slug: protoId, chainId: parsed.data.chainId } })
      : null;

    // The rule is created under a live-session check (it. 14, 4.4): the council
    // read above can take seconds, and a rule written after an account takeover
    // would fire on the owner's wallet with the previous holder's action.
    const rule = await withLiveSession(req.siwe, (tx) => tx.automationRule.create({
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
    }));
    return res.status(201).json(rule);
  } catch (err) {
    if (isSessionRevoked(err)) return respondSessionRevoked(res);
    // Contention with the takeover's long transaction is a WAIT, not a fault:
    // 503 «try again» (it. 18, 3.6), never a 500 that reads as «we broke».
    if (isTransactionBusy(err)) return respondBusyRetry(res);
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
    // Ownership BEFORE the write: a PATCH can rewrite `action` (e.g. a
    // scheduled payment's destination), so a foreign id must never reach update.
    const owned = await findOwnedRule(req.params.id, sessionUserId(req)!);
    if (!owned) {
      return res.status(404).json({ error: 'rule_not_found' });
    }
    // The action is replaced wholesale: a PATCH that makes (or keeps) it a
    // council kind is held to the same seat check as creation, against the
    // council it would propose on after the write — so `params.council` cannot
    // be re-pointed to another family's account. Re-sending the action the rule
    // already holds is not a change and pays for no ledger read.
    if (
      parsed.data.action &&
      isCouncilKind(parsed.data.action.kind) &&
      !isUnchangedCouncilAction(parsed.data.action, owned.action)
    ) {
      const refusal = await councilMembershipRefusal(
        sessionUserId(req)!,
        parsed.data.action.params,
        owned.wallet?.address ?? '',
        req.siwe?.walletAddress ?? null,
      );
      if (refusal) return res.status(refusal.status).json(refusal.body);
    }
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
    if (!(await findOwnedRule(req.params.id, sessionUserId(req)!))) {
      return res.status(404).json({ error: 'rule_not_found' });
    }
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
    if (!(await findOwnedRule(req.params.id, sessionUserId(req)!))) {
      return res.status(404).json({ error: 'rule_not_found' });
    }
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
    if (!(await findOwnedRule(req.params.id, sessionUserId(req)!))) {
      return res.status(404).json({ error: 'rule_not_found' });
    }
    await prisma.automationRule.delete({ where: { id: req.params.id } });
    return res.status(204).end();
  } catch {
    return res.status(404).json({ error: 'rule_not_found' });
  }
});

// POST /api/rules/:id/scheduled-payment/prepare — the signing door of the
// personal «domiciliación» (M1). Composes the rule's Payment FRESH (nothing
// signed or composed ever waits in storage) and returns it UNSIGNED with the
// disclosure; the owner signs in Xaman. Prepare-only: no signing, no
// broadcast, no discretion — every field comes from the rule the owner wrote.
router.post('/:id/scheduled-payment/prepare', asyncHandler(async (req: Request, res: Response) => {
  const rule = await findOwnedRule(req.params.id, sessionUserId(req)!);
  if (!rule) return res.status(404).json({ error: 'rule_not_found' });
  const action = (rule.action ?? {}) as { kind?: string; params?: Record<string, unknown> };
  if (action.kind !== 'scheduledPayment') {
    return res.status(400).json({ error: 'not_a_scheduled_payment', detail: `rule ${rule.id} has action kind "${action.kind ?? 'none'}"` });
  }
  try {
    const { composeScheduledPaymentTx } = await import('../services/ScheduledPaymentService');
    const composed = composeScheduledPaymentTx(rule.wallet.address, action.params ?? {});
    return res.json({
      xrplTx: composed.xrplTx,
      summary: composed.summary,
      disclosure: {
        disclosedToUser: true,
        astryumSigns: false,
        note:
          'Astryum composed this Payment unsigned from your own rule. You review and sign it in Xaman — nothing moves without your signature. If the destination account is new, XRPL requires the base reserve (1 XRP) to activate it.',
        facts: {
          rule: rule.name,
          from: rule.wallet.address,
          to: String((action.params ?? {}).destination ?? ''),
          amountDrops: String((action.params ?? {}).amountDrops ?? ''),
        },
      },
    });
  } catch (e) {
    return res.status(400).json({ error: 'SCHEDULED_PAYMENT_INVALID', detail: (e as Error).message });
  }
}));

router.get('/:id/runs', asyncHandler(async (req: Request, res: Response) => {
  if (!(await findOwnedRule(req.params.id, sessionUserId(req)!))) {
    return res.status(404).json({ error: 'rule_not_found' });
  }
  const runs = await prisma.automationRun.findMany({
    where: { ruleId: req.params.id },
    orderBy: { triggeredAt: 'desc' },
    take: 50,
  });
  return res.json({ count: runs.length, runs });
}));

export default router;

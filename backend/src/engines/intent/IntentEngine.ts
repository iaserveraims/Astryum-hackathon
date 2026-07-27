import { prisma } from '../../database/prismaClient';
import { ProtocolRegistry } from '../../connectors/protocols/ProtocolRegistry';
import { registerFlareAdapters } from '../../connectors/protocols/adapters';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { policyGuard } from '../../control-plane/PolicyGuard';
import { auditEventRepository } from '../../control-plane/AuditEventRepository';
import { randomUUID } from 'crypto';
import type { PolicyEvaluable, PolicyCheck } from '../../control-plane/policy/types';
import type { ActionType as CanonicalActionType } from '../../canonical/types/Action';
import type { IntentStatus as DomainStatus } from '../../types/domain/Intent';
import type {
  ProtocolAction,
  ProtocolActionKind,
} from '../../types/domain/Protocol';

const INTENT_TTL_MS = 5 * 60 * 1000;

let bootstrapped = false;
function ensureAdapters(): void {
  if (bootstrapped) return;
  registerFlareAdapters(ProtocolRegistry.getInstance());
  bootstrapped = true;
}

/** V2 lifecycle FSM. PENDING_USER_REVIEW is the entry state for V2 prepared intents. */
export type IntentLifecycleStatus =
  | 'PENDING_USER_REVIEW'  // V2: intent prepared, awaiting user review before simulation
  | 'DRAFT'
  | 'SIMULATED'
  | 'READY_TO_SIGN'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

const VALID_TRANSITIONS: Record<IntentLifecycleStatus, IntentLifecycleStatus[]> = {
  PENDING_USER_REVIEW: ['SIMULATED', 'CANCELLED', 'EXPIRED'],
  DRAFT: ['SIMULATED', 'PENDING_USER_REVIEW', 'CANCELLED', 'EXPIRED'],
  SIMULATED: ['READY_TO_SIGN', 'CANCELLED', 'EXPIRED'],
  READY_TO_SIGN: ['SIGNED', 'CANCELLED', 'EXPIRED'],
  SIGNED: ['SUBMITTED', 'FAILED'],
  SUBMITTED: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

// Map V2 lifecycle to Prisma IntentStatus enum
const LIFECYCLE_TO_PRISMA: Record<IntentLifecycleStatus, DomainStatus> = {
  PENDING_USER_REVIEW: 'pending_user_review',
  DRAFT: 'building',
  SIMULATED: 'building',
  READY_TO_SIGN: 'proposed',
  SIGNED: 'signed',
  SUBMITTED: 'broadcast',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'expired',
};

export interface CreateIntentInput {
  walletAddress: string;
  chainId?: number;
  sessionId: string;
  protocolId: string;
  actionKind: ProtocolActionKind;
  positionId?: string;
  /** Optional pre-existing simulation. If absent, IntentEngine runs simulation now. */
  simulationResultId?: string;
  /** Action-specific params, used for both simulation and txData encoding. */
  params: Record<string, unknown>;
  source?: 'user' | 'automation' | 'ai';
  /** When the intent originates from an automation rule, pass it for cooldown gating. */
  ruleId?: string;
  ruleCooldownMinutes?: number;
}

export class PolicyBlockedError extends Error {
  readonly code = 'policy_blocked';
  constructor(public readonly result: PolicyCheck) {
    super(`policy_blocked:${result.blockReason ?? 'unknown'}`);
    this.name = 'PolicyBlockedError';
  }
}

export class IntentEngine {
  private static instance: IntentEngine | null = null;
  static getInstance(): IntentEngine {
    if (!this.instance) this.instance = new IntentEngine();
    return this.instance;
  }

  /**
   * Build an intent end-to-end:
   *   1. Resolve wallet row
   *   2. Reuse simulation by id OR run a new one
   *   3. Build adapter intent (txData via BaseAdapter.buildTransactionIntent)
   *   4. Persist as Prisma TransactionIntent in `proposed` (READY_TO_SIGN) state
   *   5. Append AuditLog
   */
  async createIntent(input: CreateIntentInput) {
    ensureAdapters();
    const chainId = input.chainId ?? 14;

    const adapter = ProtocolRegistry.getInstance().getAdapter(
      input.protocolId,
      chainId
    );
    if (!adapter) throw new Error(`unknown_protocol: ${input.protocolId}`);
    if (!adapter.isActive) {
      throw Object.assign(new Error('protocol_inactive'), {
        code: 'protocol_inactive',
        protocolId: input.protocolId,
      });
    }

    // 1. wallet
    let wallet = await prisma.wallet.findFirst({
      where: { address: input.walletAddress, chainId },
    });
    if (!wallet) {
      // Same fallback as rules.ts: wallet rows keep their connect-time chainId
      // (or null when the Chain registry lacks the row) and may hold a
      // different casing than the caller — the address still identifies the
      // same wallet.
      wallet = await prisma.wallet.findFirst({
        where: { address: { equals: input.walletAddress, mode: 'insensitive' } },
      });
    }
    if (!wallet) {
      throw Object.assign(new Error('wallet_not_registered'), {
        code: 'wallet_not_registered',
      });
    }

    // 2. simulation: reuse or create
    let simResultId: string | undefined = input.simulationResultId;
    let priceTimestamp = new Date();
    if (simResultId) {
      const sim = await SimulationEngine.getInstance().getById(simResultId);
      if (!sim) throw new Error('simulation_not_found');
      if (sim.expiresAt && sim.expiresAt < new Date()) {
        throw new Error('simulation_expired');
      }
      priceTimestamp = sim.priceTimestamp;
    } else {
      const sim = await SimulationEngine.getInstance().simulate(
        input.actionKind,
        {
          walletAddress: input.walletAddress,
          protocolId: input.protocolId,
          positionId: input.positionId,
          chainId,
          params: input.params,
        }
      );
      simResultId = sim.id;
      priceTimestamp = sim.priceTimestamp;
    }

    // 3. adapter intent (carries txData)
    const action: ProtocolAction = {
      kind: input.actionKind,
      protocolId: input.protocolId,
      chainId,
      wallet: input.walletAddress,
      positionId: input.positionId,
      inputs: input.params,
    };
    const adapterIntent = await adapter.buildTransactionIntent(action, {
      owner: input.walletAddress,
      sessionId: input.sessionId,
      priceSnapshot: { takenAt: priceTimestamp, prices: {} },
    });

    // 4. find Protocol row (for FK). Self-healing: an environment whose DB was
    // never seeded (prod Railway, found live 2026-07-18: every automation
    // intent died on transaction_intents_protocolId_fkey) gets the row created
    // here from the adapter vocabulary — registry data, not user data.
    let protocolRow = await prisma.protocol.findFirst({
      where: { slug: input.protocolId, chainId },
    });
    if (!protocolRow) {
      protocolRow = await prisma.protocol.findFirst({ where: { slug: input.protocolId } });
    }
    if (!protocolRow) {
      try {
        // The Protocol row's own FK needs the Chain row too — same seed gap.
        await prisma.chain.upsert({
          where: { chainId },
          update: {},
          create: {
            chainId,
            name: chainId === 14 ? 'Flare' : `chain-${chainId}`,
            caip2: chainId === 14 ? 'eip155:14' : undefined,
            rpcHttp: chainId === 14 ? 'https://flare-api.flare.network/ext/C/rpc' : '',
            explorer: chainId === 14 ? 'https://flarescan.com' : '',
            blockTime: 1800,
            nativeSymbol: chainId === 14 ? 'FLR' : 'ETH',
          },
        });
        const CATEGORY_BY_SLUG: Record<string, 'LENDING' | 'DEX' | 'STAKING'> = {
          kinetic: 'LENDING',
          sparkdex: 'DEX',
          enosys: 'DEX',
          sceptre: 'STAKING',
          firelight: 'STAKING',
          ftso: 'STAKING',
          wflr: 'STAKING',
        };
        protocolRow = await prisma.protocol.upsert({
          where: { slug: input.protocolId },
          update: {},
          create: {
            slug: input.protocolId,
            name: input.protocolId,
            category: CATEGORY_BY_SLUG[input.protocolId] ?? 'LENDING',
            chainId,
            isActive: true,
          },
        });
      } catch (err) {
        console.warn(`[intent] protocol row self-seed failed for ${input.protocolId}: ${(err as Error).message}`);
      }
    }

    // 4b. PolicyGuard — fail-closed before persisting. The intent never enters
    // the `proposed` state (READY_TO_SIGN) if it violates the user's mandate.
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INTENT_TTL_MS);

    const evaluable: PolicyEvaluable = {
      action: {
        type: input.actionKind as CanonicalActionType,
        targetProtocol: input.protocolId,
        targetChain: chainId,
      },
      txData: adapterIntent.txData
        ? {
            to: adapterIntent.txData.to,
            data: adapterIntent.txData.data,
            chainId: adapterIntent.txData.chainId,
          }
        : undefined,
      valueUSD: extractValueUSD(input.params, adapterIntent.impact),
      slippageBps: extractSlippageBps(input.params),
      simulationId: simResultId,
      simulatedAt: adapterIntent.simulatedAt.toISOString(),
      pricesFreshAt: adapterIntent.pricesFreshAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      riskAfter: {
        healthFactor: adapterIntent.riskDelta.hfAfter,
        score: adapterIntent.riskDelta.scoreAfter,
      },
    };

    const traceId = randomUUID();
    const guardStart = Date.now();
    const policyResult = policyGuard.evaluate(evaluable, {
      userId: wallet.userId,
      ruleId: input.ruleId,
      ruleCooldownMinutes: input.ruleCooldownMinutes,
      now,
      // P17 — wallet ↔ userId binding is verified by the wallet lookup above
      // (we threw `wallet_not_registered` on null). Pass `true` explicitly so
      // the guard records walletAllowed=true.
      walletRegisteredToUser: true,
      // P18 — sessionId comes from the SIWE-signed sessionId on the intent.
      sessionId: input.sessionId,
      sessionValid: Boolean(input.sessionId),
      // P16 — V1.1 always uses FTSO for price simulations, which is
      // oracle_verified by SourceRecord.
      priceTrustLevel: 'oracle_verified',
    });

    void auditEventRepository.record(
      {
        traceId,
        providerId: 'policy-guard',
        capability: 'intent.create',
        decision: policyResult.passed ? 'pass' : 'fail',
        policyChecks: policyResult.errors.map((e) => ({
          policyId: 'P1',
          result: 'fail' as const,
          reason: `${e.code}: ${e.message}`,
        })),
        latencyMs: Date.now() - guardStart,
        cached: false,
        fellBack: false,
        timestamp: policyResult.evaluatedAt,
      },
      {
        userId: wallet.userId,
        wallet: input.walletAddress,
        action: input.actionKind,
        protocol: input.protocolId,
        blockReason: policyResult.blockReason,
        source: input.source ?? 'user',
        ruleId: input.ruleId,
      },
    );

    if (!policyResult.passed) {
      throw new PolicyBlockedError(policyResult);
    }

    // 5. persist (READY_TO_SIGN per FSM == prisma `proposed`)

    const intent = await prisma.transactionIntent.create({
      data: {
        owner: input.walletAddress,
        walletId: wallet.id,
        chainId,
        sessionId: input.sessionId,
        action: input.actionKind as any,
        protocolId: protocolRow?.id ?? input.protocolId,
        positionId: input.positionId,
        simulationResultId: simResultId,
        inputs: serialiseBigints(input.params) as object,
        preState: serialiseBigints(adapterIntent.preState) as object,
        simulation: serialiseBigints(adapterIntent.simulation) as object,
        simulatedAt: adapterIntent.simulatedAt,
        pricesFreshAt: adapterIntent.pricesFreshAt,
        impact: serialiseBigints(adapterIntent.impact) as object,
        riskDelta: serialiseBigints(adapterIntent.riskDelta) as object,
        explanation: adapterIntent.explanation,
        warnings: adapterIntent.warnings,
        txData: adapterIntent.txData
          ? (serialiseBigints(adapterIntent.txData) as object)
          : undefined,
        status: 'proposed',
        expiresAt,
      },
    });

    await this.audit(input.walletAddress, intent.id, 'create', {
      from: null,
      to: 'READY_TO_SIGN',
      source: input.source ?? 'user',
    });

    return intent;
  }

  async getIntent(id: string) {
    return prisma.transactionIntent.findUnique({ where: { id } });
  }

  async listUserIntents(address: string, status?: IntentLifecycleStatus) {
    return prisma.transactionIntent.findMany({
      where: {
        owner: address,
        ...(status ? { status: LIFECYCLE_TO_PRISMA[status] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async cancelIntent(id: string, reason?: string) {
    const intent = await prisma.transactionIntent.findUnique({ where: { id } });
    if (!intent) throw new Error('intent_not_found');
    if (intent.status !== 'proposed' && intent.status !== 'building') {
      throw new Error(`cannot_cancel_status:${intent.status}`);
    }
    const updated = await prisma.transactionIntent.update({
      where: { id },
      data: { status: 'expired', failureReason: reason ?? 'cancelled-by-user' },
    });
    await this.audit(intent.owner, id, 'cancel', {
      from: intent.status,
      to: 'CANCELLED',
      reason,
    });
    return updated;
  }

  /** Cron-callable: marks all `proposed`/`building` intents past expiresAt as expired. */
  async expireStaleIntents(): Promise<number> {
    const now = new Date();
    const stale = await prisma.transactionIntent.findMany({
      where: {
        status: { in: ['proposed', 'building', 'pending_user_review'] },
        expiresAt: { lt: now },
      },
      select: { id: true, owner: true, status: true },
    });
    if (stale.length === 0) return 0;
    await prisma.transactionIntent.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: { status: 'expired' },
    });
    for (const s of stale) {
      await this.audit(s.owner, s.id, 'expire', {
        from: s.status,
        to: 'EXPIRED',
      });
    }
    return stale.length;
  }

  /**
   * FSM transition with validation. Used by ExecutionEngine to advance
   * SIGNED → SUBMITTED → CONFIRMED|FAILED.
   */
  async transition(
    id: string,
    to: IntentLifecycleStatus,
    payload: Record<string, unknown> = {}
  ) {
    const intent = await prisma.transactionIntent.findUnique({ where: { id } });
    if (!intent) throw new Error('intent_not_found');
    const fromLifecycle = prismaToLifecycle(intent.status);
    if (!VALID_TRANSITIONS[fromLifecycle].includes(to)) {
      throw new Error(`invalid_transition:${fromLifecycle}→${to}`);
    }
    const data: any = { status: LIFECYCLE_TO_PRISMA[to] };
    if (to === 'SUBMITTED' && payload.txHash) data.txHash = payload.txHash;
    if (to === 'CONFIRMED') {
      data.confirmedAt = new Date();
      if (payload.blockNumber) data.blockNumber = BigInt(payload.blockNumber as number);
    }
    if (to === 'FAILED' && payload.reason) data.failureReason = payload.reason;

    const updated = await prisma.transactionIntent.update({
      where: { id },
      data,
    });
    await this.audit(intent.owner, id, `transition:${fromLifecycle}→${to}`, {
      from: fromLifecycle,
      to,
      payload,
    });
    return updated;
  }

  private async audit(
    owner: string,
    intentId: string,
    action: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      // userId in AuditLog is optional; we key audit by resource (intentId).
      await prisma.auditLog.create({
        data: {
          userId: undefined,
          action: `intent:${action}`,
          resource: intentId,
          newValues: { owner, ...metadata },
        },
      });
    } catch (err) {
      console.warn('[intent] audit log write failed:', (err as Error).message);
    }
  }
}

function prismaToLifecycle(s: DomainStatus): IntentLifecycleStatus {
  switch (s) {
    case 'building':
      return 'DRAFT';
    case 'proposed':
    case 'pending_user_review':
      return 'READY_TO_SIGN';
    case 'signed':
      return 'SIGNED';
    case 'broadcast':
    case 'mempool':
      return 'SUBMITTED';
    case 'confirmed':
      return 'CONFIRMED';
    case 'failed':
      return 'FAILED';
    case 'expired':
      return 'EXPIRED';
    default:
      return 'DRAFT';
  }
}

function serialiseBigints(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  );
}

function extractValueUSD(
  params: Record<string, unknown>,
  impact: { netUSDReceived?: number },
): number | undefined {
  const fromParams = params.amountUSD ?? params.valueUSD;
  if (typeof fromParams === 'number') return fromParams;
  if (typeof fromParams === 'string' && fromParams.length > 0) {
    const n = Number(fromParams);
    if (Number.isFinite(n)) return n;
  }
  if (typeof impact.netUSDReceived === 'number') return Math.abs(impact.netUSDReceived);
  return undefined;
}

function extractSlippageBps(params: Record<string, unknown>): number | undefined {
  const v = params.slippageBps;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

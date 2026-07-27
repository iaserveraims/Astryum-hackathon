import { randomUUID } from 'crypto';
import type { Mandate } from './types';

const DEFAULT_ID = '__default__';

/**
 * Conservative V1.1 mandate applied when the user has no explicit mandate.
 * Spec: docs/POLICY_GUARD.md §3.
 *
 * Note: action ids use the canonical camelCase enum from `canonical/types/Action.ts`.
 */
export function buildDefaultMandate(userId: string = DEFAULT_ID): Mandate {
  return Object.freeze({
    schemaVersion: '1.0',
    id: `mandate_default_${userId}`,
    userId,
    active: true,
    scope: Object.freeze({
      allowedProtocols: Object.freeze([
        'kinetic',
        'sparkdex',
        'firelight',
        'enosys',
        'wflr',
        'ftso',
        'sceptre',
      ]),
      allowedChains: Object.freeze([14]),
      allowedAssets: Object.freeze([
        'FXRP',
        'FLR',
        'WFLR',
        'USDC.e',
        'USDC',
        'USDT',
        'USDT0',
        'stXRP',
        'sFLR',
      ]),
      allowedActions: Object.freeze([
        'supply',
        'withdraw',
        'repay',
        'addCollateral',
        'addLiquidity',
        'exitLP',
        'harvest',
        'stake',
        'unstake',
        'claimRewards',
        'wrap',
        'unwrap',
        'delegate',
        'undelegate',
      ]) as ReadonlyArray<Mandate['scope']['allowedActions'][number]>,
      forbiddenActions: Object.freeze(['borrow']) as ReadonlyArray<
        Mandate['scope']['forbiddenActions'][number]
      >,
    }),
    limits: Object.freeze({
      maxTxValueUSD: 10_000,
      maxDailyValueUSD: 25_000,
      maxMonthlyValueUSD: 100_000,
      maxSlippageBps: 100, // 1%
      minHealthFactorAfter: 1.3,
      maxRiskScoreAfter: 75,
      cooldownMinutesPerRule: 15,
    }),
    approvals: Object.freeze({
      requireManualApprovalAboveUSD: 5_000,
      requireManualApprovalForNewProtocol: true,
      requireManualApprovalForNewAsset: true,
      requireManualApprovalForBridge: true,
    }),
    createdAt: new Date(0).toISOString(),
  });
}

/**
 * In-memory MandateService. Persistence (Prisma `Mandate` table) is deferred to
 * a follow-up — V1.1 only needs deterministic defaults + ability to override
 * per-user from tests / admin endpoints.
 */
export class MandateService {
  private readonly byUser = new Map<string, Mandate>();

  getActive(userId: string): Mandate {
    return this.byUser.get(userId) ?? buildDefaultMandate(userId);
  }

  /** Create or replace a mandate for a user. Returns the stored mandate. */
  set(userId: string, partial: Partial<Mandate>): Mandate {
    const base = buildDefaultMandate(userId);
    const merged: Mandate = {
      ...base,
      ...partial,
      id: partial.id ?? `mandate_${randomUUID()}`,
      userId,
      schemaVersion: '1.0',
      scope: { ...base.scope, ...(partial.scope ?? {}) },
      limits: { ...base.limits, ...(partial.limits ?? {}) },
      approvals: { ...base.approvals, ...(partial.approvals ?? {}) },
      createdAt: partial.createdAt ?? new Date().toISOString(),
    };
    this.byUser.set(userId, merged);
    return merged;
  }

  clear(userId: string): void {
    this.byUser.delete(userId);
  }

  isExpired(m: Mandate, now: Date = new Date()): boolean {
    if (!m.expiresAt) return false;
    return new Date(m.expiresAt).getTime() < now.getTime();
  }
}

export const mandateService = new MandateService();

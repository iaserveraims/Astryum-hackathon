import { z } from 'zod';
import { randomUUID } from 'crypto';
import { SourceRecordSchema } from './schemas/zod';
import type { SourceRecord } from './types/Source';

// ── Types ─────────────────────────────────────────────────────────────────────

export type YieldSourceType = 'lp' | 'lending' | 'staking' | 'vault' | 'perps';
export type SmartContractRisk = 'low' | 'medium' | 'high' | 'unknown';

export interface CanonicalYieldSource {
  readonly poolId: string;
  readonly protocol: string;
  readonly chain: string;             // CAIP-2 e.g. "eip155:14"
  readonly chainId: number;
  readonly symbol: string;
  readonly type: YieldSourceType;
  readonly apy: number;               // total APY = base + reward
  readonly realYield: number;         // base APY only — no reward inflation
  readonly riskScore: number;         // 0-100 Astryum own score
  readonly liquidityUSD: number;      // TVL in USD
  readonly isAudited: boolean;
  readonly isAllowlisted: boolean;
  readonly smartContractRisk: SmartContractRisk;
  readonly underlyingTokens: ReadonlyArray<string>;
  /** Display interaction contract (curated v1 only) — the address shown on the card. */
  readonly interactionContractAddress?: string;
  readonly ltv?: number;              // max LTV if lending pool
  readonly cooldownSeconds?: number;  // unstaking / withdrawal delay
  // Borrow-side fields (present only for borrowable lending pools)
  readonly borrowable?: boolean;
  readonly apyBaseBorrow?: number;    // borrow APY paid by borrower
  readonly apyRewardBorrow?: number;  // reward APY offsetting borrow cost
  readonly totalSupplyUsd?: number;
  readonly totalBorrowUsd?: number;
  readonly utilizationRate?: number;  // totalBorrowUsd / totalSupplyUsd (0-1)
  readonly debtCeilingUsd?: number;
  readonly source: SourceRecord;
}

// ── Zod schema ────────────────────────────────────────────────────────────────

export const YieldSourceTypeSchema = z.enum(['lp', 'lending', 'staking', 'vault', 'perps']);
export const SmartContractRiskSchema = z.enum(['low', 'medium', 'high', 'unknown']);

export const CanonicalYieldSourceSchema = z.object({
  poolId: z.string().min(1),
  protocol: z.string().min(1),
  chain: z.string().min(1),
  chainId: z.number().int().min(0),
  symbol: z.string().min(1),
  type: YieldSourceTypeSchema,
  apy: z.number(),
  realYield: z.number(),
  riskScore: z.number().int().min(0).max(100),
  liquidityUSD: z.number().nonnegative(),
  isAudited: z.boolean(),
  isAllowlisted: z.boolean(),
  smartContractRisk: SmartContractRiskSchema,
  underlyingTokens: z.array(z.string()),
  interactionContractAddress: z.string().optional(),
  ltv: z.number().optional(),
  cooldownSeconds: z.number().int().nonnegative().optional(),
  borrowable: z.boolean().optional(),
  apyBaseBorrow: z.number().optional(),
  apyRewardBorrow: z.number().optional(),
  totalSupplyUsd: z.number().nonnegative().optional(),
  totalBorrowUsd: z.number().nonnegative().optional(),
  utilizationRate: z.number().min(0).max(1).optional(),
  debtCeilingUsd: z.number().nonnegative().optional(),
  source: SourceRecordSchema,
});

// ── Minimal pool shape accepted by the mapper ─────────────────────────────────
// Accepts both Prisma ProtocolPool records and live DefiLlama objects.

interface PoolLike {
  id: string;
  protocol: string;
  chain: string;
  chainId: number;
  symbol: string;
  tvlUsd: number;
  apyBase?: number | null;
  apyReward?: number | null;
  apyTotal: number;
  underlyingTokens?: unknown;
  category?: string | null;
  ilRisk?: string | null;
  isAudited: boolean;
  isAllowlisted: boolean;
  ltv?: number | null;
  cooldownSeconds?: number | null;
  lastSyncedAt?: Date | string | null;
  // Borrow-side (optional — only populated for borrowable pools)
  borrowable?: boolean | null;
  apyBaseBorrow?: number | null;
  apyRewardBorrow?: number | null;
  totalSupplyUsd?: number | null;
  totalBorrowUsd?: number | null;
  debtCeilingUsd?: number | null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function categoryToType(category: string | null | undefined): YieldSourceType {
  if (!category) return 'lp';
  const cat = category.toLowerCase();
  if (cat.includes('lending') || cat.includes('money market') || cat.includes('cdp')) return 'lending';
  if (cat.includes('staking') || cat.includes('liquid staking')) return 'staking';
  if (cat.includes('deriv') || cat.includes('perp') || cat.includes('option')) return 'perps';
  if (cat.includes('vault') || cat.includes('yield') || cat.includes('rwa')) return 'vault';
  return 'lp';
}

function computeRiskScore(pool: PoolLike): number {
  let score = 0;

  // Audit risk (0-25)
  if (!pool.isAudited) score += 25;

  // Liquidity risk (0-20)
  if (pool.tvlUsd < 500_000) score += 20;
  else if (pool.tvlUsd < 2_000_000) score += 10;

  // Impermanent loss risk (0-20)
  const ilRisk = (pool.ilRisk ?? '').toLowerCase();
  if (ilRisk === 'yes' || ilRisk === 'high') score += 20;
  else if (ilRisk === 'medium') score += 10;

  // Reward inflation (0-15): high ratio of reward APY to total APY = unsustainable
  if (pool.apyReward != null && pool.apyTotal > 0) {
    const rewardRatio = pool.apyReward / pool.apyTotal;
    if (rewardRatio > 0.8) score += 15;
    else if (rewardRatio > 0.5) score += 7;
  }

  // Not on allowlist adds a small penalty (0-5)
  if (!pool.isAllowlisted) score += 5;

  // Derivatives carry higher protocol risk (0-10)
  const cat = (pool.category ?? '').toLowerCase();
  if (cat.includes('deriv') || cat.includes('perp')) score += 10;

  return Math.min(score, 100);
}

function computeSmartContractRisk(pool: PoolLike): SmartContractRisk {
  if (pool.isAudited && pool.isAllowlisted) return 'low';
  if (pool.isAudited || pool.isAllowlisted) return 'medium';
  return 'high';
}

function resolveTokens(raw: unknown): string[] {
  if (Array.isArray(raw)) return (raw as unknown[]).filter((t) => typeof t === 'string') as string[];
  return [];
}

// ── Public mapper ─────────────────────────────────────────────────────────────

export function poolToCanonicalYieldSource(pool: PoolLike, traceId?: string): CanonicalYieldSource {
  const fetchedAt =
    pool.lastSyncedAt instanceof Date
      ? pool.lastSyncedAt.toISOString()
      : typeof pool.lastSyncedAt === 'string'
        ? pool.lastSyncedAt
        : new Date().toISOString();

  // Utilization rate is derived: a value of 0.85 means 85% of supplied liquidity
  // is currently borrowed. High utilization correlates with high borrow APY.
  const utilizationRate =
    pool.totalSupplyUsd && pool.totalSupplyUsd > 0 && pool.totalBorrowUsd != null
      ? Math.min(1, Math.max(0, pool.totalBorrowUsd / pool.totalSupplyUsd))
      : undefined;

  return {
    poolId: pool.id,
    protocol: pool.protocol,
    chain: pool.chain,
    chainId: pool.chainId,
    symbol: pool.symbol,
    type: categoryToType(pool.category),
    apy: pool.apyTotal,
    realYield: pool.apyBase ?? 0,
    riskScore: computeRiskScore(pool),
    liquidityUSD: pool.tvlUsd,
    isAudited: pool.isAudited,
    isAllowlisted: pool.isAllowlisted,
    smartContractRisk: computeSmartContractRisk(pool),
    underlyingTokens: resolveTokens(pool.underlyingTokens),
    ltv: pool.ltv ?? undefined,
    cooldownSeconds: pool.cooldownSeconds ?? undefined,
    borrowable: pool.borrowable ?? undefined,
    apyBaseBorrow: pool.apyBaseBorrow ?? undefined,
    apyRewardBorrow: pool.apyRewardBorrow ?? undefined,
    totalSupplyUsd: pool.totalSupplyUsd ?? undefined,
    totalBorrowUsd: pool.totalBorrowUsd ?? undefined,
    utilizationRate,
    debtCeilingUsd: pool.debtCeilingUsd ?? undefined,
    source: {
      providerId: 'defillama',
      providerType: 'data',
      trustLevel: 'indexer_verified',
      fetchedAt,
      traceId: traceId ?? randomUUID(),
    },
  };
}

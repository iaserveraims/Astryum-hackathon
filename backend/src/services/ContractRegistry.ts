/**
 * ContractRegistry — pool persistence + lookup layer.
 *
 * Block F (2026-06-01). Single source of truth for "what contract does
 * CalldataBuilder call for this pool?". Backed by the existing `protocol_pools`
 * table extended with the contract-resolution fields (migration:
 * 20260601000000_contract_registry_fields).
 *
 * REGULATORY: read-only against the database from CalldataBuilder's perspective.
 * Writes happen exclusively from PoolIngestionService (cron) or admin tooling.
 */

import { prisma } from '../database/prismaClient';
import type { ContractKind, AbiSource } from './contractKinds';
import { addDynamicContractAddress } from '../config/allowlist.config';

/** Morpho Blue MarketParams — the struct Morpho's supply/borrow calldata needs. */
export interface MorphoMarketParams {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: string;
  /** bytes32 market id (optional — informational). */
  id?: string;
}

export interface PoolRecord {
  // Identifiers
  poolId: string;
  chain: string;
  chainId: number;
  protocol: string;
  protocolName: string;
  symbol: string;
  underlyingTokens: string[];
  rewardTokens: string[];

  // Market data
  tvlUsd: number;
  apyBase: number | null;
  apyReward: number | null;
  apyTotal: number;
  apyBaseBorrow: number | null;
  ltv: number | null;
  borrowable: boolean;

  // Contract resolution (Block F)
  interactionContractAddress: string | null;
  receiptTokenAddress: string | null;
  contractKind: ContractKind | null;
  /** Morpho Blue MarketParams (loanToken/collateralToken/oracle/irm/lltv[, id]). */
  morphoMarketParams: MorphoMarketParams | null;
  abi: unknown[] | null;
  abiSource: AbiSource | null;
  abiResolvedAt: Date | null;
  abiResolutionAttempts: number;
  abiResolutionLastError: string | null;

  // Capabilities
  supportsSupply: boolean;
  supportsWithdraw: boolean;
  supportsBorrowCapability: boolean;
  supportsRepay: boolean;
  supportsStake: boolean;
  supportsUnstake: boolean;
  supportsAddLiquidity: boolean;
  supportsRemoveLiquidity: boolean;
  supportsVaultDeposit: boolean;
  supportsVaultWithdraw: boolean;

  // Status
  isUpgradeable: boolean;
  isActive: boolean;
  inactiveReason: string | null;
  lastVerifiedAt: Date | null;

  // Misc
  isAudited: boolean;
  isAllowlisted: boolean;
  cooldownSeconds: number | null;
  lastSyncedAt: Date;
}

/** Operation → capability flag mapping for capability-check shortcuts. */
const OPERATION_TO_CAPABILITY: Readonly<Record<string, keyof PoolRecord>> = Object.freeze({
  supply:          'supportsSupply',
  withdraw:        'supportsWithdraw',
  borrow:          'supportsBorrowCapability',
  repay:           'supportsRepay',
  stake:           'supportsStake',
  unstake:         'supportsUnstake',
  add_liquidity:   'supportsAddLiquidity',
  remove_liquidity:'supportsRemoveLiquidity',
  vault_deposit:   'supportsVaultDeposit',
  vault_withdraw:  'supportsVaultWithdraw',
});

/** Map a Prisma row into the canonical PoolRecord shape. */
function rowToRecord(row: Record<string, unknown>): PoolRecord {
  const j = (v: unknown): unknown[] =>
    Array.isArray(v) ? (v as unknown[]) : v == null ? [] : (v as unknown[]);
  return {
    poolId: row.id as string,
    chain: row.chain as string,
    chainId: row.chainId as number,
    protocol: row.protocol as string,
    protocolName: row.protocolName as string,
    symbol: row.symbol as string,
    underlyingTokens: j(row.underlyingTokens) as string[],
    rewardTokens: j(row.rewardTokens) as string[],
    tvlUsd: (row.tvlUsd as number) ?? 0,
    apyBase: (row.apyBase as number | null) ?? null,
    apyReward: (row.apyReward as number | null) ?? null,
    apyTotal: (row.apyTotal as number) ?? 0,
    apyBaseBorrow: (row.apyBaseBorrow as number | null) ?? null,
    ltv: (row.ltv as number | null) ?? null,
    borrowable: !!row.borrowable,

    interactionContractAddress: (row.interactionContractAddress as string | null) ?? null,
    receiptTokenAddress: (row.receiptTokenAddress as string | null) ?? null,
    contractKind: (row.contractKind as ContractKind | null) ?? null,
    morphoMarketParams: (row.morphoMarketParams as MorphoMarketParams | null) ?? null,
    abi: j(row.abi),
    abiSource: (row.abiSource as AbiSource | null) ?? null,
    abiResolvedAt: (row.abiResolvedAt as Date | null) ?? null,
    abiResolutionAttempts: (row.abiResolutionAttempts as number) ?? 0,
    abiResolutionLastError: (row.abiResolutionLastError as string | null) ?? null,

    supportsSupply: !!row.supportsSupply,
    supportsWithdraw: !!row.supportsWithdraw,
    supportsBorrowCapability: !!row.supportsBorrowCapability,
    supportsRepay: !!row.supportsRepay,
    supportsStake: !!row.supportsStake,
    supportsUnstake: !!row.supportsUnstake,
    supportsAddLiquidity: !!row.supportsAddLiquidity,
    supportsRemoveLiquidity: !!row.supportsRemoveLiquidity,
    supportsVaultDeposit: !!row.supportsVaultDeposit,
    supportsVaultWithdraw: !!row.supportsVaultWithdraw,

    isUpgradeable: !!row.isUpgradeable,
    isActive: row.isActive !== false,
    inactiveReason: (row.inactiveReason as string | null) ?? null,
    lastVerifiedAt: (row.lastVerifiedAt as Date | null) ?? null,

    isAudited: !!row.isAudited,
    isAllowlisted: !!row.isAllowlisted,
    cooldownSeconds: (row.cooldownSeconds as number | null) ?? null,
    lastSyncedAt: (row.lastSyncedAt as Date) ?? new Date(),
  };
}

/** What an ingester writes — only the resolution-related fields. */
export interface PoolUpsertInput {
  poolId: string;
  interactionContractAddress: string | null;
  receiptTokenAddress: string | null;
  contractKind: ContractKind | null;
  morphoMarketParams?: MorphoMarketParams | null;
  abi: unknown[] | null;
  abiSource: AbiSource | null;
  isUpgradeable: boolean;
  isActive: boolean;
  inactiveReason: string | null;
  supportsSupply: boolean;
  supportsWithdraw: boolean;
  supportsBorrowCapability: boolean;
  supportsRepay: boolean;
  supportsStake: boolean;
  supportsUnstake: boolean;
  supportsAddLiquidity: boolean;
  supportsRemoveLiquidity: boolean;
  supportsVaultDeposit: boolean;
  supportsVaultWithdraw: boolean;
  abiResolutionAttempts?: number;
  abiResolutionLastError?: string | null;
}

class ContractRegistry {
  /** Look up by DefiLlama UUID. Returns null when absent. */
  async getPool(poolId: string): Promise<PoolRecord | null> {
    const row = await prisma.protocolPool.findUnique({ where: { id: poolId } });
    return row ? rowToRecord(row as unknown as Record<string, unknown>) : null;
  }

  /** Find one active pool by (protocolSlug, chainId) — symbol disambiguation optional. */
  async findPool(args: {
    protocolSlug: string;
    chainId: number;
    symbol?: string;
  }): Promise<PoolRecord | null> {
    const row = await prisma.protocolPool.findFirst({
      where: {
        protocol: args.protocolSlug,
        chainId: args.chainId,
        isActive: true,
        ...(args.symbol ? { symbol: { equals: args.symbol, mode: 'insensitive' } } : {}),
      },
      orderBy: { tvlUsd: 'desc' },
    });
    return row ? rowToRecord(row as unknown as Record<string, unknown>) : null;
  }

  /** List active pools for a (protocolSlug, chainId). Useful for admin views. */
  async listActive(protocolSlug: string, chainId: number): Promise<PoolRecord[]> {
    const rows = await prisma.protocolPool.findMany({
      where: { protocol: protocolSlug, chainId, isActive: true },
      orderBy: { tvlUsd: 'desc' },
    });
    return rows.map((r) => rowToRecord(r as unknown as Record<string, unknown>));
  }

  /** Pools whose ABI failed to resolve (for admin retry / monitoring). */
  async listUnresolved(): Promise<PoolRecord[]> {
    const rows = await prisma.protocolPool.findMany({
      where: { OR: [{ abi: { equals: null } }, { abiSource: 'unresolved' }] },
      take: 200,
      orderBy: { tvlUsd: 'desc' },
    });
    return rows.map((r) => rowToRecord(r as unknown as Record<string, unknown>));
  }

  /** Upsert resolution result — called by PoolIngestionService per pool. */
  async upsertResolution(input: PoolUpsertInput): Promise<void> {
    await prisma.protocolPool.update({
      where: { id: input.poolId },
      data: {
        interactionContractAddress: input.interactionContractAddress,
        receiptTokenAddress: input.receiptTokenAddress,
        contractKind: input.contractKind,
        ...(input.morphoMarketParams !== undefined
          ? { morphoMarketParams: input.morphoMarketParams as never }
          : {}),
        abi: input.abi as never,
        abiSource: input.abiSource,
        abiResolvedAt: input.abiSource && input.abiSource !== 'unresolved' ? new Date() : null,
        abiResolutionAttempts: { increment: 1 },
        abiResolutionLastError: input.abiResolutionLastError ?? null,
        isUpgradeable: input.isUpgradeable,
        isActive: input.isActive,
        inactiveReason: input.inactiveReason,
        supportsSupply: input.supportsSupply,
        supportsWithdraw: input.supportsWithdraw,
        supportsBorrowCapability: input.supportsBorrowCapability,
        supportsRepay: input.supportsRepay,
        supportsStake: input.supportsStake,
        supportsUnstake: input.supportsUnstake,
        supportsAddLiquidity: input.supportsAddLiquidity,
        supportsRemoveLiquidity: input.supportsRemoveLiquidity,
        supportsVaultDeposit: input.supportsVaultDeposit,
        supportsVaultWithdraw: input.supportsVaultWithdraw,
        lastVerifiedAt: input.isActive ? new Date() : null,
      },
    });

    // P35 dynamic allowlist: every pool the pipeline resolves as active becomes
    // executable. Astryum does NOT gate the catalogue to a curated list — all
    // pools are accessible; the Risk Engine surfaces risk and the user decides
    // under T&C. The only hard-stop remains anomaly-blocked pools (handled in
    // CalldataBuilder via CanonicalBridgeService.isPoolBlocked).
    if (input.isActive && input.interactionContractAddress) {
      addDynamicContractAddress(input.interactionContractAddress);
    }
  }

  async deactivate(poolId: string, reason: string): Promise<void> {
    await prisma.protocolPool.update({
      where: { id: poolId },
      data: { isActive: false, inactiveReason: reason },
    });
  }

  async reactivate(poolId: string): Promise<void> {
    await prisma.protocolPool.update({
      where: { id: poolId },
      data: { isActive: true, inactiveReason: null },
    });
  }

  /**
   * Quick capability check used by CalldataBuilder before encoding an op.
   * Returns the resolved pool ONLY when it's active AND supports the action.
   * Returns null otherwise so the caller can throw a precise error.
   */
  async getExecutablePoolForAction(args: {
    poolId?: string;
    protocolSlug?: string;
    chainId: number;
    symbol?: string;
    actionType: string;
  }): Promise<PoolRecord | null> {
    const pool = args.poolId
      ? await this.getPool(args.poolId)
      : args.protocolSlug
        ? await this.findPool({ protocolSlug: args.protocolSlug, chainId: args.chainId, symbol: args.symbol })
        : null;
    if (!pool) return null;
    if (!pool.isActive) return null;
    if (!pool.interactionContractAddress || !pool.abi || pool.abi.length === 0) return null;
    const capKey = OPERATION_TO_CAPABILITY[args.actionType];
    if (capKey && pool[capKey] !== true) return null;
    return pool;
  }
}

export const contractRegistry = new ContractRegistry();

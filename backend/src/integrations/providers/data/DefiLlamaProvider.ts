import { randomUUID } from 'crypto';
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
  HealthStatus,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../../canonical/types/Source';
import { prisma } from '../../../database/prismaClient';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'data.getProtocols',
  'data.getProtocolsByChain',
  'data.getKnownContracts',
  'data.syncProtocolRegistry',
  'data.getPools',
  'data.syncPoolRegistry',
]);

const BASE_URL = process.env.DEFILLAMA_API_URL || 'https://api.llama.fi';
const YIELDS_URL = 'https://yields.llama.fi';
// DefiLlama Pro API — only the Pro `/yields/poolsOld` endpoint exposes a pool's
// on-chain address (via `pool_old`). The free `/pools` endpoint returns only a
// UUID. Without a key we run "Tier A" (verified per-chain singleton tables in
// the resolvers); with a key we additionally get per-pool addresses ("Tier B").
const DEFILLAMA_PRO_KEY = process.env.DEFILLAMA_API_KEY;
const DEFILLAMA_PRO_URL = process.env.DEFILLAMA_PRO_URL || 'https://pro-api.llama.fi';
const HEALTH_TIMEOUT_MS = 8000;
const FETCH_TIMEOUT_MS = 30000;

/** Extract the first 0x-prefixed 20-byte address from a string, lowercased. */
function extractEvmAddress(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0].toLowerCase() : null;
}

const MIN_TVL_USD = 500_000;

// Bounded concurrency for the registry sync upserts. Strictly-sequential
// awaits meant 10k+ Postgres round-trips one after another — minutes with the
// DB busy right after boot. 10 in flight keeps the load polite while cutting
// wall-clock ~10× on a pooled connection.
const SYNC_UPSERT_CONCURRENCY = 10;

/** Run tasks with bounded concurrency; returns how many fulfilled. */
async function runBounded(
  tasks: Array<() => Promise<unknown>>,
  limit: number,
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < tasks.length; i += limit) {
    const settled = await Promise.allSettled(tasks.slice(i, i + limit).map((t) => t()));
    for (const r of settled) if (r.status === 'fulfilled') ok++;
  }
  return ok;
}

// Known cooldown periods (seconds) per DefiLlama protocol slug.
// These are the on-chain unstaking delays that affect user liquidity.
const COOLDOWN_MAP: Record<string, number> = {
  'lido':                            345600,   // 4 days (Ethereum withdrawal queue)
  'lido-v2':                         345600,
  'rocket-pool':                     604800,   // ~7 days
  'sceptre':                         864000,   // 10 days (sFLR on Flare)
  'jito':                            172800,   // 2 days
  'stader':                          345600,
  'frax-ether':                      259200,   // ~3 days
  'coinbase-wrapped-staked-eth':     345600,
};

// Known fee attribution types per DefiLlama protocol slug.
//   referrer_address — 1inch-style: Astryum passes ASTRYUM_FEE_WALLET as referrer EVM address
//   referral_code    — Aave/Compound-style: Astryum passes ASTRYUM_REFERRAL_CODE (uint16)
//   revenue_share    — liquid staking protocols with built-in node operator revenue split
const FEE_TYPE_MAP: Record<string, string> = {
  'aave-v3':                         'referral_code',
  'aave-v2':                         'referral_code',
  'compound-v3':                     'referral_code',
  'compound-v2':                     'referral_code',
  'kinetic':                         'referral_code',
  'lido':                            'revenue_share',
  'lido-v2':                         'revenue_share',
  'rocket-pool':                     'revenue_share',
  'sceptre':                         'revenue_share',
  'jito':                            'revenue_share',
  'stader':                          'revenue_share',
  'frax-ether':                      'revenue_share',
  'coinbase-wrapped-staked-eth':     'revenue_share',
  '1inch':                           'referrer_address',
  '0x-protocol':                     'referrer_address',
  'paraswap':                        'referrer_address',
};

function detectCooldown(project: string): number | null {
  return COOLDOWN_MAP[project] ?? null;
}

function detectFeeType(project: string): string | null {
  return FEE_TYPE_MAP[project] ?? null;
}

// DefiLlama chain name → our chainId
// P15: added Hedera (296), XDC (50), Solana (900) — enables pool sync for these chains.
const CHAIN_MAP: Record<string, number> = {
  Ethereum: 1,
  'BSC': 56,
  Polygon: 137,
  Arbitrum: 42161,
  Base: 8453,
  Flare: 14,
  Avalanche: 43114,
  Optimism: 10,
  Fantom: 250,
  Gnosis: 100,
  Linea: 59144,
  Scroll: 534352,
  Blast: 81457,
  // P15: non-EVM and new EVM chains
  Hedera: 296,
  XDC: 50,
  Solana: 900, // pseudo chainId — non-EVM, pools handled by Helius+Jupiter
};

// DefiLlama chain name → CAIP-2 identifier
const CAIP2_MAP: Record<string, string> = {
  Ethereum: 'eip155:1',
  BSC: 'eip155:56',
  Polygon: 'eip155:137',
  Arbitrum: 'eip155:42161',
  Base: 'eip155:8453',
  Flare: 'eip155:14',
  Avalanche: 'eip155:43114',
  Optimism: 'eip155:10',
  Fantom: 'eip155:250',
  Gnosis: 'eip155:100',
  Linea: 'eip155:59144',
  Scroll: 'eip155:534352',
  Blast: 'eip155:81457',
  // P15:
  Hedera: 'eip155:296',
  XDC: 'eip155:50',
  Solana: 'solana:mainnet',
};

export interface DefiLlamaProtocol {
  id: string;
  name: string;
  slug: string;
  category: string;
  chains: string[];
  tvl: number;
  audits?: string;
  audit_links?: string[];
  url?: string;
}

export interface DefiLlamaPool {
  pool: string;           // pool ID (uuid from DefiLlama)
  chain: string;          // chain name e.g. "Ethereum"
  project: string;        // protocol slug
  symbol: string;
  tvlUsd: number;
  apyBase?: number;
  apyReward?: number;
  apy: number;
  underlyingTokens?: string[];
  rewardTokens?: string[];
  category?: string;
  isLiquidStaking?: boolean;
  ltv?: number;
  ilRisk?: string;
  url?: string;
  isAudited?: boolean;
}

/** Borrow-side data returned by DefiLlama /yields/poolsBorrow. */
export interface DefiLlamaBorrowPool {
  pool: string;                // matches DefiLlamaPool.pool
  apyBaseBorrow?: number;      // borrow APY (the rate the user pays)
  apyRewardBorrow?: number;    // reward APY offsetting the borrow cost
  totalSupplyUsd?: number;
  totalBorrowUsd?: number;
  debtCeilingUsd?: number;
  ltv?: number;
  borrowable?: boolean;
  mintedCoin?: string | null;  // for CDP protocols (e.g. DAI for MakerDAO)
}

export interface KnownContract {
  chainId: number;
  chainName: string;
  contractAddress: string;
  protocolSlug: string;
  protocolName: string;
  category: string;
  auditCount: number;
  auditLinks: string[];
}

/**
 * DefiLlamaProvider — reads protocol registry + TVL/metadata from DefiLlama.
 * trust = indexer_verified (aggregator, not on-chain).
 * Used for: protocol discovery, contract registry, audit metadata, yield pool data.
 * Does NOT verify user positions — only metadata/registry.
 */
export class DefiLlamaProvider implements IProvider {
  readonly id = 'defillama';
  readonly type: ProviderType = 'data';
  readonly trustLevel: TrustLevel = 'indexer_verified';
  readonly priority = 70;
  readonly capabilities = CAPS;

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/protocols`, HEALTH_TIMEOUT_MS);
      const latencyMs = Date.now() - startedAt;
      const status: HealthStatus = res.ok ? 'healthy' : 'degraded';
      return {
        status,
        latencyMs,
        lastCheckAt: new Date().toISOString(),
        reason: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        lastCheckAt: new Date().toISOString(),
        reason: String(err),
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const source = this._source(ctx.traceId);
    switch (capability) {
      case 'data.getProtocols': {
        const data = await this._fetchProtocols() as unknown as TOut;
        return { data, source, cached: false };
      }
      case 'data.getProtocolsByChain': {
        const { chainId } = input as { chainId: number };
        const all = await this._fetchProtocols();
        const chainName = this._chainName(chainId);
        const filtered = all.filter((p) => p.chains.includes(chainName)) as unknown as TOut;
        return { data: filtered, source, cached: false };
      }
      case 'data.getKnownContracts': {
        const { chainId } = input as { chainId: number };
        const contracts = await this._getKnownContracts(chainId) as unknown as TOut;
        return { data: contracts, source, cached: false };
      }
      case 'data.syncProtocolRegistry': {
        const { chainIds } = input as { chainIds?: number[] };
        const count = await this.syncProtocolRegistry(chainIds);
        return { data: { synced: count } as unknown as TOut, source, cached: false };
      }
      case 'data.getPools': {
        const { chainId, isAllowlisted, minApy, limit, offset } =
          input as { chainId?: number; isAllowlisted?: boolean; minApy?: number; limit?: number; offset?: number };
        const pools = await this._getPoolsFromDb({ chainId, isAllowlisted, minApy, limit, offset });
        return { data: pools as unknown as TOut, source, cached: false };
      }
      case 'data.syncPoolRegistry': {
        const { chainIds } = input as { chainIds?: number[] };
        const count = await this.syncPoolRegistry(chainIds);
        return { data: { synced: count } as unknown as TOut, source, cached: false };
      }
      default:
        throw new Error(`DefiLlamaProvider: unknown capability ${capability}`);
    }
  }

  /** Fetch all protocols from DefiLlama and upsert into protocol_contracts. */
  async syncProtocolRegistry(chainIds?: number[]): Promise<number> {
    const protocols = await this._fetchProtocols();
    const targetChains = new Set(chainIds ?? Object.values(CHAIN_MAP));
    const tasks: Array<() => Promise<unknown>> = [];

    for (const proto of protocols) {
      for (const chainName of proto.chains) {
        const chainId = CHAIN_MAP[chainName];
        if (!chainId || (chainIds && !targetChains.has(chainId))) continue;

        // DefiLlama doesn't give contract addresses directly from /protocols.
        // We store what we have (protocol-level metadata) keyed on a synthetic address.
        // Real contract addresses come from ChainExplorerProvider + on-chain reads.
        // We use protocolSlug+chainId as the deduplication key, address = 'registry-only'.
        const syntheticAddress = `defillama:${proto.slug}:${chainId}`;

        tasks.push(() =>
          prisma.protocolContract.upsert({
            where: { chainId_contractAddress: { chainId, contractAddress: syntheticAddress } },
            create: {
              providerId: 'defillama',
              protocolSlug: proto.slug,
              protocolName: proto.name,
              chainId,
              chainName,
              contractAddress: syntheticAddress,
              category: proto.category || 'Unknown',
              auditCount: parseInt(proto.audits ?? '0') || 0,
              auditLinks: proto.audit_links ? { links: proto.audit_links } : undefined,
              sourceUrl: proto.url,
              trustLevel: 'indexer_verified',
              lastSyncedAt: new Date(),
            },
            update: {
              protocolName: proto.name,
              category: proto.category || 'Unknown',
              auditCount: parseInt(proto.audits ?? '0') || 0,
              auditLinks: proto.audit_links ? { links: proto.audit_links } : undefined,
              lastSyncedAt: new Date(),
            },
          }),
        );
      }
    }
    // Individual upsert failures are dropped by allSettled inside runBounded —
    // same semantics as the old per-row try/catch.
    return runBounded(tasks, SYNC_UPSERT_CONCURRENCY);
  }

  /**
   * Fetch yield pools from DefiLlama and upsert into protocol_pools.
   * Filters out pools with tvlUsd < 500k and chains not in CHAIN_MAP.
   * Run on a 6h cycle via cron.
   */
  async syncPoolRegistry(chainIds?: number[]): Promise<number> {
    // Fetch supply, borrow, and address data in parallel — they live in
    // different DefiLlama endpoints (/pools vs /poolsBorrow vs Pro /poolsOld)
    // but share the same pool UUID. addrMap is empty without a Pro key.
    const [pools, borrowMap, addrMap] = await Promise.all([
      this._fetchPools(),
      this._fetchBorrowPoolMap(),
      this._fetchPoolsOldMap(),
    ]);
    const targetChainIds = new Set(chainIds ?? Object.values(CHAIN_MAP));
    const tasks: Array<() => Promise<unknown>> = [];

    for (const pool of pools) {
      if (pool.tvlUsd < MIN_TVL_USD) continue;

      const chainId = this._chainIdFromName(pool.chain);
      if (!chainId) continue;
      if (!targetChainIds.has(chainId)) continue;

      const caip2 = CAIP2_MAP[pool.chain] ?? `eip155:${chainId}`;
      const borrow = borrowMap.get(pool.pool);
      // Pro `pool_old` address when available (Tier B). Null → resolvers fall
      // back to verified per-chain tables (Tier A).
      const contractAddress = addrMap.get(pool.pool) ?? null;

      tasks.push(() =>
        prisma.protocolPool.upsert({
          where: { id: pool.pool },
          create: {
            id: pool.pool,
            chain: caip2,
            chainId,
            protocol: pool.project,
            protocolName: pool.project,
            symbol: pool.symbol,
            // Pro pool_old address (Tier B). Null when no Pro key — resolvers
            // then derive the address from verified per-chain tables (Tier A).
            contractAddress,
            tvlUsd: pool.tvlUsd,
            apyBase: pool.apyBase ?? null,
            apyReward: pool.apyReward ?? null,
            apyTotal: pool.apy,
            underlyingTokens: pool.underlyingTokens ?? [],
            rewardTokens: pool.rewardTokens ?? [],
            category: pool.category ?? null,
            isLiquidStaking: pool.isLiquidStaking ?? false,
            // LTV from borrow side preferred (more accurate); falls back to supply side
            ltv: borrow?.ltv ?? pool.ltv ?? null,
            ilRisk: pool.ilRisk ?? null,
            url: pool.url ?? null,
            isAudited: pool.isAudited ?? false,
            cooldownSeconds: detectCooldown(pool.project),
            feeType: detectFeeType(pool.project),
            apyBaseBorrow: borrow?.apyBaseBorrow ?? null,
            apyRewardBorrow: borrow?.apyRewardBorrow ?? null,
            totalSupplyUsd: borrow?.totalSupplyUsd ?? null,
            totalBorrowUsd: borrow?.totalBorrowUsd ?? null,
            debtCeilingUsd: borrow?.debtCeilingUsd ?? null,
            borrowable: borrow?.borrowable ?? false,
            lastSyncedAt: new Date(),
          },
          update: {
            // Only overwrite when we actually have an address — never clobber a
            // previously-resolved contractAddress with null on a keyless sync.
            ...(contractAddress ? { contractAddress } : {}),
            tvlUsd: pool.tvlUsd,
            apyBase: pool.apyBase ?? null,
            apyReward: pool.apyReward ?? null,
            apyTotal: pool.apy,
            underlyingTokens: pool.underlyingTokens ?? [],
            rewardTokens: pool.rewardTokens ?? [],
            category: pool.category ?? null,
            isLiquidStaking: pool.isLiquidStaking ?? false,
            ltv: borrow?.ltv ?? pool.ltv ?? null,
            ilRisk: pool.ilRisk ?? null,
            isAudited: pool.isAudited ?? false,
            cooldownSeconds: detectCooldown(pool.project),
            feeType: detectFeeType(pool.project),
            apyBaseBorrow: borrow?.apyBaseBorrow ?? null,
            apyRewardBorrow: borrow?.apyRewardBorrow ?? null,
            totalSupplyUsd: borrow?.totalSupplyUsd ?? null,
            totalBorrowUsd: borrow?.totalBorrowUsd ?? null,
            debtCeilingUsd: borrow?.debtCeilingUsd ?? null,
            borrowable: borrow?.borrowable ?? false,
            lastSyncedAt: new Date(),
          },
        }),
      );
    }
    // Individual upsert failures are dropped by allSettled inside runBounded —
    // same semantics as the old per-row try/catch.
    return runBounded(tasks, SYNC_UPSERT_CONCURRENCY);
  }

  /**
   * Fetch live pools from DefiLlama without persisting to DB.
   * Used by /api/pools/live for cold-start fallback.
   */
  async fetchLivePools(chainId?: number): Promise<Array<{
    id: string; chain: string; chainId: number; protocol: string; protocolName: string;
    symbol: string; tvlUsd: number; apyBase: number | null; apyReward: number | null;
    apyTotal: number; category: string | null; isLiquidStaking: boolean;
    isAudited: boolean; isAllowlisted: boolean; url: string | null;
    underlyingTokens: string[]; ltv: number | null;
    apyBaseBorrow: number | null; apyRewardBorrow: number | null;
    totalSupplyUsd: number | null; totalBorrowUsd: number | null;
    debtCeilingUsd: number | null; borrowable: boolean;
  }>> {
    const [pools, borrowMap] = await Promise.all([
      this._fetchPools(),
      this._fetchBorrowPoolMap(),
    ]);
    const targetChainIds = chainId ? new Set([chainId]) : new Set(Object.values(CHAIN_MAP));
    const results = [];

    for (const pool of pools) {
      if (pool.tvlUsd < MIN_TVL_USD) continue;
      const cid = this._chainIdFromName(pool.chain);
      if (!cid || !targetChainIds.has(cid)) continue;
      const caip2 = CAIP2_MAP[pool.chain] ?? `eip155:${cid}`;
      const borrow = borrowMap.get(pool.pool);

      results.push({
        id: pool.pool,
        chain: caip2,
        chainId: cid,
        protocol: pool.project,
        protocolName: pool.project,
        symbol: pool.symbol,
        tvlUsd: pool.tvlUsd,
        apyBase: pool.apyBase ?? null,
        apyReward: pool.apyReward ?? null,
        apyTotal: pool.apy,
        category: pool.category ?? null,
        isLiquidStaking: pool.isLiquidStaking ?? false,
        isAudited: pool.isAudited ?? false,
        isAllowlisted: false,
        url: pool.url ?? null,
        underlyingTokens: pool.underlyingTokens ?? [],
        ltv: borrow?.ltv ?? pool.ltv ?? null,
        apyBaseBorrow: borrow?.apyBaseBorrow ?? null,
        apyRewardBorrow: borrow?.apyRewardBorrow ?? null,
        totalSupplyUsd: borrow?.totalSupplyUsd ?? null,
        totalBorrowUsd: borrow?.totalBorrowUsd ?? null,
        debtCeilingUsd: borrow?.debtCeilingUsd ?? null,
        borrowable: borrow?.borrowable ?? false,
      });
    }
    return results;
  }

  /**
   * Fetch historical APY chart for a pool from DefiLlama.
   * Returns array of { timestamp, apy } sorted oldest-first.
   */
  async fetchPoolHistory(poolId: string): Promise<Array<{ timestamp: string; apy: number; apyBase: number | null; tvlUsd: number }>> {
    const res = await fetchWithTimeout(`${YIELDS_URL}/chart/${poolId}`, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`DefiLlama /chart/${poolId} HTTP ${res.status}`);
    const body = (await res.json()) as { status: string; data: Array<{ timestamp: string; apy: number; apyBase?: number; tvlUsd: number }> };
    return (body.data ?? []).map((d) => ({
      timestamp: d.timestamp,
      apy: d.apy,
      apyBase: d.apyBase ?? null,
      tvlUsd: d.tvlUsd,
    }));
  }

  /** Get known contracts for a chain from the local cache. */
  async getKnownContractAddresses(chainId: number): Promise<string[]> {
    const rows = await prisma.protocolContract.findMany({
      where: { chainId },
      select: { contractAddress: true },
    });
    return rows.map((r) => r.contractAddress);
  }

  /** Get protocol slug for a known contract address. */
  async lookupProtocol(chainId: number, contractAddress: string): Promise<string | null> {
    const row = await prisma.protocolContract.findFirst({
      where: { chainId, contractAddress: { equals: contractAddress, mode: 'insensitive' } },
      select: { protocolSlug: true },
    });
    return row?.protocolSlug ?? null;
  }

  private async _fetchProtocols(): Promise<DefiLlamaProtocol[]> {
    const res = await fetchWithTimeout(`${BASE_URL}/protocols`, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`DefiLlama /protocols HTTP ${res.status}`);
    return (await res.json()) as DefiLlamaProtocol[];
  }

  private async _fetchPools(): Promise<DefiLlamaPool[]> {
    const res = await fetchWithTimeout(`${YIELDS_URL}/pools`, FETCH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`DefiLlama /pools HTTP ${res.status}`);
    const body = (await res.json()) as { status: string; data: DefiLlamaPool[] };
    return body.data ?? [];
  }

  /**
   * Fetch borrow-side pool data from DefiLlama /yields/poolsBorrow.
   * Returns a Map keyed by pool UUID for O(1) lookup during sync.
   *
   * If the endpoint is unavailable (rare), returns an empty map — supply pools
   * still sync normally, just without borrow enrichment.
   */
  private async _fetchBorrowPoolMap(): Promise<Map<string, DefiLlamaBorrowPool>> {
    try {
      const res = await fetchWithTimeout(`${YIELDS_URL}/poolsBorrow`, FETCH_TIMEOUT_MS);
      if (!res.ok) {
        console.warn(`DefiLlama /poolsBorrow HTTP ${res.status} — borrow enrichment skipped`);
        return new Map();
      }
      const body = (await res.json()) as { status: string; data: DefiLlamaBorrowPool[] };
      const map = new Map<string, DefiLlamaBorrowPool>();
      for (const bp of body.data ?? []) {
        if (bp.pool) map.set(bp.pool, bp);
      }
      return map;
    } catch (err) {
      console.warn('DefiLlama /poolsBorrow fetch failed — borrow enrichment skipped:', err);
      return new Map();
    }
  }

  /**
   * Fetch a Map<poolUUID, contractAddress> from the DefiLlama Pro
   * `/yields/poolsOld` endpoint. That endpoint mirrors `/pools` but adds
   * `pool_old`, which "usually contains the pool address" (per DefiLlama docs).
   *
   * Requires DEFILLAMA_API_KEY (Pro). Without it — or if the endpoint fails —
   * returns an empty map and the pipeline falls back to verified per-chain
   * tables in the resolvers (Tier A). Never throws.
   */
  private async _fetchPoolsOldMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!DEFILLAMA_PRO_KEY) return map; // Tier A only — no Pro key configured
    try {
      const res = await fetchWithTimeout(
        `${DEFILLAMA_PRO_URL}/${DEFILLAMA_PRO_KEY}/yields/poolsOld`,
        FETCH_TIMEOUT_MS,
      );
      if (!res.ok) {
        console.warn(`DefiLlama /yields/poolsOld HTTP ${res.status} — address enrichment skipped`);
        return map;
      }
      const body = (await res.json()) as { data?: Array<{ pool: string; pool_old?: string }> };
      for (const p of body.data ?? []) {
        const addr = extractEvmAddress(p.pool_old);
        if (p.pool && addr) map.set(p.pool, addr);
      }
      return map;
    } catch (err) {
      console.warn('DefiLlama /yields/poolsOld fetch failed — address enrichment skipped:', err);
      return map;
    }
  }

  private async _getKnownContracts(chainId: number): Promise<KnownContract[]> {
    const rows = await prisma.protocolContract.findMany({ where: { chainId } });
    return rows.map((r) => ({
      chainId: r.chainId,
      chainName: r.chainName,
      contractAddress: r.contractAddress,
      protocolSlug: r.protocolSlug,
      protocolName: r.protocolName,
      category: r.category,
      auditCount: r.auditCount,
      auditLinks: (r.auditLinks as { links?: string[] })?.links ?? [],
    }));
  }

  private async _getPoolsFromDb(opts: {
    chainId?: number;
    isAllowlisted?: boolean;
    minApy?: number;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (opts.chainId !== undefined) where.chainId = opts.chainId;
    if (opts.isAllowlisted !== undefined) where.isAllowlisted = opts.isAllowlisted;
    if (opts.minApy !== undefined) where.apyTotal = { gte: opts.minApy };

    return prisma.protocolPool.findMany({
      where,
      orderBy: { apyTotal: 'desc' },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    });
  }

  private _chainName(chainId: number): string {
    return Object.entries(CHAIN_MAP).find(([, id]) => id === chainId)?.[0] ?? String(chainId);
  }

  private _chainIdFromName(chainName: string): number | undefined {
    return CHAIN_MAP[chainName];
  }

  private _source(traceId: string): SourceRecord {
    return {
      providerId: this.id,
      providerType: 'data',
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const defiLlamaProvider = new DefiLlamaProvider();

import { ProtocolRegistry } from '../../connectors/protocols/ProtocolRegistry';
import { registerFlareAdapters } from '../../connectors/protocols/adapters';
import {
  NormalisationEngine,
  createFTSOPriceProvider,
  type PriceProvider,
} from '../normalisation/NormalisationEngine';
import {
  SnapshotBuilder,
  type PortfolioSnapshot,
} from './SnapshotBuilder';
import { getRedis } from '../../database/redisClient';
import { prisma } from '../../database/prismaClient';
import type { IProtocolAdapter } from '../../connectors/protocols/IProtocolAdapter';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
  PositionKind,
} from '../../types/domain/Position';
import type { CanonicalPosition } from '../../canonical/types/Position';
// Zerion DISCONNECTED from production (2026-06-15, D2 — CoinStats replaces it).
// Import isolated (not deleted); re-add to re-enable.
// import { zerionPortfolioProvider } from '../../integrations/providers/portfolio/ZerionPortfolioProvider';
import { coinStatsProvider } from '../../integrations/providers/portfolio/CoinStatsProvider';
import { deBankPortfolioProvider } from '../../integrations/providers/portfolio/DeBankPortfolioProvider';
import { onChainBalanceProvider } from '../../integrations/providers/portfolio/OnChainBalanceProvider';
import { solanaBalanceProvider, SOLANA_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/SolanaBalanceProvider';
import { xrplBalanceProvider } from '../../integrations/providers/portfolio/XrplBalanceProvider';
import { aptosBalanceProvider, APTOS_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/AptosBalanceProvider';
import { stellarBalanceProvider, STELLAR_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/StellarBalanceProvider';
import { algorandBalanceProvider, ALGORAND_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/AlgorandBalanceProvider';
import { bitcoinBalanceProvider, BITCOIN_PSEUDO_CHAIN_ID } from '../../integrations/providers/portfolio/BitcoinBalanceProvider';
import { XRPL_CHAIN_ID } from '../../integrations/providers/chain/XRPLProvider';
import type { IProvider } from '../../integrations/interfaces/IProvider';
import { randomUUID } from 'crypto';

/**
 * Address-shape ecosystem detection so a single portfolio call can serve every
 * linked wallet's chain. Order matters — the most specific shapes are tested
 * first so e.g. an Aptos 0x… (≠40 hex) is not mistaken for EVM.
 */
export type WalletEcosystem =
  | 'evm' | 'solana' | 'xrpl' | 'aptos' | 'stellar' | 'algorand' | 'bitcoin';
export function detectEcosystem(address: string): WalletEcosystem {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return 'evm';
  if (/^0x[a-fA-F0-9]{1,64}$/.test(address)) return 'aptos'; // 0x + non-40 hex (32-byte Move addr)
  if (/^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/.test(address)) return 'bitcoin';
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(address)) return 'xrpl';
  if (/^G[A-Z2-7]{55}$/.test(address)) return 'stellar';
  if (/^[A-Z2-7]{58}$/.test(address)) return 'algorand';
  return 'solana'; // base58 fallback (32–44 chars)
}

const NON_EVM_ROUTES: Record<
  Exclude<WalletEcosystem, 'evm'>,
  { chainId: number; provider: IProvider }
> = {
  solana:   { chainId: SOLANA_PSEUDO_CHAIN_ID,   provider: solanaBalanceProvider },
  xrpl:     { chainId: XRPL_CHAIN_ID,            provider: xrplBalanceProvider },
  aptos:    { chainId: APTOS_PSEUDO_CHAIN_ID,    provider: aptosBalanceProvider },
  stellar:  { chainId: STELLAR_PSEUDO_CHAIN_ID,  provider: stellarBalanceProvider },
  algorand: { chainId: ALGORAND_PSEUDO_CHAIN_ID, provider: algorandBalanceProvider },
  bitcoin:  { chainId: BITCOIN_PSEUDO_CHAIN_ID,  provider: bitcoinBalanceProvider },
};

const CANONICAL_KIND_MAP: Record<string, PositionKind> = {
  free:       'FREE',
  collateral: 'SUPPLY',
  debt:       'BORROW',
  lp:         'LP',
  staking:    'STAKE',
  reward:     'REWARD',
  locked:     'LOCKED',
};

/**
 * Converts a CanonicalPosition (from external providers like Zerion/DeBank)
 * into a NormalizedPosition so it flows through SnapshotBuilder and LST dedup.
 */
function canonicalToNormalized(pos: CanonicalPosition): NormalizedPosition | null {
  const primary = pos.assets[0];
  if (!primary) return null;
  const totalUSD = pos.assets.reduce((s, a) => s + (a.amountUSD ?? 0), 0);
  const kind = CANONICAL_KIND_MAP[pos.kind] ?? 'FREE';
  return {
    protocolId: pos.protocol === 'wallet' ? `wallet-${pos.chainId}` : pos.protocol,
    chainId: pos.chainId,
    wallet: pos.wallet,
    kind,
    asset: primary.asset.symbol,
    amount: 0n, // human amount not needed; amountUSD drives the snapshot
    amountUSD: totalUSD,
    priceUSD: primary.asset.priceUSD ?? 0,
    metadata: {
      source: pos.source.providerId,
      external: true,
      chainId: pos.chainId,
      assets: pos.assets.map((a) => ({
        symbol: a.asset.symbol,
        amountUSD: a.amountUSD,
      })),
    },
    takenAt: new Date(),
  };
}

const FLARE_CHAIN_ID = 14;
// 5 min: the dashboard is a read-only monitor — paying a full multichain scan
// more often than this only buys "Loading…" screens. Actions that change
// positions go through POST /snapshot (forceRefresh) and bypass the cache.
const CACHE_TTL_SECONDS = 300;
// A read (GET) persists at most one snapshot per wallet per hour — every page
// load was inserting a full-positions row, growing portfolio_snapshots (and
// the /history payload) linearly with visits. Explicit POST /snapshot bypasses.
const PERSIST_MIN_INTERVAL_MS = 60 * 60 * 1000;

let bootstrapped = false;
function ensureAdapters(): void {
  if (bootstrapped) return;
  registerFlareAdapters(ProtocolRegistry.getInstance());
  bootstrapped = true;
}

export interface GetPortfolioOptions {
  forceRefresh?: boolean;
  persist?: boolean;
  /**
   * Include external multichain positions. OnChainBalanceProvider (key-less
   * public-RPC reads) always runs; CoinStats/DeBank additionally run when
   * their API keys are set. Default: true.
   */
  includeExternal?: boolean;
}

/**
 * PORTFOLIO_EXTERNAL_SCAN=off disables the external multichain sweep
 * server-side (8 public-RPC chains + CoinStats/DeBank, up to 12s of cold-path
 * latency per wallet) while the demo UI only renders Flare/XRPL anyway.
 * Default stays on — the flag is an ops lever, not a behaviour change.
 */
function wantExternalScan(opts: GetPortfolioOptions): boolean {
  return opts.includeExternal !== false && process.env.PORTFOLIO_EXTERNAL_SCAN !== 'off';
}

// Hard per-adapter deadline (same rationale as OnChainBalanceProvider's
// per-chain deadline): a cold LP factory sweep against the public Flare RPC can
// hang for minutes (ethers v6 retries 429s, default request timeout 300s) and
// the allSettled below waits for the SLOWEST adapter. A late adapter yields no
// positions for this snapshot; its work keeps running underneath and warms the
// pair caches, so the next scan (cache TTL 5 min) picks it up fast.
const ADAPTER_TIMEOUT_MS = Number(process.env.PORTFOLIO_ADAPTER_TIMEOUT_MS ?? 15_000);
function withAdapterDeadline<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error(`adapter ${label} timed out after ${ADAPTER_TIMEOUT_MS}ms`)),
        ADAPTER_TIMEOUT_MS,
      );
      t.unref?.();
    }),
  ]);
}

export class PortfolioEngine {
  private static instance: PortfolioEngine | null = null;
  private priceProvider: PriceProvider | null = null;
  // Fallback cache for deployments without REDIS_URL (e.g. Railway today):
  // without it every dashboard load re-scans every chain from scratch.
  private memoryCache = new Map<string, { expires: number; snap: PortfolioSnapshot }>();
  // In-flight coalescing: the risk engine calls getPortfolio concurrently with
  // the portfolio route for the same wallet; without this both pay a full scan.
  private inflight = new Map<string, Promise<PortfolioSnapshot>>();

  static getInstance(): PortfolioEngine {
    if (!this.instance) this.instance = new PortfolioEngine();
    return this.instance;
  }

  private async cacheGet(key: string): Promise<PortfolioSnapshot | null> {
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get(key);
        if (cached) return reviveSnapshot(JSON.parse(cached));
      } catch (err) {
        console.warn('[portfolio] redis get failed:', (err as Error).message);
      }
      return null;
    }
    const hit = this.memoryCache.get(key);
    if (hit && hit.expires > Date.now()) return hit.snap;
    if (hit) this.memoryCache.delete(key);
    return null;
  }

  private async cacheSet(key: string, snap: PortfolioSnapshot): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(serialiseSnapshot(snap)));
      } catch (err) {
        console.warn('[portfolio] redis setex failed:', (err as Error).message);
      }
      return;
    }
    this.memoryCache.set(key, { expires: Date.now() + CACHE_TTL_SECONDS * 1000, snap });
    // Bound the fallback cache so a long-lived process can't grow unbounded.
    if (this.memoryCache.size > 500) {
      const oldest = this.memoryCache.keys().next().value;
      if (oldest !== undefined) this.memoryCache.delete(oldest);
    }
  }

  /** Coalesce concurrent identical computations onto one promise. */
  private coalesce(
    key: string,
    compute: () => Promise<PortfolioSnapshot>,
  ): Promise<PortfolioSnapshot> {
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = compute().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async getPortfolio(
    wallet: string,
    chainId: number = FLARE_CHAIN_ID,
    opts: GetPortfolioOptions = {}
  ): Promise<PortfolioSnapshot> {
    // Non-EVM wallets (Solana, XRPL, Aptos, Stellar, Algorand, Bitcoin) are read
    // through their own balance providers; they don't use Flare adapters or the
    // EVM Zerion/DeBank path.
    const eco = detectEcosystem(wallet);
    if (eco !== 'evm') {
      const route = NON_EVM_ROUTES[eco];
      return this.getNonEvmPortfolio(wallet, route.chainId, route.provider, opts);
    }

    ensureAdapters();
    // External (non-Flare) positions come from OnChainBalanceProvider (public
    // RPC, NO API key needed) + CoinStats (broad, D2) + DeBank. Zerion is
    // disconnected from production. The key-less on-chain provider must NOT be
    // gated behind CoinStats/DeBank keys — key-gating happens per-provider
    // inside getExternalPositions().
    const wantExternal = wantExternalScan(opts);

    const cacheKey = `portfolio:${wantExternal ? 'ext' : 'flare'}:${chainId}:${wallet.toLowerCase()}`;

    if (!opts.forceRefresh) {
      const cached = await this.cacheGet(cacheKey);
      if (cached) return cached;
    }

    return this.coalesce(cacheKey, () => this.computeEvmPortfolio(wallet, chainId, cacheKey, opts));
  }

  private async computeEvmPortfolio(
    wallet: string,
    chainId: number,
    cacheKey: string,
    opts: GetPortfolioOptions,
  ): Promise<PortfolioSnapshot> {
    const wantExternal = wantExternalScan(opts);
    const registry = ProtocolRegistry.getInstance();
    const adapters = registry.getActiveAdapters(chainId);

    // External positions only need the wallet address — fetch them in parallel
    // with the Flare adapter sweep instead of after it (they used to add their
    // full latency on top of the adapters').
    const externalPromise: Promise<CanonicalPosition[]> = wantExternal
      ? this.getExternalPositions(wallet).catch((err) => {
          console.warn('[portfolio] external positions fetch failed:', (err as Error).message);
          return [];
        })
      : Promise.resolve([]);

    const settled = await Promise.allSettled(
      adapters.map(async (a) => ({
        adapter: a,
        positions: await withAdapterDeadline(a.discoverPositions(wallet), a.protocolId),
      }))
    );

    const allRaw: { adapter: IProtocolAdapter; raws: RawPosition[] }[] = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      if (r.status === 'fulfilled') {
        allRaw.push({ adapter: r.value.adapter, raws: r.value.positions });
      } else {
        console.warn(
          `[portfolio] adapter ${adapters[i].protocolId} dropped from snapshot:`,
          (r.reason as Error).message,
        );
      }
    }

    const flatRaw = allRaw.flatMap((x) => x.raws);
    if (!this.priceProvider) {
      try {
        this.priceProvider = await createFTSOPriceProvider();
      } catch (err) {
        console.warn(
          '[portfolio] FTSO price provider unavailable, USD = 0:',
          (err as Error).message
        );
        this.priceProvider = null;
      }
    }

    const onChainNormalized = await NormalisationEngine.unify(flatRaw, {
      priceProvider: this.priceProvider ?? undefined,
    });

    // External multi-chain positions (kicked off above, in parallel with the
    // adapter sweep; failures already degraded to [] in the catch).
    const externals = await externalPromise;
    let externalNormalized: NormalizedPosition[] = externals
      .map(canonicalToNormalized)
      .filter((n): n is NormalizedPosition => n !== null);

    // The Flare adapters are the VERIFIED source. External providers (multichain
    // on-chain reader / CoinStats / DeBank) re-report the same wallet balance
    // under protocol 'wallet' → renamed 'wallet-14', which double-counted native
    // FLR (one position per source, both real-looking). Drop any external row
    // whose (chain, wallet-bucket, kind, asset) the on-chain read already covers.
    const walletBucket = (p: string) => (/^wallet(-\d+)?$/i.test(p) ? 'wallet' : p);
    const coveredOnChain = new Set(
      onChainNormalized.map(
        (n) => `${n.chainId}:${walletBucket(n.protocolId)}:${n.kind}:${n.asset.toUpperCase()}`,
      ),
    );
    externalNormalized = externalNormalized.filter(
      (n) => !coveredOnChain.has(`${n.chainId}:${walletBucket(n.protocolId)}:${n.kind}:${n.asset.toUpperCase()}`),
    );

    const allNormalized = [...onChainNormalized, ...externalNormalized];

    const adapterByProto = new Map<string, IProtocolAdapter>();
    for (const a of adapters) adapterByProto.set(a.protocolId, a);

    const metrics: PositionMetrics[] = await Promise.all([
      ...onChainNormalized.map(async (n) => {
        const a = adapterByProto.get(n.protocolId);
        if (!a) return {};
        try {
          return await a.getMetrics(n);
        } catch {
          return {};
        }
      }),
      ...externalNormalized.map(() => Promise.resolve<PositionMetrics>({})),
    ]);

    const snapshot = SnapshotBuilder.build({
      wallet,
      chainId,
      normalized: allNormalized,
      metrics,
    });

    if (opts.persist !== false) {
      await this.persistSnapshot(snapshot, opts.persist === true).catch((err) => {
        console.warn(
          '[portfolio] persist snapshot failed (continuing):',
          err.message
        );
      });
    }

    await this.cacheSet(cacheKey, snapshot);

    return snapshot;
  }

  async getBreakdown(wallet: string, chainId: number = FLARE_CHAIN_ID) {
    const s = await this.getPortfolio(wallet, chainId);
    return {
      wallet: s.wallet,
      chainId: s.chainId,
      totalUSD: s.totalUSD,
      breakdown: s.breakdown,
      takenAt: s.takenAt,
    };
  }

  async getLatestSnapshot(
    wallet: string,
    chainId: number = FLARE_CHAIN_ID
  ): Promise<PortfolioSnapshot> {
    // Non-EVM snapshots persist under their ecosystem's pseudo chain-id
    // (XRPL 1440002…). Callers pass chainId=14 for every wallet, so route by
    // address shape — otherwise the lookup can never match.
    const eco = detectEcosystem(wallet);
    if (eco !== 'evm') chainId = NON_EVM_ROUTES[eco].chainId;
    {
      const walletRow = await prisma.wallet
        .findFirst({
          // Non-EVM wallet rows carry chainId NULL — accept both shapes.
          where: { address: wallet, OR: [{ chainId }, { chainId: null }] },
          orderBy: { lastActivity: 'desc' },
        })
        .catch(() => null);
      if (walletRow) {
        const row = await prisma.portfolioSnapshot
          .findFirst({
            where: { walletId: walletRow.id, chainId },
            orderBy: { takenAt: 'desc' },
          })
          .catch(() => null);
        if (row) return rowToSnapshot(row, wallet, chainId);
      }
    }
    return this.getPortfolio(wallet, chainId);
  }

  async getHistory(
    wallet: string,
    chainId: number = FLARE_CHAIN_ID,
    from?: Date,
    to?: Date
  ): Promise<{ takenAt: Date; totalUSD: number }[]> {
    // Same pseudo chain-id routing as getLatestSnapshot: an XRPL wallet's
    // snapshots live under 1440002, but the frontend always asks with 14.
    const eco = detectEcosystem(wallet);
    if (eco !== 'evm') chainId = NON_EVM_ROUTES[eco].chainId;
    const walletRow = await prisma.wallet
      .findFirst({
        // Non-EVM wallet rows carry chainId NULL — accept both shapes.
        where: { address: wallet, OR: [{ chainId }, { chainId: null }] },
      })
      .catch(() => null);
    if (!walletRow) return [];
    // Default window: trailing year. Without it this returned EVERY snapshot
    // ever taken — and reads used to insert one per page load, so the payload
    // (and the dashboard) got slower with each visit.
    const effectiveFrom = from ?? new Date(Date.now() - 365 * 86_400_000);
    const rows = await prisma.portfolioSnapshot.findMany({
      where: {
        walletId: walletRow.id,
        chainId,
        takenAt: {
          gte: effectiveFrom,
          lte: to,
        },
      },
      orderBy: { takenAt: 'asc' },
      select: { takenAt: true, totalValue: true },
    });
    const points = rows.map((r) => ({ takenAt: r.takenAt, totalUSD: r.totalValue }));
    return downsampleHistory(points);
  }

  /**
   * Reads a non-EVM wallet (Solana, XRPL) via its dedicated balance provider and
   * builds the same PortfolioSnapshot shape the EVM path returns, so the frontend
   * can aggregate every linked wallet regardless of chain.
   */
  private async getNonEvmPortfolio(
    wallet: string,
    chainId: number,
    provider: IProvider,
    opts: GetPortfolioOptions,
  ): Promise<PortfolioSnapshot> {
    const cacheKey = `portfolio:noevm:${chainId}:${wallet}`;
    if (!opts.forceRefresh) {
      const cached = await this.cacheGet(cacheKey);
      if (cached) return cached;
    }

    return this.coalesce(cacheKey, () =>
      this.computeNonEvmPortfolio(wallet, chainId, provider, cacheKey, opts),
    );
  }

  private async computeNonEvmPortfolio(
    wallet: string,
    chainId: number,
    provider: IProvider,
    cacheKey: string,
    opts: GetPortfolioOptions,
  ): Promise<PortfolioSnapshot> {
    const traceId = randomUUID();
    let canonical: CanonicalPosition[] = [];
    try {
      const result = await provider.call<{ walletAddress: string }, CanonicalPosition[]>(
        'portfolio.getPositions',
        { walletAddress: wallet },
        { traceId, wallet },
      );
      canonical = result.data;
    } catch (err) {
      console.warn(`[portfolio] non-EVM (${chainId}) fetch failed:`, (err as Error).message);
    }

    const normalized = canonical
      .map(canonicalToNormalized)
      .filter((n): n is NormalizedPosition => n !== null);
    const metrics: PositionMetrics[] = normalized.map(() => ({}));

    const snapshot = SnapshotBuilder.build({ wallet, chainId, normalized, metrics });

    if (opts.persist !== false) {
      await this.persistSnapshot(snapshot, opts.persist === true).catch((err) => {
        console.warn('[portfolio] persist non-EVM snapshot failed (continuing):', err.message);
      });
    }
    await this.cacheSet(cacheKey, snapshot);
    return snapshot;
  }

  /**
   * Fetches external (non-Flare) positions from Zerion + DeBank.
   * On-chain Flare positions always win when the same position is detected
   * in both on-chain and external sources (deduplication by symbol+protocol+chain).
   *
   * Zerion: trustLevel='indexer_verified', intended confidence='probable'
   * DeBank: trustLevel='indexer_verified', intended confidence='detected'
   */
  async getExternalPositions(wallet: string): Promise<CanonicalPosition[]> {
    const traceId = randomUUID();
    const ctx = { traceId, wallet };

    // D2: CoinStats is the broad multichain source (replaces disconnected Zerion);
    // DeBank stays as a complement; on-chain (Flare) is the verified source.
    // CoinStats/DeBank are each gated by their own API key; OnChainBalanceProvider
    // needs NO key (public RPC + DeFiLlama prices) and ALWAYS runs.
    const skipped = (): Promise<{ data: CanonicalPosition[] }> =>
      Promise.resolve({ data: [] });

    const [coinStatsResult, debankResult, onChainResult] = await Promise.allSettled([
      process.env.COINSTATS_API_KEY
        ? coinStatsProvider.call<{ walletAddress: string }, CanonicalPosition[]>(
            'portfolio.getPositions',
            { walletAddress: wallet },
            ctx,
          )
        : skipped(),
      process.env.DEBANK_API_KEY
        ? deBankPortfolioProvider.call<{ walletAddress: string }, CanonicalPosition[]>(
            'portfolio.getPositions',
            { walletAddress: wallet },
            ctx,
          )
        : skipped(),
      onChainBalanceProvider.call<{ walletAddress: string }, CanonicalPosition[]>(
        'portfolio.getPositions',
        { walletAddress: wallet },
        ctx,
      ),
    ]);

    const coinStatsPositions = coinStatsResult.status === 'fulfilled' ? coinStatsResult.value.data : [];
    const debankPositions = debankResult.status === 'fulfilled' ? debankResult.value.data : [];
    const onChainPositions = onChainResult.status === 'fulfilled' ? onChainResult.value.data : [];

    if (coinStatsResult.status === 'rejected') {
      console.warn('[portfolio] CoinStats fetch failed:', (coinStatsResult.reason as Error).message);
    }
    if (debankResult.status === 'rejected') {
      console.warn('[portfolio] DeBank fetch failed:', (debankResult.reason as Error).message);
    }
    if (onChainResult.status === 'rejected') {
      console.warn('[portfolio] OnChainBalance fetch failed:', (onChainResult.reason as Error).message);
    }

    // Priority order: OnChain (verified) > CoinStats > DeBank
    // Key: chainId:symbol — on-chain data wins for the same asset
    const seen = new Set<string>();
    const merged: CanonicalPosition[] = [];

    for (const pos of [...onChainPositions, ...coinStatsPositions, ...debankPositions]) {
      const key = `${pos.chainId}:${pos.protocol}:${pos.kind}:${pos.assets.map((a) => a.asset.symbol).join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(pos);
    }

    return merged;
  }

  private async persistSnapshot(s: PortfolioSnapshot, force = false): Promise<void> {
    // Non-EVM wallets register with chainId NULL (the registry has no EVM
    // chain for them) while their snapshots carry the pseudo chain-id — accept
    // both so XRPL/Solana history actually persists.
    const walletRow = await prisma.wallet.findFirst({
      where: { address: s.wallet, OR: [{ chainId: s.chainId }, { chainId: null }] },
    });
    if (!walletRow) return; // no-op if wallet not registered

    if (!force) {
      const latest = await prisma.portfolioSnapshot.findFirst({
        where: { walletId: walletRow.id, chainId: s.chainId },
        orderBy: { takenAt: 'desc' },
        select: { takenAt: true },
      });
      if (latest && Date.now() - latest.takenAt.getTime() < PERSIST_MIN_INTERVAL_MS) return;
    }

    await prisma.portfolioSnapshot.create({
      data: {
        userId: walletRow.userId,
        walletId: walletRow.id,
        chainId: s.chainId,
        totalValue: s.totalUSD,
        totalUSD: s.totalUSD.toString(),
        positions: s.positions as unknown as object,
        allocation: s.breakdown as unknown as object,
        performance: {
          netWorthUSD: s.netWorthUSD,
          collateralUSD: s.collateralUSD,
          debtUSD: s.debtUSD,
        },
        riskMetrics: {},
        benchmarkDate: s.takenAt,
        takenAt: s.takenAt,
      },
    });
  }
}

/**
 * Reduce history to the LAST real snapshot per bucket (hour when the span is
 * under 48h so young accounts still draw a curve, calendar day otherwise).
 * Mirrors the frontend's mergeHistories bucketing; no point is interpolated.
 */
function downsampleHistory(
  points: { takenAt: Date; totalUSD: number }[],
): { takenAt: Date; totalUSD: number }[] {
  if (points.length < 3) return points;
  const spanMs =
    points[points.length - 1].takenAt.getTime() - points[0].takenAt.getTime();
  const hourly = spanMs < 48 * 3_600_000;
  const buckets = new Map<string, { takenAt: Date; totalUSD: number }>();
  for (const p of points) {
    const key = p.takenAt.toISOString().slice(0, hourly ? 13 : 10);
    buckets.set(key, p); // rows are asc — last write per bucket wins
  }
  return [...buckets.values()];
}

function serialiseSnapshot(s: PortfolioSnapshot): unknown {
  return { ...s, takenAt: s.takenAt.toISOString() };
}
function reviveSnapshot(s: any): PortfolioSnapshot {
  return { ...s, takenAt: new Date(s.takenAt) };
}
function rowToSnapshot(row: any, wallet: string, chainId: number): PortfolioSnapshot {
  return {
    wallet,
    chainId,
    totalUSD: row.totalValue ?? 0,
    collateralUSD: row.performance?.collateralUSD ?? 0,
    debtUSD: row.performance?.debtUSD ?? 0,
    netWorthUSD: row.performance?.netWorthUSD ?? 0,
    positions: row.positions ?? [],
    breakdown: row.allocation ?? { byProtocol: {}, byAsset: {}, byKind: {} },
    takenAt: row.takenAt,
  };
}

/**
 * CanonicalBridgeService
 *
 * In-process streaming bridge: DefiLlama → in-memory Map → SSE → frontend.
 * Replaces the 6h DB cron with tight in-memory polling.
 *
 * - Full catalog refresh every 5 minutes (also runs on boot)
 * - Active pools re-checked every 2 minutes (calls _fullRefresh for now — can be narrowed later)
 * - AnomalyDetector runs on every cycle
 * - SSE clients receive bulk_snapshot on connect, then anomaly events on detection
 * - isPoolBlocked(): called by CalldataBuilder.prepare() before building calldata
 */

import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { poolToCanonicalYieldSource, type CanonicalYieldSource } from '../canonical/CanonicalYieldSource';
import { anomalyDetector, type AnomalySignal } from './AnomalyDetector';
import type { PoolHealthScore } from './PoolHealthScorer';
import { findV1Entry, isV1Pool, syntheticV1Entries, v1DisplayContract, type V1PoolEntry } from '../config/v1Pools.config';

const YIELDS_URL = 'https://yields.llama.fi/pools';
const BORROW_URL = 'https://yields.llama.fi/poolsBorrow';
// Lower TVL minimum so the full catalog is visible. PLAN_UNICO A5.1 says
// "filtrados solo por un TVL mínimo configurable por el usuario (default 500k)"
// but with the chain filter that was cutting pools to ~200. Keep $100K so
// the pool list is comprehensive while still filtering micro-pools.
const MIN_TVL_USD = 100_000;
const ACTIVE_POLL_MS = 2 * 60 * 1000;
const FULL_REFRESH_MS = 5 * 60 * 1000;

// Comprehensive chain → EVM chainId mapping.
// Non-EVM chains (Solana, Tron, Aptos, …) use chainId 0 so they still appear
// in the display catalog — execution will route them to goto_protocol.
const CHAIN_NAME_TO_ID: Record<string, number> = {
  // ── Tier-1 EVM ────────────────────────────────────────────────────────────
  Ethereum: 1,
  Arbitrum: 42161,
  'Arbitrum Nova': 42170,
  Base: 8453,
  Polygon: 137,
  'Polygon zkEVM': 1101,
  Avalanche: 43114,
  Optimism: 10,
  BSC: 56,
  BinanceSmartChain: 56,
  Flare: 14,
  // ── L2 / newer EVM ────────────────────────────────────────────────────────
  'zkSync Era': 324,
  zkSync: 324,
  Linea: 59144,
  Scroll: 534352,
  Mantle: 5000,
  Blast: 81457,
  Mode: 34443,
  Sonic: 146,
  Taiko: 167000,
  'Manta Pacific': 169,
  Manta: 169,
  Worldchain: 480,
  Zircuit: 48900,
  Berachain: 80084,
  'X Layer': 196,
  XLayer: 196,
  'Sei EVM': 1329,
  Sei: 1329,
  Neon: 245022934,
  // ── Established EVM ───────────────────────────────────────────────────────
  Gnosis: 100,
  xDai: 100,
  Fantom: 250,
  Cronos: 25,
  Moonbeam: 1284,
  Moonriver: 1285,
  Kava: 2222,
  Celo: 42220,
  Metis: 1088,
  Aurora: 1313161554,
  Harmony: 1666600000,
  OKXChain: 66,
  OKChain: 66,
  Klaytn: 8217,
  Boba: 288,
  Telos: 40,
  Fuse: 122,
  IoTeX: 4689,
  Velas: 106,
  Heco: 128,
  // ── Non-EVM (display-only, chainId 0 → shown without chain badge) ─────────
  Solana: 0,
  Tron: 0,
  Near: 0,
  Cosmos: 0,
  Osmosis: 0,
  Aptos: 0,
  Sui: 0,
  Starknet: 0,
  Algorand: 0,
  Flow: 0,
  Hedera: 0,
  Stellar: 0,
  TON: 0,
  Cardano: 0,
  Bitcoin: 0,
  Injective: 0,
  Radix: 0,
};

interface RawLlamaPool {
  pool: string; chain: string; project: string; symbol: string;
  tvlUsd: number; apyBase?: number | null; apyReward?: number | null;
  apy: number; category?: string | null; isLiquidStaking?: boolean;
  ltv?: number | null; underlyingTokens?: string[];
  url?: string; ilRisk?: string | null; audits?: string | null;
}

/**
 * Borrow-side data from DefiLlama /yields/poolsBorrow.
 * Joined to the supply pool via shared `pool` UUID.
 */
interface RawLlamaBorrowPool {
  pool: string;
  apyBaseBorrow?: number | null;
  apyRewardBorrow?: number | null;
  totalSupplyUsd?: number | null;
  totalBorrowUsd?: number | null;
  debtCeilingUsd?: number | null;
  ltv?: number | null;
  borrowable?: boolean | null;
}

export interface SSEEventType {
  type: 'pool_update' | 'anomaly' | 'health_update' | 'bulk_snapshot';
  data: unknown;
  timestamp: string;
}

class CanonicalBridgeService {
  private readonly _pools = new Map<string, CanonicalYieldSource>();
  private readonly _anomalies = new Map<string, AnomalySignal[]>();
  private readonly _health = new Map<string, PoolHealthScore>();
  private readonly _blocked = new Set<string>();
  private readonly _clients = new Set<Response>();

  private _activeTimer: ReturnType<typeof setInterval> | null = null;
  private _fullTimer: ReturnType<typeof setInterval> | null = null;
  private _started = false;

  start(): void {
    if (this._started) return;
    this._started = true;
    void this._fullRefresh();
    this._activeTimer = setInterval(() => { void this._fullRefresh(); }, ACTIVE_POLL_MS);
    this._fullTimer = setInterval(() => { void this._fullRefresh(); }, FULL_REFRESH_MS);
  }

  stop(): void {
    if (this._activeTimer) clearInterval(this._activeTimer);
    if (this._fullTimer) clearInterval(this._fullTimer);
    this._started = false;
  }

  getAll(): CanonicalYieldSource[] { return Array.from(this._pools.values()); }
  getById(poolId: string): CanonicalYieldSource | null { return this._pools.get(poolId) ?? null; }

  /**
   * Curated v1 set ONLY — backs the "Producción de activos" screen.
   * = live feed pools that match the LOCKED set (v1Pools.config) + synthetic rows
   *   for curated pools NOT reliably present in the DefiLlama feed (Stellar Blend/
   *   Soroswap, FXRP). Synthetic rows carry no live APY/TVL (rendered as "—") — APY
   *   is always protocol data with a source (#7), never invented here.
   */
  getCuratedV1(): CanonicalYieldSource[] {
    const live = this.getAll()
      .map((p) => {
        const entry = findV1Entry({ protocol: p.protocol, chainId: p.chainId, symbol: p.symbol });
        if (!entry) return null;
        // Attach the display interaction contract (the address shown on the card).
        const addr = v1DisplayContract(entry, p.chainId);
        return addr ? { ...p, interactionContractAddress: addr } : p;
      })
      .filter((p): p is CanonicalYieldSource => p !== null);
    const matchedKeys = new Set(
      live
        .map((p) => findV1Entry({ protocol: p.protocol, chainId: p.chainId, symbol: p.symbol })?.key)
        .filter((k): k is string => !!k),
    );
    const synthetic = syntheticV1Entries()
      .filter((e) => !matchedKeys.has(e.key))
      .map((e) => this._syntheticRow(e));
    return [...live, ...synthetic];
  }

  /** Build a display-only CanonicalYieldSource for a curated entry absent from the live feed. */
  private _syntheticRow(e: V1PoolEntry): CanonicalYieldSource {
    const category =
      e.ops.includes('add_liquidity') ? 'DEX'
        : e.ops.includes('supply') || e.ops.includes('borrow') ? 'Lending'
          : e.ops.includes('stake') ? 'Liquid Staking'
            : 'Asset';
    const row = poolToCanonicalYieldSource(
      {
        id: `v1:${e.key}`,
        protocol: e.defiLlamaSlugs[0] ?? e.adapterId ?? e.key,
        chain: e.vm === 'stellar' ? 'stellar' : `eip155:${e.chainId}`,
        chainId: e.chainId,
        symbol: e.assets.join(' / '),
        tvlUsd: 0,
        apyBase: null,
        apyReward: null,
        apyTotal: 0,
        underlyingTokens: [],
        category,
        // No live audit/risk data for synthetic rows — leave unasserted (honest).
        isAudited: false,
        isAllowlisted: true,
        ltv: null,
        cooldownSeconds: null,
        lastSyncedAt: new Date(),
        borrowable: e.ops.includes('borrow'),
      },
      randomUUID(),
    );
    // poolToCanonicalYieldSource does not copy extra fields → attach via spread.
    const displayContract = v1DisplayContract(e, e.chainId);
    return displayContract ? { ...row, interactionContractAddress: displayContract } : row;
  }
  getBlocked(): string[] { return Array.from(this._blocked); }
  isPoolBlocked(poolId: string): boolean { return this._blocked.has(poolId); }
  getHealthScore(poolId: string): PoolHealthScore | null { return this._health.get(poolId) ?? null; }

  addClient(res: Response): () => void {
    this._clients.add(res);
    this._send(res, { type: 'bulk_snapshot', data: this.getAll(), timestamp: new Date().toISOString() });
    return () => this._clients.delete(res);
  }

  private async _fullRefresh(): Promise<void> {
    let raw: RawLlamaPool[];
    let borrowMap: Map<string, RawLlamaBorrowPool>;
    try {
      [raw, borrowMap] = await Promise.all([this._fetchLlama(), this._fetchBorrowMap()]);
    }
    catch (e) { console.error('[CanonicalBridge] DefiLlama fetch error:', e); return; }

    const traceId = randomUUID();

    for (const r of raw) {
      const chainId = CHAIN_NAME_TO_ID[r.chain];
      // chainId === undefined  → chain not in map at all → skip
      // chainId === 0          → non-EVM, display-only pool → keep
      if (chainId === undefined || r.tvlUsd < MIN_TVL_USD) continue;

      const borrow = borrowMap.get(r.pool);

      const poolLike = {
        id: r.pool, protocol: r.project,
        chain: chainId ? `eip155:${chainId}` : r.chain,
        chainId,
        symbol: r.symbol, tvlUsd: r.tvlUsd, apyBase: r.apyBase ?? null,
        apyReward: r.apyReward ?? null, apyTotal: r.apy,
        underlyingTokens: r.underlyingTokens ?? [],
        category: r.category ?? null, ilRisk: r.ilRisk ?? null,
        isAudited: r.audits ? parseInt(r.audits, 10) > 0 : false,
        // Curated v1 membership (#8). Pools in the LOCKED set are flagged so
        // Asset Production can show ONLY the curated set. This is MEMBERSHIP, not
        // a risk gate — the Risk Engine still surfaces risk; the catalogue stays
        // accessible elsewhere ("all pools accessible, user decides").
        isAllowlisted: isV1Pool({ protocol: r.project, chainId, symbol: r.symbol }),
        // Borrow side gives a more accurate LTV when available
        ltv: borrow?.ltv ?? r.ltv ?? null,
        cooldownSeconds: null,
        lastSyncedAt: new Date(),
        // Borrow enrichment — undefined for non-borrowable pools
        borrowable: borrow?.borrowable ?? false,
        apyBaseBorrow: borrow?.apyBaseBorrow ?? null,
        apyRewardBorrow: borrow?.apyRewardBorrow ?? null,
        totalSupplyUsd: borrow?.totalSupplyUsd ?? null,
        totalBorrowUsd: borrow?.totalBorrowUsd ?? null,
        debtCeilingUsd: borrow?.debtCeilingUsd ?? null,
      };

      const canonical = poolToCanonicalYieldSource(poolLike, traceId);
      this._pools.set(r.pool, canonical);

      const signals = anomalyDetector.detect(r.pool, { apy: r.apy, tvl: r.tvlUsd });
      if (signals.length > 0) {
        this._anomalies.set(r.pool, signals);
        if (signals.some((s) => s.severity === 'blocked')) {
          this._blocked.add(r.pool);
        } else if (!this._health.get(r.pool)?.riskLevel.includes('blocked')) {
          this._blocked.delete(r.pool);
        }
        this._broadcastAll({ type: 'anomaly', data: signals, timestamp: new Date().toISOString() });
      } else {
        this._anomalies.delete(r.pool);
        if (this._health.get(r.pool)?.riskLevel !== 'blocked') {
          this._blocked.delete(r.pool);
        }
      }
    }

    this._broadcastAll({ type: 'bulk_snapshot', data: this.getAll(), timestamp: new Date().toISOString() });
  }

  private async _fetchLlama(): Promise<RawLlamaPool[]> {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(YIELDS_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { data: RawLlamaPool[] };
      return body.data ?? [];
    } finally { clearTimeout(tid); }
  }

  /**
   * Fetch borrow-side pool data from DefiLlama and return a Map for O(1) join.
   * Failures here are non-fatal — supply pools still render without borrow rows.
   */
  // 402/403 = the endpoint moved behind DeFiLlama's paid tier — retrying every
  // poll cycle just spams the logs and burns a request. Back off for 24h.
  private _borrowDisabledUntil = 0;

  private async _fetchBorrowMap(): Promise<Map<string, RawLlamaBorrowPool>> {
    if (Date.now() < this._borrowDisabledUntil) return new Map();
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(BORROW_URL, { signal: controller.signal });
      if (!res.ok) {
        if (res.status === 402 || res.status === 403) {
          this._borrowDisabledUntil = Date.now() + 24 * 60 * 60 * 1000;
          console.warn(`[CanonicalBridge] borrow fetch HTTP ${res.status} — paid endpoint, disabling borrow data for 24h`);
        } else {
          console.warn(`[CanonicalBridge] borrow fetch HTTP ${res.status} — proceeding without borrow data`);
        }
        return new Map();
      }
      const body = (await res.json()) as { data: RawLlamaBorrowPool[] };
      const map = new Map<string, RawLlamaBorrowPool>();
      for (const bp of body.data ?? []) {
        if (bp.pool) map.set(bp.pool, bp);
      }
      return map;
    } catch (e) {
      console.warn('[CanonicalBridge] borrow fetch failed — proceeding without borrow data:', e);
      return new Map();
    } finally { clearTimeout(tid); }
  }

  private _broadcastAll(event: SSEEventType): void {
    for (const client of this._clients) this._send(client, event);
  }

  private _send(res: Response, event: SSEEventType): void {
    try { res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`); }
    catch { this._clients.delete(res); }
  }
}

export const canonicalBridgeService = new CanonicalBridgeService();

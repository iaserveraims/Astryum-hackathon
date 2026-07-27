import { BaseAdapter } from './BaseAdapter';
import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../../types/domain/Position';
import type { ProtocolAction } from '../../../types/domain/Protocol';
import type { SimulationResult } from '../../../types/domain/Intent';
import { FLARE_MULTICALL3, type FlareLpV2Venue } from '../../../config/flareLpVenues';

/**
 * Generic tracker for UniV2-style LP tokens on Flare — one registered instance
 * per venue in FLARE_LP_V2_VENUES (BlazeSwap, SparkDEX V2, Enosys V2,
 * Pangolin). READ-ONLY.
 *
 * V2 pairs are plain ERC-20s with no per-wallet enumeration, so the sweep is:
 *   1. enumerate ALL pair addresses once per factory via Multicall3
 *      (allPairsLength + chunked allPairs) — cached in-process for 6h;
 *   2. per wallet: chunked Multicall3 balanceOf over every pair (no silent
 *      cap — BlazeSwap alone has ~1,900 pairs and they are ALL swept);
 *   3. only for pairs with balance > 0 (a handful): read token0/token1/
 *      symbols/totalSupply/reserves and emit the position with the wallet's
 *      pool share and underlying amounts.
 */

const MULTICALL3_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
];
const FACTORY_ABI = [
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)',
];
const PAIR_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];
const ERC20_SYMBOL_ABI = ['function symbol() view returns (string)'];

const MULTICALL_CHUNK = 400;
const PAIRS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — pair creation is rare

/** The `ethers` namespace as produced by `(await import('ethers')).ethers`. */
type EthersNS = (typeof import('ethers'))['ethers'];

/** factory (lowercase) → cached pair list. Shared across instances/scans. */
const pairsCache = new Map<string, { pairs: string[]; at: number }>();
/** token address (lowercase) → symbol. Chain-wide. */
const symbolCache = new Map<string, string>();

export function _resetFlareLpV2Caches(): void {
  pairsCache.clear();
  symbolCache.clear();
}

export class FlareLpV2Adapter extends BaseAdapter {
  readonly protocolId: string;
  readonly chainId = 14;
  private readonly venue: FlareLpV2Venue;

  constructor(venue: FlareLpV2Venue) {
    super();
    this.venue = venue;
    this.protocolId = venue.id;
  }

  override get isActive(): boolean {
    return true; // fixed, verified mainnet constants (flareLpVenues.ts)
  }

  /** Multicall3 aggregate3 over identical-target calls, chunked. */
  private async multicall(
    ethers: EthersNS,
    provider: unknown,
    calls: Array<{ target: string; callData: string }>,
  ): Promise<Array<{ success: boolean; returnData: string }>> {
    const mc = new ethers.Contract(FLARE_MULTICALL3, MULTICALL3_ABI, provider as never);
    const out: Array<{ success: boolean; returnData: string }> = [];
    for (let i = 0; i < calls.length; i += MULTICALL_CHUNK) {
      const chunk = calls.slice(i, i + MULTICALL_CHUNK).map((c) => ({
        target: c.target,
        allowFailure: true,
        callData: c.callData,
      }));
      const res = await mc.aggregate3.staticCall(chunk);
      for (const r of res) out.push({ success: r.success, returnData: r.returnData });
    }
    return out;
  }

  /** All pair addresses of this factory (cached 6h in-process). */
  private async allPairs(
    ethers: EthersNS,
    provider: unknown,
  ): Promise<string[]> {
    const key = this.venue.factory.toLowerCase();
    const hit = pairsCache.get(key);
    if (hit && Date.now() - hit.at < PAIRS_CACHE_TTL_MS) return hit.pairs;

    const factory = new ethers.Contract(this.venue.factory, FACTORY_ABI, provider as never);
    const length = Number(await factory.allPairsLength());
    const iface = new ethers.Interface(FACTORY_ABI);
    const calls = Array.from({ length }, (_, i) => ({
      target: this.venue.factory,
      callData: iface.encodeFunctionData('allPairs', [i]),
    }));
    const res = await this.multicall(ethers, provider, calls);
    const pairs: string[] = [];
    for (const r of res) {
      if (!r.success || r.returnData === '0x') continue;
      const [addr] = iface.decodeFunctionResult('allPairs', r.returnData);
      pairs.push(String(addr));
    }
    pairsCache.set(key, { pairs, at: Date.now() });
    return pairs;
  }

  private async tokenSymbol(
    ethers: EthersNS,
    provider: unknown,
    token: string,
  ): Promise<string> {
    const key = token.toLowerCase();
    const hit = symbolCache.get(key);
    if (hit) return hit;
    try {
      const c = new ethers.Contract(token, ERC20_SYMBOL_ABI, provider as never);
      const sym: string = await c.symbol();
      symbolCache.set(key, sym);
      return sym;
    } catch {
      const short = `${token.slice(0, 6)}…${token.slice(-4)}`;
      symbolCache.set(key, short);
      return short;
    }
  }

  async discoverPositions(wallet: string): Promise<RawPosition[]> {
    const { ethers } = await import('ethers');
    const provider = this.provider.getHttpProvider();

    const pairs = await this.allPairs(ethers, provider);
    if (pairs.length === 0) return [];

    // Sweep EVERY pair's balanceOf(wallet) in a few Multicall3 round-trips.
    const pairIface = new ethers.Interface(PAIR_ABI);
    const balCall = pairIface.encodeFunctionData('balanceOf', [wallet]);
    const res = await this.multicall(
      ethers,
      provider,
      pairs.map((p) => ({ target: p, callData: balCall })),
    );

    const held: Array<{ pair: string; balance: bigint }> = [];
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      if (!r.success || r.returnData === '0x') continue;
      const [bal] = pairIface.decodeFunctionResult('balanceOf', r.returnData);
      if ((bal as bigint) > 0n) held.push({ pair: pairs[i], balance: bal as bigint });
    }
    if (held.length === 0) return [];

    const now = new Date();
    const positions: RawPosition[] = [];
    for (const { pair, balance } of held) {
      try {
        const c = new ethers.Contract(pair, PAIR_ABI, provider);
        const [token0, token1, totalSupply, reserves] = await Promise.all([
          c.token0(),
          c.token1(),
          c.totalSupply(),
          c.getReserves().catch(() => null),
        ]);
        const [sym0, sym1] = await Promise.all([
          this.tokenSymbol(ethers, provider, token0),
          this.tokenSymbol(ethers, provider, token1),
        ]);
        const ts = totalSupply as bigint;
        // Underlying amounts = user share of reserves (display-grade).
        const amount0 = reserves && ts > 0n ? ((reserves[0] as bigint) * balance) / ts : null;
        const amount1 = reserves && ts > 0n ? ((reserves[1] as bigint) * balance) / ts : null;

        positions.push({
          protocolId: this.protocolId,
          chainId: this.chainId,
          wallet,
          kind: 'LP',
          asset: `${sym0}/${sym1}`,
          amount: balance,
          raw: {
            venue: this.venue.name,
            token: `${sym0}/${sym1} LP`,
            pair,
            token0,
            token1,
            sym0,
            sym1,
            totalSupply: ts.toString(),
            sharePpm: ts > 0n ? Number((balance * 1_000_000n) / ts) : null,
            amount0: amount0?.toString() ?? null,
            amount1: amount1?.toString() ?? null,
            source: `${this.venue.name} factory ${this.venue.factory} (live on-chain)`,
          },
          discoveredAt: now,
        });
      } catch {
        // one odd pair must never sink the venue sweep
      }
    }

    return positions;
  }

  normalizePosition(raw: RawPosition): NormalizedPosition {
    return {
      protocolId: raw.protocolId,
      chainId: raw.chainId,
      wallet: raw.wallet,
      kind: raw.kind,
      asset: raw.asset,
      amount: raw.amount,
      amountUSD: 0,
      priceUSD: 0,
      metadata: raw.raw,
      takenAt: raw.discoveredAt,
    };
  }

  async getMetrics(_position: NormalizedPosition): Promise<PositionMetrics> {
    return {};
  }

  /** Tracking-only adapter: LP actions are not prepared here (V1). */
  async simulateAction(action: ProtocolAction): Promise<SimulationResult> {
    const now = new Date();
    return {
      success: false,
      gasEstimate: 0n,
      gasEstimateUSD: 0,
      netUSDImpact: 0,
      riskDelta: 0,
      warnings: [
        `${this.venue.name} is tracking-only in V1 — ${action.kind} is not prepared here. Use the venue directly ("Ir al protocolo").`,
      ],
      simulatedAt: now,
      priceTimestamp: now,
      isStale: false,
    };
  }
}

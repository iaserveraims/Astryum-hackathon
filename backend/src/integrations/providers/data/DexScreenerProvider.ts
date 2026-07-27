/**
 * DexScreenerProvider
 *
 * Real-time DEX pair data, liquidity, volume, and trending tokens across 50+ chains.
 * Public API — no key required. Optional DEXSCREENER_API_KEY for higher rate limits.
 *
 * Capabilities:
 *   market.getPairs        — pairs by token address (comma-separated, max 30)
 *   market.getTrendingPairs — recently boosted/trending token profiles
 *   market.getPoolLiquidity — liquidity snapshot for a specific chainId + pairAddress
 */
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';

const BASE_URL = 'https://api.dexscreener.com';
const API_KEY = process.env.DEXSCREENER_API_KEY ?? '';

export interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd?: string;
  txns?: { h24?: { buys?: number; sells?: number } };
  volume?: { h24?: number; h6?: number; h1?: number };
  priceChange?: { h24?: number; h6?: number; h1?: number };
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
}

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'market.getPairs',
  'market.getTrendingPairs',
  'market.getPoolLiquidity',
]);

class DexScreenerProvider implements IProvider {
  readonly id = 'dexscreener';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 60;

  private get headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' };
    if (API_KEY) h['X-API-Key'] = API_KEY;
    return h;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/token-profiles/latest/v1`, {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      return {
        status: resp.status < 500 ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: resp.status < 500 ? undefined : `HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        lastCheckAt: new Date().toISOString(),
        reason: (err as Error).message,
      };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const source = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
    } as const;

    const inp = input as Record<string, unknown>;

    switch (capability) {
      case 'market.getPairs': {
        const tokenAddresses = inp.tokenAddresses as string | string[];
        const addresses = Array.isArray(tokenAddresses)
          ? tokenAddresses.slice(0, 30).join(',')
          : tokenAddresses;
        if (!addresses) throw new Error('DexScreenerProvider: tokenAddresses required');
        const resp = await fetch(`${BASE_URL}/latest/dex/tokens/${addresses}`, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`DexScreener API error: HTTP ${resp.status}`);
        const body = (await resp.json()) as { pairs?: DexPair[] };
        return { data: (body.pairs ?? []) as unknown as TOut, source, cached: false };
      }

      case 'market.getTrendingPairs': {
        const resp = await fetch(`${BASE_URL}/token-profiles/latest/v1`, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`DexScreener API error: HTTP ${resp.status}`);
        const body = await resp.json();
        return { data: body as unknown as TOut, source, cached: false };
      }

      case 'market.getPoolLiquidity': {
        const chainId = inp.chainId as string;
        const pairAddress = inp.pairAddress as string;
        if (!chainId || !pairAddress)
          throw new Error('DexScreenerProvider: chainId + pairAddress required');
        const resp = await fetch(`${BASE_URL}/latest/dex/pairs/${chainId}/${pairAddress}`, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`DexScreener API error: HTTP ${resp.status}`);
        const body = (await resp.json()) as { pairs?: DexPair[] };
        const pair = body.pairs?.[0];
        if (!pair) throw new Error('DexScreenerProvider: pair not found');
        return { data: pair as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`DexScreenerProvider: unsupported capability '${capability}'`);
    }
  }
}

export const dexScreenerProvider = new DexScreenerProvider();

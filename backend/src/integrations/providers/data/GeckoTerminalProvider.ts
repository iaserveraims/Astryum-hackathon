/**
 * GeckoTerminalProvider
 *
 * OHLCV candles, trending pools, and real-time pool data across 200+ networks.
 * Public API — no key required. Optional GECKO_TERMINAL_API_KEY for higher rate limits.
 *
 * Capabilities:
 *   market.getOHLCV         — OHLCV candles for a pool (day/hour/minute)
 *   market.getTrendingPools — trending pools by network
 *   market.getNetworks      — list all supported networks
 */
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';

const BASE_URL = 'https://api.geckoterminal.com/api/v2';
const API_KEY = process.env.GECKO_TERMINAL_API_KEY ?? '';

export interface GeckoOHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GeckoPool {
  id: string;
  type: string;
  attributes: {
    name: string;
    address: string;
    base_token_price_usd?: string;
    quote_token_price_usd?: string;
    volume_usd?: { h24?: string };
    liquidity_usd?: string;
    fdv_usd?: string;
    price_change_percentage?: { h24?: string };
    tx_count?: { h24?: number };
  };
}

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'market.getOHLCV',
  'market.getTrendingPools',
  'market.getNetworks',
]);

class GeckoTerminalProvider implements IProvider {
  readonly id = 'geckoterminal';
  readonly type = 'data' as const;
  readonly capabilities = CAPS;
  readonly trustLevel = 'indexer_verified' as const;
  readonly priority = 58;

  private get headers(): Record<string, string> {
    // GeckoTerminal requires this Accept header for versioned responses
    const h: Record<string, string> = { Accept: 'application/json;version=20230302' };
    if (API_KEY) h['Authorization'] = `Bearer ${API_KEY}`;
    return h;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/networks?page=1`, {
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
      case 'market.getOHLCV': {
        // network: GeckoTerminal network slug ('eth', 'flare', 'solana', etc.)
        // poolAddress: pair/pool contract address
        // timeframe: 'day' | 'hour' | 'minute'
        // limit: number of candles, max 1000
        const { network, poolAddress, timeframe = 'hour', limit = 100 } = inp;
        if (!network || !poolAddress)
          throw new Error('GeckoTerminalProvider: network + poolAddress required');
        const url = `${BASE_URL}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`;
        const resp = await fetch(url, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`GeckoTerminal API error: HTTP ${resp.status}`);
        const body = (await resp.json()) as {
          data?: { attributes?: { ohlcv_list?: number[][] } };
        };
        const rawOhlcv = body.data?.attributes?.ohlcv_list ?? [];
        // GeckoTerminal format: [timestamp, open, high, low, close, volume]
        const parsed: GeckoOHLCV[] = rawOhlcv.map(([ts, o, h, l, c, v]) => ({
          timestamp: ts,
          open: o,
          high: h,
          low: l,
          close: c,
          volume: v,
        }));
        return { data: parsed as unknown as TOut, source, cached: false };
      }

      case 'market.getTrendingPools': {
        const network = (inp.network as string | undefined) ?? 'eth';
        const page = (inp.page as number | undefined) ?? 1;
        const url = `${BASE_URL}/networks/${network}/trending_pools?page=${page}`;
        const resp = await fetch(url, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`GeckoTerminal API error: HTTP ${resp.status}`);
        const body = (await resp.json()) as { data?: GeckoPool[] };
        return { data: (body.data ?? []) as unknown as TOut, source, cached: false };
      }

      case 'market.getNetworks': {
        const resp = await fetch(`${BASE_URL}/networks?page=1`, {
          headers: this.headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) throw new Error(`GeckoTerminal API error: HTTP ${resp.status}`);
        const body = await resp.json();
        return { data: body as unknown as TOut, source, cached: false };
      }

      default:
        throw new Error(`GeckoTerminalProvider: unsupported capability '${capability}'`);
    }
  }
}

export const geckoTerminalProvider = new GeckoTerminalProvider();

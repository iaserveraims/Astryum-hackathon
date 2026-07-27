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

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'oracle.getPrice',
  'oracle.getPrices',
  'oracle.getPriceWithProof',
]);

const REDSTONE_API = 'https://api.redstone.finance/prices';
const STALE_AFTER_MS = 60_000;

export interface RedstoneRawPrice {
  value: number;
  timestamp: number; // unix ms
}

async function fetchRedstone(symbols: string[]): Promise<Record<string, RedstoneRawPrice>> {
  const url = `${REDSTONE_API}?symbols=${symbols.join(',')}&provider=redstone`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.REDSTONE_API_KEY) {
    headers['x-api-key'] = process.env.REDSTONE_API_KEY;
  }
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(5_000),
    headers,
  });
  if (!resp.ok) throw new Error(`Redstone API ${resp.status}: ${resp.statusText}`);
  return (await resp.json()) as Record<string, RedstoneRawPrice>;
}

/**
 * RedstoneProvider
 *
 * Covers long-tail assets not available in the FTSO feed.
 * - oracle.getPrice / oracle.getPrices: HTTP pull — no API key required for basic use.
 *   Set REDSTONE_API_KEY for higher rate limits.
 * - oracle.getPriceWithProof: returns price + null proof for now.
 *   On-chain pull-model proof (for execution) is a future iteration.
 */
export class RedstoneProvider implements IProvider {
  readonly id = 'redstone';
  readonly type: ProviderType = 'oracle';
  readonly trustLevel: TrustLevel = 'oracle_verified';
  readonly priority = 85;
  readonly capabilities = CAPS;

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      await fetchRedstone(['ETH']);
      return {
        status: 'healthy' as HealthStatus,
        latencyMs: Date.now() - startedAt,
        lastCheckAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        status: 'down' as HealthStatus,
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
    let data: unknown;
    let stale = false;
    const now = Date.now();

    switch (capability) {
      case 'oracle.getPrice': {
        const { symbol } = input as { symbol: string };
        if (!symbol) throw new Error('symbol required');
        const result = await fetchRedstone([symbol]);
        const p = result[symbol];
        if (!p) throw new Error(`PRICE_NOT_FOUND:${symbol}`);
        stale = now - p.timestamp > STALE_AFTER_MS;
        data = { symbol, usdPrice: p.value, timestamp: p.timestamp, source: 'redstone' };
        break;
      }
      case 'oracle.getPrices': {
        const { symbols } = input as { symbols: string[] };
        if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('symbols required');
        const result = await fetchRedstone(symbols);
        stale = Object.values(result).some((p) => now - p.timestamp > STALE_AFTER_MS);
        data = result;
        break;
      }
      case 'oracle.getPriceWithProof': {
        const { symbol } = input as { symbol: string };
        if (!symbol) throw new Error('symbol required');
        const result = await fetchRedstone([symbol]);
        const p = result[symbol];
        if (!p) throw new Error(`PRICE_NOT_FOUND:${symbol}`);
        stale = now - p.timestamp > STALE_AFTER_MS;
        // On-chain pull-model proof deferred to a future iteration
        data = { price: { symbol, usdPrice: p.value, timestamp: p.timestamp }, proof: null };
        break;
      }
      default:
        throw new Error(`unsupported_capability: ${capability}`);
    }

    const source: SourceRecord = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId ?? randomUUID(),
      stale,
    };
    return { data: data as TOut, source, cached: false };
  }
}

export const redstoneProvider = new RedstoneProvider();

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
import { FTSOClient } from '../../../flare/ftso/FTSOClient';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'oracle.getPrice',
  'oracle.getPrices',
  'oracle.getPriceWithProof',
]);

const STALE_AFTER_S = 90; // V1.1 anti-stale guard for canonical responses

let shared: FTSOClient | null = null;
function getClient(): FTSOClient {
  if (!shared) {
    shared = new FTSOClient({
      network: 'flare',
      rpcUrl: process.env.FLARE_RPC_HTTP || 'https://flare-api.flare.network/ext/C/rpc',
      cacheTTL: 30,
      maxPriceAge: 180,
    });
  }
  return shared;
}

/**
 * Wraps the V1 FTSOClient as a V1.1 oracle provider. Capabilities deliver
 * canonical price snapshots; SourceRecord.stale is set true when the FTSO
 * feed update is older than STALE_AFTER_S seconds (PolicyGuard P5 trips on this).
 */
export class FtsoProvider implements IProvider {
  readonly id = 'flare-ftso';
  readonly type: ProviderType = 'oracle';
  readonly trustLevel: TrustLevel = 'oracle_verified';
  readonly priority = 100;
  readonly capabilities = CAPS;

  constructor(private readonly client: FTSOClient = getClient()) {}

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const ok = await this.client.isHealthy();
      const latencyMs = Date.now() - startedAt;
      const status: HealthStatus = ok ? 'healthy' : 'degraded';
      return { status, latencyMs, lastCheckAt: new Date().toISOString() };
    } catch (err) {
      return {
        status: 'down',
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
    switch (capability) {
      case 'oracle.getPrice': {
        const { symbol } = input as { symbol: string };
        if (!symbol) throw new Error('symbol required');
        const p = await this.client.getCurrentPrice(symbol);
        stale = p.age > STALE_AFTER_S;
        data = p;
        break;
      }
      case 'oracle.getPrices': {
        const { symbols } = input as { symbols: string[] };
        if (!Array.isArray(symbols) || symbols.length === 0) throw new Error('symbols required');
        const prices = await this.client.getCurrentPrices(symbols);
        stale = prices.some((p) => p.age > STALE_AFTER_S);
        data = prices;
        break;
      }
      case 'oracle.getPriceWithProof': {
        // FTSO v2 finalised feeds are themselves the proof: return price + epochId.
        const { symbol } = input as { symbol: string };
        if (!symbol) throw new Error('symbol required');
        const p = await this.client.getCurrentPrice(symbol);
        stale = p.age > STALE_AFTER_S;
        data = { price: p, epochId: p.epochId ?? null };
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

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
  'explorer.getActivity',
  'explorer.getTokenTransfers',
  'explorer.verifyContract',
  'explorer.getInternalTxs',
]);

const DEFAULT_BASE = process.env.FLARESCAN_API_URL || 'https://flare-explorer.flare.network/api';
const HEALTH_TIMEOUT_MS = 5000;

interface ExplorerResponse<T> {
  status?: string;
  message?: string;
  result?: T;
}

/**
 * Public Flarescan / flare-explorer indexer client. trust=indexer_verified so
 * results don't satisfy hard policy checks (P9..P14) but are good enough for
 * activity timeline and verification metadata.
 */
export class FlarescanProvider implements IProvider {
  readonly id = 'flarescan';
  readonly type: ProviderType = 'explorer';
  readonly trustLevel: TrustLevel = 'indexer_verified';
  readonly priority = 80;
  readonly capabilities = CAPS;

  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}?module=block&action=eth_block_number`,
        HEALTH_TIMEOUT_MS,
      );
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
    switch (capability) {
      case 'explorer.getActivity': {
        const { address, page, offset } = input as {
          address: string;
          page?: number;
          offset?: number;
        };
        if (!address) throw new Error('address required');
        data = await this.query<unknown[]>('account', 'txlist', {
          address,
          page: page ?? 1,
          offset: offset ?? 50,
          sort: 'desc',
        });
        break;
      }
      case 'explorer.getTokenTransfers': {
        const { address, contract } = input as { address: string; contract?: string };
        if (!address) throw new Error('address required');
        const params: Record<string, string | number> = {
          address,
          page: 1,
          offset: 100,
          sort: 'desc',
        };
        if (contract) params.contractaddress = contract;
        data = await this.query<unknown[]>('account', 'tokentx', params);
        break;
      }
      case 'explorer.verifyContract': {
        const { address } = input as { address: string };
        if (!address) throw new Error('address required');
        data = await this.query<unknown>('contract', 'getsourcecode', { address });
        break;
      }
      case 'explorer.getInternalTxs': {
        const { address } = input as { address: string };
        if (!address) throw new Error('address required');
        data = await this.query<unknown[]>('account', 'txlistinternal', {
          address,
          sort: 'desc',
        });
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
    };
    return { data: data as TOut, source, cached: false };
  }

  private async query<T>(
    module: string,
    action: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('module', module);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const res = await fetchWithTimeout(url.toString(), HEALTH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`flarescan_http_${res.status}`);
    const json = (await res.json()) as ExplorerResponse<T>;
    if (json.status && json.status !== '1' && json.message !== 'No transactions found') {
      throw new Error(`flarescan_api_error: ${json.message ?? 'unknown'}`);
    }
    return (json.result ?? ([] as unknown as T)) as T;
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

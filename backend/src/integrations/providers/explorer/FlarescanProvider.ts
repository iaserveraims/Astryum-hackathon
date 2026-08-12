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
import {
  EXPLORER_HEALTH_QUERY,
  explorerHost,
  flareExplorerBases,
} from '../../../config/flareExplorer';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'explorer.getActivity',
  'explorer.getTokenTransfers',
  'explorer.verifyContract',
  'explorer.getInternalTxs',
]);

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
 *
 * Two doors, not one (2026-08-03): the Blockscout API went 503 across every
 * /api path and took the whole activity rail with it. Every read walks the
 * bases in `config/flareExplorer` in order and sticks to whichever one answered,
 * so a single indexer's outage degrades latency instead of blinding the rail.
 */
export class FlarescanProvider implements IProvider {
  readonly id = 'flarescan';
  readonly type: ProviderType = 'explorer';
  readonly trustLevel: TrustLevel = 'indexer_verified';
  readonly priority = 80;
  readonly capabilities = CAPS;

  private readonly bases: string[];
  /** Sticky: index of the last base that answered — the next read starts there. */
  private preferred = 0;

  constructor(bases: string | ReadonlyArray<string> = flareExplorerBases()) {
    this.bases = typeof bases === 'string' ? [bases] : [...bases];
    if (this.bases.length === 0) throw new Error('FlarescanProvider: no explorer base configured');
  }

  /**
   * Ping every door with a query the three flavours (Blockscout, Routescan,
   * Etherscan) all understand, and READ THE BODY: Routescan answers HTTP 200
   * with `{"status":"0","message":"NOTOK"}` to an action it doesn't know, so a
   * status-code-only check would paint an error green.
   *
   * healthy = the primary answered · degraded = only a fallback did (the rail
   * works, but say which door and why) · down = nobody answered.
   */
  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    const failures: string[] = [];
    for (let i = 0; i < this.bases.length; i++) {
      const base = this.bases[i];
      try {
        await this.probe(base);
        const latencyMs = Date.now() - startedAt;
        this.preferred = i;
        const status: HealthStatus = i === 0 ? 'healthy' : 'degraded';
        return {
          status,
          latencyMs,
          lastCheckAt: new Date().toISOString(),
          reason:
            i === 0
              ? undefined
              : `sirviendo desde ${explorerHost(base)} — ${failures.join(' | ')}`,
        };
      } catch (err) {
        failures.push(`${explorerHost(base)}: ${(err as Error).message}`);
      }
    }
    return {
      status: 'down',
      latencyMs: Date.now() - startedAt,
      lastCheckAt: new Date().toISOString(),
      reason: `ningún explorador de Flare responde — ${failures.join(' | ')}`,
    };
  }

  private async probe(base: string): Promise<void> {
    const res = await fetchWithTimeout(`${base}?${EXPLORER_HEALTH_QUERY}`, HEALTH_TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as ExplorerResponse<string>;
    if (json.status !== '1') throw new Error(`API ${json.message ?? 'respuesta sin status'}`);
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

  /**
   * Walk the doors starting at the last one that worked. Only a real failure
   * moves on: "No transactions found" is a legitimate empty answer, not an
   * outage, so it never triggers failover (otherwise a quiet wallet would
   * hammer every indexer on every read).
   */
  private async query<T>(
    module: string,
    action: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const failures: string[] = [];
    for (let i = 0; i < this.bases.length; i++) {
      const idx = (this.preferred + i) % this.bases.length;
      const base = this.bases[idx];
      try {
        const out = await this.queryBase<T>(base, module, action, params);
        this.preferred = idx;
        return out;
      } catch (err) {
        failures.push(`${explorerHost(base)}: ${(err as Error).message}`);
      }
    }
    throw new Error(`flarescan_unreachable: ${failures.join(' | ')}`);
  }

  private async queryBase<T>(
    base: string,
    module: string,
    action: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    const url = new URL(base);
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

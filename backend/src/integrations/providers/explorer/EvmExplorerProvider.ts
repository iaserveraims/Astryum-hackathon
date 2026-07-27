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
  'explorer.getTransactions',
  'explorer.discoverInteractions',
]);

const DEFAULT_BASE = process.env.ETHERSCAN_API_URL || 'https://api.etherscan.io/v2/api';
const HEALTH_TIMEOUT_MS = 5000;
const QUERY_TIMEOUT_MS = 8000;

/** Etherscan V2 unified API — one key, chains selected via `chainid`. */
const SUPPORTED_CHAINS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Ethereum',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
});

/** Normalized, explorer-agnostic transaction record. Provider never writes DB. */
export interface NormalizedTx {
  hash: string;
  from: string;
  to: string;
  blockNumber: number;
  timeStamp: number; // unix seconds
  methodId: string; // first 4 bytes of calldata (selector) or ''
  value: string;
  isError: boolean;
  chainId: number;
}

interface EtherscanResponse {
  status?: string;
  message?: string;
  result?: unknown;
}

interface EtherscanTx {
  hash?: string;
  from?: string;
  to?: string;
  blockNumber?: string;
  timeStamp?: string;
  methodId?: string;
  input?: string;
  value?: string;
  isError?: string;
}

function resolveApiKey(): string | undefined {
  const k = process.env.ETHERSCAN_API_KEY;
  return k && k.trim().length > 0 ? k.trim() : undefined;
}

/**
 * Generic EVM explorer ("ChainExplorerProvider"). Etherscan-like only → EVM
 * chains. Self-disables (health=disabled) when ETHERSCAN_API_KEY is absent: no
 * mock fallback, ever. Flare is intentionally NOT here — it is served by the
 * existing FlarescanProvider and must stay gated by FLARE_DEFI_ENABLED upstream.
 */
export class EvmExplorerProvider implements IProvider {
  readonly id = 'evm-explorer';
  readonly type: ProviderType = 'explorer';
  readonly trustLevel: TrustLevel = 'indexer_verified';
  readonly priority = 75;
  readonly capabilities = CAPS;

  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  async health(): Promise<ProviderHealth> {
    const apiKey = resolveApiKey();
    if (!apiKey) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'ETHERSCAN_API_KEY not set',
      };
    }
    const startedAt = Date.now();
    try {
      const url = `${this.baseUrl}?chainid=1&module=proxy&action=eth_blockNumber&apikey=${apiKey}`;
      const res = await fetchWithTimeout(url, HEALTH_TIMEOUT_MS);
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
    switch (capability) {
      case 'explorer.getTransactions':
      case 'explorer.discoverInteractions': {
        const { address, chainId } = (input ?? {}) as {
          address?: string;
          chainId?: number;
        };
        if (!address) throw new Error('address required');
        if (!chainId || !SUPPORTED_CHAINS[chainId]) {
          throw new Error(`unsupported_chain: ${chainId}`);
        }
        const data = await this.getTransactions(address, chainId);
        const source: SourceRecord = {
          providerId: this.id,
          providerType: this.type,
          trustLevel: this.trustLevel,
          fetchedAt: new Date().toISOString(),
          traceId: ctx.traceId ?? randomUUID(),
        };
        return { data: data as TOut, source, cached: false };
      }
      default:
        throw new Error(`unsupported_capability: ${capability}`);
    }
  }

  async getTransactions(address: string, chainId: number): Promise<NormalizedTx[]> {
    const apiKey = resolveApiKey();
    if (!apiKey) throw new Error('ETHERSCAN_API_KEY not set');
    const url = new URL(this.baseUrl);
    url.searchParams.set('chainid', String(chainId));
    url.searchParams.set('module', 'account');
    url.searchParams.set('action', 'txlist');
    url.searchParams.set('address', address);
    url.searchParams.set('page', '1');
    url.searchParams.set('offset', '100');
    url.searchParams.set('sort', 'desc');
    url.searchParams.set('apikey', apiKey);

    const res = await fetchWithTimeout(url.toString(), QUERY_TIMEOUT_MS);
    if (!res.ok) throw new Error(`etherscan_http_${res.status}`);
    const json = (await res.json()) as EtherscanResponse;
    if (
      json.status &&
      json.status !== '1' &&
      json.message !== 'No transactions found'
    ) {
      throw new Error(`etherscan_api_error: ${json.message ?? 'unknown'}`);
    }
    const rows = Array.isArray(json.result) ? (json.result as EtherscanTx[]) : [];
    return rows.map((t) => normalize(t, chainId)).filter((t): t is NormalizedTx => t !== null);
  }
}

function normalize(t: EtherscanTx, chainId: number): NormalizedTx | null {
  if (!t.hash) return null;
  const inputData = (t.input ?? '0x').toLowerCase();
  const methodId = (
    t.methodId ?? (inputData.length >= 10 ? inputData.slice(0, 10) : '')
  ).toLowerCase();
  return {
    hash: t.hash.toLowerCase(),
    from: (t.from ?? '').toLowerCase(),
    to: (t.to ?? '').toLowerCase(),
    blockNumber: Number(t.blockNumber ?? 0),
    timeStamp: Number(t.timeStamp ?? 0),
    methodId,
    value: t.value ?? '0',
    isError: t.isError === '1',
    chainId,
  };
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

export const EVM_EXPLORER_SUPPORTED_CHAINS = SUPPORTED_CHAINS;

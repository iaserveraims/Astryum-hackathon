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
  'chain.getBalance',
  'chain.getBlockNumber',
  'chain.getCode',
  'chain.call',
  'chain.getLogs',
  'chain.getTransaction',
]);

// QuickNode is a general EVM fallback — does not handle Flare (14).
// Use when Alchemy is down or for chains Alchemy doesn't support well.
const SUPPORTED_CHAINS = new Set([1, 56, 137, 42161, 8453, 10, 43114]);

function quickNodeUrl(): string {
  const endpoint = process.env.QUICKNODE_ENDPOINT;
  if (!endpoint) throw new Error('QUICKNODE_ENDPOINT not set');
  return endpoint;
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(quickNodeUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`QuickNode HTTP ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`QuickNode RPC error: ${body.error.message}`);
  return body.result;
}

/**
 * QuickNodeRpcProvider — fallback read-only EVM chain access via QuickNode.
 * Acts as fallback when AlchemyRpcProvider is unavailable.
 * Lower priority (75) than Alchemy (90) so ProviderRouter prefers Alchemy.
 * BROADCAST_FORBIDDEN: any attempt to call sendTransaction throws immediately.
 */
export class QuickNodeRpcProvider implements IProvider {
  readonly id = 'quicknode-rpc';
  readonly type: ProviderType = 'chain';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 75;
  readonly capabilities = CAPS;

  supportsChain(chainId: number): boolean {
    return SUPPORTED_CHAINS.has(chainId);
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      await rpcCall('eth_blockNumber', []);
      const latencyMs = Date.now() - startedAt;
      return { status: 'healthy' as HealthStatus, latencyMs, lastCheckAt: new Date().toISOString() };
    } catch (err) {
      return { status: 'down', lastCheckAt: new Date().toISOString(), reason: String(err) };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    if (
      capability === 'chain.sendTransaction' ||
      capability === 'chain.broadcastTransaction' ||
      capability === 'chain.sendRawTransaction'
    ) {
      throw new Error(
        'BROADCAST_FORBIDDEN: QuickNodeRpcProvider is read-only. Astryum never broadcasts. See CLAUDE.md §0.',
      );
    }

    const inp = input as Record<string, unknown>;
    const source = this._source(ctx.traceId);

    switch (capability) {
      case 'chain.getBlockNumber': {
        const result = await rpcCall('eth_blockNumber', []);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getBalance': {
        const result = await rpcCall('eth_getBalance', [inp.address, 'latest']);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getCode': {
        const result = await rpcCall('eth_getCode', [inp.address, 'latest']);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.call': {
        const result = await rpcCall('eth_call', [inp.tx, 'latest']);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getLogs': {
        const result = await rpcCall('eth_getLogs', [inp.filter]);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getTransaction': {
        const result = await rpcCall('eth_getTransactionByHash', [inp.txHash]);
        return { data: result as TOut, source, cached: false };
      }
      default:
        throw new Error(`QuickNodeRpcProvider: unknown capability ${capability}`);
    }
  }

  private _source(traceId: string): SourceRecord {
    return {
      providerId: this.id,
      providerType: 'chain',
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
    };
  }
}

export const quickNodeRpcProvider = new QuickNodeRpcProvider();

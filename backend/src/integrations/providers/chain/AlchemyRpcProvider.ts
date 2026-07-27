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
  'chain.getTokenBalances',
]);

// Chains supported by Alchemy. Flare (14) is NOT listed — FlareRpcProvider owns chainId=14.
const SUPPORTED_CHAINS = new Set([1, 56, 137, 42161, 8453, 10, 43114]);

const ALCHEMY_CHAIN_SLUGS: Record<number, string> = {
  1: 'eth-mainnet',
  56: 'bnb-mainnet',
  137: 'polygon-mainnet',
  42161: 'arb-mainnet',
  8453: 'base-mainnet',
  10: 'opt-mainnet',
  43114: 'avax-mainnet',
};

function alchemyUrl(chainId: number): string {
  const apiKey = process.env.ALCHEMY_API_KEY;
  if (!apiKey) throw new Error('ALCHEMY_API_KEY not set');
  const slug = ALCHEMY_CHAIN_SLUGS[chainId];
  if (!slug) throw new Error(`AlchemyRpcProvider: unsupported chainId ${chainId}`);
  return `https://${slug}.g.alchemy.com/v2/${apiKey}`;
}

async function rpcCall(chainId: number, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(alchemyUrl(chainId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Alchemy HTTP ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`Alchemy RPC error: ${body.error.message}`);
  return body.result;
}

/**
 * AlchemyRpcProvider — read-only EVM chain access via Alchemy.
 * Supports ETH, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche.
 * Does NOT support Flare (chainId=14) — FlareRpcProvider handles that.
 * BROADCAST_FORBIDDEN: any attempt to call sendTransaction throws immediately.
 */
export class AlchemyRpcProvider implements IProvider {
  readonly id = 'alchemy-rpc';
  readonly type: ProviderType = 'chain';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 90;
  readonly capabilities = CAPS;

  supportsChain(chainId: number): boolean {
    return SUPPORTED_CHAINS.has(chainId);
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const result = await rpcCall(1, 'eth_blockNumber', []);
      const latencyMs = Date.now() - startedAt;
      const status: HealthStatus = result ? 'healthy' : 'degraded';
      return { status, latencyMs, lastCheckAt: new Date().toISOString() };
    } catch (err) {
      return { status: 'down', lastCheckAt: new Date().toISOString(), reason: String(err) };
    }
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    // Compile-time + runtime guard: Astryum never broadcasts via this provider.
    if (
      capability === 'chain.sendTransaction' ||
      capability === 'chain.broadcastTransaction' ||
      capability === 'chain.sendRawTransaction'
    ) {
      throw new Error(
        'BROADCAST_FORBIDDEN: AlchemyRpcProvider is read-only. Astryum never broadcasts. See CLAUDE.md §0.',
      );
    }

    const inp = input as Record<string, unknown>;
    const chainId = inp.chainId as number | undefined;
    if (!chainId || !this.supportsChain(chainId)) {
      throw new Error(`AlchemyRpcProvider: unsupported chainId ${chainId}`);
    }

    const source = this._source(ctx.traceId, chainId);

    switch (capability) {
      case 'chain.getBlockNumber': {
        const result = await rpcCall(chainId, 'eth_blockNumber', []);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getBalance': {
        const result = await rpcCall(chainId, 'eth_getBalance', [inp.address, 'latest']);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getCode': {
        const result = await rpcCall(chainId, 'eth_getCode', [inp.address, 'latest']);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.call': {
        const result = await rpcCall(chainId, 'eth_call', [inp.tx, 'latest']);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getLogs': {
        const result = await rpcCall(chainId, 'eth_getLogs', [inp.filter]);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getTransaction': {
        const result = await rpcCall(chainId, 'eth_getTransactionByHash', [inp.txHash]);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getTokenBalances': {
        // Alchemy-specific: alchemy_getTokenBalances
        const result = await rpcCall(chainId, 'alchemy_getTokenBalances', [inp.address]);
        return { data: result as TOut, source, cached: false };
      }
      default:
        throw new Error(`AlchemyRpcProvider: unknown capability ${capability}`);
    }
  }

  private _source(traceId: string, chainId: number): SourceRecord {
    return {
      providerId: this.id,
      providerType: 'chain',
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
      chainId,
    } as SourceRecord & { chainId: number };
  }
}

export const alchemyRpcProvider = new AlchemyRpcProvider();

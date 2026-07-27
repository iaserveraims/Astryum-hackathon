import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
  HealthStatus,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../../canonical/types/Source';

// Solana mainnet chainId (not EVM — using Solana's CAIP-2 convention: "solana:mainnet")
// For routing purposes we use the string identifier, not an EVM chainId.
export const SOLANA_CHAIN_ID = 'solana:mainnet';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'chain.getBalance',
  'chain.getBlockNumber',
  'chain.getTransaction',
  'chain.getTokenBalances',
  'chain.call',
]);

function heliusUrl(): string {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY not set');
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(heliusUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Helius HTTP ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`Helius RPC error: ${body.error.message}`);
  return body.result;
}

/**
 * HeliusRpcProvider — read-only Solana chain access via Helius.
 * Solana only. Does NOT support EVM chains.
 * BROADCAST_FORBIDDEN: any attempt to call sendTransaction throws immediately.
 */
export class HeliusRpcProvider implements IProvider {
  readonly id = 'helius-rpc';
  readonly type: ProviderType = 'chain';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 88;
  readonly capabilities = CAPS;

  supportsChain(chainId: number | string): boolean {
    return chainId === SOLANA_CHAIN_ID;
  }

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      await rpcCall('getSlot', []);
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
        'BROADCAST_FORBIDDEN: HeliusRpcProvider is read-only. Astryum never broadcasts. See CLAUDE.md §0.',
      );
    }

    const inp = input as Record<string, unknown>;
    const source = this._source(ctx.traceId);

    switch (capability) {
      case 'chain.getBlockNumber': {
        const result = await rpcCall('getSlot', []);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getBalance': {
        const result = await rpcCall('getBalance', [inp.address]);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getTransaction': {
        const result = await rpcCall('getTransaction', [inp.txHash, { encoding: 'json' }]);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.getTokenBalances': {
        // Helius-enhanced: getTokenAccountsByOwner
        const result = await rpcCall('getTokenAccountsByOwner', [
          inp.address,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' },
        ]);
        return { data: result as TOut, source, cached: false };
      }
      case 'chain.call': {
        // Solana doesn't have eth_call — simulate a transaction instead
        const result = await rpcCall('simulateTransaction', [inp.transaction]);
        return { data: result as TOut, source, cached: false };
      }
      default:
        throw new Error(`HeliusRpcProvider: unknown capability ${capability}`);
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

export const heliusRpcProvider = new HeliusRpcProvider();

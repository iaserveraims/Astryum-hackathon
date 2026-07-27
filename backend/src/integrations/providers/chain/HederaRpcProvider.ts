/**
 * HederaRpcProvider — P15
 *
 * Read-only EVM access to Hedera (chainId 296) via the public HashIO JSON-RPC relay.
 * No API key required. HashIO is the official Hedera JSON-RPC relay by Hashgraph.
 *
 * Endpoint: https://mainnet.hashio.io/api
 * Explorer: https://hashscan.io
 *
 * Hedera is EVM-compatible (uses same eth_* methods) but has HBAR as native currency
 * with 8 decimals (not 18). Gas prices are in tinybars.
 *
 * BROADCAST_FORBIDDEN — Astryum never signs or broadcasts.
 */

import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../../canonical/types/Source';

const HEDERA_CHAIN_ID = 296;
const HEDERA_RPC_URL = 'https://mainnet.hashio.io/api';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'chain.getBalance',
  'chain.getBlockNumber',
  'chain.getCode',
  'chain.call',
  'chain.getLogs',
  'chain.getTransaction',
]);

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(HEDERA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HederaRpc HTTP ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`HederaRpc error: ${body.error.message}`);
  return body.result;
}

export class HederaRpcProvider implements IProvider {
  readonly id = 'hedera-rpc';
  readonly type: ProviderType = 'chain';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 70;
  readonly capabilities = CAPS;

  supportsChain(chainId: number): boolean {
    return chainId === HEDERA_CHAIN_ID;
  }

  async health(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const result = await rpcCall('eth_blockNumber', []);
      const latencyMs = Date.now() - start;
      return {
        status: result ? 'healthy' : 'degraded',
        latencyMs,
        lastCheckAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        status: 'down',
        lastCheckAt: new Date().toISOString(),
        reason: err?.message ?? String(err),
      };
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
      throw new Error('BROADCAST_FORBIDDEN: HederaRpcProvider is read-only. Astryum never broadcasts.');
    }

    const inp = input as Record<string, unknown>;

    if (inp.chainId !== undefined && inp.chainId !== HEDERA_CHAIN_ID) {
      throw new Error(`HederaRpcProvider: only handles chainId ${HEDERA_CHAIN_ID}, got ${inp.chainId}`);
    }

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
        throw new Error(`HederaRpcProvider: unknown capability '${capability}'`);
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

export const hederaRpcProvider = new HederaRpcProvider();

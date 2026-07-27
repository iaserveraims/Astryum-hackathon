/**
 * XdcRpcProvider — P15
 *
 * Read-only EVM access to XDC Network (chainId 50) via the public erpc.xinfin.network endpoint.
 * No API key required. XDC is a fully EVM-compatible chain (XinFin fork of Ethereum).
 *
 * Endpoint: https://erpc.xinfin.network
 * Explorer: https://xdcscan.io
 * Native currency: XDC (18 decimals)
 *
 * Note: XDC uses the same eth_* methods as Ethereum. Addresses may appear with
 * "xdc" prefix in some wallets instead of "0x" — both forms are valid.
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

const XDC_CHAIN_ID = 50;
const XDC_RPC_URL = 'https://erpc.xinfin.network';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'chain.getBalance',
  'chain.getBlockNumber',
  'chain.getCode',
  'chain.call',
  'chain.getLogs',
  'chain.getTransaction',
]);

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(XDC_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`XdcRpc HTTP ${res.status}`);
  const body = await res.json() as { result?: unknown; error?: { message: string } };
  if (body.error) throw new Error(`XdcRpc error: ${body.error.message}`);
  return body.result;
}

export class XdcRpcProvider implements IProvider {
  readonly id = 'xdc-rpc';
  readonly type: ProviderType = 'chain';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 70;
  readonly capabilities = CAPS;

  supportsChain(chainId: number): boolean {
    return chainId === XDC_CHAIN_ID;
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
      throw new Error('BROADCAST_FORBIDDEN: XdcRpcProvider is read-only. Astryum never broadcasts.');
    }

    const inp = input as Record<string, unknown>;

    if (inp.chainId !== undefined && inp.chainId !== XDC_CHAIN_ID) {
      throw new Error(`XdcRpcProvider: only handles chainId ${XDC_CHAIN_ID}, got ${inp.chainId}`);
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
        throw new Error(`XdcRpcProvider: unknown capability '${capability}'`);
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

export const xdcRpcProvider = new XdcRpcProvider();

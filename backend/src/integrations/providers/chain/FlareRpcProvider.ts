import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
  HealthStatus,
} from '../../interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../../canonical/types/Source';
import { FlareProvider } from '../../../services/FlareProvider';

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'chain.getBalance',
  'chain.getBlockNumber',
  'chain.getCode',
  'chain.call',
  'chain.getLogs',
  'chain.getTransaction',
]);

/**
 * Wraps the V1 FlareProvider singleton as a V1.1 chain provider.
 * Capabilities map 1:1 to ethers JsonRpcProvider methods so the Router can
 * fan-out from canonical calls without anyone touching ethers directly.
 */
export class FlareRpcProvider implements IProvider {
  readonly id = 'flare-rpc';
  readonly type: ProviderType = 'chain';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 100;
  readonly capabilities = CAPS;

  constructor(private readonly flare: FlareProvider = FlareProvider.getInstance()) {}

  async health(): Promise<ProviderHealth> {
    const startedAt = Date.now();
    try {
      const block = await this.flare.getBlockNumber();
      const latencyMs = Date.now() - startedAt;
      const status: HealthStatus = block > 0 ? 'healthy' : 'degraded';
      return {
        status,
        latencyMs,
        lastCheckAt: new Date().toISOString(),
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
    const provider = this.flare.getProvider();
    let data: unknown;
    switch (capability) {
      case 'chain.getBlockNumber': {
        data = await provider.getBlockNumber();
        break;
      }
      case 'chain.getBalance': {
        const { address } = input as { address: string };
        if (!address) throw new Error('address required');
        const wei = await provider.getBalance(address);
        data = wei.toString();
        break;
      }
      case 'chain.getCode': {
        const { address } = input as { address: string };
        if (!address) throw new Error('address required');
        data = await provider.getCode(address);
        break;
      }
      case 'chain.call': {
        const tx = input as ethers.TransactionRequest;
        data = await provider.call(tx);
        break;
      }
      case 'chain.getLogs': {
        data = await provider.getLogs(input as ethers.Filter);
        break;
      }
      case 'chain.getTransaction': {
        const { hash } = input as { hash: string };
        if (!hash) throw new Error('hash required');
        data = await provider.getTransaction(hash);
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
}

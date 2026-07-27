import { randomUUID } from 'crypto';
import type {
  Capability,
  ProviderCallContext,
  ProviderCallResult,
  ProviderHealth,
} from '../../interfaces/IProvider';
import type {
  ProviderType,
  TrustLevel,
  SourceRecord,
} from '../../../canonical/types/Source';
import type { CanonicalPosition } from '../../../canonical/types/Position';
import type { ControlPlane } from '../../../control-plane/ControlPlane';
import { getProtocolAddresses } from '../../../config/protocolAddresses';

const CAPABILITIES: ReadonlyArray<Capability> = Object.freeze([
  'fasset.getFxrpExposure',
  'fasset.getFxrpStats',
  'protocol.discoverPositions',
]);

const FLARE_CHAIN_ID = 14;
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

/**
 * V1.1 read-only provider for FXRP exposure on Flare. Combines the FXRP token
 * balance (via `chain.getBalance` / ERC20.balanceOf through the chain
 * provider) with the FTSO XRP price to emit a `CanonicalPosition` of kind
 * `free`.
 *
 * Health is `disabled` until `FXRP_TOKEN` env is set; once configured, health
 * follows the chain provider's health.
 */
export class FxrpMonitorProvider {
  readonly id = 'fxrp-monitor';
  readonly type: ProviderType = 'fasset';
  readonly trustLevel: TrustLevel = 'onchain_verified';
  readonly priority = 90;
  readonly capabilities = CAPABILITIES;

  constructor(private readonly cpInjected?: ControlPlane) {}

  /** Lazy resolve to break the bootstrap → FxrpMonitor → ControlPlane cycle. */
  private get cp(): ControlPlane {
    if (this.cpInjected) return this.cpInjected;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../../../control-plane/ControlPlane').controlPlane as ControlPlane;
  }

  private get fxrpAddress(): string | undefined {
    return getProtocolAddresses().fxrp.token;
  }

  async health(): Promise<ProviderHealth> {
    if (!this.fxrpAddress) {
      return {
        status: 'disabled',
        lastCheckAt: new Date().toISOString(),
        reason: 'FXRP_TOKEN env not set',
      };
    }
    return { status: 'healthy', lastCheckAt: new Date().toISOString() };
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    const wallet = String((input as { wallet?: string }).wallet ?? ctx.wallet ?? '');
    if (!wallet) throw new Error('wallet required');

    if (
      capability === 'fasset.getFxrpExposure' ||
      capability === 'protocol.discoverPositions'
    ) {
      const r = await this.getExposure(wallet, ctx);
      return r as unknown as ProviderCallResult<TOut>;
    }
    if (capability === 'fasset.getFxrpStats') {
      const r = await this.getStats(wallet, ctx);
      return r as unknown as ProviderCallResult<TOut>;
    }
    throw new Error(`unsupported_capability: ${capability}`);
  }

  async getExposure(
    wallet: string,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<CanonicalPosition[]>> {
    const source = this.makeSource(ctx);
    const fxrp = this.fxrpAddress;
    if (!fxrp) return { data: [], source, cached: false };

    let balance = 0n;
    try {
      const r = await this.cp.call<
        { to: string; data: string },
        string
      >(
        'chain.call',
        { to: fxrp, data: ERC20_BALANCE_OF_SELECTOR + wallet.slice(2).padStart(64, '0') },
        { traceId: ctx.traceId ?? randomUUID() },
      );
      if (r.data && typeof r.data === 'string' && r.data.startsWith('0x')) {
        balance = BigInt(r.data);
      }
    } catch (err) {
      console.warn(`[fxrp-monitor] chain.call failed: ${(err as Error).message}`);
      return { data: [], source, cached: false };
    }

    if (balance === 0n) return { data: [], source, cached: false };

    let priceUSD: number | null = null;
    try {
      const r = await this.cp.call<{ symbol: string }, { price: number }>(
        'oracle.getPrice',
        { symbol: 'XRP' },
        { traceId: ctx.traceId ?? randomUUID() },
      );
      priceUSD = (r.data as { price?: number })?.price ?? null;
    } catch {
      priceUSD = null;
    }

    const decimals = 6; // FAssets FXRP follows XRP's drops convention
    const amountUSD =
      priceUSD !== null ? Number((balance * 10n ** 18n) / 10n ** BigInt(decimals)) / 1e18 * priceUSD : 0;

    const position: CanonicalPosition = {
      id: `fxrp-monitor:${wallet}:0`,
      wallet,
      chainId: FLARE_CHAIN_ID,
      protocol: 'fxrp',
      kind: 'free',
      assets: [
        {
          asset: {
            symbol: 'FXRP',
            address: fxrp,
            chainId: FLARE_CHAIN_ID,
            decimals,
            priceUSD,
            source,
          },
          amount: balance.toString(),
          amountUSD,
        },
      ],
      metrics: {},
      source,
    };
    return { data: [position], source, cached: false };
  }

  async getStats(
    wallet: string,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<{ wallet: string; fxrpBalance: string; underlyingXrpPriceUSD: number | null; fxrpAddress: string | null }>> {
    const exposure = await this.getExposure(wallet, ctx);
    const pos = exposure.data[0];
    return {
      data: {
        wallet,
        fxrpBalance: pos?.assets[0]?.amount ?? '0',
        underlyingXrpPriceUSD: pos?.assets[0]?.asset.priceUSD ?? null,
        fxrpAddress: this.fxrpAddress ?? null,
      },
      source: exposure.source,
      cached: false,
    };
  }

  private makeSource(ctx: ProviderCallContext): SourceRecord {
    return {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId ?? randomUUID(),
    };
  }
}

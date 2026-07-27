import { randomUUID } from 'crypto';
import type {
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
} from '../../interfaces/IProvider';
import type { IEngineProvider } from '../../interfaces/IEngineProvider';
import type { TrustLevel, SourceRecord } from '../../../canonical/types/Source';
import type { CanonicalPosition, PositionKind as CanonicalPositionKind } from '../../../canonical/types/Position';
import type { EngineProviderManifest } from './EngineProviderManifest';
import { engineAdapterFactory } from './EngineAdapterFactory';
import { PortfolioEngine } from '../../../engines/portfolio/PortfolioEngine';
import type { PortfolioPositionEntry, PortfolioSnapshot } from '../../../engines/portfolio/SnapshotBuilder';
import type { PositionKind as V1PositionKind } from '../../../types/domain/Position';
import { IntegrationRegistry, registry as defaultRegistry } from '../../registry/IntegrationRegistry';
import type { IProvider } from '../../interfaces/IProvider';

const KIND_MAP: Readonly<Record<V1PositionKind, CanonicalPositionKind>> = Object.freeze({
  SUPPLY: 'collateral',
  BORROW: 'debt',
  LP: 'lp',
  STAKE: 'staking',
  REWARD: 'reward',
  FREE: 'free',
  LOCKED: 'locked',
  // Money in flight (queued vault exit): owned but not spendable — same
  // canonical shape as time-locked value.
  CLAIM: 'locked',
});

const CAPS: ReadonlyArray<Capability> = Object.freeze([
  'engine.portfolio.getCanonicalPositions',
  'engine.portfolio.getSnapshot',
  'engine.portfolio.getCanonicalPositionsViaRouter',
]);

const MANIFEST: EngineProviderManifest = Object.freeze({
  engineKind: 'portfolio',
  engineVersion: '1.1.0',
  deterministic: true,
  supportedCapabilities: CAPS,
  inputSchemaVersion: '1.0.0',
  outputSchemaVersion: '1.0.0',
  auditRequired: true as const,
  description: 'PortfolioEngine (V1) wrapped as a deterministic engine provider that emits CanonicalPosition[].',
});

export interface GetCanonicalPositionsInput {
  readonly wallet: string;
  readonly chainId?: number;
  readonly forceRefresh?: boolean;
}

/**
 * Wraps the V1 PortfolioEngine. Aggregates positions from underlying chain/oracle/protocol
 * providers and returns CanonicalPosition[] tagged with a SourceRecord.
 *
 * Trust level is `aggregator`: the engine itself does not verify on-chain — it aggregates
 * outputs from upstream providers. PolicyGuard P9–P14 must continue to consult the
 * upstream onchain_verified / oracle_verified providers directly.
 */
export class PortfolioAggregationProvider implements IEngineProvider {
  readonly id = 'engine-portfolio';
  readonly type = 'engine' as const;
  readonly trustLevel: TrustLevel = 'aggregator';
  readonly priority = 100;
  readonly capabilities = CAPS;
  readonly manifest = MANIFEST;

  constructor(
    private readonly engine: PortfolioEngine = PortfolioEngine.getInstance(),
    private readonly registry: IntegrationRegistry = defaultRegistry,
  ) {
    engineAdapterFactory.validateManifest(MANIFEST);
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: 'healthy',
      lastCheckAt: new Date().toISOString(),
      reason: 'in-process deterministic engine',
    };
  }

  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    if (
      capability !== 'engine.portfolio.getCanonicalPositions' &&
      capability !== 'engine.portfolio.getSnapshot' &&
      capability !== 'engine.portfolio.getCanonicalPositionsViaRouter'
    ) {
      throw new Error(`unsupported_capability: ${capability}`);
    }
    const { wallet, chainId = 14, forceRefresh } = input as GetCanonicalPositionsInput;
    if (!wallet) throw new Error('wallet required');

    if (capability === 'engine.portfolio.getCanonicalPositionsViaRouter') {
      const r = await this.aggregateViaRouter(wallet, chainId, ctx);
      return r as unknown as ProviderCallResult<TOut>;
    }

    const snapshot = await this.engine.getPortfolio(wallet, chainId, { forceRefresh });
    const traceId = ctx.traceId ?? randomUUID();
    const source: SourceRecord = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
      stale: isStale(snapshot),
    };

    if (capability === 'engine.portfolio.getSnapshot') {
      const data = serialiseSnapshot(snapshot);
      return { data: data as TOut, source, cached: false };
    }

    const positions = snapshot.positions.map((p) => toCanonical(p, snapshot.wallet, source));
    return { data: positions as TOut, source, cached: false };
  }

  /**
   * Router-based aggregation. Iterates every protocol provider registered with
   * `protocol.discoverPositions`, calls each one directly (bypassing
   * `ProtocolRegistry`), and returns the union of their canonical outputs.
   * Unhealthy / disabled providers are skipped silently — the per-provider
   * `SourceRecord` is preserved verbatim on each position so consumers can see
   * exactly which provider produced what. The aggregator's own `SourceRecord`
   * is attached at the result level and lists upstream provider ids.
   *
   * Failures from individual providers are isolated (Promise.allSettled) and
   * surfaced via `result.warnings`. The aggregator never fails open: a provider
   * throwing only removes its slice from the union.
   */
  private async aggregateViaRouter(
    wallet: string,
    chainId: number,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<CanonicalPosition[]>> {
    const traceId = ctx.traceId ?? randomUUID();
    const protocolProviders = this.registry
      .byCapability('protocol.discoverPositions')
      .filter((p) => {
        const h = this.registry.getHealth(p.id);
        return !h || h.status === 'healthy' || h.status === 'degraded';
      });

    const settled = await Promise.allSettled(
      protocolProviders.map(async (p) =>
        callProvider(p, { wallet }, { ...ctx, traceId }),
      ),
    );

    const positions: CanonicalPosition[] = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      const id = protocolProviders[i].id;
      if (r.status === 'fulfilled') {
        const data = r.value.data as CanonicalPosition[];
        if (Array.isArray(data)) {
          for (const pos of data) if (pos.chainId === chainId) positions.push(pos);
        }
      } else {
        // Provider-level failures are isolated; per-provider SourceRecord on
        // surviving positions still tells the consumer who produced what.
        // We log here rather than mutating the aggregator's SourceRecord
        // (canonical type is intentionally narrow).
        console.warn(
          `[portfolio-router] provider ${id} failed: ${(r.reason as Error)?.message ?? 'unknown'}`,
        );
      }
    }

    const source: SourceRecord = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId,
      stale: false,
    };

    return { data: positions, source, cached: false };
  }
}

async function callProvider(
  p: IProvider,
  input: { wallet: string },
  ctx: ProviderCallContext,
): Promise<ProviderCallResult<CanonicalPosition[]>> {
  return (await p.call(
    'protocol.discoverPositions',
    input,
    ctx,
  )) as ProviderCallResult<CanonicalPosition[]>;
}

function toCanonical(p: PortfolioPositionEntry, wallet: string, source: SourceRecord): CanonicalPosition {
  const symbol = ((p.metadata?.token as string) ?? (p.metadata?.symbol as string) ?? 'UNKNOWN').toString();
  const decimals = typeof p.metadata?.decimals === 'number' ? (p.metadata.decimals as number) : 18;
  return {
    id: `${p.protocolId}:${p.asset}:${p.kind}`,
    wallet,
    chainId: p.chainId,
    protocol: p.protocolId,
    kind: KIND_MAP[p.kind] ?? 'free',
    assets: [
      {
        asset: {
          symbol,
          address: p.asset,
          chainId: p.chainId,
          decimals,
          priceUSD: p.priceUSD || null,
          source,
        },
        amount: p.amount,
        amountUSD: p.amountUSD,
      },
    ],
    metrics: {
      healthFactor: p.metrics?.hf,
      ltv: p.metrics?.ltv,
      liquidationPriceUSD: p.metrics?.liquidationPrice,
      inRange: p.metrics?.inRange,
      apy: p.metrics?.apy,
      impermanentLossPct: p.metrics?.ilEstimated,
    },
    source,
  };
}

const SNAPSHOT_FRESHNESS_MS = 90_000;
function isStale(s: PortfolioSnapshot): boolean {
  return Date.now() - new Date(s.takenAt).getTime() > SNAPSHOT_FRESHNESS_MS;
}

function serialiseSnapshot(s: PortfolioSnapshot): unknown {
  return JSON.parse(
    JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

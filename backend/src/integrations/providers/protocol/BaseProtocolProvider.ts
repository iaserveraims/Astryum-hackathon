import { randomUUID } from 'crypto';
import type {
  Capability,
  ProviderCallContext,
  ProviderCallResult,
  ProviderHealth,
} from '../../interfaces/IProvider';
import type { IProtocolProvider } from '../../interfaces/IProtocolProvider';
import type { IProtocolAdapter } from '../../../connectors/protocols/IProtocolAdapter';
import type { CanonicalPosition } from '../../../canonical/types/Position';
import type { CanonicalAction } from '../../../canonical/types/Action';
import type {
  CanonicalIntent,
  SimulationResult as CanonicalSimulationResult,
} from '../../../canonical/types/Intent';
import type {
  ProviderType,
  TrustLevel,
  SourceRecord,
} from '../../../canonical/types/Source';
import type { ProtocolAction, ProtocolActionKind } from '../../../types/domain/Protocol';
import {
  adapterIntentToCanonical,
  adapterSimulationToCanonical,
  normalizedPositionToCanonical,
} from './canonicalMapper';

const PROTOCOL_CAPABILITIES: ReadonlyArray<Capability> = Object.freeze([
  'protocol.discoverPositions',
  'protocol.simulateAction',
  'protocol.prepareIntent',
  'protocol.getMetrics',
]);

export interface BaseProtocolProviderOpts {
  readonly id: string;
  readonly trustLevel?: TrustLevel;
  readonly priority?: number;
  readonly extraCapabilities?: ReadonlyArray<Capability>;
}

/**
 * Wraps a V1 `IProtocolAdapter` as a V1.1 `IProtocolProvider`.
 *
 * The V1 adapter's logic (calldata building, simulation) is preserved verbatim;
 * this layer only translates inputs/outputs to canonical types and stamps a
 * `SourceRecord` so ControlPlane/AuditLayer can trace every result.
 */
export abstract class BaseProtocolProvider implements IProtocolProvider {
  readonly type: 'protocol' = 'protocol';
  readonly id: string;
  readonly trustLevel: TrustLevel;
  readonly priority: number;
  readonly capabilities: ReadonlyArray<Capability>;

  protected constructor(
    protected readonly adapter: IProtocolAdapter,
    opts: BaseProtocolProviderOpts,
  ) {
    this.id = opts.id;
    this.trustLevel = opts.trustLevel ?? 'protocol_native';
    this.priority = opts.priority ?? 80;
    this.capabilities = Object.freeze([
      ...PROTOCOL_CAPABILITIES,
      ...(opts.extraCapabilities ?? []),
    ]);
  }

  async health(): Promise<ProviderHealth> {
    return {
      status: this.adapter.isActive ? 'healthy' : 'disabled',
      lastCheckAt: new Date().toISOString(),
      reason: this.adapter.isActive ? undefined : 'adapter inactive',
    };
  }

  /**
   * Generic dispatch. ControlPlane.call(capability, input, ctx) lands here.
   * Each capability has a concrete sibling method below for direct typing.
   */
  async call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    switch (capability) {
      case 'protocol.discoverPositions': {
        const wallet = String((input as { wallet?: string }).wallet ?? ctx.wallet ?? '');
        if (!wallet) throw new Error('wallet required');
        const r = await this.discoverPositions(wallet, ctx);
        return r as unknown as ProviderCallResult<TOut>;
      }
      case 'protocol.simulateAction': {
        const r = await this.simulateAction(input as unknown as CanonicalAction, ctx);
        return r as unknown as ProviderCallResult<TOut>;
      }
      case 'protocol.prepareIntent': {
        const r = await this.prepareIntent(input as unknown as CanonicalAction, ctx);
        return r as unknown as ProviderCallResult<TOut>;
      }
      case 'protocol.getMetrics': {
        const wallet = String((input as { wallet?: string }).wallet ?? ctx.wallet ?? '');
        if (!wallet) throw new Error('wallet required');
        const r = await this.getMetrics(wallet, ctx);
        return r as unknown as ProviderCallResult<TOut>;
      }
      default:
        throw new Error(`unsupported_capability: ${capability}`);
    }
  }

  async discoverPositions(
    wallet: string,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<CanonicalPosition[]>> {
    const source = this.makeSource(ctx);
    const raw = await this.adapter.discoverPositions(wallet);
    const data = raw.map((r, i) =>
      normalizedPositionToCanonical(
        this.adapter.normalizePosition(r),
        source,
        `${this.id}:${wallet}:${i}`,
      ),
    );
    return { data, source, cached: false };
  }

  async simulateAction(
    action: CanonicalAction,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<CanonicalSimulationResult>> {
    const source = this.makeSource(ctx);
    const v1Action: ProtocolAction = {
      kind: action.type as ProtocolActionKind,
      protocolId: action.targetProtocol,
      chainId: action.targetChain,
      wallet: ctx.wallet ?? '',
      inputs: deserializeInputs(action.params),
    };
    const result = await this.adapter.simulateAction(v1Action);
    return {
      data: adapterSimulationToCanonical(result),
      source,
      cached: false,
    };
  }

  async prepareIntent(
    action: CanonicalAction,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<CanonicalIntent>> {
    if (!ctx.wallet) throw new Error('wallet required');
    if (!ctx.sessionId) throw new Error('sessionId required');
    const source = this.makeSource(ctx);
    const v1Action: ProtocolAction = {
      kind: action.type as ProtocolActionKind,
      protocolId: action.targetProtocol,
      chainId: action.targetChain,
      wallet: ctx.wallet,
      inputs: deserializeInputs(action.params),
    };
    const v1Intent = await this.adapter.buildTransactionIntent(v1Action, {
      owner: ctx.wallet,
      sessionId: ctx.sessionId,
      priceSnapshot: { takenAt: new Date(), prices: {} },
    });
    return {
      data: adapterIntentToCanonical(v1Intent, source),
      source,
      cached: false,
    };
  }

  /**
   * Per-position metrics for a wallet. Iterates raw → normalized → metrics
   * via the V1 adapter; output keyed by canonical position id.
   */
  async getMetrics(
    wallet: string,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<Record<string, unknown>>> {
    const source = this.makeSource(ctx);
    const raw = await this.adapter.discoverPositions(wallet);
    const out: Record<string, unknown> = {};
    for (let i = 0; i < raw.length; i++) {
      const norm = this.adapter.normalizePosition(raw[i]);
      out[`${this.id}:${wallet}:${i}`] = await this.adapter.getMetrics(norm);
    }
    return { data: out, source, cached: false };
  }

  protected makeSource(ctx: ProviderCallContext): SourceRecord {
    return {
      providerId: this.id,
      providerType: this.type as ProviderType,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId ?? randomUUID(),
    };
  }
}

/**
 * Convert canonical `params` (string/number/bool) back into the shapes V1
 * adapters expect (bigint amounts, etc.). Keep tolerant — adapters validate.
 */
function deserializeInputs(params: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (
      (k === 'amount' || k === 'amountUSD' || k === 'rewardEpoch') &&
      (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint')
    ) {
      out[k] = typeof v === 'bigint' ? v : k === 'amount' ? BigInt(v as string | number) : Number(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

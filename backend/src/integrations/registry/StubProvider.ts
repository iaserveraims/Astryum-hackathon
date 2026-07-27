import type {
  IProvider,
  ProviderHealth,
  ProviderCallContext,
  ProviderCallResult,
  Capability,
  HealthStatus,
} from '../interfaces/IProvider';
import type { ProviderType, TrustLevel, SourceRecord } from '../../canonical/types/Source';
import type { ProviderConfigEntry } from './providers.config';

/**
 * Placeholder provider used until a real adapter is wired in (S2/S3/S7).
 * - call() throws PROVIDER_NOT_IMPLEMENTED so the Router can fail-over or surface the error.
 * - health() returns 'disabled' if config.enabled === false.
 * Real providers replace stubs by registering with the same id (registry rejects duplicates,
 * so the bootstrapper unregisters the stub first).
 */
export class StubProvider implements IProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly trustLevel: TrustLevel;
  readonly priority: number;
  private readonly enabled: boolean;
  private readonly reason: string;

  constructor(cfg: ProviderConfigEntry) {
    this.id = cfg.id;
    this.type = cfg.type;
    this.capabilities = cfg.capabilities;
    this.trustLevel = cfg.trustLevel;
    this.priority = cfg.priority;
    this.enabled = cfg.enabled;
    this.reason = cfg.enabled ? 'stub: real provider not yet wired' : 'disabled by config';
  }

  async health(): Promise<ProviderHealth> {
    const status: HealthStatus = this.enabled ? 'down' : 'disabled';
    return {
      status,
      lastCheckAt: new Date().toISOString(),
      reason: this.reason,
    };
  }

  async call<TIn, TOut>(
    capability: Capability,
    _input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>> {
    void _input;
    const source: SourceRecord = {
      providerId: this.id,
      providerType: this.type,
      trustLevel: this.trustLevel,
      fetchedAt: new Date().toISOString(),
      traceId: ctx.traceId,
      stale: true,
    };
    void source;
    const err = new Error(`PROVIDER_NOT_IMPLEMENTED: ${this.id} does not yet implement ${capability}`);
    (err as Error & { code?: string }).code = 'PROVIDER_NOT_IMPLEMENTED';
    throw err;
  }
}

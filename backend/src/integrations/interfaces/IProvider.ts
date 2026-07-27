import type { ProviderType, TrustLevel, SourceRecord } from '../../canonical/types/Source';

export type Capability = string;

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'disabled';

export interface ProviderHealth {
  status: HealthStatus;
  latencyMs?: number;
  lastCheckAt: string;
  reason?: string;
}

export interface ProviderCallContext {
  readonly traceId: string;
  readonly wallet?: string;
  readonly sessionId?: string;
  readonly bypassCache?: boolean;
}

export interface ProviderCallResult<T> {
  readonly data: T;
  readonly source: SourceRecord;
  readonly cached: boolean;
}

export interface IProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly trustLevel: TrustLevel;
  readonly priority: number;
  health(): Promise<ProviderHealth>;
  call<TIn, TOut>(
    capability: Capability,
    input: TIn,
    ctx: ProviderCallContext,
  ): Promise<ProviderCallResult<TOut>>;
}

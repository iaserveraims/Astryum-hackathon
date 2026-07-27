import type { EngineKind, EngineCapability } from './engineCapabilities';

export interface EngineProviderManifest {
  readonly engineKind: EngineKind;
  readonly engineVersion: string;
  readonly deterministic: boolean;
  readonly supportedCapabilities: ReadonlyArray<EngineCapability>;
  readonly inputSchemaVersion: string;
  readonly outputSchemaVersion: string;
  readonly auditRequired: true;
  readonly description?: string;
}

/**
 * Trace record persisted alongside the AuditEvent for every engine call.
 * inputHash and outputHash are sha256 hex digests of the canonicalized JSON
 * representations of the call's input and output. They make every engine
 * computation reproducible and legally auditable.
 */
export interface EngineRunRecord {
  readonly runId: string;
  readonly providerId: string;
  readonly capability: EngineCapability;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly inputSchemaVersion: string;
  readonly outputSchemaVersion: string;
  readonly engineVersion: string;
  readonly deterministic: boolean;
  readonly executedAt: string;
  readonly latencyMs: number;
}

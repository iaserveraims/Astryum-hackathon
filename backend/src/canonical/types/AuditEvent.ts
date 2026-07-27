export type AuditDecision = 'pass' | 'fail' | 'warn';

export type PolicyId =
  | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6'
  | 'P7' | 'P8' | 'P9' | 'P10' | 'P11' | 'P12'
  | 'P13' | 'P14' | 'P15' | 'P16' | 'P17' | 'P18';

export interface PolicyCheckResult {
  readonly policyId: PolicyId;
  readonly result: AuditDecision;
  readonly reason?: string;
}

export interface CanonicalAuditEvent {
  readonly traceId: string;
  readonly providerId: string;
  readonly capability: string;
  readonly decision: AuditDecision;
  readonly policyChecks: ReadonlyArray<PolicyCheckResult>;
  readonly latencyMs: number;
  readonly cached: boolean;
  readonly fellBack: boolean;
  readonly timestamp: string;
}

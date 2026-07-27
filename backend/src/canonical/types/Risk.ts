import type { SourceRecord } from './Source';

export type RiskLevel = 'safe' | 'moderate' | 'elevated' | 'critical';

export interface RiskDriver {
  readonly code: string;
  readonly message: string;
  readonly severity: number;
}

export interface CanonicalRisk {
  readonly wallet: string;
  readonly score: number;
  readonly level: RiskLevel;
  readonly drivers: ReadonlyArray<RiskDriver>;
  readonly warnings: ReadonlyArray<string>;
  readonly source: SourceRecord;
}

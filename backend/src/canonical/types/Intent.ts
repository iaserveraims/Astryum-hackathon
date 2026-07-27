import type { SourceRecord } from './Source';
import type { CanonicalAction } from './Action';

export type IntentStatus =
  | 'building'
  | 'proposed'
  | 'pending_user_review'
  | 'expired'
  | 'signed'
  | 'broadcast'
  | 'mempool'
  | 'confirmed'
  | 'failed';

export interface SimulationResult {
  readonly success: boolean;
  readonly newHF?: number;
  readonly newLTV?: number;
  readonly gasEstimate: string;
  readonly gasEstimateUSD: number;
  readonly netUSDImpact: number;
  readonly riskDelta: number;
  readonly warnings: ReadonlyArray<string>;
  readonly simulatedAt: string;
  readonly priceTimestamp: string;
  readonly isStale: boolean;
}

export interface IntentRiskDelta {
  readonly hfBefore?: number;
  readonly hfAfter?: number;
  readonly hfChange?: number;
  readonly scoreBefore: number;
  readonly scoreAfter: number;
  readonly warnings: ReadonlyArray<string>;
  readonly isDefensive: boolean;
}

export interface IntentTxData {
  readonly to: string;
  readonly data: string;
  readonly value: string;
  readonly gasLimit: string;
  readonly chainId: number;
}

export interface CanonicalIntent {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly owner: string;
  readonly sessionId: string;
  readonly action: CanonicalAction;
  readonly protocol: string;
  readonly positionId?: string;
  readonly simulation: SimulationResult;
  readonly simulatedAt: string;
  readonly pricesFreshAt: string;
  readonly riskDelta: IntentRiskDelta;
  readonly explanation: string;
  readonly warnings: ReadonlyArray<string>;
  readonly txData?: IntentTxData;
  readonly status: IntentStatus;
  readonly txHash?: string;
  readonly confirmedAt?: string;
  readonly failureReason?: string;
  readonly blockNumber?: number;
  readonly source: SourceRecord;
}

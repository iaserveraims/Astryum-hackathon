import type { SourceRecord } from './Source';
import type { CanonicalAssetExposure } from './Asset';

export type PositionKind =
  | 'free'
  | 'collateral'
  | 'debt'
  | 'lp'
  | 'staking'
  | 'reward'
  /** Time-locked value (XRPL escrow): owned but not spendable, earns nothing. */
  | 'locked';

export interface CanonicalPositionMetrics {
  readonly healthFactor?: number;
  readonly ltv?: number;
  readonly liquidationPriceUSD?: number;
  readonly inRange?: boolean;
  readonly apr?: number;
  readonly apy?: number;
  readonly impermanentLossPct?: number;
}

export interface CanonicalPosition {
  readonly id: string;
  readonly wallet: string;
  readonly chainId: number;
  readonly protocol: string;
  readonly kind: PositionKind;
  readonly assets: ReadonlyArray<CanonicalAssetExposure>;
  readonly metrics?: CanonicalPositionMetrics;
  readonly source: SourceRecord;
}

import type { SourceRecord } from './Source';
import type { CanonicalAssetExposure } from './Asset';

export type ActivityType =
  | 'swap'
  | 'supply'
  | 'borrow'
  | 'repay'
  | 'withdraw'
  | 'stake'
  | 'unstake'
  | 'claim'
  | 'transfer'
  | 'approve'
  | 'addLiquidity'
  | 'removeLiquidity'
  | 'other';

export interface CanonicalActivityEvent {
  readonly id: string;
  readonly wallet: string;
  readonly txHash: string;
  readonly blockNumber: number;
  readonly timestamp: string;
  readonly type: ActivityType;
  readonly protocol?: string;
  readonly assetIn?: CanonicalAssetExposure;
  readonly assetOut?: CanonicalAssetExposure;
  readonly source: SourceRecord;
}

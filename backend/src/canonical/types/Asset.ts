import type { SourceRecord } from './Source';

export interface CanonicalAsset {
  readonly symbol: string;
  readonly address: string;
  readonly chainId: number;
  readonly decimals: number;
  readonly priceUSD: number | null;
  readonly source: SourceRecord;
}

export interface CanonicalAssetExposure {
  readonly asset: CanonicalAsset;
  readonly amount: string;
  readonly amountUSD: number;
}

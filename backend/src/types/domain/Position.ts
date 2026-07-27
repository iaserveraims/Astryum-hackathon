export type PositionKind =
  | 'SUPPLY'
  | 'BORROW'
  | 'LP'
  | 'STAKE'
  | 'REWARD'
  | 'FREE'
  /** Time-locked value (XRPL escrow): owned but not spendable, earns nothing. */
  | 'LOCKED'
  /** Money in flight: a queued vault exit (shares burned, assets pending claim). */
  | 'CLAIM';

export interface RawPosition {
  protocolId: string;
  chainId: number;
  wallet: string;
  kind: PositionKind;
  asset: string;
  amount: bigint;
  raw: Record<string, unknown>;
  discoveredAt: Date;
}

export interface NormalizedPosition {
  protocolId: string;
  chainId: number;
  wallet: string;
  kind: PositionKind;
  asset: string;
  amount: bigint;
  amountUSD: number;
  priceUSD: number;
  metadata: Record<string, unknown>;
  takenAt: Date;
}

export interface PositionMetrics {
  hf?: number;
  ltv?: number;
  liquidationPrice?: number;
  inRange?: boolean;
  ilEstimated?: number;
  pendingRewards?: number;
  apy?: number;
  extras?: Record<string, unknown>;
}

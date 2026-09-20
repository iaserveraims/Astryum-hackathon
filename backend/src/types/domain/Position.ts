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
  /** BASE units — the ledger's integer. NEVER a number to put on a screen. */
  amount: bigint;
  /**
   * The same quantity in HUMAN units, exact (bigint arithmetic, no float).
   *
   * `amount` alone is unreadable: it needs the token's decimals, and half the
   * producers of a position (the external providers) never had base units to
   * begin with — they report human amounts and used to drop them on the floor
   * (`amount: 0n`). So the pipeline carries the human figure explicitly, and
   * a UI shows THIS. Absent only when nobody could say how many decimals the
   * asset holds: an assumed 18 over a 6-decimals token turns 10 FXRP into
   * 0.00000000001, a lie more credible than the raw integer.
   */
  qty?: string;
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

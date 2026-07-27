export type IntentAction =
  | 'repay'
  | 'addCollateral'
  | 'withdraw'
  | 'supply'
  | 'borrow'
  | 'harvest'
  | 'exitLP'
  | 'addLiquidity'
  | 'swap'
  | 'stake'
  | 'unstake'
  | 'crossChainSwap'
  | 'wrap'
  | 'unwrap'
  | 'delegate'
  | 'undelegate'
  | 'claimRewards';

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

export interface PriceSnapshot {
  takenAt: Date;
  prices: Record<string, number>;
}

export interface SimulationResult {
  success: boolean;
  newHF?: number;
  newLTV?: number;
  gasEstimate: bigint;
  gasEstimateUSD: number;
  netUSDImpact: number;
  riskDelta: number;
  warnings: string[];
  simulatedAt: Date;
  priceTimestamp: Date;
  isStale: boolean;
}

export interface RiskDelta {
  hfBefore?: number;
  hfAfter?: number;
  hfChange?: number;
  scoreBefore: number;
  scoreAfter: number;
  warnings: string[];
  isDefensive: boolean;
}

export interface IntentTxData {
  to: string;
  data: string;
  value: bigint;
  gasLimit: bigint;
  chainId: number;
}

export interface IntentInputs {
  asset?: string;
  amount?: bigint;
  amountUSD?: number;
  toAsset?: string;
  toChain?: number;
  slippageBps?: number;
  deadline?: number;
  [k: string]: unknown;
}

/** A call that MUST precede `txData` in the same signing batch (e.g. the
 *  ERC-20 approve before a repay/supply pull). Unsigned like everything else —
 *  the signing surface batches [prerequisites..., txData] for ONE user review. */
export interface IntentPrerequisiteCall {
  to: string;
  data: string;
  /** Decimal string (JSON-safe persistence). */
  value: string;
  chainId: number;
  label: string;
}

export interface IntentPreState {
  hf?: number;
  ltv?: number;
  collateralUSD?: number;
  debtUSD?: number;
  positionValueUSD?: number;
  priceSnapshot: PriceSnapshot;
  prerequisiteCalls?: IntentPrerequisiteCall[];
}

export interface IntentImpact {
  newHF?: number;
  newLTV?: number;
  newCollateralUSD?: number;
  newDebtUSD?: number;
  netUSDReceived?: number;
  gasEstimateUSD: number;
  gasEstimateNative: bigint;
  slippageActual?: number;
  priceImpact?: number;
  ilEstimated?: number;
}

export interface TransactionIntent {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  owner: string;
  sessionId: string;
  action: IntentAction;
  protocolId: string;
  positionId?: string;
  inputs: IntentInputs;
  preState: IntentPreState;
  simulation: SimulationResult;
  simulatedAt: Date;
  pricesFreshAt: Date;
  impact: IntentImpact;
  riskDelta: RiskDelta;
  explanation: string;
  warnings: string[];
  txData?: IntentTxData;
  status: IntentStatus;
  txHash?: string;
  confirmedAt?: Date;
  failureReason?: string;
  blockNumber?: number;
}

export interface IntentBuildContext {
  owner: string;
  sessionId: string;
  priceSnapshot: PriceSnapshot;
}

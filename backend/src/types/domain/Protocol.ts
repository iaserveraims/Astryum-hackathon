export type ProtocolCategory = 'LENDING' | 'DEX' | 'STAKING' | 'BRIDGE';

export interface ProtocolDescriptor {
  slug: string;
  name: string;
  category: ProtocolCategory;
  chainId: number;
  riskTier: number;
  isActive: boolean;
}

export type ProtocolActionKind =
  | 'supply'
  | 'borrow'
  | 'repay'
  | 'withdraw'
  | 'addCollateral'
  | 'addLiquidity'
  | 'exitLP'
  | 'harvest'
  | 'stake'
  | 'unstake'
  | 'swap'
  | 'wrap'
  | 'unwrap'
  | 'delegate'
  | 'undelegate'
  | 'claimRewards'
  // XRPL savings-escrow (B.1). Rule-vocabulary only: the AutomationEngine
  // notifies (no server-side prepare) and the user signs from Savings — it
  // never reaches IntentEngine/adapters, which stay EVM-only.
  | 'escrow'
  // Governed MoneyFlows (sign-at-trigger, N firmantes). Rule-vocabulary only:
  // the trigger COMPOSES a council proposal (CouncilProposalService) that the
  // QUORUM signs in the inbox — never IntentEngine, never a signature.
  | 'councilPayment'
  | 'councilOrder';

export interface ProtocolAction {
  kind: ProtocolActionKind;
  protocolId: string;
  chainId: number;
  wallet: string;
  positionId?: string;
  inputs: {
    asset?: string;
    amount?: bigint;
    toAsset?: string;
    slippageBps?: number;
    deadline?: number;
    [k: string]: unknown;
  };
}

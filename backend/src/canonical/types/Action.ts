export type ActionType =
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

export type RiskClass = 'read_only' | 'low_risk' | 'risk_increasing';

export const ACTION_RISK_CLASS: Readonly<Record<ActionType, RiskClass>> = Object.freeze({
  repay: 'low_risk',
  addCollateral: 'low_risk',
  supply: 'low_risk',
  harvest: 'low_risk',
  stake: 'low_risk',
  withdraw: 'risk_increasing',
  borrow: 'risk_increasing',
  exitLP: 'risk_increasing',
  addLiquidity: 'low_risk',
  swap: 'risk_increasing',
  unstake: 'risk_increasing',
  crossChainSwap: 'risk_increasing',
  wrap: 'low_risk',
  unwrap: 'low_risk',
  delegate: 'low_risk',
  undelegate: 'low_risk',
  claimRewards: 'low_risk',
});

export interface CanonicalAction {
  readonly type: ActionType;
  readonly targetProtocol: string;
  readonly targetChain: number;
  readonly params: Readonly<Record<string, unknown>>;
}

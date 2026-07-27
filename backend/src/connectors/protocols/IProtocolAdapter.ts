import type {
  RawPosition,
  NormalizedPosition,
  PositionMetrics,
} from '../../types/domain/Position';
import type { ProtocolAction } from '../../types/domain/Protocol';
import type {
  TransactionIntent,
  SimulationResult,
  IntentBuildContext,
} from '../../types/domain/Intent';

/**
 * Unsigned, fully-deterministic transaction the adapter builds for one action.
 * This is the ONLY thing a connector contributes to the single intent neck
 * (CalldataBuilder): the contract + calldata + value. The regulatory envelope
 * (authorization/referral/policy/anomaly/audit) is applied by the neck, not here.
 *
 * It is exactly the shape both consumers need:
 *   - manual "Entrar"            → CalldataBuilder wraps {to,calldata,value} now
 *   - moneyflow conditional intent → ConditionalIntentService.DeterministicAction
 */
export interface EncodedAction {
  to: string;        // interaction contract (e.g. the kToken market)
  calldata: string;  // 0x + selector + args, fully formed
  value: string;     // wei as decimal string ('0' for non-payable)
}

/** Inputs for encoding one protocol action. assetSymbol is preferred for market selection. */
export interface EncodeActionParams {
  /** supply | withdraw | borrow | repay | stake | unstake | add_liquidity | remove_liquidity */
  actionType: string;
  /** Amount in the asset's smallest unit, decimal string. */
  amount: string;
  userWallet: string;
  /** e.g. 'USDC.E', 'SFLR', 'FXRP' — used to pick the per-asset market (kToken). */
  assetSymbol?: string;
  /** Underlying token address — fallback when symbol is absent. */
  assetAddress?: string;
}

/**
 * Engine-facing interface for DeFi protocols.
 *
 * Narrow contract consumed by Portfolio/Risk/Execution engines.
 * Implementations live in `connectors/protocols/adapters/*`.
 */
export interface IProtocolAdapter {
  readonly protocolId: string;
  readonly chainId: number;
  readonly isActive: boolean;

  discoverPositions(wallet: string): Promise<RawPosition[]>;
  normalizePosition(raw: RawPosition): NormalizedPosition;
  getMetrics(position: NormalizedPosition): Promise<PositionMetrics>;
  simulateAction(action: ProtocolAction): Promise<SimulationResult>;
  buildTransactionIntent(
    action: ProtocolAction,
    ctx: IntentBuildContext
  ): Promise<TransactionIntent>;

  /**
   * Encode ONE action into unsigned {to, calldata, value}. Optional: adapters that
   * have not implemented calldata yet simply omit it (the neck reports the action
   * as not-yet-executable rather than guessing). This is the calldata source for
   * BOTH the manual button and moneyflow conditional intents — the full action
   * surface per (protocol, asset), not just "enter position".
   */
  encodeAction?(params: EncodeActionParams): Promise<EncodedAction>;
}

export class ProtocolInactiveError extends Error {
  readonly code = 'protocol_inactive';
  constructor(protocolId: string) {
    super(`Protocol ${protocolId} is inactive (missing addresses or disabled)`);
    this.name = 'ProtocolInactiveError';
  }
}

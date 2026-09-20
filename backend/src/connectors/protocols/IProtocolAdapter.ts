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
 * One read a discovery sweep could NOT make — named. «Could not read whether
 * this wallet holds shares in market M» is neither `0n` nor an empty list: it
 * is this record, and the surfaces paint it as «could not be read».
 */
export interface UnreadableRead {
  /** The read that did not answer: `balanceOf on market 0x…`, `withdrawalsOf(220)`. */
  what: string;
  /** The node's own error message, trimmed. */
  reason: string;
  /** The market / venue / comptroller address concerned, when there is one. */
  market?: string;
}

/**
 * What a sweep answers when it can degrade PER READ instead of per adapter:
 * the positions it did read, plus the reads it could not make. A non-empty
 * `unreadable` makes `positions` a LOWER BOUND — never a statement of absence.
 */
export interface PositionDiscovery {
  positions: RawPosition[];
  unreadable: UnreadableRead[];
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

  /**
   * All-or-nothing discovery: every position, or a throw when ANY money read
   * did not answer (an adapter never returns a list with silent holes).
   */
  discoverPositions(wallet: string): Promise<RawPosition[]>;
  /**
   * Per-read degradation (ola 0, 15-sep). One 429 among ~20 reads used to
   * take the WHOLE adapter down: the carry's FXRP supply and USDT0 debt — and
   * their Repay door — vanished from the board because the probe of an
   * unrelated market did not answer. Adapters that can tell which read fell
   * implement this; the positions route and the portfolio engine read it
   * through `discoverWithUnreadable` and serve what WAS read, naming the rest.
   * Optional: the fallback is `discoverPositions` (whole-adapter semantics).
   */
  discoverPositionsPartial?(wallet: string): Promise<PositionDiscovery>;
  /**
   * Forget whatever this adapter remembers about a wallet between sweeps
   * (2026-09-18: the LP adapters memoise which pairs a wallet holds). The
   * engine calls it on a forced refresh — after a signature — so a position
   * opened a moment ago is found by a full sweep, not by the memo.
   */
  invalidateWallet?(wallet: string): void;
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

/**
 * The ONE way the engine and the routes read an adapter: partial when the
 * adapter can name its unread reads, whole otherwise. A throw still means
 * «this adapter could not be read at all» and is the caller's to name.
 */
export async function discoverWithUnreadable(
  adapter: IProtocolAdapter,
  wallet: string,
): Promise<PositionDiscovery> {
  if (typeof adapter.discoverPositionsPartial === 'function') {
    return adapter.discoverPositionsPartial(wallet);
  }
  return { positions: await adapter.discoverPositions(wallet), unreadable: [] };
}

/** One sentence naming every unread read — for logs and for the whole-adapter throw. */
export function describeUnreadable(reads: UnreadableRead[]): string {
  return reads.map((r) => `${r.what}${r.reason ? ` (${r.reason})` : ''}`).join('; ');
}

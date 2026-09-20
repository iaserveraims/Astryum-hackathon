/**
 * ChainCapability — the HONEST matrix of what each chain's translator can
 * compile TODAY, and in which execution mode (design doc §2.3).
 *
 * Degradation rule (deterministic, audited): the translator picks the best
 * mode AVAILABLE and declares it in its result; when a flow asks for something
 * the chain does not support, translation FAILS with a readable explanation —
 * it never approximates silently.
 *
 * The execution ladder both chains share today is `sign-at-trigger` (N1): the
 * engine detects → prepares unsigned → the USER signs. Each chain has its own
 * gated non-custodial upgrade: XRPL `native-conditional` (Smart Escrows
 * XLS-100 — amendment "In Development", NOT on mainnet) and EVM
 * `session-scoped` (session keys 4337/7702 — V1.1, MiCA-gated per
 * docs/regulatory/MICA_BOUNDARIES.md). Neither is reachable from here until
 * its gate opens.
 */

import type { CmfAmountType, CmfTriggerKind, CmfVerb } from './CanonicalMoneyFlow';

export type ExecutionMode = 'sign-at-trigger' | 'native-conditional' | 'session-scoped';

export interface ChainCapability {
  /** CAIP-2 chain id. */
  chain: string;
  /** Best execution mode available TODAY (the ladder above). */
  mode: ExecutionMode;
  /** Verbs this chain's translator can compile to an executable rule/tx. */
  verbs: readonly CmfVerb[];
  /** Trigger kinds with a REAL evaluator behind them (stubs excluded). */
  triggers: readonly CmfTriggerKind[];
  /** Amount types resolvable today ('percent-of-position'/'to-target' need trigger-time resolution — post-F1 engine work). */
  amountTypes: readonly CmfAmountType[];
  /** Honest limits worth surfacing to the user/docs. */
  notes: readonly string[];
}

/**
 * Flare (eip155:14) — the live venue. Verbs map 1:1 onto the AutomationRule
 * action vocabulary (routes/rules.ts actionSchema) and prepare via the
 * existing engine path (tick → IntentEngine.createIntent → protocol adapter).
 * A verb a given ADAPTER doesn't implement fails at prepare time through the
 * engine's existing readable error path (`intent_prepare_failed`) — the
 * matrix is vocabulary-level, not per-adapter feature detection.
 *
 * Triggers: only the evaluators TriggerEvaluator actually implements.
 * TIME_TRIGGER is REAL (5-field cron subset, UTC) and PRICE_DROP_PCT is REAL
 * since M3 (2026-08-16: live FTSO price vs the rule's own baselineUsd) →
 * 'time' and 'price' are both included below; the notes carry the fine
 * print. [This header once claimed both were excluded — it had gone stale
 * against line 57 and its own notes (plan 14-ago §10.3); kept fixed.]
 */
export const FLARE_EVM_CAPABILITY: ChainCapability = {
  chain: 'eip155:14',
  mode: 'sign-at-trigger',
  verbs: [
    'supply', 'withdraw', 'borrow', 'repay', 'swap',
    'provide-liquidity', 'remove-liquidity', 'stake', 'unstake', 'claim-rewards',
  ],
  triggers: ['health-factor', 'ltv', 'reward', 'idle-balance', 'time', 'price'],
  amountTypes: ['absolute'],
  notes: [
    'health-factor supports comparator "below" only (HF_BELOW); re-leverage on "above" needs an HF_ABOVE evaluator (post-F1).',
    '"time" runs on the TIME_TRIGGER cron evaluator (5-field subset: * */n lists ranges, UTC). "price" runs on PRICE_DROP_PCT (M3): live FTSO price vs the rule\'s own baselineUsd — drop-from-baseline, not a rolling window; no baseline or no live read ⇒ never fires.',
    'transfer/bridge are not AutomationRule actions on EVM; cross-ecosystem moves are the C.2 primitive (post-F1).',
    'session keys (4337/7702) = V1.1 MiCA-gated; until then every trigger ends in a user signature (N1).',
  ],
};

/**
 * XRPL — NON-EMPTY since M4 (2026-08-16): the CanonicalXrplTranslator
 * compiles to the rule vocabulary this window built (M1 scheduledPayment ·
 * B.1 escrow · councilPayment · M3 real price evaluator). Honest matrix:
 * only what a live rail serves is listed.
 */
export const XRPL_CAPABILITY: ChainCapability = {
  chain: 'xrpl:0',
  mode: 'sign-at-trigger',
  verbs: ['transfer', 'supply'],
  triggers: ['time', 'idle-balance', 'price'],
  amountTypes: ['absolute'],
  notes: [
    '"transfer" = an XRPL Payment: personal → scheduledPayment (the tick nudges; the Payment is composed FRESH at the signing door, Account pinned, signed in Xaman) · governed → councilPayment (the trigger composes a proposal; the QUORUM signs).',
    '"supply" = the B.1 savings escrow (venue.params.lockDays): the trigger nudges; the EscrowCreate is composed fresh in the Savings surface — FinishAfter is relative to signing time. Personal-only: the governed programmed transfer is a council ceremony, not a rule.',
    'Native XRP only in v1 — IOU rails (RLUSD on XRPL…) are post. "price" floors convert to the drop-from-baseline evaluator AT TRANSLATION TIME with a live FTSO read; no read ⇒ readable error, never a guessed baseline.',
    'AMM/DEX/Offer builders exist but stay OUT of the capability until their rule rails do (X1); Smart Escrows (XLS-100) stays roadmap until the amendment reaches mainnet.',
  ],
};

const CAPABILITIES: readonly ChainCapability[] = [FLARE_EVM_CAPABILITY, XRPL_CAPABILITY];

export function getChainCapability(chain: string): ChainCapability | undefined {
  return CAPABILITIES.find((c) => c.chain === chain);
}

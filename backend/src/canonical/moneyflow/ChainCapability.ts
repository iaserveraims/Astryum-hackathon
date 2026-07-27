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
 * PRICE_DROP_PCT and TIME_TRIGGER are stubs (always fired:false) → 'price'
 * and 'time' are EXCLUDED until those evaluators exist (honest matrix, F1).
 */
export const FLARE_EVM_CAPABILITY: ChainCapability = {
  chain: 'eip155:14',
  mode: 'sign-at-trigger',
  verbs: [
    'supply', 'withdraw', 'borrow', 'repay', 'swap',
    'provide-liquidity', 'remove-liquidity', 'stake', 'unstake', 'claim-rewards',
  ],
  triggers: ['health-factor', 'ltv', 'reward', 'idle-balance', 'time'],
  amountTypes: ['absolute'],
  notes: [
    'health-factor supports comparator "below" only (HF_BELOW); re-leverage on "above" needs an HF_ABOVE evaluator (post-F1).',
    '"time" runs on the TIME_TRIGGER cron evaluator (5-field subset: * */n lists ranges, UTC). "price" is still a stub — excluded until implemented.',
    'transfer/bridge are not AutomationRule actions on EVM; cross-ecosystem moves are the C.2 primitive (post-F1).',
    'session keys (4337/7702) = V1.1 MiCA-gated; until then every trigger ends in a user signature (N1).',
  ],
};

/**
 * XRPL — ∅ until the native builders land (X1 arrives AFTER them; plan
 * Astryum_Plan_Builders_XRPL_Nativo_2026-07-08). Declared now so the
 * capability lookup and its degradation errors are already multichain.
 */
export const XRPL_CAPABILITY: ChainCapability = {
  chain: 'xrpl:0',
  mode: 'sign-at-trigger',
  verbs: [],
  triggers: [],
  amountTypes: [],
  notes: [
    'XRPL verbs arrive with the native builders (EscrowCreate → OfferCreate → AMM) and the CanonicalXrplTranslator (X1).',
    'native-conditional (Smart Escrows XLS-100) stays roadmap until the amendment reaches mainnet — the amendment watch re-checks it.',
  ],
};

const CAPABILITIES: readonly ChainCapability[] = [FLARE_EVM_CAPABILITY, XRPL_CAPABILITY];

export function getChainCapability(chain: string): ChainCapability | undefined {
  return CAPABILITIES.find((c) => c.chain === chain);
}

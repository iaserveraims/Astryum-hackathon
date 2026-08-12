/**
 * councilPlan — the rules of a signer list, as pure functions.
 *
 * WHY THIS EXISTS (2026-08-03). The council is NOT created inside Astryum any
 * more: Xaman refuses a `SignerListSet` composed by a third-party app (401 /
 * code 1217, "No permission to create this type of sign request"), and that
 * permission is granted per app by Xaman's support. The family creates its
 * council in the Xaman Multisign xApp — the same tool that constituted and
 * amended this project's own council in July (verified on-ledger: those two
 * SignerListSets carry no SourceTag, fee 800 drops, and Xaman's own
 * "YOU ARE GIVING AWAY CONTROL OF YOUR ACCOUNT" memo).
 *
 * So Astryum's job shifts from COMPOSING the transaction to being the place
 * where the plan is decided, checked and — afterwards — verified against the
 * ledger. That makes these rules the load-bearing part, and they must hold in
 * two places at once (the live form and the unsigned-composer fallback), so
 * they live here: pure, no React, no network, testable.
 *
 * The rule that matters most is F10: a quorum above the total weight is a
 * signer list NO combination of keys can ever satisfy. With the master key
 * later disabled, that is an account locked forever, with the capital inside.
 * It has to be said HERE, in words, before anyone types it into a wallet.
 */

/** One row of the plan, exactly as a person types it. */
export interface PlannedSigner {
  account: string;
  /** Kept as a string: it comes from an input and may be empty or garbage. */
  weight: string;
}

/** A signer list as the ledger holds it. */
export interface CouncilOnLedger {
  quorum: number;
  signers: Array<{ account: string; weight: number }>;
}

export interface NormalizedPlan {
  signers: Array<{ account: string; weight: number }>;
  quorum: number;
  totalWeight: number;
  /** Weight you can lose before the quorum becomes unreachable. */
  margin: number;
}

/** XRPL classic address shape. The checksum is verified separately (xrpl.js). */
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** Rows the person left blank are not signers — they are unfinished typing. */
export function normalizeCouncilPlan(signers: PlannedSigner[], quorum: string): NormalizedPlan {
  const rows = signers
    .map((s) => ({ account: s.account.trim(), weight: Number(s.weight) }))
    .filter((s) => s.account.length > 0);
  const totalWeight = rows.reduce((a, s) => a + (Number.isFinite(s.weight) ? s.weight : 0), 0);
  const q = Number(quorum);
  return {
    signers: rows,
    quorum: Number.isFinite(q) ? q : 0,
    totalWeight,
    margin: totalWeight - (Number.isFinite(q) ? q : 0),
  };
}

/**
 * Every reason a plan must not be typed into a wallet. Returns an i18n key (an
 * English sentence, per this repo's t() strategy) plus the offending detail, so
 * the caller renders `t(message)` and appends `detail` verbatim.
 */
export interface PlanProblem {
  message: string;
  detail?: string;
}

/**
 * @param isValidAddress checksum validator (xrpl.js `isValidClassicAddress`),
 *   injected so this module stays free of the xrpl dependency and testable.
 *   The regex alone lets a plausible one-character typo through — and copying a
 *   relative's address by hand is exactly where that typo happens. A signer
 *   whose address is off by one character is a member who can NEVER sign.
 */
export function validateCouncilPlan(
  account: string | null,
  signers: PlannedSigner[],
  quorum: string,
  isValidAddress: (a: string) => boolean,
): PlanProblem | null {
  const plan = normalizeCouncilPlan(signers, quorum);
  if (plan.signers.length === 0) return { message: 'Add at least one signer address.' };

  const bad = plan.signers.find((s) => !(XRPL_ADDRESS_RE.test(s.account) && isValidAddress(s.account)));
  if (bad) return { message: 'This is not an XRPL address (r…)', detail: bad.account };

  if (account && plan.signers.some((s) => s.account === account)) {
    return { message: 'The account cannot be one of its own signers.' };
  }
  const dup = plan.signers.find(
    (s, i) => plan.signers.findIndex((x) => x.account === s.account) !== i,
  );
  if (dup) return { message: 'Duplicated signer', detail: dup.account };

  if (plan.signers.some((s) => !Number.isInteger(s.weight) || s.weight < 1)) {
    return { message: 'Every weight must be a whole number of votes (1 or more).' };
  }
  if (!Number.isInteger(plan.quorum) || plan.quorum < 1) {
    return { message: 'The quorum must be a whole number of votes (1 or more).' };
  }
  // F10 — the irreversible one.
  if (plan.quorum > plan.totalWeight) {
    return {
      message:
        'The quorum exceeds the total votes — no decision could EVER pass and the account would lock forever.',
      detail: `(${plan.quorum} > ${plan.totalWeight})`,
    };
  }
  // XRPL caps a signer list at 32 entries (ExpandedSignerList).
  if (plan.signers.length > 32) return { message: 'A signer list holds at most 32 members.' };
  return null;
}

/**
 * One rendering rule for both the live form and the composer, so the same
 * problem never reads two ways. A parenthesised detail (the F10 arithmetic)
 * reads as an aside; anything else — an address — reads after a colon.
 */
export function formatPlanProblem(problem: PlanProblem, t: (s: string) => string): string {
  const message = t(problem.message);
  if (!problem.detail) return message;
  return problem.detail.startsWith('(') ? `${message} ${problem.detail}` : `${message}: ${problem.detail}`;
}

export interface PlanComparison {
  matches: boolean;
  quorumMatches: boolean;
  /** Planned, absent from the ledger (a member who was left out or mistyped). */
  missing: string[];
  /** On the ledger, absent from the plan. */
  unexpected: string[];
  /** Present in both, different weight. */
  weightMismatch: Array<{ account: string; planned: number; onLedger: number }>;
}

/**
 * Compare what the family MEANT to create against what the ledger actually
 * holds. This is the whole point of coming back to Astryum after the xApp: the
 * only honest confirmation is the ledger, and a silent mismatch (one signer
 * missing, a quorum typed as 2 instead of 3) is discovered years later, by
 * whoever needed the council to work.
 */
export function compareCouncilPlan(
  signers: PlannedSigner[],
  quorum: string,
  council: CouncilOnLedger,
): PlanComparison {
  const plan = normalizeCouncilPlan(signers, quorum);
  const onLedger = new Map(council.signers.map((s) => [s.account, s.weight]));
  const planned = new Map(plan.signers.map((s) => [s.account, s.weight]));

  const missing = plan.signers.filter((s) => !onLedger.has(s.account)).map((s) => s.account);
  const unexpected = council.signers.filter((s) => !planned.has(s.account)).map((s) => s.account);
  const weightMismatch = plan.signers
    .filter((s) => onLedger.has(s.account) && onLedger.get(s.account) !== s.weight)
    .map((s) => ({ account: s.account, planned: s.weight, onLedger: onLedger.get(s.account) as number }));
  const quorumMatches = plan.quorum === council.quorum;

  return {
    matches:
      quorumMatches && missing.length === 0 && unexpected.length === 0 && weightMismatch.length === 0,
    quorumMatches,
    missing,
    unexpected,
    weightMismatch,
  };
}

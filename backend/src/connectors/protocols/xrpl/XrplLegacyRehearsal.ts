/**
 * XrplLegacyRehearsal — the signing-rehearsal verdict (pure, testable).
 *
 * The rehearsal (GUIA_LEGACY.md paso 3 / PROTOCOLO_CONSEJO.md §2) is passed
 * when EVERY SignerList member has appeared, at least once, in the `Signers`
 * array of a validated multisig transaction of the Legacy account, and at
 * least one of those transactions was an EscrowCreate. A quorum-sized tx only
 * proves the quorum — XRPL accepts more signatures than the quorum, and the
 * verdict is cumulative across transactions, so families can also pass with
 * several rehearsal rounds.
 *
 * This is the gate that unlocks the master-key door (candado §1): honest,
 * on-chain, per member. What it can NOT know: whether each member signed
 * PERSONALLY (that discipline stays human — the copy says so).
 */

export interface RehearsalCouncilInput {
  quorum: number;
  masterKeyDisabled: boolean;
  signers: Array<{ account: string; weight: number }>;
}

export interface RehearsalActivityInput {
  signersSeen: string[];
  multisigEscrowCreates: number;
  escrowResolved: boolean;
}

export interface RehearsalStatus {
  hasCouncil: boolean;
  masterKeyDisabled: boolean;
  members: Array<{ account: string; weight: number; signedOnChain: boolean }>;
  signedCount: number;
  memberCount: number;
  /** ≥1 validated multisig EscrowCreate exists (the rehearsal tx itself). */
  rehearsalEscrowSeen: boolean;
  /** A finish/cancel of one of the account's escrows validated (second half). */
  escrowResolved: boolean;
  /** THE gate: every member signed on-chain + the rehearsal escrow exists. */
  rehearsalComplete: boolean;
  /**
   * Quorum margin over DECLARED signers (worst-case: losing the heaviest
   * first). 0 = exact quorum — one more loss freezes governance forever.
   * Astryum sees how many signers exist, not how many CAN sign.
   */
  quorumMargin: number;
}

/** Worst-case losses the council survives: remove heaviest weights first. */
export function quorumMargin(quorum: number, weights: number[]): number {
  if (quorum <= 0 || weights.length === 0) return 0;
  const sorted = [...weights].sort((a, b) => b - a);
  let remaining = sorted.reduce((s, w) => s + w, 0);
  if (remaining < quorum) return 0; // cannot even reach quorum today
  let losses = 0;
  for (const w of sorted) {
    if (remaining - w < quorum) break;
    remaining -= w;
    losses++;
  }
  return losses;
}

/**
 * The health verdict that GOVERNS the panel (ADR-008 / PROTOCOLO_CONSEJO §4.4).
 *
 * This is the heart of the "constitute vs govern" split: a Legacy's health state
 * decides which actions are even offered. Computing it HERE (tested) instead of
 * in JSX conditionals is deliberate — "RED blocks dangerous actions" is a safety
 * rule, not a styling detail. The panel renders this verdict; it does not
 * re-derive it.
 *
 * The margin axis (§4.4: "la urgencia es de MARGEN"): margin 0 = one lost key
 * from a permanent freeze = emergency. The rehearsal axis: unverified rehearsal =
 * no real capital, no closing the door.
 */
export type LegacyHealthLevel = 'red' | 'amber' | 'green' | 'unknown';

export interface LegacyHealth {
  level: LegacyHealthLevel;
  /** The single most urgent thing to do — the panel highlights only this in RED. */
  headline: 'inspect' | 'replace-fallen-signer' | 'run-rehearsal' | 'close-the-door' | 'healthy';
  /** §2 rule: RED blocks close-the-door and capital commitment outright. */
  dangerousActionsBlocked: boolean;
  /** Closing the master-key door is safe only after a verified rehearsal AND with margin to spare. */
  canCloseDoor: boolean;
  /** Real capital requires a verified rehearsal and a non-zero margin. */
  canCommitCapital: boolean;
  /** Margin 0 — the rescue (replace the fallen signer) is the ONLY highlighted action. */
  mustReplaceSigner: boolean;
  reasons: string[];
}

export function assessLegacyHealth(status: RehearsalStatus): LegacyHealth {
  if (!status.hasCouncil) {
    return {
      level: 'unknown',
      headline: 'inspect',
      dangerousActionsBlocked: false,
      canCloseDoor: false,
      canCommitCapital: false,
      mustReplaceSigner: false,
      reasons: ['No council read yet — inspect a council-governed account.'],
    };
  }

  const margin = status.quorumMargin;
  const rehearsed = status.rehearsalComplete;
  const doorClosed = status.masterKeyDisabled;
  const reasons: string[] = [];

  // Margin axis (§4.4) — the emergency dominates everything else.
  if (margin === 0) {
    reasons.push('EXACT quorum: one more lost key locks this account forever. Replace the missing signer before anything else.');
    return {
      level: 'red',
      headline: 'replace-fallen-signer',
      dangerousActionsBlocked: true,
      canCloseDoor: false,
      canCommitCapital: false,
      mustReplaceSigner: true,
      reasons,
    };
  }

  let level: LegacyHealthLevel = 'green';
  if (margin === 1) {
    level = 'amber';
    reasons.push('Margin 1: one lost key from an exact-quorum emergency. Consider adding a signer.');
  }
  if (!rehearsed) {
    level = 'amber';
    reasons.push('Signing rehearsal not verified on-chain — no real capital, and closing the door could brick the account.');
  }

  const headline: LegacyHealth['headline'] = !rehearsed
    ? 'run-rehearsal'
    : !doorClosed
      ? 'close-the-door'
      : 'healthy';
  if (rehearsed && doorClosed && level === 'green') reasons.push('Constituted: quorum-only governance, margin to spare.');

  return {
    level,
    headline,
    dangerousActionsBlocked: false,
    // Closing the door: verified rehearsal + margin to spare (NOT at margin 1 or 0).
    canCloseDoor: rehearsed && margin >= 1 && !doorClosed,
    // Real capital: only once the rehearsal is verified and the margin is non-zero.
    canCommitCapital: rehearsed && margin >= 1,
    mustReplaceSigner: false,
    reasons,
  };
}

export function assessRehearsal(
  council: RehearsalCouncilInput | null,
  activity: RehearsalActivityInput,
): RehearsalStatus {
  if (!council || council.signers.length === 0) {
    return {
      hasCouncil: false,
      masterKeyDisabled: false,
      members: [],
      signedCount: 0,
      memberCount: 0,
      rehearsalEscrowSeen: activity.multisigEscrowCreates > 0,
      escrowResolved: activity.escrowResolved,
      rehearsalComplete: false,
      quorumMargin: 0,
    };
  }
  const seen = new Set(activity.signersSeen);
  const members = council.signers.map((s) => ({
    account: s.account,
    weight: s.weight,
    signedOnChain: seen.has(s.account),
  }));
  const signedCount = members.filter((m) => m.signedOnChain).length;
  const rehearsalEscrowSeen = activity.multisigEscrowCreates > 0;
  return {
    hasCouncil: true,
    masterKeyDisabled: council.masterKeyDisabled,
    members,
    signedCount,
    memberCount: members.length,
    rehearsalEscrowSeen,
    escrowResolved: activity.escrowResolved,
    rehearsalComplete: rehearsalEscrowSeen && signedCount === members.length,
    quorumMargin: quorumMargin(
      council.quorum,
      council.signers.map((s) => s.weight),
    ),
  };
}

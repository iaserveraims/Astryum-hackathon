/**
 * vaultModalTruth — the pure decisions behind VaultWithdrawModal and
 * VaultClaimModal (frente `settling-residuos`, 2026-08-18; closed in
 * `settling-final`, 2026-08-19).
 *
 * The two modals are twins: same rails (EVM wallet / 0xFE dispatch signed in
 * Xaman), same disclosure shape, same post-signature story. Everything here is
 * the part of that story that can be decided WITHOUT React, so it can be
 * tested for real instead of grepped for a substring.
 *
 * WHAT MOVED, AND WHERE (frente `familia-no-pude-leer`, 2026-08-20).
 *
 * Residue 1 of this file — `signOutcome` / `unconfirmedTrace` /
 * `signFailureAction`, the classification of a signature we could not follow —
 * was never about vaults. It was written here because it was born here, and it
 * turned out to be the fix three other signing surfaces still needed
 * (`positions/PaActionsModal`, `positions/FtsoExitModal`, `earn/FlareDemoEarn`,
 * all of them ending their catch with "the prepared payload is still valid,
 * retry the signature"). One family of failure, one implementation: it now
 * lives at `lib/wallet/signOutcome.ts`, beside the `inFlightError` doctrine it
 * extends, with `applySignFailure` — the whole catch — added there.
 *
 * It is re-exported below, so this path keeps working for the two vault modals
 * and for anything else already importing it: the code was moved and signposted,
 * never deleted. New callers should import from `lib/wallet/signOutcome`.
 *
 * What stays here is what is genuinely about these two modals:
 *
 *  1. `dispatchFeeQuote` + `feeXrpDigits` — a fee is shown or its absence is
 *     said (invariant #6), and shown with enough precision that a real fee
 *     cannot read as free: `fmt(0.003, 2)` printed "0 XRP".
 *
 *  2. `freshClaimableAt` + `releaseLine` — the release date the withdraw modal
 *     prints once the exit is confirmed. The prepare's date is read BEFORE the
 *     signature and the 0xFE executor runs minutes later, so it is never
 *     asserted as the day the money comes back. `ReleaseLine.floor` is the
 *     shape of that honesty: what the prepare read is `currentPeriodEnd()`,
 *     while the redeem queues into `currentPeriod() + 1`, so that instant is
 *     not an estimate of the release date — it is a FLOOR strictly below it.
 */

// Moved, not deleted (familia-no-pude-leer): the sign-failure family now has
// five surfaces across two component folders, so it lives in the wallet layer.
export {
  signOutcome,
  unconfirmedTrace,
  signFailureAction,
  applySignFailure,
} from '../../lib/wallet/signOutcome';
export type {
  SignOutcome,
  SignFailureAction,
  SignFailureHandlers,
  UnconfirmedSignature,
} from '../../lib/wallet/signOutcome';


/* ── 2 · the XRP cost of a 0xFE dispatch ─────────────────────────────────── */

export type DispatchFeeQuote =
  | { kind: 'quoted'; mintingFeeXrp: number; executorFeeXrp: number }
  | { kind: 'unquoted' };

/**
 * The mint-coupled fees of a 0xFE dispatch, or the admission that the prepare
 * did not carry them. A bare `!= null` guard rendered NOTHING when the read
 * failed, and silence in a fee row reads as "free" (invariant #6).
 */
export function dispatchFeeQuote(disclosure?: Record<string, unknown>): DispatchFeeQuote {
  const minting = disclosure ? disclosure.mintingFeeXrp : null;
  const executor = disclosure ? disclosure.executorFeeXrp : null;
  if (
    typeof minting === 'number' &&
    Number.isFinite(minting) &&
    typeof executor === 'number' &&
    Number.isFinite(executor)
  ) {
    return { kind: 'quoted', mintingFeeXrp: minting, executorFeeXrp: executor };
  }
  return { kind: 'unquoted' };
}

/* ── 2b · the vault's own instant-redemption fee ─────────────────────────── */

export type InstantFeeQuote =
  /** This vault charges no instant fee at all (Firelight queues instead). */
  | { kind: 'none' }
  /** Read live. `fxrp` is what it costs on THIS exit; `bps` may legitimately be 0. */
  | { kind: 'charged'; bps: number; fxrp: number | null }
  /** The read failed. Not a zero, not an absence — an admission. */
  | { kind: 'unreadable' };

/**
 * The instant-redemption fee of a vault exit, as one of THREE states.
 *
 * it. 27 — WHY THREE. The prepare used to send a single `null` for all of
 * them: «this vault has no instant fee», «the fee is zero» and «I could not
 * read the fee» arrived as the same symbol, and the row simply did not render.
 * Silence in a fee row reads as free (invariant #6), so the state that most
 * needed saying was the one that vanished. The server now refuses to compose
 * rather than send an unread fee, and this reader is the belt to that
 * braces: a payload that still cannot account for its fee gets a row saying
 * so, never an empty one.
 *
 * `instantFeeKnown === true` is the prepare's own statement that the fee in
 * this payload was READ. Its absence on an instant-redeem vault with no bps is
 * what marks the gap.
 */
export function instantFeeQuote(disclosure?: Record<string, unknown>): InstantFeeQuote {
  const bpsRaw = disclosure ? disclosure.instantRedemptionFeeBps : null;
  const bps = typeof bpsRaw === 'number' && Number.isFinite(bpsRaw) ? bpsRaw : null;
  if (bps != null) {
    const fxrpRaw = disclosure ? disclosure.instantFeeFxrp : null;
    const fxrp = typeof fxrpRaw === 'number' && Number.isFinite(fxrpRaw) ? fxrpRaw : null;
    return { kind: 'charged', bps, fxrp };
  }
  // No bps. Either the vault has none — which the prepare states by claiming
  // the fee is known — or nobody could read it.
  return disclosure?.instantFeeKnown === true ? { kind: 'none' } : { kind: 'unreadable' };
}

/**
 * Decimals for an XRP fee so that showing it is not the same as hiding it.
 * `fmtQtyActive` takes MAXIMUM fraction digits, so 2 turned 0.003 XRP into
 * "0 XRP" — the exact number the disclosure exists to reveal. Small fees get
 * the precision they need; big ones stay readable.
 */
export function feeXrpDigits(n: number): number {
  if (!Number.isFinite(n) || n === 0) return 2;
  const abs = Math.abs(n);
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  return 6;
}

/* ── 3 · when the queued money is really released ────────────────────────── */

/** The post-settlement re-read of GET /flare-demo/vault-claims/:owner. */
export type ClaimDateRead =
  | { state: 'idle' }
  | { state: 'reading' }
  | { state: 'read'; claimableAt: string }
  | { state: 'unread' };

/**
 * The release date of the exit THIS signature just queued, taken from the
 * vault-claims read. The newest period is ours (`_requestWithdraw` queues into
 * `currentPeriod() + 1`); if its date is unusable we return null instead of
 * borrowing the date of an older exit — that would be a figure about someone
 * else's money printed as if it were this one's.
 */
export function freshClaimableAt(pending: unknown): string | null {
  if (!Array.isArray(pending)) return null;
  let newestPeriod = Number.NEGATIVE_INFINITY;
  let newestAt: unknown = null;
  for (const row of pending) {
    if (!row || typeof row !== 'object') continue;
    const period = Number((row as { period?: unknown }).period);
    if (!Number.isFinite(period) || period <= newestPeriod) continue;
    newestPeriod = period;
    newestAt = (row as { claimableAt?: unknown }).claimableAt;
  }
  if (newestPeriod === Number.NEGATIVE_INFINITY) return null;
  return typeof newestAt === 'string' && Number.isFinite(Date.parse(newestAt)) ? newestAt : null;
}

export type ReleaseLine =
  | { kind: 'instant' }
  | { kind: 'reading' }
  /** Re-read from the ledger AFTER execution — this one can be asserted. */
  | { kind: 'confirmed'; at: string }
  /**
   * Only the prepare's read: `currentPeriodEnd()`, the end of the period that
   * was RUNNING before the signature. The exit queues into the NEXT period, so
   * the release is strictly AFTER this instant — a floor, never the date. Any
   * surface that shows it must say so; printing it as the day to come back is
   * a whole period early, and there is no Claim button waiting that day.
   */
  | { kind: 'floor'; at: string }
  | { kind: 'unknown' };

/**
 * What the done-view may claim about the release date.
 *
 * The prepare reads `currentPeriodEnd()` BEFORE the signature; on the 0xFE rail
 * the executor runs 2-5 minutes later, so the period can already have rolled
 * over — and the exit itself queues into `currentPeriod() + 1`, whose date is
 * `nextPeriodEnd`. Confirmed date if we re-read one; otherwise the prepare's,
 * typed as the FLOOR it is (settling-final · blocker 3: `estimated` was a
 * label that let a known-wrong day be printed as the day to come back);
 * otherwise nothing.
 */
export function releaseLine(
  timing: { kind: 'instant' | 'queued' | 'queued-unknown-date'; claimableAt?: string },
  read: ClaimDateRead,
): ReleaseLine {
  if (timing.kind === 'instant') return { kind: 'instant' };
  if (read.state === 'read') return { kind: 'confirmed', at: read.claimableAt };
  if (read.state === 'reading') return { kind: 'reading' };
  if (timing.kind === 'queued' && typeof timing.claimableAt === 'string') {
    return { kind: 'floor', at: timing.claimableAt };
  }
  return { kind: 'unknown' };
}

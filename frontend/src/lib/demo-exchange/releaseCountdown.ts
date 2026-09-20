/**
 * The wait a desk reservation owes the LEDGER (productizer it. 14, R5 1.2).
 *
 * «Back» on a composed put-to-work does not release it: the 0xFE can still be
 * signed and land until its LastLedgerSequence, so the server answers 409
 * WAIT_FOR_LAST_LEDGER with that ledger and the ledgers / seconds left. Until
 * now the desk showed one frozen sentence and the operator had to guess when to
 * press again — ~6-7 minutes of a reservation that looked stuck.
 *
 * Pure on purpose (lib/, no network, no React): the countdown and the single
 * automatic retry are decided here and the component only renders and fires.
 */

import type { Refusal } from './api';

/** Seconds a validated ledger takes, the same estimate the server uses for `secondsLeft`. */
export const XRPL_SECONDS_PER_LEDGER_ESTIMATE = 4;
/**
 * Margin added to the estimate before retrying by itself: the estimate is an
 * estimate, and a retry one ledger early only earns a second refusal.
 */
export const RELEASE_RETRY_MARGIN_MS = 6_000;

export interface ReleaseWait {
  /** Which reservation is waiting. */
  deskPaymentId: string;
  /** The XRPL ledger after which it can never land. */
  lastLedgerSequence: number | null;
  /** When the server's window is expected to be past (epoch ms). */
  retryAtMs: number;
  /** The automatic retry already happened: from here it is the operator's button. */
  retried: boolean;
}

/**
 * The wait a WAIT_FOR_LAST_LEDGER refusal describes, or null when it is not one.
 * A refusal with no numbers still produces a wait (the ledger is the authority,
 * not our clock): one estimated minute, never an invented ledger.
 */
export function releaseWaitFromRefusal(deskPaymentId: string, refusal: Refusal, nowMs: number): ReleaseWait | null {
  if (refusal.error !== 'WAIT_FOR_LAST_LEDGER') return null;
  const seconds =
    typeof refusal.secondsLeft === 'number' && Number.isFinite(refusal.secondsLeft)
      ? Math.max(0, refusal.secondsLeft)
      : typeof refusal.ledgersLeft === 'number' && Number.isFinite(refusal.ledgersLeft)
        ? Math.max(0, refusal.ledgersLeft) * XRPL_SECONDS_PER_LEDGER_ESTIMATE
        : 60;
  return {
    deskPaymentId,
    lastLedgerSequence: typeof refusal.lastLedgerSequence === 'number' ? refusal.lastLedgerSequence : null,
    retryAtMs: nowMs + seconds * 1000 + RELEASE_RETRY_MARGIN_MS,
    retried: false,
  };
}

/** Whole seconds left of the wait (never negative). */
export function secondsLeft(wait: ReleaseWait, nowMs: number): number {
  return Math.max(0, Math.ceil((wait.retryAtMs - nowMs) / 1000));
}

/** Milliseconds until the automatic retry, or null when it is not owed any more. */
export function msUntilRetry(wait: ReleaseWait, nowMs: number): number | null {
  if (wait.retried) return null;
  return Math.max(0, wait.retryAtMs - nowMs);
}

/**
 * The line next to the reservation. `t` is the app translator; the numbers are
 * the ledger's, and a ledger we were not told is «—», never a guess.
 *
 * ONE RULE, SAID THE SAME WAY EVERYWHERE (it. 16, «Copy y SourceTag»): the seat
 * frees when the Xaman payload can no longer be signed — not when the operator
 * believes it never reached a phone. This line, the «Release» button and its
 * confirmation all say that now; before, the line said «release it now» beside
 * a button that said «only if it never reached Xaman» and a confirmation that
 * said the opposite of both.
 */
export function releaseWaitText(wait: ReleaseWait, nowMs: number, t: (s: string) => string): string {
  const left = secondsLeft(wait, nowMs);
  const lls = wait.lastLedgerSequence === null ? '—' : String(wait.lastLedgerSequence);
  if (left > 0) {
    return (wait.retried
      ? t('Still signable: it can be signed and land until XRPL ledger {lls} — ≈ {s} s left. The seat frees once that ledger passes; if it was signed, record it instead.')
      : t('Signable until XRPL ledger {lls} — ≈ {s} s left. The desk asks again by itself once that ledger passes; nothing is freed while the payload can still be signed.')
    )
      .replace('{lls}', lls)
      .replace('{s}', String(left));
  }
  return wait.retried
    ? t('Its window (XRPL ledger {lls}) is past: the payload can no longer be signed. Release it — or record it if it was signed and landed.')
    .replace('{lls}', lls)
    : t('Its window (XRPL ledger {lls}) is past — asking the server to free the seat…').replace('{lls}', lls);
}

/* ── the seat of a 0xFE that was cancelled in Xaman (it. 21, 3.3) ────────── */

/**
 * WHAT HAPPENS WHEN SOMEBODY TAPS «Reject» IN XAMAN — and, until it. 21, what
 * nobody was told.
 *
 * Cancelling (or closing the tab) leaves the omnibus nonce seat taken by a
 * payload that is still alive: the next prepare met `NONCE_SEAT_TAKEN` with no
 * explanation and no way out, and the operator's reading was «it broke». The
 * wait is CORRECT — a payload that can still be signed must keep its seat, or
 * we build the twin — so the answer is not to free it sooner but to SAY it.
 *
 * The server measures the window and sends `secondsLeft` on its 409
 * (`WAIT_FOR_PAYLOAD_EXPIRY`); these two pure helpers turn that into a line that
 * actually counts down and a moment when asking again can work. No network, no
 * React: the door renders and fires.
 */
export interface SeatWait {
  /** When the seat is expected to free itself (epoch ms), as the SERVER measured it. */
  freesAtMs: number;
  /**
   * Did the server actually MEASURE the window? A 409 `WAIT_FOR_PAYLOAD_EXPIRY`
   * carries `secondsLeft`; a 503 «I could not read the seat» carries nothing, and
   * printing «it can no longer be signed» over that would be asserting a fact we
   * do not have. `false` = we are counting nothing but our own margin.
   */
  measured: boolean;
  /** The server's own sentence, when it sent one worth showing. */
  detail?: string;
}

/** The margin also applies here: asking one second early only earns a second refusal. */
export function seatWaitFrom(secondsLeft: number | undefined, nowMs: number, detail?: string): SeatWait {
  const measured = typeof secondsLeft === 'number' && Number.isFinite(secondsLeft);
  const secs = measured ? Math.max(0, secondsLeft as number) : 0;
  return { freesAtMs: nowMs + secs * 1000 + RELEASE_RETRY_MARGIN_MS, measured, ...(detail ? { detail } : {}) };
}

/** Whole seconds left of the seat's wait (never negative). */
export function seatSecondsLeft(wait: SeatWait, nowMs: number): number {
  return Math.max(0, Math.ceil((wait.freesAtMs - nowMs) / 1000));
}

/**
 * The line under a cancelled signature. It never promises the seat is free: it
 * says what the server said and when asking again can work (it. 20, 3.9 — «the
 * seat was freed» asserted a future in a race).
 */
export function seatWaitText(wait: SeatWait, nowMs: number, t: (s: string) => string): string {
  const left = seatSecondsLeft(wait, nowMs);
  if (!wait.measured) {
    // The server did not (or could not) say. Nothing is asserted about the
    // payload: only what we know — nothing was signed, and asking again is free.
    return t('Nothing was signed. We could not read how long its Xaman request can still be signed, so its place in the omnibus queue may still be taken — ask again in a moment.');
  }
  if (left > 0) {
    return t('Its Xaman request can still be signed, so its place in the omnibus queue stays taken — it frees itself in about {s} s. Nothing was signed.')
      .replace('{s}', String(left));
  }
  return t('Its Xaman request can no longer be signed. Ask the server to free its place in the omnibus queue, then prepare it again.');
}

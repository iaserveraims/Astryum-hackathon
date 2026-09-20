'use client';

/**
 * SeatRefusalNotice — THE TWO WAYS A PREPARED 0xFE STOPS BEING USABLE, SAID IN
 * ONE PLACE (R5 5.4 + 5.2).
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  describeSeatRefusal,
  isSeatRefusal,
  seatRefusalKind,
  type SeatRefusalKind,
  type SeatRefusalLike,
  type SeatRefusalView,
} from '../../lib/xaman/seatRefusal';
import * as seatRefusalModule from '../../lib/xaman/seatRefusal';
import * as handoffReleaseModule from '../../lib/wallet/handoffRelease';
import { releaseHandoffSeatResult, type HandoffPostResult } from '../../lib/wallet/handoffRelease';
import * as signOutcomeModule from '../../lib/wallet/signOutcome';
import { isStaleDispatch, STALE_TX_MESSAGE } from '../../lib/xrpl/singleSignVerdict';

type Translate = (s: string) => string;

/* ── the refusal, normalised ──────────────────────────────────────────────── */

/**
 * The seat refusal inside a response body, whatever wrapper it arrived in.
 *
 * Some routes answer with the seat code directly (`error: 'NONCE_SEAT_TAKEN'`)
 * and some wrap it in their own (`VAULT_YIELD_CLAIM_PREPARE_FAILED`) with the
 * real code at the head of `detail`. `null` ⇒ this is not a seat refusal and the
 * caller keeps its own rendering: a cage verdict is not this.
 */
export function normalizeSeatRefusal(body: unknown): SeatRefusalLike | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as SeatRefusalLike & { code?: unknown };
  if (isSeatRefusal(b)) return b;
  // Some routes name the code `code` rather than `error`.
  if (typeof b.code === 'string' && isSeatRefusal({ ...b, error: b.code })) {
    return { ...b, error: b.code };
  }
  for (const raw of [b.error, b.code, b.detail]) {
    // The «could not decide» 503s are read here too, so a screen
    // that shows a seat refusal in prose also shows ACCOUNT_BUSY in prose
    // instead of the raw token over the server's Spanish paragraph.
    const wrapped = refusalCodeHead(raw);
    if (wrapped) return { ...b, error: wrapped };
  }
  return null;
}

/**
 * The seat codes THIS component understands, whatever the shared reader knows.
 *
 * `WAIT_FOR_PAYLOAD_EXPIRY` is a seat verdict — «the
 * payment holding the seat can still be signed for N more seconds» — and until
 * the shared reader listed it, every surface printed the raw token. It is read
 * here as well so the sentence survives a reader that has not caught up, and so
 * that it is NEVER mistaken for something a button can free: that wait exists
 * precisely because freeing it now is what makes the twin.
 */
const SEAT_CODE_HEAD =
  /^(NONCE_SEAT_TAKEN(?:_SIGNED|_REPORTED)?|NONCE_SEAT_UNREADABLE|WAIT_FOR_PAYLOAD_EXPIRY)\b/;

/**
 * THE 503s THAT HAD NO READER AT ALL.
 *
 * `ACCOUNT_BUSY` (a concurrent write on the same account), `PROOF_STORE_UNREADABLE`
 * (the store that says which addresses you proved could not be read),
 * `SEAT_STATE_UNREADABLE` and `DUPLICATE_CHECK_UNREADABLE` are all the same
 * shape: the server did NOT decide, nothing was prepared, nothing was signed,
 * and the honest next move is to ask again. Until now they reached the screen as
 * a raw token over the server's Spanish `detail`, with no button — a reintento
 * invisible. They are not seat verdicts, so they never touch «Free the seat»:
 * what they get is the sentence and «Try again».
 */
// `PROOF_FLOOR_AHEAD_OF_CLOCK` joins the family: the takeover mark
// PARSED but is dated ahead of the server's clock, so it cannot date anything
// yet. Retryable because the clock moves and nothing has to be written; it is
// NOT a verdict on the person, and «re-link the wallet» would be the one remedy
// that provably cannot work for that row (the new binding is stamped `now`,
// still below the mark). Without this line it fell to the generic reader.
const TRANSIENT_CODE_HEAD =
  /^(ACCOUNT_BUSY|PROOF_STORE_UNREADABLE|PROOF_FLOOR_AHEAD_OF_CLOCK|SEAT_STATE_UNREADABLE|HANDOFF_SEAT_UNREADABLE|SEAT_GUARD_UNREADABLE|DUPLICATE_CHECK_UNREADABLE)\b/;

/**
 * THE TWO 409s THAT WAITING CANNOT FIX.
 *
 * `ACCOUNT_RECORD_MISSING` (the user row behind this session is gone) and
 * `PROOF_FLOOR_UNREADABLE` (its `security` block does not parse, so we cannot
 * tell which linked wallets predate the last takeover) are DETERMINISTIC: the
 * server answers 409 with `retryable:false` precisely because a retry changes
 * nothing. They reached these screens with no reader at all and degraded to
 * «The server refused this operation» — throwing away the only two doors that
 * are actually open: sign in with the wallet that controls the address (a
 * signed-in wallet proves itself and needs no stored record), or an
 * administrator repairs the row. They are NOT seat verdicts and NOT weather:
 * no «Free the seat», no «Try again», and never a countdown.
 */
const DETERMINISTIC_PROOF_CODE_HEAD = /^(ACCOUNT_RECORD_MISSING|PROOF_FLOOR_UNREADABLE)\b/;

/** Every family of code this component can say something about. */
function refusalCodeHead(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const seat = SEAT_CODE_HEAD.exec(s);
  if (seat) return seat[1];
  const transient = TRANSIENT_CODE_HEAD.exec(s);
  if (transient) return transient[1];
  const deterministic = DETERMINISTIC_PROOF_CODE_HEAD.exec(s);
  return deterministic ? deterministic[1] : null;
}

/**
 * THE BUTTON THAT COULD ONLY FAIL.
 *
 * «Free the seat» used to be offered over BOTH unsigned-draft kinds, and the
 * `taken-window-open` one is the server saying «its signing window is still
 * open — it cannot be displaced from here». `/handoff/release` enforces exactly
 * that (`classifyHandoffRelease` releases a row only once it is unsignable), so
 * the button under that sentence could only come back with a 409: an offer that
 * contradicts the paragraph it sits under, on a screen whose whole job is to be
 * believed.
 */
function mayReleaseFromHere(kind: string | null | undefined): boolean {
  return kind === 'taken-retryable';
}

/**
 * The kinds this notice renders: the shared reader's seat verdicts plus the two
 * «the server could not decide» families above. Written as a superset so that a
 * shared reader which later learns them collapses into the same union.
 */
export type SeatNoticeKind =
  | SeatRefusalKind
  | 'busy'
  | 'store-unreadable'
  /**
   * 503: the takeover mark PARSED but is dated ahead of the
   * server's clock. It used to collapse into `store-unreadable` — «could not
   * read … try again in a moment» — and both halves are false for it: the row
   * was read, and the wait may be a corrupt 2099. Its own kind, so the notice
   * can keep the server's headline, its three ways and the wallet door, and
   * never promise a moment.
   */
  | 'floor-ahead-of-clock'
  /** 409: the account record behind this session is gone. Waiting fixes nothing. */
  | 'account-record-missing'
  /** 409: its security record does not parse, so linked wallets stay out. */
  | 'proof-floor-unreadable';

export interface SeatNoticeView extends Omit<SeatRefusalView, 'kind'> {
  kind: SeatNoticeKind;
  /**
   * The server's short heading and its REAL ways forward,
   * when it sent them (`provenAddresses.ts` builds every proof refusal with
   * both; the routes forward them verbatim). `describeServerRefusal` kept them,
   * but it is not the reader of these screens — this one is, and
   * it dropped both. Never invented: absent when the server sent none and the
   * shared reserve knows no ways for the code.
   */
  headline?: string;
  ways?: string[];
  /**
   * May the surface offer to ATTEMPT THE OPERATION AGAIN? True only where a
   * retry is a real path forward — a server that could not read, not a verdict.
   * Asking again is never a bypass: the server decides again from scratch.
   */
  mayTryAgain?: boolean;
  /** `Retry-After`, in seconds, when the server sent one. */
  retryAfterSeconds?: number;
  /**
   * THE FIELD NOBODY READ, OVER THE PROFILE THAT NEEDED IT MOST.
   *
   * `describeDeterministicProofRefusal` has said `maySignInWithWallet: true`
   * and not one surface read it: `grep` found the field written in
   * exactly two places, both of them its own definition. So the two
   * deterministic 409s reached an email/Google user — the ONE profile that
   * meets them, because they are about a STORED account record and a signed-in
   * wallet needs none — as a paragraph with no button under it: «sign in with
   * the wallet that controls this address» and nothing to press. Three
   * iterations in a row this profile has been rescued by prose alone.
   */
  maySignInWithWallet?: boolean;
}

/**
 * Where «sign in with the wallet that controls this address» actually goes.
 *
 * `/app/wallets` is the surface that signs in with a wallet and binds one by
 * signature (`WalletManager`, «Sign in with your wallet»), which is exactly the
 * pair of doors the deterministic sentence names. A link, never a fetch: this
 * notice must not decide anything, only stop being a dead end.
 */
export const WALLET_SIGN_IN_HREF = '/app/wallets';

/** The `Retry-After` of a 503, from whichever field the server used. */
function retryAfterSecondsOf(x: unknown): number | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  for (const key of ['retryAfterSeconds', 'retryAfter', 'retry_after']) {
    const n = positiveNumber(o[key]);
    if (n !== null) return n;
  }
  const body = o.body;
  return body && typeof body === 'object' ? retryAfterSecondsOf(body) : null;
}

/**
 * THE TWO DETERMINISTIC 409s, EACH IN ITS OWN SENTENCE.
 *
 * `ACCOUNT_RECORD_MISSING` and `PROOF_FLOOR_UNREADABLE` are the answer an
 * email/Google user meets on an EXIT when the stored account record behind
 * their session is gone or unreadable. They are not weather: the server marks
 * them `retryable:false` because a second identical request answers the same
 * thing forever, so a «Try again» under them is a promise nobody can keep and a
 * generic «the server refused this operation» throws away the two doors that
 * ARE open — sign in with the wallet that controls the address (a signed-in
 * wallet proves itself and needs no stored record), or have an administrator
 * repair the row.
 */
function deterministicProofRefusalView(
  refusal: SeatRefusalLike,
  code: string,
  t: Translate,
): SeatNoticeView | null {
  if (!DETERMINISTIC_PROOF_CODE_HEAD.test(code)) return null;
  const kind: SeatNoticeKind = code.startsWith('ACCOUNT_RECORD_MISSING')
    ? 'account-record-missing'
    : 'proof-floor-unreadable';
  const external = seatRefusalModule as unknown as Record<string, unknown>;
  for (const name of [
    'describeDeterministicProofRefusal',
    'describeProofRecordRefusal',
    'describeAccountRecordRefusal',
  ]) {
    const fn = external[name];
    if (typeof fn !== 'function') continue;
    try {
      const answer = (fn as (x: unknown, tt: Translate) => unknown)(refusal, t);
      const said = sentenceOf(answer);
      if (said) {
        return {
          kind,
          code,
          text: said,
          mayRetryFreeingSeat: false,
          mayFreeSeat: false,
          mayTryAgain: false,
          // The helper may say so itself; these two codes mean it either way —
          // a signed-in wallet proves itself and needs no stored record.
          maySignInWithWallet: signInDoorOf(answer),
        };
      }
    } catch {
      /* a helper that throws decides nothing: fall through to our own sentence */
    }
  }
  const text =
    kind === 'account-record-missing'
      ? t('We could not find the account record behind this session, so we cannot say which wallets are linked to it — and we will not guess. Waiting does not fix this. Nothing was prepared and nothing was signed, and your capital is where it was. Sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record — or write to us, and an administrator can restore the record.')
      : t('This account’s security record cannot be read, so we cannot tell which of your linked wallets were added before the account last changed hands, and guessing could hand it back to a previous holder. Waiting does not fix this, and linking the wallet again does not either. Nothing was prepared and nothing was signed, and your capital is where it was. Sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record — or write to us, and an administrator can repair the record.');
  return {
    kind,
    code,
    text,
    mayRetryFreeingSeat: false,
    mayFreeSeat: false,
    mayTryAgain: false,
    maySignInWithWallet: true,
  };
}

/**
 * Does this view (ours, or another agent's helper) name the wallet door?
 *
 * Read defensively, like every other cross-agent field here: `false` from a
 * helper is respected, and an older helper that says nothing still gets the
 * door, because over these two codes the door is what the SENTENCE promises.
 */
function signInDoorOf(answer: unknown): boolean {
  if (answer && typeof answer === 'object') {
    const said = (answer as { maySignInWithWallet?: unknown }).maySignInWithWallet;
    if (typeof said === 'boolean') return said;
  }
  return true;
}

/**
 *
 * CROSS-AGENT CONTRACT, READ DEFENSIVELY: the helper may arrive under any of
 * several names and return a string or a view. Whatever it returns, the sentence
 * inside it wins; when it is not there yet, the fallback below says the same
 * thing. Either way the person gets prose and a button, never a token.
 */
function transientRefusalView(
  refusal: SeatRefusalLike,
  code: string,
  t: Translate,
): SeatNoticeView | null {
  if (!TRANSIENT_CODE_HEAD.test(code)) return null;
  const retryAfter = retryAfterSecondsOf(refusal);
  const kind: SeatNoticeKind = code.startsWith('ACCOUNT_BUSY')
    ? 'busy'
    : code.startsWith('PROOF_FLOOR_AHEAD_OF_CLOCK')
      ? 'floor-ahead-of-clock'
      : 'store-unreadable';
  // What the SERVER said besides the sentence — read from the
  // refusal itself first, so a helper that has not learned them cannot lose them.
  const ownHeadline = headlineOf(refusal);
  const ownWays = waysOf(refusal);
  const external = (seatRefusalModule as unknown as Record<string, unknown>);
  for (const name of [
    'describeTransientRefusal',
    'describeRetryableRefusal',
    'describeBusyRefusal',
    'describeServiceRefusal',
    'transientRefusalView',
  ]) {
    const fn = external[name];
    if (typeof fn !== 'function') continue;
    try {
      const answer = (fn as (x: unknown, tt: Translate) => unknown)(refusal, t);
      const said = sentenceOf(answer);
      if (said) {
        // Their view may have measured the wait better than the raw refusal did.
        const after = retryAfterSecondsOf(answer) ?? retryAfter;
        const headline = ownHeadline ?? headlineOf(answer);
        const ways = ownWays.length > 0 ? ownWays : waysOf(answer);
        const door = walletDoorOf(answer, ways, kind);
        return {
          kind,
          code,
          text: said,
          mayRetryFreeingSeat: false,
          mayFreeSeat: false,
          mayTryAgain: true,
          ...(after !== null ? { retryAfterSeconds: after } : {}),
          ...(headline ? { headline } : {}),
          ...(ways.length > 0 ? { ways } : {}),
          ...(door ? { maySignInWithWallet: true } : {}),
        };
      }
    } catch {
      /* a helper that throws decides nothing: fall through to our own sentence */
    }
  }
  const text =
    kind === 'busy'
      ? t('Another request for this account is still being processed, so this one was not started. Nothing was prepared and nothing was signed — try again in a moment.')
      : kind === 'floor-ahead-of-clock'
        ? // Never «in a moment»: the server withheld the seconds on purpose.
          t('This account’s security record is dated ahead of our clock, so we cannot use it to confirm your wallet proofs yet, and re-linking the wallet would not help — a fresh link is dated now, which is still earlier. Nothing was prepared and nothing was signed. Try again later, or sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record — or write to us: an administrator can check that date.')
        : code.startsWith('DUPLICATE_CHECK_UNREADABLE')
          ? t('We could not check whether this had already been requested, and «could not check» is not «it is a duplicate». Nothing was prepared and nothing was signed — try again in a moment.')
          : t('We could not read what this account has on record, and «could not read» is not an answer about your money. Nothing was prepared and nothing was signed — try again in a moment.');
  const door = walletDoorOf(null, ownWays, kind);
  return {
    kind,
    code,
    text,
    mayRetryFreeingSeat: false,
    mayFreeSeat: false,
    mayTryAgain: true,
    ...(retryAfter !== null ? { retryAfterSeconds: retryAfter } : {}),
    ...(ownHeadline ? { headline: ownHeadline } : {}),
    ...(ownWays.length > 0 ? { ways: ownWays } : {}),
    ...(door ? { maySignInWithWallet: true } : {}),
  };
}

/** The server's short heading, from a refusal or from a helper's view. */
function headlineOf(x: unknown): string | null {
  if (!x || typeof x !== 'object') return null;
  const h = (x as { headline?: unknown }).headline;
  if (typeof h === 'string' && h.trim()) return h.trim();
  const body = (x as { body?: unknown }).body;
  return body && typeof body === 'object' ? headlineOf(body) : null;
}

/** The server's `ways[]`, strings only, deduplicated, in order — from wherever they travel. */
function waysOf(x: unknown): string[] {
  if (!x || typeof x !== 'object') return [];
  const raw = (x as { ways?: unknown }).ways;
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const w of raw) {
      if (typeof w !== 'string') continue;
      const trimmed = w.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  if (out.length > 0) return out;
  const body = (x as { body?: unknown }).body;
  return body && typeof body === 'object' ? waysOf(body) : [];
}

/**
 * Does this transient refusal have the wallet door?
 *
 * A helper that says `maySignInWithWallet` is respected either way. Without a
 * helper's word, the door exists when the ways name it — and always over the
 * clock refusal, whose ways (the server's, `provenAddresses.ts`) name it in
 * second place: a signed-in wallet proves itself and needs no stored record.
 */
function walletDoorOf(answer: unknown, ways: string[], kind: SeatNoticeKind): boolean {
  if (answer && typeof answer === 'object') {
    const said = (answer as { maySignInWithWallet?: unknown }).maySignInWithWallet;
    if (typeof said === 'boolean') return said;
  }
  if (kind === 'floor-ahead-of-clock') return true;
  return /\bsign in (again )?with (the|that|your) wallet\b/i.test(ways.join(' '));
}

/**
 * The refusal as a view, preferring the shared reader and never losing a code it
 * does not know yet.
 *
 * `mayFreeSeat` is taken as permission ONLY when the shared reader says `true`
 * (contract with the wallet layer: true only over a releasable draft). Anything
 * else — false, absent, an older module — is a no: silence is not permission.
 */
export function seatRefusalView(body: unknown, t: Translate): SeatNoticeView | null {
  const refusal = normalizeSeatRefusal(body);
  if (!refusal) return null;
  const code = (refusal.error ?? refusal.code ?? '').trim();
  // The two deterministic 409s are read BEFORE the shared
  // reader's generic fallbacks, so they can never degrade into «the server
  // refused this operation» over the one exit a person still has.
  const deterministic = deterministicProofRefusalView(refusal, code, t);
  if (deterministic) return deterministic;
  const shared = describeSeatRefusal(refusal, t);
  if (shared) {
    return {
      ...shared,
      mayFreeSeat: shared.mayFreeSeat === true && mayReleaseFromHere(shared.kind),
      // A seat whose window is open cannot be displaced from
      // here, and when the server did not measure that window there is no
      // countdown either — prose and nothing else. Asking again is the one
      // honest move left: the server decides from scratch, and a seat still
      // held still refuses. Never «Prepare it again», which would claim the
      // seat is free.
      ...(shared.kind === 'taken-window-open' && shared.secondsLeft === undefined
        ? { mayTryAgain: true }
        : {}),
      // AN UNREADABLE SEAT IS NOT A DEAD END, AND LEAST OF ALL ON
      // AN EXIT. The shared reader says «could not read … try again shortly» and
      // the screen offered nothing to try: no «Free the seat» (correct: we do
      // not know what we would be freeing) and no «Prepare it again» either, so
      // the owner of the money sat there for up to 30 minutes reading an
      // instruction the screen would not let them follow. Asking the server
      // again is not a bypass — it decides from scratch every time, and a seat
      // it still cannot read still refuses. The path forward is the retry, plus
      // the countdown when the server sent one.
      ...(shared.kind === 'unreadable' || refusal.retryable === true ? { mayTryAgain: true } : {}),
      ...(retryAfterSecondsOf(refusal) !== null
        ? { retryAfterSeconds: retryAfterSecondsOf(refusal) as number }
        : {}),
    };
  }
  // The shared reader does not know this code. Two families reach here: the
  // «server could not decide» 503s, and the wait — rendered as what it is, a
  // countdown, never a dead end and never a «Free the seat» button.
  const transient = transientRefusalView(refusal, code, t);
  if (transient) return transient;
  if (!SEAT_CODE_HEAD.test(code)) return null;
  const seconds = seatSecondsLeft(refusal);
  const head = t(
    'An earlier 0xFE payment of this account is holding the seat and its signing window is still open',
  );
  return {
    kind: 'taken-window-open',
    code,
    text:
      seconds !== null
        ? `${head} (≈${seconds} s). ${t('It frees itself when that window passes.')}`
        : `${head}. ${t('It frees itself when that window passes.')}`,
    mayRetryFreeingSeat: false,
    mayFreeSeat: false,
    ...(seconds !== null ? { secondsLeft: seconds } : {}),
  };
}

/**
 * The seat refusal in ONE English sentence, or null when it is not one.
 *
 * This is what every surface prints instead of the code and the Spanish
 * paragraph: the server's `detail` is never shown for a seat refusal — it is
 * written in Spanish, it carries hashes nobody can act on, and it contradicted
 * the headline above it.
 */
export function seatRefusalSentence(body: unknown, t: Translate): string | null {
  return seatRefusalView(body, t)?.text ?? null;
}

/** A number a server may or may not have sent. Only a positive, finite one counts. */
function positiveNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** The signing window the server said is still open, from wherever it travels. */
export function seatSecondsLeft(x: unknown): number | null {
  if (!x || typeof x !== 'object') return null;
  const direct = positiveNumber((x as { secondsLeft?: unknown }).secondsLeft);
  if (direct !== null) return direct;
  const body = (x as { body?: unknown }).body;
  if (body && typeof body === 'object') {
    return positiveNumber((body as { secondsLeft?: unknown }).secondsLeft);
  }
  return null;
}

/**
 * May this screen offer to free the seat, and with which memo?
 *
 * Two ways to know the memo of the draft holding the seat:
 *  · the server sent it (`memoHex` on the refusal) — it only sends it to the
 *    preparer or to a session that proved the account;
 *  · the draft is the one THIS screen just abandoned (`fallbackMemoHex`) — the
 *    R1 1.5 case: prepare, walk away, come back and try again.
 */
export function seatReleaseOffer(
  body: unknown,
  fallbackMemoHex?: string | null,
): { memoHex: string } | null {
  const refusal = normalizeSeatRefusal(body);
  if (!refusal) return null;
  // The server has just answered «not yet»: a button that asks it again can only
  // get the same answer, whatever kind the shared reader gives this code.
  if ((refusal.error ?? refusal.code ?? '').trim() === 'WAIT_FOR_PAYLOAD_EXPIRY') return null;
  const shared = describeSeatRefusal(refusal, (s) => s);
  if (!mayReleaseFromHere(shared?.kind ?? seatRefusalKind(refusal))) return null;
  const own = (refusal as { memoHex?: unknown }).memoHex;
  if (typeof own === 'string' && own.trim()) return { memoHex: own.trim() };
  const fallback = typeof fallbackMemoHex === 'string' ? fallbackMemoHex.trim() : '';
  return fallback ? { memoHex: fallback } : null;
}

/* ── what the release answered ────────────────────────────────────────────── */

export type SeatReleaseVerdict =
  /** The draft is superseded: the seat is free right now. */
  | { kind: 'freed'; text: string }
  /** Not yet — the payload can still be signed. It frees itself when it expires. */
  | { kind: 'wait'; secondsLeft: number | null; text: string }
  /** Nothing was freed: the payment holding the seat is ALREADY SIGNED. */
  | { kind: 'signed'; text: string }
  /** Nothing was freed: a signature was reported and the ledger has not seen it yet. */
  | { kind: 'reported'; text: string }
  /** Nothing to free: no unsigned payment is holding the seat under that reference. */
  | { kind: 'nothing-to-free'; text: string }
  /**
   * THE THIRD ANSWER, THE ONE THAT WAS MISSING.
   *
   * The release could not READ the state of the seat (the store threw, the
   * account was busy, the route answered 503). Nothing was freed and nothing
   * changed — but that is not «there was nothing to free», which is what this
   * function used to say about it, with «Prepare it again» underneath. That pair
   * of sentences is the twin: it tells a person the seat is empty on the exact
   * evidence that we do not know, and invites a second 0xFE onto a nonce that
   * may still be holding a signable payload.
   */
  | {
      kind: 'unknown';
      secondsLeft: number | null;
      text: string;
      /**
       * The release answered the proof store's «dated in the
       * future» 503. Still not settled (the clock moves), still never a licence
       * — but the sentence names a door, and the notice has to render it.
       */
      maySignInWithWallet?: true;
      ways?: string[];
    }
  /**
   * THE 409 THAT IS NOT A WAIT.
   *
   * `ACCOUNT_RECORD_MISSING` / `PROOF_FLOOR_UNREADABLE`: the account record
   * behind this session is gone or unreadable, so the release cannot tell whose
   * seat this is. Every 409 used to be read as «the payload can still be
   * signed», which over these two is a sentence about somebody else's payment
   * and a countdown that never ends. They say what they are, and the two real
   * doors, instead.
   */
  | { kind: 'proof-record'; text: string }
  /** The server said no, or never answered. Never its own words: they are Spanish. */
  | { kind: 'refused'; text: string };

/**
 * Verdicts after which pressing «Free the seat» again can achieve nothing.
 *
 * 'unknown' is deliberately NOT settled: the whole point of «we could not check»
 * is that asking again is the path forward.
 */
export function seatReleaseSettled(v: SeatReleaseVerdict | null): boolean {
  return v !== null && v.kind !== 'refused' && v.kind !== 'wait' && v.kind !== 'unknown';
}

/**
 * Does this 200 `{released:false}` carry a code that means «I could not read»?
 *
 * Matched by shape, not by an exhaustive list, so a code nobody has written
 * yet still lands on the honest side.
 */
function meansUnreadable(code: string | null): boolean {
  return code !== null && /UNREADABLE|UNKNOWN|BUSY|UNAVAILABLE|TIMEOUT/i.test(code);
}

/** The code a 200 `{released:false}` carries to say WHY nothing was freed. */
function releasedFalseCode(body: unknown): string | null {
  const code = (body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}

/**
 * The release answer, in English.
 *
 * A 409 is NOT a failure: it is the physics of the seat (R1 1.1) —
 * the payload holding it can still be signed, so nobody may displace it yet.
 * Saying that with the seconds left is the difference between a wait and a dead
 * end. The server's own `detail` is never printed: it is Spanish on several of
 * these routes, and the screens it lands on are in English.
 */
export function describeSeatRelease(
  r: HandoffPostResult,
  t: Translate,
  fallbackSeconds?: number | null,
): SeatReleaseVerdict | null {
  if (r.kind === 'skipped') return null;
  const seconds = seatSecondsLeft(r) ?? positiveNumber(fallbackSeconds) ?? null;
  if (r.kind === 'ok') {
    const released = (r.body as { released?: unknown } | undefined)?.released;
    if (released === false) {
      const code = releasedFalseCode(r.body);
      if (code === 'NONCE_SEAT_TAKEN_SIGNED') {
        return {
          kind: 'signed',
          text: t('Nothing was freed: that payment is already signed and waiting to execute. Its seat is not yours to take back — preparing another one on the same seat would create a twin that cannot land.'),
        };
      }
      if (code === 'NONCE_SEAT_TAKEN_REPORTED') {
        return {
          kind: 'reported',
          text: t('Nothing was freed: a signature for that payment was reported and the ledger has not validated it yet. Wait for it, or check that payment, before preparing another.'),
        };
      }
      // A 200 that says «I could not read» is not a 200 that says «there was
      // nothing»: the honest verdict is the third one.
      if (meansUnreadable(code)) return unknownRelease(t, retryAfterSecondsOf(r.body) ?? null);
      return {
        kind: 'nothing-to-free',
        text: t('There was nothing to free: no unsigned payment of yours is holding the seat under that reference.'),
      };
    }
    return { kind: 'freed', text: t('The seat is free. You can prepare this operation again.') };
  }
  if (r.kind === 'unreachable') {
    return {
      kind: 'refused',
      text: t('That request never reached the server, so the seat was not freed. Try again in a moment.'),
    };
  }
  // Not every 409 is the seat's physics. The two deterministic
  // proof refusals arrive with the same status and mean the opposite thing —
  // nobody is waiting for anything, and retrying changes nothing.
  const proofCode = DETERMINISTIC_PROOF_CODE_HEAD.exec(
    String(r.code ?? r.error ?? (r.body as { error?: unknown } | undefined)?.error ?? '').trim(),
  );
  if (proofCode) {
    const said = deterministicProofRefusalView({ error: proofCode[1] }, proofCode[1], t);
    if (said) return { kind: 'proof-record', text: said.text };
  }
  if (r.status === 409) return { kind: 'wait', secondsLeft: seconds, text: waitText(t, seconds) };
  // THE 503 THAT IS NOT «WE COULD NOT READ THE SEAT». The row WAS read; its date is ahead of our
  // clock; the wait may be 2099. Not settled (the clock moves), never a
  // licence, and it names the two doors that do work.
  const clockCode = String(r.code ?? r.error ?? (r.body as { error?: unknown } | undefined)?.error ?? '').trim();
  if (clockCode === 'PROOF_FLOOR_AHEAD_OF_CLOCK') {
    const said = transientRefusalView({ error: clockCode }, clockCode, t);
    if (said) {
      return {
        kind: 'unknown',
        secondsLeft: null,
        text: said.text,
        maySignInWithWallet: true,
        ...(said.ways && said.ways.length > 0 ? { ways: said.ways } : {}),
      };
    }
  }
  // It used to
  // be a 200 «nothing freed», which this screen read as «nothing to free» and
  // answered with «Prepare it again». A 5xx here means the server did not
  // decide, so neither do we: it is a retry, never a licence.
  if (r.status >= 500 || meansUnreadable(r.code ?? r.error ?? null)) {
    return unknownRelease(t, retryAfterSecondsOf(r) ?? null);
  }
  return {
    kind: 'refused',
    text: t('The seat could not be freed from here. It frees itself when the signing window of the payment holding it passes.'),
  };
}

/**
 * WHEN «PREPARE IT AGAIN» IS AN HONEST OFFER.
 *
 * Exactly two things earn it: the server SAID the seat is gone (it freed it, or
 * there was nothing queued under that memo), or the signing window the server
 * itself measured has run out. A wait has not run out yet, and «we could not
 * check» is the one answer that never becomes permission — reading it as
 * «nothing to free» and offering a fresh prepare is how a second 0xFE lands on
 * a nonce that may still be holding a signable payload.
 *
 * Pure, and exported, because it is the sentence that decides whether a twin
 * can be built from this screen.
 */
export function mayPrepareAgainAfterRelease(
  verdict: SeatReleaseVerdict | null,
  windowPassed: boolean,
): boolean {
  if (verdict?.kind === 'freed' || verdict?.kind === 'nothing-to-free') return true;
  if (verdict?.kind === 'wait' || verdict?.kind === 'unknown') return false;
  return windowPassed;
}

/**
 * Did the server DECIDE anything here, or only fail to look?
 *
 * A busy account, an unreadable store and an unreadable seat are all «we did not
 * decide»: no seat was read, so no number that travels with them is a signing
 * window and nothing about them licenses a second payment — or forbids asking
 * again right now.
 */
export function undecidedSeatKind(kind: SeatNoticeKind | null | undefined): boolean {
  return kind === 'busy' || kind === 'store-unreadable' || kind === 'floor-ahead-of-clock' || kind === 'unreadable';
}

/**
 * HOW LONG A «TRY AGAIN» CANNOT POSSIBLY WORK FOR.
 *
 * `null` ⇒ pressing it now is a real attempt. A number ⇒ the SERVER measured a
 * signing window that is still running, so re-preparing lands on the same held
 * seat and comes back with the same refusal: the button waits, and says for how
 * long, instead of teaching a person that the screen's buttons do nothing.
 *
 * Only a measured window blocks it. An `undecided` refusal measured nothing, and
 * a 503's `Retry-After` is advice, not a verdict — an exit is never gated on a
 * read of ours that failed.
 */
export function tryAgainWaitSeconds(
  kind: SeatNoticeKind | null | undefined,
  secondsLeft: number | null,
): number | null {
  if (undecidedSeatKind(kind)) return null;
  return secondsLeft !== null && secondsLeft > 0 ? secondsLeft : null;
}

function unknownRelease(t: Translate, seconds: number | null): SeatReleaseVerdict {
  const head = t('We could not check whether that seat is free, so nothing was freed and nothing changed. That is not «there was nothing to free» — try again in a moment');
  return {
    kind: 'unknown',
    secondsLeft: seconds,
    text: seconds !== null ? `${head} (≈${seconds} s).` : `${head}.`,
  };
}

function waitText(t: Translate, seconds: number | null): string {
  const head = t('Not yet: the payment holding the seat can still be signed. The seat frees itself when that signing window passes');
  return seconds !== null ? `${head} (≈${seconds} s).` : `${head}.`;
}

/* ── a signature that arrived too late ────────────────────────────────────── */

/** `tefPAST_SEQ` / `tefMAX_LEDGER` as they travel: a property, a verdict, or text. */
const XRPL_RESULT_CODE = /\b(?:tec|tef|tel|tem|ter|tes)[A-Z][A-Z_]*\b/;

function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (!e || typeof e !== 'object') return '';
  const x = e as { name?: unknown; shortMessage?: unknown; details?: unknown; message?: unknown };
  return [x.name, x.shortMessage, x.details, x.message]
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .join(' · ');
}

/**
 * The XRPL result code of a signature that can never validate, or null.
 *
 * Xaman submits the payload itself (`submit: true`) and re-wraps whatever the
 * node answered into a plain `Error` whose message carries the code in
 * parentheses, so the code is read from the text as well as from the properties
 * a richer rail attaches (`xrplResult`, a `SingleSignVerdict`).
 */
export function staleSignatureCode(e: unknown): string | null {
  if (!e) return null;
  const direct = (e as { xrplResult?: unknown }).xrplResult;
  if (typeof direct === 'string' && isStaleDispatch(direct)) return direct;
  const verdict = (e as { verdict?: { kind?: unknown; code?: unknown } }).verdict;
  if (verdict && verdict.kind === 'stale' && typeof verdict.code === 'string') return verdict.code;
  const found = XRPL_RESULT_CODE.exec(errorText(e));
  return found && isStaleDispatch(found[0]) ? found[0] : null;
}

/** Whatever shape another agent's helper returns, the sentence inside it. */
function sentenceOf(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (!v || typeof v !== 'object') return null;
  const o = v as { stale?: unknown; text?: unknown; message?: unknown; sentence?: unknown };
  if (o.stale === false) return null;
  for (const candidate of [o.text, o.message, o.sentence]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * «This prepared transaction can no longer be used — prepare it again», or null
 * when the failure is not that.
 *
 * Prefers `describeStaleHandoff` from the wallet layer when that module grows
 * one (cross-agent contract), and otherwise decides here. Either way the
 * surface gets ONE sentence and the right to offer a fresh prepare — never «we
 * could not confirm it, reload the page», which is what every 0xFE surface said
 * to a payload that provably never landed.
 */
export function describeStaleSignature(
  e: unknown,
  t: Translate,
): { code: string | null; text: string } | null {
  const external = (signOutcomeModule as unknown as Record<string, unknown>).describeStaleHandoff;
  if (typeof external === 'function') {
    try {
      const said = sentenceOf((external as (x: unknown, tt: Translate) => unknown)(e, t));
      if (said) return { code: staleSignatureCode(e), text: said };
    } catch {
      /* a helper that throws decides nothing: fall through to our own reading */
    }
  }
  const code = staleSignatureCode(e);
  if (!code) return null;
  return { code, text: `${t(STALE_TX_MESSAGE)} (${code}).` };
}

/** The same question as a boolean, for a branch that only needs to choose. */
export function isStaleSignature(e: unknown): boolean {
  return describeStaleSignature(e, (s) => s) !== null;
}

/* ── the notice ───────────────────────────────────────────────────────────── */

export interface SeatRefusalNoticeProps {
  /** The refused response body (or a `Refusal`). Not a seat refusal ⇒ renders nothing. */
  refusal: unknown;
  t: Translate;
  /** The memo of the draft THIS screen prepared and abandoned, when it has one. */
  fallbackMemoHex?: string | null;
  /** Offered once the seat is free (or its window has run out). */
  onPrepareAgain?: () => void;
  className?: string;
}

export function SeatRefusalNotice({
  refusal,
  t,
  fallbackMemoHex,
  onPrepareAgain,
  className,
}: SeatRefusalNoticeProps) {
  const view = seatRefusalView(refusal, t);
  const offer = seatReleaseOffer(refusal, fallbackMemoHex);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<SeatReleaseVerdict | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  // The wait the server already told us about at the prepare, so the countdown
  // starts before anyone presses anything. A 503's `Retry-After` counts down the
  // same way — it is the only number those refusals carry (3.5).
  const declared = view?.secondsLeft ?? view?.retryAfterSeconds ?? seatSecondsLeft(refusal) ?? null;
  useEffect(() => {
    setLeft(declared);
    setVerdict(null);
  }, [declared, refusal]);

  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setInterval(() => setLeft((n) => (n === null ? null : Math.max(0, n - 1))), 1000);
    return () => clearInterval(id);
  }, [left]);

  if (!view) return null;

  // A refusal where the server did NOT decide: no seat was read, so no number
  // here is a signing window and nothing about it licenses a second payment.
  const undecided = undecidedSeatKind(view.kind);
  // Once the window the server declared has run out, preparing again is the
  // honest offer: the seat is nobody's any more. Only a window the server
  // actually measured counts — an `undecided` refusal measured nothing.
  const windowPassed = !undecided && left !== null && left <= 0;
  // After a settled answer — freed, already signed, reported, or
  // nothing queued under that memo — the button can achieve nothing, so it goes.
  // Offering it again would be the same broken promise a second time.
  const settled = seatReleaseSettled(verdict);
  // «we could not check» is not an answer, so the button stays
  // and says what it now does: ask again.
  const askAgain = verdict?.kind === 'unknown' || verdict?.kind === 'refused';
  // «Prepare it again» is offered when the seat is provably free (the release
  // said so, or there was nothing holding it), and over a signed or reported
  // seat ONLY once its signing window has passed — before that, a second
  // payment on the same seat is the twin. An unreadable release («unknown»)
  // grants nothing: it is the one answer that never becomes permission.
  const mayPrepareAgain = mayPrepareAgainAfterRelease(verdict, windowPassed);
  // NEVER A DEAD END ON AN EXIT. An unreadable seat, a busy
  // account or an unreadable store all have the same way forward: ask the
  // server again. That is not a bypass — it decides from scratch, and a seat it
  // still cannot read still refuses. The word is «Try again», never «Prepare it
  // again»: we are not claiming the seat is free.
  const mayTryAgain = Boolean(onPrepareAgain) && view.mayTryAgain === true && !mayPrepareAgain;
  // THE RELEASE IS OFFERED ONLY WHERE IT CAN DO SOMETHING.
  // While the server's own measurement says the payload holding the seat is
  // still signable, `/handoff/release` answers 409 by design: showing the
  // button then is a promise that can only come back as a refusal, under a
  // paragraph that already said so. It appears the moment that window runs out
  // — and immediately when the server never declared one, because then the only
  // way to learn is to ask.
  // One measurement, one meaning: the seconds that hide the release are the very
  // seconds a retry would waste (`tryAgainWaitSeconds`, pure and tested).
  const tryAgainBlockedFor = tryAgainWaitSeconds(view.kind, left);
  const liveWindow = tryAgainBlockedFor !== null;
  const mayOfferRelease = offer !== null && !settled && !liveWindow;
  // The ways on screen are the release's when it answered
  // with some (the clock 503), the prepare's otherwise. The wallet door is
  // rendered over either — a link, never a retry.
  const shownWays = verdict?.kind === 'unknown' && verdict.ways?.length ? verdict.ways : view.ways ?? [];
  const verdictNamesWalletDoor = verdict?.kind === 'unknown' && verdict.maySignInWithWallet === true;
  // A «TRY AGAIN» THAT COULD ONLY FAIL, AGAIN, ONE STATE OVER.
  //
  // Took «Free the seat» off the state where the release answers 409 by
  // design. The same promise survived here as a RETRY: over `taken-retryable`
  // with the server's own `secondsLeft`, `mayTryAgain` is true (the refusal
  // carries `retryable: true`) while `mayOfferRelease` is false (a live window
  // hides it) — so the only button on screen re-prepared into the very seat the
  // paragraph above says is held for N more seconds. It came back with the same
  // NONCE_SEAT_TAKEN every time, under a countdown that already said it would.

  async function free() {
    if (!offer || busy) return;
    setBusy(true);
    try {
      const answer = await releaseHandoffSeatResult(offer.memoHex);
      const said = describeSeatRelease(answer, t, left);
      setVerdict(said);
      if (said?.kind === 'wait') setLeft(said.secondsLeft);
      if (said?.kind === 'unknown') setLeft(said.secondsLeft);
      if (said?.kind === 'freed' || said?.kind === 'nothing-to-free') setLeft(0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="alert"
      className={
        className ??
        'space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5'
      }
    >
      {/* The server's short heading, when it sent one and it
          is not the sentence itself. Never invented. */}
      {view.headline && view.headline !== view.text ? (
        <p className="text-[12px] font-medium leading-relaxed text-tone-warning">{view.headline}</p>
      ) : null}
      <p className="text-[12px] leading-relaxed text-tone-warning">{view.text}</p>
      {/* The REAL ways forward the server named, in its order —
          «try again later», «sign in with the wallet…», «write to us». A list,
          because a way is something to do, not a clause at the end of a
          paragraph; it was the part the clock refusal lost on this screen. */}
      {shownWays.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-ink/70">
          {shownWays.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {verdict ? <p className="text-[11px] leading-relaxed text-ink/60">{verdict.text}</p> : null}
      {!verdict && left !== null && left > 0 ? (
        <p className="text-[11px] leading-relaxed text-ink/60">
          {undecided
            ? `${t('You can try again in')} ≈${left} s.`
            : `${t('It frees itself when that signing window passes')} (≈${left} s).`}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {mayOfferRelease ? (
          <button
            type="button"
            onClick={() => void free()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1.5 text-[12px] font-medium text-ink/80 disabled:opacity-40"
            title={t('Only frees a payment that was never signed')}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {askAgain ? t('Try again') : t('Free the seat')}
          </button>
        ) : null}
        {onPrepareAgain && mayTryAgain ? (
          <button
            type="button"
            onClick={onPrepareAgain}
            disabled={tryAgainBlockedFor !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1.5 text-[12px] font-medium text-ink/80 disabled:opacity-40"
          >
            {/* While the server's own window is still running this
                can only come back refused, so the button waits — and says what it
                is waiting for, instead of looking broken. */}
            {tryAgainBlockedFor !== null
              ? `${t('Try again in')} ≈${tryAgainBlockedFor} s`
              : t('Try again')}
          </button>
        ) : null}
        {onPrepareAgain && mayPrepareAgain ? (
          <button
            type="button"
            onClick={onPrepareAgain}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
          >
            {t('Prepare it again')}
          </button>
        ) : null}
        {/* The two deterministic 409s used to end here with nothing
            at all — a paragraph naming a door and no way to walk through it, for
            the one profile (email / Google, no proven binding) that meets them.
            This is that door. It asks the server for nothing and claims nothing
            about the seat: it is a link to where a wallet signs itself in. */}
        {view.maySignInWithWallet || verdict?.kind === 'proof-record' || verdictNamesWalletDoor ? (
          <a
            href={WALLET_SIGN_IN_HREF}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
          >
            {t('Sign in with your wallet')}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/* ── the same, for a signature that arrived too late ──────────────────────── */

export function StaleSignatureNotice({
  error,
  t,
  onPrepareAgain,
  className,
}: {
  error: unknown;
  t: Translate;
  onPrepareAgain?: () => void;
  className?: string;
}) {
  const said = describeStaleSignature(error, t);
  if (!said) return null;
  return (
    <div
      role="alert"
      className={
        className ??
        'space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5'
      }
    >
      <p className="text-[12px] leading-relaxed text-tone-warning">{said.text}</p>
      {onPrepareAgain ? (
        <button
          type="button"
          onClick={onPrepareAgain}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
        >
          {t('Prepare it again')}
        </button>
      ) : null}
    </div>
  );
}

/* ── the seat a cancelled payload is still holding ────────────────────────── */

/**
 * REJECTING IN XAMAN DOES NOT FREE THE SEAT, AND NOTHING
 * SAID SO.
 */
export function AbandonedSeatNotice({
  memoHex,
  t,
  secondsLeft,
  stillSignable,
  onPrepareAgain,
  className,
}: {
  /** The memo of the draft this screen prepared and did not sign. */
  memoHex?: string | null;
  t: Translate;
  /** The window the server measured, when this screen has it. */
  secondsLeft?: number | null;
  /**
   * Is that very payload still on screen and signable?
   *
   * When it is, the sentence changes — sign it, or leave it and the window
   * frees it — and the button never says «Free the seat now»: freeing the seat
   * of a payload the person can still sign is how a signature that lands finds
   * its instruction superseded.
   */
  stillSignable?: boolean;
  /** Offered once the seat is provably free. */
  onPrepareAgain?: () => void;
  className?: string;
}) {
  const memo = (memoHex ?? '').trim();
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<SeatReleaseVerdict | null>(null);
  const [left, setLeft] = useState<number | null>(positiveNumber(secondsLeft));

  useEffect(() => {
    setLeft(positiveNumber(secondsLeft));
    setVerdict(null);
  }, [secondsLeft, memo]);

  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setInterval(() => setLeft((n) => (n === null ? null : Math.max(0, n - 1))), 1000);
    return () => clearInterval(id);
  }, [left]);

  if (!memo) return null;

  // The minutes the SERVER stamps on the payload, when the wallet layer knows
  // them; its own default otherwise. «About», never an exact promise.
  const readExpiry = (handoffReleaseModule as unknown as Record<string, unknown>).payloadExpiryMin;
  const minutes = typeof readExpiry === 'function' ? positiveNumber((readExpiry as () => unknown)()) : null;

  // A window the SERVER measured — either the one this screen was handed or the
  // one the release answered with. Only that kind of number counts down here.
  const liveWindow = left !== null && left > 0;
  const windowPassed = left !== null && left <= 0;
  const settled = seatReleaseSettled(verdict);
  const askAgain = verdict?.kind === 'unknown' || verdict?.kind === 'refused';
  const mayPrepareAgain = mayPrepareAgainAfterRelease(verdict, windowPassed);
  // The ask is hidden only while a MEASURED window says the
  // payload is still signable — waiting is a real path when there is a clock to
  // watch. With no clock (which is every caller today) the ask is the path, and
  // the server refuses to free anything that can still be signed.
  const mayAsk = !settled && !(stillSignable && liveWindow);

  async function free() {
    if (busy) return;
    setBusy(true);
    try {
      const said = describeSeatRelease(await releaseHandoffSeatResult(memo), t, left);
      setVerdict(said);
      if (said?.kind === 'wait' || said?.kind === 'unknown') setLeft(said.secondsLeft);
      if (said?.kind === 'freed' || said?.kind === 'nothing-to-free') setLeft(0);
    } finally {
      setBusy(false);
    }
  }

  const head = stillSignable
    ? t('Nothing was signed yet. That prepared payment is still holding this account’s nonce seat, so a second one cannot be prepared while it lives')
    : t('Nothing was signed. The payment you prepared is still holding this account’s nonce seat, so preparing another one now would be refused');
  const windowLine =
    left !== null && left > 0
      ? `${t('It frees itself when its signing window passes')} (≈${left} s).`
      : minutes !== null
        ? `${t('It frees itself when its signing window passes')} (≈${minutes} min).`
        : t('It frees itself when its signing window passes.');
  const when = stillSignable ? `${t('Sign it, or leave it.')} ${windowLine}` : windowLine;

  return (
    <div
      role="alert"
      className={
        className ?? 'space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2.5'
      }
    >
      <p className="text-[12px] leading-relaxed text-tone-warning">{head}.</p>
      <p className="text-[11px] leading-relaxed text-ink/60">{verdict ? verdict.text : when}</p>
      {/* The release's own ways forward, when it named some
          (the clock 503) — a list, not a clause. */}
      {verdict?.kind === 'unknown' && verdict.ways?.length ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-ink/70">
          {verdict.ways.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      {/* Once the server has measured the window, the wait is a
          clock and not a paragraph — the verdict's own sentence froze the
          number it was written with. Only a wait counts down; a 503's
          `Retry-After` is not a signing window and never pretends to be. */}
      {verdict?.kind === 'wait' && liveWindow ? (
        <p className="text-[11px] leading-relaxed text-ink/60">
          {t('It frees itself when its signing window passes')} (≈{left} s).
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {mayAsk ? (
          <button
            type="button"
            onClick={() => void free()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1.5 text-[12px] font-medium text-ink/80 disabled:opacity-40"
            title={
              stillSignable
                ? t('Asks the server. It never frees a payment that can still be signed — it answers with how long is left.')
                : t('Only frees a payment that was never signed')
            }
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : null}
            {askAgain
              ? t('Try again')
              : stillSignable && !windowPassed
                ? t('Check whether the seat is free')
                : t('Free the seat now')}
          </button>
        ) : null}
        {onPrepareAgain && mayPrepareAgain ? (
          <button
            type="button"
            onClick={onPrepareAgain}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
          >
            {t('Prepare it again')}
          </button>
        ) : null}
        {/* The release answered with one of the two deterministic
            409s — the account record behind this session is gone or unreadable.
            That verdict is settled (asking again answers the same thing forever)
            so every button above disappears, and this state used to end as a
            paragraph with nothing under it. The sentence names a door; here it
            is. */}
        {verdict?.kind === 'proof-record' ? (
          <a
            href={WALLET_SIGN_IN_HREF}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
          >
            {t('Sign in with your wallet')}
          </a>
        ) : verdict?.kind === 'unknown' && verdict.maySignInWithWallet ? (
          // The release answered the clock 503 — the same
          // door, same link, over a verdict that is NOT settled (the clock
          // moves), so «Try again» stays beside it.
          <a
            href={WALLET_SIGN_IN_HREF}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-medium"
          >
            {t('Sign in with your wallet')}
          </a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * seatRefusal — WHAT THE SERVER MEANT WHEN IT SAID «THE SEAT IS TAKEN».
 *
 * . A 0xFE instruction takes the nonce seat of its
 * Personal Account, and a prepare that finds the seat occupied is refused. Until
 * now every one of those refusals arrived as the same code (`NONCE_SEAT_TAKEN`)
 * and OperatorConsole answered all of them with ONE button: «Retry, freeing the
 * seat». That button asks the server to DISPLACE the draft holding the seat, so
 * offering it over a seat held by a SIGNED payment invites a twin that must die
 * `InvalidNonce` with its carrier — and over a draft of another member (or one
 * older than the deploy) it simply loops, because the server will refuse the
 * displacement every time.
 */
import { releaseHandoffSeatResult, type HandoffPostResult } from '../wallet/handoffRelease';
import { namesWalletSignIn, reserveRefusalWays } from '../errors/serverRefusal';

export type SeatRefusalKind =
  /** An unsigned draft this session may displace («Retry, freeing the seat»). */
  | 'taken-retryable'
  /** An unsigned draft this session may NOT displace: its window is still open. */
  | 'taken-window-open'
  /**
   * THE 409 THE SCREEN USED TO PRINT AS A CODE.
   *
   * `/handoff/release` answers `WAIT_FOR_PAYLOAD_EXPIRY` when the payload holding
   * the seat CAN STILL BE SIGNED: displacing it now is precisely what creates the
   * twin (R1 1.1), so the honest answer is a wait with its seconds. It
   * was not in `SEAT_CODES`, so `describeSeatRefusal` returned null over it and
   * the surfaces fell through to printing the slug.
   *
   * It is NEVER releasable: that is the whole point of the refusal.
   */
  | 'wait-payload-expiry'
  /** Already signed and waiting to execute. */
  | 'signed'
  /** Its signature was reported; the ledger has not validated it yet. */
  | 'reported'
  /** The ledger could not be read to decide. */
  | 'unreadable'
  /** An Astryum operational account: this hand-off is not prepared from here. */
  | 'operational-account';

/** The shape of a refusal this reads — `Refusal` (lib/institutional/api) fits it. */
export interface SeatRefusalLike {
  error?: string | null;
  /**
   * Some routes name the code `code` instead of `error`. Read
   * both, or the same refusal is prose on one screen and a raw token on another.
   */
  code?: string | null;
  detail?: string | null;
  /** true ⇔ this session may free the seat by displacing the draft that holds it. */
  retryable?: boolean | null;
  /** How long the draft's signing window still has, when the server said so. */
  secondsLeft?: number | null;
  /**
   * The memo of the 0xFE that HOLDS the seat — sent ONLY to the
   * session that prepared it or that proves the account, because it names a
   * payment. With it the person can free their own seat instead of waiting out
   * a window they own.
   */
  memoHex?: string | null;
  /** The ledger the draft dies at, when the server said so (diagnostic only). */
  lastLedgerSequence?: number | null;
}

export interface SeatRefusalView {
  kind: SeatRefusalKind;
  /** The code the server really sent (never rendered raw; for bookkeeping). */
  code: string;
  /** The sentence for the person, already translated. */
  text: string;
  /**
   * May the surface offer «Retry, freeing the seat»? ONLY for an unsigned draft
   * the server said this session can displace — never for a signed, reported or
   * unreadable seat, and never when `retryable` is absent (an older backend that
   * cannot tell us: silence is not permission).
   */
  mayRetryFreeingSeat: boolean;
  /** The 0xFE holding the seat, when the server told THIS session which it is. */
  memoHex?: string;
  /**
   * May the surface offer «Free the seat»? Only when the server handed us the
   * memo (it does that only for the preparer or for a session that proves the
   * account) AND the seat is an unsigned draft. A signed or reported seat is
   * never freed from a screen: its payment may still land.
   */
  mayFreeSeat: boolean;
  /** How long the draft's window still has, rounded to whole seconds. */
  secondsLeft?: number;
}

const SEAT_CODES: Record<string, SeatRefusalKind | 'taken'> = {
  NONCE_SEAT_TAKEN: 'taken',
  NONCE_SEAT_TAKEN_SIGNED: 'signed',
  NONCE_SEAT_TAKEN_REPORTED: 'reported',
  NONCE_SEAT_UNREADABLE: 'unreadable',
  OPERATIONAL_ACCOUNT_HANDOFF_REFUSED: 'operational-account',
  // The release's own 409. Same vocabulary as the prepare's
  // refusals, so a surface that shows one shows the other.
  WAIT_FOR_PAYLOAD_EXPIRY: 'wait-payload-expiry',
};

/**
 * The codes whose seat is an UNSIGNED DRAFT — the only ones a release may free.
 *
 * Said once, and read by both `describeSeatRefusal` (which offers the button)
 * and `freeSeatOfRefusal` (which presses it), because the round where those two
 * disagreed is the round a signed payment was offered a «Free the seat».
 * `_SIGNED` and `_REPORTED` may still land; `_UNREADABLE` is «I could not read»,
 * which is never «it is free»; `wait-payload-expiry` is the server saying NO to
 * this very release.
 */
const RELEASABLE_DRAFT_KINDS: ReadonlySet<SeatRefusalKind> = new Set<SeatRefusalKind>([
  'taken-retryable',
  'taken-window-open',
]);

/** Is the seat of this refusal an unsigned draft a release could free? */
export function seatIsReleasableDraft(r: SeatRefusalLike | null | undefined): boolean {
  const kind = seatRefusalKind(r);
  return kind !== null && RELEASABLE_DRAFT_KINDS.has(kind);
}

/** The code this refusal really carries: the `error`/`code`, or the prefix of an older `detail`. */
export function seatRefusalCode(r: SeatRefusalLike | null | undefined): string | null {
  const code = ((r?.error ?? r?.code) ?? '').trim();
  if (!code || !(code in SEAT_CODES)) return null;
  if (code !== 'NONCE_SEAT_TAKEN') return code;
  // Older routes: one code for every case, the real one at the head of `detail`.
  const head = (r?.detail ?? '').trim().match(/^(NONCE_SEAT_TAKEN_SIGNED|NONCE_SEAT_TAKEN_REPORTED|NONCE_SEAT_UNREADABLE)\b/);
  return head ? head[1] : code;
}

export function isSeatRefusal(r: SeatRefusalLike | null | undefined): boolean {
  return seatRefusalCode(r) !== null;
}

export function seatRefusalKind(r: SeatRefusalLike | null | undefined): SeatRefusalKind | null {
  const code = seatRefusalCode(r);
  if (code === null) return null;
  const kind = SEAT_CODES[code];
  if (kind !== 'taken') return kind;
  return r?.retryable === true ? 'taken-retryable' : 'taken-window-open';
}

/** Only an unsigned draft the server said this session may displace. */
export function mayRetryFreeingSeat(r: SeatRefusalLike | null | undefined): boolean {
  return seatRefusalKind(r) === 'taken-retryable';
}

/**
 * The refusal, said in one sentence — or null when it is not a seat refusal at
 * all (the caller keeps its own rendering: a cage verdict is not this).
 */
export function describeSeatRefusal(
  r: SeatRefusalLike | null | undefined,
  t: (s: string) => string,
): SeatRefusalView | null {
  const kind = seatRefusalKind(r);
  if (kind === null) return null;
  const seconds = typeof r?.secondsLeft === 'number' && Number.isFinite(r.secondsLeft) && r.secondsLeft > 0
    ? Math.round(r.secondsLeft)
    : null;
  let text: string;
  switch (kind) {
    case 'taken-retryable':
      text = t('An earlier 0xFE payment of this account is holding the seat and nobody signed it. You can free the seat and prepare this one instead — only if that earlier payment was never signed.');
      break;
    case 'taken-window-open':
      text = seconds !== null
        ? `${t('An earlier 0xFE payment of this account is holding the seat and its signing window is still open')} (≈${seconds} s). ${t('Wait for it, or cancel that request where it was prepared — it cannot be displaced from here.')}`
        : t('An earlier 0xFE payment of this account is holding the seat and its signing window is still open. Wait for it, or cancel that request where it was prepared — it cannot be displaced from here.');
      break;
    case 'wait-payload-expiry':
      // The server refused THIS release because the payload can still be signed.
      // Saying so with the seconds is the difference between a wait and a dead end.
      text = seconds !== null
        ? `${t('Not yet: the payment holding this seat can still be signed, so it cannot be displaced. The seat frees itself when that signing window passes')} (≈${seconds} s).`
        : t('Not yet: the payment holding this seat can still be signed, so it cannot be displaced. The seat frees itself when that signing window passes.');
      break;
    case 'signed':
      text = t('An earlier 0xFE payment of this account is already signed — wait for it to execute. Preparing another one now would create a twin that cannot land, and it would lose its carrier.');
      break;
    case 'reported':
      text = t('A signature for an earlier 0xFE payment of this account was reported and the ledger has not validated it yet — wait for it, or check that payment, before preparing another.');
      break;
    case 'unreadable':
      text = t('The ledger could not be read to tell whether this seat is free, and «could not read» is not «free» — try again shortly.');
      break;
    case 'operational-account':
      text = t('This is an Astryum operational account: this operation is not prepared for it from this screen.');
      break;
  }
  const memoHex = typeof r?.memoHex === 'string' && /^[0-9A-Fa-f]{4,}$/.test(r.memoHex.trim())
    ? r.memoHex.trim().toUpperCase()
    : undefined;
  // The seat is an unsigned DRAFT in exactly two cases; a signed or reported one
  // may still land, an unreadable ledger is not a «no» (invariant: «no pude
  // leer» is never «it is free»), and `wait-payload-expiry` is the server having
  // just refused this very release. One set, shared with `freeSeatOfRefusal`.
  const isDraft = RELEASABLE_DRAFT_KINDS.has(kind);
  return {
    kind,
    code: seatRefusalCode(r) ?? '',
    text: memoHex && isDraft
      ? `${text} ${t('It is your own prepared payment, so you can free its seat here.')}`
      : text,
    mayRetryFreeingSeat: kind === 'taken-retryable',
    ...(memoHex ? { memoHex } : {}),
    mayFreeSeat: Boolean(memoHex) && isDraft,
    ...(seconds !== null ? { secondsLeft: seconds } : {}),
  };
}

/**
 * «FREE THE SEAT», WIRED.
 *
 * The seat of a 0xFE is released by its MEMO, and until now the memo never
 * reached the screen, so five surfaces could only print the refusal and tell the
 * person to wait ~604 s. When the server hands the memo to the session that
 * prepared the payment (or that proves the account), the offer becomes real and
 * this is the one call behind it — the same `releaseHandoffSeat` every abandoned
 * draft already uses, so a refusal to release still reaches the global banner.
 *
 * Returns false when there is nothing to free, so the caller renders no button.
 */
export async function freeSeatOfRefusal(r: SeatRefusalLike | null | undefined): Promise<boolean> {
  return (await freeSeatOfRefusalResult(r)).kind === 'freed';
}

/**
 * WHAT THE RELEASE ACTUALLY ANSWERED.
 *
 * `freeSeatOfRefusal` returned `res.kind === 'ok'`, and the route answers **200
 * `{released:false}`** in three cases where nothing was freed: no queued row
 * under that memo any more, the row is SIGNED (`NONCE_SEAT_TAKEN_SIGNED`), or a
 * signature was REPORTED for it. All three came back as `true` — the console
 * then told the person «the seat of your unsigned 0xFE was freed» over a payment
 * that is on its way to the ledger. And the opposite lie lived next door: a 200
 * `{released:false}` read as «it can still be signed», which is the 409's
 * sentence, not this one. A payment that is already signed is not waiting for
 * anybody.
 */
export type SeatReleaseOutcome =
  /** The draft was superseded: the seat is free right now. */
  | { kind: 'freed' }
  /**
   * 200 `{released:false}` — there was nothing to free. Either the draft is gone
   * already, or it is signed / reported and its payment may still land. NOT a
   * wait: nobody is going to sign it, and nobody may displace it either.
   */
  | { kind: 'nothing-to-free'; code?: string }
  /** 409 `WAIT_FOR_PAYLOAD_EXPIRY`: it can still be signed. The seconds, when sent. */
  | { kind: 'wait'; secondsLeft?: number }
  /**
   * «I COULD NOT READ» IS NOT
   * «NOTHING WAS FREED».
   *
   * The route used to swallow a database failure into 200 `{released:false}`,
   * which this module read as `nothing-to-free` — «no unsigned order of yours is
   * holding that seat any more» — and the screen then offered to prepare
   * another one, blind, over a seat that may still be held.
   */
  | {
      kind: 'unreadable';
      retryAfterSeconds?: number;
      /**
       * WHICH read failed. `/handoff/release` forwards the
       * proof store's 503s with their code and nothing else (`handoffOwnerRefusal`
       * drops `headline`/`ways`), and this outcome flattened every one of them
       * into «we could not read the state of that seat … try again in a
       * moment». Over `PROOF_FLOOR_AHEAD_OF_CLOCK` both halves are false: the
       * row WAS read (its date is ahead of our clock), and the wait may be 2099.
       * The code travels so the sentence can be the true one.
       */
      code?: string;
    }
  /** The server said no for another reason, or never answered. */
  | { kind: 'refused'; status?: number; code?: string }
  /** Nothing was even attempted: not a seat refusal, no memo, or not a draft. */
  | { kind: 'not-offered' };

export async function freeSeatOfRefusalResult(
  r: SeatRefusalLike | null | undefined,
): Promise<SeatReleaseOutcome> {
  const memoHex = typeof r?.memoHex === 'string' ? r.memoHex.trim() : '';
  if (!memoHex || !seatIsReleasableDraft(r)) return { kind: 'not-offered' };
  return readSeatRelease(await releaseHandoffSeatResult(memoHex));
}

/** The release's answer, classified. Pure — the round trip is the caller's. */
export function readSeatRelease(res: HandoffPostResult): SeatReleaseOutcome {
  if (res.kind === 'skipped') return { kind: 'not-offered' };
  if (res.kind === 'unreachable') return { kind: 'refused' };
  if (res.kind === 'ok') {
    const released = (res.body as { released?: unknown }).released;
    if (released === false) {
      const code = (res.body as { code?: unknown }).code;
      return { kind: 'nothing-to-free', ...(typeof code === 'string' && code ? { code } : {}) };
    }
    return { kind: 'freed' };
  }
  // 409 WAIT_FOR_PAYLOAD_EXPIRY — the one answer that really is a wait.
  if (res.status === 409 || res.code === 'WAIT_FOR_PAYLOAD_EXPIRY' || res.error === 'WAIT_FOR_PAYLOAD_EXPIRY') {
    return { kind: 'wait', ...(res.secondsLeft !== undefined ? { secondsLeft: res.secondsLeft } : {}) };
  }
  // 503 = the seat state could not be read. It
  // is neither «freed» nor «there was nothing there»: it is «ask me again».
  if (res.status === 503 || isUnreadableCode(res.code) || isUnreadableCode(res.error)) {
    const after = retryAfterSecondsOf(res.body);
    const code = [res.code, res.error, (res.body as { error?: unknown } | undefined)?.error].find(
      (c): c is string => typeof c === 'string' && c.trim().length > 0,
    );
    return {
      kind: 'unreadable',
      ...(after !== undefined ? { retryAfterSeconds: after } : {}),
      ...(code ? { code: code.trim() } : {}),
    };
  }
  return { kind: 'refused', status: res.status, ...(res.code ? { code: res.code } : {}) };
}

/** The one sentence each outcome deserves, already translated. */
export function seatReleaseSentence(o: SeatReleaseOutcome, t: (s: string) => string): string | null {
  switch (o.kind) {
    case 'freed':
      // «you can prepare this one now» PROMISED A RACE.
      // Freeing a seat does not reserve it: the very next prepare of this
      // account — another tab, another member, our own autopilot — may take it
      // first, and the person read a promise the server never made. The seat is
      // free; whether THIS one gets it is decided when they press the button.
      return t('The seat of your unsigned 0xFE was freed. It is not reserved for you — try preparing this one now; if it answers that the seat is taken, something else took it first.');
    case 'nothing-to-free':
      return o.code === 'NONCE_SEAT_TAKEN_SIGNED' || o.code === 'NONCE_SEAT_TAKEN_REPORTED'
        ? t('There was nothing to free: that payment is already signed and waiting to execute. Freeing its seat now would let a twin be signed on the same nonce — wait for it to land.')
        : t('There was nothing to free: no unsigned order of yours is holding that seat any more. Read this screen again before preparing another one.');
    case 'wait':
      return o.secondsLeft !== undefined
        ? `${t('Not yet: the payment holding the seat can still be signed. The seat frees itself when that signing window passes')} (≈${o.secondsLeft} s).`
        : t('Not yet: the payment holding the seat can still be signed. The seat frees itself when that signing window passes.');
    case 'unreadable':
      // The proof store's «dated in the future» refusal is
      // NOT «we could not read the seat». Its own sentence, its own three ways,
      // and never «in a moment» over a date that may be 2099.
      if (o.code === 'PROOF_FLOOR_AHEAD_OF_CLOCK') {
        return `${t(FLOOR_AHEAD_OF_CLOCK_TEXT)} ${reserveRefusalWays('PROOF_FLOOR_AHEAD_OF_CLOCK', t).join(' ')}`;
      }
      return o.retryAfterSeconds !== undefined
        ? `${t('We could not read the state of that seat just now, so we will not tell you it is free and we will not tell you it is taken either. Nothing was changed. Try again in about')} ${o.retryAfterSeconds} ${t('seconds.')}`
        : t('We could not read the state of that seat just now, so we will not tell you it is free and we will not tell you it is taken either. Nothing was changed. Try again in a moment.');
    case 'refused':
      return t('The seat could not be freed from here. It frees itself when the signing window of the payment holding it passes.');
    case 'not-offered':
      return null;
  }
}

/** Does this outcome leave the person a retry that is expected to work? */
export function seatReleaseRetryable(o: SeatReleaseOutcome): boolean {
  return o.kind === 'unreadable';
}

/* ── THE `seat` FIELD OF A WITHDRAWN PROPOSAL ──────────── */

/**
 * `POST /council/proposals/:id/withdraw` answers, with a
 * `seat` field in the SAME grammar as the ceremony's release
 * (`seatReleaseAnswer`, backend/src/services/flare/DirectMintHandoffStore.ts):
 * whether the 0xFE nonce seat of the proposal's bytes was handed back and, when
 * it was not, why — a live signing window with its seconds, a signature that
 * was reported and the ledger has not validated, or a read of ours that failed.
 * `ProposalInbox.withdraw` ignored the whole field: the proposer filed the
 * proposal, saw the list reload, and met `NONCE_SEAT_TAKEN` on the next exit
 * with no idea the withdraw had told them so.
 */
export interface WithdrawnSeatView {
  kind: 'freed' | 'held' | 'unreadable';
  /** The sentence for the person, already translated. */
  text: string;
  /** The server's own countdown, when it measured one. Never a client guess. */
  secondsLeft?: number;
}

export function describeWithdrawnSeat(
  seat: unknown,
  t: (s: string) => string,
): WithdrawnSeatView | null {
  if (!seat || typeof seat !== 'object') return null;
  const s = seat as Record<string, unknown>;
  if (s.released === true) {
    // Freed, and NOT reserved: the next prepare of this account
    // decides who gets it.
    return {
      kind: 'freed',
      text: t('The proposal is withdrawn and the nonce seat its payment was holding is free again. It is not reserved for you — the next exit this council composes may take it.'),
    };
  }
  const code = typeof s.code === 'string' ? s.code.trim() : '';
  const reason = typeof s.reason === 'string' ? s.reason : '';
  const seconds = retryAfterSecondsOf({ secondsLeft: s.secondsLeft });
  const said = serverDetailIfEnglish(typeof s.detail === 'string' ? s.detail : null);
  // «I could not read» is neither «freed» nor «held»: nothing changed, ask again.
  if (isUnreadableCode(code) || code === 'NONCE_SEAT_UNREADABLE' || (s.retryable === true && seconds === undefined && !code)) {
    return {
      kind: 'unreadable',
      text: t('The proposal is withdrawn, but we could not read whether the nonce seat its payment was holding is free again, and «could not read» is never «it is free». Nothing else changed — if the next exit answers that the seat is taken, this is why.'),
    };
  }
  if (code === 'NONCE_SEAT_TAKEN_SIGNED' || code === 'NONCE_SEAT_TAKEN_REPORTED') {
    return {
      kind: 'held',
      text: t('The proposal is withdrawn, but its payment was already signed or reported to the ledger, so its nonce seat stays taken: the ledger decides — it either shows that payment or closes its window. Do not compose another exit for this account until it does.'),
    };
  }
  // Nothing queued under those bytes any more: the seat is not held BY THEM.
  // Not a statement that it is free — another payment may hold it — so quiet.
  if (reason === 'not-found') return null;
  const head = t('The proposal is withdrawn, but the nonce seat its payment was holding is not free yet: it is measured by that payment’s own signing window and frees itself when the window passes. Composing another exit for this account before then will be refused.');
  const tail = said && !/^We have no record/.test(said) ? ` ${said}` : '';
  return {
    kind: 'held',
    text: seconds !== undefined ? `${head} (≈${seconds} s)${tail}` : `${head}${tail}`,
    ...(seconds !== undefined ? { secondsLeft: seconds } : {}),
  };
}

/* ── WHEN A CANCELLED PAYLOAD LETS GO OF ITS SEAT ──── */

/**
 * Rejecting in Xaman, or letting the request expire, leaves the 0xFE's nonce
 * seat held until its signing window passes — and NOTHING said so, so the next
 * prepare walked into a bare `NONCE_SEAT_TAKEN`. This is the
 * sentence for that moment, built from whatever the release actually answered:
 *   · freed     → the seat is free (and not reserved: see above);
 *   · wait      → the server's own `secondsLeft` — never a client-side guess;
 *   · unreadable→ a retry, never a verdict;
 *   · anything else → the honest generic: it frees itself when the window passes.
 *
 * Pure: the round trip belongs to the caller.
 */
export function seatFreesItselfSentence(
  o: SeatReleaseOutcome | null | undefined,
  t: (s: string) => string,
): string | null {
  if (!o || o.kind === 'not-offered') {
    return t('Nothing was signed. The instruction that was prepared still holds this account’s nonce seat until its signing window passes — preparing another one before then may answer that the seat is taken.');
  }
  if (o.kind === 'nothing-to-free') {
    // Said by `seatReleaseSentence` far better than a generic line would.
    return seatReleaseSentence(o, t);
  }
  return seatReleaseSentence(o, t);
}

/* ── THE 503s AND THE 409 NOBODY WAS READING ─── */

/** The refusal codes that mean «a read of OURS failed» — a wait, never a verdict. */
const UNREADABLE_CODES: ReadonlySet<string> = new Set([
  'ACCOUNT_BUSY',
  'PROOF_STORE_UNREADABLE',
  // The takeover mark parsed but is dated ahead of the server's clock —
  // not a verdict, a wait (the clock moves and nothing has to be written).
  'PROOF_FLOOR_AHEAD_OF_CLOCK',
  'SEAT_STATE_UNREADABLE',
  'SEAT_GUARD_UNREADABLE',
  'DUPLICATE_CHECK_UNREADABLE',
  'HANDOFF_SEAT_UNREADABLE',
  // The step-up's own 503. It is the SAME family — a
  // failure of ours with a `Retry-After` — and `translateError` used to flatten
  // it into «we couldn't reach the server», which blames the network for our
  // database and drops the retry the route promised.
  'STEP_UP_UNAVAILABLE',
  'COUNCIL_READ_UNREADABLE',
  // The two vault reads that used to answer with a GUESS instead of a
  // refusal — an unreadable `instantRedemptionFee()` became a fee of zero, and
  // an unreadable `paused()` became «this vault takes deposits». Both are now
  // 502s of this family, and both have to reach the person as «a read of ours
  // failed», never as the generic «the server refused this operation».
  'VAULT_FEE_UNREADABLE',
  'VAULT_STATE_UNREADABLE',
  // The reads that used to be swallowed into a ZERO and reached the
  // screen as «you hold nothing» / «your queue is empty». Same family: a
  // read of OURS failed, nothing was composed, nothing moved, ask again.
  'ISO_LEGS_UNREADABLE',
  'ISO_SUPPLY_UNREADABLE',
  'VAULT_CLAIMS_UNREADABLE',
  'PA_BALANCE_UNREADABLE',
  'DEMO_CAP_UNREADABLE',
  'BORROW_STATE_UNREADABLE',
  // The exchange's submission journal (which payments the omnibus key
  // already signed) could not be read. Same family: nothing was composed and
  // nothing moved; and it is NEVER a statement that the client's money is held —
  // a withdrawal does not depend on it unless an entry of theirs is pending.
  'SUBMISSION_JOURNAL_UNREADABLE',
]);

function isUnreadableCode(code: string | null | undefined): boolean {
  const raw = (code ?? '').trim();
  return raw.length > 0 && UNREADABLE_CODES.has(raw);
}

/** `Retry-After`-shaped seconds, from whichever field the route used. */
function retryAfterSecondsOf(body: Record<string, unknown> | null | undefined): number | undefined {
  for (const key of ['retryAfterSeconds', 'retryAfter', 'secondsLeft']) {
    const v = body?.[key];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
      const n = Number(v.trim());
      if (n > 0) return n;
    }
  }
  return undefined;
}

export interface RetryableRefusalLike {
  status?: number | null;
  error?: string | null;
  code?: string | null;
  detail?: string | null;
  retryable?: boolean | null;
  retryAfterSeconds?: number | null;
  /** 409 DUPLICATE_CHECK_UNREADABLE: the escape the server itself names. */
  confirmAnotherOrder?: boolean | null;
  /**
   * The proof store's refusals travel with a short `headline`
   * and the REAL `ways[]` forward (`provenAddresses.ts`); the routes send them
   * verbatim and this reader threw both away.
   */
  headline?: string | null;
  ways?: unknown;
  /** Everything the server answered, for the fields this shape does not name. */
  body?: Record<string, unknown> | null;
}

export interface RetryableRefusalView {
  /** The code the server sent — bookkeeping only, NEVER rendered raw. */
  code: string;
  /** The sentence for the person, already translated. */
  text: string;
  /** Offer a «Try again»? True for every one of these: they are all our failure. */
  mayRetry: boolean;
  /** Seconds the server asked us to wait, when it said (`Retry-After`). */
  retryAfterSeconds?: number;
  /**
   * 409 `DUPLICATE_CHECK_UNREADABLE` only: the server offers the explicit escape
   * «compose another order anyway». It is a SEPARATE decision from the retry and
   * must be rendered as one — a person saying «I know this order has not gone out».
   */
  mayConfirmAnotherOrder: boolean;
  /**
   * THE THREE FIELDS THIS VIEW DROPPED, OVER THE ONE REFUSAL
   * THAT NEEDED THEM.
   *
   * `PROOF_FLOOR_AHEAD_OF_CLOCK` (503, `retryable: true`, NO `retryAfterSeconds`)
   * arrives with a headline and three ways — «try again later», «sign in with
   * the wallet that controls this address», «write to us: an administrator can
   * check that date». This view kept the sentence, appended «Try again in a
   * moment.» to it, and the notice classified it as a generic transient: the
   * email user whose mark is dated 2099 read «re-linking would not help. Try
   * again in a moment», pressed «Try again», got the same 503, and never saw
   * the two doors that actually work. They travel now.
   */
  /** The server's short heading, when it sent one. Never invented. */
  headline?: string;
  /** The real ways forward: the server's, or the shared reserve for this code. */
  ways?: string[];
  /**
   * The wallet door — a signed-in wallet proves itself and needs no stored
   * record. True only when the ways (server's or reserve) name it. A link,
   * never a retry: nothing about it re-asks the server.
   */
  maySignInWithWallet?: boolean;
}

/** The clock refusal, in one sentence — shared by the prepare and the release paths. */
const FLOOR_AHEAD_OF_CLOCK_TEXT =
  'Your account record carries a date that is ahead of our clock, so we cannot use it to confirm your wallet proofs yet. This clears on its own once our clock passes that date — we will not put a number on when — and re-linking the wallet would not help: a fresh link is dated now, which is still earlier. Nothing was composed and nothing moved.';

/** `ways` as they travel: a list of sentences, strings only, deduplicated, in order. */
function waysOf(...candidates: unknown[]): string[] {
  const out: string[] = [];
  for (const ways of candidates) {
    if (!Array.isArray(ways)) continue;
    for (const w of ways) {
      if (typeof w !== 'string') continue;
      const trimmed = w.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
    if (out.length > 0) return out;
  }
  return out;
}

/**
 * A READER FOR THE THREE REFUSALS THAT HAD NONE.
 *
 * `ACCOUNT_BUSY` (503 + `Retry-After`), `PROOF_STORE_UNREADABLE` (503) and
 * `DUPLICATE_CHECK_UNREADABLE` (409) all reached the screens as nothing but the
 * server's Spanish-or-English `detail`, with no button: the retry the server had
 * gone to the trouble of promising was invisible (§2.7).
 */
export function describeRetryableRefusal(
  r: RetryableRefusalLike | null | undefined,
  t: (s: string) => string,
): RetryableRefusalView | null {
  const code = ((r?.error ?? r?.code) ?? '').trim();
  if (!code || !UNREADABLE_CODES.has(code)) return null;
  const retryAfterSeconds =
    (typeof r?.retryAfterSeconds === 'number' && Number.isFinite(r.retryAfterSeconds) && r.retryAfterSeconds > 0
      ? Math.round(r.retryAfterSeconds)
      : undefined) ?? retryAfterSecondsOf(r?.body ?? null);
  let text: string;
  switch (code) {
    case 'ACCOUNT_BUSY':
      text = t('Your account was busy for a moment — another change to it was being applied. Nothing was saved and nothing moved.');
      break;
    case 'PROOF_STORE_UNREADABLE':
      text = t('We could not read your wallet proofs just now, so we will not answer for them either way — and we will not take anything away from you because of it. Nothing was composed and nothing moved.');
      break;
    case 'PROOF_FLOOR_AHEAD_OF_CLOCK':
      text = t(FLOOR_AHEAD_OF_CLOCK_TEXT);
      break;
    case 'DUPLICATE_CHECK_UNREADABLE':
      text = t('We could not check whether this same order already went out minutes ago, so we did not compose a second one blindly. Nothing was composed and nothing moved — check the account on an explorer, or the order you last composed.');
      break;
    case 'SEAT_STATE_UNREADABLE':
    case 'HANDOFF_SEAT_UNREADABLE':
      text = t('We could not read whether an earlier instruction of this account is still holding its nonce seat, and «could not read» is never «it is free». Nothing was composed and nothing moved.');
      break;
    case 'SEAT_GUARD_UNREADABLE':
      text = t('We could not read this account’s proposal inbox, so we cannot tell you whether another payload is already holding its Sequence. Nothing was composed and nothing moved.');
      break;
    case 'COUNCIL_READ_UNREADABLE':
      text = t('We could not read which addresses you hold, so we will not answer for them either way — and we will not tell you that you are not on this council when the truth is that we could not look. Nothing was written and nothing moved.');
      break;
    case 'VAULT_FEE_UNREADABLE':
      // The sentence invariant #6 is owed: we could not read what
      // leaving costs, so we did not put a number in front of a signature.
      text = t('We could not read this vault’s exit fee just now, and a fee we could not look at is an unknown fee — never a zero. So we did not work out what you would receive and we composed nothing. Nothing was prepared and nothing was signed.');
      break;
    case 'VAULT_STATE_UNREADABLE':
      text = t('We could not read this vault’s live state just now — whether it is still taking deposits — and «we could not read it» is never «it is open». Nothing was composed and nothing moved.');
      break;
    case 'ISO_LEGS_UNREADABLE':
      text = t('We could not read your Kinetic position just now — what you supplied and what you owe — and «we could not read it» is never «you hold nothing». Nothing was composed and nothing moved.');
      break;
    case 'ISO_SUPPLY_UNREADABLE':
      // The sentence promised «enter the exact amount and it
      // composes» as if composing were the whole story. It is not: Kinetic
      // does not revert an oversized redeem, it RETURNS a code — the
      // transaction mines, gas is paid, nothing moves, and the wallet does not
      // warn. The exact-amount door stays open, and the sentence now says what
      // guards it: the dry-run verdict on the review step.
      text = t('We could not read how much FXRP you have supplied, so we will not compose an exit of «everything» against a number we do not have. An exact amount still composes — but with your balance unread we cannot check it, and Kinetic does not reject an oversized withdrawal: it returns a code, the transaction mines, you pay gas and nothing moves. Read the dry-run verdict on the review step before signing. Nothing moved.');
      break;
    case 'BORROW_STATE_UNREADABLE':
      text = t('We could not read your current debt or collateral in this market, so we will not size a loan against a number we could not check — an unread debt is an unknown debt, never a zero. Nothing was prepared and nothing was signed.');
      break;
    case 'VAULT_CLAIMS_UNREADABLE':
      text = t('We could not read the vault’s withdrawal queue just now. Anything you queued is still queued — this is never a statement that your queue is empty. Nothing moved.');
      break;
    case 'PA_BALANCE_UNREADABLE':
      text = t('We could not read the balance of your Personal Account just now, so we will not size a repayment against a number we do not have. Nothing was prepared and nothing was signed.');
      break;
    case 'DEMO_CAP_UNREADABLE':
      text = t('We could not read today’s daily quota just now, so we did not reserve anything against a number we do not have. Nothing was composed and nothing moved.');
      break;
    case 'STEP_UP_UNAVAILABLE':
      // The one sentence this refusal exists to say —
      // it is OURS, not the person's signature, and nothing was granted.
      text = t('We could not complete the security check just now — that is us, not your signature, and nothing was changed or granted.');
      break;
    case 'SUBMISSION_JOURNAL_UNREADABLE':
      // «could not read which of your payments is already signed» is not
      // «one is signed», and not «your money is held». Nothing was composed
      // because composing on top of a signed payment pays the same XRP twice.
      text = t('We could not read the exchange’s record of which of your payments were already signed, so we did not compose a new one on top of them — that could pay the same XRP twice. Nothing was changed and nothing moved; this is not a statement that your money is held.');
      break;
    default:
      text = t('A read of ours failed, so nothing was composed and nothing moved.');
  }
  // «in a moment» is a promise, and over a mark dated ahead of
  // our clock nobody can keep it — the server withholds `retryAfterSeconds` for
  // exactly that reason (it may be three seconds of skew or a corrupt 2099). So
  // that code says «later», and only a number the server sent becomes a number.
  const wait =
    retryAfterSeconds !== undefined
      ? `${t('Try again in about')} ${retryAfterSeconds} ${t('seconds.')}`
      : code === 'PROOF_FLOOR_AHEAD_OF_CLOCK'
        ? t('Try again later.')
        : t('Try again in a moment.');
  // The server's `headline` and `ways[]` when it sent them; the shared reserve
  // (ONE list per code, `lib/errors/serverRefusal`) when a route forwarded the
  // refusal bare. Never invented for a code the reserve does not know.
  const headline = [r?.headline, r?.body?.headline]
    .map((h) => (typeof h === 'string' ? h.trim() : ''))
    .find((h) => h.length > 0);
  const ways = waysOf(r?.ways, r?.body?.ways);
  const saidWays = ways.length > 0 ? ways : reserveRefusalWays(code, t);
  const maySignInWithWallet = namesWalletSignIn(saidWays);
  return {
    code,
    text: `${text} ${wait}`,
    mayRetry: true,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    mayConfirmAnotherOrder: code === 'DUPLICATE_CHECK_UNREADABLE' && r?.confirmAnotherOrder !== false,
    ...(headline ? { headline } : {}),
    ...(saidWays.length > 0 ? { ways: saidWays } : {}),
    ...(maySignInWithWallet ? { maySignInWithWallet: true } : {}),
  };
}

/** Is this refusal one of the «a read of ours failed» family? */
export function isRetryableReadFailure(r: RetryableRefusalLike | null | undefined): boolean {
  return isUnreadableCode((r?.error ?? r?.code) ?? null);
}

/* ── THE TWO 409s THAT HAD NO READER ───────────────── */

/**
 * `ACCOUNT_RECORD_MISSING` and `PROOF_FLOOR_UNREADABLE`
 * are the OPPOSITE of the family above: the stored account record is gone, or
 * its security block does not parse, and **waiting changes nothing**. That is
 * why they are 409 with `retryable:false` instead of the 503 they used to be.
 */
const DETERMINISTIC_PROOF_CODES: ReadonlySet<string> = new Set([
  'ACCOUNT_RECORD_MISSING',
  'PROOF_FLOOR_UNREADABLE',
]);

export interface DeterministicRefusalView {
  /** The code the server sent — bookkeeping only, NEVER rendered raw. */
  code: string;
  /** The sentence for the person, already translated. */
  text: string;
  /** Always false: this state does not heal by waiting. */
  mayRetry: false;
  /** The person's own door: sign in with the wallet that controls the address. */
  maySignInWithWallet: true;
}

export function describeDeterministicProofRefusal(
  r: RetryableRefusalLike | null | undefined,
  t: (s: string) => string,
): DeterministicRefusalView | null {
  const code = ((r?.error ?? r?.code) ?? '').trim();
  if (!code || !DETERMINISTIC_PROOF_CODES.has(code)) return null;
  const what =
    code === 'ACCOUNT_RECORD_MISSING'
      ? t('We could not find the account record behind this session, so the wallets linked to it cannot be dated or trusted — and we will not guess.')
      : t('This account’s security record cannot be read, so we cannot tell which of your linked wallets were added before the account last changed hands. We will not guess: guessing could hand the account back to a previous holder, so linked wallets stay out until it is repaired — and re-linking one will not help either.');
  return {
    code,
    text: `${what} ${t('This will not fix itself by waiting, and nothing was composed and nothing moved. Two things do work: sign in with the wallet that controls this address — a signed-in wallet proves itself and needs no stored record — or write to us, and an administrator can repair it.')}`,
    mayRetry: false,
    maySignInWithWallet: true,
  };
}

/** Is this one of the two deterministic account-record refusals? */
export function isDeterministicProofRefusal(r: RetryableRefusalLike | null | undefined): boolean {
  const code = ((r?.error ?? r?.code) ?? '').trim();
  return code.length > 0 && DETERMINISTIC_PROOF_CODES.has(code);
}

/**
 * THE SERVER SOMETIMES WRITES ITS `detail` IN SPANISH.
 *
 * The app is in English and several 0xFE refusals carry a Spanish paragraph with
 * hashes in it («el PA rXXX ya tiene un 0xFE firmado…»). Printing it under an
 * English headline is the same failure as printing a raw code: the person reads
 * a language the screen does not speak and learns nothing. A detail that is
 * plainly English still helps, so it is kept; anything that looks Spanish is
 * dropped. Wrong in this direction costs a diagnostic, never a wrong sentence.
 */
const SPANISH_MARKERS =
  /[áéíóúñ¿¡]|\b(el|la|los|las|del|una|sin|con|para|pero|porque|está|ya|se|su|sus|que|qué|firmada|firmado|asiento|cuenta|pago|orden|ledger_actual|hasta|puede|otra|antes|liberar|espera|segundos)\b/i;

export function serverDetailIfEnglish(detail: string | null | undefined): string | null {
  const raw = (detail ?? '').trim();
  if (!raw) return null;
  return SPANISH_MARKERS.test(raw) ? null : raw;
}

/**
 * A SLUG IS NOT A SENTENCE.
 *
 * Several consoles keep a `{ error, detail }` whose `error` is sometimes a
 * translated sentence they wrote themselves and sometimes the server's raw code
 * (`NO_DIRECTOR_CEDED`, `CAP_EXCEEDED`), and they printed whichever arrived as
 * the headline of a red box. A person reading `DENIED — CAP_EXCEEDED` learns
 * nothing they can act on, and the Spanish `detail` underneath made it worse.
 *
 * This says which of the two it is: a slug (ALL_CAPS with underscores and no
 * spaces) is replaced by the one honest generic sentence; anything a human
 * wrote is kept. Seat refusals get their own, better sentence first.
 */
export function looksLikeRawCode(s: string | null | undefined): boolean {
  const raw = (s ?? '').trim();
  return raw.length >= 3 && /^[A-Z][A-Z0-9_]*$/.test(raw);
}

export function refusalHeadline(
  // It also reads the «a read of ours failed» family, whose refusals
  // carry a `status` (503 / 409) the seat shapes never had.
  r: (SeatRefusalLike & RetryableRefusalLike) | null | undefined,
  t: (s: string) => string,
): string | null {
  if (!r) return null;
  const seat = describeSeatRefusal(r, t);
  if (seat) return seat.text;
  // The three «a read of ours failed» refusals used to fall
  // straight through to the generic «the server refused this operation», which
  // is both wrong (nobody refused anything) and a dead end (no retry).
  const readFailure = describeRetryableRefusal(r, t);
  if (readFailure) return readFailure.text;
  // And the two that do NOT heal by waiting, which had no reader
  // at all and were read as «the server refused this operation» — over the only
  // bytes a cosignatory can sign, with both real ways forward thrown away.
  const deterministic = describeDeterministicProofRefusal(r, t);
  if (deterministic) return deterministic.text;
  const said = ((r.error ?? r.code) ?? '').trim();
  if (!said || looksLikeRawCode(said)) {
    return t('The server refused this operation. Nothing was prepared and nothing was signed.');
  }
  return said;
}

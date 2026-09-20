/**
 * takeover — coordination with the identity module (productizer it. 10).
 *
 * A User row taken over through OAuth carries `preferences.security.takeoverAt`
 * (an ISO instant, written by the identity side). Whatever the demo exchange
 * trusted on the strength of that user id BEFORE that instant is not proof of the
 * person holding the session now:
 *  · a WalletBinding linked before it is not wallet proof (proveXrplWallet);
 *  · a client row whose ownership was established before it needs a RE-CLAIM: its
 *    session is not its owner any more, and only a founder re-opens it (a fresh
 *    claim code, or an explicit assignment).
 *
 * Read safely: an ABSENT preference is «no takeover». A database that cannot be
 * read THROWS — the caller refuses (503), it never assumes «no takeover».
 *
 * productizer it. 16 (R4 4.3) — AND SO DOES A MARK THAT CANNOT BE READ. This
 * file used to parse the preference leniently: a `security` that was not an
 * object, or a `takeoverAt` that was not a parsable instant, came back as null —
 * i.e. «there was no takeover», i.e. the previous holder's wallet bindings and
 * client rows stayed trusted. «No pude leer» became permission in the very place
 * that decides whose exchange account this is. The cage acknowledgement, the
 * legal click-wrap and `provenAddresses` already read it strictly
 * (`readTakeoverAtStrict`); this now reads the same way, and an unreadable mark
 * takes the path the file already had for a database failure: it THROWS, the
 * route answers 503 OWNERSHIP_UNREADABLE, and the display treats the viewer as
 * if the takeover were now (nothing shows as theirs).
 *
 * productizer it. 29 (1.2) — AND SO DOES A MARK DATED AHEAD OF OUR CLOCK. The
 * read is now the SHARED floor reader (`readTakeoverFloorStrict`), which asks
 * both questions — does it parse, and can it date anything yet — so this file
 * and the identity module cannot answer the same row differently. See
 * `takeoverAtOf` for what a future mark was costing the owner of a desk.
 */

import type { DemoClient } from './DemoExchangeStore';
import { readTakeoverFloorStrict } from '../identity/credentialsEpoch';

/** A takeover mark that exists but cannot be USED. Never «there was none». */
export class TakeoverUnreadableError extends Error {
  constructor(message = 'the takeover mark on this account is not readable') {
    super(message);
    this.name = 'TakeoverUnreadableError';
  }
}

/**
 * A MARK DATED AHEAD OF OUR CLOCK IS THE SAME KIND OF NOTHING (it. 29, 1.2).
 *
 * The message is its own sentence because the route puts it inside the 503
 * (`OWNERSHIP_UNREADABLE`: «whether this login was taken over could not be read
 * (…) — nothing was changed; try again»), and «not readable» would be false for
 * a row that reads perfectly well and is simply dated in the future.
 */
export const TAKEOVER_AHEAD_OF_CLOCK_MESSAGE =
  'the takeover mark on this account is dated later than our clock, so it cannot date anything yet';

/**
 * Pure: the takeover instant inside a User.preferences JSON, or null when there
 * is none. THROWS `TakeoverUnreadableError` when the mark is present but cannot
 * be USED as a floor — the identity module's own strict reader decides which is
 * which, and there are two ways to be unusable.
 *
 * productizer it. 29 (1.2) — THE SECOND WAY WAS TAPING A PERSON OUT OF THEIR OWN
 * DESK. It. 27 taught the future-mark rule to the legal gate and the cage
 * acknowledgement — the two doors that decide a MODAL — and to neither of the
 * two that decide MONEY. Here the consequence was precise and total: with a mark
 * in the future, `ownershipPredatesTakeover` answers `true` for EVERY row (no
 * `ownedSince` can be later than a date that has not happened), so the owner of
 * a desk met 403 `CLIENT_RECLAIM_REQUIRED` on `POST …/requests` — WITHDRAW
 * INCLUDED — on `PATCH …/clients/:cid` and on the `DELETE` of their own dead
 * request. They could not take their money out, could not retract the request
 * that was holding it, and could not repair anything: only a founder re-opens a
 * row. A refusal nobody decided, over an exit, with no way out from inside.
 *
 * Reading it as «there was no takeover» would have been the opposite mistake and
 * is not on the table (that is the it. 16 lesson: «no pude leer» is never
 * permission). The answer is the one this file already had for a database that
 * will not answer: THROW, so the route says 503 «nothing was changed; try
 * again» — retryable, true, and it really does clear, because the wall clock
 * passes the mark on its own.
 *
 * `now` is injectable so the rule is testable without moving the machine clock.
 */
export function takeoverAtOf(preferences: unknown, now: Date = new Date()): Date | null {
  const strict = readTakeoverFloorStrict(preferences, now);
  if (!strict.readable) {
    throw new TakeoverUnreadableError(
      strict.why === 'ahead-of-clock' ? TAKEOVER_AHEAD_OF_CLOCK_MESSAGE : undefined,
    );
  }
  return strict.at;
}

/**
 * Pure: was this row's ownership established before the owner's login was taken
 * over? `ownedSince` absent → `createdAt` (the earliest possible moment). An
 * instant that cannot be read counts as «before» — with a takeover on record,
 * «could not date it» never keeps a row trusted.
 *
 * THAT RULE IS ONLY SAFE BECAUSE `takeoverAt` IS ALREADY A USABLE FLOOR (it. 29).
 * Fed a mark dated in the future it answers `true` for every row on earth, which
 * is not «this row predates the takeover» but «I cannot date anything» wearing
 * its face — and this function's answer becomes a 403 that only a founder can
 * lift. Every live caller gets its `takeoverAt` from `readTakeoverAt` /
 * `takeoverAtOf`, which now THROW on such a mark rather than hand it over, so
 * this comparison never sees one. Do not «fix» it here by returning false: that
 * would trust every row of an account whose floor we cannot establish, which is
 * the it. 16 mistake with the sign flipped.
 */
export function ownershipPredatesTakeover(client: Pick<DemoClient, 'ownedSince' | 'createdAt'>, takeoverAt: Date | null | undefined): boolean {
  if (!takeoverAt) return false;
  const since = Date.parse(client.ownedSince ?? client.createdAt ?? '');
  if (!Number.isFinite(since)) return true;
  return since < takeoverAt.getTime();
}

/**
 * Live: the takeover instant of a user. No database / no row / no preference →
 * null. STRICT on database errors AND on a mark that cannot be parsed: both
 * throw, and every caller in this module already turns a throw into a refusal
 * (503 OWNERSHIP_UNREADABLE) or into «trust nothing» for display.
 */
export async function readTakeoverAt(userId: string | undefined | null): Promise<Date | null> {
  if (!userId || !process.env.DATABASE_URL) return null;
  const { prisma } = await import('../../database/prismaClient');
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } });
  return takeoverAtOf(row?.preferences ?? null);
}

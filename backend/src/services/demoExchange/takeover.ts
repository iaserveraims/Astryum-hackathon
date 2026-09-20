/**
 * takeover — coordination with the identity module.
 *
 * A User row taken over through OAuth carries `preferences.security.takeoverAt`
 * (an ISO instant, written by the identity side). Whatever the demo exchange
 * trusted on the strength of that user id BEFORE that instant is not proof of the
 * person holding the session now:
 *  · a WalletBinding linked before it is not wallet proof (proveXrplWallet);
 *  · a client row whose ownership was established before it needs a RE-CLAIM: its
 *    session is not its owner any more, and only a founder re-opens it (a fresh
 *    claim code, or an explicit assignment).
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
 * A MARK DATED AHEAD OF OUR CLOCK IS THE SAME KIND OF NOTHING (1.2).
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

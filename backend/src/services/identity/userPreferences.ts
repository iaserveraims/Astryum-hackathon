/**
 * userPreferences — the ONLY way a request may write `User.preferences`.
 *
 * The column is shared: `legal`, `managerMode`, `appearance`, `demoTerms`… and
 * `security` (credentialsEpoch / takeoverAt, written by the account takeover in
 * AuthService._takeOverSquattedAccount). A route that reads the JSON, merges its
 * key and writes the WHOLE object back can resurrect a stale copy: an intruder's
 * /appearance request that read before the takeover and wrote after it erased
 * `security`, and with it the epoch that kills the intruder's sessions and the
 * `takeoverAt` that stops their wallets and exchange tickets passing as the
 * owner's (finding 5.2).
 */
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { prisma } from '../../database/prismaClient';
import { QUARANTINED_PREFERENCES_KEY } from './credentialsEpoch';
import { lockAndAssertLiveSession, type LiveSessionRef } from './liveSession';

export const RESERVED_PREFERENCE_KEY = 'security';

/**
 * Every key the caller never sees, never merges into and never overwrites:
 * `security` (the takeover floor) and the quarantine slot where a `preferences`
 * column that was not an object is parked by the takeover.
 */
export const RESERVED_PREFERENCE_KEYS = [RESERVED_PREFERENCE_KEY, QUARANTINED_PREFERENCES_KEY] as const;

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Can this column be merged into at all? `null` / `undefined` is a brand-new row
 * with nothing in it — readable, and the empty object is the truth. ANYTHING
 * ELSE that is not a plain object (a string, a number, an array) is a column we
 * cannot read, and no preference is worth writing on top of one: see
 * `applyPreferencesUpdate`.
 */
export function isReadablePreferencesColumn(current: unknown): boolean {
  return current === null || current === undefined || asObject(current) !== null;
}

/**
 * The English sentence a screen shows when the column cannot be read. It says
 * what happened, that it was OURS, that nothing changed, and the ONE thing that
 * moves it forward — because waiting does not.
 */
export const PREFERENCES_UNREADABLE_DETAIL =
  "We could not read this account's saved settings, so we did not write over them. This is a fault in the stored " +
  'record, not in what you sent, and nothing was changed — your security settings, your linked wallets and your ' +
  'accepted terms all stand exactly as they were. Waiting will not fix it. Write to us: an administrator can ' +
  'repair the settings record, and until then everything else in the app keeps working.';

/**
 * The refusal thrown when `User.preferences` is not an object.
 *
 * 409, NOT 503: nothing about this heals by retrying — the stored value is
 * malformed and will still be malformed in ten minutes. `retryable: false` so a
 * screen does not offer a button that can only fail (the same contract as
 * `ProofRefusal` in provenAddresses).
 */
export function preferencesUnreadable(): Error {
  return Object.assign(new Error('preferences_unreadable'), {
    code: 'preferences_unreadable',
    status: 409 as const,
    retryable: false as const,
    detail: PREFERENCES_UNREADABLE_DETAIL,
  });
}

export function isPreferencesUnreadable(err: unknown): boolean {
  return (err as { code?: unknown } | null | undefined)?.code === 'preferences_unreadable';
}

/**
 * The 409 a route sends when the column could not be read. Shaped exactly like
 * every other refusal in this iteration so one reader covers them all:
 * `{ error, detail, retryable }`.
 */
export function respondPreferencesUnreadable(res: Response): Response {
  return res.status(409).json({
    error: 'PREFERENCES_UNREADABLE',
    detail: PREFERENCES_UNREADABLE_DETAIL,
    retryable: false,
  });
}

/** Pure: the preferences a caller may see and merge into (no reserved keys). */
export function withoutReservedKeys(preferences: unknown): Record<string, unknown> {
  const rest = { ...(asObject(preferences) ?? {}) };
  for (const key of RESERVED_PREFERENCE_KEYS) delete rest[key];
  return rest;
}

/**
 * Pure: the object to persist — the caller's result with the reserved keys
 * restored from the CURRENT (locked) row, whatever the caller put there.
 *
 * @throws the `preferences_unreadable` 409 when `current` is not an object.
 */
export function applyPreferencesUpdate(
  current: unknown,
  updater: (visible: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  if (!isReadablePreferencesColumn(current)) throw preferencesUnreadable();
  const base = asObject(current) ?? {};
  const next = { ...withoutReservedKeys(updater(withoutReservedKeys(base))) };
  for (const key of RESERVED_PREFERENCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(base, key)) next[key] = base[key];
  }
  // Tripwire, not decoration: whatever happens above, a row that HAD a reserved
  // key must never come out without it. If this ever fires, the write is dropped
  // rather than allowed to strip the takeover floor by accident.
  for (const key of RESERVED_PREFERENCE_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(base, key) !== Object.prototype.hasOwnProperty.call(next, key)
    ) {
      throw preferencesUnreadable();
    }
  }
  return next;
}

export function userNotFound(): Error {
  return Object.assign(new Error('user_not_found'), { code: 'user_not_found' });
}

/**
 * Atomically merge into `User.preferences`. Returns what was persisted, minus
 * `security` (responses built from it must not echo the takeover marks).
 *
 * `liveSession`: pass `req.siwe` when the value being written is a CONSENT (the
 * legal click-wrap) rather than a preference. The session is then re-checked
 * under the same row lock, so a record clicked by a previous holder cannot land
 * after a takeover and read as the owner's signature (4.2 / 4.4).
 */
export async function updateUserPreferences(
  userId: string,
  updater: (visible: Record<string, unknown>) => Record<string, unknown>,
  opts: { liveSession?: LiveSessionRef } = {},
): Promise<Record<string, unknown>> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Row lock FIRST — the read below then sees the latest committed version.
    if (opts.liveSession) {
      // Takes the same lock and, under it, proves the session is still live.
      await lockAndAssertLiveSession(tx, opts.liveSession);
    } else {
      const locked = await tx.user.updateMany({ where: { id: userId }, data: { updatedAt: new Date() } });
      if (!locked || locked.count !== 1) throw userNotFound();
    }
    const row = await tx.user.findUnique({ where: { id: userId }, select: { preferences: true } });
    if (!row) throw userNotFound();
    // Throws `preferences_unreadable` when the column is not an object. It is
    // raised BEFORE the update statement and inside the transaction, so the
    // rollback is total: the corrupt value stays exactly as it was, which is the
    // whole point — see `applyPreferencesUpdate`. Routes turn it into the 409
    // with `respondPreferencesUnreadable`.
    const next = applyPreferencesUpdate(row.preferences, updater);
    await tx.user.update({ where: { id: userId }, data: { preferences: next as never } });
    return withoutReservedKeys(next);
  });
}

/**
 * credentialsEpoch — the per-user line before which every credential is dead.
 *
 * Lives in `User.preferences.security` (JSON, no migration):
 *   · `credentialsEpoch` (ISO) — a session born, or a JWT issued, before it is
 *     refused by `verifyToken`, `refresh` and passkey registration, even if its
 *     row somehow stayed `isActive`;
 *   · `takeoverAt` (ISO) — when a provider-verified owner took the account over
 *     from an unverified password holder (AuthService._takeOverSquattedAccount).
 *     Anything the previous holder attached before it (wallet bindings) proves
 *     nothing about the owner.
 */
import type { Prisma } from '@prisma/client';

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function isoDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

function securityOf(preferences: unknown): Record<string, unknown> {
  return asObject(asObject(preferences)?.security) ?? {};
}

/**
 * The epoch, read SOFTLY: a `security` block that does not parse comes out as
 * «no epoch». That is deliberate, and it is the one place in this module where
 * an unreadable mark does not fail closed. The argument, written down so it is
 * re-decided rather than re-discovered (task 5):
 */
export function credentialsEpochOf(preferences: unknown): Date | null {
  return isoDate(securityOf(preferences).credentialsEpoch);
}

export function takeoverAtOf(preferences: unknown): Date | null {
  return isoDate(securityOf(preferences).takeoverAt);
}

/**
 * The takeover instant, read STRICTLY: the caller can tell "there was none" from
 * "I could not read it". Consumers that treat the mark as consent (the cage
 * acknowledgement, the legal click-wrap) must fail closed on the second — «no
 * pude leer» is never «lo aceptaste».
 *
 *   · preferences null/absent, or no `security`, or no `takeoverAt` → readable, null;
 *   · preferences or `security` present but not an object, or a `takeoverAt`
 *     that is not a parsable instant → unreadable.
 */
export type StrictTakeoverAt = { readable: true; at: Date | null } | { readable: false };

export function readTakeoverAtStrict(preferences: unknown): StrictTakeoverAt {
  if (preferences === null || preferences === undefined) return { readable: true, at: null };
  const prefs = asObject(preferences);
  if (!prefs) return { readable: false };
  if (!Object.prototype.hasOwnProperty.call(prefs, 'security')) return { readable: true, at: null };
  const security = asObject(prefs.security);
  if (!security) return { readable: false };
  if (!Object.prototype.hasOwnProperty.call(security, 'takeoverAt')) return { readable: true, at: null };
  const at = isoDate(security.takeoverAt);
  return at ? { readable: true, at } : { readable: false };
}

/**
 * A TAKEOVER MARK AHEAD OF OUR OWN CLOCK IS NOT A USABLE FLOOR (made
 * shared in). Written for the legal click-wrap, it belongs HERE: every
 * reader of `readTakeoverAtStrict` compares something against this mark, and a
 * rule that only one of them applies is not a rule — it is a coincidence.
 */
export function markIsAheadOfClock(takeoverAt: Date | null, now: Date): boolean {
  return takeoverAt !== null && takeoverAt.getTime() > now.getTime();
}

/** Why a mark cannot be used as a floor. Both are «no pude leer», never «no hay». */
export type TakeoverFloorUnusable =
  /** The mark does not parse at all (see `readTakeoverAtStrict`). */
  | 'unreadable'
  /** The mark parses but sits ahead of this server's clock (`markIsAheadOfClock`). */
  | 'ahead-of-clock';

/**
 * `why` is present on BOTH arms (null when the floor is usable) on purpose: this
 * backend compiles with `strict: false`, where narrowing a union by a boolean
 * discriminant is not something to bet a closed exit on. A total field cannot be
 * read wrong by a consumer that forgets to narrow.
 */
export type StrictTakeoverFloor =
  | { readable: true; at: Date | null; why: null }
  | { readable: false; why: TakeoverFloorUnusable; at: Date | null };

/**
 * THE FLOOR, AS EVERY CONSUMER MUST READ IT (1.1/1.2).
 *
 * `readTakeoverAtStrict` answers about LEGIBILITY. That was never the whole
 * question: what a consumer actually does with the mark is compare a `now`-ish
 * instant against it (a binding's `linkedAt`, a click-wrap's `acceptedAt`, a
 * client row's `ownedSince`). A mark in the FUTURE loses every one of those
 * comparisons for ever, so it is not a floor — it is a wall.
 */
export function readTakeoverFloorStrict(preferences: unknown, now: Date = new Date()): StrictTakeoverFloor {
  const strict = readTakeoverAtStrict(preferences);
  if (!strict.readable) return { readable: false, why: 'unreadable', at: null };
  if (markIsAheadOfClock(strict.at, now)) return { readable: false, why: 'ahead-of-clock', at: strict.at };
  return { readable: true, at: strict.at, why: null };
}

/**
 * Preference keys that record a PERSON's consent and therefore cannot survive a
 * takeover: the unified legal signature and the register-time click-wrap. They
 * are not deleted — they move to the quarantine account, where they still prove
 * what the previous holder accepted (invariant #11: nothing is destroyed).
 */
export const CONSENT_PREFERENCE_KEYS = ['legal', 'demoTerms'] as const;

/** A session row born before the epoch. Unknown birth under an epoch = dead. */
export function sessionPredatesEpoch(createdAt: Date | string | null | undefined, epoch: Date | null): boolean {
  if (!epoch) return false;
  const t = createdAt instanceof Date ? createdAt.getTime() : typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t)) return true;
  return t < epoch.getTime();
}

/**
 * A JWT issued before the epoch. `iat` is whole seconds, so the comparison is
 * at second granularity: a token minted in the epoch's own second (the owner's,
 * issued right after the takeover) must live. A token from that same second but
 * BEFORE the takeover still dies with its session row (`isActive`, `createdAt`).
 */
export function tokenPredatesEpoch(iat: unknown, epoch: Date | null): boolean {
  if (!epoch) return false;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return true;
  return iat < Math.floor(epoch.getTime() / 1000);
}

/**
 * Where a `preferences` column that is NOT an object is parked when the takeover
 * has to write anyway (see `withCredentialsReset`). Reserved: no caller ever
 * sees it, merges into it or overwrites it (identity/userPreferences).
 *
 * Its value is the RAW original, whatever it was — a string, a number, an array.
 * Nothing built is destroyed (invariant), and an admin repairing the row later
 * can still see what was there.
 */
export const QUARANTINED_PREFERENCES_KEY = 'unreadablePreferences';

/**
 * preferences with the takeover marks merged in — every other key kept.
 *
 * A COLUMN THAT IS NOT AN OBJECT IS QUARANTINED, NEVER DROPPED (1.8).
 * `asObject(preferences) ?? {}` silently threw the old value away. Here the
 * takeover CANNOT refuse — it is the rescue: the verified owner is taking the
 * account back and every credential must die now — so the raw original moves
 * under `QUARANTINED_PREFERENCES_KEY` and the fresh `security` is written on
 * top. The row that comes out is readable AND carries the floor, so nothing is
 * resurrected and nothing is lost.
 */
export function withCredentialsReset(preferences: unknown, at: Date): Record<string, unknown> {
  const readable = asObject(preferences);
  const iso = at.toISOString();
  const security = { ...securityOf(preferences), credentialsEpoch: iso, takeoverAt: iso };
  if (readable) return { ...readable, security };
  if (preferences === null || preferences === undefined) return { security };
  return { [QUARANTINED_PREFERENCES_KEY]: preferences, security };
}

/**
 * Split the account's preferences at the takeover: what the OWNER inherits, and
 * what belongs to the previous holder and moves to the quarantine account.
 *
 * The owner keeps presentation and marks (appearance, managerMode…) plus the
 * fresh `security` epoch; they do NOT inherit a consent someone else clicked
 * (4.2 — a click-wrap that accredits another person). The
 * consent record is not erased: it travels to the quarantine row, where it still
 * proves who accepted what and when.
 */
export function splitTakeoverPreferences(
  preferences: unknown,
  at: Date,
): { owner: Record<string, unknown>; quarantined: Record<string, unknown> } {
  const readable = asObject(preferences);
  const kept: Record<string, unknown> = readable ? { ...readable } : {};
  // Same rule as withCredentialsReset: a column that is not an object is parked,
  // never dropped. `kept` is an object from here on, so the owner's row always
  // comes out readable and always carries `security`.
  if (!readable && preferences !== null && preferences !== undefined) {
    kept[QUARANTINED_PREFERENCES_KEY] = preferences;
  }
  const quarantined: Record<string, unknown> = {};
  for (const key of CONSENT_PREFERENCE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(kept, key)) {
      quarantined[key] = kept[key];
      delete kept[key];
    }
  }
  return { owner: withCredentialsReset(kept, at), quarantined };
}

export function credentialsChanged(): Error {
  return Object.assign(new Error('credentials_changed'), { code: 'credentials_changed' });
}

export interface ObservedCredentialState {
  passwordHash: string | null;
  preferences: unknown;
}

/**
 * Compare-and-swap on the user row, INSIDE the transaction that is about to
 * issue a credential (session, rotated refresh token, passkey).
 *
 * The conditional UPDATE takes the row lock. The takeover updates the same row
 * FIRST in its own transaction, so the two serialise:
 *   · takeover committed first → Postgres re-evaluates our WHERE on the new
 *     version: the password is gone (count 0), or the epoch re-read differs →
 *     `credentials_changed`, nothing is written;
 *   · we lock first → the takeover waits for our commit, and its session /
 *     passkey sweep (a later statement) sees and revokes what we just wrote.
 * Callers must re-validate their session AFTER this returns: that read can no
 * longer race the takeover.
 */
export async function lockCredentialState(
  tx: Prisma.TransactionClient,
  userId: string,
  observed: ObservedCredentialState,
): Promise<{ passwordHash: string | null; preferences: unknown; isActive: boolean }> {
  const expectedHash = observed.passwordHash ?? null;
  const locked = await tx.user.updateMany({
    where: { id: userId, passwordHash: expectedHash },
    data: { updatedAt: new Date() },
  });
  if (!locked || locked.count !== 1) throw credentialsChanged();
  const fresh = await tx.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, preferences: true, isActive: true },
  });
  const epochKey = (p: unknown) => credentialsEpochOf(p)?.toISOString() ?? null;
  if (
    !fresh ||
    (fresh.passwordHash ?? null) !== expectedHash ||
    epochKey(fresh.preferences) !== epochKey(observed.preferences)
  ) {
    throw credentialsChanged();
  }
  return fresh;
}

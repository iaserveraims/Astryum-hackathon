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
 *
 * The epoch alone cannot close a race: a request that passed its session check
 * BEFORE the takeover can still write AFTER it, and its new row is born after
 * the epoch. `lockCredentialState` is the compare-and-swap for that — see there.
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
 * re-decided rather than re-discovered (productizer it. 20, task 5):
 *
 *   · this is read on EVERY request, at the session door (`verifyToken`). Failing
 *     closed there means refusing the session — and the login that would follow
 *     re-reads the same unparseable row, so the person is bricked into a
 *     sign-in ↔ 401 loop with no way out and no exit;
 *   · the epoch is a BELT, not the brace. A takeover revokes the previous
 *     holder's sessions directly (the sweep in `_takeOverSquattedAccount`) and
 *     WRITES this block itself via `withCredentialsReset`, so after a real
 *     takeover the block is well-formed by construction. An unparseable one is
 *     corruption, not an attack surface someone can arrange;
 *   · everything that GRANTS off the same block reads it strictly instead —
 *     `readTakeoverAtStrict` for the bindings floor (provenAddresses), the cage
 *     acknowledgement and the legal click-wrap. There, «could not read» costs a
 *     permission; here it would cost an account.
 *
 * If that ever stops being true — if this value alone decides an authority — it
 * must move to a strict read WITH a repair path, not just a stricter answer.
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
 * A TAKEOVER MARK AHEAD OF OUR OWN CLOCK IS NOT A USABLE FLOOR (it. 27; made
 * shared in it. 29). Written for the legal click-wrap, it belongs HERE: every
 * reader of `readTakeoverAtStrict` compares something against this mark, and a
 * rule that only one of them applies is not a rule — it is a coincidence.
 *
 * WHAT WENT WRONG (it. 27). It. 25 closed the loop that came in through
 * LEGIBILITY, but the condition that actually opens the legal ceremony is not
 * «the mark parses» — it is `acceptedAt > takeoverAt` (`signedByThisHolder`). A
 * mark that parses CLEANLY and sits in the FUTURE fails that comparison for
 * every signature that can ever be written, because a signature is stamped
 * `now` and `now` is always before it. The write lands (the row is a well-formed
 * object, so `applyPreferencesUpdate` does not refuse), no 409 is ever raised,
 * and the non-dismissable modal comes back on the next /auth/me. For ever. And
 * `unreadable` was `false` for that row, so the third state never caught it.
 *
 * How a mark gets ahead of the reader: the replica that stamps the takeover is
 * not necessarily the replica that later stamps the signature (clock skew), a
 * hand repair of the row, or a copy of the accounts mirror. With a corrupt —
 * but parsable — date, the distance is unbounded.
 *
 * WHY THE THIRD STATE AND NOT `min(takeoverAt, now)`. Clamping to `now` was the
 * other candidate and it does NOT break the loop: the floor would then move
 * forward with the wall clock, so a signature stamped at t1 is re-read at
 * t2 > t1 against a floor of t2 and STILL does not count. Clamping to a mark we
 * already distrust is worse: for a far-future mark it would admit every
 * binding and every signature older than `now`, which is precisely the previous
 * holder's proof passing as this holder's — the one thing the strict read exists
 * to stop. So the honest answer is the one it. 25 already built: we cannot
 * establish what this account signed, we say so, and we do not put a door in
 * front of anybody's exits while we cannot.
 *
 * NO TOLERANCE WINDOW ON PURPOSE. A few seconds of real skew resolves itself:
 * once the wall clock passes the mark the row reads normally again and the
 * person is asked to sign then, correctly. A tolerance would only buy an
 * interval in which a signature from BEFORE a real takeover counts — paid for
 * with the exact risk above, for a case that heals on its own.
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
 * THE FLOOR, AS EVERY CONSUMER MUST READ IT (productizer it. 29, 1.1/1.2).
 *
 * `readTakeoverAtStrict` answers about LEGIBILITY. That was never the whole
 * question: what a consumer actually does with the mark is compare a `now`-ish
 * instant against it (a binding's `linkedAt`, a click-wrap's `acceptedAt`, a
 * client row's `ownedSince`). A mark in the FUTURE loses every one of those
 * comparisons for ever, so it is not a floor — it is a wall.
 *
 * It. 27 taught that rule to the two doors that decide a MODAL and to neither of
 * the two that decide MONEY: with a future mark, `provenAddresses` dropped every
 * binding while claiming `floorReadable: true` (so the exit answered 403 «you
 * have not proven that wallet», with two remedies that cannot work: signing in
 * with a wallet an email user does not have, and re-linking — which stamps
 * `linkedAt = now`, still below the mark), and the demo exchange refused the
 * owner of a desk their own withdrawal with `CLIENT_RECLAIM_REQUIRED`, which
 * only a founder can undo.
 *
 * So the rule lives in ONE function and the answer is the third state:
 * `readable: false` with the reason, which every consumer already knows how to
 * turn into «no pude leer» — honest, retryable, and never a closed exit.
 *
 * `now` is injectable so the rule is testable without moving the machine clock.
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
 * A COLUMN THAT IS NOT AN OBJECT IS QUARANTINED, NEVER DROPPED (it. 22, 1.8).
 * `asObject(preferences) ?? {}` silently threw the old value away. Here the
 * takeover CANNOT refuse — it is the rescue: the verified owner is taking the
 * account back and every credential must die now — so the raw original moves
 * under `QUARANTINED_PREFERENCES_KEY` and the fresh `security` is written on
 * top. The row that comes out is readable AND carries the floor, so nothing is
 * resurrected and nothing is lost.
 *
 * Note the asymmetry with `applyPreferencesUpdate`, which REFUSES on the same
 * input: an appearance patch is not worth writing over a column we cannot read,
 * and a takeover is worth everything. Both end with a row that has `security`.
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
 * (productizer it. 14, 4.2 — a click-wrap that accredits another person). The
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

/**
 * LegacyCageAckService — the record that a person read the cage disclosure
 * before their capital could enter one, and the gate that enforces it.
 */

import { CAGE_ACK_IDS, CAGE_DISCLOSURE_VERSION, cageDisclosureHash } from '../../config/cageDisclosure';
import { readTakeoverFloorStrict } from '../identity/credentialsEpoch';
import { sessionRevoked, withLiveSession, type LiveSessionRef } from '../identity/liveSession';

export const CAGE_ACK_ACTION = 'legacy_cage_disclosure_ack';

/** How many recent acks to scan for the current version (cheap, indexed). */
const SCAN_LIMIT = 20;
/**
 * Positive-only cache. 30s rather than the 60s of requireLegacyAccess: this
 * entry can only ever be WRONG in one direction — a positive that survives a
 * takeover committed by ANOTHER replica, whose tombstone this process never saw
 * (see below). Halving the window halves that residual; the flow is still
 * human-paced, so the extra reads are a handful per user per minute.
 */
const CACHE_TTL_MS = 30_000;

interface AckCacheEntry {
  at: number;
  acceptedAt: string;
  /**
   * The takeover instant this entry was computed against (ms), or null for «no
   * takeover on record when I read it». A tombstone newer than this discards
   * the entry: it was computed on a reading that predates the handover.
   */
  takeoverAt: number | null;
}

const ackCache = new Map<string, AckCacheEntry>();

/**
 * userId → the instant from which every EARLIER reading is void. Written by
 * `forgetCageAck`, i.e. by the account takeover after it commits. It outlives
 * the cache entry on purpose: a read that started before the takeover can only
 * land after it, and without the tombstone that late `set` would re-seed the
 * intruder's positive over the deletion (4.4).
 */
const ackTombstones = new Map<string, number>();

export function __resetCageAckCacheForTests(): void {
  ackCache.clear();
  ackTombstones.clear();
}

/**
 * Drop this user's cached ack AND plant a tombstone. Called by the account
 * takeover after it commits: the acknowledgement on record belongs to the
 * PREVIOUS holder, and a cached "accepted" would let the owner fund a cage on a
 * reading that was never theirs (4.1). The stored rows are
 * never touched — they are the proof that the previous holder read it
 * (invariant #11).
 *
 * `takeoverAt` is the instant the handover was stamped with; without it the
 * tombstone is «now», which is never later than the takeover and so never
 * discards more than it should.
 */
export function forgetCageAck(userId: string, takeoverAt?: Date | null): void {
  ackCache.delete(userId);
  const stamped =
    takeoverAt instanceof Date && Number.isFinite(takeoverAt.getTime()) ? takeoverAt.getTime() : Date.now();
  const previous = ackTombstones.get(userId);
  ackTombstones.set(userId, previous === undefined ? stamped : Math.max(previous, stamped));
}

/**
 * Is an entry computed against `takeoverAt` still admissible for this user? It
 * is, unless a tombstone says a handover happened that the reading did not see.
 */
function entryOutlivesTombstone(userId: string, takeoverAt: number | null): boolean {
  const tombstone = ackTombstones.get(userId);
  if (tombstone === undefined) return true;
  return takeoverAt !== null && takeoverAt >= tombstone;
}

/**
 * WHY THE ACK IS MISSING — THREE READINGS, NOT ONE.
 *
 * The gate itself does not move: it guards ENTRIES (cage birth, vault funding),
 * capital that does not come back out to an address, so «I could not read» must
 * keep failing closed there. What was wrong is what the person was TOLD. All
 * three of these came out as the same sentence — «Read "How a cage works" and
 * confirm you understand it» — which is the very lie had just removed
 * from the legal gate, alive on the other side of the house:
 */
export type CageAckMissingCause = 'no_record' | 'unreadable_mark' | 'ahead_of_clock' | 'read_failed';

export interface CageAckStatus {
  version: number;
  hash: string;
  /** ISO instant of the accepted ack for the CURRENT version, or null. */
  acceptedAt: string | null;
  /** Why there is no `acceptedAt`. Absent when there is one. */
  cause?: CageAckMissingCause;
}

/**
 * Has this user accepted the CURRENT version? A previous version's ack does not
 * count — that is what bumping the version is for — and neither does one written
 * BEFORE an account takeover: the person who read the disclosure then is not the
 * person holding the account now (4.1). The takeover instant
 * is read strictly: a `security` block we cannot parse is treated as "not
 * acknowledged", because «no pude leer» is never consent.
 */
export async function readCageAck(userId: string | undefined): Promise<CageAckStatus> {
  const base = { version: CAGE_DISCLOSURE_VERSION, hash: cageDisclosureHash() };
  // No session: there is nobody to attribute a reading to. The database was
  // never asked, so this is «nothing on file», not «I could not read».
  if (!userId) return { ...base, acceptedAt: null, cause: 'no_record' as const };

  const cached = ackCache.get(userId);
  if (cached) {
    // A tombstone planted after this entry was computed voids it, TTL or not.
    if (!entryOutlivesTombstone(userId, cached.takeoverAt)) {
      ackCache.delete(userId);
    } else if (Date.now() - cached.at < CACHE_TTL_MS) {
      return { ...base, acceptedAt: cached.acceptedAt };
    }
  }

  let acceptedAt: string | null = null;
  let readFloor: number | null = null;
  try {
    const { prisma } = await import('../../database/prismaClient');
    const [account, rows] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } }),
      prisma.auditLog.findMany({
        where: { userId, action: CAGE_ACK_ACTION },
        orderBy: { timestamp: 'desc' },
        take: SCAN_LIMIT,
        select: { timestamp: true, newValues: true },
      }),
    ]);
    // An account we cannot find, or a takeover mark we cannot USE, is not a
    // reading: same fail-closed rule as the catch below. It is reported as its
    // own cause, because the sentence the gate owes here is not «read it» —
    // see `CageAckMissingCause`.
    if (!account) return { ...base, acceptedAt: null, cause: 'unreadable_mark' as const };
    // A MARK AHEAD OF OUR OWN CLOCK IS NOT A FLOOR EITHER — the same
    // door the legal gate was still open through. Here it cannot cage anybody:
    // this gate guards an ENTRY, and an entry that fails closed leaves the
    // person exactly where they were. But it CAN refuse for ever while telling
    // them to do the one thing that will not help, so it gets the honest cause.
    //
    // The two questions are asked ONCE, by the shared floor reader
    // (`readTakeoverFloorStrict`), because the doors that decide money had the
    // legibility half and not this one. The long argument — why the third state
    // and not `min(takeoverAt, now)`, and why no tolerance window — travelled
    // with it to services/identity/credentialsEpoch.
    const takeover = readTakeoverFloorStrict(account.preferences);
    // The two unusable floors are two causes — the reader already
    // tells them apart; folding them back together here was what made the gate
    // say «we will repair the record» about a row that heals on its own.
    if (!takeover.readable) {
      return { ...base, acceptedAt: null, cause: takeover.why === 'ahead-of-clock' ? ('ahead_of_clock' as const) : ('unreadable_mark' as const) };
    }
    const floor = takeover.at ? takeover.at.getTime() : null;
    readFloor = floor;
    // Filtered in JS rather than with a JSON path predicate: the index on
    // (userId, action, timestamp) already makes this a handful of rows, and it
    // keeps the query portable across the providers this repo runs on.
    const hit = rows.find((r) => {
      const v = r.newValues as { version?: unknown } | null;
      if (!v || Number(v.version) !== CAGE_DISCLOSURE_VERSION) return false;
      if (floor === null) return true;
      const at = r.timestamp instanceof Date ? r.timestamp.getTime() : Date.parse(String(r.timestamp));
      // Unreadable stamp, or one from before the handover: not this person's.
      return Number.isFinite(at) && at > floor;
    });
    acceptedAt = hit ? hit.timestamp.toISOString() : null;
  } catch {
    // FAIL-CLOSED, like the Legacy access gate: an ack we cannot read is not an
    // ack — against a capital movement that has no way back. The refusal stands;
    // what changes is that it is reported as what it is, our database
    // not answering, and not as a statement about what this person has read.
    return { ...base, acceptedAt: null, cause: 'read_failed' as const };
  }

  // Only the POSITIVE is cached. A cached "not accepted" would survive an ack
  // written by another replica (or another tab) for up to the TTL and refuse a
  // prepare the user had just earned; a cached "accepted" is stable by
  // construction, since acks are never revoked — only outdated by a version bump
  // or by a takeover, and THAT is what the tombstone check below is for: a read
  // that started before the handover must not re-seed the intruder's positive
  // over the deletion `forgetCageAck` just did (4.4).
  if (acceptedAt && entryOutlivesTombstone(userId, readFloor)) {
    ackCache.set(userId, { at: Date.now(), acceptedAt, takeoverAt: readFloor });
  }
  return acceptedAt ? { ...base, acceptedAt } : { ...base, acceptedAt: null, cause: 'no_record' as const };
}

/**
 * Write the acknowledgement. `account` is the council the person was looking at
 * (context, not scope — the ack is per user and per version, so a second cage
 * does not re-ask). Returns the stored status.
 */
export async function recordCageAck(input: {
  userId: string;
  account?: string | null;
  acknowledgements: string[];
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Required — see the note above. Nullable only so a caller may pass what it has. */
  session: LiveSessionRef | null;
}): Promise<CageAckStatus> {
  if (!input.session?.userId || !input.session?.sessionId) throw sessionRevoked();
  // (the direct `prisma.auditLog.create` that used to run when no session was
  // given is gone with the optional parameter — the write is always guarded now)
  const data = {
    userId: input.userId,
    action: CAGE_ACK_ACTION,
    resource: input.account ?? null,
    newValues: {
      version: CAGE_DISCLOSURE_VERSION,
      // The server's own hash — never the client's claim about it.
      hash: cageDisclosureHash(),
      acknowledgements: input.acknowledgements,
      account: input.account ?? null,
    },
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    timestamp: new Date(),
  };
  const row = await withLiveSession(input.session, (tx) =>
    tx.auditLog.create({ data, select: { timestamp: true } }),
  );
  const acceptedAt = row.timestamp.toISOString();
  // The row was just written by a session this process proved live (or by a
  // caller with no session at all), so the reading IS this holder's. The entry
  // is stamped with whatever handover this process already knows about, so it
  // satisfies the current tombstone and is discarded by any later one.
  ackCache.set(input.userId, {
    at: Date.now(),
    acceptedAt,
    takeoverAt: ackTombstones.get(input.userId) ?? null,
  });
  return { version: CAGE_DISCLOSURE_VERSION, hash: cageDisclosureHash(), acceptedAt };
}

/** Every acknowledgement present, in any order, nothing invented. */
export function acknowledgementsComplete(ids: unknown): ids is string[] {
  if (!Array.isArray(ids)) return false;
  const given = new Set(ids.filter((i): i is string => typeof i === 'string'));
  return CAGE_ACK_IDS.every((id) => given.has(id)) && given.size === CAGE_ACK_IDS.length;
}

/**
 * THE SENTENCE, ONE PER CAUSE. Same rules as the legal gate's third
 * state: say what happened, never claim as a fact about the person something
 * that is a fact about our row, and NAME THE ACTION THAT ACTUALLY WORKS — a
 * refusal that asks for the impossible is the shape of every loop in this file's
 * history. In English, like every other user-facing string in this repo.
 */
export const CAGE_ACK_REFUSAL_DETAIL: Record<CageAckMissingCause, string> = {
  // The only case where re-reading and confirming is the way out — the original
  // sentence, unchanged.
  no_record:
    'Capital entering a cage never comes back out to an address. Read “How a cage works” and confirm you ' +
    'understand it before composing this — nothing has been composed and no capital has moved.',
  // Confirming again CANNOT clear this: the confirmation is stored (it is an
  // audit row, and that write lands), but we cannot tell whose reading it is,
  // so it never counts. Saying «read it» here would be asking for the one
  // action that changes nothing.
  unreadable_mark:
    'We could not check your reading of “How a cage works”, because the security record on your account ' +
    'cannot be read — a fault in what we stored, not in anything you did. Confirming again will not clear this: ' +
    'write to us and we will repair the record. Nothing has been composed, no capital has moved, and everything ' +
    'else on your account keeps working.',
  // The row reads fine and is dated in the future. Confirming
  // again does not help (the reading is stamped now, still below the mark), but
  // nothing has to be repaired either: the clock passing the mark is the fix.
  // Neither «cannot be read» nor «we will repair the record» is true here.
  ahead_of_clock:
    'We could not check your reading of “How a cage works” yet, because the security record on your account ' +
    'is dated later than our own clock, so we cannot tell whose reading is on file. Confirming again will not ' +
    'clear this — it clears on its own once our clock passes that date: try again later, or write to us and an ' +
    'administrator can check that date. Nothing has been composed, no capital has moved, and everything else on ' +
    'your account keeps working.',
  // A database that did not answer says nothing about this person. It usually
  // clears on its own, which is the one honest instruction here.
  read_failed:
    'We could not check your reading of “How a cage works” right now — our database did not answer, so we ' +
    'will not compose an entry we cannot evidence. This is on our side and usually clears on its own: try again ' +
    'in a moment. Nothing has been composed and no capital has moved.',
};

/**
 * The gate for routes that compose an irreversible entry. Returns the refusal
 * envelope to send, or null when the user may proceed.
 *
 * The dev bypass mirrors requireSiweAuth/requireLegacyAccess: with ALLOW_NO_AUTH
 * there is no session to attribute an ack to, and that combination is already
 * refused outright in production.
 */
export async function cageAckGate(
  userId: string | undefined,
): Promise<{
  status: number;
  body: { error: string; detail: string; version: number; cause: CageAckMissingCause };
} | null> {
  if (!userId && process.env.ALLOW_NO_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    return null;
  }
  const status = await readCageAck(userId);
  if (status.acceptedAt) return null;
  const cause = status.cause ?? 'no_record';
  return {
    status: 409,
    // The CODE does not move — `CAGE_ACK_REQUIRED` is what the two screens match
    // on (CageBirthCard, CouncilVaultEntry) and what a `curl` caller already
    // handles — and neither does the refusal. Only the SENTENCE splits, plus a
    // machine-readable `cause` so a client never has to parse prose.
    body: { error: 'CAGE_ACK_REQUIRED', detail: CAGE_ACK_REFUSAL_DETAIL[cause], version: CAGE_DISCLOSURE_VERSION, cause },
  };
}

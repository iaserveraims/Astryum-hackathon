/**
 * LegacyCageAckService — the record that a person read the cage disclosure
 * before their capital could enter one, and the gate that enforces it.
 *
 * WHY THIS IS SERVER-SIDE (founder, 2026-08-06). The first shape of this was
 * going to be a localStorage flag. localStorage dies with the cache, does not
 * travel between devices, and proves nothing to anyone — which is the whole
 * point of an acknowledgement. So the ack is an AuditLog row: who, which
 * council, which version of the text, and the SHA-256 of the text itself. The
 * repo is a due-diligence document (invariant #12); this is the evidence that
 * the disclosure existed at the instant the capital moved.
 *
 * WHY IT GATES THE PREPARE, NOT JUST THE BUTTON. A modal the frontend can skip
 * is a UI gate, and this codebase already has one of those on the open-findings
 * list. The routes that compose an irreversible entry (cage-create, vault-fund)
 * ask this service first and refuse with CAGE_ACK_REQUIRED, so a stale client,
 * a direct API call, or a reopened tab all land in the same place: read it, then
 * sign. The frontend turns that refusal back into the modal.
 *
 * The hash is written from the SERVER's copy of the text, never from the request
 * body — a client that could name its own hash could name a hash of anything.
 */

import { CAGE_ACK_IDS, CAGE_DISCLOSURE_VERSION, cageDisclosureHash } from '../../config/cageDisclosure';

export const CAGE_ACK_ACTION = 'legacy_cage_disclosure_ack';

/** How many recent acks to scan for the current version (cheap, indexed). */
const SCAN_LIMIT = 20;
/** Same 60s TTL as requireLegacyAccess: human-paced flow, polled surfaces. */
const CACHE_TTL_MS = 60_000;

const ackCache = new Map<string, { at: number; acceptedAt: string | null }>();

export function __resetCageAckCacheForTests(): void {
  ackCache.clear();
}

export interface CageAckStatus {
  version: number;
  hash: string;
  /** ISO instant of the accepted ack for the CURRENT version, or null. */
  acceptedAt: string | null;
}

/**
 * Has this user accepted the CURRENT version? A previous version's ack does not
 * count — that is what bumping the version is for.
 */
export async function readCageAck(userId: string | undefined): Promise<CageAckStatus> {
  const base = { version: CAGE_DISCLOSURE_VERSION, hash: cageDisclosureHash() };
  if (!userId) return { ...base, acceptedAt: null };

  const cached = ackCache.get(userId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { ...base, acceptedAt: cached.acceptedAt };
  }

  let acceptedAt: string | null = null;
  try {
    const { prisma } = await import('../../database/prismaClient');
    const rows = await prisma.auditLog.findMany({
      where: { userId, action: CAGE_ACK_ACTION },
      orderBy: { timestamp: 'desc' },
      take: SCAN_LIMIT,
      select: { timestamp: true, newValues: true },
    });
    // Filtered in JS rather than with a JSON path predicate: the index on
    // (userId, action, timestamp) already makes this a handful of rows, and it
    // keeps the query portable across the providers this repo runs on.
    const hit = rows.find((r) => {
      const v = r.newValues as { version?: unknown } | null;
      return v && Number(v.version) === CAGE_DISCLOSURE_VERSION;
    });
    acceptedAt = hit ? hit.timestamp.toISOString() : null;
  } catch {
    // FAIL-CLOSED, like the Legacy access gate: an ack we cannot read is not an
    // ack. The user re-reads the disclosure — a cost of seconds, against a
    // capital movement that has no way back.
    return { ...base, acceptedAt: null };
  }

  // Only the POSITIVE is cached. A cached "not accepted" would survive an ack
  // written by another replica (or another tab) for up to a minute and refuse a
  // prepare the user had just earned; a cached "accepted" is stable by
  // construction, since acks are never revoked — only outdated by a version bump.
  if (acceptedAt) ackCache.set(userId, { at: Date.now(), acceptedAt });
  return { ...base, acceptedAt };
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
}): Promise<CageAckStatus> {
  const { prisma } = await import('../../database/prismaClient');
  const row = await prisma.auditLog.create({
    data: {
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
    },
    select: { timestamp: true },
  });
  const acceptedAt = row.timestamp.toISOString();
  ackCache.set(input.userId, { at: Date.now(), acceptedAt });
  return { version: CAGE_DISCLOSURE_VERSION, hash: cageDisclosureHash(), acceptedAt };
}

/** Every acknowledgement present, in any order, nothing invented. */
export function acknowledgementsComplete(ids: unknown): ids is string[] {
  if (!Array.isArray(ids)) return false;
  const given = new Set(ids.filter((i): i is string => typeof i === 'string'));
  return CAGE_ACK_IDS.every((id) => given.has(id)) && given.size === CAGE_ACK_IDS.length;
}

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
): Promise<{ status: number; body: { error: string; detail: string; version: number } } | null> {
  if (!userId && process.env.ALLOW_NO_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    return null;
  }
  const status = await readCageAck(userId);
  if (status.acceptedAt) return null;
  return {
    status: 409,
    body: {
      error: 'CAGE_ACK_REQUIRED',
      detail:
        'Capital entering a cage never comes back out to an address. Read “How a cage works” and confirm you ' +
        'understand it before composing this — nothing has been composed and no capital has moved.',
      version: CAGE_DISCLOSURE_VERSION,
    },
  };
}

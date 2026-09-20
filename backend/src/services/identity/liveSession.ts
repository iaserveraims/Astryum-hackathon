/**
 * liveSession — re-check the session INSIDE the transaction that creates
 * authority (productizer it. 14, 4.4).
 *
 * WHAT FAILED. `requireSiweAuth` verifies the session BEFORE the handler runs.
 * An account takeover (AuthService._takeOverSquattedAccount) can commit while
 * the handler is still working — validating a signature, reading a ledger — and
 * the row the handler then writes is born AFTER the takeover, so every later
 * reader dates it to the owner: a wallet binding with `signatureProof` that
 * provenAddresses calls PROVEN, an address-book entry that pre-fills a
 * stranger's address in the send modal, an agent document that rides into the
 * owner's copilot prompt, a rule that fires on the owner's wallet.
 *
 * THE RULE. A write that creates authority takes the user row lock FIRST (the
 * conditional-UPDATE pattern of lockCredentialState / updateUserPreferences) and
 * only then re-reads the session and the credential epoch. The two serialise:
 *   · takeover committed first → our re-read sees the dead session (or the epoch
 *     past our session's birth) → `session_revoked`, nothing is written;
 *   · we lock first → the takeover waits for our commit and its own sweep sees
 *     the row we just wrote (bindings deactivated, residue quarantined).
 *
 * `withLiveSession` never decides WHAT to write: the caller's callback receives
 * the same transaction client and does its own work there.
 */
import type { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { prisma } from '../../database/prismaClient';
import { credentialsEpochOf, sessionPredatesEpoch } from './credentialsEpoch';

/** What `req.siwe` carries (services/SiweAuth.VerifiedToken), narrowed. */
export interface LiveSessionRef {
  userId: string;
  sessionId: string;
}

export function sessionRevoked(): Error {
  return Object.assign(new Error('session_revoked'), { code: 'session_revoked' });
}

export function isSessionRevoked(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'session_revoked';
}

// ── «Busy», not «broken» (productizer it. 18, 3.6) ──────────────────────────
//
// The guarded write contends with the takeover's ~25-statement transaction. When
// it loses that race it is NOT a server fault and must not read as one: nothing
// was written, the account is fine, and the very same request will succeed in a
// moment. A 500 with a raw Prisma chain in it tells the user their money broke.

/**
 * Milliseconds the guarded transaction may run before Prisma aborts it (P2028).
 * Explicit so a timeout is DISTINGUISHABLE: without it the default is Prisma's
 * own 5 s and the error is indistinguishable from any other transaction fault.
 */
export const LIVE_SESSION_TX_TIMEOUT_MS = clampMs(process.env.LIVE_SESSION_TX_TIMEOUT_MS, 8_000, 1_000, 30_000);
/** Milliseconds we wait for a connection from the pool before giving up (P2024). */
export const LIVE_SESSION_MAX_WAIT_MS = clampMs(process.env.LIVE_SESSION_MAX_WAIT_MS, 4_000, 500, 15_000);
/** Postgres `lock_timeout` for the row lock itself — a wait becomes 55P03, fast. */
export const LIVE_SESSION_LOCK_TIMEOUT_MS = clampMs(process.env.LIVE_SESSION_LOCK_TIMEOUT_MS, 3_000, 250, 10_000);

function clampMs(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export function transactionBusy(cause?: unknown): Error {
  return Object.assign(new Error('live_session_busy'), { code: 'live_session_busy', cause });
}

/**
 * Did this write lose the race rather than fail? True for our own
 * `live_session_busy`, for Prisma's transaction timeout / closed-transaction
 * (P2028), its pool timeout (P2024), a serialisation or deadlock abort (P2034),
 * for the Postgres `lock_timeout` (55P03) the row lock below arms, and for
 * Postgres's own DEADLOCK (40P01).
 *
 * WHY 40P01 IS HERE (productizer it. 20, 3.8). Prisma only maps a deadlock to
 * P2034 when it recognises it; a raw `$queryRaw` row lock — which is exactly what
 * `takeUserRowLock` takes — surfaces the native SQLSTATE instead, and that fell
 * through to a 500. A deadlock is the most literal form of contention there is:
 * Postgres picked one of two waiting transactions, aborted it, WROTE NOTHING, and
 * the other one went through. That is a wait, not a failure, and the person is
 * owed the same 503 `ACCOUNT_BUSY` «try again» as every other contention case —
 * not a 500 that says something broke, on a screen with no retry.
 * 40001 (serialization_failure) is its twin and rides the same rule.
 */
export function isTransactionBusy(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code === 'live_session_busy') return true;
  if (code === 'P2028' || code === 'P2024' || code === 'P2034' || code === '55P03') return true;
  if (code === '40P01' || code === '40001') return true;
  const msg = typeof e?.message === 'string' ? e.message : '';
  return (
    /\b(P2028|P2024|P2034)\b/.test(msg) ||
    /lock_not_available|55P03/i.test(msg) ||
    /\b(40P01|40001)\b/i.test(msg) ||
    /deadlock detected/i.test(msg) ||
    /Transaction (?:API error|already closed|not found)/i.test(msg)
  );
}

/** The English sentence a busy guarded write shows. It is a wait, not a loss. */
export const LIVE_SESSION_BUSY_DETAIL =
  'Your account was busy for a moment — another change to it was being applied. Nothing was saved and nothing ' +
  'moved. Try again.';

/** 503 + Retry-After. Never 500: nothing broke and the retry is expected to work. */
export function respondBusyRetry(res: Response, detail?: string): Response {
  res.setHeader('Retry-After', '2');
  return res.status(503).json({
    error: 'ACCOUNT_BUSY',
    detail: detail ?? LIVE_SESSION_BUSY_DETAIL,
    retryable: true,
  });
}

/** The English sentence the client shows when a guarded write is refused. */
export const SESSION_REVOKED_DETAIL =
  'This session is no longer valid — it was signed out, or the account was taken over by its verified owner. ' +
  'Nothing was saved. Sign in again and repeat the action.';

/**
 * The 401 every guarded write answers with. Same code the passkey routes use, so
 * the client already knows it: the session is gone, sign in again.
 *
 * ALWAYS 401 and ALWAYS with `error: 'session_revoked'` — a route that lets the
 * thrown error fall into its generic catch turns a security refusal into a 500
 * with a raw chain in it (productizer it. 16, 5.6), which reads as "we broke"
 * instead of "your session is gone".
 *
 * `detail` overrides the default sentence for a caller that has something more
 * specific to say (e.g. the embedded-wallet create, where a sub-org was already
 * created at the provider and was NOT attached).
 */
export function respondSessionRevoked(res: Response, detail?: string): Response {
  return res.status(401).json({
    error: 'session_revoked',
    detail: detail ?? SESSION_REVOKED_DETAIL,
  });
}

/**
 * The synthetic user `requireSiweAuth` invents under `ALLOW_NO_AUTH=1`. There is
 * no `User` row behind it and there never will be — by construction, not by
 * failure — so every reader that would otherwise report «the account record is
 * missing» has to recognise it first (it. 23, 2.5: that 409 is non-retryable,
 * and a non-retryable refusal invented by our own dev switch would sit on top of
 * every exit in local development).
 *
 * Hard-gated on `NODE_ENV !== 'production'` AND the bypass flag, exactly like
 * `requireSiweAuth`: in production this is always false, whatever the id says.
 */
export function isDevBypassUserId(userId: string | null | undefined): boolean {
  return (
    process.env.ALLOW_NO_AUTH === '1' && process.env.NODE_ENV !== 'production' && userId === 'dev-user'
  );
}

/** The dev bypass of requireSiweAuth (ALLOW_NO_AUTH=1): there is no session row. */
function isDevBypass(ref: LiveSessionRef): boolean {
  return isDevBypassUserId(ref.userId) && ref.sessionId === 'dev-session';
}

/**
 * Take the user row lock without writing to it (productizer it. 18, 3.6).
 *
 * WHY NOT `UPDATE users SET updatedAt = now()`. That is what this used to do,
 * and it is a heavier lock than the job needs: every guarded write produced a
 * new row version, dirtied the index entries and bumped a column other code
 * reads — all to obtain an exclusive lock we immediately throw away. Against the
 * takeover's ~25-statement transaction (which holds the same row) that turned
 * every concurrent guarded write into a queue behind a long writer, and the wait
 * surfaced as P2028 → 500.
 *
 * `SELECT id FROM users WHERE id = $1 FOR UPDATE` takes THE SAME row lock and
 * the same serialisation against the takeover, writes nothing, and — with
 * `SET LOCAL lock_timeout` — gives up quickly and identifiably (55P03) instead
 * of burning the whole transaction budget waiting.
 *
 * WHY NOT LOCK THE SESSION ROW INSTEAD. It would be cheaper still and it would
 * be WRONG: the takeover serialises on the user row (it rewrites preferences,
 * the credential epoch, the bindings), so a lock on `sessions` orders us against
 * nothing. The whole point is to contend with the takeover, not to avoid it.
 *
 * Falls back to the old conditional UPDATE when the client has no `$queryRaw`
 * (the unit-test doubles, and any non-SQL client) — same guarantee, old cost.
 */
async function takeUserRowLock(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const raw = (tx as unknown as { $queryRaw?: unknown; $executeRawUnsafe?: unknown });
  if (typeof raw.$queryRaw !== 'function') {
    const locked = await tx.user.updateMany({ where: { id: userId }, data: { updatedAt: new Date() } });
    return !!locked && locked.count === 1;
  }
  // Best-effort: a client that does not speak Postgres just skips the timeout.
  if (typeof raw.$executeRawUnsafe === 'function') {
    try {
      await (raw.$executeRawUnsafe as (q: string) => Promise<unknown>)(
        `SET LOCAL lock_timeout = '${LIVE_SESSION_LOCK_TIMEOUT_MS}ms'`,
      );
    } catch {
      /* not Postgres, or not permitted — the transaction timeout still bounds us */
    }
  }
  const rows = (await (tx as unknown as {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  }).$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`) as unknown;
  return Array.isArray(rows) && rows.length === 1;
}

/**
 * Take the user row lock and assert the session is STILL live, inside `tx`.
 * Throws `session_revoked` otherwise, or `live_session_busy` when the lock could
 * not be taken in time (a wait, not a refusal — see `isTransactionBusy`).
 * Returns the locked row's preferences so a caller that also merges into them
 * does not re-read.
 */
export async function lockAndAssertLiveSession(
  tx: Prisma.TransactionClient,
  ref: LiveSessionRef | undefined,
): Promise<{ preferences: unknown }> {
  if (!ref?.userId || !ref?.sessionId) throw sessionRevoked();
  if (isDevBypass(ref)) return { preferences: null };

  // Row lock FIRST: a takeover that commits later waits for us, and one that
  // committed already is visible to the reads below (READ COMMITTED takes a
  // fresh snapshot per statement).
  let locked: boolean;
  try {
    locked = await takeUserRowLock(tx, ref.userId);
  } catch (e) {
    // A lock we could not TAKE is «busy», never «your session is gone»: telling
    // a user to sign in again over a lock timeout is a lie, and on an exit it
    // would be a punishment for a transient failure.
    if (isTransactionBusy(e)) throw transactionBusy(e);
    throw e;
  }
  if (!locked) throw sessionRevoked();

  const user = await tx.user.findUnique({
    where: { id: ref.userId },
    select: { isActive: true, preferences: true },
  });
  if (!user || user.isActive === false) throw sessionRevoked();

  const session = await tx.session.findUnique({ where: { id: ref.sessionId } });
  if (
    !session ||
    session.isActive !== true ||
    session.userId !== ref.userId ||
    (session.expiresAt instanceof Date && session.expiresAt < new Date()) ||
    sessionPredatesEpoch(session.createdAt, credentialsEpochOf(user.preferences))
  ) {
    throw sessionRevoked();
  }
  return { preferences: user.preferences };
}

/**
 * Run `fn` in one transaction that first proves the session is still live.
 * The callback MUST do its writes on the `tx` it receives — a write on the
 * global client would escape the lock and could land after a takeover.
 *
 * The transaction carries an EXPLICIT timeout and maxWait (it. 18, 3.6) so a
 * loss against the takeover's long transaction is a recognisable P2028/P2024
 * rather than an anonymous fault, and comes back out of here as
 * `live_session_busy` — which routes answer 503 «try again», never 500.
 * A caller may still see a raw P2028 if it bypasses this helper; `isTransactionBusy`
 * recognises both shapes.
 */
export async function withLiveSession<T>(
  ref: LiveSessionRef | undefined,
  fn: (tx: Prisma.TransactionClient, ctx: { preferences: unknown }) => Promise<T>,
  db: typeof prisma = prisma,
): Promise<T> {
  try {
    return await db.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const ctx = await lockAndAssertLiveSession(tx, ref);
        return fn(tx, ctx);
      },
      { timeout: LIVE_SESSION_TX_TIMEOUT_MS, maxWait: LIVE_SESSION_MAX_WAIT_MS },
    );
  } catch (e) {
    // A revoked session is a verdict and must survive untranslated; everything
    // that is merely contention becomes one code the routes already handle.
    if (isSessionRevoked(e)) throw e;
    if (isTransactionBusy(e)) throw transactionBusy(e);
    throw e;
  }
}

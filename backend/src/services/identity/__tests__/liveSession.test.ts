/**
 * productizer it. 15 (4.4) — a write that CREATES AUTHORITY re-checks the
 * session inside its own transaction, so a request that passed `requireSiweAuth`
 * before an account takeover cannot land after it.
 *
 * Here: the helper's contract against an in-memory client. The route-level
 * proof lives in walletBindings.evmChallenge / addressBook / rules.ownership,
 * and the race against the REAL takeover in AuthService.oauthTakeover.
 */
const db = {
  users: new Map<string, any>(),
  sessions: new Map<string, any>(),
};
const writes: string[] = [];

jest.mock('../../../database/prismaClient', () => {
  const client: any = {
    user: {
      updateMany: jest.fn(async ({ where }: any) => ({ count: db.users.has(where.id) ? 1 : 0 })),
      findUnique: jest.fn(async ({ where }: any) => (db.users.has(where.id) ? { ...db.users.get(where.id) } : null)),
    },
    session: {
      findUnique: jest.fn(async ({ where }: any) => (db.sessions.has(where.id) ? { ...db.sessions.get(where.id) } : null)),
    },
  };
  client.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(client));
  return { prisma: client };
});

import {
  readTakeoverAtStrict,
  splitTakeoverPreferences,
} from '../credentialsEpoch';
import {
  isDevBypassUserId,
  isSessionRevoked,
  isTransactionBusy,
  lockAndAssertLiveSession,
  respondBusyRetry,
  withLiveSession,
  LIVE_SESSION_MAX_WAIT_MS,
  LIVE_SESSION_TX_TIMEOUT_MS,
} from '../liveSession';
import { provenAddressesDetailed } from '../provenAddresses';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../../../database/prismaClient') as { prisma: any };

const REF = { userId: 'u1', sessionId: 's1' };

function seed(over: { user?: Record<string, unknown>; session?: Record<string, unknown> } = {}) {
  db.users.set('u1', { id: 'u1', isActive: true, preferences: null, ...over.user });
  db.sessions.set('s1', {
    id: 's1',
    userId: 'u1',
    isActive: true,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    ...over.session,
  });
}

const run = () => withLiveSession(REF, async () => void writes.push('written'));

beforeEach(() => {
  db.users.clear();
  db.sessions.clear();
  writes.length = 0;
  jest.clearAllMocks();
  delete process.env.ALLOW_NO_AUTH;
});

describe('withLiveSession — the write happens only while the session is alive', () => {
  it('locks the user row FIRST, then reads the session, then writes — all in one transaction', async () => {
    seed();
    await run();
    expect(writes).toEqual(['written']);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.session.findUnique.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['the session row is gone', { session: undefined }],
    ['the session was revoked', { session: { isActive: false } }],
    ['the session belongs to someone else', { session: { userId: 'u2' } }],
    ['the session expired', { session: { expiresAt: new Date(Date.now() - 1000) } }],
    ['the account is disabled (a quarantine row)', { user: { isActive: false } }],
  ])('refuses when %s — nothing is written', async (_label, over: any) => {
    seed(over);
    if (over.session === undefined && 'session' in over) db.sessions.clear();
    await expect(run()).rejects.toMatchObject({ code: 'session_revoked' });
    expect(writes).toEqual([]);
  });

  it('refuses a session born before the credential epoch (it escaped the sweep)', async () => {
    const epoch = new Date();
    seed({
      user: { preferences: { security: { credentialsEpoch: epoch.toISOString(), takeoverAt: epoch.toISOString() } } },
      session: { createdAt: new Date(epoch.getTime() - 60_000) },
    });
    await expect(run()).rejects.toMatchObject({ code: 'session_revoked' });
    expect(writes).toEqual([]);
  });

  it('refuses an unknown user, and a caller with no session at all', async () => {
    await expect(run()).rejects.toMatchObject({ code: 'session_revoked' });
    await expect(withLiveSession(undefined, async () => void writes.push('x'))).rejects.toMatchObject({
      code: 'session_revoked',
    });
    await expect(
      withLiveSession({ userId: 'u1', sessionId: '' }, async () => void writes.push('x')),
    ).rejects.toMatchObject({ code: 'session_revoked' });
    expect(writes).toEqual([]);
    expect(isSessionRevoked(await run().catch((e) => e))).toBe(true);
  });

  it('the dev bypass (ALLOW_NO_AUTH, never production) writes without a session row', async () => {
    process.env.ALLOW_NO_AUTH = '1';
    await withLiveSession({ userId: 'dev-user', sessionId: 'dev-session' }, async () => void writes.push('dev'));
    expect(writes).toEqual(['dev']);
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    // A real user id is still checked, bypass or not.
    await expect(run()).rejects.toMatchObject({ code: 'session_revoked' });
  });

  it('lockAndAssertLiveSession returns the locked row preferences for callers that merge into them', async () => {
    seed({ user: { preferences: { legal: { termsVersion: 'v1' } } } });
    const ctx = await lockAndAssertLiveSession(prisma, REF);
    expect(ctx.preferences).toEqual({ legal: { termsVersion: 'v1' } });
  });
});

/**
 * productizer it. 18 (3.6) — the guard contends with the takeover's ~25-statement
 * transaction. It must contend CHEAPLY, and losing that race must read as «busy,
 * try again», never as «we broke» (500) and never as «your session is gone».
 */
describe('the lock is cheap, and losing the race is a 503, never a 500', () => {
  it('prefers SELECT … FOR UPDATE over writing user.updatedAt on every guarded write', async () => {
    seed();
    const queryRaw = jest.fn(async () => [{ id: 'u1' }]);
    const executeRawUnsafe = jest.fn(async () => 0);
    prisma.$queryRaw = queryRaw;
    prisma.$executeRawUnsafe = executeRawUnsafe;
    try {
      await run();
      expect(writes).toEqual(['written']);
      // No row version burnt just to take a lock we throw away.
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(String(queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
      // …and the wait is bounded, so a lost race is fast and identifiable.
      expect(executeRawUnsafe.mock.calls[0][0]).toMatch(/lock_timeout/);
    } finally {
      delete prisma.$queryRaw;
      delete prisma.$executeRawUnsafe;
    }
  });

  it('a lock timeout is BUSY, not «session_revoked» and not a 500', async () => {
    seed();
    prisma.$queryRaw = jest.fn(async () => {
      throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    });
    prisma.$executeRawUnsafe = jest.fn(async () => 0);
    try {
      const err = await run().then(() => null, (e) => e);
      expect(isSessionRevoked(err)).toBe(false);
      expect(isTransactionBusy(err)).toBe(true);
      expect(writes).toEqual([]);
    } finally {
      delete prisma.$queryRaw;
      delete prisma.$executeRawUnsafe;
    }
  });

  it('Prisma P2028 (the explicit transaction timeout) comes out as busy too', async () => {
    seed();
    (prisma.$transaction as jest.Mock).mockImplementationOnce(async () => {
      throw Object.assign(new Error('Transaction API error: Transaction already closed'), { code: 'P2028' });
    });
    const err = await run().then(() => null, (e) => e);
    expect(isTransactionBusy(err)).toBe(true);
    expect(isSessionRevoked(err)).toBe(false);
  });

  /**
   * productizer it. 20, 3.8 — A DEADLOCK IS CONTENTION, NOT A BREAKAGE.
   * `takeUserRowLock` takes its lock with raw SQL, so Postgres reports the
   * deadlock it resolved as native 40P01 and Prisma never maps it to P2034. It
   * fell through every branch and came out as a 500 «something broke» on a
   * screen with no retry — when in fact nothing was written and the other
   * transaction went through. Same answer as every other wait: 503 ACCOUNT_BUSY.
   */
  it.each([
    ['40P01 by code', Object.assign(new Error('deadlock detected'), { code: '40P01' })],
    ['40P01 in the message only', new Error('Raw query failed. Code: `40P01`. Message: deadlock detected')],
    ['a deadlock with no code at all', new Error('deadlock detected (process 123 waits for ShareLock)')],
    ['40001 serialization_failure', Object.assign(new Error('could not serialize access'), { code: '40001' })],
  ])('a deadlock is BUSY, never a 500: %s', async (_label, thrown) => {
    seed();
    prisma.$queryRaw = jest.fn(async () => {
      throw thrown;
    });
    prisma.$executeRawUnsafe = jest.fn(async () => 0);
    try {
      const err = await run().then(() => null, (e) => e);
      expect(isTransactionBusy(err)).toBe(true);
      expect(isSessionRevoked(err)).toBe(false);
      expect(writes).toEqual([]);
    } finally {
      delete prisma.$queryRaw;
      delete prisma.$executeRawUnsafe;
    }
  });

  it('a plain failure is still NOT busy — the net did not widen into everything', () => {
    expect(isTransactionBusy(new Error('column "foo" does not exist'))).toBe(false);
    expect(isTransactionBusy(Object.assign(new Error('nope'), { code: 'P2002' }))).toBe(false);
  });

  it('a revoked session is NOT re-labelled busy — the verdict survives', async () => {
    seed({ session: { isActive: false } });
    const err = await run().then(() => null, (e) => e);
    expect(isSessionRevoked(err)).toBe(true);
    expect(isTransactionBusy(err)).toBe(false);
  });

  it('the transaction carries an explicit timeout and maxWait', async () => {
    seed();
    await run();
    const opts = (prisma.$transaction as jest.Mock).mock.calls[0][1];
    expect(opts).toMatchObject({
      timeout: LIVE_SESSION_TX_TIMEOUT_MS,
      maxWait: LIVE_SESSION_MAX_WAIT_MS,
    });
  });

  it('respondBusyRetry answers 503 with a retryable English body, never 500', () => {
    const json = jest.fn();
    const res = { setHeader: jest.fn(), status: jest.fn(() => ({ json })) } as never as import('express').Response;
    respondBusyRetry(res);
    expect((res.status as unknown as jest.Mock).mock.calls[0][0]).toBe(503);
    expect(json.mock.calls[0][0]).toMatchObject({ error: 'ACCOUNT_BUSY', retryable: true });
    expect(json.mock.calls[0][0].detail).toMatch(/Nothing was saved/);
  });
});

describe('readTakeoverAtStrict — «no pude leer» is never consent', () => {
  it('tells a missing mark from an unreadable one', () => {
    expect(readTakeoverAtStrict(null)).toEqual({ readable: true, at: null });
    expect(readTakeoverAtStrict(undefined)).toEqual({ readable: true, at: null });
    expect(readTakeoverAtStrict({})).toEqual({ readable: true, at: null });
    expect(readTakeoverAtStrict({ security: {} })).toEqual({ readable: true, at: null });
    expect(readTakeoverAtStrict({ security: { credentialsEpoch: 'x' } })).toEqual({ readable: true, at: null });

    expect(readTakeoverAtStrict('oops')).toEqual({ readable: false });
    expect(readTakeoverAtStrict([1, 2])).toEqual({ readable: false });
    expect(readTakeoverAtStrict({ security: 'nonsense' })).toEqual({ readable: false });
    expect(readTakeoverAtStrict({ security: { takeoverAt: 'not a date' } })).toEqual({ readable: false });
    expect(readTakeoverAtStrict({ security: { takeoverAt: null } })).toEqual({ readable: false });

    const iso = '2026-09-14T10:00:00.000Z';
    const read = readTakeoverAtStrict({ security: { takeoverAt: iso } });
    expect(read.readable && read.at?.toISOString()).toBe(iso);
  });
});

describe('splitTakeoverPreferences — consent travels, everything else stays', () => {
  const at = new Date('2026-09-14T10:00:00.000Z');

  it('moves legal and demoTerms out and stamps the epoch on what the owner keeps', () => {
    const { owner, quarantined } = splitTakeoverPreferences(
      {
        legal: { termsVersion: 'v1' },
        demoTerms: { version: 'v1' },
        appearance: { theme: 'dark' },
        security: { note: 'kept' },
      },
      at,
    );
    expect(owner).toEqual({
      appearance: { theme: 'dark' },
      security: { note: 'kept', credentialsEpoch: at.toISOString(), takeoverAt: at.toISOString() },
    });
    expect(quarantined).toEqual({ legal: { termsVersion: 'v1' }, demoTerms: { version: 'v1' } });
  });

  it('an account with no consent on record quarantines nothing', () => {
    const { owner, quarantined } = splitTakeoverPreferences(null, at);
    expect(quarantined).toEqual({});
    expect(owner.security).toEqual({ credentialsEpoch: at.toISOString(), takeoverAt: at.toISOString() });
  });
});


/**
 * it. 23, 2.5 — `provenAddresses` keeps its own copy of this predicate (it must
 * stay importable without a database). The two must agree, or `dev-user` gets a
 * non-retryable 409 on one path and not the other.
 */
describe('isDevBypassUserId — the synthetic user is recognised, and only outside production', () => {
  const ORIGINAL_ALLOW = process.env.ALLOW_NO_AUTH;
  const ORIGINAL_ENV = process.env.NODE_ENV;
  afterEach(() => {
    if (ORIGINAL_ALLOW === undefined) delete process.env.ALLOW_NO_AUTH;
    else process.env.ALLOW_NO_AUTH = ORIGINAL_ALLOW;
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('true only with the flag, outside production, for that exact id', () => {
    process.env.ALLOW_NO_AUTH = '1';
    process.env.NODE_ENV = 'test';
    expect(isDevBypassUserId('dev-user')).toBe(true);
    expect(isDevBypassUserId('someone-else')).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(isDevBypassUserId('dev-user')).toBe(false);
    process.env.NODE_ENV = 'test';
    delete process.env.ALLOW_NO_AUTH;
    expect(isDevBypassUserId('dev-user')).toBe(false);
  });

  it('provenAddresses agrees with it — one synthetic user, one answer', async () => {
    process.env.ALLOW_NO_AUTH = '1';
    process.env.NODE_ENV = 'test';
    const previousDb = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://test';
    try {
      const v = await provenAddressesDetailed('dev-user', '0x0000000000000000000000000000000000000000');
      // Not a failed read and not a missing record: an account with no bindings.
      expect(v.floorReadable).toBe(true);
      expect(v.failure).toBeNull();
      expect(v.addresses).toEqual(['0x0000000000000000000000000000000000000000']);
    } finally {
      if (previousDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDb;
    }
  });
});

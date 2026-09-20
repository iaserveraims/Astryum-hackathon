/**
 * productizer it. 25 — UNA LECTURA ILEGIBLE JAMÁS ENCIERRA A NADIE FUERA DE SU
 * APLICACIÓN.
 *
 * The pure logic is proved next door (config/__tests__/legalAcceptance.test.ts).
 * THIS file exists because testing the pieces does not prove the chain exists —
 * the lesson this repo keeps re-learning. The bug was never in one function: it
 * was in the JOIN between three correct decisions.
 *
 *   1. `readTakeoverAtStrict` fails closed on an unparseable
 *      `preferences.security` — right, and it stays;
 *   2. `applyPreferencesUpdate` refuses to write over a `preferences` column
 *      that is not an object (409 `PREFERENCES_UNREADABLE`, not retryable) —
 *      right, and it stays: the object it would write has no `security` key,
 *      and a row with no `security` key resurrects every binding the previous
 *      holder attached;
 *   3. the client mounts a NON-DISMISSABLE modal whenever `legal.required` is
 *      true, in front of the whole /app tree.
 *
 * Joined: GET /auth/me said `required: true` for a row nobody could read, the
 * modal opened, its only button posted /auth/legal-accept, and that answered
 * 409 for ever. The person could not enter — and the legal gate sits in front
 * of every capital route, so their EXITS were behind it too.
 *
 * So these tests drive the two real endpoints over a corrupt column and assert
 * the two halves of the way out: /auth/me does NOT ask for a signature, and
 * /auth/legal-accept still refuses (it must) but hands back the same
 * «unreadable» verdict instead of leaving the caller in a loop.
 */

const mockUserFindUnique = jest.fn();
const mockTransaction = jest.fn();
const mockTxUserFindUnique = jest.fn();
const mockTxUserUpdateMany = jest.fn();
const mockTxUserUpdate = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

// The session is live and belongs to this user; the takeover race is proved in
// its own suite. Everything else in liveSession stays real so the route's
// `isSessionRevoked` branch behaves exactly as it does in production.
jest.mock('../../services/identity/liveSession', () => ({
  ...jest.requireActual('../../services/identity/liveSession'),
  lockAndAssertLiveSession: jest.fn().mockResolvedValue({ preferences: null }),
}));

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { siwe?: unknown }, _res: unknown, next: () => void) => {
    req.siwe = { userId: 'user-1', sessionId: 's1', walletAddress: 'rUser' };
    next();
  },
}));

// Module-load weight the legal surface does not need: the SIWE/OAuth machinery,
// the points engine and the admin allowlist router.
jest.mock('../../services/SiweAuth', () => ({
  issueNonce: jest.fn(),
  buildSiweMessage: jest.fn(),
  verifySiweAndIssueToken: jest.fn(),
  revokeSessionForToken: jest.fn(),
  getLinkedWallets: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../engines/points/PointsEngine', () => ({
  PointsEngine: { getInstance: () => ({ grantSafe: jest.fn() }) },
}));
jest.mock('../../services/AuthService', () => ({
  authService: {},
  resetTokenExposureEnabled: () => false,
}));
jest.mock('../adminPanel', () => ({ isAdminEmail: () => false }));

import express from 'express';
import request from 'supertest';
import authRouter from '../auth';
import { PRIVACY_NOTICE_VERSION } from '../../config/legalAcceptance';

/** The account row as /auth/me selects it, with whatever sits in `preferences`. */
function accountRow(preferences: unknown) {
  return {
    email: 'someone@example.com',
    emailVerified: true,
    username: 'someone',
    firstName: null,
    lastName: null,
    avatar: null,
    preferences,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // The real `updateUserPreferences` runs against this fake transaction, so the
  // 409 in these tests is raised by the production code path, not by a stub.
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      user: {
        findUnique: (...a: unknown[]) => mockTxUserFindUnique(...a),
        updateMany: (...a: unknown[]) => mockTxUserUpdateMany(...a),
        update: (...a: unknown[]) => mockTxUserUpdate(...a),
      },
    }),
  );
  mockTxUserUpdateMany.mockResolvedValue({ count: 1 });
  mockTxUserUpdate.mockResolvedValue({});
});

// The two shapes that closed the loop, plus the one that merely looped for ever.
const CORRUPT_COLUMN = 'this row is not an object';
const CORRUPT_MARK = { security: { takeoverAt: 'not a date' }, legal: { termsVersion: 'x', privacyVersion: 'y', acceptedAt: 'z' } };

describe('GET /api/auth/me — a record we cannot read does not become a door', () => {
  it.each([
    ['the whole preferences column is corrupt', CORRUPT_COLUMN],
    ['the takeover mark does not parse', CORRUPT_MARK],
  ])('%s ⇒ the person is let in, and told we could not check', async (_label, preferences) => {
    mockUserFindUnique.mockResolvedValue(accountRow(preferences));

    const res = await request(buildApp()).get('/api/auth/me');

    expect(res.status).toBe(200);
    // THE FIX, in one line: no modal, so no lock-out, so no gated exit.
    expect(res.body.legal.required).toBe(false);
    // …and the client is told WHY it is closed, so it can say the honest thing
    // instead of silently pretending everything is signed.
    expect(res.body.legal.unreadable).toBe(true);
    // Never «you have not signed»: no reason, and no signature we cannot
    // attribute to whoever holds the account right now.
    expect(res.body.legal.reason).toBeNull();
    expect(res.body.legal.accepted).toBeNull();
    expect(res.body.legal.privacyVersion).toBe(PRIVACY_NOTICE_VERSION);
  });

  it('a readable account that never signed still gets the gate (nothing was loosened)', async () => {
    mockUserFindUnique.mockResolvedValue(accountRow({}));

    const res = await request(buildApp()).get('/api/auth/me');

    expect(res.status).toBe(200);
    expect(res.body.legal.required).toBe(true);
    expect(res.body.legal.reason).toBe('first');
    expect(res.body.legal.unreadable).toBe(false);
  });
});

describe('POST /api/auth/legal-accept — the 409 stops being a dead end', () => {
  it('still refuses to write over a column it cannot read (no resurrection)', async () => {
    mockTxUserFindUnique.mockResolvedValue({ preferences: CORRUPT_COLUMN });

    const res = await request(buildApp())
      .post('/api/auth/legal-accept')
      .send({ terms: true, privacyRead: true });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PREFERENCES_UNREADABLE');
    expect(res.body.retryable).toBe(false);
    // Nothing was persisted: the refusal is raised before the UPDATE.
    expect(mockTxUserUpdate).not.toHaveBeenCalled();
  });

  it('…and hands back the SAME verdict /auth/me reports, so the gate retires itself', async () => {
    mockTxUserFindUnique.mockResolvedValue({ preferences: CORRUPT_COLUMN });
    mockUserFindUnique.mockResolvedValue(accountRow(CORRUPT_COLUMN));

    const app = buildApp();
    const refused = await request(app).post('/api/auth/legal-accept').send({ terms: true, privacyRead: true });
    const me = await request(app).get('/api/auth/me');

    // One answer, one story — a `curl` caller does not need our UI to
    // understand that waiting and retrying are not the way out.
    expect(refused.body.legal).toEqual(me.body.legal);
    expect(refused.body.legal.unreadable).toBe(true);
    expect(refused.body.legal.required).toBe(false);
  });

  it('a readable column still records the signature and closes the gate', async () => {
    mockTxUserFindUnique.mockResolvedValue({ preferences: { appearance: { theme: 'dark' } } });

    const res = await request(buildApp())
      .post('/api/auth/legal-accept')
      .send({ terms: true, privacyRead: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.legal.required).toBe(false);
    expect(res.body.legal.unreadable).toBe(false);
    expect(res.body.legal.accepted?.privacyVersion).toBe(PRIVACY_NOTICE_VERSION);
    // Sibling keys survive, as they always did.
    const written = mockTxUserUpdate.mock.calls[0][0].data.preferences as Record<string, unknown>;
    expect(written.appearance).toEqual({ theme: 'dark' });
  });
});

const mockUserFindUnique = jest.fn();
const mockUserCount = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserGroupBy = jest.fn();
const mockWalletCount = jest.fn();
const mockGovernedAccountCount = jest.fn();
const mockCouncilProposalCount = jest.fn();
const mockWaitlistFindMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      count: (...a: unknown[]) => mockUserCount(...a),
      findMany: (...a: unknown[]) => mockUserFindMany(...a),
      groupBy: (...a: unknown[]) => mockUserGroupBy(...a),
    },
    wallet: {
      count: (...a: unknown[]) => mockWalletCount(...a),
    },
    governedAccount: {
      count: (...a: unknown[]) => mockGovernedAccountCount(...a),
    },
    councilProposal: {
      count: (...a: unknown[]) => mockCouncilProposalCount(...a),
    },
    waitlistSignup: {
      // .count/.groupBy are gone from the route (§ signal-vs-noise, 2026-07-23):
      // the overview now derives both from a single findMany + isNoiseEmail.
      findMany: (...a: unknown[]) => mockWaitlistFindMany(...a),
    },
  },
}));

// waitlist.ts is imported by adminPanel.ts for isNoiseEmail, but it also
// wires up SMTP/Resend at module load (services/waitlistMailer) — stub the
// mailer so the test never touches that transport.
jest.mock('../../services/waitlistMailer', () => ({
  sendWaitlistWelcome: jest.fn(),
  mailerDiag: jest.fn(),
  verifyMailer: jest.fn(),
  testSend: jest.fn(),
}));

// /alerts reads the ops-alert inbox via a dynamic import — stub the store so
// the route test never needs a DB.
const mockListOpsAlerts = jest.fn();
jest.mock('../../services/OpsAlertStore', () => ({
  listOpsAlerts: (...a: unknown[]) => mockListOpsAlerts(...a),
}));

// The router imports requireSiweAuth for its session-less mount; stub it so
// the test never touches the real JWT/session stack. Mirrors the real
// middleware's contract: no valid bearer → 401, request handled.
const mockRequireSiweAuth = jest.fn(
  async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
  },
);
jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (...a: unknown[]) => mockRequireSiweAuth(...(a as [unknown, never])),
}));

import express from 'express';
import request from 'supertest';
import adminPanelRouter, { _resetKeyFailuresForTests, isAdminEmail } from '../adminPanel';

const USER_ID = 'user-1';
const ADMIN_EMAIL = 'founder@astryum.xyz';
const PANEL_KEY = 'orbital-hangar-9';
const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;
const ORIGINAL_ADMIN_PANEL_KEY = process.env.ADMIN_PANEL_KEY;

function buildApp(withSession = true) {
  const app = express();
  app.use(express.json());
  if (withSession) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: { userId: string } }).siwe = {
        userId: USER_ID,
        sessionId: 's1',
        walletAddress: '0x0',
      } as never;
      next();
    });
  }
  app.use('/api/admin-panel', adminPanelRouter);
  return app;
}

// One real signup per source, plus noise that must never pollute counts/bySource:
// a@example.com (reserved RFC 2606) and spam@mailinator.com (disposable).
function mockHealthyCounts() {
  mockUserCount.mockResolvedValue(3);
  mockWalletCount.mockResolvedValue(5);
  mockGovernedAccountCount.mockResolvedValue(1);
  mockCouncilProposalCount.mockResolvedValue(2);
  mockWaitlistFindMany.mockResolvedValue([
    { email: 'spam@mailinator.com', source: 'early-access', lang: 'en', createdAt: new Date(2) },
    { email: 'bot@example.com', source: 'early-access', lang: 'en', createdAt: new Date(1) },
    { email: 'real@astryum.xyz', source: 'early-access', lang: 'en', createdAt: new Date(0) },
    { email: 'other@astryum.xyz', source: 'register', lang: 'en', createdAt: new Date(0) },
    { email: 'another@astryum.xyz', source: 'register', lang: 'en', createdAt: new Date(0) },
    { email: 'third@astryum.xyz', source: 'register', lang: 'en', createdAt: new Date(0) },
  ]);
  mockUserFindMany.mockResolvedValue([
    // An email account that later linked Google: BOTH badges must surface,
    // and the raw oauthSub must never leave the backend.
    { email: 'a@astryum.xyz', username: 'ada', createdAt: new Date(0), lastLogin: null, authProvider: 'email', oauthSub: 'google:1234567890' },
    { email: 'b@astryum.xyz', username: null, createdAt: new Date(0), lastLogin: null, authProvider: 'apple', oauthSub: 'apple:000123.abc' },
  ]);
  mockUserGroupBy.mockResolvedValue([
    { authProvider: 'email', _count: { _all: 2 } },
    { authProvider: 'apple', _count: { _all: 1 } },
  ]);
}

beforeEach(() => {
  mockUserFindUnique.mockReset();
  mockUserCount.mockReset();
  mockUserFindMany.mockReset();
  mockUserGroupBy.mockReset();
  mockWalletCount.mockReset();
  mockGovernedAccountCount.mockReset();
  mockCouncilProposalCount.mockReset();
  mockWaitlistFindMany.mockReset();
  mockListOpsAlerts.mockReset();
  mockRequireSiweAuth.mockClear();
  _resetKeyFailuresForTests();
  // Each test opens exactly the doors it needs.
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_PANEL_KEY;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_EMAILS === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  if (ORIGINAL_ADMIN_PANEL_KEY === undefined) delete process.env.ADMIN_PANEL_KEY;
  else process.env.ADMIN_PANEL_KEY = ORIGINAL_ADMIN_PANEL_KEY;
});

describe('GET /api/admin-panel/overview — gate', () => {
  test('neither env configured → 404, the surface does not even look up the caller', async () => {
    const res = await request(buildApp()).get('/api/admin-panel/overview');
    expect(res.status).toBe(404);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(mockWaitlistFindMany).not.toHaveBeenCalled();
  });

  test('static door: correct x-admin-key → 200 without any session', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockHealthyCounts();
    const res = await request(buildApp(false))
      .get('/api/admin-panel/overview')
      .set('x-admin-key', PANEL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.counts.users).toBe(3);
    expect(mockRequireSiweAuth).not.toHaveBeenCalled();
  });

  test('static door: wrong key → 401 BAD_ADMIN_KEY, nothing read', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const res = await request(buildApp(false))
      .get('/api/admin-panel/overview')
      .set('x-admin-key', 'not-the-key');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('BAD_ADMIN_KEY');
    expect(mockUserCount).not.toHaveBeenCalled();
    expect(mockWaitlistFindMany).not.toHaveBeenCalled();
  });

  test('static door only, no key presented → 401 ADMIN_KEY_REQUIRED', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const res = await request(buildApp(false)).get('/api/admin-panel/overview');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('ADMIN_KEY_REQUIRED');
    expect(mockUserCount).not.toHaveBeenCalled();
  });

  test('siwe door: caller email not on the allowlist → 403, no sensitive data read', async () => {
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    mockUserFindUnique.mockResolvedValue({ email: 'someone-else@example.com' });
    const res = await request(buildApp()).get('/api/admin-panel/overview');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_AN_ADMIN');
    expect(mockUserFindMany).not.toHaveBeenCalled();
    expect(mockUserCount).not.toHaveBeenCalled();
    expect(mockWaitlistFindMany).not.toHaveBeenCalled();
  });

  test('siwe door: no session → the auth middleware answers 401, prisma never consulted', async () => {
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    const res = await request(buildApp(false)).get('/api/admin-panel/overview');
    expect(res.status).toBe(401);
    expect(mockRequireSiweAuth).toHaveBeenCalledTimes(1);
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  test('siwe door: listed admin (case-insensitive, whitespace-tolerant) → 200 with counts, never passwordHash', async () => {
    process.env.ADMIN_EMAILS = ` Other@Founder.xyz , ${ADMIN_EMAIL.toUpperCase()} `;
    mockUserFindUnique.mockResolvedValue({ email: ADMIN_EMAIL });
    mockHealthyCounts();

    const res = await request(buildApp()).get('/api/admin-panel/overview');

    expect(res.status).toBe(200);
    // 6 raw rows, 2 noise (mailinator + example.com) → 4 clean, split 1/3 by source.
    expect(res.body.counts).toEqual({
      users: 3,
      wallets: 5,
      governedAccounts: 1,
      councilProposals: 2,
      waitlistSignups: 4,
      waitlistNoise: 2,
      waitlistBySource: { 'early-access': 1, register: 3 },
      usersByProvider: { email: 2, apple: 1 },
    });
    expect(res.body.waitlist).toHaveLength(4);
    expect(res.body.waitlist.every((r: { noise: boolean }) => r.noise === false)).toBe(true);
    expect(res.body.recentUsers).toHaveLength(2);
    // Provider separation: creation origin + linked OAuth identity, and the
    // raw oauthSub (provider subject id) never leaves the backend.
    expect(res.body.recentUsers[0].authProviders).toEqual(['email', 'google']);
    expect(res.body.recentUsers[1].authProviders).toEqual(['apple']);
    expect(JSON.stringify(res.body)).not.toContain('1234567890');

    // The recentUsers query must never select passwordHash/resetToken —
    // assert on the actual `select` clause, not just the mocked payload.
    const findManyArg = mockUserFindMany.mock.calls[0][0];
    expect(findManyArg.select).toEqual({
      email: true,
      username: true,
      createdAt: true,
      lastLogin: true,
      authProvider: true,
      oauthSub: true,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|resetToken/i);
  });

  test('waitlist noise is hidden by default and never counted in waitlistBySource', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockHealthyCounts();

    const res = await request(buildApp(false))
      .get('/api/admin-panel/overview')
      .set('x-admin-key', PANEL_KEY);

    expect(res.status).toBe(200);
    const emails = res.body.waitlist.map((r: { email: string }) => r.email);
    expect(emails).not.toContain('spam@mailinator.com');
    expect(emails).not.toContain('bot@example.com');
  });

  test('?includeNoise=1 returns the top 200 by recency, noisy rows tagged noise:true', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockHealthyCounts();

    const res = await request(buildApp(false))
      .get('/api/admin-panel/overview?includeNoise=1')
      .set('x-admin-key', PANEL_KEY);

    expect(res.status).toBe(200);
    // Counts stay signal-only even when the audit view is requested.
    expect(res.body.counts.waitlistSignups).toBe(4);
    expect(res.body.counts.waitlistNoise).toBe(2);
    expect(res.body.waitlist).toHaveLength(6);
    const bySource = new Map(res.body.waitlist.map((r: { email: string; noise: boolean }) => [r.email, r.noise]));
    expect(bySource.get('spam@mailinator.com')).toBe(true);
    expect(bySource.get('bot@example.com')).toBe(true);
    expect(bySource.get('real@astryum.xyz')).toBe(false);
  });
});

describe('GET /api/admin-panel/alerts — the ops-alert inbox', () => {
  test('unconfigured panel → 404, the store is never read', async () => {
    const res = await request(buildApp()).get('/api/admin-panel/alerts');
    expect(res.status).toBe(404);
    expect(mockListOpsAlerts).not.toHaveBeenCalled();
  });

  test('static-key door → 200 with alerts, counts by level, sorted sources', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockListOpsAlerts.mockResolvedValue([
      { id: '1', source: '0xFE-executor', level: 'critical', message: 'saldo bajo', at: '2026-07-26T10:02:00.000Z' },
      { id: '2', source: 'xrpl-watch', level: 'warn', message: 'reintento', at: '2026-07-26T10:01:00.000Z' },
      { id: '3', source: '0xFE-executor', level: 'info', message: 'sweep ok', at: '2026-07-26T10:00:00.000Z' },
    ]);

    const res = await request(buildApp(false))
      .get('/api/admin-panel/alerts')
      .set('x-admin-key', PANEL_KEY);

    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(3);
    expect(res.body.counts).toEqual({ info: 1, warn: 1, critical: 1 });
    expect(res.body.sources).toEqual(['0xFE-executor', 'xrpl-watch']);
    expect(typeof res.body.checkedAt).toBe('string');
    // Bounded read: the route caps the limit it asks the store for.
    const arg = mockListOpsAlerts.mock.calls[0][0];
    expect(arg.limit).toBeLessThanOrEqual(500);
  });

  test('wrong admin key → 401, the store is never touched', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const res = await request(buildApp(false))
      .get('/api/admin-panel/alerts')
      .set('x-admin-key', 'not-the-key');
    expect(res.status).toBe(401);
    expect(mockListOpsAlerts).not.toHaveBeenCalled();
  });
});

describe('isAdminEmail — the /auth/me visibility hint (2026-07-25)', () => {
  test('matches the allowlist case-insensitively; unset env means nobody is admin', () => {
    expect(isAdminEmail(ADMIN_EMAIL)).toBe(false); // env deleted in beforeEach
    process.env.ADMIN_EMAILS = ` Other@Founder.xyz , ${ADMIN_EMAIL.toUpperCase()} `;
    expect(isAdminEmail(ADMIN_EMAIL)).toBe(true);
    expect(isAdminEmail(' other@founder.xyz ')).toBe(true);
    expect(isAdminEmail('someone-else@example.com')).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});

describe('POST /api/admin-panel/session — the 2h panel session (2026-07-23 hardening)', () => {
  test('unconfigured panel → 404, no hint that the endpoint exists', async () => {
    const res = await request(buildApp(false)).post('/api/admin-panel/session').send({ key: 'whatever' });
    expect(res.status).toBe(404);
  });

  test('correct key → token that opens the overview via x-admin-session', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockHealthyCounts();

    const created = await request(buildApp(false)).post('/api/admin-panel/session').send({ key: PANEL_KEY });
    expect(created.status).toBe(200);
    expect(typeof created.body.token).toBe('string');
    expect(new Date(created.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const res = await request(buildApp(false))
      .get('/api/admin-panel/overview')
      .set('x-admin-session', created.body.token);
    expect(res.status).toBe(200);
    expect(res.body.counts.users).toBe(3);
  });

  test('wrong key → 401; a forged/garbage session token → 401 ADMIN_SESSION_EXPIRED', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const bad = await request(buildApp(false)).post('/api/admin-panel/session').send({ key: 'nope' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('BAD_ADMIN_KEY');

    const forged = await request(buildApp(false))
      .get('/api/admin-panel/overview')
      .set('x-admin-session', 'not-a-jwt');
    expect(forged.status).toBe(401);
    expect(forged.body.error).toBe('ADMIN_SESSION_EXPIRED');
    expect(mockUserCount).not.toHaveBeenCalled();
  });

  test('10 wrong keys from one IP → 429 BEFORE any comparison; a correct key is never throttled', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const app = buildApp(false);
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/admin-panel/session')
        .set('x-forwarded-for', '198.51.100.9')
        .send({ key: `guess-${i}` });
      expect(res.status).toBe(401);
    }
    const throttledRes = await request(app)
      .post('/api/admin-panel/session')
      .set('x-forwarded-for', '198.51.100.9')
      .send({ key: 'guess-11' });
    expect(throttledRes.status).toBe(429);
    expect(throttledRes.body.error).toBe('TOO_MANY_ATTEMPTS');

    // A different caller with the RIGHT key still walks straight in.
    const ok = await request(app)
      .post('/api/admin-panel/session')
      .set('x-forwarded-for', '198.51.100.10')
      .send({ key: PANEL_KEY });
    expect(ok.status).toBe(200);
  });

  test('failed x-admin-key attempts share the same per-IP throttle', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const app = buildApp(false);
    for (let i = 0; i < 10; i++) {
      await request(app)
        .get('/api/admin-panel/overview')
        .set('x-forwarded-for', '198.51.100.20')
        .set('x-admin-key', `guess-${i}`);
    }
    const throttledRes = await request(app)
      .get('/api/admin-panel/overview')
      .set('x-forwarded-for', '198.51.100.20')
      .set('x-admin-key', PANEL_KEY); // even the right key answers 429 once the IP is burnt
    expect(throttledRes.status).toBe(429);
  });
});

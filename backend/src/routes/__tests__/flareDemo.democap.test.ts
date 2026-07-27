/**
 * The demo cap is actually WIRED into the /api/flare-demo router (middleware), not just
 * unit-tested in isolation (config/__tests__/demoCap.test.ts). Proves: an over-cap mint
 * POST is rejected before the handler; an exempt address bypasses it; and when the demo
 * is off the cap is moot (503 precedence preserved). All three reject before any RPC.
 */
// Account-based exemption (2026-07-25): the middleware resolves the authenticated
// userId → email through prisma. Mock the client so the wired test proves the
// req.siwe → demoCapFromBody plumbing without a real DB.
const mockUserFindUnique = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
    backgroundJob: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}));

import express from 'express';
import request from 'supertest';
import flareDemoRouter from '../flareDemo';
import { _resetDemoCapState } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

// Same router with an authenticated session injected (the real mount sits behind
// requireSiweAuth, so req.siwe is always populated in production).
const authedApp = express();
authedApp.use(express.json());
authedApp.use((req, _res, next) => {
  (req as express.Request & { siwe: unknown }).siwe = { userId: 'user-1', sessionId: 's1', walletAddress: '0x0' };
  next();
});
authedApp.use('/api/flare-demo', flareDemoRouter);

const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

beforeEach(() => {
  _resetDemoCapState();
  _resetFeeLedgerForTests();
  mockUserFindUnique.mockReset();
});
afterEach(() => {
  delete process.env.FLARE_DEFI_ENABLED;
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_CAP_EXEMPT_ADDRESSES;
  delete process.env.DEMO_CAP_EXEMPT_EMAILS;
  delete process.env.DATABASE_URL;
  delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
  delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
});

describe('flare-demo router — demo cap is WIRED (middleware)', () => {
  it('rejects an over-cap E1 mint with DEMO_TX_CAP_EXCEEDED when the demo is live', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    const res = await request(app)
      .post('/api/flare-demo/e1/prepare')
      .send({ xrplAddress: XRPL, amountXrp: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
  });

  it('lets an EXPLICITLY exempt address through even over the cap', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    process.env.DEMO_CAP_EXEMPT_ADDRESSES = XRPL;
    const res = await request(app)
      .post('/api/flare-demo/e1/prepare')
      .send({ xrplAddress: XRPL, amountXrp: 5 });
    // Exempt → the cap does not fire; the request proceeds (then 503 ISO_MARKET, but NOT the cap).
    expect(res.body.error).not.toBe('DEMO_TX_CAP_EXCEEDED');
  });

  it('exempts an ACCOUNT on DEMO_CAP_EXEMPT_EMAILS whichever wallet it pays from (req.siwe wired)', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    process.env.DEMO_CAP_EXEMPT_EMAILS = 'founder@astryum.xyz';
    process.env.DATABASE_URL = 'postgres://mocked';
    mockUserFindUnique.mockResolvedValue({ email: 'Founder@Astryum.xyz' });
    const res = await request(authedApp)
      .post('/api/flare-demo/e1/prepare')
      .send({ xrplAddress: XRPL, amountXrp: 5 }); // address NOT on any list — the account exempts
    expect(res.body.error).not.toBe('DEMO_TX_CAP_EXCEEDED');
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { email: true } });

    // The same over-cap body from an account NOT on the list is still rejected.
    mockUserFindUnique.mockResolvedValue({ email: 'judge@example.com' });
    const capped = await request(authedApp)
      .post('/api/flare-demo/e1/prepare')
      .send({ xrplAddress: XRPL, amountXrp: 5 });
    expect(capped.status).toBe(400);
    expect(capped.body.error).toBe('DEMO_TX_CAP_EXCEEDED');
  });

  it('is moot when the demo is off — the flag/geofence 503 keeps precedence', async () => {
    delete process.env.FLARE_DEFI_ENABLED;
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    const res = await request(app)
      .post('/api/flare-demo/e1/prepare')
      .send({ xrplAddress: XRPL, amountXrp: 5 });
    expect(res.status).toBe(503);
  });

  it('GET /cap-status reports caps + today spend + exemption, and reading never consumes', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    process.env.DEMO_MAX_XRP_PER_TX = '10';
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '100';
    // A passing prepare records its XRP at cap-check time (prepare-level accounting).
    await request(app).post('/api/flare-demo/e1/prepare').send({ xrplAddress: XRPL, amountXrp: 1 });
    const res = await request(app).get(`/api/flare-demo/cap-status?address=${XRPL}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      maxXrpPerTx: 10,
      maxXrpPerDay: 100,
      spentTodayXrp: 1,
      remainingTodayXrp: 99,
      exempt: false,
      active: true,
    });
    const again = await request(app).get(`/api/flare-demo/cap-status?address=${XRPL}`);
    expect(again.body.spentTodayXrp).toBe(1); // the gauge does not move on read
  });

  it('GET /cap-status marks an exempt ACCOUNT (req.siwe wired)', async () => {
    process.env.DEMO_CAP_EXEMPT_EMAILS = 'founder@astryum.xyz';
    process.env.DATABASE_URL = 'postgres://mocked';
    mockUserFindUnique.mockResolvedValue({ email: 'founder@astryum.xyz' });
    const res = await request(authedApp).get(`/api/flare-demo/cap-status?address=${XRPL}`);
    expect(res.status).toBe(200);
    expect(res.body.exempt).toBe(true);
    expect(res.body.spentTodayXrp).toBe(0);
  });

  it('§3 — refuses an XRPL-mint BEFORE signing when the executor fee budget is exhausted', async () => {
    process.env.FLARE_DEFI_ENABLED = 'true';
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    process.env.DEMO_CAP_EXEMPT_ADDRESSES = XRPL; // skip the cap → reach the budget pre-check
    process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR = '40'; // = the Legacy reserve → 0 effective 0xFE budget
    process.env.LEGACY_DAILY_FEE_RESERVE_FLR = '40';
    const res = await request(app)
      .post('/api/flare-demo/e1/prepare')
      .send({ xrplAddress: XRPL, amountXrp: 1 });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('DEMO_DAILY_OPS_EXHAUSTED');
  });
});

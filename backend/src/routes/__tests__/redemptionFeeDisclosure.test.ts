/**
 * productizer-it9 §3.4 — the two unmint doors disclose the FAssets redemption fee
 * as a figure (invariant #6), read live (#9); an unreadable fee is null plus a line
 * that says so — never 0, never a silent omission.
 *
 * Doors: `/api/flare-demo/pa-unmint/prepare` and `/api/institutional/pote-exit-xrp/prepare`.
 * The chain is mocked at the FlareDirectMintService / preflight seam.
 */
import express from 'express';
import request from 'supertest';

const mockFeeBips = jest.fn();
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readRedemptionFeeBips: (...a: unknown[]) => mockFeeBips(...a),
  readDirectMintParams: jest.fn(async () => ({ minFeeUBA: 100_000n, feeBIPS: 10n, executorFeeUBA: 200_000n })),
  computeNetMint: jest.fn(() => ({ netToPersonalAccountUBA: 500_000n, supplyUBA: 500_000n })),
  mintFeeDisclosure: jest.fn(() => ({})),
  readFxrpBalance: jest.fn(async () => 20_000_000n),
  readMinimumRedeemAmountUBA: jest.fn(async () => 5_000_000n),
  buildRedeemToXrplCall: jest.fn(async () => ({ to: '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8', calldata: '0xab', value: '0' })),
  buildDirectMintHandoff: jest.fn(async () => ({
    personalAccount: '0xeeee000000000000000000000000000000000001',
    xrplPayment: { TransactionType: 'Payment' },
    memoHex: 'FE00',
    userOpData: '0x',
  })),
  resolveRedemptionExecutor: jest.fn(async () => '0x0000000000000000000000000000000000000000'),
}));
jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(async () => '0xeeee000000000000000000000000000000000001'),
}));
jest.mock('../../services/flare/preparePreflight', () => ({
  ...jest.requireActual('../../services/flare/preparePreflight'),
  preflightXrplPayment: jest.fn(async () => ({ ok: true })),
  preflightEvmCalls: jest.fn(async () => ({ ok: true })),
  mergePreflights: jest.fn(() => ({ ok: true })),
}));

import flareDemoRouter from '../flareDemo';
import institutionalRouter from '../institutional';
import { _resetDemoCapState } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);
app.use('/api/institutional', institutionalRouter);

const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  process.env.FLARE_DEFI_ENABLED = 'true';
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY;
  delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
  delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
  _resetDemoCapState();
  _resetFeeLedgerForTests();
});
afterAll(() => {
  process.env = ENV;
});

describe('POST /api/flare-demo/pa-unmint/prepare — redemption fee disclosure', () => {
  const body = { xrplAddress: XRPL, amountFxrpBase: '10000000', amountXrpForMint: 1 };

  it('discloses the live fee in BIPS and the estimated FXRP on the redeemed amount', async () => {
    mockFeeBips.mockResolvedValue(20);
    const res = await request(app).post('/api/flare-demo/pa-unmint/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure).toMatchObject({ redemptionFeeBips: 20, redemptionFeeFxrp: 0.02, disclosedToUser: true });
    expect(res.body.disclosure.redemptionFeeLine).toContain('0.2%');
    expect(res.body.disclosure.redemptionFeeLine).toContain('0.02 FXRP');
  });

  it('an unreadable fee is null with a line that says NOT zero', async () => {
    mockFeeBips.mockResolvedValue(null);
    const res = await request(app).post('/api/flare-demo/pa-unmint/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure.redemptionFeeBips).toBeNull();
    expect(res.body.disclosure.redemptionFeeFxrp).toBeNull();
    expect(res.body.disclosure.redemptionFeeLine).toMatch(/could not be read/);
    expect(res.body.disclosure.redemptionFeeLine).toMatch(/NOT zero/);
  });
});

describe('POST /api/institutional/pote-exit-xrp/prepare — redemption fee disclosure', () => {
  const body = { amountFxrpBase: '10000000', xrplDestination: XRPL };

  it('discloses the live fee in BIPS, the estimated FXRP, and a line with the figure', async () => {
    mockFeeBips.mockResolvedValue(20);
    const res = await request(app).post('/api/institutional/pote-exit-xrp/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure).toMatchObject({ redemptionFeeBips: 20, redemptionFeeFxrp: 0.02, disclosedToUser: true });
    expect(res.body.disclosure.lines.some((l: string) => l.includes('0.2%') && l.includes('0.02 FXRP'))).toBe(true);
  });

  it('an unreadable fee is null with a line that says it is NOT zero', async () => {
    mockFeeBips.mockResolvedValue(null);
    const res = await request(app).post('/api/institutional/pote-exit-xrp/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure.redemptionFeeBips).toBeNull();
    expect(res.body.disclosure.redemptionFeeFxrp).toBeNull();
    expect(res.body.disclosure.lines.some((l: string) => /NO es cero/.test(l))).toBe(true);
  });
});

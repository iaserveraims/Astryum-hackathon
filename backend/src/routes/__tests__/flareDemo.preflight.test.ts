/**
 * /e1-borrow/prepare × the REAL preflight helper — endpoint-level proof of
 * invariant #11: the prepare's `preflight` says whether the dry-run expects
 * the borrow to execute, and a broken simulator NEVER breaks the prepare.
 *
 * Hermetic like the other flareDemo suites: chain reads via FakeContract, and
 * here ALSO a fake JsonRpcProvider whose eth_call is scenario-driven — so the
 * request flows through the genuine preflightEvmCalls (no stubs on it).
 */
import express from 'express';
import request from 'supertest';

const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const USDT0_TOKEN = '0xe7cd86e13AC4309349F30B3435a9d337750fC82D';
const WALLET = '0xeabcd745598916b0131ece397c8d6a332088462c';
const PA = '0x1111111111111111111111111111111111111111';
const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

// Same live-collateral state as flareDemo.isoDirect: member, 9.6 FXRP, no debt
// → e1-borrow prepares a SINGLE borrow call, fully dry-runnable today.
// USDT0: the wallet holds 10 and has a STANDING allowance, so the repay/supply
// steps that ride an approve are individually dry-runnable in the happy cases.
const CHAIN: Record<string, Record<string, unknown>> = {
  [ISO_COMPTROLLER.toLowerCase()]: { markets: [true, 750000000000000000n], checkMembership: true },
  [KFXRP_ISO.toLowerCase()]: { balanceOfUnderlying: 9_600_014n },
  [KUSDT0_ISO.toLowerCase()]: { borrowBalanceCurrent: 0n, underlying: USDT0_TOKEN },
  [USDT0_TOKEN.toLowerCase()]: { balanceOf: 10_000_000n, allowance: 10n ** 30n },
};

/** What the fake node answers to the preflight's eth_call. */
const RPC: { mode: 'clean' | 'insufficient-cash' | 'revert' | 'down' } = { mode: 'clean' };

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = CHAIN[address.toLowerCase()] ?? {};
      for (const [fn, value] of Object.entries(state)) {
        const impl = async () => value;
        (impl as unknown as { staticCall: () => Promise<unknown> }).staticCall = impl;
        this[fn] = impl;
      }
    }
  }
  const coder = actual.ethers.AbiCoder.defaultAbiCoder();
  class FakeRpcProvider {
    async call(): Promise<string> {
      if (RPC.mode === 'down') {
        throw Object.assign(new Error('ECONNREFUSED'), { code: 'NETWORK_ERROR' });
      }
      if (RPC.mode === 'revert') {
        throw Object.assign(new Error('reverted'), { code: 'CALL_EXCEPTION', reason: 'borrow paused' });
      }
      return coder.encode(['uint256'], [RPC.mode === 'insufficient-cash' ? 14 : 0]);
    }
  }
  return {
    ...actual,
    ethers: { ...actual.ethers, Contract: FakeContract, JsonRpcProvider: FakeRpcProvider },
  };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return {
    ...actual,
    createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 2.0 }),
  };
});

// 0xFE routes: the hand-off builder does the heavy on-chain lifting (mint
// params, PA resolution, nonce seats) — stubbed; what stays REAL here is the
// route's preflight assembly over its output.
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => {
  const actual = jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService');
  return {
    ...actual,
    buildDirectMintHandoff: jest.fn(async () => ({
      personalAccount: '0x1111111111111111111111111111111111111111',
      xrplPayment: { TransactionType: 'Payment', Destination: 'rVault', Amount: '1000000' },
      memoHex: 'FE00',
      userOpData: '0x00',
      net: { netToPersonalAccountUBA: 900_000n, mintingFeeUBA: 50_000n, executorFeeUBA: 50_000n, supplyUBA: 0n },
    })),
  };
});

// The XRPL half of the merged preflight — stubbed at the provider seam (its
// own degradation matrix is covered by preparePreflight.test.ts).
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: {
    simulateTransaction: jest.fn(async () => ({
      available: true,
      willSucceed: true,
      engineResult: 'tesSUCCESS',
      balanceChanges: [],
    })),
  },
}));

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';
import { _resetDemoCapState } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

// The 0xFE prepares RESERVE executor fuel (modelo reserva→confirmación, v2) —
// without a reset each mint-shaped prepare in this suite eats the budget and
// the later ones 429 for reasons alien to the preflight under test.
beforeEach(() => {
  _resetDemoCapState();
  _resetFeeLedgerForTests();
});

beforeAll(() => {
  process.env.FLARE_DEFI_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  process.env.FXRP_TOKEN = FXRP;
  process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
  process.env.KINETIC_KFXRP_ISO = KFXRP_ISO;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  resetAddressCache();
});
afterAll(() => {
  delete process.env.FLARE_DEFI_ENABLED;
});

const prepare = () =>
  request(app).post('/api/flare-demo/e1-borrow/prepare').send({ evmAddress: WALLET, borrowRatio: 0.3 });

describe('e1-borrow/prepare — preflight through the REAL helper', () => {
  it('clean dry-run ⇒ preflight.willSucceed=true with the borrow step verified', async () => {
    RPC.mode = 'clean';
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
    expect(res.body.preflight.steps).toEqual([{ label: 'borrow USDT0', verdict: 'ok' }]);
  });

  it('market without cash (Kinetic RETURNS code 14) ⇒ willSucceed=false, reason named, prepare intact', async () => {
    RPC.mode = 'insufficient-cash';
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(res.body.preflight.reason).toMatch(/TOKEN_INSUFFICIENT_CASH/);
    // The prepare itself is untouched — same unsigned calls, same disclosure.
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.disclosure.disclosedToUser).toBe(true);
  });

  it('a REVERTING borrow ⇒ willSucceed=false with the decoded revert reason', async () => {
    RPC.mode = 'revert';
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(res.body.preflight.reason).toMatch(/borrow paused/);
  });

  it('simulator down ⇒ available=false and the prepare still answers 200 (never a 500)', async () => {
    RPC.mode = 'down';
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: false, willSucceed: false });
    expect(res.body.calls).toHaveLength(1);
  });
});

describe('a1/prepare — preflight from the SIGNING wallet', () => {
  const body = {
    personalAccount: PA,
    supplyUBA: '9600014',
    debtUsdt0Base: '4320000',
    collateralFactor: 0.75,
    mode: 'full',
  };

  it('with signerAddress: clean dry-run ⇒ willSucceed=true, both steps verified (standing allowance)', async () => {
    RPC.mode = 'clean';
    const res = await request(app)
      .post('/api/flare-demo/a1/prepare')
      .send({ ...body, signerAddress: WALLET });
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
    expect(res.body.preflight.steps.map((s: { verdict: string }) => s.verdict)).toEqual(['ok', 'ok']);
    expect(res.body.calls).toHaveLength(2); // response shape intact
  });

  it('without signerAddress: no preflight field — there is no honest `from` to simulate with', async () => {
    RPC.mode = 'clean';
    const res = await request(app).post('/api/flare-demo/a1/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.preflight).toBeUndefined();
    expect(res.body.calls).toHaveLength(2);
  });

  it('simulator down ⇒ prepare still 200, preflight degraded to available=false', async () => {
    RPC.mode = 'down';
    const res = await request(app)
      .post('/api/flare-demo/a1/prepare')
      .send({ ...body, signerAddress: WALLET });
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: false, willSucceed: false });
    expect(res.body.calls).toHaveLength(2);
  });
});

describe('supply-usdt0/prepare — BOTH rails carry the preflight', () => {
  it('EVM-direct rail: clean dry-run ⇒ verified approve + supply (standing allowance)', async () => {
    RPC.mode = 'clean';
    const res = await request(app)
      .post('/api/flare-demo/supply-usdt0/prepare')
      .send({ evmAddress: WALLET, amountUsdt0Base: '1000000' });
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
    expect(res.body.preflight.steps.map((s: { verdict: string }) => s.verdict)).toEqual(['ok', 'ok']);
  });

  it('0xFE rail: merged verdict — XRPL Payment + approve verified, the supply honestly unverified', async () => {
    RPC.mode = 'clean';
    const res = await request(app)
      .post('/api/flare-demo/supply-usdt0/prepare')
      .send({ xrplAddress: XRPL, amountUsdt0Base: '1000000', amountXrpForMint: 1 });
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
    expect(res.body.preflight.steps.map((s: { label: string; verdict: string }) => [s.label, s.verdict])).toEqual([
      ['XRPL Payment', 'ok'],
      ['approve USDT0', 'ok'],
      ['supply USDT0', 'unverified'], // rides the approve of this same batch
    ]);
    expect(res.body.xrplPayment).toBeDefined(); // response shape intact
    // Invariante #6 — the dispatch's fees always ride the disclosure.
    expect(res.body.disclosure.mintingFeeXrp).toBeCloseTo(0.05, 6);
    expect(res.body.disclosure.executorFeeXrp).toBeCloseTo(0.05, 6);
  });

  it('0xFE rail with the EVM simulator down ⇒ 200, the XRPL leg still answers (merge keeps it available)', async () => {
    RPC.mode = 'down';
    const res = await request(app)
      .post('/api/flare-demo/supply-usdt0/prepare')
      .send({ xrplAddress: XRPL, amountUsdt0Base: '1000000', amountXrpForMint: 1 });
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
  });
});

describe('pa-withdraw-transfer/prepare — the redeem guard fires BEFORE anyone signs', () => {
  const body = { xrplAddress: XRPL, evmWallet: WALLET, asset: 'usdt0', amountBase: '1000000', amountXrpForMint: 1 };

  it('clean ⇒ withdraw verified, transfer honestly unverified (moves what the redeem releases)', async () => {
    RPC.mode = 'clean';
    const res = await request(app).post('/api/flare-demo/pa-withdraw-transfer/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
    expect(res.body.preflight.steps.map((s: { verdict: string }) => s.verdict)).toEqual(['ok', 'ok', 'unverified']);
    // Invariante #6 — the dispatch's fees always ride the disclosure.
    expect(res.body.disclosure.mintingFeeXrp).toBeCloseTo(0.05, 6);
    expect(res.body.disclosure.executorFeeXrp).toBeCloseTo(0.05, 6);
  });

  it('Kinetic refuses the redeem (RETURNED code 14) ⇒ willSucceed=false with the reason, prepare intact', async () => {
    RPC.mode = 'insufficient-cash';
    const res = await request(app).post('/api/flare-demo/pa-withdraw-transfer/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.preflight.willSucceed).toBe(false);
    expect(res.body.preflight.reason).toMatch(/TOKEN_INSUFFICIENT_CASH/);
    expect(res.body.xrplPayment).toBeDefined();
  });
});

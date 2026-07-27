/**
 * ISO actions for WALLET-HELD positions (EVM-direct rail):
 *   /iso-withdraw/prepare — redeemUnderlying handed to the holding wallet.
 *   /e1-borrow/prepare    — complete a HALF-OPEN carry (supply landed, borrow
 *                           didn't — the sequential-signing gap of 2026-07-14).
 *
 * Hermetic: FTSO stubbed, chain reads via a fake ethers.Contract keyed by
 * address. What stays REAL: validation, gating, live-collateral math and the
 * disclosure contract. Every assertion is over UNSIGNED payloads.
 */
import express from 'express';
import request from 'supertest';

const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const WALLET = '0xeabcd745598916b0131ece397c8d6a332088462c';

// The founder's real half-open state (2026-07-14): 9.600014 FXRP supplied,
// zero USDT0 debt, kFXRP membership already entered.
const CHAIN: Record<string, Record<string, unknown>> = {
  [ISO_COMPTROLLER.toLowerCase()]: {
    markets: [true, 750000000000000000n], // CF 0.75
    checkMembership: true,
  },
  [KFXRP_ISO.toLowerCase()]: {
    balanceOfUnderlying: 9_600_014n,
    balanceOf: 9_500_000n, // kToken shares (exchange rate > 1 → fewer shares)
  },
  [KUSDT0_ISO.toLowerCase()]: {
    borrowBalanceCurrent: 0n,
    balanceOfUnderlying: 3_000_000n, // 3 USDT0 supplied (carry step 2)
    balanceOf: 2_950_000n,
  },
};

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
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return {
    ...actual,
    createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 2.0 }),
  };
});

// The invariant-#11 preflight dry-runs against a LIVE RPC — stubbed here so the
// suite stays hermetic (its real behaviour is covered by preparePreflight.test.ts
// and flareDemo.preflight.test.ts); this suite only checks it flows through.
jest.mock('../../services/flare/preparePreflight', () => {
  const actual = jest.requireActual('../../services/flare/preparePreflight');
  return {
    ...actual,
    preflightEvmCalls: jest.fn(async () => ({ available: true, willSucceed: true, steps: [] })),
    preflightXrplPayment: jest.fn(async () => ({ available: false, willSucceed: false, reason: 'stub' })),
  };
});

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

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
  delete process.env.FXRP_TOKEN;
  delete process.env.KINETIC_ISO_COMPTROLLER;
  delete process.env.KINETIC_KFXRP_ISO;
  delete process.env.KINETIC_KUSDT0_ISO;
  resetAddressCache();
});

describe('POST /api/flare-demo/iso-withdraw/prepare', () => {
  it('400 on bad inputs; 503 when the flag is off', async () => {
    const badAddr = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: 'nope', asset: 'usdt0', amountBase: '1000000' });
    expect(badAddr.status).toBe(400);

    const badAsset = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'flr', amountBase: '1000000' });
    expect(badAsset.status).toBe(400);
    expect(badAsset.body.error).toBe('INVALID_ASSET');

    process.env.FLARE_DEFI_ENABLED = 'false';
    const gated = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'usdt0', amountBase: '1000000' });
    expect(gated.status).toBe(503);
    process.env.FLARE_DEFI_ENABLED = 'true';
  });

  it('returns ONE unsigned redeemUnderlying call on the right ISO market', async () => {
    const usdt0 = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'usdt0', amountBase: '1500000' });
    expect(usdt0.status).toBe(200);
    expect(usdt0.body.rail).toBe('evm');
    expect(usdt0.body.calls).toHaveLength(1);
    expect(usdt0.body.calls[0].to).toBe(KUSDT0_ISO);
    // redeemUnderlying(uint256) — 0x852a12e3
    expect(usdt0.body.calls[0].data.startsWith('0x852a12e3')).toBe(true);
    expect(usdt0.body.disclosure.amount).toBeCloseTo(1.5, 6);
    expect(usdt0.body.disclosure.defibroSigns).toBe(false);

    const fxrp = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'fxrp', amountBase: '9600014' });
    expect(fxrp.status).toBe(200);
    expect(fxrp.body.calls[0].to).toBe(KFXRP_ISO);
  });

  it('discloses the LIVE available supply alongside every prepare', async () => {
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'usdt0', amountBase: '1000000' });
    expect(res.status).toBe(200);
    expect(res.body.disclosure.available).toBeCloseTo(3, 6);
    expect(res.body.disclosure.availableBase).toBe('3000000');
    expect(res.body.disclosure.all).toBe(false);
  });

  it('all:true = EXACT full exit — ONE redeem-by-shares call, interest included', async () => {
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'usdt0', all: true });
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(KUSDT0_ISO);
    // redeem(uint256) — 0xdb006a75 — by SHARES, not redeemUnderlying.
    expect(res.body.calls[0].data.startsWith('0xdb006a75')).toBe(true);
    const d = res.body.disclosure;
    expect(d.all).toBe(true);
    expect(d.amount).toBeCloseTo(3, 6); // live underlying estimate
    expect(d.sharesRedeemed).toBeCloseTo(2.95, 6); // ALL the kToken shares
    expect(d.defibroSigns).toBe(false);
  });

  it('409 INSUFFICIENT_SUPPLY with the live balance when asking above it', async () => {
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'usdt0', amountBase: '3000001' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_SUPPLY');
    expect(res.body.available).toBeCloseTo(3, 6);
    expect(res.body.requested).toBeCloseTo(3.000001, 6);
  });

  it('GET /iso-legs/:owner returns the LIVE legs (never a snapshot)', async () => {
    const res = await request(app).get(`/api/flare-demo/iso-legs/${WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.supplyFxrpBase).toBe('9600014');
    expect(res.body.suppliedUsdt0Base).toBe('3000000');
    expect(res.body.debtUsdt0Base).toBeNull(); // no debt in the fixture
    expect(String(res.body.source)).toContain('live on-chain');
  });

  it('409 NO_SUPPLY_TO_WITHDRAW when the wallet has nothing in that market', async () => {
    CHAIN[KUSDT0_ISO.toLowerCase()].balanceOfUnderlying = 0n;
    const res = await request(app)
      .post('/api/flare-demo/iso-withdraw/prepare')
      .send({ evmAddress: WALLET, asset: 'usdt0', all: true });
    CHAIN[KUSDT0_ISO.toLowerCase()].balanceOfUnderlying = 3_000_000n;
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_SUPPLY_TO_WITHDRAW');
  });
});

describe('POST /api/flare-demo/e1-borrow/prepare', () => {
  it('completes the half-open carry: borrow-only call, live-collateral math', async () => {
    const res = await request(app)
      .post('/api/flare-demo/e1-borrow/prepare')
      .send({ evmAddress: WALLET, borrowRatio: 0.3, targetHF: 1.1 });

    expect(res.status).toBe(200);
    expect(res.body.rail).toBe('evm');
    // Membership already entered → NO enterMarkets, just borrow(uint256) 0xc5ebeaec.
    expect(res.body.calls).toHaveLength(1);
    expect(res.body.calls[0].to).toBe(KUSDT0_ISO);
    expect(res.body.calls[0].data.startsWith('0xc5ebeaec')).toBe(true);

    const d = res.body.disclosure;
    // 9.600014 FXRP × $2 × 0.75 CF × 0.30 ratio = $4.32 borrow.
    expect(d.fxrpCollateral).toBeCloseTo(9.600014, 6);
    expect(d.existingDebtUsdt0).toBe(0);
    expect(d.usdt0Borrowed).toBeCloseTo(4.32, 2);
    expect(d.entryHF).toBeCloseTo((9.600014 * 2 * 0.75) / d.usdt0Borrowed, 3);
    expect(res.body.a1.triggerPriceUSD).toBeGreaterThan(0);
    expect(d.disclosedToUser).toBe(true);
    expect(d.defibroSigns).toBe(false);
    // Invariant #11 — the prepare carries the dry-run verdict for the review UI.
    expect(res.body.preflight).toMatchObject({ available: true, willSucceed: true });
  });

  it('prepends enterMarkets when the account is not a member yet', async () => {
    CHAIN[ISO_COMPTROLLER.toLowerCase()].checkMembership = false;
    const res = await request(app)
      .post('/api/flare-demo/e1-borrow/prepare')
      .send({ evmAddress: WALLET, borrowRatio: 0.3 });
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(2);
    expect(res.body.calls[0].to).toBe(ISO_COMPTROLLER);
    // enterMarkets(address[]) — 0xc2998238
    expect(res.body.calls[0].data.startsWith('0xc2998238')).toBe(true);
    CHAIN[ISO_COMPTROLLER.toLowerCase()].checkMembership = true;
  });

  it('409 NO_COLLATERAL without supply; 409 ALREADY_AT_RATIO when debt covers the ratio', async () => {
    CHAIN[KFXRP_ISO.toLowerCase()].balanceOfUnderlying = 0n;
    const noCol = await request(app)
      .post('/api/flare-demo/e1-borrow/prepare')
      .send({ evmAddress: WALLET, borrowRatio: 0.3 });
    expect(noCol.status).toBe(409);
    expect(noCol.body.error).toBe('NO_COLLATERAL');
    CHAIN[KFXRP_ISO.toLowerCase()].balanceOfUnderlying = 9_600_014n;

    CHAIN[KUSDT0_ISO.toLowerCase()].borrowBalanceCurrent = 5_000_000n; // $5 debt > $4.32 target
    const atRatio = await request(app)
      .post('/api/flare-demo/e1-borrow/prepare')
      .send({ evmAddress: WALLET, borrowRatio: 0.3 });
    expect(atRatio.status).toBe(409);
    expect(atRatio.body.error).toBe('ALREADY_AT_RATIO');
    CHAIN[KUSDT0_ISO.toLowerCase()].borrowBalanceCurrent = 0n;
  });
});

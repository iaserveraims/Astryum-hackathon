/**
 * M7 (audit 2026-07) — DERISK carry-spread shortfall disclosure of /a1/prepare.
 *
 * Hermetic by construction: the live FTSO read is skipped via a scenario
 * fxrpPriceUSD, and the ONLY on-chain read in the a1 path — resolving the ISO
 * market's USDT0 underlying via kUSDT0_ISO.underlying() — is stubbed by faking
 * ethers.Contract. Everything else (validation, gate, KineticIsoMath, calldata
 * encoding in KineticAdapter) is the real code path. Astryum signs nothing:
 * every assertion is over UNSIGNED calls + the disclosure.
 */
import express from 'express';
import request from 'supertest';

// The ISO USDT0 underlying the fake underlying() returns (lowercase → getAddress
// normalises it; value itself is irrelevant to the math under test).
const USDT0_UNDERLYING = '0xe7cd86e13ac4309349f30b3435a262c46aa4740a';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    underlying: () => Promise<string>;
    constructor() {
      this.underlying = async () => USDT0_UNDERLYING;
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

import flareDemoRouter from '../flareDemo';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

const PA = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const KUSDT0_ISO = '0xad7e79896a2f9be508a02e327c04e0e57eba2ceb';

// Position: 5 FXRP collateral @ $2, CF 0.7, debt 1.05 USDT0 → HF ≈ 6.67 (safe),
// so mode='full' exercises the whole-debt repay with no restore interference.
const base = {
  personalAccount: PA,
  supplyUBA: '5000000',
  debtUsdt0Base: '1050000',
  collateralFactor: 0.7,
  fxrpPriceUSD: 2.0, // scenario price → no live FTSO read
  mode: 'full',
};

beforeAll(() => {
  process.env.FLARE_DEFI_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED; // defaults to enabled
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  resetAddressCache();
});

afterAll(() => {
  delete process.env.FLARE_DEFI_ENABLED;
  delete process.env.KINETIC_KUSDT0_ISO;
  resetAddressCache();
});

describe('POST /api/flare-demo/a1/prepare — DERISK shortfall disclosure (M7)', () => {
  it('debt outgrew the withdrawn supply → discloses the exact top-up and warns in the note', async () => {
    // DERISK step 1 yielded 1.00 USDT0 but the full repay needs 1.05.
    const res = await request(app)
      .post('/api/flare-demo/a1/prepare')
      .send({ ...base, withdrawableUsdt0Base: '1000000' });

    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(2); // unsigned [approve, repayBorrowBehalf]
    const d = res.body.disclosure;
    expect(d.repayUsdt0).toBeCloseTo(1.05, 6);
    expect(d.withdrawableUsdt0).toBeCloseTo(1.0, 6);
    expect(d.shortfallUsdt0).toBeCloseTo(0.05, 6);
    expect(d.coveredByWithdraw).toBe(false);
    expect(d.note).toMatch(/top up 0\.05 USDT0/);
    expect(d.disclosedToUser).toBe(true);
    expect(d.defibroSigns).toBe(false);
  });

  it('withdrawal covers the full repay → shortfall 0, no top-up warning', async () => {
    const res = await request(app)
      .post('/api/flare-demo/a1/prepare')
      .send({ ...base, withdrawableUsdt0Base: '2000000' });

    expect(res.status).toBe(200);
    const d = res.body.disclosure;
    expect(d.shortfallUsdt0).toBe(0);
    expect(d.coveredByWithdraw).toBe(true);
    expect(d.note).not.toMatch(/top up/);
  });

  it('withdrawableUsdt0Base omitted → disclosure unchanged (backwards-compatible)', async () => {
    const res = await request(app).post('/api/flare-demo/a1/prepare').send(base);

    expect(res.status).toBe(200);
    const d = res.body.disclosure;
    expect(d).not.toHaveProperty('shortfallUsdt0');
    expect(d).not.toHaveProperty('withdrawableUsdt0');
    expect(d).not.toHaveProperty('coveredByWithdraw');
    expect(d.repayUsdt0).toBeCloseTo(1.05, 6);
  });
});

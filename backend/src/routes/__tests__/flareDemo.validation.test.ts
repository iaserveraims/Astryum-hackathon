/**
 * Input-validation contract of the /api/flare-demo/* prepare routes
 * (2026-07 audit — P0 input hardening).
 *
 * Hermetic by construction: every validation guard runs BEFORE the
 * FLARE_DEFI_ENABLED gate, and the gate runs before any RPC/FTSO read. So:
 *   - malformed input  → 400 with a stable error code (never a 500), and
 *   - well-formed input → 503 FLARE_DEFI_DISABLED (flag unset in tests),
 * which proves validation passed without touching the network.
 */
import express from 'express';
import request from 'supertest';
import flareDemoRouter from '../flareDemo';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

const GOOD_XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh'; // valid classic address
const GOOD_EVM = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';

beforeEach(() => {
  delete process.env.FLARE_DEFI_ENABLED; // gate closed → valid input ⇒ 503
});

describe('POST /api/flare-demo/e1/prepare — validation', () => {
  const valid = { xrplAddress: GOOD_XRPL, amountXrp: 5, borrowRatio: 0.3, targetHF: 1.1 };

  it('rejects a missing XRPL address', async () => {
    const res = await request(app).post('/api/flare-demo/e1/prepare').send({ ...valid, xrplAddress: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_XRPL_ADDRESS');
  });

  it.each(['0x1234', 'not-an-address', 'rIL0O', 'r'])(
    'rejects a malformed XRPL address (%s) with 400, not 500',
    async (bad) => {
      const res = await request(app).post('/api/flare-demo/e1/prepare').send({ ...valid, xrplAddress: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_XRPL_ADDRESS');
    },
  );

  it.each(['Infinity', '1e400', 'NaN', -1, 0, 'abc'])(
    'rejects non-finite / non-positive amountXrp (%s)',
    async (bad) => {
      const res = await request(app).post('/api/flare-demo/e1/prepare').send({ ...valid, amountXrp: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_AMOUNT');
    },
  );

  it('rejects a non-finite targetHF', async () => {
    const res = await request(app).post('/api/flare-demo/e1/prepare').send({ ...valid, targetHF: Infinity });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_TARGET_HF');
  });

  it('valid input passes validation and stops at the feature-flag gate (no RPC)', async () => {
    const res = await request(app).post('/api/flare-demo/e1/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('POST /api/flare-demo/e2/prepare — validation', () => {
  const valid = { amountFlr: 10, provider: GOOD_EVM, bips: 10000 };

  it('rejects a bad-checksum (mixed-case) provider address with 400, not 500', async () => {
    // Same 40 hex chars, EIP-55 checksum deliberately broken.
    const badChecksum = '0x1d80C49BbBCd1C0911346656B529DF9E5c2F783d';
    const res = await request(app).post('/api/flare-demo/e2/prepare').send({ ...valid, provider: badChecksum });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_FTSO_PROVIDER');
  });

  it('rejects Infinity amountFlr', async () => {
    const res = await request(app).post('/api/flare-demo/e2/prepare').send({ ...valid, amountFlr: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNT');
  });

  it('rejects out-of-range bips', async () => {
    const res = await request(app).post('/api/flare-demo/e2/prepare').send({ ...valid, bips: 10001 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BIPS');
  });

  it('valid input stops at the feature-flag gate', async () => {
    const res = await request(app).post('/api/flare-demo/e2/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('POST /api/flare-demo/a1/prepare — validation', () => {
  const valid = {
    personalAccount: GOOD_EVM,
    supplyUBA: '5000000',
    debtUsdt0Base: '1000000',
    collateralFactor: 0.7,
    targetHF: 1.1,
  };

  it('rejects a non-integer supplyUBA', async () => {
    const res = await request(app).post('/api/flare-demo/a1/prepare').send({ ...valid, supplyUBA: '1.5' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNTS');
  });

  it('rejects an out-of-range collateralFactor', async () => {
    const res = await request(app).post('/api/flare-demo/a1/prepare').send({ ...valid, collateralFactor: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_COLLATERAL_FACTOR');
  });

  it('rejects a provided non-finite scenario price instead of treating it as "safe"', async () => {
    const res = await request(app).post('/api/flare-demo/a1/prepare').send({ ...valid, fxrpPriceUSD: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PRICE');
  });

  it('rejects an unknown mode', async () => {
    const res = await request(app).post('/api/flare-demo/a1/prepare').send({ ...valid, mode: 'yolo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_MODE');
  });

  it.each(['1.5', 'abc', -1])(
    'rejects a malformed/negative withdrawableUsdt0Base (%s) with 400, not 500',
    async (bad) => {
      const res = await request(app).post('/api/flare-demo/a1/prepare').send({ ...valid, withdrawableUsdt0Base: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_WITHDRAWABLE');
    },
  );

  it('valid input with withdrawableUsdt0Base passes validation and stops at the gate', async () => {
    const res = await request(app).post('/api/flare-demo/a1/prepare').send({ ...valid, withdrawableUsdt0Base: '1000000' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });

  it('valid input stops at the feature-flag gate', async () => {
    const res = await request(app).post('/api/flare-demo/a1/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('POST /api/flare-demo/supply-usdt0/prepare — validation', () => {
  const valid = { xrplAddress: GOOD_XRPL, amountUsdt0Base: '1000000', amountXrpForMint: 1 };

  it('rejects a malformed XRPL address', async () => {
    const res = await request(app).post('/api/flare-demo/supply-usdt0/prepare').send({ ...valid, xrplAddress: '0xdead' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_XRPL_ADDRESS');
  });

  it('rejects Infinity amountXrpForMint', async () => {
    const res = await request(app).post('/api/flare-demo/supply-usdt0/prepare').send({ ...valid, amountXrpForMint: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_MINT_AMOUNT');
  });

  it('valid input stops at the feature-flag gate', async () => {
    const res = await request(app).post('/api/flare-demo/supply-usdt0/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('POST /api/flare-demo/pa-withdraw-transfer/prepare — validation', () => {
  const valid = {
    xrplAddress: GOOD_XRPL,
    evmWallet: GOOD_EVM,
    asset: 'usdt0',
    amountBase: '1000000',
    amountXrpForMint: 1,
  };

  it('rejects a malformed XRPL address', async () => {
    const res = await request(app).post('/api/flare-demo/pa-withdraw-transfer/prepare').send({ ...valid, xrplAddress: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_XRPL_ADDRESS');
  });

  it('rejects a bad-checksum EVM wallet with 400, not 500', async () => {
    const badChecksum = '0x1d80C49BbBCd1C0911346656B529DF9E5c2F783d';
    const res = await request(app).post('/api/flare-demo/pa-withdraw-transfer/prepare').send({ ...valid, evmWallet: badChecksum });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_EVM_WALLET');
  });

  it('rejects an unknown asset', async () => {
    const res = await request(app).post('/api/flare-demo/pa-withdraw-transfer/prepare').send({ ...valid, asset: 'wflr' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSET');
  });

  it('valid input stops at the feature-flag gate', async () => {
    const res = await request(app).post('/api/flare-demo/pa-withdraw-transfer/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });

  // Unmint variant: FXRP → native XRP, no EVM wallet needed (2026-07-26).
  it('rejects unmintToXrpl on a non-FXRP asset (only FXRP redeems to XRP)', async () => {
    const res = await request(app)
      .post('/api/flare-demo/pa-withdraw-transfer/prepare')
      .send({ ...valid, asset: 'usdt0', unmintToXrpl: true, evmWallet: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('UNMINT_REQUIRES_FXRP');
  });

  it('unmintToXrpl with FXRP needs NO evmWallet — passes validation, stops at the gate', async () => {
    const res = await request(app)
      .post('/api/flare-demo/pa-withdraw-transfer/prepare')
      .send({ xrplAddress: GOOD_XRPL, asset: 'fxrp', amountBase: '5000000', amountXrpForMint: 1, unmintToXrpl: true });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('POST /api/flare-demo/pa-unmint/prepare — validation', () => {
  const valid = { xrplAddress: GOOD_XRPL, amountFxrpBase: '5000000', amountXrpForMint: 1 };

  it('rejects a malformed XRPL address', async () => {
    const res = await request(app).post('/api/flare-demo/pa-unmint/prepare').send({ ...valid, xrplAddress: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_XRPL_ADDRESS');
  });

  it('rejects a non-finite mint amount', async () => {
    const res = await request(app).post('/api/flare-demo/pa-unmint/prepare').send({ ...valid, amountXrpForMint: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_MINT_AMOUNT');
  });

  it('rejects a malformed xrplDest override', async () => {
    const res = await request(app).post('/api/flare-demo/pa-unmint/prepare').send({ ...valid, xrplDest: '0xdead' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_XRPL_DESTINATION');
  });

  it('valid input (default destination = owner) stops at the feature-flag gate', async () => {
    const res = await request(app).post('/api/flare-demo/pa-unmint/prepare').send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });

  it('valid input with useMax (no amountFxrpBase) stops at the gate', async () => {
    const res = await request(app)
      .post('/api/flare-demo/pa-unmint/prepare')
      .send({ xrplAddress: GOOD_XRPL, useMax: true, amountXrpForMint: 1 });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

describe('GET /api/flare-demo/pa-fxrp/:owner — validation', () => {
  it('rejects a malformed owner address with 400 (not 500)', async () => {
    const res = await request(app).get('/api/flare-demo/pa-fxrp/not-an-address');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ADDRESS');
  });
});

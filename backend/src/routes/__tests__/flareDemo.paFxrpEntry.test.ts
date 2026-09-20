/**
 * Smart-Account entry (fromSmartAccount) — validation contract of the three
 * strategy prepares.
 *
 * Hermetic like flareDemo.validation.test.ts: every guard here runs BEFORE
 * the FLARE_DEFI_ENABLED gate, so malformed input → stable 400 code and
 * well-formed input → 503 FLARE_DEFI_DISABLED, proving validation passed
 * without touching the network. The on-chain half (PA balance read, carrier
 * net joining the supply, handoff assembly) rides the same primitives the
 * existing supply-usdt0 / vault-rotate suites already pin.
 */
import express from 'express';
import request from 'supertest';
import flareDemoRouter from '../flareDemo';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

const GOOD_XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const GOOD_EVM = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';

beforeEach(() => {
  delete process.env.FLARE_DEFI_ENABLED; // gate closed → valid input ⇒ 503
});

const ROUTES: Array<{ path: string; extra: Record<string, unknown> }> = [
  { path: '/api/flare-demo/e1/prepare', extra: { borrowRatio: 0.3, targetHF: 1.1 } },
  { path: '/api/flare-demo/e3/prepare', extra: {} },
  { path: '/api/flare-demo/vault/prepare', extra: { vault: 'firelight' } },
];

describe.each(ROUTES)('fromSmartAccount entry — $path', ({ path, extra }) => {
  const valid = {
    xrplAddress: GOOD_XRPL,
    amountFxrp: 5,
    fromSmartAccount: true,
    amountXrpForMint: 1,
    ...extra,
  };

  it('requires the carrier Payment (the 0xFE dispatch is mint-coupled)', async () => {
    const res = await request(app).post(path).send({ ...valid, amountXrpForMint: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_MINT_AMOUNT');
  });

  it.each(['Infinity', 'NaN', -1, 0])('rejects a non-positive carrier (%s)', async (bad) => {
    const res = await request(app).post(path).send({ ...valid, amountXrpForMint: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_MINT_AMOUNT');
  });

  it('rejects mixing fromSmartAccount with an evmAddress (the PA cannot sign EVM)', async () => {
    const res = await request(app).post(path).send({ ...valid, evmAddress: GOOD_EVM });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_COMBINATION');
  });

  it('still requires the owning XRPL address (the signer)', async () => {
    const res = await request(app).post(path).send({ ...valid, xrplAddress: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_XRPL_ADDRESS');
  });

  it('reads the amount from amountFxrp (the FXRP already in the account)', async () => {
    const res = await request(app).post(path).send({ ...valid, amountFxrp: undefined });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_AMOUNT');
  });

  it('valid input passes validation and stops at the feature-flag gate (no RPC)', async () => {
    const res = await request(app).post(path).send(valid);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('FLARE_DEFI_DISABLED');
  });
});

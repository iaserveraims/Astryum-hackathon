/**
 * THE EXIT IS NEVER GATED (doctrine) — the flare-demo router.
 *
 * A holder's exit (redeem / claim / withdraw / unwind back to their own wallet) must
 * not be blocked by policy: not by the geofence, not by the per-address daily budget.
 * What stays is physics and blast radius: the FLARE_DEFI_ENABLED flag, the 0xFE
 * carrier's per-TRANSACTION cap (flareDemo.capRoutes.test.ts) and the executor fuel
 * pre-check — the latter with an honest message for an exit.
 *
 * Hermetic: no chain. ethers.Contract / JsonRpcProvider are empty fakes, so any read
 * PAST the gate throws and the handler's catch answers 5xx — which is exactly what
 * "got past the gate" looks like. The control that the body was valid (validation
 * runs before the gate) is the flag-off run answering 503 FLARE_DEFI_DISABLED.
 */
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {}
  class FakeRpcProvider {}
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract, JsonRpcProvider: FakeRpcProvider } };
});

jest.mock('../../engines/normalisation/NormalisationEngine', () => {
  const actual = jest.requireActual('../../engines/normalisation/NormalisationEngine');
  return {
    ...actual,
    createFTSOPriceProvider: async () => {
      throw new Error('NO_FTSO_IN_TEST');
    },
  };
});

import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';
import flareDemoRouter from '../flareDemo';
import { EXIT_PREPARE_ROUTES, EXIT_PREPARE_PATHS } from '../../config/demoCapRoutes';
import { _resetDemoCapState, checkDemoCap, getDemoCapStatus } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';
import { jurisdictionService } from '../../services/JurisdictionService';

const app = express();
app.use(express.json());
app.use('/api/flare-demo', flareDemoRouter);

const EVM = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const BLOCKED = 'US';

/** A VALID body for every exit route (validation runs before the gate). */
const EXIT_BODIES: Record<string, Record<string, unknown>> = {
  '/e2/exit/prepare': { account: EVM, amountFlr: 1 },
  '/pa-withdraw-transfer/prepare': {
    xrplAddress: XRPL,
    asset: 'fxrp',
    amountBase: '1000000',
    keepInPa: true,
    amountXrpForMint: 0.5,
  },
  '/pa-unmint/prepare': { xrplAddress: XRPL, amountXrpForMint: 0.5 },
  '/pa-transfer/prepare': { xrplAddress: XRPL, evmWallet: EVM, amountFxrpBase: '1000000', amountXrpForMint: 0.5 },
  '/iso-withdraw/prepare': { evmAddress: EVM, asset: 'fxrp', amountBase: '1000000' },
  '/vault-withdraw/prepare': { vault: 'firelight', sharesBase: '1000000', evmAddress: EVM },
  '/vault-claim/prepare': { period: 1, evmAddress: EVM },
  '/a1/prepare': { personalAccount: EVM, supplyUBA: '1000000', debtUsdt0Base: '500000' },
  '/pa-repay/prepare': { xrplAddress: XRPL, amountXrpForMint: 0.5 },
};

const ENV = { ...process.env };
let geoSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...ENV };
  process.env.FLARE_DEFI_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY;
  delete process.env.DEMO_CAP_EXEMPT_ADDRESSES;
  delete process.env.DEMO_CAP_EXEMPT_EMAILS;
  delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
  delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
  _resetDemoCapState();
  _resetFeeLedgerForTests();
  geoSpy = jest.spyOn(jurisdictionService, 'isDefiExecutionAllowed');
});

afterEach(() => {
  geoSpy.mockRestore();
});

afterAll(() => {
  process.env = ENV;
});

describe('exit routes are enumerated and each has a test body', () => {
  it('every EXIT_PREPARE_ROUTES path is exercised here (a new exit route needs a body)', () => {
    expect(Object.keys(EXIT_BODIES).sort()).toEqual([...EXIT_PREPARE_PATHS].sort());
  });
});

describe('geofence — an EXIT is never blocked by region; an ENTRY still is', () => {
  it.each(Object.keys(EXIT_BODIES))('%s: a blocked region gets past the gate', async (path) => {
    // Control: the body is valid — with the flag off it reaches the (flag) gate.
    delete process.env.FLARE_DEFI_ENABLED;
    const off = await request(app).post(`/api/flare-demo${path}`).send({ ...EXIT_BODIES[path], region: BLOCKED });
    expect({ path, status: off.status, error: off.body?.error }).toEqual({
      path,
      status: 503,
      error: 'FLARE_DEFI_DISABLED',
    });

    process.env.FLARE_DEFI_ENABLED = 'true';
    const res = await request(app).post(`/api/flare-demo${path}`).send({ ...EXIT_BODIES[path], region: BLOCKED });
    expect({ path, status: res.status }).not.toEqual({ path, status: 451 });
    expect(String(res.body?.error ?? '')).not.toMatch(/GEOFENCE/);
    expect(geoSpy).not.toHaveBeenCalled();
  }, 20_000);

  it('an ENTRY (/e2/prepare) in a blocked region still answers 451', async () => {
    const res = await request(app)
      .post('/api/flare-demo/e2/prepare')
      .send({ amountFlr: 1, provider: EVM, region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.error).toMatch(/^GEOFENCE_BLOCKED/);
    expect(geoSpy).toHaveBeenCalled();
  });

  it('a ROTATION (redeem A → deposit B) is an entry, not an exit: still 451', async () => {
    const res = await request(app)
      .post('/api/flare-demo/vault-rotate/prepare')
      .send({ fromVault: 'firelight', toVault: 'earnxrp', sharesBase: '1000000', evmAddress: EVM, region: BLOCKED });
    expect(res.status).toBe(451);
  });

  it('by source: every exit handler uses the flag-only gate; no exit calls the geofenced gate', () => {
    const SOURCE = readFileSync(join(__dirname, '..', 'flareDemo.ts'), 'utf8');
    const blockOf = (path: string): string => {
      const start = SOURCE.indexOf(`router.post('${path}'`);
      expect({ path, found: start > -1 }).toEqual({ path, found: true });
      const next = SOURCE.indexOf('\nrouter.', start + 10);
      return SOURCE.slice(start, next === -1 ? undefined : next);
    };
    for (const path of EXIT_PREPARE_PATHS) {
      const body = blockOf(path);
      expect({ path, flagOnly: body.includes('gateFlareDemoExit()') }).toEqual({ path, flagOnly: true });
      expect({ path, geofenced: body.includes('gateFlareDemo(') }).toEqual({ path, geofenced: false });
    }
  });
});

describe('the per-address DAILY budget never refuses an exit carrier', () => {
  it('an address that exhausted today still gets every exit carrier (within per-tx) past the cap — and nothing is reserved', async () => {
    process.env.DEMO_MAX_XRP_PER_TX = '1';
    process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY = '2';
    // Today's entries reserved the whole budget (two 1-XRP prepares: per-tx cap is 1).
    expect(await checkDemoCap(1, XRPL)).toBeNull();
    expect(await checkDemoCap(1, XRPL)).toBeNull();

    // Control: an ENTRY from the same address is refused by the daily budget.
    const entry = await request(app).post('/api/flare-demo/e1/prepare').send({ xrplAddress: XRPL, amountXrp: 1 });
    expect(entry.status).toBe(429);
    expect(entry.body.error).toBe('DEMO_DAILY_CAP_EXCEEDED');

    for (const { path, carrierField } of EXIT_PREPARE_ROUTES) {
      if (!carrierField) continue;
      const res = await request(app)
        .post(`/api/flare-demo${path}`)
        .send({ ...EXIT_BODIES[path], xrplAddress: XRPL, [carrierField]: 1 });
      expect({ path, error: res.body?.error }).not.toEqual({ path, error: 'DEMO_DAILY_CAP_EXCEEDED' });
      expect({ path, error: res.body?.error }).not.toEqual({ path, error: 'DEMO_TX_CAP_EXCEEDED' });
    }

    // The exit prepares neither read-refused nor reserved: the gauge still shows only the entries.
    const status = await getDemoCapStatus(XRPL);
    expect(status.spentTodayXrp).toBe(2);
  }, 30_000);
});

describe('executor fuel exhausted — an exit gets the honest message', () => {
  it('says the capital has not moved, the exit needs the executor, retry later — never "daily limit"', async () => {
    process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR = '40'; // = the Legacy reserve → 0 effective 0xFE budget
    process.env.LEGACY_DAILY_FEE_RESERVE_FLR = '40';

    const res = await request(app)
      .post('/api/flare-demo/pa-unmint/prepare')
      .send({ xrplAddress: XRPL, amountXrpForMint: 0.5 });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('EXECUTOR_FUEL_EXHAUSTED');
    expect(res.body.detail).toMatch(/no se ha movido/);
    expect(res.body.detail).toMatch(/executor/);
    expect(res.body.detail).toMatch(/reinténtalo más tarde/);
    expect(res.body.detail).not.toMatch(/límite diario|Vuelve mañana/i);

    // An ENTRY keeps its existing wording.
    const entry = await request(app).post('/api/flare-demo/e1/prepare').send({ xrplAddress: XRPL, amountXrp: 1 });
    expect(entry.status).toBe(429);
    expect(entry.body.error).toBe('DEMO_DAILY_OPS_EXHAUSTED');
  });
});

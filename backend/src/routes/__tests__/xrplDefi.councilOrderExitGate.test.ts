/**
 * THE EXIT IS NEVER GATED — per ACTION on `POST /api/xrpl-defi/council-order/prepare`.
 *
 * `recall` and `evacuate` only bring capital back into the vault's buffer: flag-only
 * (`gateXrplDefiExit`), never the geofence — the same classification `/cage-order`
 * and `/pote-council-order` already apply. Every other action keeps the full gate,
 * and an unknown action falls to the STRICT gate before validation.
 * `requireLegacyAccess` stays in front (LEGACY_ENABLED=true opens it without a DB).
 *
 * Hermetic: the cage resolver answers «no cage» (409) right after the gate — reaching
 * it instead of 451 is the proof. No ledger, no Flare.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import request from 'supertest';

jest.mock('../../services/flare/LegacyCageResolver', () => ({
  requireCageForCouncil: jest.fn(async () => {
    throw new Error('NO_CAGE');
  }),
  noCageResponse: () => ({ status: 409, body: { error: 'NO_CAGE' } }),
}));

import xrplDefiRouter from '../xrplDefi';
import { jurisdictionService } from '../../services/JurisdictionService';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const URL = '/api/xrpl-defi/council-order/prepare';
const BLOCKED = 'US';

const ENV = { ...process.env };
let geoSpy: jest.SpyInstance;

beforeEach(() => {
  process.env = { ...ENV };
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  geoSpy = jest.spyOn(jurisdictionService, 'isDefiExecutionAllowed');
});
afterEach(() => geoSpy.mockRestore());
afterAll(() => {
  process.env = ENV;
});

describe('council-order/prepare — recall / evacuate are exits', () => {
  it.each([
    ['recall', { venueId: 0, amount: '1000' }],
    ['evacuate', { venueId: 0 }],
  ])('%s in a blocked region gets past the gate (409 NO_CAGE, not 451) without asking the geofence', async (action, params) => {
    const res = await request(app).post(URL).send({ account: COUNCIL, action, params, region: BLOCKED });
    expect({ action, status: res.status, error: res.body.error }).toEqual({ action, status: 409, error: 'NO_CAGE' });
    expect(geoSpy).not.toHaveBeenCalled();
  });

  it('recall with NO region under an allowlist (what a client may send) also gets past', async () => {
    delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,AD';
    const res = await request(app).post(URL).send({ account: COUNCIL, action: 'recall', params: { venueId: 0, amount: '1' } });
    expect(res.status).not.toBe(451);
    expect(res.body.error).toBe('NO_CAGE');
  });

  it.each(['direct-to', 'move', 'cede'])('%s in a blocked region still answers 451', async (action) => {
    const res = await request(app).post(URL).send({ account: COUNCIL, action, params: {}, region: BLOCKED });
    expect(res.status).toBe(451);
    expect(res.body.error).toMatch(/^GEOFENCE_BLOCKED/);
  });

  it('an unknown action falls to the STRICT gate (451 before the 400): never opened by a typo', async () => {
    const res = await request(app).post(URL).send({ account: COUNCIL, action: 'recal', params: {}, region: BLOCKED });
    expect(res.status).toBe(451);
  });

  it('the flag still applies: XRPL_DEFI_ENABLED off answers 503 on a recall', async () => {
    delete process.env.XRPL_DEFI_ENABLED;
    const res = await request(app).post(URL).send({ account: COUNCIL, action: 'recall', params: {}, region: BLOCKED });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('XRPL_DEFI_DISABLED');
  });
});

describe('by source — the council-order door picks its gate per action', () => {
  const SOURCE = readFileSync(join(__dirname, '..', 'xrplDefi.ts'), 'utf8');

  it('the exit set is EXACTLY recall and evacuate (widening it is an explicit decision)', () => {
    // ONE set for every council-order door, in services/councilExitToken.ts.
    expect(SOURCE).toMatch(/const COUNCIL_ORDER_EXIT_ACTIONS[^=]*=\s*SHARED_COUNCIL_ORDER_EXIT_ACTIONS/);
    const TOKEN_SOURCE = readFileSync(join(__dirname, '..', '..', 'services', 'councilExitToken.ts'), 'utf8');
    const m = TOKEN_SOURCE.match(/export const COUNCIL_ORDER_EXIT_ACTIONS[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
    expect(m).not.toBeNull();
    const listed = (m as RegExpMatchArray)[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    expect(listed).toEqual(['evacuate', 'recall']);
  });

  it('the route keeps requireLegacyAccess and chooses gateXrplDefiExit() only for the exit set', () => {
    const start = SOURCE.indexOf("router.post('/council-order/prepare'");
    expect(start).toBeGreaterThan(-1);
    const block = SOURCE.slice(start, SOURCE.indexOf('\nrouter.', start + 10));
    expect(block).toContain('requireLegacyAccess');
    expect(block).toMatch(/COUNCIL_ORDER_EXIT_ACTIONS\.has\(requestedAction\) \? gateXrplDefiExit\(\) : gateXrplDefi\(regionOf\(req\)\)/);
  });
});

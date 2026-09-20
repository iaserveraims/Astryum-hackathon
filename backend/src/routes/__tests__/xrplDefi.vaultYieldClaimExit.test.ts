/**
 * THE EXIT IS NEVER GATED — /api/xrpl-defi/vault-yield/claim/prepare.
 *
 * A payee claiming yield already owed to them is an exit: flag-only, NO geofence.
 * `requireLegacyAccess` stays in front of it (an access gate pending a founder
 * decision — not an exit policy, not removed here); LEGACY_ENABLED=true opens it
 * for this suite without a DB read.
 *
 * Hermetic: an invalid `council` answers 400 INVALID_BODY right AFTER the gate, so
 * a blocked region reaching that 400 (instead of 451) is the proof — no chain, no DB.
 */
import express from 'express';
import request from 'supertest';
import xrplDefiRouter from '../xrplDefi';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ENV };
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
  delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  _resetFeeLedgerForTests();
});

afterAll(() => {
  process.env = ENV;
});

describe('vault-yield/claim — an exit, never geofenced', () => {
  it('a blocked region gets past the gate (400 on the body, not 451)', async () => {
    const res = await request(app)
      .post('/api/xrpl-defi/vault-yield/claim/prepare')
      .send({ council: 'not-an-address', region: 'US' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
  });

  it('the flag still applies: XRPL_DEFI_ENABLED off answers 503', async () => {
    delete process.env.XRPL_DEFI_ENABLED;
    const res = await request(app)
      .post('/api/xrpl-defi/vault-yield/claim/prepare')
      .send({ council: 'not-an-address', region: 'US' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('XRPL_DEFI_DISABLED');
  });

  it('control: an ENTRY on the same router in a blocked region still answers 451', async () => {
    const res = await request(app).post('/api/xrpl-defi/escrow-create/prepare').send({ region: 'US' });
    expect(res.status).toBe(451);
  });
});

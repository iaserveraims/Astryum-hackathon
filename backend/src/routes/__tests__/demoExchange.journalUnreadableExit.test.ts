/**
 * «NO PUDE LEER» NUESTRO JOURNAL NO NIEGA UNA
 * SALIDA QUE CABE.
 */
import express from 'express';
import request from 'supertest';
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';
import type { OmnibusTx } from '../../services/demoExchange/OmnibusWatcher';

let ledgerIndex: number | null = 1000;
let journalDown = false;
/** The single-entry read (`REQUEST_PENDING`, the DELETE) fails too. */
let readSubmissionDown = false;

jest.mock('../../services/demoExchange/submissionJournal', () => {
  const actual = jest.requireActual('../../services/demoExchange/submissionJournal');
  return {
    ...actual,
    // The same failure `readSubmission` raises with a database (kvGetStrict throws).
    againstFor: jest.fn(async (...a: unknown[]) => {
      if (journalDown) throw new Error('pooler down (P1001)');
      return actual.againstFor(...a);
    }),
    readSubmission: jest.fn(async (...a: unknown[]) => {
      if (readSubmissionDown) throw new Error('pooler down (P1001)');
      return actual.readSubmission(...a);
    }),
  };
});
jest.mock('../../services/demoExchange/OmnibusWatcher', () => {
  const actual = jest.requireActual('../../services/demoExchange/OmnibusWatcher');
  return {
    ...actual,
    currentValidatedLedgerIndex: jest.fn(async () => ledgerIndex),
    scanOmnibus: jest.fn(async () => [] as OmnibusTx[]),
    scanOmnibusWindow: jest.fn(async () => [] as OmnibusTx[]),
    scanOmnibusWindowUntil: jest.fn(async () => ({ rows: [] as OmnibusTx[] })),
  };
});
jest.mock('../../services/demoExchange/deskPaymentReads', () => ({
  findHandoffByMemo: jest.fn(async () => null),
  readXrplTx: jest.fn(async () => ({ found: false })),
  readCoreVaultAddress: jest.fn(async () => 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'),
  mintExecutedOnFlare: jest.fn(async () => true),
}));
jest.mock('../../services/demoExchange/DemoRunVerifier', () => ({
  explorerUrl: () => undefined,
  flareProvider: () => ({}),
  readClientFacts: jest.fn(async () => []),
  verifyRun: jest.fn(async (run: DemoRun) => run),
}));
jest.mock('../../services/demoExchange/resolveRunPote', () => ({ resolveRunPote: async () => null }));
jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: `s-${user}`, walletAddress: req.header('x-test-wallet') ?? '' };
    next();
  },
}));

import router from '../demoExchange';
import { _resetKeyFailuresForTests } from '../adminPanel';
import { __resetDemoExchangeMemoryForTests, loadRun, saveRun } from '../../services/demoExchange/DemoExchangeStore';
import { _resetSubmissionJournal, writeSubmission } from '../../services/demoExchange/submissionJournal';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
const T0 = new Date(0).toISOString();

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);
const admin = { 'x-admin-key': 'founder-test-key' };
const as = (user: string) => ({ 'x-test-user': user, Authorization: 'Bearer test' });

/** 50 XRP at the exchange; one put-to-work of 2 XRP pending that nobody signed. */
function seedRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Journal down',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [{ id: 'c1', runId: 'run1', label: 'Alice', tag: 101, kyc: 'none', ownerUserId: 'alice', passkeyAccount: PASSKEY, xrplAddress: WALLET, xrplAddressProof: 'session', xrpOnExchangeDrops: '50000000', createdAt: T0 }],
    receipts: [],
    requests: [{ id: 'rqEntry', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'pending', reason: 'NO_CLIENT_ACCOUNT: the client has no Flare account yet (Face ID)', createdAt: T0, updatedAt: T0 }],
    appliedTxHashes: [],
  };
}

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, key: process.env.ADMIN_PANEL_KEY, emails: process.env.ADMIN_EMAILS };
beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_EMAILS;
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.ADMIN_PANEL_KEY = 'founder-test-key';
});
afterAll(() => {
  for (const [k, v] of [['INSTITUTIONAL_POTES_ENABLED', SAVED.flag], ['DATABASE_URL', SAVED.db], ['ADMIN_PANEL_KEY', SAVED.key], ['ADMIN_EMAILS', SAVED.emails]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  __resetDemoExchangeMemoryForTests();
  _resetSubmissionJournal();
  ledgerIndex = 1000;
  journalDown = true;
  readSubmissionDown = false;
  await saveRun(seedRun());
});
afterEach(() => _resetKeyFailuresForTests());

const ask = (kind: string, amountXrp: string) => request(app).post('/api/demo-exchange/runs/run1/clients/c1/requests').set(as('alice')).send({ kind, amountXrp });
const prepare = (amountXrp: string) => request(app).post('/api/demo-exchange/runs/run1/withdraw/prepare').set(admin).send({ clientId: 'c1', amountXrp });

describe('La salida con el journal ilegible', () => {
  it('LA PERSONA REAL: 50 en la casilla, entrada pendiente de 2, retirada de 10 → 201 (la entrada retiene sus 2; caben 48)', async () => {
    const res = await ask('withdraw', '10');
    expect(res.status).toBe(201);
    expect(res.body.error).toBeUndefined();
    expect(res.body.request).toMatchObject({ kind: 'withdraw', drops: '10000000', status: 'pending' });
    const live = (await loadRun('run1'))!;
    expect(live.requests!.map((r) => r.kind)).toEqual(['put-to-work', 'withdraw']);
    // a second exit of the same kind is refused as always (REQUEST_PENDING), not by the journal
    const again = await ask('withdraw', '1');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('REQUEST_PENDING');
  });

  it('la que NO cabe contando la entrada → 409 INSUFFICIENT_AVAILABLE_BALANCE reintentable que dice por qué se contó así (jamás SUBMISSION_JOURNAL_UNREADABLE a secas)', async () => {
    const res = await ask('withdraw', '49');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    expect(res.body.reservedDrops).toBe('2000000');
    expect(res.body.availableDrops).toBe('48000000');
    expect(res.body.journalUnreadable).toBe(true);
    expect(res.body.retryable).toBe(true);
    expect(res.body.detail).toMatch(/could not be read just now/);
    expect(res.body.detail).toMatch(/counted as reserved/);
    expect(res.body.detail).toMatch(/pooler down/);
    // …and 48 still fits right after, with the journal still down
    expect((await ask('withdraw', '48')).status).toBe(201);
  });

  it('Con el journal legible la misma entrada queda EXIMIDA (la asimetría de la /29 no cambia): 50 caben', async () => {
    journalDown = false;
    const res = await ask('withdraw', '50');
    expect(res.status).toBe(201);
    expect(res.body.journalUnreadable).toBeUndefined();
  });

  it('el pago a mano con la entrada delante → 409 PAYMENT_IN_FLIGHT que la nombra y dice que el journal no se leyó; sin entradas delante, 200 sin leerlo', async () => {
    const res = await prepare('10');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.inFlight.map((p: { id: string }) => p.id)).toEqual(['rqEntry']);
    expect(res.body.journalUnreadable).toBe(true);
    expect(res.body.retryable).toBe(true);
    expect(res.body.detail).toMatch(/counted as reserved/);
    expect((await loadRun('run1'))!.deskPayments ?? []).toHaveLength(0);

    // the entry gone (its owner withdraws it — the DELETE reads the journal itself, so bring it back)
    journalDown = false;
    expect((await request(app).delete('/api/demo-exchange/runs/run1/clients/c1/requests/rqEntry').set(as('alice'))).status).toBe(200);
    journalDown = true;
    const paid = await prepare('10');
    expect(paid.status).toBe(200);
    expect(paid.body.xrplTx).toMatchObject({ Destination: WALLET, Amount: '10000000' });
  });

  it('una ENTRADA con el journal ilegible no cambia: ni lo lee (no hay exención posible) ni se niega por él', async () => {
    const res = await ask('put-to-work', '1');
    expect(res.status).toBe(409);
    // the pending entry of the same kind is what refuses it, as always
    expect(res.body.error).toBe('REQUEST_PENDING');
  });
});

/**
 * `REQUEST_PENDING` NOMBRA LA PUERTA SOLO SI EL JOURNAL
 * DICE QUE VA A CEDER. Antes: `withdrawableRequestIds` con `pending && !txHash`,
 * sin journal — un botón para una petición que el journal declara `submitting`,
 * y 409 al pulsarlo. La misma regla que `againstFor`/`journalPlan`.
 */
describe('REQUEST_PENDING consulta el journal antes de nombrar la puerta', () => {
  const FE_HASH = 'D'.repeat(64);
  const entry = (status: 'submitting' | 'failed' | 'expired') =>
    writeSubmission({ requestId: 'rqEntry', runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '2000000', txHash: FE_HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status, code: status === 'failed' ? 'tecPATH_DRY' : undefined, updatedAt: T0 });

  it('sin entry (nadie firmó) → la puerta se nombra, y cede', async () => {
    journalDown = false;
    const res = await ask('put-to-work', '1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REQUEST_PENDING');
    expect(res.body.withdrawableRequestIds).toEqual(['rqEntry']);
    expect((await request(app).delete('/api/demo-exchange/runs/run1/clients/c1/requests/rqEntry').set(as('alice'))).status).toBe(200);
  });

  it('CONSUMIDOR: el journal dice `submitting` (firmada, clobbeada a pending) → NINGUNA puerta, «carries a signed payment» — y el DELETE que antes se ofrecía contesta 409', async () => {
    journalDown = false;
    await entry('submitting');
    const res = await ask('put-to-work', '1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REQUEST_PENDING');
    expect(res.body.withdrawableRequestIds).toBeUndefined();
    expect(res.body.detail).toMatch(/carries a signed payment/);
    expect(res.body.detail).not.toMatch(/DELETE/);
    expect((await request(app).delete('/api/demo-exchange/runs/run1/clients/c1/requests/rqEntry').set(as('alice'))).status).toBe(409);
  });

  it('un entry `failed` (validado ≠ tes) sí se nombra: su puerta reconcilia y cede', async () => {
    journalDown = false;
    await entry('failed');
    const res = await ask('put-to-work', '1');
    expect(res.body.withdrawableRequestIds).toEqual(['rqEntry']);
    const door = await request(app).delete('/api/demo-exchange/runs/run1/clients/c1/requests/rqEntry').set(as('alice'));
    expect(door.status).toBe(200);
    expect(door.body.reconciled).toBe('failed-on-ledger');
  });

  it('el journal ilegible → no se nombra puerta alguna, y se dice (retryable, journalUnreadable) — «no pude leer» no promete', async () => {
    readSubmissionDown = true;
    const res = await ask('put-to-work', '1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REQUEST_PENDING');
    expect(res.body.withdrawableRequestIds).toBeUndefined();
    expect(res.body.journalUnreadable).toBe(true);
    expect(res.body.retryable).toBe(true);
    expect(res.body.detail).toMatch(/could not be read just now/);
    expect(res.body.detail).not.toMatch(/carries a signed payment/);
  });
});

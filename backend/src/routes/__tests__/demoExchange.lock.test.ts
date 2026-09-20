/**
 * A slow public /verify cannot erase what happened to the run while it was
 * verifying. It used to load the run, verify
 * for seconds and save the WHOLE run back: a request created and minted in
 * between vanished, its balance came back, and a new request minted again.
 * Now verification runs on a snapshot and only its results are applied, by
 * receipt id, to a fresh copy inside the run lock.
 */
import express from 'express';
import request from 'supertest';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';

let releaseVerify: () => void = () => undefined;
let verifyStarted: () => void = () => undefined;

jest.mock('../../services/demoExchange/DemoRunVerifier', () => ({
  explorerUrl: () => undefined,
  flareProvider: () => ({}),
  readClientFacts: jest.fn(async () => []),
  verifyRun: jest.fn(async (run: DemoRun) => {
    verifyStarted();
    await new Promise<void>((resolve) => {
      releaseVerify = resolve;
    });
    for (const r of run.receipts) {
      r.checks = [{ label: 'on the ledger', ok: true }];
      r.verifiedAt = new Date().toISOString();
    }
    return run;
  }),
}));

const mockScan = jest.fn(async (): Promise<unknown[]> => []);
jest.mock('../../services/demoExchange/OmnibusWatcher', () => {
  const actual = jest.requireActual('../../services/demoExchange/OmnibusWatcher');
  return { ...actual, scanOmnibus: (...a: unknown[]) => mockScan(...(a as [])), currentValidatedLedgerIndex: jest.fn(async () => 1000) };
});

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: 's', walletAddress: '' };
    next();
  },
}));

import router, { __resetOmnibusReadsForTests } from '../demoExchange';
import { __resetDemoExchangeMemoryForTests, loadRun, saveRun, withRunLock } from '../../services/demoExchange/DemoExchangeStore';

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);

const HASH = 'E'.repeat(64);
const T0 = new Date(0).toISOString();

function seedRun(): DemoRun {
  return {
    runId: 'run1',
    // Un exchange es de quien lo creó, y sus lecturas de mesa también.
    createdByUserId: 'owner1',
    seq: 1,
    label: 'Lock test',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7',
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [{ id: 'c1', runId: 'run1', label: 'Alice', tag: 101, kyc: 'none', ownerUserId: 'alice', xrplAddress: 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf', xrplAddressProof: 'session', xrpOnExchangeDrops: '5000000', createdAt: T0 }],
    receipts: [{ id: 'rc_seed', runId: 'run1', step: 'E1_ANCHOR', chain: 'xrpl', txHash: 'F'.repeat(64), at: T0, checks: [] }],
    requests: [],
    appliedTxHashes: [],
  };
}

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL };
beforeAll(() => {
  delete process.env.DATABASE_URL; // the real store, in memory
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
});
afterAll(() => {
  if (SAVED.flag === undefined) delete process.env.INSTITUTIONAL_POTES_ENABLED;
  else process.env.INSTITUTIONAL_POTES_ENABLED = SAVED.flag;
  if (SAVED.db !== undefined) process.env.DATABASE_URL = SAVED.db;
});
beforeEach(async () => {
  __resetDemoExchangeMemoryForTests();
  __resetOmnibusReadsForTests();
  mockScan.mockReset();
  mockScan.mockImplementation(async () => []);
  await saveRun(seedRun());
});

describe('GET /omnibus is the owner’s and never holds the run lock across the chain read (2.6b)', () => {
  it('a slow scan by the owner does not stall a writer of the run; concurrent readers share ONE scan; a repeat within the interval is served cached', async () => {
    let releaseScan: () => void = () => undefined;
    let scanStarted: () => void = () => undefined;
    const started = new Promise<void>((r) => { scanStarted = r; });
    mockScan.mockImplementation(() => new Promise<unknown[]>((resolve) => {
      scanStarted();
      releaseScan = () => resolve([]);
    }));
    const first = request(app).get('/api/demo-exchange/runs/run1/omnibus').set('x-test-user', 'owner1').then((r) => r);
    await started;
    const second = request(app).get('/api/demo-exchange/runs/run1/omnibus').set('x-test-user', 'owner1').then((r) => r);

    // While the owner’s read waits on the chain, a writer of the run gets the lock and finishes.
    const asked = await request(app).post('/api/demo-exchange/runs/run1/clients/c1/requests').set('x-test-user', 'alice').send({ kind: 'withdraw', amountXrp: '1' });
    expect(asked.status).toBe(201);
    let writerRan = false;
    await withRunLock('run1', async () => { writerRan = true; });
    expect(writerRan).toBe(true);

    releaseScan();
    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(mockScan).toHaveBeenCalledTimes(1);
    // applied to the FRESH run: the request created during the scan is there, nothing erased
    expect(a.body.requests).toHaveLength(1);
    expect((await loadRun('run1'))!.requests).toHaveLength(1);

    const third = await request(app).get('/api/demo-exchange/runs/run1/omnibus').set('x-test-user', 'owner1');
    expect(third.status).toBe(200);
    expect(third.body.cached).toBe(true);
    expect(mockScan).toHaveBeenCalledTimes(1);
  });

  it('an unknown run → 404; a failed scan → 502 without touching the run', async () => {
    expect((await request(app).get('/api/demo-exchange/runs/nope/omnibus').set('x-test-user', 'owner1')).status).toBe(404);
    // Sin sesión no hay lectura; y el exchange de otro contesta lo mismo que uno inventado.
    expect((await request(app).get('/api/demo-exchange/runs/run1/omnibus')).status).toBe(401);
    expect((await request(app).get('/api/demo-exchange/runs/run1/omnibus').set('x-test-user', 'stranger')).status).toBe(404);
    // Un cliente del exchange tampoco lee la conciliación: lleva los ingresos de todos.
    expect((await request(app).get('/api/demo-exchange/runs/run1/omnibus').set('x-test-user', 'alice')).status).toBe(404);
    mockScan.mockImplementationOnce(async () => { throw new Error('rippled frozen'); });
    const res = await request(app).get('/api/demo-exchange/runs/run1/omnibus').set('x-test-user', 'owner1');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('OMNIBUS_READ_FAILED');
    expect((await loadRun('run1'))!.version).toBe(1);
  });
});

describe('withRunLock', () => {
  it('serializes writers of the same run and never interleaves them', async () => {
    const order: string[] = [];
    const slow = withRunLock('runX', async () => {
      order.push('a:start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('a:end');
    });
    const fast = withRunLock('runX', async () => {
      order.push('b:start');
      order.push('b:end');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('a throwing writer releases the lock', async () => {
    await expect(withRunLock('runY', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(withRunLock('runY', async () => 'next')).resolves.toBe('next');
  });

  it('different runs do not wait for each other', async () => {
    let otherRan = false;
    let unblock: () => void = () => undefined;
    const held = withRunLock('runA', () => new Promise<void>((r) => { unblock = r; }));
    await withRunLock('runB', async () => { otherRan = true; });
    expect(otherRan).toBe(true);
    unblock();
    await held;
  });
});

describe('POST /verify vs a request created and minted meanwhile', () => {
  it('the slow verification applies its checks and erases nothing', async () => {
    const started = new Promise<void>((r) => { verifyStarted = r; });
    const verifying = request(app).post('/api/demo-exchange/runs/run1/verify').set('x-test-user', 'owner1').send({}).then((r) => r);
    await started; // /verify holds its snapshot and is reading the chain

    // Meanwhile: the client asks for a withdraw…
    const asked = await request(app).post('/api/demo-exchange/runs/run1/clients/c1/requests').set('x-test-user', 'alice').send({ kind: 'withdraw', amountXrp: '1' });
    expect(asked.status).toBe(201);
    // …and the autopilot signs it and debits the ledger (inside its lock).
    await withRunLock('run1', async () => {
      const run = (await loadRun('run1'))!;
      const req = run.requests![0];
      req.status = 'submitting';
      req.txHash = HASH;
      run.clients[0].xrpOnExchangeDrops = '4000000';
      await saveRun(run);
    });

    releaseVerify();
    const res = await verifying;
    expect(res.status).toBe(200);

    const after = (await loadRun('run1'))!;
    expect(after.requests).toHaveLength(1);
    expect(after.requests![0]).toMatchObject({ status: 'submitting', txHash: HASH });
    expect(after.clients[0].xrpOnExchangeDrops).toBe('4000000');
    // the verification result landed on the receipt it verified…
    expect(after.receipts.find((r) => r.id === 'rc_seed')?.checks).toEqual([{ label: 'on the ledger', ok: true }]);
    // …and the NOTE the request added meanwhile survived, unverified
    const note = after.receipts.find((r) => r.step === 'NOTE');
    expect(note).toBeDefined();
    expect(note?.checks).toEqual([]);
    // what /verify answers is the fresh run, not its snapshot
    expect(res.body.run.requests).toHaveLength(1);
  });
});

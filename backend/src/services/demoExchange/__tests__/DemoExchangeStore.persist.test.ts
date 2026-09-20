/**
 * A run save is PROVEN, a run load never guesses (productizer it. 10):
 *  - saveRun writes, reads back STRICTLY and compares version + stamp — a
 *    swallowed database error throws RUN_NOT_PERSISTED and leaves nothing behind;
 *  - compare-and-set: a stale copy (another writer saved meanwhile) is refused;
 *  - loadRun with a database reads strictly (RUN_UNREADABLE) and never falls back
 *    to the in-process copy; without a database the in-process copy is the store.
 */
const mockKv = new Map<string, Record<string, unknown>>();
const mockState = { upsertSwallows: false, strictThrows: false, casThrows: false, upsertOverwrittenBy: null as Record<string, unknown> | null };

jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async (t: string, _k: string, key: string) => mockKv.get(`${t}:${key}`) ?? null),
  kvGetStrict: jest.fn(async (t: string, _k: string, key: string) => {
    // A real database answers asynchronously: a read-compare-write interleaves here.
    await new Promise((r) => setImmediate(r));
    if (mockState.strictThrows) throw new Error('pooler down');
    return mockKv.get(`${t}:${key}`) ?? null;
  }),
  kvUpsert: jest.fn(async (t: string, _k: string, key: string, payload: Record<string, unknown>) => {
    await new Promise((r) => setImmediate(r));
    if (mockState.upsertSwallows) return; // what kvUpsert does on a DB error: log and return
    mockKv.set(`${t}:${key}`, JSON.parse(JSON.stringify(mockState.upsertOverwrittenBy ?? payload)));
  }),
  // What the conditional UPDATE under the key lock guarantees: compare and write are ONE step.
  kvCompareAndSet: jest.fn(async (t: string, _k: string, key: string, payload: Record<string, unknown>, cas: { versionField: string; expectedVersion: number; createIfAbsent?: boolean }) => {
    await new Promise((r) => setImmediate(r));
    if (mockState.casThrows || mockState.strictThrows) throw new Error('pooler down');
    const current = mockKv.get(`${t}:${key}`);
    if (!current) {
      if (cas.expectedVersion !== 0 && !cas.createIfAbsent) return 'conflict';
    } else if (Number(current[cas.versionField] ?? 0) !== cas.expectedVersion) {
      return 'conflict';
    }
    mockKv.set(`${t}:${key}`, JSON.parse(JSON.stringify(mockState.upsertOverwrittenBy ?? payload)));
    return 'written';
  }),
  kvList: jest.fn(async () => []),
  kvDelete: jest.fn(async (t: string, _k: string, key: string) => void mockKv.delete(`${t}:${key}`)),
}));

import { __resetDemoExchangeMemoryForTests, DEMO_RUN_JOB_TYPE, DemoRunStoreError, loadRun, saveRun, type DemoRun } from '../DemoExchangeStore';

const T0 = new Date(0).toISOString();
function seed(): DemoRun {
  return {
    runId: 'runP',
    seq: 1,
    label: 'persist',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7',
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [{ id: 'c1', runId: 'runP', label: 'Ana', tag: 101, kyc: 'none', xrpOnExchangeDrops: '2000000', createdAt: T0 }],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
  };
}
const reservation = { id: 'dp1', kind: 'put-to-work' as const, clientId: 'c1', drops: '2000000', status: 'prepared' as const, createdAtLedger: 1000, createdAt: T0, updatedAt: T0 };

async function expectStoreError(p: Promise<unknown>, code: string) {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(DemoRunStoreError);
  expect((e as DemoRunStoreError).code).toBe(code);
}

const SAVED_DB = process.env.DATABASE_URL;
afterAll(() => {
  if (SAVED_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = SAVED_DB;
});
beforeEach(() => {
  mockKv.clear();
  mockState.upsertSwallows = false;
  mockState.strictThrows = false;
  mockState.upsertOverwrittenBy = null;
  __resetDemoExchangeMemoryForTests();
});

describe('with a database', () => {
  beforeAll(() => {
    process.env.DATABASE_URL = 'postgres://persist-test';
  });

  it('save → read back with version 1; the same object saves again (version 2); load returns it', async () => {
    const run = seed();
    await saveRun(run);
    expect(run.version).toBe(1);
    expect(mockKv.get(`${DEMO_RUN_JOB_TYPE}:runP`)).toMatchObject({ version: 1, savedStamp: run.savedStamp });
    run.label = 'renamed';
    await saveRun(run);
    expect(run.version).toBe(2);
    expect(await loadRun('runP')).toMatchObject({ label: 'renamed', version: 2 });
  });

  it('THE bug: a swallowed database error used to be silently reverted on the next load — now the save THROWS and nothing pretends it happened', async () => {
    await saveRun(seed());
    const run = (await loadRun('runP'))!;
    run.deskPayments = [reservation];
    mockState.casThrows = true;
    await expectStoreError(saveRun(run), 'RUN_NOT_PERSISTED');
    mockState.casThrows = false;
    const after = (await loadRun('runP'))!;
    expect(after.deskPayments ?? []).toHaveLength(0); // the caller was told: 503, nothing recorded
    expect(after.version).toBe(1);
  });

  it('a read-back that is not this save (another stamp) → RUN_NOT_PERSISTED', async () => {
    await saveRun(seed());
    const run = (await loadRun('runP'))!;
    mockState.upsertOverwrittenBy = { ...seed(), runId: 'runP', version: 2, savedStamp: 'someone-else' };
    await expectStoreError(saveRun(run), 'RUN_NOT_PERSISTED');
  });

  it('compare-and-set: a stale copy saved after another writer → RUN_VERSION_CONFLICT; the other writer\'s change stands', async () => {
    await saveRun(seed());
    const a = (await loadRun('runP'))!;
    const b = (await loadRun('runP'))!;
    a.clients[0].xrpOnExchangeDrops = '0';
    await saveRun(a);
    b.label = 'stale';
    await expectStoreError(saveRun(b), 'RUN_VERSION_CONFLICT');
    expect(await loadRun('runP')).toMatchObject({ label: 'persist', version: 2 });
    expect((await loadRun('runP'))!.clients[0].xrpOnExchangeDrops).toBe('0');
  });

  it('it. 12 (2.4): two writers of the same version saving CONCURRENTLY (two instances, no shared lock) → exactly one lands, the other is a DemoRunStoreError', async () => {
    await saveRun(seed());
    const a = (await loadRun('runP'))!;
    const b = (await loadRun('runP'))!;
    a.deskPayments = [reservation];
    b.label = 'the other instance';
    const results = await Promise.allSettled([saveRun(a), saveRun(b)]);
    const landed = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBeInstanceOf(DemoRunStoreError);
    expect((refused[0].reason as DemoRunStoreError).code).toBe('RUN_VERSION_CONFLICT');
    const stored = (await loadRun('runP'))!;
    expect(stored.version).toBe(2);
    // whichever landed is whole: never a mix, never a lost reservation silently «saved»
    if (results[0].status === 'fulfilled') expect(stored.deskPayments).toHaveLength(1);
    else expect(stored.label).toBe('the other instance');
  });

  it('the compare is the database\'s, in the same step as the write: saveRun never pre-reads to decide', async () => {
    const { kvGetStrict, kvCompareAndSet } = jest.requireMock('../../persistence/backgroundJobKv') as { kvGetStrict: jest.Mock; kvCompareAndSet: jest.Mock };
    kvGetStrict.mockClear();
    kvCompareAndSet.mockClear();
    const run = seed();
    await saveRun(run);
    expect(kvCompareAndSet).toHaveBeenCalledWith(DEMO_RUN_JOB_TYPE, 'runId', 'runP', expect.objectContaining({ version: 1 }), { versionField: 'version', expectedVersion: 0, createIfAbsent: true });
    // one strict read: the read-back after the write
    expect(kvGetStrict).toHaveBeenCalledTimes(1);
    expect(kvCompareAndSet.mock.invocationCallOrder[0]).toBeLessThan(kvGetStrict.mock.invocationCallOrder[0]);
  });

  it('load: a database error → RUN_UNREADABLE; an absent row → null, never the in-process copy', async () => {
    await saveRun(seed());
    mockState.strictThrows = true;
    await expectStoreError(loadRun('runP'), 'RUN_UNREADABLE');
    await expectStoreError(saveRun(seed()), 'RUN_NOT_PERSISTED');
    mockState.strictThrows = false;
    mockKv.delete(`${DEMO_RUN_JOB_TYPE}:runP`);
    expect(await loadRun('runP')).toBeNull();
  });

  it('a legacy row without version is version 0: its loaded copy saves', async () => {
    mockKv.set(`${DEMO_RUN_JOB_TYPE}:runP`, { ...seed() } as unknown as Record<string, unknown>);
    const run = (await loadRun('runP'))!;
    await saveRun(run);
    expect(run.version).toBe(1);
  });
});

describe('without a database (in-process store)', () => {
  beforeAll(() => {
    delete process.env.DATABASE_URL;
  });

  it('loads are copies; a stale copy is refused the same way', async () => {
    await saveRun(seed());
    const a = (await loadRun('runP'))!;
    const b = (await loadRun('runP'))!;
    a.label = 'first';
    expect((await loadRun('runP'))!.label).toBe('persist');
    await saveRun(a);
    await expectStoreError(saveRun(b), 'RUN_VERSION_CONFLICT');
    expect((await loadRun('runP'))!.label).toBe('first');
  });
});

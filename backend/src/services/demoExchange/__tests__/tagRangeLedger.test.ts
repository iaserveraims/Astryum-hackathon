/**
 * The marks that keep a deleted run's tags its own are PROVEN persisted
 * (productizer cycle, it. 8):
 *  - every tag range ever assigned lives apart from the runs, read STRICTLY and
 *    written with read-back — `kvUpsert` swallows a database error;
 *  - the seq high-water is read back too, and a failed write never makes the
 *    retry skip the write;
 *  - findTagRangeClash refuses overlap with live runs, past ranges, and the
 *    classic tags of seqs no record explains.
 */
const mockKv = new Map<string, Record<string, unknown>>();
const mockState = { upsertSwallows: false, strictThrows: false };

jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async (t: string, _k: string, key: string) => mockKv.get(`${t}:${key}`) ?? null),
  kvGetStrict: jest.fn(async (t: string, _k: string, key: string) => {
    if (mockState.strictThrows) throw new Error('pooler down');
    return mockKv.get(`${t}:${key}`) ?? null;
  }),
  kvUpsert: jest.fn(async (t: string, _k: string, key: string, payload: Record<string, unknown>) => {
    if (mockState.upsertSwallows) return; // what kvUpsert does on a DB error: log and return
    mockKv.set(`${t}:${key}`, JSON.parse(JSON.stringify(payload)));
  }),
  kvList: jest.fn(async () => []),
  kvDelete: jest.fn(async () => undefined),
}));

import {
  __resetDemoExchangeMemoryForTests,
  bumpSeqHighWater,
  DEMO_SEQ_JOB_TYPE,
  findTagRangeClash,
  readAssignedTagRanges,
  readSeqHighWater,
  recordAssignedTagRange,
  type AssignedTagRange,
} from '../DemoExchangeStore';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const OTHER = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const range = (runId: string, base: number, count: number, over: Partial<AssignedTagRange> = {}): AssignedTagRange => ({ runId, seq: 2, omnibusAddress: OMNIBUS, base, count, assignedAt: 'T0', ...over });

const SAVED_DB = process.env.DATABASE_URL;
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://tag-ranges-test';
});
afterAll(() => {
  if (SAVED_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = SAVED_DB;
});
beforeEach(() => {
  mockKv.clear();
  mockState.upsertSwallows = false;
  mockState.strictThrows = false;
  __resetDemoExchangeMemoryForTests();
});

describe('assigned tag ranges ledger', () => {
  it('records with read-back, idempotent per run, and survives the in-process copy', async () => {
    await recordAssignedTagRange(range('runA', 5000, 50));
    await recordAssignedTagRange(range('runA', 5000, 50));
    __resetDemoExchangeMemoryForTests(); // a restart
    expect(await readAssignedTagRanges()).toEqual([range('runA', 5000, 50)]);
  });

  it('a write the database swallowed THROWS TAG_RANGES_NOT_PERSISTED — and is not remembered in process', async () => {
    mockState.upsertSwallows = true;
    await expect(recordAssignedTagRange(range('runA', 5000, 50))).rejects.toThrow(/TAG_RANGES_NOT_PERSISTED/);
    mockState.upsertSwallows = false;
    expect(await readAssignedTagRanges()).toEqual([]);
  });

  it('an unreadable database THROWS — «could not read» is never «no range assigned»', async () => {
    mockState.strictThrows = true;
    await expect(readAssignedTagRanges()).rejects.toThrow('pooler down');
    await expect(recordAssignedTagRange(range('runA', 5000, 50))).rejects.toThrow('pooler down');
  });
});

describe('seq high-water read-back', () => {
  it('a swallowed write THROWS SEQ_HIGH_WATER_NOT_PERSISTED; the retry writes (the in-memory mark does not skip it)', async () => {
    mockState.upsertSwallows = true;
    await expect(bumpSeqHighWater(5)).rejects.toThrow(/SEQ_HIGH_WATER_NOT_PERSISTED/);
    mockState.upsertSwallows = false;
    await bumpSeqHighWater(5);
    expect(mockKv.get(`${DEMO_SEQ_JOB_TYPE}:high-water`)).toMatchObject({ seq: 5 });
    __resetDemoExchangeMemoryForTests();
    expect(await readSeqHighWater()).toBe(5);
  });

  it('never lowers the stored mark; an unreadable mark throws', async () => {
    await bumpSeqHighWater(7);
    await bumpSeqHighWater(3);
    expect(mockKv.get(`${DEMO_SEQ_JOB_TYPE}:high-water`)).toMatchObject({ seq: 7 });
    mockState.strictThrows = true;
    await expect(bumpSeqHighWater(9)).rejects.toThrow('pooler down');
  });
});

describe('findTagRangeClash (pure)', () => {
  const live = [{ runId: 'run1', seq: 1, label: 'take 1', omnibusAddress: OMNIBUS }]; // classic 101…199

  it('live run on the same omnibus; a different omnibus does not clash', () => {
    expect(findTagRangeClash({ base: 150, count: 10 }, OMNIBUS, live, [], 1)?.source).toBe('live');
    expect(findTagRangeClash({ base: 150, count: 10 }, OTHER, live, [], 1)).toBeNull();
  });

  it("a deleted run's range (the ledger) on the same omnibus", () => {
    const assigned = [range('gone', 5000, 50)];
    expect(findTagRangeClash({ base: 5049, count: 1 }, OMNIBUS, live, assigned, 2)?.source).toBe('assigned');
    expect(findTagRangeClash({ base: 5050, count: 10 }, OMNIBUS, live, assigned, 2)).toBeNull();
    expect(findTagRangeClash({ base: 5000, count: 10 }, OTHER, live, assigned, 2)).toBeNull();
  });

  it('a seq ≤ high-water no record explains holds its classic tags on EVERY omnibus', () => {
    // high-water 3: seq 1 live, seq 2 in the ledger, seq 3 unknown (deleted before ranges were recorded)
    const assigned = [range('two', 9000, 10, { seq: 2 })];
    expect(findTagRangeClash({ base: 350, count: 1 }, OTHER, live, assigned, 3)?.source).toBe('unrecorded-classic');
    expect(findTagRangeClash({ base: 250, count: 1 }, OTHER, live, assigned, 3)).toBeNull(); // seq 2 is explained
  });
});

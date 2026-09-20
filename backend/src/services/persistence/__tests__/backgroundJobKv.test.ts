/* eslint-disable @typescript-eslint/no-explicit-any */
const rows: any[] = [];
const mockLocks: string[] = [];
const mockTxState = { failWith: null as Error | null };
jest.mock('../../../database/prismaClient', () => {
  const backgroundJob = {
    findFirst: jest.fn(async ({ where }: any) => {
      const field = where.payload.path[0];
      return (
        [...rows].reverse().find(
          (r) => r.jobType === where.jobType && r.payload?.[field] === where.payload.equals,
        ) ?? null
      );
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: rows.length + 1, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data);
      return row;
    }),
    // A conditional UPDATE: only a row whose id AND (when asked) stored version still match.
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hits = rows.filter(
        (r) => r.id === where.id && r.jobType === where.jobType && (!where.payload || r.payload?.[where.payload.path[0]] === where.payload.equals),
      );
      for (const r of hits) Object.assign(r, data);
      return { count: hits.length };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const field = where.payload.path[0];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].jobType === where.jobType && rows[i].payload?.[field] === where.payload.equals) {
          rows.splice(i, 1);
        }
      }
      return { count: 0 };
    }),
  };
  return {
    prisma: {
      backgroundJob,
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
        if (mockTxState.failWith) throw mockTxState.failWith;
        const tx = {
          backgroundJob,
          $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            mockLocks.push(`${strings.join('?')}|${values.join(',')}`);
            return [{ locked: '' }];
          }),
        };
        return fn(tx);
      }),
    },
  };
});

import { kvGet, kvGetStrict, kvUpsert, kvDelete, kvCompareAndSet } from '../backgroundJobKv';

const P = () => (jest.requireMock('../../../database/prismaClient') as { prisma: { backgroundJob: Record<string, jest.Mock> } }).prisma.backgroundJob;

const ENV = process.env;
beforeEach(() => {
  rows.length = 0;
  mockLocks.length = 0;
  mockTxState.failWith = null;
  jest.clearAllMocks();
  process.env = { ...ENV, DATABASE_URL: 'postgres://test' };
});
afterAll(() => {
  process.env = ENV;
});

describe('backgroundJobKv — the shared low-level KV', () => {
  it('upsert then get round-trips the payload', async () => {
    await kvUpsert('t-job', 'k', 'a', { k: 'a', n: 1 });
    expect(await kvGet('t-job', 'k', 'a')).toMatchObject({ k: 'a', n: 1 });
  });

  it('upsert updates in place — no duplicate row (idempotent by key)', async () => {
    await kvUpsert('t-job', 'k', 'a', { k: 'a', n: 1 });
    await kvUpsert('t-job', 'k', 'a', { k: 'a', n: 2 });
    expect((await kvGet('t-job', 'k', 'a'))?.n).toBe(2);
    expect(rows.length).toBe(1);
  });

  it('isolates by jobType and by key', async () => {
    await kvUpsert('job-A', 'k', 'a', { k: 'a', n: 1 });
    await kvUpsert('job-B', 'k', 'a', { k: 'a', n: 9 });
    expect((await kvGet('job-A', 'k', 'a'))?.n).toBe(1);
    expect(await kvGet('job-A', 'k', 'b')).toBeNull();
  });

  it('delete removes the row', async () => {
    await kvUpsert('t-job', 'k', 'a', { k: 'a', n: 1 });
    await kvDelete('t-job', 'k', 'a');
    expect(await kvGet('t-job', 'k', 'a')).toBeNull();
  });

  it('no DATABASE_URL ⇒ null / no-op (best-effort fallback lives in the caller)', async () => {
    delete process.env.DATABASE_URL;
    await kvUpsert('t-job', 'k', 'a', { k: 'a', n: 1 });
    expect(await kvGet('t-job', 'k', 'a')).toBeNull();
    expect(rows.length).toBe(0);
  });

  it('Upsert, get and strict get pick THE SAME row of a key — newest createdAt, id as tie-break', async () => {
    await kvUpsert('t-job', 'k', 'a', { k: 'a', n: 1 });
    await kvGet('t-job', 'k', 'a');
    await kvGetStrict('t-job', 'k', 'a');
    const orders = P().findFirst.mock.calls.map((c) => c[0].orderBy);
    expect(orders).toHaveLength(3);
    for (const o of orders) expect(o).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });
});

describe('KvCompareAndSet — ONE conditional write under the key lock (2.4)', () => {
  const cas = (payload: Record<string, unknown>, expectedVersion: number, createIfAbsent = false) =>
    kvCompareAndSet('t-run', 'runId', 'r1', payload, { versionField: 'version', expectedVersion, createIfAbsent });

  it('absent row → created (under the advisory lock of the key); a second create of version 0 is a conflict, never a duplicate', async () => {
    expect(await cas({ runId: 'r1', version: 1 }, 0)).toBe('written');
    expect(rows).toHaveLength(1);
    expect(mockLocks[0]).toMatch(/pg_advisory_xact_lock/);
    expect(mockLocks[0]).toContain('bg-kv:t-run:runId:r1');
    expect(await cas({ runId: 'r1', version: 1 }, 0)).toBe('conflict');
    expect(rows).toHaveLength(1);
  });

  it('stored version ≠ expected → conflict, nothing written; equal → the UPDATE is conditional on id AND the stored version', async () => {
    await cas({ runId: 'r1', version: 1 }, 0);
    expect(await cas({ runId: 'r1', version: 3, tag: 'stale' }, 2)).toBe('conflict');
    expect(rows[0].payload).toEqual({ runId: 'r1', version: 1 });
    expect(await cas({ runId: 'r1', version: 2 }, 1)).toBe('written');
    expect(P().updateMany).toHaveBeenLastCalledWith({ where: { id: rows[0].id, jobType: 't-run', payload: { path: ['version'], equals: 1 } }, data: { payload: { runId: 'r1', version: 2 } } });
    expect(rows[0].payload.version).toBe(2);
  });

  it('the conditional UPDATE touching no row (the version moved under it) → conflict', async () => {
    await cas({ runId: 'r1', version: 1 }, 0);
    P().updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await cas({ runId: 'r1', version: 2 }, 1)).toBe('conflict');
  });

  it('a legacy row without the version field is version 0; absent + createIfAbsent writes whatever the expected version', async () => {
    rows.push({ id: 7, jobType: 't-run', createdAt: new Date(), payload: { runId: 'r1' } });
    expect(await cas({ runId: 'r1', version: 1 }, 0)).toBe('written');
    rows.length = 0;
    expect(await cas({ runId: 'r1', version: 5 }, 4)).toBe('conflict');
    expect(await cas({ runId: 'r1', version: 5 }, 4, true)).toBe('written');
  });

  it('a database error THROWS (never «written»); without a database it throws too', async () => {
    mockTxState.failWith = new Error('pooler down');
    await expect(cas({ runId: 'r1', version: 1 }, 0)).rejects.toThrow('pooler down');
    mockTxState.failWith = null;
    delete process.env.DATABASE_URL;
    await expect(cas({ runId: 'r1', version: 1 }, 0)).rejects.toThrow(/NO_DATABASE/);
  });
});

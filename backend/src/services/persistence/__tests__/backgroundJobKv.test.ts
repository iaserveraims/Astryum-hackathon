/* eslint-disable @typescript-eslint/no-explicit-any */
const rows: any[] = [];
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
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
      deleteMany: jest.fn(async ({ where }: any) => {
        const field = where.payload.path[0];
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].jobType === where.jobType && rows[i].payload?.[field] === where.payload.equals) {
            rows.splice(i, 1);
          }
        }
        return { count: 0 };
      }),
    },
  },
}));

import { kvGet, kvUpsert, kvDelete } from '../backgroundJobKv';

const ENV = process.env;
beforeEach(() => {
  rows.length = 0;
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
});

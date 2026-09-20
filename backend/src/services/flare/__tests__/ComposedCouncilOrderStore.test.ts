/**
 * ComposedCouncilOrderStore — the server-side memory of a composed council order.
 *
 * Pins: strict write (read back, or ORDER_RECOVERY_UNRECORDED), the memo must be
 * the keccak of the bytes, a re-composition never moves the scan start forward, and
 * (productizer it. 13) every live record is listed oldest first, a council holds at
 * most MAX_LIVE_ORDERS_PER_COUNCIL live compositions (an exit is never refused by
 * it), writes/forgets are CAS on the record as read, and a scan that hits its page
 * cap keeps only the progress it fully read.
 *
 * Hermetic: an in-memory `background_jobs` table stands in for Prisma.
 */
import { ethers } from 'ethers';

type Row = { id: string; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date };
const rows: Row[] = [];
let idSeq = 0;
let clock = Date.parse('2026-09-14T00:00:00Z');
let failReads = false;
let dropWrites = false;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matches(row: Row, where: any): boolean {
  if (!where) return true;
  if (where.jobType !== undefined && row.jobType !== where.jobType) return false;
  if (where.payload && row.payload?.[where.payload.path[0]] !== where.payload.equals) return false;
  if (where.createdAt?.lt && !(row.createdAt < where.createdAt.lt)) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray(where.AND) && !where.AND.every((w: any) => matches(row, w))) return false;
  return true;
}
const asc = (a: Row, b: Row) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    backgroundJob: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: async ({ where, orderBy }: any) => {
        if (failReads) throw new Error('db down');
        const list = rows.filter((r) => matches(r, where)).sort(asc);
        if (orderBy?.createdAt === 'desc') list.reverse();
        return list[0] ? clone(list[0]) : null;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: async ({ where, take, cursor, skip, orderBy }: any) => {
        if (failReads) throw new Error('db down');
        let list = rows.filter((r) => matches(r, where)).sort(asc);
        if (orderBy?.createdAt === 'desc') list.reverse();
        if (cursor) {
          const i = list.findIndex((r) => r.id === cursor.id);
          list = i < 0 ? [] : list.slice(i + (skip ?? 0));
        }
        return clone(list.slice(0, take ?? list.length));
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: async ({ data }: any) => {
        if (dropWrites) return;
        rows.push({ id: `row${String(++idSeq).padStart(6, '0')}`, jobType: data.jobType, status: data.status, payload: clone(data.payload), createdAt: new Date(clock++) });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
        if (dropWrites) return { count: 0 };
        let count = 0;
        for (const r of rows) if (matches(r, where)) { r.payload = clone(data.payload); count++; }
        return { count };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      deleteMany: async ({ where }: any) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
  },
}));

import type { Request } from 'express';
import {
  COMPOSED_ORDER_JOB,
  ComposedOrderUnrecordedError,
  _resetCouncilProvenMemory,
  councilQueuePrecheck,
  countQueueWithoutLedger,
  MAX_LIVE_ORDERS_PER_COUNCIL,
  MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER,
  TooManyPendingOrdersError,
  councilOrderContentKey,
  listComposedCouncilOrdersForCouncil,
  sessionProvesCouncil,
  forgetComposedCouncilOrder,
  getComposedCouncilOrderStrict,
  listComposedCouncilOrders,
  parseCouncilPaymentEntry,
  recordComposedCouncilOrder,
  recordComposedOrderForDelivery,
  scanCouncilPayments,
  updateComposedCouncilOrder,
} from '../ComposedCouncilOrderStore';

const COUNCIL = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const ORDER_DATA = '0xdeadbeef';
const MEMO = ethers.keccak256(ORDER_DATA).slice(2).toUpperCase();
const pinnedTx = (memo = MEMO) => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  Amount: '1',
  Sequence: 42,
  Memos: [{ Memo: { MemoData: memo } }],
});
const input = (
  over: Partial<{
    lls: number | null;
    ledger: number;
    seq: number;
    orderData: string;
    action: string;
    proven: boolean;
    userId: string | null;
    contentKey: string;
    exit: boolean;
  }> = {},
) => {
  const orderData = over.orderData ?? ORDER_DATA;
  const memo = ethers.keccak256(orderData).slice(2).toUpperCase();
  return {
    route: 'cage-order' as const,
    action: over.action ?? 'recall',
    council: COUNCIL,
    pinnedTx: pinnedTx(memo),
    order: { orderData },
    pin: {
      sequence: over.seq ?? 42,
      lastLedgerSequence: over.lls === undefined ? 1_150 : over.lls,
      validatedLedgerIndex: over.ledger ?? 1_000,
    },
    preparedByProven: over.proven ?? false,
    preparedByUserId: over.userId ?? null,
    ...(over.contentKey ? { contentKey: over.contentKey } : {}),
    ...(over.exit !== undefined ? { exit: over.exit } : {}),
  };
};
const stored = (memo = MEMO) => rows.find((r) => r.jobType === COMPOSED_ORDER_JOB && r.payload.memoHex === memo)?.payload;

const ENV = { ...process.env };
beforeEach(() => {
  rows.length = 0;
  failReads = false;
  dropWrites = false;
  process.env = { ...ENV, DATABASE_URL: 'postgres://test' };
});
afterAll(() => {
  process.env = ENV;
});

describe('recordComposedCouncilOrder', () => {
  it('writes the order and reads it back: memo, bytes, account, Destination/Amount, pinned seat, composition ledger', async () => {
    const out = await recordComposedCouncilOrder(input(), () => Date.parse('2026-09-14T10:00:00Z'));
    expect(out.recorded).toBe(true);
    expect(stored()).toMatchObject({
      memoHex: MEMO,
      orderHash: '0x' + MEMO.toLowerCase(),
      orderData: ORDER_DATA,
      council: COUNCIL,
      route: 'cage-order',
      sequence: 42,
      lastLedgerSequence: 1_150,
      composedLedgerIndex: 1_000,
      composedAt: '2026-09-14T10:00:00.000Z',
      destination: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
      amount: '1',
      version: 1,
    });
    expect(await listComposedCouncilOrders()).toHaveLength(1);
  });

  it('without a database there is nothing to persist into: composed as before', async () => {
    delete process.env.DATABASE_URL;
    expect(await recordComposedCouncilOrder(input())).toEqual({ recorded: false, reason: 'no-database' });
    expect(rows).toHaveLength(0);
  });

  it('a read-back that does not return the order is ORDER_RECOVERY_UNRECORDED', async () => {
    dropWrites = true;
    await expect(recordComposedCouncilOrder(input())).rejects.toBeInstanceOf(ComposedOrderUnrecordedError);
  });

  it('an unreadable database is ORDER_RECOVERY_UNRECORDED — «could not read» is never «recorded»', async () => {
    failReads = true;
    const err = await recordComposedCouncilOrder(input()).catch((e) => e);
    expect(err).toBeInstanceOf(ComposedOrderUnrecordedError);
    expect(err.code).toBe('ORDER_RECOVERY_UNRECORDED');
  });

  it('bytes that do not hash to the signed memo are refused (nothing relayable from them)', async () => {
    await expect(recordComposedCouncilOrder({ ...input(), pinnedTx: pinnedTx('AB'.repeat(32)) })).rejects.toThrow(/does not hash/);
    expect(rows).toHaveLength(0);
  });

  it('re-composing the same order keeps the EARLIEST scan start and the widest window, and moves the version', async () => {
    await recordComposedCouncilOrder(input({ ledger: 1_000, lls: 1_150 }));
    await recordComposedCouncilOrder(input({ ledger: 1_040, lls: 1_190, seq: 43 }));
    expect(stored()).toMatchObject({ composedLedgerIndex: 1_000, lastLedgerSequence: 1_190, sequence: 43, version: 2 });
    // a SignerList composition has no window: the record then never expires early
    await recordComposedCouncilOrder(input({ ledger: 1_050, lls: null }));
    expect(stored()).toMatchObject({ composedLedgerIndex: 1_000, lastLedgerSequence: null, version: 3 });
    expect(rows).toHaveLength(1);
  });

  it('a re-composition keeps a launch already made', async () => {
    await recordComposedCouncilOrder(input());
    const r = rows[0];
    r.payload = { ...r.payload, launchedXrplTxHash: 'C'.repeat(64), launchedAt: '2026-09-14T10:00:00.000Z' };
    await recordComposedCouncilOrder(input({ ledger: 1_020 }));
    expect(stored()?.launchedXrplTxHash).toBe('C'.repeat(64));
    expect(stored()?.launchedAt).toBe('2026-09-14T10:00:00.000Z');
  });
});

describe('the per-council cap (it. 13, counted by preparer in it. 15)', () => {
  const fill = async (
    n: number,
    over: Partial<{ lls: number | null; seq: number; proven: boolean; userId: string | null }> = {},
  ) => {
    for (let i = 0; i < n; i++) {
      await recordComposedCouncilOrder(
        input({ orderData: '0x' + (i + 1).toString(16).padStart(8, '0'), proven: over.proven ?? true, userId: over.userId, ...over }),
      );
    }
  };

  it(`a PROVEN session holding ${MAX_LIVE_ORDERS_PER_COUNCIL} live unlaunched compositions cannot add a NEW one`, async () => {
    await fill(MAX_LIVE_ORDERS_PER_COUNCIL);
    const err = await recordComposedCouncilOrder(input({ orderData: '0xffffffff', proven: true })).catch((e) => e);
    expect(err).toBeInstanceOf(TooManyPendingOrdersError);
    expect(err.code).toBe('TOO_MANY_PENDING_ORDERS');
    expect(err.bucket).toBe('council');
    // re-composing an order already in the queue adds nothing and is still allowed
    await expect(recordComposedCouncilOrder(input({ orderData: '0x00000001', proven: true }))).resolves.toMatchObject({ recorded: true });
  });

  it('closed windows, spent seats and launched orders do not hold a place', async () => {
    await fill(MAX_LIVE_ORDERS_PER_COUNCIL, { lls: 1_150 });
    // composed now on ledger 1_200: every one of those windows (≤ 1_150) is closed
    await expect(
      recordComposedCouncilOrder({
        ...input({ orderData: '0xffffffff', proven: true }),
        pin: { sequence: 42, lastLedgerSequence: 1_350, validatedLedgerIndex: 1_200 },
      }),
    ).resolves.toMatchObject({ recorded: true });
  });

  it('recordComposedOrderForDelivery: a full queue refuses a NON-exit with 429; an EXIT is still RECORDED (the cap never sees it)', async () => {
    await fill(MAX_LIVE_ORDERS_PER_COUNCIL);
    const entry = await recordComposedOrderForDelivery(input({ orderData: '0xfffffffe', action: 'direct-to', proven: true }), { exit: false });
    expect(entry).toMatchObject({ proceed: false, status: 429, body: { error: 'TOO_MANY_PENDING_ORDERS' } });
    const exit = await recordComposedOrderForDelivery(input({ orderData: '0xfffffffd', proven: true }), { exit: true });
    expect(exit).toMatchObject({ proceed: true, warning: null, serverDelivery: { recorded: true } });
    expect(stored(ethers.keccak256('0xfffffffd').slice(2).toUpperCase())).toBeDefined();
  });

  /* ── it. 15 (finding 2.1): a stranger fills their own bucket, and only theirs ── */

  it('a STRANGER composing 50 orders does not stop the proven manager: their records are counted apart', async () => {
    // The stranger stops at their own, small limit…
    for (let i = 0; i < MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER; i++) {
      await recordComposedCouncilOrder(input({ orderData: '0x' + (0xaa00 + i).toString(16), proven: false, userId: 'stranger' }));
    }
    const blocked = await recordComposedCouncilOrder(input({ orderData: '0xaaff0001', proven: false, userId: 'stranger' })).catch((e) => e);
    expect(blocked).toBeInstanceOf(TooManyPendingOrdersError);
    expect(blocked.bucket).toBe('preparer');
    expect(blocked.limit).toBe(MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER);
    // …and the manager who PROVES the council composes as if none of that existed.
    await expect(recordComposedCouncilOrder(input({ orderData: '0xbb000001', proven: true, userId: 'manager' }))).resolves.toMatchObject({ recorded: true });
    // Even 50 stranger records (several strangers) never reach the manager's count.
    for (let s = 0; s < 4; s++) {
      for (let i = 0; i < MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER; i++) {
        await recordComposedCouncilOrder(input({ orderData: '0x' + (0xc000 + s * 100 + i).toString(16), proven: false, userId: `stranger${s}` }));
      }
    }
    await expect(recordComposedCouncilOrder(input({ orderData: '0xbb000002', proven: true, userId: 'manager' }))).resolves.toMatchObject({ recorded: true });
  });

  /* ── it. 17 (finding 2.5): the cap, decided before any chain read is spent ── */

  it('councilQueuePrecheck sees a full queue with ONE database read and no ledger read', async () => {
    // Records with no window (a SignerList order) are the ones it can judge blind.
    for (let i = 0; i < MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER; i++) {
      await recordComposedCouncilOrder(input({ orderData: '0x' + (0xdd00 + i).toString(16), lls: null, proven: false, userId: 'stranger' }));
    }
    await expect(councilQueuePrecheck({ council: COUNCIL, proven: false, preparedByUserId: 'stranger' })).resolves.toMatchObject({
      full: true,
      bucket: 'preparer',
      limit: MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER,
    });
    // The manager's own queue is untouched by it, and an EXIT is never even asked.
    await expect(councilQueuePrecheck({ council: COUNCIL, proven: true, preparedByUserId: 'manager' })).resolves.toMatchObject({ full: false });
    await expect(
      councilQueuePrecheck({ council: COUNCIL, proven: false, preparedByUserId: 'stranger', exit: true }),
    ).resolves.toBeNull();
  });

  /**
   * it. 19 (finding 2.6) — THE PRE-CHECK WAS DEAD ON SINGLE-SIG COUNCILS. Counting
   * only windowless records is counting only multisig orders: every single-sign one
   * carries a `LastLedgerSequence`, so the lower bound was always zero and the door
   * spent every chain read the pre-check exists to save. A windowed row is now
   * counted while its window CANNOT yet have closed (window in ledgers × the slowest
   * a ledger closes), and dropped the moment that is no longer certain — the estimate
   * stays a lower bound of what the ledger would say about the window.
   */
  it('counts a windowed (single-sig) record while its window certainly cannot have closed', async () => {
    for (let i = 0; i < MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER + 5; i++) {
      // `exit: true` only skips the CAP while filling; the records still count.
      await recordComposedCouncilOrder(input({ orderData: '0x' + (0xee00 + i).toString(16), lls: 1_150, proven: false, userId: 'stranger', exit: true }));
    }
    // 150 ledgers of window, composed seconds ago: the ledger cannot have passed it.
    await expect(councilQueuePrecheck({ council: COUNCIL, proven: false, preparedByUserId: 'stranger' })).resolves.toMatchObject({
      full: true,
      bucket: 'preparer',
    });
    // …and an EXIT is still never asked, however full that bucket is.
    await expect(
      councilQueuePrecheck({ council: COUNCIL, proven: false, preparedByUserId: 'stranger', exit: true }),
    ).resolves.toBeNull();
  });

  it('stops counting a windowed record as soon as its window MAY have closed — under-count, never a false refusal', async () => {
    for (let i = 0; i < MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER + 5; i++) {
      await recordComposedCouncilOrder(input({ orderData: '0x' + (0xee00 + i).toString(16), lls: 1_150, proven: false, userId: 'stranger', exit: true }));
    }
    // 150 ledgers × 2.5 s ≈ 6 min; at 20 minutes nothing can be promised about them.
    const later = Date.now() + 20 * 60_000;
    expect(
      countQueueWithoutLedger(await listComposedCouncilOrdersForCouncil(COUNCIL), later, { proven: false, preparedByUserId: 'stranger' }),
    ).toBe(0);
    await expect(
      councilQueuePrecheck({ council: COUNCIL, proven: false, preparedByUserId: 'stranger', now: later }),
    ).resolves.toMatchObject({ full: false, live: 0 });
  });

  it('a store it cannot read is never a refusal: the pre-check answers null', async () => {
    failReads = true;
    await expect(councilQueuePrecheck({ council: COUNCIL, proven: true, preparedByUserId: 'manager' })).resolves.toBeNull();
  });

  it('an EXIT is recorded however full the bucket is — the cap has no vote on a way out', async () => {
    for (let i = 0; i < MAX_LIVE_ORDERS_PER_UNPROVEN_PREPARER + 5; i++) {
      const out = await recordComposedCouncilOrder(input({ orderData: '0x' + (0xdd00 + i).toString(16), proven: false, userId: 'stranger', exit: true }));
      expect(out.recorded).toBe(true);
    }
    const delivered = await recordComposedOrderForDelivery(input({ orderData: '0xdeff0001', proven: false, userId: 'stranger' }), { exit: true });
    expect(delivered).toMatchObject({ proceed: true, warning: null, serverDelivery: { recorded: true } });
  });

  it('attribution never downgrades: an unproven re-composition keeps the proven owner of the record', async () => {
    await recordComposedCouncilOrder(input({ orderData: '0xab01', proven: true, userId: 'manager' }));
    await recordComposedCouncilOrder(input({ orderData: '0xab01', proven: false, userId: 'stranger' }));
    expect(stored(ethers.keccak256('0xab01').slice(2).toUpperCase())).toMatchObject({
      preparedByProven: true,
      preparedByUserId: 'manager',
    });
  });

  it('recordComposedOrderForDelivery: unrecordable → 503 for a non-exit, warning for an exit; recorded → serverDelivery', async () => {
    process.env.FLARE_EXECUTOR_ENABLED = 'true';
    expect(await recordComposedOrderForDelivery(input(), { exit: false })).toEqual({
      proceed: true,
      warning: null,
      serverDelivery: { recorded: true, executorEnabled: true },
    });
    failReads = true;
    expect(await recordComposedOrderForDelivery(input(), { exit: false })).toMatchObject({ proceed: false, status: 503, body: { error: 'ORDER_RECOVERY_UNRECORDED' } });
    expect(await recordComposedOrderForDelivery(input(), { exit: true })).toMatchObject({ proceed: true, serverDelivery: { recorded: false, executorEnabled: true } });
  });
});

describe('listing and CAS (it. 13)', () => {
  it('lists EVERY record oldest first — past the old window of 200', async () => {
    for (let i = 0; i < 450; i++) {
      rows.push({
        id: `row${String(++idSeq).padStart(6, '0')}`,
        jobType: COMPOSED_ORDER_JOB,
        status: 'completed',
        createdAt: new Date(clock++),
        payload: {
          memoHex: i.toString(16).toUpperCase().padStart(64, '0'),
          orderData: '0x01',
          council: COUNCIL,
          composedLedgerIndex: 1_000 + i,
          composedAt: '2026-09-14T10:00:00.000Z',
          lastLedgerSequence: null,
        },
      });
    }
    const all = await listComposedCouncilOrders({ pageSize: 200 });
    expect(all).toHaveLength(450);
    expect(all[0].composedLedgerIndex).toBe(1_000);
    expect(all[449].composedLedgerIndex).toBe(1_449);
  });

  it('update and forget only touch the record as it was read', async () => {
    await recordComposedCouncilOrder(input());
    const read = (await getComposedCouncilOrderStrict(MEMO))!;
    // a re-composition lands between the read and the write
    await recordComposedCouncilOrder(input({ ledger: 1_010 }));
    expect(await updateComposedCouncilOrder({ ...read, scannedThroughLedger: 1_100 }, read)).toBe(false);
    expect(stored()?.scannedThroughLedger).toBeUndefined();
    expect(await forgetComposedCouncilOrder(read)).toBe(false);
    expect(stored()).toBeDefined();

    const fresh = (await getComposedCouncilOrderStrict(MEMO))!;
    expect(await updateComposedCouncilOrder({ ...fresh, scannedThroughLedger: 1_100 }, fresh)).toBe(true);
    expect(stored()).toMatchObject({ scannedThroughLedger: 1_100, version: (fresh.version ?? 0) + 1 });
    const after = (await getComposedCouncilOrderStrict(MEMO))!;
    expect(await forgetComposedCouncilOrder(after)).toBe(true);
    expect(stored()).toBeUndefined();
  });
});

describe('councilOrderContentKey — what makes two orders «the same order» (it. 15)', () => {
  const key = (action: string, params: unknown, council = COUNCIL) => councilOrderContentKey({ council, action, params });

  it('same account, action and params → same key, however the params were typed', () => {
    expect(key('direct-to', { venueId: 0, amount: '1000' })).toBe(key('direct-to', { amount: 1000, venueId: '0' }));
    expect(key('create-pote', { pote: '0xAbCd', name: ' A ' })).toBe(key('create-pote', { name: 'A', pote: '0xabcd' }));
  });

  it('a different action, venue, amount, destination or account is a DIFFERENT order', () => {
    const base = key('direct-to', { venueId: 0, amount: '1000' });
    expect(key('set-user-gate', { venueId: 0, amount: '1000' })).not.toBe(base);
    expect(key('direct-to', { venueId: 1, amount: '1000' })).not.toBe(base);
    expect(key('direct-to', { venueId: 0, amount: '1001' })).not.toBe(base);
    expect(key('direct-to', { venueId: 0, amount: '1000', pote: '0x01' })).not.toBe(base);
    expect(key('direct-to', { venueId: 0, amount: '1000' }, 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH')).not.toBe(base);
  });

  /** it. 17 (finding 2.4): the same venues in another order are the SAME order. */
  it('arrays are sorted before hashing: the same list in another order is one key', () => {
    expect(key('propose-venue', { venues: [1, 0] })).toBe(key('propose-venue', { venues: ['0', 1] }));
    expect(key('set-payees', { payees: ['0xBB', '0xaa'] })).toBe(key('set-payees', { payees: ['0xaa', '0xbb'] }));
    expect(key('set-payees', { payees: [{ to: '0xAA', bps: 10 }, { to: '0xbb', bps: 5 }] })).toBe(
      key('set-payees', { payees: [{ bps: '5', to: '0xBB' }, { bps: 10, to: '0xaa' }] }),
    );
    // …but a DIFFERENT list is still a different order.
    expect(key('propose-venue', { venues: [1, 2] })).not.toBe(key('propose-venue', { venues: [1, 0] }));
  });

  it('travels with the record and can be read back for one council', async () => {
    const k = key('recall', { venueId: 0, amount: '1000' });
    await recordComposedCouncilOrder(input({ contentKey: k, proven: true }));
    await recordComposedCouncilOrder(input({ orderData: '0x0bad', contentKey: key('recall', { venueId: 1, amount: '1000' }), proven: true }));
    const same = await listComposedCouncilOrdersForCouncil(COUNCIL, { contentKey: k });
    expect(same.map((r) => r.memoHex)).toEqual([MEMO]);
  });
});

describe('sessionProvesCouncil — who controls the council (it. 15)', () => {
  const req = (userId = 'u1') => ({ siwe: { userId, walletAddress: 'rSESSION' } }) as unknown as Request;
  beforeEach(() => _resetCouncilProvenMemory());

  it('the session that proved the account controls it — no ledger read needed', async () => {
    const readSignerCouncil = jest.fn();
    expect(await sessionProvesCouncil(req(), COUNCIL, { mayActOnAccount: async () => true, readSignerCouncil })).toBe(true);
    expect(readSignerCouncil).not.toHaveBeenCalled();
  });

  it('a proven address holding a SEAT in the SignerList controls it too (the multisig case)', async () => {
    const deps = {
      mayActOnAccount: async () => false,
      provenAddresses: async () => ['rMEMBER'],
      readSignerCouncil: async () => ({ signers: [{ account: 'rOTHER' }, { account: 'rMEMBER' }] }),
    };
    expect(await sessionProvesCouncil(req(), COUNCIL, deps)).toBe(true);
  });

  it('a stranger does not: no seat, no proven address, and an unreadable ledger is never authority', async () => {
    expect(
      await sessionProvesCouncil(req(), COUNCIL, {
        mayActOnAccount: async () => false,
        provenAddresses: async () => ['rSOMEONE'],
        readSignerCouncil: async () => ({ signers: [{ account: 'rMEMBER' }] }),
      }),
    ).toBe(false);
    expect(
      await sessionProvesCouncil(req(), COUNCIL, { mayActOnAccount: async () => false, provenAddresses: async () => [] }),
    ).toBe(false);
    expect(
      // A session that never proved anything: an unreadable ledger is not authority.
      await sessionProvesCouncil(req('never-proved'), COUNCIL, {
        mayActOnAccount: async () => false,
        provenAddresses: async () => ['rMEMBER'],
        readSignerCouncil: async () => {
          throw new Error('xrpl down');
        },
      }),
    ).toBe(false);
  });

  /**
   * it. 17 (finding 2.5) — A 429 FROM THE NODE MUST NOT DEMOTE A REAL MANAGER.
   * The verdict is only ever remembered after it was READ off the validated ledger,
   * so this is a memory of a proof, never a widening: the previous test pins that a
   * session which never proved anything still gets `false`.
   */
  it('a node that goes down does not move a PROVED manager into the stranger queue', async () => {
    const deps = {
      mayActOnAccount: async () => false,
      provenAddresses: async () => ['rMEMBER'],
      readSignerCouncil: async () => ({ signers: [{ account: 'rMEMBER' }] }),
    };
    expect(await sessionProvesCouncil(req('manager'), COUNCIL, deps)).toBe(true);
    expect(
      await sessionProvesCouncil(req('manager'), COUNCIL, {
        ...deps,
        readSignerCouncil: async () => {
          throw new Error('429 Too Many Requests');
        },
      }),
    ).toBe(true);
    // …and only for THAT council: the memory is keyed by (session, account).
    expect(
      await sessionProvesCouncil(req('manager'), 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH', {
        ...deps,
        readSignerCouncil: async () => {
          throw new Error('429 Too Many Requests');
        },
      }),
    ).toBe(false);
  });

  it('a SignerList read that never answers is bounded, and is not authority', async () => {
    jest.useFakeTimers();
    try {
      const verdict = sessionProvesCouncil(req('hanging'), COUNCIL, {
        mayActOnAccount: async () => false,
        provenAddresses: async () => ['rMEMBER'],
        readSignerCouncil: () => new Promise(() => {}) as Promise<{ signers: Array<{ account: string }> }>,
      });
      await jest.advanceTimersByTimeAsync(5_000);
      expect(await verdict).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('asks once per request and council (the ledger is not read twice for one composition)', async () => {
    const readSignerCouncil = jest.fn(async () => ({ signers: [{ account: 'rMEMBER' }] }));
    const r = req();
    const deps = { mayActOnAccount: async () => false, provenAddresses: async () => ['rMEMBER'], readSignerCouncil };
    expect(await sessionProvesCouncil(r, COUNCIL, deps)).toBe(true);
    expect(await sessionProvesCouncil(r, COUNCIL, deps)).toBe(true);
    expect(readSignerCouncil).toHaveBeenCalledTimes(1);
  });
});

describe('parseCouncilPaymentEntry', () => {
  const entry = (over: Record<string, unknown> = {}, tx: Record<string, unknown> = {}) => ({
    hash: 'a'.repeat(64),
    validated: true,
    ledger_index: 1_010,
    meta: { TransactionResult: 'tesSUCCESS' },
    tx_json: { TransactionType: 'Payment', Account: COUNCIL, Memos: [{ Memo: { MemoData: MEMO.toLowerCase() } }], ...tx },
    ...over,
  });

  it('reads a validated Payment the council sent, in both api_versions', () => {
    expect(parseCouncilPaymentEntry(entry(), COUNCIL)).toEqual({ hash: 'A'.repeat(64), memoHex: MEMO, result: 'tesSUCCESS', ledgerIndex: 1_010 });
    const v1 = { ...entry(), tx: entry().tx_json, tx_json: undefined };
    expect(parseCouncilPaymentEntry(v1, COUNCIL)?.memoHex).toBe(MEMO);
  });

  it('a payment from anyone else with the same memo is never the council’s order', () => {
    expect(parseCouncilPaymentEntry(entry({}, { Account: 'rDNvpqSzJzk8Qx2oGmYzhFj7uRzAbfnFmA' }), COUNCIL)).toBeNull();
  });

  it('non-Payments, unvalidated entries and memos that are not 32 bytes are ignored', () => {
    expect(parseCouncilPaymentEntry(entry({}, { TransactionType: 'OfferCreate' }), COUNCIL)).toBeNull();
    expect(parseCouncilPaymentEntry(entry({ validated: false }), COUNCIL)).toBeNull();
    expect(parseCouncilPaymentEntry(entry({}, { Memos: [{ Memo: { MemoData: 'FE01' } }] }), COUNCIL)).toBeNull();
  });

  it('an entry without meta reads as «unknown» — unreadable, never a result', () => {
    expect(parseCouncilPaymentEntry(entry({ meta: undefined }), COUNCIL)?.result).toBe('unknown');
  });
});

describe('scanCouncilPayments — exhaustive, or only what was fully read', () => {
  const tx = (memo: string, hash: string, ledger = 1_010) => ({
    hash,
    validated: true,
    ledger_index: ledger,
    meta: { TransactionResult: 'tesSUCCESS' },
    tx_json: { TransactionType: 'Payment', Account: COUNCIL, Memos: [{ Memo: { MemoData: memo } }] },
  });

  it('reads OLDEST FIRST, pages until the marker is gone and reports how far the node searched', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ ledger_index_min: 1_000, ledger_index_max: 1_200, transactions: [tx('11'.repeat(32), '1'.repeat(64))], marker: { l: 1 } })
      .mockResolvedValueOnce({ ledger_index_min: 1_000, ledger_index_max: 1_200, transactions: [tx(MEMO, '2'.repeat(64))] });
    const out = await scanCouncilPayments(COUNCIL, { ledgerIndexMin: 1_000 }, rpc);
    expect(out).toMatchObject({ searchedThroughLedger: 1_200, exhausted: true });
    expect(out.matches.map((m) => m.memoHex)).toEqual(['11'.repeat(32).toUpperCase(), MEMO]);
    expect(rpc).toHaveBeenNthCalledWith(1, 'account_tx', expect.objectContaining({ account: COUNCIL, ledger_index_min: 1_000, ledger_index_max: -1, forward: true }));
    expect(rpc.mock.calls[1][1]).toMatchObject({ marker: { l: 1 } });
  });

  it('the page cap with a marker still set keeps the progress it FULLY read (the ledger before the last entry)', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ ledger_index_min: 1_000, ledger_index_max: 9_000, transactions: [tx('11'.repeat(32), '1'.repeat(64), 1_010)], marker: 'm1' })
      .mockResolvedValueOnce({ ledger_index_min: 1_000, ledger_index_max: 9_000, transactions: [tx(MEMO, '2'.repeat(64), 1_020)], marker: 'm2' });
    const out = await scanCouncilPayments(COUNCIL, { ledgerIndexMin: 1_000, maxPages: 2 }, rpc);
    expect(out).toMatchObject({ exhausted: false, searchedThroughLedger: 1_019 });
    expect(out.matches.map((m) => m.memoHex)).toContain(MEMO);
  });

  it('the page cap with nothing to anchor progress on throws — never an invented answer', async () => {
    const rpc = jest.fn().mockResolvedValue({ ledger_index_min: 1_000, ledger_index_max: 1_200, transactions: [], marker: 'more' });
    await expect(scanCouncilPayments(COUNCIL, { ledgerIndexMin: 1_000, maxPages: 2 }, rpc)).rejects.toThrow(/NOT_EXHAUSTED/);
  });

  it('a node without history for the window throws', async () => {
    const rpc = jest.fn().mockResolvedValue({ ledger_index_min: 1_050, ledger_index_max: 1_200, transactions: [] });
    await expect(scanCouncilPayments(COUNCIL, { ledgerIndexMin: 1_000 }, rpc)).rejects.toThrow(/HISTORY_MISSING/);
  });

  it('a node that does not say how far it searched throws', async () => {
    const rpc = jest.fn().mockResolvedValue({ transactions: [] });
    await expect(scanCouncilPayments(COUNCIL, { ledgerIndexMin: 1_000 }, rpc)).rejects.toThrow(/UNBOUNDED/);
  });
});

/**
 * sweepComposedCouncilOrders — a signed order reaches Flare even when the screen
 * that signed it is gone (2026-09-14; productizer it. 13).
 *
 * Mocked ledger (account_tx) + mocked relay + an in-memory `background_jobs`
 * table: the sweep finds the validated tesSUCCESS Payment carrying the composed
 * memo, launches the SAME idempotent relay POST relay uses (with the recorded
 * bytes), forgets orders that can never validate, and concludes nothing from a
 * ledger it could not read. it. 13 pins: every record is watched (not the newest
 * 200), partial progress survives a page cap, an unreadable entry is never a tec,
 * update/forget are CAS, and the fate of an order stays readable.
 */

const relayCouncilOrder = jest.fn();
class RelayAbort extends Error {}
jest.mock('../LegacyOrderRelayService', () => ({
  relayCouncilOrder: (...args: unknown[]) => relayCouncilOrder(...args),
  RelayAbort,
}));

const mockXrplJsonRpc = jest.fn();
jest.mock('../DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockXrplJsonRpc(...a),
}));

// The pending-relay list still lives on the generic kv.
const pending = new Map<string, Record<string, unknown>>();
jest.mock('../../persistence/backgroundJobKv', () => ({
  kvList: async () => [...pending.values()],
  // `rememberPending` lee ESTRICTO desde el it. 27: un fallo de lectura no puede
  // reescribir `firstSeenAt` (el reloj de 14 días del FDC). Aquí la base responde.
  kvListStrict: async () => [...pending.values()],
  kvUpsert: async (_j: string, _f: string, key: string, payload: Record<string, unknown>) => {
    pending.set(key, payload);
  },
  kvDelete: async (_j: string, _f: string, key: string) => {
    pending.delete(key);
  },
}));

// The composed-order store reads the table directly: an in-memory stand-in.
type Row = { id: string; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date };
const rows: Row[] = [];
let idSeq = 0;
let clock = Date.parse('2026-09-01T00:00:00Z');
let failReads = false;
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
    councilProposal: { findMany: async () => [] },
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
        rows.push({ id: `row${String(++idSeq).padStart(6, '0')}`, jobType: data.jobType, status: data.status, payload: clone(data.payload), createdAt: new Date(clock++) });
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: async ({ where, data }: any) => {
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

import { ethers } from 'ethers';
import { COMPOSED_ORDER_FATE_JOB, COMPOSED_ORDER_JOB } from '../ComposedCouncilOrderStore';
import {
  CouncilOrderFateRateLimitedError,
  CouncilOrderFateUnreadableError,
  FATE_READS_PER_SESSION_PER_MIN,
  _resetCouncilOrderFateLimiter,
  councilDuplicateOrderVerdict,
  councilOrderInFlight,
  getCouncilOrderRelayState,
  launchCouncilOrderRelay,
  ledgerDuplicateCheck,
  readCouncilOrderFate,
  readCouncilOrderFateLimited,
  recentSameCouncilOrder,
  retryPendingCouncilOrders,
  sweepComposedCouncilOrders,
} from '../CouncilOrderRelayLauncher';

const COUNCIL = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const NOW = Date.parse('2026-09-14T12:00:00Z');
let seq = 0;

function order(over: Record<string, unknown> = {}) {
  seq++;
  const orderData = '0x' + seq.toString(16).padStart(8, '0');
  const memoHex = ethers.keccak256(orderData).slice(2).toUpperCase();
  const rec = {
    memoHex,
    orderHash: '0x' + memoHex.toLowerCase(),
    orderData,
    council: COUNCIL,
    route: 'cage-order',
    action: 'recall',
    sequence: 42,
    lastLedgerSequence: 1_150,
    composedLedgerIndex: 1_000,
    composedAt: new Date(NOW - 60_000).toISOString(),
    version: 1,
    ...over,
  };
  rows.push({ id: `row${String(++idSeq).padStart(6, '0')}`, jobType: COMPOSED_ORDER_JOB, status: 'completed', payload: clone(rec), createdAt: new Date(clock++) });
  return rec;
}
const hashOf = (n: number) => n.toString(16).toUpperCase().padStart(64, '0');
const payment = (memoHex: string, hash: string, result: string | null = 'tesSUCCESS', account = COUNCIL, ledger?: number) => ({
  hash,
  validated: true,
  ...(result !== null ? { meta: { TransactionResult: result } } : {}),
  ...(ledger !== undefined ? { ledger_index: ledger } : {}),
  tx_json: { TransactionType: 'Payment', Account: account, Memos: [{ Memo: { MemoData: memoHex } }] },
});
const page = (transactions: unknown[], max = 1_100, marker?: unknown) => ({
  ledger_index_min: 1_000,
  ledger_index_max: max,
  transactions,
  ...(marker !== undefined ? { marker } : {}),
});
const composed = (memo: string) => rows.find((r) => r.jobType === COMPOSED_ORDER_JOB && r.payload.memoHex === memo)?.payload;
const fateRow = (memo: string) => rows.find((r) => r.jobType === COMPOSED_ORDER_FATE_JOB && r.payload.memoHex === memo)?.payload;

async function waitFor(fn: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('condition never met');
}

const ENV = { ...process.env };
beforeEach(() => {
  rows.length = 0;
  pending.clear();
  failReads = false;
  relayCouncilOrder.mockReset();
  mockXrplJsonRpc.mockReset();
  process.env = { ...ENV, FLARE_EXECUTOR_ENABLED: 'true', DATABASE_URL: 'postgres://test' };
});
afterAll(() => {
  process.env = ENV;
});

describe('sweepComposedCouncilOrders', () => {
  it('a validated tesSUCCESS Payment with the memo → the relay launches with the recorded bytes, no browser', async () => {
    const o = order();
    const H = hashOf(0xa1);
    relayCouncilOrder.mockResolvedValue({ stage: 'executed', flareTxHash: '0xf1' });
    const rpc = jest.fn().mockResolvedValue(page([payment(o.memoHex, H)]));

    const out = await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(out).toMatchObject({ checked: 1, launched: 1 });
    expect(rpc).toHaveBeenCalledWith('account_tx', expect.objectContaining({ account: COUNCIL, ledger_index_min: 1_000 }));
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'executed');
    expect(relayCouncilOrder).toHaveBeenCalledWith({ xrplTxHash: H, orderDataOverride: o.orderData });
    expect(composed(o.memoHex)).toMatchObject({ launchedXrplTxHash: H, launchedAt: new Date(NOW).toISOString() });

    // Next pass: the relay said executed → forgotten, with its fate left behind.
    const again = await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(again.launched).toBe(0);
    expect(composed(o.memoHex)).toBeUndefined();
    expect(fateRow(o.memoHex)).toMatchObject({ state: 'executed', xrplTxHash: H });
    expect(relayCouncilOrder).toHaveBeenCalledTimes(1);
  });

  it('an order already relaying (POST relay from the browser) is marked, never launched twice', async () => {
    const o = order();
    const H = hashOf(0xa2);
    let release: (v: unknown) => void = () => {};
    relayCouncilOrder.mockImplementation(() => new Promise((r) => (release = r)));
    launchCouncilOrderRelay(H, o.orderData);
    await waitFor(() => relayCouncilOrder.mock.calls.length === 1);

    const out = await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([payment(o.memoHex, H)])) });
    expect(out.launched).toBe(0);
    expect(composed(o.memoHex)?.launchedXrplTxHash).toBe(H);
    expect(relayCouncilOrder).toHaveBeenCalledTimes(1);
    release({ stage: 'executed' });
  });

  it('not on the ledger yet, window still open → kept, with the scan progress (next pass starts after it)', async () => {
    const o = order();
    const rpc = jest.fn().mockResolvedValue(page([], 1_100));
    await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(relayCouncilOrder).not.toHaveBeenCalled();
    expect(composed(o.memoHex)?.scannedThroughLedger).toBe(1_100);

    rpc.mockResolvedValue({ ...page([], 1_120), ledger_index_min: 1_101 });
    await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(rpc.mock.calls[1][1]).toMatchObject({ ledger_index_min: 1_101 });
    expect(composed(o.memoHex)?.scannedThroughLedger).toBe(1_120);
  });

  it('its whole LastLedgerSequence window read without the memo → it can never validate: forgotten, fate failed', async () => {
    const o = order({ lastLedgerSequence: 1_150 });
    const out = await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([], 1_151)) });
    expect(out.forgotten).toBe(1);
    expect(composed(o.memoHex)).toBeUndefined();
    expect(fateRow(o.memoHex)).toMatchObject({ state: 'failed' });
    expect(relayCouncilOrder).not.toHaveBeenCalled();
  });

  it('a SignerList order (no window) is never expired early by the scan', async () => {
    const o = order({ lastLedgerSequence: null });
    await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([], 9_999)) });
    expect(composed(o.memoHex)).toBeDefined();
  });

  it('the memo validated with a failure (tec*) → applied, nothing to deliver: forgotten, no relay, fate failed with the hash', async () => {
    const o = order();
    const H = hashOf(0xa3);
    await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([payment(o.memoHex, H, 'tecUNFUNDED_PAYMENT')])) });
    expect(composed(o.memoHex)).toBeUndefined();
    expect(fateRow(o.memoHex)).toMatchObject({ state: 'failed', xrplTxHash: H });
    expect(relayCouncilOrder).not.toHaveBeenCalled();
  });

  it('an entry WITHOUT a readable result is unreadable, never a tec: kept, progress held below it', async () => {
    const o = order({ lastLedgerSequence: 1_150 });
    await sweepComposedCouncilOrders({
      now: NOW,
      rpc: jest.fn().mockResolvedValue(page([payment(o.memoHex, hashOf(0xa8), null, COUNCIL, 1_050)], 1_200)),
    });
    expect(composed(o.memoHex)).toMatchObject({ scannedThroughLedger: 1_049 });
    expect(fateRow(o.memoHex)).toBeUndefined();
    expect(relayCouncilOrder).not.toHaveBeenCalled();
  });

  it('the same memo sent by ANOTHER account is not the council’s order', async () => {
    const o = order();
    await sweepComposedCouncilOrders({
      now: NOW,
      rpc: jest.fn().mockResolvedValue(page([payment(o.memoHex, hashOf(0xa4), 'tesSUCCESS', 'rDNvpqSzJzk8Qx2oGmYzhFj7uRzAbfnFmA')])),
    });
    expect(relayCouncilOrder).not.toHaveBeenCalled();
    expect(composed(o.memoHex)?.launchedXrplTxHash).toBeUndefined();
  });

  it('finds the memo on a later page (marker exhausted)', async () => {
    const o = order();
    const H = hashOf(0xa5);
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    const rpc = jest
      .fn()
      .mockResolvedValueOnce(page([payment('11'.repeat(32), hashOf(0xb1))], 1_100, 'next'))
      .mockResolvedValueOnce(page([payment(o.memoHex, H)], 1_100));
    const out = await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(out.launched).toBe(1);
    await waitFor(() => relayCouncilOrder.mock.calls.length === 1);
    expect(relayCouncilOrder.mock.calls[0][0]).toMatchObject({ xrplTxHash: H });
  });

  it('a page cap keeps the progress fully read — a busy council no longer concludes nothing forever', async () => {
    const o = order({ lastLedgerSequence: null });
    let n = 0;
    const rpc = jest.fn().mockImplementation(async () => {
      n++;
      return page([payment('22'.repeat(32), hashOf(0xc000 + n), 'tesSUCCESS', COUNCIL, 1_000 + n * 10)], 9_999, `m${n}`);
    });
    await sweepComposedCouncilOrders({ now: NOW, rpc });
    // 20 pages, last entry on ledger 1_200: only up to 1_199 was fully read.
    expect(composed(o.memoHex)?.scannedThroughLedger).toBe(1_199);
    expect(relayCouncilOrder).not.toHaveBeenCalled();
  });

  it('a ledger it could not read at all concludes NOTHING: no launch, no forget, no progress', async () => {
    const o = order();
    const rpc = jest.fn().mockResolvedValue(page([], 9_999, 'always-more'));
    await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(composed(o.memoHex)).toEqual(o);
    rpc.mockRejectedValue(new Error('xrpl_endpoint_stale'));
    await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(composed(o.memoHex)).toEqual(o);
    expect(relayCouncilOrder).not.toHaveBeenCalled();
  });

  it('past the FDC window (14 days) the record is forgotten without reading the ledger', async () => {
    const o = order({ composedAt: new Date(NOW - 15 * 86_400_000).toISOString() });
    const rpc = jest.fn();
    await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(composed(o.memoHex)).toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('with the relayer OFF nothing is delivered, but the expired IS pruned and the validated is marked (it. 15)', async () => {
    process.env.FLARE_EXECUTOR_ENABLED = 'false';
    const expired = order({ composedAt: new Date(NOW - 15 * 86_400_000).toISOString() });
    const closed = order({ lastLedgerSequence: 1_050 });
    const validated = order();
    const H = hashOf(0xab1);
    const out = await sweepComposedCouncilOrders({
      now: NOW,
      rpc: jest.fn().mockResolvedValue(page([payment(validated.memoHex, H)], 1_100)),
    });
    // nothing reaches Flare without the flag…
    expect(relayCouncilOrder).not.toHaveBeenCalled();
    expect(out.launched).toBe(0);
    // …but the table stops growing for ever, and the guard can see what went out.
    expect(composed(expired.memoHex)).toBeUndefined();
    expect(composed(closed.memoHex)).toBeUndefined();
    expect(composed(validated.memoHex)).toMatchObject({ launchedXrplTxHash: H, launchedAt: new Date(NOW).toISOString() });
    expect(out.forgotten).toBe(2);
  });

  it('with the relayer off a marked order is neither re-marked nor forgotten; switching the flag on delivers it', async () => {
    process.env.FLARE_EXECUTOR_ENABLED = 'false';
    const H = hashOf(0xab2);
    const o = order({ launchedXrplTxHash: H, launchedAt: new Date(NOW - 60_000).toISOString() });
    await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn() });
    expect(relayCouncilOrder).not.toHaveBeenCalled();
    expect(composed(o.memoHex)).toBeDefined();

    process.env.FLARE_EXECUTOR_ENABLED = 'true';
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    const out = await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn() });
    expect(out.launched).toBe(1);
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'executed');
  });

  it('a launched order the relay did not finish (restart / error) is relaunched — idempotent', async () => {
    const H = hashOf(0xa6);
    const o = order({ launchedXrplTxHash: H });
    relayCouncilOrder.mockResolvedValue({ stage: 'already-executed' });
    const out = await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn() });
    expect(out.launched).toBe(1);
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'executed');
    expect(relayCouncilOrder).toHaveBeenCalledWith({ xrplTxHash: H, orderDataOverride: o.orderData });
  });

  it('201+ records: the OLDEST order is still watched and delivered', async () => {
    const oldest = order({ lastLedgerSequence: null });
    for (let i = 0; i < 250; i++) order({ lastLedgerSequence: null });
    const H = hashOf(0xd1);
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    const out = await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([payment(oldest.memoHex, H)])) });
    expect(out.checked).toBe(251);
    expect(out.launched).toBe(1);
    await waitFor(() => relayCouncilOrder.mock.calls.length === 1);
    expect(relayCouncilOrder.mock.calls[0][0]).toMatchObject({ xrplTxHash: H, orderDataOverride: oldest.orderData });
  });

  it('CAS: a re-composition during the scan is neither overwritten nor forgotten', async () => {
    const o = order();
    const rpc = jest.fn().mockImplementation(async () => {
      // the same order is composed again while the ledger is being read
      const row = rows.find((r) => r.payload.memoHex === o.memoHex)!;
      row.payload = { ...row.payload, version: 2, composedAt: new Date(NOW - 1_000).toISOString(), sequence: 43 };
      return page([payment(o.memoHex, hashOf(0xa9), 'tecUNFUNDED_PAYMENT')], 1_200);
    });
    const out = await sweepComposedCouncilOrders({ now: NOW, rpc });
    expect(out.forgotten).toBe(0);
    expect(composed(o.memoHex)).toMatchObject({ version: 2, sequence: 43 });
  });
});

describe('retryPendingCouncilOrders runs the composed sweep on its interval', () => {
  it('a composed order validated while nobody watched is launched by the periodic tick', async () => {
    const o = order();
    const H = hashOf(0xa7);
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    mockXrplJsonRpc.mockResolvedValue(page([payment(o.memoHex, H)]));
    const out = await retryPendingCouncilOrders();
    expect(out.recovered).toBe(1);
    expect(mockXrplJsonRpc).toHaveBeenCalledWith('account_tx', expect.objectContaining({ account: COUNCIL }), undefined, { requireFresh: true });
    await waitFor(() => relayCouncilOrder.mock.calls.length === 1);
    expect(relayCouncilOrder.mock.calls[0][0]).toMatchObject({ xrplTxHash: H, orderDataOverride: o.orderData });
  });
});

describe('readCouncilOrderFate — what became of this order (it. 13, finding 3.1)', () => {
  const infoAndTx = (info: Record<string, unknown>, tx: Record<string, unknown>) =>
    jest.fn().mockImplementation(async (method: string) => (method === 'account_info' ? info : tx));

  it('an order the ledger already validated (the sibling payload) → validated, with its hash', async () => {
    const o = order();
    const H = hashOf(0xe1);
    const rpc = infoAndTx({ validated: true, ledger_index: 1_090, account_data: { Sequence: 43 } }, page([payment(o.memoHex, H)], 1_100));
    expect(await readCouncilOrderFate(o.memoHex, { rpc })).toMatchObject({ memo: o.memoHex, state: 'validated', xrplTxHash: H });
  });

  it('a launched order whose relay executed → executed', async () => {
    const H = hashOf(0xe2);
    const o = order({ launchedXrplTxHash: H });
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    launchCouncilOrderRelay(H, o.orderData);
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'executed');
    expect(await readCouncilOrderFate(o.memoHex, { rpc: jest.fn() })).toMatchObject({ state: 'executed', xrplTxHash: H });
  });

  it('its Sequence spent by another transaction and not on the ledger → failed (safe to compose again)', async () => {
    const o = order({ lastLedgerSequence: 1_150 });
    const rpc = infoAndTx({ validated: true, ledger_index: 1_090, account_data: { Sequence: 43 } }, page([], 1_100));
    expect(await readCouncilOrderFate(o.memoHex, { rpc })).toMatchObject({ state: 'failed' });
  });

  it('window open, seat not spent, not on the ledger → composed', async () => {
    const o = order({ lastLedgerSequence: 1_150 });
    const rpc = infoAndTx({ validated: true, ledger_index: 1_090, account_data: { Sequence: 42 } }, page([], 1_100));
    expect(await readCouncilOrderFate(o.memoHex, { rpc })).toMatchObject({ state: 'composed' });
  });

  it('a forgotten order answers with the fate the sweep left; an unknown memo is unknown', async () => {
    const o = order();
    const H = hashOf(0xe3);
    await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([payment(o.memoHex, H, 'tecNO_DST')])) });
    expect(await readCouncilOrderFate(o.memoHex)).toMatchObject({ state: 'failed', xrplTxHash: H });
    expect(await readCouncilOrderFate('77'.repeat(32))).toEqual({ memo: '77'.repeat(32), state: 'unknown' });
  });

  it('«could not read» is an error, never unknown: store down, ledger down, entry without result', async () => {
    const o = order();
    await expect(
      readCouncilOrderFate(o.memoHex, { rpc: jest.fn().mockRejectedValue(new Error('xrpl_endpoint_stale')) }),
    ).rejects.toBeInstanceOf(CouncilOrderFateUnreadableError);
    await expect(
      readCouncilOrderFate(o.memoHex, { rpc: infoAndTx({}, page([payment(o.memoHex, hashOf(0xe4), null)], 1_100)) }),
    ).rejects.toBeInstanceOf(CouncilOrderFateUnreadableError);
    failReads = true;
    await expect(readCouncilOrderFate('77'.repeat(32))).rejects.toBeInstanceOf(CouncilOrderFateUnreadableError);
  });
});

describe('the duplicate guard, by CONTENT (it. 15, finding 2.2)', () => {
  const KEY = 'content-key-direct-to-venue-0';
  const OTHER_KEY = 'content-key-direct-to-venue-1';

  it('the SAME order launched 5 min ago blocks a non-exit — even after it executed — and confirming lets it through', async () => {
    const H = hashOf(0x1a1);
    order({ contentKey: KEY, action: 'direct-to', launchedXrplTxHash: H, launchedAt: new Date(NOW - 5 * 60_000).toISOString() });
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    launchCouncilOrderRelay(H);
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'executed');

    const recent = await recentSameCouncilOrder(COUNCIL, KEY, { now: NOW });
    expect(recent).toMatchObject({ xrplTxHash: H, state: 'executed' });

    const refused = await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: false, now: NOW });
    expect(refused).toMatchObject({ proceed: false, status: 409, body: { error: 'SAME_ORDER_RECENTLY_LAUNCHED', xrplTxHash: H } });

    const confirmed = await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: false, confirmAnotherOrder: true, now: NOW });
    expect(confirmed).toMatchObject({ proceed: true, duplicateWarning: null });
  });

  it('a DIFFERENT order (another venue, another action) passes: sequences of orders are not duplicates', async () => {
    order({ contentKey: KEY, action: 'direct-to', launchedXrplTxHash: hashOf(0x1a2), launchedAt: new Date(NOW - 60_000).toISOString() });
    expect(await recentSameCouncilOrder(COUNCIL, OTHER_KEY, { now: NOW })).toBeNull();
    expect(await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: OTHER_KEY, isExit: false, now: NOW })).toMatchObject({ proceed: true });
  });

  it('an EXIT is never refused: it goes out with the warning', async () => {
    order({ contentKey: KEY, action: 'recall', launchedXrplTxHash: hashOf(0x1a3), launchedAt: new Date(NOW - 60_000).toISOString() });
    const verdict = await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: true, now: NOW });
    expect(verdict.proceed).toBe(true);
    expect(String((verdict as { duplicateWarning: string }).duplicateWarning)).toContain(hashOf(0x1a3));
  });

  it('an order the sweep already FORGOT still counts: its fate keeps the content key', async () => {
    const o = order({ contentKey: KEY, action: 'direct-to' });
    const H = hashOf(0x1a4);
    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([payment(o.memoHex, H)])) });
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'executed');
    await sweepComposedCouncilOrders({ now: NOW, rpc: jest.fn().mockResolvedValue(page([payment(o.memoHex, H)])) });
    expect(composed(o.memoHex)).toBeUndefined();
    expect(fateRow(o.memoHex)).toMatchObject({ state: 'executed', contentKey: KEY });

    expect(await recentSameCouncilOrder(COUNCIL, KEY, { now: NOW })).toMatchObject({ xrplTxHash: H, state: 'executed' });
  });

  it('older than 30 min, never launched, or an unreadable store → no verdict at all', async () => {
    order({ contentKey: KEY, launchedXrplTxHash: hashOf(0x1a5), launchedAt: new Date(NOW - 45 * 60_000).toISOString() });
    expect(await recentSameCouncilOrder(COUNCIL, KEY, { now: NOW })).toBeNull();
    order({ contentKey: OTHER_KEY });
    expect(await recentSameCouncilOrder(COUNCIL, OTHER_KEY, { now: NOW })).toBeNull();
    failReads = true;
    expect(await recentSameCouncilOrder(COUNCIL, KEY, { now: NOW })).toBeNull();
  });
});

/**
 * productizer it. 17 (finding 2.3) — THE COMPOSE DOOR WAS BLIND FOR FIVE MINUTES.
 *
 * `launchedXrplTxHash` is stamped by the background sweep, which runs every five
 * minutes; inside that window the store half of the guard says «nothing like this
 * went out» about an order that is already on the XRP Ledger. That window is exactly
 * when a family re-composes after a stalled QR. The door now asks the LEDGER about
 * the records the sweep has not marked, through the fate read's own cache and
 * budget.
 */
describe('the duplicate guard also asks the LEDGER (it. 17, finding 2.3)', () => {
  const KEY = 'content-key-direct-to-venue-0';
  const infoAndTx = (info: Record<string, unknown>, tx: Record<string, unknown>) =>
    jest.fn().mockImplementation(async (method: string) => (method === 'account_info' ? info : tx));
  beforeEach(() => _resetCouncilOrderFateLimiter());

  it('validated 1 min ago and not swept yet: 409 for a non-exit, a warning for an exit', async () => {
    const o = order({ contentKey: KEY, action: 'direct-to', composedAt: new Date(NOW - 60_000).toISOString() });
    const H = hashOf(0x2b1);
    mockXrplJsonRpc.mockImplementation(
      infoAndTx({ validated: true, ledger_index: 1_090, account_data: { Sequence: 42 } }, page([payment(o.memoHex, H)], 1_100)),
    );
    // The store half sees nothing: the sweep has stamped no launch on this record.
    expect(await recentSameCouncilOrder(COUNCIL, KEY, { now: NOW })).toBeNull();

    const refused = await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: false, now: NOW, sessionKey: 's1' });
    expect(refused).toMatchObject({ proceed: false, status: 409, body: { error: 'SAME_ORDER_RECENTLY_LAUNCHED', xrplTxHash: H } });

    const exit = await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: true, now: NOW, sessionKey: 's1' });
    expect(exit.proceed).toBe(true);
    expect(String((exit as { duplicateWarning: string }).duplicateWarning)).toContain(H);
  });

  it('an order still only COMPOSED is not a duplicate: nothing went out', async () => {
    const o = order({ contentKey: KEY, action: 'direct-to', composedAt: new Date(NOW - 60_000).toISOString() });
    void o;
    mockXrplJsonRpc.mockImplementation(
      infoAndTx({ validated: true, ledger_index: 1_090, account_data: { Sequence: 42 } }, page([], 1_100)),
    );
    expect(await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: false, now: NOW, sessionKey: 's2' })).toMatchObject({
      proceed: true,
      duplicateWarning: null,
    });
  });

  /**
   * it. 19 (finding 2.5) — «NO PUDE COMPROBARLO» NO ES «COMPROBADO». it. 17 let a
   * non-exit through on a check that never ran, with a sentence nobody had to
   * acknowledge — on the exact scenario the guard exists for (a re-composition
   * minutes after a stalled QR, with the fate budget already spent by the screen's
   * own polling). Now: an EXIT proceeds warned, a person may confirm, and anything
   * else is refused with a readable 409 that names its own escape.
   */
  it('a ledger it could not read REFUSES a non-exit (and offers confirmAnotherOrder); an exit proceeds warned', async () => {
    order({ contentKey: KEY, action: 'direct-to', composedAt: new Date(NOW - 60_000).toISOString() });
    mockXrplJsonRpc.mockRejectedValue(new Error('xrpl_endpoint_stale'));

    const entry = await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: false, now: NOW, sessionKey: 's3' });
    expect(entry).toMatchObject({
      proceed: false,
      status: 409,
      body: { error: 'DUPLICATE_CHECK_UNREADABLE', retryable: true, confirmAnotherOrder: true },
    });
    expect(String((entry as { body: { detail: string } }).body.detail)).toContain('could not be run');
    // Nothing is presented as checked, and nothing is presented as a duplicate.
    expect(String((entry as { body: { detail: string } }).body.detail)).not.toContain('already signed THIS SAME order');

    const exit = await councilDuplicateOrderVerdict({ council: COUNCIL, contentKey: KEY, isExit: true, now: NOW, sessionKey: 's4' });
    expect(exit.proceed).toBe(true);
    expect(String((exit as { duplicateWarning: string }).duplicateWarning)).toContain('DUPLICATE_CHECK_UNREADABLE');

    // A person who says «yes, compose it anyway» is not stopped either — warned.
    const confirmed = await councilDuplicateOrderVerdict({
      council: COUNCIL,
      contentKey: KEY,
      isExit: false,
      confirmAnotherOrder: true,
      now: NOW,
      sessionKey: 's5',
    });
    expect(confirmed.proceed).toBe(true);
    expect(String((confirmed as { duplicateWarning: string }).duplicateWarning)).toContain('DUPLICATE_CHECK_UNREADABLE');
  });

  /**
   * it. 19 (finding 2.5, second half) — THE COMPOSE READS HAVE THEIR OWN ALLOWANCE.
   * The routes hand this check the key the screen's `GET /council-order/fate` polling
   * spends; the check prefixes it, so a page that exhausted the fate budget cannot
   * blind the duplicate guard of a compose.
   */
  /**
   * productizer it. 21 (finding 2.7) — THE REFUSAL HAD NO READER AND NO CLOCK.
   *
   * `DUPLICATE_CHECK_UNREADABLE` was invented by it. 19 and no screen ever read it,
   * so «the manager auto-blocks for about a minute with no button» was the whole
   * user experience. The commonest cause is OUR OWN read allowance, which knows
   * exactly how many seconds are left — and that number was being thrown away inside
   * the message string. The refusal now carries it, beside the two real exits it
   * already named (`retryable` and `confirmAnotherOrder`).
   */
  it('carries retryAfterSeconds when the reason is our own read allowance', async () => {
    order({ contentKey: KEY, action: 'direct-to', composedAt: new Date(NOW - 60_000).toISOString() });
    const rateLimited = Object.assign(new Error('Too many fate checks from this session'), {
      retryAfterSeconds: 37,
    });
    const read = jest.fn(async () => {
      throw rateLimited;
    }) as never;

    const entry = await councilDuplicateOrderVerdict({
      council: COUNCIL,
      contentKey: KEY,
      isExit: false,
      now: NOW,
      sessionKey: 's-rl',
      ledgerCheck: (council: string, contentKey: string, opts?: Record<string, unknown>) =>
        ledgerDuplicateCheck(council, contentKey, { ...(opts ?? {}), read }),
    });

    expect(entry).toMatchObject({
      proceed: false,
      status: 409,
      body: { error: 'DUPLICATE_CHECK_UNREADABLE', retryable: true, confirmAnotherOrder: true, retryAfterSeconds: 37 },
    });
    expect(String((entry as { body: { detail: string } }).body.detail)).toContain('37s');
  });

  it('never invents a schedule: a store that simply threw carries no retryAfterSeconds', async () => {
    order({ contentKey: KEY, action: 'direct-to', composedAt: new Date(NOW - 60_000).toISOString() });
    mockXrplJsonRpc.mockRejectedValue(new Error('xrpl_endpoint_stale'));

    const entry = await councilDuplicateOrderVerdict({
      council: COUNCIL,
      contentKey: KEY,
      isExit: false,
      now: NOW,
      sessionKey: 's-nors',
    });

    expect((entry as { body: Record<string, unknown> }).body.retryAfterSeconds).toBeUndefined();
    // …and the two affordances a screen needs are still there.
    expect((entry as { body: Record<string, unknown> }).body).toMatchObject({
      retryable: true,
      confirmAnotherOrder: true,
    });
  });

  it('spends a budget of its own: the key it reads with is not the caller’s fate key', async () => {
    const o = order({ contentKey: KEY, action: 'direct-to', composedAt: new Date(NOW - 60_000).toISOString() });
    const read = jest.fn(async () => ({ state: 'composed' }) as never);
    await ledgerDuplicateCheck(COUNCIL, KEY, { now: NOW, sessionKey: 'session-9', read });
    expect(read).toHaveBeenCalledWith(o.memoHex, 'compose:session-9');
  });

  /** it. 17 (copy): the sentence has to describe what a SECOND order would do. */
  it('the warning does not promise a double movement for an order that moves no capital, nor over a failed delivery', async () => {
    const H = hashOf(0x2b2);
    order({ contentKey: KEY, action: 'set-user-gate', launchedXrplTxHash: H, launchedAt: new Date(NOW - 60_000).toISOString() });

    const gate = await councilDuplicateOrderVerdict({
      council: COUNCIL,
      contentKey: KEY,
      isExit: false,
      action: 'set-user-gate',
      now: NOW,
      ledgerCheck: null,
    });
    expect((gate as { body: { detail: string } }).body.detail).toContain('moves no capital');
    expect((gate as { body: { detail: string } }).body.detail).not.toContain('a second time');

    // …and a delivery sitting in `error` is a RECOVERY, not a double payment.
    relayCouncilOrder.mockRejectedValue(new Error('FDC round not finalised'));
    launchCouncilOrderRelay(H, '0x01');
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'error');
    const failed = await councilDuplicateOrderVerdict({
      council: COUNCIL,
      contentKey: KEY,
      isExit: false,
      action: 'direct-to',
      now: NOW,
      ledgerCheck: null,
    });
    expect((failed as { body: { detail: string; state: string } }).body.state).toBe('error');
    expect((failed as { body: { detail: string } }).body.detail).toContain('relay that one by its hash');
    expect((failed as { body: { detail: string } }).body.detail).not.toContain('a second time');
  });
});

describe('the fate read is bounded (it. 15, finding 2.5)', () => {
  beforeEach(() => _resetCouncilOrderFateLimiter());

  it('one chain read per memo per 15s: the second asker gets the cached answer', async () => {
    const read = jest.fn(async () => ({ memo: 'M', state: 'composed' }) as never);
    const first = await readCouncilOrderFateLimited('AB'.repeat(32), 's1', { read, now: NOW });
    const second = await readCouncilOrderFateLimited('ab'.repeat(32), 's2', { read, now: NOW + 5_000 });
    expect(second).toEqual(first);
    expect(read).toHaveBeenCalledTimes(1);
    // past the cache window the ledger is read again
    await readCouncilOrderFateLimited('AB'.repeat(32), 's1', { read, now: NOW + 20_000 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a session past its budget is 429 with a retry — never a wrong verdict', async () => {
    const read = jest.fn(async (memo: string) => ({ memo, state: 'composed' }) as never);
    for (let i = 0; i < FATE_READS_PER_SESSION_PER_MIN; i++) {
      await readCouncilOrderFateLimited(i.toString(16).padStart(64, '0'), 's1', { read, now: NOW + i });
    }
    const err = await readCouncilOrderFateLimited('FF'.repeat(32), 's1', { read, now: NOW + 100 }).catch((e) => e);
    expect(err).toBeInstanceOf(CouncilOrderFateRateLimitedError);
    expect(err.code).toBe('COUNCIL_ORDER_FATE_RATE_LIMITED');
    expect(err.retryAfterSeconds).toBeGreaterThan(0);
    // another session is unaffected, and a minute later so is this one
    await expect(readCouncilOrderFateLimited('FF'.repeat(32), 's2', { read, now: NOW + 100 })).resolves.toBeDefined();
    await expect(readCouncilOrderFateLimited('EE'.repeat(32), 's1', { read, now: NOW + 61_000 })).resolves.toBeDefined();
  });

  it('«could not read» is still an error (briefly cached), never an «unknown»', async () => {
    const read = jest.fn(async () => {
      throw new CouncilOrderFateUnreadableError('ledger down');
    });
    await expect(readCouncilOrderFateLimited('CC'.repeat(32), 's1', { read, now: NOW })).rejects.toBeInstanceOf(CouncilOrderFateUnreadableError);
    await expect(readCouncilOrderFateLimited('CC'.repeat(32), 's1', { read, now: NOW + 1_000 })).rejects.toBeInstanceOf(CouncilOrderFateUnreadableError);
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('councilOrderInFlight — the guard against the double order', () => {
  it('a launch less than 30 min ago not seen executed is in flight; older or executed is not', async () => {
    const H = hashOf(0xf1);
    order({ launchedXrplTxHash: H, launchedAt: new Date(NOW - 10 * 60_000).toISOString() });
    expect(await councilOrderInFlight(COUNCIL, { now: NOW })).toMatchObject({ xrplTxHash: H });
    expect(await councilOrderInFlight(COUNCIL, { now: NOW + 25 * 60_000 })).toBeNull();

    relayCouncilOrder.mockResolvedValue({ stage: 'executed' });
    launchCouncilOrderRelay(H);
    await waitFor(() => getCouncilOrderRelayState(H)?.state === 'executed');
    expect(await councilOrderInFlight(COUNCIL, { now: NOW })).toBeNull();
  });

  it('an unreadable store is no answer (null), never a refusal by itself', async () => {
    order({ launchedXrplTxHash: hashOf(0xf2), launchedAt: new Date(NOW - 60_000).toISOString() });
    failReads = true;
    expect(await councilOrderInFlight(COUNCIL, { now: NOW })).toBeNull();
  });
});

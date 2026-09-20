import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  type LiveRequestsDeps,
  __resetLiveRequests,
  __setLiveRequestsDeps,
  checkLiveRequest,
  deliversToFlareAutomatically,
  dismissLiveNotice,
  dismissLiveRequest,
  handOffLiveRequest,
  isCouncilOrderTx,
  isFlareInstructionTx,
  listLiveNotices,
  listLiveRequests,
  noteCouncilOrderDelivery,
  noteFlareInstructionDelivery,
  pushLiveNotice,
  subscribeLiveNotices,
  type XamanPayloadStatusRead,
} from '../liveRequests';
import type { CouncilOrderFateReadLike } from '../../xrpl/singleSignVerdict';

/**
 * productizer it.13 — the banner promises only what the server took on, a stale
 * council order asks the order's fate first, and a refused seat release is seen.
 */

const MEMO = 'ab'.repeat(32);
const HASH = 'A'.repeat(64);
const SIBLING = 'B'.repeat(64);
const orderTx = (memo = MEMO) => ({ TransactionType: 'Payment', Account: 'rCouncil', Memos: [{ Memo: { MemoData: memo } }] });
const ORDER_REQ = { uuid: 'o-1', title: 'Recall from venue #0', txKey: JSON.stringify(orderTx()) };

let clock = 1_000_000;
let statusQueue: XamanPayloadStatusRead[] = [];
let fetchFate: Mock<LiveRequestsDeps['fetchFate']>;
let settleFate: (r: CouncilOrderFateReadLike) => void;

beforeEach(() => {
  __resetLiveRequests();
  clock = 1_000_000;
  statusQueue = [];
  settleFate = () => {};
  fetchFate = vi.fn<LiveRequestsDeps['fetchFate']>(() => new Promise((r) => { settleFate = r; }));
  __setLiveRequestsDeps({
    fetchStatus: vi.fn(async () => statusQueue.shift() ?? {}),
    cancel: vi.fn(async () => ({ action: 'close' as const })),
    awaitValidation: vi.fn<LiveRequestsDeps['awaitValidation']>(() => new Promise(() => {})),
    fetchFate,
    now: () => clock,
    setInterval: () => 0 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => {},
  });
});

afterEach(() => {
  __resetLiveRequests();
});

const only = () => {
  const list = listLiveRequests();
  expect(list).toHaveLength(1);
  return list[0];
};

describe('noteCouncilOrderDelivery → deliversToFlareAutomatically (R5 1.3 / R2 3.2)', () => {
  const key = JSON.stringify(orderTx());

  it('recorded AND executor running: the relay watcher delivers it — the banner may say so', () => {
    noteCouncilOrderDelivery(orderTx(), { recorded: true, executorEnabled: true });
    expect(deliversToFlareAutomatically(key)).toBe(true);
  });

  it.each([
    ['recorded, executor stopped', { recorded: true, executorEnabled: false }],
    ['executor running, not recorded', { recorded: false, executorEnabled: true }],
    ['no serverDelivery (older backend)', undefined],
  ])('%s: NOT delivered by the server', (_n, sd) => {
    noteCouncilOrderDelivery(orderTx(), sd as never);
    expect(deliversToFlareAutomatically(key)).toBe(false);
  });

  it('never registered (the syntax alone): not delivered', () => {
    expect(deliversToFlareAutomatically(key)).toBe(false);
    expect(isCouncilOrderTx(key)).toBe(true);
  });

  it('the memo is matched case-insensitively and the latest word wins', () => {
    noteCouncilOrderDelivery(orderTx(MEMO.toUpperCase()), { recorded: true, executorEnabled: true });
    expect(deliversToFlareAutomatically(key)).toBe(true);
    noteCouncilOrderDelivery(orderTx(), { recorded: false, executorEnabled: true });
    expect(deliversToFlareAutomatically(key)).toBe(false);
  });

  it('a 0xFE instruction needs the same word (it.14, R2 2.6): the syntax alone promises nothing', () => {
    const instruction = JSON.stringify(orderTx('FE' + '01'.repeat(40)));
    // THE REGRESSION: this used to be `true` from the transaction's shape alone,
    // so with the executor STOPPED the banner promised a delivery nobody made.
    expect(deliversToFlareAutomatically(instruction)).toBe(false);
    expect(isFlareInstructionTx(instruction)).toBe(true);
    expect(isCouncilOrderTx(instruction)).toBe(false);

    noteFlareInstructionDelivery(orderTx('FE' + '01'.repeat(40)), { executorEnabled: false });
    expect(deliversToFlareAutomatically(instruction)).toBe(false);
    noteFlareInstructionDelivery(orderTx('FE' + '01'.repeat(40)), { executorEnabled: true });
    expect(deliversToFlareAutomatically(instruction)).toBe(true);

    noteCouncilOrderDelivery({ TransactionType: 'TrustSet' }, { recorded: true, executorEnabled: true });
    expect(deliversToFlareAutomatically(JSON.stringify({ TransactionType: 'TrustSet' }))).toBe(false);
    expect(isFlareInstructionTx(JSON.stringify({ TransactionType: 'TrustSet' }))).toBe(false);
  });

  it('the executor word is per instruction, bounded, and forgotten by a reset', () => {
    const first = 'FE' + '0a'.repeat(40);
    noteFlareInstructionDelivery(orderTx(first), { executorEnabled: true });
    expect(deliversToFlareAutomatically(JSON.stringify(orderTx(first)))).toBe(true);
    for (let i = 0; i < 200; i++) {
      noteFlareInstructionDelivery(orderTx('FE' + i.toString(16).padStart(80, '0')), { executorEnabled: true });
    }
    expect(deliversToFlareAutomatically(JSON.stringify(orderTx(first)))).toBe(false);
  });

  it('the memory is bounded: the oldest word is forgotten (→ not delivered), never a false promise', () => {
    const first = 'cd'.repeat(32);
    noteCouncilOrderDelivery(orderTx(first), { recorded: true, executorEnabled: true });
    for (let i = 0; i < 200; i++) {
      noteCouncilOrderDelivery(orderTx(i.toString(16).padStart(64, '0')), { recorded: true, executorEnabled: true });
    }
    expect(deliversToFlareAutomatically(JSON.stringify(orderTx(first)))).toBe(false);
  });
});

describe('a STALE council order in the banner reads the order fate first (R2 3.1)', () => {
  async function staleOrder() {
    handOffLiveRequest(ORDER_REQ);
    statusQueue.push({ signed: true, txid: HASH, dispatched: 'tefPAST_SEQ' });
    await checkLiveRequest('o-1');
  }

  it('stale → failed/stale, fate «checking», and the fate is asked with the order memo', async () => {
    await staleOrder();
    expect(only()).toMatchObject({ state: 'failed', failure: 'stale', code: 'tefPAST_SEQ', fate: { kind: 'checking' } });
    expect(fetchFate).toHaveBeenCalledWith(MEMO.toUpperCase());
  });

  it('validated by a sibling → «already out», with its hash — no «prepare it again»', async () => {
    await staleOrder();
    settleFate({ ok: true, fate: { state: 'relaying', xrplTxHash: SIBLING } });
    await vi.waitFor(() => expect(only().fate).toEqual({ kind: 'already-out', txHash: SIBLING }));
  });

  it('composed / unknown → «prepare it again»', async () => {
    await staleOrder();
    settleFate({ ok: true, fate: { state: 'composed' } });
    await vi.waitFor(() => expect(only().fate).toEqual({ kind: 'prepare-again' }));
  });

  it('503 → «could not check»', async () => {
    await staleOrder();
    settleFate({ ok: false });
    await vi.waitFor(() => expect(only().fate).toEqual({ kind: 'unchecked' }));
  });

  it('a fate read that throws → «could not check», never a silent re-prepare', async () => {
    fetchFate.mockRejectedValueOnce(new Error('offline'));
    await staleOrder();
    await vi.waitFor(() => expect(only().fate).toEqual({ kind: 'unchecked' }));
  });

  it('a fate that lands after the notice was dismissed touches nothing', async () => {
    await staleOrder();
    dismissLiveRequest('o-1');
    settleFate({ ok: true, fate: { state: 'executed' } });
    await Promise.resolve();
    expect(listLiveRequests()).toEqual([]);
  });

  it('a stale payload that is not a council order asks nothing and carries no fate', async () => {
    handOffLiveRequest({ uuid: 'p-1', title: 'Trust line', txKey: JSON.stringify({ TransactionType: 'TrustSet' }) });
    statusQueue.push({ signed: true, txid: HASH, dispatched: 'tefMAX_LEDGER' });
    await checkLiveRequest('p-1');
    expect(only()).toMatchObject({ state: 'failed', failure: 'stale' });
    expect(only().fate).toBeUndefined();
    expect(fetchFate).not.toHaveBeenCalled();
  });
});

describe('notices — a refused 0xFE seat release reaches the banner (R5 1.2)', () => {
  it('push → listed with its words, dismiss → gone; subscribers hear both', () => {
    const cb = vi.fn();
    subscribeLiveNotices(cb);
    const empty = listLiveNotices();
    const n = pushLiveNotice({ kind: 'seat-release-refused', detail: 'NOT_THE_HANDOFF_OWNER — prove it', memoHex: 'FE01', freesInMinutes: 5 });
    expect(listLiveNotices()).toEqual([{ ...n, createdAt: clock }]);
    expect(listLiveNotices()).not.toBe(empty);
    expect(listLiveNotices()).toBe(listLiveNotices());
    dismissLiveNotice(n.id);
    expect(listLiveNotices()).toEqual([]);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('the same memo replaces its previous notice instead of stacking', () => {
    pushLiveNotice({ kind: 'seat-release-refused', detail: 'first', memoHex: 'FE01' });
    pushLiveNotice({ kind: 'seat-release-refused', detail: 'second', memoHex: 'FE01' });
    pushLiveNotice({ kind: 'seat-release-refused', detail: 'other', memoHex: 'FE02' });
    expect(listLiveNotices().map((x) => x.detail)).toEqual(['second', 'other']);
  });

  it('a reset forgets notices and delivery words', () => {
    pushLiveNotice({ kind: 'seat-release-refused', detail: 'x' });
    noteCouncilOrderDelivery(orderTx(), { recorded: true, executorEnabled: true });
    __resetLiveRequests();
    expect(listLiveNotices()).toEqual([]);
    expect(deliversToFlareAutomatically(JSON.stringify(orderTx()))).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  type LiveRequestsDeps,
  LIVE_POLL_MS,
  LIVE_VALIDATION_TIMEOUT_MS,
  LIVE_WATCH_CAP_MS,
  __resetLiveRequests,
  __setLiveRequestsDeps,
  bannerRequests,
  cancelLiveRequest,
  checkLiveRequest,
  confirmLiveRequest,
  createBlockTally,
  deliversToFlareAutomatically,
  dismissLiveRequest,
  fetchXamanStatus,
  followLiveValidation,
  handOffLiveRequest,
  hasOpenLiveRequests,
  leaveAction,
  listLiveRequests,
  noteUnfollowedSignature,
  parseXamanStatusBody,
  payloadWatchVerdict,
  registerLiveRequest,
  resolveLiveRequest,
  subscribeLiveRequests,
  type XamanPayloadStatusRead,
} from '../liveRequests';
import { cancelPayloadAndDecide } from '../payloadBus';

/**
 * productizer-it7 — a Xaman request outlives the component that showed it.
 *
 * `XamanSingleSign` used to fire a blind DELETE on unmount; an ALREADY_OPENED
 * answer (open on the phone, still signable) was read by nobody. These cover the
 * registry that replaces it: register → hand-off on an undecided unmount (NO
 * cancel) → watched until Xaman decides → signed is FOLLOWED on the ledger
 * (it.11) until its validated result is read — never «done» on Xaman's word.
 */

const REQ = { uuid: 'u-1', title: 'Open the pote — the root signs', txKey: '{"TransactionType":"Payment"}' };
const HASH = 'A'.repeat(64);

type Validation = { validated: boolean; finalResult?: string; timedOut?: boolean };

let clock = 1_000_000;
let intervals: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
let statusQueue: XamanPayloadStatusRead[] = [];
let fetchStatus: Mock<LiveRequestsDeps['fetchStatus']>;
let cancel: Mock<LiveRequestsDeps['cancel']>;
let awaitValidation: Mock<LiveRequestsDeps['awaitValidation']>;
/** Resolve the pending ledger read (awaitValidation) with a result. */
let settleLedger: (v: Validation) => void;

beforeEach(() => {
  __resetLiveRequests();
  clock = 1_000_000;
  intervals = [];
  statusQueue = [];
  settleLedger = () => {};
  fetchStatus = vi.fn<LiveRequestsDeps['fetchStatus']>(async () => statusQueue.shift() ?? {});
  cancel = vi.fn<LiveRequestsDeps['cancel']>(async () => ({ action: 'close' }));
  awaitValidation = vi.fn<LiveRequestsDeps['awaitValidation']>(
    () => new Promise<Validation>((r) => { settleLedger = r; }),
  );
  __setLiveRequestsDeps({
    fetchStatus,
    cancel,
    awaitValidation,
    now: () => clock,
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms, cleared: false });
      return (intervals.length - 1) as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: (t) => {
      const i = t as unknown as number;
      if (intervals[i]) intervals[i].cleared = true;
    },
  });
});

afterEach(() => {
  __resetLiveRequests();
  vi.unstubAllGlobals();
});

const only = () => {
  const list = listLiveRequests();
  expect(list).toHaveLength(1);
  return list[0];
};

describe('leaveAction — what an unmount does with its payload', () => {
  it('a payload that exists and nobody decided is handed off, never cancelled', () => {
    expect(leaveAction({ uuid: 'u-1', decided: false })).toBe('hand-off');
  });
  it('a decided payload belongs to its verdict', () => {
    expect(leaveAction({ uuid: 'u-1', decided: true })).toBe('none');
  });
  it('a signed payload whose ledger result is still being read is handed off (it.11)', () => {
    expect(leaveAction({ uuid: 'u-1', decided: true, confirming: true })).toBe('hand-off');
  });
  it('no payload yet: nothing to hand off', () => {
    for (const uuid of [undefined, null, '']) expect(leaveAction({ uuid, decided: false, confirming: true })).toBe('none');
  });
});

describe('payloadWatchVerdict / parseXamanStatusBody — the status read, moved out of the component', () => {
  it('reads meta + response and invents nothing', () => {
    expect(
      parseXamanStatusBody({ meta: { signed: true, resolved: true }, response: { txid: 'ABC', dispatched_result: 'tesSUCCESS' } }),
    ).toEqual({ signed: true, cancelled: undefined, expired: undefined, resolved: true, txid: 'ABC', dispatched: 'tesSUCCESS' });
    expect(parseXamanStatusBody(null)).toEqual({});
    expect(parseXamanStatusBody({ meta: { signed: 'yes' }, response: { txid: '' } })).toEqual({});
  });

  it('keeps the component order: signed, cancelled, expired, declined, else pending', () => {
    expect(payloadWatchVerdict({ signed: true, expired: true })).toBe('signed');
    expect(payloadWatchVerdict({ cancelled: true, expired: true })).toBe('cancelled');
    expect(payloadWatchVerdict({ expired: true })).toBe('expired');
    expect(payloadWatchVerdict({ resolved: true, signed: false })).toBe('declined');
    // resolved without an explicit signed:false is NOT a decline
    expect(payloadWatchVerdict({ resolved: true })).toBe('pending');
    expect(payloadWatchVerdict({})).toBe('pending');
  });

  it('an unreadable status is no verdict at all', async () => {
    const notOk = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response);
    expect(await fetchXamanStatus('u-1', notOk as unknown as typeof fetch)).toEqual({});
    const throws = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchXamanStatus('u-1', throws as unknown as typeof fetch)).toEqual({});
  });
});

describe('deliversToFlareAutomatically — which banners may say «Astryum delivers it»', () => {
  const pay = (memo?: string, type = 'Payment') =>
    JSON.stringify({ TransactionType: type, Account: 'rA', ...(memo !== undefined ? { Memos: [{ Memo: { MemoData: memo } }] } : {}) });

  /**
   * CHANGED ON PURPOSE (it.13, R5 1.3 / R2 3.2). The syntax alone promised a
   * delivery the server may not have taken on. A council order is delivered by
   * the relay watcher only when its prepare said recorded + executor running —
   * covered in liveRequests.delivery.test.ts.
   */
  it('a council order (Payment + 32-byte memo commitment) is NOT promised on syntax alone', () => {
    expect(deliversToFlareAutomatically(pay('ab'.repeat(32)))).toBe(false);
  });
  /**
   * CHANGED ON PURPOSE (it.14, R2 2.6). A 0xFE was promised on its syntax too —
   * «the handoff is persisted and the executor sweeps the Core Vault» — so with
   * the executor STOPPED the banner announced a delivery nobody was going to
   * make. It now needs the same word as an order (noteFlareInstructionDelivery),
   * covered in liveRequests.delivery.test.ts.
   */
  it('a 0xFE Smart Account instruction is NOT promised on syntax alone either', () => {
    expect(deliversToFlareAutomatically(pay('FE' + '01'.repeat(40)))).toBe(false);
  });
  it('anything else keeps «do NOT sign it again»', () => {
    expect(deliversToFlareAutomatically(pay())).toBe(false);
    expect(deliversToFlareAutomatically(pay('AB12'))).toBe(false);
    expect(deliversToFlareAutomatically(pay('ab'.repeat(32), 'CredentialAccept'))).toBe(false);
    expect(deliversToFlareAutomatically('not json')).toBe(false);
  });
});

describe('registry — register → unmount hand-off → resolution', () => {
  it('a registered payload is open (beforeunload) but not in the banner: its component shows it', () => {
    registerLiveRequest(REQ);
    expect(only()).toMatchObject({ uuid: 'u-1', state: 'owned', createdAt: clock, cancelUi: 'idle' });
    expect(hasOpenLiveRequests()).toBe(true);
    expect(bannerRequests(listLiveRequests())).toEqual([]);
    expect(intervals).toHaveLength(0);
  });

  it('the owner resolving it (a decided verdict) removes it', () => {
    registerLiveRequest(REQ);
    resolveLiveRequest('u-1');
    expect(listLiveRequests()).toEqual([]);
    expect(hasOpenLiveRequests()).toBe(false);
  });

  it('hand-off: watched, polled, in the banner — and NO cancel was fired', () => {
    registerLiveRequest(REQ);
    handOffLiveRequest(REQ);
    expect(only()).toMatchObject({ state: 'watched', title: REQ.title });
    expect(bannerRequests(listLiveRequests())).toHaveLength(1);
    expect(hasOpenLiveRequests()).toBe(true);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].ms).toBe(LIVE_POLL_MS);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('watched → signed with a hash: it STAYS, open and in the banner, while the ledger is read', async () => {
    registerLiveRequest(REQ);
    handOffLiveRequest(REQ);
    statusQueue.push({}, { signed: true, resolved: true, txid: HASH, dispatched: 'tesSUCCESS' });
    await checkLiveRequest('u-1');
    expect(only().state).toBe('watched');
    await checkLiveRequest('u-1');
    expect(only()).toMatchObject({ state: 'validating', txid: HASH });
    expect(hasOpenLiveRequests()).toBe(true);
    expect(bannerRequests(listLiveRequests())).toHaveLength(1);
    expect(intervals[0].cleared).toBe(true);
    expect(awaitValidation).toHaveBeenCalledWith(HASH, { timeoutMs: LIVE_VALIDATION_TIMEOUT_MS });
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each([
    ['validated tesSUCCESS → validated', { validated: true, finalResult: 'tesSUCCESS' }, { state: 'validated' }],
    ['validated tec → failed on-chain', { validated: true, finalResult: 'tecNO_PERMISSION' }, { state: 'failed', failure: 'onchain', code: 'tecNO_PERMISSION' }],
    ['not validated in time → «signed — check the result»', { validated: false, timedOut: true }, { state: 'signed' }],
  ] as Array<[string, Validation, Record<string, unknown>]>)('the ledger read: %s — a notice, no longer open', async (_n, ledger, expected) => {
    handOffLiveRequest(REQ);
    statusQueue.push({ signed: true, txid: HASH });
    await checkLiveRequest('u-1');
    settleLedger(ledger);
    await vi.waitFor(() => expect(only()).toMatchObject({ ...expected, txid: HASH }));
    expect(hasOpenLiveRequests()).toBe(false);
    expect(bannerRequests(listLiveRequests())).toHaveLength(1);
    dismissLiveRequest('u-1');
    expect(listLiveRequests()).toEqual([]);
  });

  it.each([
    ['tefPAST_SEQ', 'stale'],
    ['tefMAX_LEDGER', 'stale'],
    ['temBAD_AMOUNT', 'refused'],
  ])('watched → signed but dispatched %s: failed (%s) without reading the ledger', async (code, failure) => {
    handOffLiveRequest(REQ);
    statusQueue.push({ signed: true, txid: HASH, dispatched: code });
    await checkLiveRequest('u-1');
    expect(only()).toMatchObject({ state: 'failed', failure, code });
    expect(awaitValidation).not.toHaveBeenCalled();
    expect(hasOpenLiveRequests()).toBe(false);
  });

  it('the poll tick is the same read', async () => {
    handOffLiveRequest(REQ);
    statusQueue.push({ signed: true, txid: HASH });
    intervals[0].fn();
    await vi.waitFor(() => expect(only().state).toBe('validating'));
  });

  it.each([
    ['expired', { expired: true }],
    ['cancelled', { cancelled: true }],
    ['declined', { resolved: true, signed: false }],
  ] as Array<[string, XamanPayloadStatusRead]>)('watched → %s: nothing signed, it leaves the list', async (_n, st) => {
    handOffLiveRequest(REQ);
    statusQueue.push(st);
    await checkLiveRequest('u-1');
    expect(listLiveRequests()).toEqual([]);
    expect(intervals[0].cleared).toBe(true);
  });

  it('a payload that arrives after its component left is handed off with its own title', () => {
    handOffLiveRequest({ uuid: 'late', title: 'Late one', txKey: 'k' });
    expect(only()).toMatchObject({ uuid: 'late', title: 'Late one', state: 'watched' });
  });

  it('no verdict past the cap → «could not read», poll stopped, no longer open', async () => {
    handOffLiveRequest(REQ);
    clock += LIVE_WATCH_CAP_MS + 1;
    await checkLiveRequest('u-1');
    expect(only().state).toBe('unread');
    expect(hasOpenLiveRequests()).toBe(false);
    expect(intervals[0].cleared).toBe(true);
  });

  it('a late resolve from the owner never erases a request the registry is reading', async () => {
    handOffLiveRequest(REQ);
    statusQueue.push({ signed: true, txid: HASH });
    await checkLiveRequest('u-1');
    resolveLiveRequest('u-1');
    registerLiveRequest(REQ); // and a re-register never demotes it either
    noteUnfollowedSignature({ ...REQ, txid: 'OTHER' }); // nor an unfollowed-signature note
    expect(only()).toMatchObject({ state: 'validating', txid: HASH });
  });

  it('dismiss only takes notices, never a watched or validating request', async () => {
    handOffLiveRequest(REQ);
    dismissLiveRequest('u-1');
    expect(only().state).toBe('watched');
    statusQueue.push({ signed: true });
    await checkLiveRequest('u-1');
    expect(only().state).toBe('signed'); // no hash: nothing to follow
    dismissLiveRequest('u-1');
    expect(listLiveRequests()).toEqual([]);
  });

  it('an unmount while a SIGNED outcome was unread is reported «signed — check the result»', () => {
    noteUnfollowedSignature({ ...REQ, txid: 'HASH3' });
    expect(only()).toMatchObject({ state: 'signed', txid: 'HASH3' });
    expect(hasOpenLiveRequests()).toBe(false);
  });

  it('notifies subscribers and keeps the snapshot identity until something changes', () => {
    const cb = vi.fn();
    const off = subscribeLiveRequests(cb);
    const empty = listLiveRequests();
    expect(listLiveRequests()).toBe(empty);
    registerLiveRequest(REQ);
    expect(cb).toHaveBeenCalledTimes(1);
    const one = listLiveRequests();
    expect(one).not.toBe(empty);
    expect(listLiveRequests()).toBe(one);
    off();
    resolveLiveRequest('u-1');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("the 'confirming' phase — signed, the component reading the ledger (it.11)", () => {
  it('is open (beforeunload guards it) but not in the banner: the component shows it', () => {
    registerLiveRequest(REQ);
    confirmLiveRequest({ ...REQ, txid: HASH });
    expect(only()).toMatchObject({ state: 'confirming', txid: HASH });
    expect(hasOpenLiveRequests()).toBe(true);
    expect(bannerRequests(listLiveRequests())).toEqual([]);
  });

  it('the component reading the result resolves it', () => {
    registerLiveRequest(REQ);
    confirmLiveRequest({ ...REQ, txid: HASH });
    resolveLiveRequest('u-1');
    expect(listLiveRequests()).toEqual([]);
  });

  it('unmounting while confirming hands it off: the registry reads the ledger and the banner shows it', async () => {
    registerLiveRequest(REQ);
    confirmLiveRequest({ ...REQ, txid: HASH });
    handOffLiveRequest(REQ);
    expect(only()).toMatchObject({ state: 'validating', txid: HASH });
    expect(bannerRequests(listLiveRequests())).toHaveLength(1);
    expect(hasOpenLiveRequests()).toBe(true);
    expect(intervals).toHaveLength(0); // no Xaman status poll: it is signed
    settleLedger({ validated: true, finalResult: 'tesSUCCESS' });
    await vi.waitFor(() => expect(only().state).toBe('validated'));
  });

  it('a follow already in flight is joined, never duplicated', async () => {
    registerLiveRequest(REQ);
    confirmLiveRequest({ ...REQ, txid: HASH });
    handOffLiveRequest(REQ);
    void followLiveValidation('u-1');
    expect(awaitValidation).toHaveBeenCalledTimes(1);
  });

  it('a ledger read that throws is «could not confirm», never success', async () => {
    awaitValidation.mockRejectedValueOnce(new Error('offline'));
    registerLiveRequest(REQ);
    confirmLiveRequest({ ...REQ, txid: HASH });
    handOffLiveRequest(REQ);
    await vi.waitFor(() => expect(only()).toMatchObject({ state: 'signed', txid: HASH }));
  });

  it('a result that lands after the entry was reset touches nothing', async () => {
    registerLiveRequest(REQ);
    confirmLiveRequest({ ...REQ, txid: HASH });
    handOffLiveRequest(REQ);
    const settle = settleLedger;
    __resetLiveRequests();
    settle({ validated: true, finalResult: 'tesSUCCESS' });
    await Promise.resolve();
    expect(listLiveRequests()).toEqual([]);
  });
});

describe('cancelLiveRequest — «Cancel it here» obeys what Xaman answered', () => {
  it('confirmed kill → gone', async () => {
    handOffLiveRequest(REQ);
    await cancelLiveRequest('u-1');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(listLiveRequests()).toEqual([]);
  });

  it('refused / no answer → stays watched, with the warning', async () => {
    handOffLiveRequest(REQ);
    cancel.mockResolvedValueOnce({ action: 'warn-alive' });
    await cancelLiveRequest('u-1');
    expect(only()).toMatchObject({ state: 'watched', cancelUi: 'alive' });
    cancel.mockResolvedValueOnce({ action: 'warn-unknown' });
    await cancelLiveRequest('u-1');
    expect(only()).toMatchObject({ state: 'watched', cancelUi: 'unknown' });
    expect(intervals[0].cleared).toBe(false);
  });

  it('ALREADY_RESOLVED → follow it: read the status now', async () => {
    handOffLiveRequest(REQ);
    cancel.mockResolvedValueOnce({ action: 'warn-resolved' });
    statusQueue.push({ signed: true, txid: HASH });
    await cancelLiveRequest('u-1');
    await vi.waitFor(() => expect(only()).toMatchObject({ state: 'validating', txid: HASH }));
  });

  it('a double press never fires a second DELETE', async () => {
    handOffLiveRequest(REQ);
    let release!: () => void;
    cancel.mockImplementationOnce(() => new Promise((r) => { release = () => r({ action: 'close' }); }));
    const first = cancelLiveRequest('u-1');
    expect(only().cancelUi).toBe('cancelling');
    await cancelLiveRequest('u-1');
    expect(cancel).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(listLiveRequests()).toEqual([]);
  });

  it('a poll that decided during the round trip owns the entry', async () => {
    handOffLiveRequest(REQ);
    let release!: () => void;
    cancel.mockImplementationOnce(() => new Promise((r) => { release = () => r({ action: 'warn-alive' }); }));
    const pending = cancelLiveRequest('u-1');
    statusQueue.push({ signed: true, txid: HASH });
    await checkLiveRequest('u-1');
    release();
    await pending;
    expect(only()).toMatchObject({ state: 'validating', txid: HASH, cancelUi: 'idle' });
  });

  it('only a watched request can be cancelled from here (an owned one has its own button)', async () => {
    registerLiveRequest(REQ);
    await cancelLiveRequest('u-1');
    expect(cancel).not.toHaveBeenCalled();
  });

  describe('through the real payloadBus round trip (ALREADY_* handling unchanged)', () => {
    const answer = (body: unknown) =>
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response));

    beforeEach(() => {
      __setLiveRequestsDeps({ cancel: (uuid, onScreen) => cancelPayloadAndDecide(uuid, onScreen) });
    });

    it('ALREADY_OPENED is still signable: the request stays, warned «alive»', async () => {
      answer({ result: { cancelled: false, reason: 'ALREADY_OPENED' } });
      handOffLiveRequest(REQ);
      await cancelLiveRequest('u-1');
      expect(only()).toMatchObject({ state: 'watched', cancelUi: 'alive' });
    });

    it('ALREADY_EXPIRED: nothing left — gone', async () => {
      answer({ result: { cancelled: false, reason: 'ALREADY_EXPIRED' } });
      handOffLiveRequest(REQ);
      await cancelLiveRequest('u-1');
      expect(listLiveRequests()).toEqual([]);
    });

    it('cancelled: true — gone', async () => {
      answer({ result: { cancelled: true } });
      handOffLiveRequest(REQ);
      await cancelLiveRequest('u-1');
      expect(listLiveRequests()).toEqual([]);
    });

    it('an unreachable proxy is «unknown», never «dead»', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }) as unknown as Response));
      handOffLiveRequest(REQ);
      await cancelLiveRequest('u-1');
      expect(only()).toMatchObject({ state: 'watched', cancelUi: 'unknown' });
    });
  });
});

describe('createBlockTally — an ancestor locks while ANY signing child blocks', () => {
  it('reports only the transitions of «any blocks»', () => {
    const onChange = vi.fn();
    const tally = createBlockTally(onChange);
    const a = Symbol('a');
    const b = Symbol('b');
    tally.report(a, false);
    expect(onChange).not.toHaveBeenCalled();
    tally.report(a, true);
    tally.report(b, true);
    tally.report(a, true);
    expect(onChange.mock.calls).toEqual([[true]]);
    tally.report(a, false);
    expect(tally.blocked).toBe(true);
    tally.report(b, false);
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(tally.blocked).toBe(false);
  });
});

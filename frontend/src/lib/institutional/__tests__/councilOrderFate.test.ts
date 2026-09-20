import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNCIL_ORDER_IN_FLIGHT,
  SAME_ORDER_RECENTLY_LAUNCHED,
  isCouncilOrderInFlight,
  parseCouncilOrderFateBody,
  prepareCageOrder,
  preparePoteCouncilOrder,
  preparePoteExit,
  readCouncilOrderFate,
  sameOrderMinutesAgo,
} from '../api';
import { __resetLiveRequests, deliversToFlareAutomatically } from '../../xaman/liveRequests';

/**
 * The council-order contracts the consoles code against:
 * the fate read (after a stale verdict), the in-flight 409, and the delivery
 * word registered at prepare time for the banner.
 */

const MEMO = 'EF'.repeat(32);
const HASH = 'E'.repeat(64);
const xrplTx = { TransactionType: 'Payment', Account: 'rCouncil', Memos: [{ Memo: { MemoData: MEMO } }] };
const respond = (status: number, body: unknown) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);

beforeEach(() => __resetLiveRequests());
afterEach(() => {
  __resetLiveRequests();
  vi.unstubAllGlobals();
});

describe('readCouncilOrderFate', () => {
  it('reads the fate of the memo it asked for', async () => {
    const f = respond(200, { memo: MEMO, state: 'executed', xrplTxHash: HASH });
    expect(await readCouncilOrderFate(MEMO, f as unknown as typeof fetch)).toEqual({
      ok: true,
      fate: { memo: MEMO, state: 'executed', xrplTxHash: HASH },
    });
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toMatch(new RegExp(`/institutional/council-order/fate\\?memo=${MEMO}$`));
  });

  it('503 (and any non-OK, a throw, a state outside the vocabulary) is «could not read», never «unknown»', async () => {
    expect(await readCouncilOrderFate(MEMO, respond(503, { error: 'X' }) as unknown as typeof fetch)).toEqual({ ok: false, status: 503 });
    expect(await readCouncilOrderFate(MEMO, respond(404, {}) as unknown as typeof fetch)).toEqual({ ok: false, status: 404 });
    const throws = vi.fn(async () => { throw new Error('offline'); });
    expect(await readCouncilOrderFate(MEMO, throws as unknown as typeof fetch)).toEqual({ ok: false, status: 0 });
    expect(parseCouncilOrderFateBody(MEMO, { state: 'maybe' })).toEqual({ ok: false, status: 0 });
    expect(parseCouncilOrderFateBody(MEMO, { state: 'unknown' })).toEqual({ ok: true, fate: { memo: MEMO, state: 'unknown' } });
  });
});

describe('prepare clients register what the server took on (the banner reads it)', () => {
  it.each([
    ['cage-order', () => prepareCageOrder({ council: 'rCouncil', action: 'recall', params: {} })],
    ['pote-council-order', () => preparePoteCouncilOrder({ council: 'rCouncil', action: 'recall', venueId: 0, amount: '1' })],
  ])('%s: recorded + executor → delivered; absent → not', async (_n, call) => {
    const key = JSON.stringify(xrplTx);
    vi.stubGlobal('fetch', respond(200, { account: 'rCouncil', xrplTx, order: {}, disclosure: {}, serverDelivery: { recorded: true, executorEnabled: true } }));
    const ok = await call();
    expect(ok.ok).toBe(true);
    expect(deliversToFlareAutomatically(key)).toBe(true);

    vi.stubGlobal('fetch', respond(200, { account: 'rCouncil', xrplTx, order: {}, disclosure: {}, recoveryWarning: 'ORDER_RECOVERY_UNRECORDED: …' }));
    const warned = await call();
    expect(warned.ok && warned.data.recoveryWarning).toContain('ORDER_RECOVERY_UNRECORDED');
    expect(deliversToFlareAutomatically(key)).toBe(false);
  });

  it('A composed 0xFE registers the EXECUTOR word — absent, the banner stays prudent (R2 2.6)', async () => {
    const instruction = { TransactionType: 'Payment', Account: 'rOwner', Memos: [{ Memo: { MemoData: `FE${'0c'.repeat(40)}` } }] };
    const key = JSON.stringify(instruction);
    vi.stubGlobal('fetch', respond(200, { account: 'rOwner', xrplPayment: instruction, disclosure: {} }));
    await preparePoteExit({ account: 'rOwner', pote: '0xpote' });
    expect(deliversToFlareAutomatically(key)).toBe(false);

    vi.stubGlobal('fetch', respond(200, { account: 'rOwner', xrplPayment: instruction, disclosure: {}, serverDelivery: { executorEnabled: true } }));
    await preparePoteExit({ account: 'rOwner', pote: '0xpote' });
    expect(deliversToFlareAutomatically(key)).toBe(true);
  });

  it('409 SAME_ORDER_RECENTLY_LAUNCHED is the name of the confirmable refusal — both are read', async () => {
    for (const error of [SAME_ORDER_RECENTLY_LAUNCHED, COUNCIL_ORDER_IN_FLIGHT]) {
      vi.stubGlobal('fetch', respond(409, { error, detail: 'the same recall went out', minutesAgo: 4 }));
      const r = await prepareCageOrder({ council: 'rCouncil', action: 'recall', params: {} });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(isCouncilOrderInFlight(r.refusal)).toBe(true);
        expect(sameOrderMinutesAgo(r.refusal)).toBe(4);
      }
    }
  });

  it('the refusal carries what the seat and the exit doors need, and never invents it', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'NONCE_SEAT_TAKEN', retryable: false, secondsLeft: 90 }));
    const seat = await prepareCageOrder({ council: 'rCouncil', action: 'recall', params: {} });
    expect(seat.ok).toBe(false);
    if (!seat.ok) {
      expect(seat.refusal.retryable).toBe(false);
      expect(seat.refusal.secondsLeft).toBe(90);
      expect(seat.refusal.minutesAgo).toBeUndefined();
    }
    vi.stubGlobal('fetch', respond(503, { error: 'EXIT_CLASSIFICATION_UNREADABLE', exitClassification: 'unreadable' }));
    const exit = await prepareCageOrder({ council: 'rCouncil', action: 'recall', params: {} });
    expect(exit.ok).toBe(false);
    if (!exit.ok) expect(exit.refusal.exitClassification).toBe('unreadable');
  });

  it('sameOrderMinutesAgo: counted, derived from the instant, or «recently» — never a made-up number', () => {
    const now = Date.UTC(2026, 8, 14, 12, 0, 0);
    expect(sameOrderMinutesAgo({ minutesAgo: 0 }, now)).toBe(0);
    expect(sameOrderMinutesAgo({ launchedAt: new Date(now - 7 * 60_000).toISOString() }, now)).toBe(7);
    expect(sameOrderMinutesAgo({}, now)).toBeNull();
    expect(sameOrderMinutesAgo({ launchedAt: 'not a date' }, now)).toBeNull();
    // A clock skew that puts the launch in the future is not «minus three minutes».
    expect(sameOrderMinutesAgo({ launchedAt: new Date(now + 60_000).toISOString() }, now)).toBeNull();
    expect(sameOrderMinutesAgo(null, now)).toBeNull();
  });

  it('409 COUNCIL_ORDER_IN_FLIGHT is a refusal the console confirms; the confirm travels in the body', async () => {
    const f = respond(409, { error: COUNCIL_ORDER_IN_FLIGHT, detail: 'order 0xabc is relaying' });
    vi.stubGlobal('fetch', f);
    const r = await prepareCageOrder({ council: 'rCouncil', action: 'direct-to', params: {}, confirmAnotherOrder: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(isCouncilOrderInFlight(r.refusal)).toBe(true);
      expect(r.refusal.detail).toBe('order 0xabc is relaying');
    }
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).confirmAnotherOrder).toBe(true);
    expect(isCouncilOrderInFlight({ status: 409, error: 'NO_CAGE' })).toBe(false);
    expect(isCouncilOrderInFlight(null)).toBe(false);
  });
});

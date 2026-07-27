import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  savePending,
  XRPL_MINT_SETTLE_CEILING_MS,
  PENDING_MAX_AGE_MS,
  type SettlementState,
} from '../settlement';
import { POLL_MS, type TrackerDeps } from '../tracker';
import { resumeAllPending } from '../resume';

/* Seeded-localStorage harness (same stub shape as settlement.test.ts) + the
 * injected-timer harness of tracker.test.ts: each test seeds pendings, mounts
 * the resume, and drives the poll by hand. */

const store: Record<string, string> = {};
const ls = {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  key: (i: number) => Object.keys(store)[i] ?? null,
  get length() {
    return Object.keys(store).length;
  },
};

const PENDING_PREFIX = 'astryum:settlement-pending:';
const NOW = 1_000_000_000;

function makeHarness(over: Partial<TrackerDeps> = {}) {
  const timers: Array<() => void> = [];
  const clock = { now: NOW };
  const updates: Array<{ ref: string; state: SettlementState }> = [];
  const deps: TrackerDeps = {
    getCallsStatus: async () => ({ status: 'PENDING' }),
    getTxReceipt: async () => null,
    getMintStatus: async () => false,
    getXrplTxValidated: async () => false,
    getCouncilOrderExecuted: async () => false,
    now: () => clock.now,
    setTimer: (fn) => {
      timers.push(fn as () => void);
      return fn;
    },
    clearTimer: (t) => {
      const i = timers.indexOf(t as () => void);
      if (i >= 0) timers.splice(i, 1);
    },
    ...over,
  };
  const drain = () => new Promise<void>((r) => setImmediate(r));
  const tick = async (ms = 0) => {
    clock.now += ms;
    const fn = timers.shift();
    fn?.();
    await drain();
  };
  const resume = () => resumeAllPending(deps, (ref, state) => updates.push({ ref, state }), clock.now);
  return { deps, timers, clock, updates, resume, tick, drain };
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.stubGlobal('window', { localStorage: ls });
});

describe('resumeAllPending — mount-resume from storage', () => {
  it('resumes the FRESH pending, prunes the expired and deletes the malformed', async () => {
    savePending({ rail: 'xrpl-mint', ref: 'F'.repeat(64), startedAt: NOW - 60_000 });
    savePending({ rail: 'evm-5792', ref: '0xdead', startedAt: NOW - PENDING_MAX_AGE_MS - 1 }); // expired
    store[PENDING_PREFIX + 'broken'] = '{not-json'; // malformed

    const h = makeHarness();
    h.resume();
    await h.drain();

    const refs = [...new Set(h.updates.map((u) => u.ref))];
    expect(refs).toEqual(['F'.repeat(64)]); // only the fresh one resumed
    expect(store[PENDING_PREFIX + '0xdead']).toBeUndefined(); // dead ref not resurrected
    expect(store[PENDING_PREFIX + 'broken']).toBeUndefined();
    expect(h.updates[0].state.status).toBe('pending'); // resumed as PENDING, never a green
  });

  it('a CORRUPT rail is pruned, never resumed — it would hot-loop setTimeout(fn, undefined) (escaneo #8)', async () => {
    store[PENDING_PREFIX + 'evil'] = JSON.stringify({ rail: 'not-a-rail', ref: 'evil', startedAt: NOW - 1000 });
    const h = makeHarness();
    h.resume();
    await h.drain();
    expect(h.updates).toEqual([]); // nothing resumed
    expect(h.timers.length).toBe(0); // and NOTHING scheduled — no hot loop possible
    expect(store[PENDING_PREFIX + 'evil']).toBeUndefined(); // pruned from storage
  });

  it('preserves the ORIGINAL startedAt: a mint older than its ceiling shows stalled at once', async () => {
    // Signed 1s past the XRPL ceiling — if resume restarted the clock, the
    // first poll would stay silent 'pending' for another 6 minutes.
    savePending({ rail: 'xrpl-mint', ref: 'A'.repeat(64), startedAt: NOW - XRPL_MINT_SETTLE_CEILING_MS - 1_000 });
    const h = makeHarness();
    h.resume();
    await h.drain();
    const last = h.updates[h.updates.length - 1];
    expect(last.state.status).toBe('stalled');
    expect(h.timers.length).toBe(1); // and it keeps polling (§3)
  });

  it('a resumed op still settles on real confirmation and clears its pending', async () => {
    savePending({ rail: 'xrpl-mint', ref: 'B'.repeat(64), startedAt: NOW - 30_000 });
    let executed = false;
    const h = makeHarness({ getMintStatus: async () => executed });
    h.resume();
    await h.drain();

    executed = true;
    await h.tick(POLL_MS['xrpl-mint']);
    const last = h.updates[h.updates.length - 1];
    expect(last.state.status).toBe('settled');
    expect(store[PENDING_PREFIX + 'B'.repeat(64)]).toBeUndefined(); // tracker cleared it
  });

  it('two tabs resuming the same ref is idempotent (poll is a read; clear is idempotent)', async () => {
    savePending({ rail: 'xrpl-mint', ref: 'C'.repeat(64), startedAt: NOW - 30_000 });
    const h = makeHarness({ getMintStatus: async () => true });
    h.resume(); // tab 1
    h.resume(); // tab 2 — same storage
    await h.drain();
    const settled = h.updates.filter((u) => u.state.status === 'settled');
    expect(settled.length).toBe(2); // both tabs reach the same truth, no throw
    expect(store[PENDING_PREFIX + 'C'.repeat(64)]).toBeUndefined();
  });

  it('cancel stops every resumed poll', async () => {
    savePending({ rail: 'xrpl-mint', ref: 'D'.repeat(64), startedAt: NOW - 30_000 });
    savePending({ rail: 'evm', ref: '0xeeee', startedAt: NOW - 30_000 });
    const h = makeHarness();
    const cancel = h.resume();
    await h.drain();
    cancel();
    expect(h.timers.length).toBe(0);
  });

  it('nothing in storage ⇒ resumes nothing and schedules nothing', async () => {
    const h = makeHarness();
    h.resume();
    await h.drain();
    expect(h.updates).toEqual([]);
    expect(h.timers.length).toBe(0);
  });
});

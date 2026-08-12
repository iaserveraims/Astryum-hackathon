import { describe, it, expect } from 'vitest';
import {
  startPending,
  toSettled,
  EVM_SETTLE_CEILING_MS,
  XRPL_MINT_SETTLE_CEILING_MS,
  type SettlementState,
} from '../settlement';
import { trackSettlement, UNSUPPORTED_5792_PROBES, POLL_MS, type TrackerDeps } from '../tracker';

/**
 * Deterministic harness: timers and the clock are injected, so each test drives
 * the poll loop by hand (advance = fire the next scheduled tick and drain the
 * async step). No fake global timers, no real waiting.
 */
function makeHarness(over: Partial<TrackerDeps> = {}) {
  const timers: Array<() => void> = [];
  const clock = { now: 0 };
  const updates: SettlementState[] = [];
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
  /** Advance the clock and fire the next scheduled poll tick. */
  const tick = async (ms = 0) => {
    clock.now += ms;
    const fn = timers.shift();
    fn?.();
    await drain();
  };
  const track = (initial: SettlementState) =>
    trackSettlement(initial, deps, { onUpdate: (s) => updates.push(s) });
  return { deps, timers, clock, updates, track, tick, drain };
}

const last = (h: { updates: SettlementState[] }) => h.updates[h.updates.length - 1];

describe('tracker — handles that arrive already final', () => {
  it('an already-settled handle emits once and never schedules a poll', async () => {
    const h = makeHarness();
    h.track(toSettled(startPending('evm', '0xabc')));
    await h.drain();
    expect(h.updates.map((u) => u.status)).toEqual(['settled']);
    expect(h.timers.length).toBe(0);
  });
});

describe('tracker — evm rail (receipt is the truth)', () => {
  it('stays pending while the receipt is unavailable, settles on a success receipt', async () => {
    let receipt: { status: unknown } | null = null;
    const h = makeHarness({ getTxReceipt: async () => receipt });
    h.track(startPending('evm', '0xaaa'));
    await h.drain();
    expect(last(h).status).toBe('pending');

    await h.tick(POLL_MS.evm); // still no receipt
    expect(last(h).status).toBe('pending');

    receipt = { status: 'success' };
    await h.tick(POLL_MS.evm);
    expect(last(h).status).toBe('settled');
    expect(h.timers.length).toBe(0); // final — polling stopped
  });

  it('a reverted receipt is a FAILED state with a reason, never a green', async () => {
    const h = makeHarness({ getTxReceipt: async () => ({ status: 'reverted' }) });
    h.track(startPending('evm', '0xbbb'));
    await h.drain();
    expect(last(h).status).toBe('failed');
    expect(last(h).reason).toBeTruthy();
  });
});

describe('tracker — evm-5792 rail (§1.1/§1.2)', () => {
  it('polls while not CONFIRMED; settles ONLY on CONFIRMED + all receipts success, upgrading the ref to the real tx hash', async () => {
    let result: { status: unknown; receipts?: Array<{ status: unknown; transactionHash?: string }> } = {
      status: 'PENDING',
    };
    const h = makeHarness({ getCallsStatus: async () => result });
    h.track(startPending('evm-5792', 'bundle-1'));
    await h.drain();
    expect(last(h).status).toBe('pending');

    result = { status: 'CONFIRMED', receipts: [{ status: 'success', transactionHash: '0xdeadbeef' }] };
    await h.tick(POLL_MS['evm-5792']);
    expect(last(h).status).toBe('settled');
    expect(last(h).ref).toBe('0xdeadbeef'); // bundle id upgraded to the linkable hash
    expect(last(h).explorerUrl).toContain('0xdeadbeef');
  });

  it('CONFIRMED with a reverted call inside the batch is FAILED (a bundle green is not enough)', async () => {
    const h = makeHarness({
      getCallsStatus: async () => ({
        status: 'CONFIRMED',
        receipts: [{ status: 'success' }, { status: 'reverted' }],
      }),
    });
    h.track(startPending('evm-5792', 'bundle-2'));
    await h.drain();
    expect(last(h).status).toBe('failed');
    // Reasons travel as codes (settlementReasonText renders the sentence).
    expect(last(h).reason).toBe('BATCH_CALL_REVERTED:2');
  });

  it('a wallet without getCallsStatus goes to an honest STALLED after N probes — and a late confirm still settles (§3)', async () => {
    let broken = true;
    const h = makeHarness({
      getCallsStatus: async () => {
        if (broken) throw new Error('method not found');
        return { status: 'CONFIRMED', receipts: [{ status: 'success' }] };
      },
    });
    h.track(startPending('evm-5792', 'bundle-3'));
    await h.drain();
    for (let i = 1; i < UNSUPPORTED_5792_PROBES; i++) await h.tick(POLL_MS['evm-5792']);
    expect(last(h).status).toBe('stalled');
    expect(h.timers.length).toBe(1); // stalled does NOT stop the poll

    broken = false;
    await h.tick(POLL_MS['evm-5792']);
    expect(last(h).status).toBe('settled');
  });
});

describe('tracker — xrpl-mint rail (mint-status is the truth)', () => {
  it('executed=false and a failed read both stay pending; executed=true settles', async () => {
    let executed: boolean | null = false;
    const h = makeHarness({ getMintStatus: async () => executed });
    h.track(startPending('xrpl-mint', 'A'.repeat(64)));
    await h.drain();
    expect(last(h).status).toBe('pending');

    executed = null; // red caída ≠ pendiente — no state change
    await h.tick(POLL_MS['xrpl-mint']);
    expect(last(h).status).toBe('pending');

    executed = true;
    await h.tick(POLL_MS['xrpl-mint']);
    expect(last(h).status).toBe('settled');
  });

  it('past the XRPL ceiling it shows STALLED but keeps polling until the executor lands it', async () => {
    let executed = false;
    const h = makeHarness({ getMintStatus: async () => executed });
    h.track(startPending('xrpl-mint', 'B'.repeat(64)));
    await h.drain();

    await h.tick(XRPL_MINT_SETTLE_CEILING_MS);
    expect(last(h).status).toBe('stalled');
    expect(h.timers.length).toBe(1);

    executed = true;
    await h.tick(POLL_MS['xrpl-mint']);
    expect(last(h).status).toBe('settled');
  });
});

describe('tracker — xrpl-tx rail (ledger validation is the truth)', () => {
  it('not-yet-validated (txnNotFound → false) stays pending; validated ⇒ settled', async () => {
    let validated: boolean | null = false;
    const h = makeHarness({ getXrplTxValidated: async () => validated });
    h.track(startPending('xrpl-tx', 'E'.repeat(64)));
    await h.drain();
    expect(last(h).status).toBe('pending');

    validated = null; // read failed — red caída ≠ pendiente
    await h.tick(POLL_MS['xrpl-tx']);
    expect(last(h).status).toBe('pending');

    validated = true;
    await h.tick(POLL_MS['xrpl-tx']);
    expect(last(h).status).toBe('settled');
    expect(h.timers.length).toBe(0);
  });
});

describe('tracker — council-order rail (LegacyBridge.consumedTxId is the truth)', () => {
  it('pending through the FDC round, settles on executed — success NEVER from the preliminary broadcast', async () => {
    let executed = false;
    const h = makeHarness({ getCouncilOrderExecuted: async () => executed });
    h.track(startPending('council-order', 'F'.repeat(64)));
    await h.drain();
    expect(last(h).status).toBe('pending');

    executed = true;
    await h.tick(POLL_MS['council-order']);
    expect(last(h).status).toBe('settled');
  });

  it('rides the XRPL (FDC) ceiling, not the 90s EVM one — no false stall on the NORMAL 2–5 min path', async () => {
    const h = makeHarness({ getCouncilOrderExecuted: async () => false });
    h.track(startPending('council-order', 'A1'.repeat(32)));
    await h.drain();
    await h.tick(EVM_SETTLE_CEILING_MS + 1_000); // past 90s — still normal for FDC
    expect(last(h).status).toBe('pending');
    await h.tick(XRPL_MINT_SETTLE_CEILING_MS);
    expect(last(h).status).toBe('stalled');
  });
});

describe('tracker — ceiling and lifecycle', () => {
  it('an evm pending past its ceiling stalls with the ref still carried', async () => {
    const h = makeHarness({ getTxReceipt: async () => null });
    h.track(startPending('evm', '0xccc'));
    await h.drain();
    await h.tick(EVM_SETTLE_CEILING_MS);
    expect(last(h).status).toBe('stalled');
    expect(last(h).ref).toBe('0xccc');
  });

  it('no duplicate consecutive emissions (stalled twice emits once)', async () => {
    const h = makeHarness({ getTxReceipt: async () => null });
    h.track(startPending('evm', '0xddd'));
    await h.drain();
    await h.tick(EVM_SETTLE_CEILING_MS);
    await h.tick(POLL_MS.evm);
    const stalls = h.updates.filter((u) => u.status === 'stalled');
    expect(stalls.length).toBe(1);
  });

  it('cancel stops the poll', async () => {
    const h = makeHarness();
    const cancel = h.track(startPending('evm', '0xeee'));
    await h.drain();
    cancel();
    expect(h.timers.length).toBe(0);
  });
});

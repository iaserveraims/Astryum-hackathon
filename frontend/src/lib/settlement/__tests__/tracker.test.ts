import { describe, it, expect } from 'vitest';
import {
  startPending,
  toFailed,
  toSettled,
  COMPOUND_FAILURE_TOPIC,
  EVM_SETTLE_CEILING_MS,
  XRPL_MINT_SETTLE_CEILING_MS,
  type SettlementState,
} from '../settlement';

/** The log kFXRP_ISO emits on a refused redeem: Failure(error=9 MATH_ERROR, info=45, detail=0). */
const KINETIC_FAILURE_LOG = {
  address: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3',
  topics: [COMPOUND_FAILURE_TOPIC],
  data:
    '0x' +
    '0000000000000000000000000000000000000000000000000000000000000009' +
    '000000000000000000000000000000000000000000000000000000000000002d' +
    '0000000000000000000000000000000000000000000000000000000000000000',
};
import { trackSettlement, UNSUPPORTED_5792_PROBES, POLL_MS, type TrackerDeps } from '../tracker';
import type { XrplTxVerdict } from '../../xrpl/txResult';

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
    getXrplTxVerdict: async () => ({ kind: 'pending' }) as const,
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
  it('an already-failed handle emits once and never schedules a poll', async () => {
    const h = makeHarness();
    h.track(toFailed(startPending('evm', '0xabc'), 'REVERTED'));
    await h.drain();
    expect(h.updates.map((u) => u.status)).toEqual(['failed']);
    expect(h.timers.length).toBe(0);
  });

  it('an already-settled handle on a NON-evm rail still passes through untouched', async () => {
    const h = makeHarness();
    h.track(toSettled(startPending('xrpl-tx', 'ABCD')));
    await h.drain();
    expect(h.updates.map((u) => u.status)).toEqual(['settled']);
    expect(h.timers.length).toBe(0);
  });

  // The single/sequential rails of sendIntentCalls settle the handle on
  // `receipt.status === 'success'` alone, and a Kinetic code produces exactly
  // that receipt (mined, no effect). A settled evm handle is therefore
  // re-verified: it re-enters as pending and the receipt poll, logs included,
  // gives the verdict.
  it('an already-settled EVM handle is re-verified for EFFECT: pending, then settled on a clean receipt', async () => {
    const h = makeHarness({ getTxReceipt: async () => ({ status: 'success', logs: [] }) });
    h.track(toSettled(startPending('evm', '0xabc')));
    await h.drain();
    expect(h.updates.map((u) => u.status)).toEqual(['pending', 'settled']);
    expect(h.timers.length).toBe(0); // one read on a mined tx — final, no poll left behind
  });

  it('an already-settled EVM handle whose receipt carries a Compound Failure ends FAILED, mined without effect — never settled', async () => {
    const h = makeHarness({ getTxReceipt: async () => ({ status: 'success', logs: [KINETIC_FAILURE_LOG] }) });
    h.track(toSettled(startPending('evm', '0xabc', undefined, 14)));
    await h.drain();
    expect(h.updates.map((u) => u.status)).toEqual(['pending', 'failed']);
    expect(last(h).reason).toBe('MINED_NO_EFFECT:COMPOUND:9:45:0');
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

  // Status 1 is not the whole test. Mainnet probe: kFXRP_ISO
  // `redeemUnderlying(1e12)` from an empty account mines with status 1 and a
  // `Failure(9 MATH_ERROR, 45, 0)` log; gas paid, nothing moved.
  it('a status-1 receipt WITH a Compound Failure log is FAILED with the code — mined without effect', async () => {
    const h = makeHarness({ getTxReceipt: async () => ({ status: 1, logs: [KINETIC_FAILURE_LOG] }) });
    h.track(startPending('evm', '0xccc', undefined, 14));
    await h.drain();
    expect(last(h).status).toBe('failed');
    expect(last(h).reason).toBe('MINED_NO_EFFECT:COMPOUND:9:45:0');
    expect(h.timers.length).toBe(0);
  });

  it('a status-1 receipt whose logs are ordinary (Transfer…) still settles', async () => {
    const h = makeHarness({
      getTxReceipt: async () => ({
        status: 1,
        logs: [{ address: '0xd1b7', topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'], data: '0x' + '0'.repeat(64) }],
      }),
    });
    h.track(startPending('evm', '0xddd', undefined, 14));
    await h.drain();
    expect(last(h).status).toBe('settled');
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

  // The 5792 receipts carry `logs`: a call mined without effect
  // inside a CONFIRMED bundle is a failure that names its step, so the
  // «earlier steps already went through» sentence applies (the approve did).
  it('CONFIRMED with every receipt status 1 but a Compound Failure in call 2 is FAILED, step named', async () => {
    const h = makeHarness({
      getCallsStatus: async () => ({
        status: 'CONFIRMED',
        receipts: [
          { status: 'success', transactionHash: '0x1111', logs: [] },
          { status: 'success', transactionHash: '0x2222', logs: [KINETIC_FAILURE_LOG] },
        ],
      }),
    });
    h.track(startPending('evm-5792', 'bundle-9'));
    await h.drain();
    expect(last(h).status).toBe('failed');
    expect(last(h).reason).toBe('MINED_NO_EFFECT:COMPOUND:9:45:0:STEP:2');
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
  it('not-yet-validated stays pending; validated+tesSUCCESS ⇒ settled', async () => {
    let verdict: XrplTxVerdict = { kind: 'pending' };
    const h = makeHarness({ getXrplTxVerdict: async () => verdict });
    h.track(startPending('xrpl-tx', 'E'.repeat(64)));
    await h.drain();
    expect(last(h).status).toBe('pending');

    verdict = { kind: 'unreadable' }; // read failed — red caída ≠ pendiente
    await h.tick(POLL_MS['xrpl-tx']);
    expect(last(h).status).toBe('pending');

    verdict = { kind: 'settled' };
    await h.tick(POLL_MS['xrpl-tx']);
    expect(last(h).status).toBe('settled');
    expect(h.timers.length).toBe(0);
  });

  // Un fallo TERMINAL tiene que parar el
  // reloj, no seguir vigilando un hash que nunca va a aparecer.
  it('un fallo terminal asienta como failed y DETIENE el poll', async () => {
    const h = makeHarness({
      getXrplTxVerdict: async () => ({ kind: 'failed', code: 'tefPAST_SEQ', onChain: false }),
    });
    h.track(startPending('xrpl-tx', 'F'.repeat(64)));
    await h.drain();
    expect(last(h).status).toBe('failed');
    expect(last(h).reason).toBe('tefPAST_SEQ');
    expect(h.timers.length).toBe(0);
  });

  // El verde no ganado: `validated === true` NO basta. Un tec* ocupa ledger,
  // cobra fee y no hace el pago — pintarlo verde es mentir sobre el dinero.
  it('un tec* validado es FALLO, jamás asentado', async () => {
    const h = makeHarness({
      getXrplTxVerdict: async () => ({ kind: 'failed', code: 'tecUNFUNDED_PAYMENT', onChain: true }),
    });
    h.track(startPending('xrpl-tx', 'A'.repeat(64)));
    await h.drain();
    expect(last(h).status).toBe('failed');
    expect(last(h).reason).toBe('tecUNFUNDED_PAYMENT');
  });

  // El contrapeso, que también es un bug cerrado: «no he podido leer» no puede
  // convertirse en fallo — ese error empujaba al DOBLE depósito.
  it('«ilegible» nunca se convierte en fallo, por mucho que se repita', async () => {
    const h = makeHarness({ getXrplTxVerdict: async () => ({ kind: 'unreadable' }) });
    h.track(startPending('xrpl-tx', 'B'.repeat(64)));
    await h.drain();
    for (let i = 0; i < 5; i++) await h.tick(POLL_MS['xrpl-tx']);
    expect(last(h).status).not.toBe('failed');
    expect(h.timers.length).toBeGreaterThan(0); // sigue vigilando
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

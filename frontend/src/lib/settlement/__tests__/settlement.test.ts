import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluate5792,
  isCallsConfirmed,
  isReceiptSuccess,
  isPastCeiling,
  ceilingForRail,
  EVM_SETTLE_CEILING_MS,
  XRPL_MINT_SETTLE_CEILING_MS,
  startPending,
  toSettled,
  toFailed,
  toStalled,
  savePending,
  clearPending,
  loadAllPending,
  PENDING_MAX_AGE_MS,
} from '../settlement';

describe('§1.1 — EIP-5792 evaluation (per-call, not just the bundle)', () => {
  it('keeps polling while the bundle is not CONFIRMED', () => {
    expect(evaluate5792({ status: 'PENDING' })).toEqual({ done: false, failed: false });
    expect(evaluate5792({ status: 100 })).toEqual({ done: false, failed: false });
    expect(evaluate5792({})).toEqual({ done: false, failed: false });
  });

  it('CONFIRMED + every receipt success ⇒ settled', () => {
    expect(evaluate5792({ status: 'CONFIRMED', receipts: [{ status: 'success' }, { status: '0x1' }] })).toEqual({
      done: true,
      failed: false,
    });
    expect(evaluate5792({ status: 200, receipts: [{ status: 1 }] }).failed).toBe(false);
  });

  it('CONFIRMED but a call REVERTED ⇒ failed, naming which call', () => {
    const v = evaluate5792({ status: 'CONFIRMED', receipts: [{ status: 'success' }, { status: 'reverted' }] });
    expect(v).toMatchObject({ done: true, failed: true });
    // Reasons travel as codes (settlementReasonText renders the sentence).
    expect(v.reason).toBe('BATCH_CALL_REVERTED:2');
  });

  it('normalises heterogeneous status/receipt encodings', () => {
    expect(isCallsConfirmed('confirmed')).toBe(true);
    expect(isCallsConfirmed(200)).toBe(true);
    expect(isCallsConfirmed('PENDING')).toBe(false);
    expect(isReceiptSuccess('success')).toBe(true);
    expect(isReceiptSuccess(1)).toBe(true);
    expect(isReceiptSuccess('0x1')).toBe(true);
    expect(isReceiptSuccess('reverted')).toBe(false);
    expect(isReceiptSuccess(0)).toBe(false);
  });
});

describe('§1 — wait ceiling is PER RAIL (XRPL ≫ EVM)', () => {
  it('XRPL ceiling is much larger than EVM (FDC round = minutes vs seconds)', () => {
    expect(ceilingForRail('evm-5792')).toBe(EVM_SETTLE_CEILING_MS);
    expect(ceilingForRail('evm')).toBe(EVM_SETTLE_CEILING_MS);
    expect(ceilingForRail('xrpl-mint')).toBe(XRPL_MINT_SETTLE_CEILING_MS);
    expect(XRPL_MINT_SETTLE_CEILING_MS).toBeGreaterThan(EVM_SETTLE_CEILING_MS);
  });
  it('a 2-min XRPL mint is NOT stalled (normal), but 2 min on EVM IS', () => {
    const twoMin = 2 * 60_000;
    expect(isPastCeiling('xrpl-mint', 0, twoMin)).toBe(false); // FDC round in flight — normal
    expect(isPastCeiling('evm-5792', 0, twoMin)).toBe(true); // 2 min on EVM = genuinely stalled
  });
});

describe('§2 — success is machine-only; ref always carried', () => {
  it('startPending is pending and keeps the ref/explorer', () => {
    const s = startPending('evm-5792', '0xbundle', 'https://ex/0xbundle');
    expect(s.status).toBe('pending');
    expect(s.ref).toBe('0xbundle');
    expect(s.explorerUrl).toBe('https://ex/0xbundle');
  });
  it('transitions preserve the ref (always shown/copyable) — incl. stalled→settled (§3)', () => {
    const p = startPending('xrpl-mint', 'ABCD');
    expect(toSettled(p)).toMatchObject({ status: 'settled', ref: 'ABCD' });
    expect(toFailed(p, 'reverted')).toMatchObject({ status: 'failed', ref: 'ABCD', reason: 'reverted' });
    const stalled = toStalled(p, 'timeout');
    expect(stalled).toMatchObject({ status: 'stalled', ref: 'ABCD' });
    // §3: stalled is a UI state, not the end — it can still transition to settled/failed.
    expect(toSettled(stalled).status).toBe('settled');
  });
});

describe('§2/§3 — pending persistence: per-ref + expiry', () => {
  const store: Record<string, string> = {};
  const ls = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal('window', { localStorage: ls });
  });

  it('keys PER ref — two ops (E1 then borrow) do not overwrite each other', () => {
    savePending({ rail: 'evm-5792', ref: '0xA', startedAt: 100 });
    savePending({ rail: 'xrpl-mint', ref: 'B', startedAt: 100 });
    expect(
      loadAllPending(200)
        .map((p) => p.ref)
        .sort(),
    ).toEqual(['0xA', 'B']);
  });

  it('clear removes ONLY that ref', () => {
    savePending({ rail: 'evm-5792', ref: '0xA', startedAt: 100 });
    savePending({ rail: 'xrpl-mint', ref: 'B', startedAt: 100 });
    clearPending('0xA');
    expect(loadAllPending(200).map((p) => p.ref)).toEqual(['B']);
  });

  it('PRUNES pendings past the max age — a dead ref is not resurrected', () => {
    savePending({ rail: 'xrpl-mint', ref: 'OLD', startedAt: 0 });
    savePending({ rail: 'evm-5792', ref: 'FRESH', startedAt: PENDING_MAX_AGE_MS });
    expect(loadAllPending(PENDING_MAX_AGE_MS + 1).map((p) => p.ref)).toEqual(['FRESH']);
    expect(store['astryum:settlement-pending:OLD']).toBeUndefined(); // pruned from storage
  });

  it('malformed entry ⇒ pruned, no throw', () => {
    store['astryum:settlement-pending:BAD'] = '{not json';
    expect(loadAllPending()).toEqual([]);
  });
});

// ── it. 34 — MINED WITHOUT EFFECT: the Compound `Failure` decoder ─────────────
import {
  COMPOUND_FAILURE_TOPIC,
  compoundFailureIn,
  isPartialBatchFailure,
  noEffectReason,
  parseNoEffect,
  receiptHasEffect,
} from '../settlement';

/** What kFXRP_ISO emits on a refused redeem (mainnet probe, it. 31): Failure(9, 45, 0). */
const FAILURE_9 = {
  address: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3',
  topics: [COMPOUND_FAILURE_TOPIC],
  data:
    '0x' +
    '0000000000000000000000000000000000000000000000000000000000000009' +
    '000000000000000000000000000000000000000000000000000000000000002d' +
    '0000000000000000000000000000000000000000000000000000000000000000',
};
const TRANSFER = {
  address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
  topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', '0x0', '0x0'],
  data: '0x' + '0'.repeat(63) + '1',
};

describe('it. 34 — a status-1 receipt with a Compound Failure is not a success', () => {
  it('decodes Failure(error, info, detail) from the log, by topic and 32-byte words', () => {
    expect(compoundFailureIn([TRANSFER, FAILURE_9])).toEqual({ error: 9, info: 45, detail: 0 });
    // Topic compared case-insensitively (wallets differ).
    expect(compoundFailureIn([{ ...FAILURE_9, topics: [COMPOUND_FAILURE_TOPIC.toUpperCase().replace('0X', '0x')] }])).toEqual({
      error: 9,
      info: 45,
      detail: 0,
    });
  });

  it('ordinary logs, empty logs, missing logs and a Failure with code 0 are NOT a failure', () => {
    expect(compoundFailureIn([TRANSFER])).toBeNull();
    expect(compoundFailureIn([])).toBeNull();
    expect(compoundFailureIn(undefined)).toBeNull();
    expect(compoundFailureIn(null)).toBeNull();
    expect(compoundFailureIn([{ ...FAILURE_9, data: '0x' + '0'.repeat(192) }])).toBeNull();
    // A log with the topic but unreadable data cannot invent a code either.
    expect(compoundFailureIn([{ ...FAILURE_9, data: '0xzz' }])).toBeNull();
    expect(compoundFailureIn([{ topics: [] }, { topics: undefined }])).toBeNull();
  });

  it('receiptHasEffect = status 1 AND no Failure', () => {
    expect(receiptHasEffect({ status: 1, logs: [TRANSFER] })).toBe(true);
    expect(receiptHasEffect({ status: 'success', logs: [] })).toBe(true);
    expect(receiptHasEffect({ status: 1 })).toBe(true);
    expect(receiptHasEffect({ status: 1, logs: [FAILURE_9] })).toBe(false);
    expect(receiptHasEffect({ status: 'reverted', logs: [] })).toBe(false);
  });

  it('the reason travels as a CODE and parses back, with the batch step when there is one', () => {
    expect(noEffectReason({ error: 9, info: 45, detail: 0 })).toBe('MINED_NO_EFFECT:COMPOUND:9:45:0');
    expect(noEffectReason({ error: 3, info: 7, detail: 4 }, 2)).toBe('MINED_NO_EFFECT:COMPOUND:3:7:4:STEP:2');
    expect(parseNoEffect('MINED_NO_EFFECT:COMPOUND:9:45:0')).toEqual({ failure: { error: 9, info: 45, detail: 0 }, step: null });
    expect(parseNoEffect('MINED_NO_EFFECT:COMPOUND:3:7:4:STEP:2')).toEqual({ failure: { error: 3, info: 7, detail: 4 }, step: 2 });
    expect(parseNoEffect('REVERTED')).toBeNull();
    expect(parseNoEffect(undefined)).toBeNull();
  });

  it('a no-effect call at step >1 is a PARTIAL batch (the approve before it went through)', () => {
    expect(isPartialBatchFailure('MINED_NO_EFFECT:COMPOUND:9:45:0:STEP:2')).toBe(true);
    expect(isPartialBatchFailure('MINED_NO_EFFECT:COMPOUND:9:45:0:STEP:1')).toBe(false);
    expect(isPartialBatchFailure('MINED_NO_EFFECT:COMPOUND:9:45:0')).toBe(false);
  });

  it('evaluate5792: CONFIRMED + all status 1 + a Failure in call 2 ⇒ failed, step named', () => {
    const v = evaluate5792({
      status: 'CONFIRMED',
      receipts: [
        { status: 'success', logs: [TRANSFER] },
        { status: 'success', logs: [FAILURE_9] },
      ],
    });
    expect(v).toEqual({ done: true, failed: true, reason: 'MINED_NO_EFFECT:COMPOUND:9:45:0:STEP:2' });
    // A reverted receipt still wins first (it is the older, louder failure).
    expect(
      evaluate5792({ status: 'CONFIRMED', receipts: [{ status: 'reverted' }, { status: 'success', logs: [FAILURE_9] }] }).reason,
    ).toBe('BATCH_CALL_REVERTED:1');
    // Clean receipts still settle.
    expect(evaluate5792({ status: 'CONFIRMED', receipts: [{ status: 'success', logs: [TRANSFER] }] })).toEqual({ done: true, failed: false });
  });
});

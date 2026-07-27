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
    expect(v.reason).toMatch(/llamada 2/);
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

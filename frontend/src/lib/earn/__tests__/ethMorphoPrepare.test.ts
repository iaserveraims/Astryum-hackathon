/**
 * Pure adapters of the eth-morpho modal wiring (B5-UI paso 4). Pinned: the
 * 6/18 unit asymmetry with comma input and no silent rounding, chainId per
 * call, and the honest pre-flight translation (partial green is said).
 */
import { describe, it, expect } from 'vitest';
import {
  toBaseUnits,
  baseToHuman,
  emCallsFromLegs,
  emPreflightInfo,
  type EmPrepareEnvelope,
} from '../ethMorphoPrepare';

describe('toBaseUnits — the F4 asymmetry, no silent rounding', () => {
  it('FXRP (6 dec): "12,5" → 12500000', () => {
    expect(toBaseUnits('12,5', 6)).toBe('12500000');
    expect(toBaseUnits('12.5', 6)).toBe('12500000');
  });

  it('RLUSD (18 dec): "0.000000000000000001" → 1', () => {
    expect(toBaseUnits('0.000000000000000001', 18)).toBe('1');
  });

  it('rejects more precision than the asset carries — never rounds money', () => {
    expect(() => toBaseUnits('1.0000001', 6)).toThrowError(/AMOUNT_TOO_PRECISE/);
  });

  it('rejects zero, empty and malformed', () => {
    expect(() => toBaseUnits('0', 6)).toThrowError(/AMOUNT_NOT_POSITIVE/);
    expect(() => toBaseUnits('', 6)).toThrowError(/AMOUNT_MALFORMED/);
    expect(() => toBaseUnits('1.2.3', 6)).toThrowError(/AMOUNT_MALFORMED/);
    expect(() => toBaseUnits('-5', 6)).toThrowError(/AMOUNT_MALFORMED/);
  });
});

describe('baseToHuman', () => {
  it('renders both decimal families and trims zeros', () => {
    expect(baseToHuman('12500000', 6)).toBe('12.5');
    expect(baseToHuman('5000000000000000000', 18)).toBe('5');
    expect(baseToHuman('5630000000000000000000000', 18)).toBe('5630000');
  });
});

describe('emCallsFromLegs', () => {
  it('stamps chainId on EVERY call and keeps the description as label', () => {
    const calls = emCallsFromLegs(
      [{ to: '0xA', data: '0x1', value: '0x0', description: 'Approve FXRP' }],
      1,
    );
    expect(calls[0]).toEqual({ to: '0xA', data: '0x1', value: '0x0', chainId: 1, label: 'Approve FXRP' });
  });
});

describe('emPreflightInfo', () => {
  const base: EmPrepareEnvelope = {
    preflight: { ok: true, checks: [{ name: 'liquidity', ok: true }, { name: 'health', ok: true }] },
    simulation: {
      attempted: true,
      legs: [
        { legIndex: 0, description: 'Approve FXRP', status: 'ok' },
        { legIndex: 1, description: 'Deposit FXRP', status: 'depends_on_prior', note: 'runs after the approve' },
      ],
    },
  };

  it('green with unverified legs = PARTIAL green, said out loud', () => {
    const p = emPreflightInfo(base);
    expect(p).toMatchObject({ available: true, willSucceed: true, partial: true });
    expect(p.steps?.map((s) => s.verdict)).toEqual(['ok', 'ok', 'ok', 'unverified']);
  });

  it('a failing check gates the sign button with its message as reason', () => {
    const p = emPreflightInfo({
      ...base,
      preflight: {
        ok: false,
        checks: [{ name: 'liquidity', ok: false, code: 'BORROW_EXCEEDS_LIQUIDITY', message: 'The market cannot lend that much right now — lower the amount' }],
      },
    });
    expect(p.willSucceed).toBe(false);
    expect(p.reason).toContain('cannot lend');
  });

  it('a simulated revert proves failure even when checks passed', () => {
    const p = emPreflightInfo({
      ...base,
      simulation: {
        attempted: true,
        legs: [{ legIndex: 0, description: 'Approve', status: 'revert', revertReason: 'ERC20: allowance' }],
      },
    });
    expect(p.willSucceed).toBe(false);
    expect(p.reason).toContain('allowance');
  });
});

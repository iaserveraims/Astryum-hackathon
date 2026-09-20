import { describe, expect, it } from 'vitest';
import { deriskMayAutoAdvance, deriskStepIsEmpty, parseIsoLegs } from '../deriskReadState';

/**
 * A failed iso-legs read used to fall back to stale props and declare «the
 * unwind is complete» over 0 FXRP nobody read. These tests fail the day an
 * unread step is called empty.
 */

const read = { legsLoading: false, legsReadFailed: false, suppliedUsdt0Human: 0, debtHuman: 0, supplyFxrpHuman: 0 };

describe('deriskStepIsEmpty', () => {
  it('each step is empty only on its own leg, as the chain answered', () => {
    expect(deriskStepIsEmpty({ ...read, step: 1 })).toBe(true);
    expect(deriskStepIsEmpty({ ...read, step: 1, suppliedUsdt0Human: 5 })).toBe(false);
    expect(deriskStepIsEmpty({ ...read, step: 2, debtHuman: 0.01 })).toBe(false);
    expect(deriskStepIsEmpty({ ...read, step: 3 })).toBe(true);
    expect(deriskStepIsEmpty({ ...read, step: 3, supplyFxrpHuman: 12 })).toBe(false);
  });

  it('a FAILED read never makes a step empty — step 3 never says «complete»', () => {
    for (const step of [1, 2, 3] as const) {
      expect(deriskStepIsEmpty({ ...read, step, legsReadFailed: true })).toBe(false);
    }
  });

  it('while loading nothing is empty either', () => {
    expect(deriskStepIsEmpty({ ...read, step: 3, legsLoading: true })).toBe(false);
  });
});

describe('deriskMayAutoAdvance', () => {
  it('only on answered numbers', () => {
    expect(deriskMayAutoAdvance({ legsLoading: false, legsReadFailed: false })).toBe(true);
    expect(deriskMayAutoAdvance({ legsLoading: true, legsReadFailed: false })).toBe(false);
    expect(deriskMayAutoAdvance({ legsLoading: false, legsReadFailed: true })).toBe(false);
  });
});

/**
 * THE SECOND DOOR. The guard above only learned of a failure through
 * HTTP, so a 200 whose body carried no legs — the shape the route produced
 * while `balanceOf` was swallowed as `0n`, and the shape any error envelope
 * produces — walked straight through: three `undefined` became 0, step 3 was
 * «empty», and the unwind was declared complete over a carry with live debt.
 */
describe('parseIsoLegs — a 200 is not a reading until the legs are IN it', () => {
  const chainSaysEmpty = (b: unknown) => {
    const r = parseIsoLegs(b);
    const legsReadFailed = !r.ok;
    const n = (v: string | null | undefined) => (v ? Number(v) / 1e6 : 0);
    const legs = r.ok ? r.legs : {};
    return deriskStepIsEmpty({
      step: 3,
      legsLoading: false,
      legsReadFailed,
      suppliedUsdt0Human: n(legs.suppliedUsdt0Base),
      debtHuman: n(legs.debtUsdt0Base),
      supplyFxrpHuman: n(legs.supplyFxrpBase),
    });
  };

  it('the three keys PRESENT with explicit nulls is a genuine empty position — step 3 may be called empty', () => {
    const r = parseIsoLegs({ supplyFxrpBase: null, suppliedUsdt0Base: null, debtUsdt0Base: null, legsRead: 'live' });
    expect(r.ok).toBe(true);
    expect(chainSaysEmpty({ supplyFxrpBase: null, suppliedUsdt0Base: null, debtUsdt0Base: null })).toBe(true);
  });

  it('live numbers travel through as strings', () => {
    const r = parseIsoLegs({ supplyFxrpBase: '5000000', suppliedUsdt0Base: null, debtUsdt0Base: 1050000 });
    expect(r).toEqual({ ok: true, legs: { supplyFxrpBase: '5000000', suppliedUsdt0Base: null, debtUsdt0Base: '1050000' } });
  });

  it('a body WITHOUT the legs (error envelope, empty object, proxy page) is NOT a reading — step 3 is never empty', () => {
    for (const body of [{}, { error: 'ISO_LEGS_UNREADABLE', retryable: true }, { supplyFxrpBase: null }, null, 'ok', []]) {
      expect(parseIsoLegs(body).ok).toBe(false);
      // Before: 0 FXRP nobody read → «No FXRP collateral left — the unwind is complete».
      expect(chainSaysEmpty(body)).toBe(false);
    }
  });

  it('a failed read never auto-advances the unwind either', () => {
    const r = parseIsoLegs({ error: 'ISO_LEGS_UNREADABLE' });
    expect(deriskMayAutoAdvance({ legsLoading: false, legsReadFailed: !r.ok })).toBe(false);
  });
});

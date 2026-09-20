/**
 * The institutional pure logic — no network, no DOM (vitest node env).
 * What is fixed here: exact base-unit parsing (Number rounds money away),
 * the exit-speed label that F1 shows AT decision time, and the day-scale
 * countdown of the exit clock (F3).
 */

import { describe, expect, it } from 'vitest';
import { exitSpeedLabel, parseAmountToBase } from '../institutional/policyCatalog';
import { formatDaySpan } from '../useCountdown';

describe('parseAmountToBase — exact, never floats', () => {
  it('parses FXRP (6 dec) exactly', () => {
    // BigInt(...) instead of `n` literals: the frontend tsconfig targets ES2017.
    expect(parseAmountToBase('1', 6)).toBe(BigInt(1_000_000));
    expect(parseAmountToBase('0.000001', 6)).toBe(BigInt(1));
    expect(parseAmountToBase('123456.789012', 6)).toBe(BigInt(123_456_789_012));
  });

  it('parses share units (9 dec) beyond double precision', () => {
    // 123456789.123456789 has more significant digits than a double carries —
    // so the expected value is built from a STRING, never from a number.
    expect(parseAmountToBase('123456789.123456789', 9)).toBe(BigInt('123456789123456789'));
  });

  it('refuses malformed input, excess precision and zero', () => {
    expect(parseAmountToBase('', 6)).toBeNull();
    expect(parseAmountToBase('1,5', 6)).toBeNull();
    expect(parseAmountToBase('-1', 6)).toBeNull();
    expect(parseAmountToBase('0.0000001', 6)).toBeNull(); // 7 decimals on asset
    expect(parseAmountToBase('0', 6)).toBeNull();
    expect(parseAmountToBase('0.000000', 6)).toBeNull();
  });
});

describe('exitSpeedLabel — the decision-slot label', () => {
  it('names the two shapes of the demo', () => {
    expect(exitSpeedLabel(0)).toBe('Exit: immediate');
    expect(exitSpeedLabel(72 * 3600)).toBe('Exit: 3 day(s)');
  });

  it('says hours when the cooldown is not whole days', () => {
    expect(exitSpeedLabel(36 * 3600)).toBe('Exit: 36 h');
  });
});

describe('formatDaySpan — honest at every magnitude', () => {
  it('days above 48h, hours above 1h, m:ss below', () => {
    expect(formatDaySpan(72 * 3600)).toBe('3d');
    expect(formatDaySpan(50 * 3600)).toBe('2d 2h');
    expect(formatDaySpan(5 * 3600 + 12 * 60)).toBe('5h 12m');
    expect(formatDaySpan(3600)).toBe('1h');
    expect(formatDaySpan(12 * 60 + 5)).toBe('12:05');
  });

  it('zero, negative and NaN are null — the caller decides what «now» looks like', () => {
    expect(formatDaySpan(0)).toBeNull();
    expect(formatDaySpan(-5)).toBeNull();
    expect(formatDaySpan(Number.NaN)).toBeNull();
  });
});

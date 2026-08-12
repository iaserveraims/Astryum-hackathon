import { describe, expect, it } from 'vitest';
import { displayBaseUnits, formatBaseUnits, parseBaseUnits, tryParseBaseUnits } from '../baseUnits';

// The app targets ES2017, where `1n` is a syntax error — build the expected
// bigints instead of writing literals (same reason as lib/legacy/baseUnits).
const big = (s: string) => BigInt(s);
const pow10 = (n: number) => BigInt(10) ** BigInt(n);

describe('base units are exact at 18 decimals', () => {
  it('round-trips human amounts without drift', () => {
    for (const human of ['1', '1.5', '60', '0.000000000000000001', '123456.789']) {
      expect(formatBaseUnits(parseBaseUnits(human, 18), 18)).toBe(human);
    }
  });

  it('holds amounts a JS number would corrupt', () => {
    // The exact reason nothing in this module uses Number(): a double cannot
    // carry this, and a corrupted amount is a different order than the one the
    // quorum reviewed.
    const human = '123456789.123456789012345678';
    const raw = parseBaseUnits(human, 18);
    expect(raw).toBe(big('123456789123456789012345678'));
    // Round-tripping through a double loses the low digits outright — the
    // order would commit a different number than the one displayed.
    expect(BigInt(Number(raw.toString()))).not.toBe(raw);
    expect(formatBaseUnits(raw, 18)).toBe(human);
  });

  it('formats whole amounts without a trailing dot', () => {
    expect(formatBaseUnits(pow10(18), 18)).toBe('1');
    expect(formatBaseUnits(big('0'), 18)).toBe('0');
    expect(formatBaseUnits('', 18)).toBe('0');
    expect(formatBaseUnits(big('12345'), 0)).toBe('12345');
  });

  it('refuses precision the token cannot hold instead of truncating', () => {
    expect(() => parseBaseUnits('1.1234567', 6)).toThrow(/lose precision/);
    expect(parseBaseUnits('1.123456', 6)).toBe(big('1123456'));
  });

  it('rejects everything that is not a positive decimal', () => {
    for (const bad of ['', '-1', 'abc', '1e18', '1.2.3', ' ', '0']) {
      expect(() => parseBaseUnits(bad, 18)).toThrow();
      expect(tryParseBaseUnits(bad, 18)).toBeNull();
    }
  });

  it('groups for display without letting that value back into an order', () => {
    expect(displayBaseUnits(parseBaseUnits('1234567.891', 18), 18)).toBe('1,234,567.891');
    expect(displayBaseUnits(parseBaseUnits('1000', 18), 18)).toBe('1,000');
    // Display truncates; the exact form is what an order must ever carry.
    expect(displayBaseUnits(parseBaseUnits('1.123456789', 18), 18)).toBe('1.1234');
    expect(formatBaseUnits(parseBaseUnits('1.123456789', 18), 18)).toBe('1.123456789');
  });
});

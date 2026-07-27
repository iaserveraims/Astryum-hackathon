import { isLpInRange, computeLpAmounts } from '../PositionScanService';

describe('isLpInRange — SparkDEX V3.1 LP range check (D3)', () => {
  test('tick strictly inside [lower, upper) is in range', () => {
    expect(isLpInRange(100, 0, 200)).toBe(true);
  });

  test('lower bound is inclusive', () => {
    expect(isLpInRange(0, 0, 200)).toBe(true);
  });

  test('upper bound is exclusive (Uniswap V3 semantics)', () => {
    expect(isLpInRange(200, 0, 200)).toBe(false);
  });

  test('tick below the range is out', () => {
    expect(isLpInRange(-50, 0, 200)).toBe(false);
  });

  test('tick above the range is out', () => {
    expect(isLpInRange(500, 0, 200)).toBe(false);
  });

  test('negative tick ranges (common for stable/correlated pairs)', () => {
    expect(isLpInRange(-100, -200, -50)).toBe(true);
    expect(isLpInRange(-50, -200, -50)).toBe(false); // upper exclusive
  });
});

describe('computeLpAmounts — Uniswap V3 amounts in price space (D3)', () => {
  // Range [sqrtPLower=1, sqrtPUpper=2], liquidity=100.
  test('below range → all token0, no token1', () => {
    const { amount0, amount1 } = computeLpAmounts(1, 1, 2, 100);
    expect(amount0).toBeCloseTo(50, 6); // L*(U-L)/(L*U) = 100*1/2
    expect(amount1).toBe(0);
  });

  test('above range → all token1, no token0', () => {
    const { amount0, amount1 } = computeLpAmounts(2, 1, 2, 100);
    expect(amount0).toBe(0);
    expect(amount1).toBeCloseTo(100, 6); // L*(U-L) = 100*1
  });

  test('in range → both tokens', () => {
    const { amount0, amount1 } = computeLpAmounts(1.5, 1, 2, 100);
    expect(amount0).toBeCloseTo(100 * (2 - 1.5) / (1.5 * 2), 6); // ≈16.667
    expect(amount1).toBeCloseTo(100 * (1.5 - 1), 6); // 50
  });

  test('degenerate inputs → zero', () => {
    expect(computeLpAmounts(1.5, 1, 2, 0)).toEqual({ amount0: 0, amount1: 0 }); // no liquidity
    expect(computeLpAmounts(1.5, 2, 1, 100)).toEqual({ amount0: 0, amount1: 0 }); // upper ≤ lower
  });
});

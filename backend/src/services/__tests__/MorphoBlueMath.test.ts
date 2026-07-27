/**
 * Morpho Blue position-math tests.
 *
 * Item 3 (2026-06-02) — Locks in the pure helpers the Morpho Blue position
 * scanner relies on, so the shares→assets conversion and health-factor formula
 * can't silently drift. These mirror Morpho's on-chain SharesMathLib +
 * `_isHealthy` math (VIRTUAL_SHARES=1e6, VIRTUAL_ASSETS=1, ORACLE_PRICE_SCALE=1e36,
 * WAD=1e18).
 */

import {
  morphoSharesToAssetsUp,
  morphoMaxBorrow,
  morphoHealthFactor,
} from '../PositionScanService';

const WAD = 10n ** 18n;
const ORACLE_PRICE_SCALE = 10n ** 36n;

describe('morphoSharesToAssetsUp', () => {
  test('zero shares → zero assets', () => {
    expect(morphoSharesToAssetsUp(0n, 1_000n, 1_000n)).toBe(0n);
  });

  test('fresh market (only virtual liquidity) rounds up', () => {
    // shares=1e6, totalAssets=0, totalShares=0 →
    //   (1e6 * (0+1)) / (0+1e6) = 1, rounded up = 1
    expect(morphoSharesToAssetsUp(1_000_000n, 0n, 0n)).toBe(1n);
  });

  test('1:1 market returns ~shares-scaled assets, rounding up', () => {
    // totalAssets == totalShares (both large) → assets ≈ shares, +1 from rounding/virtuals
    const shares = 500n;
    const totalAssets = 1_000_000n;
    const totalShares = 1_000_000n;
    // numerator = 500 * (1_000_000 + 1) = 500_000_500
    // denominator = 1_000_000 + 1_000_000 = 2_000_000
    // mulDivUp = ceil(500_000_500 / 2_000_000) = ceil(250.00025) = 251
    expect(morphoSharesToAssetsUp(shares, totalAssets, totalShares)).toBe(251n);
  });

  test('always rounds up (debt is never under-counted)', () => {
    // Any non-exact division must round up by exactly 1.
    expect(morphoSharesToAssetsUp(3n, 2n, 0n)).toBe(
      (3n * (2n + 1n) + (0n + 1_000_000n) - 1n) / (0n + 1_000_000n),
    );
  });
});

describe('morphoMaxBorrow', () => {
  test('price at 1.0 (1e36 scale), lltv 80% → 80% of collateral', () => {
    const collateral = 1_000n;
    const price = ORACLE_PRICE_SCALE; // 1.0 in loan-token units
    const lltv = (80n * WAD) / 100n; // 0.8 WAD
    expect(morphoMaxBorrow(collateral, price, lltv)).toBe(800n);
  });

  test('zero collateral → zero max borrow', () => {
    expect(morphoMaxBorrow(0n, ORACLE_PRICE_SCALE, WAD)).toBe(0n);
  });

  test('collateral priced at 2.0 doubles borrow ceiling', () => {
    const collateral = 1_000n;
    const price = 2n * ORACLE_PRICE_SCALE; // collateral worth 2 loan tokens each
    const lltv = (90n * WAD) / 100n; // 0.9
    // collateralValue = 1000 * 2 = 2000 ; maxBorrow = 2000 * 0.9 = 1800
    expect(morphoMaxBorrow(collateral, price, lltv)).toBe(1_800n);
  });
});

describe('morphoHealthFactor', () => {
  test('no debt → Infinity', () => {
    expect(morphoHealthFactor(0n, 1_000n)).toBe(Infinity);
  });

  test('maxBorrow == debt → HF of 1.0', () => {
    expect(morphoHealthFactor(1_000n, 1_000n)).toBeCloseTo(1.0, 9);
  });

  test('debt above ceiling → HF below 1 (liquidatable)', () => {
    expect(morphoHealthFactor(1_200n, 1_000n)).toBeLessThan(1);
  });

  test('healthy 2x over-collateralised → HF of 2.0', () => {
    expect(morphoHealthFactor(500n, 1_000n)).toBeCloseTo(2.0, 9);
  });

  test('tiny position keeps precision (no truncation to 0)', () => {
    // 1 wei debt vs 2 wei ceiling → HF 2.0, not 0.
    expect(morphoHealthFactor(1n, 2n)).toBeCloseTo(2.0, 9);
  });
});

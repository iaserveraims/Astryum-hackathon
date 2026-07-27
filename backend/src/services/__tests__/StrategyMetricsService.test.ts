import { StrategyMetricsService } from '../StrategyMetricsService';

const RATES = { fxrpPriceUSD: 2.0, collateralFactor: 0.7, borrowAprPct: 15.5, supplyAprPct: 2.0 };

describe('StrategyMetricsService (Fix 2 — neutral, honest metrics calculator)', () => {
  test('always includes a debt-free lend-only option (no liquidation risk)', () => {
    const m = StrategyMetricsService.computeCarryOptions(10000, RATES);
    const lend = m.options.find((o) => o.kind === 'lend-only')!;
    expect(lend.noDebt).toBe(true);
    expect(lend.noLiquidationRisk).toBe(true);
    expect(lend.liquidationPriceUSD).toBeNull();
    expect(lend.borrowUsd).toBeNull();
  });

  test('carry option numbers come from the tested math: HF=1/ratio, borrow, liquidation price, cost', () => {
    const m = StrategyMetricsService.computeCarryOptions(10000, RATES, { ratios: [0.5] });
    const carry = m.options.find((o) => o.borrowRatio === 0.5)!;
    expect(carry.borrowUsd).toBeCloseTo(7000, 0); // 20000 * 0.7 * 0.5
    expect(carry.entryHF).toBeCloseTo(2.0, 2); // 1 / 0.5
    expect(carry.liquidationPriceUSD).toBeCloseTo(1.0, 2); // D/(C·CF) = 7000/(10000·0.7)
    expect(carry.annualBorrowCostUsd).toBeCloseTo(7000 * 0.155, 0); // ~1085/yr
    // the HONEST full picture — every carry option exposes cost + liquidation, not just the upside
    expect(carry.liquidationPriceUSD).not.toBeNull();
    expect(carry.annualBorrowCostUsd).not.toBeNull();
  });

  test('target USD adds the exact-target option and shows its full picture', () => {
    const m = StrategyMetricsService.computeCarryOptions(10000, RATES, { targetUsd: 200 });
    const target = m.options.find((o) => o.kind === 'carry' && Math.abs((o.borrowUsd ?? 0) - 200) < 5);
    expect(target).toBeDefined();
    expect(target!.entryHF).toBeGreaterThan(10); // $200 against $20k → very high HF
    expect(target!.liquidationPriceUSD).not.toBeNull();
    expect(target!.annualBorrowCostUsd).not.toBeNull();
  });

  test('options are UNRANKED — no "best"/recommend/highlight anywhere in the data or the table', () => {
    const m = StrategyMetricsService.computeCarryOptions(10000, RATES, { targetUsd: 200 });
    expect(JSON.stringify(m)).not.toMatch(/best|recommend|mejor|recomend|highlight|preferred/i);
    const table = StrategyMetricsService.toContextTable(m);
    expect(table).toMatch(/sin orden de preferencia/);
    expect(table).not.toMatch(/mejor opci|recomend|deber[íi]as/i);
  });

  test('rejects bad inputs (never guesses)', () => {
    expect(() => StrategyMetricsService.computeCarryOptions(0, RATES)).toThrow(/BAD_AMOUNT/);
    expect(() =>
      StrategyMetricsService.computeCarryOptions(100, { fxrpPriceUSD: 0, collateralFactor: 0.7 }),
    ).toThrow(/BAD_PRICE/);
  });
});

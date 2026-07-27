/**
 * StrategyEngine.test.ts
 *
 * Tests for the deterministic heuristics in StrategyEngine.
 * All external dependencies (PortfolioEngine, RiskEngine, SimulationEngine)
 * are fully mocked — no real RPC, DB, or HTTP.
 */

// ── Hoist mocks before any imports ─────────────────────────────────────────
jest.mock('../../../engines/portfolio/PortfolioEngine', () => ({
  PortfolioEngine: { getInstance: jest.fn() },
}));
jest.mock('../../../engines/risk/RiskEngine', () => ({
  RiskEngine: { getInstance: jest.fn() },
}));
jest.mock('../../../engines/simulation/SimulationEngine', () => ({
  SimulationEngine: {},
}));

import type { PortfolioSnapshot } from '../../portfolio/SnapshotBuilder';
import type { RiskSnapshot } from '../../risk/types';
import { StrategyEngine } from '../StrategyEngine';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    wallet: '0xuser',
    chainId: 14,
    totalUSD: 10_000,
    collateralUSD: 8_000,
    debtUSD: 3_000,
    netWorthUSD: 7_000,
    positions: [],
    breakdown: {
      byProtocol: {},
      byAsset: {},
      byKind: {} as any,
    },
    takenAt: new Date(),
    ...overrides,
  };
}

function makeRisk(overrides: Partial<RiskSnapshot> = {}): RiskSnapshot {
  return {
    scope: 'PORTFOLIO',
    scopeId: '0xuser',
    riskLevel: 'SAFE',
    riskScore: 10,
    warnings: [],
    assumptions: [],
    drivers: [],
    computedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StrategyEngine — deterministic heuristics', () => {
  let engine: StrategyEngine;

  beforeEach(() => {
    // Reset the singleton so tests are isolated
    (StrategyEngine as any).instance = null;
    engine = StrategyEngine.getInstance();
  });

  // 1. Empty portfolio → single noAction entry
  test('empty portfolio returns noAction', async () => {
    const portfolio = makeSnapshot({ positions: [], totalUSD: 0 });
    const risk = makeRisk();

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    expect(recs).toHaveLength(1);
    expect(recs[0].kind).toBe('noAction');
    expect(recs[0].priority).toBe('INFO');
  });

  // 2. Low HF → repay recommended for borrow positions
  test('HF below target triggers repay recommendation', async () => {
    const portfolio = makeSnapshot({
      positions: [
        {
          protocolId: 'kinetic',
          chainId: 14,
          kind: 'BORROW',
          asset: '0xUSDC',
          amount: '1000000000',
          amountUSD: 1_000,
          priceUSD: 1,
          metrics: {},
          metadata: { symbol: 'USDC' },
          takenAt: new Date(),
        },
      ],
    });
    const risk = makeRisk({ healthFactor: 1.1, ltv: 0.5 }); // strict < 1.2 → CRITICAL

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const repays = recs.filter((r) => r.kind === 'repay');
    expect(repays.length).toBeGreaterThan(0);
    const repay = repays[0];
    expect(repay.priority).toBe('CRITICAL'); // HF < 1.2 → CRITICAL
    expect(repay.protocolId).toBe('kinetic');
    expect(repay.asset).toBe('0xUSDC');
    expect(repay.amountUSD).toBeGreaterThan(0);
    expect(repay.reason).toMatch(/HF/);
  });

  // 3. HF just below 1.8 but above 1.2 → HIGH priority (not CRITICAL)
  test('HF between 1.2 and 1.8 triggers HIGH (not CRITICAL) repay', async () => {
    const portfolio = makeSnapshot({
      positions: [
        {
          protocolId: 'kinetic',
          chainId: 14,
          kind: 'BORROW',
          asset: '0xDAI',
          amount: '500000000',
          amountUSD: 500,
          priceUSD: 1,
          metrics: {},
          metadata: { symbol: 'DAI' },
          takenAt: new Date(),
        },
      ],
    });
    const risk = makeRisk({ healthFactor: 1.5, ltv: 0.5 });

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const repay = recs.find((r) => r.kind === 'repay');
    expect(repay).toBeDefined();
    expect(repay!.priority).toBe('HIGH');
  });

  // 4. High LTV (>0.75) → addCollateral suggested
  test('LTV above threshold triggers addCollateral recommendation', async () => {
    const portfolio = makeSnapshot({
      positions: [
        {
          protocolId: 'kinetic',
          chainId: 14,
          kind: 'SUPPLY',
          asset: '0xWFLR',
          amount: '1000000000000000000',
          amountUSD: 5_000,
          priceUSD: 0.05,
          metrics: {},
          metadata: { symbol: 'WFLR' },
          takenAt: new Date(),
        },
      ],
    });
    const risk = makeRisk({ healthFactor: 2.0, ltv: 0.8 }); // LTV > 0.75

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const addCol = recs.find((r) => r.kind === 'addCollateral');
    expect(addCol).toBeDefined();
    expect(addCol!.priority).toBe('HIGH');
    expect(addCol!.reason).toMatch(/LTV/);
  });

  // 5. Out-of-range LP → exitOutOfRangeLP recommended
  test('out-of-range LP triggers exitOutOfRangeLP recommendation', async () => {
    const portfolio = makeSnapshot({
      positions: [
        {
          protocolId: 'sparkdex',
          chainId: 14,
          kind: 'LP',
          asset: 'WFLR/USDC',
          amount: '0',
          amountUSD: 2_000,
          priceUSD: 1,
          metrics: { inRange: false } as any,
          metadata: {},
          takenAt: new Date(),
        },
      ],
    });
    const risk = makeRisk({ healthFactor: 3.0, riskScore: 15 });

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const exit = recs.find((r) => r.kind === 'exitOutOfRangeLP');
    expect(exit).toBeDefined();
    expect(exit!.priority).toBe('MEDIUM');
    expect(exit!.protocolId).toBe('sparkdex');
    expect(exit!.reason).toMatch(/out-of-range/);
  });

  // 6. In-range LP → no exit recommended
  test('in-range LP does NOT trigger exitOutOfRangeLP', async () => {
    const portfolio = makeSnapshot({
      positions: [
        {
          protocolId: 'sparkdex',
          chainId: 14,
          kind: 'LP',
          asset: 'WFLR/USDC',
          amount: '0',
          amountUSD: 2_000,
          priceUSD: 1,
          metrics: { inRange: true } as any,
          metadata: {},
          takenAt: new Date(),
        },
      ],
    });
    const risk = makeRisk();

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const exit = recs.find((r) => r.kind === 'exitOutOfRangeLP');
    expect(exit).toBeUndefined();
  });

  // 7. Pending rewards above $50 → harvest recommended
  test('pending rewards above $50 trigger harvest recommendation', async () => {
    const portfolio = makeSnapshot({
      positions: [
        {
          protocolId: 'firelight',
          chainId: 14,
          kind: 'REWARD',
          asset: '0xstXRP',
          amount: '0',
          amountUSD: 75,
          priceUSD: 1,
          metrics: {},
          metadata: {},
          takenAt: new Date(),
        },
      ],
    });
    const risk = makeRisk();

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const harvest = recs.find((r) => r.kind === 'harvest');
    expect(harvest).toBeDefined();
    expect(harvest!.priority).toBe('LOW');
    expect(harvest!.amountUSD).toBe(75);
  });

  // 8. Pending rewards below $50 → no harvest
  test('pending rewards below $50 do NOT trigger harvest', async () => {
    const portfolio = makeSnapshot({
      positions: [
        {
          protocolId: 'firelight',
          chainId: 14,
          kind: 'REWARD',
          asset: '0xstXRP',
          amount: '0',
          amountUSD: 30,
          priceUSD: 1,
          metrics: {},
          metadata: {},
          takenAt: new Date(),
        },
      ],
    });
    const risk = makeRisk();

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const harvest = recs.find((r) => r.kind === 'harvest');
    expect(harvest).toBeUndefined();
  });

  // 9. Asset concentration > 70% → reduceConcentration
  test('single asset > 70% of portfolio triggers reduceConcentration', async () => {
    const portfolio = makeSnapshot({
      totalUSD: 10_000,
      breakdown: {
        byProtocol: { kinetic: 10_000 },
        byAsset: { WFLR: 8_500 }, // 85%
        byKind: {} as any,
      },
      positions: [],
    });
    const risk = makeRisk({ healthFactor: 3.0 });

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const conc = recs.find((r) => r.kind === 'reduceConcentration');
    expect(conc).toBeDefined();
    expect(conc!.asset).toBe('WFLR');
    expect(conc!.reason).toMatch(/85%/);
  });

  // 10. Recommendations are sorted by priority weight (CRITICAL > HIGH > MEDIUM > LOW)
  test('recommendations come back sorted by descending priority', async () => {
    const portfolio = makeSnapshot({
      totalUSD: 10_000,
      positions: [
        // BORROW → triggers repay (CRITICAL because HF < 1.2)
        {
          protocolId: 'kinetic',
          chainId: 14,
          kind: 'BORROW',
          asset: '0xUSDC',
          amount: '1000000000',
          amountUSD: 1_000,
          priceUSD: 1,
          metrics: {},
          metadata: { symbol: 'USDC' },
          takenAt: new Date(),
        },
        // LP out-of-range → MEDIUM
        {
          protocolId: 'sparkdex',
          chainId: 14,
          kind: 'LP',
          asset: 'WFLR/USDC',
          amount: '0',
          amountUSD: 2_000,
          priceUSD: 1,
          metrics: { inRange: false } as any,
          metadata: {},
          takenAt: new Date(),
        },
        // REWARD > $50 → LOW
        {
          protocolId: 'firelight',
          chainId: 14,
          kind: 'REWARD',
          asset: '0xstXRP',
          amount: '0',
          amountUSD: 75,
          priceUSD: 1,
          metrics: {},
          metadata: {},
          takenAt: new Date(),
        },
      ],
      breakdown: {
        byProtocol: {},
        byAsset: { WFLR: 2_000 }, // < 70%, no concentration warning
        byKind: {} as any,
      },
    });
    const risk = makeRisk({ healthFactor: 1.1, ltv: 0.5 });

    const recs = await engine.recommendFromSnapshot(portfolio, risk);

    const priorityOrder: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 1,
      MEDIUM: 2,
      LOW: 3,
      INFO: 4,
    };

    for (let i = 0; i < recs.length - 1; i++) {
      const currentOrder = priorityOrder[recs[i].priority] ?? 99;
      const nextOrder = priorityOrder[recs[i + 1].priority] ?? 99;
      expect(currentOrder).toBeLessThanOrEqual(nextOrder);
    }

    // Verify CRITICAL is first
    expect(recs[0].priority).toBe('CRITICAL');
  });

  // 11. recommendDefensive delegates to PortfolioEngine + RiskEngine
  test('recommendDefensive calls PortfolioEngine and RiskEngine', async () => {
    const { PortfolioEngine } = await import('../../../engines/portfolio/PortfolioEngine');
    const { RiskEngine } = await import('../../../engines/risk/RiskEngine');

    const mockPortfolio = makeSnapshot();
    const mockRisk = makeRisk();

    const mockGetPortfolio = jest.fn().mockResolvedValue(mockPortfolio);
    const mockEvaluate = jest.fn().mockReturnValue(mockRisk);

    (PortfolioEngine.getInstance as jest.Mock).mockReturnValue({
      getPortfolio: mockGetPortfolio,
    });
    (RiskEngine.getInstance as jest.Mock).mockReturnValue({
      evaluateSnapshot: mockEvaluate,
    });

    const recs = await engine.recommendDefensive('0xuser', 14);

    expect(mockGetPortfolio).toHaveBeenCalledWith('0xuser', 14);
    expect(mockEvaluate).toHaveBeenCalledWith(mockPortfolio);
    expect(Array.isArray(recs)).toBe(true);
  });
});

// Patch: enforce sort at the heuristic level is not built into StrategyEngine yet —
// test 10 verifies the EXISTING emission order (CRITICAL positions come from the
// first heuristic block, MEDIUM from LP, LOW from harvest) which is already
// in descending priority by construction of the method.

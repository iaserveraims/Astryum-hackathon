import { PortfolioRiskEngine } from '../PortfolioRiskEngine';
import type { PortfolioSnapshot } from '../../portfolio/SnapshotBuilder';

function snap(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    wallet: '0x0000000000000000000000000000000000000001',
    chainId: 14,
    totalUSD: 1000,
    collateralUSD: 1000,
    debtUSD: 0,
    netWorthUSD: 1000,
    positions: [],
    breakdown: { byProtocol: {}, byAsset: {}, byKind: { SUPPLY: 0, BORROW: 0, LP: 0, STAKE: 0, REWARD: 0, FREE: 0 } },
    takenAt: new Date(),
    ...overrides,
  };
}

describe('PortfolioRiskEngine', () => {
  test('empty portfolio → SAFE, score 0', () => {
    const r = PortfolioRiskEngine.evaluate(snap());
    expect(r.riskLevel).toBe('SAFE');
    expect(r.riskScore).toBe(0);
  });

  test('worst HF 1.1 (BORROW with low HF) → high HF score', () => {
    const r = PortfolioRiskEngine.evaluate(
      snap({
        debtUSD: 500,
        collateralUSD: 700,
        positions: [
          {
            protocolId: 'kinetic',
            chainId: 14,
            kind: 'BORROW',
            asset: '0xstable',
            amount: '500000000000000000000',
            amountUSD: 500,
            priceUSD: 1,
            metrics: { hf: 1.1 },
            metadata: { symbol: 'USDT0' },
            takenAt: new Date(),
          },
        ],
        breakdown: {
          byProtocol: { kinetic: -500 },
          byAsset: { '0xstable': -500 },
          byKind: { SUPPLY: 0, BORROW: 500, LP: 0, STAKE: 0, REWARD: 0, FREE: 0 },
        },
      })
    );
    // hfToScore(1.1) = 90 → 90*0.6 = 54 (no other concentration drivers active here)
    expect(r.healthFactor).toBe(1.1);
    expect(r.riskScore).toBeGreaterThanOrEqual(50);
    expect(['WARNING', 'DANGER', 'CRITICAL']).toContain(r.riskLevel);
    expect(r.warnings.some((w) => /HF/.test(w))).toBe(true);
  });

  test('liquidation price+distance of the worst-HF account propagate (legs merged)', () => {
    // One risky account = two legs with the SAME HF: the SUPPLY leg carries
    // the liquidation price (adapter computes it there), the BORROW leg the
    // USD distance (LendingRiskEngine computes it there). Plus a safer supply
    // whose figures must NOT win. The aggregate merges the tied worst legs.
    const r = PortfolioRiskEngine.evaluate(
      snap({
        debtUSD: 500,
        collateralUSD: 2000,
        positions: [
          {
            protocolId: 'kinetic',
            chainId: 14,
            kind: 'SUPPLY',
            asset: '0xfxrp',
            amount: '1000000000',
            amountUSD: 1000,
            priceUSD: 2,
            metrics: { hf: 1.05, liquidationPrice: 0.9, ltv: 0.66 },
            metadata: { symbol: 'FXRP' },
            takenAt: new Date(),
          },
          {
            protocolId: 'kinetic',
            chainId: 14,
            kind: 'BORROW',
            asset: '0xusdt0',
            amount: '500000000',
            amountUSD: 500,
            priceUSD: 1,
            metrics: { hf: 1.05 },
            metadata: { symbol: 'USDT0' },
            takenAt: new Date(),
          },
          {
            protocolId: 'kinetic',
            chainId: 14,
            kind: 'SUPPLY',
            asset: '0xother',
            amount: '1000000000',
            amountUSD: 1000,
            priceUSD: 1,
            metrics: { hf: 1.8, liquidationPrice: 0.4, ltv: 0.3 },
            metadata: { symbol: 'SFLR' },
            takenAt: new Date(),
          },
        ],
        breakdown: {
          byProtocol: { kinetic: 2000 },
          byAsset: { '0xfxrp': 1000, '0xusdt0': -500, '0xother': 1000 },
          byKind: { SUPPLY: 2000, BORROW: 500, LP: 0, STAKE: 0, REWARD: 0, FREE: 0 },
        },
      })
    );
    expect(r.healthFactor).toBe(1.05);
    // Price from the worst account's SUPPLY leg (not the safer 0.4 one)…
    expect(r.liquidationPriceUSD).toBe(0.9);
    // …distance from its BORROW leg: debt × (HF − 1) = 500 × 0.05 = 25.
    expect(r.liquidationDistanceUSD).toBeCloseTo(25, 9);
  });

  test('no lending positions → liquidation fields stay undefined (never invented)', () => {
    const r = PortfolioRiskEngine.evaluate(snap());
    expect(r.liquidationPriceUSD).toBeUndefined();
    expect(r.liquidationDistanceUSD).toBeUndefined();
  });

  test('SIN DEUDA (Lend-only con HF residual) → sin HF ni liquidación (bug 2026-07-29 "at risk" con LTV 0%)', () => {
    // Una posición Lend que arrastra un hf=1.0 residual NO puede liquidarse sin
    // borrow: el HealthStrip debe caer en "No debt to watch", no en "at risk".
    const r = PortfolioRiskEngine.evaluate(
      snap({
        debtUSD: 0,
        collateralUSD: 1000,
        positions: [
          {
            protocolId: 'kinetic',
            chainId: 14,
            kind: 'SUPPLY',
            asset: '0xfxrp',
            amount: '1000000000',
            amountUSD: 1000,
            priceUSD: 2,
            metrics: { hf: 1.0, liquidationPrice: 1.0852 },
            metadata: { symbol: 'FXRP' },
            takenAt: new Date(),
          },
        ],
        breakdown: {
          byProtocol: { kinetic: 1000 },
          byAsset: { '0xfxrp': 1000 },
          byKind: { SUPPLY: 1000, BORROW: 0, LP: 0, STAKE: 0, REWARD: 0, FREE: 0 },
        },
      })
    );
    expect(r.healthFactor).toBeUndefined();
    expect(r.liquidationPriceUSD).toBeUndefined();
    expect(r.ltv).toBe(0); // 0 deuda / colateral = 0, no "at risk"
  });

  test('asset concentration > 80% → warning', () => {
    const r = PortfolioRiskEngine.evaluate(
      snap({
        totalUSD: 1000,
        positions: [
          {
            protocolId: 'kinetic',
            chainId: 14,
            kind: 'SUPPLY',
            asset: '0xfxrp',
            amount: '900000000000000000000',
            amountUSD: 900,
            priceUSD: 1,
            metrics: {},
            metadata: { symbol: 'FXRP' },
            takenAt: new Date(),
          },
          {
            protocolId: 'firelight',
            chainId: 14,
            kind: 'STAKE',
            asset: '0xfxrp',
            amount: '100000000000000000000',
            amountUSD: 100,
            priceUSD: 1,
            metrics: {},
            metadata: { symbol: 'stXRP' },
            takenAt: new Date(),
          },
        ],
        breakdown: {
          byProtocol: { kinetic: 900, firelight: 100 },
          byAsset: { '0xfxrp': 1000 },
          byKind: { SUPPLY: 900, BORROW: 0, LP: 0, STAKE: 100, REWARD: 0, FREE: 0 },
        },
      })
    );
    expect(r.warnings.some((w) => /concentration/.test(w))).toBe(true);
  });
});

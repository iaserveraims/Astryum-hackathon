const mockSnapFindMany = jest.fn();
const mockPositionFindUnique = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    positionSnapshot: { findMany: (...a: unknown[]) => mockSnapFindMany(...a) },
    position: { findUnique: (...a: unknown[]) => mockPositionFindUnique(...a) },
  },
}));

import { PositionPerformanceService } from '../PositionPerformanceService';

describe('PositionPerformanceService (C2 — P&L + debt growth from PositionSnapshot history)', () => {
  beforeEach(() => {
    mockSnapFindMany.mockReset();
    mockPositionFindUnique.mockReset();
  });

  test('honest empty-state when there is no history', async () => {
    mockSnapFindMany.mockResolvedValue([]);
    const p = await PositionPerformanceService.compute('pos1');
    expect(p.available).toBe(false);
    expect(p.reason).toBe('no-history');
    expect(p.snapshotCount).toBe(0);
    expect(p.netPnlUSD).toBeUndefined();
  });

  test('honest empty-state with a single snapshot (needs two)', async () => {
    mockSnapFindMany.mockResolvedValue([
      { takenAt: new Date(), amountUSD: 100, priceUSD: 1, hf: 2, metricsJson: {} },
    ]);
    const p = await PositionPerformanceService.compute('pos1');
    expect(p.available).toBe(false);
    expect(p.reason).toBe('need-two-snapshots');
    expect(p.snapshotCount).toBe(1);
  });

  test('net P&L for a SUPPLY position: entry vs latest, + entry APY from metricsJson', async () => {
    mockSnapFindMany.mockResolvedValue([
      { takenAt: new Date('2026-07-01T00:00:00Z'), amountUSD: 100, priceUSD: 2.0, hf: null, metricsJson: { apy: 3.7 } },
      { takenAt: new Date('2026-07-05T00:00:00Z'), amountUSD: 110, priceUSD: 2.2, hf: null, metricsJson: {} },
    ]);
    mockPositionFindUnique.mockResolvedValue({ kind: 'SUPPLY' });
    const p = await PositionPerformanceService.compute('pos1');
    expect(p.available).toBe(true);
    expect(p.entryValueUSD).toBe(100);
    expect(p.currentValueUSD).toBe(110);
    expect(p.netPnlUSD).toBe(10);
    expect(p.netPnlPct).toBeCloseTo(10);
    expect(p.entryApy).toBe(3.7);
    expect(p.entryAt).toBe('2026-07-01T00:00:00.000Z');
    // supply has no debt growth
    expect(p.debtGrowthUSD).toBeUndefined();
  });

  test('debt growth for a BORROW position (amountUSD is the debt)', async () => {
    mockSnapFindMany.mockResolvedValue([
      { takenAt: new Date('2026-07-01T00:00:00Z'), amountUSD: 100, priceUSD: 1, hf: 1.8, metricsJson: {} },
      { takenAt: new Date('2026-07-05T00:00:00Z'), amountUSD: 103, priceUSD: 1, hf: 1.7, metricsJson: {} },
    ]);
    mockPositionFindUnique.mockResolvedValue({ kind: 'BORROW' });
    const p = await PositionPerformanceService.compute('pos1');
    expect(p.available).toBe(true);
    expect(p.entryDebtUSD).toBe(100);
    expect(p.currentDebtUSD).toBe(103);
    expect(p.debtGrowthUSD).toBe(3);
    expect(p.debtGrowthPct).toBeCloseTo(3);
  });
});

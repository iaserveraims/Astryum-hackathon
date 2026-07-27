import { prisma } from '../database/prismaClient';

/**
 * PositionPerformanceService — net P&L + debt growth for a position (C2).
 *
 * DECISION (build spec C2, revised): rather than a brand-new PositionEntry table +
 * migration, we reuse the EXISTING `PositionSnapshot` history. The FIRST snapshot
 * (oldest `takenAt`) is the entry cost-basis; the LATEST is "now". This gives
 * P&L-per-position and debt-growth-per-position with NO new prod migration.
 *
 * Honest empty-state: until a live position has been snapshotted at least twice
 * (i.e. a real E1/E3 position exists and has been scanned over time), `available`
 * is false and no numbers are invented — the correct state until then.
 */

export interface PositionPerformance {
  positionId: string;
  /** false when there isn't enough history yet — the honest empty state. */
  available: boolean;
  reason?: 'no-history' | 'need-two-snapshots';
  snapshotCount: number;

  entryAt?: string; // ISO timestamp of the entry (first) snapshot
  entryValueUSD?: number;
  currentValueUSD?: number;
  /** Net P&L of this position's value since entry (number and %). */
  netPnlUSD?: number;
  netPnlPct?: number;

  /** Debt growth — only for BORROW positions (amountUSD is the debt there). */
  entryDebtUSD?: number;
  currentDebtUSD?: number;
  debtGrowthUSD?: number;
  debtGrowthPct?: number;

  /** APY at entry, if it was captured in the entry snapshot's metricsJson. */
  entryApy?: number | null;
}

export class PositionPerformanceService {
  static async compute(positionId: string): Promise<PositionPerformance> {
    const snaps = await prisma.positionSnapshot.findMany({
      where: { positionId },
      orderBy: { takenAt: 'asc' },
      select: { takenAt: true, amountUSD: true, priceUSD: true, hf: true, metricsJson: true },
    });

    if (snaps.length < 2) {
      return {
        positionId,
        available: false,
        reason: snaps.length === 0 ? 'no-history' : 'need-two-snapshots',
        snapshotCount: snaps.length,
      };
    }

    const entry = snaps[0];
    const now = snaps[snaps.length - 1];
    const entryValueUSD = Number(entry.amountUSD);
    const currentValueUSD = Number(now.amountUSD);
    const netPnlUSD = currentValueUSD - entryValueUSD;
    const netPnlPct = entryValueUSD !== 0 ? (netPnlUSD / entryValueUSD) * 100 : 0;

    const entryApy =
      (entry.metricsJson as { apy?: number; entryApy?: number } | null)?.apy ??
      (entry.metricsJson as { apy?: number; entryApy?: number } | null)?.entryApy ??
      null;

    const base: PositionPerformance = {
      positionId,
      available: true,
      snapshotCount: snaps.length,
      entryAt: entry.takenAt.toISOString(),
      entryValueUSD,
      currentValueUSD,
      netPnlUSD,
      netPnlPct,
      entryApy,
    };

    // Debt growth is only meaningful for a BORROW position (its amountUSD IS the debt).
    const pos = await prisma.position.findUnique({ where: { id: positionId }, select: { kind: true } });
    if (pos?.kind === 'BORROW') {
      const entryDebtUSD = entryValueUSD;
      const currentDebtUSD = currentValueUSD;
      const debtGrowthUSD = currentDebtUSD - entryDebtUSD;
      return {
        ...base,
        entryDebtUSD,
        currentDebtUSD,
        debtGrowthUSD,
        debtGrowthPct: entryDebtUSD !== 0 ? (debtGrowthUSD / entryDebtUSD) * 100 : 0,
      };
    }

    return base;
  }
}

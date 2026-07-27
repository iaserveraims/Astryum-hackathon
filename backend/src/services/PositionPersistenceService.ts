/**
 * PositionPersistenceService — pipeline 2.6 (Opción A, sin migración).
 *
 * Persists the AGGREGATED per-protocol lending scan into the existing
 * Position/PositionSnapshot tables so PositionPerformanceService (already
 * built + tested) can light the historical P&L and debt-growth panels once
 * ≥2 snapshots of a live position exist.
 *
 * Model decision (Opción A refined to fit the PositionKind enum): per
 * (user wallet, protocol, chain) we persist up to TWO aggregate rows —
 *   kind SUPPLY → amountUSD = totalCollateralUSD  (P&L series)
 *   kind BORROW → amountUSD = totalDebtUSD        (debt-growth series;
 *                 PositionPerformanceService keys debt growth on kind BORROW)
 * with `asset = 'aggregate'` (the scan is per-protocol, no single token) and
 * the full scan detail in metadata/metricsJson.
 *
 * Defensive by spec (Cierre 2026-07-07 §2.6): every FK is resolved with
 * findFirst and MISSING links SKIP the row (reason reported) — never throw
 * into the read path. Gated behind POSITION_PERSISTENCE_ENABLED (off by
 * default) so nothing writes to prod until the first live position validates
 * the mapping. Read-only invariants untouched: this writes OUR OWN DB rows,
 * never the chain.
 */

import { prisma } from '../database/prismaClient';
import type { ScannedLendingPosition } from './PositionScanService';

/** Convention for aggregated rows — the scan has no single token address. */
export const AGGREGATE_ASSET = 'aggregate';

export interface PersistScanOutcome {
  persisted: number;
  skipped: Array<{ protocolSlug: string; reason: string }>;
}

export function positionPersistenceEnabled(): boolean {
  return process.env.POSITION_PERSISTENCE_ENABLED === 'true';
}

class PositionPersistenceService {
  /**
   * Upsert aggregate Position rows + append one PositionSnapshot per row.
   * Never throws for a single row — failures are reported per protocol.
   */
  async persistScan(
    userId: string | undefined,
    scans: ScannedLendingPosition[],
  ): Promise<PersistScanOutcome> {
    const outcome: PersistScanOutcome = { persisted: 0, skipped: [] };
    if (!userId) {
      outcome.skipped.push({ protocolSlug: '*', reason: 'no_user' });
      return outcome;
    }

    for (const scan of scans) {
      try {
        // FK chain — defensive: skip when a link is missing (spec 2.6 #3).
        const wallet = await prisma.wallet.findFirst({
          where: { userId, address: { equals: scan.wallet, mode: 'insensitive' } },
          select: { id: true },
        });
        if (!wallet) {
          outcome.skipped.push({ protocolSlug: scan.protocolSlug, reason: 'wallet_not_registered' });
          continue;
        }
        const protocol = await prisma.protocol.findFirst({
          where: { slug: scan.protocolSlug },
          select: { id: true },
        });
        if (!protocol) {
          outcome.skipped.push({ protocolSlug: scan.protocolSlug, reason: 'protocol_not_seeded' });
          continue;
        }
        const chain = await prisma.chain.findUnique({
          where: { chainId: scan.chainId },
          select: { chainId: true },
        });
        if (!chain) {
          outcome.skipped.push({ protocolSlug: scan.protocolSlug, reason: 'chain_not_seeded' });
          continue;
        }

        // Infinity (no debt) must not reach PositionSnapshot.hf (Float?).
        const hf = Number.isFinite(scan.healthFactor) ? scan.healthFactor : null;

        const rows: Array<{ kind: 'SUPPLY' | 'BORROW'; amountUSD: number }> = [];
        if (scan.totalCollateralUSD > 0) rows.push({ kind: 'SUPPLY', amountUSD: scan.totalCollateralUSD });
        if (scan.totalDebtUSD > 0) rows.push({ kind: 'BORROW', amountUSD: scan.totalDebtUSD });
        if (rows.length === 0) {
          outcome.skipped.push({ protocolSlug: scan.protocolSlug, reason: 'empty_position' });
          continue;
        }

        for (const row of rows) {
          const metadata = {
            aggregate: true,
            source: 'position-scan',
            protocolName: scan.protocolName,
            totalCollateralUSD: scan.totalCollateralUSD,
            totalDebtUSD: scan.totalDebtUSD,
            availableBorrowUSD: scan.availableBorrowUSD,
            ltv: scan.ltv,
            liquidationThreshold: scan.liquidationThreshold,
            healthFactor: hf,
          };

          // Position has no natural-key unique constraint → findFirst-then-write.
          const existing = await prisma.position.findFirst({
            where: {
              walletId: wallet.id,
              protocolId: protocol.id,
              chainId: scan.chainId,
              kind: row.kind,
              asset: AGGREGATE_ASSET,
            },
            select: { id: true },
          });

          const position = existing
            ? await prisma.position.update({
                where: { id: existing.id },
                data: { amountUSD: String(row.amountUSD), metadata, closedAt: null },
              })
            : await prisma.position.create({
                data: {
                  walletId: wallet.id,
                  protocolId: protocol.id,
                  chainId: scan.chainId,
                  kind: row.kind,
                  asset: AGGREGATE_ASSET,
                  amount: '0', // aggregated row — no per-asset amount; USD drives the series
                  amountUSD: String(row.amountUSD),
                  metadata,
                },
              });

          await prisma.positionSnapshot.create({
            data: {
              positionId: position.id,
              amount: '0',
              amountUSD: String(row.amountUSD),
              priceUSD: '0',
              hf,
              ltv: scan.ltv,
              metricsJson: {
                source: 'position-scan',
                kind: row.kind,
                totalCollateralUSD: scan.totalCollateralUSD,
                totalDebtUSD: scan.totalDebtUSD,
                availableBorrowUSD: scan.availableBorrowUSD,
                liquidationThreshold: scan.liquidationThreshold,
                healthFactor: hf,
              },
            },
          });
          outcome.persisted += 1;
        }
      } catch (err) {
        outcome.skipped.push({
          protocolSlug: scan.protocolSlug,
          reason: `write_failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    return outcome;
  }
}

export const positionPersistenceService = new PositionPersistenceService();

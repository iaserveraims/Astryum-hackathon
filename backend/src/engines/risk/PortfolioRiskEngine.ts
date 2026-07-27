import type { PortfolioSnapshot } from '../portfolio/SnapshotBuilder';
import { classifyRiskLevel, RiskSnapshot, hfToScore } from './types';
import { LendingRiskEngine } from './LendingRiskEngine';
import { LPRiskEngine } from './LPRiskEngine';

const STABLE_SYMBOLS = new Set(['USDT', 'USDC', 'USDT0', 'DAI', 'BUSD', 'USDF']);

/**
 * Aggregates per-position risk into a single portfolio-level RiskSnapshot.
 *
 * Score components (weighted):
 *  - 60% lending HF (worst HF across borrows)
 *  - 20% concentration (top1 asset share)
 *  - 10% protocol concentration
 *  - 10% LP out-of-range count
 */
export class PortfolioRiskEngine {
  static evaluate(snapshot: PortfolioSnapshot): RiskSnapshot {
    const warnings: string[] = [];
    const assumptions: string[] = [];

    let worstHF: number | undefined;
    // Liquidation figures of the worst-HF lending ACCOUNT — the portfolio's
    // binding constraint (the first position to liquidate). One account spans
    // two legs with the same HF: the SUPPLY leg carries the liquidation price,
    // the BORROW leg the USD distance — merge across ties instead of dropping.
    let worstLiqPriceUSD: number | undefined;
    let worstLiqDistanceUSD: number | undefined;
    let worstLiqDistancePct: number | undefined;
    let totalDebt = snapshot.debtUSD;
    let totalCollateral = snapshot.collateralUSD;
    let outOfRangeCount = 0;

    for (const p of snapshot.positions) {
      if (p.kind === 'BORROW' || p.kind === 'SUPPLY') {
        const r = LendingRiskEngine.evaluate(
          {
            protocolId: p.protocolId,
            chainId: p.chainId,
            wallet: snapshot.wallet,
            kind: p.kind,
            asset: p.asset,
            amount: BigInt(p.amount),
            amountUSD: p.amountUSD,
            priceUSD: p.priceUSD,
            metadata: p.metadata,
            takenAt: p.takenAt,
          },
          p.metrics
        );
        if (r.healthFactor !== undefined) {
          // Relative tolerance: both legs of one account compute the same HF
          // through different float paths — treat near-equal as the same account.
          const tiesWorst =
            worstHF !== undefined &&
            Math.abs(r.healthFactor - worstHF) <= Math.abs(worstHF) * 1e-9;
          if (worstHF === undefined || (r.healthFactor < worstHF && !tiesWorst)) {
            worstHF = r.healthFactor;
            worstLiqPriceUSD = r.liquidationPriceUSD;
            worstLiqDistanceUSD = r.liquidationDistanceUSD;
            worstLiqDistancePct = r.liquidationDistancePct;
          } else if (tiesWorst) {
            worstLiqPriceUSD ??= r.liquidationPriceUSD;
            worstLiqDistanceUSD ??= r.liquidationDistanceUSD;
            worstLiqDistancePct ??= r.liquidationDistancePct;
          }
        }
      } else if (p.kind === 'LP') {
        const r = LPRiskEngine.evaluate(
          {
            protocolId: p.protocolId,
            chainId: p.chainId,
            wallet: snapshot.wallet,
            kind: p.kind,
            asset: p.asset,
            amount: BigInt(p.amount),
            amountUSD: p.amountUSD,
            priceUSD: p.priceUSD,
            metadata: p.metadata,
            takenAt: p.takenAt,
          },
          p.metrics
        );
        if (r.riskScore >= 50) outOfRangeCount += 1;
      }
    }

    // Concentration by asset (top 1 share over total)
    const total = snapshot.totalUSD || 1;
    const assetShares = Object.values(snapshot.breakdown.byAsset)
      .map((v) => Math.abs(v) / total);
    const topAssetShare = assetShares.length ? Math.max(...assetShares) : 0;

    // Concentration by protocol
    const protoShares = Object.values(snapshot.breakdown.byProtocol)
      .map((v) => Math.abs(v) / total);
    const topProtoShare = protoShares.length ? Math.max(...protoShares) : 0;

    // Stablecoin exposure (informational)
    let stableUSD = 0;
    for (const p of snapshot.positions) {
      const sym = String(p.metadata?.symbol ?? '').toUpperCase();
      if (STABLE_SYMBOLS.has(sym) && p.kind !== 'BORROW') {
        stableUSD += p.amountUSD;
      }
    }
    const stableShare = total > 0 ? stableUSD / total : 0;

    // Composite score
    const hfComp = hfToScore(worstHF);
    const assetConcComp = Math.min(100, Math.max(0, (topAssetShare - 0.5) * 200));
    const protoConcComp = Math.min(100, Math.max(0, (topProtoShare - 0.5) * 200));
    const lpComp = Math.min(100, outOfRangeCount * 25);

    const score =
      hfComp * 0.6 +
      assetConcComp * 0.2 +
      protoConcComp * 0.1 +
      lpComp * 0.1;

    const drivers = [
      { name: 'lending-hf', contribution: 0.6 },
      { name: 'asset-concentration', contribution: 0.2 },
      { name: 'protocol-concentration', contribution: 0.1 },
      { name: 'lp-out-of-range', contribution: 0.1 },
    ];

    if (worstHF !== undefined && worstHF < 1.3) {
      warnings.push(`worst HF ${worstHF.toFixed(2)} below 1.3`);
    }
    if (topAssetShare > 0.8) {
      warnings.push(`asset concentration ${(topAssetShare * 100).toFixed(0)}% above 80%`);
    }
    if (totalDebt > totalCollateral && totalCollateral > 0) {
      warnings.push('debt exceeds collateral');
    }

    assumptions.push('IL not modeled in V1');
    assumptions.push('score weights: HF=60%, assetConc=20%, protoConc=10%, LP=10%');

    return {
      scope: 'PORTFOLIO',
      scopeId: snapshot.wallet,
      healthFactor: worstHF,
      // Liquidation figures of the binding (worst-HF) lending account: the
      // portfolio liquidates when ITS first position does. Undefined when no
      // position reports them.
      liquidationPriceUSD: worstLiqPriceUSD,
      liquidationDistanceUSD: worstLiqDistanceUSD,
      liquidationDistancePct: worstLiqDistancePct,
      ltv: totalCollateral > 0 ? totalDebt / totalCollateral : undefined,
      collateralBufferUSD:
        worstHF !== undefined && totalDebt > 0
          ? Math.max(0, totalDebt * (worstHF - 1))
          : undefined,
      riskLevel: classifyRiskLevel(Math.round(score)),
      riskScore: Math.round(score),
      warnings,
      assumptions: [
        ...assumptions,
        `stablecoin-exposure: ${(stableShare * 100).toFixed(1)}%`,
      ],
      drivers,
      computedAt: new Date(),
    };
  }
}

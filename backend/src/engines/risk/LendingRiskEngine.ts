import type {
  NormalizedPosition,
  PositionMetrics,
} from '../../types/domain/Position';
import {
  classifyRiskLevel,
  hfToScore,
  RiskSnapshot,
} from './types';

/**
 * Position-level risk for lending positions (SUPPLY/BORROW).
 *
 * Source-of-truth precedence (R8):
 *   1. metrics.hf from adapter (protocol-native if available)
 *   2. derived from collateral/debt USD (assumption flagged)
 *   3. unknown (warning, no false safety)
 */
export class LendingRiskEngine {
  static evaluate(
    position: NormalizedPosition,
    metrics: PositionMetrics
  ): RiskSnapshot {
    const warnings: string[] = [];
    const assumptions: string[] = [];

    const hf = metrics.hf;
    const ltv = metrics.ltv;

    if (hf === undefined && position.kind === 'BORROW') {
      warnings.push('HF unknown — adapter did not return protocol-native metric');
      assumptions.push('inferred-from-balances');
    }

    let liquidationDistanceUSD: number | undefined;
    let liquidationDistancePct: number | undefined;
    let collateralBufferUSD: number | undefined;

    if (
      position.kind === 'BORROW' &&
      position.amountUSD > 0 &&
      hf !== undefined
    ) {
      // Distance to HF=1 in USD-equivalent of additional debt or collateral loss
      collateralBufferUSD = Math.max(0, position.amountUSD * (hf - 1));
      liquidationDistanceUSD = collateralBufferUSD;
      liquidationDistancePct = (hf - 1) * 100;
    }

    const score = hfToScore(hf);
    const drivers = [
      {
        name: hf !== undefined ? 'health-factor' : 'no-hf-data',
        contribution: 1,
      },
    ];

    return {
      scope: 'POSITION',
      scopeId: `${position.protocolId}:${position.asset}:${position.kind}`,
      healthFactor: hf,
      ltv,
      liquidationDistanceUSD,
      liquidationDistancePct,
      // Exact liquidation price straight from the adapter (getMetrics), when it
      // resolved one (debt > 0, single collateral). The UI paints the concrete
      // price ("if XRP touches $X…") instead of only the USD distance.
      liquidationPriceUSD: metrics.liquidationPrice,
      collateralBufferUSD,
      riskLevel: classifyRiskLevel(score),
      riskScore: score,
      warnings,
      assumptions,
      drivers,
      computedAt: new Date(),
    };
  }
}

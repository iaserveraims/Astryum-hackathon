import type {
  NormalizedPosition,
  PositionMetrics,
} from '../../types/domain/Position';
import { classifyRiskLevel, RiskSnapshot } from './types';

/**
 * V1 minimal LP risk: in-range / out-of-range, no IL modeling.
 * Adapters should populate metrics.inRange. If absent → warning, score 0.
 */
export class LPRiskEngine {
  static evaluate(
    position: NormalizedPosition,
    metrics: PositionMetrics
  ): RiskSnapshot {
    const warnings: string[] = [];
    const assumptions: string[] = ['IL not modeled in V1'];

    const inRange = metrics.inRange;
    if (inRange === undefined) {
      warnings.push('LP range unknown — adapter did not report in-range metric');
    }

    // Score model: in-range = 0, out-of-range = 50 (WARNING)
    const score = inRange === false ? 50 : 0;

    return {
      scope: 'POSITION',
      scopeId: `${position.protocolId}:${position.asset}:LP`,
      riskLevel: classifyRiskLevel(score),
      riskScore: score,
      warnings,
      assumptions,
      drivers: [
        {
          name: inRange === false ? 'lp-out-of-range' : 'lp-in-range',
          contribution: 1,
        },
      ],
      computedAt: new Date(),
    };
  }
}

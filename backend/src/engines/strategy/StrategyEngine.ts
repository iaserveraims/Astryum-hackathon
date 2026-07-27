import { PortfolioEngine } from '../portfolio/PortfolioEngine';
import { RiskEngine } from '../risk/RiskEngine';
import { SimulationEngine } from '../simulation/SimulationEngine';
import type { PortfolioSnapshot } from '../portfolio/SnapshotBuilder';
import type { RiskSnapshot } from '../risk/types';

export type RecommendationKind =
  | 'repay'
  | 'addCollateral'
  | 'reduceConcentration'
  | 'exitOutOfRangeLP'
  | 'harvest'
  | 'noAction';

export interface StrategyRecommendation {
  kind: RecommendationKind;
  protocolId?: string;
  asset?: string;
  amountUSD?: number;
  reason: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  simulationResultId?: string;
  warnings?: string[];
}

const HF_DEFENSIVE_TARGET = 1.8;
const LTV_HIGH_THRESHOLD = 0.75;

/**
 * Deterministic strategy heuristics. NOT an AI.
 * Reads portfolio + risk → emits prioritized actions, attaching a SimulationResult
 * id when the recommendation is concrete enough to simulate.
 */
export class StrategyEngine {
  private static instance: StrategyEngine | null = null;
  static getInstance(): StrategyEngine {
    if (!this.instance) this.instance = new StrategyEngine();
    return this.instance;
  }

  /**
   * Detect defensive contextual signals against the portfolio.
   *
   * 2026-06-01 audit Cat 4.2: renamed from `recommendDefensive` to avoid the
   * "advice" framing under MiCA Article 3(1)(16)(8). The signals are
   * deterministic computations, not financial recommendations.
   * The old method name is kept as a thin alias for callers that haven't
   * migrated yet (MCP server, tests, etc.).
   */
  async detectDefensiveSignals(
    walletAddress: string,
    chainId: number = 14
  ): Promise<StrategyRecommendation[]> {
    const portfolio = await PortfolioEngine.getInstance().getPortfolio(
      walletAddress,
      chainId
    );
    const risk = RiskEngine.getInstance().evaluateSnapshot(portfolio);
    return this.recommendFromSnapshot(portfolio, risk);
  }

  /** @deprecated renamed to `detectDefensiveSignals` (2026-06-01 audit Cat 4.2). */
  async recommendDefensive(
    walletAddress: string,
    chainId: number = 14
  ): Promise<StrategyRecommendation[]> {
    return this.detectDefensiveSignals(walletAddress, chainId);
  }

  async recommendFromSnapshot(
    portfolio: PortfolioSnapshot,
    risk: RiskSnapshot
  ): Promise<StrategyRecommendation[]> {
    const recs: StrategyRecommendation[] = [];

    // 1. Critical HF → suggest repay first (no simulation here; SimulationEngine called by caller via /api/simulate/repay)
    if (
      risk.healthFactor !== undefined &&
      risk.healthFactor < HF_DEFENSIVE_TARGET
    ) {
      const borrows = portfolio.positions.filter((p) => p.kind === 'BORROW');
      for (const b of borrows) {
        const targetRepayUSD = Math.min(
          b.amountUSD,
          Math.max(0, b.amountUSD * (HF_DEFENSIVE_TARGET - risk.healthFactor) / HF_DEFENSIVE_TARGET)
        );
        recs.push({
          kind: 'repay',
          protocolId: b.protocolId,
          asset: b.asset,
          amountUSD: targetRepayUSD,
          reason: `HF ${risk.healthFactor.toFixed(2)} below target ${HF_DEFENSIVE_TARGET}; repay ≈ $${targetRepayUSD.toFixed(0)} of ${b.metadata?.symbol ?? 'debt'} to recover`,
          priority: risk.healthFactor < 1.2 ? 'CRITICAL' : 'HIGH',
        });
      }
    }

    // 2. LTV high → suggest addCollateral (pick stable + supplied asset already used)
    if (risk.ltv !== undefined && risk.ltv > LTV_HIGH_THRESHOLD) {
      const supplies = portfolio.positions.filter((p) => p.kind === 'SUPPLY');
      const top = supplies.sort((a, b) => b.amountUSD - a.amountUSD)[0];
      if (top) {
        recs.push({
          kind: 'addCollateral',
          protocolId: top.protocolId,
          asset: top.asset,
          reason: `LTV ${(risk.ltv * 100).toFixed(0)}% above ${(LTV_HIGH_THRESHOLD * 100).toFixed(0)}%; add ${top.metadata?.symbol ?? 'collateral'}`,
          priority: 'HIGH',
        });
      }
    }

    // 3. Out-of-range LPs → suggest exit
    for (const p of portfolio.positions) {
      if (p.kind === 'LP' && p.metrics?.inRange === false) {
        recs.push({
          kind: 'exitOutOfRangeLP',
          protocolId: p.protocolId,
          asset: p.asset,
          amountUSD: p.amountUSD,
          reason: `LP on ${p.protocolId} is out-of-range; consider exiting or rebalancing`,
          priority: 'MEDIUM',
        });
      }
    }

    // 4. Asset concentration → informational
    const total = portfolio.totalUSD || 1;
    for (const [asset, value] of Object.entries(portfolio.breakdown.byAsset)) {
      const share = Math.abs(value) / total;
      if (share > 0.7) {
        recs.push({
          kind: 'reduceConcentration',
          asset,
          reason: `${asset} represents ${(share * 100).toFixed(0)}% of portfolio; consider diversification`,
          priority: 'MEDIUM',
        });
      }
    }

    // 5. Pending rewards
    for (const p of portfolio.positions) {
      if (p.kind === 'REWARD' && p.amountUSD > 50) {
        recs.push({
          kind: 'harvest',
          protocolId: p.protocolId,
          asset: p.asset,
          amountUSD: p.amountUSD,
          reason: `Pending rewards ≈ $${p.amountUSD.toFixed(0)} on ${p.protocolId}`,
          priority: 'LOW',
        });
      }
    }

    if (recs.length === 0) {
      recs.push({
        kind: 'noAction',
        reason: 'Portfolio is stable; no defensive action needed',
        priority: 'INFO',
      });
    }

    return recs;
  }
}

void SimulationEngine;

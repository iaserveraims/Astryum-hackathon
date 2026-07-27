import { PortfolioEngine } from '../portfolio/PortfolioEngine';
import { LendingRiskEngine } from './LendingRiskEngine';
import { LPRiskEngine } from './LPRiskEngine';
import { PortfolioRiskEngine } from './PortfolioRiskEngine';
import { PortfolioSnapshot } from '../portfolio/SnapshotBuilder';
import type { RiskSnapshot } from './types';

export interface MarketDropResult {
  wallet: string;
  chainId: number;
  dropPct: number;
  asset?: string;
  before: RiskSnapshot;
  after: RiskSnapshot;
  newHFsByPosition: { positionId: string; before?: number; after?: number }[];
  computedAt: Date;
}

export class RiskEngine {
  private static instance: RiskEngine | null = null;
  static getInstance(): RiskEngine {
    if (!this.instance) this.instance = new RiskEngine();
    return this.instance;
  }

  /** Risk for a single position resolved within a fresh portfolio snapshot. */
  async getPositionRisk(
    wallet: string,
    chainId: number,
    positionId: string
  ): Promise<RiskSnapshot | null> {
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(
      wallet,
      chainId
    );
    const target = snapshot.positions.find(
      (p) => `${p.protocolId}:${p.asset}:${p.kind}` === positionId
    );
    if (!target) return null;

    if (target.kind === 'LP') {
      return LPRiskEngine.evaluate(
        toNormalized(target, wallet),
        target.metrics
      );
    }
    if (target.kind === 'BORROW' || target.kind === 'SUPPLY') {
      return LendingRiskEngine.evaluate(
        toNormalized(target, wallet),
        target.metrics
      );
    }
    // STAKE/REWARD/FREE → no specific risk in V1
    return {
      scope: 'POSITION',
      scopeId: positionId,
      riskLevel: 'SAFE',
      riskScore: 0,
      warnings: [],
      assumptions: [`kind ${target.kind} has no specific V1 risk model`],
      drivers: [],
      computedAt: new Date(),
    };
  }

  /** Aggregated portfolio risk. */
  async getPortfolioRisk(
    wallet: string,
    chainId: number = 14
  ): Promise<RiskSnapshot> {
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(
      wallet,
      chainId
    );
    return PortfolioRiskEngine.evaluate(snapshot);
  }

  /** Same as portfolio risk but accepts a pre-computed snapshot. */
  evaluateSnapshot(snapshot: PortfolioSnapshot): RiskSnapshot {
    return PortfolioRiskEngine.evaluate(snapshot);
  }

  /**
   * Stress test: shock prices of `asset` (or all non-stable assets if undefined)
   * down by `dropPct` percent and recompute risk.
   *
   * Pure recompute on a cloned snapshot — no on-chain calls.
   */
  async simulateMarketDrop(
    wallet: string,
    chainId: number,
    dropPct: number,
    asset?: string
  ): Promise<MarketDropResult> {
    if (dropPct <= 0 || dropPct >= 100) {
      throw new Error(`dropPct must be in (0, 100), got ${dropPct}`);
    }
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(
      wallet,
      chainId
    );
    const before = PortfolioRiskEngine.evaluate(snapshot);

    const factor = 1 - dropPct / 100;
    const shocked: PortfolioSnapshot = JSON.parse(
      JSON.stringify(snapshot, (_k, v) =>
        typeof v === 'bigint' ? v.toString() : v
      )
    );
    // dates lose Date type after JSON round-trip; restore takenAt
    shocked.takenAt = new Date(snapshot.takenAt);

    let totalUSD = 0;
    let collateralUSD = 0;
    let debtUSD = 0;
    const byProtocol: Record<string, number> = {};
    const byAsset: Record<string, number> = {};
    const byKind: Record<string, number> = {
      SUPPLY: 0,
      BORROW: 0,
      LP: 0,
      STAKE: 0,
      REWARD: 0,
      FREE: 0,
    };
    const newHFsByPosition: MarketDropResult['newHFsByPosition'] = [];

    for (const p of shocked.positions) {
      const symbol = String(p.metadata?.symbol ?? '').toUpperCase();
      const isStable = ['USDT', 'USDC', 'USDT0', 'DAI'].includes(symbol);
      const targetMatch =
        asset === undefined
          ? !isStable
          : p.asset.toLowerCase() === asset.toLowerCase() || symbol === asset.toUpperCase();
      if (targetMatch) {
        p.amountUSD = p.amountUSD * factor;
        p.priceUSD = p.priceUSD * factor;
      }

      const sign = p.kind === 'BORROW' ? -1 : 1;
      const signed = sign * p.amountUSD;
      byProtocol[p.protocolId] = (byProtocol[p.protocolId] ?? 0) + signed;
      byAsset[p.asset] = (byAsset[p.asset] ?? 0) + signed;
      byKind[p.kind] = (byKind[p.kind] ?? 0) + p.amountUSD;

      if (p.kind === 'BORROW') debtUSD += p.amountUSD;
      else if (p.kind === 'SUPPLY' || p.kind === 'STAKE' || p.kind === 'LP') {
        collateralUSD += p.amountUSD;
      }
      if (p.kind !== 'BORROW') totalUSD += p.amountUSD;

      // Recompute per-position HF if metrics had hf and this is a BORROW
      if (p.kind === 'BORROW' && p.metrics?.hf !== undefined && p.amountUSD > 0) {
        // Naive proportional recompute: HF scales with collateral/debt USD ratio change.
        // After the shock, collateral that backs this debt has shrunk by `factor` for non-stable assets.
        // Because we cannot per-debt attribute collateral here, use ratio collateralUSD/debtUSD.
        const newHF = debtUSD > 0 ? (collateralUSD * 0.7) / debtUSD : undefined;
        newHFsByPosition.push({
          positionId: `${p.protocolId}:${p.asset}:${p.kind}`,
          before: p.metrics.hf,
          after: newHF,
        });
        if (p.metrics) p.metrics.hf = newHF;
      }
    }

    shocked.totalUSD = totalUSD;
    shocked.collateralUSD = collateralUSD;
    shocked.debtUSD = debtUSD;
    shocked.netWorthUSD = totalUSD - debtUSD;
    shocked.breakdown = { byProtocol, byAsset, byKind: byKind as any };

    const after = PortfolioRiskEngine.evaluate(shocked);

    return {
      wallet,
      chainId,
      dropPct,
      asset,
      before,
      after,
      newHFsByPosition,
      computedAt: new Date(),
    };
  }
}

function toNormalized(p: any, wallet: string) {
  return {
    protocolId: p.protocolId,
    chainId: p.chainId,
    wallet,
    kind: p.kind,
    asset: p.asset,
    amount: typeof p.amount === 'string' ? BigInt(p.amount) : p.amount,
    amountUSD: p.amountUSD,
    priceUSD: p.priceUSD,
    metadata: p.metadata,
    takenAt: p.takenAt,
  };
}

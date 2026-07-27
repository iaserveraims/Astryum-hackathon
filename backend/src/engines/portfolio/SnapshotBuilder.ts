import type {
  NormalizedPosition,
  PositionMetrics,
  PositionKind,
} from '../../types/domain/Position';
import { deduplicateLSTPositions } from '../../control-plane/LSTReceiptMap';

export interface PortfolioPositionEntry {
  protocolId: string;
  chainId: number;
  kind: PositionKind;
  asset: string;
  amount: string; // bigint serialized
  amountUSD: number;
  priceUSD: number;
  metrics: PositionMetrics;
  metadata: Record<string, unknown>;
  takenAt: Date;
}

export interface PortfolioBreakdown {
  byProtocol: Record<string, number>;
  byAsset: Record<string, number>;
  byKind: Record<PositionKind, number>;
}

export interface PortfolioSnapshot {
  wallet: string;
  chainId: number;
  totalUSD: number;
  collateralUSD: number;
  debtUSD: number;
  netWorthUSD: number;
  positions: PortfolioPositionEntry[];
  breakdown: PortfolioBreakdown;
  takenAt: Date;
}

export interface SnapshotInput {
  wallet: string;
  chainId: number;
  normalized: NormalizedPosition[];
  metrics: PositionMetrics[]; // index-aligned with normalized
}

export class SnapshotBuilder {
  static build(input: SnapshotInput): PortfolioSnapshot {
    const { wallet, chainId, normalized, metrics } = input;
    const now = new Date();
    const rawPositions: PortfolioPositionEntry[] = normalized.map((n, i) => ({
      protocolId: n.protocolId,
      chainId: n.chainId,
      kind: n.kind,
      asset: n.asset,
      amount: n.amount.toString(),
      amountUSD: n.amountUSD,
      priceUSD: n.priceUSD,
      metrics: metrics[i] ?? {},
      metadata: n.metadata,
      takenAt: n.takenAt,
    }));

    // Remove underlying FREE positions already represented as LST receipt tokens
    // (e.g. stETH covers ETH, sFLR covers FLR) to prevent double-counting.
    const positions = deduplicateLSTPositions(rawPositions);

    const byProtocol: Record<string, number> = {};
    const byAsset: Record<string, number> = {};
    const byKind: Record<PositionKind, number> = {
      SUPPLY: 0,
      BORROW: 0,
      LP: 0,
      STAKE: 0,
      REWARD: 0,
      FREE: 0,
      LOCKED: 0,
      CLAIM: 0,
    };

    let collateralUSD = 0;
    let debtUSD = 0;

    for (const p of positions) {
      // Borrow positions are debt (subtract); everything else is value held.
      const sign = p.kind === 'BORROW' ? -1 : 1;
      const signed = sign * p.amountUSD;

      byProtocol[p.protocolId] = (byProtocol[p.protocolId] ?? 0) + signed;
      byAsset[p.asset] = (byAsset[p.asset] ?? 0) + signed;
      byKind[p.kind] = (byKind[p.kind] ?? 0) + p.amountUSD;

      if (p.kind === 'BORROW') debtUSD += p.amountUSD;
      else if (p.kind === 'SUPPLY' || p.kind === 'STAKE' || p.kind === 'LP') {
        collateralUSD += p.amountUSD;
      }
    }

    const totalUSD = positions.reduce(
      (acc, p) => acc + (p.kind === 'BORROW' ? 0 : p.amountUSD),
      0
    );
    const netWorthUSD = totalUSD - debtUSD;

    return {
      wallet,
      chainId,
      totalUSD,
      collateralUSD,
      debtUSD,
      netWorthUSD,
      positions,
      breakdown: { byProtocol, byAsset, byKind },
      takenAt: now,
    };
  }
}

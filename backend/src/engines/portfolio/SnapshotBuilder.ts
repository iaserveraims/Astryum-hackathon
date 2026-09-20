import type {
  NormalizedPosition,
  PositionMetrics,
  PositionKind,
} from '../../types/domain/Position';
import { deduplicateLSTPositions } from '../../control-plane/LSTReceiptMap';
import type { UnreadableRead } from '../../connectors/protocols/IProtocolAdapter';

export interface PortfolioPositionEntry {
  protocolId: string;
  chainId: number;
  kind: PositionKind;
  asset: string;
  amount: string; // bigint serialized — BASE units, never a display figure
  /** La cantidad en unidades humanas, exacta. `null` cuando nadie pudo decir
   *  cuántos decimales tiene el activo: una cifra inventada es peor que
   *  ninguna. Es el ÚNICO campo de cantidad que una pantalla puede leer. */
  qty: string | null;
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
  /**
   * it. 31 — the protocols this sweep could NOT read (adapter threw or timed
   * out), each with the reason. A snapshot missing a protocol is not «nothing
   * held there»: it is «we could not look», and the person is owed that
   * sentence, not only the server log. Absent/empty when every adapter
   * answered. Travels through /api/portfolio as-is (the route serialises the
   * whole snapshot); a cached degraded snapshot keeps it too.
   */
  unreadable?: PortfolioUnreadableProtocol[];
}

/** One protocol the sweep could not read — named, with the adapter's own reason. */
export interface PortfolioUnreadableProtocol {
  protocolId: string;
  /** The adapter's error message, trimmed — «FIRELIGHT_QUEUE_UNREADABLE: …», «adapter kinetic timed out…». */
  reason: string;
  /**
   * Ola 0 (15-sep) — `true` when the adapter answered for SOME markets and
   * not others: its rows ARE in `positions` (a lower bound) and `reads` names
   * what could not be read. Absent/false = the whole adapter fell (no rows).
   */
  partial?: boolean;
  /** The reads that did not answer, one per market/period, with the node's reason. */
  reads?: UnreadableRead[];
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
      qty: n.qty ?? null,
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

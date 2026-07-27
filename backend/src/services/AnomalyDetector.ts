/**
 * AnomalyDetector — compares consecutive pool snapshots cycle-by-cycle.
 *
 * APY_SPIKE:    current APY ≥ 3× previous AND previous > 0.1  → warning (≥10× → blocked)
 * APY_COLLAPSE: current APY ≤ 20% of previous AND previous > 0.1 → warning
 * TVL_DRAIN:    current TVL ≤ 50% of previous AND previous > 100k → critical (≤10% → blocked)
 */

export type AnomalySeverity = 'warning' | 'critical' | 'blocked';
export type AnomalyKind = 'APY_SPIKE' | 'TVL_DRAIN' | 'APY_COLLAPSE';

export interface AnomalySignal {
  readonly poolId: string;
  readonly kind: AnomalyKind;
  readonly severity: AnomalySeverity;
  readonly previous: number;
  readonly current: number;
  readonly ratio: number;
  readonly detectedAt: string;
}

interface PoolSnapshot { apy: number; tvl: number; }

export class AnomalyDetector {
  private readonly _state = new Map<string, PoolSnapshot>();

  detect(poolId: string, current: PoolSnapshot): AnomalySignal[] {
    const previous = this._state.get(poolId);
    this._state.set(poolId, { apy: current.apy, tvl: current.tvl });
    if (!previous) return [];

    const signals: AnomalySignal[] = [];
    const now = new Date().toISOString();

    if (previous.apy > 0.1 && current.apy >= previous.apy * 3) {
      const ratio = current.apy / previous.apy;
      signals.push({ poolId, kind: 'APY_SPIKE', severity: ratio >= 10 ? 'blocked' : 'warning',
        previous: previous.apy, current: current.apy, ratio, detectedAt: now });
    }
    if (previous.apy > 0.1 && current.apy > 0 && current.apy <= previous.apy * 0.2) {
      signals.push({ poolId, kind: 'APY_COLLAPSE', severity: 'warning',
        previous: previous.apy, current: current.apy, ratio: current.apy / previous.apy, detectedAt: now });
    }
    if (previous.tvl > 100_000 && current.tvl <= previous.tvl * 0.5) {
      const ratio = current.tvl / previous.tvl;
      signals.push({ poolId, kind: 'TVL_DRAIN', severity: ratio <= 0.1 ? 'blocked' : 'critical',
        previous: previous.tvl, current: current.tvl, ratio, detectedAt: now });
    }
    return signals;
  }

  get snapshotCount(): number { return this._state.size; }
  reset(): void { this._state.clear(); }
}

export const anomalyDetector = new AnomalyDetector();

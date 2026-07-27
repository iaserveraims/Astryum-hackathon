export type RiskLevel = 'SAFE' | 'WATCH' | 'WARNING' | 'DANGER' | 'CRITICAL';

export interface RiskDriver {
  name: string;
  contribution: number; // 0..1, share of total risk score
}

export interface RiskSnapshot {
  scope: 'POSITION' | 'PORTFOLIO';
  scopeId: string;
  healthFactor?: number;
  ltv?: number;
  liquidationDistanceUSD?: number;
  liquidationDistancePct?: number;
  /**
   * Exact collateral price at which the position is liquidated (e.g. "if XRP
   * touches $X, you're liquidated"). Adapter-computed (getMetrics), surfaced here
   * so the UI can show the concrete price, not just the USD distance. Present only
   * when the adapter returns it (single-collateral lending positions with debt).
   */
  liquidationPriceUSD?: number;
  collateralBufferUSD?: number;
  riskLevel: RiskLevel;
  riskScore: number; // 0..100, 100 = worst
  warnings: string[];
  assumptions: string[];
  drivers: RiskDriver[];
  computedAt: Date;
}

export function classifyRiskLevel(score: number): RiskLevel {
  if (score >= 85) return 'CRITICAL';
  if (score >= 65) return 'DANGER';
  if (score >= 45) return 'WARNING';
  if (score >= 25) return 'WATCH';
  return 'SAFE';
}

/**
 * Map an HF threshold to a risk score component (0..100).
 * HF >= 2.0 → 0  ; HF == 1.0 → 100 ; below 1.0 → 100 (liquidatable)
 */
export function hfToScore(hf: number | undefined): number {
  if (hf === undefined) return 0;
  if (hf <= 1) return 100;
  if (hf >= 2) return 0;
  return Math.round(100 * (2 - hf));
}

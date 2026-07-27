/**
 * Calibrated Health-Factor → 0–100 score.
 *
 * The mapping is deliberately NOT linear-smooth: danger must be visible.
 * Liquidation happens at HF = 1.0, so the band just above it collapses the
 * score hard (HF 1.1 ≈ 10, not 36), and a leveraged position can never read
 * 100 — "100" is reserved for wallets with zero debt, where no liquidation
 * price exists. Anchors chosen against the Carry FXRP economics (entry HF
 * ≈ 3.33 at ratio 0.3, A1 protection trigger at HF 1.1).
 */

interface Anchor {
  hf: number;
  score: number;
}

// Piecewise-linear anchors (HF → score). Steep below 1.25, flattening above.
const ANCHORS: Anchor[] = [
  { hf: 1.0, score: 0 },
  { hf: 1.1, score: 10 },
  { hf: 1.25, score: 30 },
  { hf: 1.5, score: 55 },
  { hf: 2.0, score: 75 },
  { hf: 3.0, score: 88 },
  { hf: 5.0, score: 95 },
];
const MAX_WITH_DEBT = 97; // with debt outstanding the score never reads 100

export function healthScoreFromHF(hf: number | null | undefined, hasDebt: boolean): number | null {
  if (!hasDebt) return 100;
  if (hf == null || !Number.isFinite(hf)) return null;
  if (hf <= ANCHORS[0].hf) return 0;
  const last = ANCHORS[ANCHORS.length - 1];
  if (hf >= last.hf) return MAX_WITH_DEBT;
  for (let i = 1; i < ANCHORS.length; i++) {
    const a = ANCHORS[i - 1];
    const b = ANCHORS[i];
    if (hf <= b.hf) {
      const t = (hf - a.hf) / (b.hf - a.hf);
      return Math.round(a.score + t * (b.score - a.score));
    }
  }
  return MAX_WITH_DEBT;
}

export function healthWords(score: number | null, es: boolean): string {
  if (score == null) return es ? 'Sin lectura' : 'No reading';
  if (score >= 90) return es ? 'Sana' : 'Healthy';
  if (score >= 75) return es ? 'Estable' : 'Stable';
  if (score >= 55) return es ? 'Correcta' : 'OK';
  if (score >= 30) return es ? 'Vigilar' : 'Watch';
  if (score >= 10) return es ? 'Peligro' : 'Danger';
  return es ? 'Liquidación inminente' : 'Liquidation imminent';
}

export function healthTone(score: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score == null) return 'neutral';
  if (score >= 75) return 'success';
  if (score >= 30) return 'warning';
  return 'danger';
}

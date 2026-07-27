/**
 * preflight — the shape every flare-demo /prepare attaches under `preflight`
 * (invariant #11, "simulation before signature"). Mirror of
 * backend/src/services/flare/preparePreflight.ts:
 *   - available=false  → the dry-run itself could not run (node down / no
 *     `simulate`) — show the council-style "proceed with care" note, never block;
 *   - willSucceed=false → a PROVEN failure (revert / Kinetic error code / XRPL
 *     engine result) — the review must say so BEFORE the wallet opens.
 */

export interface PreflightStep {
  label: string;
  verdict: 'ok' | 'fail' | 'unverified';
  reason?: string;
}

export interface PreflightInfo {
  available: boolean;
  willSucceed: boolean;
  reason?: string;
  steps?: PreflightStep[];
  /** merged verdicts: one leg could not be simulated — an incomplete green that must say so. */
  partial?: boolean;
}

/** true only when the dry-run RAN and proved a failure — the case that must gate the sign button. */
export function preflightSaysFail(p: PreflightInfo | undefined | null): boolean {
  return !!p && p.available && !p.willSucceed;
}

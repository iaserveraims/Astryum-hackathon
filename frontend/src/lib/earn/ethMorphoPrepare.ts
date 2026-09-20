/**
 * ethMorphoPrepare — the PURE adapters between /api/eth-morpho responses and
 * DemoVaultModal's existing machinery (BuildSpec B5-UI paso 4).
 *
 * Three impedance mismatches, resolved here and tested, so the modal edits
 * stay thin:
 *   1. Units: the API takes/returns BASE units with decimals READ on-chain
 *      (FXRP 6 / RLUSD 18 — the F4 asymmetry). Humans type "12,5".
 *   2. Payload: the API returns legs {to,data,value,description} with ONE
 *      root chainId; the signing rail expects calls with chainId PER call.
 *   3. Pre-flight: the API's {ok, checks[]} + simulation legs vs the app-wide
 *      PreflightInfo that PreflightNotice/preflightSaysFail consume.
 */
import type { PreflightInfo, PreflightStep } from '../preflight';

/* ── 1 · Units ────────────────────────────────────────────────────────────── */

/**
 * "12,5" | "12.5" → base-unit decimal string for the given decimals.
 * Throws with a code on: empty, malformed, ≤ 0, more fractional digits than
 * the asset carries (never silently round money — R7.6).
 */
export function toBaseUnits(human: string, decimals: number): string {
  const normalized = human.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw Object.assign(new Error('AMOUNT_MALFORMED'), { code: 'AMOUNT_MALFORMED' });
  }
  const [whole, frac = ''] = normalized.split('.');
  if (frac.length > decimals) {
    throw Object.assign(
      new Error('AMOUNT_TOO_PRECISE'),
      { code: 'AMOUNT_TOO_PRECISE', data: { decimals } },
    );
  }
  const base = BigInt(whole + frac.padEnd(decimals, '0'));
  if (base <= BigInt(0)) {
    throw Object.assign(new Error('AMOUNT_NOT_POSITIVE'), { code: 'AMOUNT_NOT_POSITIVE' });
  }
  return base.toString();
}

/** Base-unit string → human string, trailing zeros trimmed, max `maxDp` shown. */
export function baseToHuman(base: string, decimals: number, maxDp = 4): string {
  const raw = BigInt(base);
  const negative = raw < BigInt(0);
  const abs = negative ? -raw : raw;
  const unit = BigInt(10) ** BigInt(decimals);
  const whole = abs / unit;
  const frac = (abs % unit).toString().padStart(decimals, '0').slice(0, maxDp).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/* ── 2 · Payload ──────────────────────────────────────────────────────────── */

export interface EmLeg {
  to: string;
  data: string;
  value: string;
  description: string;
}

export function emCallsFromLegs(
  legs: EmLeg[],
  chainId: number,
): Array<{ to: string; data: string; value: string; chainId: number; label: string }> {
  return legs.map((l) => ({
    to: l.to, data: l.data, value: l.value, chainId, label: l.description,
  }));
}

/* ── 3 · Pre-flight ───────────────────────────────────────────────────────── */

export interface EmPrepareEnvelope {
  preflight: {
    ok: boolean;
    checks: Array<{ name: string; ok: boolean; code?: string; message?: string }>;
  };
  simulation: {
    attempted: boolean;
    note?: string;
    legs: Array<{
      legIndex: number;
      description: string;
      status: 'ok' | 'revert' | 'depends_on_prior' | 'unavailable';
      revertReason?: string;
      note?: string;
    }>;
  };
}

/**
 * Server pre-flights ALWAYS run (that is the point: block before the wallet
 * opens), so `available` is true whenever the envelope exists. A simulated
 * revert or a failed check both prove failure; depends_on_prior/unavailable
 * legs make an honest PARTIAL green, never a full one.
 */
export function emPreflightInfo(prep: EmPrepareEnvelope): PreflightInfo {
  const checkSteps: PreflightStep[] = prep.preflight.checks.map((c) => ({
    label: c.name,
    verdict: c.ok ? 'ok' : 'fail',
    reason: c.ok ? undefined : (c.message ?? c.code),
  }));
  const simSteps: PreflightStep[] = prep.simulation.legs.map((l) => ({
    label: l.description,
    verdict: l.status === 'ok' ? 'ok' : l.status === 'revert' ? 'fail' : 'unverified',
    reason: l.status === 'revert' ? (l.revertReason ?? 'simulation reverted') : l.note,
  }));
  const failedCheck = prep.preflight.checks.find((c) => !c.ok);
  const revertedLeg = prep.simulation.legs.find((l) => l.status === 'revert');
  const willSucceed = prep.preflight.ok && !revertedLeg;
  return {
    available: true,
    willSucceed,
    reason: failedCheck?.message ?? failedCheck?.code ?? revertedLeg?.revertReason,
    // El codigo viaja aparte: es lo que la UI puede traducir con certeza.
    code: failedCheck?.code,
    steps: [...checkSteps, ...simSteps],
    partial: willSucceed && simSteps.some((s) => s.verdict === 'unverified'),
  };
}

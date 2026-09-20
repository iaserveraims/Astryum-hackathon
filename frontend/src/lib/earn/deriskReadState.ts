/**
 * deriskReadState — when may the guided unwind call a step «empty»?
 *
 * Why this exists (reviewer): PaActionsModal reads the LIVE Kinetic ISO
 * legs (`/flare-demo/iso-legs/:owner`). A failed read fell back to the props —
 * a portfolio snapshot that can be stale or empty — so step 3 could announce
 * «No FXRP collateral left — the unwind is complete» over 0 FXRP that was never
 * read. A step is empty only when the chain SAID so: a failed read is «I don't
 * know», it never auto-skips a step and never declares the unwind complete.
 */

export type DeriskStep = 1 | 2 | 3;

export function deriskStepIsEmpty(input: {
  step: DeriskStep;
  legsLoading: boolean;
  /** The live legs read failed (HTTP error, network, unreadable body). */
  legsReadFailed: boolean;
  suppliedUsdt0Human: number;
  debtHuman: number;
  supplyFxrpHuman: number;
}): boolean {
  if (input.legsLoading || input.legsReadFailed) return false;
  switch (input.step) {
    case 1:
      return input.suppliedUsdt0Human <= 0;
    case 2:
      return input.debtHuman <= 0;
    case 3:
      return input.supplyFxrpHuman <= 0;
    default:
      return false;
  }
}

/** Auto-advance (skip an empty or folded step) only runs on numbers the chain answered. */
export function deriskMayAutoAdvance(input: { legsLoading: boolean; legsReadFailed: boolean }): boolean {
  return !input.legsLoading && !input.legsReadFailed;
}

/* ── · La segunda puerta: un 200 tampoco es una lectura ───────────── */

/** The three live Kinetic ISO legs, exactly as the route serves them. */
export type IsoLegsBody = {
  supplyFxrpBase?: string | null;
  suppliedUsdt0Base?: string | null;
  debtUsdt0Base?: string | null;
};

/** A read that ANSWERED, or one that did not. Never a body folded into zeros. */
export type IsoLegsRead = { ok: true; legs: IsoLegsBody } | { ok: false };

/**
 * Read the body of GET /flare-demo/iso-legs/:owner, or refuse to call it a read.
 *
 * WHY. The guard above only ever learned about a failure through HTTP
 * (`!r.ok` / a network throw), so a 200 carrying nothing — the shape the route
 * produced while `balanceOf` was swallowed as `0n`, and the shape any proxy or
 * error envelope produces — walked straight through: the three fields came back
 * `undefined`, became 0, `deriskStepIsEmpty` said `true`, and step 3 told the
 * person «No FXRP collateral left — the unwind is complete» over a carry with
 * live debt.
 */
export function parseIsoLegs(body: unknown): IsoLegsRead {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  const keys = ['supplyFxrpBase', 'suppliedUsdt0Base', 'debtUsdt0Base'] as const;
  if (!keys.every((k) => k in b)) return { ok: false };
  const leg = (k: (typeof keys)[number]): string | null => {
    const v = b[k];
    if (v == null) return null;
    return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
  };
  return {
    ok: true,
    legs: {
      supplyFxrpBase: leg('supplyFxrpBase'),
      suppliedUsdt0Base: leg('suppliedUsdt0Base'),
      debtUsdt0Base: leg('debtUsdt0Base'),
    },
  };
}

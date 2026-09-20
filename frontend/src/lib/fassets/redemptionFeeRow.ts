/**
 * redemptionFeeRow — the FAssets redemption fee of ANY unmint/redeem, said
 * before the signature with the figure the backend read live (invariant #6).
 */

import { finiteOrNull, readPaDispatchFees, type FeeText } from '../wallet/paDispatchDisclosure';

export type { FeeText };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** A non-negative finite number, or null. A negative fee is not a fee we read. */
function nonNegative(v: number | null): number | null {
  return v != null && v >= 0 ? v : null;
}

/** A human decimal the backend sends as a string (or a number), or null. Never `Number('')` = 0. */
function humanNumberOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 6 dp (FXRP/XRP resolution), trailing zeros dropped. */
function round6(n: number): string {
  return (Math.round(n * 1e6) / 1e6).toString();
}

/** FXRP has 6 decimals: base units (UBA) → human, or null when it is not a positive integer string. */
function fxrpFromUba(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null;
  const n = Number(v) / 1e6;
  return n > 0 ? n : null;
}

export interface ExitXrpOut {
  /** FXRP this exit redeems, BEFORE the fee; null when the response does not say. */
  grossFxrp: number | null;
  /** The server's own estimate AFTER the fee; null when it stated none. */
  netXrp: number | null;
}

/**
 * The gross and the net of a pote-exit / pote-claim-exit response.
 *
 * The three shapes, in the order they are recognised:
 *  1. TRANSITION (backend): `xrpOutNetOfRedemptionFee: true` and no usable
 *     `xrpOutNetHuman` → `xrpOutHuman` is already NET. It is shown as the net and
 *     never has the fee taken out again; the gross is `exit.unmintUBA` (what the
 *     route actually unmints), or null. (A half-migrated response that repeats
 *     the same number in both fields is the same case.)
 *  2. CURRENT: `xrpOutHuman` is the GROSS and `xrpOutNetHuman` is the net, or
 *     null when the fee could not be read.
 *  3. OLDER: `xrpOutHuman` is the gross and there is no net at all.
 */
export function exitXrpOut(response: unknown): ExitXrpOut {
  const exit = asRecord(asRecord(response).exit);
  const out = humanNumberOf(exit.xrpOutHuman);
  const net = nonNegative(humanNumberOf(exit.xrpOutNetHuman));
  if (exit.xrpOutNetOfRedemptionFee === true && (net == null || net === out)) {
    return { grossFxrp: fxrpFromUba(exit.unmintUBA), netXrp: out != null && out >= 0 ? out : null };
  }
  return { grossFxrp: out, netXrp: net };
}

/**
 * The net the SERVER stated for this redemption, whatever the route:
 * institutional exits (`exit.xrpOutNetHuman`, or the transition shape) and the
 * Legacy yield claim (`disclosure.facts.estXrpOutNet`). Null when none.
 */
export function readServerNetXrp(response: unknown): number | null {
  const r = asRecord(response);
  if (r.exit && typeof r.exit === 'object') {
    const { netXrp } = exitXrpOut(r);
    if (netXrp != null) return netXrp;
  }
  return nonNegative(humanNumberOf(asRecord(asRecord(r.disclosure).facts).estXrpOutNet));
}

export interface RedemptionFeeFigures {
  /** Protocol parameter (`redemptionFeeBIPS`), or null when not read. */
  bips: number | null;
  /** That share of THIS redemption, in FXRP (human units), or null. */
  fxrp: number | null;
}

/**
 * The figures of a prepare response. Same reader as the 0xFE modal
 * (`readPaDispatchFees`: `disclosure` first, then the top level), plus the
 * `disclosure.facts` bag the institutional routes use.
 */
export function readRedemptionFeeFigures(response: unknown): RedemptionFeeFigures {
  const r = asRecord(response);
  const d = asRecord(r.disclosure);
  const facts = asRecord(d.facts);
  const fees = readPaDispatchFees(d, r);
  return {
    bips: nonNegative(fees.redemptionFeeBips ?? finiteOrNull(facts.redemptionFeeBips)),
    fxrp: nonNegative(fees.redemptionFeeFxrp ?? finiteOrNull(facts.redemptionFeeFxrp)),
  };
}

export type RedemptionFeeView =
  | {
      kind: 'figure';
      bips: number | null;
      /** Server figure, or `gross × bips` when only the parameter came back. */
      feeFxrp: number | null;
      /** Estimated XRP the agent sends: the server's net when it stated one, else gross − fee; null without either. */
      netXrp: number | null;
      grossFxrp: number | null;
    }
  | { kind: 'unreadable'; grossFxrp: number | null };

/** `grossFxrp` = what the surface redeems (FXRP burned = XRP asked for, before the fee). */
export function redemptionFeeView(response: unknown, grossFxrp: number | null): RedemptionFeeView {
  const gross = grossFxrp != null && Number.isFinite(grossFxrp) && grossFxrp >= 0 ? grossFxrp : null;
  const { bips, fxrp } = readRedemptionFeeFigures(response);
  // No figure: «could not be read — it is not zero». A net without a figure is a
  // contradiction in the response, not a licence to drop the caveat.
  if (bips == null && fxrp == null) return { kind: 'unreadable', grossFxrp: gross };
  const feeFxrp = fxrp ?? (gross != null && bips != null ? (gross * bips) / 10_000 : null);
  // The server's net IS the net: recomputing gross − fee beside it put a second,
  // slightly different figure on the same screen (R3 3.2).
  const serverNet = readServerNetXrp(response);
  const netXrp =
    serverNet ?? (gross != null && feeFxrp != null ? Math.max(0, Math.round((gross - feeFxrp) * 1e6) / 1e6) : null);
  return { kind: 'figure', bips, feeFxrp, netXrp, grossFxrp: gross };
}

export interface RedemptionFeeRows {
  kind: 'figure' | 'unreadable';
  /** The fee sentence — always present. */
  fee: FeeText;
  /** The amount the XRP destination gets: net when computable, gross + caveat otherwise; null without a gross. */
  amount: FeeText | null;
  /** When the XRP arrives: the FAssets agent pays it, minutes to hours later. */
  arrival: FeeText;
}

export const REDEMPTION_ARRIVAL_TEXT =
  'The XRP arrives when the FAssets agent pays it — minutes to hours after execution.';

export function redemptionFeeRowsOf(view: RedemptionFeeView): RedemptionFeeRows {
  const arrival: FeeText = { text: REDEMPTION_ARRIVAL_TEXT, params: {} };
  if (view.kind === 'unreadable') {
    return {
      kind: 'unreadable',
      fee: { text: 'FAssets redemption fee: could not be read — it is not zero', params: {} },
      amount:
        view.grossFxrp != null
          ? { text: '≈ {xrp} XRP before the redemption fee, which could not be read', params: { xrp: round6(view.grossFxrp) } }
          : null,
      arrival,
    };
  }
  const pct = view.bips != null ? String(view.bips / 100) : null;
  const feeFxrp = view.feeFxrp != null ? round6(view.feeFxrp) : null;
  let fee: FeeText;
  if (pct != null && feeFxrp != null) {
    fee = { text: 'FAssets redemption fee: {pct}% ≈ {fxrp} FXRP, paid out of the XRP the agent sends', params: { pct, fxrp: feeFxrp } };
  } else if (pct != null) {
    fee = { text: 'FAssets redemption fee: {pct}% of the amount, paid out of the XRP the agent sends', params: { pct } };
  } else {
    fee = { text: 'FAssets redemption fee: ≈ {fxrp} FXRP, paid out of the XRP the agent sends', params: { fxrp: feeFxrp as string } };
  }
  const amount: FeeText | null =
    view.netXrp != null ? { text: '≈ {xrp} XRP after the redemption fee', params: { xrp: round6(view.netXrp) } } : null;
  return { kind: 'figure', fee, amount, arrival };
}

export function redemptionFeeRows(response: unknown, grossFxrp: number | null): RedemptionFeeRows {
  return redemptionFeeRowsOf(redemptionFeeView(response, grossFxrp));
}

/**
 * What an institutional exit/claim review shows, from ONE reader: the gross it
 * hands to `RedemptionFeeNotice`, and the rows (null when the exit does not
 * unmint). PoteExitCard, TicketsBoard and VaultEntryModal all go through here, so
 * none of them parses `xrpOutHuman` on its own again.
 */
export function exitRedemption(
  handoff: unknown,
  unminted: boolean,
): { grossFxrp: number | null; rows: RedemptionFeeRows | null } {
  if (!handoff) return { grossFxrp: null, rows: null };
  const { grossFxrp } = exitXrpOut(handoff);
  return { grossFxrp, rows: unminted ? redemptionFeeRows(handoff, grossFxrp) : null };
}

/**
 * Does this prepare response redeem FXRP to native XRP, and for how much?
 * Read from what the backend COMPOSED, per route shape:
 *  - pote-exit / pote-claim-exit: `unminted === true` → the gross of `exitXrpOut`;
 *  - pa-withdraw-transfer / vault-claim / pa-unmint: `disclosure.fxrpRedeemed`;
 *  - wallet-transfer bridge/flare-to-xrpl (and PaActionsModal's EVM unmint):
 *    `disclosure.action` `bridge-redeem-fxrp` | `unmint-position` → `disclosure.amount`;
 *  - Legacy vault-yield claim: `redeemUBA` (6-decimals base units).
 */
export function redemptionOf(response: unknown): { redeems: boolean; grossFxrp: number | null } {
  const r = asRecord(response);
  const d = asRecord(r.disclosure);
  if (r.unminted === true) {
    return { redeems: true, grossFxrp: exitXrpOut(r).grossFxrp };
  }
  if (r.unminted === false) return { redeems: false, grossFxrp: null };
  const redeemed = finiteOrNull(d.fxrpRedeemed);
  if (redeemed != null) return { redeems: true, grossFxrp: redeemed };
  if (d.action === 'bridge-redeem-fxrp' || d.action === 'unmint-position' || d.action === 'withdraw-fxrp-unmint') {
    return { redeems: true, grossFxrp: finiteOrNull(d.amount) };
  }
  if (typeof r.redeemUBA === 'string' && /^\d+$/.test(r.redeemUBA)) {
    return { redeems: true, grossFxrp: Number(r.redeemUBA) / 1e6 };
  }
  return { redeems: false, grossFxrp: null };
}

/**
 * paDispatchDisclosure — what a Smart Account (0xFE) order may SAY about its
 * fees before the user signs, decided only by what the prepare returned
 * (invariant #6).
 *
 * WHAT WAS WRONG (productizer, 14-sep). The Send/Unmint modal rebuilt the
 * pa-unmint / pa-transfer disclosure on the client with `astryumFee: 0` and a
 * fixed «net cost ≈ 0.3 XRP», throwing away the real `mintingFeeXrp` /
 * `executorFeeXrp` the backend spreads in from `mintFeeDisclosure(net)`. A
 * figure the client invents is not a disclosure, and a missing figure is not 0.
 *
 * It also covers the balance reads that decide which asset may be offered:
 * «could not read» is never «zero», so a failed read must not hide the choice
 * and must never let an FXRP/FLR send slide into an XRP payment.
 *
 * Strings are English sources for `t()`; `{placeholders}` are filled by the caller.
 */

/** A finite number from an untyped disclosure field, or null ("not returned"). */
export function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface PaDispatchFees {
  /** XRP paid in the XRPL carrier Payment that steers the Smart Account. */
  carrierXrp: number | null;
  /** FAssets minting fee, in XRP (out of the carrier). */
  mintingFeeXrp: number | null;
  /** Executor fee, in XRP (out of the carrier). */
  executorFeeXrp: number | null;
  /** FXRP the carrier mints back into the user's own account. */
  returnsFxrp: number | null;
  /** Protocol redemption fee: `redemptionFeeBips` is the protocol parameter,
   *  `redemptionFeeFxrp` that share of THIS amount; each null when not read. */
  redemptionFeeXrp: number | null;
  redemptionFeeBips: number | null;
  redemptionFeeFxrp: number | null;
  /** Astryum's own fee, only when the server states one. */
  astryumFee: number | null;
  /** Both mint-coupled figures came back from the server. */
  known: boolean;
}

/**
 * `response` is the whole prepare body: the redemption-fee figures are read from
 * the disclosure first and, failing that, from the top level of the response.
 */
export function readPaDispatchFees(
  disclosure: Record<string, unknown> | null | undefined,
  response?: Record<string, unknown> | null,
): PaDispatchFees {
  const d = disclosure ?? {};
  const top = response ?? {};
  const mintingFeeXrp = finiteOrNull(d.mintingFeeXrp);
  const executorFeeXrp = finiteOrNull(d.executorFeeXrp);
  return {
    carrierXrp: finiteOrNull(d.mintCoupledXrp),
    mintingFeeXrp,
    executorFeeXrp,
    returnsFxrp: finiteOrNull(d.fxrpMintedSideEffect),
    redemptionFeeXrp: finiteOrNull(d.redemptionFeeXrp) ?? finiteOrNull(top.redemptionFeeXrp),
    redemptionFeeBips: finiteOrNull(d.redemptionFeeBips) ?? finiteOrNull(top.redemptionFeeBips),
    redemptionFeeFxrp: finiteOrNull(d.redemptionFeeFxrp) ?? finiteOrNull(top.redemptionFeeFxrp),
    astryumFee: finiteOrNull(d.astryumFee),
    known: mintingFeeXrp != null && executorFeeXrp != null,
  };
}

export interface FeeText {
  /** English source for t(). */
  text: string;
  params: Record<string, string>;
}

/**
 * The «Network fee» row of a 0xFE order. Real figures when the server sent them;
 * otherwise it says the figures are unavailable — never a number it did not read.
 */
export function paDispatchNetworkFee(fees: PaDispatchFees, fallbackCarrierXrp: number | null): FeeText {
  const carrier = fees.carrierXrp ?? fallbackCarrierXrp;
  const carrierStr = carrier != null ? String(carrier) : '?';
  if (fees.known) {
    const cost = (fees.mintingFeeXrp as number) + (fees.executorFeeXrp as number);
    return {
      text:
        fees.returnsFxrp != null
          ? 'Travels inside the {carrier} XRP dispatch you sign. Fees out of it: {minting} XRP minting + {executor} XRP executor = {cost} XRP; {returns} FXRP returns to your account.'
          : 'Travels inside the {carrier} XRP dispatch you sign. Fees out of it: {minting} XRP minting + {executor} XRP executor = {cost} XRP; the rest returns to your account as FXRP.',
      params: {
        carrier: carrierStr,
        minting: roundXrp(fees.mintingFeeXrp as number),
        executor: roundXrp(fees.executorFeeXrp as number),
        cost: roundXrp(cost),
        returns: fees.returnsFxrp != null ? roundXrp(fees.returnsFxrp) : '',
      },
    };
  }
  return {
    text: 'Travels inside the {carrier} XRP dispatch you sign. The server did not return the fee figures for this order — they are unavailable here, not zero.',
    params: { carrier: carrierStr },
  };
}

/**
 * The «Astryum fee» row. A stated figure is shown as such; with no stated figure
 * the row never says 0 — it points at the executor fee when that is known (the
 * inner batch of these orders carries no fee leg of Astryum's), or says the
 * figure is unavailable.
 */
export type AstryumFeeRow =
  | { kind: 'stated'; amount: number }
  | { kind: 'executor-listed' }
  | { kind: 'unavailable' };

export function astryumFeeRow(fees: PaDispatchFees): AstryumFeeRow {
  if (fees.astryumFee != null) return { kind: 'stated', amount: fees.astryumFee };
  if (fees.executorFeeXrp != null) return { kind: 'executor-listed' };
  return { kind: 'unavailable' };
}

/**
 * The redemption-fee row of an unmint: a figure only if the server sent one
 * (FXRP amount and/or protocol bips); none read → «could not be read», never 0.
 */
export function redemptionFeeRow(fees: PaDispatchFees): FeeText {
  if (fees.redemptionFeeFxrp != null && fees.redemptionFeeBips != null) {
    return {
      text: '{fxrp} FXRP ({pct}% of the amount), deducted by the FAssets protocol from the XRP the agent pays',
      params: { fxrp: roundXrp(fees.redemptionFeeFxrp), pct: String(fees.redemptionFeeBips / 100) },
    };
  }
  if (fees.redemptionFeeFxrp != null) {
    return { text: '{fxrp} FXRP, deducted by the FAssets protocol from the XRP the agent pays', params: { fxrp: roundXrp(fees.redemptionFeeFxrp) } };
  }
  if (fees.redemptionFeeXrp != null) {
    return { text: '{xrp} XRP, deducted by the FAssets protocol from the XRP the agent pays', params: { xrp: roundXrp(fees.redemptionFeeXrp) } };
  }
  if (fees.redemptionFeeBips != null) {
    return { text: '{pct}% of the amount, deducted by the FAssets protocol from the XRP the agent pays', params: { pct: String(fees.redemptionFeeBips / 100) } };
  }
  return {
    text: 'Deducted by the FAssets protocol from the XRP the agent pays — the figure could not be read, so no number is shown (it is not zero).',
    params: {},
  };
}

/* ── pa-unmint: does the FXRP the carrier mints really come back? ─────────── */

/**
 * WHAT WAS WRONG (productizer, 14-sep). The unmint review said «Returns to your
 * account ≈ X FXRP» for every order — also when the amount exceeds the free FXRP
 * and the redemption burns the FXRP this same dispatch mints (backend
 * `ridesOwnMint = amountUBA > freeUBA`, flareDemo.ts pa-unmint/prepare).
 */
export type PaUnmintReturn =
  /** The redemption is covered by free FXRP: what the carrier mints stays. */
  | { kind: 'returns'; fxrp: number }
  /** Part of what the carrier mints stays; the rest is burned. */
  | { kind: 'partial'; fxrp: number }
  /** Everything the carrier mints is burned in the redemption. */
  | { kind: 'none' }
  /** The redemption rides the mint, by an amount that could not be computed. */
  | { kind: 'consumed' }
  /** Nothing read says either way. */
  | { kind: 'unknown' };

/**
 * `ridesOwnMint` as the prepare exposes it. The backend computes it
 * (`amountUBA > freeUBA`, flareDemo.ts pa-unmint/prepare) and states it as
 * `disclosure.ridesOwnMint`: that boolean wins, then a top-level one.
 *
 * FALLBACK ONLY (productizer it. 12, finding 4.4 — deducing it from text is
 * fragile): a response without the field falls back to the preflight step of the
 * redeem — the backend marks it `unverified` («depends on an earlier step»)
 * exactly when it rides the mint, and dry-runs it (`ok` / `fail`) when free FXRP
 * already covers it. Anything else is null («could not be determined»).
 */
export function readRidesOwnMint(response: Record<string, unknown> | null | undefined): boolean | null {
  const r = response ?? {};
  const d = r.disclosure && typeof r.disclosure === 'object' ? (r.disclosure as Record<string, unknown>) : {};
  if (typeof d.ridesOwnMint === 'boolean') return d.ridesOwnMint;
  if (typeof r.ridesOwnMint === 'boolean') return r.ridesOwnMint;
  const pf = r.preflight && typeof r.preflight === 'object' ? (r.preflight as { steps?: unknown }) : null;
  const steps = Array.isArray(pf?.steps) ? (pf?.steps as Array<Record<string, unknown>>) : [];
  const redeem = steps.find((s) => s && typeof s.label === 'string' && /^redeem\b/i.test(s.label));
  if (!redeem) return null;
  if (redeem.verdict === 'unverified') {
    return typeof redeem.reason === 'string' && /earlier step/i.test(redeem.reason) ? true : null;
  }
  if (redeem.verdict === 'ok' || redeem.verdict === 'fail') return false;
  return null;
}

export function paUnmintReturn(input: {
  mintedFxrp: number | null;
  redeemedFxrp: number | null;
  ridesOwnMint: boolean | null;
  freeFxrp: number | null;
}): PaUnmintReturn {
  const { mintedFxrp, redeemedFxrp, freeFxrp } = input;
  if (mintedFxrp == null) return { kind: 'unknown' };
  let rides = input.ridesOwnMint;
  if (rides == null && freeFxrp != null && redeemedFxrp != null) rides = redeemedFxrp > freeFxrp;
  if (rides == null) return { kind: 'unknown' };
  if (!rides) return { kind: 'returns', fxrp: mintedFxrp };
  if (freeFxrp != null && redeemedFxrp != null) {
    const left = Math.round((freeFxrp + mintedFxrp - redeemedFxrp) * 1e6) / 1e6;
    if (left <= 0) return { kind: 'none' };
    return left >= mintedFxrp ? { kind: 'returns', fxrp: mintedFxrp } : { kind: 'partial', fxrp: left };
  }
  return { kind: 'consumed' };
}

/** The «Returns to your account» row, per decision. */
export function paUnmintReturnRow(r: PaUnmintReturn, mintedFxrp: number | null): FeeText {
  const minted = mintedFxrp != null ? roundXrp(mintedFxrp) : '?';
  switch (r.kind) {
    case 'returns':
      return { text: '≈ {fxrp} FXRP', params: { fxrp: roundXrp(r.fxrp) } };
    case 'partial':
      return { text: '≈ {fxrp} FXRP — the rest of what this dispatch mints is burned in the redemption', params: { fxrp: roundXrp(r.fxrp) } };
    case 'none':
      return { text: 'Nothing — the ≈ {minted} FXRP this dispatch mints is burned in the redemption', params: { minted } };
    case 'consumed':
      return { text: 'Not in full — this redemption burns some or all of the ≈ {minted} FXRP this dispatch mints', params: { minted } };
    default:
      return {
        text: 'Could not be determined — if the amount exceeds your free FXRP, the redemption burns the ≈ {minted} FXRP this dispatch mints',
        params: { minted },
      };
  }
}

/**
 * The network-fee sentence of a pa-unmint whose return is not «returns»: the
 * same real figures, without claiming the minted FXRP comes back.
 */
export function paUnmintNetworkFee(fees: PaDispatchFees, fallbackCarrierXrp: number | null, ret: PaUnmintReturn): FeeText {
  const base = paDispatchNetworkFee(fees, fallbackCarrierXrp);
  if (ret.kind === 'returns' || !fees.known) return base;
  return {
    text: 'Travels inside the {carrier} XRP dispatch you sign. Fees out of it: {minting} XRP minting + {executor} XRP executor = {cost} XRP; what it mints lands in your account first and counts toward this redemption — see «Returns to your account».',
    params: base.params,
  };
}

/** Fill `{name}` placeholders of an already-translated string. */
export function fillFeeText(translated: string, params: Record<string, string>): string {
  return Object.keys(params).reduce((acc, k) => acc.split(`{${k}}`).join(params[k]), translated);
}

function roundXrp(n: number): string {
  // 6 dp is XRP's resolution; trailing zeros dropped.
  return (Math.round(n * 1e6) / 1e6).toString();
}

/* ── balance reads that decide which asset may be offered ─────────────────── */

export type BalanceRead =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ok'; value: number; raw: string };

/**
 * `GET /network/balance` answers `{ ok, balance }`. Anything else — HTTP error,
 * `ok: false`, no balance, an unparsable number — is a failed read, never 0.
 */
export function parseNetworkBalance(httpOk: boolean, body: unknown): BalanceRead {
  if (!httpOk || !body || typeof body !== 'object') return { status: 'failed' };
  const b = body as { ok?: unknown; balance?: unknown };
  if (b.ok !== true || b.balance == null) return { status: 'failed' };
  const raw = String(b.balance);
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return { status: 'failed' };
  return { status: 'ok', value, raw };
}

export function balanceValue(r: BalanceRead): number {
  return r.status === 'ok' ? r.value : 0;
}

export type SmartAccountAsset = 'XRP' | 'FXRP' | 'FLR';

export interface AssetChoiceVerdict {
  /** A PROVEN zero under the picked asset: go back to XRP, visibly. */
  forceXrp: boolean;
  /** The picked asset's balance is not known: preparing is blocked (never slides to XRP). */
  blocked: null | 'loading' | 'failed';
}

export function assetChoiceVerdict(chosen: SmartAccountAsset, fxrp: BalanceRead, flr: BalanceRead): AssetChoiceVerdict {
  if (chosen === 'XRP') return { forceXrp: false, blocked: null };
  const r = chosen === 'FXRP' ? fxrp : flr;
  if (r.status === 'ok') return { forceXrp: r.value <= 0, blocked: null };
  if (r.status === 'failed') return { forceXrp: false, blocked: 'failed' };
  // idle (no Smart Account resolved yet) or loading: not known yet.
  return { forceXrp: false, blocked: 'loading' };
}

/* ── GET /flare-demo/pa-fxrp/:owner ────────────────────────────────────────── */

export interface PaFxrpRead {
  freeFxrp: number;
  redeemMinimumXrp: number | null;
}

/** null = could not read (HTTP error, network error or a body without `freeFxrp`). */
export function parsePaFxrpRead(httpOk: boolean, body: unknown): PaFxrpRead | null {
  if (!httpOk || !body || typeof body !== 'object') return null;
  const b = body as { freeFxrp?: unknown; redeemMinimumXrp?: unknown };
  const free = finiteOrNull(b.freeFxrp);
  if (free == null) return null;
  return { freeFxrp: free, redeemMinimumXrp: finiteOrNull(b.redeemMinimumXrp) };
}

/**
 * clientExitPlan — what the exchange client's «take out» may OFFER and PROMISE,
 * decided by the pote's policy and by what the backend composed.
 *
 * WHAT WAS WRONG (productizer, 14-sep). ClientApp went prepareRedeem →
 * preparePoteExitXrp → Face ID with nothing on screen but an estimate: neither
 * the redeem disclosure (with Astryum's fee tranche) nor the unmint disclosure
 * was shown before signing (invariant #6). And on a pote with an exit window
 * (`mode: 'request'`) the chosen destination was silently ignored — shares burn,
 * the amount is fixed in FXRP and is claimed at maturity into the Face ID
 * account — while the UI offered «to my own XRPL wallet» and the site promised
 * «one Face ID takes everything out… to your own wallet».
 *
 * Strings are English sources for `t()`; `{placeholders}` are filled by the caller.
 */

import type { Disclosure } from '../institutional/api';

export type ClientExitTo = 'exchange' | 'wallet' | 'keep';

export interface ExitDestinationOption {
  key: ClientExitTo;
  label: string;
  enabled: boolean;
  /** Why it is not offered — shown next to the disabled option. */
  reason: string | null;
}

export const WINDOW_REASON =
  'This pote has an exit window: the amount is fixed in FXRP and claimed at maturity into your Face ID account — it cannot go to the XRP Ledger in this signature.';
export const NO_WALLET_REASON = 'No XRPL wallet of yours on file yet — add it at the exchange first.';

/**
 * The destinations the exit button may offer. `cooldownSeconds` null = the
 * policy could not be read: everything stays offered and the review step
 * reconciles with the mode the backend actually composed.
 */
export function exitDestinationOptions(input: { cooldownSeconds: number | null | undefined; hasOwnWallet: boolean }): ExitDestinationOption[] {
  const windowed = typeof input.cooldownSeconds === 'number' && input.cooldownSeconds > 0;
  return [
    {
      key: 'exchange',
      label: 'to my slot at the exchange (with my tag)',
      enabled: !windowed,
      reason: windowed ? WINDOW_REASON : null,
    },
    {
      key: 'wallet',
      label: 'to my own XRPL wallet',
      enabled: !windowed && input.hasOwnWallet,
      reason: windowed ? WINDOW_REASON : input.hasOwnWallet ? null : NO_WALLET_REASON,
    },
    {
      key: 'keep',
      label: windowed ? 'as FXRP into my Face ID account, claimable at maturity' : 'keep as FXRP in my account',
      enabled: true,
      reason: null,
    },
  ];
}

/** The chosen destination if it is offered; otherwise the first offered one (never a disabled pick). */
export function pickExitTo(chosen: ClientExitTo, options: ExitDestinationOption[]): ClientExitTo {
  const hit = options.find((o) => o.key === chosen);
  if (hit?.enabled) return chosen;
  return options.find((o) => o.enabled)?.key ?? 'keep';
}

/** What the backend composition will really do with the chosen destination. */
export function effectiveExitTo(mode: string | undefined, chosen: ClientExitTo): ClientExitTo {
  return mode === 'request' ? 'keep' : chosen;
}

/** Astryum's service fee on the redeem, as the backend returned it. */
export interface RedeemFeeInfo {
  feeShares: string;
  bps: number;
  collector?: string;
}

export type ExitFeeStatement =
  | { kind: 'charged'; feeShares: string; bps: number }
  | { kind: 'none' }
  | { kind: 'unavailable' };

/**
 * `fee` is ALWAYS present in a pote-redeem response (routes/institutional.ts):
 * an object when a fee leg was composed, null when none was. A missing key is
 * «not returned», so it is said as unavailable — never as «no fee».
 */
export function exitFeeStatement(response: object): ExitFeeStatement {
  if (!('fee' in response)) return { kind: 'unavailable' };
  const fee = (response as { fee?: unknown }).fee;
  if (fee === null) return { kind: 'none' };
  if (fee && typeof fee === 'object') {
    const f = fee as { feeShares?: unknown; bps?: unknown };
    if (typeof f.feeShares === 'string' && typeof f.bps === 'number') return { kind: 'charged', feeShares: f.feeShares, bps: f.bps };
  }
  return { kind: 'unavailable' };
}

/**
 * The FAssets redemption fee of an unmint, as the prepare returned it. The
 * backend states it as `redemptionFeeBips` (the protocol parameter) and
 * `redemptionFeeFxrp` (that share of THIS amount), each nullable — top level or
 * inside `disclosure`. A figure that was not read is «could not be read», never 0.
 */
export type RedemptionFeeStatement =
  | { kind: 'figure'; fxrp: string | null; pct: string | null }
  | { kind: 'unreadable' };

/** A finite number from a JSON number or a plain decimal string; null otherwise. */
function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

/** 6 dp (FXRP's resolution), trailing zeros dropped. */
function trimAmount(n: number): string {
  return (Math.round(n * 1e6) / 1e6).toString();
}

export function redemptionFeeStatement(response: object | null | undefined): RedemptionFeeStatement {
  const r = (response ?? {}) as Record<string, unknown>;
  const d = r.disclosure && typeof r.disclosure === 'object' ? (r.disclosure as Record<string, unknown>) : {};
  const bips = numberOrNull(r.redemptionFeeBips) ?? numberOrNull(d.redemptionFeeBips);
  const fxrp = numberOrNull(r.redemptionFeeFxrp) ?? numberOrNull(d.redemptionFeeFxrp);
  if (bips == null && fxrp == null) return { kind: 'unreadable' };
  return { kind: 'figure', fxrp: fxrp != null ? trimAmount(fxrp) : null, pct: bips != null ? String(bips / 100) : null };
}

export interface ReviewSentence {
  /** English source for t(). */
  text: string;
  params: Record<string, string>;
}

/** The redemption-fee sentence: a number when one was read; otherwise «could not be read». */
export function redemptionFeeSentence(s: RedemptionFeeStatement): ReviewSentence {
  if (s.kind === 'figure') {
    if (s.fxrp != null && s.pct != null) {
      return { text: 'FAssets redemption fee: {fxrp} FXRP ({pct}% of the amount), deducted from the XRP the agent pays.', params: { fxrp: s.fxrp, pct: s.pct } };
    }
    if (s.fxrp != null) return { text: 'FAssets redemption fee: {fxrp} FXRP, deducted from the XRP the agent pays.', params: { fxrp: s.fxrp } };
    return { text: 'FAssets redemption fee: {pct}% of the amount, deducted from the XRP the agent pays.', params: { pct: s.pct as string } };
  }
  return {
    text: 'FAssets redemption fee: could not be read. It comes out of the XRP the agent pays — no number is shown because none was read, and it is not zero.',
    params: {},
  };
}

export interface ClientExitReview {
  mode: 'sync' | 'request';
  chosen: ClientExitTo;
  effective: ClientExitTo;
  /** The chosen destination will NOT be used (request mode) — said, not hidden. */
  destinationIgnored: boolean;
  /** One-sentence plain statement of what this signature does (English source). */
  headline: string;
  headlineParams: Record<string, string>;
  /** The backend's own disclosures, in the order they execute. */
  disclosures: Array<Pick<Disclosure, 'title' | 'lines'>>;
  fee: ExitFeeStatement;
  /** The unmint: what the FAssets side charges is not in these disclosures. */
  mentionsRedemptionFee: boolean;
  /** The unmint's redemption fee as the exit-xrp prepare stated it (null = no unmint). */
  redemptionFee: RedemptionFeeStatement | null;
}

export function buildClientExitReview(input: {
  mode: 'sync' | 'request';
  chosen: ClientExitTo;
  redeem: { disclosure?: Pick<Disclosure, 'title' | 'lines'> | null; fee?: RedeemFeeInfo | null; maturityISO?: string };
  exitXrp?: {
    disclosure?: Pick<Disclosure, 'title' | 'lines'> | null;
    /** Nullable redemption-fee figures of pote-exit-xrp/prepare (see redemptionFeeStatement). */
    redemptionFeeBips?: number | string | null;
    redemptionFeeFxrp?: number | string | null;
  } | null;
  /** Pre-formatted amounts (the caller owns decimals and symbol). */
  amounts: { estimate: string; unminted?: string; margin?: string; symbol: string };
}): ClientExitReview {
  const effective = effectiveExitTo(input.mode, input.chosen);
  const disclosures: Array<Pick<Disclosure, 'title' | 'lines'>> = [];
  if (input.redeem.disclosure) disclosures.push(input.redeem.disclosure);
  const unmints = input.mode === 'sync' && effective !== 'keep';
  if (unmints && input.exitXrp?.disclosure) disclosures.push(input.exitXrp.disclosure);

  let headline: string;
  const params: Record<string, string> = { estimate: input.amounts.estimate, symbol: input.amounts.symbol };
  if (input.mode === 'request') {
    params.maturity = input.redeem.maturityISO ?? '?';
    headline =
      'Your shares burn now and the amount is fixed at ≈ {estimate} {symbol}. It stays in FXRP and is claimable at maturity (≈ {maturity}) into your Flare account — this Face ID account. Nothing is sent to the XRP Ledger in this signature.';
  } else if (effective === 'keep') {
    headline = 'Redeems your shares now: ≈ {estimate} {symbol} lands as FXRP in your Face ID account.';
  } else {
    params.unminted = input.amounts.unminted ?? '?';
    params.margin = input.amounts.margin ?? '?';
    headline =
      effective === 'exchange'
        ? 'Redeems your shares and unmints ≈ {unminted} {symbol} to XRP, sent to your slot at the exchange with your tag. The {margin} {symbol} margin kept back stays as FXRP in your Face ID account.'
        : 'Redeems your shares and unmints ≈ {unminted} {symbol} to XRP, sent to your own XRPL wallet. The {margin} {symbol} margin kept back stays as FXRP in your Face ID account.';
  }

  return {
    mode: input.mode,
    chosen: input.chosen,
    effective,
    destinationIgnored: input.mode === 'request' && input.chosen !== 'keep',
    headline,
    headlineParams: params,
    disclosures,
    fee: exitFeeStatement(input.redeem),
    mentionsRedemptionFee: unmints,
    redemptionFee: unmints ? redemptionFeeStatement(input.exitXrp) : null,
  };
}

/** Fill `{name}` placeholders of an already-translated string. */
export function fillParams(s: string, params: Record<string, string>): string {
  return Object.keys(params).reduce((acc, k) => acc.split(`{${k}}`).join(params[k]), s);
}

/**
 * The site's promise (ExchangeClientSite hero): true for BOTH policies — the
 * immediate pote and the one with an exit window.
 *
 * WHAT WAS WRONG (productizer, 14-sep): it said «the money comes back in that
 * signature» and «Every fee is shown before you sign». The signature burns the
 * FXRP; the XRP is paid later by the FAssets agent (minutes to hours), and the
 * redemption fee is only a number when the prepare could read it.
 */
export const EXCHANGE_EXIT_PROMISE =
  'One Face ID starts your whole exit, and nobody has to approve it. In a pote without an exit window, that signature redeems your shares and burns the FXRP; the XRP reaches your slot at the exchange or your own wallet when the FAssets agent pays it — minutes to hours later. In a pote with one, your shares burn now, the amount is fixed in FXRP and you claim it into your Face ID account when the window ends. The fees Astryum composes are shown before you sign, including the FAssets redemption fee when it can be read.';

/* ── UserVaultPanel: the same prepare → review → Face ID, for four verbs ──── */

/**
 * WHAT WAS WRONG (productizer, 14-sep). UserVaultPanel (/app/earn-passkey,
 * GuidedDemo, InstitutionalV1Room) went compose → Face ID directly: the redeem's
 * disclosure and Astryum fee tranche, and the unmint's disclosure, were dropped
 * before signing — the bug ClientApp's exit already fixed.
 */
export type VaultVerb = 'deposit' | 'redeem' | 'unmint' | 'send';

export interface VaultActionReview {
  verb: VaultVerb;
  headline: string;
  headlineParams: Record<string, string>;
  /** The backend's own disclosure, when the verb is composed by the backend. */
  disclosures: Array<Pick<Disclosure, 'title' | 'lines'>>;
  fee: ExitFeeStatement;
  /** Only for the unmint. */
  redemptionFee: RedemptionFeeStatement | null;
}

function disclosureOf(response: object | null | undefined): Pick<Disclosure, 'title' | 'lines'> | null {
  const d = (response as { disclosure?: unknown } | null | undefined)?.disclosure as { title?: unknown; lines?: unknown } | undefined;
  if (!d || typeof d.title !== 'string' || !Array.isArray(d.lines)) return null;
  return { title: d.title, lines: d.lines.filter((l): l is string => typeof l === 'string') };
}

export function buildVaultActionReview(input: {
  verb: VaultVerb;
  /** The backend prepare response (redeem / unmint); client-composed verbs pass none. */
  response?: object | null;
  /** Pre-formatted amount (the caller owns decimals and symbol). */
  amount: string;
  symbol: string;
  destination?: string;
}): VaultActionReview {
  const { verb, response } = input;
  const params: Record<string, string> = { amount: input.amount, symbol: input.symbol, destination: input.destination ?? '?' };
  const d = disclosureOf(response);
  const disclosures = d ? [d] : [];
  if (verb === 'deposit' || verb === 'send') {
    // Composed in this browser: the batch on screen IS the whole batch, and it
    // carries no fee leg of Astryum's — said about these calls, nothing more.
    return {
      verb,
      headline:
        verb === 'deposit'
          ? 'Approves and deposits {amount} {symbol} from your Face ID account into this vault.'
          : 'Sends {amount} {symbol} from your Face ID account to {destination} on Flare.',
      headlineParams: params,
      disclosures,
      fee: { kind: 'none' },
      redemptionFee: null,
    };
  }
  if (verb === 'redeem') {
    const r = (response ?? {}) as { mode?: unknown; maturityISO?: unknown };
    const request = r.mode === 'request';
    if (request) params.maturity = typeof r.maturityISO === 'string' ? r.maturityISO : '?';
    return {
      verb,
      headline: request
        ? 'Your shares burn now and the amount is fixed at ≈ {amount} {symbol}. It stays in FXRP and is claimable at maturity (≈ {maturity}) into your Face ID account.'
        : 'Redeems all your shares now: ≈ {amount} {symbol} lands as FXRP in your Face ID account.',
      headlineParams: params,
      disclosures,
      fee: exitFeeStatement(response ?? {}),
      redemptionFee: null,
    };
  }
  return {
    verb,
    headline:
      'Burns {amount} {symbol} from your Face ID account in this signature. A FAssets agent then pays the XRP to {destination} — minutes to hours later, not in this signature.',
    headlineParams: params,
    disclosures,
    fee: exitFeeStatement(response ?? {}),
    redemptionFee: redemptionFeeStatement(response),
  };
}

/** The Astryum-fee sentence of a vault review. */
export function vaultFeeSentence(verb: VaultVerb, fee: ExitFeeStatement): ReviewSentence {
  if (fee.kind === 'charged') {
    return {
      text: 'Astryum service fee: {pct}% of your shares ({shares} base shares), deducted in this same signature.',
      params: { pct: String(fee.bps / 100), shares: fee.feeShares },
    };
  }
  if (fee.kind === 'none') {
    return verb === 'deposit' || verb === 'send'
      ? { text: 'Astryum service fee: none — these calls are composed in this browser and carry no fee leg.', params: {} }
      : { text: 'Astryum service fee: none composed in this exit.', params: {} };
  }
  return { text: 'Astryum service fee: the server did not return the figure — unavailable here, not zero.', params: {} };
}

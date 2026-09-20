/**
 * exitReadState — what an Ethereum exit screen does when a READ fails.
 *
 * Doctrine: the exit is never gated, and «could not read» is never shown as
 * «you have nothing». Two reads were dead ends (reviewer):
 */

export type EmDecimalsSide = 'collateral' | 'loan';

/** FXRP (collateral) 6 · RLUSD (loan) 18 — the documented F4 constants. */
export const EM_DOCUMENTED_DECIMALS: Readonly<Record<EmDecimalsSide, number>> = {
  collateral: 6,
  loan: 18,
};

export type DecimalsSource = 'market' | 'position' | 'documented';

export interface ResolvedDecimals {
  decimals: number;
  source: DecimalsSource;
}

const validDecimals = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 36;

/**
 * The decimals to convert with, and where they came from. The market read wins;
 * then a decimals figure another live read already returned (e.g. the vault's
 * `lentDecimals` from `/position`); then the documented constant.
 */
export function resolveExitDecimals(input: {
  side: EmDecimalsSide;
  /** `decimals` of a SUCCESSFUL `/eth-morpho/market` read; null when it failed. */
  market: { collateral?: unknown; loan?: unknown } | null | undefined;
  /** A decimals figure from another successful live read, if any. */
  positionDecimals?: number | null;
}): ResolvedDecimals {
  const fromMarket = input.market ? input.market[input.side] : undefined;
  if (validDecimals(fromMarket)) return { decimals: fromMarket, source: 'market' };
  if (validDecimals(input.positionDecimals)) return { decimals: input.positionDecimals, source: 'position' };
  return { decimals: EM_DOCUMENTED_DECIMALS[input.side], source: 'documented' };
}

export type DecimalsVerdict = 'ok' | 'mismatch' | 'unconfirmed';

/**
 * May the prepared transaction reach the review step?
 *  · the prepare reports different decimals than we converted with → 'mismatch'
 *    (the amount is wrong, whatever the source);
 *  · we did NOT read the market and the prepare does not report decimals →
 *    'unconfirmed' (a fallback nobody confirmed never reaches a signature);
 *  · otherwise 'ok'.
 */
export function decimalsVerdict(used: ResolvedDecimals, preparedDecimals: unknown): DecimalsVerdict {
  if (validDecimals(preparedDecimals)) {
    return preparedDecimals === used.decimals ? 'ok' : 'mismatch';
  }
  return used.source === 'market' ? 'ok' : 'unconfirmed';
}

/** English source for `t()` when the verdict refuses. Nothing was sent to the wallet. */
export function decimalsRefusalMessage(verdict: Exclude<DecimalsVerdict, 'ok'>): string {
  return verdict === 'mismatch'
    ? "The prepared transaction reports different token decimals than the amount was converted with, so it was stopped before your wallet. Nothing was sent — try again."
    : "Couldn't read the market data to convert your amount, and the prepared transaction did not confirm the token decimals, so it was stopped before your wallet. Nothing was sent — try again.";
}

/** English source for `t()`: the review says when the conversion used a confirmed fallback. */
export function decimalsFallbackNote(source: DecimalsSource): string | null {
  if (source === 'market') return null;
  return "Market data couldn't be read just now. Your amount was converted with the token's standard decimals (FXRP 6 · RLUSD 18) and the prepared transaction confirmed them on-chain.";
}

/** Transient HTTP answers: worth a Retry button. 451 and 4xx are not «a moment». */
export function isTransientStatus(status: number | null | undefined): boolean {
  return status == null || status === 408 || status === 429 || status >= 500;
}

/* ── The positions board ──────────────────────────────────────────────────── */

export type PositionReadFailureKind = 'region' | 'auth' | 'transient' | 'other';

/** Why a `/position` (or `/positions/:wallet`) read failed. `null` = network/timeout. */
export function positionReadFailureKind(status: number | null | undefined): PositionReadFailureKind {
  if (status === 451) return 'region';
  if (status === 401 || status === 403) return 'auth';
  if (isTransientStatus(status)) return 'transient';
  return 'other';
}

/** The `wallet` query param of a `/eth-morpho/position?wallet=…` URL, else null. */
export function positionWalletOf(url: string): string | null {
  if (!/\/eth-morpho\/position\?/.test(url)) return null;
  const m = /[?&]wallet=([^&#]*)/.exec(url);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/**
 * The board's empty state («No open DeFi positions yet») is only true when
 * every read ANSWERED. Any unreadable address, an unread vault leg or a board
 * error means «I don't know», which is never drawn as «nothing».
 */
export function boardShowsEmpty(input: {
  loading: boolean;
  error: string | null;
  positionsCount: number;
  unreadableCount: number;
  vaultLegUnread: boolean;
}): boolean {
  return (
    !input.loading &&
    !input.error &&
    input.positionsCount === 0 &&
    input.unreadableCount === 0 &&
    !input.vaultLegUnread
  );
}

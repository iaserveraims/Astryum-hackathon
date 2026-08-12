/**
 * Exact base-unit arithmetic for the cage's amounts.
 *
 * The council order rail speaks BASE UNITS (the contract's integers). A person
 * types "60". At 18 decimals that is 60000000000000000000 — a value no JS
 * number can hold, and `Number(...)` silently rounds it into a DIFFERENT order
 * than the one about to be signed by a quorum. So every conversion here runs on
 * bigint and strings, and nothing ever touches a float.
 *
 * This mirrors the backend's LegacyVaultStateService helpers deliberately: the
 * boundary between the two is HTTP, so the same rule has to hold on both sides.
 * The backend stays authoritative — these exist so the UI can show a person
 * what they are typing, in the units they think in.
 */

// The app compiles to ES2017, where BigInt LITERALS (`0n`) are a syntax error
// even though every browser we ship to has BigInt at runtime. Constructing the
// values keeps the exactness without dragging the whole app's target forward.
const ZERO = BigInt(0);
const TEN = BigInt(10);

/**
 * The cage's asset is FXRP — 6 decimals, verified on mainnet (backend
 * KineticIsoMath: FXRP UBA == XRP drops). ONE fallback for every Legacy
 * surface: two different guesses (18 vs 6) made sibling cards of the same
 * vault disagree by 10^12 whenever the chain read failed.
 */
export const LEGACY_ASSET_DECIMALS_FALLBACK = 6;

/** Accept the Spanish decimal comma: one comma and no dot reads as a decimal
 *  separator ("12,5" → "12.5"). Anything ambiguous is left for the validator. */
function normalizeDecimal(s: string): string {
  const v = String(s).trim();
  if (v.includes('.')) return v;
  return v.split(',').length - 1 === 1 ? v.replace(',', '.') : v;
}

/** Base units → a human decimal string, exact. Trailing zeros trimmed. */
export function formatBaseUnits(raw: bigint | string, decimals: number): string {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw || '0');
  if (decimals === 0) return v.toString();
  const neg = v < ZERO;
  const abs = neg ? -v : v;
  const base = TEN ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Base units → a SHORT human string for dense UI (grouped, capped decimals).
 *  Display only — never feed this back into an order. */
export function displayBaseUnits(raw: bigint | string, decimals: number, maxFrac = 4): string {
  const exact = formatBaseUnits(raw, decimals);
  const [whole, frac = ''] = exact.split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  const shown = frac.slice(0, maxFrac).replace(/0+$/, '');
  return shown ? `${grouped}.${shown}` : grouped;
}

/**
 * A human decimal string → base units, exact.
 *
 * Throws rather than rounding: an amount quietly truncated to the token's
 * precision is not the amount the person reviewed, and this value is minutes
 * away from a quorum signature.
 */
export function parseBaseUnits(human: string, decimals: number): bigint {
  const s = normalizeDecimal(human);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`"${human}" is not a positive decimal amount`);
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    throw new Error(`this token holds ${decimals} decimals — "${human}" would lose precision`);
  }
  const scaled = BigInt(whole) * TEN ** BigInt(decimals) + BigInt((frac || '0').padEnd(decimals, '0') || '0');
  if (scaled <= ZERO) throw new Error('amount must be greater than zero');
  return scaled;
}

/** Non-throwing form for live input validation (null while the user types). */
export function tryParseBaseUnits(human: string, decimals: number): bigint | null {
  try {
    return parseBaseUnits(human, decimals);
  } catch {
    return null;
  }
}

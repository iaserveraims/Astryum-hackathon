/**
 * exitRiskWarnings — the scanner verdict that travels WITH an exit prepare.
 *
 * Why this exists (reviewer, 14-sep): the Ethereum Morpho exits (close, repay,
 * withdraw_collateral, vault_withdraw, bridge back) no longer answer 409 when
 * GoPlus flags FXRP or RLUSD as DANGER — THE EXIT IS NEVER GATED, a flagged
 * token is exactly when a holder wants out. The verdict now rides in the 200 as
 * `riskWarnings`, and not a single screen rendered it: users signed an exit
 * with a flagged token without seeing anything. Invariant #10: the risk is
 * visible BEFORE the signature.
 *
 * Pure and defensive: the field is optional (absent when nothing is flagged),
 * and a malformed entry is dropped rather than rendered half-empty — but a
 * warning with a token and no flags still shows, because «flagged, reason
 * unknown» is still a warning.
 */

/** One DANGER finding, as the backend sends it (`KwyhRiskWarning`). */
export interface ExitRiskWarning {
  /** KWYH_DANGER_FXRP / KWYH_DANGER_RLUSD — the code an ENTRY would be refused with. */
  code: string;
  token: string;
  address: string;
  flags: string[];
  note: string;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * `riskWarnings` out of any prepare body. Never throws; returns [] when the
 * field is missing or not an array. Duplicate codes collapse to the first.
 */
export function parseRiskWarnings(body: unknown): ExitRiskWarning[] {
  if (!body || typeof body !== 'object') return [];
  const raw = (body as { riskWarnings?: unknown }).riskWarnings;
  if (!Array.isArray(raw)) return [];
  const out: ExitRiskWarning[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const w = item as Record<string, unknown>;
    const token = asString(w.token);
    const code = asString(w.code) || (token ? `KWYH_DANGER_${token.toUpperCase()}` : '');
    if (!token && !code) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({
      code,
      token: token || code.replace(/^KWYH_DANGER_/, ''),
      address: asString(w.address),
      flags: Array.isArray(w.flags) ? w.flags.map(asString).filter((f) => f.length > 0) : [],
      note: asString(w.note),
    });
  }
  return out;
}

/** GoPlus flag code → words: `is_honeypot` → `honeypot`, `cannot_sell_all` → `cannot sell all`. */
export function formatRiskFlag(flag: string): string {
  return flag
    .trim()
    .replace(/^is_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ExitRiskWarningView {
  key: string;
  token: string;
  /** Human flags joined, or null when the scanner sent none (still a warning). */
  flagsText: string | null;
  note: string | null;
  addressShort: string | null;
  /** Etherscan token page — the scan runs against chainId 1. */
  explorerUrl: string | null;
}

const EVM_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** What the warning box renders, one row per flagged token. */
export function riskWarningViews(warnings: ExitRiskWarning[]): ExitRiskWarningView[] {
  return warnings.map((w) => {
    const flags = Array.from(new Set(w.flags.map(formatRiskFlag).filter((f) => f.length > 0)));
    const validAddr = EVM_ADDR.test(w.address);
    return {
      key: w.code,
      token: w.token,
      flagsText: flags.length > 0 ? flags.join(' · ') : null,
      note: w.note || null,
      addressShort: validAddr ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}` : null,
      explorerUrl: validAddr ? `https://etherscan.io/token/${w.address}` : null,
    };
  });
}

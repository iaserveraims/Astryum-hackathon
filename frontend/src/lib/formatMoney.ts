/**
 * formatMoney — the ONE voice for money (de-AI pass 2026-07-21).
 *
 * The audit found SIX local formatters writing the same balance three ways
 * ($12.35K · $12,345.67 · $12345.67 — the last one without thousands
 * separators). Two explicit registers and nothing else:
 *
 *   formatMoney(v)        → "$12,345.67"  — tables, details, anywhere exact
 *   formatMoneyCompact(v) → "$12.35K"     — heroes and tight chips only
 *
 * Both accept null/undefined/NaN (→ "—") and `masked` (→ the app's mask) so
 * callers stop re-implementing those guards too. Pair the rendered figure
 * with `tabular-nums` so refreshes don't make digits dance.
 */

export const MONEY_MASK = '••••';

type Opts = { masked?: boolean };

export function formatMoney(v: number | null | undefined, opts: Opts = {}): string {
  if (opts.masked) return MONEY_MASK;
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatMoneyCompact(v: number | null | undefined, opts: Opts = {}): string {
  if (opts.masked) return MONEY_MASK;
  if (v == null || Number.isNaN(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${(a / 1_000).toFixed(1)}K`;
  if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(2)}K`;
  return `${sign}$${a.toFixed(2)}`;
}

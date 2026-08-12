/**
 * formatMoney — the ONE voice for money (de-AI pass 2026-07-21; locale-aware
 * since Fase 3, 2026-07-30).
 *
 * The audit found SIX local formatters writing the same balance three ways
 * ($12.35K · $12,345.67 · $12345.67 — the last one without thousands
 * separators). Two explicit registers and nothing else:
 *
 *   formatMoney(v)        → "$12,345.67" · es: "12.345,67 $"
 *   formatMoneyCompact(v) → "$12.35K"    · es: "12,35K $"
 *
 * Both accept null/undefined/NaN (→ "—") and `masked` (→ the app's mask) so
 * callers stop re-implementing those guards too. Pair the rendered figure
 * with `tabular-nums` so refreshes don't make digits dance.
 *
 * Locale comes from the module-level active locale (lib/format), set by
 * LanguageProvider — the 8 existing importers localized without churn.
 */

import { getActiveLocale, makeFormatters, MONEY_MASK as MASK } from './format';

export const MONEY_MASK = MASK;

type Opts = { masked?: boolean };

export function formatMoney(v: number | null | undefined, opts: Opts = {}): string {
  return makeFormatters(getActiveLocale()).money(v, opts);
}

export function formatMoneyCompact(v: number | null | undefined, opts: Opts = {}): string {
  return makeFormatters(getActiveLocale()).moneyCompact(v, opts);
}

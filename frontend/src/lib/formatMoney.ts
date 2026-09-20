/**
 * formatMoney — the ONE voice for money (de-AI pass; locale-aware
 * since Fase 3).
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

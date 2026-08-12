/**
 * format — the ONE locale-aware voice for every number in the product (Fase 1
 * of the abstraction prompt, 2026-07-30).
 *
 * The audit found four incompatible locale strategies (en-US pinned, es-ES
 * pinned, browser default, bare toFixed) and ~35 copy-paste formatters; the
 * language switch changed not a single digit. This module fixes the rule at
 * the root: THE LOCALE ENTERS THROUGH THE HOOK (hooks/useFormat.ts) — `es`
 * reads 1.234,56 and `en` reads 1,234.56, everywhere, from one place.
 *
 * Unit rules the formatters enforce (GLOSSARY §9-to-be):
 *  - Ratios never reach the screen: `pct()` takes the 0–1 wire value and is
 *    the only place it is multiplied by 100.
 *  - The health factor is a pure number, 2 decimals, NEVER a percentage
 *    (1.00 = liquidation; "100%" would read as perfect health).
 *  - Money defaults to 2 decimals; token quantities to 4; precision beyond
 *    that belongs only where precision IS the content (signing reviews).
 *  - Addresses/hashes: one truncation (6…4 / 10…6), real ellipsis, full value
 *    in the title attribute of whatever renders it.
 *
 * `lib/formatMoney.ts` (en-US only) predates this and keeps its 8 callers
 * working; new code takes `useFormat()` and existing calls migrate in Fase 3.
 */

import type { Lang } from '../i18n/dict';

export type AppLocale = 'es-ES' | 'en-US';

export const localeOf = (lang: Lang): AppLocale => (lang === 'es' ? 'es-ES' : 'en-US');

export const MONEY_MASK = '••••';

/**
 * Module-level active locale — set by LanguageProvider, read by the plain
 * (non-hook) formatters so their ~40 existing call sites localize without
 * churn. Starts 'en-US' to match the server render (the provider flips it in
 * its post-hydration effect, exactly like it does for `lang` itself); every
 * component that renders numbers also renders t() strings, so the language
 * switch re-renders them and they pick the new locale up on the next call.
 */
let activeLocale: AppLocale = 'en-US';
export function setActiveLocale(locale: AppLocale): void {
  activeLocale = locale;
}
export function getActiveLocale(): AppLocale {
  return activeLocale;
}

/** Locale-aware quantity for the legacy local `fmt(n, digits)` helpers. */
export function fmtQtyActive(v: number, digits = 4): string {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString(activeLocale, { maximumFractionDigits: digits });
}

export interface Formatters {
  locale: AppLocale;
  /** "$12,345.67" / "12.345,67 $". null/NaN → "—", masked → dots. */
  money(v: number | null | undefined, opts?: { masked?: boolean }): string;
  /** "$12.35K" / "12,35 K$" — heroes and tight chips only. */
  moneyCompact(v: number | null | undefined, opts?: { masked?: boolean }): string;
  /** "1.234,5678 FXRP" — token amounts always carry their ticker. */
  qty(v: number | null | undefined, symbol?: string, opts?: { decimals?: number }): string;
  /** Takes the 0–1 wire ratio → "30 %" / "30%". The ONLY ×100 in the app. */
  pct(ratio01: number | null | undefined, opts?: { decimals?: number }): string;
  /** Takes a value already in percent points (APY feeds) → "4.20%". */
  pctPoints(v100: number | null | undefined, opts?: { decimals?: number }): string;
  /** Health factor: pure number, 2 decimals, never %. ∞/no-debt → "∞". */
  hf(v: number | null | undefined): string;
  /** "0x1234…abcd" — six head, four tail, real ellipsis. */
  address(a: string | null | undefined): string;
  /** "0x1234567890…abcdef" — ten head, six tail, for tx hashes. */
  hash(h: string | null | undefined): string;
  /** Locale date+time without seconds. */
  dateTime(iso: string | number | Date | null | undefined): string;
  /** Locale date only. */
  date(iso: string | number | Date | null | undefined): string;
}

function num(locale: AppLocale, v: number, min: number, max: number): string {
  return v.toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
}

export function makeFormatters(locale: AppLocale): Formatters {
  const es = locale === 'es-ES';
  const moneyStr = (body: string, sign: string) => (es ? `${sign}${body} $` : `${sign}$${body}`);

  return {
    locale,

    money(v, opts = {}) {
      if (opts.masked) return MONEY_MASK;
      if (v == null || Number.isNaN(v)) return '—';
      const sign = v < 0 ? '-' : '';
      return moneyStr(num(locale, Math.abs(v), 2, 2), sign);
    },

    moneyCompact(v, opts = {}) {
      if (opts.masked) return MONEY_MASK;
      if (v == null || Number.isNaN(v)) return '—';
      const sign = v < 0 ? '-' : '';
      const a = Math.abs(v);
      if (a >= 1_000_000) return moneyStr(`${num(locale, a / 1_000_000, 0, 2)}M`, sign);
      if (a >= 10_000) return moneyStr(`${num(locale, a / 1_000, 0, 1)}K`, sign);
      if (a >= 1_000) return moneyStr(`${num(locale, a / 1_000, 0, 2)}K`, sign);
      return moneyStr(num(locale, a, 2, 2), sign);
    },

    qty(v, symbol, opts = {}) {
      if (v == null || Number.isNaN(v)) return '—';
      const d = opts.decimals ?? 4;
      const body = num(locale, v, 0, d);
      return symbol ? `${body} ${symbol}` : body;
    },

    pct(ratio01, opts = {}) {
      if (ratio01 == null || Number.isNaN(ratio01)) return '—';
      const d = opts.decimals ?? 0;
      return `${num(locale, ratio01 * 100, 0, d)}${es ? ' %' : '%'}`;
    },

    pctPoints(v100, opts = {}) {
      if (v100 == null || Number.isNaN(v100)) return '—';
      const d = opts.decimals ?? 2;
      return `${num(locale, v100, 0, d)}${es ? ' %' : '%'}`;
    },

    hf(v) {
      if (v == null || Number.isNaN(v)) return '—';
      if (!Number.isFinite(v) || v > 1e6) return '∞';
      return num(locale, v, 2, 2);
    },

    address(a) {
      if (!a) return '—';
      return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
    },

    hash(h) {
      if (!h) return '—';
      return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
    },

    dateTime(iso) {
      if (iso == null) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },

    date(iso) {
      if (iso == null) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    },
  };
}

'use client';

/**
 * PositionHealthMeter — small inline meter: health-factor bar + exact
 * liquidation price for ONE position/account. Purely presentational and
 * protocol-agnostic (receives numbers, renders them): a Kinetic carry today
 * and an XRPL lending position tomorrow use it identically.
 *
 * Encoding notes: the bar maps HF 1.0 (liquidation) → empty and HF ≥ 2.0 →
 * full; status colors follow the app-wide HF convention (≥2 emerald, ≥1.5
 * yellow, ≥1.2 orange, <1.2 red) and identity is never color-alone — the
 * numeric HF and the liquidation price always render as text next to the bar.
 */

import { useT } from '../../i18n/LanguageProvider';

export interface PositionHealthMeterProps {
  healthFactor?: number | null;
  /** Collateral price at which the account liquidates. */
  liquidationPriceUSD?: number | null;
  /** Current collateral price, for the "now vs liquidation" read. */
  currentPriceUSD?: number | null;
}

function hfBarClass(hf: number): string {
  if (hf >= 2) return 'bg-emerald-400';
  if (hf >= 1.5) return 'bg-yellow-400';
  if (hf >= 1.2) return 'bg-orange-400';
  return 'bg-red-400';
}

function hfTextClass(hf?: number | null): string {
  if (hf == null) return 'text-white/30';
  if (hf >= 2) return 'text-emerald-400';
  if (hf >= 1.5) return 'text-yellow-400';
  if (hf >= 1.2) return 'text-orange-400';
  return 'text-red-400';
}

function fmtPrice(v: number): string {
  return v >= 100 ? v.toFixed(2) : v.toFixed(4);
}

export function PositionHealthMeter({
  healthFactor,
  liquidationPriceUSD,
  currentPriceUSD,
}: PositionHealthMeterProps) {
  const { t } = useT();
  const hf = typeof healthFactor === 'number' && isFinite(healthFactor) ? healthFactor : null;
  // HF 1.0 = liquidation = empty bar; HF ≥ 2.0 = full bar.
  const fill = hf != null ? Math.max(0, Math.min(1, hf - 1)) : 0;

  return (
    <div className="min-w-[140px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] text-white/40">{t('Health')}</span>
        <span className={`font-mono text-xs ${hfTextClass(hf)}`}>{hf != null ? hf.toFixed(2) : '—'}</span>
      </div>
      <div
        className="mt-1 h-1.5 rounded-full bg-white/10 overflow-hidden"
        role="meter"
        aria-valuemin={1}
        aria-valuemax={2}
        aria-valuenow={hf ?? undefined}
        aria-label={t('Health Factor')}
        title={hf != null ? `HF ${hf.toFixed(2)} (1.00 = ${t('liquidation')})` : t('No health reading')}
      >
        {hf != null && (
          <div className={`h-full rounded-full ${hfBarClass(hf)}`} style={{ width: `${fill * 100}%` }} />
        )}
      </div>
      <div className="mt-1 text-[10px] text-white/40">
        {liquidationPriceUSD != null && liquidationPriceUSD > 0 ? (
          <>
            {t('Liquidates at')}{' '}
            <span className="font-mono text-white/65">${fmtPrice(liquidationPriceUSD)}</span>
            {currentPriceUSD != null && currentPriceUSD > 0 && (
              <span className="text-white/30">
                {' '}
                · {t('now')} <span className="font-mono">${fmtPrice(currentPriceUSD)}</span>
              </span>
            )}
          </>
        ) : (
          t('No liquidation price')
        )}
      </div>
    </div>
  );
}

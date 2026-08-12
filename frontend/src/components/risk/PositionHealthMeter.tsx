'use client';

/**
 * PositionHealthMeter — small inline meter: health-factor bar + exact
 * liquidation price for ONE position/account. Purely presentational and
 * protocol-agnostic (receives numbers, renders them): a Kinetic carry today
 * and an XRPL lending position tomorrow use it identically.
 *
 * Encoding notes: the bar maps HF 1.0 (liquidation) → empty and HF ≥ 2.0 →
 * full; bands come from the ONE canonical scale (lib/healthScore hfWord — this
 * file's own 4-step split was one of four competing scales) and identity is
 * never color-alone: the plain-language word, the numeric HF and the
 * liquidation price always render as text next to the bar.
 */

import { useT } from '../../i18n/LanguageProvider';
import { hfWord } from '../../lib/healthScore';

export interface PositionHealthMeterProps {
  healthFactor?: number | null;
  /** Collateral price at which the account liquidates. */
  liquidationPriceUSD?: number | null;
  /** Current collateral price, for the "now vs liquidation" read. */
  currentPriceUSD?: number | null;
}

const BAR_CLASS: Record<string, string> = {
  success: 'bg-emerald-400',
  warning: 'bg-yellow-400',
  danger: 'bg-red-400',
  neutral: 'bg-white/30',
};

const TEXT_CLASS: Record<string, string> = {
  success: 'text-emerald-400',
  warning: 'text-yellow-400',
  danger: 'text-red-400',
  neutral: 'text-white/30',
};

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
  const w = hfWord(hf, t);
  // HF 1.0 = liquidation = empty bar; HF ≥ 2.0 = full bar.
  const fill = hf != null ? Math.max(0, Math.min(1, hf - 1)) : 0;

  return (
    <div className="min-w-[140px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] text-white/40">{t('Health')}</span>
        <span className={`text-xs ${TEXT_CLASS[w.tone]}`}>
          {hf != null ? (
            <>
              {w.label} <span className="font-mono">({hf.toFixed(2)})</span>
            </>
          ) : (
            '—'
          )}
        </span>
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
          <div className={`h-full rounded-full ${BAR_CLASS[w.tone]}`} style={{ width: `${fill * 100}%` }} />
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

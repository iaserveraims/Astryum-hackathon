'use client';

/**
 * BorrowRiskMeter — dónde cae tu préstamo entre «no pasa nada» y «te liquidan».
 *
 * La decisión que acompaña: cuánto pedir, y dónde poner el stop-loss. Las dos se
 * toman mirando lo mismo — cuánto puede caer el XRP antes de que duela — así que
 * las dos viven en el mismo dibujo.
 */
import { useId } from 'react';
import { ShieldCheck, AlertTriangle, Flame, Slash } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import {
  borrowRisk, riskBands, priceDropToReach, ltvFromHf, type Fraction, type RiskLevel,
} from '../../lib/earn/borrowRisk';

/** Un tono por estado. Solo se pinta UNO a la vez — ver la cabecera. */
const TONE: Record<RiskLevel, string> = {
  comfortable: 'var(--tone-success)',
  tight: 'var(--tone-warning)',
  exposed: 'var(--tone-danger)',
  liquidatable: 'var(--tone-danger)',
};

/** Forma además de color: el canal que sobrevive al daltonismo y al gris. */
const ICON: Record<RiskLevel, typeof ShieldCheck> = {
  comfortable: ShieldCheck,
  tight: AlertTriangle,
  exposed: Flame,
  liquidatable: Slash,
};

function pct(fraction: number, dp = 0): string {
  if (!Number.isFinite(fraction)) return '—';
  return `${(fraction * 100).toFixed(dp)}%`;
}

export interface BorrowRiskMeterProps {
  /**
   * El health factor QUE DEVUELVE EL SERVIDOR para esta posición (el de después
   * de firmar, que es el que se decide). `null` = sin deuda.
   *
   * Entra ya calculado a propósito (regla R0 de esta pantalla): ninguna cuenta
   * de precio×ratio corre en el navegador. Un HF calculado aquí con un precio
   * que no es el del oráculo de Morpho enseñaría un margen que el mercado no
   * reconoce — y una falsa tranquilidad sobre el riesgo es el peor sitio donde
   * tenerla, porque hace que dejes de mirar. Este componente solo CONVIERTE
   * unidades sobre lo que el servidor ya afirmó.
   */
  healthFactor: number | null;
  /** Techo de liquidación del mercado (LLTV), leído on-chain. Nunca asumido. */
  lltv: Fraction;
  /** Umbral del repago automático, en LTV. Ausente = sin protección armada. */
  stopLtv?: Fraction | null;
}

export function BorrowRiskMeter({ healthFactor, lltv, stopLtv }: BorrowRiskMeterProps) {
  const { t } = useT();
  const titleId = useId();

  // Conversión pura sobre el veredicto del servidor: HF → LTV → colchón.
  const ltv = ltvFromHf(healthFactor ?? Infinity, lltv);
  const risk = borrowRisk(ltv, 1, lltv);
  const Icon = ICON[risk.level];
  const tone = TONE[risk.level];

  // La escala llega hasta la liquidación: pasado ese punto la posición ya no es
  // tuya, así que dibujar más recorrido sugeriría un margen que no existe.
  const scaleMax = lltv;
  const clamp = (v: number) => Math.max(0, Math.min(1, v / scaleMax));
  const fill = Number.isFinite(risk.ltv) ? clamp(risk.ltv) : 1;
  const stopAt = stopLtv != null && stopLtv > 0 ? clamp(stopLtv) : null;

  const WORD: Record<RiskLevel, string> = {
    comfortable: t('Comfortable'),
    tight: t('Tight'),
    exposed: t('Exposed'),
    liquidatable: t('Past the limit'),
  };

  const bands = riskBands(lltv);

  return (
    <div className="space-y-3">
      {/* La lectura primero, en palabras: el dibujo la ilustra, no la sustituye. */}
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: tone }} strokeWidth={1.6} aria-hidden />
        <p className="text-sm text-ink/85 leading-relaxed" id={titleId}>
          <span className="font-medium">{WORD[risk.level]}</span>
          {risk.level === 'liquidatable' ? (
            <> — {t('this borrow is past what the market allows on that collateral.')}</>
          ) : (
            <>
              {' — '}
              {t('it survives a')}{' '}
              <span className="font-medium font-mono">{pct(risk.dropToLiquidation)}</span>{' '}
              {t('fall in the collateral before liquidation.')}
            </>
          )}
        </p>
      </div>

      {/* El medidor. `meter` expone el valor a los lectores de pantalla; el texto
          de arriba lo dice igual, así que nada depende de poder ver esto. */}
      <div
        role="meter"
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={Math.round(scaleMax * 100)}
        aria-valuenow={Number.isFinite(risk.ltv) ? Math.round(risk.ltv * 100) : undefined}
        aria-valuetext={`${pct(risk.ltv)} ${t('of the collateral borrowed')} · ${WORD[risk.level]}`}
        className="relative h-2 rounded-full overflow-hidden"
        // La pista es un paso más claro del MISMO tono del relleno: el estado se
        // lee a lo ancho de la barra, no solo en el trozo lleno.
        style={{ backgroundColor: `color-mix(in oklab, ${tone} 18%, transparent)` }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${fill * 100}%`, backgroundColor: tone }}
        />
        {/* El stop-loss: una marca con hueco de superficie a los lados, para que
            se lea contra el relleno sin dibujarle un borde encima. */}
        {stopAt != null && (
          <div
            className="absolute inset-y-0 w-[2px] bg-ink/70"
            style={{ left: `calc(${stopAt * 100}% - 1px)`, boxShadow: '0 0 0 2px hsl(var(--surface-1))' }}
            aria-hidden
          />
        )}
      </div>

      {/* Los extremos, etiquetados: sin esto el 100% de la barra no significa nada. */}
      <div className="flex justify-between text-[10px] text-ink/40 font-mono">
        <span>0%</span>
        <span>{t('liquidation at')} {pct(lltv)}</span>
      </div>

      {stopLtv != null && stopLtv > 0 && (
        <p className="text-[11px] text-ink/55 leading-relaxed">
          {t('Automatic repay armed at')}{' '}
          <span className="font-mono">{pct(stopLtv)}</span>
          {' — '}
          {t('it fires if the collateral falls')}{' '}
          <span className="font-mono font-medium">{pct(priceDropToReach(risk.ltv, stopLtv))}</span>.
        </p>
      )}

      {/* La leyenda que pediste. Cada zona lleva icono, palabra y el colchón que
          deja — el color es el tercer canal, nunca el único. */}
      <ul className="grid gap-1.5 pt-1 border-t border-ink/10">
        {bands.map((band) => {
          const BandIcon = ICON[band.level];
          return (
            <li key={band.level} className="flex items-center gap-2 text-[11px] text-ink/55">
              <BandIcon className="w-3 h-3 shrink-0" style={{ color: TONE[band.level] }} strokeWidth={1.8} aria-hidden />
              <span className="font-medium text-ink/70">{WORD[band.level]}</span>
              <span className="text-ink/35">·</span>
              <span>
                {t('up to')} <span className="font-mono">{pct(band.toLtv)}</span> {t('borrowed')}
                {' — '}
                {t('survives a fall of at least')}{' '}
                <span className="font-mono">{pct(band.dropAtEnd)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default BorrowRiskMeter;

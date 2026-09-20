'use client';

/**
 * StationDoneNotice — «¿POR QUÉ ESTÁ HECHA?», sin popup.
 *
 * Tenía razón dos veces: un modal con fondo oscuro para un dato que no pide
 * nada rompe la regla de la casa (los overlays nunca oscurecen) y en un
 * Legacy ya constituido saltaba en TODAS las estaciones.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../i18n/LanguageProvider';
import { resumeSummary, type ResumeStation } from '../../lib/ui/resumeNotice';

/**
 * La notificación de «retomado»: sale UNA vez por `key` (la cuenta) cuando
 * la ceremonia aterriza (`landed`) más allá de la primera estación con alguna
 * anterior ya hecha. `stations` se lee en el momento del aterrizaje, no se
 * vigila: el aterrizaje ya es la lectura real del ledger.
 */
export function useResumeToast({
  landed,
  stations,
  key,
}: {
  /** La estación en la que la ceremonia aterrizó; null = aún no aterrizó. */
  landed: number | null;
  stations: readonly ResumeStation[];
  /** Por qué cuenta se avisa; cambiar de cuenta permite avisar de nuevo. */
  key: string | null | undefined;
}) {
  const { t } = useT();
  const announced = useRef<string | null>(null);
  const stationsRef = useRef(stations);
  stationsRef.current = stations;
  useEffect(() => {
    if (landed === null || !key) return;
    if (announced.current === key) return;
    announced.current = key;
    const s = resumeSummary(landed, stationsRef.current);
    if (!s) return;
    toast(`${t('Resumed at')} ${s.label}`, {
      description: `${s.doneBefore} ${t('earlier station(s) were already done on this account — read from the ledger, never assumed.')}`,
    });
  }, [landed, key, t]);
}

/**
 * La franja de la estación: hecha (verde, con lo leído, «¿por qué cuenta?» y
 * el salto a la primera pendiente) o pendiente (qué se mira para darla por
 * hecha). Va justo bajo la cabecera de estación, en las tres ceremonias.
 */
export function StationDoneStrip({
  done,
  how,
  nextPendingLabel,
  onNextPending,
}: {
  done: boolean;
  /** Qué se leyó (o se leerá) para dar la estación por hecha — ya traducido. */
  how: string;
  /** La primera estación pendiente, si la hay y no es ésta: el enlace la abre. */
  nextPendingLabel?: string;
  onNextPending?: () => void;
}) {
  const { t } = useT();
  const [why, setWhy] = useState(false);
  if (!done) {
    return (
      <p className="-mt-2 text-[11px] leading-relaxed text-ink/40">
        <span>{t('Pending')} · </span>
        {how}
      </p>
    );
  }
  return (
    <div className="-mt-2 rounded-lg border border-tone-success/20 bg-tone-success/[0.05] px-3 py-2 text-[11.5px] leading-relaxed">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium text-tone-success">
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> {t('Done on this account')}
        </span>
        <span className="min-w-0 text-ink/55">
          <span className="text-ink/35">{t('What was read')}:</span> {how}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWhy((v) => !v)}
            aria-expanded={why}
            className="inline-flex items-center gap-1 text-[11px] text-ink/45 transition-colors hover:text-ink"
          >
            {t('Why it counts')} <ChevronDown className={`h-3 w-3 transition-transform ${why ? 'rotate-180' : ''}`} />
          </button>
          {onNextPending && nextPendingLabel ? (
            <button
              type="button"
              onClick={onNextPending}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-volt transition-colors hover:underline"
            >
              {nextPendingLabel} <ArrowRight className="h-3 w-3" />
            </button>
          ) : null}
        </span>
      </div>
      {why ? (
        <p className="mt-2 max-w-[70ch] text-[12px] leading-relaxed text-ink/60">
          {t('This station is already done for the account you picked. The ledger is per account: whatever this account already did counts here, whoever did it and wherever it was done — a manager setup, a Legacy, an earlier take.')}{' '}
          {t('Nothing to sign here.')}
        </p>
      ) : null}
    </div>
  );
}

export default StationDoneStrip;

'use client';

/**
 * GovernOperation — gobernar una cuenta gobernada como UNA OPERACIÓN MÁS.
 *
 * El gemelo de ConstituteOperation: misma OperationSurface (ventana corta,
 * pin a la derecha, píldora minimizada del host multi-op), mismo sello índigo
 * LOCAL (data-authority="governed" — índigo dentro, oro fuera, precedente
 * GovernanceModal) y dentro el MISMO LegacyPanel en variant='operation',
 * clavado a la superficie Govern: Info reordenada (capital primero, luego
 * rendimiento y actividad, el consejo al final) y Propuestas. Nada se
 * bifurca — lo que gobiernas aquí es exactamente /app/legacy?govern=….
 *
 * SIN cierre por backdrop ni Escape: una propuesta a medias fija una
 * Sequence de XRPL — la X es la única salida (regla GovernanceModal).
 */

import { Landmark, Minus, PanelRight, PanelRightClose } from 'lucide-react';
import { CloseOperationButton, OperationSurface } from '../ui/OperationSurface';
import { useOperationStore } from '../../stores/operationStore';
import { useDockStore } from '../../stores/dockStore';
import { useT } from '../../i18n/LanguageProvider';
import LegacyPanel from './LegacyPanel';

const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export default function GovernOperation({
  account,
  label,
  tab,
  onClose,
}: {
  account: string;
  /** El nombre de la tarjeta (apodo/registro) — el título habla de ESTE Legacy. */
  label?: string | null;
  /** Aterrizar directo en la bandeja («firma en la bandeja» desde Movimientos). */
  tab?: 'proposals';
  onClose: () => void;
}) {
  const { t } = useT();
  const docked = useDockStore((st) => st.docked);
  const setDocked = useDockStore((st) => st.setDocked);
  const minimizeActive = useOperationStore((st) => st.minimizeActive);
  const title = label?.trim() || shortAddr(account);

  return (
    <OperationSurface docked={docked} title={`${t('Govern')} · ${title}`} onClose={onClose}>
      <div data-authority="governed" className="flex min-h-0 flex-1 flex-col bg-surface-1">
        <div className="shrink-0 flex items-start justify-between px-5 py-4 border-b border-ink/5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-xl grid place-items-center border text-volt border-volt/30 bg-volt/10">
              <Landmark className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
              <p className="mt-0.5 text-xs text-ink/40">
                <span className="font-mono">{shortAddr(account)}</span>
                <span className="text-ink/30"> · {t('the quorum signs — Astryum never does')}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={minimizeActive}
              className="p-0.5 text-ink/40 hover:text-ink transition-colors"
              title={t('Minimize — it waits at the bottom, exactly as you left it')}
            >
              <Minus className="w-5 h-5" />
            </button>
            {/* Anclar/soltar — solo en pantallas con lado al que deslizar. */}
            <button
              onClick={() => setDocked(!docked)}
              className="hidden lg:block p-0.5 text-ink/40 hover:text-ink transition-colors"
              title={docked ? t('Back to a window') : t('Pin to the side — the dashboard stays live')}
            >
              {docked ? <PanelRightClose className="w-5 h-5" /> : <PanelRight className="w-5 h-5" />}
            </button>
            <CloseOperationButton onClose={onClose} />
          </div>
        </div>

        {/* ceremony-compact: en 360–720px las reservas de escena estrangulan —
            se anulan por envoltorio (globals.css), la misma regla que
            Constituir. */}
        <div className="ceremony-compact flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          <LegacyPanel
            embed={{ entry: { kind: 'govern', account, tab }, onExit: onClose, variant: 'operation' }}
          />
        </div>
      </div>
    </OperationSurface>
  );
}

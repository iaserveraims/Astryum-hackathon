'use client';

/**
 * SetupOperationShell — LA PLANTILLA de toda ceremonia de configuración.
 *
 * Lo que ya tenía Constituir un Legacy, sacado a una pieza: ventana corta o
 * panel anclado (OperationSurface), cabecera con el icono en su baldosa, el
 * título, una línea de propósito y los tres mandos — minimizar a píldora,
 * anclar/soltar, cerrar en dos pasos — y un cuerpo con scroll propio en el
 * que vive la ceremonia por estaciones (StationRailLayout: raíl al lado si
 * la caja es ancha, tira encima si es estrecha).
 */

import { useState, type ReactNode } from 'react';
import { Lock, Minus, PanelRight, PanelRightClose } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CloseOperationButton, OperationSurface } from './OperationSurface';
import { useOperationStore } from '../../stores/operationStore';
import { useDockStore } from '../../stores/dockStore';
import { useT } from '../../i18n/LanguageProvider';
import { XamanSignBlockScope } from '../xrpl/XamanSingleSign';

export function SetupOperationShell({
  title,
  subtitle,
  icon: Icon,
  authority,
  headerExtra,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  icon: LucideIcon;
  /** 'governed' tiñe SOLO este panel de índigo (Legacy); el shell sigue oro. */
  authority?: 'governed';
  /** Cromo extra junto a los mandos (p. ej. «página entera ↗»). */
  headerExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const docked = useDockStore((st) => st.docked);
  const setDocked = useDockStore((st) => st.setDocked);
  const minimizeActive = useOperationStore((st) => st.minimizeActive);
  // A Xaman signature inside can no longer be dropped: closing would unmount it.
  const [signBlocked, setSignBlocked] = useState(false);

  return (
    <OperationSurface docked={docked} title={title} onClose={signBlocked ? undefined : onClose} size="wide">
      <div data-authority={authority} className="flex min-h-0 flex-1 flex-col bg-surface-1">
        <div className="flex shrink-0 items-start justify-between border-b border-ink/5 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-volt/30 bg-volt/10 text-volt">
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-ink">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-xs text-ink/40">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {headerExtra}
            <button
              type="button"
              onClick={minimizeActive}
              className="p-0.5 text-ink/40 transition-colors hover:text-ink"
              title={t('Minimize — it waits at the bottom, exactly as you left it')}
            >
              <Minus className="h-5 w-5" />
            </button>
            {/* Anclar/soltar — solo en pantallas con lado al que deslizar. */}
            <button
              type="button"
              onClick={() => setDocked(!docked)}
              className="hidden p-0.5 text-ink/40 transition-colors hover:text-ink lg:block"
              title={docked ? t('Back to a window') : t('Pin to the side — the dashboard stays live')}
            >
              {docked ? <PanelRightClose className="h-5 w-5" /> : <PanelRight className="h-5 w-5" />}
            </button>
            {signBlocked ? (
              <span
                className="p-0.5 text-tone-warning"
                title={t('A Xaman signature inside is still open — resolve it in the request before closing this window.')}
                aria-label={t('A Xaman signature inside is still open — resolve it in the request before closing this window.')}
              >
                <Lock className="h-4 w-4" />
              </span>
            ) : (
              <CloseOperationButton onClose={onClose} />
            )}
          </div>
        </div>

        {/* ceremony-compact: en 360–720px las reservas de escena de las
            ceremonias (lg:pr-56 y compañía) se anulan por CSS global. */}
        <div className="ceremony-compact flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
          <XamanSignBlockScope onBlockedChange={setSignBlocked}>{children}</XamanSignBlockScope>
        </div>
      </div>
    </OperationSurface>
  );
}

export default SetupOperationShell;

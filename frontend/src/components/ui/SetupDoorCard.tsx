'use client';

/**
 * SetupDoorCard — LA PUERTA a una ceremonia de configuración.
 *
 * Cada alta vive UNA vez, en su ventana (SetupOperationShell). Donde antes
 * se incrustaba el wizard entero (la sala «Configurar» de la mesa del gestor,
 * la del operador del exchange, el hub de altas) ahora hay esta tarjeta:
 * qué es, cuántas estaciones, cuánto cuesta, y un botón que abre la MISMA
 * ventana — anclable, minimizable, con sus estaciones. Una puerta, una
 * ceremonia; nunca dos copias.
 */

import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, MicroLabel, PrimaryButton } from './primitives';
import { useT } from '../../i18n/LanguageProvider';

export function SetupDoorCard({
  icon: Icon,
  eyebrow,
  title,
  purpose,
  stations,
  effort,
  status,
  cta,
  onOpen,
  authority,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  purpose: string;
  /** Cuántas estaciones tiene la ceremonia. */
  stations: number;
  /** Cuánto cuesta, en tiempo y dispositivos — nunca dinero ni resultados. */
  effort: string;
  /** Una línea de estado leída de la cadena, si el anfitrión la tiene. */
  status?: ReactNode;
  cta?: string;
  onOpen: () => void;
  /** Índigo para el Legacy; oro para lo demás. */
  authority?: 'governed';
}) {
  const { t } = useT();
  return (
    <div data-authority={authority}>
    <Card className="p-6">
      <div className="flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-volt/30 bg-volt/10 text-volt">
          <Icon className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <div className="min-w-0 flex-1">
          <MicroLabel>{eyebrow}</MicroLabel>
          <h3 className="mt-1 text-[17px] font-semibold tracking-tight text-ink">{title}</h3>
          <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">{purpose}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink/45">
            <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5">{stations} {t('stations')}</span>
            <span className="rounded-full border border-ink/10 bg-ink/[0.03] px-2 py-0.5">{effort}</span>
            {status ? <span className="min-w-0">{status}</span> : null}
          </div>
          <PrimaryButton onClick={onOpen} className="mt-4">
            {cta ?? t('Open the setup')} <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
          </PrimaryButton>
          <p className="mt-2 text-[11px] text-ink/35">{t('Opens as a window you can pin to the side or minimize — the dashboard stays live beside it.')}</p>
        </div>
      </div>
    </Card>
    </div>
  );
}

export default SetupDoorCard;

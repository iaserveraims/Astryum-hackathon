'use client';

/**
 * ManagerOperation — LA MESA DEL GESTOR como ventana (fundador 2026-09-10:
 * fuera del sidebar, se abre desde Managed vaults «en una ventanita»
 * anclable a la derecha). Dentro va ManagerDesk entero: sus salas, sus
 * bóvedas, sus consolas. La sala «Configurar» es una PUERTA al alta
 * (ManagerSetupOperation), que vive una sola vez en su propia ventana.
 *
 * Desde el 2026-09-12 monta la PLANTILLA común de toda ceremonia
 * (SetupOperationShell): misma cabecera, mismos mandos, mismo cuerpo que
 * Constituir un Legacy y las altas. Cierra en dos pasos, como las
 * estrategias (fundador 12-sep).
 */

import Link from 'next/link';
import { Briefcase, ExternalLink } from 'lucide-react';
import { SetupOperationShell } from '../ui/SetupOperationShell';
import { useT } from '../../i18n/LanguageProvider';
import { useIsManager } from '../../stores/managerStore';
import { ManagerDesk } from './ManagerDesk';
import { ManagerDeclaration } from './ManagerDeclaration';

export default function ManagerOperation({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const isManager = useIsManager();

  return (
    <SetupOperationShell
      icon={Briefcase}
      title={t('Manager desk')}
      subtitle={t('Set up your account, then run your vaults')}
      onClose={onClose}
      headerExtra={
        <Link href="/app/manager" className="mr-1 inline-flex items-center gap-1 text-[11px] text-ink/40 transition-colors hover:text-ink">
          {t('full page')} <ExternalLink className="h-3 w-3" />
        </Link>
      }
    >
      {isManager ? <ManagerDesk /> : <ManagerDeclaration />}
    </SetupOperationShell>
  );
}

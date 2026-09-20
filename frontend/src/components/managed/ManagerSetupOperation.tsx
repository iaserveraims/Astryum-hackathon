'use client';

/**
 * ManagerSetupOperation — EL ALTA DEL GESTOR como ceremonia de configuración.
 *
 * La MISMA ventana que Constituir un Legacy (SetupOperationShell) con el
 * wizard de siempre dentro (ManagerSetupWizard: cuenta, título, constitución,
 * jaula, primera bóveda, perfil). Vive UNA vez, aquí: la mesa del gestor y el
 * hub de altas la abren con una puerta (SetupDoorCard), no la incrustan.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, ExternalLink } from 'lucide-react';
import { SetupOperationShell } from '../ui/SetupOperationShell';
import { AstryumLoader } from '../ui/AstryumLoader';
import { useT } from '../../i18n/LanguageProvider';
import { useIsManager } from '../../stores/managerStore';
import { useManagerAccount } from '../../hooks/useManagerAccount';
import { getCageOf } from '../../lib/institutional/api';
import { ManagerSetupWizard } from './ManagerSetupWizard';
import { ManagerDeclaration } from './ManagerDeclaration';
import { ManagerAccountInXaman } from './ManagerAccountInXaman';

export default function ManagerSetupOperation({
  onClose,
  jumpTo = null,
}: {
  onClose: () => void;
  /** Una orden de aterrizar en una estación (renovar el título desde Operar). */
  jumpTo?: { step: number; nonce: number } | null;
}) {
  const { t } = useT();
  const isManager = useIsManager();
  const { address, resolving } = useManagerAccount();
  // ¿Tiene ya bóveda? Se lee de la jaula de la cuenta (potes > 0); el wizard
  // lo usa para el aterrizaje. «No pude leer» = false, y la estación lo dirá.
  const [hasVault, setHasVault] = useState(false);
  const readVault = useCallback(async () => {
    if (!address) return setHasVault(false);
    try {
      const r = await getCageOf(address);
      setHasVault(Boolean(r.cage && !('unreadable' in r.cage) && r.cage.potes.length > 0));
    } catch {
      /* sin veredicto: el wizard lo detecta por su cuenta */
    }
  }, [address]);
  useEffect(() => { void readVault(); }, [readVault]);

  return (
    <SetupOperationShell
      icon={Briefcase}
      title={t('Set up your manager account')}
      subtitle={t('Six stations — pin this panel and the dashboard stays live beside it.')}
      onClose={onClose}
      headerExtra={
        <Link href="/app/manager" className="mr-1 inline-flex items-center gap-1 text-[11px] text-ink/40 transition-colors hover:text-ink" title={t('full page')}>
          {t('desk')} <ExternalLink className="h-3 w-3" />
        </Link>
      }
    >
      {!isManager ? (
        <ManagerDeclaration />
      ) : !address && resolving ? (
        // Las wallets de la cuenta aún se leen: «ninguna» no se sabe todavía.
        <div className="py-6">
          <AstryumLoader size={56} label={t('Reading your wallets…')} />
        </div>
      ) : !address ? (
        <div className="space-y-4">
          <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
            {t('No XRPL wallet is linked to your account yet, and none is connected in this browser.')}{' '}
            {t('The setup follows ONE XRPL account of yours. Connect the one that will manage — a fresh, dedicated account — and this window fills with its stations.')}
          </p>
          <ManagerAccountInXaman />
        </div>
      ) : (
        <ManagerSetupWizard account={address} hasVault={hasVault} onOpened={() => void readVault()} jumpTo={jumpTo} />
      )}
    </SetupOperationShell>
  );
}

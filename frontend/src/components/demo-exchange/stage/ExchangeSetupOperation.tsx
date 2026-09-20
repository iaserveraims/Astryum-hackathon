'use client';

/**
 * ExchangeSetupOperation — NACE TU EXCHANGE como ceremonia de configuración.
 *
 * La MISMA ventana que Constituir un Legacy y el alta del gestor
 * (SetupOperationShell), con el wizard del exchange dentro
 * (ExchangeSetupWizard: dos cuentas nuevas, credenciales, constitución,
 * registro, jaula, pote, puerta, mesa). Vive UNA vez, aquí: la mesa del
 * operador y el hub de altas la abren con una puerta (SetupDoorCard).
 */

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, ExternalLink } from 'lucide-react';
import { SetupOperationShell } from '../../ui/SetupOperationShell';
import { useT } from '../../../i18n/LanguageProvider';
import { useDemoRun } from '../../../lib/demo-exchange/useDemoRun';
import { useXrplWalletPartner } from '../../../lib/wallet/useXrplWalletPartner';
import { ExchangeSetupWizard } from './ExchangeSetupWizard';
import { ExchangeAccountGate } from './ExchangeAccountGate';

export default function ExchangeSetupOperation({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const demo = useDemoRun();
  const { address: root } = useXrplWalletPartner();

  return (
    <SetupOperationShell
      icon={Building2}
      title={t('Set up your exchange')}
      subtitle={t('Seven stations — pin this panel and the dashboard stays live beside it.')}
      onClose={onClose}
      headerExtra={
        <Link href="/app/exchange/operator" className="mr-1 inline-flex items-center gap-1 text-[11px] text-ink/40 transition-colors hover:text-ink" title={t('full page')}>
          {t('desk')} <ExternalLink className="h-3 w-3" />
        </Link>
      }
    >
      {!root ? (
        <ExchangeAccountGate onChosen={() => undefined} />
      ) : (
        <ExchangeSetupWizard
          demo={demo}
          onOperate={() => {
            onClose();
            // `guided=1`: la mesa del operador abre por el ENSAYO, no por la
            // consola. La propia mesa ofrece saltarlo, y recuerda el salto.
            router.push('/app/exchange/operator?guided=1');
          }}
        />
      )}
    </SetupOperationShell>
  );
}

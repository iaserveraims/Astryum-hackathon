'use client';

/**
 * ExchangeSetupOperation — NACE TU EXCHANGE como ceremonia de configuración
 * (fundador 2026-09-12: «la misma plantilla de configuración que el Legacy,
 * con su pantalla flotante y sus pasos, para el exchange»).
 *
 * La MISMA ventana que Constituir un Legacy y el alta del gestor
 * (SetupOperationShell), con el wizard del exchange dentro
 * (ExchangeSetupWizard: dos cuentas nuevas, credenciales, constitución,
 * registro, jaula, pote, puerta, mesa). Vive UNA vez, aquí: la mesa del
 * operador y el hub de altas la abren con una puerta (SetupDoorCard).
 *
 * Sin cuenta XRPL elegida como raíz, la ceremonia empieza por la puerta de
 * cuenta (ExchangeAccountGate). Al terminar («Abrir la mesa») se cierra la
 * ventana y se va a la mesa del operador — al ENSAYO GUIADO (`?guided=1`,
 * 15-sep): antes de operar con clientes de verdad, la mesa por estaciones
 * enseña el circuito entero y deja probarlo. Se puede saltar de un clic.
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

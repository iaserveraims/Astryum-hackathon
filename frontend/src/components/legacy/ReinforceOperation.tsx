'use client';

/**
 * ReinforceOperation — REFORZAR una cuenta personal como operación: la misma ceremonia que la constitución por debajo (LegacyPanel,
 * entry 'reinforce'), pero en ORO y sin el sello índigo del Legacy — un
 * quórum de tus propias llaves sigue siendo una wallet personal.
 *
 * Monta la PLANTILLA común de toda ceremonia de
 * configuración (SetupOperationShell): misma cabecera, mismos mandos, mismo
 * cuerpo que Constituir, el alta del gestor y la del exchange.
 */

import { ShieldCheck } from 'lucide-react';
import { SetupOperationShell } from '../ui/SetupOperationShell';
import { useT } from '../../i18n/LanguageProvider';
import LegacyPanel from './LegacyPanel';

export default function ReinforceOperation({
  account,
  onClose,
}: {
  account: string;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <SetupOperationShell
      icon={ShieldCheck}
      title={t('Reinforce this account')}
      subtitle={t('Your own keys guard it — it stays a personal wallet throughout.')}
      onClose={onClose}
    >
      <LegacyPanel embed={{ entry: { kind: 'reinforce', account }, onExit: onClose, variant: 'operation' }} />
    </SetupOperationShell>
  );
}

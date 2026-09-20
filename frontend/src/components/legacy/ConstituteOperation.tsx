'use client';

/**
 * ConstituteOperation — la constitución de un Legacy como UNA OPERACIÓN MÁS.
 *
 * Monta la PLANTILLA común de toda ceremonia de
 * configuración (SetupOperationShell): la misma cabecera, los mismos mandos
 * y el mismo cuerpo que el alta del gestor y la del exchange. Dentro va el
 * LegacyPanel real en variant='operation': la MISMA ceremonia que
 * /app/legacy, sin cromo de página. Nada se bifurca.
 *
 * ÍNDIGO DENTRO, ORO FUERA: `authority="governed"` tiñe solo este panel —
 * el shell alrededor sigue en el color del producto activo.
 */

import { Landmark } from 'lucide-react';
import { SetupOperationShell } from '../ui/SetupOperationShell';
import { useT } from '../../i18n/LanguageProvider';
import LegacyPanel from './LegacyPanel';

export default function ConstituteOperation({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  return (
    <SetupOperationShell
      icon={Landmark}
      title={t('Constitute a Legacy')}
      subtitle={t('Six stations — pin this panel and the dashboard stays live beside it.')}
      authority="governed"
      onClose={onClose}
    >
      <LegacyPanel embed={{ entry: { kind: 'constitute' }, onExit: onClose, variant: 'operation' }} />
    </SetupOperationShell>
  );
}

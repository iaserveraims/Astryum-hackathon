'use client';

/**
 * SetupHub — UN SOLO SITIO para todas las ceremonias de configuración.
 *
 * Tres puertas, una plantilla: Constituir un Legacy, el alta del gestor y
 * el alta del exchange. Cada una abre SU ventana (SetupOperationShell) —
 * anclable, minimizable, con sus estaciones — la misma que abren sus mesas.
 * Aquí no se incrusta ningún wizard: son puertas (SetupDoorCard).
 *
 * El alta del exchange solo la ven los fundadores (isAdmin), como su mesa.
 * La fila del menú la decide el agente de menús; esta pieza no toca el nav.
 */

import { Briefcase, Building2, Landmark } from 'lucide-react';
import { PageHeader } from '../ui/primitives';
import { SetupDoorCard } from '../ui/SetupDoorCard';
import { RevealGroup, RevealItem } from '../ui/motion';
import { useT } from '../../i18n/LanguageProvider';
import { useOperationStore } from '../../stores/operationStore';
import { useAuthStore } from '../../stores/authStore';

export function SetupHub() {
  const { t } = useT();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const openConstitute = useOperationStore((st) => st.openConstituteOp);
  const openManagerSetup = useOperationStore((st) => st.openManagerSetupOp);
  const openExchangeSetup = useOperationStore((st) => st.openExchangeSetupOp);

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        eyebrow={t('Set up')}
        title={t('Ceremonies')}
        subtitle={t('Everything that is set up once, by stations, in the same window: a Legacy, a manager account, an exchange. Each check is read from the ledger — leave at any station and come back.')}
      />
      <RevealGroup className="grid gap-4 md:grid-cols-2" stagger={0.06}>
        <RevealItem>
          <SetupDoorCard
            icon={Landmark}
            eyebrow={t('Legacy')}
            title={t('Constitute a Legacy')}
            purpose={t('A fresh account becomes the vessel of a council: who signs, how many must agree, the rehearsal, the master key retired, the rules anchored.')}
            stations={6}
            effort={t('~45 min · the members’ phones')}
            onOpen={() => openConstitute()}
            authority="governed"
          />
        </RevealItem>
        <RevealItem>
          <SetupDoorCard
            icon={Briefcase}
            eyebrow={t('Managed vaults')}
            title={t('Set up your manager account')}
            purpose={t('A dedicated account, its title, its constitution, its cage and its first vault — and the public card clients read before depositing.')}
            stations={6}
            effort={t('~30 min · Xaman + your signatures')}
            onOpen={() => openManagerSetup()}
          />
        </RevealItem>
        {isAdmin ? (
          <RevealItem>
            <SetupDoorCard
              icon={Building2}
              eyebrow={t('Exchange')}
              title={t('Set up your exchange')}
              purpose={t('Two new accounts, the licence, the constitution, the KYC registry, the cage, the pote, the gate and the desk — become a tenant of the rail.')}
              stations={8}
              effort={t('~40 min · Xaman + MetaMask')}
              onOpen={() => openExchangeSetup()}
            />
          </RevealItem>
        ) : null}
      </RevealGroup>
    </div>
  );
}

export default SetupHub;

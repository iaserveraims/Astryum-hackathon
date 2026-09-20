'use client';

/**
 * InstitutionalV1Room — la PRIMERA generación (pote suelto, v1) tal y como
 * vivía en /app/admin/institutional, traída a la mesa del exchange (encargo
 * 2026-09-11: «coger la parte de admin/institutional y ponerlo allí»).
 *
 * Se conserva por lo que es: el recorrido de 11 pasos del vídeo, la consola
 * del operador v1, el panel del usuario y la constitución del consejo
 * (SignerList). La generación viva es la v2 — la sala «Operate»; esto queda
 * como acta y como banco de pruebas. Misma composición que la página de
 * admin, sin tocarla: los componentes son los mismos.
 */

import { useState } from 'react';
import { SegmentedControl } from '../../ui/primitives';
import { useT } from '../../../i18n/LanguageProvider';
import { OperatorConsole } from '../../institutional/OperatorConsole';
import { PoteBirthCard } from '../../institutional/PoteBirthCard';
import { CouncilAnchorCard } from '../../institutional/CouncilAnchorCard';
import { GuidedDemo } from '../../institutional/GuidedDemo';
import { PasskeyGate } from '../../institutional/user/PasskeyGate';
import { UserVaultPanel } from '../../institutional/user/UserVaultPanel';
import { useCatalogPolicies } from '../../../lib/institutional/useCatalogPolicies';
import LegacyPanel from '../../legacy/LegacyPanel';

type Section = 'guided' | 'exchange' | 'user' | 'council';

export function InstitutionalV1Room() {
  const { t } = useT();
  const [section, setSection] = useState<Section>('guided');
  const { policies } = useCatalogPolicies();

  return (
    <div className="space-y-5">
      <p className="max-w-[70ch] text-[12px] leading-relaxed text-ink/45">
        {t('First generation (a loose pote, v1), kept for the record and as a test bench. The live generation is the cage (v2) — the Operate room. Nothing here is faked: the contracts are live on Flare.')}
      </p>
      <SegmentedControl<Section>
        layoutId="exchange-v1-room"
        options={[
          { key: 'guided', label: t('Guided demo') },
          { key: 'exchange', label: t('Exchange') },
          { key: 'user', label: t('User') },
          { key: 'council', label: t('Council') },
        ]}
        value={section}
        onChange={setSection}
      />

      {section === 'guided' ? <GuidedDemo /> : null}

      {section === 'council' ? (
        <div className="space-y-3">
          <p className="text-xs text-ink/50">
            {t('Constitute the exchange council here (SignerList) — the whole Legacy governance flow, in place. Once the council has its quorum, anchor its constitution and birth the pote in the Exchange tab.')}
          </p>
          <LegacyPanel />
        </div>
      ) : null}

      {section === 'exchange' ? (
        <div className="space-y-8">
          <p className="text-xs text-ink/50">
            {t('You are the exchange here: issue a credential, onboard a client (you pay, the shares are theirs), direct capital, harvest. Try to extract and the cage says no.')}
          </p>
          <CouncilAnchorCard />
          <PoteBirthCard />
          {policies.map((p) => (
            <section key={p.key} className="space-y-3">
              <h2 className="text-sm font-semibold text-ink">{t(p.title)}</h2>
              <OperatorConsole policy={p} />
            </section>
          ))}
        </div>
      ) : null}

      {section === 'user' ? (
        <div className="space-y-3">
          <p className="text-xs text-ink/50">
            {t('You are the client here: set up Face ID once, then add, take out, or send to your own wallet — each with your face. You never touch a wallet or gas.')}
          </p>
          <PasskeyGate>{(account) => <UserVaultPanel account={account} />}</PasskeyGate>
        </div>
      ) : null}
    </div>
  );
}

export default InstitutionalV1Room;

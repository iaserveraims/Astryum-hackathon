'use client';

/**
 * /app/admin/institutional — la demo institucional COMPLETA, en admin, con dos
 * secciones: «Exchange» y «Usuario».
 *
 *  · Exchange = la consola del operador: emitir credencial (KYC), dar de alta
 *    clientes en modo B, dirigir capital, cosechar — y el DENIED de la escena 4.
 *    La cuenta se comporta como un exchange.
 *  · Usuario = el lado cliente con Face ID: dar de alta la passkey y
 *    meter/sacar/enviar con la cara. Nunca ve una wallet ni FLR.
 *
 * Página oculta (sin nav), bajo /app/admin, gated por
 * NEXT_PUBLIC_INSTITUTIONAL_ENABLED (#10, ships OFF). En la demo jugamos ambos
 * papeles; se dice: ningún exchange lo usa aún.
 */

import { useState } from 'react';
import { useT } from '../../../../i18n/LanguageProvider';
import { PreviewOnly } from '../../../../components/ui/PreviewOnly';
import { OperatorConsole } from '../../../../components/institutional/OperatorConsole';
import { PoteBirthCard } from '../../../../components/institutional/PoteBirthCard';
import { CouncilAnchorCard } from '../../../../components/institutional/CouncilAnchorCard';
import { GuidedDemo } from '../../../../components/institutional/GuidedDemo';
import { PasskeyGate } from '../../../../components/institutional/user/PasskeyGate';
import { UserVaultPanel } from '../../../../components/institutional/user/UserVaultPanel';
import { useCatalogPolicies } from '../../../../lib/institutional/useCatalogPolicies';
import LegacyPanel from '../../../../components/legacy/LegacyPanel';

// deploy trigger: pote A vivo en 0x21d4ccf29EEB61E573c2037F2B29B727168c3da9
const ENABLED = process.env.NEXT_PUBLIC_INSTITUTIONAL_ENABLED === 'true';
type Section = 'guided' | 'exchange' | 'user' | 'council';

export default function AdminInstitutionalPage() {
  const { t } = useT();

  if (!ENABLED) {
    return (
      <div className="p-6">
        <p className="text-sm text-ink/60">{t('The institutional module is not enabled on this environment.')}</p>
      </div>
    );
  }

  // Gate de admin (cerrado): esta página compone gobierno y
  // capital reales; la flag sola dejaba entrar a cualquier usuario logueado que
  // tecleara la URL. PreviewOnly es fail-closed con veredicto de SERVIDOR
  // (isAdmin de /auth/me) — igual que sus hermanas /exchange y /client.
  return (
    <PreviewOnly label="Demo institucional (guiada)" pending="rodaje 13-sep">
      <AdminInstitutionalDemo />
    </PreviewOnly>
  );
}

function AdminInstitutionalDemo() {
  const { t } = useT();
  const [section, setSection] = useState<Section>('guided');
  const { policies } = useCatalogPolicies();

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">{t('Institutional demo')}</h1>
        <p className="text-xs text-ink/60">
          {t('The manager can work the capital; it can never decide whether you may leave.')}{' '}
          {t('Demo: Astryum plays the operator — no exchange uses this yet.')}
        </p>
      </header>

      {/* Product surfaces: the two sides, separated — built beside this page. */}
      <p className="text-[11px] text-ink/50">
        <a href="/app/admin/institutional/exchange" className="underline hover:text-ink">{t('Exchange console →')}</a>
        {' · '}
        <a href="/app/admin/institutional/client" className="underline hover:text-ink">{t('Client surface →')}</a>
      </p>

      <nav className="flex gap-2">
        {(
          [
            ['guided', t('Guided demo')],
            ['exchange', t('Exchange')],
            ['user', t('User')],
            ['council', t('Council')],
          ] as Array<[Section, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold border ${
              section === key ? 'border-volt text-volt' : 'border-ink/10 text-ink/60'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

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

      {/* SOLO en su tab. Antes era el `else` de 'exchange', así que el panel del
          cliente se pintaba también debajo de Guided y Council — tres de cuatro
          tabs enseñaban el panel equivocado. */}
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

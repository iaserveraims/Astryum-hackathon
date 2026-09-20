'use client';

/**
 * ManagerAccountInXaman — crear la cuenta XRPL del gestor, EN XAMAN.
 *
 * El gemelo pequeño de `CouncilInXaman` (Legacy): Astryum no genera claves ni
 * las ve jamás (invariante #1) — su papel es guiar pantalla a pantalla dentro
 * de la wallet del usuario, decir cuánto XRP hace falta y por qué, y leer el
 * ledger cuando la cuenta vuelve conectada. La cuenta del gestor es PÚBLICA
 * (gobierna un vehículo agrupado y queda ligada a sus credenciales), así que
 * la guía empuja a una cuenta NUEVA y dedicada, no a la personal.
 */

import { ArrowUpRight, KeyRound, PenLine, Smartphone, Wallet } from 'lucide-react';
import Link from 'next/link';
import { Card, MicroLabel } from '../ui/primitives';
import { useT } from '../../i18n/LanguageProvider';

export function ManagerAccountInXaman() {
  const { t } = useT();

  const steps = [
    {
      icon: Smartphone,
      title: t('In Xaman: add a new account'),
      body: t('In Xaman, tap the account switcher → “Add account” → “Create new account”. The keys are generated on your phone and never leave it — Astryum never sees them.'),
    },
    {
      icon: PenLine,
      title: t('Write the secret down, on paper'),
      body: t('Xaman shows the family seed once. Write it on paper and keep it offline: it is the only copy, and whoever holds it holds the account.'),
    },
    {
      icon: Wallet,
      title: t('Activate it with XRP'),
      body: t('An XRPL account exists once it receives its first XRP. Send it ~2 XRP from another account or an exchange: 1 stays locked as the base reserve; the rest covers credential reserves and fees.'),
    },
    {
      icon: KeyRound,
      title: t('Connect it here'),
      body: t('Back in Astryum, connect the new account from Wallets. This desk reads the ledger and lights up with it.'),
    },
  ];

  return (
    <Card className="p-6">
      <MicroLabel>{t('A dedicated account for your management')}</MicroLabel>
      <p className="mt-2 max-w-[64ch] text-[13px] leading-relaxed text-ink/55">
        {t('The account that governs a vault is public: clients see it, credentials attach to it, every order carries its signature. Use a FRESH account dedicated to managing — created in your Xaman, where its keys are born and stay.')}
      </p>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">
              {i + 1}
            </span>
            <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink/80">{s.title}</p>
              <p className="mt-0.5 max-w-[58ch] text-[12px] leading-relaxed text-ink/50">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Link
        href="/app/wallets"
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-volt/40 bg-volt/[0.08] px-3 py-1.5 text-[12px] font-medium text-volt"
      >
        {t('Connect it from Wallets')} <ArrowUpRight className="h-3.5 w-3.5" />
      </Link>
    </Card>
  );
}

export default ManagerAccountInXaman;

'use client';

/**
 * ExchangeAccountGate — LA PUERTA DE ENTRADA (fundador 2026-09-11: «para los
 * usuarios que vengan nuevos se tienen que crear o vincular su cuenta antes
 * de empezar a usar el exchange»).
 *
 * Nadie entra en la mesa sin una cuenta XRPL elegida como SU cuenta. Tres
 * puertas, una por situación:
 *   · No tengo cuenta XRPL → crearla en Xaman, paso a paso, con el enlace.
 *   · Ya la tengo en Astryum → elegir una de las Xaman conectadas.
 *   · Tengo cuenta, pero no está aquí → añadirla desde Wallets (?add=1).
 *
 * Elegida, la mesa entera la sigue (credenciales, constitución, jaula,
 * órdenes). Se puede cambiar después desde la estación «Root account».
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, KeyRound, PenLine, Plus, Smartphone, Wallet } from 'lucide-react';
import { Card, GhostButton, MicroLabel, PrimaryButton } from '../../ui/primitives';
import { WalletSelect, type WalletFaceRecord } from '../../wallet/WalletSelect';
import { useLinkedRecordOf } from '../../../hooks/useLinkedRecordOf';
import { walletDisplayName } from '../../../lib/walletIdentity';
import { useT } from '../../../i18n/LanguageProvider';
import { useWalletStore } from '../../../stores/walletStore';
import { shortAddr } from '../../../lib/institutional/format';

type Door = 'none' | 'link' | 'new';

export function ExchangeAccountGate({ onChosen }: { onChosen: () => void }) {
  const { t } = useT();
  const allWallets = useWalletStore((s) => s.wallets);
  const setActiveWallet = useWalletStore((s) => s.setActiveWallet);
  const xrplWallets = useMemo(() => allWallets.filter((w) => w.isConnected && w.walletType === 'xaman'), [allWallets]);
  // El apodo del DUEÑO, no la etiqueta de sesión «Xaman 1 (…)» (2026-09-13).
  const linkedOf = useLinkedRecordOf();
  const [door, setDoor] = useState<Door | null>(xrplWallets.length > 0 ? 'link' : null);
  const [picked, setPicked] = useState<string>(xrplWallets[0]?.id ?? '');

  const doors: Array<{ key: Door; icon: typeof Wallet; title: string; body: string }> = [
    { key: 'none', icon: Smartphone, title: t('I don\'t have an XRPL account'), body: t('Create one in Xaman in two minutes — the keys are born on your phone.') },
    { key: 'link', icon: KeyRound, title: t('I already have one in Astryum'), body: t('Pick one of the Xaman wallets you connected.') },
    { key: 'new', icon: Plus, title: t('I have one, but not here yet'), body: t('Connect it from Wallets and come back.') },
  ];

  const createSteps = [
    { icon: Smartphone, title: t('Install Xaman'), body: t('The XRPL wallet where your keys are born and stay. Free, on iOS and Android.'), link: { label: 'xaman.app', href: 'https://xaman.app' } },
    { icon: PenLine, title: t('Create a new account and write the secret on paper'), body: t('Xaman shows the family seed once. Paper, offline — whoever holds it holds the account.') },
    { icon: Wallet, title: t('Activate it with a few XRP'), body: t('An XRPL account exists once it receives its first XRP. For an exchange root, 15–30 XRP cover reserves, objects and the birth of the cage.') },
    { icon: KeyRound, title: t('Connect it here'), body: t('Back in Astryum, add it from Wallets. This desk follows it from then on.') },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="p-6">
        <MicroLabel>{t('Before you start')}</MicroLabel>
        <h2 className="mt-2 text-[20px] font-semibold tracking-tight text-ink">{t('Which XRPL account is yours here?')}</h2>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
          {t('Everything on the exchange desk follows ONE XRPL account of yours: it holds the credentials, anchors the rules and signs every order in Xaman. Choose how you bring it.')}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {doors.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDoor(d.key)}
              aria-pressed={door === d.key}
              className={`flex flex-col items-start rounded-xl border p-4 text-left transition-colors ${door === d.key ? 'border-volt/50 bg-volt/[0.05]' : 'border-ink/10 hover:border-ink/25'}`}
            >
              <d.icon className={`h-5 w-5 ${door === d.key ? 'text-volt' : 'text-ink/35'}`} strokeWidth={1.7} />
              <span className="mt-2 text-[13px] font-medium text-ink/85">{d.title}</span>
              <span className="mt-1 text-[12px] leading-relaxed text-ink/50">{d.body}</span>
            </button>
          ))}
        </div>
      </Card>

      {door === 'none' ? (
        <Card className="p-6">
          <MicroLabel>{t('Create your account in Xaman')}</MicroLabel>
          <ol className="mt-4 space-y-3">
            {createSteps.map((s, i) => (
              <li key={s.title} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-ink/15 font-mono text-[10px] text-ink/45">{i + 1}</span>
                <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/35" strokeWidth={1.7} />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink/80">{s.title}</p>
                  <p className="mt-0.5 max-w-[58ch] text-[12px] leading-relaxed text-ink/50">{s.body}</p>
                  {s.link ? (
                    <a href={s.link.href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-volt hover:underline">
                      {s.link.label} <ArrowUpRight className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="https://xaman.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-volt/40 bg-volt/[0.08] px-3 py-1.5 text-[12px] font-medium text-volt">
              {t('Get Xaman')} <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
            <Link href="/app/wallets?add=1" className="inline-flex items-center gap-1.5 rounded-lg border border-ink/10 px-3 py-1.5 text-[12px] text-ink/70 transition-colors hover:border-ink/25 hover:text-ink">
              {t('Then connect it from Wallets')} <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </Card>
      ) : null}

      {door === 'link' ? (
        <Card className="p-6">
          <MicroLabel>{t('Your Xaman wallets in Astryum')}</MicroLabel>
          {xrplWallets.length === 0 ? (
            <p className="mt-2 text-[12px] text-tone-warning">{t('No Xaman wallet connected yet — connect it from Wallets first.')}</p>
          ) : (
            <>
              <div className="mt-3 max-w-sm">
                <WalletSelect
                  options={xrplWallets.map((w) => {
                    const linked = linkedOf(w.address);
                    return {
                    key: w.id,
                    record: (linked ?? { address: w.address, walletType: w.walletType, ecosystem: 'xrpl' }) as WalletFaceRecord,
                    name: linked ? walletDisplayName(linked, t) : (w.nickname || 'Xaman'),
                    detail: shortAddr(w.address),
                  };
                  })}
                  value={picked}
                  onChange={setPicked}
                />
              </div>
              <p className="mt-2 max-w-[60ch] text-[11px] leading-relaxed text-ink/40">
                {t('For an exchange root, use a NEW account with no history: one root governs one cage, for ever.')}
              </p>
              <PrimaryButton
                onClick={() => {
                  const w = xrplWallets.find((x) => x.id === picked);
                  if (w) { setActiveWallet(w); onChosen(); }
                }}
                disabled={!picked}
                className="mt-4"
              >
                {t('Use this account')}
              </PrimaryButton>
            </>
          )}
          <div className="mt-3">
            <Link href="/app/wallets?add=1" className="inline-flex items-center gap-1 text-[12px] text-ink/50 transition-colors hover:text-ink">
              <Plus className="h-3.5 w-3.5" /> {t('Add another from Wallets')}
            </Link>
          </div>
        </Card>
      ) : null}

      {door === 'new' ? (
        <Card className="p-6">
          <MicroLabel>{t('Connect your account')}</MicroLabel>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-ink/55">
            {t('Wallets opens the connection flow: scan with your Xaman, sign the binding, and it appears in your list. Come back here and pick it.')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/wallets?add=1" className="inline-flex items-center gap-1.5 rounded-lg border border-volt/40 bg-volt/[0.08] px-3 py-1.5 text-[12px] font-medium text-volt">
              {t('Connect it from Wallets')} <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <GhostButton onClick={() => setDoor('link')}>{t('I already connected it')}</GhostButton>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

export default ExchangeAccountGate;

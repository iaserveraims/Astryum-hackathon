'use client';

/**
 * CoinbaseVerificationGuide — cómo verificarte con Coinbase, pantalla a
 * pantalla, para que la credencial KYC de tu cuenta de gestor llegue sola
 * (fundador 10-sep: «que sea igual que en el Legacy: si el usuario se ve
 * confundido, que sea fácil de abrir la pantalla con la configuración
 * necesaria en Coinbase»).
 *
 * El gemelo del tutorial de Multisign de CouncilInXaman: un paso por
 * pantalla con su captura o vídeo (StepShot; los ficheros viven en
 * /public/managed/coinbase — ver su README), y en cada paso el enlace OFICIAL
 * de Coinbase que corresponde. Las capturas son NUESTRAS (del fundador): no
 * se incrustan imágenes ni vídeos de terceros — derechos y privacidad.
 *
 * Lo que Coinbase publica onchain es solo «esta wallet pertenece a una cuenta
 * verificada»: ningún dato personal. Astryum lee ese hecho público y nada más.
 */

import { useState } from 'react';
import { ArrowUpRight, BookOpen, X } from 'lucide-react';
import { GhostButton } from '../ui/primitives';
import { ModalOverlay } from '../ui/ModalPortal';
import { StepShot } from '../ui/StepShot';
import { useT } from '../../i18n/LanguageProvider';

const MEDIA = '/managed/coinbase';

/** Enlaces OFICIALES de Coinbase — los únicos que se enlazan. */
export const COINBASE_LINKS = {
  signup: 'https://www.coinbase.com/signup',
  gettingStarted: 'https://help.coinbase.com/en/coinbase/getting-started',
  verifyIdentity: 'https://help.coinbase.com/en/coinbase/getting-started/getting-started-with-coinbase/id-doc-verification',
  onchainVerifyHelp: 'https://help.coinbase.com/en/coinbase/getting-started/verify-my-account/onchain-verification',
  onchainVerify: 'https://www.coinbase.com/onchain-verify',
} as const;

export function CoinbaseVerificationGuideBody() {
  const { t } = useT();
  const steps: Array<{ file: string; title: string; body: string; link?: { label: string; href: string } }> = [
    {
      file: '01-signup',
      title: t('Create your Coinbase account'),
      body: t('At coinbase.com: email, password and the confirmation email. If you already have an account, skip to the next step.'),
      link: { label: t('Create an account at Coinbase'), href: COINBASE_LINKS.signup },
    },
    {
      file: '02-identity',
      title: t('Verify your identity at Coinbase'),
      body: t('Coinbase asks for your ID document and a selfie, in its own app. Those documents stay with Coinbase — Astryum never sees them.'),
      link: { label: t('Coinbase help: verify your identity'), href: COINBASE_LINKS.verifyIdentity },
    },
    {
      file: '03-onchain-verify',
      title: t('Open Coinbase’s onchain verification'),
      body: t('This is the page that writes the public proof: “this wallet belongs to a verified Coinbase account”. No personal data goes on-chain.'),
      link: { label: t('coinbase.com/onchain-verify'), href: COINBASE_LINKS.onchainVerify },
    },
    {
      file: '04-connect-wallet',
      title: t('Connect the wallet you will use in Astryum'),
      body: t('Connect the SAME EVM wallet (MetaMask) you connect in Astryum. The proof is issued to that address — a different wallet means Astryum cannot find it.'),
      link: { label: t('Coinbase help: onchain verification'), href: COINBASE_LINKS.onchainVerifyHelp },
    },
    {
      file: '05-attested',
      title: t('Mint the “Verified account” attestation'),
      body: t('One click, free. When Coinbase shows the green tick, the attestation exists on the Base chain and you are done at Coinbase.'),
    },
    {
      file: '06-astryum-check',
      title: t('Back in Astryum: check and issue'),
      body: t('In the Title station, with that MetaMask wallet connected, press “Verify & issue what is missing”. Astryum finds your attestation by itself.'),
    },
    {
      file: '07-metamask-sign',
      title: t('Sign the challenge in MetaMask'),
      body: t('One signature ties your EVM wallet to your XRPL manager account. Nothing is sent to any chain and it costs nothing.'),
    },
    {
      file: '08-xaman-accept',
      title: t('Accept the credential in Xaman'),
      body: t('The notary issues the KYC credential to your XRPL account; it only counts once you accept it — one signature in your Xaman.'),
    },
  ];

  return (
    <div className="space-y-6">
      <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink/60">
        {t('Eight screens, most of them at Coinbase. The only thing that reaches Astryum is a public fact on the Base chain: your wallet belongs to a verified account.')}
      </p>
      <ol className="space-y-6">
        {steps.map((s, i) => (
          <li key={s.file} className="flex items-start gap-3">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ink/15 bg-ink/[0.04] font-mono text-[11px] text-ink/60">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-ink">{s.title}</p>
              <p className="mt-1 max-w-[60ch] text-[12px] leading-relaxed text-ink/55">{s.body}</p>
              {s.link ? (
                <a href={s.link.href} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[12px] text-volt hover:underline">
                  {s.link.label} <ArrowUpRight className="h-3 w-3" />
                </a>
              ) : null}
              {/* Vídeo si existe; si no, la captura; si tampoco, el marco con el nombre. */}
              <StepShot src={`${MEDIA}/${s.file}.mp4`} poster={`${MEDIA}/${s.file}.png`} caption={s.title} />
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[11px] leading-relaxed text-ink/40">
        {t('The links open Coinbase’s official help and pages. Astryum neither creates nor stores identity documents; it reads the public attestation and composes what you sign.')}
      </p>
    </div>
  );
}

/** El botón que abre la guía en modal — se pone donde alguien pueda perderse. */
export function CoinbaseGuideButton({ className = '' }: { className?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <GhostButton onClick={() => setOpen(true)} className={className}>
        <BookOpen className="mr-1.5 inline h-3.5 w-3.5" /> {t('Step by step: set up Coinbase')}
      </GhostButton>
      {open ? (
        <ModalOverlay onEscape={() => setOpen(false)} lockScroll className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
          <div className="my-auto flex max-h-[min(90dvh,48rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-ink">{t('Verify yourself with Coinbase')}</h2>
                <p className="mt-1 text-[12px] text-ink/45">{t('Screen by screen — from creating the account to accepting the credential in Xaman.')}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label={t('Close')} className="mt-1 shrink-0 text-ink/40 transition-colors hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
              <CoinbaseVerificationGuideBody />
            </div>
          </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}

export default CoinbaseVerificationGuideBody;

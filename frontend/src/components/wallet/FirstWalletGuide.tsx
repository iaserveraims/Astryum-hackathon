'use client';

/**
 * FirstWalletGuide — the interactive "I don't have a wallet yet" wizard.
 *
 * Founder 2026-08-08: users arriving straight from an exchange own tokens but
 * no wallet, so "Connect wallet" is a wall for them. This guide walks that
 * user from zero to connected in four steps, per ecosystem the beta accepts:
 * Xaman on XRPL and MetaMask on Flare (the same two rails as AddWalletModal).
 *
 * Two mounting modes, decided by the props:
 *  - With onConnectXrpl/onConnectEvm (Wallets page): the final step CONNECTS
 *    right here — the wizard ends where AddWalletModal would have.
 *  - Without them (Summary welcome panel): the final step links to
 *    /app/wallets?add=1, which auto-opens the Add Wallet modal on arrival.
 *
 * Copy rules honoured: the XRPL base reserve and the network-choice warning
 * are stated as NETWORK facts (never Astryum fees/promises); the secret-phrase
 * step says out loud that Astryum never asks for it (non-custodial invariant).
 */

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownToLine,
  ChevronLeft,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { Pill } from '@/components/ui/primitives';
import WalletBrandIcon from '@/components/wallet/WalletBrandIcon';
import { useT } from '@/i18n/LanguageProvider';

type GuidePath = 'xrpl' | 'evm';

type GuideStep = {
  icon: LucideIcon;
  /** EN strings are the i18n keys — t() at render, same as the whole app. */
  title: string;
  body: string;
  /** Softer, boxed aside — network rules, tag/network gotchas. */
  note?: string;
  link?: { href: string; label: string };
  /** Label of the advance button ("I have the app", "Secret saved"…). */
  advance: string;
};

// Official download portals ONLY — the guide repeats "never from a link
// someone sent you" precisely because fake wallet sites are the #1 scam
// vector for exchange-only users.
const XAMAN_URL = 'https://xaman.app';
const METAMASK_URL = 'https://metamask.io';

const STEPS: Record<GuidePath, GuideStep[]> = {
  xrpl: [
    {
      icon: Download,
      title: 'Install Xaman',
      body: 'Xaman is the XRPL wallet app, for iOS and Android. Download it only from the official site — never from a link someone sent you.',
      link: { href: XAMAN_URL, label: 'xaman.app' },
      advance: 'I have the app',
    },
    {
      icon: KeyRound,
      title: 'Create your account and guard the secret',
      body: 'The app generates your secret numbers — they ARE the wallet. Write them on paper and keep them offline. Astryum will never ask for them; nobody legitimate will.',
      note: 'The XRP Ledger keeps a small base reserve (about 1 XRP) locked in every active address — a network rule, not a fee.',
      advance: 'Secret saved',
    },
    {
      icon: ArrowDownToLine,
      title: 'Withdraw from your exchange',
      body: 'Copy your address (r…) from Xaman. In your exchange, withdraw XRP over the XRP Ledger network and paste it. Send a small test amount first; the rest once it arrives.',
      note: 'Destination tag: your Xaman address is only yours, so if the exchange marks the field optional you can leave it empty.',
      advance: 'Done — my XRP is on its way',
    },
    {
      icon: Link2,
      title: 'Connect it to Astryum',
      body: 'Connecting only reads your address — your balance and positions appear on their own. Enabling transactions is a separate, per-wallet signature, always yours.',
      advance: 'Connect Xaman',
    },
  ],
  evm: [
    {
      icon: Download,
      title: 'Install MetaMask',
      body: 'MetaMask is the most used EVM wallet — a browser extension and a mobile app. Download it only from the official site — never from a link someone sent you.',
      link: { href: METAMASK_URL, label: 'metamask.io' },
      advance: 'I have the app',
    },
    {
      icon: KeyRound,
      title: 'Create your wallet and guard the phrase',
      body: 'The app gives you a 12-word recovery phrase — it IS the wallet. Paper, offline, never typed into any website. Astryum will never ask for it; nobody legitimate will.',
      advance: 'Phrase saved',
    },
    {
      icon: ArrowDownToLine,
      title: 'Withdraw from your exchange on the Flare network',
      body: 'Copy your address (0x…) from MetaMask. In your exchange, withdraw FLR choosing the Flare network. Send a small test amount first; the rest once it arrives.',
      note: 'If your exchange does not offer the Flare network for that token, do not send — funds sent over a different network do not arrive on Flare.',
      advance: 'Done — my funds are on their way',
    },
    {
      icon: Link2,
      title: 'Connect it to Astryum',
      body: 'Connecting only reads your address — your balance and positions appear on their own. Astryum switches MetaMask to Flare Mainnet (chain 14) when you connect. Enabling transactions is a separate, per-wallet signature, always yours.',
      advance: 'Connect MetaMask',
    },
  ],
};

export function FirstWalletGuide({
  onClose,
  onConnectXrpl,
  onConnectEvm,
}: {
  onClose: () => void;
  /** Present on the Wallets page: the wizard's last step connects directly. */
  onConnectXrpl?: () => Promise<void>;
  onConnectEvm?: () => Promise<void>;
}) {
  const { t } = useT();
  const [path, setPath] = useState<GuidePath | null>(null);
  const [step, setStep] = useState(0);
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const steps = path ? STEPS[path] : null;
  const current = steps ? steps[step] : null;
  const isLast = !!steps && step === steps.length - 1;
  const connectHandler = path === 'xrpl' ? onConnectXrpl : onConnectEvm;

  function back() {
    setConnectError(null);
    if (step > 0) setStep(step - 1);
    else setPath(null);
  }

  async function submitConnect() {
    if (!connectHandler) return;
    setConnectBusy(true);
    setConnectError(null);
    try {
      await connectHandler();
      onClose();
    } catch (e) {
      setConnectError((e as Error).message);
    } finally {
      setConnectBusy(false);
    }
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {path && (
              <button
                onClick={back}
                aria-label={t('Back')}
                className="grid place-items-center w-7 h-7 rounded-full border border-ink/10 text-ink/50 hover:text-ink hover:bg-ink/[0.05] transition-colors shrink-0"
              >
                <ChevronLeft className="w-4 h-4" strokeWidth={2} />
              </button>
            )}
            <h2 className="text-base font-semibold text-ink truncate">{t('Your first wallet')}</h2>
          </div>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors" aria-label={t('Close')}>
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto">
          {!path ? (
            <div className="space-y-4">
              <Pill tone="info">{t('Non-custodial · You always sign')}</Pill>
              <p className="text-sm text-ink/60 leading-relaxed">
                {t('A wallet is your own account on the network — you hold the keys and Astryum never sees them. If your capital lives in an exchange today, four steps bring it under your own control.')}
              </p>
              <p className="text-[13px] font-semibold text-ink">{t('Where is your capital today?')}</p>

              <button
                onClick={() => { setPath('xrpl'); setStep(0); }}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-sky-400/30 bg-sky-400/10 text-left hover:bg-sky-400/20 transition-colors"
              >
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-surface-0/60 border border-ink/10 shrink-0">
                  <WalletBrandIcon brand="xaman" size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t('XRP on an exchange')}</span>
                  <span className="block text-xs text-ink/50 mt-0.5">{t('Create Xaman, the XRPL wallet app, and withdraw to it')}</span>
                </span>
              </button>

              <button
                onClick={() => { setPath('evm'); setStep(0); }}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl border border-volt/30 bg-volt/10 text-left hover:bg-volt/20 transition-colors"
              >
                <span className="grid place-items-center w-9 h-9 rounded-xl bg-surface-0/60 border border-ink/10 shrink-0">
                  <WalletBrandIcon brand="metamask" size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{t('FLR or tokens on Flare')}</span>
                  <span className="block text-xs text-ink/50 mt-0.5">{t('Create MetaMask and receive on the Flare network')}</span>
                </span>
              </button>

              <p className="text-[11px] text-ink/40">
                {t('Already have one of these apps? Close this and press Add Wallet — connecting takes one tap.')}
              </p>
            </div>
          ) : current ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2" aria-hidden>
                {steps!.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === step ? 'w-6 bg-volt' : i < step ? 'w-1.5 bg-volt/50' : 'w-1.5 bg-ink/15'
                    }`}
                  />
                ))}
                <span className="ml-auto text-[11px] text-ink/40 tabular-nums">
                  {step + 1} / {steps!.length}
                </span>
              </div>

              <div className="flex items-start gap-3.5">
                <span className="grid place-items-center w-10 h-10 rounded-xl bg-volt/10 border border-volt/20 text-volt shrink-0">
                  <current.icon className="w-5 h-5" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-ink leading-snug">{t(current.title)}</h3>
                  <p className="mt-1.5 text-[13px] text-ink/60 leading-relaxed">{t(current.body)}</p>
                </div>
              </div>

              {current.link && (
                <a
                  href={current.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-ink/10 bg-ink/[0.03] text-sm text-ink/80 hover:bg-ink/[0.06] hover:text-ink transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <ExternalLink className="w-4 h-4 text-ink/40" strokeWidth={1.75} />
                    {t('Official site')}
                  </span>
                  {/* The domain itself, untranslated: it is the thing to verify
                      in the browser bar before downloading anything. */}
                  <span className="font-mono text-xs text-ink/50">{current.link.label}</span>
                </a>
              )}

              {current.note && (
                <p className="px-4 py-3 rounded-xl border border-ink/10 bg-ink/[0.03] text-xs text-ink/55 leading-relaxed">
                  {t(current.note)}
                </p>
              )}

              {isLast && connectError && (
                <p className="text-xs text-tone-danger">{t(connectError)}</p>
              )}
            </div>
          ) : null}
        </div>

        {path && current && (
          <div className="px-6 py-4 border-t border-ink/5 shrink-0">
            {!isLast ? (
              <button
                onClick={() => { setStep(step + 1); }}
                className="w-full px-5 py-3 rounded-xl bg-volt text-volt-ink text-sm font-semibold hover:brightness-105 transition-all"
              >
                {t(current.advance)}
              </button>
            ) : connectHandler ? (
              <button
                onClick={() => void submitConnect()}
                disabled={connectBusy}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-volt text-volt-ink text-sm font-semibold hover:brightness-105 transition-all disabled:opacity-50"
              >
                {connectBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {t(current.advance)}
              </button>
            ) : (
              // Mounted away from the connect rail (Summary): hand over to the
              // Wallets page, which auto-opens Add Wallet on ?add=1.
              <Link
                href="/app/wallets?add=1"
                onClick={onClose}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-volt text-volt-ink text-sm font-semibold hover:brightness-105 transition-all"
              >
                <Link2 className="w-4 h-4" /> {t(current.advance)}
              </Link>
            )}
          </div>
        )}
      </div>
    </ModalOverlay>
  );
}

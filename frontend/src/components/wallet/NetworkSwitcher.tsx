'use client';

import { usePathname } from 'next/navigation';
import { FLARE_CHAIN_ID, FLARE_ADD_CHAIN_PARAMS, CHAINLIST_FLARE_URL } from '../../lib/wallet/flareChain';
import { useSwitchToFlare } from '../../lib/wallet/useSwitchToFlare';
import { getStoredLang } from '../../i18n/LanguageProvider';
import { translate } from '../../i18n/dict';

/**
 * V1 FINAL Flare-only enforcer — the app-wide safety net.
 *
 * If the user's CONNECTED EVM wallet is on a chain other than Flare Mainnet,
 * render a banner with a "Switch to Flare" button. The switch/add engine and
 * its failure contract live in useSwitchToFlare (shared with the active
 * wallet's card in WalletManager — the contextual surface).
 *
 * Shown ONLY when the site has an active EVM connection — a visitor whose
 * MetaMask extension merely exists (e.g. a Xaman-rail user) never sees it.
 * Raw wallet error text is never rendered.
 *
 * V1 explicitly disallows: Songbird, Coston2, Ethereum, Solana, anything ≠ 14.
 */
export function NetworkSwitcher() {
  const pathname = usePathname();
  const flare = useSwitchToFlare();

  // The public marketing landing must never show ops banners (same guard as
  // EnvironmentBanner): here the in-flow strip rendered UNDER the landing's
  // fixed hackathon banner while shoving the hero down by its own height.
  if (pathname === '/') return null;
  if (!flare.wrongNetwork) return null;

  const t = (s: string) => translate(getStoredLang(), s);

  if (flare.manualNeeded) {
    return (
      <div className="w-full bg-red-950 border-b border-red-500/60 text-red-100 text-sm py-2 px-4 font-mono">
        <p>
          {t('Your wallet can’t add Flare automatically. Add it manually with these details, or open Chainlist:')}{' '}
          <a
            href={CHAINLIST_FLARE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-medium hover:text-white"
          >
            {t('Open Chainlist')} ↗
          </a>
        </p>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-xs text-red-200">
          <dt>{t('Network name')}</dt>
          <dd>{FLARE_ADD_CHAIN_PARAMS.chainName}</dd>
          <dt>RPC URL</dt>
          <dd>{FLARE_ADD_CHAIN_PARAMS.rpcUrls[0]}</dd>
          <dt>Chain ID</dt>
          <dd>{FLARE_CHAIN_ID}</dd>
          <dt>{t('Currency symbol')}</dt>
          <dd>{FLARE_ADD_CHAIN_PARAMS.nativeCurrency.symbol}</dd>
          <dt>{t('Block explorer')}</dt>
          <dd>{FLARE_ADD_CHAIN_PARAMS.blockExplorerUrls[0]}</dd>
        </dl>
      </div>
    );
  }

  return (
    <div className="w-full bg-red-950 border-b border-red-500/60 text-red-100 text-sm py-2 px-4 flex items-center justify-between font-mono">
      <span>
        {t("You're on another network — this app runs on Flare.")}
        {flare.declined && (
          <span className="ml-2">{t("No problem — you can switch whenever you're ready.")}</span>
        )}
      </span>
      <button
        onClick={flare.switchToFlare}
        disabled={flare.switching}
        className="ml-4 px-3 py-1 rounded bg-red-100 text-red-950 font-medium hover:bg-white disabled:opacity-50 whitespace-nowrap"
      >
        {flare.switching ? t('Switching…') : t('Switch to Flare')}
      </button>
    </div>
  );
}

export default NetworkSwitcher;

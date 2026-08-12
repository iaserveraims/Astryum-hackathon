'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Link2,
  ShieldCheck,
  PenLine,
  Star,
  Check,
  ArrowLeftRight,
} from 'lucide-react';
import {
  Card,
  HairlineCell,
  HairlineGroup,
  MicroLabel,
  PageHeader,
  Pill,
  SectionTitle,
  SegmentedControl,
} from '@/components/ui/primitives';
import { CountUp, RevealGroup, RevealItem, Spotlight } from '@/components/ui/motion';
import { formatMoneyCompact } from '@/lib/formatMoney';
import { fmtQtyActive } from '@/lib/format';
import { SceneDoor } from '@/components/ui/SceneDoor';
import { SignalBeacon } from '@/components/ui/scenes';
import { OrbitScene, CometMark } from '@/components/earn/icons';
import { useAuthStore } from '@/stores/authStore';
import { isAddressRemoved, useWalletLinking } from '@/lib/wallet/useWalletLinking';
import { useAuthorities } from '@/hooks/useAuthorities';
import { useSmartAccountsOf } from '@/hooks/useSmartAccountsOf';
import { addressKey } from '@/lib/authority';
import { connectWallet, updateWallet, type BackendWallet } from '@/services/walletLinkService';
import { useAppKitAccount } from '@reown/appkit/react';
import { useUniversalConnect } from '@/lib/wallet/useUniversalConnect';
// Demo: embedded-wallet creation is disabled front + back (EMBEDDED_WALLET_ENABLED).
// import { EmbeddedWalletCreatePanel } from '@/components/wallet/EmbeddedWalletCreatePanel';
import MovementsModal from '@/components/movements/MovementsModal';
import { AddressBookPanel } from '@/components/wallet/AddressBookPanel';
import { fetchNativeBalance, type NativeBalance } from '@/lib/wallet/nativeBalance';
import { useAggregatedPortfolio } from '@/hooks/useAggregatedPortfolio';
import { useBalanceVisibility } from '@/stores/balanceVisibilityStore';
import { useT } from '@/i18n/LanguageProvider';
import WalletBrandIcon from '@/components/wallet/WalletBrandIcon';
import WalletGlyphIcon from '@/components/wallet/WalletGlyphIcon';
import { WALLET_COLOR_PRESETS, brandOf, walletColor, walletDisplayName, walletIcon, walletProviderLabel } from '@/lib/walletIdentity';
import { walletHoldings, type WalletHolding } from '@/lib/portfolioMerge';
import { TokenLogo } from '@/components/ui/TokenLogo';
import { useSwitchToFlare, type FlareSwitch } from '@/lib/wallet/useSwitchToFlare';
import { CHAINLIST_FLARE_URL } from '@/lib/wallet/flareChain';
import { MULTI_VM_CONNECT_ENABLED } from '@/lib/wallet/config';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { FirstWalletGuide } from '@/components/wallet/FirstWalletGuide';

/* ------------------------------------------------------------------ */
/* CHAIN CONFIG                                                         */
/* ------------------------------------------------------------------ */

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum', 56: 'BNB Chain', 137: 'Polygon', 42161: 'Arbitrum',
  8453: 'Base', 10: 'Optimism', 43114: 'Avalanche', 14: 'Flare',
};

// One neutral chip for every chain — the name already identifies it, so no
// per-chain rainbow (de-AI pass 2026-07-21).
const CHAIN_BADGE: Record<number, string> = {
  1:      'ETH',
  42161:  'ARB',
  8453:   'BASE',
  137:    'POL',
  43114:  'AVAX',
  10:     'OP',
  56:     'BNB',
  14:     'FLR',
};

/* ------------------------------------------------------------------ */
/* TYPES                                                                */
/* ------------------------------------------------------------------ */

// NativeBalance + fetchNativeBalance live in lib/wallet/nativeBalance so the
// Send modal can show the exact same balance this card shows.
interface WalletPortfolio {
  native: NativeBalance | null;
  loading: boolean;
}

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

// ─── Organizer (founder 2026-07-25 · reworked user test 2026-08-03) ──────────
// "La vista de las wallets me parece un poco compleja": the fleet can be laid
// out three ways — a compact list (now the DEFAULT: the grid of full cards
// confused the first-time tester), the grid (operate), or grouped by native
// token — filtered by origin (added by you / created for you) and ordered
// A–Z, by balance or by colour tag. Persisted per browser so the chosen lens
// survives navigation.
type WalletsView = 'grid' | 'list' | 'token';
type WalletsOrder = 'name' | 'color' | 'balance';
type WalletsOriginFilter = 'all' | 'manual' | 'auto';
// Key bumped to v2 with the list-default change so every browser re-defaults
// ONCE — a 'grid' saved under the old key would silently override the new
// default forever.
const WALLETS_VIEW_STORE = 'astryum:walletsView.v2';

// ─── Origin (user test 2026-08-03) ───────────────────────────────────────────
// "No queda claro cuál es cuál": the fleet mixed wallets the user added by
// hand with rows the platform registered for them. There is no stored origin
// field — origin is DERIVED from walletType, whose writers are a closed set.
// CASE-SENSITIVE on purpose: 'Xaman' (capital X — the user pressed Connect)
// is manual, while 'xaman' (lowercase — the backend auto-registered the login
// wallet) is the platform's. Watch-only rows ('manual') are manual by
// definition: the user pasted the address.
const AUTO_WALLET_TYPES = new Set([
  'siwe', // login wallet, auto-registered by the SIWE flow
  'xaman', // login wallet, auto-registered by the Xaman login (≠ 'Xaman')
  'turnkey_embedded', // embedded wallet created by the platform
  'smart-account', // a council's Flare Smart Account (backend writer)
  'Flare Smart Account', // same account, synthesized client-side (Legacy tab)
  'Council · multisig', // synthesized council leg (Legacy tab)
  'evm', // old repository writer (auto-register)
]);
type WalletOrigin = 'manual' | 'auto';
function originOf(w: BackendWallet): WalletOrigin {
  return AUTO_WALLET_TYPES.has((w.walletType ?? '').trim()) ? 'auto' : 'manual';
}

/** Friendly sub-type shelf label inside each origin section of the list. */
function walletTypeLabelOf(w: BackendWallet, t: (s: string) => string): string {
  const wt = (w.walletType ?? '').trim();
  if (wt === 'manual') return t('Watch-only');
  if (wt === 'siwe' || wt === 'xaman') return t('Login wallet');
  if (wt === 'turnkey_embedded') return t('Embedded wallet');
  if (wt === 'smart-account' || wt === 'Flare Smart Account') return 'Smart Account';
  if (wt === 'Council · multisig') return t('Council');
  // A recognised provider shows its proper name ('xaman' → 'Xaman'), never
  // the raw writer value — same casing rule as the wallet display name.
  return walletProviderLabel(wt, w.ecosystem) ?? (wt || 'Wallet');
}

/** The token chips of what a wallet HOLDS (shared walletHoldings reading) —
 *  ALL readable tokens with their money in plain sight (founder 2026-08-12:
 *  a wallet holding ~10 FXRP read «0 FLR» and the chip said only "FXRP").
 *  Quantity when the snapshot priced it (never invented), USD always; the
 *  hidden-balances switch masks the numbers but keeps the identity. */
function HoldingsChips({ holdings, hidden }: { holdings: WalletHolding[]; hidden: boolean }) {
  if (holdings.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {holdings.map((h) => (
        <span
          key={h.symbol}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] pl-1 pr-2 py-0.5"
        >
          <TokenLogo symbol={h.symbol} size="xs" />
          <span className="font-mono text-[10px] text-ink/70 tabular-nums">
            {hidden ? `•••• ${h.symbol}` : h.qty != null ? `${fmtQtyActive(h.qty)} ${h.symbol}` : h.symbol}
          </span>
          <span className="font-mono text-[10px] text-ink/40 tabular-nums">
            {hidden ? '••••' : formatMoneyCompact(h.usd)}
          </span>
        </span>
      ))}
    </div>
  );
}

// Heading of an origin shelf — name, count, and one line saying what the shelf
// holds. The explanation IS the feature: the tester could not tell which
// wallet was which, so each section says where its rows came from.
function OriginShelfHeading({ origin, count, es }: { origin: WalletOrigin; count: number; es: boolean }) {
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <MicroLabel>
        {origin === 'manual' ? (es ? 'Añadidas por ti' : 'Added by you') : es ? 'De la plataforma' : 'From the platform'}
      </MicroLabel>
      <span className="font-mono text-[10px] text-ink/30">{count}</span>
      <span className="text-[11px] text-ink/35">
        {origin === 'manual'
          ? es
            ? 'wallets que conectaste o que miras'
            : 'wallets you connected or watch'
          : es
            ? 'cuentas registradas para ti — acceso, Smart Accounts, embedded'
            : 'accounts registered for you — login, Smart Accounts, embedded'}
      </span>
    </div>
  );
}

/** Native token of a wallet's home rail — the "Por token" grouping key. */
function nativeTokenOf(w: BackendWallet): string {
  if ((w.ecosystem ?? '').toLowerCase() === 'xrpl') return 'XRP';
  switch (w.chainId) {
    case 14:
      return 'FLR';
    case 1:
    case 42161:
    case 8453:
    case 10:
      return 'ETH';
    case 137:
      return 'POL';
    case 56:
      return 'BNB';
    case 43114:
      return 'AVAX';
    default:
      return 'EVM';
  }
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// A synthesized, READ-ONLY wallet row for a Legacy's leg that is not a linked
// /wallets/mine record — chiefly the multisig council account, which lives in
// the governed-accounts registry, never the wallet table. Rendered only in the
// embedded (read-only) card, so the fabricated id never reaches a write handler;
// the balance is fetched by address like any other card.
function legacyWalletRow(
  address: string,
  meta: { walletType: string; network: string; chainId: number | null; caip2: string | null; ecosystem: string },
): BackendWallet {
  return {
    id: `legacy:${address}`,
    address,
    walletType: meta.walletType,
    network: meta.network,
    chainId: meta.chainId,
    caip2: meta.caip2,
    ecosystem: meta.ecosystem,
    isPrimary: false,
    purpose: 'watch',
    isConnected: false,
    nickname: null,
    bindingId: null,
    bindingMode: null,
    txAuthorized: false,
    includeInPortfolio: false,
    color: null,
    icon: null,
  };
}

// One counter cell of the stats organism — the figure counts up to its value.
function WalletStat({
  label,
  value,
  hint,
  tone = 'text-ink',
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: string;
}) {
  return (
    <HairlineCell className="p-5">
      <div className="mb-2.5">
        <MicroLabel>{label}</MicroLabel>
      </div>
      <div className={`text-[26px] leading-none font-semibold tracking-tight font-mono ${tone}`}>
        <CountUp value={value} format={(v) => String(Math.round(v))} duration={0.7} />
      </div>
      {hint ? <div className="text-xs text-ink/40 mt-2">{hint}</div> : null}
    </HairlineCell>
  );
}


/* ------------------------------------------------------------------ */
/* WALLET CARD                                                          */
/* ------------------------------------------------------------------ */

// ─── Personalization panel — name + colour, shared by card and row ───────────
// The glyph picker left this panel (founder 2026-07-25: "los iconitos
// quítalos"); wallets that already carry a glyph keep rendering it.
function PersonalizePanel({
  wallet,
  onRename,
  onSetColor,
}: {
  wallet: BackendWallet;
  onRename: (id: string, nickname: string) => void;
  onSetColor: (id: string, color: string | null) => void;
}) {
  const { t } = useT();
  const [nameDraft, setNameDraft] = useState(wallet.nickname || '');
  const commitName = () => {
    const next = nameDraft.trim();
    if (next !== (wallet.nickname || '')) onRename(wallet.id, next);
  };
  return (
    <div className="mt-2 space-y-3 rounded-xl border border-ink/10 bg-ink/[0.03] p-3">
      <div className="flex items-center gap-1.5">
        <input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName();
            if (e.key === 'Escape') setNameDraft(wallet.nickname || '');
          }}
          placeholder={wallet.walletType}
          className="flex-1 min-w-0 px-2 py-1 bg-ink/5 border border-ink/10 rounded-md text-sm text-ink focus:outline-none focus:border-volt/50"
        />
        <button onClick={commitName} className="p-1 text-tone-success hover:brightness-110" title={t('Save')}>
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>

      <div>
        <MicroLabel tone="muted">{t('Colour tag')}</MicroLabel>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap" role="radiogroup" aria-label={t('Colour tag')}>
          {WALLET_COLOR_PRESETS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={wallet.color === c}
              onClick={() => onSetColor(wallet.id, wallet.color === c ? null : c)}
              className="h-4 w-4 rounded-full ring-1 ring-ink/20 transition-transform hover:scale-125"
              style={{ background: c, outline: wallet.color === c ? `2px solid ${c}` : 'none', outlineOffset: 1 }}
              title={c}
            />
          ))}
          <button
            onClick={() => onSetColor(wallet.id, null)}
            className="h-4 w-4 rounded-full border border-dashed border-ink/30 hover:border-ink/60"
            title={t('No colour')}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * A Flare Smart Account (Personal Account) row — the Flare address the backend
 * registers as `smart-account` when it resolves the PA of an XRPL account
 * (GET /flare-demo/personal-account), plus the synthesized label used on the
 * Legacy tab.
 *
 * It has NO key of its own: it only executes 0xFE userOps signed from the XRPL
 * account that controls it (Xaman). So an EVM ownership proof can never be
 * produced for it — offering "Enable transactions" dead-ended on "connect this
 * exact wallet in your wallet app", a demand no wallet app can ever satisfy
 * (founder 2026-08-03). Same reason the Earn signer picker excludes it.
 */
function isSmartAccount(w: BackendWallet): boolean {
  return w.walletType === 'smart-account' || w.walletType === 'Flare Smart Account';
}

// ─── Compact row — the "Lista" / "Por token" views (founder 2026-07-25) ──────
// The simple lens on a wallet: identity, name, address, chain, live native
// balance + USD, copy, Movements and the SAME pencil. The list is the DEFAULT
// lens since 2026-08-03, so it must let the user act, not just read — deep
// management (enable tx, remove, dashboard-inclusion) still lives on the card.
function WalletRow({
  wallet,
  holdings,
  busy,
  readOnly,
  onRename,
  onSetColor,
  onMovements,
}: {
  wallet: BackendWallet;
  /** What this wallet HOLDS (shared aggregated-portfolio reading) — undefined
   *  while the engine hasn't priced it (renders nothing, never a false 0). */
  holdings?: WalletHolding[];
  busy: boolean;
  readOnly: boolean;
  onRename: (id: string, nickname: string) => void;
  onSetColor: (id: string, color: string | null) => void;
  onMovements?: (w: BackendWallet) => void;
}) {
  const { t } = useT();
  const [customizing, setCustomizing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [native, setNative] = useState<NativeBalance | null>(null);
  const globalHidden = useBalanceVisibility((s) => s.hidden);
  const glyph = walletIcon(wallet);
  const badge = wallet.chainId ? CHAIN_BADGE[wallet.chainId] : null;

  const copyAddress = () => {
    navigator.clipboard
      ?.writeText(wallet.address)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* clipboard blocked — the full address is still on the card */
      });
  };

  useEffect(() => {
    let cancelled = false;
    fetchNativeBalance(wallet).then((bal) => {
      if (!cancelled && bal) setNative(bal);
    });
    const interval = setInterval(() => {
      fetchNativeBalance(wallet).then((bal) => {
        if (!cancelled && bal) setNative(bal);
      });
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, wallet.chainId, wallet.ecosystem]);

  return (
    <li className="border-b border-ink/[0.05] last:border-0">
      <div className="flex items-center gap-3 py-2.5 px-1">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `color-mix(in srgb, ${walletColor(wallet)} 18%, transparent)`,
            boxShadow: `inset 0 0 0 1.5px ${walletColor(wallet)}55`,
          }}
        >
          {glyph ? (
            <WalletGlyphIcon icon={glyph} size={13} color={walletColor(wallet)} />
          ) : (
            <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={13} />
          )}
        </div>
        <span className="min-w-0 truncate text-sm font-medium text-ink">
          {walletDisplayName(wallet, t)}
        </span>
        {wallet.isPrimary && <Star className="h-3 w-3 shrink-0 text-volt" fill="currentColor" aria-label={t('Primary')} />}
        <span className="hidden sm:block font-mono text-[11px] text-ink/40">{shortAddr(wallet.address)}</span>
        {badge && (
          <span className="hidden md:block rounded-full border border-ink/10 bg-ink/5 px-2 py-0.5 font-mono text-[10px] text-ink/45">
            {badge}
          </span>
        )}
        <span className="ml-auto shrink-0 text-right">
          <span className="block font-mono tabular-nums text-sm text-ink">
            {native
              ? globalHidden
                ? '••••'
                : `${(parseFloat(native.balance) || 0).toFixed(4)} ${native.symbol ?? ''}`
              : '…'}
          </span>
          {native && typeof native.usdValue === 'number' && (
            <span className="block font-mono tabular-nums text-[11px] text-ink/40">
              {globalHidden ? '••••' : formatMoneyCompact(native.usdValue)}
            </span>
          )}
        </span>
        <button
          onClick={copyAddress}
          className={`shrink-0 p-1 rounded-md transition-colors ${
            copied ? 'text-tone-success' : 'text-ink/40 hover:text-ink hover:bg-ink/5'
          }`}
          title={t('Copy address')}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        {!readOnly && onMovements && (
          <button
            onClick={() => onMovements(wallet)}
            disabled={busy}
            className="shrink-0 p-1 rounded-md text-volt/80 hover:text-volt hover:bg-volt/10 transition-colors disabled:opacity-40"
            title={t('Movements')}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </button>
        )}
        {!readOnly && (
          <button
            onClick={() => setCustomizing((v) => !v)}
            disabled={busy}
            className={`shrink-0 p-1 rounded-md transition-colors disabled:opacity-40 ${
              customizing ? 'text-volt bg-volt/10' : 'text-ink/40 hover:text-ink hover:bg-ink/5'
            }`}
            title={t('Customize')}
            aria-expanded={customizing}
          >
            <PenLine className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* What the wallet holds — the tokens Home/Portfolio already read for
          this address, finally visible on the Wallets screen too (founder
          2026-08-08: "se muestran en el portfolio y en el home pero no en la
          pantalla wallets"). */}
      {holdings && holdings.length > 0 && (
        <div className="pb-2.5 pl-10 pr-1">
          <HoldingsChips holdings={holdings} hidden={globalHidden} />
        </div>
      )}
      {!readOnly && customizing && (
        <div className="pb-3 pl-10 pr-1">
          <PersonalizePanel wallet={wallet} onRename={onRename} onSetColor={onSetColor} />
        </div>
      )}
    </li>
  );
}

function WalletCard({
  wallet,
  holdings,
  isActiveConnected,
  busy,
  readOnly = false,
  flareSwitch,
  onEnableTx,
  onDisableTx,
  onRename,
  onSetColor,
  onSetPrimary,
  onRemove,
  onMovements,
  onGovernedMovements,
  onToggleInclude,
}: {
  wallet: BackendWallet;
  /** What this wallet HOLDS (shared aggregated-portfolio reading) — undefined
   *  while the engine hasn't priced it (renders nothing, never a false 0). */
  holdings?: WalletHolding[];
  /** true if this is the wallet currently active in the wallet app (wagmi) */
  isActiveConnected: boolean;
  busy: boolean;
  /** Shared switch-to-Flare engine (one instance, owned by WalletManager).
   *  Renders the contextual «Switch to Flare» CTA ON the active EVM card when
   *  its live network ≠ Flare — same engine as the global banner, zero
   *  duplicated logic (founder 2026-07-29: the button belongs on the
   *  connected MetaMask wallet, not only on a global banner). */
  flareSwitch?: FlareSwitch;
  /** Governance-embedded (Legacy Wallets tab): a read-only card. Suppresses
   *  every write/action CTA — a Legacy's council is a MULTISIG and its Smart
   *  Account has no EOA key, so single-sig "Enable transactions" is a footgun /
   *  dead-end and "Remove" self-defeats (the PA re-registers).
   *  Identity + balance + copy + explorer remain. */
  readOnly?: boolean;
  /** Present only on a Legacy-scoped card: opens the GOVERNED Movements
   *  surface (compose unsigned → council inbox → quorum signs) instead of the
   *  single-sig modal a personal card opens. The gesture is the same, the rail
   *  is not — which is the whole point of the unification (2026-07-28). */
  onGovernedMovements?: () => void;
  onEnableTx: (address: string) => void;
  onDisableTx: (bindingId: string) => void;
  onRename: (id: string, nickname: string) => void;
  onSetColor: (id: string, color: string | null) => void;
  onSetPrimary: (id: string) => void;
  onRemove: (id: string) => void;
  onMovements: (wallet: BackendWallet) => void;
  onToggleInclude: (wallet: BackendWallet) => void;
}) {
  const { t } = useT();
  const { address, chainId, isPrimary, txAuthorized, bindingId } = wallet;
  const [copied, setCopied] = useState(false);
  const [portfolio, setPortfolio] = useState<WalletPortfolio>({ native: null, loading: false });
  // Per-card eye ORs with the app-wide hide-balances switch: the global
  // toggle (Portfolio / Summary) masks every card; the local eye can still
  // hide one card on its own.
  const [hideLocal, setHideLocal] = useState(false);
  const globalHidden = useBalanceVisibility((s) => s.hidden);
  const hideBalance = hideLocal || globalHidden;
  // Personalization is ONE panel (rename + colour) behind an always-visible
  // PENCIL (founder 2026-07-25: "no que se tenga que presionar los tres
  // puntitos" — the '⋯' hid it). The glyph PICKER left the panel the same day
  // ("los iconitos quítalos"); already-set glyphs keep rendering, data-driven.
  const [customizing, setCustomizing] = useState(false);
  const glyph = walletIcon(wallet);

  const badge = chainId ? CHAIN_BADGE[chainId] : null;
  const chainName = chainId ? CHAIN_NAMES[chainId] : t('Multi-chain');
  // The Smart Account is keyless (see isSmartAccount): it states the honest
  // fact instead of offering a signing capability nobody can grant.
  const smartAccount = isSmartAccount(wallet);

  useEffect(() => {
    let cancelled = false;
    setPortfolio({ native: null, loading: true });
    const load = () =>
      fetchNativeBalance(wallet).then((bal) => {
        // A failed re-check keeps the last known balance instead of blanking it.
        if (!cancelled) setPortfolio((prev) => ({ native: bal ?? prev.native, loading: false }));
      });
    load();
    // Re-check every 30s — silent refresh (no loading flicker), stops on unmount.
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, chainId, wallet.ecosystem]);

  function copy() {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const explorerBase = chainId === 14 ? 'https://flarescan.com/address/' : chainId === 1 ? 'https://etherscan.io/address/' : chainId === 42161 ? 'https://arbiscan.io/address/' : chainId === 8453 ? 'https://basescan.org/address/' : chainId === 137 ? 'https://polygonscan.com/address/' : null;

  return (
    <Card hover spotlight className="group relative overflow-hidden h-full">
      {/* faint per-chain watermark — the wallet's home ecosystem, sitting behind
          the content (never intercepts clicks): Flare/EVM orbit, XRPL comet. */}
      <div
        aria-hidden
        className="art-veil pointer-events-none absolute -right-10 -bottom-10 hidden sm:block group-hover:opacity-30 duration-500"
        style={{ zIndex: 0 }}
      >
        {wallet.ecosystem?.toLowerCase() === 'xrpl' ? <CometMark size={92} /> : <OrbitScene size={124} />}
      </div>
      <div className="relative z-[1]">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-1"
            style={{
              background: `color-mix(in srgb, ${walletColor(wallet)} 18%, transparent)`,
              boxShadow: `inset 0 0 0 1.5px ${walletColor(wallet)}55`,
            }}
            title={wallet.walletType}
          >
            {/* Personal glyph wins when set — tinted to the wallet's own
                colour so the chip stays legible on any hue. Falls back to
                the provider's brand mark. */}
            {glyph ? (
              <WalletGlyphIcon icon={glyph} size={20} color={walletColor(wallet)} />
            ) : (
              <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={20} />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-ink">{walletDisplayName(wallet, t)}</span>
              {!readOnly && (
                <button
                  onClick={() => setCustomizing((v) => !v)}
                  disabled={busy}
                  className={`p-1 rounded-md transition-colors disabled:opacity-40 ${
                    customizing ? 'text-volt bg-volt/10' : 'text-ink/40 hover:text-ink hover:bg-ink/5'
                  }`}
                  title={t('Customize')}
                  aria-expanded={customizing}
                >
                  <PenLine className="w-3.5 h-3.5" />
                </button>
              )}
              {isPrimary && <Pill tone="success">{t('Primary')}</Pill>}
              {smartAccount && (
                <Pill tone="neutral" size="sm">
                  {t('Smart Account')}
                </Pill>
              )}
            </div>
            <div className="text-[11px] font-mono text-ink/50 mt-0.5">{shortAddr(address)}</div>

            {/* Personalization — name + colour, one shared panel (the glyph
                picker left it 2026-07-25). */}
            {!readOnly && customizing && (
              <PersonalizePanel wallet={wallet} onRename={onRename} onSetColor={onSetColor} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {badge && (
            <span className="text-[10px] px-2 py-0.5 rounded-full border font-mono bg-ink/5 text-ink/45 border-ink/10">
              {badge}
            </span>
          )}
          <button
            onClick={copy}
            className="p-1.5 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            title={t('Copy address')}
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-tone-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {explorerBase && (
            <a
              href={`${explorerBase}${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
              title={t('View on explorer')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button
            onClick={() => setHideLocal((h) => !h)}
            className="p-1.5 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            title={hideBalance ? t('Show balance') : t('Hide balance')}
          >
            {hideBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          {!readOnly && (
            <button
              onClick={() => onRemove(wallet.id)}
              disabled={busy}
              className="p-1.5 rounded-md text-ink/40 hover:text-tone-danger hover:bg-tone-danger/10 transition-colors disabled:opacity-40"
              title={t('Remove wallet')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="pt-3 border-t border-ink/5">
        {portfolio.loading ? (
          <div className="flex items-center gap-2 text-ink/40 text-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {t('Fetching balance…')}
          </div>
        ) : portfolio.native ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-ink/40">{t('Available Balance')}</div>
                <div className="text-sm font-mono tabular-nums text-ink mt-1">
                  {hideBalance ? (
                    '••••'
                  ) : (
                    <>
                      <CountUp value={parseFloat(portfolio.native.balance) || 0} format={(v) => v.toFixed(4)} duration={0.6} />
                      {' '}
                      {portfolio.native.symbol ?? ''}
                    </>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-ink/40">{t('USD Value')}</div>
                <div className="text-sm font-mono tabular-nums text-ink mt-1">
                  {hideBalance
                    ? '••••'
                    : portfolio.native.usdValue == null
                      ? '—'
                      : <CountUp value={portfolio.native.usdValue} format={formatMoneyCompact} duration={0.6} />}
                </div>
              </div>
            </div>
            {/* XRPL locks a reserve on-ledger — excluded from the balance above */}
            {!hideBalance && portfolio.native.reservedXrp != null && (
              <div className="text-[10px] text-ink/30 mt-1.5 tabular-nums">
                {`+${portfolio.native.reservedXrp} XRP ${t('locked as XRPL reserve (not spendable)')}`}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-ink/30">
            <span>
              {wallet.ecosystem?.toLowerCase() === 'xrpl'
                ? `XRPL · ${t('Balance unavailable right now')}`
                : chainId && chainId !== 14
                  ? // Deliberately hidden, not an error: this beta reads Flare only.
                    `${chainName} · ${t('Balance hidden — showing Flare only for now')}`
                  : chainId
                    ? `${chainName} · ${t('Balance unavailable right now')}`
                    : t('Balance shown for Flare and XRPL wallets')}
            </span>
          </div>
        )}
        {/* What the wallet holds — same shared reading as Home/Portfolio
            (founder 2026-08-08), so a wallet with FXRP in Kinetic no longer
            looks empty next to its native balance. Independent of the native
            fetch: tokens still show when that read is unavailable. */}
        {holdings && holdings.length > 0 && (
          <div className="mt-3 pt-3 border-t border-ink/5">
            <div className="text-xs text-ink/40 mb-1.5">{t('Holds')}</div>
            <HoldingsChips holdings={holdings} hidden={hideBalance} />
          </div>
        )}
      </div>

      {/* Switch to Flare — contextual CTA on the ACTIVE connected EVM wallet
          when its live network ≠ Flare. The wallet opens its own pre-filled
          dialog (EIP-3085/3326); a decline is answered calmly and the CTA
          stays; an unsupported wallet gets the honest Chainlist way out. The
          global NetworkSwitcher banner remains as the app-wide safety net. */}
      {!readOnly &&
        isActiveConnected &&
        wallet.ecosystem?.toLowerCase() === 'evm' &&
        flareSwitch?.wrongNetwork && (
          <div className="mt-3 flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-tone-warning/25 bg-tone-warning/[0.07]">
            <span className="text-[11px] text-tone-warning/90">
              {flareSwitch.declined
                ? t("No problem — you can switch whenever you're ready.")
                : t("You're on another network — this app runs on Flare.")}
            </span>
            {flareSwitch.manualNeeded ? (
              <a
                href={CHAINLIST_FLARE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-tone-warning/30 bg-tone-warning/10 text-tone-warning hover:bg-tone-warning/20 transition-colors"
              >
                {t('Open Chainlist')} ↗
              </a>
            ) : (
              <button
                onClick={flareSwitch.switchToFlare}
                disabled={flareSwitch.switching}
                className="shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-tone-warning/30 bg-tone-warning/10 text-tone-warning hover:bg-tone-warning/20 transition-colors disabled:opacity-40"
              >
                {flareSwitch.switching ? t('Switching…') : t('Switch to Flare')}
              </button>
            )}
          </div>
        )}

      {/* Movements — one button opens the full surface: send/receive,
          set XRP aside (escrow) and native DEX buy/sell on XRPL wallets;
          send/receive on Flare wallets. Prepare-only; you sign in your wallet.
          A Legacy-scoped card shows the SAME button (founder 2026-07-28 — a
          council is a personal wallet that signs by quorum, so it deserves the
          same gesture) but routes to the GOVERNED surface: the move is composed
          unsigned and proposed to the council inbox, never signed single-sig
          here. Everything else on that card stays read-only. */}
      {(!readOnly || onGovernedMovements) && (
        <div className="mt-3">
          <button
            onClick={() => (onGovernedMovements ? onGovernedMovements() : onMovements(wallet))}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-volt/25 bg-volt/[0.07] text-volt text-xs font-medium hover:bg-volt/15 transition-colors"
            title={
              onGovernedMovements
                ? t('Compose a movement for this Legacy — the quorum signs it in Proposals')
                : t('Send, receive, set aside and trade — you sign in your own wallet')
            }
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            {t('Movements')}
          </button>
        </div>
      )}

      {/* Dashboard-inclusion toggle — excluded wallets don't count in the
          Summary/Portfolio monetary totals; the wallet stays fully manageable here. */}
      {!readOnly && (
        <button
          onClick={() => onToggleInclude(wallet)}
          disabled={busy}
          className="mt-2 w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-ink/5 transition-colors disabled:opacity-40 group"
          title={t('Include or exclude this wallet from the dashboard totals')}
        >
          <span className={`text-[11px] ${wallet.includeInPortfolio !== false ? 'text-ink/50' : 'text-tone-warning/80'}`}>
            {wallet.includeInPortfolio !== false
              ? t('Counts in dashboard totals')
              : t('Excluded from dashboard totals')}
          </span>
          <span
            className={`relative inline-block shrink-0 w-8 h-4 rounded-full transition-colors ${
              wallet.includeInPortfolio !== false ? 'bg-volt/70' : 'bg-ink/15'
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 w-3 h-3 rounded-full bg-black transition-transform ${
                wallet.includeInPortfolio !== false ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </span>
        </button>
      )}

      {/* Capability row — read-only vs tx-enabled. In the governed card there is
          no capability to grant: the account is a multisig / a council-operated
          Smart Account, so we state the honest read-only fact and offer no CTA.
          A personal Smart Account is the same story for a different reason: it
          holds no key at all, so there is nothing to enable — its moves are
          signed in Xaman by the XRPL account that controls it. */}
      <div className="mt-3 pt-3 border-t border-ink/5">
        {readOnly ? (
          <span className="flex items-center gap-2 text-[11px] text-ink/45">
            <ShieldCheck className="w-3.5 h-3.5" />
            {t('Governed by its council — Astryum never signs')}
          </span>
        ) : smartAccount ? (
          <span
            className="flex items-center gap-2 text-[11px] text-ink/45"
            title={t('It executes orders signed in Xaman by the XRPL account that controls it — there is no EVM key to prove.')}
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            {t('Operated from your XRPL account in Xaman — it has no key of its own')}
          </span>
        ) : txAuthorized ? (
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[11px] text-tone-success/90">
              <ShieldCheck className="w-3.5 h-3.5" />
              {t('Authorized for transactions')}
            </span>
            <div className="flex items-center gap-3">
              {!isPrimary && (
                <button
                  onClick={() => onSetPrimary(wallet.id)}
                  disabled={busy}
                  className="flex items-center gap-1 text-[11px] text-ink/40 hover:text-tone-warning transition-colors disabled:opacity-40"
                  title={t('Make this the default wallet for its chain ecosystem')}
                >
                  <Star className="w-3 h-3" />
                  {t('Set primary')}
                </button>
              )}
              {bindingId && (
                <button
                  onClick={() => onDisableTx(bindingId)}
                  disabled={busy}
                  className="text-[11px] text-ink/40 hover:text-tone-danger transition-colors disabled:opacity-40"
                >
                  {t('Revoke')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink/40">{t('Read-only — cannot sign transactions')}</span>
            <button
              onClick={() => onEnableTx(address)}
              disabled={busy}
              className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-volt/30 bg-volt/10 text-volt hover:bg-volt/20 transition-colors disabled:opacity-40"
              title={isActiveConnected ? t('Sign an ownership proof to enable transactions') : t('Connect this wallet in your wallet app first')}
            >
              <PenLine className="w-3 h-3" />
              {t('Enable transactions')}
            </button>
          </div>
        )}
      </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* PENDING WALLET BANNER                                                */
/* ------------------------------------------------------------------ */

/**
 * One partner-connected-but-not-yet-added wallet, as a row — replaces three
 * near-identical banner cards (EVM/Solana/Bitcoin) with one parametrized
 * component (de-AI pass 2026-07-21). Callers render as many as apply inside
 * a single shared Card.
 */
function PendingWalletBanner({
  label,
  address,
  busy,
  onAdd,
  onSecondary,
  secondaryLabel,
  secondaryTitle,
}: {
  label: string;
  address: string;
  busy: boolean;
  onAdd?: () => void;
  onSecondary?: () => void;
  secondaryLabel?: string;
  secondaryTitle?: string;
}) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between gap-3 py-3 px-5 relative overflow-hidden">
      <div
        className="art-veil pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hidden md:block"
        aria-hidden
        style={{ zIndex: 0 }}
      >
        <CometMark size={34} />
      </div>
      <div className="relative z-[1] flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-tone-success/15 border border-tone-success/30 flex items-center justify-center shrink-0">
          <Link2 className="w-4 h-4 text-tone-success" />
        </div>
        <div className="min-w-0">
          <div className="text-sm text-ink truncate">{label}</div>
          <div className="text-[11px] font-mono text-ink/50 truncate">{shortAddr(address)}</div>
        </div>
      </div>
      <div className="relative z-[1] flex items-center gap-2 shrink-0">
        {onAdd && (
          <button
            onClick={onAdd}
            disabled={busy}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-volt text-volt-ink hover:brightness-95 transition-all disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {t('Add this wallet')}
          </button>
        )}
        {onSecondary && (
          <button
            onClick={onSecondary}
            disabled={busy}
            title={secondaryTitle}
            className="text-xs text-ink/50 hover:text-ink px-3 py-1.5 rounded-lg border border-ink/10 hover:bg-ink/5 transition-colors disabled:opacity-50"
          >
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ADD WALLET MODAL                                                     */
/* ------------------------------------------------------------------ */

// Hackathon demo: the only two accepted wallets are Xaman (XRPL) and MetaMask
// on Flare (EVM), plus a watch-an-address form (XRPL / Flare, read-only). The
// multi-ecosystem connectors (AppKit multi-chain, Aptos, Stellar) are preserved
// in useUniversalConnect / walletLinkService but have no UI entry point here.
//
// Founder 2026-08-04: the MetaMask button no longer opens a wallet picker. It
// connects MetaMask itself and only survives on Flare Mainnet (chain 14) — the
// picker, the other chains and the other extensions are gone from the rail (see
// lib/wallet/config.ts · MULTI_VM_CONNECT_ENABLED).

/** XRPL classic address (base58, case-sensitive) and EVM address shapes. */
const WATCH_XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const WATCH_EVM_RE = /^0x[a-fA-F0-9]{40}$/;

function AddWalletModal({
  onConnect,
  onConnectXrpl,
  onWatchAddress,
  onNoWallet,
  connectBusy,
  connectError,
  onClose,
}: {
  /** Connect MetaMask on Flare (14). Rejects — and links nothing — otherwise. */
  onConnect: () => Promise<void>;
  onConnectXrpl: () => Promise<void>;
  onWatchAddress: (address: string) => Promise<void>;
  /** Swap this modal for the first-wallet guide (exchange-only users). */
  onNoWallet: () => void;
  connectBusy: string | null;
  connectError: string | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const [watchInput, setWatchInput] = useState('');
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  // The MetaMask button owns its own busy/error: a declined Flare switch must
  // be readable HERE (the modal used to close the moment it was pressed).
  const [evmBusy, setEvmBusy] = useState(false);
  const [evmError, setEvmError] = useState<string | null>(null);

  async function submitEvm() {
    setEvmBusy(true);
    setEvmError(null);
    try {
      await onConnect();
      onClose();
    } catch (e) {
      setEvmError((e as Error).message);
    } finally {
      setEvmBusy(false);
    }
  }

  async function submitWatch() {
    const addr = watchInput.trim();
    if (!WATCH_XRPL_RE.test(addr) && !WATCH_EVM_RE.test(addr)) {
      setWatchError(t('Enter a valid XRPL (r…) or Flare (0x…) address'));
      return;
    }
    setWatchBusy(true);
    setWatchError(null);
    try {
      await onWatchAddress(addr);
      onClose();
    } catch (e) {
      setWatchError((e as Error).message);
    } finally {
      setWatchBusy(false);
    }
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <h2 className="text-base font-semibold text-ink">{t('Add Wallet')}</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <button
            onClick={() => void submitEvm()}
            disabled={evmBusy || !!connectBusy}
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl border border-volt/30 bg-volt/10 text-volt text-sm font-medium hover:bg-volt/20 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2.5">
              {evmBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              MetaMask · Flare Mainnet
            </span>
            {/* Untranslated on purpose: "chain 14" is the identifier the user
                will also read inside MetaMask (t('chain') would say "cadena"). */}
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-volt/30 text-volt/80">
              chain 14
            </span>
          </button>
          {/* t() on the thrown prose: the connect rail speaks English, the UI
              may not — a miss falls back to the string itself. */}
          {evmError && <p className="text-xs text-tone-danger -mt-1">{t(evmError)}</p>}

          <button
            onClick={() => onConnectXrpl().then(onClose).catch(() => {})}
            disabled={!!connectBusy || evmBusy}
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl border border-sky-400/30 bg-sky-400/10 text-sky-200 text-sm font-medium hover:bg-sky-400/20 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2.5">
              {connectBusy === 'xrpl' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Xaman · XRPL
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-400/30 text-sky-200/80">XRP</span>
          </button>

          <p className="text-[11px] text-ink/40 text-center">
            {t('These are the two wallets accepted in this beta: MetaMask on Flare Mainnet (chain 14) and Xaman on XRPL. Connecting only reads the address — enabling transactions is a separate, per-wallet signature.')}
          </p>
          {connectError && <p className="text-xs text-tone-danger text-center -mt-1">{connectError}</p>}

          {/* The door for exchange-only users (founder 2026-08-08): both
              buttons above assume a wallet app already exists — this row is
              for the user who has none and would otherwise bounce here. */}
          <button
            onClick={onNoWallet}
            className="w-full px-4 py-3 rounded-xl border border-dashed border-ink/15 text-[13px] text-ink/60 hover:text-ink hover:bg-ink/[0.04] transition-colors"
          >
            {t('I don’t have a wallet yet — show me how')}
          </button>

          <div className="flex items-center gap-3">
            <span className="flex-1 h-px bg-ink/10" />
            <span className="text-[10px] uppercase tracking-wide text-ink/30">{t('or watch an address')}</span>
            <span className="flex-1 h-px bg-ink/10" />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void submitWatch(); }}
            className="space-y-2"
          >
            <div className="flex gap-2">
              <input
                value={watchInput}
                onChange={(e) => { setWatchInput(e.target.value); setWatchError(null); }}
                placeholder={t('XRPL (r…) or Flare (0x…) address')}
                spellCheck={false}
                autoComplete="off"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-xl bg-ink/5 border border-ink/10 text-sm text-ink placeholder-ink/25 font-mono focus:outline-none focus:border-volt/40 transition-colors"
              />
              <button
                type="submit"
                disabled={watchBusy || !watchInput.trim()}
                className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-ink/10 bg-ink/5 text-ink/80 text-sm font-medium hover:bg-ink/10 transition-colors disabled:opacity-40"
              >
                {watchBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                {t('Watch')}
              </button>
            </div>
            {watchError && <p className="text-xs text-tone-danger">{watchError}</p>}
            <p className="text-[11px] text-ink/40">
              {t('Watch-only: balances and positions are read — this address can never sign.')}
            </p>
          </form>
        </div>
      </div>
    </ModalOverlay>
  );
}

/* ------------------------------------------------------------------ */
/* PAGE                                                                 */
/* ------------------------------------------------------------------ */

export type WalletManagerScope = 'personal' | { legacyCouncil: string };

export default function WalletManager({
  scope = 'personal',
  variant = 'page',
  onGovernedMovements,
}: {
  /** 'personal' = Astryum Personal (every wallet MINUS the ones a Legacy owns);
   *  { legacyCouncil } = the "Wallets" tab of one Legacy (its council + its PA). */
  scope?: WalletManagerScope;
  /** 'page' = full standalone page (header, sign-in, add-wallet, address book);
   *  'embedded' = inside another surface (the Legacy governance tab). */
  variant?: 'page' | 'embedded';
  /** Legacy scope only: open the GOVERNED Movements surface for this Legacy
   *  (compose unsigned → council inbox → quorum). Given by the Legacy hub,
   *  which owns that modal; passing it here keeps the wallet layer free of any
   *  dependency on the governance components. */
  onGovernedMovements?: () => void;
} = {}) {
  const { t, lang } = useT();
  const es = lang === 'es';
  const legacyCouncil = typeof scope === 'object' ? scope.legacyCouncil : null;

  // Organizer state — restored once per mount, persisted on change. List is
  // the default lens (user test 2026-08-03: the card grid confused a
  // first-time holder — "no acaba de quedar clara cada wallet").
  const [view, setView] = useState<WalletsView>('list');
  const [order, setOrder] = useState<WalletsOrder>('name');
  const [originFilter, setOriginFilter] = useState<WalletsOriginFilter>('all');
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WALLETS_VIEW_STORE);
      if (!raw) return;
      const p = JSON.parse(raw) as { view?: WalletsView; order?: WalletsOrder; origin?: WalletsOriginFilter };
      if (p.view === 'grid' || p.view === 'list' || p.view === 'token') setView(p.view);
      if (p.order === 'name' || p.order === 'color' || p.order === 'balance') setOrder(p.order);
      if (p.origin === 'all' || p.origin === 'manual' || p.origin === 'auto') setOriginFilter(p.origin);
    } catch {
      /* corrupt/blocked storage — defaults stand */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(WALLETS_VIEW_STORE, JSON.stringify({ view, order, origin: originFilter }));
    } catch {
      /* best-effort */
    }
  }, [view, order, originFilter]);
  const user = useAuthStore((s) => s.user);
  const authLoading = useAuthStore((s) => s.isLoading);
  const authError = useAuthStore((s) => s.error);
  const login = useAuthStore((s) => s.login);
  const clearError = useAuthStore((s) => s.clearError);

  // A persisted user.address can outlive the JWT, and a stale auth_token can
  // outlive its server-side session. Decode the JWT locally and check exp; if
  // missing/expired we drop the token so the sign-in CTA reappears.
  const [hasJwt, setHasJwt] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    function check() {
      const token = window.localStorage.getItem('auth_token');
      if (!token) { setHasJwt(false); return; }
      const parts = token.split('.');
      if (parts.length !== 3) {
        window.localStorage.removeItem('auth_token');
        setHasJwt(false);
        return;
      }
      try {
        const payload = JSON.parse(atob(parts[1])) as { exp?: number };
        const now = Math.floor(Date.now() / 1000);
        if (!payload.exp || now >= payload.exp) {
          window.localStorage.removeItem('auth_token');
          setHasJwt(false);
          return;
        }
        setHasJwt(true);
      } catch {
        window.localStorage.removeItem('auth_token');
        setHasJwt(false);
      }
    }
    check();
    window.addEventListener('storage', check);
    return () => window.removeEventListener('storage', check);
  }, []);

  const linking = useWalletLinking(hasJwt);
  const { wallets: allLinkedWallets, connectedAddress, isConnected } = linking;

  // ONE shared switch-to-Flare engine for every card (same one the global
  // banner uses) — the active EVM card renders the contextual CTA from it.
  const flareSwitch = useSwitchToFlare();

  // Astryum Personal holds only NORMAL wallets (founder 2026-07-18/21): the
  // wallets a Legacy controls are NOT personal — its council multisig AND the
  // Flare Smart Account that council operates. Both leave the personal list and
  // live inside their Legacy (Governance › Wallets); a one-line note says so.
  const { governedCandidates } = useAuthorities();
  const confirmedCouncils = useMemo(
    () => governedCandidates.filter((g) => g.hasCouncil === true).map((g) => g.address),
    [governedCandidates],
  );
  // Personal excludes EVERY Legacy's Smart Account; the Legacy tab resolves just
  // its own council → PA. One deterministic resolver (getPersonalAccount) both.
  const { byXrpl: smartAccounts, paKeys } = useSmartAccountsOf(
    legacyCouncil ? [legacyCouncil] : confirmedCouncils,
  );

  const wallets = useMemo(() => {
    if (legacyCouncil) {
      // The wallets a Legacy controls — ALWAYS both legs, never dependent on the
      // /wallets/mine table: the council (XRPL, where authority + rules live) and
      // the Smart Account it operates on Flare. Where a real linked record exists
      // we use it (real balance/nickname/id); otherwise a synthesized read-only
      // row, so the council — which lives in the governed registry, not the
      // wallet table — never silently disappears from its own Legacy.
      const pa = smartAccounts[legacyCouncil];
      const byKey = new Map(allLinkedWallets.map((w) => [addressKey(w.address), w] as const));
      const rows: BackendWallet[] = [
        byKey.get(addressKey(legacyCouncil)) ??
          legacyWalletRow(legacyCouncil, {
            walletType: 'Council · multisig',
            network: 'xrpl',
            chainId: null,
            caip2: null,
            ecosystem: 'xrpl',
          }),
      ];
      if (pa) {
        rows.push(
          byKey.get(addressKey(pa)) ??
            legacyWalletRow(pa, {
              walletType: 'Flare Smart Account',
              network: 'flare',
              chainId: 14,
              caip2: 'eip155:14',
              ecosystem: 'evm',
            }),
        );
      }
      return rows;
    }
    const councilKeys = new Set(confirmedCouncils.map((a) => addressKey(a)));
    return allLinkedWallets.filter(
      (w) => !councilKeys.has(addressKey(w.address)) && !paKeys.has(addressKey(w.address)),
    );
  }, [allLinkedWallets, legacyCouncil, smartAccounts, confirmedCouncils, paKeys]);

  // Personal only: how many linked wallets moved into a Legacy (council + PA).
  const legacyOwnedCount = legacyCouncil ? 0 : allLinkedWallets.length - wallets.length;

  // Balance order reads the REAL per-wallet net worth from the shared
  // aggregated-portfolio store (already warm — the shell's poller feeds it);
  // wallets the engine hasn't priced yet sink to the bottom, A–Z among them.
  const { data: aggregatedPortfolio } = useAggregatedPortfolio();
  const usdByAddress = useMemo(() => {
    const m = new Map<string, number>();
    for (const pw of aggregatedPortfolio?.perWallet ?? []) {
      const v = pw?.snap?.netWorthUSD;
      if (typeof v === 'number') m.set(addressKey(pw.address), v);
    }
    return m;
  }, [aggregatedPortfolio]);
  // What each wallet HOLDS — the same per-wallet snapshot Home/Portfolio
  // read, finally surfaced on this screen (founder 2026-08-08). Wallets the
  // engine hasn't priced (excluded from portfolio, or a failed read) simply
  // have no entry — the row renders nothing, never a false "empty".
  const holdingsByAddress = useMemo(() => {
    const m = new Map<string, WalletHolding[]>();
    for (const pw of aggregatedPortfolio?.perWallet ?? []) {
      if (pw?.snap) m.set(addressKey(pw.address), walletHoldings(pw.snap));
    }
    return m;
  }, [aggregatedPortfolio]);

  // Organizer projections — order applies to every view; token groups feed the
  // "Por token" lens. Colour order walks the picker's own palette (tagged
  // first, in rainbow order; untagged after; A–Z inside each step).
  const sortedWallets = useMemo(() => {
    const displayName = (w: BackendWallet) => walletDisplayName(w).toLowerCase();
    const colorRank = (w: BackendWallet) => {
      const i = (WALLET_COLOR_PRESETS as readonly string[]).indexOf(w.color ?? '');
      return i === -1 ? WALLET_COLOR_PRESETS.length : i;
    };
    const usdRank = (w: BackendWallet) => usdByAddress.get(addressKey(w.address)) ?? -1;
    return [...wallets].sort((a, b) =>
      order === 'color'
        ? colorRank(a) - colorRank(b) || displayName(a).localeCompare(displayName(b))
        : order === 'balance'
          ? usdRank(b) - usdRank(a) || displayName(a).localeCompare(displayName(b))
          : displayName(a).localeCompare(displayName(b)),
    );
  }, [wallets, order, usdByAddress]);
  // The origin filter cuts across every lens; the two origin shelves feed the
  // sectioned list/grid (added-by-you first, the platform's after).
  const originFiltered = useMemo(
    () => (originFilter === 'all' ? sortedWallets : sortedWallets.filter((w) => originOf(w) === originFilter)),
    [sortedWallets, originFilter],
  );
  const originSections = useMemo(
    () =>
      (['manual', 'auto'] as const)
        .map((origin) => ({ origin, rows: originFiltered.filter((w) => originOf(w) === origin) }))
        .filter((s) => s.rows.length > 0),
    [originFiltered],
  );
  const tokenGroups = useMemo(() => {
    const groups = new Map<string, BackendWallet[]>();
    for (const w of originFiltered) {
      const key = nativeTokenOf(w);
      const list = groups.get(key) ?? [];
      list.push(w);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [originFiltered]);
  // The Legacy tab keeps its two-card grid — the organizer is a personal-fleet lens.
  const activeView: WalletsView = legacyCouncil ? 'grid' : view;

  // Solana wallet partner (AppKit, non-wagmi). Connecting it at the partner
  // layer doesn't persist it — we register it read-only so it shows up in the
  // list and aggregates in the portfolio, just like an EVM wallet.
  const solAccount = useAppKitAccount({ namespace: 'solana' });
  const solInList =
    !!solAccount.address &&
    wallets.some((w) => w.address === solAccount.address);

  // Bitcoin wallet partner (AppKit bip122 namespace).
  const btcAccount = useAppKitAccount({ namespace: 'bip122' });
  const btcInList =
    !!btcAccount.address &&
    wallets.some((w) => w.address === btcAccount.address);

  // Unified connect for native (non-AppKit) chains: XRPL/Aptos/Stellar.
  const universal = useUniversalConnect(linking.refresh);

  const [showAdd, setShowAdd] = useState(false);
  // First-wallet guide (exchange-only users) — opened from AddWalletModal's
  // "I don't have a wallet yet" row; its last step connects via the same
  // handlers the modal uses.
  const [showGuide, setShowGuide] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  // Per-wallet Movements modal — one button opens send/receive + (XRPL) escrow
  // & DEX buy/sell, chain-adaptive to the card's wallet.
  const [movementsWallet, setMovementsWallet] = useState<BackendWallet | null>(null);

  // Deep link from the Summary's guide: /app/wallets?add=1 lands with the Add
  // Wallet door already open, so the guided user doesn't have to hunt for a
  // button they have never seen. The param is consumed (stripped) so refresh
  // and back/forward don't reopen the modal. window.location, not
  // useSearchParams: this runs client-only and must not force a Suspense
  // boundary on the statically-rendered wallets page.
  useEffect(() => {
    if (variant !== 'page') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('add') !== '1') return;
    setShowAdd(true);
    params.delete('add');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, [variant]);

  async function handleAddSolana() {
    if (!solAccount.address) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await connectWallet({
        address: solAccount.address,
        walletType: 'Solana Wallet',
        network: 'solana',
        caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        ecosystem: 'solana',
        purpose: 'watch',
      });
      await linking.refresh();
      setActionMsg(t('Solana wallet added — it now shows in your portfolio.'));
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleAddBitcoin() {
    if (!btcAccount.address) return;
    setActionBusy(true);
    setActionMsg(null);
    try {
      await connectWallet({
        address: btcAccount.address,
        walletType: 'Bitcoin Wallet',
        network: 'bitcoin',
        caip2: 'bip122:000000000019d6689c085ae165831e93',
        ecosystem: 'bitcoin',
        purpose: 'watch',
      });
      await linking.refresh();
      setActionMsg(t('Bitcoin wallet added — it now shows in your portfolio.'));
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSiweLogin() {
    clearError();
    try {
      await login();
      setHasJwt(!!window.localStorage.getItem('auth_token'));
    } catch {
      /* error already in authStore */
    }
  }

  // ── Auto-register the SIWE primary (Flare) as READ-ONLY ──────────────────
  // Logging in is read-only; we persist the login wallet as a 'watch' row so it
  // shows up in the list with no tx capability. Connected wallets (AppKit) are
  // added EXPLICITLY via the banner below — auto-registering on connect would
  // block the user from picking a different wallet next.
  const attemptedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Personal-only: the Legacy tab must never auto-register the connected
    // personal wallet (it belongs to Astryum Personal, not this Legacy).
    if (variant !== 'page' || !hasJwt || !user?.address) return;
    // Only a real EVM address may be filed as a Flare row. `user.address` falls
    // back to the FIRST linked wallet when SIWE set none, and for a Xaman login
    // that is an XRPL r-address: lower-cased and hard-coded to Flare/eip155:14
    // below, it created a phantom "Flare N" twin of the user's own Xaman wallet
    // (no balance, and re-created on every page load after being deleted).
    if (!/^0x[0-9a-fA-F]{40}$/.test(user.address)) return;
    const addr = user.address.toLowerCase();
    if (allLinkedWallets.some((w) => w.address.toLowerCase() === addr)) return;
    // A wallet the user deleted stays deleted. `attemptedRef` is per mount, and
    // this effect also fires BEFORE the list has loaded, so without this the row
    // came back on every refresh. Re-adding it stays one explicit click away.
    if (isAddressRemoved(addr)) return;
    if (attemptedRef.current.has(addr)) return;
    attemptedRef.current.add(addr);
    connectWallet({
      address: addr,
      walletType: 'siwe',
      network: 'flare',
      chainId: 14,
      caip2: 'eip155:14',
      ecosystem: 'evm',
      purpose: 'watch',
    })
      .then(() => linking.refresh())
      .catch(() => attemptedRef.current.delete(addr));
  }, [variant, hasJwt, user?.address, allLinkedWallets, linking]);

  const connectedInList =
    !!connectedAddress &&
    wallets.some((w) => w.address.toLowerCase() === connectedAddress.toLowerCase());

  async function handleAddConnected() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await linking.addConnected();
      setActionMsg(t('Wallet added. Connect another to add more — pick any wallet app.'));
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  // Release the active session and reconnect MetaMask, so the user can hand
  // over a different account (switch it inside MetaMask first — the button's
  // title says so). Same single rail as "Add wallet": MetaMask, on Flare.
  async function handleConnectAnother() {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await linking.connectMetaMaskFlare();
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  // Let go of the live session without linking anything.
  async function handleDisconnect() {
    setActionBusy(true);
    try {
      await linking.disconnect();
    } finally {
      setActionBusy(false);
    }
  }

  async function handleEnableTx(address: string) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await linking.enableTransactions(address);
      setActionMsg(t('Transactions enabled for') + ' ' + shortAddr(address));
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDisableTx(bindingId: string) {
    setActionBusy(true);
    try {
      await linking.disableTransactions(bindingId);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSetColor(id: string, color: string | null) {
    setActionBusy(true);
    try {
      await updateWallet(id, { color });
      await linking.refresh();
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  // handleSetIcon removed with the glyph picker (founder 2026-07-25) — the
  // walletsApi.setIcon endpoint and stored glyphs stay; only the UI to set
  // NEW ones is gone.

  async function handleRename(id: string, nickname: string) {
    setActionBusy(true);
    try {
      await linking.rename(id, nickname);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSetPrimary(id: string) {
    setActionBusy(true);
    setActionMsg(null);
    try {
      await linking.setPrimary(id);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRemove(id: string) {
    setActionBusy(true);
    try {
      await linking.remove(id);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleToggleInclude(w: BackendWallet) {
    setActionBusy(true);
    try {
      await linking.setIncludeInPortfolio(w.id, w.includeInPortfolio === false);
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  }

  const totalWallets = wallets.length;
  const txEnabled = wallets.filter((w) => w.txAuthorized).length;
  // Group by chain name for EVM wallets (they carry a chainId) and by ecosystem
  // for everything else (XRPL/Solana/Bitcoin/Stellar wallets have no chainId and
  // would silently vanish from a chainId-keyed count).
  const ECOSYSTEM_LABELS: Record<string, string> = {
    xrpl: 'XRPL', solana: 'Solana', bitcoin: 'Bitcoin', stellar: 'Stellar',
    aptos: 'Aptos', algorand: 'Algorand', evm: 'EVM',
  };
  const chainCounts = new Map<string, number>();
  wallets.forEach((w) => {
    const label = w.chainId
      ? CHAIN_NAMES[w.chainId] ?? `Chain ${w.chainId}`
      : ECOSYSTEM_LABELS[w.ecosystem?.toLowerCase() ?? ''] ?? (w.ecosystem || 'Other');
    chainCounts.set(label, (chainCounts.get(label) ?? 0) + 1);
  });
  const chainRows = Array.from(chainCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {variant === 'page' ? (
        // ONE title key, not t('Connected')+t('wallets'): the composed pair
        // collided with the status pill's feminine 'Conectada' and read
        // "Conectada wallets" in Spanish.
        <PageHeader
          eyebrow="Wallets"
          title={t('Connected wallets')}
          subtitle="Connect as many wallets as you want — even several from the same app. Connecting is read-only; enable transactions per wallet with a one-time signature."
          actions={
            hasJwt && (
              <div className="flex items-center gap-2">
                {/* "Create wallet" (Turnkey embedded) is disabled for the demo —
                    see the note at the bottom of this file. */}
                <button
                  onClick={() => setShowAdd(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-volt text-volt-ink text-sm font-medium hover:brightness-95 transition-all shadow-lg shadow-volt/20"
                >
                  <Plus className="w-4 h-4" />
                  {t('Add Wallet')}
                </button>
              </div>
            )
          }
        />
      ) : (
        // Embedded in the Legacy governance "Wallets" tab: no page chrome, no
        // add-wallet (a Legacy's wallets are the council + its PA, resolved
        // deterministically — nothing to link here).
        <div className="mb-6">
          <MicroLabel>{t('Wallets')}</MicroLabel>
          <h2 className="text-lg font-semibold tracking-tight text-ink mt-2">
            {t('Wallets this Legacy controls')}
          </h2>
          <p className="text-sm text-ink/50 leading-relaxed mt-1 max-w-[60ch]">
            {t('The council governs on XRPL; the Smart Account it controls produces on Flare. Read-only here — every action is signed by the council, never by Astryum.')}
          </p>
        </div>
      )}

      {/* Stats — one hairline organism: three counters and the chains
          breakdown sharing a single panel, lit by the cursor like the
          Summary's hero. (Restored 2026-07-21: the founder wants the built
          artifact back, not the flat summary line the de-AI pass left.) */}
      <Spotlight className="rounded-2xl mb-8">
      <HairlineGroup columns="grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1.6fr]">
        <WalletStat label={t('Total Wallets')} value={totalWallets} hint={t('All linked')} />
        <WalletStat
          label={t('Tx Enabled')}
          value={txEnabled}
          hint={t('Can sign')}
          tone={txEnabled > 0 ? 'text-emerald-300' : 'text-amber-200'}
        />
        <WalletStat label={t('Read-only')} value={totalWallets - txEnabled} hint={t('Watch only')} />
        <HairlineCell className="col-span-3 lg:col-span-1">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <span className="text-[13px] font-semibold text-ink">{t('Chains')}</span>
            <span className="text-xs text-ink/40">
              {chainRows.length} {chainRows.length === 1 ? t('chain') : t('chains')}
            </span>
          </div>
          {chainRows.length === 0 ? (
            <div className="text-ink/40 text-sm px-5 py-4 text-center">{t('No chains yet')}</div>
          ) : (
            /* Wallets per chain — plain counts (never a balance, never $-masked),
               with a subtle proportional bar so the spread reads at a glance. */
            <ul className="px-2 pb-2 space-y-0.5">
              {chainRows.map(([label, count]) => (
                <li
                  key={label}
                  className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg hover:bg-ink/[0.03] transition-colors"
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-volt shrink-0" />
                    <span className="text-sm text-ink/85 truncate">{label}</span>
                  </span>
                  <span className="flex items-center gap-2.5 shrink-0">
                    <span className="hidden sm:block w-16 h-1 rounded-full bg-ink/[0.06] overflow-hidden" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-volt/50"
                        style={{ width: `${(count / (chainRows[0][1] || 1)) * 100}%` }}
                      />
                    </span>
                    <span className="text-sm text-ink/50 font-mono">
                      {count} {count === 1 ? t('wallet') : t('wallets')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </HairlineCell>
      </HairlineGroup>
      </Spotlight>

      {actionMsg && (
        <div className="mb-6 text-xs text-ink/70 bg-ink/5 border border-ink/10 rounded-xl px-4 py-2.5">
          {t(actionMsg)}
        </div>
      )}

      {/* Connected-wallet banner — add it, then connect another (any app) */}
      {/* Partner-connected-but-not-yet-added wallets — one shared card, one
          banner row per pending wallet (de-AI pass 2026-07-21: was three
          near-identical cloned Cards). Personal-only: the Legacy tab links no
          new wallets. */}
      {variant === 'page' &&
        hasJwt &&
        ((isConnected && connectedAddress) ||
          (MULTI_VM_CONNECT_ENABLED && solAccount.isConnected && solAccount.address && !solInList) ||
          (MULTI_VM_CONNECT_ENABLED && btcAccount.isConnected && btcAccount.address && !btcInList)) && (
          <Card padded={false} className="mb-6 divide-y divide-ink/5 overflow-hidden">
            {isConnected && connectedAddress && (
              <PendingWalletBanner
                label={`${linking.connectorName ?? t('Wallet')} ${t('connected')}`}
                address={connectedAddress}
                busy={actionBusy}
                onAdd={!connectedInList ? handleAddConnected : undefined}
                onSecondary={connectedInList ? handleConnectAnother : handleDisconnect}
                secondaryLabel={connectedInList ? t('Connect another') : t('Disconnect')}
                secondaryTitle={t('To add another account from the SAME wallet app, switch the active account inside that app first, then connect.')}
              />
            )}
            {/* Solana / Bitcoin — built, and dark while the connect rail is
                MetaMask+Xaman only (MULTI_VM_CONNECT_ENABLED in lib/wallet/config). */}
            {MULTI_VM_CONNECT_ENABLED && solAccount.isConnected && solAccount.address && !solInList && (
              <PendingWalletBanner
                label={t('Solana wallet connected')}
                address={solAccount.address}
                busy={actionBusy}
                onAdd={handleAddSolana}
              />
            )}
            {MULTI_VM_CONNECT_ENABLED && btcAccount.isConnected && btcAccount.address && !btcInList && (
              <PendingWalletBanner
                label={t('Bitcoin wallet connected')}
                address={btcAccount.address}
                busy={actionBusy}
                onAdd={handleAddBitcoin}
              />
            )}
          </Card>
        )}

      {/* Signed-out state — the page's biggest empty canvas, as a scene-door.
          Sign-in is READ-ONLY; the button (with its loading/disabled state) and
          the auth error are preserved exactly — only the shell around them is new.
          Personal-only: the Legacy governance surface is always authed. */}
      {variant === 'page' && !hasJwt && (
        <Card hover spotlight padded={false} className="group relative overflow-hidden mb-6 border-volt/15 hover:border-volt/35">
          {/* satellites (your wallets) drawn toward the control-plane core */}
          <div
            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 hidden sm:block opacity-70 group-hover:opacity-100 transition-opacity duration-500"
            aria-hidden
            style={{ zIndex: 0 }}
          >
            <SignalBeacon width={210} height={176} />
          </div>
          <div className="relative z-[1] p-6 md:p-8 sm:pr-56 flex flex-col">
            <MicroLabel>{t('Read-only by default')}</MicroLabel>
            <h2 className="text-lg font-semibold tracking-tight text-ink mt-2.5">{t('Sign in with your wallet')}</h2>
            <p className="text-sm text-ink/50 leading-relaxed mt-2 mb-5 max-w-[52ch]">
              {t('Signing in only reads your address — it does not move funds and costs no gas. Every wallet you connect starts as read-only. To prepare on-chain transactions you enable each wallet separately with a one-time ownership signature.')}
            </p>
            <button
              onClick={handleSiweLogin}
              disabled={authLoading}
              className="self-start flex items-center gap-2 px-5 py-2.5 rounded-xl bg-volt text-volt-ink text-sm font-medium hover:brightness-95 transition-all shadow-lg shadow-volt/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {authLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('Awaiting signature…')}
                </>
              ) : (
                <>
                  <Link2 className="w-4 h-4" />
                  {t('Sign in (read-only)')}
                </>
              )}
            </button>
            {authError && <p className="mt-3 text-xs text-tone-danger max-w-md">{authError}</p>}
          </div>
        </Card>
      )}

      {/* Wallet list */}
      {hasJwt && (
        <div>
          <SectionTitle
            actions={linking.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin text-ink/40" /> : undefined}
          >
            {legacyCouncil ? t('Legacy wallets') : t('Your Wallets')} ({wallets.length})
          </SectionTitle>

          {/* the organizer — three lenses, the origin filter and three orders.
              Shown from the FIRST wallet on (it used to hide under 2 wallets,
              so the tester never discovered the list existed). */}
          {!legacyCouncil && wallets.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <SegmentedControl<WalletsView>
                layoutId="wallets-view"
                value={view}
                onChange={setView}
                options={[
                  { key: 'list', label: es ? 'Lista' : 'List' },
                  { key: 'grid', label: es ? 'Cuadrícula' : 'Grid' },
                  { key: 'token', label: es ? 'Por token' : 'By token' },
                ]}
              />
              <SegmentedControl<WalletsOriginFilter>
                layoutId="wallets-origin"
                value={originFilter}
                onChange={setOriginFilter}
                options={[
                  { key: 'all', label: es ? 'Todas' : 'All' },
                  { key: 'manual', label: es ? 'Añadidas por ti' : 'Added by you' },
                  { key: 'auto', label: es ? 'De la plataforma' : 'From the platform' },
                ]}
              />
              <SegmentedControl<WalletsOrder>
                layoutId="wallets-order"
                value={order}
                onChange={setOrder}
                options={[
                  { key: 'name', label: 'A–Z' },
                  { key: 'balance', label: es ? 'Por balance' : 'By balance' },
                  { key: 'color', label: es ? 'Por color' : 'By colour' },
                ]}
              />
            </div>
          )}

          {legacyOwnedCount > 0 && (
            <p className="mb-3 text-[11px] text-ink/40">
              {legacyOwnedCount === 1
                ? t('1 wallet belongs to a Legacy (its council or Smart Account) — see it in Astryum Legacy › Governance › Wallets.')
                : `${legacyOwnedCount} ${t('wallets belong to your Legacies (council or Smart Account) — see them in Astryum Legacy › Governance › Wallets.')}`}
            </p>
          )}

          {wallets.length === 0 ? (
            legacyCouncil ? (
              <div className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-6 text-center text-sm text-ink/50">
                {t('Resolving this Legacy’s Smart Account… its wallets appear here once the council’s Flare account is known.')}
              </div>
            ) : (
              <SceneDoor
                scene={<SignalBeacon width={210} height={176} />}
                tone="gold"
                eyebrow={t('Your control plane')}
                title={t('No wallets yet')}
                desc={t('Connect a wallet app or watch any XRPL or Flare address. You can add as many as you like.')}
                cta={t('Add wallet')}
                onClick={() => setShowAdd(true)}
              />
            )
          ) : !legacyCouncil && originFiltered.length === 0 ? (
            // The origin filter emptied the view — say so instead of showing a
            // blank room (the fleet itself is NOT empty here).
            <p className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-6 text-center text-sm text-ink/50">
              {originFilter === 'manual'
                ? t('No wallets added by hand yet — Add wallet connects or watches one.')
                : t('No platform-created accounts yet — they appear when you log in with a wallet or open a Smart Account.')}
            </p>
          ) : activeView === 'grid' ? (
            legacyCouncil ? (
              <RevealGroup className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sortedWallets.map((w) => (
                  // Key on address+chain, NOT w.id: in the Legacy tab a leg starts
                  // as a synthesized row (id 'legacy:<addr>') and becomes the real
                  // record (backend id) once /wallets/mine loads — a w.id key would
                  // remount the card (reveal + balance re-fetch flash). Address+chain
                  // is stable across that swap and still unique for multichain wallets.
                  <RevealItem key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`}>
                    <WalletCard
                      wallet={w}
                      holdings={holdingsByAddress.get(addressKey(w.address))}
                      isActiveConnected={isConnected && connectedAddress?.toLowerCase() === w.address.toLowerCase()}
                      busy={actionBusy}
                      readOnly={variant === 'embedded'}
                      flareSwitch={flareSwitch}
                      onEnableTx={handleEnableTx}
                      onDisableTx={handleDisableTx}
                      onRename={handleRename}
                      onSetColor={handleSetColor}
                      onSetPrimary={handleSetPrimary}
                      onRemove={handleRemove}
                      onMovements={setMovementsWallet}
                      onGovernedMovements={legacyCouncil ? onGovernedMovements : undefined}
                      onToggleInclude={handleToggleInclude}
                    />
                  </RevealItem>
                ))}
              </RevealGroup>
            ) : (
              // Personal grid, shelved by origin (user test 2026-08-03).
              <div className="space-y-6">
                {originSections.map(({ origin, rows }) => (
                  <div key={origin}>
                    <OriginShelfHeading origin={origin} count={rows.length} es={es} />
                    <RevealGroup className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {rows.map((w) => (
                        <RevealItem key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`}>
                          <WalletCard
                            wallet={w}
                            holdings={holdingsByAddress.get(addressKey(w.address))}
                            isActiveConnected={isConnected && connectedAddress?.toLowerCase() === w.address.toLowerCase()}
                            busy={actionBusy}
                            readOnly={variant === 'embedded'}
                            flareSwitch={flareSwitch}
                            onEnableTx={handleEnableTx}
                            onDisableTx={handleDisableTx}
                            onRename={handleRename}
                            onSetColor={handleSetColor}
                            onSetPrimary={handleSetPrimary}
                            onRemove={handleRemove}
                            onMovements={setMovementsWallet}
                            onGovernedMovements={undefined}
                            onToggleInclude={handleToggleInclude}
                          />
                        </RevealItem>
                      ))}
                    </RevealGroup>
                  </div>
                ))}
              </div>
            )
          ) : activeView === 'list' ? (
            // The DEFAULT lens: origin shelves, and inside each shelf the rows
            // grouped by type (MetaMask, Xaman, watch-only… / login wallet,
            // Smart Account, embedded) — "separada por tipo", user 2026-08-03.
            <div className="space-y-6">
              {originSections.map(({ origin, rows }) => {
                const byType = new Map<string, BackendWallet[]>();
                for (const w of rows) {
                  const k = walletTypeLabelOf(w, t);
                  byType.set(k, [...(byType.get(k) ?? []), w]);
                }
                return (
                  <div key={origin}>
                    <OriginShelfHeading origin={origin} count={rows.length} es={es} />
                    <Card padded={false} className="px-4 py-1.5">
                      {[...byType.entries()].map(([type, group]) => (
                        <div key={type} className="py-1">
                          <div className="flex items-baseline gap-2 pt-2 px-1">
                            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink/35">{type}</span>
                            <span className="font-mono text-[10px] text-ink/25">{group.length}</span>
                          </div>
                          <ul>
                            {group.map((w) => (
                              <WalletRow
                                key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`}
                                wallet={w}
                                holdings={holdingsByAddress.get(addressKey(w.address))}
                                busy={actionBusy}
                                readOnly={variant === 'embedded'}
                                onRename={handleRename}
                                onSetColor={handleSetColor}
                                onMovements={variant === 'embedded' ? undefined : setMovementsWallet}
                              />
                            ))}
                          </ul>
                        </div>
                      ))}
                    </Card>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-4">
              {tokenGroups.map(([token, group]) => (
                <div key={token}>
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <MicroLabel>{token}</MicroLabel>
                    <span className="font-mono text-[10px] text-ink/30">{group.length}</span>
                  </div>
                  <Card padded={false} className="px-4 py-1">
                    <ul>
                      {group.map((w) => (
                        <WalletRow
                          key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`}
                          wallet={w}
                          holdings={holdingsByAddress.get(addressKey(w.address))}
                          busy={actionBusy}
                          readOnly={variant === 'embedded'}
                          onRename={handleRename}
                          onSetColor={handleSetColor}
                          onMovements={variant === 'embedded' ? undefined : setMovementsWallet}
                        />
                      ))}
                    </ul>
                  </Card>
                </div>
              ))}
            </div>
          )}

          {linking.error && (
            <p className="mt-3 text-xs text-tone-danger">{linking.error}</p>
          )}

          {/* Saved addresses — one-tap destinations for the Send flow.
              Personal-only: the address book is the user's, not a Legacy's. */}
          {variant === 'page' && <AddressBookPanel />}
        </div>
      )}


      {variant === 'page' && showAdd && (
        <AddWalletModal
          onConnect={linking.connectMetaMaskFlare}
          onConnectXrpl={universal.connectXrpl}
          onWatchAddress={(addr) => linking.watchAddress(addr, 14)}
          onNoWallet={() => { setShowAdd(false); setShowGuide(true); }}
          connectBusy={universal.busy}
          connectError={universal.error}
          onClose={() => setShowAdd(false)}
        />
      )}

      {/* First-wallet guide — mounted with the connect handlers, so its last
          step connects right here instead of bouncing back through the modal. */}
      {variant === 'page' && showGuide && (
        <FirstWalletGuide
          onClose={() => setShowGuide(false)}
          onConnectXrpl={universal.connectXrpl}
          onConnectEvm={linking.connectMetaMaskFlare}
        />
      )}

      {/* Movements — one modal, chain-adaptive: send/receive on any wallet,
          plus set-aside (escrow) and native DEX buy/sell on XRPL wallets.
          Prepare-only: unsigned payloads signed in the user's own wallet. */}
      {movementsWallet && (
        <MovementsModal wallet={movementsWallet} onClose={() => setMovementsWallet(null)} />
      )}

      {/* Create wallet (Turnkey embedded) — DISABLED for the hackathon demo,
          front (no button/panel) and back (EMBEDDED_WALLET_ENABLED=false).
          Component preserved intact at components/wallet/EmbeddedWalletCreatePanel. */}
    </div>
  );
}

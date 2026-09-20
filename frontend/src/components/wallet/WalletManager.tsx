'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import { useCursorGlow, useCursorTilt } from '../ui/motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
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
  ShieldPlus,
  PenLine,
  Star,
  Check,
  ArrowLeftRight,
  Undo2,
  Briefcase,
  Landmark,
  Minimize2,
  MoreHorizontal,
  SlidersHorizontal,
  Maximize2,
  RotateCw,
  AlertTriangle,
  Info,
  X, Wallet } from 'lucide-react';
import Link from 'next/link';
import {
  inspectAddressForAdd,
  shelfForVerdict,
  type AddWalletVerdict,
} from '@/lib/wallet/addWalletPreflight';
import dynamic from 'next/dynamic';
import {
  Card,
  MicroLabel,
  PageHeader,
  Pill,
  SectionTitle,
  SegmentedControl,
} from '@/components/ui/primitives';
import { Arrive, arriveMotion, CountUp } from '@/components/ui/motion';
import { PortfolioSyncBadge } from '@/components/dashboard/PortfolioSyncBadge';
import { formatMoneyCompact } from '@/lib/formatMoney';
import { fmtQtyActive } from '@/lib/format';
import { SceneDoor } from '@/components/ui/SceneDoor';
import { SignalBeacon } from '@/components/ui/scenes';
import { SignetMark } from '@/components/ui/skin/marks';
import { useEngraved } from '@/stores/themeStore';
import { CometMark } from '@/components/earn/icons';
import { useAuthStore } from '@/stores/authStore';
import { isAddressRemoved, markAddressRemoved, useWalletLinking } from '@/lib/wallet/useWalletLinking';
import { useAuthorities } from '@/hooks/useAuthorities';
import { useSmartAccountsOf } from '@/hooks/useSmartAccountsOf';
import { addressKey } from '@/lib/authority';
import { reinforcedPersonalKeys, unmarkPersonalQuorum } from '@/lib/authority/personalQuorum';
import { connectWallet, updateWallet, type BackendWallet } from '@/services/walletLinkService';
import { useAppKitAccount } from '@reown/appkit/react';
import { useUniversalConnect } from '@/lib/wallet/useUniversalConnect';
// Demo: embedded-wallet creation is disabled front + back (EMBEDDED_WALLET_ENABLED).
// import { EmbeddedWalletCreatePanel } from '@/components/wallet/EmbeddedWalletCreatePanel';
import MovementsModal from '@/components/movements/MovementsModal';
import { WalletSendModal } from '@/components/wallet/WalletTransferModals';
import { AddressBookPanel } from '@/components/wallet/AddressBookPanel';
import { fetchNativeBalance, type NativeBalance } from '@/lib/wallet/nativeBalance';
import { useAggregatedPortfolio } from '@/hooks/useAggregatedPortfolio';
import { useBalanceVisibility } from '@/stores/balanceVisibilityStore';
import { useT } from '@/i18n/LanguageProvider';
import WalletBrandIcon from '@/components/wallet/WalletBrandIcon';
import WalletGlyphIcon from '@/components/wallet/WalletGlyphIcon';
import XamanAvatar from '@/components/wallet/XamanAvatar';
import { useXamanHues } from '@/lib/wallet/xamanHues';
import { WALLET_COLOR_PRESETS, brandOf, isCouncilType, isXrplWallet, usesXamanAvatar, walletColor, walletDisplayName, walletIcon, walletProviderLabel, walletWash } from '@/lib/walletIdentity';
import { walletHoldings, type WalletHolding } from '@/lib/portfolioMerge';
import { usePaFold, foldKey, isHiddenEmptyOrphanPa } from '@/lib/wallet/paFold';
import { SmartAccountBadge } from '@/components/wallet/SmartAccountBadge';
import { TokenLogo } from '@/components/ui/TokenLogo';
import { useSwitchToFlare, type FlareSwitch } from '@/lib/wallet/useSwitchToFlare';
import { CHAINLIST_FLARE_URL } from '@/lib/wallet/flareChain';
import { MULTI_VM_CONNECT_ENABLED } from '@/lib/wallet/config';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { FirstWalletGuide } from '@/components/wallet/FirstWalletGuide';
import { injectedWalletName } from '@/lib/wallet/injectedBrand';
import { useOperationStore } from '@/stores/operationStore';
import { forgetLegacy, getLegacyNickname, setLegacyNickname } from '@/components/legacy/legacyLocal';
import { useXrplWalletPartner } from '@/lib/wallet/useXrplWalletPartner';
import { planWalletRemoval, type RemovalPlan } from '@/lib/wallet/removeWalletPlan';
import { governedAccountsApi } from '@/services/v1Api';
import { isDemoMode, openLegacyComingSoon } from '@/lib/demoMode';
import GovernedMovementsModal from '@/components/legacy/GovernedMovementsModal';
import { useManagerWalletKeys } from '@/lib/wallet/managerWallets';

// La constitución como operación anclable arrastra el LegacyPanel entero —
// solo quien cruza la puerta paga ese peso (dynamic, sin SSR: usa el dock).

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
// The list/grid/token lenses and their orders DIED with the 2026-08-22
// redesign — one presentation (identity cards, two shelves), one order
// (balance). Pre-0.9.53 git history keeps them.
// Key bumped to v2 with the list-default change so every browser re-defaults
// ONCE — a 'grid' saved under the old key would silently override the new
// default forever.


/** Friendly sub-type shelf label inside each origin section of the list. */

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


/** Native token of a wallet's home rail — the "Por token" grouping key. */

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// A synthesized, READ-ONLY wallet row for a Legacy's leg that is not a linked
// /wallets/mine record — chiefly the multisig council account, which lives in
// the governed-accounts registry, never the wallet table. Rendered only in the
// embedded (read-only) card, so the fabricated id never reaches a write handler;
// the balance is fetched by address like any other card.
export function legacyWalletRow(
  address: string,
  meta: {
    walletType: string;
    network: string;
    chainId: number | null;
    caip2: string | null;
    ecosystem: string;
    /** The Legacy's real name (registry label / local nickname) — 2026-08-22. */
    nickname?: string | null;
  },
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
    nickname: meta.nickname ?? null,
    bindingId: null,
    bindingMode: null,
    txAuthorized: false,
    includeInPortfolio: false,
    color: null,
    icon: null,
  };
}

// One counter cell of the stats organism — the figure counts up to its value.


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
          {usesXamanAvatar(wallet) ? (
            /* SEGUIR EL AVATAR (fundador 2026-09-13): la opción por defecto de
               una wallet de Xaman — la tarjeta toma el color de su cubito.
               Elegir una muestra la sustituye; volver aquí la restaura. */
            <button
              role="radio"
              aria-checked={wallet.color == null}
              onClick={() => onSetColor(wallet.id, null)}
              className={`grid h-5 w-5 place-items-center rounded-full transition-transform hover:scale-125 ${
                wallet.color == null ? 'ring-2 ring-volt' : 'ring-1 ring-ink/20'
              }`}
              title={t('Follow the Xaman avatar')}
            >
              <XamanAvatar address={wallet.address} size={16} brand="xaman" />
            </button>
          ) : (
            <button
              onClick={() => onSetColor(wallet.id, null)}
              className="h-4 w-4 rounded-full border border-dashed border-ink/30 hover:border-ink/60"
              title={t('No colour')}
            />
          )}
        </div>
        {usesXamanAvatar(wallet) && (
          <p className="mt-1.5 text-[10.5px] leading-snug text-ink/40">
            {t('The card follows the colours of your Xaman avatar. Pick a swatch to choose your own colour.')}
          </p>
        )}
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
// WalletRow (the list/token row) left with the lenses — git keeps it.

function WalletCard({
  wallet,
  holdings,
  absorbedPa,
  isActiveConnected,
  busy,
  readOnly = false,
  onUnmint,
  flareSwitch,
  onEnableTx,
  onMovements,
  onGovernedMovements,
  onGovern,
  onManage,
  council = false,
  manager = false,
  councilFacts,
  onCollapse,
}: {
  wallet: BackendWallet;
  /** What this wallet HOLDS (shared aggregated-portfolio reading) — undefined
   *  while the engine hasn't priced it (renders nothing, never a false 0). */
  holdings?: WalletHolding[];
  /** The Smart Account visually folded into this card (paFold, 2026-08-17). */
  absorbedPa?: BackendWallet;
  /** Opens the unmint door (FXRP → native XRP) — Smart Account cards only. */
  onUnmint?: (w: BackendWallet) => void;
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
  /** Una cuenta del consejo: abre su gobernanza (consejo, constitución,
   *  propuestas). Es la puerta que hace que un Legacy no necesite un apartado
   *  propio en el menú — se gobierna desde la wallet, como todo lo demás. */
  onGovern?: () => void;
  onEnableTx: (address: string) => void;
  onMovements: (wallet: BackendWallet) => void;
  /** Opens the MANAGE dialog for this wallet (2026-08-22, second pass: the
   *  inline expanding panel stretched every card in its grid row — a layout
   *  bug by construction. A dialog floats above; the grid never moves). */
  onManage?: () => void;
  /** Council-governed (Legacy): the card dresses as an institutional PLAQUE —
   *  seal watermark, squared chip, double frame, and the CROWN (2026-08-24).
   *  Founder, twice: «parece una wallet normal con otro color» → «tiene que
   *  destacar más, no solo el logito del panteón abajo». */
  council?: boolean;
  /** Wallet con mandato sobre managed vaults: lleva el sello de gestor. */
  manager?: boolean;
  /** Los hechos del consejo que la corona enseña. Sin ellos dice «firma el
   *  consejo» — el quórum jamás se inventa. */
  councilFacts?: { quorum?: number; memberCount?: number };
  /** Modo tarjeta-de-crédito (2026-08-27): esta tarjeta grande nació de una
   *  compacta al pulsarla, y este botón la devuelve a su tamaño. */
  onCollapse?: () => void;
}) {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
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
  const glyph = walletIcon(wallet);
  const color = walletColor(wallet);

  const badge = chainId ? CHAIN_BADGE[chainId] : null;
  const chainName = chainId ? CHAIN_NAMES[chainId] : t('Multi-chain');
  // The Smart Account is keyless (see isSmartAccount): it states the honest
  // fact instead of offering a signing capability nobody can grant.
  const smartAccount = isSmartAccount(wallet);
  // E2 third state: a personal wallet whose keys are a CONFIRMED quorum (the
  // reinforced account) says so. Read via the shared authority list (module-
  // cached ledger read) — never painted from the owner's mark alone.
  const { authorities } = useAuthorities();
  const hardened = useMemo(() => {
    const hit = authorities.find(
      (a) => a.kind === 'single' && addressKey(a.wallet.address) === addressKey(wallet.address),
    );
    return hit && hit.kind === 'single' && hit.hardenedQuorum?.hasCouncil === true
      ? hit.hardenedQuorum
      : null;
  }, [authorities, wallet.address]);

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
    <Card
      hover
      spotlight
      // A council card is a PLAQUE: the double frame (ring + offset) reads as
      // an engraved border — quiet at rest, unmistakably not a normal wallet.
      className={`group relative overflow-hidden h-full ${
        council ? 'ring-1 ring-offset-2 ring-offset-surface-1' : ''
      }`}
      // The whole box wears the wallet's colour (founder 2026-08-22: «no solo
      // el iconito, sino todo el recuadro») — subtle wash + hairline, one
      // shared recipe (walletWash). Councils arrive already indigo via
      // walletColor's council rule.
      style={{
        ...walletWash(color),
        ...(council
          ? ({ '--tw-ring-color': 'hsl(var(--product-legacy) / 0.25)' } as React.CSSProperties)
          : null),
      }}
    >
      {/* faint per-chain watermark — the wallet's home ecosystem, sitting behind
          the content (never intercepts clicks): Flare/EVM orbit, XRPL comet. */}
      {/* La marca de agua, RECOLOCADA (fundador 2026-08-25: «they are buged
          and on the right down corner, its strange») — el ancla -right-10
          -bottom-10 la metía medio recortada en la esquina por el
          overflow-hidden y leía como un bug, no como arte. Ahora vive
          centrada en el lateral derecho y se DESVANECE hacia el borde con
          una máscara radial: nunca un corte duro, a cualquier tamaño. */}
      <div
        aria-hidden
        className="art-veil pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-5 hidden sm:block group-hover:opacity-30 duration-500"
        style={{
          zIndex: 0,
          maskImage: 'radial-gradient(105% 90% at 35% 50%, black 45%, transparent 85%)',
          WebkitMaskImage: 'radial-gradient(105% 90% at 35% 50%, black 45%, transparent 85%)',
        }}
      >
        {/* EL CRITERIO (fundador 2026-08-27): la marca de agua ES la identidad
            de la cuenta — el sello del consejo, o la marca real del proveedor
            (la zorra, la X). El cometa y la órbita genéricos se retiran: un
            adorno que no dice de quién es la tarjeta no gana sitio en ella. */}
        {council ? (
          <CouncilSealMark size={112} />
        ) : (
          <div className="grayscale" style={{ transform: 'rotate(-8deg)' }}>
            <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={100} />
          </div>
        )}
      </div>
      <div className="relative z-[1]">
      {council && <CouncilCrown quorum={councilFacts?.quorum} memberCount={councilFacts?.memberCount} t={t} />}
      {/* E2 amplificado (2026-09-06): la reforzada lleva CORONA, como un
          Legacy — misma banda, en oro personal. La píldora de abajo murió. */}
      {!council && hardened && <QuorumCrown quorum={hardened.quorum} memberCount={hardened.memberCount} t={t} />}
      {/* ── THE FACE says three things: who it is, what it holds, what it can
             do. Everything else lives behind «Manage» (founder 2026-08-22:
             «hay demasiada información en cada card»). The ADDRESS left the
             face — the name is guaranteed now (walletIdentity never falls to
             the code) and the copy button still copies the address. ── */}
      <div className="flex items-start justify-between mb-3 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-11 h-11 flex items-center justify-center shrink-0 ring-1 ${
              council ? 'rounded-lg' : 'rounded-full'
            }`}
            style={{
              background: `color-mix(in srgb, ${color} 18%, transparent)`,
              boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 33%, transparent)`,
            }}
          >
            {/* Personal glyph wins when set — tinted to the wallet's own
                colour so the chip stays legible on any hue. Falls back to
                the provider's brand mark (the real fox, the real X). A
                council chip is SQUARED — a plaque, not a coin — and carries
                the Landmark, never a generic chain mark. */}
            {council ? (
              <Landmark className="w-[22px] h-[22px]" style={{ color: 'hsl(var(--product-legacy))' }} strokeWidth={1.6} />
            ) : glyph ? (
              <WalletGlyphIcon icon={glyph} size={22} color={color} />
            ) : (
              usesXamanAvatar(wallet) ? (
                  <XamanAvatar address={wallet.address} size={22} brand={brandOf(wallet.walletType, wallet.ecosystem)} />
                ) : (
                  <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={22} tint={color} />
                )
            )}
          </div>
          <div className="min-w-0">
            {/* El «LEGACY» de encima del nombre se retira: lo dice la corona,
                más grande y antes. Repetirlo a 9px era ruido. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-semibold text-ink truncate">{walletDisplayName(wallet, t)}</span>
              {manager && <ManagerMark t={t} />}
              {absorbedPa && <SmartAccountBadge pa={absorbedPa.address} t={t} />}
              {isPrimary && <Pill tone="success">{t('Primary')}</Pill>}
              {smartAccount && (
                <Pill tone="neutral" size="sm">
                  {t('Smart Account')}
                </Pill>
              )}
              {/* E2: la píldora «Quorum M/N» vivía aquí — ahora lo dice la
                  QuorumCrown de cabecera, más grande y antes (2026-09-06). */}
            </div>
            <div className="text-[11px] text-ink/40 mt-0.5">{chainName}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1.5 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
              title={t('Collapse this card')}
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={copy}
            className="p-1.5 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            title={t('Copy address')}
          >
            {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-tone-success" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setHideLocal((h) => !h)}
            className="p-1.5 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
            title={hideBalance ? t('Show balance') : t('Hide balance')}
          >
            {hideBalance ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
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

      {/* Movements / Govern / Unmint — the card's ACTION row. A Legacy-scoped
          card shows the same Movements gesture but routes to the GOVERNED
          surface (composed unsigned, quorum signs — 2026-07-28). */}
      {(!readOnly || onGovernedMovements || onGovern) && (
        <div
          className={`mt-3 ${
            onGovern || ((smartAccount || absorbedPa) && !onGovernedMovements && onUnmint)
              ? 'grid grid-cols-2 gap-2'
              : ''
          }`}
        >
          {onGovern && (
            <button
              onClick={onGovern}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-colors"
              style={{
                borderColor: 'hsl(var(--product-legacy) / 0.35)',
                background: 'hsl(var(--product-legacy) / 0.07)',
                color: 'hsl(var(--product-legacy))',
              }}
              title={t('Council, constitution and proposals of this account')}
            >
              <Landmark className="w-3.5 h-3.5" />
              {t('Govern')}
            </button>
          )}
          {(smartAccount || absorbedPa) && !onGovernedMovements && onUnmint && (
            <button
              onClick={() => onUnmint(absorbedPa ?? wallet)}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-volt/25 bg-volt/[0.07] text-volt text-xs font-medium hover:bg-volt/15 transition-colors"
              title={t('Convert the FXRP in this account back to native XRP on your XRPL wallet')}
            >
              <Undo2 className="w-3.5 h-3.5" />
              {t('Unmint to XRP')}
            </button>
          )}
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

      {/* Capability + the Manage door, ONE quiet line. Enable-transactions
          stays on the face (it is the core onboarding act); set-primary and
          revoke moved behind Manage. */}
      <div className="mt-3 pt-3 border-t border-ink/5 flex items-center justify-between gap-2">
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
          <span className="flex items-center gap-2 text-[11px] text-tone-success/90">
            <ShieldCheck className="w-3.5 h-3.5" />
            {t('Authorized for transactions')}
          </span>
        ) : (
          <button
            onClick={() => onEnableTx(address)}
            disabled={busy}
            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-volt/30 bg-volt/10 text-volt hover:bg-volt/20 transition-colors disabled:opacity-40"
            title={isActiveConnected ? t('Sign an ownership proof to enable transactions') : t('Connect this wallet in your wallet app first')}
          >
            <PenLine className="w-3 h-3" />
            {t('Enable transactions')}
          </button>
        )}
        {onManage && (
          <button
            onClick={onManage}
            disabled={busy}
            className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink transition-colors disabled:opacity-40"
          >
            {t('Manage')}
          </button>
        )}
      </div>

      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* COUNCIL SEAL                                                         */
/* ------------------------------------------------------------------ */

/**
 * CouncilSealMark — el toque con clase de la tarjeta Legacy (fundador
 * 2026-08-23: «aunque estén separadas parece una wallet normal con otro
 * color»). Un SELLO institucional grabado: columna entre dos anillos — el
 * exterior firme, el interior punteado como una órbita — y cinco estrellas
 * en el aro, el vocabulario astral del consejo (la constelación del
 * crossing, quieta y en relieve). Va de marca de agua, veiled como todas.
 */
function CouncilSealMark({ size = 120 }: { size?: number }) {
  const stars = [270, 342, 54, 126, 198].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    return [60 + 46 * Math.cos(rad), 60 + 46 * Math.sin(rad)] as const;
  });
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <circle cx="60" cy="60" r="52" stroke="hsl(var(--product-legacy))" strokeWidth="1.5" />
      <circle
        cx="60"
        cy="60"
        r="38"
        stroke="hsl(var(--product-legacy))"
        strokeWidth="1"
        strokeDasharray="3 5"
        strokeLinecap="round"
      />
      {/* la columna — el Landmark de las puertas, redibujado a trazos del sello */}
      <g stroke="hsl(var(--product-legacy))" strokeWidth="1.6" strokeLinecap="round">
        <path d="M46 74h28" />
        <path d="M48 70v-14M56 70v-14M64 70v-14M72 70v-14" />
        <path d="M45 54h30" />
        <path d="M60 42l15 10H45l15-10Z" strokeLinejoin="round" />
      </g>
      {stars.map(([x, y], k) => (
        <path
          key={k}
          d={`M${x} ${y - 3.2}l0.9 2.1 2.3 0.3-1.7 1.6 0.4 2.3-2-1.1-2 1.1 0.4-2.3-1.7-1.6 2.3-0.3z`}
          fill="hsl(var(--product-legacy))"
        />
      ))}
    </svg>
  );
}

/**
 * CouncilCrown — la CORONA de una cuenta gobernada (fundador 2026-08-24: «el
 * distintivo de la cuenta legacy tenemos que amplificarlo, tiene que destacar
 * más, no solo el logito del panteón abajo»).
 *
 * El sello de marca de agua era un detalle bonito EN el fondo; el problema es
 * que una tarjeta Legacy seguía teniendo la silueta de una wallet normal. Una
 * corona a sangre en la cabecera cambia la silueta: se ve que es otra COSA
 * desde el otro lado de la pantalla, antes de leer una sola palabra.
 *
 * Y dice el hecho que la define. Un Legacy no es «una wallet índigo»: es una
 * cuenta que NO firmas tú — la firman M de N. Ese quórum va aquí, en puntos
 * (M encendidos de N) y en palabra, porque el color nunca es el único
 * indicador. Si el ledger todavía no lo ha contestado, no se inventa: se dice
 * que firma el consejo y ya está.
 */
function CouncilCrown({
  quorum,
  memberCount,
  t,
}: {
  quorum?: number;
  memberCount?: number;
  t: (s: string) => string;
}) {
  const known = typeof quorum === 'number' && typeof memberCount === 'number' && memberCount > 0;
  return (
    <div
      className="relative -mx-6 -mt-6 mb-4 flex items-center gap-2.5 px-6 py-2.5"
      style={{
        background:
          'linear-gradient(90deg, hsl(var(--product-legacy) / 0.20), hsl(var(--product-legacy) / 0.07) 60%, transparent)',
        borderBottom: '1px solid hsl(var(--product-legacy) / 0.28)',
      }}
    >
      <span className="shrink-0" style={{ color: 'hsl(var(--product-legacy))' }} aria-hidden>
        <CouncilSealMark size={22} />
      </span>
      <span
        className="font-mono text-[10px] uppercase tracking-[0.24em]"
        style={{ color: 'hsl(var(--product-legacy))' }}
      >
        {t('Legacy')}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {known && (
          <span className="flex items-center gap-1" aria-hidden>
            {Array.from({ length: Math.min(memberCount as number, 7) }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    i < (quorum as number)
                      ? 'hsl(var(--product-legacy))'
                      : 'hsl(var(--product-legacy) / 0.28)',
                }}
              />
            ))}
          </span>
        )}
        <span className="text-[10.5px]" style={{ color: 'hsl(var(--product-legacy) / 0.85)' }}>
          {known
            ? `${quorum}/${memberCount} ${t('sign')}`
            : t('the council signs')}
        </span>
      </span>
    </div>
  );
}

/**
 * QuorumCrown — la corona de la cuenta REFORZADA (fundador 2026-09-06: «en
 * legacy hay un artifact que da a entender la gente que hay en multisig y el
 * quorum. debería haber lo mismo para este tipo de wallets en personal»).
 *
 * Misma gramática que la corona Legacy — puntos por miembro, M encendidos de
 * N, y la cifra en palabra — pero en el ORO personal y con el escudo, no el
 * sello: la cuenta sigue siendo TUYA (firman tus llaves, no un consejo), y el
 * color lo dice antes que el texto. La píldora «Quorum M/N» muere con ella:
 * decirlo dos veces en la misma cabecera era ruido (la lección de la corona
 * Legacy, 2026-09-05).
 */
function QuorumCrown({
  quorum,
  memberCount,
  t,
}: {
  quorum?: number;
  memberCount?: number;
  t: (s: string) => string;
}) {
  const known = typeof quorum === 'number' && typeof memberCount === 'number' && memberCount > 0;
  return (
    <div
      className="relative -mx-6 -mt-6 mb-4 flex items-center gap-2.5 px-6 py-2.5"
      style={{
        background:
          'linear-gradient(90deg, hsl(var(--product-personal) / 0.20), hsl(var(--product-personal) / 0.07) 60%, transparent)',
        borderBottom: '1px solid hsl(var(--product-personal) / 0.28)',
      }}
    >
      <ShieldCheck
        className="h-[18px] w-[18px] shrink-0"
        style={{ color: 'hsl(var(--product-personal))' }}
        strokeWidth={1.8}
        aria-hidden
      />
      <span
        className="font-mono text-[10px] uppercase tracking-[0.24em]"
        style={{ color: 'hsl(var(--product-personal))' }}
      >
        {t('Reinforced')}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {known && (
          <span className="flex items-center gap-1" aria-hidden>
            {Array.from({ length: Math.min(memberCount as number, 7) }).map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background:
                    i < (quorum as number)
                      ? 'hsl(var(--product-personal))'
                      : 'hsl(var(--product-personal) / 0.28)',
                }}
              />
            ))}
          </span>
        )}
        <span className="text-[10.5px]" style={{ color: 'hsl(var(--product-personal) / 0.85)' }}>
          {known
            ? `${quorum}/${memberCount} ${t('sign')}`
            : t('a quorum of your keys signs')}
        </span>
      </span>
    </div>
  );
}

/**
 * cardNumber — la dirección con la GRAMÁTICA de un número de tarjeta
 * (fundador 2026-08-27: «añade el id de manera que parezca el número de una
 * tarjeta»). Cuatro grupos en mono: los dos primeros reales, el tercero de
 * puntos, el último real — se reconoce la cuenta por sus extremos, que es como
 * todo el mundo compara direcciones, y el botón de al lado copia la ENTERA.
 */
function cardNumber(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 4)} ${addr.slice(4, 8)} ···· ${addr.slice(-4)}`;
}

/**
 * CompactWalletCard — la cuenta como TARJETA DE CRÉDITO, con anverso y REVERSO.
 *
 * LA INTERACCIÓN (fundador 2026-08-27, tercera pasada): LA TARJETA ENTERA ES
 * EL GIRO. Se pulse donde se pulse — anverso o reverso — la tarjeta rota; las
 * únicas excepciones son las superficies con trabajo propio: el número (copia)
 * y los botones del dorso (cada uno activa LO SUYO, con stopPropagation). Al
 * pasar el ratón la tarjeta se eleva y una flecha circular aparece arriba a la
 * derecha sugiriendo el giro.
 *
 * EL BUG QUE ESTA VERSIÓN PAGA: `backface-visibility: hidden` esconde la cara
 * girada PERO SUS BOTONES SEGUÍAN RECIBIENDO CLICS — en el dorso, cualquier
 * pulsación caía en el botón invisible del anverso y expandía la tarjeta
 * («le des donde le des se expande»). La cara oculta lleva ahora
 * pointer-events: none; solo la cara visible escucha.
 *
 * EXPANDIR vive en el dorso (botón «Abrir») y ES PERSISTENTE: quien prefiera
 * la vista grande la conserva — entre visitas incluidas (localStorage) — y
 * puede tener varias abiertas a la vez. La regla vieja de «una a la vez» era
 * mía, no del fundador, y murió con este encargo.
 *
 * CUARTA PASADA (fundador 2026-08-29): tarjetas más grandes (suelo ~300px),
 * caras OPACAS con cuerpo de degradado («menos translúcidas, algo más de
 * contraste, no super llamativas»), Movements fijo en el rincón del anverso
 * («que el usuario no tenga que darle la vuelta») con la flecha del giro
 * corrida a su lado, y el dorso con DOS direcciones etiquetadas — la wallet
 * y su Smart Account de Flare — cada una con su botón de copia.
 *
 * QUINTA PASADA (fundador 2026-08-29): cada listón del dorso lleva el
 * DISTINTIVO de su cuenta — glifo personal o marca del proveedor en el de la
 * wallet, el logo de Flare en el de la Smart Account («un distintivo de cada
 * una, a modo de logo pequeño») — y el titular va grabado en la banda
 * magnética.
 *
 * SEXTA PASADA (fundador 2026-08-29: «no me gusta el toque brillante…
 * como antes pero mejor en general»): el barniz especular MUERE el mismo día
 * que nació — la tarjeta es MATE. Mejor sin brillo: el chip gana sus
 * contactos grabados y la sombra pasa a la doble de la casa (contacto +
 * vuelo). Si alguien propone otro reflejo, que lea esta línea primero.
 */

/** Los mismos umbrales que las @container queries de `.wallet-cards`
 *  (globals.css): una tarjeta nunca baja de ~260px. En rem para respetar el
 *  tamaño de fuente raíz del usuario, igual que hace el CSS. */
const CARD_COL_STEPS_REM = [77, 58, 38] as const;

/**
 * La rejilla de tarjetas con el recuento de columnas ASENTADO, no en vivo
 * (fundador 2026-08-29: al ensanchar la estrategia anclada «las wallets hacen
 * dos redimensiones... a mitad de ensanchar se reinicia el tamaño de la
 * wallet»). Las @container queries puras cambiaban de columnas EN EL FOTOGRAMA
 * exacto en que la animación del dock cruzaba un umbral: las tarjetas se
 * encogían con la animación y, a mitad de gesto, saltaban de golpe a otra
 * rejilla. Aquí el número de columnas lo decide un ResizeObserver que espera a
 * que el ancho DEJE DE MOVERSE (~180ms quieto): durante la animación las
 * tarjetas se comprimen fluidas en su rejilla actual, y al asentarse el panel
 * se recolocan UNA vez — animada por el `layout` spring que las celdas ya
 * llevan. El CSS de container queries se queda como primer pintado sin JS; el
 * estilo inline lo pisa en cuanto hay medida.
 */
export function WalletCardsGrid({ children }: { children: React.ReactNode }) {
  const flowRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState<number | null>(null);

  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    const rootFont = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const colsFor = (px: number) => {
      const rem = px / rootFont;
      const idx = CARD_COL_STEPS_REM.findIndex((step) => rem >= step);
      return idx === -1 ? 1 : 4 - idx;
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        // La primera medida entra al momento: es el pintado inicial, no un
        // gesto en marcha — esperar aquí solo haría parpadear la rejilla.
        first = false;
        setCols(colsFor(el.clientWidth));
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setCols(colsFor(el.clientWidth)), 180);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div ref={flowRef} className="wallet-cards-flow">
      <div
        className="wallet-cards"
        style={cols != null ? { gridTemplateColumns: `repeat(${cols}, 1fr)` } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Una dirección etiquetada en el dorso — la etiqueta dice DE QUÉ cuenta es el
 * código (fundador 2026-08-29: «se tiene que entender qué código es de qué
 * wallet para que no confunda»). Todo el listón copia; el check confirma.
 */
function BackAddressStrip({
  label,
  addr,
  mark,
  copied,
  onCopy,
  title,
}: {
  label: string;
  addr: string;
  /** El distintivo de la cuenta (fundador 2026-08-29: «detrás, donde pone el
   *  hash de cada wallet, un distintivo de cada una, a modo de logo pequeño»):
   *  la marca del proveedor o el glifo personal en el listón de la wallet, el
   *  logo de Flare en el de la Smart Account — el código se reconoce por su
   *  emblema antes de leer la etiqueta. */
  mark: React.ReactNode;
  copied: boolean;
  onCopy: (e: React.MouseEvent) => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      title={title}
      className="group/sig flex w-full items-center gap-2 rounded-md bg-ink/[0.07] px-2 py-1 text-left transition-colors hover:bg-ink/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50"
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink/[0.05] ring-1 ring-ink/10" aria-hidden>
        {mark}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-1.5">
          <span className="truncate font-mono text-[7.5px] uppercase tracking-[0.18em] text-ink/45">{label}</span>
          {copied ? (
            <CheckCircle2 className="h-3 w-3 shrink-0 text-tone-success" />
          ) : (
            <Copy className="h-3 w-3 shrink-0 text-ink/30 transition-colors group-hover/sig:text-ink/60" />
          )}
        </span>
        <span className="block truncate font-mono text-[9px] leading-tight text-ink/70">{addr}</span>
      </span>
    </button>
  );
}

export function CompactWalletCard({
  wallet,
  holdings,
  usd,
  absorbedPa,
  council = false,
  manager = false,
  councilFacts,
  quorumFacts,
  onOpen,
  onMovements,
  onManage,
  onGovern,
  t,
}: {
  wallet: BackendWallet;
  holdings?: WalletHolding[];
  /** Lo que contiene, del agregado compartido. undefined = sin leer ⇒ «…». */
  usd?: number;
  /** La Smart Account de Flare que ejecuta por esta cuenta — su dirección se
   *  copia desde el dorso, etiquetada para no confundirla con la de la wallet
   *  (fundador 2026-08-29). En las personales llega como la wallet absorbida
   *  (absorbedPaByOwner); en un consejo, como la PA que resuelve
   *  useSmartAccountsOf — solo hace falta la dirección, y el tipo lo dice. */
  absorbedPa?: { address: string };
  council?: boolean;
  /** Wallet con mandato sobre managed vaults: lleva el sello de gestor. */
  manager?: boolean;
  councilFacts?: { quorum?: number; memberCount?: number };
  /** E2 (2026-09-06): la cuenta personal REFORZADA — sus llaves son un quórum
   *  confirmado por el ledger. La tarjeta compacta lo dice con la misma
   *  gramática que la corona Legacy (puntos + M/N), en el oro personal. */
  quorumFacts?: { quorum?: number; memberCount?: number };
  onOpen: () => void;
  onMovements?: () => void;
  onManage?: () => void;
  onGovern?: () => void;
  t: (s: string) => string;
}) {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
  const level = useMotionLevel();
  const reduced = level === 'minimal';
  const hidden = useBalanceVisibility((st) => st.hidden);
  const [flipped, setFlipped] = useState(false);
  const [hovered, setHovered] = useState(false);
  // EL VUELO (fundador 2026-09-10, segunda pasada de la tarjeta: «cuando giran
  // se queda la sombra en color iluminada por detrás, no me acaba»). El aura
  // era un estado de HOVER: se encendía al posarse y, como al girar el ratón
  // sigue encima, se quedaba encendida detrás de la tarjeta girada — una
  // mancha de color fija, que es justo lo que no convence. Ahora el aura es
  // la SOMBRA DEL VUELO: se enciende mientras la tarjeta está girando y se
  // apaga sola al aterrizar, esté el ratón donde esté; en reposo bajo el
  // cursor solo insinúa (un tercio) para acompañar al amago 3D. Y es una
  // sombra de verdad: sigue al ángulo — se estrecha cuando la tarjeta está de
  // canto y se corre hacia el lado que se aleja — leyendo la rotación real
  // frame a frame (onUpdate → ry), no un adorno que se enciende y ya.
  const [flying, setFlying] = useState(false);
  const flipsSeen = useRef(0);
  useEffect(() => {
    // La primera pasada es el montaje, no un giro.
    if (flipsSeen.current++ === 0) return;
    setFlying(true);
  }, [flipped]);
  const ry = useMotionValue(0);
  const auraX = useTransform(ry, (d) => Math.sin((d * Math.PI) / 180) * 16);
  const auraScaleX = useTransform(ry, (d) => 0.7 + 0.3 * Math.abs(Math.cos((d * Math.PI) / 180)));
  const [copied, setCopied] = useState<null | 'wallet' | 'fsa'>(null);
  const color = council ? 'hsl(var(--product-legacy))' : walletColor(wallet);
  // LA TARJETA REACCIONA AL RATÓN EN TIEMPO REAL (fundador 2026-09-12: «antes
  // hacían un efecto hover más divertido y reaccionaban a la ubicación del
  // ratón… vuelve a ponerlo sin desactivar nada de lo nuevo»): la receta de
  // la mano del Earn —inclinación 3D hacia el cursor— más una luz con la
  // tinta de la tarjeta (índigo en un consejo, la del proveedor en una
  // personal) que lo sigue por la cara. Se SUMA al amago del giro, a la
  // pestaña y a la sombra del vuelo; no sustituye nada. Tempo del nivel
  // (ui/motion useCursorTilt/useCursorGlow): al instante en completo, con
  // retardo y la mitad de grados en sereno, apagado en mínimo.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const tilt = useCursorTilt(shellRef, council ? 4 : 6);
  const glow = useCursorGlow(shellRef, {
    radius: 260,
    tint: council
      ? `hsl(var(--product-legacy) / ${level === 'calm' ? 0.1 : 0.16})`
      : `color-mix(in srgb, ${color} ${level === 'calm' ? 14 : 22}%, transparent)`,
  });
  const glyph = walletIcon(wallet);
  const toks = (holdings ?? []).slice(0, 3);
  const copyText = (which: 'wallet' | 'fsa', text: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1400);
  };
  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };
  const flipKeys = (to: boolean) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setFlipped(to);
    }
  };
  const face =
    'absolute inset-0 flex flex-col overflow-hidden rounded-2xl border p-3.5 text-left cursor-pointer [backface-visibility:hidden]';
  /* MENOS translúcida, más tarjeta (fundador 2026-08-29: «algo más de
     contraste, no que sean super llamativas, pero sí menos translúcidas»): el
     color se mezcla con la SUPERFICIE en vez de con transparente — la tarjeta
     es opaca, con un degradado diagonal que le da cuerpo de plástico, y el
     hairline sube de 30% a 45%. El wash de 7% queda para filas y paneles. */
  // Un CONSEJO viste más tinta que una personal (fundador 2026-09-05: «no se
  // distingue mucho la wallet legacy de la de Xaman, son colores parecidos»;
  // segunda pasada el mismo día: «la legacy puede mejorar bastante»): el matiz
  // solo no separa dos azules — separan la ESTRUCTURA (la corona), un cuerpo
  // francamente índigo (la primera dosis, 26%, seguía leyéndose gris) y el
  // AURA: la sombra de vuelo de un consejo es índigo, no negra. Mezclar con
  // la superficie mantiene el texto legible en los dos temas.
  const washMix = council ? { a: 38, b: 16, c: 27, edge: 62 } : { a: 17, b: 6, c: 12, edge: 45 };
  const faceWash: React.CSSProperties = {
    background: `linear-gradient(150deg, color-mix(in srgb, ${color} ${washMix.a}%, hsl(var(--surface-2))), color-mix(in srgb, ${color} ${washMix.b}%, hsl(var(--surface-1))) 58%, color-mix(in srgb, ${color} ${washMix.c}%, hsl(var(--surface-1))))`,
    borderColor: `color-mix(in srgb, ${color} ${washMix.edge}%, transparent)`,
    // La sombra doble de la casa (astry-panel): contacto + vuelo — asienta
    // la tarjeta sin un solo reflejo. En un consejo, el vuelo es su aura.
    // Y el CUERPO por dentro (2026-09-10, «no acaba de estar perfecto»):
    // una luz cenital de un pelo en el canto superior y un sombreado grave
    // hacia el pie — iluminación mate, no barniz (el brillo murió el 29-ago).
    // En un consejo el pie se apaga en su propia tinta índigo.
    boxShadow: council
      ? '0 1px 2px rgba(0, 0, 0, 0.3), 0 14px 34px -16px hsl(var(--product-legacy) / 0.4), inset 0 1px 0 hsl(0 0% 100% / 0.06), inset 0 -16px 26px -22px hsl(var(--product-legacy) / 0.38)'
      : '0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 30px -18px rgba(0, 0, 0, 0.55), inset 0 1px 0 hsl(0 0% 100% / 0.05), inset 0 -14px 24px -22px rgba(0, 0, 0, 0.32)',
  };
  /** La invitación al giro (fundador 2026-09-10: «que no sea un simple botón
   *  que aparece — algo más complejo»): una pestaña que se DESPLIEGA al
   *  posarse — el arco se traza alrededor del icono, el icono da media vuelta
   *  y la palabra aparece. Decorativa (la tarjeta entera gira), y vestida con
   *  la casa de su tarjeta: índigo de consejo o la tinta del proveedor. La
   *  coreografía vive en globals.css (.wflip-*), con su tempo de sereno y su
   *  quietud de mínimo. En el anverso se corre a la izquierda para dejar el
   *  rincón a los chips fijos (Movements / Govern). */
  const flipInvite = (pos: string, label: string) => (
    <span
      aria-hidden
      className={`wflip-pill pointer-events-none absolute ${pos} top-2 z-[2] flex h-7 items-center justify-end overflow-hidden rounded-full border bg-surface-2/95`}
      style={{
        borderColor: council
          ? 'hsl(var(--product-legacy) / 0.45)'
          : `color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      <span className="wflip-label whitespace-nowrap pl-2.5 font-mono text-[8.5px] uppercase tracking-[0.2em] text-ink/70">
        {label}
      </span>
      <span className="relative grid h-[26px] w-[26px] shrink-0 place-items-center">
        <svg className="absolute inset-0" width="26" height="26" viewBox="0 0 26 26" fill="none">
          <circle
            className="wflip-arc"
            cx="13"
            cy="13"
            r="10.5"
            stroke={council ? 'hsl(var(--product-legacy) / 0.85)' : `color-mix(in srgb, ${color} 80%, transparent)`}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeDasharray="66"
            transform="rotate(-90 13 13)"
          />
        </svg>
        <RotateCw className="wflip-icon h-3.5 w-3.5 text-ink/65" strokeWidth={1.8} />
      </span>
    </span>
  );
  // Y la tarjeta misma EMPIEZA el giro al posarse: unos grados hacia donde
  // irá (y de vuelta hacia el anverso si está girada) — el amago dice «esto
  // gira» antes que ningún botón. Un consejo se mueve más solemne: menos
  // ángulo y muelle más pesado; el sereno insinúa apenas y en tween lento;
  // el mínimo ni se inmuta.
  const teaseDeg = level === 'calm' ? 3 : council ? 5 : 8;
  const teased = hovered && !reduced;
  const flipTransition = reduced
    ? { duration: 0 }
    : level === 'calm'
      ? { duration: 0.9, ease: 'easeInOut' as const }
      : council
        ? { type: 'spring' as const, stiffness: 165, damping: 25 }
        : { type: 'spring' as const, stiffness: 260, damping: 24 };
  return (
    <motion.div
      ref={shellRef}
      className="group/card relative aspect-[8/5] w-full [perspective:1100px]"
      whileHover={reduced ? undefined : { y: council ? -3 : -5 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onMouseMove={(e) => {
        tilt.onMove(e);
        glow.onMove(e);
      }}
      onMouseLeave={tilt.onLeave}
      style={{ rotateX: tilt.rotateX, rotateY: tilt.rotateY, transformPerspective: 1100 }}
      transition={{ type: 'spring', stiffness: 320, damping: 24 }}
    >
      {/* La SOMBRA DEL VUELO (ver `flying`): tintada —índigo en un consejo, la
          tinta del proveedor en una personal—, nunca un reflejo encima: la
          tarjeta sigue siendo mate. Plena mientras gira, insinuada bajo el
          cursor, apagada en reposo; su anchura y su desplazamiento siguen al
          ángulo real de la tarjeta. */}
      <motion.div
        aria-hidden
        className="wcard-aura pointer-events-none absolute inset-x-1 bottom-0 top-3 rounded-2xl"
        style={{
          x: auraX,
          scaleX: auraScaleX,
          boxShadow: council
            ? '0 28px 56px -20px hsl(var(--product-legacy) / 0.5)'
            : `0 26px 50px -20px color-mix(in srgb, ${color} 32%, rgba(0, 0, 0, 0.6))`,
        }}
        animate={{ opacity: reduced ? 0 : flying ? 1 : hovered ? 0.35 : 0 }}
        transition={{ duration: flying ? 0.25 : level === 'calm' ? 0.9 : 0.5, ease: 'easeOut' }}
      />
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? (teased ? 180 - teaseDeg : 180) : teased ? teaseDeg : 0 }}
        transition={flipTransition}
        onUpdate={(latest) => {
          const v = latest.rotateY;
          const n = typeof v === 'number' ? v : parseFloat(String(v));
          if (Number.isFinite(n)) ry.set(n);
        }}
        // Aterrizaje: el aura se apaga sola, esté el ratón donde esté. También
        // se dispara al acabar el amago de hover — inocuo, `flying` ya era false.
        onAnimationComplete={() => setFlying(false)}
      >
        {/* ── ANVERSO — pulsar en cualquier punto GIRA ────────────────────── */}
        <div
          role="button"
          tabIndex={flipped ? -1 : 0}
          aria-label={`${walletDisplayName(wallet, t)} — ${t('Flip the card — quick actions on the back')}`}
          onClick={() => setFlipped(true)}
          onKeyDown={flipKeys(true)}
          className={face}
          style={{ ...faceWash, pointerEvents: flipped ? 'none' : 'auto' }}
        >
          {/* la luz que sigue al cursor, con la tinta de la tarjeta */}
          {glow.active && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit]"
              style={{ background: glow.background }}
              animate={{ opacity: hovered ? 1 : 0 }}
              transition={{ duration: level === 'calm' ? 0.8 : 0.4 }}
            />
          )}
          {flipInvite(council && onGovern ? 'right-[5.4rem]' : onMovements ? 'right-[2.8rem]' : 'right-2', t('Turn'))}
          {/* MOVEMENTS EN EL ANVERSO (fundador 2026-08-29: «para agilizar,
              que el usuario no tenga que darle la vuelta»): un chip fijo y
              quieto en el rincón — presente sin estorbar, se enciende al
              pasar. El giro sigue siendo la tarjeta entera; este botón es
              otra excepción con trabajo propio, como el número. */}
          {onMovements && (
            <button
              type="button"
              onClick={stop(onMovements)}
              title={t('Movements')}
              aria-label={t('Movements')}
              className="absolute right-2 top-2 z-[2] grid h-7 w-7 place-items-center rounded-full border border-ink/15 bg-surface-2/70 text-ink/55 transition-colors hover:border-volt/45 hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
          {/* GOVERN EN EL ANVERSO de un consejo (fundador 2026-09-05: «entrar
              a gobernar sin tener que girarla»): el chip vecino, teñido de
              índigo Legacy — la acción de la casa de esta tarjeta, a un clic
              desde la primera pantalla. */}
          {council && onGovern && (
            <button
              type="button"
              onClick={stop(onGovern)}
              title={t('Govern')}
              aria-label={t('Govern')}
              className="absolute right-[2.8rem] top-2 z-[2] grid h-7 w-7 place-items-center rounded-full border transition-colors hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50"
              style={{
                borderColor: `color-mix(in srgb, ${color} 42%, transparent)`,
                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                color,
              }}
            >
              <Landmark className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          )}
          {/* El barniz especular vivió una pasada (2026-08-29) y MURIÓ el
              mismo día: «no me gusta el toque brillante». La tarjeta es mate:
              su cuerpo lo pone el degradado del wash, no un reflejo. */}
          {/* la marca de agua ES la identidad: sello del consejo o la marca
              del proveedor, grande y tenue, centrada a la derecha */}
          <div
            aria-hidden
            className="art-veil pointer-events-none absolute -right-4 top-1/2 -translate-y-1/2"
            // El sello de un consejo pesa más que la marca de agua estándar
            // (0.1 la dejaba fantasmal en la captura del fundador) y va en su
            // tinta índigo, no en la del texto.
            style={council ? { zIndex: 0, opacity: 0.2, color: 'hsl(var(--product-legacy))' } : { zIndex: 0 }}
          >
            {/* La marca de agua deriva unos píxeles A CONTRAMANO del amago
                3D (wcard-float, globals.css): dos planos que no se mueven
                igual — eso es lo que hace cuerpo, sin un solo reflejo. */}
            <span className="wcard-float block">
              {council ? (
                <CouncilSealMark size={112} />
              ) : (
                <div className="grayscale" style={{ transform: 'rotate(-8deg)' }}>
                  <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={96} />
                </div>
              )}
            </span>
          </div>
          {/* LA CORONA de un consejo (fundador 2026-09-05: «no se distingue
              mucho la legacy de la de Xaman»): una banda índigo de cabecera —
              sello, palabra y quórum en puntos — con el ADN del estante
              Legacy. Dos azules parecidos no se separan por matiz; una
              tarjeta CORONADA no se confunde con ninguna personal. Sustituye
              al chip de glifo: la corona ES la identidad del consejo. */}
          {council ? (
            /* Segunda pasada de la corona (fundador: «puede mejorar
               bastante»): más alta, gradiente con cuerpo, sello y palabra a
               plena tinta — y el quórum ANCLADO tras la palabra («M/N» +
               puntos), no flotando a media tarjeta como quedó en la v1. */
            <div
              className="relative z-[1] -mx-3.5 -mt-3.5 mb-1 flex h-9 shrink-0 items-center gap-2 px-3.5"
              style={{
                background:
                  'linear-gradient(90deg, hsl(var(--product-legacy) / 0.5), hsl(var(--product-legacy) / 0.18) 55%, hsl(var(--product-legacy) / 0.05))',
                borderBottom: '1px solid hsl(var(--product-legacy) / 0.5)',
              }}
            >
              <span className="shrink-0 text-ink" aria-hidden>
                <CouncilSealMark size={19} />
              </span>
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.26em] text-ink">
                {t('Legacy')}
              </span>
              {typeof councilFacts?.quorum === 'number' && typeof councilFacts?.memberCount === 'number' && (
                <>
                  <span className="ml-1 flex items-center gap-1" aria-hidden>
                    {Array.from({ length: Math.min(councilFacts.memberCount, 7) }).map((_, i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background:
                            i < (councilFacts.quorum as number)
                              ? 'hsl(var(--product-legacy))'
                              : 'hsl(var(--product-legacy) / 0.3)',
                          boxShadow:
                            i < (councilFacts.quorum as number)
                              ? '0 0 6px hsl(var(--product-legacy) / 0.8)'
                              : 'none',
                        }}
                      />
                    ))}
                  </span>
                  <span className="font-mono text-[9px] tabular-nums text-ink/70">
                    {councilFacts.quorum}/{councilFacts.memberCount}
                  </span>
                </>
              )}
            </div>
          ) : quorumFacts ? (
            /* LA CORONA de la REFORZADA (fundador 2026-09-06: «en legacy hay
               un artifact que da a entender la gente que hay en multisig y el
               quorum — debería haber lo mismo en personal»): misma banda que
               un consejo, en el ORO personal y con el escudo — la cuenta
               sigue siendo tuya, sus llaves son un quórum. */
            <div
              className="relative z-[1] -mx-3.5 -mt-3.5 mb-1 flex h-9 shrink-0 items-center gap-2 px-3.5"
              style={{
                background:
                  'linear-gradient(90deg, hsl(var(--product-personal) / 0.42), hsl(var(--product-personal) / 0.15) 55%, hsl(var(--product-personal) / 0.04))',
                borderBottom: '1px solid hsl(var(--product-personal) / 0.5)',
              }}
            >
              <ShieldCheck className="h-[15px] w-[15px] shrink-0 text-ink" strokeWidth={1.9} aria-hidden />
              <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.26em] text-ink">
                {t('Reinforced')}
              </span>
              {typeof quorumFacts.quorum === 'number' && typeof quorumFacts.memberCount === 'number' && (
                <>
                  <span className="ml-1 flex items-center gap-1" aria-hidden>
                    {Array.from({ length: Math.min(quorumFacts.memberCount, 7) }).map((_, i) => (
                      <span
                        key={i}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{
                          background:
                            i < (quorumFacts.quorum as number)
                              ? 'hsl(var(--product-personal))'
                              : 'hsl(var(--product-personal) / 0.3)',
                          boxShadow:
                            i < (quorumFacts.quorum as number)
                              ? '0 0 6px hsl(var(--product-personal) / 0.8)'
                              : 'none',
                        }}
                      />
                    ))}
                  </span>
                  <span className="font-mono text-[9px] tabular-nums text-ink/70">
                    {quorumFacts.quorum}/{quorumFacts.memberCount}
                  </span>
                </>
              )}
            </div>
          ) : (
            <div className="relative z-[1]">
              <span
                className="grid h-8 w-8 place-items-center rounded-full ring-1"
                style={{
                  background: `color-mix(in srgb, ${color} 18%, transparent)`,
                  boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 33%, transparent)`,
                }}
              >
                {glyph ? (
                  <WalletGlyphIcon icon={glyph} size={14} color={color} />
                ) : (
                  usesXamanAvatar(wallet) ? (
                  <XamanAvatar address={wallet.address} size={14} brand={brandOf(wallet.walletType, wallet.ecosystem)} />
                ) : (
                  usesXamanAvatar(wallet) ? (
                  <XamanAvatar address={wallet.address} size={14} brand={brandOf(wallet.walletType, wallet.ecosystem)} />
                ) : (
                  <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={14} tint={color} />
                )
                )
                )}
              </span>
            </div>
          )}
          {/* el chip + el número — la copia es la EXCEPCIÓN al giro */}
          <div className="relative z-[1] mt-auto">
            {/* el chip — con sus CONTACTOS grabados (sexta pasada, 2026-08-29:
                «como antes pero mejor»): detalle mate, no brillo */}
            <span
              aria-hidden
              className="mb-2 grid h-5 w-7 place-items-center rounded-[4px] border"
              style={{
                borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
                background: `linear-gradient(135deg, color-mix(in srgb, ${color} 34%, transparent), color-mix(in srgb, ${color} 12%, transparent))`,
                // El chip va EMBUTIDO en la tarjeta, no pegado encima:
                // una sombra interior de un pelo — grabado mate, no brillo.
                boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.28), inset 0 -0.5px 0 hsl(0 0% 100% / 0.1)',
              }}
            >
              <svg width="22" height="14" viewBox="0 0 22 14" fill="none">
                <path
                  d="M0 5 H7 M0 9 H7 M15 5 H22 M15 9 H22 M7 5 A4 4.5 0 1 0 15 5 M7 9 A4 4.5 0 1 1 15 9 M11 0 V3 M11 11 V14"
                  stroke={`color-mix(in srgb, ${color} 55%, transparent)`}
                  strokeWidth="0.9"
                />
              </svg>
            </span>
            <button
              type="button"
              onClick={copyText('wallet', wallet.address)}
              title={t('Copy address')}
              className="group/num flex min-w-0 items-center gap-1.5 rounded px-0.5 font-mono text-[12px] tracking-[0.08em] text-ink/80 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50"
            >
              <span className="truncate tabular-nums">{cardNumber(wallet.address)}</span>
              {copied === 'wallet' ? (
                <CheckCircle2 className="h-3 w-3 shrink-0 text-tone-success" />
              ) : (
                <Copy className="h-3 w-3 shrink-0 text-ink/30 transition-colors group-hover/num:text-ink/60" />
              )}
            </button>
          </div>
          {/* el titular y el dinero — parte de la tarjeta: giran con ella */}
          <div className="relative z-[1] mt-2 flex w-full items-end justify-between gap-2">
            <span className="min-w-0">
              {/* La etiqueta «LEGACY M/N» junto al nombre MURIÓ con la corona
                  (2026-09-05): decirlo dos veces en 180px es ruido. */}
              <span className="block truncate text-[12px] font-semibold uppercase tracking-[0.06em] text-ink/90">
                {walletDisplayName(wallet, t)}
              </span>
              {manager && <ManagerMark t={t} compact />}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5">
              {/* El carril de logos SIEMPRE reserva su alto (min-h de 1rem =
                  TokenLogo xs), tenga tokens o no: sin la reserva, la fila de
                  abajo era más baja en las wallets vacías y el NÚMERO de cada
                  tarjeta quedaba a distinta altura que el de su vecina
                  (fundador 2026-08-29: «no están a la misma altura ambos
                  hash — quiero que los muestre a la misma altura»). */}
              <span className="flex min-h-[1rem] items-center" aria-hidden>
                {toks.map((h, i) => (
                  <span key={h.symbol} className="relative" style={{ marginLeft: i === 0 ? 0 : -5, zIndex: 3 - i }}>
                    <TokenLogo symbol={h.symbol} size="xs" className="ring-1 ring-surface-1" />
                  </span>
                ))}
              </span>
              <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                {usd == null ? '…' : hidden ? '••••' : formatMoneyCompact(usd)}
              </span>
            </span>
          </div>
        </div>

        {/* ── REVERSO — la misma interacción: pulsar la tarjeta la gira; los
            botones hacen LO SUYO (stopPropagation, y la cara oculta no
            escucha punteros — el bug de «le des donde le des se expande»). ── */}
        <div
          role="button"
          tabIndex={flipped ? 0 : -1}
          aria-label={t('Flip back')}
          onClick={() => setFlipped(false)}
          onKeyDown={flipKeys(false)}
          className={face}
          style={{ ...faceWash, transform: 'rotateY(180deg)', pointerEvents: flipped ? 'auto' : 'none' }}
        >
          {glow.active && (
            <motion.div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit]"
              style={{ background: glow.background }}
              animate={{ opacity: hovered ? 1 : 0 }}
              transition={{ duration: level === 'calm' ? 0.8 : 0.4 }}
            />
          )}
          {flipInvite('right-2', t('Turn back'))}
          {/* la banda magnética — el dorso se reconoce sin leer nada; el
              titular va grabado en ella, como en una tarjeta de verdad (la
              banda es negra en los dos temas: el blanco tenue es material,
              no color de tema). En un consejo la banda tira a índigo y lleva
              el sello a la izquierda: el dorso también dice Legacy sin leer
              (2026-09-10, «seguir diferenciando la normal de la legacy»). */}
          <div
            aria-hidden
            className={`-mx-3.5 -mt-3.5 flex h-6 shrink-0 items-center px-3.5 ${council ? 'justify-between' : 'justify-end'}`}
            style={{
              background: council
                ? 'color-mix(in srgb, hsl(var(--product-legacy)) 30%, rgba(0, 0, 0, 0.62))'
                : 'rgba(0, 0, 0, 0.55)',
            }}
          >
            {council && (
              <span style={{ color: 'rgba(255,255,255,0.4)' }}>
                <CouncilSealMark size={13} />
              </span>
            )}
            <span className="truncate font-mono text-[8px] uppercase tracking-[0.22em]" style={{ color: 'rgba(255,255,255,0.32)' }}>
              {walletDisplayName(wallet, t)}
            </span>
          </div>
          {/* las bandas de firma: la dirección de la WALLET y, debajo, la de
              su Smart Account de Flare — cada una con su etiqueta para que se
              entienda qué código es de qué cuenta, y cada una copia LA SUYA
              (fundador 2026-08-29). Excepciones al giro, como el número. */}
          <div className="mt-2.5 space-y-1.5">
            <BackAddressStrip
              label={t('Wallet')}
              addr={wallet.address}
              mark={
                council ? (
                  <CouncilSealMark size={16} />
                ) : glyph ? (
                  <WalletGlyphIcon icon={glyph} size={13} color={color} />
                ) : (
                  <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={14} tint={color} />
                )
              }
              copied={copied === 'wallet'}
              onCopy={copyText('wallet', wallet.address)}
              title={t('Copy address')}
            />
            {absorbedPa && (
              <BackAddressStrip
                label={t('Smart Account')}
                addr={absorbedPa.address}
                mark={<TokenLogo symbol="FLR" size="xs" />}
                copied={copied === 'fsa'}
                onCopy={copyText('fsa', absorbedPa.address)}
                title={t('Copy the Smart Account address')}
              />
            )}
          </div>
          {/* Gestionar YA NO cede su sitio a Gobernar (fundador 2026-09-06:
              «pon un botón en las cards de Legacy para personalizar nombre y
              demás — ya está en las de Personal»): un consejo lleva LAS DOS
              puertas — gobernar es del consejo, el nombre es tuyo. La rejilla
              se ensancha a 4 solo cuando conviven. */}
          <div className={`mt-auto grid gap-1.5 ${council && onGovern && onManage ? 'grid-cols-4' : 'grid-cols-3'}`}>
            {onMovements && (
              <button type="button" onClick={stop(onMovements)} className="flex flex-col items-center gap-1 rounded-lg border border-ink/10 py-1.5 text-[9px] text-ink/65 transition-colors hover:border-volt/30 hover:bg-volt/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50">
                <ArrowLeftRight className="h-3.5 w-3.5" />
                {t('Movements')}
              </button>
            )}
            {council && onGovern && (
              <button type="button" onClick={stop(onGovern)} className="flex flex-col items-center gap-1 rounded-lg border py-1.5 text-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50" style={{ borderColor: `color-mix(in srgb, ${color} 30%, transparent)`, color }}>
                <Landmark className="h-3.5 w-3.5" />
                {t('Govern')}
              </button>
            )}
            {onManage && (
              <button type="button" onClick={stop(onManage)} className="flex flex-col items-center gap-1 rounded-lg border border-ink/10 py-1.5 text-[9px] text-ink/65 transition-colors hover:border-volt/30 hover:bg-volt/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('Manage')}
              </button>
            )}
            <button type="button" onClick={stop(onOpen)} className="flex flex-col items-center gap-1 rounded-lg border border-ink/10 py-1.5 text-[9px] text-ink/65 transition-colors hover:border-volt/30 hover:bg-volt/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/50">
              <Maximize2 className="h-3.5 w-3.5" />
              {t('Open')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* LIST ROW                                                             */
/* ------------------------------------------------------------------ */

/**
 * WalletListRow — the compact lens (founder 2026-08-22, second pass: «vuelve
 * a añadir las distintas vistas, pero que sea sencillo y se entienda»). ONE
 * line per account: identity (chip + name + marks), what it is worth, and the
 * same two doors the card offers (Movements/Govern + Manage). Same wash, same
 * shelves — a row is the card at squint distance, never a different story.
 */
/** El sello de GESTOR — mismo en tarjeta abierta, compacta y fila: un
 *  distintivo, no un estante (fundador 2026-09-11). */
/** La cabecera de estante, la misma para los tres (12-sep): icono en su
 *  anillo, nombre a color, recuento, la regla en una línea y, si toca, una
 *  puerta a la derecha. Va sobre el raíl de color del estante (.shelf-rail). */
function ShelfHead({ icon, color, label, count, purpose, action }: { icon: React.ReactNode; color: string; label: string; count: number; purpose: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-ink/[0.02]" style={{ borderColor: color, color }} aria-hidden>
        {icon}
      </span>
      <span className="text-[14px] font-semibold tracking-tight" style={{ color }}>{label}</span>
      <span className="font-mono text-[10px] text-ink/30">{count}</span>
      <span className="hidden min-w-0 text-[11px] leading-snug text-ink/45 sm:inline">· {purpose}</span>
      {action ? <span className="ml-auto text-[11px]">{action}</span> : null}
    </div>
  );
}

function ManagerMark({ t, compact = false }: { t: (s: string) => string; compact?: boolean }) {
  return (
    <span
      title={t('Runs managed vaults')}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-ink/15 bg-ink/[0.05] font-medium text-ink/65 ${
        compact ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'
      }`}
    >
      <Briefcase className={compact ? 'h-2.5 w-2.5' : 'h-3 w-3'} strokeWidth={1.7} aria-hidden />
      {t('Manager')}
    </span>
  );
}

function WalletListRow({
  wallet,
  usd,
  absorbedPa,
  rowIndex = 0,
  busy,
  council,
  manager = false,
  quorumFacts,
  onMovements,
  onGovern,
  onManage,
  t,
}: {
  wallet: BackendWallet;
  /** Aggregated USD (shared reading) — undefined while unpriced: renders '…'. */
  usd: number | undefined;
  absorbedPa?: BackendWallet;
  /** Puesto en la lista — escalona su llegada (arriveMotion). */
  rowIndex?: number;
  busy: boolean;
  council: boolean;
  manager?: boolean;
  /** E2 (2026-09-06): reforzada — el quórum M/N también a escala de fila. */
  quorumFacts?: { quorum?: number; memberCount?: number };
  onMovements: () => void;
  onGovern?: () => void;
  onManage?: () => void;
  t: (s: string) => string;
}) {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
  const hidden = useBalanceVisibility((st) => st.hidden);
  const reduced = useReducedMotion();
  const color = walletColor(wallet);
  const glyph = walletIcon(wallet);
  return (
    /* La fila LLEGA con el dato (arriveMotion, 2026-08-25): la lista es la
       lente por defecto de esta pantalla y sus filas se enchufaban de golpe. */
    <motion.li
      className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
      style={walletWash(color)}
      {...arriveMotion(rowIndex, reduced)}
    >
      <div
        className={`w-8 h-8 flex items-center justify-center shrink-0 ring-1 ${council ? 'rounded-lg' : 'rounded-full'}`}
        style={{
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 33%, transparent)`,
        }}
      >
        {/* La placa también a esta escala: chip cuadrado + Landmark. */}
        {council ? (
          <Landmark className="w-4 h-4" style={{ color: 'hsl(var(--product-legacy))' }} strokeWidth={1.6} />
        ) : glyph ? (
          <WalletGlyphIcon icon={glyph} size={16} color={color} />
        ) : (
          usesXamanAvatar(wallet) ? (
                  <XamanAvatar address={wallet.address} size={16} brand={brandOf(wallet.walletType, wallet.ecosystem)} />
                ) : (
                  <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={16} tint={color} />
                )
        )}
      </div>
      <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
        {council && (
          <span
            className="font-mono text-[9px] uppercase tracking-[0.22em] shrink-0"
            style={{ color: 'hsl(var(--product-legacy) / 0.75)' }}
          >
            {t('Legacy')}
          </span>
        )}
        <span className="text-[13px] font-medium text-ink truncate">{walletDisplayName(wallet, t)}</span>
        {manager && <ManagerMark t={t} compact />}
        {/* Reforzada: el hecho del ledger (M/N) en oro, también a esta escala. */}
        {!council && quorumFacts && typeof quorumFacts.quorum === 'number' && typeof quorumFacts.memberCount === 'number' && (
          <span
            className="inline-flex shrink-0 items-center gap-1 font-mono text-[9.5px] tabular-nums"
            style={{ color: 'hsl(var(--product-personal))' }}
            title={t('Reinforced')}
          >
            <ShieldCheck className="h-3 w-3" strokeWidth={1.9} aria-hidden />
            {quorumFacts.quorum}/{quorumFacts.memberCount}
          </span>
        )}
        {absorbedPa && <SmartAccountBadge pa={absorbedPa.address} compact t={t} />}
        {wallet.isPrimary && <Star className="h-3 w-3 shrink-0 text-volt" fill="currentColor" aria-label={t('Primary')} />}
      </div>
      <span className="font-mono tabular-nums text-[13px] text-ink shrink-0">
        {hidden ? '••••' : usd == null ? '…' : formatMoneyCompact(usd)}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {onGovern && (
          <button
            onClick={onGovern}
            disabled={busy}
            className="p-1.5 rounded-md transition-colors disabled:opacity-40"
            style={{ color: 'hsl(var(--product-legacy))' }}
            title={t('Council, constitution and proposals of this account')}
          >
            <Landmark className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onMovements}
          disabled={busy}
          className="p-1.5 rounded-md text-volt/80 hover:text-volt hover:bg-volt/10 transition-colors disabled:opacity-40"
          title={council ? t('Compose a movement for this Legacy — the quorum signs it in Proposals') : t('Send, receive, set aside and trade — you sign in your own wallet')}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>
        {onManage && (
          <button
            onClick={onManage}
            disabled={busy}
            className="p-1.5 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors disabled:opacity-40"
            title={t('Manage')}
          >
            <PenLine className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ */
/* MANAGE DIALOG                                                        */
/* ------------------------------------------------------------------ */

/**
 * ManageWalletModal — everything the card's face no longer shouts, floating
 * ABOVE the grid (founder 2026-08-22, second pass: the inline expanding panel
 * stretched every card in its row — «está medio bugeado» — because grid rows
 * share a height by construction; a dialog cannot move the grid).
 *
 * Personal wallet: personalize (name + colour), the address, the totals
 * toggle, signing options, the reinforce door and the way out. A council
 * (Legacy) wallet: rename the LEGACY + the address — everything else is
 * governance and lives on /app/legacy.
 */
function ManageWalletModal({
  wallet,
  council,
  busy,
  onClose,
  onRename,
  onSetColor,
  onSetPrimary,
  onDisableTx,
  onRemove,
  onToggleInclude,
  onRenameLegacy,
  onReinforce,
  onGovernance,
}: {
  wallet: BackendWallet;
  /** A council-governed (Legacy) row: manage = rename + address only. */
  council: boolean;
  busy: boolean;
  onClose: () => void;
  onRename: (id: string, nickname: string) => void;
  onSetColor: (id: string, color: string | null) => void;
  onSetPrimary: (id: string) => void;
  onDisableTx: (bindingId: string) => void;
  onRemove: (plan: RemovalPlan) => void;
  onToggleInclude: (wallet: BackendWallet) => void;
  onRenameLegacy?: (address: string, name: string) => void;
  onReinforce?: () => void;
  onGovernance?: () => void;
}) {
  useXamanHues(); // repinta cuando llega el color del cubito de una cuenta
  const { t } = useT();
  const { address, isPrimary, txAuthorized, bindingId, chainId } = wallet;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeAck, setRemoveAck] = useState(false);
  const [copied, setCopied] = useState(false);
  const [legacyName, setLegacyName] = useState('');
  const smartAccount = isSmartAccount(wallet);
  const color = walletColor(wallet);
  const glyph = walletIcon(wallet);

  // The reinforce door states what the LEDGER says (same read as the card).
  const { authorities, governedCandidates } = useAuthorities();
  // QUÉ HAY QUE BORRAR PARA QUE NO VUELVA (lib/wallet/removeWalletPlan): una
  // cuenta gobernada llega aquí por hasta tres caminos a la vez —fila real,
  // puntero del registro y sesión conectada— y borrar uno deja vivos los
  // otros. El plan se calcula ANTES de abrir el diálogo para poder avisar de
  // lo que hace falta, en vez de que el botón parezca no hacer nada.
  const { address: connectedXrpl } = useXrplWalletPartner();
  const removalPlan = useMemo(
    () =>
      planWalletRemoval({
        wallet: { id: wallet.id, address: wallet.address },
        governed: governedCandidates,
        connectedXrplAddress: connectedXrpl,
      }),
    [wallet.id, wallet.address, governedCandidates, connectedXrpl],
  );
  const hardened = useMemo(() => {
    const hit = authorities.find(
      (a) => a.kind === 'single' && addressKey(a.wallet.address) === addressKey(wallet.address),
    );
    return hit && hit.kind === 'single' && hit.hardenedQuorum?.hasCouncil === true
      ? hit.hardenedQuorum
      : null;
  }, [authorities, wallet.address]);

  function copy() {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const explorerBase = chainId === 14 ? 'https://flarescan.com/address/' : chainId === 1 ? 'https://etherscan.io/address/' : chainId === 42161 ? 'https://arbiscan.io/address/' : chainId === 8453 ? 'https://basescan.org/address/' : chainId === 137 ? 'https://polygonscan.com/address/' : null;

  return (
    <>
    <ModalOverlay
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm"
      onEscape={onClose}
    >
      <div className="min-h-full flex justify-center p-4" onClick={onClose}>
        <div
          className="relative w-full max-w-md my-auto rounded-2xl border bg-surface-1 shadow-2xl p-5"
          style={walletWash(color)}
          role="dialog"
          aria-modal="true"
          aria-label={`${t('Manage')} — ${walletDisplayName(wallet, t)}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — the same identity the card wears. */}
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 ring-1"
              style={{
                background: `color-mix(in srgb, ${color} 18%, transparent)`,
                boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${color} 33%, transparent)`,
              }}
            >
              {glyph ? (
                <WalletGlyphIcon icon={glyph} size={18} color={color} />
              ) : (
                usesXamanAvatar(wallet) ? (
                  <XamanAvatar address={wallet.address} size={18} brand={brandOf(wallet.walletType, wallet.ecosystem)} />
                ) : (
                  <WalletBrandIcon brand={brandOf(wallet.walletType, wallet.ecosystem)} size={18} tint={color} />
                )
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-ink truncate">{walletDisplayName(wallet, t)}</div>
              <div className="text-[11px] text-ink/40">{t('Manage')}</div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-ink/45 hover:text-ink hover:bg-ink/5 transition-colors"
              aria-label={t('Close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            {/* Identity: rename + colour — TAMBIÉN para un consejo ENLAZADO
                (fundador 2026-09-13: «las tarjetas de legacy deben tener el
                mismo modal de manage que las otras... el nombre no se
                guarda»). El nombre va a la fila del registro de wallets (se
                guarda y se pinta en todas partes) Y al apuntador de
                gobernanza, para que la superficie Legacy diga lo mismo. La
                fila SINTETIZADA (id legacy:…) no existe en el registro: esa
                conserva el formulario de renombrar el Legacy. */}
            {!council || !wallet.id.startsWith('legacy:') ? (
              <PersonalizePanel
                wallet={wallet}
                onRename={(id, nickname) => {
                  onRename(id, nickname);
                  if (council && onRenameLegacy) onRenameLegacy(address, nickname);
                }}
                onSetColor={onSetColor}
              />
            ) : onRenameLegacy ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (legacyName.trim()) onRenameLegacy(address, legacyName.trim());
                  setLegacyName('');
                }}
              >
                <input
                  value={legacyName}
                  onChange={(e) => setLegacyName(e.target.value)}
                  placeholder={walletDisplayName(wallet, t)}
                  maxLength={40}
                  className="flex-1 min-w-0 px-2.5 py-1.5 bg-ink/5 border border-ink/10 rounded-lg text-xs text-ink placeholder-ink/30 focus:outline-none focus:border-volt/50"
                  aria-label={t('Rename this Legacy')}
                />
                <button
                  type="submit"
                  disabled={!legacyName.trim()}
                  className="text-[11px] font-medium px-2.5 py-1.5 rounded-lg border border-ink/15 text-ink/70 hover:text-ink hover:border-ink/30 transition-colors disabled:opacity-40"
                >
                  {t('Rename')}
                </button>
              </form>
            ) : null}

            {/* The address — one honest row, out of the card's face. */}
            <div className="flex items-center justify-between gap-2 rounded-lg bg-ink/[0.03] px-2.5 py-2">
              <span className="font-mono text-[10px] text-ink/50 break-all">{address}</span>
              <span className="flex items-center gap-1 shrink-0">
                <button
                  onClick={copy}
                  className="p-1 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
                  title={t('Copy address')}
                >
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-tone-success" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {explorerBase && (
                  <a
                    href={`${explorerBase}${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors"
                    title={t('View on explorer')}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </span>
            </div>

            {!council && (
              <>
                {/* Dashboard-inclusion toggle. */}
                <button
                  onClick={() => onToggleInclude(wallet)}
                  disabled={busy}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-ink/5 transition-colors disabled:opacity-40"
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

                {/* Signing options — off the card's face. */}
                {txAuthorized && (
                  <div className="flex items-center justify-between gap-2 px-2.5">
                    <span className="text-[11px] text-ink/40">{t('Signing wallet options')}</span>
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
                )}

                {/* The reinforce door (founder 2026-08-21) — states what the
                    LEDGER says; opens the governance page. */}
                {isXrplWallet(wallet) && !smartAccount && (onReinforce || onGovernance) && (
                  <div className="flex items-center justify-between gap-2 px-2.5">
                    {hardened ? (
                      <>
                        <span className="flex items-center gap-2 text-[11px] text-tone-success/90">
                          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                          {t('Reinforced — no single key moves anything')}
                        </span>
                        {onGovernance && (
                          <button
                            onClick={onGovernance}
                            title={t('Its keys, its quorum, its health and its rules')}
                            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-tone-success/30 bg-tone-success/10 text-tone-success hover:bg-tone-success/20 transition-colors"
                          >
                            {t('Governance')}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] text-ink/40">{t('One key can move everything here')}</span>
                        {onReinforce && (
                          <button
                            onClick={onReinforce}
                            title={t('Give this account a quorum of your own keys — it stays yours, and you keep signing in Xaman')}
                            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-ink/15 text-ink/70 hover:border-ink/30 hover:bg-ink/[0.05] hover:text-ink transition-colors"
                          >
                            <ShieldPlus className="w-3 h-3" />
                            {t('Reinforce it')}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* LA PUERTA DE VUELTA (fundador 2026-09-13: cuatro consejos
                    clavados en Personal con corona de oro y el estante Legacy
                    vacío — la MARCA «es mi reforzada» existía solo de ida).
                    El ledger no distingue reforzada de Legacy; la marca es
                    del dueño, así que el dueño puede retirarla: sin marca, el
                    default del 2026-07-18 manda y la cuenta gobierna desde el
                    estante Legacy. Reversible en ambos sentidos (la puerta de
                    ida vive en My Legacies). */}
                {isXrplWallet(wallet) && hardened && (
                  <div className="flex items-center justify-between gap-2 px-2.5">
                    <span className="text-[11px] text-ink/40">
                      {t('Marked as YOUR reinforced account')}
                    </span>
                    <button
                      onClick={() => {
                        unmarkPersonalQuorum(address);
                        onClose();
                      }}
                      title={t('Remove the mark: the ledger-confirmed council takes over and the account moves to the Legacy shelf')}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors"
                      style={{
                        borderColor: 'hsl(var(--product-legacy) / 0.35)',
                        background: 'hsl(var(--product-legacy) / 0.07)',
                        color: 'hsl(var(--product-legacy))',
                      }}
                    >
                      <Landmark className="w-3 h-3" />
                      {t('It is a Legacy')}
                    </button>
                  </div>
                )}

              </>
            )}

            {/* LA SALIDA, Y TAMBIÉN PARA UN LEGACY (fundador 2026-09-13:
                «tengo una wallet legacy que no puedo eliminar de la cuenta; en
                Manage no aparece el botón de remove, ni la papelera»).
                Este bloque vivía DENTRO del `{!council && …}` de arriba, así
                que la cuenta que más necesita explicarse era justo la única
                sin puerta de salida — y el texto para Legacy que hay dentro
                estaba escrito y muerto.

                CONFIRMACIÓN CLÁSICA (misma orden): el botón ya no arma nada en
                línea; abre un diálogo que dice qué se borra, qué NO se toca y
                qué hace falta para que no vuelva. Nada se borra hasta
                confirmar ahí. */}
            <div className="px-2.5 pt-2 border-t border-ink/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink/35">{t('Stop tracking this wallet')}</span>
                <button
                  onClick={() => { setConfirmRemove(true); setRemoveAck(false); }}
                  disabled={busy}
                  className="flex items-center gap-1 text-[11px] text-ink/40 transition-colors hover:text-tone-danger disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" />
                  {t('Remove…')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>

    {/* ── LA CONFIRMACIÓN CLÁSICA ────────────────────────────────────────
        Un diálogo propio, encima del panel: título que pregunta, la cuenta
        que se va con su dirección entera, qué NO se toca, y el botón rojo al
        final. Escape y Cancelar vuelven sin borrar nada.

        Dice ADEMÁS lo que hace falta para que no vuelva. Si la cuenta es la
        que está conectada ahora mismo, quitarla sin soltar esa sesión la
        devolvería en la siguiente lectura — y el usuario habría visto un
        botón que no hace nada, que es justo el fallo del que venimos. */}
    {confirmRemove && (
      <ModalOverlay
        onEscape={() => setConfirmRemove(false)}
        className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-wallet-title"
          className="my-auto w-full max-w-sm overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl"
        >
          <div className="space-y-3 px-5 py-5">
            <h3 id="remove-wallet-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Trash2 className="w-4 h-4 shrink-0 text-tone-danger" strokeWidth={1.9} />
              {council ? t('Remove this Legacy from your list?') : t('Remove this wallet from your list?')}
            </h3>
            <div className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2">
              <p className="text-[12.5px] text-ink/85">{walletDisplayName(wallet, t)}</p>
              <p className="font-mono text-[11px] break-all text-ink/45">{address}</p>
            </div>
            <p className="text-[12px] leading-relaxed text-ink/70">
              {council
                ? t('This is a Legacy governed by a council. Removing it here only stops tracking it in Astryum: the account, its council and its capital stay on XRPL exactly as they are, and nothing is signed. To see it again you will have to add it back.')
                : t('Removing it here only stops tracking it in Astryum: the wallet and its capital stay where they are, and nothing is signed. To see it again you will have to add it back.')}
            </p>
            {removalPlan.disconnectXrplSession && (
              <p className="rounded-lg border border-tone-warning/30 bg-tone-warning/[0.07] px-3 py-2 text-[11.5px] leading-relaxed text-ink/75">
                {t('This is the wallet connected right now, so removing it also releases that connection — otherwise it would come straight back to the list.')}
              </p>
            )}
            {council && (
              <label className="flex cursor-pointer items-start gap-2 text-[11.5px] leading-relaxed text-ink/70">
                <input
                  type="checkbox"
                  checked={removeAck}
                  onChange={(e) => setRemoveAck(e.target.checked)}
                  className="mt-0.5"
                />
                <span>{t('I understand the Legacy stays on the ledger — I am only removing it from this list.')}</span>
              </label>
            )}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-ink/5 px-5 py-3">
            <button
              type="button"
              onClick={() => { setConfirmRemove(false); setRemoveAck(false); }}
              className="rounded-lg border border-ink/10 bg-ink/5 px-3 py-1.5 text-[12px] font-medium text-ink/70 transition-colors hover:bg-ink/10"
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(false);
                onRemove(removalPlan);
                onClose();
              }}
              disabled={busy || (council && !removeAck)}
              className="flex items-center gap-1.5 rounded-lg border border-tone-danger/40 bg-tone-danger/10 px-3 py-1.5 text-[12px] font-medium text-tone-danger transition-colors hover:bg-tone-danger/20 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {council ? t('Remove this Legacy from my list') : t('Remove this wallet')}
            </button>
          </div>
        </div>
      </ModalOverlay>
    )}
    </>
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
  onDismiss,
}: {
  label: string;
  address: string;
  busy: boolean;
  onAdd?: () => void;
  onSecondary?: () => void;
  secondaryLabel?: string;
  secondaryTitle?: string;
  /** La X (fundador 2026-09-09: «añade una x para cerrar la ventanita»). */
  onDismiss?: () => void;
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
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label={t('Close')}
            title={t('Close')}
            className="grid h-7 w-7 place-items-center rounded-full text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
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
  wallets,
  connectBusy,
  connectError,
  onClose,
}: {
  /** Connect MetaMask on Flare (14). Rejects — and links nothing — otherwise. */
  onConnect: () => Promise<void>;
  /** Connect Xaman. `confirm` para el alta ANTES de escribir (ver useUniversalConnect). */
  onConnectXrpl: (confirm?: (address: string) => Promise<boolean>) => Promise<string>;
  onWatchAddress: (address: string) => Promise<void>;
  /** Swap this modal for the first-wallet guide (exchange-only users). */
  onNoWallet: () => void;
  /** Las wallets ya enlazadas — para poder decir «esta ya la tienes». */
  wallets: BackendWallet[];
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
  const [xamanError, setXamanError] = useState<string | null>(null);

  // ── EL ALTA TERMINA SIEMPRE EN UNA FRASE (fundador 2026-09-13) ────────────
  // Tres estados, y ninguno es el silencio de antes: `checking` (mirando qué
  // es la dirección), `pending` (hace falta tu permiso y aquí está el motivo)
  // y `outcome` (cómo acabó y DÓNDE ha aterrizado la fila). El modal ya no se
  // cierra solo al terminar: cerrarse era justo lo que hacía indistinguible
  // «añadida» de «no ha pasado nada».
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState<{ address: string; verdict: AddWalletVerdict } | null>(null);
  const [outcome, setOutcome] = useState<
    | { kind: 'added'; address: string; shelf: 'personal' | 'legacy' }
    | { kind: 'already'; name: string }
    /** Xaman: ya estaba en la lista, pero la SESIÓN de este navegador sí ha cambiado. */
    | { kind: 'reconnected'; name: string }
    | null
  >(null);
  // El resolver de la pregunta en curso. La dirección de Xaman sólo se conoce
  // después de conectar, así que la confirmación tiene que poder esperar a que
  // el usuario pulse: la promesa se resuelve desde los botones del panel.
  const decideRef = useRef<((ok: boolean) => void) | null>(null);
  const verdictRef = useRef<AddWalletVerdict | null>(null);

  /**
   * Mira qué es la dirección y decide si hace falta parar. Devuelve `true`
   * sólo cuando el alta puede seguir — y cuando para, la pantalla ya está
   * enseñando por qué.
   */
  async function ask(address: string): Promise<boolean> {
    setChecking(true);
    let verdict: AddWalletVerdict;
    try {
      verdict = await inspectAddressForAdd(address, wallets);
    } finally {
      setChecking(false);
    }
    verdictRef.current = verdict;
    if (verdict.kind === 'new') return true;
    if (verdict.kind === 'already_linked') {
      setOutcome({ kind: 'already', name: walletDisplayName(verdict.wallet) });
      return false;
    }
    setPending({ address, verdict });
    return new Promise<boolean>((resolve) => {
      decideRef.current = resolve;
    });
  }

  function decide(ok: boolean) {
    const resolve = decideRef.current;
    decideRef.current = null;
    setPending(null);
    resolve?.(ok);
  }

  /** ¿Paró el alta porque el usuario dijo que no? Eso no se pinta en rojo. */
  const isCancelled = (e: unknown) => !!(e as { cancelled?: boolean })?.cancelled;

  async function submitEvm() {
    setEvmBusy(true);
    setEvmError(null);
    setOutcome(null);
    try {
      await onConnect();
      onClose();
    } catch (e) {
      setEvmError((e as Error).message);
    } finally {
      setEvmBusy(false);
    }
  }

  async function submitXaman() {
    setXamanError(null);
    setOutcome(null);
    try {
      const address = await onConnectXrpl(ask);
      setOutcome({
        kind: 'added',
        address,
        shelf: shelfForVerdict(verdictRef.current ?? { kind: 'new' }),
      });
    } catch (e) {
      // Con Xaman, «ya la tenías» NO es «no ha pasado nada»: el QR ya se
      // escaneó y este navegador vuelve a tener la sesión de esa cuenta — la
      // que usan la mesa del gestor y las firmas. Decir «nada cambió» era
      // mentir justo a quien venía de la mesa a reconectar (fundador
      // 2026-09-14).
      const v = verdictRef.current;
      if (isCancelled(e) && v?.kind === 'already_linked') {
        setOutcome({ kind: 'reconnected', name: walletDisplayName(v.wallet) });
        return;
      }
      if (!isCancelled(e)) setXamanError((e as Error).message);
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
    setOutcome(null);
    try {
      if (!(await ask(addr))) return;
      await onWatchAddress(addr);
      setWatchInput('');
      setOutcome({
        kind: 'added',
        address: addr,
        shelf: shelfForVerdict(verdictRef.current ?? { kind: 'new' }),
      });
    } catch (e) {
      setWatchError((e as Error).message);
    } finally {
      setWatchBusy(false);
    }
  }

  return (
    <ModalOverlay className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
      {/* Springy arrival + staggered rows (founder 2026-08-22: "se pueden
          mejorar mucho las animaciones") — transforms/opacity only. */}
      <motion.div
        initial={{ opacity: 0, y: 22, scale: 0.965 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className="bg-surface-1 border border-ink/10 rounded-2xl w-full max-w-md my-auto shadow-2xl overflow-hidden"
      >
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
          <h2 className="text-base font-semibold text-ink">{t('Add Wallet')}</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors">
            <span className="text-lg leading-none">×</span>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
        {/* ── LA PREGUNTA ─────────────────────────────────────────────────
            Sustituye al cuerpo entero a propósito: una decisión con su
            motivo delante, sin los tres botones de alta compitiendo por el
            mismo clic. */}
        {pending ? (
          <div className="space-y-4">
            <div
              className="rounded-xl border px-4 py-3.5 space-y-2"
              style={
                pending.verdict.kind === 'governed'
                  ? {
                      borderColor: 'hsl(var(--product-legacy) / 0.35)',
                      background: 'hsl(var(--product-legacy) / 0.07)',
                    }
                  : undefined
              }
            >
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                {pending.verdict.kind === 'governed' ? (
                  <>
                    <Landmark
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'hsl(var(--product-legacy))' }}
                      strokeWidth={1.8}
                    />
                    {t('This account is governed by a council')}
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 shrink-0 text-tone-warning" strokeWidth={1.8} />
                    {t('I could not check this account')}
                  </>
                )}
              </p>
              <p className="font-mono text-[11px] text-ink/45 break-all">{pending.address}</p>
              {pending.verdict.kind === 'governed' ? (
                <>
                  <p className="text-[12px] leading-relaxed text-ink/70">
                    {t(
                      'The ledger says its signatures come from a quorum, not from a single key. Adding it is fine — it lands on the Legacy shelf as read-only, and the council keeps signing.',
                    )}
                  </p>
                  <p className="text-[12px] text-ink/60">
                    {pending.verdict.quorum !== null
                      ? `${t('Quorum')} ${pending.verdict.quorum} / ${pending.verdict.memberCount} ${t('signers')}`
                      : `${pending.verdict.memberCount} ${t('signers')}`}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[12px] leading-relaxed text-ink/70">
                    {t(
                      'The ledger read failed, so I do not know whether this account has a council. You can add it anyway — I am telling you instead of guessing.',
                    )}
                  </p>
                  {pending.verdict.kind === 'unreadable' && (
                    <p className="font-mono text-[11px] text-ink/40 break-words">{pending.verdict.detail}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => decide(false)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-ink/10 bg-ink/5 text-ink/70 text-sm font-medium hover:bg-ink/10 transition-colors"
              >
                {t('Cancel')}
              </button>
              <button
                onClick={() => decide(true)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-volt/30 bg-volt/10 text-volt text-sm font-medium hover:bg-volt/20 transition-colors"
              >
                {t('Add it anyway')}
              </button>
            </div>
          </div>
        ) : outcome ? (
          /* ── CÓMO ACABÓ ──────────────────────────────────────────────
             El modal ya no se cierra solo: se cerraba antes de decir nada,
             y eso es lo que hacía «añadida» indistinguible de «nada». */
          <div className="space-y-4">
            <div className="rounded-xl border border-ink/10 bg-ink/[0.04] px-4 py-3.5 space-y-2">
              {outcome.kind === 'added' ? (
                <>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Check className="w-4 h-4 shrink-0 text-tone-success" strokeWidth={2.2} />
                    {t('Wallet added')}
                  </p>
                  <p className="font-mono text-[11px] text-ink/45 break-all">{outcome.address}</p>
                  <p className="text-[12px] leading-relaxed text-ink/70">
                    {outcome.shelf === 'legacy'
                      ? t('You will find it on the Legacy shelf, as read-only: its council signs, never a single key.')
                      : t('You will find it on the Personal shelf, in your wallet list.')}
                  </p>
                </>
              ) : outcome.kind === 'reconnected' ? (
                <>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Check className="w-4 h-4 shrink-0 text-tone-success" strokeWidth={2.2} />
                    {t('Connected again')}
                  </p>
                  <p className="text-sm text-ink/85">{outcome.name}</p>
                  <p className="text-[12px] leading-relaxed text-ink/70">
                    {t('It was already in your list. What changed is this browser: it has the Xaman session for this account again, the one the Manager desk and signatures use.')}
                  </p>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Info className="w-4 h-4 shrink-0 text-ink/50" strokeWidth={2} />
                    {t('You already had this one')}
                  </p>
                  <p className="text-sm text-ink/85">{outcome.name}</p>
                  <p className="text-[12px] leading-relaxed text-ink/70">
                    {t('It is already in your wallet list, and nothing was changed.')}
                  </p>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setOutcome(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border border-ink/10 bg-ink/5 text-ink/70 text-sm font-medium hover:bg-ink/10 transition-colors"
              >
                {t('Add another')}
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl border border-volt/30 bg-volt/10 text-volt text-sm font-medium hover:bg-volt/20 transition-colors"
              >
                {t('Done')}
              </button>
            </div>
          </div>
        ) : (
          <>
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28, delay: 0.05 }}
            onClick={() => void submitEvm()}
            disabled={evmBusy || !!connectBusy}
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl border border-volt/30 bg-volt/10 text-volt text-sm font-medium hover:bg-volt/20 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2.5">
              {evmBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <WalletBrandIcon brand="metamask" size={18} />}
              MetaMask · Flare Mainnet
            </span>
            {/* Untranslated on purpose: "chain 14" is the identifier the user
                will also read inside MetaMask (t('chain') would say "cadena"). */}
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-volt/30 text-volt/80">
              chain 14
            </span>
          </motion.button>
          {/* t() on the thrown prose: the connect rail speaks English, the UI
              may not — a miss falls back to the string itself. */}
          {evmError && <p className="text-xs text-tone-danger -mt-1">{t(evmError)}</p>}

          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28, delay: 0.1 }}
            onClick={() => void submitXaman()}
            disabled={!!connectBusy || evmBusy || checking}
            className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-xl border border-sky-400/30 bg-sky-400/10 text-sky-200 text-sm font-medium hover:bg-sky-400/20 transition-colors disabled:opacity-50"
          >
            <span className="flex items-center gap-2.5">
              {connectBusy === 'xrpl' || checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <WalletBrandIcon brand="xaman" size={18} />}
              Xaman · XRPL
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full border border-sky-400/30 text-sky-200/80">XRP</span>
          </motion.button>
          {/* El fallo de Xaman ya no se traga: antes el `.catch(() => {})` del
              botón lo mandaba al vacío y la pantalla se quedaba igual. */}
          {xamanError && <p className="text-xs text-tone-danger -mt-1">{t(xamanError)}</p>}
          {checking && (
            <p className="text-[11px] text-ink/45 -mt-1">{t('Checking what this address is…')}</p>
          )}

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
          </>
        )}
        </div>
      </motion.div>
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
  constituteDoor = false,
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
  /** Render the «Constitute a Legacy» door at the foot (the /app/wallets page
   *  hands it in so the door and the governance dialog share one owner). */
  constituteDoor?: boolean;
} = {}) {
  const { t, lang } = useT();
  const es = lang === 'es';
  // En la lámina, el faro de satélites es el sello con sus firmas: las
  // cuentas que firman ante el registro (ui/skin/marks.tsx SignetMark).
  const engraved = useEngraved();
  const legacyCouncil = typeof scope === 'object' ? scope.legacyCouncil : null;

  // The lenses returned SIMPLE (founder 2026-08-22, second pass: «vuelve a
  // añadir las distintas vistas, pero que sea sencillo»): exactly TWO —
  // cards or rows — over the same two shelves and the same balance order.
  // The old organizer (token lens, three orders) stays retired in git.
  const [view, setView] = useState<'grid' | 'list'>('grid');
  /** LAS TARJETAS ABIERTAS (fundador 2026-08-27, tercera pasada: «que se
   *  mantenga expandida, por si alguien prefiere la vista expandida»). La
   *  expansión es una PREFERENCIA, no un vistazo: varias pueden estar abiertas
   *  a la vez y el conjunto sobrevive entre visitas (localStorage). La regla
   *  vieja de «una a la vez» era mía, no del fundador, y murió aquí. */
  const [openCards, setOpenCards] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem('astryum:wallets:open-cards');
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const toggleOpenCard = (key: string, open: boolean) => {
    setOpenCards((prev) => {
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      try {
        window.localStorage.setItem('astryum:wallets:open-cards', JSON.stringify([...next]));
      } catch {
        /* storage bloqueado — la preferencia vive solo esta sesión */
      }
      return next;
    });
  };
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    try {
      const raw = localStorage.getItem('astryum:walletsView.v3');
      if (raw === 'grid' || raw === 'list') setView(raw);
    } catch {
      /* defaults stand */
    }
  }, []);
  const pickView = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem('astryum:walletsView.v3', v);
    } catch {
      /* best-effort persistence */
    }
  };
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

  // The visual fold (paFold, 2026-08-17): personal Smart Accounts whose
  // owning XRPL wallet is linked disappear as rows — the owner absorbs their
  // value/tokens (aggregated store folds them) and wears the badge + the
  // unmint door. Legacy tab untouched: a council's legs stay explicit.
  const paFold = usePaFold(allLinkedWallets.map((w) => w.address));
  const absorbedPaByOwner = useMemo(() => {
    const linkedKeys = new Set(allLinkedWallets.map((w) => foldKey(w.address)));
    const m = new Map<string, BackendWallet>();
    for (const w of allLinkedWallets) {
      const owner = paFold.ownerByPa.get(foldKey(w.address));
      if (owner && linkedKeys.has(foldKey(owner))) m.set(foldKey(owner), w);
    }
    return m;
  }, [allLinkedWallets, paFold]);

  // ONE shared switch-to-Flare engine for every card (same one the global
  // banner uses) — the active EVM card renders the contextual CTA from it.
  const flareSwitch = useSwitchToFlare();

  // TODAS LAS CUENTAS, LOS LEGACY TAMBIÉN (fundador 2026-08-22: «los legacy los
  // tienes que poner en la pantalla de wallets»). Hasta aquí, la cuenta del
  // consejo y su Smart Account salían de esta lista y sólo se veían dentro de
  // su Legacy — así que la pantalla que promete enseñar tus cuentas escondía
  // justo las que más explicación necesitan. Un consejo es una wallet cuya
  // firma es un quórum, y eso lo dice su propia tarjeta (readOnly + la píldora
  // M-de-N), no su ausencia.
  const { authorities: allAuthorities, governedCandidates, reload: reloadAuthorities } = useAuthorities();
  // A SignerList alone does NOT make an account a council (founder 2026-08-21):
  // a reinforced personal account has one too, and it belongs HERE — that is
  // the whole promise of "it stays a personal wallet". Before this, finishing a
  // reinforcement made the wallet disappear from this screen and reappear as a
  // Legacy. The owner's side is the tiebreaker the ledger cannot give us.
  const reinforcedKeys = useMemo(() => reinforcedPersonalKeys(allAuthorities), [allAuthorities]);
  const confirmedCouncils = useMemo(
    () =>
      governedCandidates
        .filter((g) => g.hasCouncil === true && !reinforcedKeys.has(addressKey(g.address)))
        .map((g) => g.address),
    [governedCandidates, reinforcedKeys],
  );
  // Personal excludes EVERY Legacy's Smart Account; the Legacy tab resolves just
  // its own council → PA. One deterministic resolver (getPersonalAccount) both.
  const { byXrpl: smartAccounts, paKeys } = useSmartAccountsOf(
    legacyCouncil ? [legacyCouncil] : confirmedCouncils,
  );

  // NINGUNA puerta de esta pantalla NAVEGA ya a /app/legacy (fundador
  // 2026-08-30: «que se mantenga en la pantalla de wallets»). El helper
  // `openLegacySurface` que empujaba a la página murió con el recableado:
  // constituir, reforzar y gobernar abren su operación en el host global, y
  // Movimientos su modal aquí mismo. Las tres siguen pasando por las MISMAS
  // puertas de acceso (demo → aviso; sin beta → aviso), ahora cada una en su
  // propio abridor. /app/legacy sigue existiendo para deep-links y para el
  // push «firma en la bandeja».
  // CONSTITUIR = OPERACIÓN (fundador 2026-08-26: «que cuente como otra
  // operación normal... formato popup... anclable a la derecha»). La puerta
  // ya no navega: abre ConstituteOperation aquí mismo, sobre el dashboard
  // vivo. /app/legacy?constitute=1 sigue existiendo (deep-links, Home).
  const openConstituteOperation = () => {
    if (isDemoMode()) {
      openLegacyComingSoon();
      return;
    }
    if (!useAuthStore.getState().legacyAccess) {
      openLegacyComingSoon('beta');
      return;
    }
    openConstituteOp();
  };
  // GOBERNAR = OPERACIÓN (fundador 2026-08-30: «no quiero que te lance el
  // menú ese tan complejo — burbuja anclable»): la puerta ya no navega a
  // /app/legacy; abre GovernOperation en el host global, sobre el dashboard
  // vivo. La página ?govern= sigue existiendo (deep-links, push «firma en la
  // bandeja»). Las MISMAS puertas de acceso que siempre.
  const openGovernOp = useOperationStore((st) => st.openGovernOp);
  const openGovernance = (address: string, tab?: 'proposals') => {
    if (isDemoMode()) {
      openLegacyComingSoon();
      return;
    }
    if (!useAuthStore.getState().legacyAccess) {
      openLegacyComingSoon('beta');
      return;
    }
    openGovernOp(address, getLegacyNickname(address), tab);
  };
  // MOVIMIENTOS SE QUEDA EN WALLETS (fundador 2026-08-30: «que se mantenga
  // en la pantalla de wallets») — el modal de la cuenta gobernada abre aquí
  // mismo, sin cargar la pantalla Legacy. Misma pieza que usa LegacyPanel.
  const [governedMovementsFor, setGovernedMovementsFor] = useState<string | null>(null);
  const openGovernedMovements = (address: string) => {
    if (isDemoMode()) {
      openLegacyComingSoon();
      return;
    }
    if (!useAuthStore.getState().legacyAccess) {
      openLegacyComingSoon('beta');
      return;
    }
    setGovernedMovementsFor(address);
  };
  // Reinforce — la ceremonia abre como OPERACIÓN (fundador 2026-08-27):
  // popup/anclable del host global, en ORO — la cuenta sigue siendo personal,
  // así que nada de tema Legacy ni de viaje a la superficie de gobernanza.
  const openReinforceOp = useOperationStore((st) => st.openReinforceOp);
  const openReinforce = (address: string) => {
    openReinforceOp(address);
  };
  // El quórum personal se gobierna con la MISMA burbuja (la entrada govern
  // del panel ya distingue reinforce por el ledger, como hacía la página).
  const openPersonalGovernance = (address: string) => {
    openGovernance(address);
  };
  // Renaming a Legacy is naming the ACCOUNT, not a wallet row: the nickname
  // lives in the legacy pointers (localStorage + drained to the governed
  // registry by useAuthorities). The bump re-synthesizes the council rows so
  // the new name paints immediately.
  const [legacyNameBump, setLegacyNameBump] = useState(0);
  // The Manage dialog — one wallet at a time, floating above the grid.
  const [manageWallet, setManageWallet] = useState<BackendWallet | null>(null);
  // La ceremonia de constitución, abierta como operación (popup/anclada).
  // La operación vive en el HOST GLOBAL (operationStore, 2026-08-26): el
  // fundador la pilló muriendo al cambiar de pestaña — estado local de página
  // era el mismo pecado que ya pagaron estrategia y posiciones.
  const openConstituteOp = useOperationStore((st) => st.openConstituteOp);
  const handleRenameLegacy = (address: string, name: string) => {
    setLegacyNickname(address, name);
    setLegacyNameBump((n) => n + 1);
  };

  // Una cuenta del consejo se pinta SIEMPRE en modo lectura, también en la
  // lista general: es un multisig, así que ofrecerle los botones de firma
  // única sería ofrecer una acción que la cadena va a rechazar. Su tarjeta
  // dice lo que es («Gobernada por su consejo — Astryum nunca firma») y su
  // gobernanza vive en la pantalla de Legacy.
  // ANCLADO POR CONTENIDO (2026-09-13): governedCandidates estrena identidad
  // con cada tick del ledger, y un Set nuevo-pero-igual re-disparaba los
  // efectos aguas abajo (la pata de credenciales del estante Manager corría
  // una docena de veces por visita). La clave-texto solo cambia cuando
  // cambia el CONTENIDO.
  const councilKeyString = useMemo(
    () => confirmedCouncils.map((a) => addressKey(a)).sort().join(','),
    [confirmedCouncils],
  );
  const councilKeySet = useMemo(
    () => new Set(councilKeyString.split(',').filter(Boolean)),
    [councilKeyString],
  );

  // ── El estante MANAGER (fundador 2026-09-06: «añadir otra sección para la
  // de Manager — solo las wallets que sirven para los managed vaults»). La
  // clasificación vive en lib/wallet/managerWallets y se DERIVA de la chain,
  // nunca de una etiqueta guardada ni de un flag declarado. Tres patas:
  // consejo XRPL de un pote (catálogo), director EVM vigente de una jaula
  // (listCages + la regla del contrato) y — la que faltaba el 6-sep — la
  // cuenta ACREDITADA como gestor (credenciales AIFM/KYC aceptadas en el
  // ledger: la cuenta dedicada del wizard ya es la wallet del manager ANTES
  // de tener jaula o potes). «No pude leer» ≠ «no gestionas nada»: sin
  // lectura, nada cambia de estante.
  const managerScanOn = variant === 'page' && !legacyCouncil && allLinkedWallets.length > 0;
  /** Las XRPL cuyo consejo AÚN NO contestó `false` (leyendo, error, o true):
   *  con gobernanza desconocida nadie sube al estante Manager — sin esto, un
   *  consejo de pote cuya lectura tardaba aterrizaba en Manager en vez de en
   *  Legacy (fundador 2026-09-12, visto en vivo). */
  const unresolvedKeyString = useMemo(
    () =>
      governedCandidates
        .filter((g) => g.hasCouncil !== false)
        .map((g) => addressKey(g.address))
        .sort()
        .join(','),
    [governedCandidates],
  );
  const xrplUnresolvedKeys = useMemo(
    () => new Set(unresolvedKeyString.split(',').filter(Boolean)),
    [unresolvedKeyString],
  );
  const managerKeySet = useManagerWalletKeys(allLinkedWallets, councilKeySet, managerScanOn, xrplUnresolvedKeys);

  // Balance order + the orphan-PA filter below read the REAL per-wallet net
  // worth from the shared aggregated-portfolio store (already warm — the
  // shell's poller feeds it); unpriced wallets simply have no entry.
  const { data: aggregatedPortfolio, loading: aggLoading, refreshing: aggRefreshing } = useAggregatedPortfolio();
  const usdByAddress = useMemo(() => {
    const m = new Map<string, number>();
    for (const pw of aggregatedPortfolio?.perWallet ?? []) {
      const v = pw?.snap?.netWorthUSD;
      if (typeof v === 'number') m.set(addressKey(pw.address), v);
    }
    return m;
  }, [aggregatedPortfolio]);

  /** Wallets con valoración ya leída — el recuento del chip de lectura. */
  const walletsRead = useMemo(
    () => allLinkedWallets.filter((w) => usdByAddress.has(addressKey(w.address))).length,
    [allLinkedWallets, usdByAddress],
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
    const absorbedKeys = new Set([...absorbedPaByOwner.values()].map((w) => foldKey(w.address)));
    const linked = allLinkedWallets.filter(
      (w) =>
        !absorbedKeys.has(foldKey(w.address)) &&
        // La Smart Account de un Legacy se pliega DENTRO de su consejo, igual
        // que la de una wallet personal se pliega dentro de su dueña: una
        // cuenta, una fila, entera. (El agregado ya suma las dos patas en la
        // fila del consejo.) Sin esto, quitar el viejo filtro de consejos
        // sacaba la pata de Flare como una fila suelta y sin dueña visible.
        !paKeys.has(addressKey(w.address)) &&
        // Founder 2026-08-19 ("se siguen viendo las smart accounts"): an
        // ORPHAN Smart Account holding nothing — neither a Legacy's leg nor
        // absorbed by an owner in the list — is registry plumbing from old
        // deployments, not capital: hidden here too. One with value stays.
        !isHiddenEmptyOrphanPa(w.walletType, usdByAddress.get(addressKey(w.address))),
    );
    // El consejo de un Legacy vive en el registro de cuentas gobernadas, no en
    // la tabla de wallets: si no está dado de alta, se sintetiza su fila —
    // igual que ya se hace dentro de la pestaña Wallets del propio Legacy —
    // para que la cuenta nunca desaparezca de la pantalla que la lista.
    const present = new Set(linked.map((w) => addressKey(w.address)));
    const councilRows = confirmedCouncils
      .filter((a) => !present.has(addressKey(a)))
      .map((a) =>
        legacyWalletRow(a, {
          walletType: 'Council · multisig',
          network: 'xrpl',
          chainId: null,
          caip2: null,
          ecosystem: 'xrpl',
          // The Legacy's REAL name (founder 2026-08-22: the card read
          // «Council» while the account was called «Family Legacy»): registry
          // label first, local nickname as fallback — same precedence as
          // everywhere else. Without one, walletIdentity's curated 'Council'
          // stands; the display rule never shows the address.
          nickname:
            governedCandidates.find((g) => addressKey(g.address) === addressKey(a))?.label ??
            getLegacyNickname(a) ??
            null,
        }),
      );
    return [...linked, ...councilRows];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLinkedWallets, legacyCouncil, smartAccounts, confirmedCouncils, paKeys, absorbedPaByOwner, usdByAddress, governedCandidates, legacyNameBump]);

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
    const usdRank = (w: BackendWallet) => usdByAddress.get(addressKey(w.address)) ?? -1;
    return [...wallets].sort(
      (a, b) => usdRank(b) - usdRank(a) || displayName(a).localeCompare(displayName(b)),
    );
  }, [wallets, usdByAddress]);
  // The origin filter cuts across every lens; the two origin shelves feed the
  // sectioned list/grid (added-by-you first, the platform's after).
  // The origin filter + origin shelves LEFT (founder 2026-08-19: "el toggle
  // de added by you / by the platform no tiene sentido — menos movidas"):
  // with Legacy legs and empty orphan PAs already out of this list, origin
  // stopped carrying information. The TYPE shelves below still explain each
  // row (login wallet, watch-only, embedded…).
  // The two shelves (founder 2026-08-22): Personal above, Legacy below —
  // separated so «esto es tuyo con tu llave» and «esto lo gobierna un
  // consejo» never share a row. A REINFORCED personal wallet (own-key quorum)
  // stays on the Personal shelf: reinforced is not governed.
  // EL ESTANTE MANAGER, RESTAURADO (fundador 2026-09-12: «no están ordenadas
  // cada una en su sitio: slot personal, slot manager y slot legacy»). El
  // 11-sep pidió sello-sin-estante y el 12 pidió los tres slots — manda la
  // orden más nueva. Conviven las dos piezas: la wallet de gestor VIVE en su
  // estante Y lleva el sello (ManagerMark) como identidad de tarjeta.
  // managerKeySet sigue derivándose de la chain, nunca de una etiqueta.
  const personalRows = useMemo(
    () => sortedWallets.filter((w) => !councilKeySet.has(addressKey(w.address)) && !managerKeySet.has(addressKey(w.address))),
    [sortedWallets, councilKeySet, managerKeySet],
  );
  /** El estante Manager: tus llaves, con mandato sobre managed vaults. Mismas
   *  tarjetas y puertas que Personal (siguen siendo single-sig tuyas). */
  const managerRows = useMemo(
    () => sortedWallets.filter((w) => managerKeySet.has(addressKey(w.address))),
    [sortedWallets, managerKeySet],
  );
  const councilRows = useMemo(
    () => sortedWallets.filter((w) => councilKeySet.has(addressKey(w.address))),
    [sortedWallets, councilKeySet],
  );
  /** El quórum de cada consejo, leído del LEDGER (useAuthorities), para que la
   *  corona de su tarjeta diga M de N. Sin lectura no hay cifra: la corona cae
   *  a «firma el consejo» antes que inventarse un número. */
  const councilFactsByKey = useMemo(() => {
    const m = new Map<string, { quorum?: number; memberCount?: number }>();
    for (const a of allAuthorities) {
      if (a.kind !== 'governed') continue;
      m.set(addressKey(a.address), { quorum: a.quorum, memberCount: a.memberCount });
    }
    return m;
  }, [allAuthorities]);
  /** El quórum de cada REFORZADA, del mismo ledger (hardenedQuorum solo se
   *  escribe desde una lectura real) — la corona de oro de la tarjeta y la
   *  cifra de la fila lo pintan; sin lectura no hay corona (2026-09-06). */
  const quorumFactsByKey = useMemo(() => {
    const m = new Map<string, { quorum?: number; memberCount?: number }>();
    for (const a of allAuthorities) {
      if (a.kind !== 'single' || a.hardenedQuorum?.hasCouncil !== true) continue;
      m.set(addressKey(a.wallet.address), {
        quorum: a.hardenedQuorum.quorum,
        memberCount: a.hardenedQuorum.memberCount,
      });
    }
    return m;
  }, [allAuthorities]);

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
  // The unmint door (founder 2026-08-12): the Smart Account card/row opens
  // the send modal LOCKED as what the action really is — FXRP → native XRP.
  const [unmintWallet, setUnmintWallet] = useState<BackendWallet | null>(null);

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
    // WHICH app signed the login (founder 2026-08-22: the row used to be filed
    // as 'siwe' — the protocol, not the app — so the list showed an Ethereum
    // diamond over a bare address). The extension identifies itself; 'siwe'
    // survives only as the honest fallback when nothing does.
    const brandName = injectedWalletName((window as { ethereum?: unknown }).ethereum);
    const existing = allLinkedWallets.find((w) => w.address.toLowerCase() === addr);
    if (existing) {
      // HEALING: a row filed as 'siwe' by older builds gets its app name the
      // first time we can detect it — POST /connect on an existing row
      // overwrites walletType (walletRegistry upsert), nothing else changes.
      const wt = (existing.walletType ?? '').trim().toLowerCase();
      const healKey = `heal:${addr}`;
      if (wt === 'siwe' && brandName && !attemptedRef.current.has(healKey)) {
        attemptedRef.current.add(healKey);
        connectWallet({
          address: addr,
          walletType: brandName,
          network: 'flare',
          chainId: 14,
          caip2: 'eip155:14',
          ecosystem: 'evm',
          purpose: 'watch',
        })
          .then(() => linking.refresh())
          .catch(() => attemptedRef.current.delete(healKey));
      }
      return;
    }
    // A wallet the user deleted stays deleted. `attemptedRef` is per mount, and
    // this effect also fires BEFORE the list has loaded, so without this the row
    // came back on every refresh. Re-adding it stays one explicit click away.
    if (isAddressRemoved(addr)) return;
    if (attemptedRef.current.has(addr)) return;
    attemptedRef.current.add(addr);
    connectWallet({
      address: addr,
      walletType: brandName ?? 'siwe',
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

  // EL BANNER SOLO MIENTRAS HAY ALGO QUE HACER (fundador 2026-09-09: «me
  // aparece arriba el mensajito de MetaMask connected… ¿por qué aparece tanto
  // rato?»). No era un mensaje que expira: era una tira de ESTADO atada a la
  // sesión de MetaMask, viva mientras la extensión siguiera conectada — o
  // sea, siempre. Su trabajo es ofrecer «añadir esta wallet»; una vez está
  // en la lista, su «Connect another» ya lo cubre el botón «Add Wallet» de
  // la cabecera (MetaMask · Flare Mainnet). Y la X: cerrada, no vuelve en
  // esta pestaña (sessionStorage, por dirección).
  const DISMISSED_KEY = 'astryum:walletBannerDismissed';
  const [dismissedBanners, setDismissedBanners] = useState<Set<string>>(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(DISMISSED_KEY) : null;
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const dismissBanner = (address: string) => {
    setDismissedBanners((prev) => {
      const next = new Set(prev).add(address.toLowerCase());
      try {
        window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage bloqueado: se cierra igual, solo que vuelve al recargar */
      }
      return next;
    });
  };
  const showConnectedBanner =
    isConnected &&
    !!connectedAddress &&
    !connectedInList &&
    !dismissedBanners.has(connectedAddress.toLowerCase());

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

  /**
   * QUITAR UNA CUENTA DE LA LISTA — el plan entero, no sólo la fila.
   *
   * Antes esto era `linking.remove(id)` a secas, y para una cuenta gobernada
   * eso era insuficiente de dos maneras: si la fila era sintetizada el id no
   * existe en el servidor (404), y si además tenía puntero en el registro, la
   * cuenta volvía en la siguiente lectura aunque la fila se borrase. Se borra
   * lo que haya de cada cosa, y los fallos se DICEN: una limpieza a medias que
   * se calla es cómo vuelve la fila sin que nadie sepa por qué.
   */
  async function handleRemove(plan: RemovalPlan) {
    setActionBusy(true);
    setActionMsg(null);
    const failures: string[] = [];
    try {
      if (plan.walletId) {
        try {
          await linking.remove(plan.walletId);
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      // EL REGISTRO SE LE PREGUNTA AL SERVIDOR, no a una vista ya filtrada.
      // `plan.registryId` sale de `governedCandidates`, que desde hoy esconde
      // las direcciones marcadas como quitadas: si el usuario ya intentó
      // quitarla antes, su entrada seguiría en el servidor y el plan la vería
      // como inexistente — huérfana para siempre. Se barre por dirección, que
      // además se lleva por delante los duplicados.
      try {
        const { accounts } = await governedAccountsApi.list();
        const mine = accounts.filter(
          (a) => !!a.address && addressKey(a.address) === addressKey(plan.address),
        );
        for (const hit of mine) await governedAccountsApi.remove(hit.id);
      } catch (e) {
        failures.push((e as Error).message);
      }
      // El puntero local y la marca de «no la resucites». Esto no falla: es
      // localStorage, y forgetLegacy ya se protege solo.
      forgetLegacy(plan.address);
      markAddressRemoved(plan.address);
      if (plan.disconnectXrplSession) {
        // Estar conectada la hace candidata por sí solo: sin soltar la sesión
        // la cuenta reaparece y el botón habría parecido no hacer nada. Import
        // dinámico, como en authStore: la factoría arrastra los servicios de
        // todos los proveedores.
        try {
          const { WalletServiceFactory } = await import('@/services/wallets/WalletServiceFactory');
          const xaman = WalletServiceFactory.getWalletService('xaman') as { disconnect?: () => Promise<void> };
          await xaman.disconnect?.();
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      // Que las listas se rehagan: la de wallets y la de consejos.
      reloadAuthorities();
      await linking.refresh();
      setLegacyNameBump((n) => n + 1);
      if (failures.length > 0) setActionMsg(failures.join(' · '));
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

      {/* The stat band (Total/Tx/Read-only/Chains) DIED 2026-08-22 — it was
          instrument-panel noise on a screen whose job is «which wallet is
          which» (founder: «entras y lo único que se entiende es que hay tres
          wallets»). The counts live in the shelf headers now. */}

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
        (showConnectedBanner ||
          (MULTI_VM_CONNECT_ENABLED && solAccount.isConnected && solAccount.address && !solInList) ||
          (MULTI_VM_CONNECT_ENABLED && btcAccount.isConnected && btcAccount.address && !btcInList)) && (
          <Card padded={false} className="mb-6 divide-y divide-ink/5 overflow-hidden">
            {showConnectedBanner && connectedAddress && (
              <PendingWalletBanner
                label={`${linking.connectorName ?? t('Wallet')} ${t('connected')}`}
                address={connectedAddress}
                busy={actionBusy}
                onAdd={handleAddConnected}
                onSecondary={handleDisconnect}
                secondaryLabel={t('Disconnect')}
                secondaryTitle={t('To add another account from the SAME wallet app, switch the active account inside that app first, then connect.')}
                onDismiss={() => dismissBanner(connectedAddress)}
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
            {engraved ? <SignetMark size={150} /> : <SignalBeacon width={210} height={176} />}
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
            actions={
              <span className="flex items-center gap-3">
                {/* SE SIGUEN LEYENDO (fundador 2026-09-11: «no queda claro cuándo
                    están todas cargadas»): mientras el agregado lee, un punto
                    que respira con el recuento de wallets ya valoradas. Sin
                    petición nueva — lee el mismo store que las tarjetas. */}
                {!legacyCouncil && wallets.length > 0 && (aggLoading || aggRefreshing) && walletsRead < wallets.length && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink/[0.03] px-2.5 py-1 text-[11px] text-ink/55">
                    <span className="relative flex h-1.5 w-1.5" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt/60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-volt" />
                    </span>
                    {t('Reading wallets')}
                    <span className="font-mono tabular-nums text-ink/40">{walletsRead}/{wallets.length}</span>
                  </span>
                )}
                {linking.loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink/40" />}
                {/* Two lenses, nothing more (founder 2026-08-22): cards or
                    rows — same shelves, same order, same doors. */}
                {!legacyCouncil && wallets.length > 0 && (
                  <SegmentedControl<'grid' | 'list'>
                    layoutId="wallets-view"
                    value={view}
                    onChange={pickView}
                    options={[
                      { key: 'grid', label: es ? 'Tarjetas' : 'Cards' },
                      { key: 'list', label: es ? 'Lista' : 'List' },
                    ]}
                  />
                )}
              </span>
            }
          >
            {legacyCouncil ? t('Legacy wallets') : t('Your Wallets')} ({wallets.length})
          </SectionTitle>
          {/* «Aún leyendo» junto a la lista: una tarjeta sin cifra es una
              wallet en cola, no una wallet vacía (2026-09-07). */}
          <div className="-mt-1 mb-3">
            <PortfolioSyncBadge />
          </div>

          {wallets.length === 0 ? (
            legacyCouncil ? (
              <div className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-6 text-center text-sm text-ink/50">
                {t('Resolving this Legacy’s Smart Account… its wallets appear here once the council’s Flare account is known.')}
              </div>
            ) : (
              <SceneDoor
                scene={<SignalBeacon width={210} height={176} />}
                engraving={<SignetMark size={150} />}
                tone="gold"
                eyebrow={t('Your control plane')}
                title={t('No wallets yet')}
                desc={t('Connect a wallet app or watch any XRPL or Flare address. You can add as many as you like.')}
                cta={t('Add wallet')}
                onClick={() => setShowAdd(true)}
              />
            )
          ) : legacyCouncil ? (
            // Arrive, no Reveal (2026-08-25): estas rejillas montan CUANDO el
            // dato contesta, así que su gesto es el de llegada de datos — el
            // de ruta ya jugó, con la página aún vacía.
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sortedWallets.map((w, wIdx) => (
                // Key on address+chain, NOT w.id: a leg starts as a synthesized
                // row (id 'legacy:<addr>') and becomes the real record once
                // /wallets/mine loads — a w.id key would remount the card.
                <Arrive key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`} index={wIdx}>
                  <WalletCard
                    wallet={w}
                    holdings={holdingsByAddress.get(addressKey(w.address))}
                    absorbedPa={undefined}
                    isActiveConnected={isConnected && connectedAddress?.toLowerCase() === w.address.toLowerCase()}
                    busy={actionBusy}
                    readOnly
                    flareSwitch={flareSwitch}
                    onEnableTx={handleEnableTx}
                    onMovements={setMovementsWallet}
                    onUnmint={undefined}
                    onGovernedMovements={onGovernedMovements}
                    onGovern={undefined}
                    council={councilKeySet.has(addressKey(w.address)) || isCouncilType(w.walletType)}
                  />
                </Arrive>
              ))}
            </div>
          ) : (
            // ── TWO SHELVES (founder 2026-08-22): Personal above, Legacy
            //    below. A reinforced personal wallet stays Personal — its
            //    quorum pill tells the story; governed is a different thing. ──
            <div className="space-y-8">
              {/* TRES ESTANTES, UN LENGUAJE (fundador 2026-09-12: «que cada una
                  tenga su función… más visual, pero no un corte por el medio de
                  la página»): la misma cabecera en línea (ShelfHead) sobre un
                  raíl de color a la izquierda (.shelf-rail) — personal en
                  tinta, gestor en oro, Legacy en índigo. Sin bandas. */}
              {personalRows.length > 0 && (
                <div className="shelf-rail" style={{ ['--shelf' as never]: 'hsl(var(--ink) / 0.14)' }}>
                  <ShelfHead
                    icon={<Wallet className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    color="hsl(var(--ink) / 0.85)"
                    label={t('Personal')}
                    count={personalRows.length}
                    purpose={t('Your own keys — one signature, yours to move.')}
                  />
                  {view === 'list' ? (
                    <ul className="space-y-1.5">
                      {personalRows.map((w, wIdx) => (
                        <WalletListRow
                          key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`}
                          rowIndex={wIdx}
                          wallet={w}
                          manager={managerKeySet.has(addressKey(w.address))}
                          usd={usdByAddress.get(addressKey(w.address))}
                          absorbedPa={absorbedPaByOwner.get(foldKey(w.address))}
                          busy={actionBusy}
                          council={false}
                          quorumFacts={quorumFactsByKey.get(addressKey(w.address))}
                          onMovements={() => setMovementsWallet(w)}
                          onManage={() => setManageWallet(w)}
                          t={t}
                        />
                      ))}
                    </ul>
                  ) : (
                  <WalletCardsGrid>
                    {/* Rejilla de TARJETAS compactas (2026-08-27): tres por
                        fila, cara de tarjeta de crédito. La abierta ocupa la
                        fila entera y el `layout` del contenedor anima el
                        crecimiento EN EL SITIO — las vecinas se recolocan
                        solas. */}
                    {personalRows.map((w, wIdx) => {
                      const cardKey = `${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`;
                      const openThis = openCards.has(cardKey);
                      return (
                        <motion.div
                          key={cardKey}
                          layout
                          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            layout: { type: 'spring', stiffness: 300, damping: 30 },
                            opacity: { duration: 0.35, delay: Math.min(wIdx * 0.04, 0.3) },
                          }}
                          className={openThis ? 'col-span-full' : ''}
                        >
                          {openThis ? (
                            <WalletCard
                              wallet={w}
                              manager={managerKeySet.has(addressKey(w.address))}
                              holdings={holdingsByAddress.get(addressKey(w.address))}
                              absorbedPa={absorbedPaByOwner.get(foldKey(w.address))}
                              isActiveConnected={isConnected && connectedAddress?.toLowerCase() === w.address.toLowerCase()}
                              busy={actionBusy}
                              readOnly={false}
                              flareSwitch={flareSwitch}
                              onEnableTx={handleEnableTx}
                              onMovements={setMovementsWallet}
                              onUnmint={setUnmintWallet}
                              onGovernedMovements={undefined}
                              onGovern={undefined}
                              onManage={() => setManageWallet(w)}
                              onCollapse={() => toggleOpenCard(cardKey, false)}
                            />
                          ) : (
                            <CompactWalletCard
                              wallet={w}
                              manager={managerKeySet.has(addressKey(w.address))}
                              holdings={holdingsByAddress.get(addressKey(w.address))}
                              usd={usdByAddress.get(addressKey(w.address))}
                              absorbedPa={absorbedPaByOwner.get(foldKey(w.address))}
                              quorumFacts={quorumFactsByKey.get(addressKey(w.address))}
                              onOpen={() => toggleOpenCard(cardKey, true)}
                              onMovements={() => setMovementsWallet(w)}
                              onManage={() => setManageWallet(w)}
                              t={t}
                            />
                          )}
                        </motion.div>
                      );
                    })}
                  </WalletCardsGrid>
                  )}
                </div>
              )}
              {/* ── El estante MANAGER (2026-09-06 · muerto el 11 · RESUCITADO
                  el 2026-09-12 por orden del fundador: «cada una en su sitio:
                  slot personal, slot manager y slot legacy»): entre Personal y
                  Legacy — tus llaves, con mandato sobre managed vaults. El
                  sello (ManagerMark) sigue en la tarjeta: estante Y sello. */}
              {managerRows.length > 0 && (
                <div className="shelf-rail" style={{ ['--shelf' as never]: 'hsl(var(--volt) / 0.55)' }}>
                  <ShelfHead
                    icon={<Briefcase className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    color="hsl(var(--volt))"
                    label={t('Manager')}
                    count={managerRows.length}
                    purpose={t('The wallets you run managed vaults with: the XRPL account that governs and, while ceded, the director key on Flare.')}
                    action={
                      <Link href="/app/manager" className="inline-flex items-center gap-1 font-medium text-ink/55 transition-colors hover:text-ink">
                        {t('Open the manager desk')} →
                      </Link>
                    }
                  />
                  {view === 'list' ? (
                    <ul className="space-y-1.5">
                      {managerRows.map((w, wIdx) => (
                        <WalletListRow
                          key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`}
                          rowIndex={wIdx}
                          wallet={w}
                          manager
                          usd={usdByAddress.get(addressKey(w.address))}
                          absorbedPa={absorbedPaByOwner.get(foldKey(w.address))}
                          busy={actionBusy}
                          council={false}
                          quorumFacts={quorumFactsByKey.get(addressKey(w.address))}
                          onMovements={() => setMovementsWallet(w)}
                          onManage={() => setManageWallet(w)}
                          t={t}
                        />
                      ))}
                    </ul>
                  ) : (
                  <WalletCardsGrid>
                    {managerRows.map((w, wIdx) => {
                      const cardKey = `${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`;
                      const openThis = openCards.has(cardKey);
                      return (
                        <motion.div
                          key={cardKey}
                          layout
                          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            layout: { type: 'spring', stiffness: 300, damping: 30 },
                            opacity: { duration: 0.35, delay: Math.min(wIdx * 0.04, 0.3) },
                          }}
                          className={openThis ? 'col-span-full' : ''}
                        >
                          {openThis ? (
                            <WalletCard
                              wallet={w}
                              manager
                              holdings={holdingsByAddress.get(addressKey(w.address))}
                              absorbedPa={absorbedPaByOwner.get(foldKey(w.address))}
                              isActiveConnected={isConnected && connectedAddress?.toLowerCase() === w.address.toLowerCase()}
                              busy={actionBusy}
                              readOnly={false}
                              flareSwitch={flareSwitch}
                              onEnableTx={handleEnableTx}
                              onMovements={setMovementsWallet}
                              onUnmint={setUnmintWallet}
                              onGovernedMovements={undefined}
                              onGovern={undefined}
                              onManage={() => setManageWallet(w)}
                              onCollapse={() => toggleOpenCard(cardKey, false)}
                            />
                          ) : (
                            <CompactWalletCard
                              wallet={w}
                              manager
                              holdings={holdingsByAddress.get(addressKey(w.address))}
                              usd={usdByAddress.get(addressKey(w.address))}
                              absorbedPa={absorbedPaByOwner.get(foldKey(w.address))}
                              quorumFacts={quorumFactsByKey.get(addressKey(w.address))}
                              onOpen={() => toggleOpenCard(cardKey, true)}
                              onMovements={() => setMovementsWallet(w)}
                              onManage={() => setManageWallet(w)}
                              t={t}
                            />
                          )}
                        </motion.div>
                      );
                    })}
                  </WalletCardsGrid>
                  )}
                </div>
              )}
              {councilRows.length > 0 && (
                <div className="shelf-rail" style={{ ['--shelf' as never]: 'hsl(var(--product-legacy) / 0.55)' }}>
                  {/* La banda con degradado (2026-08-24) se retira (12-sep): la
                      misma cabecera en línea que los otros dos estantes. */}
                  <ShelfHead
                    icon={<CouncilSealMark size={22} />}
                    color="hsl(var(--product-legacy))"
                    label={t('Legacy')}
                    count={councilRows.length}
                    purpose={t('Accounts governed by a council: a quorum signs, never a single key.')}
                  />
                  {view === 'list' ? (
                    <ul className="space-y-1.5">
                      {councilRows.map((w, wIdx) => (
                        <WalletListRow
                          key={`${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`}
                          rowIndex={wIdx}
                          wallet={w}
                          usd={usdByAddress.get(addressKey(w.address))}
                          busy={actionBusy}
                          council
                          onMovements={() => openGovernedMovements(w.address)}
                          onGovern={() => openGovernance(w.address)}
                          onManage={() => setManageWallet(w)}
                          t={t}
                        />
                      ))}
                    </ul>
                  ) : (
                  <WalletCardsGrid>
                    {councilRows.map((w, wIdx) => {
                      const cardKey = `${addressKey(w.address)}:${w.chainId ?? w.ecosystem}`;
                      const openThis = openCards.has(cardKey);
                      return (
                        <motion.div
                          key={cardKey}
                          layout
                          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            layout: { type: 'spring', stiffness: 300, damping: 30 },
                            opacity: { duration: 0.35, delay: Math.min(wIdx * 0.04, 0.3) },
                          }}
                          className={openThis ? 'col-span-full' : ''}
                        >
                          {openThis ? (
                            <WalletCard
                          wallet={w}
                          holdings={holdingsByAddress.get(addressKey(w.address))}
                          absorbedPa={undefined}
                          isActiveConnected={isConnected && connectedAddress?.toLowerCase() === w.address.toLowerCase()}
                          busy={actionBusy}
                          readOnly
                          council
                          councilFacts={councilFactsByKey.get(addressKey(w.address))}
                          flareSwitch={flareSwitch}
                          onEnableTx={handleEnableTx}
                          onMovements={setMovementsWallet}
                          onUnmint={undefined}
                          onGovernedMovements={() => openGovernedMovements(w.address)}
                          onGovern={() => openGovernance(w.address)}
                          onManage={() => setManageWallet(w)}
                              onCollapse={() => toggleOpenCard(cardKey, false)}
                            />
                          ) : (
                            <CompactWalletCard
                              wallet={w}
                              holdings={holdingsByAddress.get(addressKey(w.address))}
                              usd={usdByAddress.get(addressKey(w.address))}
                              absorbedPa={
                                // La pata de Flare del consejo — plegada como
                                // fila, copiable desde el dorso (fundador
                                // 2026-08-29: «la wallet de legacy también
                                // tiene smart account»).
                                smartAccounts[w.address]
                                  ? { address: smartAccounts[w.address] }
                                  : undefined
                              }
                              council
                              councilFacts={councilFactsByKey.get(addressKey(w.address))}
                              onOpen={() => toggleOpenCard(cardKey, true)}
                              onMovements={() => openGovernedMovements(w.address)}
                              onGovern={() => openGovernance(w.address)}
                              onManage={() => setManageWallet(w)}
                              t={t}
                            />
                          )}
                        </motion.div>
                      );
                    })}
                  </WalletCardsGrid>
                  )}
                </div>
              )}
            </div>
          )}

          {linking.error && (
            <p className="mt-3 text-xs text-tone-danger">{linking.error}</p>
          )}

          {/* The «Constitute a Legacy» door — below what exists, before the
              address book (first what you have, then what you can create). */}
          {variant === 'page' && constituteDoor && (
            <div
              className="mt-6 rounded-2xl border border-dashed p-5 text-center"
              style={{ borderColor: 'hsl(var(--product-legacy) / 0.3)' }}
            >
              <h3 className="text-sm font-semibold text-ink">{t('Constitute a Legacy')}</h3>
              <p className="mx-auto mt-1.5 max-w-xl text-[12px] leading-relaxed text-ink/45">
                {t('A Legacy is one of your accounts held by a council: a quorum signs, not a single key. It appears in this same list, and you govern it from its own card.')}
              </p>
              <button
                type="button"
                onClick={openConstituteOperation}
                className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/40"
                style={{
                  borderColor: 'hsl(var(--product-legacy) / 0.4)',
                  background: 'hsl(var(--product-legacy) / 0.07)',
                  color: 'hsl(var(--product-legacy))',
                }}
              >
                <Landmark className="h-3.5 w-3.5" /> {t('Constitute a Legacy')}
              </button>
            </div>
          )}

          {/* Saved addresses — one-tap destinations for the Send flow.
              Personal-only: the address book is the user's, not a Legacy's. */}
          {variant === 'page' && <AddressBookPanel />}
        </div>
      )}


      {/* Constituir — la ceremonia como operación: ventana corta o panel
          anclado a la derecha, con el dashboard vivo debajo. */}
      {/* ConstituteOperation vive en EarnOperationHost (AppShell) — montarla
          aquí era lo que la mataba al navegar. */}

      {/* Movimientos de una cuenta gobernada, EN SITIO (fundador 2026-08-30):
          el modal abre sobre esta misma pantalla — nada de cargar Legacy.
          «Firma en la bandeja» abre la operación de gobierno directamente en
          Propuestas, también sin navegar. */}
      {governedMovementsFor && (
        <GovernedMovementsModal
          account={governedMovementsFor}
          onClose={() => setGovernedMovementsFor(null)}
          onGoToProposals={() => {
            const a = governedMovementsFor;
            setGovernedMovementsFor(null);
            openGovernOp(a, getLegacyNickname(a), 'proposals');
          }}
        />
      )}

      {/* Manage — floating above the grid; a dialog cannot stretch a row. */}
      {manageWallet && (
        <ManageWalletModal
          key={manageWallet.id}
          wallet={wallets.find((x) => x.id === manageWallet.id) ?? manageWallet}
          council={councilKeySet.has(addressKey(manageWallet.address))}
          busy={actionBusy}
          onClose={() => setManageWallet(null)}
          onRename={handleRename}
          onSetColor={handleSetColor}
          onSetPrimary={handleSetPrimary}
          onDisableTx={handleDisableTx}
          onRemove={handleRemove}
          onToggleInclude={handleToggleInclude}
          onRenameLegacy={handleRenameLegacy}
          onReinforce={isXrplWallet(manageWallet) ? () => openReinforce(manageWallet.address) : undefined}
          onGovernance={isXrplWallet(manageWallet) ? () => openPersonalGovernance(manageWallet.address) : undefined}
        />
      )}

      {variant === 'page' && showAdd && (
        <AddWalletModal
          onConnect={linking.connectMetaMaskFlare}
          onConnectXrpl={universal.connectXrpl}
          onWatchAddress={(addr) => linking.watchAddress(addr, 14)}
          onNoWallet={() => { setShowAdd(false); setShowGuide(true); }}
          wallets={allLinkedWallets}
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
      {unmintWallet && (
        <WalletSendModal
          wallet={unmintWallet}
          wallets={allLinkedWallets}
          unmint
          initial={{ asset: 'FXRP' }}
          onClose={() => setUnmintWallet(null)}
        />
      )}
      {movementsWallet && (
        <MovementsModal wallet={movementsWallet} onClose={() => setMovementsWallet(null)} />
      )}

      {/* Create wallet (Turnkey embedded) — DISABLED for the hackathon demo,
          front (no button/panel) and back (EMBEDDED_WALLET_ENABLED=false).
          Component preserved intact at components/wallet/EmbeddedWalletCreatePanel. */}
    </div>
  );
}

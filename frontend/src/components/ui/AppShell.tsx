'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard,
  Wallet,
  Wallet2,
  Layers,
  Settings as SettingsIcon,
  Search,
  LogOut,
  MessageCircleQuestion,
  Menu,
  X,
  Clock,
  Sprout,
  Target,
  // PiggyBank left the nav with the Savings entry (Savings lives inside Earn now).
  Landmark,
  ShieldCheck,
  LucideIcon,
} from 'lucide-react';
import BackgroundFx from './BackgroundFx';
// AIChatSidebar (floating "AI Copilot") removed from the shell: the /ai/chat
// backend it talks to is not live, and a dead button erodes trust. The
// component is preserved at components/ui/AIChatSidebar.tsx — re-mount it here
// when the endpoint ships. The working in-app guide is ProductAssistant,
// opened from the sidebar's guide button below (no floating trigger).
import { openProductAssistant } from '../assistant/ProductAssistant';
import OnboardingModal from '../onboarding/OnboardingModal';
// AuthoritySwitcher (the "Overview / per-account" selector) is UNMOUNTED
// (founder 2026-07-18): the sidebar slot now holds only the product toggle.
// Component preserved at components/authority/AuthoritySwitcher.tsx.
import ProductToggle from '../authority/ProductToggle';
// GoverningBar is UNMOUNTED (founder 2026-07-18): the data-authority palette
// already tells governed mode apart; the strip duplicated it. Component
// preserved at components/authority/GoverningBar.tsx.
import AuthorityCrossing, { type AuthorityCrossingDirection } from '../authority/AuthorityCrossing';
import { useAuthorities } from '../../hooks/useAuthorities';
import { useAuthStore } from '../../stores/authStore';
import { useT } from '../../i18n/LanguageProvider';
import { useIntentWatcher } from '../../hooks/useIntentWatcher';
import { useVaultClaimsWatcher } from '../../hooks/useVaultClaimsWatcher';
import { usePortfolioAutoRefresh } from '../../hooks/useAggregatedPortfolio';
import { SidebarIntentsCard } from '../intents/SidebarIntents';
import { ResumedSettlements } from '../settlement/ResumedSettlements';
import type { VaultClaimEntry } from '../../hooks/useVaultClaimsWatcher';
import type { PreparedIntent } from '../../services/v1Api';
// AuthorityContextBar stays UNMOUNTED: per-account switching returned to the
// shell as AuthoritySwitcher + GoverningBar (ADR-011) — exactly the re-mount
// case its 2026-07-17 note anticipated. The component is preserved at
// components/authority/AuthorityContextBar.tsx (now an adapter consumer).

const BRAND_LOGO = '/astryum-asteroid.png'; // asteroid + wordmark — same lockup as the landing

function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useT();
  return (
    <div className={`flex items-center rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5 text-[11px] font-medium ${className}`}>
      {(['es', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`flex-1 px-2 py-1 rounded-md uppercase transition-colors ${
            lang === l ? 'bg-volt text-volt-ink' : 'text-ink/45 hover:text-ink/80'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ─── Navigation model ───────────────────────────────────────────────────────
// MVP IA: a single flat list, everything visible — no collapsible groups, no
// drill-in panes. The product surfaces few destinations, so the cheapest, clearest
// thing is to show them all at once. Settings is pinned separately at the very
// bottom (above the account card). When the product grows, reintroduce grouping.
//
// Naming: the holdings overview is "Portfolio" (was "Wallet"); "Wallets" is the
// connected-wallets manager. Two different things, two clearly different names.

type NavLeaf = { href: string; label: string; icon: LucideIcon };

// Savings is no longer a top-level destination: it lives inside Earn as the
// Movements door — send/receive + savings (/app/asset-production?view=movements;
// the old /app/savings route redirects).
// Intents is no longer a nav row: it lives as an always-on card pinned to the
// bottom of the sidebar (SidebarIntentsCard) so anything waiting for the user's
// signature is in view from every page. The /app/intents page is kept and still
// reachable by URL (e.g. from a browser notification).
// The Legacy and Wallets rows swap with the PRODUCT mode (founder 2026-07-17):
// Astryum mode shows Wallets and hides Legacy; Legacy mode shows Legacy and
// hides Wallets. Same dashboard, two products — the nav declares which one.
// Earn stays in BOTH modes (founder 2026-07-18: never strip it from the
// Legacy menu). Estrategias also serves both modes — it just moved INSIDE
// Earn (?view=strategies), so it no longer needs its own row (see below).
const PRIMARY_NAV: NavLeaf[] = [
  { href: '/app', label: 'Summary', icon: LayoutDashboard },
  { href: '/app/asset-production', label: 'Earn', icon: Sprout },
  // Estrategias left the nav (founder 2026-07-18): the registry lives INSIDE
  // Earn now (?view=strategies door). The /app/strategies route stays alive
  // for old deep-links.
  // Portfolio sits ABOVE Legacy (founder 2026-07-19): in Legacy mode the menu
  // reads Summary · Earn · Portfolio · Legacy. Astryum mode filters Legacy out,
  // so its order (Summary · Earn · Portfolio · Wallets) is unchanged.
  { href: '/app/portfolio', label: 'Portfolio', icon: Wallet },
  { href: '/app/legacy', label: 'Legacy', icon: Landmark },
  { href: '/app/wallets', label: 'Wallets', icon: Wallet2 },
];

function navForProduct(mode: 'astryum' | 'legacy'): NavLeaf[] {
  return PRIMARY_NAV.filter((n) =>
    mode === 'legacy' ? n.href !== '/app/wallets' : n.href !== '/app/legacy',
  );
}

const SETTINGS_NAV: NavLeaf = { href: '/app/settings', label: 'Settings', icon: SettingsIcon };
// Spatial OS (/os) toggle disabled for now — route/components left intact, just no UI entry point.

// Founders-only row (2026-07-25): shown ONLY when /auth/me says isAdmin
// (ADMIN_EMAILS allowlist) — everyone else keeps the panel invisible, same as
// before. Present in BOTH product modes: the founders are admins whichever
// hat they wear. Server-side gates stay untouched; this is pure discovery.
const ADMIN_NAV: NavLeaf = { href: '/app/admin', label: 'Admin', icon: ShieldCheck };

// Positions and Activity are Portfolio TABS (nav collapse + source
// unification) and stay OUT of ⌘K too (founder 2026-07-19): hidden screens
// must not resurface through search suggestions. They remain reachable inside
// Portfolio itself; Capital Map likewise only via ?tab=map.

// Every searchable destination for ⌘K — computed per product mode so the
// hidden tab (Wallets or Legacy) doesn't surface through search either.
// Admin joins the pool only for founder accounts — for anyone else it must
// not resurface through search (same rule as the hidden Portfolio tabs).
type Destination = NavLeaf & { groupLabel: string };
function destinationsForProduct(mode: 'astryum' | 'legacy', isAdmin: boolean): Destination[] {
  return [...navForProduct(mode), SETTINGS_NAV, ...(isAdmin ? [ADMIN_NAV] : [])].map((n) => ({
    ...n,
    groupLabel: 'Menu',
  }));
}

const isActive = (pathname: string, href: string) =>
  pathname === href || (href !== '/app' && pathname.startsWith(href + '/'));

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Mounted ONCE for the whole shell (F3-entrega) — every page shares one
  // 60s poller. `intentsWaiting` feeds the mobile burger's alert dot; the full
  // `waiting` list + `refresh` feed the always-on sidebar Intents card.
  const { waitingCount: intentsWaiting, waiting: waitingIntents, refresh: refreshIntents } = useIntentWatcher();

  // Money in flight (F-entrega 2026-07-19): vault exits queued in a withdrawal
  // period (Firelight ~24h) that the redeem left in transit. Authority-scoped,
  // so the Intents card tells Personal and Legacy each its own truth. Feeds
  // the same card — one surface for "what needs me + what's on its way".
  const { entries: vaultClaims, claimableCount: claimsWaiting, refresh: refreshClaims } = useVaultClaimsWatcher();

  // Mounted ONCE for the whole shell: one shared poller keeps the portfolio
  // cache warm so every page paints instantly and refreshes invisibly.
  usePortfolioAutoRefresh();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // ONE source of truth: the authority switcher (useAuthorities). The active
  // authority drives the shell's atmosphere (data-authority swaps the CSS
  // palette — --volt flips in globals.css) AND the product-mode nav swap
  // (founder 2026-07-17): governed mode shows Legacy and hides Wallets.
  // The Summary toggle (ProductModeCard) and the sidebar switcher both write
  // this same state — they can never disagree.
  const { activeGoverned, loading: authoritiesLoading } = useAuthorities();
  const productMode: 'astryum' | 'legacy' = activeGoverned ? 'legacy' : 'astryum';
  // Founder flag from /auth/me (refreshMe hydrates it on every mount) — adds
  // the Admin row at the end of the menu, in both product modes.
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const nav = useMemo(
    () => (isAdmin ? [...navForProduct(productMode), ADMIN_NAV] : navForProduct(productMode)),
    [productMode, isAdmin],
  );
  const destinations = useMemo(() => destinationsForProduct(productMode, isAdmin), [productMode, isAdmin]);

  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Authority crossing: a ~1.5s transition (AuthorityCrossing) every time the
  // active authority moves into, out of, or between governed accounts — in
  // BOTH directions (founder ask, superseding the old one-way half-second
  // crossingSeal stamp). Skipped on the initial render (reloading while
  // already governed/personal is not a crossing) — same prevGovernedId
  // sentinel as before.
  const [crossing, setCrossing] = useState<{
    direction: AuthorityCrossingDirection;
    label?: string;
    quorum?: string;
    quorumMet?: number;
    members?: number;
    key: string;
  } | null>(null);
  const prevGovernedId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = activeGoverned?.id ?? null;
    // Data refreshes are not crossings: while authorities are (re)loading, an
    // id transition is plumbing, not a user stepping between products — track
    // it silently so no spurious crossing fires (bug 2026-07-21).
    if (authoritiesLoading) {
      prevGovernedId.current = id;
      return;
    }
    if (prevGovernedId.current !== undefined && prevGovernedId.current !== id) {
      if (id) {
        // null→id or id→otherId: entering a (new) governed chamber.
        setCrossing({
          direction: 'to-legacy',
          label: activeGoverned?.label || activeGoverned?.address.slice(0, 10),
          quorum:
            typeof activeGoverned?.quorum === 'number' && typeof activeGoverned?.memberCount === 'number'
              ? `${activeGoverned.quorum}/${activeGoverned.memberCount}`
              : undefined,
          // Numeric twin of the caption — the constellation ignites one star
          // per signer, lit up to the real quorum (the old seal engraved a
          // hardcoded 3-of-5 whatever the council actually was).
          quorumMet: typeof activeGoverned?.quorum === 'number' ? activeGoverned.quorum : undefined,
          members: typeof activeGoverned?.memberCount === 'number' ? activeGoverned.memberCount : undefined,
          key: `to-legacy:${id}:${Date.now()}`,
        });
      } else {
        // id→null: leaving governed mode, back to personal.
        setCrossing({ direction: 'to-personal', key: `to-personal:${Date.now()}` });
      }
    }
    prevGovernedId.current = id;
    // Keyed only on the id transition (matches the previous crossingSeal
    // behaviour): label/quorum/address are read from the activeGoverned
    // closure at the moment id changes, not tracked as separate triggers — a
    // ledger read completing after the id settles must not replay the
    // crossing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoverned?.id]);

  return (
    <div
      data-authority={activeGoverned ? 'governed' : 'single'}
      className="relative min-h-screen bg-[var(--shell-bg)] text-ink overflow-x-hidden transition-colors duration-700"
    >
      <BackgroundFx />

      <div className="relative z-10">
        <Sidebar
          pathname={pathname}
          nav={nav}
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onOpenPalette={() => setPaletteOpen(true)}
          waitingIntents={waitingIntents}
          refreshIntents={refreshIntents}
          vaultClaims={vaultClaims}
          refreshClaims={refreshClaims}
        />

        {/* Slim mobile-only bar — the desktop header is gone for an immersive shell. */}
        <MobileBar
          onMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          intentsWaiting={intentsWaiting + claimsWaiting}
        />

        <div className="lg:ml-64">
          {/* GoverningBar UNMOUNTED (founder 2026-07-18): the dashboard color
              (data-authority palette) already declares governed mode — the
              strip was redundant. Preserved at components/authority/GoverningBar.tsx. */}
          {/* Route-keyed crossfade — the per-page RevealGroups carry the rise,
              so the shell only fades to avoid double movement. */}
          <motion.main
            key={pathname}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="px-4 md:px-8 py-8 max-w-7xl mx-auto"
          >
            {children}
          </motion.main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} destinations={destinations} />
      <OnboardingModal />
      {/* Settlements signed before a reload — resumed from localStorage and
          watched to the same machine-gated green/red as the modals (R1). */}
      <ResumedSettlements />

      <AnimatePresence>
        {crossing && (
          <AuthorityCrossing
            key={crossing.key}
            direction={crossing.direction}
            label={crossing.label}
            quorum={crossing.quorum}
            quorumMet={crossing.quorumMet}
            members={crossing.members}
            onDone={() => setCrossing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MobileBar({
  onMenu,
  onOpenPalette,
  intentsWaiting,
}: {
  onMenu: () => void;
  onOpenPalette: () => void;
  /** Intents waiting for the user's signature — the sidebar badge is hidden behind this button on mobile, so the burger carries the red dot. */
  intentsWaiting: number;
}) {
  return (
    <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-[var(--shell-panel)] backdrop-blur-xl border-b border-ink/[0.05] transition-colors duration-700">
      <button onClick={onMenu} className="relative text-ink/70 hover:text-ink" aria-label="Open menu">
        <Menu className="w-5 h-5" />
        {intentsWaiting > 0 ? (
          <span className="absolute -top-1 -right-1 flex w-2.5 h-2.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500/70 animate-ping" />
            <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-red-500" />
          </span>
        ) : null}
      </button>
      <Link href="/app" className="flex items-center" aria-label="Astryum">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={BRAND_LOGO} alt="Astryum" className="h-7 w-auto object-contain" />
      </Link>
      <button onClick={onOpenPalette} className="text-ink/70 hover:text-ink" aria-label="Search">
        <Search className="w-5 h-5" />
      </button>
    </header>
  );
}

function Sidebar({
  pathname,
  nav,
  mobileOpen,
  onClose,
  onOpenPalette,
  waitingIntents,
  refreshIntents,
  vaultClaims,
  refreshClaims,
}: {
  pathname: string;
  /** Primary rows for the CURRENT product mode (Wallets↔Legacy swap). */
  nav: NavLeaf[];
  mobileOpen: boolean;
  onClose: () => void;
  onOpenPalette: () => void;
  /** Intents waiting for the user's signature (F3-entrega) — feed the always-on card at the bottom of the sidebar. */
  waitingIntents: PreparedIntent[];
  refreshIntents: () => void;
  /** Money in flight — queued vault exits of the active authority. */
  vaultClaims: VaultClaimEntry[];
  refreshClaims: () => void;
}) {
  const { t } = useT();

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={onClose} />
      ) : null}
      <aside
        className={`fixed top-0 left-0 z-50 h-screen w-64 flex flex-col border-r border-ink/[0.06] bg-[var(--shell-panel)] backdrop-blur-xl transform transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* soft seam down the right edge — gold in the warm shell, steel/indigo
            when operating a governed account (data-authority theme). */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--shell-seam), transparent)' }}
          aria-hidden
        />

        {/* ONE brand card: the Astryum lockup with the product toggle inside
            (founder 2026-07-18) — it reads as "Astryum Personal" / "Astryum
            Legacy", the brand naming both products. Took the slot of the old
            Overview switcher (AuthoritySwitcher, preserved); the dashboard's
            color says the rest. */}
        <div className="relative px-3 pt-4 pb-3">
          <div className="rounded-2xl border border-ink/[0.07] bg-ink/[0.03] p-3">
            <Link href="/app" className="block group" aria-label="Astryum">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={BRAND_LOGO}
                alt="Astryum"
                className="w-full h-auto max-h-16 object-contain transition-transform group-hover:scale-[1.02]"
              />
            </Link>
            {/* data-tour anchor: the tour's "who am I operating as" step now
                points at the product toggle (the switcher slot it replaced). */}
            <div className="mt-2.5" data-tour="switcher">
              <ProductToggle />
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden absolute top-3 right-2 text-ink/60 hover:text-ink"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* search */}
        <div className="px-3 pb-3">
          <button
            onClick={onOpenPalette}
            className="flex items-center gap-2.5 w-full rounded-lg border border-ink/[0.06] bg-ink/[0.03] text-ink/45 hover:text-ink/80 hover:border-ink/15 transition-colors px-3 py-2"
            aria-label="Search and jump to anywhere"
          >
            <Search className="w-4 h-4 shrink-0" strokeWidth={2} />
            <span className="flex-1 text-left text-sm">{t('Search…')}</span>
            <kbd className="text-[10px] font-mono border border-ink/10 rounded px-1 py-0.5 text-ink/35">⌘K</kbd>
          </button>
        </div>

        {/* primary nav — flat, everything visible. The Intents card lives at
            the END of the menu (founder 2026-07-19): below the last nav row,
            integrated inside the scrolling menu, the big card that shows what
            needs a signature AND the money in flight (queued vault exits)
            directly — no navigation to find it. */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
          <ul className="space-y-0.5">
            {nav.map((n) => (
              <NavRow key={n.href} item={n} active={isActive(pathname, n.href)} onClick={onClose} />
            ))}
          </ul>

          <div className="mt-3 pt-3 border-t border-ink/[0.06]">
            <SidebarIntentsCard
              waiting={waitingIntents}
              refresh={refreshIntents}
              claims={vaultClaims}
              refreshClaims={refreshClaims}
              onBeforeOpen={onClose}
            />
          </div>
        </nav>

        {/* pinned footer: co-pilot · language · settings · account */}
        <div className="px-3 pt-3 pb-3 space-y-2 border-t border-ink/[0.06]">
          {/* The Co-pilot — the crew member who explains the ship. Gold-filled
              so it reads as THE helper, not one more nav row. */}
          <button
            data-tour="copilot"
            onClick={() => {
              onClose();
              openProductAssistant();
            }}
            className="group relative flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-xl text-sm font-semibold text-volt-ink bg-volt hover:brightness-105 transition-all shadow-[0_6px_22px_-6px_hsl(var(--volt)/0.55)]"
          >
            <MessageCircleQuestion className="w-[18px] h-[18px] shrink-0 transition-transform duration-300 group-hover:-rotate-12" strokeWidth={1.8} />
            <span className="flex-1 text-left leading-none">
              {t('Co-pilot')}
              <span className="block text-[10px] font-normal text-volt-ink/60 mt-1">{t('How does this work?')}</span>
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-volt-ink/35 group-hover:bg-volt-ink/60 transition-colors" aria-hidden />
          </button>
          <LangToggle />
          <ul>
            <NavRow item={SETTINGS_NAV} active={isActive(pathname, SETTINGS_NAV.href)} onClick={onClose} />
          </ul>
          <AccountCard />
        </div>
      </aside>
    </>
  );
}

function NavRow({
  item,
  active,
  onClick,
  badge,
}: {
  item: NavLeaf;
  active: boolean;
  onClick?: () => void;
  /** Small waiting-count badge (F3-entrega) — only the "Intents" row passes this today. Omitted/0 renders nothing. */
  badge?: number;
}) {
  const { t } = useT();
  const Icon = item.icon;
  return (
    <li className="relative">
      <Link
        href={item.href}
        onClick={onClick}
        data-tour={`nav-${item.href === '/app' ? 'summary' : item.href.split('/').pop()}`}
        aria-current={active ? 'page' : undefined}
        className={`group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${
          active ? 'bg-volt/[0.10] text-ink' : 'text-ink/60 hover:text-ink hover:bg-ink/[0.04]'
        }`}
      >
        {/* active left rail */}
        {active ? (
          <motion.span
            layoutId="nav-active-rail"
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-volt"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        ) : null}
        <Icon
          className={`w-[18px] h-[18px] shrink-0 transition-transform duration-200 ${
            active ? 'text-volt' : 'text-ink/45 group-hover:text-ink/70 group-hover:translate-x-0.5'
          }`}
          strokeWidth={1.6}
        />
        <span className="flex-1 transition-transform duration-200 group-hover:translate-x-0.5">{t(item.label)}</span>
        {badge ? (
          <span
            className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none shadow-[0_0_10px_rgba(239,68,68,0.45)]"
            title={t('Waiting for your signature')}
          >
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function AccountCard() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const address = user?.address;
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'dev';
  const isDev = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
  const name = user?.username?.trim() || short;
  const initials = (user?.username?.trim() || short).slice(0, 2).toUpperCase();

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-ink/[0.07] bg-ink/[0.03] p-2.5">
      <Link
        href="/app/settings"
        className="shrink-0"
        aria-label="Account settings"
        title="Account settings"
      >
        {user?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatar} alt="" className="w-9 h-9 rounded-full object-cover ring-1 ring-ink/10" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-volt to-[hsl(var(--volt-deep))] text-volt-ink flex items-center justify-center text-xs font-bold ring-1 ring-ink/10">

            {initials}
          </div>
        )}
      </Link>
      <Link href="/app/settings" className="flex-1 min-w-0 group">
        <div className="text-sm font-medium text-ink/90 truncate group-hover:text-ink">{name}</div>
        <div className="text-[11px] text-ink/40 truncate">
          {user?.username && address ? short : isDev ? 'Dev session' : 'Connected'}
        </div>
      </Link>
      <button
        onClick={() => {
          logout();
          router.replace('/login');
        }}
        className="shrink-0 text-ink/40 hover:text-ink/80 transition-colors p-1"
        aria-label="Logout"
        title="Logout"
      >
        <LogOut className="w-4 h-4" strokeWidth={1.6} />
      </button>
    </div>
  );
}

// ─── Command palette (⌘K) ──────────────────────────────────────────────────────

function CommandPalette({
  open,
  onClose,
  destinations,
}: {
  open: boolean;
  onClose: () => void;
  /** Searchable destinations for the CURRENT product mode. */
  destinations: Destination[];
}) {
  const router = useRouter();
  const { t: tr } = useT();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return destinations;
    return destinations.filter((n) =>
      [n.label, tr(n.label), String(n.groupLabel), tr(String(n.groupLabel))].some((s) =>
        s.toLowerCase().includes(query),
      ),
    );
  }, [q, tr, destinations]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[active];
      if (r) go(r.href);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-2xl border border-ink/10 bg-surface-1 overflow-hidden"
            style={{ boxShadow: '0 30px 90px rgba(0,0,0,0.6)' }}
          >
            <div className="flex items-center gap-3 px-4 border-b border-ink/[0.05]">
              <Search className="w-4 h-4 text-ink/40 shrink-0" strokeWidth={2} />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={tr('Search destinations…')}
                className="flex-1 bg-transparent py-3.5 text-sm text-ink placeholder-ink/30 focus:outline-none"
              />
              <kbd className="text-[10px] font-mono text-ink/30 border border-ink/10 rounded px-1.5 py-0.5">ESC</kbd>
            </div>
            <ul className="max-h-[52vh] overflow-y-auto p-2 scrollbar-thin">
              {results.length === 0 ? (
                <li className="px-3 py-8 text-center text-sm text-ink/35">{tr('No matches')}</li>
              ) : (
                results.map((r, i) => {
                  const Icon = r.icon;
                  const on = i === active;
                  return (
                    <li key={r.href}>
                      <button
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(r.href)}
                        className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left transition-colors ${
                          on ? 'bg-volt/[0.12] text-ink' : 'text-ink/70 hover:bg-ink/5'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${on ? 'text-volt' : 'text-ink/45'}`} strokeWidth={1.5} />
                        <span className="flex-1 text-sm">{tr(r.label)}</span>
                        <span className="text-[10px] uppercase tracking-widest text-ink/30">{tr(String(r.groupLabel))}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

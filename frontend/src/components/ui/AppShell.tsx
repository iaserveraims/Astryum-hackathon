'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Wallet,
  PieChart,
  Gauge,
  Layers,
  Settings as SettingsIcon,
  Search,
  LogOut,
  MessageCircleQuestion,
  Menu,
  X,
  Clock,
  Sprout,
  Orbit,
  Target,
  // PiggyBank left the nav with the Savings entry (Savings lives inside Earn now).
  ShieldCheck,
  ArrowUpRight,
  Loader2,
  LucideIcon,
  PanelLeftOpen,
  PanelLeftClose,
  Briefcase,
  Building2,
  Landmark,
  Sparkles,
} from 'lucide-react';
import { MANAGER_DESK_OPEN } from '../../lib/nav/managerDesk';
import { HACKATHON_HUB_OPEN } from '../../lib/nav/hackathonHub';
import BackgroundFx from './BackgroundFx';
// AIChatSidebar (floating "AI Copilot") removed from the shell: the /ai/chat
// backend it talks to is not live, and a dead button erodes trust. The
// component is preserved at components/ui/AIChatSidebar.tsx — re-mount it here
// when the endpoint ships. The working in-app guide is ProductAssistant,
// opened from the sidebar's guide button below (no floating trigger).
import { openProductAssistant } from '../assistant/ProductAssistant';
import OnboardingModal from '../onboarding/OnboardingModal';
// AuthoritySwitcher (the "Overview / per-account" selector) is UNMOUNTED:
// the sidebar slot now holds only the product toggle.
// Component preserved at components/authority/AuthoritySwitcher.tsx.
// ProductToggle UNMOUNTED (theme follows the Home hub selection);
// component preserved at components/authority/ProductToggle.tsx. Its
// access walk-back effect survives as LegacyAccessGuard below.
import LegacyAccessGuard from '../authority/LegacyAccessGuard';
import EarnOperationHost from '../earn/EarnOperationHost';
// THE name of the capital-at-work destination lives in ONE file so the
// rename is one edit (it is still provisional — see lib/nav/capitalSection.ts).
import { CAPITAL_SECTION_HREF, CAPITAL_SECTION_LABEL } from '../../lib/nav/capitalSection';
// GoverningBar is UNMOUNTED: the data-authority palette
// already tells governed mode apart; the strip duplicated it. Component
// preserved at components/authority/GoverningBar.tsx.
import AuthorityCrossing, { type AuthorityCrossingDirection } from '../authority/AuthorityCrossing';
import { useAuthorities } from '../../hooks/useAuthorities';
import { useAuthorityStore } from '../../stores/authorityStore';
import { OVERVIEW_AUTHORITY_ID } from '../../lib/authority';
import { useAuthStore } from '../../stores/authStore';
import { useT } from '../../i18n/LanguageProvider';
import { useIntentWatcher } from '../../hooks/useIntentWatcher';
import { useDockStore } from '../../stores/dockStore';
import { useOperationStore } from '../../stores/operationStore';
import { useVaultClaimsWatcher } from '../../hooks/useVaultClaimsWatcher';
import { useMyManagedTickets, type ManagedTicket } from '../../lib/institutional/useMyManagedPositions';
import { usePortfolioAutoRefresh } from '../../hooks/useAggregatedPortfolio';
import { SidebarIntentsCard } from '../intents/SidebarIntents';
import { SidebarSettlements } from '../settlement/SidebarSettlements';
import { useResumePendingSettlements } from '../../lib/settlement/useResumePendingSettlements';
import type { VaultClaimEntry, VaultClaimsUnreadable } from '../../hooks/useVaultClaimsWatcher';
import type { PreparedIntent } from '../../services/v1Api';
// AuthorityContextBar stays UNMOUNTED: per-account switching returned to the
// shell as AuthoritySwitcher + GoverningBar (ADR-011) — exactly the re-mount
// case its note anticipated. The component is preserved at
// components/authority/AuthorityContextBar.tsx (now an adapter consumer).

const BRAND_LOGO = '/astryum-asteroid.png'; // asteroid + wordmark — same lockup as the landing
// The blue twin: identical lockup with the asteroid in
// the Legacy indigo — the brand dresses for the product it is naming.
const BRAND_LOGO_LEGACY = '/astryum-logo-azul-transparente.png';

// Our community server: where users report bugs and send feedback, and where we
// tell them what changed. Pinned next to Settings so it is reachable from every
// screen.
const DISCORD_INVITE = 'https://discord.gg/veXZr7a3hJ';

// lucide dropped brand marks, so the Discord logo travels inline (simple-icons path).
function DiscordIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden focusable="false">
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  );
}

// (LangToggle left the sidebar — the language switch now lives
// in Settings › Preferences, next to the theme.)

// ─── Navigation model ───────────────────────────────────────────────────────
// MVP IA: a single flat list, everything visible — no collapsible groups, no
// drill-in panes. The product surfaces few destinations, so the cheapest, clearest
// thing is to show them all at once. Settings is pinned separately at the very
// bottom (above the account card). When the product grows, reintroduce grouping.
//
// Naming: the holdings overview is "Portfolio" (was "Wallet"); "Wallets" is the
// connected-wallets manager. Two different things, two clearly different names.

type NavLeaf = {
  href: string;
  /** English label — also the dict.ts key for every row that has one. */
  label: string;
  /**
   * Spanish label carried INLINE, used only by the capital-at-work row.
   *
   * Every other row translates through `t(label)` against dict.ts, which is
   * right for a fixed string. That row's name is still being chosen, so it
   * reads from `lib/nav/capitalSection.ts` — and a dynamic `t(LABEL)` is
   * invisible to `scripts/check-i18n.js`, which only scans literal arguments.
   * CI would stay green while a Spanish user saw an English menu. Carrying the
   * pair keeps the rename atomic and the check honest.
   */
  labelEs?: string;
  icon: LucideIcon;
};

/** The row's visible name: the inline Spanish when there is one, else dict. */
function leafLabel(item: NavLeaf, lang: string, t: (s: string) => string): string {
  return lang === 'es' && item.labelEs ? item.labelEs : t(item.label);
}

// Savings is no longer a top-level destination: it lives inside Earn as the
// Movements door — send/receive + savings (/app/asset-production?view=movements;
// the old /app/savings route redirects).
// Intents is no longer a nav row: it lives as an always-on card pinned to the
// bottom of the sidebar (SidebarIntentsCard) so anything waiting for the user's
// signature is in view from every page. The /app/intents page is kept and still
// reachable by URL (e.g. from a browser notification).
// The Legacy and Wallets rows swap with the PRODUCT mode:
// Astryum mode shows Wallets and hides Legacy; Legacy mode shows Legacy and
// hides Wallets. Same dashboard, two products — the nav declares which one.
// Earn stays in BOTH modes. Estrategias also serves both modes — it lived INSIDE Earn
// (?view=strategies) from until, when it got its row
// back as the capital-at-work section (see PRIMARY_NAV below). The old
// ?view=strategies deep-link now redirects to /app/strategies.
// Order: the reading order —
// how much (Summary), where (Portfolio) — then Earn: it is THE function of
// the product ("lo que nos da de comer a nosotros y a nuestros usuarios"),
// so it sits above Wallets/Legacy. A separate /app/home landing page was
// tried and REMOVED: the Summary already welcomes a
// wallet-less account with its own connect panel — two front doors confused
// more than they calmed.
// Earn's highlight is POSITION ONLY: two colored
// treatments were tried and retired the same day — a soft volt tint (read as
// "selected") and a solid volt button (too loud). Do not re-introduce color
// on a nav row to mark importance; the selected state owns the gold here.
// Portfolio still sits ABOVE Legacy. Estrategias lived
// INSIDE Earn (?view=strategies, founder) and came back OUT as its
// own row — /app/strategies was never retired, which is why the
// return cost almost nothing.
// Naming: HOME is the new hub at /app/home (the fleet: personal
// wallets + Legacies + the add door), and the overview at /app goes back to
// being SUMMARY. The Wallets row is GONE from the nav (W1): its full surface
// lives embedded in Home behind ?panel=wallets, and /app/wallets redirects
// there — every old deep-link keeps working. "Summary" internal ids
// (data-tour nav-summary, TourId, stop-summary anchors) were never renamed.
// The Home hub row LEFT the nav (fusión): the Summary absorbed
// the Home — greeting, fleet scope, the hidden Wallets surface
// (?panel=wallets) and the first-run tour all live at /app now. /app/home
// redirects there; HomeHub stays preserved at components/home/HomeHub.tsx.
// Founder (quinta pasada): el vestíbulo vuelve a llamarse Home, y
// el destino Legacy deja su sitio a WALLETS. Legacy no desaparece: vive DENTRO
// de Wallets, porque una cuenta gobernada por un consejo es una wallet más y
// su gobernanza es algo que se le hace a ELLA, no un apartado paralelo.
// Portfolio suelta el icono de cartera —que es de Wallets— y se queda con el
// del reparto, que es lo que esa pantalla enseña.
// Fundador — se DESHACE el colapso: el registro vuelve a
// tener fila propia. La razón no es de gusto, es de frecuencia. Earn es un
// gesto que haces una vez (decidir); mirar lo que ya corre es un gesto
// semanal. Tenerlo como cuarta puerta DENTRO de Earn ponía a dos clics lo que
// más se repite, detrás de lo que menos. Y una card que solo contiene otras
// cards es un marco sin navegación: cuando una agrupación necesita un
// contenedor visible, la agrupación pertenece al MENÚ, no a una caja.
const PRIMARY_NAV: NavLeaf[] = [
  { href: '/app', label: 'Home', icon: Gauge },
  { href: '/app/portfolio', label: 'Portfolio', icon: PieChart },
  { href: '/app/asset-production', label: 'Earn', icon: Sprout },
  {
    href: CAPITAL_SECTION_HREF,
    label: CAPITAL_SECTION_LABEL.en,
    labelEs: CAPITAL_SECTION_LABEL.es,
    icon: Orbit,
  },
  { href: '/app/wallets', label: 'Wallets', icon: Wallet },
];

// Legacy es un SITIO, no un producto: está siempre en el
// menú. Antes sólo aparecía dentro del modo índigo, así que para llegar a la
// gobernanza había que descubrir primero un interruptor — y ese interruptor
// además te escondía media flota. La puerta de acceso la sigue guardando
// LegacyAccessGuard dentro de la propia pantalla.
function primaryNav(): NavLeaf[] {
  // Con el hub cerrado (producción) Legacy recupera su fila de
  // siempre, detrás de Wallets. Con el hub abierto vive arriba, en el grupo.
  return HACKATHON_HUB_OPEN ? PRIMARY_NAV : [...PRIMARY_NAV, LEGACY_NAV];
}

const SETTINGS_NAV: NavLeaf = { href: '/app/settings', label: 'Settings', icon: SettingsIcon };
// Spatial OS (/os) toggle disabled for now — route/components left intact, just no UI entry point.

// Founders-only row: shown ONLY when /auth/me says isAdmin
// (ADMIN_EMAILS allowlist) — everyone else keeps the panel invisible, same as
// before. Present in BOTH product modes: the founders are admins whichever
// hat they wear. Server-side gates stay untouched; this is pure discovery.
const ADMIN_NAV: NavLeaf = { href: '/app/admin', label: 'Admin', icon: ShieldCheck };

// La mesa del EXCHANGE: la interfaz entera del exchange custodial en un sitio propio.
// PUBLICADA — la
// fila la ve todo el mundo; la página perdió su PreviewOnly y las lecturas
// del backend son públicas (anillo VER). Las mutaciones siguen tras admin
// hasta la CredentialAccessGate.
const EXCHANGE_NAV: NavLeaf = { href: '/app/exchange', label: 'Exchange', icon: Building2 };

// La mesa del gestor de bóvedas dejó de ser fila del menú:
// se abre desde Earn → Managed vaults en ventana anclable
// (ManagerOperation). /app/partner (la auditora) sigue solo por URL.
//
// …Y VUELVE, POR AHORA, ese mismo día: mientras
// MANAGER_DESK_OPEN esté en marcha (lib/nav/managerDesk.ts) la fila se enseña
// a todos y entra en ⌘K. Apagada la variable, se vuelve al párrafo de arriba
// sin tocar código.
const MANAGER_NAV: NavLeaf = { href: '/app/manager', label: 'Manager desk', icon: Briefcase };

// EL HUB DEL HACKATHON: las
// tres puertas de la entrega de XRPL Commons, agrupadas y separadas del resto
// al final del menú, para que un juez las encuentre sin pelearse con la
// página. Descubrimiento, no permiso — cada página conserva su puerta.
// Exchange sigue siendo solo de fundadores (adminOnly) mientras su página vaya
// tras PreviewOnly: una fila pública a una página que no pinta nada sería
// peor que ninguna fila.
const HACKATHON_HUB_LABEL = 'Hackathon exclusives';
type HubLeaf = NavLeaf & { adminOnly?: boolean };
// Legacy NO es una función del hackathon: es un sitio del producto, con su
// propia puerta (LegacyAccessGuard), y vivía en el menú de siempre. Vive en el grupo sólo mientras el grupo existe; cerrado el hub
// vuelve a su fila — sin esta constante compartida, cerrar el grupo se llevaba
// Legacy por delante y dejaba la gobernanza sin puerta en producción.
const LEGACY_NAV: NavLeaf = { href: '/app/legacy', label: 'Legacy', icon: Landmark };
const HACKATHON_NAV: HubLeaf[] = [LEGACY_NAV, MANAGER_NAV, EXCHANGE_NAV];
function hackathonNav(isAdmin: boolean): NavLeaf[] {
  if (!HACKATHON_HUB_OPEN) return [];
  return HACKATHON_NAV.filter((n) => !n.adminOnly || isAdmin).map(({ adminOnly: _a, ...n }) => n);
}

// Positions and Activity are Portfolio TABS (nav collapse + source
// unification) and stay OUT of ⌘K too: hidden screens
// must not resurface through search suggestions. They remain reachable inside
// Portfolio itself; Capital Map likewise only via ?tab=map.

// Every searchable destination for ⌘K. Admin joins the pool only for founder
// accounts — for anyone else it must
// not resurface through search (same rule as the hidden Portfolio tabs).
type Destination = NavLeaf & { groupLabel: string };
function destinationsFor(isAdmin: boolean): Destination[] {
  const hub = hackathonNav(isAdmin);
  return [
    ...[
      ...primaryNav(),
      // Sin el hub, Manager desk vuelve a su fila SÓLO si su propio
      // interruptor lo permite, y Exchange no vuelve: su página contesta
      // notFound() sin NEXT_PUBLIC_INSTITUTIONAL_ENABLED, y una fila que lleva
      // a un 404 es peor que ninguna fila. Antes volvía sin condición.
      ...(hub.length === 0 && MANAGER_DESK_OPEN ? [MANAGER_NAV] : []),
      ...(hub.length === 0 && HACKATHON_HUB_OPEN ? [EXCHANGE_NAV] : []),
      SETTINGS_NAV,
      ...(isAdmin ? [ADMIN_NAV] : []),
    ].map((n) => ({ ...n, groupLabel: 'Menu' })),
    ...hub.map((n) => ({ ...n, groupLabel: HACKATHON_HUB_LABEL })),
  ];
}

const isActive = (pathname: string, href: string) =>
  pathname === href || (href !== '/app' && pathname.startsWith(href + '/'));

export default function AppShell({ children }: { children: ReactNode }) {
  // La operación anclada (dockStore): desliza el contenido y colapsa el sidebar.
  const dockedFlag = useDockStore((st) => st.docked);
  // Multi-op: hay empuje solo si alguna operación está DESPLEGADA (activa).
  // Con todas en píldora el dashboard recupera todo su sitio aunque el modo
  // anclado siga recordado para cuando se restaure una.
  const anyOpActive = useOperationStore((st) => st.activeId !== null);
  const dockWidth = useDockStore((st) => st.width);
  const dockResizing = useDockStore((st) => st.resizing);
  // Minimizada, la operación es una píldora abajo: el dashboard recupera TODO
  // su sitio (sin margen derecho, sidebar completo) — el anclaje solo empuja
  // mientras el panel está de verdad desplegado.
  const docked = dockedFlag && anyOpActive;
  // EL SIDEBAR SE PLIEGA POR DEFECTO CON ALGO ANCLADO, PERO EL USUARIO MANDA.
  // El raíl sigue siendo el
  // defecto; abrirlo es una preferencia recordada (dockStore.sidebarOpen).
  const sidebarOpen = useDockStore((st) => st.sidebarOpen);
  const setSidebarOpen = useDockStore((st) => st.setSidebarOpen);
  const collapsed = docked && !sidebarOpen;
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Mounted ONCE for the whole shell (F3-entrega) — every page shares one
  // 60s poller. `intentsWaiting` feeds the mobile burger's alert dot; the full
  // `waiting` list + `refresh` feed the always-on sidebar Intents card.
  const { waitingCount: intentsWaiting, waiting: waitingIntents, refresh: refreshIntents } = useIntentWatcher();

  // Money in flight (F-entrega): vault exits queued in a withdrawal
  // period (Firelight ~24h) that the redeem left in transit. Authority-scoped,
  // so the Intents card tells Personal and Legacy each its own truth. Feeds
  // the same card — one surface for "what needs me + what's on its way".
  const { entries: vaultClaims, claimableCount: claimsWaiting, refresh: refreshClaims, unreadable: vaultClaimsUnreadable } = useVaultClaimsWatcher();
  // Tickets de salida pendientes de managed vaults (requestRedeem): alimentan
  // «pending to withdraw» en el sidebar, junto a las colas de Earn.
  const { tickets: managedTickets, reload: refreshManagedTickets } = useMyManagedTickets();

  // Mounted ONCE for the whole shell: one shared poller keeps the portfolio
  // cache warm so every page paints instantly and refreshes invisibly.
  usePortfolioAutoRefresh();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // ONE source of truth: the authority switcher (useAuthorities). The active
  // authority drives the shell's atmosphere (data-authority swaps the CSS
  // palette — --volt flips in globals.css) AND the product-mode nav swap:
  // governed mode shows Legacy and hides Wallets.
  // The Summary toggle (ProductModeCard) and the sidebar switcher both write
  // this same state — they can never disagree.
  const { activeGoverned, loading: authoritiesLoading } = useAuthorities();
  // The product is a first-class, persisted choice. Activating/leaving a governed account
  // keeps this in sync via setActiveAuthority; data scope still keys off
  // activeGoverned — the lobby wears the product without claiming an account.
  const productMode = useAuthorityStore((s) => s.productMode);
  const { t } = useT();
  const router = useRouter();
  // EL PRODUCTO SIGUE A LA PANTALLA. Esta es la ÚNICA
  // línea que mueve el modo: dentro de /app/legacy — gobernar, constituir,
  // reforzar, la bandeja del consejo — el shell se viste de índigo y la
  // travesía de abajo se dispara sola; al salir, vuelve. Nadie más lo escribe,
  // así que es imposible quedarse atrapado en un producto que no elegiste.
  //
  // Con esto muere el LOBBY: el modo legacy sólo existe estando EN la pantalla
  // de Legacy, que era justo la ruta que el lobby eximía. Ya no hay estado en
  // el que las páginas compartidas tengan que esconder los datos de nadie.
  const setProductMode = useAuthorityStore((s) => s.setProductMode);
  const activeAuthorityId = useAuthorityStore((s) => s.activeAuthorityId);
  const setActiveAuthorityId = useAuthorityStore((s) => s.setActiveAuthority);
  const onLegacySurface = !!pathname?.startsWith('/app/legacy');
  useEffect(() => {
    setProductMode(onLegacySurface ? 'legacy' : 'astryum');
    // Y al SALIR, la autoridad gobernada se suelta. Sin esto quedaba el peor
    // agujero de todo el modelo viejo: la selección se persiste, el
    // interruptor que la deshacía ya no existe, y `useAuthorityWallets`
    // acotaba TODA la aplicación a esa cuenta — Portfolio y Earn enseñando el
    // dinero de un consejo, sin ninguna puerta visible para volver. Gobernar
    // es algo que se hace ESTANDO en la pantalla de Legacy; fuera de ella el
    // alcance es siempre la flota entera, que ahora ya la incluye.
    if (!onLegacySurface && activeAuthorityId.startsWith('governed:')) {
      setActiveAuthorityId(OVERVIEW_AUTHORITY_ID);
    }
  }, [onLegacySurface, activeAuthorityId, setProductMode, setActiveAuthorityId]);

  // Founder flag from /auth/me (refreshMe hydrates it on every mount) — adds
  // the Admin row at the end of the menu, in both product modes.
  const isAdmin = useAuthStore((s) => s.isAdmin);
  // La mesa del gestor no tiene fila propia en reposo — salvo con
  // MANAGER_DESK_OPEN, el interruptor del hackathon (ver MANAGER_NAV).
  // Con el hub del hackathon abierto (HACKATHON_NAV), Manager desk y Exchange
  // viven en su grupo y no se repiten aquí; cerrado, vuelven a sus filas.
  const hubNav = useMemo(() => hackathonNav(isAdmin), [isAdmin]);
  const nav = useMemo(
    () => [
      ...primaryNav(),
      ...(hubNav.length === 0 && MANAGER_DESK_OPEN ? [MANAGER_NAV] : []),
      ...(hubNav.length === 0 && HACKATHON_HUB_OPEN ? [EXCHANGE_NAV] : []),
      ...(isAdmin ? [ADMIN_NAV] : []),
    ],
    [isAdmin, hubNav],
  );
  const destinations = useMemo(() => destinationsFor(isAdmin), [isAdmin]);

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
  // BOTH directions (ask, superseding the old one-way half-second
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
  const prevCross = useRef<{ mode: 'astryum' | 'legacy'; id: string | null } | undefined>(undefined);
  useEffect(() => {
    // The crossing tracks the PRODUCT, not just the account: entering the lobby (legacy with nothing constituted) is a
    // crossing too — indigo, no council caption. Entering/changing a governed
    // account keeps its constellation with the real quorum.
    const cur = { mode: productMode, id: activeGoverned?.id ?? null };
    // Data refreshes are not crossings: while authorities are (re)loading, a
    // transition is plumbing, not a user stepping between products — track
    // it silently so no spurious crossing fires (bug). This also
    // collapses click-while-loading into ONE crossing: the lobby flip is
    // tracked silently and only the resolved activation plays.
    if (authoritiesLoading) {
      prevCross.current = cur;
      return;
    }
    const prev = prevCross.current;
    if (prev !== undefined && (prev.mode !== cur.mode || prev.id !== cur.id)) {
      if (cur.mode === 'legacy' && (prev.mode !== 'legacy' || (cur.id && prev.id !== cur.id))) {
        // astryum→legacy (lobby or account), or hopping between chambers.
        setCrossing({
          direction: 'to-legacy',
          // Jamás la dirección como nombre: un Legacy sin
          // bautizar cruza como 'Legacy' a secas.
          label: activeGoverned ? activeGoverned.label || t('Legacy') : undefined,
          quorum:
            typeof activeGoverned?.quorum === 'number' && typeof activeGoverned?.memberCount === 'number'
              ? `${activeGoverned.quorum}/${activeGoverned.memberCount}`
              : undefined,
          // Numeric twin of the caption — the constellation ignites one star
          // per signer, lit up to the real quorum (the old seal engraved a
          // hardcoded 3-of-5 whatever the council actually was).
          quorumMet: typeof activeGoverned?.quorum === 'number' ? activeGoverned.quorum : undefined,
          members: typeof activeGoverned?.memberCount === 'number' ? activeGoverned.memberCount : undefined,
          key: `to-legacy:${cur.id ?? 'lobby'}:${Date.now()}`,
        });
      } else if (cur.mode !== 'legacy' && prev.mode === 'legacy') {
        // legacy→astryum: leaving the product, back to personal.
        setCrossing({ direction: 'to-personal', key: `to-personal:${Date.now()}` });
      }
    }
    prevCross.current = cur;
    // Keyed on the (mode, id) transition: label/quorum are read from the
    // activeGoverned closure at that moment, not tracked as separate triggers
    // — a ledger read completing after the id settles must not replay the
    // crossing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productMode, activeGoverned?.id]);

  return (
    <div
      /* data-authority moved UP to <html> (ThemeApplier): stamped here, the
         copilot and every body portal sat outside it and stayed gold in
         Legacy. One stamp, one source — the whole document flips. */
      /* overflow-x-CLIP, never -hidden: per the Overflow spec, when one axis
         is `hidden` the other computes to `auto` — so `overflow-x-hidden`
         turned this wrapper into a silent Y-axis SCROLL CONTAINER. The window
         bar is hidden on html/body (globals.css), but this one is neither, so
         the universal *::-webkit-scrollbar rule painted it an 8px bar. Home is
         pinned to exactly one viewport (page.tsx: h-[calc(100dvh-4rem)] under
         main's py-8), so the reveal cascade's 14px rise and the 60s/90s polls
         tipped it in and out of overflow — the bar blinking on and off.
         `clip` clips the same horizontal drift WITHOUT creating a scrollport
         (and gives MobileBar's sticky the viewport back). */
      className="relative min-h-screen bg-[var(--shell-bg)] text-ink overflow-x-clip transition-colors duration-700"
    >
      <BackgroundFx />

      <div className="relative z-10">
        <Sidebar
          pathname={pathname}
          nav={nav}
          hubNav={hubNav}
          collapsed={collapsed}
          collapsible={docked}
          onToggleCollapsed={() => setSidebarOpen(!sidebarOpen)}
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onOpenPalette={() => setPaletteOpen(true)}
          waitingIntents={waitingIntents}
          refreshIntents={refreshIntents}
          vaultClaims={vaultClaims}
          refreshClaims={refreshClaims}
          vaultClaimsUnreadable={vaultClaimsUnreadable}
          managedTickets={managedTickets}
          refreshManagedTickets={refreshManagedTickets}
        />

        {/* Slim mobile-only bar — the desktop header is gone for an immersive shell. */}
        <MobileBar
          onMenu={() => setMobileOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          intentsWaiting={intentsWaiting + claimsWaiting}
        />

        <div
          style={{ ['--dock-w' as never]: `${dockWidth}px` }}
          // El margen se mueve con la MISMA curva y duración que el ancho del
          // sidebar (500ms, la salida expresiva de la casa): los dos bordes
          // del contenido se desplazan a la vez, como una sola pieza. En
          // movimiento Mínimo, ninguno de los dos anima.
          className={`${
            dockResizing
              ? ''
              : 'transition-[margin] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] [html[data-motion=minimal]_&]:transition-none'
          } ${docked ? `${collapsed ? 'lg:ml-[72px]' : 'lg:ml-64'} lg:mr-[var(--dock-w)]` : 'lg:ml-64'}`}
        >
          {/* GoverningBar UNMOUNTED: the dashboard color
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
            {/* El LOBBY murió con la selección de producto: no
                existe ya un estado «legacy sin cuenta» fuera de la propia
                pantalla de Legacy, así que ninguna página compartida tiene que
                esconder los datos de nadie. La invitación a constituir vive
                donde toca — en la banda del Summary y en /app/legacy. */}
            {children}
          </motion.main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} destinations={destinations} />
      <OnboardingModal />
      <LegacyAccessGuard />
      {/* La operación de estrategia, montada POR ENCIMA de las rutas:
          navegar con ella abierta no la mata — es el punto del anclaje. */}
      <EarnOperationHost />
      {/* The signature ceremony is INLINE now — SignedMark plays inside
          each operation's own progress view: SettlementIndicator (EVM/Flare)
          and XamanQRModal's signed cover (XRPL). Nothing shell-level left. */}

      {/* SIN <AnimatePresence>: la travesía se funde sola (ver su cabecera).
          Como hijo directo de una frontera de presencia no se desmontaba
          nunca — el mismo defecto que congelaba la página tras firmar
          (LegalAcceptGate). */}
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
  // The brand dresses for the product: blue lockup in Legacy.
  const brandLogo = useAuthorityStore((s) => s.productMode) === 'legacy' ? BRAND_LOGO_LEGACY : BRAND_LOGO;
  const { t } = useT();
  return (
    <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 px-4 py-3 bg-[var(--shell-panel)] backdrop-blur-xl border-b border-ink/[0.05] transition-colors duration-700">
      <button onClick={onMenu} className="relative text-ink/70 hover:text-ink" aria-label={t('Open menu')}>
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
        <img src={brandLogo} alt="Astryum" className="h-7 w-auto object-contain" />
      </Link>
      {/* Same-width spacer where the search button lived — keeps the logo optically centred.
      { */}
      <span className="w-5" aria-hidden />
    </header>
  );
}

/** Los hechos vivos del raíl colapsado: firmas que esperan (badge con
 *  contador → /app/intents) y operaciones liquidándose (pulso). Leen las
 *  MISMAS fuentes que las tarjetas grandes — jamás una segunda verdad. */
function RailLiveIndicators({ waiting, t }: { waiting: number; t: (s: string) => string }) {
  const { resumed } = useResumePendingSettlements();
  const inFlight = resumed.filter((r) => r.state.status === 'pending' || r.state.status === 'stalled').length;
  if (waiting <= 0 && inFlight <= 0) return null;
  return (
    <div className="mb-1 flex flex-col items-center gap-1">
      {waiting > 0 && (
        <Link
          href="/app/intents"
          title={`${waiting} ${t('waiting for your signature')}`}
          className="relative grid h-10 w-10 place-items-center rounded-xl text-volt bg-volt/10 border border-volt/25 hover:bg-volt/20 transition-colors"
        >
          <Clock className="h-[18px] w-[18px]" strokeWidth={1.7} />
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-volt px-1 font-mono text-[9px] font-semibold text-volt-ink">
            {waiting}
          </span>
        </Link>
      )}
      {inFlight > 0 && (
        <span
          title={`${inFlight} ${t('operations settling on-chain')}`}
          className="grid h-10 w-10 place-items-center rounded-xl border border-ink/10 bg-ink/[0.03] text-volt"
        >
          <Loader2 className="h-[16px] w-[16px] animate-spin" strokeWidth={1.7} />
        </span>
      )}
    </div>
  );
}

function Sidebar({
  pathname,
  nav,
  hubNav = [],
  collapsed = false,
  collapsible = false,
  onToggleCollapsed,
  mobileOpen,
  onClose,
  onOpenPalette,
  waitingIntents,
  refreshIntents,
  vaultClaims,
  refreshClaims,
  vaultClaimsUnreadable = [],
  managedTickets,
  refreshManagedTickets,
}: {
  pathname: string;
  /** Anclaje (dockStore): el raíl se encoge a solo-iconos con transición. */
  collapsed?: boolean;
  /** Hay algo anclado: se ofrece el botón de plegar/desplegar. */
  collapsible?: boolean;
  onToggleCollapsed?: () => void;
  /** Primary rows for the CURRENT product mode (Wallets↔Legacy swap). */
  nav: NavLeaf[];
  /** El hub del hackathon (HACKATHON_NAV) — vacío cuando está cerrado. */
  hubNav?: NavLeaf[];
  mobileOpen: boolean;
  onClose: () => void;
  onOpenPalette: () => void;
  /** Intents waiting for the user's signature (F3-entrega) — feed the always-on card at the bottom of the sidebar. */
  waitingIntents: PreparedIntent[];
  refreshIntents: () => void;
  /** Money in flight — queued vault exits of the active authority. */
  vaultClaims: VaultClaimEntry[];
  refreshClaims: () => void;
  /** Owners whose queue the watcher could not read on its last tick (the tray says so, never «nothing»). */
  vaultClaimsUnreadable?: VaultClaimsUnreadable[];
  /** Tickets de salida pendientes de managed vaults — «pending to withdraw». */
  managedTickets: ManagedTicket[];
  refreshManagedTickets: () => void;
}) {
  const { t } = useT();
  // The brand dresses for the product: blue lockup in Legacy.
  const brandLogo = useAuthorityStore((s) => s.productMode) === 'legacy' ? BRAND_LOGO_LEGACY : BRAND_LOGO;

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={onClose} />
      ) : null}
      <aside
        // overflow-hidden: mientras el ancho anima, las etiquetas del menú
        // completo no se asoman por fuera del raíl. En Mínimo, sin transición.
        className={`app-sidebar fixed top-0 left-0 z-50 h-screen flex flex-col overflow-hidden border-r border-ink/[0.06] bg-[var(--shell-panel)] backdrop-blur-xl transform transition-[transform,width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] [html[data-motion=minimal]_&]:transition-none lg:translate-x-0 ${
          collapsed ? 'w-[72px]' : 'w-64'
        } ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* soft seam down the right edge — gold in the warm shell, steel/indigo
            when operating a governed account (data-authority theme). */}
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-px"
          style={{ background: 'linear-gradient(to bottom, transparent, var(--shell-seam), transparent)' }}
          aria-hidden
        />

        {collapsed ? (
          /* ── EL RAÍL COMPACTO (anclaje): solo los iconos — la
             operación anclada manda y el menú se aparta sin desaparecer.
             Deliberadamente NO intenta encoger las tarjetas (To sign,
             settlements, cuenta): a 72px serían ruido; vuelven al soltar. ── */
          <div className="shell-reveal flex h-full flex-col items-center gap-1 py-4">
            <span className="mb-2 grid h-9 w-9 place-items-center" aria-hidden>
              {/* El asteroide REAL de la marca;
                  el mismo juego oro/índigo que el lockup del sidebar. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={brandLogo === BRAND_LOGO_LEGACY ? '/astryum-mark-azul-transparente.png' : '/astryum-mark-gold-glow.png'}
                alt=""
                className="h-7 w-7 object-contain"
              />
            </span>
            {/* Desplegar el menú completo al lado de la operación anclada —
                la preferencia se recuerda. */}
            {collapsible && onToggleCollapsed && (
              <button
                onClick={onToggleCollapsed}
                title={t('Expand sidebar')}
                aria-label={t('Expand sidebar')}
                className="mb-1 grid h-8 w-8 place-items-center rounded-lg text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.7} />
              </button>
            )}
            <nav className="flex flex-1 flex-col items-center gap-1">
              {nav.map((n) => {
                const Active = isActive(pathname, n.href);
                const Icon = n.icon;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    title={t(n.label)}
                    className={`grid h-10 w-10 place-items-center rounded-xl transition-colors ${
                      Active ? 'bg-volt/15 text-volt' : 'text-ink/45 hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </Link>
                );
              })}
              {hubNav.length > 0 && (
                <>
                  {/* el hub del hackathon, separado por un filete y en dorado tenue */}
                  <span aria-hidden className="my-1 h-px w-6 bg-volt/20" />
                  {hubNav.map((n) => {
                    const Active = isActive(pathname, n.href);
                    const Icon = n.icon;
                    return (
                      <Link
                        key={n.href}
                        href={n.href}
                        title={`${t(HACKATHON_HUB_LABEL)} · ${t(n.label)}`}
                        className={`grid h-10 w-10 place-items-center rounded-xl transition-colors ${
                          Active ? 'bg-volt/15 text-volt' : 'text-volt/60 hover:bg-volt/10 hover:text-volt'
                        }`}
                      >
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
                      </Link>
                    );
                  })}
                </>
              )}
            </nav>
            {/* Lo importante NO se calla al colapsar — las tarjetas grandes no caben a 72px, pero sus
                HECHOS sí: el contador de firmas (va a /app/intents, la página
                completa de siempre) y el pulso de operaciones en vuelo. */}
            <RailLiveIndicators waiting={waitingIntents.length} t={t} />
            <button
              onClick={openProductAssistant}
              title={t('Co-pilot')}
              className="grid h-10 w-10 place-items-center rounded-xl bg-volt text-volt-ink shadow-[0_6px_18px_-6px_hsl(var(--volt)/0.55)] hover:brightness-105 transition-all"
            >
              <MessageCircleQuestion className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </button>
            <Link
              href={SETTINGS_NAV.href}
              title={t(SETTINGS_NAV.label)}
              className={`mt-1 grid h-10 w-10 place-items-center rounded-xl transition-colors ${
                isActive(pathname, SETTINGS_NAV.href) ? 'bg-volt/15 text-volt' : 'text-ink/45 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </Link>
          </div>
        ) : (
          <div className="shell-reveal flex h-full flex-col">

        {/* The brand mark, unboxed. The lockup now breathes on the panel itself; the
            link is rounded so the rare keyboard-focus ring follows its shape
            instead of boxing the logo. It links to /app/home — the switcher
            surface (a personal wallet turns the shell gold, a Legacy card
            indigo; ProductToggle preserved at components/authority/, its
            access walk-back lives on as LegacyAccessGuard). */}
        <div className="relative px-4 pt-5 pb-2">
          <Link
            href="/app/home"
            className="block group rounded-xl focus-visible:outline-offset-4"
            aria-label="Astryum"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={brandLogo}
              alt="Astryum"
              className="w-full h-auto max-h-14 object-contain transition-transform group-hover:scale-[1.02]"
            />
          </Link>
          <button
            onClick={onClose}
            className="lg:hidden absolute top-3 right-2 text-ink/60 hover:text-ink"
            aria-label={t('Close menu')}
          >
            <X className="w-5 h-5" />
          </button>
          {/* Volver al raíl con la operación anclada. */}
          {collapsible && onToggleCollapsed && (
            <button
              onClick={onToggleCollapsed}
              title={t('Collapse sidebar')}
              aria-label={t('Collapse sidebar')}
              className="hidden lg:grid absolute top-3 right-2 h-8 w-8 place-items-center rounded-lg text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.7} />
            </button>
          )}
        </div>

        {/* No search row: questions
            go to the Co-pilot below. The ⌘K command palette stays wired as a
            keyboard-only power shortcut. */}

        {/* primary nav — flat, everything visible. The Intents card lives at
            the END of the menu: below the last nav row,
            integrated inside the scrolling menu, the big card that shows what
            needs a signature AND the money in flight (queued vault exits)
            directly — no navigation to find it. */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 scrollbar-hide">
          <ul className="space-y-0.5">
            {nav.map((n) => (
              <NavRow key={n.href} item={n} active={isActive(pathname, n.href)} onClick={onClose} />
            ))}
          </ul>

          {/* EL HUB DEL HACKATHON: las puertas de la
              entrega de XRPL Commons, separadas del menú de siempre por un
              filete y una cabecera propia, para que un juez las vea al
              entrar. Temporal: lib/nav/hackathonHub.ts. */}
          {hubNav.length > 0 && (
            <div className="mt-3 border-t border-volt/15 pt-3" data-tour="hackathon-hub">
              <div className="mb-1 flex items-center gap-1.5 px-3">
                <Sparkles className="h-3 w-3 shrink-0 text-volt/70" strokeWidth={1.8} />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-volt/70">
                  {t(HACKATHON_HUB_LABEL)}
                </span>
                <span className="ml-auto rounded-full border border-volt/25 bg-volt/[0.08] px-1.5 py-px font-mono text-[8.5px] uppercase tracking-[0.12em] text-volt/80">
                  XRPL
                </span>
              </div>
              <ul className="space-y-0.5">
                {hubNav.map((n) => (
                  <NavRow key={n.href} item={n} active={isActive(pathname, n.href)} onClick={onClose} />
                ))}
              </ul>
            </div>
          )}

          {/* LA ZONA DE NOTIFICACIONES: en reposo, un
              marcador mudo («Notifications»); con algo que firmar, la tarjeta
              con su punto que respira; con una operación liquidándose, la de
              SidebarSettlements. Un solo sitio, una sola cosa a la vez. */}
          <div className="mt-3 pt-3 border-t border-ink/[0.06]">
            <SidebarIntentsCard
              waiting={waitingIntents}
              refresh={refreshIntents}
              claims={vaultClaims}
              refreshClaims={refreshClaims}
              claimsUnreadable={vaultClaimsUnreadable}
              managedTickets={managedTickets}
              refreshManagedTickets={refreshManagedTickets}
              onBeforeOpen={onClose}
            />
            {/* In-flight operations live right under "To sign": the floating bottom-right cards moved here so ONE
                sidebar spot holds signatures-waiting AND ops-in-progress.
                Minimised by default; renders nothing when nothing is live. */}
            <SidebarSettlements />
          </div>
        </nav>

        {/* pinned footer: co-pilot · discord · settings · account. The
            language toggle moved to Settings › Preferences — the sidebar stays about
            destinations, not preferences. */}
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
          <ul className="space-y-0.5">
            <DiscordRow onClick={onClose} />
            <NavRow item={SETTINGS_NAV} active={isActive(pathname, SETTINGS_NAV.href)} onClick={onClose} />
          </ul>
          <AccountCard />
        </div>

          </div>
        )}
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
  const { t, lang } = useT();
  const Icon = item.icon;
  return (
    <li className="relative">
      <Link
        href={item.href}
        onClick={onClick}
        data-tour={`nav-${item.href === '/app' ? 'summary' : item.href.split('/').pop()}`}
        aria-current={active ? 'page' : undefined}
        className={`app-nav-row group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-200 ${
          active ? 'bg-volt/[0.10] text-ink' : 'text-ink/60 hover:text-ink hover:bg-ink/[0.04]'
        }`}
      >
        {/* active left rail */}
        {active ? (
          <motion.span
            layoutId="nav-active-rail"
            className="app-nav-rail absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-volt"
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          />
        ) : null}
        <Icon
          className={`w-[18px] h-[18px] shrink-0 transition-transform duration-200 ${
            active ? 'text-volt' : 'text-ink/45 group-hover:text-ink/70 group-hover:translate-x-0.5'
          }`}
          strokeWidth={1.6}
        />
        <span className="flex-1 transition-transform duration-200 group-hover:translate-x-0.5">{leafLabel(item, lang, t)}</span>
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

/**
 * The Discord door — same shape as a nav row, but it leaves the app: a real
 * anchor, new tab, and the outward arrow that says so. No active state (it is
 * never "the current page") and no ⌘K entry (the palette routes internally).
 */
function DiscordRow({ onClick }: { onClick?: () => void }) {
  const { t } = useT();
  return (
    <li className="relative">
      <a
        href={DISCORD_INVITE}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        title={t('Report a bug or send us feedback')}
        className="group relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-ink/60 hover:text-ink hover:bg-ink/[0.04] transition-colors duration-200"
      >
        <DiscordIcon className="w-[18px] h-[18px] shrink-0 text-ink/45 group-hover:text-[#5865F2] transition-colors duration-200" />
        <span className="flex-1 min-w-0 transition-transform duration-200 group-hover:translate-x-0.5">
          Discord
          <span className="block text-[10px] leading-none text-ink/35 mt-1 truncate">
            {t('Bugs and feedback')}
          </span>
        </span>
        <ArrowUpRight
          className="w-3.5 h-3.5 shrink-0 text-ink/25 group-hover:text-ink/50 transition-colors"
          strokeWidth={1.8}
          aria-hidden
        />
      </a>
    </li>
  );
}

function AccountCard() {
  const { t } = useT();
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
        aria-label={t('Account settings')}
        title={t('Account settings')}
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
          {user?.username && address ? short : isDev ? t('Dev session') : t('Connected')}
        </div>
      </Link>
      <button
        onClick={() => {
          logout();
          router.replace('/login');
        }}
        className="shrink-0 text-ink/40 hover:text-ink/80 transition-colors p-1"
        aria-label={t('Logout')}
        title={t('Logout')}
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
  const { t: tr, lang } = useT();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return destinations;
    return destinations.filter((n) =>
      // `labelEs` joins the haystack or the capital-at-work row would be
      // unreachable by its Spanish name — the one row whose translation does
      // not live in dict.ts, so `tr(n.label)` cannot find it.
      [n.label, n.labelEs ?? '', tr(n.label), String(n.groupLabel), tr(String(n.groupLabel))]
        .filter(Boolean)
        .some((s) => s.toLowerCase().includes(query)),
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
                        <span className="flex-1 text-sm">{leafLabel(r, lang, tr)}</span>
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

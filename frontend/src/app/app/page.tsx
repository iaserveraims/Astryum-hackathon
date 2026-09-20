'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Wallet, ArrowRight, ArrowLeft, Sparkles, Eye, EyeOff } from 'lucide-react';
import { motion, useAnimationControls } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { AsteroidMark, Card, HairlineGroup, HairlineCell, MicroLabel, Pill } from '@/components/ui/primitives';
import { CountUp, RevealGroup, RevealItem, Spotlight } from '@/components/ui/motion';
import { OrbitDial } from '@/components/ui/charts';
// PerformanceCard is UNMOUNTED (+ the one-viewport contract below). Preserved whole at
// components/dashboard/PerformanceCard.tsx — its slot now hosts WalletsBand.
// NetworkStatusCard is UNMOUNTED: network fees belong
// NEXT TO each operation before the user signs, not floating on the Summary.
// Component preserved at components/dashboard/NetworkStatusCard.tsx for that
// per-operation migration; its header slot now hosts OrbitStatusCard.
import OrbitStatusCard from '@/components/dashboard/OrbitStatusCard';
import ProductTour from '@/components/onboarding/ProductTour';
import WalletManager from '@/components/wallet/WalletManager';
import DemoCapUsageCard from '@/components/dashboard/DemoCapUsageCard';
import { FirstWalletGuide } from '@/components/wallet/FirstWalletGuide';
// ProductModeCard is UNMOUNTED: the product toggle moved
// to the sidebar (components/authority/ProductToggle.tsx). Card preserved at
// components/dashboard/ProductModeCard.tsx.
// LegacySummaryPanel (the standalone Legacy hero) is UNMOUNTED: the Legacy is "una wallet más" — its data feeds the EXISTING
// Net worth / Health organisms below instead of a parallel section. The
// component is preserved at components/dashboard/LegacySummaryPanel.tsx.
import { getLegacyNickname } from '@/components/legacy/legacyLocal';
import { healthTone as legacyHealthTone, headlineLabel } from '@/components/legacy/MyLegaciesList';
import type { LegacyHealth } from '@/services/v1Api';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n/LanguageProvider';
import {
  alerts as alertsApi,
  rules as rulesApi,
  type Alert,
  type AutomationRule,
  type PortfolioSnapshot,
  type RiskSnapshot,
} from '@/services/v1Api';
// The fleet, read ONCE (hooks/useFleet): the hero, the health, the band and
// both rings all read the SAME arrays — so the figure on top is by
// construction the sum of the rows underneath, and there is no second scan.
import { useFleet } from '@/hooks/useFleet';
import FleetBand from '@/components/dashboard/FleetBand';
import { DonutCard, earningRing, assetQuantities } from '@/components/dashboard/DonutCard';
import { SignalBeacon } from '@/components/ui/scenes';
import { SignetMark } from '@/components/ui/skin/marks';
import { useEngraved } from '@/stores/themeStore';
import { EVM_ADDRESS_RE } from '@/lib/portfolioMerge';
/** Cuenta clásica de XRPL — el mismo patrón que valida el backend. */
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
import { healthScoreFromHF, healthTone, healthWords } from '@/lib/healthScore';
import { type EthMorphoHealth } from '@/lib/earn/useEthMorphoHealth';
import { PortfolioSyncBadge } from '@/components/dashboard/PortfolioSyncBadge';
import { PortfolioUnreadableNotice } from '@/components/dashboard/PortfolioUnreadableNotice';
import { homePositionsVerdict, unreadableOf } from '@/lib/portfolioUnreadable';
import { useBalanceVisibility, MASK } from '@/stores/balanceVisibilityStore';
import { formatMoneyCompact } from '@/lib/formatMoney';
import { CAPITAL_SECTION_HREF } from '@/lib/nav/capitalSection';

const SEV_TONE: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
  INFO: 'neutral',
};

// Flare + the backend's pseudo chain-id for XRPL, the demo's two rails —
// an XRPL snapshot must read "XRPL", not blank.
const CHAIN_LABEL: Record<number, string> = {
  14: 'Flare',
  1440002: 'XRPL',
};

// Trigger kinds that guard a position (repay/exit before liquidation) — the
// only ones that count as "Active protections". Harvest/reward/idle triggers
// are automation, not protection, so they're excluded from this count.
const PROTECTIVE_TRIGGER_TYPES = new Set(['HF_BELOW', 'HF_CRITICAL', 'LTV_ABOVE', 'LIQUIDATION_DISTANCE_USD']);

type HistoryPoint = { takenAt: string; totalUSD: number };

// Backend sometimes returns partial snapshots (missing breakdown / positions
// when no engine has produced a snapshot yet). Render code calls .toFixed on
// these fields, so we fill numeric defaults here to keep the dashboard from
// crashing the whole /app shell via the root error boundary.
function normaliseSnap(raw: PortfolioSnapshot | null | undefined): PortfolioSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = (raw as PortfolioSnapshot).breakdown ?? ({} as PortfolioSnapshot['breakdown']);
  const byProtocol: Record<string, number> = b.byProtocol ?? {};
  const byAsset: Record<string, number> = b.byAsset ?? {};
  const byKind: Record<string, number> = b.byKind ?? {};
  const snap: PortfolioSnapshot = {
    ...raw,
    chainId: typeof raw.chainId === 'number' ? raw.chainId : 14,
    totalUSD: typeof raw.totalUSD === 'number' ? raw.totalUSD : 0,
    collateralUSD: typeof raw.collateralUSD === 'number' ? raw.collateralUSD : 0,
    debtUSD: typeof raw.debtUSD === 'number' ? raw.debtUSD : 0,
    netWorthUSD: typeof raw.netWorthUSD === 'number' ? raw.netWorthUSD : 0,
    positions: Array.isArray(raw.positions) ? raw.positions : [],
    breakdown: { byProtocol, byAsset, byKind },
  };
  return snap;
}

// assetQuantities moved to components/dashboard/DonutCard (fusión).

// Engine kind enums → words a person would use (same register as Portfolio).
// PARKED (with prettyKinds/onlyEarningKinds below): the Assets
// Earning ring stopped charting kinds — it now splits the WHOLE capital by
// asset + idle. Kept inert per repo rule; grep for callers before reviving.
const KIND_WORD: Record<string, string> = {
  free: 'Idle',
  supply: 'Supplied',
  collateral: 'Collateral',
  debt: 'Debt',
  borrow: 'Borrowed',
  lp: 'LP',
  staking: 'Staked',
  locked: 'Locked',
  stake: 'Staked',
  rewards: 'Rewards',
  reward: 'Rewards',
};

function prettyKinds(data: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) {
    const kl = k.toLowerCase();
    const label = KIND_WORD[kl] ?? (kl ? kl.charAt(0).toUpperCase() + kl.slice(1) : '—');
    out[label] = (out[label] ?? 0) + (v ?? 0);
  }
  return out;
}

// Which kinds earn, which are debt, which are money in flight: ONE classifier,
// shared with Portfolio (lib/positionKinds). This page used to keep its own
// Set, and it knew nothing about CLAIM — a queued vault exit read as "idle".
const EARNING_KIND_WORDS = new Set(['supply', 'stake', 'staking', 'lp', 'reward', 'rewards']);

function onlyEarningKinds(data: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) {
    if (EARNING_KIND_WORDS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

export default function OverviewPage() {
  const { t, lang } = useT();
  const es = lang === 'es';
  const user = useAuthStore((s) => s.user);
  const address = user?.address;
  // EL HOME ENSEÑA SIEMPRE LA FLOTA ENTERA. La lente que se podía reencuadrar por
  // fila duró un día: un botón de más en la pantalla que debe leerse de un
  // vistazo. Para mirar una cuenta sola está Wallets, que es adonde lleva la
  // fila al pulsarla.
  const fleet = useFleet();
  const snap = useMemo(() => normaliseSnap(fleet.snap), [fleet.snap]);
  const riskSnap = fleet.risk;
  // La cartera agregada no tiene adapter para morpho-blue, así que sin esta
  // lectura la tarjeta decía «Sana — nada puede liquidarse» sobre un carry
  // apalancado VIVO.
  const emHealth = fleet.emHealth;
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  // Real count of enabled, protective automation rules guarding any connected
  // wallet — never invented. null = still loading (renders as an em dash).
  const [protections, setProtections] = useState<number | null>(null);

  // Alerts and protections cover the WHOLE fleet, same as the net-worth figure
  // beside them: counting rules that guard wallets the figure does not include
  // would be two readings of two different accounts sharing one panel.
  const fleetAddresses = fleet.addresses;
  const walletsKey = fleetAddresses.join(',').toLowerCase();
  const walletsResolving = fleet.loading;

  useEffect(() => {
    // Alerts cover EVERY connected wallet — same scope as net worth/HF. The
    // /alerts endpoint takes one address, so fan out per wallet and merge,
    // deduping by id and summing the real per-wallet counts (each capped
    // server-side at 100, not at the 4 rows we render).
    // G2 (auditorí) — este filtro EVM dejaba fuera TODA cuenta XRPL,
    // y con ella el único canal donde vive el «por qué no pasó nada» de una
    // regla gobernada: el motor escribe una Alert por cada disparo Y por cada
    // ERROR (consejo sin jaula, compose fallido, pago programado inválido) con
    // el walletId de la cuenta del consejo. El backend ya acepta r-address
    // (routes/alerts.ts lo arregló); este era el ÚNICO consumidor y las
    // descartaba antes de preguntar. Resultado: silencio absoluto sobre
    // protecciones gobernadas que llevaban semanas sin funcionar.
    const addresses = fleetAddresses.filter((a) => EVM_ADDRESS_RE.test(a) || XRPL_CLASSIC_RE.test(a));
    if (addresses.length === 0) return;
    let alive = true;
    (async () => {
      const collected: Alert[] = [];
      // Parallel fan-out: awaiting each wallet in sequence made load time grow
      // linearly with the number of connected wallets.
      const results = await Promise.allSettled(addresses.map((addr) => alertsApi.list(addr, true)));
      for (const res of results) {
        if (res.status !== 'fulfilled') continue; // best-effort; one address failing must not blank the rest
        const list = Array.isArray(res.value?.alerts) ? res.value.alerts : [];
        collected.push(...list);
      }
      if (!alive) return;
      const deduped = [...new Map(collected.map((a) => [a.id, a])).values()];
      setRecentAlerts(deduped.slice(0, 4));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsKey]);

  useEffect(() => {
    // Protections guard every connected wallet, same scope as net worth/HF
    // above — one /rules call per address, deduped by id (mirrors
    // DefiPositionsBoard's loadRules for the same multi-wallet shape).
    const addresses = fleetAddresses;
    if (addresses.length === 0) {
      setProtections(0);
      return;
    }
    let alive = true;
    (async () => {
      const collected: AutomationRule[] = [];
      // Parallel fan-out — same reasoning as the alerts effect above.
      const results = await Promise.allSettled(addresses.map((addr) => rulesApi.list(addr)));
      for (const res of results) {
        if (res.status !== 'fulfilled') continue; // best-effort; one address failing shouldn't blank the count
        collected.push(...(Array.isArray(res.value?.rules) ? res.value.rules : []));
      }
      if (!alive) return;
      const deduped = [...new Map(collected.map((x) => [x.id, x])).values()];
      const active = deduped.filter(
        (x) => x.enabled && PROTECTIVE_TRIGGER_TYPES.has((x.trigger as { type?: string } | null | undefined)?.type ?? ''),
      );
      setProtections(active.length);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsKey]);

  // Wallet connected, snapshot loaded, nothing in it — the moment the
  // dashboard should nudge toward Earn instead of just showing empty charts.
  //
  // ONLY when every adapter answered. `positions.length === 0`
  // alone said «nothing is working yet — Open your first strategy» over a live
  // carry whenever the forced refresh after a signature landed on a 429 and
  // the snapshot came back without Kinetic. `snapshot.unreadable` has been
  // there; this is its reader (lib/portfolioUnreadable).
  const positionsVerdict = homePositionsVerdict(snap);
  const hasPositions = positionsVerdict === 'positions';
  const noPositionsYet = positionsVerdict === 'empty';
  const snapUnreadable = unreadableOf(snap);

  // El héroe ya NO se viste de un Legacy concreto: la cifra de arriba es la de
  // toda la flota, así que ponerle al lado el consejo de una de las cuentas
  // sería describir el dinero equivocado. La identidad y la gobernanza de una
  // cuenta del consejo viven en su tarjeta, en Wallets.

  // The dashboard belongs to anyone with capital linked: a SIWE login address
  // OR any wallet, OR any governed structure (an heir with no personal wallet
  // must still see the fleet).
  const hasCapitalSurface = !!address || fleet.rows.length > 0;

  // Load-once, reveal-once (bug: "carga una vez, no lo carga todo y
  // luego vuelve a cargarlo todo"). For a user whose capital comes from
  // connected wallets (no SIWE address), myWallets is [] on the first paint, so
  // hasCapitalSurface was briefly false — the Welcome panel cascaded in, then a
  // beat later the wallets resolved and the ENTIRE dashboard mounted and
  // cascaded AGAIN. That second mount also oscillated the document height,
  // flashing the (otherwise hidden) window scrollbar. While wallets/authorities
  // are still resolving we ASSUME the capital surface and render the dashboard
  // tree ONCE — its cards already handle null data (—/Loading…/empty states)
  // and fill in place, no second reveal. Welcome only shows once we KNOW there
  // is no capital (resolved). The rare reverse case (a genuinely wallet-less new
  // account) briefly shows the empty dashboard before Welcome — acceptable next
  // to killing the double-load every wallet user was hitting.
  const surfaceUndecided = !hasCapitalSurface && walletsResolving;
  const showDashboard = hasCapitalSurface || surfaceUndecided;
  const showWelcome = !hasCapitalSurface && !surfaceUndecided;

  // The two allocation rings, back on the Summary. Same organisms the Portfolio renders — ONE component, in
  // components/dashboard/DonutCard — reading whatever the lens selected.
  const ring = useMemo(
    () => earningRing(snap, es ? 'En camino' : 'On the way'),
    [snap, es],
  );

  // Personalised, time-of-day greeting — the assistant welcome. "Captain" is the
  // mission-control fallback when there's no name yet. The hour is read after
  // mount: the server's clock can disagree with the client's, and computing it
  // during render makes React hydrate "Good morning" over "Good evening".
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => setHour(new Date().getHours()), []);
  const greeting =
    hour == null
      ? es ? 'Hola' : 'Hello'
      : es
        ? hour < 12 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches'
        : hour < 12 ? 'Good morning' : hour < 20 ? 'Good afternoon' : 'Good evening';
  const pilotName = user?.username || (es ? 'Capitán' : 'Captain');

  // El panel incrustado de Wallets MURIÓ (quinta pasada): Wallets
  // volvió a ser un destino propio del menú, así que la superficie completa
  // vive en /app/wallets y no hace falta esconderla dentro del Home. Los
  // enlaces viejos siguen entrando: `?panel=wallets` se reenvía allí, con su
  // query intacta (`?add=1` incluido).
  const router = useRouter();
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('panel') !== 'wallets') return;
    qs.delete('panel');
    const rest = qs.toString();
    router.replace(`/app/wallets${rest ? `?${rest}` : ''}`);
  }, [router]);

  return (
    /* One-viewport contract: on lg+ the column takes exactly the viewport
       minus the shell's py-8 and every band is shrink-0 EXCEPT the donuts row,
       which flexes and lets its donuts scale down. No overflow-hidden — on a
       genuinely tiny window the page still scrolls rather than cutting
       content. Below lg the page stacks and scrolls naturally, as ever. */
    // min-h, no h: con sitio, la columna llena
    // el viewport como siempre; sin sitio —pantalla baja— CRECE y la página
    // hace scroll, en vez de apretar la fila de anillos hasta recortarlos.
    <RevealGroup className="flex flex-col gap-4 lg:min-h-[calc(100dvh-4rem)]" stagger={0.045}>
      {/* Greeting + live network telemetry, sharing the header band. The ONE
          brand moment of the page: the asteroid mark, the mission line, and
          the pilot's name carrying the landing's gold sweep. */}
      <RevealItem className="shrink-0 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <AsteroidMark size={15} />
            <MicroLabel>
              {es ? 'Astryum · plano de control' : 'Astryum · control plane'}
            </MicroLabel>
          </div>
          <h1 className="text-[26px] md:text-[30px] font-semibold tracking-tight leading-[1.1] text-ink text-balance">
            {greeting}, <span className="text-gold-sweep font-semibold">{pilotName}</span>
          </h1>
          <p className="text-ink/55 mt-2 text-sm">{t('Here is where your capital stands today.')}</p>
          {/* The "Across all fleets" line of the fusion is GONE (
              this pass): the hero figure below IS that total by default, and
              the band prints each half's subtotal — a third copy of the same
              number was furniture. */}
        </div>
        {/* The product toggle left this header: it lives
            in the sidebar slot (ProductToggle). Only telemetry remains here. */}
        {/* First-run tour — back from the retired Home (fusión):
            the Summary is the meeting point again. Fresh id 'summary' so the
            fused layout replays even for pilots who saw the Home tour. */}
        <ProductTour
          tour="summary"
          steps={[
            { target: null, title: t('Welcome aboard'), body: t('This is your Home: all your capital, across every account, in one place. A minute of tour and you will know where everything lives — skip and replay it any time from Settings.') },
            { target: 'fleet-band', title: t('Your accounts'), body: t('Every account you own, at a glance — including the ones a council governs: how much of each is working, how it stands, what it is worth. Click any row to manage it.') },
            { target: 'nav-wallets', title: t('Wallets'), body: t('Where your accounts are managed: connect, watch or create them, and give one a quorum of your own keys. A Legacy — an account a council governs — lives here too, and you govern it from its own card.') },
            { target: 'nav-portfolio', title: t('Portfolio'), body: t('Every position, token and movement across your wallets — with filters, health readings and export.') },
            { target: 'nav-asset-production', title: t('Earn'), body: t('Where capital goes to work: ready-made strategies, the AI agent, and your strategy registry. You always sign in your own wallet.') },
            { target: 'nav-settings', title: t('Settings'), body: t('Language, region, security and your profile. The tutorial can be replayed from here whenever you want.') },
            { target: 'copilot', title: t('Co-pilot'), body: t('Stuck anywhere? The co-pilot explains the ship — ask it anything about what a screen or button does.') },
          ]}
        />
        {showDashboard && (
          <div className="flex flex-wrap items-center gap-3">
            {/* Daily XRP allowance (demo cap) — same size family as the orbit
                card; hides itself when there is no linked XRPL wallet or the
                open demo is off. */}
            <DemoCapUsageCard />
            <OrbitStatusCard />
          </div>
        )}
      </RevealItem>

      {/* LegacyVaultCard is UNMOUNTED here. The cage's capital now enters the portfolio
          pipeline SERVER-SIDE (LegacyCagePositionsService → XrplBalanceProvider
          attributes the vault to the council account), so net worth, the
          earning ring and My Assets count it like any personal position — no
          special hero card. The card itself stays mounted inside /app/legacy. */}

      {showWelcome && (
        <RevealItem>
          <WelcomePanel es={es} t={t} onConnect={() => router.push('/app/wallets?add=1')} />
        </RevealItem>
      )}

      {showDashboard && (
        <>
          {/* ONE hero organism: net worth and health share a single panel,
              separated by a hairline — the state of your capital reads as one
              breath, not two competing boxes. Compacted: the
              per-wallet rows moved OUT to WalletsBand below, so this panel is
              a short reading, not a tower. */}
          <RevealItem className="shrink-0">
            {/* Cursor light travels across the hero like the landing's
                spotlight cards — the panel feels lit, not painted. */}
            {/* La luz del cursor viaja por el héroe como en las tarjetas de la
                landing — el panel se siente iluminado, no pintado. Y encima,
                y el barrido lento que lo recorre solo. El relevo por los
                cuatro paneles se retiró: la luz se queda
                AQUÍ, en el primer recuadro, a la misma velocidad. */}
            <Spotlight className="rounded-2xl">
              <div className="relative rounded-2xl">
                <span className="hero-sheen" aria-hidden />
              <HairlineGroup columns="lg:grid-cols-2">
                <HairlineCell className="p-5 md:p-6">
                  <NetWorthCard snap={snap} es={es} t={t} legacy={null} />
                </HairlineCell>
                <HairlineCell className="p-5 md:p-6">
                  <HealthCard
                    snap={snap}
                    riskSnap={riskSnap}
                    emHealth={emHealth}
                    protections={protections}
                    es={es}
                    t={t}
                    legacy={false}
                  />
                </HairlineCell>
              </HairlineGroup>
              </div>
            </Spotlight>
          </RevealItem>

          {noPositionsYet && (
            <RevealItem className="shrink-0">
              <NoPositionsCTA es={es} t={t} />
            </RevealItem>
          )}

          {/* Lo que el barrido NO pudo leer se dice aquí, con
              reintento que pide un snapshot fresco; nunca se disfraza de
              «nada trabajando». */}
          {snapUnreadable.length > 0 && (
            <RevealItem className="shrink-0">
              <PortfolioUnreadableNotice snap={snap} />
            </RevealItem>
          )}

          {/* LAS CUENTAS, una línea cada una: el vistazo de siempre — lo que trabaja, cómo está, lo
              que vale — con los Legacy dentro de la misma lista. No se
              seleccionan: la fila lleva a Wallets, que es donde se gestionan y
              de donde cuelga la gobernanza de una cuenta del consejo. */}
          <RevealItem className="shrink-0">
            <FleetBand view={fleet} />
          </RevealItem>

          {/* StructuresBand (the governed fleet) LEFT this page — it closes the
              Portfolio now, under every lens. The Summary keeps one viewport:
              hero, wallets, destinations.
          { *
              Destinations: My Assets → Portfolio;
              Assets Earning → the strategy registry inside Earn. Both read the
              LENS, so the rings answer "of what I just picked". */}
          {/* El suelo de esta fila es lo que arregla los quesitos. Con la banda alta,
              el `flex-1` dejaba a los anillos menos alto del que necesitan y
              el aro se desbordaba por encima del título de su propia tarjeta.
              Ahora la fila no baja de lo que el anillo pide: si el viewport no
              da, la página hace scroll — que es lo que el contrato de una
              pantalla siempre dijo que debía pasar, en vez de recortar. */}
          <RevealItem className="flex-1 min-h-0 lg:min-h-[252px] grid gap-4 lg:grid-cols-2">
            <DonutCard
              title={t('My Assets')}
              data={snap?.breakdown.byAsset ?? {}}
              qty={hasPositions && snap ? assetQuantities(snap.positions) : undefined}
              href="/app/portfolio"
              loading={!snap && fleet.loading}
            />
            <DonutCard
              title={t('Assets Earning')}
              data={ring.donut}
              qty={Object.keys(ring.workingQty).length > 0 ? ring.workingQty : undefined}
              split={
                ring.workingUSD + ring.idleUSD + ring.inflightUSD > 0.01
                  ? {
                      working: ring.workingUSD,
                      idle: ring.idleUSD,
                      inflight: ring.inflightUSD,
                      arrivesAt: ring.inflightArrival,
                    }
                  : undefined
              }
              href={CAPITAL_SECTION_HREF}
              loading={!snap && fleet.loading}
            />
          </RevealItem>

          {/* Mobile surface only (its own comment always said so — desktop
              reads the unread counter in the health card): on lg it would
              also break the one-viewport contract. */}
          {recentAlerts.length > 0 && (
            <RevealItem className="lg:hidden">
              <AlertsPanel alerts={recentAlerts} t={t} />
            </RevealItem>
          )}
        </>
      )}
    </RevealGroup>
  );
}

// ── Welcome (no wallet connected) ─────────────────────────────────────────────
function WelcomePanel({ es, t, onConnect }: { es: boolean; t: (s: string) => string; onConnect?: () => void }) {
  // First-wallet guide: users landing from an exchange
  // own tokens but no wallet — for them "Connect wallet" is a wall, so the
  // welcome panel carries its own door into the step-by-step guide. Mounted
  // WITHOUT connect handlers: its last step hands over to /app/wallets?add=1.
  const [showGuide, setShowGuide] = useState(false);
  // El grabado del tema Institucional en lugar del faro de satélites: las
  // wallets que firman ante el registro (ui/skin/marks.tsx SignetMark).
  const engraved = useEngraved();
  return (
    <Card glow spotlight padded={false} className="relative overflow-hidden p-8 md:p-12">
      <div
        className="absolute -top-28 -right-20 w-96 h-96 rounded-full blur-[120px] pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--volt) / 0.12), transparent 70%)' }}
        aria-hidden
      />
      {/* The living beacon — the empty state wears a SCENE, not a void.
          Hidden below lg
          where the copy needs the room. */}
      <div className="pointer-events-none absolute right-8 top-1/2 hidden -translate-y-1/2 lg:block opacity-90" aria-hidden>
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 30, delay: 0.15 }}
        >
          {engraved ? <SignetMark size={210} /> : <SignalBeacon width={280} height={230} />}
        </motion.div>
      </div>
      <div className="relative max-w-xl">
        <Pill tone="info">{t('Non-custodial · You always sign')}</Pill>
        <h2 className="mt-5 text-2xl md:text-3xl font-semibold tracking-tight leading-snug text-ink text-balance">
          {es ? (
            <>Conecta una wallet para dar <span className="text-volt">vida a tu capital</span>.</>
          ) : (
            <>Connect a wallet to bring your <span className="text-volt">capital to life</span>.</>
          )}
        </h2>
        <p className="mt-4 text-ink/55 leading-relaxed">
          {t('Read-only until you sign. Astryum reads your on-chain positions and prepares defensive actions — repay, add collateral, exit LP — with their exact impact shown before you commit.')}
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          {/* Navigational Links styled with the PrimaryButton/GhostButton
              recipe (the primitives are <button>s and can't carry an href) —
              same colors, same one hover direction, no ad-hoc gold. */}
          <button
            onClick={onConnect}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-volt text-volt-ink text-sm font-semibold hover:brightness-105 transition-all shadow-[0_8px_24px_-10px_hsl(var(--volt)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
          >
            <Wallet className="w-4 h-4" strokeWidth={2} /> {t('Connect wallet')}
          </button>
          <Link
            href="/app/asset-production"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-ink/10 bg-ink/[0.03] text-ink/80 text-sm hover:bg-ink/[0.06] hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
          >
            {t('Explore Earn')} <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
          </Link>
        </div>
        {/* Text link, not a third button: the two CTAs above keep their
            hierarchy; this catches the exchange-only user before they bounce. */}
        <button
          onClick={() => setShowGuide(true)}
          className="mt-4 text-[13px] text-ink/50 underline underline-offset-4 decoration-ink/25 hover:text-ink hover:decoration-ink/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 rounded"
        >
          {t('I don’t have a wallet yet — show me how')}
        </button>
      </div>
      {showGuide && <FirstWalletGuide onClose={() => setShowGuide(false)} />}
    </Card>
  );
}

// ── No positions yet (wallet connected, snapshot came back empty) ────────────
// A soft nudge, not a wall: net worth/health above already read "—"/"0
// positions", so this just points at what to do next.
function NoPositionsCTA({ es, t }: { es: boolean; t: (s: string) => string }) {
  return (
    <Card padded={false} className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-5">
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="w-10 h-10 rounded-xl grid place-items-center bg-volt/10 border border-volt/20 text-volt shrink-0">
          <Sparkles className="w-5 h-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink">
            {t('Your wallet is connected, but nothing is working yet')}
          </div>
          <div className="text-sm text-ink/45 mt-0.5">
            {t('Open your first strategy — supply, stake or LP, always prepared for your signature.')}
          </div>
        </div>
      </div>
      <Link
        href="/app/asset-production"
        className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-volt text-volt-ink text-sm font-semibold hover:brightness-105 transition-all shadow-[0_8px_24px_-10px_hsl(var(--volt)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
      >
        {t('Open your first strategy')} <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
      </Link>
    </Card>
  );
}

// ── Net worth — the hero figure, bare on purpose ──────────────────────────────
// The per-wallet rows moved to WalletsBand; a "pulse" strip
// (trailing gains + working share) briefly filled the room they left and was
// REMOVED the next day — the figure breathes alone, vertically centred.
function NetWorthCard({
  snap,
  es,
  t,
  legacy = null,
}: {
  snap: PortfolioSnapshot | null;
  es: boolean;
  t: (s: string) => string;
  /** Legacy product mode: the loaded governed account's identity — the same
   *  card, one more wallet, with its governance stated.
   *  The council reading (total · rehearsed) sits small NEXT TO the balance. */
  legacy?: {
    nickname?: string;
    address: string;
    health?: LegacyHealth;
    total?: number;
    signed?: number;
  } | null;
}) {
  const positions = snap?.positions.length ?? 0;
  const chainLabel = snap ? CHAIN_LABEL[snap.chainId] ?? '' : '';
  // Global hide-balances: this eye is the same switch as the Portfolio's —
  // masking here masks the whole app (donuts, charts, wallet cards…).
  const hidden = useBalanceVisibility((s) => s.hidden);
  const toggleHidden = useBalanceVisibility((s) => s.toggle);
  return (
    <div className="flex flex-col h-full justify-center min-h-[172px]">
      <MicroLabel>{legacy ? (es ? 'Legacy · patrimonio' : 'Legacy · net worth') : t('Net worth')}</MicroLabel>
      {/* Legacy identity INSIDE the existing card — same organism, one more
          wallet, its governance visible: nickname + constitution health. */}
      {legacy && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold text-ink truncate">
            {legacy.nickname ?? t('Unnamed Legacy')}
          </span>
          <span className="font-mono text-[11px] text-ink/40">
            {legacy.address.length > 14
              ? `${legacy.address.slice(0, 7)}…${legacy.address.slice(-5)}`
              : legacy.address}
          </span>
          {legacy.health && (
            <Pill tone={legacyHealthTone(legacy.health.level)}>
              {headlineLabel(legacy.health.headline, t)}
            </Pill>
          )}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-3">
        <div className="text-[38px] md:text-[42px] leading-none font-semibold tracking-tight font-mono tabular-nums text-ink">
          {snap ? (
            hidden ? MASK : <CountUp value={snap.netWorthUSD} format={(v) => formatMoneyCompact(v)} />
          ) : (
            '—'
          )}
        </div>
        <button
          onClick={toggleHidden}
          title={hidden ? t('Show balances') : t('Hide balances')}
          className={`mt-1 p-1.5 rounded-lg border transition-all ${
            hidden
              ? 'bg-volt/15 text-volt border-volt/30'
              : 'text-ink/30 border-ink/10 hover:text-ink/60 hover:border-ink/20'
          }`}
        >
          {hidden ? <EyeOff className="w-4 h-4" strokeWidth={1.5} /> : <Eye className="w-4 h-4" strokeWidth={1.5} />}
        </button>
        {/* Council reading, small, right beside the balance (ask). */}
        {legacy && legacy.total != null && (
          <div className="ml-1 self-center text-[11px] leading-snug text-ink/45">
            <div className="font-medium text-ink/60">
              {es ? 'Consejo' : 'Council'} · {legacy.total}
            </div>
            {legacy.signed != null && (
              <div>
                {legacy.signed}/{legacy.total} {t('rehearsed')}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="mt-2 text-sm text-ink/45">
        {snap
          ? `${positions} ${positions === 1 ? t('position') : t('positions')}${chainLabel ? ` · ${chainLabel}` : ''}`
          : t('Loading…')}
      </div>
      {/* «Aún leyendo tus wallets» — la cifra parcial se declara parcial.
      { */}
      <div className="mt-2.5">
        <PortfolioSyncBadge />
      </div>
    </div>
  );
}

// PARKED (with signedMoney below): the Wallets band no longer draws
// a P&L range. Two reasons, in order. (1) It could not be read: a track with a
// round knob and a figure on each side reads as a SLIDER you set, not as a
// range you are shown, and the only explanation lived in a hover title.
// (2) Worse, it was not true at this size — the flow filter below only discards
// a jump that is BOTH >25% and >$50, so on a $7 wallet every transfer in or out
// was booked as profit or loss (live rows showed −$51.25 all-time-low on a
// $7.60 wallet, and +$27.01 all-time-high on a $0.87 one). Showing invented
// performance is exactly what invariant #9 forbids. Reviving this needs REAL
// deposit/withdrawal records from the backend, not a heuristic. Kept inert per
// repo rule; grep for callers before reviving.
function pnlRange(points: HistoryPoint[]): { atl: number; ath: number; cur: number } | null {
  if (points.length < 2) return null;
  let adj = 0;
  let atl = 0;
  let ath = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].totalUSD;
    const delta = points[i].totalUSD - prev;
    const isFlow = prev <= 0 ? true : Math.abs(delta) > 50 && Math.abs(delta) / prev > 0.25;
    if (!isFlow) adj += delta;
    if (adj < atl) atl = adj;
    if (adj > ath) ath = adj;
  }
  return { atl, ath, cur: adj };
}

function signedMoney(v: number): string {
  return `${v < 0 ? '−' : '+'}${formatMoneyCompact(Math.abs(v))}`;
}

// ── The per-wallet reading MOVED OUT (revisión de la fusión) ────
// holdingsOf/holdingsLine, capitalMix, healthLine and the CapitalMeter now
// live with the band that draws them, in components/dashboard/FleetBand.tsx —
// one copy, not two. What must not be re-litigated there:

// ── Position health — simple, honest, one small ornament ────────────────────
// History of this card, so nobody re-grows it: the "Capital in orbit" dial
// left (repeated Assets Earning + blended score read as unreal
// risk); a data-dense v2 (open debt figure, per-wallet HF strip) left the
// next day. What stays: the honest posture (no debt = nothing can be
// liquidated), the three readings, and ONE ornament — a dashed orbit whose
// moonlet wears the REAL health tone. Decoration reflecting truth, no
// invented number.
function HealthCard({
  snap,
  riskSnap,
  emHealth,
  protections,
  es,
  t,
  legacy = false,
}: {
  snap: PortfolioSnapshot | null;
  riskSnap: RiskSnapshot | null;
  /** Riesgo del carril de Ethereum — el snapshot agregado no lo ve. */
  emHealth: EthMorphoHealth;
  protections: number | null;
  es: boolean;
  t: (s: string) => string;
  /** Legacy product mode: gates the "you propose" line. The council reading
   *  itself lives beside the balance in NetWorthCard. */
  legacy?: boolean;
}) {
  const snapHf = typeof riskSnap?.healthFactor === 'number' ? riskSnap.healthFactor : null;
  // El PEOR de los dos mundos manda. Sin esto, con un carry vivo en Ethereum
  // esta tarjeta afirmaba «Sin deuda abierta — nada puede liquidarse», que es
  // la mentira mas cara del producto: hace que dejes de mirar.
  const emHf = emHealth.healthFactor;
  const hf = snapHf != null && emHf != null ? Math.min(snapHf, emHf) : (snapHf ?? emHf);
  const hasDebt = (snap?.debtUSD ?? 0) > 0.01 || emHf != null;

  const hfTone = hf == null ? 'text-ink' : hf < 1.2 ? 'text-tone-danger' : hf < 1.5 ? 'text-tone-warning' : 'text-tone-success';

  // HF sobre 100: la escala calibrada
  // del repo (lib/healthScore — HF 1,1 → 10, liquidación → 0, 100 reservado a
  // cero deuda), el mismo cuello que ya puntúa las tiras por wallet.
  const hfScore = snap ? healthScoreFromHF(hf, hasDebt) : null;
  const hfScoreTitle =
    snap && !hasDebt
      ? es
        ? 'Sin deuda abierta — nada puede liquidarse'
        : 'No open debt — nothing can be liquidated'
      : hf != null
        ? `HF ${hf.toFixed(2)} · ${healthWords(hfScore, es)}`
        : undefined;

  // LTV real (deuda / colateral): el dial de la derecha. Risk engine primero
  // (ratio 0–1), fallback al snapshot; sin colateral → 0. null = cargando.
  const ltvPct =
    typeof riskSnap?.ltv === 'number'
      ? Math.min(100, Math.max(0, riskSnap.ltv * 100))
      : snap
        ? snap.collateralUSD > 0
          ? Math.min(100, Math.max(0, (snap.debtUSD / snap.collateralUSD) * 100))
          : 0
        : null;
  return (
    <div className="h-full min-h-[172px]">
      {/* Entry point to the detail: every position conditioning the capital's
          health, each with its own bar + liquidation price (#position-health). */}
      <Link
        href="/app/portfolio#position-health"
        className="group/health flex h-full items-center justify-between gap-6 rounded-xl -m-2 p-2 transition-colors hover:bg-ink/[0.03]"
      >
        {/*
        { */}
        <div className="min-w-0 self-center">
          <div className="mb-4">
            <MicroLabel>{es ? 'Salud de posiciones' : 'Position health'}</MicroLabel>
          </div>
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <Reading label={es ? 'Protecciones activas' : 'Active protections'}>
              <span className="inline-flex items-center gap-2">
                {/* El latido solo late cuando HAY algo vigilando. Una regla
                    activa es un hecho vivo —está mirando tu posición ahora
                    mismo— y merece decirlo; con cero protecciones no hay nada
                    que respire, y fingirlo sería decorar una ausencia. */}
                {protections != null && protections > 0 && (
                  <span
                    className="live-beat relative inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-tone-success text-tone-success"
                    aria-hidden
                  />
                )}
                {/* La cifra CUENTA al llegar (idioma de la casa: «figures
                    count up»). Antes el guion se sustituía por el número de
                    golpe — el pop que el fundador señaló. */}
                <span className={`font-mono ${protections != null && protections > 0 ? 'text-tone-success' : 'text-ink'}`}>
                  {protections != null ? <CountUp value={protections} format={(v) => String(Math.round(v))} /> : '—'}
                </span>
              </span>
            </Reading>
            <Reading label={es ? 'Salud' : 'Health'} title={hfScoreTitle}>
              <span className={`font-mono ${snap && !hasDebt ? 'text-tone-success' : hfTone}`}>
                {hfScore != null ? <CountUp value={hfScore} format={(v) => `${Math.round(v)}/100`} /> : '—'}
              </span>
            </Reading>
          </div>
          {legacy && (
            <p className="mt-4 text-[11px] text-ink/40">
              {t('In this product you propose — the council signs. Astryum never signs, never holds custody.')}
            </p>
          )}
        </div>

        {/* El dial de la derecha: LTV real — deuda sobre
            colateral — con el mismo trazo OrbitDial del Protection buffer.
            0 = sin deuda (planeta aparcado), más órbita = más apalancado.
            Dato del snapshot/risk engine, jamás inventado. */}
        <div className="shrink-0 hidden sm:flex flex-col items-center self-center" aria-hidden>
          <div className="mb-1.5">
            <MicroLabel>LTV</MicroLabel>
          </div>
          <OrbitDial
            value={ltvPct}
            words={ltvPct != null ? (es ? 'de tu colateral' : 'of your collateral') : undefined}
            size={124}
          />
        </div>
      </Link>
    </div>
  );
}

function Reading({
  label,
  children,
  title,
}: {
  label: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <div title={title}>
      <div className="text-xs text-ink/40 mb-1.5">{label}</div>
      <div className="text-xl font-semibold tracking-tight">{children}</div>
    </div>
  );
}

// DonutFrame + DonutCard moved to components/dashboard/DonutCard (fusión)
// — the Portfolio's Overview renders them now.

// ── Recent alerts (mobile surface — desktop reads the health card counter) ────
/**
 * LA PUERTA DEL AVISO. El motor manda el deep-link de cada
 * disparo accionable —repago de la posición de Ethereum, propuesta del consejo,
 * pago programado, escrow— y hasta hoy ese enlace viajaba SOLO en el push. Aquí
 * la fila era texto muerto: «Ethereum repay ready to prepare» y a buscarte la
 * vida, con el reloj de la liquidación corriendo. Es el hallazgo H4 («un aviso
 * que no abre nada es un aviso que miente») reentrando por la superficie de al
 * lado, que además es la que se lee en escritorio, donde no hay push.
 *
 * Solo se convierte en enlace lo que trae `data.url` y es una ruta interna: un
 * aviso sin puerta se sigue pintando como antes (no se inventa un destino), y
 * un `url` que no empiece por `/` no se sigue jamás — el dato viene de la BD y
 * un enlace externo en una alerta es un vector de phishing, no una comodidad.
 */
function alertHref(a: Alert): string | null {
  const url = (a.data as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== 'string') return null;
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  return url;
}

function AlertsPanel({ alerts, t }: { alerts: Alert[]; t: (s: string) => string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t('Recent alerts')}</h2>
        <Link href="/app/portfolio?tab=activity" className="text-sm text-volt hover:text-volt/80 inline-flex items-center gap-1">
          {t('View all')} <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
        </Link>
      </div>
      <Card spotlight padded={false} className="overflow-hidden">
        <ul>
          {alerts.map((a) => {
            const href = alertHref(a);
            const row = (
              <>
                <Pill tone={SEV_TONE[a.severity] ?? 'neutral'}>{a.severity}</Pill>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-ink/90 truncate">{a.title}</div>
                  <div className="text-sm text-ink/45 truncate mt-0.5">{a.message}</div>
                  {href && (
                    <span className="text-[11px] text-volt inline-flex items-center gap-1 mt-1">
                      {t('Open it')} <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
                    </span>
                  )}
                </div>
                <div className="text-xs text-ink/30 font-mono whitespace-nowrap pt-1">
                  {new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </>
            );
            return (
              <li key={a.id} className="border-b border-ink/[0.04] last:border-0">
                {href ? (
                  <Link href={href} className="flex items-start gap-3.5 p-4 hover:bg-ink/[0.03] transition-colors">
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3.5 p-4">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

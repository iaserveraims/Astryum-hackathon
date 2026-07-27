'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Wallet, ArrowRight, Sparkles, Eye, EyeOff } from 'lucide-react';
import { AsteroidMark, Card, HairlineGroup, HairlineCell, MicroLabel, Pill } from '@/components/ui/primitives';
import { CountUp, RevealGroup, RevealItem, Spotlight } from '@/components/ui/motion';
import { AllocationDonut, AllocationLegend, OrbitDial } from '@/components/ui/charts';
// PerformanceCard is UNMOUNTED (founder 2026-07-25: "me gusta, pero no le veo
// mucho el sentido" + the one-viewport contract below). Preserved whole at
// components/dashboard/PerformanceCard.tsx — its slot now hosts WalletsBand.
// NetworkStatusCard is UNMOUNTED (founder 2026-07-25): network fees belong
// NEXT TO each operation before the user signs, not floating on the Summary.
// Component preserved at components/dashboard/NetworkStatusCard.tsx for that
// per-operation migration; its header slot now hosts OrbitStatusCard.
import OrbitStatusCard from '@/components/dashboard/OrbitStatusCard';
import DemoCapUsageCard from '@/components/dashboard/DemoCapUsageCard';
import ProductTour from '@/components/onboarding/ProductTour';
// ProductModeCard is UNMOUNTED (founder 2026-07-18): the product toggle moved
// to the sidebar (components/authority/ProductToggle.tsx). Card preserved at
// components/dashboard/ProductModeCard.tsx.
// LegacySummaryPanel (the standalone Legacy hero) is UNMOUNTED (founder
// 2026-07-18): the Legacy is "una wallet más" — its data feeds the EXISTING
// Net worth / Health organisms below instead of a parallel section. The
// component is preserved at components/dashboard/LegacySummaryPanel.tsx.
import { useAuthorities } from '@/hooks/useAuthorities';
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
import { useAuthorityWallets } from '@/hooks/useAuthorityWallets';
import { walletColorResolver, walletIconResolver, type WalletIconSlug } from '@/lib/walletIdentity';
import WalletGlyphIcon from '@/components/wallet/WalletGlyphIcon';
import { useAggregatedPortfolio } from '@/hooks/useAggregatedPortfolio';
import { EVM_ADDRESS_RE } from '@/lib/portfolioMerge';
import { healthScoreFromHF, healthTone, healthWords } from '@/lib/healthScore';
import { useBalanceVisibility, MASK } from '@/stores/balanceVisibilityStore';
import { formatMoney, formatMoneyCompact } from '@/lib/formatMoney';

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
type WalletSlice = {
  address: string;
  snap: PortfolioSnapshot;
  risk: RiskSnapshot | null;
  history: HistoryPoint[];
};

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

// Real token quantities per asset, derived from the snapshot's positions
// (qty = amountUSD / priceUSD when the position carries a live price). Assets
// without a price stay undefined and render as no quantity — never invented.
function assetQuantities(positions: PortfolioSnapshot['positions']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions) {
    const usd = typeof p.amountUSD === 'number' ? p.amountUSD : 0;
    const price = typeof p.priceUSD === 'number' ? p.priceUSD : 0;
    const asset = typeof p.asset === 'string' ? p.asset : '';
    if (!asset || usd === 0 || price <= 0) continue;
    out[asset] = (out[asset] ?? 0) + Math.abs(usd) / price;
  }
  return out;
}

// Engine kind enums → words a person would use (same register as Portfolio).
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

// Kinds that actually generate for the holder — idle wallet balance (free) and
// open debt (borrow) sit in the portfolio but earn nothing, so the "Assets
// Earning" donut would lie if it counted them.
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
  // Portfolio comes from the shared reactive store (survives navigation, paints
  // instantly on return, refreshes invisibly) — no per-page fetch/flash.
  const { data: aggregated } = useAggregatedPortfolio();
  const snap = useMemo(
    () => (aggregated?.snap ? normaliseSnap(aggregated.snap) : null),
    [aggregated],
  );
  const riskSnap = aggregated?.risk ?? null;
  const perWallet = (aggregated?.perWallet ?? []) as WalletSlice[];
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  // Real count of enabled, protective automation rules guarding any connected
  // wallet — never invented. null = still loading (renders as an em dash).
  const [protections, setProtections] = useState<number | null>(null);

  // The ONE source, scoped to the ACTIVE AUTHORITY (switcher): overview =
  // every simple wallet, single = that wallet, governed = the council account.
  // Same scope as Portfolio/Capital Map — surfaces can never disagree.
  // `walletsResolving` is true until wallets AND authorities have loaded — used
  // below to hold the welcome/dashboard decision so the page reveals ONCE.
  const { wallets: myWallets, loading: walletsResolving } = useAuthorityWallets();
  const walletsKey = myWallets.map((w) => w.address).join(',').toLowerCase();

  // Nickname per wallet (editable any time in Wallets) — addresses never show
  // when the user has named the wallet.
  const labelFor = useMemo(() => {
    const key = (a: string) => (EVM_ADDRESS_RE.test(a) ? a.toLowerCase() : a);
    const map = new Map<string, string>();
    for (const w of myWallets) if (w.label) map.set(key(w.address), w.label);
    return (a: string) => map.get(key(a)) ?? `${a.slice(0, 6)}…${a.slice(-4)}`;
  }, [myWallets]);

  // The wallet's personal colour follows it everywhere (walletIdentity):
  // the same hue in Wallets, these rows, and the performance bars.
  const colorFor = useMemo(() => walletColorResolver(myWallets), [myWallets]);
  // Same idea, one layer further: an optional personal glyph. When set, rows
  // below swap the plain colour dot for the glyph painted in that colour.
  const iconFor = useMemo(() => walletIconResolver(myWallets), [myWallets]);

  useEffect(() => {
    // Alerts cover EVERY connected wallet — same scope as net worth/HF. The
    // /alerts endpoint takes one address, so fan out per wallet and merge,
    // deduping by id and summing the real per-wallet counts (each capped
    // server-side at 100, not at the 4 rows we render).
    const addresses = myWallets.map((w) => w.address).filter((a) => EVM_ADDRESS_RE.test(a));
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
    const addresses = myWallets.map((w) => w.address);
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

  const hasPositions = !!snap && snap.positions.length > 0;
  // Wallet connected, snapshot loaded, nothing in it — the moment the
  // dashboard should nudge toward Earn instead of just showing empty charts.
  const noPositionsYet = !!snap && !hasPositions;

  // Product coherence (founder 2026-07-18): the Legacy is "una wallet más" —
  // when a governed authority is active the SAME organisms below read its
  // account (useAuthorityWallets already swapped the portfolio's address set).
  // Here we only add the governance differences, straight from the ONE source
  // of truth (useAuthorities: ledger reads minute-cached, ADR-011).
  const { activeGoverned } = useAuthorities();
  const legacyMode = !!activeGoverned;
  const governed = activeGoverned;

  // The dashboard belongs to anyone with capital linked: a SIWE login address
  // OR any wallet connected from the Wallets tab (email/passkey accounts have
  // no user.address, and an XRPL-only user must still see their capital).
  // In Legacy mode the surface is the loaded Legacy itself.
  const hasCapitalSurface = legacyMode ? !!governed : !!address || myWallets.length > 0;

  // Load-once, reveal-once (bug 2026-07-21: "carga una vez, no lo carga todo y
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

  // "Assets Earning" ring: the earning kinds when any exist; otherwise the
  // honest complement — all capital idle — so the ring is present whenever
  // there IS capital (an empty box reads as a bug, not as "nothing earns").
  const earningData = prettyKinds(onlyEarningKinds(snap?.breakdown.byKind ?? {}));
  const earningTotal = Object.values(earningData).reduce((s, v) => s + v, 0);
  const generatingDonut =
    earningTotal > 0.01
      ? earningData
      : (snap?.totalUSD ?? 0) > 0.01
        ? { [es ? 'Sin generar' : 'Not earning']: snap!.totalUSD }
        : {};

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

  return (
    /* One-viewport contract (founder 2026-07-25: "que no tenga scroll, que se
       vea todo en una carga"): on lg+ the column takes exactly the viewport
       minus the shell's py-8 and every band is shrink-0 EXCEPT the donuts row,
       which flexes and lets its donuts scale down. No overflow-hidden — on a
       genuinely tiny window the page still scrolls rather than cutting
       content. Below lg the page stacks and scrolls naturally, as ever. */
    <RevealGroup className="flex flex-col gap-4 lg:h-[calc(100dvh-4rem)] lg:min-h-[560px]" stagger={0.045}>
      {/* Greeting + live network telemetry, sharing the header band. The ONE
          brand moment of the page: the asteroid mark, the mission line, and
          the pilot's name carrying the landing's gold sweep. */}
      <RevealItem className="shrink-0 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <AsteroidMark size={15} />
            <MicroLabel>
              {legacyMode
                ? es ? 'Astryum Legacy · capital bajo reglas' : 'Astryum Legacy · capital under rules'
                : es ? 'Astryum · plano de control' : 'Astryum · control plane'}
            </MicroLabel>
          </div>
          <h1 className="text-[26px] md:text-[30px] font-semibold tracking-tight leading-[1.1] text-ink text-balance">
            {greeting}, <span className="text-gold-sweep font-semibold">{pilotName}</span>
          </h1>
          <p className="text-ink/55 mt-2 text-sm">{t('Here is where your capital stands today.')}</p>
        </div>
        {/* The product toggle left this header (founder 2026-07-18): it lives
            in the sidebar slot (ProductToggle). Only telemetry remains here. */}
        {/* First-run coachmarks: the sidebar explained once, right here in
            the Summary. Skips any target the current mode hides; replayable
            from Settings. The 'switcher' anchor now lives on the sidebar's
            product toggle (the slot that replaced the account switcher). */}
        <ProductTour
          tour="summary"
          steps={[
            { target: null, title: t('Welcome aboard'), body: t('This is your control deck. A one-minute walk through the sidebar and you will know where everything lives. You can skip and replay it any time from Settings.') },
            { target: 'switcher', title: t('Two products, one dashboard'), body: t('Astryum Personal and Astryum Legacy. Flip it here — the whole dashboard re-tints and the menu follows the product you are operating.') },
            { target: 'nav-summary', title: t('Summary'), body: t('The overview: net worth, health, alerts and how each wallet is performing — always scoped to the active account.') },
            { target: 'nav-asset-production', title: t('Earn'), body: t('Where capital goes to work: ready-made strategies, the AI agent, and your strategy registry. You always sign in your own wallet.') },
            { target: 'nav-legacy', title: t('Legacy'), body: t('Council-governed accounts: capital under rules that a quorum signs. Constitute one or govern the ones you sit on.') },
            { target: 'nav-portfolio', title: t('Portfolio'), body: t('Every position, token and movement across your wallets — with filters, health readings and export.') },
            { target: 'nav-wallets', title: t('Wallets'), body: t('Connect, watch and manage your wallets: colours, nicknames, permissions and what counts in your totals.') },
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

      {showWelcome && (
        <RevealItem>
          <WelcomePanel es={es} t={t} />
        </RevealItem>
      )}

      {showDashboard && (
        <>
          {/* ONE hero organism: net worth and health share a single panel,
              separated by a hairline — the state of your capital reads as one
              breath, not two competing boxes. Compacted 2026-07-25: the
              per-wallet rows moved OUT to WalletsBand below, so this panel is
              a short reading, not a tower. */}
          <RevealItem className="shrink-0">
            {/* Cursor light travels across the hero like the landing's
                spotlight cards — the panel feels lit, not painted. */}
            <Spotlight className="rounded-2xl">
              <HairlineGroup columns="lg:grid-cols-2">
                <HairlineCell className="p-5 md:p-6">
                  <NetWorthCard
                    snap={snap}
                    es={es}
                    t={t}
                    legacy={
                      governed
                        ? {
                            nickname: governed.label || getLegacyNickname(governed.address),
                            address: governed.address,
                            health: governed.health,
                            total: governed.memberCount,
                            signed: governed.status?.signedCount,
                          }
                        : null
                    }
                  />
                </HairlineCell>
                <HairlineCell className="p-5 md:p-6">
                  <HealthCard
                    snap={snap}
                    riskSnap={riskSnap}
                    protections={protections}
                    es={es}
                    t={t}
                    legacy={!!governed}
                  />
                </HairlineCell>
              </HairlineGroup>
            </Spotlight>
          </RevealItem>

          {noPositionsYet && (
            <RevealItem className="shrink-0">
              <NoPositionsCTA es={es} t={t} />
            </RevealItem>
          )}

          {/* The wallets, promoted to their own band (founder 2026-07-25):
              they used to sit squeezed under the net-worth figure. Rows link
              to Wallets — each card of the Summary sends you where its
              content is managed. */}
          {perWallet.length > 0 ? (
            <RevealItem className="shrink-0">
              <WalletsBand perWallet={perWallet} labelFor={labelFor} colorFor={colorFor} iconFor={iconFor} es={es} t={t} />
            </RevealItem>
          ) : !aggregated ? (
            /* Skeleton with the band's real footprint, so the page doesn't
               reflow-and-collide when the wallets resolve a beat later
               (founder 2026-07-25: "se queda medio bugeado… las cards
               pegadas unas con otras"). */
            <RevealItem className="shrink-0">
              <Card padded={false} className="overflow-hidden" aria-hidden>
                <div className="px-5 pt-3.5 pb-2.5">
                  <div className="h-4 w-24 animate-pulse rounded bg-ink/[0.06]" />
                </div>
                <div className="border-t border-ink/[0.05] px-5 py-2 space-y-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="flex items-center gap-3 py-2">
                      <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-ink/[0.08]" />
                      <div className="h-3.5 w-28 animate-pulse rounded bg-ink/[0.06]" />
                      <div className="h-1.5 flex-1 animate-pulse rounded-full bg-ink/[0.05]" />
                      <div className="h-3.5 w-20 animate-pulse rounded bg-ink/[0.06]" />
                    </div>
                  ))}
                </div>
              </Card>
            </RevealItem>
          ) : null}

          {/* Destinations (founder 2026-07-25): My Assets → Portfolio;
              Assets Earning → the strategy registry inside Earn. */}
          <RevealItem className="flex-1 min-h-0 grid gap-4 lg:grid-cols-2">
            <DonutCard
              title={t('My Assets')}
              data={snap?.breakdown.byAsset ?? {}}
              qty={hasPositions && snap ? assetQuantities(snap.positions) : undefined}
              href="/app/portfolio"
              loading={!snap}
            />
            <DonutCard
              title={t('Assets Earning')}
              data={generatingDonut}
              href="/app/asset-production?view=strategies"
              loading={!snap}
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
function WelcomePanel({ es, t }: { es: boolean; t: (s: string) => string }) {
  return (
    <Card glow spotlight padded={false} className="relative overflow-hidden p-8 md:p-12">
      <div
        className="absolute -top-28 -right-20 w-96 h-96 rounded-full blur-[120px] pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--volt) / 0.12), transparent 70%)' }}
        aria-hidden
      />
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
          <Link
            href="/app/wallets"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-volt text-volt-ink text-sm font-semibold hover:brightness-105 transition-all shadow-[0_8px_24px_-10px_hsl(var(--volt)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
          >
            <Wallet className="w-4 h-4" strokeWidth={2} /> {t('Connect wallet')}
          </Link>
          <Link
            href="/app/asset-production"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-ink/10 bg-ink/[0.03] text-ink/80 text-sm hover:bg-ink/[0.06] hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
          >
            {t('Explore Earn')} <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      </div>
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
// The per-wallet rows moved to WalletsBand (2026-07-25); a "pulse" strip
// (trailing gains + working share) briefly filled the room they left and was
// REMOVED the next day (founder 2026-07-26: "deja el net worth como antes,
// sin nada") — the figure breathes alone, vertically centred.
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
   *  card, one more wallet, with its governance stated (founder 2026-07-18).
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
        {/* Council reading, small, right beside the balance (founder ask). */}
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
    </div>
  );
}

// Deposit-aware P&L range (founder 2026-07-26: "si el usuario mete de golpe
// 1000 XRP que no suba al 200%"): without flow data, a single-step jump that
// is BOTH >25% of the previous snapshot and >$50 is treated as money moved
// in/out — a baseline shift, not performance — and excluded from the profit
// curve. The all-time low/high are then the extremes of that adjusted curve
// (P&L basis: 0 = the first snapshot). An approximation, honestly labelled:
// real flow accounting needs deposit/withdrawal records the frontend doesn't
// have yet.
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

// ── Wallets band — the per-wallet rows, promoted to their own organism ────────
// They used to sit squeezed under the net-worth figure; now they take the full
// width Capital Performance occupied (preserved at
// components/dashboard/PerformanceCard.tsx). Each row: the wallet's identity
// (glyph + colour), its 3-level health dot, its P&L RANGE — all-time low to
// all-time high of the deposit-adjusted profit curve (pnlRange above), with
// the marker at today — and its net worth. Rows link to Wallets (founder
// 2026-07-25: "los tokens te manden a las wallets").
function WalletsBand({
  perWallet,
  labelFor,
  colorFor,
  iconFor,
  es,
  t,
}: {
  perWallet: WalletSlice[];
  labelFor: (a: string) => string;
  colorFor: (a: string) => string;
  iconFor: (a: string) => WalletIconSlug | null;
  es: boolean;
  t: (s: string) => string;
}) {
  const hidden = useBalanceVisibility((s) => s.hidden);
  // 3 security levels, colour only: green = healthy, amber = watch, red = danger.
  const dotBg: Record<string, string> = {
    success: 'bg-tone-success',
    warning: 'bg-tone-warning',
    danger: 'bg-tone-danger',
    neutral: 'bg-ink/25',
  };
  const rows = [...perWallet].sort((a, b) => (b.snap.netWorthUSD ?? 0) - (a.snap.netWorthUSD ?? 0));
  return (
    <Card spotlight padded={false} className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-3.5 pb-2.5">
        <h3 className="text-[15px] font-semibold tracking-tight text-ink">
          {t('Wallets')}
          <span className="ml-2 text-xs font-normal text-ink/35">{rows.length}</span>
        </h3>
        <Link
          href="/app/wallets"
          className="inline-flex items-center gap-1 text-[11px] text-ink/40 hover:text-volt transition-colors"
        >
          {es ? 'Gestionar' : 'Manage'} <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
        </Link>
      </div>
      {/* Two columns past 3 wallets so the band never grows the page past the
          one-viewport contract. */}
      <div className={`border-t border-ink/[0.05] px-5 py-2 ${rows.length > 3 ? 'lg:grid lg:grid-cols-2 lg:gap-x-8' : ''}`}>
        {rows.map((w) => {
          const hf = typeof w.risk?.healthFactor === 'number' ? w.risk.healthFactor : null;
          const hasDebt = (w.snap.debtUSD ?? 0) > 0.01;
          const tone = healthTone(healthScoreFromHF(hf, hasDebt));
          const color = colorFor(w.address);
          const icon = iconFor(w.address);
          const range = pnlRange(w.history);
          const span = range ? range.ath - range.atl : 0;
          const pos = range && span > 0 ? ((range.cur - range.atl) / span) * 100 : 50;
          return (
            <Link
              key={w.address}
              href="/app/wallets"
              title={
                es
                  ? 'Recorrido de beneficio de la wallet (depósitos y retiradas descontados): mínimo histórico · hoy · máximo histórico'
                  : 'The wallet’s profit range (deposits and withdrawals excluded): all-time low · today · all-time high'
              }
              className="group flex items-center gap-3 rounded-lg px-1 -mx-1 py-2 hover:bg-ink/[0.025] transition-colors"
            >
              {/* Personal glyph (walletIdentity) wins when set, painted in the
                  wallet's own colour; otherwise the plain colour dot. */}
              {icon ? (
                <WalletGlyphIcon icon={icon} size={14} color={color} className="shrink-0" />
              ) : (
                <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-ink/20" style={{ background: color }} aria-hidden />
              )}
              <span className="w-28 md:w-32 truncate text-[13px] text-ink/80">{labelFor(w.address)}</span>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotBg[tone]}`} aria-hidden />
              {/* P&L range — ATL to ATH of the deposit-adjusted curve, marker
                  at today. Easy read: left is the worst it's been, right the
                  best, and the dot is where the wallet stands now. */}
              {range ? (
                <>
                  <span className="hidden sm:block w-14 text-right font-mono tabular-nums text-[10px] text-tone-danger/90 shrink-0">
                    {hidden ? MASK : signedMoney(range.atl)}
                  </span>
                  <span
                    className="relative h-1.5 flex-1 rounded-full"
                    style={{
                      background:
                        'linear-gradient(90deg, hsl(var(--tone-danger) / 0.22), hsl(var(--ink) / 0.05) 50%, hsl(var(--tone-success) / 0.22))',
                    }}
                  >
                    <span
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-2 ring-surface-1 transition-[left] duration-500"
                      style={{ left: `calc(${Math.max(0, Math.min(100, pos))}% - 5px)`, background: color }}
                    />
                  </span>
                  <span className="hidden sm:block w-14 font-mono tabular-nums text-[10px] text-tone-success/90 shrink-0">
                    {hidden ? MASK : signedMoney(range.ath)}
                  </span>
                </>
              ) : (
                <span className="flex-1 text-center text-[10px] text-ink/25">
                  {es ? 'historial en construcción' : 'history building'}
                </span>
              )}
              <span className="w-24 text-right font-mono tabular-nums text-sm text-ink shrink-0">
                {hidden ? MASK : formatMoney(w.snap.netWorthUSD)}
              </span>
              <ArrowRight className="w-3.5 h-3.5 shrink-0 text-ink/25 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

// ── Position health — simple, honest, one small ornament ────────────────────
// History of this card, so nobody re-grows it: the "Capital in orbit" dial
// left 2026-07-25 (repeated Assets Earning + blended score read as unreal
// risk); a data-dense v2 (open debt figure, per-wallet HF strip) left the
// next day (founder 2026-07-26: "déjalo simple y con algún artefacto visual
// sencillo"). What stays: the honest posture (no debt = nothing can be
// liquidated), the three readings, and ONE ornament — a dashed orbit whose
// moonlet wears the REAL health tone. Decoration reflecting truth, no
// invented number.
function HealthCard({
  snap,
  riskSnap,
  protections,
  es,
  t,
  legacy = false,
}: {
  snap: PortfolioSnapshot | null;
  riskSnap: RiskSnapshot | null;
  protections: number | null;
  es: boolean;
  t: (s: string) => string;
  /** Legacy product mode: gates the "you propose" line. The council reading
   *  itself lives beside the balance in NetWorthCard (founder 2026-07-18). */
  legacy?: boolean;
}) {
  const hf = typeof riskSnap?.healthFactor === 'number' ? riskSnap.healthFactor : null;
  const hasDebt = (snap?.debtUSD ?? 0) > 0.01;

  const hfTone = hf == null ? 'text-ink' : hf < 1.2 ? 'text-tone-danger' : hf < 1.5 ? 'text-tone-warning' : 'text-tone-success';

  // HF sobre 100 (founder 2026-07-26, "ejemplo 10/100"): la escala calibrada
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
        {/* Founder 2026-07-26: sin titular de postura ni riskScore — el summary
            son ESTAS dos lecturas, todo centrado en la card. */}
        <div className="min-w-0 self-center">
          <div className="mb-4">
            <MicroLabel>{es ? 'Salud de posiciones' : 'Position health'}</MicroLabel>
          </div>
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <Reading label={es ? 'Protecciones activas' : 'Active protections'}>
              <span className={`font-mono ${protections != null && protections > 0 ? 'text-tone-success' : 'text-ink'}`}>
                {protections != null ? protections : '—'}
              </span>
            </Reading>
            <Reading label={es ? 'Salud' : 'Health'} title={hfScoreTitle}>
              <span className={`font-mono ${snap && !hasDebt ? 'text-tone-success' : hfTone}`}>
                {hfScore != null ? `${hfScore}/100` : '—'}
              </span>
            </Reading>
          </div>
          {legacy && (
            <p className="mt-4 text-[11px] text-ink/40">
              {t('In this product you propose — the council signs. Astryum never signs, never holds custody.')}
            </p>
          )}
        </div>

        {/* El dial de la derecha (founder 2026-07-26): LTV real — deuda sobre
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

// ── Allocation donuts — clickable, distinct colours, no caption noise ─────────
function DonutCard({
  title,
  data,
  qty,
  href,
  loading = false,
}: {
  title: string;
  data: Record<string, number>;
  qty?: Record<string, number>;
  href: string;
  /** Snapshot still on its way: hold the donut's footprint with a quiet pulse
      instead of flashing "Nothing to chart yet" and reflowing when it lands. */
  loading?: boolean;
}) {
  const { t } = useT();
  const empty = Object.keys(data).length === 0;
  return (
    <Link href={href} className="group block h-full min-h-0">
      <Card hover spotlight padded={false} className="h-full p-5 flex flex-col">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h3>
          <ArrowRight className="w-4 h-4 shrink-0 text-ink/30 -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" />
        </div>
        {empty && loading ? (
          <div className="flex-1 flex items-center gap-6 py-4" aria-hidden>
            <div className="m-2 h-[170px] w-[170px] shrink-0 animate-pulse rounded-full border-[22px] border-ink/[0.05]" />
            <div className="flex-1 space-y-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-3.5 animate-pulse rounded bg-ink/[0.05]" style={{ width: `${78 - i * 18}%` }} />
              ))}
            </div>
          </div>
        ) : empty ? (
          <div className="flex-1 grid place-items-center py-10 text-ink/40 text-sm">{t('Nothing to chart yet')}</div>
        ) : (
          /* Donut big on the left, legend breathing on the right — one organic
             read: shape first, detail beside it. Stacks on small screens.
             A dashed outer ring with a moonlet turns the allocation into a
             small orbital system — the landing's solar hero, miniaturised.
             On lg the donut takes whatever height the one-viewport contract
             left for this row (AllocationDonut `fill`), instead of a fixed
             box forcing the page to scroll. */
          <div className="flex-1 min-h-0 flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
            <div className="relative shrink-0 m-2 w-[190px] h-[190px] md:w-[210px] md:h-[210px] lg:w-auto lg:h-[calc(100%-1rem)] lg:min-h-[140px] lg:max-h-[216px] lg:aspect-square">
              <div className="donut-orbit absolute -inset-2.5 rounded-full border border-dashed border-volt/20" aria-hidden>
                <span
                  className="absolute w-[5px] h-[5px] rounded-full bg-volt-soft"
                  style={{ top: '3%', left: '50%', boxShadow: '0 0 8px hsl(var(--volt-soft) / 0.9), 0 0 20px hsl(var(--volt) / 0.5)' }}
                />
              </div>
              <AllocationDonut data={data} fill />
            </div>
            <div className="flex-1 w-full min-w-0 sm:pr-2">
              <AllocationLegend data={data} qty={qty} showUSD />
            </div>
          </div>
        )}
      </Card>
    </Link>
  );
}

// ── Recent alerts (mobile surface — desktop reads the health card counter) ────
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
          {alerts.map((a) => (
            <li key={a.id} className="flex items-start gap-3.5 p-4 border-b border-ink/[0.04] last:border-0">
              <Pill tone={SEV_TONE[a.severity] ?? 'neutral'}>{a.severity}</Pill>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink/90 truncate">{a.title}</div>
                <div className="text-sm text-ink/45 truncate mt-0.5">{a.message}</div>
              </div>
              <div className="text-xs text-ink/30 font-mono whitespace-nowrap pt-1">
                {new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

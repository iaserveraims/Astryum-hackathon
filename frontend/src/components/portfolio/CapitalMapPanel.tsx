'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Map, RefreshCw, Layers, Coins, BarChart2, Tag } from 'lucide-react';
import { type PortfolioSnapshot } from '../../services/v1Api';
import {
  buildCapitalView,
  type CapitalView,
} from '../../lib/portfolioMerge';
import { useMyWallets } from '../../hooks/useMyWallets';
import { useAggregatedPortfolio } from '../../hooks/useAggregatedPortfolio';
import {
  Card,
  EmptyState,
  GhostButton,
  PageHeader,
  Pill,
  SectionTitle,
  StatTile,
} from '../ui/primitives';
import { AuthRequired, hasAuthToken } from '../../lib/authError';
import { TokenLogo } from '../ui/TokenLogo';
import { RevealGroup, RevealItem, CountUp } from '../ui/motion';
import { useBalanceVisibility } from '../../stores/balanceVisibilityStore';
import { useT } from '../../i18n/LanguageProvider';
import { formatMoney, formatMoneyCompact } from '../../lib/formatMoney';

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  137: 'Polygon',
  42161: 'Arbitrum',
  8453: 'Base',
  14: 'Flare',
  56: 'BSC',
  10: 'Optimism',
  43114: 'Avalanche',
  900: 'Solana',
  1440002: 'XRPL',
};

// Snapshot kinds are lowercase canonical strings; display them in words.
const KIND_LABEL: Record<string, string> = {
  free: 'Free',
  collateral: 'Supplied',
  supply: 'Supplied',
  debt: 'Borrowed',
  borrow: 'Borrowed',
  staking: 'Staked',
  locked: 'Locked',
  stake: 'Staked',
  lp: 'LP',
  reward: 'Rewards',
  rewards: 'Rewards',
  other: 'Other',
};

const KIND_COLOR: Record<string, string> = {
  Free: 'text-tone-success',
  Supplied: 'text-volt',
  Borrowed: 'text-tone-danger',
  Staked: 'text-tone-warning',
  LP: 'text-volt',
  Rewards: 'text-lime-400',
  // Matches the KIND_COLOR[label] ?? fallback below — "Other" IS that
  // fallback tone, kept in the panel's existing text-white/* register (this
  // panel predates the ink/surface migration; out of scope here).
  Other: 'text-white/70',
};

type TabId = 'chain' | 'asset' | 'protocol' | 'kind';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'chain', label: 'By Chain', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'asset', label: 'By Asset', icon: <Coins className="w-3.5 h-3.5" /> },
  { id: 'protocol', label: 'By Protocol', icon: <BarChart2 className="w-3.5 h-3.5" /> },
  { id: 'kind', label: 'By Type', icon: <Tag className="w-3.5 h-3.5" /> },
];


/**
 * Capital Map — the connected-wallet portfolio, grouped through four lenses.
 *
 * Reads the SAME source as every other portfolio surface: the merged live
 * snapshot of the account's connected wallets (GET /api/wallets/mine fanned
 * out through GET /api/portfolio). The legacy watchlist pipeline is gone —
 * it disagreed with Portfolio ($0 vs real balances).
 *
 * `embedded` + `snap`: the Portfolio page passes its already-loaded (and
 * filter-aware) snapshot so the tab is literally the same data, zero fetches.
 * Standalone: fans out over the unified wallet list itself.
 */
export default function CapitalMapPanel({
  embedded = false,
  snap: providedSnap,
  walletCount: providedWalletCount,
}: {
  embedded?: boolean;
  snap?: PortfolioSnapshot | null;
  walletCount?: number;
}) {
  const { t } = useT();
  const { wallets, loading: walletsLoading } = useMyWallets();
  // Self-load reads the shared reactive store (instant on nav, refreshes
  // invisibly); when a snapshot is provided by the parent we use that instead.
  const selfLoading = providedSnap === undefined;
  const { data, loading: aggLoading, error: aggError, reload } = useAggregatedPortfolio();
  const ownSnap = data?.snap ?? null;
  const loading = selfLoading ? aggLoading : false;
  const error = selfLoading ? aggError : null;
  const [activeTab, setActiveTab] = useState<TabId>('chain');
  // Global hide-balances: every USD figure in the map masks with the app.
  const hidden = useBalanceVisibility((s) => s.hidden);
  const money = (usd: number) => formatMoney(usd, { masked: hidden });

  const snap = selfLoading ? ownSnap : providedSnap ?? null;
  const walletCount = providedWalletCount ?? wallets.length;

  const view: CapitalView | null = useMemo(
    () => (snap ? buildCapitalView(snap, walletCount) : null),
    [snap, walletCount],
  );

  // Nickname per wallet address — a position row must read "Apodo", never the
  // raw address, matching every other dashboard surface. EVM addresses compare
  // case-insensitively; XRPL/Solana are case-sensitive and compared verbatim.
  const walletLabel = useMemo(() => {
    // (`Map` here is the lucide icon — plain object instead of the global)
    const key = (a: string) => (/^0x[a-fA-F0-9]{40}$/.test(a) ? a.toLowerCase() : a);
    const labels: Record<string, string> = {};
    for (const w of wallets) if (w.label) labels[key(w.address)] = w.label;
    return (a: string) => labels[key(a)] ?? `${a.slice(0, 8)}…`;
  }, [wallets]);

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!embedded) {
    if (!hasAuthToken()) return <AuthRequired />;
    if (error === 'no_session') return <AuthRequired />;
    if (!walletsLoading && wallets.length === 0)
      return (
        <EmptyState
          icon={<Map className="w-8 h-8" strokeWidth={1.5} />}
          title="Connect a wallet to view your capital map"
          hint="The map reads the same connected wallets as the rest of the dashboard."
        />
      );
  }

  const actions = selfLoading ? (
    <div className="flex items-center gap-2">
      <GhostButton onClick={reload} disabled={loading}>
        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.5} />
      </GhostButton>
      {view && (
        <Pill tone="neutral" className="font-mono text-[10px]">
          {new Date(view.takenAt).toLocaleTimeString()}
        </Pill>
      )}
    </div>
  ) : undefined;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      {embedded ? (
        <SectionTitle
          hint={t('Live on-chain reads across your connected wallets — one source, every lens.')}
          actions={actions}
        >
          Capital Map
        </SectionTitle>
      ) : (
        <PageHeader
          eyebrow="Capital Map"
          title="Multi-chain capital overview"
          subtitle={t('Live on-chain reads across your connected wallets — one source, every lens.')}
          actions={actions}
        />
      )}

      {error && error !== 'no_session' && (
        <Card className="mb-4 border-tone-warning/20 bg-tone-warning/10">
          <div className="text-sm text-tone-warning/90">{t('Could not load the capital map right now.')}</div>
        </Card>
      )}

      {(loading || (selfLoading && walletsLoading)) && !view && (
        <div className="text-center py-16 text-white/40 text-sm">{t('Loading capital map…')}</div>
      )}

      {view && (
        <>
          {/* Summary stats — settle in sequence, figures counting up */}
          <RevealGroup className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <RevealItem>
              <StatTile
                label="Wallets"
                value={<CountUp value={view.walletCount} format={(v) => String(Math.round(v))} />}
              />
            </RevealItem>
            <RevealItem>
              <StatTile
                label="Positions"
                value={<CountUp value={view.totalPositions} format={(v) => String(Math.round(v))} />}
              />
            </RevealItem>
            <RevealItem>
              <StatTile
                label="Total value"
                value={hidden ? formatMoneyCompact(null, { masked: true }) : <CountUp value={view.totalUSD} format={formatMoneyCompact} />}
              />
            </RevealItem>
          </RevealGroup>

          {/* Tab switcher — scrolls horizontally on narrow screens. */}
          <div className="flex gap-1 mb-4 border-b border-white/10 overflow-x-auto scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px shrink-0 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-volt text-volt'
                    : 'border-transparent text-white/50 hover:text-white/80'
                }`}
              >
                {tab.icon}
                {t(tab.label)}
              </button>
            ))}
          </div>

          {/* Tab: By Chain */}
          {activeTab === 'chain' && (
            <div className="mb-6">
              {view.byChain.length === 0 ? (
                <EmptyState icon={<Layers className="w-6 h-6" />} title="No chain data yet" hint="Connect wallets to see the chain breakdown." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {view.byChain.map((c) => (
                    <Card key={c.chainId} padded className="flex flex-col gap-1">
                      <div className="text-sm font-medium text-white/90">
                        {CHAIN_NAMES[c.chainId] ?? `Chain ${c.chainId}`}
                      </div>
                      <div className="text-xs text-white/50 font-mono">
                        {c.positionCount} {c.positionCount !== 1 ? t('positions') : t('position')}
                      </div>
                      <div className="text-sm font-mono font-semibold tabular-nums text-white/80 mt-1">
                        {money(c.valueUSD)}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: By Asset */}
          {activeTab === 'asset' && (
            <div className="mb-6">
              {view.byAsset.length === 0 ? (
                <EmptyState icon={<Coins className="w-6 h-6" />} title="No asset data yet" hint="Connect wallets to see the asset breakdown." />
              ) : (
                <div className="space-y-2">
                  {view.byAsset.map((a) => (
                    <Card key={a.symbol} padded className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenLogo symbol={a.symbol} size="sm" className="shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-white/90 font-mono">{a.symbol}</div>
                          <div className="text-xs text-white/40 mt-0.5">
                            {a.chains.map((c) => CHAIN_NAMES[c] ?? `Chain ${c}`).join(' · ')}
                            {a.protocols.length > 0 &&
                              ` · ${a.protocols.slice(0, 2).join(', ')}${a.protocols.length > 2 ? `+${a.protocols.length - 2}` : ''}`}
                          </div>
                        </div>
                      </div>
                      <div className="text-sm font-mono font-semibold tabular-nums text-white/80 shrink-0">
                        {money(a.valueUSD)}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: By Protocol */}
          {activeTab === 'protocol' && (
            <div className="mb-6">
              {view.byProtocol.length === 0 ? (
                <EmptyState icon={<BarChart2 className="w-6 h-6" />} title="No protocol data yet" hint="Connect wallets to see the protocol breakdown." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {view.byProtocol.map((p, i) => (
                    <Card key={i} padded className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium text-white/90 capitalize">{p.protocol}</div>
                        <div className="text-xs text-white/50 font-mono mt-0.5">
                          {CHAIN_NAMES[p.chainId] ?? `Chain ${p.chainId}`} · {p.positionCount}{' '}
                          {p.positionCount !== 1 ? t('positions') : t('position')}
                        </div>
                      </div>
                      <span className="text-sm font-mono font-semibold tabular-nums text-white/80 shrink-0">
                        {money(p.valueUSD)}
                      </span>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: By Kind / Type */}
          {activeTab === 'kind' && (
            <div className="mb-6">
              {view.byKind.length === 0 ? (
                <EmptyState icon={<Tag className="w-6 h-6" />} title="No type data yet" hint="Connect wallets to see the position type breakdown." />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {view.byKind.map((k) => {
                    const label = KIND_LABEL[k.kind] ?? k.kind;
                    return (
                      <Card key={k.kind} padded className="flex flex-col gap-1">
                        <div className={`text-sm font-semibold ${KIND_COLOR[label] ?? 'text-white/70'}`}>
                          {t(label)}
                        </div>
                        <div className="text-xs text-white/50 font-mono">
                          {k.positionCount} {k.positionCount !== 1 ? t('positions') : t('position')}
                        </div>
                        <div className="text-sm font-mono font-semibold tabular-nums text-white/80 mt-1">
                          {money(k.valueUSD)}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Top Positions (always visible below tabs) */}
          {view.topPositions.length > 0 && (
            <div>
              <SectionTitle>Top Positions</SectionTitle>
              <div className="space-y-2">
                {view.topPositions.map((p) => (
                  <Card key={p.id} padded className="flex items-center gap-4">
                    <TokenLogo symbol={p.asset} size="sm" className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white/90 capitalize">{p.protocol}</div>
                      <div className="text-xs text-white/50 font-mono truncate">
                        {p.wallet ? `${walletLabel(p.wallet)} · ` : ''}
                        {KIND_LABEL[p.kind.toLowerCase()] ?? p.kind} · {p.asset}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-mono tabular-nums text-white/80">{money(p.valueUSD)}</div>
                      <div className="text-[10px] text-white/35 font-mono mt-1">
                        {CHAIN_NAMES[p.chainId] ?? `Chain ${p.chainId}`}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {view.totalPositions === 0 && (
            <EmptyState
              icon={<Map className="w-8 h-8" strokeWidth={1.5} />}
              title="No positions detected"
              hint="Connect wallets on the Wallets page — the map reads them live."
            />
          )}

          <p className="mt-8 text-[11px] text-white/30 text-center">
            {t('Live reads from the same source as Portfolio — verify on-chain before acting.')}
          </p>
        </>
      )}
    </motion.div>
  );
}

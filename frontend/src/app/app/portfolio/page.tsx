'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Eye, EyeOff, Wallet2, ShieldAlert, RefreshCw,
  TrendingUp, TrendingDown, Network,
  ExternalLink, Search, X, Filter,
} from 'lucide-react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  portfolioV1,
  type PortfolioSnapshot,
  type RiskSnapshot,
} from '../../../services/v1Api';
import { useAuthStore } from '../../../stores/authStore';
import { Card, MicroLabel, PageHeader, Pill, EmptyState, HairlineGroup, SegmentedControl } from '../../../components/ui/primitives';
import { CountUp, PulseDot, RevealGroup, RevealItem, Spotlight } from '../../../components/ui/motion';
import { formatMoney, formatMoneyCompact } from '../../../lib/formatMoney';
import { TokenLogo } from '../../../components/ui/TokenLogo';
import { AllocationDonut, AllocationLegend, OrbitDial, PerfLine, chartColorsFor } from '../../../components/ui/charts';
import { SceneDoor } from '../../../components/ui/SceneDoor';
import { CapitalField } from '../../../components/ui/scenes';
import { OrbitScene } from '../../../components/earn/icons';
import { useBalanceVisibility } from '../../../stores/balanceVisibilityStore';
import { AuthRequired, FriendlyError, hasAuthToken, isAuthError } from '../../../lib/authError';
import { useT } from '../../../i18n/LanguageProvider';
import CapitalMapPanel from '../../../components/portfolio/CapitalMapPanel';
import DefiPositionsBoard from '../../../components/positions/DefiPositionsBoard';
import ActivityPanel from '../activity/_self';
import { PositionHealthMeter } from '../../../components/risk/PositionHealthMeter';
import { groupPositionHealth } from '../../../lib/risk/positionHealth';
import {
  loadAggregatedPortfolio,
  type AggregatedPortfolio,
  type WalletRecord,
} from '../../../lib/portfolioMerge';
import { useAuthorityWallets } from '../../../hooks/useAuthorityWallets';
import { walletColor, walletIcon } from '../../../lib/walletIdentity';
import WalletGlyphIcon from '../../../components/wallet/WalletGlyphIcon';

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeRange = '24h' | '7d' | '30d' | '90d' | '1y';

interface HistoryPoint {
  t: string;
  value: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CHAIN_NAMES: Record<number, string> = {
  1:     'ETH',
  14:    'FLARE',
  56:    'BSC',
  137:   'POL',
  8453:  'Base',
  42161: 'Arb',
  10:    'OP',
  43114: 'AVAX',
  // Pseudo chain-id the backend assigns to XRPL — without it an XRPL
  // position reads "Chain 1440002" instead of its network.
  1440002: 'XRPL',
};

function chainLabel(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

// Full network names for the positions table — "POL"/"AVAX" style codes stay in
// the compact filter chips, but a data row should read like a network, not a slug.
const CHAIN_FULL: Record<number, string> = {
  1:     'Ethereum',
  14:    'Flare',
  56:    'BNB Chain',
  137:   'Polygon',
  8453:  'Base',
  42161: 'Arbitrum',
  10:    'Optimism',
  43114: 'Avalanche',
  1440002: 'XRPL',
};

function chainFullLabel(chainId: number): string {
  return CHAIN_FULL[chainId] ?? chainLabel(chainId);
}

// Raw protocolIds arrive as engine slugs ("wallet", "wallet-8453", "kinetic").
// "wallet-*" is a free balance sitting in the wallet itself — say so; anything
// else gets title-cased for display. Data stays untouched, only the label changes.
function prettyProtocol(id: string | undefined | null): string {
  const s = String(id ?? '').trim();
  if (!s) return '—';
  if (/^wallet(-\d+)?$/i.test(s)) return 'Wallet';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Position kinds are engine enums ("free", "supply"…) — translate them into
// words a person would use. Unknown kinds fall back to title case, never blank.
const KIND_LABEL: Record<string, string> = {
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

function kindLabel(kind: string | undefined | null): string {
  const k = String(kind ?? '').toLowerCase();
  if (!k) return '—';
  return KIND_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
}

// Real token amount for a position row (USD / live price). No price → no
// amount; we never invent a quantity.
function positionQty(p: { amountUSD?: number; priceUSD?: number }): number | null {
  const usd = typeof p.amountUSD === 'number' ? p.amountUSD : 0;
  const price = typeof p.priceUSD === 'number' ? p.priceUSD : 0;
  if (usd === 0 || price <= 0) return null;
  return Math.abs(usd) / price;
}

function fmtQty(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

// Re-key a breakdown map through a display formatter, merging buckets that
// collapse to the same label (wallet + wallet-14 + wallet-8453 → Wallet).
function prettifyKeys(
  data: Record<string, number>,
  fmt: (k: string) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(data)) {
    const label = fmt(k);
    out[label] = (out[label] ?? 0) + (v ?? 0);
  }
  return out;
}

// Where a position lives, in words: sitting in the wallet ("In Wallet") or out
// in a protocol ("Working" for lending legs, "Earning" for staking/LP/rewards).
// Deployed rows carry the exact leg + protocol as small subtext.
function locationInfo(p: { protocolId?: string; kind?: string }): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  sub: string | null;
} {
  const proto = String(p.protocolId ?? '');
  const kind = String(p.kind ?? '').toLowerCase();
  if (!proto || /^wallet(-\d+)?$/i.test(proto)) return { label: 'In Wallet', tone: 'neutral', sub: null };
  const pretty = prettyProtocol(proto);
  if (['debt', 'borrow'].includes(kind)) return { label: 'Working', tone: 'danger', sub: `${kindLabel(kind)} · ${pretty}` };
  if (['staking', 'stake', 'lp', 'rewards', 'reward'].includes(kind)) return { label: 'Earning', tone: 'info', sub: pretty };
  return { label: 'Working', tone: 'success', sub: `${kindLabel(kind)} · ${pretty}` };
}

// Nickname of the wallet a position belongs to (falls back to the short address).
function walletLabel(wallets: WalletRecord[], addr: string | undefined | null): string {
  if (!addr || addr === 'all') return '—';
  const found = wallets.find(
    (w) => w.address === addr || w.address.toLowerCase() === String(addr).toLowerCase(),
  );
  return found?.label ?? shortAddr(String(addr));
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TIME_RANGES: TimeRange[] = ['24h', '7d', '30d', '90d', '1y'];

// ─── Client-side filtering ──────────────────────────────────────────────────
// Everything in a snapshot derives from `positions` (each carries chainId,
// protocolId, kind, amountUSD). So network / search / dust filters are a pure
// client-side refinement: filter the positions and recompute the aggregates,
// then hand the smaller snapshot to the same section components.

function groupSum(
  positions: PortfolioSnapshot['positions'],
  key: 'asset' | 'protocolId' | 'kind',
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of positions) {
    const k = String((p as Record<string, unknown>)[key] ?? '—');
    out[k] = (out[k] ?? 0) + (p.amountUSD ?? 0);
  }
  return out;
}

interface PortfolioFilters {
  chainId: number | null;
  query: string;
  hideDust: boolean;
}

function applyFilters(snap: PortfolioSnapshot, f: PortfolioFilters): PortfolioSnapshot {
  const q = f.query.trim().toLowerCase();
  let positions = snap.positions;
  if (f.chainId !== null) positions = positions.filter((p) => (p.chainId ?? 14) === f.chainId);
  if (q)
    positions = positions.filter(
      (p) =>
        (p.asset ?? '').toLowerCase().includes(q) ||
        (p.protocolId ?? '').toLowerCase().includes(q),
    );
  if (f.hideDust) positions = positions.filter((p) => (p.amountUSD ?? 0) >= 1);

  const sumKinds = (kinds: string[]) =>
    positions
      .filter((p) => kinds.includes((p.kind ?? '').toLowerCase()))
      .reduce((s, p) => s + (p.amountUSD ?? 0), 0);
  const totalUSD = positions.reduce((s, p) => s + (p.amountUSD ?? 0), 0);
  const debtUSD = sumKinds(['debt', 'borrow']);
  const collateralUSD = sumKinds(['collateral', 'supply']);

  return {
    ...snap,
    positions,
    totalUSD,
    collateralUSD,
    debtUSD,
    netWorthUSD: totalUSD - debtUSD,
    breakdown: {
      ...snap.breakdown,
      byAsset: groupSum(positions, 'asset'),
      byProtocol: groupSum(positions, 'protocolId'),
      byKind: groupSum(positions, 'kind'),
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function kindTone(kind: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const k = (kind ?? '').toLowerCase();
  if (k === 'collateral' || k === 'supply') return 'success';
  if (k === 'debt' || k === 'borrow') return 'danger';
  if (k === 'lp' || k === 'staking' || k === 'stake') return 'info';
  if (k === 'rewards' || k === 'reward') return 'warning';
  return 'neutral';
}

// 3-tone scale (de-AI pass 2026-07-21): success ≥2, warning 1.5-2, danger <1.5 —
// the old 4-step orange/red split collapses into one danger tone.
function hfColor(hf?: number | null): string {
  if (hf == null) return 'text-ink/30';
  if (hf >= 2) return 'text-tone-success';
  if (hf >= 1.5) return 'text-tone-warning';
  return 'text-tone-danger';
}

function riskBadgeClass(level?: string): string {
  const map: Record<string, string> = {
    SAFE:     'bg-tone-success/15 text-tone-success border-tone-success/25',
    WATCH:    'bg-tone-warning/15 text-tone-warning border-tone-warning/25',
    WARNING:  'bg-tone-warning/15 text-tone-warning border-tone-warning/25',
    DANGER:   'bg-tone-danger/15  text-tone-danger  border-tone-danger/25',
    CRITICAL: 'bg-tone-danger/15  text-tone-danger  border-tone-danger/25',
  };
  return map[level ?? ''] ?? 'bg-ink/5 text-ink/40 border-ink/10';
}

function pctOf(v: number, total: number): string {
  if (!total) return '0%';
  return `${((v / total) * 100).toFixed(1)}%`;
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ─── Filter bar ─────────────────────────────────────────────────────────────
// One interactive control strip: wallet · network · time range · search · dust.

function FilterBar({
  wallets,
  activeWallet,
  onWalletChange,
  timeRange,
  onTimeRangeChange,
  networks,
  network,
  onNetworkChange,
  query,
  onQueryChange,
  hideDust,
  onHideDustToggle,
  balanceVisible,
  onBalanceToggle,
  filtersActive,
  onClearFilters,
  resultCount,
}: {
  wallets: WalletRecord[];
  activeWallet: string;
  onWalletChange: (a: string) => void;
  timeRange: TimeRange;
  onTimeRangeChange: (t: TimeRange) => void;
  networks: number[];
  network: number | null;
  onNetworkChange: (n: number | null) => void;
  query: string;
  onQueryChange: (q: string) => void;
  hideDust: boolean;
  onHideDustToggle: () => void;
  balanceVisible: boolean;
  onBalanceToggle: () => void;
  filtersActive: boolean;
  onClearFilters: () => void;
  resultCount: number;
}) {
  const { t } = useT();
  // The filter bar's ONE content-filter species: a rounded-full chip, on or
  // off. Network and dust both use it; Range is the other species (a compact
  // SegmentedControl) — two species max, no hand-drawn checkboxes.
  const chip = (on: boolean) =>
    `flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium shrink-0 transition-all border ${
      on
        ? 'bg-volt/15 text-volt border-volt/30'
        : 'text-ink/45 border-ink/10 hover:text-ink/70 hover:border-ink/20'
    }`;

  return (
    <div className="px-5 py-3.5 flex flex-col gap-3">
      {/* Row 1 — wallets + search */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1 min-w-0">
          <button onClick={() => onWalletChange('all')} className={chip(activeWallet === 'all')}>
            <Wallet2 className="w-3 h-3" strokeWidth={1.5} />
            {t('All wallets')}
          </button>
          {wallets.map((w) => {
            const glyph = walletIcon(w);
            return (
              <button
                key={w.address}
                onClick={() => onWalletChange(w.address)}
                className={chip(activeWallet === w.address)}
              >
                {/* The wallet's personal colour/glyph (walletIdentity) — same
                    identity as in Wallets and the Summary rows. */}
                {glyph ? (
                  <WalletGlyphIcon icon={glyph} size={12} color={walletColor(w)} className="shrink-0" />
                ) : (
                  <span
                    className="w-2 h-2 rounded-full shrink-0 ring-1 ring-ink/20"
                    style={{ background: walletColor(w) }}
                  />
                )}
                {w.label ?? shortAddr(w.address)}
              </button>
            );
          })}
        </div>
        <div className="relative shrink-0">
          <Search
            className="w-3.5 h-3.5 text-ink/30 absolute left-2.5 top-1/2 -translate-y-1/2"
            strokeWidth={2}
          />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('Search asset or protocol…')}
            className="w-40 sm:w-56 pl-8 pr-7 py-1.5 rounded-full bg-ink/[0.04] border border-ink/10 text-xs text-ink placeholder-ink/30 focus:outline-none focus:border-volt/40 transition-colors"
          />
          {query && (
            <button
              onClick={() => onQueryChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink/30 hover:text-ink/70"
              aria-label={t('Clear search')}
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2 — network · range · dust · clear */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => onNetworkChange(null)} className={chip(network === null)}>
            {t('All')}
          </button>
          {networks.map((c) => (
            <button key={c} onClick={() => onNetworkChange(c)} className={chip(network === c)}>
              {chainLabel(c)}
            </button>
          ))}
        </div>

        <SegmentedControl<TimeRange>
          layoutId="portfolio-range-pill"
          value={timeRange}
          onChange={onTimeRangeChange}
          options={TIME_RANGES.map((r) => ({ key: r, label: r.toUpperCase() }))}
        />

        <button onClick={onHideDustToggle} className={chip(hideDust)}>
          {t('Hide dust (<$1)')}
        </button>

        <button
          onClick={onBalanceToggle}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
            balanceVisible ? 'text-ink/30 hover:text-ink/60' : 'bg-volt/15 text-volt'
          }`}
        >
          {balanceVisible ? (
            <Eye className="w-3 h-3" strokeWidth={1.5} />
          ) : (
            <EyeOff className="w-3 h-3" strokeWidth={1.5} />
          )}
          {balanceVisible ? t('Hide balances') : t('Show balances')}
        </button>

        <div className="flex-1" />

        {filtersActive && (
          <button
            onClick={onClearFilters}
            className="flex items-center gap-1.5 text-[10px] text-ink/40 hover:text-ink/75 transition-colors"
          >
            <Filter className="w-3 h-3" />
            <span className="font-mono">{resultCount}</span> {t('shown')}
            <span className="text-ink/20">·</span>
            <X className="w-3 h-3" /> {t('Clear filters')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Stat cards ───────────────────────────────────────────────────────────────

function StatCard({
  label, value, visible, hint, tone,
}: {
  label: string;
  value: number;
  visible: boolean;
  hint?: string;
  tone?: 'success' | 'warning' | 'danger';
}) {
  const { t } = useT();
  const color =
    tone === 'success' ? 'text-tone-success' :
    tone === 'warning' ? 'text-tone-warning' :
    tone === 'danger'  ? 'text-tone-danger' :
    'text-ink/80';
  // Rendered as a hairline cell inside the stats strip — no border of its own.
  // The figure counts up to its real value; masked to dots when balances hide.
  return (
    <div className="bg-surface-1 p-4">
      <p className="text-xs text-ink/40 mb-1.5">{t(label)}</p>
      <p className={`text-xl font-semibold font-mono tabular-nums ${color}`}>
        {visible ? <CountUp value={value} format={formatMoney} /> : formatMoney(null, { masked: true })}
      </p>
      {hint && <p className="text-[10px] text-ink/30 mt-1">{t(hint)}</p>}
    </div>
  );
}

function HFCard({ riskSnap }: { riskSnap: RiskSnapshot | null }) {
  const { t } = useT();
  const hf = riskSnap?.healthFactor;
  // The protection buffer as an orbit: how far the price can fall before this
  // capital is liquidated (dropPct = 1 − 1/HF). The dial only DRAWS — the HF
  // value and its tone thresholds (hfColor / riskBadgeClass) are unchanged.
  const buffer =
    hf != null ? Math.min(100, Math.round(Math.max(0, (1 - 1 / hf) * 100))) : null;
  return (
    <Card spotlight padded={false} className="relative overflow-hidden p-5 flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 mb-2">
          <MicroLabel>{t('Health Factor')}</MicroLabel>
          {riskSnap?.riskLevel && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${riskBadgeClass(riskSnap.riskLevel)}`}>
              {t(riskSnap.riskLevel)}
            </span>
          )}
        </div>
        <p className={`text-2xl font-semibold font-mono tabular-nums ${hfColor(hf)}`}>
          {hf != null ? hf.toFixed(2) : '—'}
        </p>
        {riskSnap?.liquidationDistanceUSD != null ? (
          <p className="text-[10px] text-ink/30 mt-1.5 tabular-nums">
            {formatMoney(riskSnap.liquidationDistanceUSD)} {t('from liquidation')}
          </p>
        ) : (
          <p className="text-[10px] text-ink/30 mt-1.5">{t('No lending positions')}</p>
        )}
      </div>
      <div className="shrink-0 hidden sm:flex flex-col items-center">
        <div className="mb-1.5">
          <MicroLabel>{t('Protection buffer')}</MicroLabel>
        </div>
        <OrbitDial value={buffer} words={hf != null ? t('to liquidation') : undefined} size={100} />
      </div>
    </Card>
  );
}

// ─── Per-position health (the positions that CONDITION the capital's health) ──
//
// The home HealthCard links here (#position-health): every lending account with
// debt shows its own health bar + exact liquidation price, riskiest first.
// Read-only — data comes from the same portfolio snapshot (metrics per leg).

function PositionsHealthPanel({ snap, wallets }: { snap: PortfolioSnapshot; wallets: WalletRecord[] }) {
  const { t } = useT();
  const groups = useMemo(() => groupPositionHealth(snap.positions), [snap.positions]);
  // Whether the user ARRIVED here through the home HealthCard's deep link —
  // if so, never land them on nothing: show the honest empty state instead.
  const [anchored] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#position-health',
  );

  // The home HealthCard deep-links to this panel; honour the hash once mounted
  // (the panel only exists after data loads, so a plain anchor jump would miss).
  useEffect(() => {
    if ((groups.length > 0 || anchored) && typeof window !== 'undefined' && window.location.hash === '#position-health') {
      document.getElementById('position-health')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [groups.length, anchored]);

  if (groups.length === 0 && anchored) {
    return (
      <div id="position-health" className="scroll-mt-24 rounded-2xl border border-ink/[0.05] bg-surface-1 px-5 py-6 text-center">
        <ShieldAlert className="w-6 h-6 mx-auto mb-2 text-ink/20" strokeWidth={1.5} />
        <p className="text-sm text-ink/60">{t('No positions conditioning your health right now')}</p>
        <p className="text-xs text-ink/35 mt-1">
          {t('Positions with debt appear here with their own health bar and exact liquidation price.')}
        </p>
      </div>
    );
  }
  if (groups.length === 0) return null;

  return (
    <div id="position-health" className="scroll-mt-24 rounded-2xl border border-ink/[0.05] bg-surface-1 overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-ink/5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-ink/40" strokeWidth={1.5} />
          <h3 className="text-sm font-semibold text-ink">{t('Position health')}</h3>
        </div>
        <span className="text-[10px] text-ink/20 font-mono">{t('riskiest first')}</span>
      </div>
      <div className="divide-y divide-ink/[0.04]">
        {groups.map((g) => {
          const atRisk = g.healthFactor != null && g.healthFactor < 1.2;
          const debtUSD = g.debt.reduce((s, l) => s + l.amountUSD, 0);
          const collateralAssets = [...new Set(g.collateral.map((l) => l.asset))].join(' + ');
          const debtAssets = [...new Set(g.debt.map((l) => l.asset))].join(' + ');
          return (
            <div
              key={g.key}
              className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3.5 ${
                atRisk ? 'bg-tone-danger/[0.06]' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink capitalize">{g.protocolId}</span>
                  {atRisk && <Pill tone="danger">{t('at risk')}</Pill>}
                </div>
                <div className="text-[11px] text-ink/45 mt-0.5">
                  {collateralAssets || '—'}
                  {debtAssets && <span className="text-ink/30"> → {t('borrowed')} {debtAssets}</span>}
                  {debtUSD > 0 && (
                    <span className="text-ink/30 tabular-nums"> · {formatMoney(debtUSD)} {t('debt')}</span>
                  )}
                </div>
                <div className="text-[10px] text-ink/30 mt-0.5">
                  {/* Single-wallet snapshots aren't re-stamped by mergeSnaps — fall
                      back to the snapshot's own wallet so the row never reads "—". */}
                  {walletLabel(wallets, g.wallet ?? (snap.wallet !== 'all' ? snap.wallet : undefined))}
                  {g.chainId != null && <span> · {chainFullLabel(g.chainId)}</span>}
                </div>
              </div>
              <PositionHealthMeter
                healthFactor={g.healthFactor}
                liquidationPriceUSD={g.liquidationPriceUSD}
                currentPriceUSD={g.collateralPriceUSD}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mini breakdown card ──────────────────────────────────────────────────────

function MiniBreakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const { t } = useT();
  const entries = Object.entries(data)
    .filter(([, v]) => v > 0.01)
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  // Entity-locked colours (XRP blue / FLR pink) — same helper the donut uses.
  const colors = chartColorsFor(entries.map(([k]) => k));
  // Rendered as a hairline cell inside the breakdown strip.
  return (
    <div className="bg-surface-1 p-5">
      <p className="text-xs font-semibold text-ink/60 mb-3">{t(title)}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-ink/20 py-2 text-center">{t('No data')}</p>
      ) : (
        <>
          <AllocationDonut data={data} height={130} />
          <div className="mt-3 space-y-1">
            {/* Dot colours match the donut slices: same sort, same palette. */}
            {entries.slice(0, 5).map(([k, v], i) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-sm shrink-0"
                    style={{ background: colors[i] }}
                  />
                  <span className="text-ink/40 truncate max-w-[110px]">{k}</span>
                </span>
                <span className="text-ink/30 font-mono">{pctOf(v, total)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Section: Overview ────────────────────────────────────────────────────────

function OverviewSection({
  snap, riskSnap, historyPoints, visible, pnl24h, onRefresh, refreshing, wallets,
}: {
  snap: PortfolioSnapshot;
  riskSnap: RiskSnapshot | null;
  historyPoints: HistoryPoint[];
  visible: boolean;
  pnl24h: { delta: number; pct: number } | null;
  onRefresh: () => void;
  refreshing: boolean;
  wallets: WalletRecord[];
}) {
  const { t } = useT();
  // Asset drill-down: clicking an asset opens its detail (where every unit of
  // it lives — wallet, chain, protocol, amounts).
  const [assetDetail, setAssetDetail] = useState<string | null>(null);
  // Per-asset USD deployed OUTSIDE the wallet (working/earning legs, debt
  // excluded) — shown small under "In Wallet" rows so idle vs deployed reads
  // at a glance.
  const deployedUSD: Record<string, number> = {};
  for (const p of snap.positions) {
    const li = locationInfo(p);
    if (li.label === 'In Wallet') continue;
    if (['debt', 'borrow'].includes(String(p.kind ?? '').toLowerCase())) continue;
    const sym = String(p.asset ?? '—');
    deployedUSD[sym] = (deployedUSD[sym] ?? 0) + Math.abs(p.amountUSD ?? 0);
  }
  const fmtUSD = (v: number) => formatMoney(v, { masked: !visible });

  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="py-2"
    >
      <RevealGroup className="space-y-6">
      {/* ── Balance card + Allocation ── */}
      <RevealItem className="grid lg:grid-cols-3 gap-4">

        {/* Balance + chart */}
        <Card spotlight padded={false} className="lg:col-span-2 p-5">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="mb-2.5">
                <MicroLabel>{t('Total balance')}</MicroLabel>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-4xl font-semibold font-mono tabular-nums text-ink tracking-tight leading-none">
                  {visible ? <CountUp value={snap.totalUSD} format={formatMoneyCompact} /> : formatMoneyCompact(null, { masked: true })}
                </span>
                {pnl24h && (
                  <span
                    className={`inline-flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded-full border tabular-nums ${
                      pnl24h.delta >= 0
                        ? 'bg-tone-success/15 text-tone-success border-tone-success/20'
                        : 'bg-tone-danger/15 text-tone-danger border-tone-danger/20'
                    }`}
                  >
                    {pnl24h.delta >= 0
                      ? <TrendingUp className="w-3.5 h-3.5" />
                      : <TrendingDown className="w-3.5 h-3.5" />}
                    {pnl24h.delta >= 0 ? '+' : ''}{pnl24h.pct.toFixed(2)}%
                  </span>
                )}
              </div>
              {pnl24h && visible && (
                <p className="text-sm text-ink/30 mt-1.5 font-mono tabular-nums">
                  {pnl24h.delta >= 0 ? '+' : ''}{formatMoney(Math.abs(pnl24h.delta))} {t('today')}
                </p>
              )}
            </div>
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="flex items-center gap-1.5 text-xs text-ink/30 hover:text-ink/65 py-1.5 px-3 rounded-lg border border-ink/10 hover:border-ink/20 transition-all disabled:opacity-40 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              {refreshing ? t('Refreshing…') : t('Refresh')}
            </button>
          </div>
          {historyPoints.length > 1 ? (
            <Spotlight className="rounded-lg">
              <PerfLine points={historyPoints} height={175} />
            </Spotlight>
          ) : (
            <div className="h-[175px] rounded-lg bg-ink/[0.04] border border-ink/5 flex flex-col items-center justify-center gap-2 text-ink/20">
              <TrendingUp className="w-8 h-8 opacity-30" strokeWidth={1} />
              <span className="text-xs">{t('History accumulates as snapshots run')}</span>
            </div>
          )}
        </Card>

        {/* Allocation donut — the same small orbital system as the Summary */}
        <Card spotlight padded={false} className="group p-5">
          <div className="flex items-center justify-between mb-4">
            <MicroLabel>{t('Allocation')}</MicroLabel>
          </div>
          {Object.keys(snap.breakdown.byAsset).length > 0 ? (
            <>
              <div className="relative w-[164px] h-[164px] mx-auto">
                <div className="donut-orbit absolute -inset-2 rounded-full border border-dashed border-volt/20" aria-hidden>
                  <span
                    className="absolute w-[4px] h-[4px] rounded-full bg-volt-soft"
                    style={{ top: '3%', left: '50%', boxShadow: '0 0 7px hsl(var(--volt-soft) / 0.9), 0 0 16px hsl(var(--volt) / 0.5)' }}
                  />
                </div>
                <AllocationDonut data={snap.breakdown.byAsset} fill />
              </div>
              <div className="mt-4">
                <AllocationLegend data={snap.breakdown.byAsset} />
              </div>
            </>
          ) : (
            <div className="h-[148px] flex items-center justify-center text-ink/20 text-sm">
              {t('No assets')}
            </div>
          )}
        </Card>
      </RevealItem>

      {/* ── Stats + Health Factor — the numeric trio as one hairline panel
          beside the protection-first HF dial. ── */}
      <RevealItem className="grid gap-4 lg:grid-cols-3">
        <HairlineGroup columns="grid-cols-1 sm:grid-cols-3" className="lg:col-span-2">
          <StatCard
            label="Net Worth"
            value={snap.netWorthUSD}
            visible={visible}
            tone="success"
            hint="Total minus debt"
          />
          <StatCard
            label="Collateral"
            value={snap.collateralUSD}
            visible={visible}
            hint="Backing your loans"
          />
          <StatCard
            label="Debt"
            value={snap.debtUSD}
            visible={visible}
            tone={snap.debtUSD > 0 ? 'warning' : undefined}
            hint={snap.debtUSD > 0 ? 'Outstanding borrows' : 'No active debt'}
          />
        </HairlineGroup>
        {/* StatCard label/hint auto-translate via its own useT */}
        <HFCard riskSnap={riskSnap} />
      </RevealItem>

      {/* ── Per-position health — where the home HealthCard lands ── */}
      <RevealItem>
        <PositionsHealthPanel snap={snap} wallets={wallets} />
      </RevealItem>

      {/* ── Positions table ── */}
      <RevealItem>
      <Card spotlight padded={false} className="overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-ink/5">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{t('Positions')}</h3>
            <span className="text-[10px] text-ink/25 font-mono bg-ink/5 px-1.5 py-0.5 rounded">
              {snap.positions.length} {t('active')}
            </span>
          </div>
          <span className="text-[10px] text-ink/20 font-mono">
            {t('FTSO prices · cached 30s')}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink/40 bg-ink/[0.045]">
              <tr>
                <th className="text-left py-3 px-5 font-medium">{t('Asset')}</th>
                <th className="text-right py-3 px-4 font-medium">{t('Amount')}</th>
                <th className="text-right py-3 px-4 font-medium">{t('Price')}</th>
                <th className="text-right py-3 px-4 font-medium">{t('Value')}</th>
                <th className="text-left py-3 px-4 font-medium">{t('Wallet')}</th>
                <th className="text-left py-3 px-4 font-medium">{t('Chain')}</th>
                <th className="text-left py-3 px-4 font-medium">{t('Location')}</th>
                <th className="text-right py-3 px-5 font-medium">{t('Portfolio %')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/[0.04]">
              {snap.positions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-ink/20 text-sm">
                    <Network className="w-8 h-8 mx-auto mb-2 opacity-20" strokeWidth={1} />
                    {t('No positions detected — connect a wallet and wait for the engine to scan')}
                  </td>
                </tr>
              ) : (
                snap.positions.map((p, i) => {
                  const assetSymbol = p.asset && !p.asset.startsWith('0x')
                    ? p.asset
                    : p.asset?.slice(0, 6) ?? '??';
                  const qty = positionQty(p);
                  const price = typeof p.priceUSD === 'number' && p.priceUSD > 0 ? p.priceUSD : null;
                  const loc = locationInfo(p);
                  const outUSD = loc.label === 'In Wallet' ? deployedUSD[String(p.asset ?? '—')] ?? 0 : 0;
                  const owner = p.wallet ?? (snap.wallet !== 'all' ? snap.wallet : undefined);
                  return (
                  <tr key={i} className="hover:bg-ink/[0.04] transition-colors">
                    <td className="py-3.5 px-5">
                      <button
                        onClick={() => setAssetDetail(String(p.asset ?? assetSymbol))}
                        className="flex items-center gap-2.5 group/asset"
                        title={t('See where this asset lives')}
                      >
                        <TokenLogo symbol={assetSymbol} size="sm" />
                        <span className="font-mono text-xs text-ink/70 font-medium group-hover/asset:text-volt transition-colors">
                          {assetSymbol}
                        </span>
                      </button>
                    </td>
                    <td className="py-3.5 px-4 text-right text-ink/70 font-mono text-xs tabular-nums">
                      {qty != null && visible ? fmtQty(qty) : qty != null ? '••••' : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right text-ink/50 font-mono text-xs tabular-nums">
                      {price != null ? `$${price >= 100 ? price.toFixed(2) : price.toFixed(4)}` : '—'}
                    </td>
                    <td className="py-3.5 px-4 text-right text-ink font-mono text-xs tabular-nums">
                      {fmtUSD(p.amountUSD ?? 0)}
                    </td>
                    <td className="py-3.5 px-4 text-ink/65 text-xs">{walletLabel(wallets, owner)}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-ink/5 text-ink/35 border border-ink/8">
                        {chainFullLabel(p.chainId ?? 14)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <Pill tone={loc.tone}>{t(loc.label)}</Pill>
                      {loc.sub && <div className="text-[10px] text-ink/35 mt-1">{loc.sub}</div>}
                      {outUSD > 0.01 && (
                        <div className="text-[10px] text-ink/35 mt-1 tabular-nums">
                          {fmtUSD(outUSD)} {t('also working')}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <span className="text-ink/30 text-xs font-mono tabular-nums">
                        {pctOf(p.amountUSD ?? 0, snap.totalUSD)}
                      </span>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
      </RevealItem>

      {/* ── Breakdown row — three lenses of the same panel ── */}
      <RevealItem>
        <HairlineGroup columns="md:grid-cols-3">
          <MiniBreakdown title="By Protocol" data={prettifyKeys(snap.breakdown.byProtocol, prettyProtocol)} />
          <MiniBreakdown title="By Asset"    data={snap.breakdown.byAsset} />
          <MiniBreakdown title="By Kind"     data={prettifyKeys(snap.breakdown.byKind, kindLabel)} />
        </HairlineGroup>
      </RevealItem>
      </RevealGroup>

      {assetDetail && (
        <AssetDetailModal
          symbol={assetDetail}
          snap={snap}
          wallets={wallets}
          visible={visible}
          onClose={() => setAssetDetail(null)}
        />
      )}
    </motion.div>
  );
}

// ─── Asset detail — where every unit of one asset lives ──────────────────────
// Opened by clicking an asset in the positions table: totals, live price and a
// per-position breakdown (wallet · chain · location · amount · value).
function AssetDetailModal({
  symbol,
  snap,
  wallets,
  visible,
  onClose,
}: {
  symbol: string;
  snap: PortfolioSnapshot;
  wallets: WalletRecord[];
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useT();
  const positions = snap.positions.filter((p) => String(p.asset ?? '') === symbol);
  const displaySymbol = symbol && !symbol.startsWith('0x') ? symbol : symbol.slice(0, 6);
  const totalUSD = positions.reduce((s, p) => s + (p.amountUSD ?? 0), 0);
  const price = positions.map((p) => (typeof p.priceUSD === 'number' ? p.priceUSD : 0)).find((v) => v > 0) ?? null;
  const totalQty = price ? positions.reduce((s, p) => s + Math.abs(p.amountUSD ?? 0), 0) / price : null;
  const fmtUSD = (v: number) => formatMoney(v, { masked: !visible });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl overflow-hidden">
          <div className="flex items-start justify-between px-6 py-5 border-b border-ink/5">
            <div className="flex items-center gap-3">
              <TokenLogo symbol={displaySymbol} size="md" />
              <div>
                <h2 className="text-lg font-semibold text-ink font-mono">{displaySymbol}</h2>
                <p className="text-xs text-ink/40 mt-0.5">
                  {t('Where this asset lives across your wallets and protocols')}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors mt-1" aria-label={t('Close')}>
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-6 py-4 grid grid-cols-3 gap-3 border-b border-ink/5">
            <div>
              <div className="text-[10px] text-ink/35">{t('Total value')}</div>
              <div className="text-sm font-mono tabular-nums text-ink mt-1">{fmtUSD(totalUSD)}</div>
            </div>
            <div>
              <div className="text-[10px] text-ink/35">{t('Total amount')}</div>
              <div className="text-sm font-mono tabular-nums text-ink mt-1">
                {totalQty != null ? (visible ? fmtQty(totalQty) : '••••') : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-ink/35">{t('Price')}</div>
              <div className="text-sm font-mono tabular-nums text-ink mt-1">
                {price != null ? `$${price >= 100 ? price.toFixed(2) : price.toFixed(4)}` : '—'}
              </div>
            </div>
          </div>

          <ul className="divide-y divide-ink/[0.05] max-h-[46vh] overflow-y-auto scrollbar-thin">
            {positions.map((p, i) => {
              const loc = locationInfo(p);
              const qty = positionQty(p);
              const owner = p.wallet ?? (snap.wallet !== 'all' ? snap.wallet : undefined);
              return (
                <li key={i} className="px-6 py-3.5 flex items-center gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Pill tone={loc.tone}>{t(loc.label)}</Pill>
                      {loc.sub && <span className="text-[11px] text-ink/40">{loc.sub}</span>}
                    </div>
                    <div className="text-[11px] text-ink/40 mt-1.5">
                      {walletLabel(wallets, owner)} · {chainFullLabel(p.chainId ?? 14)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono tabular-nums text-ink">{fmtUSD(p.amountUSD ?? 0)}</div>
                    <div className="text-[11px] font-mono tabular-nums text-ink/40 mt-0.5">
                      {qty != null ? `${visible ? fmtQty(qty) : '••••'} ${displaySymbol}` : ''}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="px-6 py-3 border-t border-ink/5 text-[10px] text-ink/30">
            {t('Read-only view — balances come from the same live snapshot as the portfolio.')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Tokens ──────────────────────────────────────────────────────────

function TokensSection({ snap, visible }: { snap: PortfolioSnapshot; visible: boolean }) {
  const { t } = useT();
  const fmtUSD = (v: number) => formatMoney(v, { masked: !visible });
  const tokens = snap.positions.filter((p) =>
    ['free', 'supply', 'rewards', 'staking', 'reward', 'stake'].includes(
      (p.kind ?? '').toLowerCase()
    )
  );
  const total = tokens.reduce((s, p) => s + (p.amountUSD ?? 0), 0);

  return (
    <motion.div
      key="tokens"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="py-2"
    >
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-lg font-semibold text-ink">{t('Token Inventory')}</h2>
        {total > 0 && (
          <span className="text-sm text-ink/35 font-mono tabular-nums">
            {visible ? `${formatMoney(total)} ${t('total')}` : formatMoney(null, { masked: true })}
          </span>
        )}
      </div>
      <Card spotlight padded={false} className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-ink/40 bg-ink/[0.045]">
            <tr>
              <th className="text-left py-3 px-5 font-medium">{t('Token / Address')}</th>
              <th className="text-left py-3 px-4 font-medium">{t('Protocol')}</th>
              <th className="text-left py-3 px-4 font-medium">{t('Kind')}</th>
              <th className="text-right py-3 px-5 font-medium">{t('Value (USD)')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/[0.04]">
            {tokens.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-ink/20 text-sm">
                  {t('No free / supply / rewards tokens')}
                </td>
              </tr>
            ) : (
              tokens.map((p, i) => (
                <tr key={i} className="hover:bg-ink/[0.04] transition-colors">
                  <td className="py-3.5 px-5">
                    <div className="flex items-center gap-2">
                      <TokenLogo symbol={p.asset && !p.asset.startsWith('0x') ? p.asset : p.asset?.slice(0, 6) ?? '?'} size="sm" />
                      <span className="font-mono text-xs text-ink/45 truncate max-w-[160px]">{p.asset}</span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-ink/55 text-xs">{prettyProtocol(p.protocolId)}</td>
                  <td className="py-3.5 px-4">
                    <Pill tone={kindTone(p.kind)}>{t(kindLabel(p.kind))}</Pill>
                  </td>
                  <td className="py-3.5 px-5 text-right text-ink font-mono text-xs tabular-nums">
                    {fmtUSD(p.amountUSD ?? 0)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </motion.div>
  );
}

// ─── Section: DeFi ────────────────────────────────────────────────────────────

function DeFiSection({ snap, visible }: { snap: PortfolioSnapshot; visible: boolean }) {
  const { t } = useT();
  const fmtUSD = (v: number) => formatMoney(v, { masked: !visible });
  const byProtocol = useMemo(() => {
    const map: Record<string, typeof snap.positions> = {};
    for (const p of snap.positions) {
      (map[p.protocolId] ||= []).push(p);
    }
    return Object.entries(map).sort((a, b) => {
      const sa = a[1].reduce((s, p) => s + (p.amountUSD ?? 0), 0);
      const sb = b[1].reduce((s, p) => s + (p.amountUSD ?? 0), 0);
      return sb - sa;
    });
  }, [snap.positions]);

  return (
    <motion.div
      key="defi"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className="py-2 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">{t('DeFi Positions')}</h2>
        <Link
          href="/app/positions"
          className="flex items-center gap-1.5 text-xs text-ink/35 hover:text-ink/65 transition-colors"
        >
          {t('All positions')} <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {byProtocol.length === 0 ? (
        <SceneDoor
          scene={<OrbitScene />}
          tone="emerald"
          eyebrow={t('DeFi')}
          title={t('No DeFi positions detected')}
          desc={t('Positions appear once Kinetic, SparkDEX or Firelight adapters are active')}
        />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {byProtocol.map(([protocol, positions]) => {
            const total = positions.reduce((s, p) => s + (p.amountUSD ?? 0), 0);
            const debt = positions
              .filter((p) => ['debt', 'borrow'].includes((p.kind ?? '').toLowerCase()))
              .reduce((s, p) => s + (p.amountUSD ?? 0), 0);
            const supply = positions
              .filter((p) => ['collateral', 'supply'].includes((p.kind ?? '').toLowerCase()))
              .reduce((s, p) => s + (p.amountUSD ?? 0), 0);
            return (
              <Card key={protocol} spotlight padded={false} className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <ProtocolLogo slug={protocol} />
                    <div>
                      <p className="text-sm font-semibold text-ink">{prettyProtocol(protocol)}</p>
                      <p className="text-[10px] text-ink/25 font-mono">
                        {positions.length} {positions.length !== 1 ? t('positions') : t('position')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-mono font-semibold tabular-nums text-ink">
                      {visible ? <CountUp value={total} format={formatMoney} /> : formatMoney(null, { masked: true })}
                    </p>
                    <p className="text-[10px] text-ink/25 font-mono tabular-nums">
                      {pctOf(total, snap.totalUSD)}
                    </p>
                  </div>
                </div>
                {(supply > 0 || debt > 0) && (
                  <HairlineGroup
                    columns={supply > 0 && debt > 0 ? 'grid-cols-2' : 'grid-cols-1'}
                    className="mb-3"
                  >
                    {supply > 0 && (
                      <div className="bg-surface-1 p-3">
                        <MicroLabel tone="muted">{t('Supplied')}</MicroLabel>
                        <p className="text-xs font-mono tabular-nums text-tone-success mt-0.5">{fmtUSD(supply)}</p>
                      </div>
                    )}
                    {debt > 0 && (
                      <div className="bg-surface-1 p-3">
                        <MicroLabel tone="muted">{t('Borrowed')}</MicroLabel>
                        <p className="text-xs font-mono tabular-nums text-tone-warning mt-0.5">{fmtUSD(debt)}</p>
                      </div>
                    )}
                  </HairlineGroup>
                )}
                <div className="space-y-1">
                  {positions.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-ink/[0.045] transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Pill tone={kindTone(p.kind)}>{t(kindLabel(p.kind))}</Pill>
                        <span className="text-xs text-ink/30 font-mono truncate max-w-[120px]">
                          {p.asset}
                        </span>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-ink/60 shrink-0 ml-2">
                        {fmtUSD(p.amountUSD ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ─── Protocol logo (DefiLlama icons → gradient fallback) ───────────────────────

function ProtocolLogo({ slug }: { slug: string }) {
  const [failed, setFailed] = useState(false);
  if (!failed) {
    return (
      <img
        src={`https://icons.llama.fi/${slug}.jpg`}
        alt={slug}
        onError={() => setFailed(true)}
        className="w-9 h-9 rounded-lg object-cover shrink-0 bg-ink/5"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-lg bg-ink/[0.06] border border-ink/10 flex items-center justify-center shrink-0">
      <span className="text-[10px] font-bold text-ink/45">{slug.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

// In-page section so the page shows one focused view at a time instead of an
// endless vertical scroll — the user always knows what they're looking at.
// Capital Map, Positions and Activity live here as tabs (nav collapse):
// every lens reads the SAME merged snapshot / wallet list.
type Section = 'overview' | 'tokens' | 'defi' | 'positions' | 'activity' | 'map';
const SECTIONS: Section[] = ['overview', 'tokens', 'defi', 'positions', 'activity', 'map'];

// The filter strip persists per session so leaving and re-entering the page
// (or switching tabs) keeps wallet/network/range/search. Read synchronously in
// the useState initializers: an effect-based restore raced the write-through
// under StrictMode's double-invoke and clobbered the saved state with defaults.
// Nothing renders from these values until client-side data arrives, so the
// server/client initial difference is invisible.
const FILTERS_KEY = 'astryum:portfolio-filters';
interface SavedFilters {
  section: Section;
  activeWallet: string;
  timeRange: TimeRange;
  network: number | null;
  query: string;
  hideDust: boolean;
}
function savedFilters(): Partial<SavedFilters> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? '{}') as Partial<SavedFilters>;
  } catch {
    return {};
  }
}

export default function PortfolioPage() {
  const { t } = useT();
  const userAddress = useAuthStore((s) => s.user?.address);

  const [snap, setSnap]               = useState<PortfolioSnapshot | null>(null);
  const [riskSnap, setRiskSnap]       = useState<RiskSnapshot | null>(null);
  const [rawHistory, setRawHistory]   = useState<{ takenAt: string; totalUSD: number }[]>([]);
  const [error, setError]             = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  // Global hide-balances (persisted store): this page's toggle drives the
  // whole app — donuts, summary, wallet cards, chart tooltips.
  const balancesHidden = useBalanceVisibility((s) => s.hidden);
  const toggleBalances = useBalanceVisibility((s) => s.toggle);
  const balanceVisible = !balancesHidden;
  const [activeWallet, setActiveWallet]     = useState<string>(() => savedFilters().activeWallet ?? 'all');
  const [timeRange, setTimeRange]           = useState<TimeRange>(() => {
    const r = savedFilters().timeRange;
    return r && TIME_RANGES.includes(r) ? r : '7d';
  });
  const [refreshing, setRefreshing]         = useState(false);
  const [network, setNetwork]               = useState<number | null>(() => {
    const n = savedFilters().network;
    return typeof n === 'number' ? n : null;
  });
  const [query, setQuery]                   = useState(() => savedFilters().query ?? '');
  const [hideDust, setHideDust]             = useState(() => savedFilters().hideDust === true);
  const [section, setSection]               = useState<Section>(() => {
    // 'map' and 'defi' are hidden from the tab row (reachable only via
    // ?tab=…) — never restore into them or the user lands on a lens with no
    // active tab. 'defi' was pulled from the row 2026-07-25 (founder: "hace
    // lo mismo que positions, es redundante"); DeFiSection stays mounted
    // behind ?tab=defi so nothing breaks and restoring is one row below.
    const s = savedFilters().section;
    return s && SECTIONS.includes(s) && s !== 'map' && s !== 'defi' ? s : 'overview';
  });

  // Deep-linkable tabs (?tab=map|positions|activity|…) so ⌘K and the old
  // standalone routes land on the right lens, plus ?wallet=<address> so the
  // dashboard's per-wallet rows open this page scoped to that exact wallet.
  // Read once on mount — client-only to avoid the useSearchParams Suspense
  // requirement. Explicit URL params win over the persisted filter state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab && SECTIONS.includes(tab as Section)) setSection(tab as Section);
    const wallet = params.get('wallet');
    if (wallet) setActiveWallet(wallet);
  }, []);

  // Write-through: the state IS the source of truth, storage just mirrors it.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        FILTERS_KEY,
        JSON.stringify({ section, activeWallet, timeRange, network, query, hideDust }),
      );
    } catch { /* storage full/blocked — persistence is best-effort */ }
  }, [section, activeWallet, timeRange, network, query, hideDust]);

  // The view's loadable wallets: the ACTIVE AUTHORITY's set (switcher) —
  // overview = every linked wallet across every chain, single = that wallet,
  // governed = the council account. Same shared source as Summary, so the two
  // surfaces can never disagree (this also folds in the SIWE login address and
  // respects the includeInPortfolio toggle, which the old direct fetch here
  // did not).
  const { wallets: loadableWallets, loading: loadingWallets } = useAuthorityWallets();

  // Which addresses feed the current view: every wallet ("All wallets") or the
  // single one the user selected in the wallet bar.
  const targetAddresses = useMemo<string[]>(() => {
    if (activeWallet === 'all') return loadableWallets.map((w) => w.address);
    return loadableWallets.some((w) => w.address === activeWallet)
      ? [activeWallet]
      : loadableWallets.map((w) => w.address);
  }, [activeWallet, loadableWallets]);
  const targetKey = targetAddresses.join(',').toLowerCase();

  // Monotonic id so a slow response from a previous wallet selection can never
  // overwrite the data of the current one.
  const loadSeq = useRef(0);
  const loadData = useCallback((addresses: string[]) => {
    if (addresses.length === 0) { setSnap(null); setRawHistory([]); setRiskSnap(null); return; }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    // Progressive: each wallet paints as soon as it answers — one slow chain
    // scan must not hold the whole page on the loading state.
    const apply = (r: AggregatedPortfolio) => {
      if (seq !== loadSeq.current) return;
      if (!r.snap) return;
      setSnap(r.snap);
      setRawHistory(r.history);
      setRiskSnap(r.risk);
      setLoading(false);
    };
    loadAggregatedPortfolio(addresses, apply)
      .then((r) => {
        if (seq !== loadSeq.current) return;
        apply(r);
        if (!r.snap) { setSnap(null); setRawHistory([]); setRiskSnap(null); setError('portfolio_failed'); }
      })
      .catch((err) => { if (seq === loadSeq.current) setError(err.message); })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }, []);

  // (Re)load the portfolio whenever the target wallet set changes.
  useEffect(() => {
    if (!hasAuthToken()) { setError('no_session'); return; }
    if (targetAddresses.length === 0) { setSnap(null); setRawHistory([]); setRiskSnap(null); return; }
    loadData(targetAddresses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, loadData]);

  // The range selector actually drives the chart: only snapshots inside the
  // selected window are plotted (before, timeRange was read by nothing).
  const RANGE_DAYS: Record<TimeRange, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  const historyPoints = useMemo<HistoryPoint[]>(() => {
    const cutoff = Date.now() - RANGE_DAYS[timeRange] * 86_400_000;
    return rawHistory
      .filter((p) => new Date(p.takenAt).getTime() >= cutoff)
      .map((p) => ({
        t: new Date(p.takenAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        }),
        value: p.totalUSD,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawHistory, timeRange]);

  const pnl24h = useMemo(() => {
    if (rawHistory.length < 2) return null;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const latest = rawHistory[rawHistory.length - 1];
    const base =
      rawHistory.find((p) => new Date(p.takenAt).getTime() >= cutoff) ??
      rawHistory[0];
    if (base.takenAt === latest.takenAt) return null;
    const delta = latest.totalUSD - base.totalUSD;
    const pctVal = base.totalUSD > 0 ? (delta / base.totalUSD) * 100 : 0;
    return { delta, pct: pctVal };
  }, [rawHistory]);

  // Networks for the filter chips: XRPL and Flare (the flagship networks) are
  // always offered, pinned first; any other chain present in the snapshot follows.
  const availableNetworks = useMemo(() => {
    const present = new Set((snap?.positions ?? []).map((p) => p.chainId ?? 14));
    const rest = Array.from(present)
      .filter((c) => c !== 1440002 && c !== 14)
      .sort((a, b) => a - b);
    return [1440002, 14, ...rest];
  }, [snap]);
  const filtersActive = network !== null || query.trim() !== '' || hideDust;
  const filteredSnap = useMemo(
    () => (snap && filtersActive ? applyFilters(snap, { chainId: network, query, hideDust }) : snap),
    [snap, network, query, hideDust, filtersActive],
  );

  const handleRefresh = () => {
    if (targetAddresses.length === 0) return;
    setRefreshing(true);
    Promise.all(
      targetAddresses.map((a) => portfolioV1.forceSnapshot(a, 14).catch(() => {}))
    )
      .finally(() => {
        loadData(targetAddresses);
        setRefreshing(false);
      });
  };

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!hasAuthToken()) return <AuthRequired />;
  if (loadingWallets && loadableWallets.length === 0)
    return <EmptyState variant="loading" title="Loading wallets…" />;
  if (loadableWallets.length === 0)
    return (
      <SceneDoor
        scene={<CapitalField />}
        tone="gold"
        eyebrow={t('Portfolio')}
        title={t('Connect a wallet to view your portfolio')}
        desc={t('Link any wallet (MetaMask, Phantom, Xaman… any chain) to load your on-chain positions across every connected account.')}
        cta={t('Connect a wallet')}
        href="/app/wallets"
      />
    );
  if (loading && !snap) return <EmptyState variant="loading" title="Loading portfolio…" />;
  if (error && !snap)
    return isAuthError({ message: error }) ? (
      <AuthRequired />
    ) : (
      <FriendlyError message={error} />
    );

  const positionCount = snap?.positions.length ?? 0;
  const walletCount = loadableWallets.length;
  // The snapshot the sections render — filtered when any filter is active.
  const fSnap = filteredSnap ?? snap;

  return (
    <div>
      {/* Page header — the live connection reading and the balance toggle live
          IN the header instead of a separate chrome row. */}
      <PageHeader
        eyebrow="Portfolio"
        title={
          <>
            {t('Your')} {t('portfolio')}
          </>
        }
        subtitle={t('Every wallet and position in one live view — filter by wallet, network or range.')}
        meta={
          <div className="flex items-center gap-2 text-[10px] text-ink/30 font-mono">
            <PulseDot size={6} />
            {t('Networks · XRPL + FLARE')}
            {snap && <span className="opacity-60">· {new Date(snap.takenAt).toLocaleTimeString()}</span>}
          </div>
        }
      />

      {/* ── Section tabs — the page's spine, out in the open, one focused
          view at a time. The active pill glides between destinations. ── */}
      {fSnap && (
        <SegmentedControl<Exclude<Section, 'map' | 'defi'>>
          layoutId="portfolio-tab-pill"
          className="mb-4 overflow-x-auto scrollbar-hide"
          value={section as Exclude<Section, 'map' | 'defi'>}
          onChange={setSection}
          options={[
            { key: 'overview', label: t('Overview') },
            { key: 'tokens', label: t('Tokens') },
            // 'defi' hidden (founder 2026-07-25): redundant with Positions.
            // Still reachable via ?tab=defi — restore by re-adding the row.
            { key: 'positions', label: t('Positions') },
            { key: 'activity', label: t('Activity') },
          ]}
        />
      )}

      {/* ── Filters — one slim strip, present on EVERY lens so the selection
          persists visibly across tabs. Overview/Tokens/DeFi/Map read the
          filtered snapshot; Activity scopes to the selected wallet. ── */}
      {snap && (
        <Card padded={false} className="mb-5 overflow-hidden">
          <FilterBar
            wallets={loadableWallets}
            activeWallet={activeWallet}
            onWalletChange={setActiveWallet}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            networks={availableNetworks}
            network={network}
            onNetworkChange={setNetwork}
            query={query}
            onQueryChange={setQuery}
            hideDust={hideDust}
            onHideDustToggle={() => setHideDust((v) => !v)}
            balanceVisible={balanceVisible}
            onBalanceToggle={toggleBalances}
            filtersActive={filtersActive}
            onClearFilters={() => { setNetwork(null); setQuery(''); setHideDust(false); }}
            resultCount={fSnap?.positions.length ?? 0}
          />
        </Card>
      )}

      {/* ── Section content ── */}
      <div>
          {!fSnap ? (
            <SceneDoor
              scene={<CapitalField />}
              tone="violet"
              eyebrow={t('Portfolio')}
              title={t('No portfolio snapshot yet')}
              desc={t("The portfolio engine hasn't produced a snapshot")}
              cta={t('Refresh')}
              onClick={handleRefresh}
            />
          ) : (
            <div className="pb-6">
              {section === 'overview' && (
                <OverviewSection
                  snap={fSnap}
                  riskSnap={riskSnap}
                  historyPoints={historyPoints}
                  visible={balanceVisible}
                  pnl24h={pnl24h}
                  onRefresh={handleRefresh}
                  refreshing={refreshing}
                  wallets={loadableWallets}
                />
              )}

              {(section === 'tokens' || section === 'defi') &&
              fSnap.positions.length === 0 &&
              filtersActive ? (
                <div className="px-6 py-16 text-center text-sm text-ink/30">
                  {t('No positions match these filters.')}{' '}
                  <button
                    onClick={() => { setNetwork(null); setQuery(''); setHideDust(false); }}
                    className="text-volt hover:underline"
                  >
                    {t('Clear filters')}
                  </button>
                </div>
              ) : (
                <>
                  {section === 'tokens' && <TokensSection snap={fSnap} visible={balanceVisible} />}
                  {section === 'defi' && <DeFiSection snap={fSnap} visible={balanceVisible} />}
                </>
              )}

              {section === 'positions' && (
                <div className="pt-2">
                  <DefiPositionsBoard embedded />
                </div>
              )}

              {section === 'activity' && (
                <div className="pt-2">
                  <ActivityPanel
                    embedded
                    walletFilter={activeWallet === 'all' ? null : activeWallet}
                    networkFilter={network}
                  />
                </div>
              )}

              {section === 'map' && (
                <div className="pt-2">
                  <CapitalMapPanel embedded snap={fSnap} walletCount={loadableWallets.length} />
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

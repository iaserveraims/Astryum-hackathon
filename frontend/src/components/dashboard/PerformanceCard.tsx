'use client';

/**
 * PerformanceCard — UNMOUNTED from the Summary (founder 2026-07-25: "me gusta,
 * pero no le veo mucho el sentido" — and the page must fit one viewport with
 * no scroll). Preserved here whole, same convention as ProductModeCard /
 * LegacySummaryPanel: the per-wallet gain bars over a selectable horizon plus
 * the Expand modal with the real P&L curve. To re-mount, render
 * <PerformanceCard …/> from app/app/page.tsx again and feed it the aggregated
 * store's history/perWallet exactly as before.
 */

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { X, Maximize2 } from 'lucide-react';
import { Card } from '@/components/ui/primitives';
import { PerfLine } from '@/components/ui/charts';
import WalletGlyphIcon from '@/components/wallet/WalletGlyphIcon';
import type { WalletIconSlug } from '@/lib/walletIdentity';
import { useBalanceVisibility, MASK } from '@/stores/balanceVisibilityStore';
import { formatMoneyCompact } from '@/lib/formatMoney';
import type { PortfolioSnapshot, RiskSnapshot } from '@/services/v1Api';

type HistoryPoint = { takenAt: string; totalUSD: number };
type WalletSlice = {
  address: string;
  snap: PortfolioSnapshot;
  risk: RiskSnapshot | null;
  history: HistoryPoint[];
};

/**
 * Gain over the trailing window: latest point vs the last point at or before
 * the cutoff (falls back to the earliest point we have — the max lookback the
 * history allows). Both values are REAL snapshots; nothing is interpolated.
 */
function gainSince(points: HistoryPoint[], days: number): { delta: number; pct: number } | null {
  if (points.length < 2) return null;
  const latest = points[points.length - 1];
  const cutoff = Date.now() - days * 86_400_000;
  let base = points[0];
  for (const p of points) {
    if (new Date(p.takenAt).getTime() <= cutoff) base = p;
    else break;
  }
  if (base.takenAt === latest.takenAt) return null;
  const delta = latest.totalUSD - base.totalUSD;
  const pct = base.totalUSD > 0 ? (delta / base.totalUSD) * 100 : 0;
  return { delta, pct };
}

function toChartPoints(points: HistoryPoint[]): { t: string; value: number }[] {
  return points.map((p) => ({
    t: new Date(p.takenAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    value: p.totalUSD,
  }));
}

const PERIODS = (es: boolean): { label: string; days: number }[] => [
  { label: es ? 'Hoy' : 'Today', days: 1 },
  { label: es ? 'Semana' : 'Week', days: 7 },
  { label: es ? 'Mes' : 'Month', days: 30 },
  { label: es ? 'Año' : 'Year', days: 365 },
];

function GainReadout({ gain, size = 'sm' }: { gain: { delta: number; pct: number } | null; size?: 'sm' | 'md' }) {
  // Global hide-balances: the $ delta masks; the % stays (shape, not amount).
  const hidden = useBalanceVisibility((s) => s.hidden);
  if (!gain) return <span className={`font-mono tabular-nums text-ink/35 ${size === 'sm' ? 'text-[11px]' : 'text-sm'}`}>—</span>;
  const up = gain.delta >= 0;
  const cls = up ? 'text-tone-success' : 'text-tone-danger';
  const sign = up ? '+' : '−';
  const abs = Math.abs(gain.delta);
  const amount = hidden ? MASK : formatMoneyCompact(abs);
  return (
    <span className={`font-mono tabular-nums ${cls} ${size === 'sm' ? 'text-[11px]' : 'text-sm'}`}>
      {sign}{amount}
      <span className="opacity-70"> {sign}{Math.abs(gain.pct).toFixed(1)}%</span>
    </span>
  );
}

export default function PerformanceCard({
  history,
  perWallet,
  labelFor,
  colorFor,
  iconFor,
  es,
  t,
}: {
  history: HistoryPoint[];
  perWallet: WalletSlice[];
  labelFor: (a: string) => string;
  colorFor: (a: string) => string;
  iconFor: (a: string) => WalletIconSlug | null;
  es: boolean;
  t: (s: string) => string;
}) {
  const [open, setOpen] = useState(false);
  // Per-wallet lens (founder 2026-07-18): the card compares WALLETS over one
  // horizon, not the aggregate over four. The time curves live in Expand.
  const [days, setDays] = useState(7);
  const rows = perWallet
    .map((w) => ({
      address: w.address,
      gain: gainSince(w.history, days),
      netWorth: w.snap.netWorthUSD ?? 0,
    }))
    .sort((a, b) => (b.gain?.pct ?? 0) - (a.gain?.pct ?? 0));
  const maxAbsPct = Math.max(1e-9, ...rows.map((r) => Math.abs(r.gain?.pct ?? 0)));
  return (
    <>
      <Card spotlight padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 pb-3">
          <h3 className="text-[15px] font-semibold tracking-tight text-ink">{t('Capital Performance')}</h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-ink/10 bg-ink/[0.03] p-0.5 text-[11px]">
              {PERIODS(es).map((p) => (
                <button
                  key={p.days}
                  onClick={() => setDays(p.days)}
                  aria-pressed={days === p.days}
                  className={`rounded-md px-2 py-1 transition-colors ${
                    days === p.days ? 'bg-volt/15 text-ink' : 'text-ink/45 hover:text-ink/80'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-ink/40 hover:text-volt transition-colors"
            >
              <Maximize2 className="w-3 h-3" /> {t('Expand')}
            </button>
          </div>
        </div>
        {/* One row per wallet: its colour, its gain in the horizon, and a bar
            scaled against the best mover — who is pulling the capital, at a
            glance. Curves over time live behind Expand. */}
        <div className="border-t border-ink/[0.05] px-5 py-3">
          {rows.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink/35">{t('Connect a wallet to see its performance.')}</p>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((r) => {
                const pct = r.gain?.pct ?? 0;
                const width = Math.max(3, (Math.abs(pct) / maxAbsPct) * 100);
                const color = colorFor(r.address);
                const icon = iconFor(r.address);
                return (
                  <li key={r.address}>
                    <Link
                      href={`/app/portfolio?wallet=${encodeURIComponent(r.address)}`}
                      className="group flex items-center gap-3 rounded-lg px-1 -mx-1 py-1 hover:bg-ink/[0.025] transition-colors"
                    >
                      {icon ? (
                        <WalletGlyphIcon icon={icon} size={13} color={color} className="shrink-0" />
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-ink/20" style={{ background: color }} aria-hidden />
                      )}
                      <span className="w-28 truncate text-[12px] text-ink/70">{labelFor(r.address)}</span>
                      <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-ink/[0.05]">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
                          style={{ width: `${width}%`, background: color, opacity: r.gain ? (pct >= 0 ? 0.9 : 0.45) : 0.15 }}
                        />
                      </span>
                      <span className="w-28 text-right shrink-0">
                        <GainReadout gain={r.gain} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
      {open && (
        <PerformanceModal
          history={history}
          perWallet={perWallet}
          labelFor={labelFor}
          es={es}
          t={t}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PerformanceModal({
  history,
  perWallet,
  labelFor,
  es,
  t,
  onClose,
}: {
  history: HistoryPoint[];
  perWallet: WalletSlice[];
  labelFor: (a: string) => string;
  es: boolean;
  t: (s: string) => string;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<'all' | string>('all');
  const points = useMemo(
    () => (sel === 'all' ? history : perWallet.find((w) => w.address === sel)?.history ?? []),
    [sel, history, perWallet],
  );
  const chartPoints = useMemo(() => toChartPoints(points), [points]);
  const chip = (on: boolean) =>
    `px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
      on ? 'bg-volt/15 text-volt border-volt/30' : 'text-ink/45 border-ink/10 hover:text-ink/75 hover:border-ink/20'
    }`;
  // PORTAL to <body>: the card lives inside a RevealItem whose residual
  // `filter: blur(0px)` makes any ancestor a containing block for fixed
  // descendants — rendered in place, this overlay got trapped inside the
  // card's box and painted ON TOP of the neighbouring cards instead of
  // covering the viewport.
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <Card padded={false} className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold tracking-tight text-ink">{t('Performance')}</h3>
            <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors" aria-label={t('Close')}>
              <X className="w-5 h-5" />
            </button>
          </div>

          {perWallet.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap mb-4">
              <button onClick={() => setSel('all')} className={chip(sel === 'all')}>
                {t('All wallets')}
              </button>
              {perWallet.map((w) => (
                <button key={w.address} onClick={() => setSel(w.address)} className={chip(sel === w.address)}>
                  {labelFor(w.address)}
                </button>
              ))}
            </div>
          )}

          {chartPoints.length > 1 ? (
            <PerfLine points={chartPoints} height={280} />
          ) : (
            <div className="h-[280px] flex items-center justify-center text-ink/30 text-sm">
              {t('History accumulates as snapshots run')}
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PERIODS(es).map((p) => (
              <div key={p.days} className="rounded-xl border border-ink/[0.06] bg-ink/[0.03] px-4 py-3">
                <div className="text-xs text-ink/40">{p.label}</div>
                <div className="mt-1">
                  <GainReadout gain={gainSince(points, p.days)} size="md" />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>,
    document.body,
  );
}

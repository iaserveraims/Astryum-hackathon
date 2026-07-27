'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Clock,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import {
  activity as activityApi,
  type CanonicalActivityEvent,
} from '../../../services/v1Api';
import { useT } from '../../../i18n/LanguageProvider';
import { Card, EmptyState, PageHeader, Pill, SectionTitle } from '../../../components/ui/primitives';
import { SourceBadge } from '../../../components/v11/SourceBadge';
import { AuthRequired, FriendlyError, hasAuthToken } from '../../../lib/authError';
import { useAuthorityWallets } from '../../../hooks/useAuthorityWallets';
import { fetchActivityExport } from '../../../services/v1Api';
import { EVM_ADDRESS_RE } from '../../../lib/portfolioMerge';

const TYPE_TONE: Record<
  CanonicalActivityEvent['type'],
  'success' | 'info' | 'warning' | 'neutral' | 'danger'
> = {
  supply: 'success',
  repay: 'success',
  stake: 'success',
  addLiquidity: 'info',
  withdraw: 'warning',
  unstake: 'warning',
  borrow: 'warning',
  removeLiquidity: 'warning',
  swap: 'info',
  approve: 'neutral',
  transfer: 'neutral',
  claim: 'success',
  other: 'neutral',
};

// Per-rail explorers: the timeline mixes Flare (EVM) and XRPL events, and each
// row must link to the explorer of ITS network — never Flarescan for an XRPL tx.
const EXPLORER_TX: Record<ActivityRail, string> = {
  evm: 'https://flarescan.com/tx/',
  xrpl: 'https://livenet.xrpl.org/transactions/',
};

type ActivityRail = 'evm' | 'xrpl';
type RailedEvent = CanonicalActivityEvent & { rail: ActivityRail };

const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
/** The portfolio's network chips: Flare = 14, XRPL = pseudo-chain 1440002. */
const XRPL_PSEUDO_CHAIN_ID = 1440002;

export default function ActivityPage({
  embedded = false,
  walletFilter = null,
  networkFilter = null,
}: {
  embedded?: boolean;
  /** Scope the timeline to ONE wallet (the Portfolio filter strip); null = all. */
  walletFilter?: string | null;
  /** Portfolio network chip: 14 = Flare, 1440002 = XRPL, null = all networks. */
  networkFilter?: number | null;
}) {
  const { t } = useT();
  // The unified source, scoped to the ACTIVE AUTHORITY (switcher): overview =
  // every simple wallet, single = that wallet, governed = the council account.
  // Two rails: EVM wallets read Flarescan via the backend cache, XRPL wallets
  // read the ledger live (account_tx) through the same /activity endpoint.
  const { wallets: myWallets, loading: walletsLoading } = useAuthorityWallets();
  const matchesWalletFilter = (a: string) =>
    !walletFilter ||
    a === walletFilter ||
    (EVM_ADDRESS_RE.test(a) && a.toLowerCase() === walletFilter.toLowerCase());
  const evmWallets = useMemo(
    () =>
      networkFilter === XRPL_PSEUDO_CHAIN_ID
        ? []
        : myWallets
            .map((w) => w.address)
            .filter((a) => EVM_ADDRESS_RE.test(a))
            .filter(matchesWalletFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myWallets, walletFilter, networkFilter],
  );
  const xrplWallets = useMemo(
    () =>
      networkFilter != null && networkFilter !== XRPL_PSEUDO_CHAIN_ID
        ? []
        : myWallets
            .map((w) => w.address)
            .filter((a) => XRPL_ADDRESS_RE.test(a))
            .filter(matchesWalletFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myWallets, walletFilter, networkFilter],
  );
  const scopedWallets = useMemo(
    () => [
      ...evmWallets.map((address) => ({ address, rail: 'evm' as ActivityRail })),
      ...xrplWallets.map((address) => ({ address, rail: 'xrpl' as ActivityRail })),
    ],
    [evmWallets, xrplWallets],
  );
  const walletsKey = scopedWallets.map((w) => w.address).join(',');
  const [events, setEvents] = useState<RailedEvent[]>([]);
  // Movements export (§3 fiscal read): period window + per-wallet download.
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportMovements = async (format: 'csv' | 'json') => {
    setExporting(true);
    setExportError(null);
    try {
      for (const w of scopedWallets) {
        const blob = await fetchActivityExport({
          wallet: w.address,
          format,
          from: exportFrom ? new Date(`${exportFrom}T00:00:00Z`).toISOString() : undefined,
          to: exportTo ? new Date(`${exportTo}T23:59:59Z`).toISOString() : undefined,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `astryum-movements-${w.address.slice(0, 8)}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  const load = async (forceRefresh = false) => {
    if (scopedWallets.length === 0) return;
    if (!hasAuthToken()) {
      setError('no_session');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fan out per wallet (both rails share the endpoint) and merge by
      // timestamp, tagging each event with its rail so every row can link to
      // the explorer of ITS network. Guard against a hung backend: time out
      // to a visible error instead of an eternal spinner.
      const results = await Promise.race([
        Promise.all(
          scopedWallets.map(({ address, rail }) =>
            activityApi
              .timeline({
                wallet: address,
                types: selectedTypes.size > 0 ? Array.from(selectedTypes).join(',') : undefined,
                limit: 200,
                // XRPL reads the ledger live — refresh only applies to Flarescan.
                refresh: rail === 'evm' ? forceRefresh : undefined,
              })
              .then((r) => ({ rail, events: r.events }))
              .catch(() => null),
          ),
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('The timeline took too long to respond.')), 20000),
        ),
      ]);
      const seen = new Set<string>();
      const merged: RailedEvent[] = [];
      for (const r of results) {
        for (const ev of r?.events ?? []) {
          if (seen.has(ev.id)) continue;
          seen.add(ev.id);
          merged.push({ ...ev, rail: r!.rail });
        }
      }
      merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setEvents(merged);
      if (results.every((r) => r == null)) setError('Could not load the timeline for any wallet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletsKey, selectedTypes]);

  const handleRefresh = async () => {
    if (scopedWallets.length === 0) return;
    setRefreshing(true);
    try {
      // Only the EVM rail has an explorer cache to refresh; XRPL is live.
      await Promise.all(evmWallets.map((w) => activityApi.refresh(w).catch(() => {})));
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const grouped = useMemo(() => {
    const out: Record<string, RailedEvent[]> = {};
    for (const ev of events) {
      const day = ev.timestamp.slice(0, 10);
      out[day] ??= [];
      out[day].push(ev);
    }
    return out;
  }, [events]);

  if (error === 'no_session') return <AuthRequired />;

  const toggleType = (t: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const ALL_TYPES: CanonicalActivityEvent['type'][] = [
    'supply',
    'borrow',
    'repay',
    'withdraw',
    'stake',
    'unstake',
    'claim',
    'swap',
    'addLiquidity',
    'removeLiquidity',
    'transfer',
    'approve',
    'other',
  ];

  const refreshButton = (
    <button
      onClick={() => void handleRefresh()}
      disabled={refreshing || scopedWallets.length === 0}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-ink/10 bg-ink/5 text-ink/80 hover:bg-ink/10 disabled:opacity-50"
    >
      <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
      {refreshing ? t('syncing…') : t('Refresh')}
    </button>
  );

  return (
    <div className="space-y-6">
      {embedded ? (
        <SectionTitle
          hint={t('On-chain timeline across your connected wallets · Flare via Flarescan, XRPL live from the ledger')}
          actions={refreshButton}
        >
          Activity
        </SectionTitle>
      ) : (
        <PageHeader
          eyebrow="History"
          title="Activity"
          subtitle="On-chain timeline across your connected wallets · classified via canonical selectors · Flare via Flarescan, XRPL live from the ledger"
          actions={refreshButton}
        />
      )}
      {error && error !== 'no_session' && <FriendlyError message={error} />}

      <Card>
        <div className="flex flex-wrap gap-2">
          {ALL_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => toggleType(t)}
              className={`px-2.5 py-1 rounded-full text-xs border ${
                selectedTypes.has(t)
                  ? 'border-volt/50 bg-volt/10 text-volt'
                  : 'border-ink/10 bg-ink/5 text-ink/60 hover:bg-ink/10'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Card>

      {/* The fiscal read (§3): the period's movements as a FILE for the user's
          tax advisor — exactly what the book knows how to read today, one file
          per wallet in scope. Astryum reports data, never advises. */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink/45">
            {t('Start date')}
            <input
              type="date"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
              className="mt-1 block rounded-lg border border-ink/10 bg-ink/5 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink/25 [color-scheme:dark]"
            />
          </label>
          <label className="text-xs text-ink/45">
            {t('End date')}
            <input
              type="date"
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
              className="mt-1 block rounded-lg border border-ink/10 bg-ink/5 px-2.5 py-1.5 text-sm text-ink outline-none focus:border-ink/25 [color-scheme:dark]"
            />
          </label>
          {(['csv', 'json'] as const).map((f) => (
            <button
              key={f}
              onClick={() => void exportMovements(f)}
              disabled={exporting || scopedWallets.length === 0}
              className="rounded-lg border border-ink/10 bg-ink/5 px-3 py-2 text-sm text-ink/75 transition-colors hover:bg-ink/10 disabled:opacity-40"
            >
              {exporting ? '…' : `${t('Export')} ${f.toUpperCase()}`}
            </button>
          ))}
          <span className="text-[11px] text-ink/40">
            {t('One file per wallet in scope. Astryum reports data; the filing is your advisor’s job.')}
          </span>
        </div>
        {exportError && <p className="mt-2 text-sm text-amber-400">{exportError}</p>}
      </Card>

      {error === 'no_session' ? (
        <AuthRequired />
      ) : error && events.length === 0 ? (
        <FriendlyError message={`Couldn't load your timeline. ${error} Use refresh to retry.`} />
      ) : (loading || walletsLoading) && events.length === 0 ? (
        <Card>
          <div className="text-center text-ink/50 py-8">{t('Loading timeline…')}</div>
        </Card>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Clock className="w-8 h-8 text-ink/40" />}
          title="No activity yet"
          hint={
            scopedWallets.length > 0
              ? 'No on-chain events found for the selected wallets on Flare or XRPL. Try refreshing.'
              : walletFilter || networkFilter != null
                ? 'No wallet matches the selected filters.'
                : 'Connect a wallet to see activity.'
          }
        />
      ) : (
        Object.entries(grouped).map(([day, dayEvents]) => (
          <section key={day} className="space-y-2">
            <h2 className="text-xs text-ink/40 px-2">{day}</h2>
            <Card padded={false} className="divide-y divide-ink/5">
              {dayEvents.map((ev) => (
                <ActivityRow key={ev.id} ev={ev} />
              ))}
            </Card>
          </section>
        ))
      )}
    </div>
  );
}

function ActivityRow({ ev }: { ev: RailedEvent }) {
  const { t } = useT();
  const Icon =
    ev.type === 'supply' || ev.type === 'repay' || ev.type === 'stake' || ev.type === 'addLiquidity'
      ? ArrowDownLeft
      : ev.type === 'withdraw' ||
          ev.type === 'borrow' ||
          ev.type === 'unstake' ||
          ev.type === 'removeLiquidity'
        ? ArrowUpRight
        : ArrowLeftRight;
  return (
    <div className="flex items-center gap-4 px-4 py-3 hover:bg-ink/[0.04]">
      <div className="w-9 h-9 rounded-full border border-ink/10 bg-ink/5 flex items-center justify-center">
        <Icon className="w-4 h-4 text-ink/70" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={TYPE_TONE[ev.type]}>{ev.type}</Pill>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${
              ev.rail === 'xrpl'
                ? 'text-sky-300 bg-sky-500/10 border-sky-500/20'
                : 'text-pink-300 bg-pink-500/10 border-pink-500/20'
            }`}
          >
            {ev.rail === 'xrpl' ? 'XRPL' : 'Flare'}
          </span>
          {ev.protocol && <span className="text-xs text-ink/60">{t('on')} {ev.protocol}</span>}
          <SourceBadge source={ev.source} compact />
        </div>
        <div className="text-[11px] text-ink/40 font-mono mt-1 truncate">
          {ev.rail === 'xrpl' ? t('ledger') : t('block')} {ev.blockNumber} ·{' '}
          {new Date(ev.timestamp).toLocaleTimeString()}
        </div>
      </div>
      <a
        href={`${EXPLORER_TX[ev.rail]}${ev.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-volt hover:text-volt inline-flex items-center gap-1"
      >
        {t('view')} <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

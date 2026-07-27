'use client';

/**
 * NetworkStatusCard — compact live telemetry for the two rails Astryum
 * prepares intents on: Flare (gas in gwei + latest block) and XRPL (open-ledger
 * fee in XRP + ledger index). Sits next to the dashboard greeting; sized to the
 * header's spare space, no more. Data comes from GET /api/network/status
 * (public chain reads, cached 30s server-side) and refreshes every 30s.
 */

import { useEffect, useState } from 'react';
import { networkApi, type NetworkStatus } from '@/services/v1Api';
import { useT } from '@/i18n/LanguageProvider';

function fmtGwei(g?: number): string {
  if (g == null || !Number.isFinite(g)) return '—';
  if (g >= 100) return g.toFixed(0);
  if (g >= 10) return g.toFixed(1);
  return g.toFixed(2);
}

function fmtXrpFee(x?: number): string {
  if (x == null || !Number.isFinite(x)) return '—';
  // Fees are tiny (0.00001 XRP base) — trim trailing zeros for calm reading.
  return x.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

export default function NetworkStatusCard() {
  const { t } = useT();
  const [status, setStatus] = useState<NetworkStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      networkApi
        .status()
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => {
          // Unreachable API reads as both rails offline — never an endless "…".
          if (alive) {
            setStatus((prev) => prev ?? { flare: { ok: false }, xrpl: { ok: false }, takenAt: new Date().toISOString() });
          }
        });
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dot = (ok: boolean | undefined) =>
    ok == null
      ? 'bg-ink/25'
      : ok
        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
        : 'bg-red-400';

  return (
    <div
      className="shrink-0 rounded-2xl border border-ink/[0.05] bg-surface-1 px-5 py-3.5 flex items-center gap-5"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.32), 0 16px 36px -22px rgba(0,0,0,0.7)' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${dot(status?.flare.ok)}`} aria-hidden />
          <span className="text-xs text-ink/45">Flare</span>
        </div>
        <div className="mt-1 font-mono text-sm text-ink leading-none">
          {status?.flare.ok ? `${fmtGwei(status.flare.gasGwei)} gwei` : status ? t('offline') : '…'}
        </div>
        <div className="mt-1 text-[10px] text-ink/30 font-mono">
          {status?.flare.blockNumber != null ? `#${status.flare.blockNumber}` : t('gas')}
        </div>
      </div>

      <div className="w-px self-stretch bg-ink/[0.06]" aria-hidden />

      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${dot(status?.xrpl.ok)}`} aria-hidden />
          <span className="text-xs text-ink/45">XRPL</span>
        </div>
        <div className="mt-1 font-mono text-sm text-ink leading-none">
          {status?.xrpl.ok
            ? `${fmtXrpFee(status.xrpl.openLedgerFeeXrp ?? status.xrpl.baseFeeXrp)} XRP`
            : status
              ? t('offline')
              : '…'}
        </div>
        <div className="mt-1 text-[10px] text-ink/30 font-mono">
          {status?.xrpl.ledgerIndex != null ? `#${status.xrpl.ledgerIndex}` : t('fee')}
        </div>
      </div>
    </div>
  );
}

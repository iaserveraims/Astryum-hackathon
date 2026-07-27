'use client';

/**
 * DemoCapUsageCard — the daily XRP allowance bar (founder 2026-07-25), sitting
 * NEXT TO OrbitStatusCard in the Summary header and matching its size/shape.
 *
 * Shows what the user's XRPL wallet has spent today against the open demo's
 * per-address daily cap (GET /flare-demo/cap-status — read-only, the gauge
 * never moves on read), with the per-tx cap as the small print. Exempt
 * accounts (the founders) see "Sin límite" instead of a bar.
 *
 * Renders NOTHING when: no XRPL wallet is linked (there is no payer to
 * measure), the demo is off (`active: false`), or the API is unreachable —
 * a fuel gauge with no reading is noise, not telemetry.
 */

import { useEffect, useState } from 'react';
import { Fuel, Infinity as InfinityIcon } from 'lucide-react';
import { demoCapApi, type DemoCapStatus } from '@/services/v1Api';
import { useAuthStore } from '@/stores/authStore';
import { MicroLabel } from '@/components/ui/primitives';
import { useT } from '@/i18n/LanguageProvider';

// Same shape the backend enforces (flareDemo.ts) — the payer of the 0xFE rail.
const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export default function DemoCapUsageCard() {
  const { lang } = useT();
  const es = lang === 'es';
  const linkedWallets = useAuthStore((s) => s.linkedWallets);
  const xrplAddress = linkedWallets.find((w) => XRPL_CLASSIC_RE.test(w.address))?.address ?? null;

  const [status, setStatus] = useState<DemoCapStatus | null>(null);

  useEffect(() => {
    if (!xrplAddress) {
      setStatus(null);
      return;
    }
    let alive = true;
    const load = () =>
      demoCapApi
        .status(xrplAddress)
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => {
          if (alive) setStatus(null); // unreachable ⇒ no gauge, not a fake reading
        });
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [xrplAddress]);

  if (!xrplAddress || !status || !status.active) return null;

  const spent = status.spentTodayXrp;
  const max = status.maxXrpPerDay;
  const pct = status.exempt ? 0 : Math.min(100, max > 0 ? (spent / max) * 100 : 100);
  const barTone =
    pct >= 100 ? 'bg-tone-danger' : pct >= 75 ? 'bg-tone-warning' : 'bg-volt';
  const fmt = (n: number) =>
    n.toLocaleString(es ? 'es' : 'en', { maximumFractionDigits: 2 });

  return (
    <div
      className="shrink-0 rounded-2xl border border-ink/[0.05] bg-surface-1 px-5 py-3.5 flex items-center gap-4"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.32), 0 16px 36px -22px rgba(0,0,0,0.7)' }}
      title={
        status.exempt
          ? es ? 'Cuenta del equipo — sin tope diario' : 'Team account — no daily cap'
          : es
            ? `XRP usado hoy por esta wallet · máx ${fmt(status.maxXrpPerTx)} XRP por transacción · se reinicia a medianoche UTC`
            : `XRP used today by this wallet · max ${fmt(status.maxXrpPerTx)} XRP per transaction · resets at midnight UTC`
      }
    >
      <Fuel className="h-4 w-4 shrink-0 text-ink/40" strokeWidth={1.6} aria-hidden />
      <div className="min-w-0">
        <MicroLabel>{es ? 'Combustible XRP de hoy' : "Today's XRP fuel"}</MicroLabel>
        {status.exempt ? (
          <span className="mt-1.5 flex items-center gap-1.5 font-mono text-sm leading-none text-ink">
            <InfinityIcon className="h-3.5 w-3.5 text-volt" strokeWidth={2} aria-hidden />
            {es ? 'Sin límite' : 'No limit'}
          </span>
        ) : (
          <span className="mt-1.5 flex items-center gap-2.5">
            <span
              className="h-1.5 w-24 md:w-28 overflow-hidden rounded-full bg-ink/[0.08]"
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className={`block h-full rounded-full ${barTone} transition-[width] duration-500`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="font-mono text-[11px] leading-none text-ink/60 whitespace-nowrap">
              {fmt(spent)} / {fmt(max)} XRP
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { getApiBase } from '../../lib/env';
import { usePathname } from 'next/navigation';
import { isPreviewActive } from '../../services/previewData';
import { LIVE_CHANGED_EVENT } from '../../lib/demoMode';

type Status = 'unknown' | 'mock' | 'real-ok' | 'real-down';

interface IntegrationsSummary {
  healthy: number;
  degraded: number;
  down: number;
  disabled: number;
  total: number;
}

const API_BASE = getApiBase();
const HEALTH_URL = API_BASE.replace(/\/api\/?$/, '') + '/health';
const INTEGRATIONS_URL = API_BASE.replace(/\/$/, '') + '/integrations';
const CHECK_INTERVAL_MS = 30_000;

/**
 * Permanent top-of-page banner indicating the environment posture.
 *  - DEV · MOCK DATA  (yellow) — NEXT_PUBLIC_USE_MOCK_DATA=true
 *  - REAL · Backend OK (green) — mock=false + GET /health 200
 *  - BACKEND DOWN     (red)    — mock=false + health fails
 */
export function EnvironmentBanner() {
  const pathname = usePathname();
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';
  const devBypass = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
  const [status, setStatus] = useState<Status>(useMock ? 'mock' : 'unknown');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationsSummary | null>(null);
  // R2: reflect the public-demo fixture mode. Reactive — disappears the moment a real
  // wallet is connected (markLiveWalletSession dispatches LIVE_CHANGED_EVENT).
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const sync = () => setPreview(isPreviewActive());
    sync();
    window.addEventListener(LIVE_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LIVE_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (useMock) {
      setStatus('mock');
      return;
    }
    let cancelled = false;
    const probe = async () => {
      try {
        const r = await fetch(HEALTH_URL, { method: 'GET' });
        if (cancelled) return;
        setStatus(r.ok ? 'real-ok' : 'real-down');
      } catch {
        if (!cancelled) setStatus('real-down');
      } finally {
        if (!cancelled) setLastChecked(new Date());
      }

      try {
        const r2 = await fetch(INTEGRATIONS_URL, { method: 'GET' });
        if (cancelled || !r2.ok) return;
        const j = (await r2.json()) as { providers?: Array<{ health?: { status?: string } }> };
        const providers = j.providers ?? [];
        const summary: IntegrationsSummary = {
          healthy: 0,
          degraded: 0,
          down: 0,
          disabled: 0,
          total: providers.length,
        };
        for (const p of providers) {
          const s = p.health?.status;
          if (s === 'healthy') summary.healthy += 1;
          else if (s === 'degraded') summary.degraded += 1;
          else if (s === 'down') summary.down += 1;
          else if (s === 'disabled') summary.disabled += 1;
        }
        if (!cancelled) setIntegrations(summary);
      } catch {
        if (!cancelled) setIntegrations(null);
      }
    };
    probe();
    const id = setInterval(probe, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [useMock]);

  // The public marketing landing must never show ops/dev banners.
  const isPublicLanding = pathname === '/';
  if (isPublicLanding) return null;

  const healthSummary = integrations ? (
    <span className="ml-3 text-white/70">
      · integrations
      <span className="ml-1 text-emerald-300">●{integrations.healthy}</span>
      <span className="ml-1 text-amber-300">●{integrations.degraded}</span>
      <span className="ml-1 text-red-300">●{integrations.down}</span>
      <span className="ml-1 text-white/40">○{integrations.disabled}</span>
      <span className="ml-1 text-white/40">/ {integrations.total}</span>
    </span>
  ) : null;

  const demoStrip = preview ? (
    <div className="w-full bg-amber-900/50 border-b border-amber-500/40 text-amber-100 text-xs py-1.5 px-3 text-center font-mono tracking-wider">
      ⚠ DATOS DE EJEMPLO · demo pública — conecta una wallet para ver datos reales.
    </div>
  ) : null;

  // demoStrip rides with every return (the 4 status paths already render devBypassStrip).
  const devBypassStrip = (
    <>
      {demoStrip}
      {devBypass ? (
        <div className="w-full bg-fuchsia-950 border-b border-volt/60 text-fuchsia-100 text-xs py-1.5 px-3 text-center font-mono tracking-wider">
          ⚡ DEV BYPASS · NO REAL AUTH — NEXT_PUBLIC_DEV_BYPASS_AUTH=true. UI only, backend mutations will fail.
        </div>
      ) : null}
    </>
  );

  // Healthy state shows no banner — a green "Backend OK" strip is dev noise that
  // makes a finished product look unfinished. We only surface genuine warnings
  // (mock data, backend down, dev bypass). `lastChecked`/`healthSummary` stay wired
  // for the warning states and future ops surfaces.
  void lastChecked;
  void healthSummary;
  if (status === 'real-ok') {
    return devBypassStrip;
  }
  if (status === 'mock') {
    return (
      <>
        {devBypassStrip}
        <div className="w-full bg-amber-900/50 border-b border-amber-500/40 text-amber-100 text-xs py-1.5 px-3 text-center font-mono tracking-wider">
          ⚠ DEV · MOCK DATA — NEXT_PUBLIC_USE_MOCK_DATA=true. No real on-chain calls.
        </div>
      </>
    );
  }
  if (status === 'real-down') {
    return (
      <>
        {devBypassStrip}
        <div className="w-full bg-red-950 border-b border-red-500/60 text-red-100 text-xs py-1.5 px-3 text-center font-mono tracking-wider">
          🛑 BACKEND DOWN — {HEALTH_URL} unreachable. Operations will fail. Retrying every {CHECK_INTERVAL_MS / 1000}s…
        </div>
      </>
    );
  }
  // 'unknown' (pre-probe) — stay silent too; only the dev-bypass strip (if any) shows.
  return devBypassStrip;
}

export default EnvironmentBanner;

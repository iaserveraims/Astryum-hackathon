'use client';

/**
 * OrbitStatusCard — "Astryum Orbit System": the platform's own light, in the
 * slot the network-fee telemetry used to occupy (founder 2026-07-25: fees
 * belong NEXT TO each operation before signing, not floating on the Summary —
 * NetworkStatusCard is preserved for that migration).
 *
 * Collapsed: status dot + Online/Offline + the version chip. Clicking opens a
 * panel with the current status (including the founders' hand-written reason
 * while offline) and the "noticiero" — the versioned log of what shipped
 * (lib/platform/changelog.ts, whose newest entry IS the version chip).
 *
 * Status comes from GET /api/platform/status (admin-set, polled every 60s).
 * Three honest lights: green online, red offline (with reason), amber "no
 * signal" when the API itself is unreachable — the card never claims Online
 * on a dead wire.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { platformApi, type PlatformStatus } from '@/services/v1Api';
import { CHANGELOG, KIND_LABEL, PLATFORM_VERSION, type ChangeKind } from '@/lib/platform/changelog';
import { PulseDot } from '@/components/ui/motion';
import { MicroLabel } from '@/components/ui/primitives';
import { useAuthorities } from '@/hooks/useAuthorities';
import { useT } from '@/i18n/LanguageProvider';

type Light = 'online' | 'offline' | 'no-signal' | 'loading';

export default function OrbitStatusCard() {
  const { lang } = useT();
  const es = lang === 'es';
  // The panel portals to <body>, ESCAPING the shell's [data-authority]
  // subtree — in Legacy it kept resolving Personal's gold (founder
  // 2026-07-26). Re-stamp the attribute on the portal root so the surface
  // and accent vars follow the active product.
  const { activeGoverned } = useAuthorities();
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [light, setLight] = useState<Light>('loading');
  const [open, setOpen] = useState(false);
  // PORTAL position (fixed, viewport coords): rendered in place, the panel got
  // trapped BEHIND the summary cards — every RevealItem is a stacking context
  // (residual motion filter/transform), so later siblings paint above any
  // z-index inside an earlier one. Same root cause the PerformanceModal
  // documented; same cure: escape to <body>.
  const [panelPos, setPanelPos] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setPanelPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };

  useEffect(() => {
    let alive = true;
    const load = () =>
      platformApi
        .status()
        .then((s) => {
          if (!alive) return;
          setStatus(s);
          setLight(s.state);
        })
        .catch(() => {
          if (alive) setLight('no-signal');
        });
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Close on any click outside card AND panel (the panel lives in a portal,
  // so the root's contains() alone would treat panel clicks as "outside").
  // Reposition on resize; on scroll simply close — a fixed panel would float
  // detached from its button.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      // Scrolling the ship log itself must NOT dismiss it (founder
      // 2026-07-27) — only page/ancestor scrolls detach the fixed panel
      // from its button and warrant closing.
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const dotClass =
    light === 'online'
      ? 'bg-tone-success'
      : light === 'offline'
        ? 'bg-tone-danger'
        : light === 'no-signal'
          ? 'bg-tone-warning'
          : 'bg-ink/25';
  const stateWord =
    light === 'online'
      ? 'Online'
      : light === 'offline'
        ? 'Offline'
        : light === 'no-signal'
          ? es ? 'Sin señal' : 'No signal'
          : '…';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        onClick={() => {
          if (!open) place();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="rounded-2xl border border-ink/[0.05] bg-surface-1 px-5 py-3.5 flex items-center gap-4 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/60"
        style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.32), 0 16px 36px -22px rgba(0,0,0,0.7)' }}
      >
        <span aria-hidden>
          <PulseDot className={dotClass} size={8} />
        </span>
        <span className="min-w-0">
          <MicroLabel>Astryum Orbit System</MicroLabel>
          <span className="mt-1 flex items-center gap-2">
            <span className={`font-mono text-sm leading-none ${light === 'offline' ? 'text-tone-danger' : 'text-ink'}`}>
              {stateWord}
            </span>
            <span className="rounded-md border border-ink/10 bg-ink/[0.04] px-1.5 py-0.5 font-mono text-[10px] text-ink/50">
              {PLATFORM_VERSION}
            </span>
          </span>
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink/30 transition-transform ${open ? 'rotate-180' : ''}`}
          strokeWidth={1.5}
        />
      </button>

      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            data-authority={activeGoverned ? 'governed' : 'single'}
            className="astry-panel fixed z-[80] w-[340px] overflow-hidden"
            style={{ top: panelPos.top, right: panelPos.right }}
          >
          {/* status detail — the founders' hand-written reason while offline */}
          <div className="px-4 py-3.5">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
              <span className="text-sm font-medium text-ink">
                {light === 'online'
                  ? es ? 'Todos los sistemas en órbita' : 'All systems in orbit'
                  : light === 'offline'
                    ? es ? 'Estamos trabajando en la nave' : 'We are working on the ship'
                    : es ? 'Sin lectura del control de tierra' : 'No reading from ground control'}
              </span>
            </div>
            {light === 'offline' && status?.reason && (
              <p className="mt-2 text-[13px] leading-relaxed text-ink/60">{status.reason}</p>
            )}
            {light === 'no-signal' && (
              <p className="mt-2 text-[13px] leading-relaxed text-ink/60">
                {es
                  ? 'No llegamos al backend ahora mismo — tus claves y tu capital siguen en tus wallets, siempre.'
                  : 'We cannot reach the backend right now — your keys and capital stay in your wallets, always.'}
              </p>
            )}
            {status?.updatedAt && light !== 'no-signal' && (
              <div className="mt-2 font-mono text-[10px] text-ink/30">
                {es ? 'actualizado' : 'updated'} {new Date(status.updatedAt).toLocaleString()}
              </div>
            )}
          </div>

          {/* the noticiero — newest first. DeFi items get their full line (a
              new capability is worth reading); everything else collapses into
              one generic line per kind (founder 2026-07-26: "no quiero que dé
              tanto detalle"). */}
          <div className="border-t border-ink/[0.06] max-h-[300px] overflow-y-auto px-4 py-3">
            <MicroLabel>{es ? 'Bitácora de a bordo' : 'Ship log'}</MicroLabel>
            {/* Only the last FOUR versions (founder 2026-07-27) — the log is a
                pulse, not an archive. */}
            <ul className="mt-2.5 space-y-3.5">
              {CHANGELOG.slice(0, 4).map((entry) => {
                const defi = entry.items.filter((i) => i.kind === 'defi');
                const otherKinds = [
                  ...new Set(
                    entry.items.map((i) => i.kind).filter((k): k is Exclude<ChangeKind, 'defi'> => k !== 'defi'),
                  ),
                ];
                return (
                  <li key={entry.version}>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] font-semibold text-volt">v{entry.version}</span>
                      <span className="font-mono text-[10px] text-ink/30">{entry.date}</span>
                    </div>
                    <ul className="mt-1 space-y-1">
                      {defi.map((item) => (
                        <li key={item.es} className="flex gap-2 text-[12.5px] leading-snug text-ink/70">
                          <span className="mt-[3px] shrink-0 rounded border border-volt/30 bg-volt/10 px-1 font-mono text-[8.5px] uppercase tracking-wide text-volt">
                            DeFi
                          </span>
                          {es ? item.es : item.en}
                        </li>
                      ))}
                      {otherKinds.map((k) => (
                        <li key={k} className="flex gap-2 text-[12px] leading-snug text-ink/45">
                          <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-ink/25" aria-hidden />
                          {es ? KIND_LABEL[k].es : KIND_LABEL[k].en}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

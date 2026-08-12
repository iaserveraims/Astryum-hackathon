'use client';

/**
 * SidebarSettlements — the sidebar home of in-flight operations (founder
 * 2026-08-08: the floating bottom-right cards moved here, under "To sign",
 * so the user learns ONE place where signatures-waiting and ops-in-progress
 * live). Minimised by default — a one-line header with an honest aggregate
 * icon and a count; expanding lists each op with the same machine-gated
 * truth as the modals (green only on real confirmation, honest stalled,
 * ref always shown and linked). Renders nothing when nothing is in flight.
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, Loader2, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import type { SettlementState } from '../../lib/settlement/settlement';
import { useResumePendingSettlements } from '../../lib/settlement/useResumePendingSettlements';

function MiniStatusIcon({ status }: { status: SettlementState['status'] }) {
  if (status === 'settled') return <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-tone-success" strokeWidth={1.8} />;
  if (status === 'failed') return <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-tone-danger" strokeWidth={1.8} />;
  if (status === 'stalled') return <Loader2 className="w-3.5 h-3.5 shrink-0 text-tone-warning animate-spin" strokeWidth={1.8} />;
  return <Loader2 className="w-3.5 h-3.5 shrink-0 text-volt animate-spin" strokeWidth={1.8} />;
}

export function SidebarSettlements() {
  const { t } = useT();
  const { resumed, dismiss } = useResumePendingSettlements();
  // Minimised by default (founder: visible but never in the way) — the header
  // is the whole story until the user opens it.
  const [open, setOpen] = useState(false);
  if (resumed.length === 0) return null;

  const activeCount = resumed.filter((r) => r.state.status === 'pending' || r.state.status === 'stalled').length;
  const anyFailed = resumed.some((r) => r.state.status === 'failed');

  const statusLine = (state: SettlementState) =>
    state.status === 'settled'
      ? t('Confirmed on-chain')
      : state.status === 'failed'
        ? t('Failed on-chain')
        : state.status === 'stalled'
          ? t('Taking longer — still watching')
          : t('Settling on-chain…');

  return (
    <div className="mt-2 rounded-2xl border border-ink/[0.06] bg-ink/[0.02] px-3.5 py-3">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-left"
        title={open ? t('Minimise') : t('See the operations being watched')}
      >
        {activeCount > 0 ? (
          <Loader2 className="w-4 h-4 shrink-0 text-volt animate-spin" strokeWidth={1.8} />
        ) : anyFailed ? (
          <AlertTriangle className="w-4 h-4 shrink-0 text-tone-danger" strokeWidth={1.8} />
        ) : (
          <CheckCircle2 className="w-4 h-4 shrink-0 text-tone-success" strokeWidth={1.8} />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/55">
          {t('In progress')}
        </span>
        <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-volt/15 text-volt text-[10px] font-bold leading-none">
          {resumed.length > 9 ? '9+' : resumed.length}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 text-ink/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="mt-2 space-y-0.5">
          {resumed.map(({ ref, state }) => (
            <div key={ref} className="group relative rounded-lg px-2 py-1.5 hover:bg-ink/[0.04] transition-colors">
              <button
                onClick={() => dismiss(ref)}
                aria-label={t('Hide')}
                title={t('Only hides this notice — the operation keeps going on-chain.')}
                className="absolute top-1.5 right-1.5 text-ink/25 opacity-0 group-hover:opacity-100 hover:text-ink transition-all"
              >
                <X className="w-3 h-3" />
              </button>
              <div className="flex items-center gap-2 pr-4">
                <MiniStatusIcon status={state.status} />
                <span className="flex-1 min-w-0 truncate text-[12px] text-ink/90">{statusLine(state)}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-ink/40 pl-[22px]">
                <span>{t('Receipt')}:</span>
                {state.explorerUrl ? (
                  <a
                    href={state.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-volt/90 hover:underline truncate"
                    title={state.ref}
                  >
                    {state.ref.slice(0, 8)}…{state.ref.slice(-6)}
                    <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                  </a>
                ) : (
                  <span className="font-mono select-all truncate" title={state.ref}>
                    {state.ref.slice(0, 8)}…{state.ref.slice(-6)}
                  </span>
                )}
              </div>
            </div>
          ))}
          <p className="px-2 pt-1 text-[10px] leading-snug text-ink/35">
            {t('Everything you sign is watched here until the chain confirms it.')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

'use client';

/**
 * GoverningBar — the persistent context strip of governed mode (ADR-009).
 *
 * Visible on EVERY screen while the active authority is a governed account:
 * "⬥ Governing: [name] — quorum X/Y — health [state]". Invisible state is the
 * most expensive bug a financial app can ship: every action below must be
 * unmistakably attributed to the account it will hit. The premium palette
 * accompanies; THIS BAR is the indicator (colour is never the only signal).
 */

import { Diamond, X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorities } from '../../hooks/useAuthorities';
import { authorityDisplayName, shortAddress } from '../../lib/authority';

export default function GoverningBar() {
  const { t } = useT();
  const { activeGoverned, setActive } = useAuthorities();
  if (!activeGoverned) return null;

  const name = authorityDisplayName(activeGoverned);
  const quorum =
    typeof activeGoverned.quorum === 'number' && typeof activeGoverned.memberCount === 'number'
      ? `${activeGoverned.quorum}/${activeGoverned.memberCount}`
      : '…';
  const health = activeGoverned.loading
    ? t('reading ledger…')
    : activeGoverned.error
      ? t('could not read')
      : activeGoverned.health?.level === 'red'
        ? t('health: at risk')
        : activeGoverned.health?.level === 'amber'
          ? t('health: attention')
          : activeGoverned.health?.level === 'green'
            ? t('health: sound')
            : t('health: unknown');
  const healthCls =
    activeGoverned.health?.level === 'red'
      ? 'text-red-300'
      : activeGoverned.health?.level === 'amber'
        ? 'text-amber-300'
        : activeGoverned.health?.level === 'green'
          ? 'text-emerald-300'
          : 'text-ink/60';

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-[52px] lg:top-0 z-20 border-b border-[var(--authority-border)] bg-[var(--shell-panel)] backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-8">
        <Diamond className="h-3.5 w-3.5 shrink-0 text-[var(--authority-solid)]" strokeWidth={1.8} />
        <span className="text-[13px] font-medium text-ink/90">
          {t('Governing')}: <span className="text-[var(--authority-solid)]">{name}</span>
        </span>
        <span className="text-[12px] text-ink/55">
          {t('quorum')} {quorum}
        </span>
        <span className={`text-[12px] ${healthCls}`}>{health}</span>
        <span className="hidden font-mono text-[11px] text-ink/35 sm:inline">
          {shortAddress(activeGoverned.address)}
        </span>
        {typeof activeGoverned.pendingSignatures === 'number' && activeGoverned.pendingSignatures > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
            {activeGoverned.pendingSignatures} {t('waiting for your signature')}
          </span>
        )}
        <button
          onClick={() => setActive('all')}
          className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ink/50 transition-colors hover:bg-ink/[0.06] hover:text-ink/85"
          aria-label={t('Leave governed mode')}
          title={t('Leave governed mode')}
        >
          <X className="h-3 w-3" strokeWidth={2} />
          {t('exit')}
        </button>
      </div>
    </div>
  );
}

'use client';

/**
 * ResumedSettlements — the visible surface of rehydrated settlements. After a
 * reload the signing modal is gone, but the operation the user signed is not:
 * this compact host floats the resumed ops (SettlementIndicator = the same
 * machine-gated truth as the modals: green only on real confirmation, honest
 * stalled, ref always linked). Renders nothing when nothing was in flight.
 */

import { X } from 'lucide-react';
import { useT } from '../../i18n/LanguageProvider';
import { useResumePendingSettlements } from '../../lib/settlement/useResumePendingSettlements';
import { SettlementIndicator } from './SettlementIndicator';

export function ResumedSettlements() {
  const { t } = useT();
  const { resumed, dismiss } = useResumePendingSettlements();
  if (resumed.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col gap-3 w-[22rem] max-w-[calc(100vw-2rem)]">
      {resumed.map(({ ref, state }) => (
        <div
          key={ref}
          className="relative bg-surface-1 border border-ink/10 rounded-2xl shadow-2xl px-4 py-4"
        >
          <button
            onClick={() => dismiss(ref)}
            aria-label={t('Dismiss')}
            className="absolute top-2.5 right-2.5 text-ink/35 hover:text-ink transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <p className="text-[11px] text-ink/45 mb-2 pr-6">
            {t('Operation signed before the reload — still being watched:')}
          </p>
          <SettlementIndicator
            state={state}
            pendingText={t('Still settling on Flare…')}
          />
        </div>
      ))}
    </div>
  );
}

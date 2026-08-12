'use client';

/**
 * LegacyBetaBanner — the sign at the door, and the permanent way back to the
 * text.
 *
 * The blocking dialog fires at the one-way step (CageDisclosureModal); this is
 * what entering Legacy gets instead: one line that separates the two halves of
 * the product — governing locks up nothing, a cage is one-way — plus the link
 * that reopens the full disclosure at any time.
 *
 * Deliberately NOT dismissable. A disclosure you can only ever see once is the
 * one nobody reads, and this is the sentence that decides whether someone should
 * be here at all. It is one line tall; it costs nothing to leave standing.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import CageDisclosureModal from './CageDisclosureModal';
import { useT } from '../../i18n/LanguageProvider';

export default function LegacyBetaBanner({ account }: { account?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[12px] leading-relaxed text-ink/65">
        <AlertTriangle size={13} className="shrink-0 text-tone-warning" strokeWidth={1.8} />
        <span>
          <span className="font-semibold text-tone-warning">{t('Beta.')}</span>{' '}
          {t('Governing a Legacy locks up nothing. Creating a cage does — and a cage is one-way by design.')}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="underline underline-offset-2 transition-colors hover:text-ink"
        >
          {t('How a cage works')}
        </button>
      </div>

      {open && <CageDisclosureModal account={account} mode="read" onClose={() => setOpen(false)} />}
    </>
  );
}

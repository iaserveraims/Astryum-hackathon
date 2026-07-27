'use client';

/**
 * MovementsModal — the "Movements" surface (send/receive + XRPL escrow +
 * savings rules + native DEX buy/sell) behind a single button, deployable from
 * anywhere: each wallet card in Astryum Personal, and the Movements tab in
 * Astryum Legacy's governance.
 *
 * It is a thin overlay shell around <MovementsPanel/>: the panel already carries
 * every rail and its own invariants (prepare-only; Astryum never signs). This
 * shell only frames it, scopes it to ONE wallet, and handles the close.
 *
 * Rendered through a portal to <body> so the fixed overlay covers the viewport
 * regardless of any ancestor that became a containing block (a card's residual
 * `filter` traps `position: fixed` otherwise — same fix as the dashboard's
 * PerformanceModal).
 */

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeftRight } from 'lucide-react';
import type { BackendWallet } from '../../services/walletLinkService';
import { useT } from '../../i18n/LanguageProvider';
import MovementsPanel from './MovementsPanel';

export default function MovementsModal({
  wallet,
  onClose,
}: {
  /** The wallet this modal is scoped to — its ecosystem decides which rails
   *  render (XRPL: everything; Flare/EVM: send/receive). Optional: absent =
   *  the panel's default (XRPL-native) behaviour. */
  wallet?: BackendWallet;
  onClose: () => void;
}) {
  const { t } = useT();

  // Escape closes; lock the page scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="my-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-surface-1 shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header — the one bit of chrome the modal owns */}
        <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <ArrowLeftRight className="h-4 w-4 text-volt/80" strokeWidth={1.6} />
            <h2 className="text-[15px] font-semibold tracking-tight text-white">{t('Movements')}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Close')}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/40 transition-colors hover:bg-white/5 hover:text-white/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <MovementsPanel scopeWallet={wallet} variant="modal" />
        </div>
      </div>
    </div>,
    document.body,
  );
}

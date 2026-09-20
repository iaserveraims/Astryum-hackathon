'use client';

/**
 * ⚠️ UNMOUNTED since 2026-08-22 (same day it was born): the founder tried
 * governance-as-a-dialog and sent it back to its own page — «está mal
 * gestionado, pásalo a página independiente». /app/legacy mounts LegacyPanel
 * again (workshop-only, no list); nothing renders this component. Preserved
 * with LegacyPanel's `embed` mode in case the dialog returns.
 *
 * GovernanceModal — governance as a LARGE DIALOG over /app/wallets (founder
 * 2026-08-22: «borrar del mapa la página de gestión de cuentas legacy — toda
 * esa configuración tiene que estar en la página de wallets», delivery mode
 * chosen: «ventana propia»). It hosts the full LegacyPanel in embedded mode:
 * constitution wizard, governance tabs, reinforce ceremony, proposal inbox.
 *
 * INDIGO INSIDE, GOLD OUTSIDE: `data-authority="governed"` on the overlay
 * root flips the whole token ladder for everything INSIDE the dialog — the
 * precedent is the landing's local stamp (LandingPage data-authority). The
 * shell around it stays gold: Legacy stopped being a mode, it is a surface.
 * (Nested overlays that portal to <body> — the Xaman signing doors, the
 * governed movements dialog — sit OUTSIDE this root and keep the shell's
 * gold. Known and accepted: their own chrome names the ceremony.)
 *
 * NO accidental dismissal: multisig ceremonies pin an XRPL Sequence — a
 * backdrop click or a stray Escape mid-signing is exactly how a council ends
 * up with a seat it cannot settle (the CouncilMultisigFlow prose). So the X
 * button is the only way out; the panel's own exits (← Wallets, the
 * ceremony's final button) call the same `onClose`.
 */

import { X } from 'lucide-react';
import { ModalOverlay } from '@/components/ui/ModalPortal';
import { useT } from '@/i18n/LanguageProvider';
import LegacyPanel, { type LegacyPanelEntry } from './LegacyPanel';

export function GovernanceModal({
  entry,
  onClose,
}: {
  entry: LegacyPanelEntry;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <ModalOverlay
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-[2px]"
      data-authority="governed"
    >
      <div className="min-h-full flex justify-center p-3 sm:p-6">
        <div
          className="relative w-full max-w-5xl my-auto rounded-2xl border bg-surface-1 shadow-2xl"
          style={{ borderColor: 'hsl(var(--product-legacy) / 0.25)' }}
          role="dialog"
          aria-modal="true"
          aria-label={t('Legacy governance')}
        >
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 p-2 rounded-lg text-ink/45 hover:text-ink hover:bg-ink/5 transition-colors"
            aria-label={t('Close')}
          >
            <X className="w-4 h-4" />
          </button>
          <div className="p-4 sm:p-6">
            <LegacyPanel embed={{ entry, onExit: onClose }} />
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}

export default GovernanceModal;

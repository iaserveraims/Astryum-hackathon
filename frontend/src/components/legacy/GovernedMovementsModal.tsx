'use client';

/**
 * GovernedMovementsModal — el modal de Movimientos de una cuenta gobernada,
 * EXTRAÍDO de LegacyPanel (fundador 2026-08-30: «cuando le doy a movements me
 * carga la pantalla legacy... quiero que se mantenga en la pantalla de
 * wallets»). Una sola pieza, dos montajes: LegacyPanel (la puerta de la card
 * en My Legacies) y WalletManager (la puerta Movimientos de la tarjeta en
 * /app/wallets, que ya NO navega — el dashboard se queda debajo).
 *
 * El raíl no cambia: GovernedMovements compone SIN firmar, atado a la cuenta
 * del consejo, y deja la propuesta en la bandeja para el quórum — Astryum
 * jamás firma (#1). Patrón oro de modales (overlay que scrollea + my-auto) y
 * la disciplina de foco del 2026-08-04: entra al abrir, Tab envuelve dentro,
 * y vuelve al botón que lo abrió al cerrar (el trap escucha en el propio
 * diálogo, así los overlays de Xaman portalados a <body> nunca pelean).
 */

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Landmark, X } from 'lucide-react';

import { ModalOverlay } from '../ui/ModalPortal';
import { modalPop } from '../ui/motion';
import { useT } from '../../i18n/LanguageProvider';
import GovernedMovements from './GovernedMovements';

export function GovernedMovementsModal({
  account,
  onClose,
  onGoToProposals,
}: {
  account: string;
  onClose: () => void;
  /** «Firma en la bandeja»: el anfitrión decide cómo se llega a Propuestas. */
  onGoToProposals: () => void;
}) {
  const { t } = useT();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      returnFocus.current?.focus();
      returnFocus.current = null;
    };
  }, []);

  return (
    <ModalOverlay
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onEscape={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="legacy-movements-title"
        tabIndex={-1}
        variants={modalPop}
        initial="hidden"
        animate="shown"
        className="my-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-surface-1 shadow-2xl shadow-black/60 outline-none"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          const root = dialogRef.current;
          if (!root) return;
          const focusables = root.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/5 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Landmark className="h-4 w-4 text-volt/80" strokeWidth={1.6} />
            <h2 id="legacy-movements-title" className="text-[15px] font-semibold tracking-tight text-ink">
              {t('Movements')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Close')}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          <GovernedMovements account={account} onGoToProposals={onGoToProposals} />
        </div>
      </motion.div>
    </ModalOverlay>
  );
}

export default GovernedMovementsModal;

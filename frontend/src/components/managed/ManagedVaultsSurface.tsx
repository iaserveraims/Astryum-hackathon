'use client';

/**
 * ManagedVaultsSurface — la puerta «Bóvedas con gestor» de Earn: EL CATÁLOGO,
 * y solo el catálogo.
 *
 * REORG 2026-08-29 (fundador): Earn es el menú del CLIENTE — aquí se elige una
 * bóveda igual que en los demás menús se elige una estrategia; la «estrategia»
 * de una managed vault es de su gestor. Las otras dos lentes que vivían aquí
 * se mudaron con su persona:
 *  · «Run a vault» (la mesa del gestor) → /app/manager, entrada de sidebar
 *    condicional al flag de gestor (managerStore) — mismo mecanismo que Admin.
 *  · «KYC partner» (la auditora) → /app/partner, SOLO por URL: relación B2B
 *    negociada, no auto-servicio.
 * El segmented control se fue con ellas: un selector de una sola opción es
 * un adorno.
 *
 * ── LA EXPLICACIÓN DEJA DE SER UN PEAJE ─────────────────────────────────────
 * Aparece (a) sola, EN MODAL, la primera vez que alguien entra, y (b) cuando
 * se pide desde el botón de arriba a la derecha. Una sola pieza
 * (`HowManagedVaultsWorkBody`) en los dos sitios — dos explicaciones
 * mantenidas aparte acabarían contando dos versiones distintas de qué puede
 * hacer alguien con tu dinero.
 *
 * ── LA PRIMERA VISITA SE RECUERDA EN EL NAVEGADOR, Y FALLA ABIERTO ──────────
 * `localStorage` puede estar bloqueado (modo privado, ajustes del navegador) y
 * `getItem` LANZA, no devuelve null. Si eso pasa, se enseña: molestar dos veces
 * a alguien es infinitamente mejor que dejar entrar sin la explicación a quien
 * nunca la vio. Al revés del gate de fundadores, que falla cerrado — aquí lo
 * que está en juego es entender, no un permiso.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Briefcase, HelpCircle, Users, X } from 'lucide-react';

import { GhostButton, PrimaryButton } from '../ui/primitives';
import { ModalOverlay } from '../ui/ModalPortal';
import { useT } from '../../i18n/LanguageProvider';
import { useIsManager } from '../../stores/managerStore';
import { MANAGER_DESK_OPEN } from '../../lib/nav/managerDesk';
import { useOperationStore } from '../../stores/operationStore';
import { ManagerDirectory } from './ManagerDirectory';
import { HowManagedVaultsWork, HowManagedVaultsWorkBody } from './HowManagedVaultsWork';
import { DryRunBanner } from '../dryrun/DryRunBanner';

const SEEN_KEY = 'astryum:managed-vaults:explained';

export function ManagedVaultsSurface() {
  const { t } = useT();
  const [showHow, setShowHow] = useState(false);
  const [firstVisit, setFirstVisit] = useState(false);
  const isManager = useIsManager();
  // La MESA DEL GESTOR vive aquí (fundador 10-sep: fuera del sidebar, dentro
  // de Managed vaults), y se abre en ventana anclable — la misma que Gobernar.
  const openManagerOp = useOperationStore((st) => st.openManagerOp);
  // Durante el hackathon la mesa se enseña a TODOS con su botón con nombre
  // (lib/nav/managerDesk.ts); en reposo, solo a quien se declaró gestor.
  const showDesk = isManager || MANAGER_DESK_OPEN;

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SEEN_KEY) !== '1') setFirstVisit(true);
    } catch {
      // Almacenamiento bloqueado: se enseña. Ver la nota de la cabecera.
      setFirstVisit(true);
    }
  }, []);

  function dismissFirstVisit() {
    setFirstVisit(false);
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* si no se puede recordar, volverá a salir — y eso es lo correcto */
    }
  }

  return (
    <div className="space-y-5">
      {/* La banda del ensayo: solo existe con NEXT_PUBLIC_DRY_RUN=true. */}
      <DryRunBanner />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {/* La mesa del gestor: para quien se declaró —o para todos, con la
            mesa abierta por el hackathon—, un botón con nombre; para el
            resto, la puerta discreta de abajo. Abre en ventana. */}
        {showDesk ? (
          <button
            type="button"
            onClick={() => openManagerOp()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-ink/[0.03] px-3 py-1.5 text-xs font-medium text-ink/80 transition-colors hover:border-ink/30 hover:text-ink"
          >
            <Briefcase className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('Manager desk')}
          </button>
        ) : null}
        {/* La COMUNIDAD (8-sep): quién lleva bóvedas, con cara y apoyos. No
            vive en el sidebar — esta es su puerta principal, siempre visible
            (también mientras el catálogo carga o falla). */}
        <Link
          href="/app/community"
          className="inline-flex items-center gap-1.5 rounded-lg border border-volt/40 bg-volt/[0.08] px-3 py-1.5 text-xs font-medium text-volt transition-colors hover:bg-volt/[0.14]"
        >
          <Users className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('Community')}
        </Link>
        <button
          onClick={() => setShowHow((v) => !v)}
          aria-expanded={showHow}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
            showHow
              ? 'border-volt/40 bg-volt/[0.08] text-volt'
              : 'border-ink/10 text-ink/55 hover:border-ink/20 hover:text-ink'
          }`}
        >
          <HelpCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('How managed vaults work')}
        </button>
      </div>

      {showHow && <HowManagedVaultsWork />}

      <ManagerDirectory />

      {/* Quien aún no se declaró gestor encuentra aquí la puerta, discreta:
          la ventana abre con la declaración, no con un muro. Con el botón de
          arriba a la vista de todos (hackathon), esta puerta sobra. */}
      {!showDesk && (
        <p className="text-[11px] text-ink/40">
          <Briefcase className="mr-1 inline h-3.5 w-3.5 align-[-2px]" strokeWidth={1.7} />
          {t('Do you manage third-party capital?')}{' '}
          <button type="button" onClick={() => openManagerOp()} className="text-volt hover:underline">
            {t('Open the manager desk')}
          </button>
        </p>
      )}

      {/* Primera visita: la misma explicación, en modal, una sola vez. */}
      {firstVisit && (
        <ModalOverlay
          onEscape={dismissFirstVisit}
          lockScroll
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm"
        >
          <div className="my-auto w-full max-w-2xl overflow-hidden rounded-2xl border border-ink/10 bg-surface-1 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-ink/5 px-6 py-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  {t('How a managed vault works')}
                </h2>
                <p className="mt-1 text-[12px] text-ink/45">
                  {t('Worth two minutes before you put money anywhere near one.')}
                </p>
              </div>
              <button
                onClick={dismissFirstVisit}
                aria-label={t('Close')}
                className="mt-1 shrink-0 text-ink/40 transition-colors hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto scrollbar-thin px-6 py-5">
              <HowManagedVaultsWorkBody />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink/5 px-6 py-4">
              <GhostButton onClick={() => { dismissFirstVisit(); setShowHow(true); }}>
                {t('Keep it open')}
              </GhostButton>
              <PrimaryButton onClick={dismissFirstVisit}>{t('Got it')}</PrimaryButton>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}

export default ManagedVaultsSurface;

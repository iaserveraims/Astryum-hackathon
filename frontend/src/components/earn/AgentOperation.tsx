'use client';

/**
 * AgentOperation — el agente como VENTANA DE OPERACIÓN. Misma OperationSurface que las estrategias — anclable,
 * minimizable a píldora, sobrevive a la navegación en el host global — con
 * una diferencia deliberada: NO cuenta para el tope de tres operaciones (el
 * store lo excluye), así que el máximo real es tres estrategias más el
 * agente.
 *
 * Lanzar una opción desde el chat abre la estrategia real por el mismo
 * camino de siempre (openVaultOp → prepare→review→sign): la nueva operación
 * toma el foco y el agente espera en su píldora, con la conversación viva.
 */

import { Minus, PanelRight, PanelRightClose, Sparkles } from 'lucide-react';
import { CloseOperationButton, OperationSurface } from '../ui/OperationSurface';
import { useOperationStore } from '../../stores/operationStore';
import { useDockStore } from '../../stores/dockStore';
import { useT } from '../../i18n/LanguageProvider';
import { useAuthorities } from '../../hooks/useAuthorities';
import { StrategyLLMChat } from './StrategyLLMChat';
import { DEMO_VAULTS } from './FlareDemoEarn';
import type { LaunchStrategy } from './StrategyAgent';

export default function AgentOperation({
  seed,
  seedKey,
  restoreId,
  restoreKey,
  onClose,
}: {
  seed?: string;
  seedKey?: number;
  /** Un chat del historial que abrir ya restaurado (relojito del héroe). */
  restoreId?: string;
  restoreKey?: number;
  onClose: () => void;
}) {
  const { t } = useT();
  const docked = useDockStore((st) => st.docked);
  const setDocked = useDockStore((st) => st.setDocked);
  const minimizeActive = useOperationStore((st) => st.minimizeActive);
  const openVaultOp = useOperationStore((st) => st.openVaultOp);
  const { activeGoverned } = useAuthorities();

  // El mismo camino de lanzamiento que la página de Earn: catálogo real,
  // modal real. Si el tope de tres está lleno, el store avisa con su toast.
  const launch: LaunchStrategy = (kind, initial) => {
    const v = DEMO_VAULTS.find((x) => x.kind === kind);
    if (v) openVaultOp(v, initial);
  };

  return (
    <OperationSurface docked={docked} title={t('Agent')} onClose={onClose} immediateClose>
      <div className="shrink-0 flex items-start justify-between px-5 py-4 border-b border-ink/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl grid place-items-center border text-volt border-volt/30 bg-volt/10">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-ink">{t('Agent')}</h2>
            <p className="text-xs text-ink/40 mt-0.5">{t('It compiles — you sign')}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={minimizeActive}
            className="p-0.5 text-ink/40 hover:text-ink transition-colors"
            title={t('Minimize — it waits at the bottom, exactly as you left it')}
          >
            <Minus className="w-5 h-5" />
          </button>
          <button
            onClick={() => setDocked(!docked)}
            className="hidden lg:block p-0.5 text-ink/40 hover:text-ink transition-colors"
            title={docked ? t('Back to a window') : t('Pin to the side — the dashboard stays live')}
          >
            {docked ? <PanelRightClose className="w-5 h-5" /> : <PanelRight className="w-5 h-5" />}
          </button>
          {/* A la primera: la conversación queda en el historial local — no
              hay nada a medias que proteger con un segundo clic. */}
          <CloseOperationButton onClose={onClose} immediate />
        </div>
      </div>
      {/* El chat llena el hueco de la ventana — variant fill: sin alto propio,
          sin marco propio (el marco es la propia operación). */}
      <div className="flex min-h-0 flex-1 flex-col">
        <StrategyLLMChat
          variant="fill"
          seed={seed}
          seedKey={seedKey}
          restoreId={restoreId}
          restoreKey={restoreKey}
          onLaunch={launch}
          governed={!!activeGoverned}
        />
      </div>
    </OperationSurface>
  );
}

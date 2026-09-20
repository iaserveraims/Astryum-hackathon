'use client';

/**
 * EarnOperationHost — monta la operación de estrategia POR ENCIMA de las
 * páginas (AppShell), leyendo el operationStore. Así navegar con la operación
 * abierta —anclada o flotante— no la mata: el host no cambia con la ruta.
 *
 * El modal llega por import dinámico: FlareDemoEarn es el módulo más pesado
 * del Earn y el shell lo comparte todo — cargarlo solo cuando una operación
 * se abre deja el chunk común como estaba (y deduplica con el del propio
 * Earn cuando ya está cargado).
 */

import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { getStoredLang } from '../../i18n/LanguageProvider';
import { translate } from '../../i18n/dict';
import { Landmark, Minus, PanelRight, PanelRightClose } from 'lucide-react';
import { useOperationStore, rehydrateOperations, type HostedOp } from '../../stores/operationStore';
import { useDockStore } from '../../stores/dockStore';
import { CloseOperationButton, OperationSurface, OpWindowContext } from '../ui/OperationSurface';
import { useT } from '../../i18n/LanguageProvider';

const DemoVaultModal = dynamic(
  () => import('./FlareDemoEarn').then((m) => m.DemoVaultModal),
  { ssr: false },
);
// El segundo inquilino: la operación de posiciones — mismo
// motivo, mismo carril: sobrevivir a la navegación con el anclaje puesto.
const PaActionsModal = dynamic(
  () => import('../positions/PaActionsModal').then((m) => m.PaActionsModal),
  { ssr: false },
);
// El tercer inquilino: la orden de consejo del hub (la jaula).
const CouncilVaultEntry = dynamic(() => import('../legacy/CouncilVaultEntry'), { ssr: false });
// El cuarto: la constitución del Legacy — la pieza del otro builder
// (ConstituteOperation), que ya venía con OperationSurface, sello
// índigo local y regla de no-cierre-accidental; aquí solo cambia DÓNDE vive.
const ConstituteOperation = dynamic(() => import('../legacy/ConstituteOperation'), { ssr: false });
// El quinto: reforzar una cuenta personal — la misma
// ceremonia por debajo, pero en ORO y sin el sello índigo del Legacy.
const ReinforceOperation = dynamic(() => import('../legacy/ReinforceOperation'), { ssr: false });
// El sexto: el AGENTE como ventana — fuera del tope de
// tres; la conversación sobrevive en su píldora como cualquier operación.
const AgentOperation = dynamic(() => import('./AgentOperation'), { ssr: false });
// El séptimo: GOBERNAR un Legacy — el gemelo de Constituir, clavado a Govern.
const GovernOperation = dynamic(() => import('../legacy/GovernOperation'), { ssr: false });
// El octavo: la MESA DEL GESTOR.
const ManagerOperation = dynamic(() => import('../managed/ManagerOperation'), { ssr: false });
// Las CEREMONIAS DE CONFIGURACIÓN: el alta del gestor y la del exchange, cada una UNA vez,
// en su ventana — las mesas y el hub de altas las abren con una puerta.
const ManagerSetupOperation = dynamic(() => import('../managed/ManagerSetupOperation'), { ssr: false });
const ExchangeSetupOperation = dynamic(() => import('../demo-exchange/stage/ExchangeSetupOperation'), { ssr: false });

/** Carcasa dual de la orden de consejo — el hub solo escribe {account,
 *  vaultTitle}; la cabecera (anclar/minimizar/cerrar) vive aquí. */
function CageOperation({ account, vaultTitle, onClose }: { account: string; vaultTitle: string; onClose: () => void }) {
  const { t } = useT();
  const docked = useDockStore((st) => st.docked);
  const setDocked = useDockStore((st) => st.setDocked);
  const minimizeActive = useOperationStore((st) => st.minimizeActive);
  return (
    <OperationSurface docked={docked} title={`${vaultTitle} · ${t('Council order')}`} onClose={onClose}>
      <div className="shrink-0 flex items-start justify-between px-6 py-5 border-b border-ink/5">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border border-[var(--authority-border)] bg-[var(--authority-soft)] text-ink/60">
            <Landmark className="h-3 w-3" />
            {t('Council order · the cage')}
          </span>
          <h2 className="mt-1.5 text-lg font-semibold text-ink capitalize">{vaultTitle}</h2>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
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
          <CloseOperationButton onClose={onClose} />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
        <CouncilVaultEntry account={account} vaultTitle={vaultTitle} />
      </div>
    </OperationSurface>
  );
}

/** Qué componente encarna cada operación montada. */
function renderOp(op: HostedOp, close: () => void) {
  switch (op.kind) {
    case 'vault':
      return (
        <DemoVaultModal
          // Mismo contrato de remount que tenía la página: cambiar los inputs
          // precompilados reabre limpio (la identidad del op ya es el kind).
          key={op.initial ? `${op.initial.amount}-${op.initial.ratio}-${op.initial.targetHF}` : 'manual'}
          vault={op.vault}
          initial={op.initial}
          onClose={close}
        />
      );
    case 'pa':
      return (
        <PaActionsModal
          owner={op.owner}
          legs={op.legs}
          holders={op.holders}
          action={op.action}
          onClose={close}
          onChanged={op.onChanged}
        />
      );
    case 'cage':
      return <CageOperation account={op.account} vaultTitle={op.vaultTitle} onClose={close} />;
    case 'constitute':
      return <ConstituteOperation onClose={close} />;
    case 'reinforce':
      return <ReinforceOperation account={op.account} onClose={close} />;
    case 'govern':
      return <GovernOperation account={op.account} label={op.label} tab={op.tab} onClose={close} />;
    case 'manager':
      return <ManagerOperation onClose={close} />;
    case 'manager-setup':
      return <ManagerSetupOperation onClose={close} jumpTo={op.jump ?? null} />;
    case 'exchange-setup':
      return <ExchangeSetupOperation onClose={close} />;
    case 'agent':
      return <AgentOperation seed={op.seed} seedKey={op.seedKey} restoreId={op.restoreId} restoreKey={op.restoreKey} onClose={close} />;
  }
}

/**
 * OpErrorBoundary — una ventana que revienta se CIERRA sola, jamás tumba la
 * app. Desde que las ventanas sobreviven a la recarga, un
 * fallo dentro de una rehidratada (un chunk que ya no existe tras un deploy,
 * un dato persistido que ya no cuadra) subía al error boundary de la app… y
 * al recargar la ventana volvía, y el fallo con ella: un bucle sin salida.
 * Aquí el fallo se registra, la ventana se cierra (y con ello deja de
 * persistirse) y el resto del dashboard sigue vivo.
 */
class OpErrorBoundary extends Component<{ opId: string; onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[operation window ${this.props.opId}] closed after an error`, error, info.componentStack);
    const tr = (s: string) => translate(getStoredLang(), s);
    // Un chunk que ya no existe (deploy nuevo bajo una pestaña vieja) es un
    // problema de TODA la app, no de esta ventana: una recarga completa, una
    // sola vez, lo cura — y la ventana persistida vuelve entera.
    const stale = /ChunkLoadError|Loading chunk|dynamically imported module/i.test(`${error.name} ${error.message}`);
    if (stale && typeof window !== 'undefined') {
      try {
        const flag = 'astryum:chunk-reloaded';
        if (window.sessionStorage.getItem(flag) !== '1') {
          window.sessionStorage.setItem(flag, '1');
          window.location.reload();
          return;
        }
      } catch { /* sin sessionStorage: se cierra como cualquier otro fallo */ }
    }
    this.props.onFail();
    toast(tr('An operation window closed after an error'), {
      description: tr('Nothing was signed by that window after the error. Open it again from where you started; if it keeps happening, tell us what you were doing.'),
    });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function EarnOperationHost() {
  // MULTI-OP: hasta tres operaciones MONTADAS a la vez
  // — todas conservan su estado (importes, review, ceremonia) porque nunca se
  // desmontan al plegarse. Solo la activa se despliega; las demás son
  // píldoras en fila. El contexto OpWindow le cuenta a cada superficie su
  // papel; el hueco de píldora es el orden entre las no-activas.
  const ops = useOperationStore((s) => s.ops);
  const activeId = useOperationStore((s) => s.activeId);
  const activate = useOperationStore((s) => s.activate);
  const close = useOperationStore((s) => s.close);
  // LAS VENTANAS SOBREVIVEN A LA RECARGA: el host es
  // el único que las monta y vive en el shell, así que es quien las
  // rehidrata — una vez por carga de página.
  useEffect(() => {
    void rehydrateOperations();
  }, []);
  let pillSlot = 0;
  return (
    <>
      {ops.map((op) => {
        const active = op.id === activeId;
        const pillIndex = active ? 0 : pillSlot++;
        return (
          <OpWindowContext.Provider
            key={op.id}
            value={{ id: op.id, active, pillIndex, restore: () => activate(op.id) }}
          >
            <OpErrorBoundary opId={op.id} onFail={() => close(op.id)}>
              {renderOp(op, () => close(op.id))}
            </OpErrorBoundary>
          </OpWindowContext.Provider>
        );
      })}
    </>
  );
}

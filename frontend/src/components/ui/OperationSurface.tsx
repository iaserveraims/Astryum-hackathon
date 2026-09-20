'use client';

/**
 * OperationSurface — la operación en curso, en VENTANA o ANCLADA (fundador
 * 2026-08-25: «o sigues el proceso a ciegas o... anclarla a la derecha»).
 *
 * Flotante: el modal de siempre (patrón oro — overlay que scrollea, my-auto).
 * Anclada: un panel fijo al borde derecho; el dashboard entero se desliza a
 * la izquierda y el sidebar se colapsa a iconos (AppShell lee el dockStore).
 * SIN backdrop en modo anclado: el resto de la página queda VIVO — consultar
 * el portfolio mientras preparas la firma es exactamente el punto.
 *
 * En pantallas pequeñas el anclaje no existe (no hay lado al que deslizar):
 * el panel anclado ocupa la pantalla entera como una hoja — el botón de
 * anclar solo se ofrece en lg+ (lo pinta el header de cada operación).
 */

import { createContext, useContext, useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { ChevronUp, X } from 'lucide-react';
import ModalPortal, { PortalSuspenseContext } from './ModalPortal';
import { genieMotion } from './motion';
import { DOCK_MAX_W, DOCK_MIN_W, useDockStore } from '../../stores/dockStore';
import { useOperationStore } from '../../stores/operationStore';
import { useT } from '../../i18n/LanguageProvider';

/**
 * OpWindow — lo que el HOST le cuenta a cada superficie montada (multi-op,
 * fundador 2026-08-27: hasta TRES a la vez, solo una desplegada y las demás
 * plegadas en píldora): si es la activa, qué hueco de la fila de píldoras
 * ocupa, y cómo restaurarse. Sin contexto la superficie cae al comportamiento
 * de operación única de siempre (el flag global del dockStore).
 */
export interface OpWindow {
  /** La identidad de la operación en el store (p.ej. 'vault:v-earnxrp'):
   *  la clave con la que su asiento persiste y se readopta al recargar. */
  id: string;
  active: boolean;
  pillIndex: number;
  restore: () => void;
}
export const OpWindowContext = createContext<OpWindow | null>(null);

/** Ancho de píldora + hueco: la fila se reparte con offsets fijos. */
const PILL_W = 224;
const PILL_GAP = 10;

/**
 * CloseOperationButton — el cierre en DOS PASOS, nada intrusivo (fundador
 * 2026-08-27: «un mensaje de confirmación... si el usuario quiere cerrarla
 * del todo simplemente tiene que hacer clic al lado de la cruz donde
 * aparecerá el disclaimer»). Primer clic en la X: el aviso se despliega A SU
 * LADO y la X se ARMA (roja, con su halo). Segundo clic — en el aviso O EN
 * LA MISMA X (fundador 2026-09-12: «no me gusta que cliques una vez y tengas
 * que mover el ratón a la izquierda… tienes que poder cerrar dando dos veces
 * en la cruz») — cierre de verdad. Se desarma sola a los 4 s, con Escape, o
 * al sacar el ratón del conjunto — jamás un diálogo encima de la operación.
 */
export function CloseOperationButton({
  onClose,
  compact,
  immediate,
}: {
  onClose: () => void;
  /** Versión píldora: cruz pequeña con borde propio. */
  compact?: boolean;
  /** Cerrar A LA PRIMERA, sin el aviso (fundador 2026-08-29: el chat del
   *  agente «se tiene que poder cerrar de una») — la confirmación protege
   *  operaciones con firma a medias; una conversación no lo es. */
  immediate?: boolean;
}) {
  const { t } = useT();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setArmed(false); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); window.removeEventListener('keydown', onKey); };
  }, [armed]);
  // Salir con el ratón del conjunto (X + aviso) desarma con un respiro: cruzar
  // el hueco entre los dos no puede desarmar.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEnter = () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } };
  const onLeave = () => { if (!armed) return; leaveTimer.current = setTimeout(() => setArmed(false), 900); };
  return (
    <span className="flex items-center" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <AnimatePresence>
        {armed && (
          <motion.button
            initial={{ opacity: 0, x: 8, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={onClose}
            className="mr-1.5 whitespace-nowrap rounded-lg border border-tone-danger/30 bg-tone-danger/10 px-2 py-0.5 text-[11px] font-medium text-tone-danger transition-colors hover:bg-tone-danger/20"
          >
            {t('Close the operation')}
          </motion.button>
        )}
      </AnimatePresence>
      <button
        onClick={() => (immediate || armed ? onClose() : setArmed(true))}
        aria-expanded={immediate ? undefined : armed}
        title={immediate ? t('Close') : armed ? t('Click again to close') : t('Close…')}
        className={`transition-colors ${
          compact
            ? `shrink-0 border-l border-ink/10 px-2.5 py-2.5 ${armed ? 'bg-tone-danger/15 text-tone-danger' : 'text-ink/40 hover:bg-ink/5 hover:text-ink'}`
            : armed
              ? 'rounded-md text-tone-danger ring-2 ring-tone-danger/40'
              : 'text-ink/40 hover:text-ink'
        }`}
      >
        <X className={compact ? 'h-3.5 w-3.5' : 'w-5 h-5'} />
      </button>
    </span>
  );
}

/**
 * EL TAMAÑO DE LA VENTANA FLOTANTE (fundador 2026-09-15: «se abre en pequeñito…
 * el popup no cambia demasiado de tamaño, pero sí el fondo… siempre anclo la
 * configuración a la derecha y no es la solución, el popup bien hecho es lo
 * mejor»). Antes TODAS las operaciones flotaban en la misma caja de 42 rem de
 * ancho y 44 rem de alto: bien para un vault o una orden del consejo, pero
 * una ceremonia de seis estaciones con su raíl quedaba encogida en mitad de
 * una pantalla grande, con el fondo oscurecido alrededor.
 *   regular · la caja de siempre (vault, orden, agente, gobernar).
 *   wide    · las ceremonias: crece con la pantalla — hasta 84 rem de ancho
 *             (90 vw) y 72 rem de alto (92 dvh). A partir de 52 rem de caja el
 *             raíl de estaciones se pone al lado, como en la página. Medido:
 *             1152 px en un MacBook de 1280, 1344 px en un monitor de 2560.
 */
export type OperationSurfaceSize = 'regular' | 'wide';

const FLOATING_BOX: Record<OperationSurfaceSize, string> = {
  regular: 'max-w-2xl max-h-[min(90dvh,44rem)]',
  wide: 'max-w-[min(90vw,84rem)] max-h-[min(92dvh,72rem)]',
};

export function OperationSurface({
  docked,
  title,
  onClose,
  immediateClose,
  size = 'regular',
  children,
}: {
  docked: boolean;
  /** Lo que dice la píldora minimizada — el encabezado de la operación. */
  title?: string;
  /** La X de la píldora: cerrar la operación sin restaurarla. */
  onClose?: () => void;
  /** La X cierra a la primera (el agente); las operaciones confirman. */
  immediateClose?: boolean;
  /** La caja flotante: `wide` para las ceremonias (ver FLOATING_BOX). */
  size?: OperationSurfaceSize;
  children: React.ReactNode;
}) {
  const win = useContext(OpWindowContext);
  const legacyMinimized = useDockStore((st) => st.minimized);
  const reduce = useReducedMotion();
  // Multi-op: plegada = «no soy la activa» (lo decide el host); el flag
  // global viejo queda de red de seguridad para superficies sin host.
  const minimized = win ? !win.active : legacyMinimized;
  const restore = () => {
    if (win) win.restore();
    else useDockStore.getState().setMinimized(false);
  };
  // El dock se suelta solo al cerrarse la ÚLTIMA operación — cerrar una
  // píldora no puede robarle el panel a la que sigue desplegada. (El cleanup
  // corre tras salir del store, así que ops ya no incluye a esta.)
  useEffect(
    () => () => {
      if (useOperationStore.getState().ops.length === 0) {
        useDockStore.getState().setDocked(false);
      }
      useDockStore.getState().setMinimized(false);
    },
    [],
  );
  const width = useDockStore((st) => st.width);
  const setWidth = useDockStore((st) => st.setWidth);
  const setResizing = useDockStore((st) => st.setResizing);

  // El asa (fundador 2026-08-26): arrastrar el canto izquierdo redimensiona.
  // Listeners en window para no perder el puntero al salirse del asa; el
  // ancho se acota en el store y se recuerda entre sesiones.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setResizing(true);
    const onMove = (ev: PointerEvent) => setWidth(window.innerWidth - ev.clientX);
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  // ── UNA sola estructura, tres trajes (fundador 2026-08-29: al pasar de
  // anclado a ventana «se vuelve a generar todo el texto»). Las tres ramas de
  // antes desmontaban a los hijos en cada cambio de modo — plegar, anclar o
  // soltar REINICIABA el estado interior de la operación (el chat del agente
  // re-enviaba su seed; una ceremonia perdía su scroll). Ahora la cadena
  // Portal → contenedor → marco → hijos es SIEMPRE la misma: cambian las
  // clases, jamás la posición en el árbol — React no desmonta nada. Plegada,
  // el contenedor se esconde con `hidden` (display:none) y la píldora es un
  // hermano de cromo; el backdrop flotante es otro hermano, nunca un
  // envoltorio. lockScroll solo en flotante (ModalPortal lo re-registra por
  // efecto, sin remontar). ──
  const floating = !docked && !minimized;
  return (
    <ModalPortal lockScroll={floating}>
      {minimized && (
        <motion.div
          // EL GENIO al minimizar (fundador 2026-08-27): la píldora no aparece
          // — la ventana SE PLIEGA hacia el borde. Fila de píldoras multi-op:
          // cada una en su hueco fijo; `layout` recoloca a las vecinas.
          {...genieMotion(reduce, 'bottom-right')}
          layout
          style={{ right: 24 + (win?.pillIndex ?? 0) * (PILL_W + PILL_GAP), width: PILL_W }}
          className="fixed bottom-0 z-[60] flex items-center overflow-hidden rounded-t-xl border border-b-0 border-ink/15 bg-surface-1 shadow-2xl"
        >
          <button
            onClick={restore}
            className="flex min-w-0 flex-1 items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-ink/[0.04]"
          >
            <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-volt" />
            </span>
            <span className="min-w-0 truncate text-xs font-medium text-ink">{title}</span>
            <ChevronUp className="h-3.5 w-3.5 shrink-0 text-ink/40" />
          </button>
          {onClose && <CloseOperationButton onClose={onClose} compact immediate={immediateClose} />}
        </motion.div>
      )}

      {/* backdrop del modo flotante — hermano, para no envolver a los hijos */}
      {floating && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" aria-hidden />
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: minimized ? 0 : 1 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        // El ancho del dock vive en una var y solo la consume la clase lg: —
        // por debajo de lg el panel anclado es hoja completa.
        style={{ ['--dock-w' as never]: `${width}px` }}
        className={
          minimized
            ? 'hidden'
            : docked
              ? 'op-flow fixed inset-0 z-40 flex flex-col bg-surface-1 shadow-2xl lg:inset-auto lg:top-0 lg:right-0 lg:bottom-0 lg:w-[var(--dock-w)] lg:border-l lg:border-ink/10'
              : 'fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto md:p-6'
        }
      >
        {docked && !minimized && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={`resize (${DOCK_MIN_W}–${DOCK_MAX_W}px)`}
            onPointerDown={startResize}
            className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize lg:block hover:bg-volt/25 active:bg-volt/40 transition-colors"
          />
        )}
        <div
          className={
            docked || minimized
              ? 'flex min-h-0 flex-1 flex-col'
              : `op-flow bg-surface-1 border border-ink/10 rounded-2xl w-full ${FLOATING_BOX[size]} my-auto flex flex-col shadow-2xl overflow-hidden`
          }
        >
          {/* Plegada, los PORTALES de los hijos se pliegan con ella — el
              display:none de arriba solo alcanza al DOM en el árbol; un
              sub-modal portalado a <body> seguía a pantalla completa
              (revisión 2026-08-29, ver PortalSuspenseContext). */}
          <PortalSuspenseContext.Provider value={minimized}>{children}</PortalSuspenseContext.Provider>
        </div>
      </motion.div>
    </ModalPortal>
  );
}

export default OperationSurface;

import { create } from 'zustand';

/**
 * dockStore — la operación en curso, anclada (fundador 2026-08-25: «que se
 * pueda anclar a la derecha... el dashboard se desliza a la izquierda, la
 * barra lateral se colapsa a iconos, y la operación queda anclada»).
 *
 * UN solo hueco de anclaje: las operaciones son excluyentes entre sí (cada
 * modal ya es la única superficie viva), así que un booleano global basta.
 * AppShell lo lee para deslizar el contenido y colapsar el sidebar; la
 * superficie de la operación (OperationSurface) lo escribe. Quien monta la
 * operación lo suelta al desmontar — nunca queda un hueco fantasma.
 *
 * ANCHURA (fundador 2026-08-26: «que la tab de la derecha se pueda
 * redimensionar»): arrastrable por su canto izquierdo, acotada a
 * [360, 720]px y recordada entre sesiones. `resizing` apaga la transición
 * del margen del shell mientras se arrastra — un margen con transition
 * persiguiendo al puntero se siente como goma, no como asa.
 */
const WIDTH_KEY = 'astryum:dockWidth';
/** El modo anclado se recuerda (2026-09-09): una ventana rehidratada tras
 *  recargar vuelve al lado en que estaba, no a flotar en medio. */
const DOCKED_KEY = 'astryum:dockDocked';
/** El sidebar ABIERTO con algo anclado (fundador 2026-09-10): por defecto se
 *  pliega al raíl, pero en una pantalla ancha cabe entero al lado de la
 *  operación y el usuario decide. Se recuerda. */
const SIDEBAR_OPEN_KEY = 'astryum:dockSidebarOpen';

function initialSidebarOpen(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function initialDocked(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(DOCKED_KEY) === '1';
  } catch {
    return false;
  }
}
export const DOCK_MIN_W = 360;
// 720 → 1120 (fundador 2026-09-12: «hay que poder abrir más el anclaje»): con
// ~52rem de caja el raíl de estaciones vuelve al lado y el contenido respira.
// El tope real lo pone también la pantalla (setWidth deja sitio al resto).
export const DOCK_MAX_W = 1120;

function initialWidth(): number {
  if (typeof window === 'undefined') return 430;
  try {
    const raw = Number(window.localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(raw) && raw >= DOCK_MIN_W && raw <= DOCK_MAX_W) return raw;
  } catch {
    /* storage bloqueado — el defecto vale */
  }
  return 430;
}

interface DockState {
  docked: boolean;
  /** MINIMIZADA (fundador 2026-08-26: «como una ventana de navegador pero en
   *  el bottom») — la operación se pliega a una píldora abajo a la derecha,
   *  VIVA: su estado (prepare, review, importes) no se toca. Restaurar
   *  vuelve al modo anterior (flotante o anclada — `docked` no se pierde). */
  minimized: boolean;
  width: number;
  resizing: boolean;
  setDocked: (v: boolean) => void;
  /** Con algo anclado: sidebar completo (true) o raíl de iconos (false). */
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  setMinimized: (v: boolean) => void;
  setWidth: (w: number) => void;
  setResizing: (v: boolean) => void;
}

export const useDockStore = create<DockState>((set) => ({
  docked: initialDocked(),
  sidebarOpen: initialSidebarOpen(),
  minimized: false,
  width: initialWidth(),
  resizing: false,
  setDocked: (v) => {
    set({ docked: v });
    try {
      window.localStorage.setItem(DOCKED_KEY, v ? '1' : '0');
    } catch {
      /* storage bloqueado: el anclaje simplemente no se recuerda */
    }
  },
  setMinimized: (v) => set({ minimized: v }),
  setSidebarOpen: (v) => {
    set({ sidebarOpen: v });
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_KEY, v ? '1' : '0');
    } catch {
      /* storage bloqueado: no se recuerda, pero funciona */
    }
  },
  setWidth: (w) => {
    // Nunca más ancho que lo que deja sitio al sidebar y a un trozo de página.
    const roomMax = typeof window !== 'undefined' ? Math.max(DOCK_MIN_W, window.innerWidth - 420) : DOCK_MAX_W;
    const clamped = Math.min(DOCK_MAX_W, roomMax, Math.max(DOCK_MIN_W, Math.round(w)));
    set({ width: clamped });
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      /* best-effort */
    }
  },
  setResizing: (v) => set({ resizing: v }),
}));

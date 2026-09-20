/**
 * borrowFlow — la máquina que conduce la entrada y la salida de punta a punta.
 *
 * El problema que resuelve: hasta ahora cada tramo era una puerta distinta (un
 * modal para el puente, otro para la entrada, otro para el repago) y el usuario
 * tenía que saber cuál abrir, en qué orden y cuándo. La aplicación sabía todo
 * eso y no lo usaba: se limitaba a avisar de que faltaba algo.
 *
 * Aquí el flujo se DERIVA del estado real —dónde está el dinero, qué wallet
 * eligió, qué posición tiene— y avanza solo: prepara el paso, lo enseña, el
 * usuario firma, espera lo que haya que esperar, y pasa al siguiente. El
 * usuario nunca elige un paso; elige un destino.
 *
 * Todo lo de este fichero es lógica pura: qué pasos hacen falta, cuál toca
 * ahora y cómo avanza. Quien la ejecuta (el componente) es quien llama a los
 * prepare y a la firma. Separarlo es lo que permite testear el orden y las
 * transiciones sin red, sin cadena y sin wallet.
 */
import {
  planBorrowRoute,
  type BorrowRouteOptions,
  type FxrpOrigin,
  type StepKind,
  type WaitKind,
} from './fxrpOrigin';

export type StepStatus =
  | 'pending'     // aún no le toca
  | 'preparing'   // pidiendo la tx al servidor
  | 'ready'       // tx construida, esperando la firma del usuario
  | 'signing'     // en la wallet del usuario
  | 'settling'    // firmada; esperando confirmación o entrega
  | 'done'
  | 'failed'
  /** Salió y no se pudo leer el recibo: ni éxito ni fallo. NUNCA se reintenta. */
  | 'unconfirmed';

export interface FlowStep {
  kind: StepKind;
  status: StepStatus;
  /** Quién firma este paso. */
  signer: string;
  rail: 'xrpl' | 'evm';
  chainId?: number;
  /** Transacciones que lo componen (una firma si la wallet agrupa). */
  txCount: number;
  waitAfter?: WaitKind;
  /** Motivo cuando `failed`, o el hash cuando quedó sin confirmar. */
  detail?: string;
}

export interface FlowState {
  steps: FlowStep[];
  /** Índice del paso en curso. Igual a `steps.length` cuando ya no queda nada. */
  cursor: number;
}

/** El flujo que hace falta para entrar desde `origin`, ya listo para ejecutar. */
export function buildEntryFlow(
  origin: FxrpOrigin,
  destination: string,
  opts: BorrowRouteOptions = {},
): FlowState {
  const route = planBorrowRoute(origin, destination, opts);
  return {
    steps: route.steps.map((s) => ({
      kind: s.kind,
      status: 'pending' as StepStatus,
      signer: s.signer,
      rail: s.rail,
      chainId: s.chainId,
      txCount: s.txCount,
      waitAfter: s.waitAfter,
    })),
    cursor: 0,
  };
}

/** El paso en curso, o null si el flujo terminó. */
export function currentStep(state: FlowState): FlowStep | null {
  return state.steps[state.cursor] ?? null;
}

export function isComplete(state: FlowState): boolean {
  return state.cursor >= state.steps.length;
}

/** Cuántos pasos quedan por firmar (el actual incluido). */
export function remainingSignatures(state: FlowState): number {
  return Math.max(0, state.steps.length - state.cursor);
}

/**
 * Mueve el paso actual a `status`. Devuelve un estado NUEVO — nada se muta, así
 * que React ve el cambio y el historial del flujo se puede inspeccionar.
 */
export function setStatus(state: FlowState, status: StepStatus, detail?: string): FlowState {
  const step = state.steps[state.cursor];
  if (!step) return state;
  const steps = state.steps.map((s, i) => (i === state.cursor ? { ...s, status, detail } : s));
  return { ...state, steps };
}

/**
 * Cierra el paso actual y pasa al siguiente.
 *
 * Solo avanza desde un paso REALMENTE terminado. Un paso «sin confirmar» —la
 * transacción salió pero no se pudo leer su recibo— no avanza y tampoco se
 * reintenta: cada tramo de este flujo mueve dinero (el puente cobra su comisión
 * de entrega, la entrada paga gas), así que reintentar a ciegas es pagar dos
 * veces. Ahí el flujo se detiene y pregunta.
 */
export function advance(state: FlowState): FlowState {
  const step = state.steps[state.cursor];
  if (!step || step.status !== 'done') return state;
  return { ...state, cursor: state.cursor + 1 };
}

/** El flujo no puede continuar solo y necesita al usuario. */
export function isBlocked(state: FlowState): boolean {
  const step = currentStep(state);
  return !!step && (step.status === 'failed' || step.status === 'unconfirmed');
}

/**
 * Reintenta el paso actual. Solo se ofrece tras un fallo LIMPIO (`failed`):
 * desde `unconfirmed` está prohibido, porque no sabemos si la primera salió.
 */
export function retry(state: FlowState): FlowState {
  const step = currentStep(state);
  if (!step || step.status !== 'failed') return state;
  return setStatus(state, 'pending');
}

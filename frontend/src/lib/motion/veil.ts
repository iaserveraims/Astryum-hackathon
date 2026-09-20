/**
 * EL VELO DEL ARRANQUE, como señal (2026-09-14).
 *
 * AccessGate retiene un velo negro ~1,9 s en cada carga dura (el nacimiento
 * del asteroide) y lo funde en 0,45 s. El panel MONTA DEBAJO del velo en
 * cuanto la verificación pasa — a propósito, para que las lecturas arranquen
 * durante la ceremonia. Pero las coreografías de entrada (RevealGroup, Arrive)
 * arrancaban al montar, es decir, DETRÁS del velo: en Portfolio la impresión
 * entera termina en ~1,1 s y el filete en ~1,25 s, y el velo cae a los 1,9.
 * Cuando el fundador veía la página, ya estaba impresa del todo — «aparecen
 * todos los cuadros sin más», en los DOS temas, y solo en recarga dura;
 * navegando entre páginas la entrada sí se veía. Lo cazó la sesión paralela
 * astryum-73 sumando tiempos, no mirando.
 *
 * La corrección es que la coreografía arranque cuando el velo EMPIEZA A CAER,
 * no cuando el árbol monta. Esta es la señal: un store mínimo, sin React ni
 * zustand (lib/motion es puro y lo lee ui/motion.tsx por useSyncExternalStore).
 *
 * POR DEFECTO ESTÁ LEVANTADO. Solo AccessGate lo baja, mientras vela, y lo
 * vuelve a levantar al retirarse. Así nada que viva fuera de la puerta —o en
 * un test— se queda esperando a un velo que no existe: fallar hacia
 * «animar», nunca hacia «quedarse recortado».
 */

type Listener = () => void;

let lifted = true;
const listeners = new Set<Listener>();

export function setVeilLifted(next: boolean): void {
  if (lifted === next) return;
  lifted = next;
  listeners.forEach((l) => l());
}

export function isVeilLifted(): boolean {
  return lifted;
}

/** En el servidor no hay velo: siempre levantado. */
export function serverVeilLifted(): boolean {
  return true;
}

export function subscribeVeil(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

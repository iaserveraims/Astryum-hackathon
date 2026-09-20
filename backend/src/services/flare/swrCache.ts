/**
 * swrCache — stale-while-revalidate + fusión de peticiones para LECTURAS de
 * cadena (2026-09-11, tras la lentitud de la mesa del gestor y el «no se pudo
 * leer» de Running).
 *
 * POR QUÉ. El catálogo de potes, el estado de cada pote y la jaula de un
 * consejo se releían de Flare ENTEROS en cada petición, y cada pantalla los
 * pedía por duplicado (el shell y la estantería a la vez; la mesa, su consola
 * y su gobernanza, el mismo pote tres veces). Contra el RPC público, que
 * limita por IP, esa ráfaga acababa en 429 y el 429 en un 502 que la UI
 * pintaba como «la cadena no se pudo leer».
 *
 * QUÉ HACE. Mismo patrón que `PortfolioEngine` (staleGet/coalesce), en
 * memoria del proceso:
 *  · FRESCO (≤ freshMs): se sirve sin tocar la cadena.
 *  · PASADO (≤ staleMs): se sirve YA y se recalcula por detrás, una sola vez.
 *  · NADA: se calcula, y todas las peticiones concurrentes esperan la MISMA
 *    promesa (fusión) — una ráfaga de N lectores es UNA lectura de cadena.
 *  · Un fallo de recálculo NO borra lo servible: se reintenta a la siguiente.
 *
 * NO cachea errores: si no hay nada servible y el cálculo falla, el fallo se
 * propaga tal cual (la ruta decide su 502). «No pude leer» sigue sin ser «no
 * tienes».
 */

interface Entry<T> {
  value: T;
  at: number;
}

const entries = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export interface SwrOptions {
  /** Hasta aquí se sirve sin recalcular. */
  freshMs: number;
  /** Hasta aquí se sirve lo viejo mientras se recalcula por detrás. */
  staleMs: number;
  now?: () => number;
}

function coalesce<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = compute().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export async function swr<T>(key: string, opts: SwrOptions, compute: () => Promise<T>): Promise<T> {
  const now = (opts.now ?? Date.now)();
  const hit = entries.get(key) as Entry<T> | undefined;
  const age = hit ? now - hit.at : Infinity;

  if (hit && age <= opts.freshMs) return hit.value;

  const refresh = () =>
    coalesce(key, async () => {
      const value = await compute();
      entries.set(key, { value, at: (opts.now ?? Date.now)() });
      return value;
    });

  if (hit && age <= opts.staleMs) {
    // Servir lo viejo y recalcular por detrás. El fallo de fondo se traga a
    // propósito: lo servible sigue siéndolo hasta que caduque del todo.
    void refresh().catch(() => undefined);
    return hit.value;
  }

  return refresh();
}

/** Mirar SIN calcular: ¿hay algo servible, y hay un cálculo en vuelo? Para
 *  que una ruta pueda decir «se está leyendo, vuelve en unos segundos» en vez
 *  de dejar al cliente colgado hasta su tope. */
export function swrPeek<T>(key: string): { value: T | undefined; computing: boolean } {
  const hit = entries.get(key) as Entry<T> | undefined;
  return { value: hit?.value, computing: inflight.has(key) };
}

/** Borra las entradas cuya clave empieza por `prefix` (tras una escritura relayada, p. ej.). */
export function invalidateSwr(prefix: string): void {
  for (const k of entries.keys()) if (k.startsWith(prefix)) entries.delete(k);
}

/** Solo para tests. */
export function _resetSwrForTests(): void {
  entries.clear();
  inflight.clear();
}

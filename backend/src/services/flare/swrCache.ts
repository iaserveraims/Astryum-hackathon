/**
 * swrCache — stale-while-revalidate + fusión de peticiones para LECTURAS de
 * cadena (tras la lentitud de la mesa del gestor y el «no se pudo
 * leer» de Running).
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

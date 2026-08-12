/**
 * httpErrorMonitor — la ventana de errores 5xx de la API.
 *
 * Una petición que revienta quedaba solo en el log de Railway: el usuario veía
 * un error, nosotros no veíamos nada. Un 500 suelto es ruido (un timeout de un
 * RPC, un bot mandando basura); una RÁFAGA de 500 en la misma ruta es un
 * despliegue roto o una dependencia caída — y eso sí hay que saberlo ya.
 *
 * Por eso no se alerta por error: se cuenta en una ventana y el probe
 * `errores-http` del Sentinel mira la forma del conjunto. En memoria, anillo
 * acotado: esto no puede crecer ni con la API entera fallando.
 *
 * Solo se guardan método, ruta NORMALIZADA y código. Jamás cuerpos, cabeceras,
 * cookies ni querystrings — ahí viven tokens y datos de usuario (#2).
 */

export interface HttpErrorEvent {
  atMs: number;
  method: string;
  /** Ruta con los identificadores enmascarados: /api/wallets/:id, no el id. */
  route: string;
  status: number;
}

const MAX_EVENTS = 300;
const events: HttpErrorEvent[] = [];

/**
 * Enmascara lo que identifica a una persona o a un objeto concreto para que la
 * ráfaga se agrupe por RUTA y no se disperse en mil URLs distintas (y de paso
 * no se registran hashes ni direcciones). Segmentos que se sustituyen: números,
 * hex largo (hashes, direcciones), cuentas XRPL (r…) y cuids/uuids.
 */
export function normalizeRoute(path: string): string {
  const clean = path.split('?')[0];
  return clean
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      if (/^\d+$/.test(seg)) return ':n';
      if (/^(0x)?[0-9a-fA-F]{16,}$/.test(seg)) return ':hash';
      if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(seg)) return ':xrpl';
      if (/^c[a-z0-9]{20,}$/i.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return ':uuid';
      return seg;
    })
    .join('/');
}

export function recordHttpError(method: string, path: string, status: number, now = Date.now()): void {
  events.push({ atMs: now, method, route: normalizeRoute(path), status });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export interface HttpErrorWindow {
  total: number;
  windowMin: number;
  /** Rutas ordenadas por número de fallos, la peor primero. */
  top: Array<{ route: string; method: string; count: number; lastStatus: number }>;
}

/** Resumen de los 5xx de los últimos `windowMs`. */
export function httpErrorWindow(windowMs: number, now = Date.now()): HttpErrorWindow {
  const since = now - windowMs;
  const recent = events.filter((e) => e.atMs >= since);
  const byRoute = new Map<string, { route: string; method: string; count: number; lastStatus: number }>();
  for (const e of recent) {
    const k = `${e.method} ${e.route}`;
    const prev = byRoute.get(k);
    if (prev) {
      prev.count += 1;
      prev.lastStatus = e.status;
    } else {
      byRoute.set(k, { route: e.route, method: e.method, count: 1, lastStatus: e.status });
    }
  }
  return {
    total: recent.length,
    windowMin: Math.round(windowMs / 60_000),
    top: [...byRoute.values()].sort((a, b) => b.count - a.count).slice(0, 5),
  };
}

/** Solo tests. */
export function _resetHttpErrorsForTests(): void {
  events.length = 0;
}

/**
 * AstryumPoteCatalogService — qué potes existen, leído de la cadena.
 *
 * Hasta ahora el catálogo eran DOS direcciones en variables de entorno
 * (`NEXT_PUBLIC_POTE_A_ADDRESS` / `_B_`): añadir un pote exigía desplegar el
 * frontend, y un pote creado por un gestor sencillamente no existía para nadie.
 * Con potes que nacen bajo demanda eso deja de servir.
 *
 * La factory ya lo publica todo: `vaultCount()` + `allVaults(i)`. No hace falta
 * indexar eventos para SABER QUÉ POTES HAY — solo para saber de quién es cada
 * uno, porque la r-address del consejo viaja en el evento `StackCreated` y
 * on-chain solo queda su hash (irreversible por diseño).
 *
 * ── DOS REGLAS QUE ESTE MÓDULO NO NEGOCIA ──────────────────────────────────
 *
 * 1. ORDEN NEUTRO. Se devuelven en orden de creación, el que da el array. Sin
 *    ranking, sin destacados, sin ordenar por rendimiento. Ordenar es elegir, y
 *    elegir por el usuario es la diferencia entre publicar un catálogo y
 *    recomendar un producto (dictamen 3, Z12). Quien quiera otro orden lo aplica
 *    en su pantalla y se ve que lo aplicó.
 *
 * 2. «NO PUDE LEER» NUNCA ES «NO EXISTE». Un pote cuyo estado no se deja leer
 *    aparece igual, marcado como ilegible. Esconderlo lo haría desaparecer del
 *    catálogo de su propio dueño sin decir por qué — que es exactamente lo que
 *    pasó con la jaula sin registrar (22-ago) y le borró el principal del Home.
 */

import { ethers } from 'ethers';

const FACTORY_CATALOG_ABI = [
  'function vaultCount() view returns (uint256)',
  'function allVaults(uint256) view returns (address)',
  'function bridgeOf(bytes32) view returns (address)',
  'event StackCreated(bytes32 indexed councilAddressHash, string councilAddress, address indexed bridge, address indexed vault, address personalAccount)',
];

/**
 * La SEGUNDA generación (27-ago): potes que nacen de una JAULA. La factory de
 * jaulas enumera las jaulas; cada jaula enumera sus potes; la r-address del
 * consejo viaja en `CageCreated` igual que en `StackCreated`. Mismo catálogo,
 * mismas dos reglas: orden de creación, y «no pude leer» ≠ «no existe».
 */
const CAGE_FACTORY_CATALOG_ABI = [
  'function cageCount() view returns (uint256)',
  'function allCages(uint256) view returns (address)',
  'event CageCreated(bytes32 indexed councilAddressHash, string councilAddress, address indexed bridge, address indexed cage, address personalAccount)',
];
const CAGE_CATALOG_ABI = [
  'function poteCount() view returns (uint256)',
  'function potes(uint256) view returns (address)',
];

export type PoteGeneration = 'v1' | 'v2';
export interface PoteOrigin {
  generation: PoteGeneration;
  /** La jaula que gobierna el pote (solo v2). */
  cage: string | null;
}

const POTE_SUMMARY_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function COOLDOWN() view returns (uint48)',
  'function BUFFER_FLOOR_BPS() view returns (uint16)',
  'function maxVenueBps() view returns (uint16)',
  'function venueCount() view returns (uint256)',
  'function venues(uint256) view returns (address target, uint8 kind, uint64 readyAt, bool retired)',
  'function council() view returns (address)',
  'function director() view returns (address)',
  'function userGate() view returns (address)',
  // Solo en la generación V2: un pote v1 no lo tiene y se lee como null.
  'function maxDepositPerUser() view returns (uint256)',
];

const ERC20_META_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

export interface PoteVenueSummary {
  id: number;
  target: string;
  kind: number;
  /** Segundos que faltan para que el venue pueda recibir capital (0 = ya). */
  readyInSeconds: number;
  retired: boolean;
}

export interface PoteSummary {
  pote: string;
  /** null cuando el pote existe pero su estado no se dejó leer. */
  name: string | null;
  symbol: string | null;
  asset: { address: string; symbol: string; decimals: number } | null;
  totalAssets: string | null;
  cooldownSeconds: number | null;
  bufferFloorBps: number | null;
  maxVenueBps: number | null;
  /** La allowlist COMPLETA y visible: el usuario decide con esto delante. */
  venues: PoteVenueSummary[];
  /** La cuenta XRPL que gobierna este pote, si se pudo resolver del evento. */
  councilXrplAddress: string | null;
  /** true = tiene puerta de entrada on-chain (userGate) configurada. */
  gated: boolean;
  /**
   * true cuando el pote existe en la factory pero no se pudo leer su estado.
   * NO significa que esté vacío ni roto: significa que ahora no se sabe.
   */
  unreadable: boolean;
  /** 'v1' = pote suelto (factory de potes) · 'v2' = pote de una jaula. */
  generation: PoteGeneration;
  /** La jaula que lo gobierna (v2), o null. */
  cage: string | null;
  /** Tope de posición por cuenta, en base units (V2). '0' = sin tope; null = el pote no lo expone. */
  maxDepositPerUser: string | null;
}

/**
 * Llamar sin que un throw SÍNCRONO se lleve por delante lo ya lanzado.
 *
 * `contract.foo()` no siempre devuelve una promesa: si el ABI declara `foo` y el
 * contrato desplegado no la tiene —un pote nacido de una factory anterior—, la
 * llamada revienta en el sitio. Dentro de un array de promesas eso es peor de lo
 * que parece: las que YA se crearon se quedan sin nadie que las espere, y un
 * rechazo huérfano tumba el proceso entero en Node moderno. Es la misma familia
 * del crash por `emit('error')` sin oyente durante los 429 de Flare (17-ago).
 *
 * Esto convierte cualquier fallo, síncrono o no, en un rechazo normal que
 * `allSettled` sabe recoger.
 */
function callSafe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (e) {
    return Promise.reject(e);
  }
}

/** Cuántos potes hay. Barato: una sola llamada. */
export async function countPotes(provider: ethers.Provider, factoryAddress: string): Promise<number> {
  const factory = new ethers.Contract(factoryAddress, FACTORY_CATALOG_ABI, provider);
  return Number(await withRetry(() => factory.vaultCount()));
}

/**
 * Las direcciones de todos los potes, en orden de creación.
 *
 * Se leen de `allVaults(i)` una a una en vez de esperar un getter de array
 * entero porque el contrato no lo expone — y de todas formas el número de potes
 * es pequeño y acotado por el coste de crear cada uno.
 */
export async function listPoteAddresses(
  provider: ethers.Provider,
  factoryAddress: string,
): Promise<string[]> {
  const factory = new ethers.Contract(factoryAddress, FACTORY_CATALOG_ABI, provider);
  const count = Number(await withRetry(() => factory.vaultCount()));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(ethers.getAddress(await withRetry(() => factory.allVaults(i))));
  }
  return out;
}

/**
 * De quién es cada pote, leído de los eventos `StackCreated`.
 *
 * On-chain solo queda `keccak256(r-address)`, que no se puede deshacer: la
 * r-address legible viaja en el evento. Si el RPC no deja consultar el rango,
 * se devuelve un mapa vacío y cada pote se queda sin dueño visible — nunca un
 * dueño equivocado, y nunca un pote escondido por no saberlo.
 */
/**
 * queryFilter TROCEADO en ventanas de ≤30 bloques. El RPC público de Flare
 * rechaza rangos mayores («maximum is set to 30»), así que un `fromBlock →
 * latest` de cientos de bloques falla entero y deja el mapa de consejos vacío
 * (bug 6-sep: el pote recién creado no aparecía porque su consejo salía null).
 * Trocear lo hace robusto; un chunk que falle no tumba los demás.
 */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Reintenta una lectura puntual (429/transitorio). Las lecturas de ÍNDICE
 * (`cageCount`, `allCages(i)`, `vaultCount`, `allVaults(i)`, `poteCount`,
 * `potes(i)`) no estaban protegidas: un 429 del RPC compartido — visto desde el
 * egress de Railway, y ahora más probable porque el escaneo corre en paralelo a
 * la vez que ellas — las hacía LANZAR y tumbaba el catálogo entero con un 502
 * («catalogue could not be read»). Ahora reintentan con backoff antes de rendirse.
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(150 * (i + 1));
    }
  }
  throw last;
}

// El tamaño de ventana de `getLogs`. El RPC PÚBLICO de Flare rechaza rangos
// mayores de 30 bloques; un RPC propio (Ankr, dRPC, nodo dedicado) admite miles
// y colapsa el rango decenas de veces. Configurable para poder aprovecharlo sin
// tocar código — por defecto, el límite seguro del público.
const GETLOGS_SPAN = (() => {
  const n = Number((process.env.FLARE_GETLOGS_SPAN ?? '').trim());
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
})();
// Ventanas simultáneas por lote. El RPC PÚBLICO limita por IP (429 desde el
// egress de Railway): a concurrencia 8 los 429 tumbaban el catálogo Y las
// lecturas de pote-state que corren a la vez (regresión 8-sep). Por defecto se
// mantiene BAJA — gentil con el público, absorbible por el retry. Subirla solo
// tiene sentido con un RPC propio que acepte la IP de Railway.
const GETLOGS_CONCURRENCY = (() => {
  const n = Number((process.env.FLARE_GETLOGS_CONCURRENCY ?? '').trim());
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 4;
})();

// El mínimo que CUALQUIER nodo de Flare acepta (el público topa justo aquí).
const GETLOGS_MIN_SPAN = 30;

/** Lo que devuelve un barrido: los eventos, hasta qué bloque se LEYÓ de verdad
 *  y si llegó al final. Un barrido a medias es progreso, no un hueco. */
interface ChunkedScan {
  events: ethers.EventLog[];
  scannedTo: number;
  complete: boolean;
}

// EL RATE-LIMIT DEL RPC (12-sep, medido contra Ankr público: 45 de 48
// ventanas a 429 «call rate limit exhausted, retry in 10s» con 4 en paralelo).
// Antes un 429 persistente acababa en `return []` silencioso — el consejo se
// perdía, el mapa no se llenaba nunca, el barrido seguía hasta latest a base
// de ventanas fallidas, y el catálogo tardaba minutos para salir SIN dueños.
// Ahora: se reconoce, se espera lo que el nodo pide (o backoff exponencial),
// se baja el ritmo del resto del barrido, y si aun así no hay manera, la
// ventana LANZA: el barrido para donde llegó y lo dice.
const RATE_LIMIT_RE = /429|too many requests|rate limit|retry in \d+/i;
let paceMs = 0;
function retryHintMs(msg: string): number {
  const m = /retry in (\d+)\s*s/i.exec(msg);
  return m ? Math.min(15_000, Number(m[1]) * 1000) : 0;
}

async function queryFilterChunked(
  provider: ethers.Provider,
  contract: ethers.Contract,
  filter: ethers.ContractEventName,
  fromBlock: number,
  toBlock: number,
): Promise<ChunkedScan> {
  // Una ventana [from,to], con hasta 5 intentos. Tres protecciones:
  //  · Un 429 se reconoce: se espera lo que el nodo pide (o 1s, 2s, 4s, 8s) y
  //    el barrido baja el ritmo (paceMs) para el resto de ventanas.
  //  · Un transitorio cualquiera se reintenta con backoff corto.
  //  · Si el RPC rechaza el RANGO como demasiado grande (span mal puesto para
  //    ESTE endpoint), la ventana se SUBDIVIDE en trozos de 30 y se reúnen.
  // Agotados los intentos, LANZA — jamás un [] que se lea como «sin eventos».
  const readWindow = async (from: number, to: number): Promise<ethers.EventLog[]> => {
    let last: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const evs = await contract.queryFilter(filter, from, to);
        return evs.filter((ev): ev is ethers.EventLog => Boolean((ev as ethers.EventLog).args));
      } catch (e) {
        last = e;
        const msg = String((e as { message?: unknown })?.message ?? e).toLowerCase();
        const rangeRejected = /too many blocks|range is too large|range too large|maximum is set to|response size exceeded/.test(msg);
        if (rangeRejected && to - from + 1 > GETLOGS_MIN_SPAN) {
          const subs: Array<[number, number]> = [];
          for (let s = from; s <= to; s += GETLOGS_MIN_SPAN) subs.push([s, Math.min(s + GETLOGS_MIN_SPAN - 1, to)]);
          const acc: ethers.EventLog[] = [];
          for (let i = 0; i < subs.length; i += GETLOGS_CONCURRENCY) {
            const b = subs.slice(i, i + GETLOGS_CONCURRENCY);
            const rs = await Promise.all(b.map(([f, t]) => readWindow(f, t)));
            for (const r of rs) acc.push(...r);
          }
          return acc;
        }
        if (attempt === 4) break;
        if (RATE_LIMIT_RE.test(msg)) {
          paceMs = Math.min(2_000, Math.max(paceMs, 400));
          await sleep(Math.max(retryHintMs(msg), 1_000 * 2 ** attempt));
        } else {
          await sleep(150 * (attempt + 1));
        }
      }
    }
    throw last instanceof Error ? last : new Error(String(last));
  };

  // Todas las ventanas [from,to] al span configurado, EN PARALELO POR LOTES de
  // GETLOGS_CONCURRENCY. Si un lote no hay manera de leerlo, se PARA AHÍ y se
  // devuelve hasta dónde se llegó: la caché guarda ese progreso y la siguiente
  // pasada sigue desde él — nunca se salta un tramo ni se inventa «leído».
  const windows: Array<[number, number]> = [];
  for (let from = fromBlock; from <= toBlock; from += GETLOGS_SPAN) {
    windows.push([from, Math.min(from + GETLOGS_SPAN - 1, toBlock)]);
  }
  const out: ethers.EventLog[] = [];
  let scannedTo = fromBlock - 1;
  for (let i = 0; i < windows.length; i += GETLOGS_CONCURRENCY) {
    if (paceMs > 0 && i > 0) await sleep(paceMs);
    const batch = windows.slice(i, i + GETLOGS_CONCURRENCY);
    try {
      const results = await Promise.all(batch.map(([f, t]) => readWindow(f, t)));
      for (const r of results) out.push(...r);
      scannedTo = batch[batch.length - 1][1];
    } catch {
      return { events: out, scannedTo, complete: false };
    }
  }
  return { events: out, scannedTo, complete: true };
}

/**
 * CACHE INCREMENTAL de resolución de consejos (6-sep, arregla la lentitud).
 *
 * Los eventos `CageCreated`/`StackCreated` son INMUTABLES: una jaula creada en
 * el bloque X gobierna al consejo Y para siempre. Así que en vez de re-escanear
 * `fromBlock → latest` (decenas de llamadas RPC en serie) en CADA carga del
 * catálogo, cada factory guarda su mapa y el último bloque escaneado; la
 * siguiente carga solo mira los bloques NUEVOS. El primer scan cuesta; los
 * demás son casi gratis. Vive en memoria del proceso (se pierde al reiniciar,
 * y se re-llena solo).
 */
interface CouncilCache {
  map: Map<string, string>;
  scannedTo: number;
}
const councilCaches = new Map<string, CouncilCache>();

/**
 * LA CACHÉ DE CONSEJOS PERSISTE (2026-09-12): vivía solo en memoria y cada
 * deploy de Railway (= cada push a la rama) la vaciaba, así que el primer
 * catálogo tras cada deploy volvía a escanear eventos desde el bloque de
 * origen — minutos contra el RPC público, y el cliente agotaba su tope
 * («The catalogue could not be read right now»). Ahora cada mapa se guarda
 * en `background_jobs` (jobType 'catalog-council-cache', vía backgroundJobKv:
 * sin migración, best-effort) con hasta dónde se escaneó, y al arrancar se
 * retoma desde ahí: el frío solo escanea los bloques nuevos.
 *
 * Solo se reutiliza si el fromBlock guardado ≤ el pedido (un fromBlock más
 * temprano en el entorno significaría huecos por detrás: se rehace).
 */
const KV_JOB = 'catalog-council-cache';
const loadedKeys = new Set<string>();

async function loadPersistedCache(cacheKey: string, fromBlock: number): Promise<CouncilCache | null> {
  try {
    const { kvGet } = await import('../persistence/backgroundJobKv');
    const row = await kvGet(KV_JOB, 'cacheKey', cacheKey);
    if (!row) return null;
    const entries = row.entries as Array<[string, string]> | undefined;
    const scannedTo = Number(row.scannedTo);
    const savedFrom = Number(row.fromBlock);
    if (!Array.isArray(entries) || !Number.isFinite(scannedTo) || !Number.isFinite(savedFrom) || savedFrom > fromBlock) return null;
    return { map: new Map(entries), scannedTo };
  } catch {
    return null;
  }
}

function persistCache(cacheKey: string, cache: CouncilCache, fromBlock: number): void {
  void import('../persistence/backgroundJobKv')
    .then(({ kvUpsert }) => kvUpsert(KV_JOB, 'cacheKey', cacheKey, { cacheKey, fromBlock, scannedTo: cache.scannedTo, entries: [...cache.map.entries()], savedAt: new Date().toISOString() }))
    .catch(() => undefined);
}

async function resolveCouncilsCached(
  provider: ethers.Provider,
  factory: ethers.Contract,
  filter: ethers.ContractEventName,
  cacheKey: string,
  fromBlock: number,
  /** (args) → [claveEnMinusculas (vault/cage), r-address] o null si no aplica. */
  extract: (args: ethers.Result) => [string, string] | null,
  /** Cuántas entradas dice el CONTRATO que hay (cageCount/vaultCount): en cuanto
   *  el mapa las tiene todas, el escaneo PARA — las jaulas viven cerca de
   *  fromBlock, no hasta latest. Sin él se escanea hasta latest (comportamiento
   *  viejo). Es lo que mata el arranque en frío de ~130k bloques. */
  expectedCount?: number,
  /** DIFERIDO (12-sep): devuelve lo que la caché ya sabe y, si falta algo,
   *  escanea POR DETRÁS (un solo escaneo por clave, con reintentos espaciados)
   *  guardando el progreso. El catálogo sale en segundos con los consejos que
   *  ya se conocen; los demás aparecen en la siguiente lectura. */
  defer = false,
): Promise<Map<string, string>> {
  // Sin `getBlockNumber` (proveedor mock o limitado) no hay cache incremental:
  // se hace un scan directo `fromBlock → latest`, que es lo que los tests
  // mockean. En producción el provider real sí lo tiene → cache rápido.
  let latest: number;
  try {
    latest = await provider.getBlockNumber();
    if (!Number.isFinite(latest)) throw new Error('no block number');
  } catch {
    const map = new Map<string, string>();
    // Diferido y sin número de bloque (el nodo también limitó eso): nada de
    // barridos gigantes en línea — se devuelve vacío y la siguiente lectura,
    // con el nodo respirando, ya encontrará el número y escaneará por detrás.
    if (defer) return map;
    try {
      const events = await factory.queryFilter(filter, fromBlock, 'latest');
      for (const ev of events) {
        const args = (ev as ethers.EventLog).args;
        if (!args) continue;
        const kv = extract(args);
        if (kv) map.set(kv[0], kv[1]);
      }
    } catch {
      // Sin eventos legibles, mapa vacío — el catálogo sigue, solo sin dueños.
    }
    return map;
  }
  let cache = councilCaches.get(cacheKey);
  if (!cache) {
    // Primero lo persistido (si lo hay y cubre este fromBlock); si no, vacío.
    if (!loadedKeys.has(cacheKey)) {
      loadedKeys.add(cacheKey);
      cache = (await loadPersistedCache(cacheKey, fromBlock)) ?? undefined;
    }
    if (!cache) cache = { map: new Map(), scannedTo: fromBlock - 1 };
    councilCaches.set(cacheKey, cache);
  }
  // Caché caliente y completa: ni tocamos la cadena.
  if (expectedCount != null && expectedCount > 0 && cache.map.size >= expectedCount) {
    return cache.map;
  }
  const start = Math.max(fromBlock, cache.scannedTo + 1);
  if (start > latest) return cache.map;

  // EL ESCANEO, como función: en línea (como siempre) o por detrás (defer).
  // Devuelve si llegó a completarse (todas las entradas, o latest).
  const c = cache;
  const scanNow = async (): Promise<boolean> => {
    let complete = true;
    try {
      if (expectedCount != null && expectedCount > 0) {
        // PARADA TEMPRANA: se avanza por segmentos y se para en cuanto el mapa
        // tiene las `expectedCount` que dice el contrato. Las jaulas se crean
        // justo tras el deploy de la factory (cerca de fromBlock), así que se
        // encuentran en los primeros segmentos y NO se barre hasta latest.
        const SEGMENT = GETLOGS_SPAN * GETLOGS_CONCURRENCY * 8;
        let scanned = start - 1;
        let partial = false;
        for (let from = start; from <= latest && c.map.size < expectedCount; from += SEGMENT) {
          const to = Math.min(from + SEGMENT - 1, latest);
          const scan = await queryFilterChunked(provider, factory, filter, from, to);
          for (const ev of scan.events) {
            if (!ev.args) continue;
            const kv = extract(ev.args);
            if (kv) c.map.set(kv[0], kv[1]);
          }
          scanned = scan.scannedTo;
          // El RPC no dio más de sí: se guarda hasta dónde se llegó y se sigue
          // en la próxima pasada. Ni hueco ni «leído» inventado.
          if (!scan.complete) { partial = true; break; }
        }
        // Si las encontramos todas antes de latest, recordamos DÓNDE paramos: el
        // hueco hasta latest solo se escanea si aparece una jaula NUEVA (el
        // contrato sube expectedCount y el mapa vuelve a quedarse corto).
        c.scannedTo = partial || c.map.size >= expectedCount ? scanned : latest;
        complete = !partial;
        persistCache(cacheKey, c, fromBlock);
      } else {
        const scan = await queryFilterChunked(provider, factory, filter, start, latest);
        for (const ev of scan.events) {
          if (!ev.args) continue;
          const kv = extract(ev.args);
          if (kv) c.map.set(kv[0], kv[1]);
        }
        c.scannedTo = scan.complete ? latest : scan.scannedTo;
        complete = scan.complete;
        persistCache(cacheKey, c, fromBlock);
      }
    } catch {
      // Un fallo de scan no borra lo ya cacheado; se reintenta la próxima.
      complete = false;
    }
    return complete;
  };

  if (defer) {
    kickBackgroundScan(cacheKey, scanNow);
    return cache.map;
  }
  await scanNow();
  return cache.map;
}

/**
 * SEMBRAR consejos conocidos (12-sep): la app YA sabe r-addresses de raíces
 * (perfiles de gestor, runs del exchange) y la factory contesta `cageOf(hash)`
 * con una llamada barata. Lo que se resuelve así entra en la caché — y si con
 * ello el mapa cubre `cageCount`, el escaneo de eventos ni arranca. Es lo que
 * permite tener los nombres de los consejos sin depender del getLogs del RPC.
 */
export function seedCageCouncils(cageFactoryAddress: string, entries: Array<[cage: string, council: string]>): void {
  if (entries.length === 0) return;
  const cacheKey = `cage:${cageFactoryAddress.toLowerCase()}`;
  let cache = councilCaches.get(cacheKey);
  if (!cache) {
    cache = { map: new Map(), scannedTo: -1 };
    councilCaches.set(cacheKey, cache);
  }
  for (const [cage, council] of entries) cache.map.set(cage.toLowerCase(), council);
}

/**
 * EL ESCANEO POR DETRÁS (12-sep): uno por clave a la vez; si no llegó al
 * final (el nodo limitó), vuelve a intentarlo a los 30 s; si falló, al minuto.
 * Cada pasada guarda su progreso, así que nunca se repite lo ya leído. Es lo
 * que permite servir el catálogo en segundos aunque el RPC público del
 * catálogo conteste 429 a la mitad de las ventanas.
 */
const scanning = new Set<string>();
function kickBackgroundScan(cacheKey: string, scanNow: () => Promise<boolean>): void {
  if (scanning.has(cacheKey)) return;
  scanning.add(cacheKey);
  void scanNow()
    .then((complete) => {
      scanning.delete(cacheKey);
      if (!complete) setTimeout(() => kickBackgroundScan(cacheKey, scanNow), 30_000).unref?.();
    })
    .catch(() => {
      scanning.delete(cacheKey);
      setTimeout(() => kickBackgroundScan(cacheKey, scanNow), 60_000).unref?.();
    });
}

export async function resolveCouncilAddresses(
  provider: ethers.Provider,
  factoryAddress: string,
  fromBlock: number = 0,
  expectedCount?: number,
  defer = false,
): Promise<Map<string, string>> {
  const factory = new ethers.Contract(factoryAddress, FACTORY_CATALOG_ABI, provider);
  return resolveCouncilsCached(
    provider,
    factory,
    factory.filters.StackCreated(),
    `stack:${factoryAddress.toLowerCase()}`,
    fromBlock,
    (args) => [ethers.getAddress(String(args.vault)).toLowerCase(), String(args.councilAddress)],
    expectedCount,
    defer,
  );
}

/** El resumen de UN pote. Nunca lanza: un pote ilegible se marca, no desaparece. */
export async function readPoteSummary(
  provider: ethers.Provider,
  pote: string,
  councilXrplAddress: string | null = null,
  origin: PoteOrigin = { generation: 'v1', cage: null },
): Promise<PoteSummary> {
  const address = ethers.getAddress(pote);
  const blank: PoteSummary = {
    pote: address,
    name: null,
    symbol: null,
    asset: null,
    totalAssets: null,
    cooldownSeconds: null,
    bufferFloorBps: null,
    maxVenueBps: null,
    venues: [],
    councilXrplAddress,
    gated: false,
    unreadable: true,
    generation: origin.generation,
    cage: origin.cage,
    maxDepositPerUser: null,
  };

  try {
    const c = new ethers.Contract(address, POTE_SUMMARY_ABI, provider);

    // allSettled y no all, y no es estilo: con `Promise.all`, si una lectura
    // rechaza, las OTRAS siguen vivas y sus rechazos se quedan sin dueño. Un
    // unhandled rejection tumba el proceso en Node moderno — que es justo cómo
    // murió el backend con los 429 de Flare (17-ago). Cuando el RPC se cae, se
    // caen las nueve a la vez: exactamente el caso que no puede matar a nadie.
    const settled = await Promise.allSettled([
      callSafe<string>(() => c.name()),
      callSafe<string>(() => c.symbol()),
      callSafe<string>(() => c.asset()),
      callSafe<bigint>(() => c.totalAssets()),
      callSafe<bigint>(() => c.COOLDOWN()),
      callSafe<bigint>(() => c.BUFFER_FLOOR_BPS()),
      callSafe<bigint>(() => c.maxVenueBps()),
      callSafe<bigint>(() => c.venueCount()),
      callSafe<string>(() => c.userGate()),
      callSafe<bigint>(() => c.maxDepositPerUser()),
    ]);

    // El pote se considera legible cuando lo esencial se leyó. `userGate` y
    // `maxDepositPerUser` no entran: son opcionales (v1 no tiene el segundo) y
    // no saberlos no invalida lo demás.
    const essential = settled.slice(0, 8);
    if (essential.some((r) => r.status === 'rejected')) return blank;

    const val = <T,>(i: number, fallback: T): T =>
      settled[i].status === 'fulfilled' ? ((settled[i] as PromiseFulfilledResult<T>).value as T) : fallback;

    const name = val<string>(0, '');
    const symbol = val<string>(1, '');
    const assetAddr = val<string>(2, ethers.ZeroAddress);
    const totalAssets = val<bigint>(3, 0n);
    const cooldown = val<bigint>(4, 0n);
    const bufferFloorBps = val<bigint>(5, 0n);
    const maxVenueBps = val<bigint>(6, 0n);
    const venueCount = val<bigint>(7, 0n);
    const userGate = val<string>(8, ethers.ZeroAddress);
    const maxDepositPerUser =
      settled[9].status === 'fulfilled' ? ((settled[9] as PromiseFulfilledResult<bigint>).value).toString() : null;

    const asset = new ethers.Contract(assetAddr, ERC20_META_ABI, provider);
    const assetMeta = await Promise.allSettled([
      callSafe<string>(() => asset.symbol()),
      callSafe<bigint>(() => asset.decimals()),
    ]);
    const assetSymbol = assetMeta[0].status === 'fulfilled' ? (assetMeta[0].value as string) : '?';
    const assetDecimals = assetMeta[1].status === 'fulfilled' ? (assetMeta[1].value as bigint) : 18n;

    const now = Math.floor(Date.now() / 1000);
    const venues: PoteVenueSummary[] = [];
    for (let i = 0; i < Number(venueCount); i++) {
      try {
        const v = await c.venues(i);
        const readyAt = Number(v.readyAt ?? v[2]);
        venues.push({
          id: i,
          target: ethers.getAddress(String(v.target ?? v[0])),
          kind: Number(v.kind ?? v[1]),
          readyInSeconds: readyAt > now ? readyAt - now : 0,
          retired: Boolean(v.retired ?? v[3]),
        });
      } catch {
        // Un venue ilegible no invalida el pote entero: se omite ese y sigue.
      }
    }

    return {
      pote: address,
      name,
      symbol,
      asset: { address: ethers.getAddress(assetAddr), symbol: assetSymbol, decimals: Number(assetDecimals) },
      totalAssets: totalAssets.toString(),
      cooldownSeconds: Number(cooldown),
      bufferFloorBps: Number(bufferFloorBps),
      maxVenueBps: Number(maxVenueBps),
      venues,
      councilXrplAddress,
      gated: userGate !== ethers.ZeroAddress,
      unreadable: false,
      generation: origin.generation,
      cage: origin.cage,
      maxDepositPerUser,
    };
  } catch {
    return blank;
  }
}

/**
 * El catálogo entero, en orden de creación.
 *
 * `fromBlock` acota la consulta de eventos: sin él algunos RPC rechazan el rango
 * completo. Que falle solo cuesta los nombres de los consejos, nunca los potes.
 */
export async function listPotes(
  provider: ethers.Provider,
  factoryAddress: string,
  opts?: { fromBlock?: number; deferCouncilScan?: boolean },
): Promise<PoteSummary[]> {
  if (!ethers.isAddress(factoryAddress)) return [];

  // Primero las direcciones (vaultCount/allVaults, barato): su número dice
  // cuántos consejos esperar, y con eso el escaneo de eventos PARA temprano en
  // vez de barrer hasta latest en cada arranque en frío.
  const addresses = await listPoteAddresses(provider, factoryAddress);
  const councils = await resolveCouncilAddresses(provider, factoryAddress, opts?.fromBlock ?? 0, addresses.length, opts?.deferCouncilScan === true);

  // En serie a propósito: son pocos y cada uno hace varias lecturas. Un
  // Promise.all sobre N potes × ~10 llamadas es la forma de comerse el rate
  // limit del RPC compartido (incidente 429 de Flare en Railway, 17-ago).
  const out: PoteSummary[] = [];
  for (const a of addresses) {
    out.push(await readPoteSummary(provider, a, councils.get(a.toLowerCase()) ?? null));
  }
  return out;
}

// ── La generación v2: potes de jaulas ───────────────────────────────────────

/** Las jaulas, en orden de creación. */
export async function listCageAddresses(provider: ethers.Provider, cageFactoryAddress: string): Promise<string[]> {
  const factory = new ethers.Contract(cageFactoryAddress, CAGE_FACTORY_CATALOG_ABI, provider);
  const count = Number(await withRetry(() => factory.cageCount()));
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(ethers.getAddress(await withRetry(() => factory.allCages(i))));
  return out;
}

/** jaula → r-address de su consejo, de los eventos `CageCreated`. Vacío si no se pudo leer. */
export async function resolveCageCouncils(
  provider: ethers.Provider,
  cageFactoryAddress: string,
  fromBlock: number = 0,
  expectedCount?: number,
  defer = false,
): Promise<Map<string, string>> {
  const factory = new ethers.Contract(cageFactoryAddress, CAGE_FACTORY_CATALOG_ABI, provider);
  return resolveCouncilsCached(
    provider,
    factory,
    factory.filters.CageCreated(),
    `cage:${cageFactoryAddress.toLowerCase()}`,
    fromBlock,
    (args) => [ethers.getAddress(String(args.cage)).toLowerCase(), String(args.councilAddress)],
    expectedCount,
    defer,
  );
}

/**
 * Los potes de TODAS las jaulas, en orden de creación (jaula a jaula, pote a
 * pote). Cada uno lleva su jaula y la cuenta XRPL que la gobierna. Una jaula
 * cuyos potes no se dejan enumerar se salta (no hay nada que enseñar de ella
 * todavía); un pote ilegible aparece marcado, como en la v1.
 */
export async function listCagePotes(
  provider: ethers.Provider,
  cageFactoryAddress: string,
  opts?: { fromBlock?: number; deferCouncilScan?: boolean },
): Promise<PoteSummary[]> {
  if (!ethers.isAddress(cageFactoryAddress)) return [];
  // Primero las jaulas (cageCount/allCages, barato): su número dice cuántos
  // consejos esperar, y con eso el escaneo de `CageCreated` PARA temprano en
  // vez de barrer hasta latest en cada arranque en frío.
  const cages = await listCageAddresses(provider, cageFactoryAddress);
  const councils = await resolveCageCouncils(provider, cageFactoryAddress, opts?.fromBlock ?? 0, cages.length, opts?.deferCouncilScan === true);
  const out: PoteSummary[] = [];
  for (const cage of cages) {
    let potes: string[] = [];
    try {
      const c = new ethers.Contract(cage, CAGE_CATALOG_ABI, provider);
      const n = Number(await withRetry(() => c.poteCount()));
      for (let i = 0; i < n; i++) potes.push(ethers.getAddress(await withRetry(() => c.potes(i))));
    } catch {
      potes = [];
    }
    const council = councils.get(cage.toLowerCase()) ?? null;
    for (const p of potes) {
      out.push(await readPoteSummary(provider, p, council, { generation: 'v2', cage }));
    }
  }
  return out;
}

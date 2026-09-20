'use client';

/**
 * accountQuorum — ¿esta cuenta XRPL firma sola, o por quórum?
 *
 * La pregunta la contesta la CADENA y nada más. Ni una marca de `localStorage`
 * (no viaja entre navegadores), ni el registro de cuentas gobernadas (una
 * cuenta personal reforzada no está en él), ni si la wallet está «conectada»
 * (una cuenta con la llave maestra deshabilitada NO PUEDE conectarse: no le
 * queda ninguna llave capaz de hacerlo). Cada uno de esos atajos ya falló.
 *
 * Lectura pública y de sólo lectura, cacheada por dirección. Se consulta justo
 * antes de firmar, que es el único momento en el que la respuesta importa.
 *
 * it. 27 (§4) — ESTA ES LA SEGUNDA LECTURA, Y NO ES LA QUE MANDA. El backend lee
 * el MISMO SignerList (`signingCeremonyFor`) y con él compone el 0xFE: la ventana
 * que decide viaja DENTRO de los bytes firmados como `LastLedgerSequence`, así
 * que la suya es la que ya dio forma a la transacción. Cuando las dos discrepan
 * gana la del servidor (`serverDeclaredCeremony`, en `lib/wallet/handoffRelease`),
 * y esta queda como el respaldo para lo que el servidor no compuso — una
 * constitución, un envío suelto, cualquier tx sin memo de 0xFE. Ver el desvío en
 * `lib/wallet/useXrplWalletPartner.ts`.
 *
 * FAIL-SAFE HACIA LA CEREMONIA, NO HACIA LA FIRMA ÚNICA: si la lectura falla no
 * se afirma «no tiene quórum». Firmar sola una cuenta que sí lo tiene produce
 * una firma inútil que la red rechaza; esperar una ceremonia en una cuenta que
 * firma sola sólo produce una pantalla que el usuario cierra. Se devuelve
 * `null` («no lo sé») y quien llama decide — hoy, seguir por el camino de
 * siempre, porque el 99% de las cuentas firman solas y bloquear todas las
 * firmas por un nodo caído sería peor.
 */

/**
 * it. 29 (§5) — UN SOLO NODO ERA UN SOLO PUNTO DE «NO LO SÉ».
 *
 * This asked `xrplcluster.com` and nothing else, so one sick balancer member
 * turned every account in the house into `null` — and `null` is the answer that
 * used to fall through to a single signature with a `Sequence` Xaman fills in.
 * The cure for an unread fact is to READ IT SOMEWHERE ELSE before deciding
 * anything, exactly as the broadcast path already does (`SUBMIT_NODES`).
 *
 * Browser-reachable means CORS: `xrplcluster.com` and `xrpl.link` send
 * `Access-Control-Allow-Origin`, `s1.ripple.com` does not — it is kept last
 * because it costs nothing here and does help outside a browser (tests, SSR).
 * The first node that gives a REAL answer wins; a node that fails is simply not
 * a verdict, and the next one is asked.
 */
const RPC_NODES = ['https://xrplcluster.com/', 'https://xrpl.link/', 'https://s1.ripple.com:51234/'];
const TTL_MS = 60_000;

interface CacheRow {
  at: number;
  /** true = tiene SignerList; false = no; null = no se pudo leer. */
  quorum: boolean | null;
}

const cache = new Map<string, CacheRow>();
const inflight = new Map<string, Promise<boolean | null>>();

/** Test hook — deja el módulo como recién cargado. */
export function __resetAccountQuorumCache(): void {
  cache.clear();
  inflight.clear();
}

async function readFrom(rpc: string, address: string): Promise<boolean | null> {
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'account_objects',
        params: [{ account: address, type: 'signer_list', ledger_index: 'validated' }],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      result?: { error?: string; account_objects?: Array<{ LedgerEntryType?: string }> };
    };
    const result = body.result;
    if (!result) return null;
    // `actNotFound` es una respuesta REAL: la cuenta no existe, luego no tiene
    // quórum. Cualquier otro error es una lectura fallida, no un veredicto.
    if (result.error) return result.error === 'actNotFound' ? false : null;
    if (!Array.isArray(result.account_objects)) return null;
    return result.account_objects.some((o) => o.LedgerEntryType === 'SignerList');
  } catch {
    return null;
  }
}

/**
 * it. 29 (§5): ask the nodes IN ORDER and stop at the first real answer. `null`
 * now means every node we know of failed — a much stronger statement than «the
 * balancer hiccupped», and the one the caller is entitled to act on.
 */
async function read(address: string): Promise<boolean | null> {
  for (const rpc of RPC_NODES) {
    const answer = await readFrom(rpc, address);
    if (answer !== null) return answer;
  }
  return null;
}

/**
 * ¿Tiene SignerList? `true` / `false` cuando se pudo leer, `null` cuando no.
 * Comparte UNA lectura en vuelo por dirección y cachea el resultado 60s.
 */
export async function accountHasQuorum(address: string): Promise<boolean | null> {
  if (!address || !address.startsWith('r')) return false;
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.quorum;

  const live = inflight.get(address);
  if (live) return live;

  const started = read(address).then((quorum) => {
    // Una lectura fallida NO se cachea: reintentar en la siguiente firma es
    // mejor que quedarse un minuto entero con un «no lo sé» pegado.
    if (quorum !== null) cache.set(address, { at: Date.now(), quorum });
    if (inflight.get(address) === started) inflight.delete(address);
    return quorum;
  });
  inflight.set(address, started);
  return started;
}

/** Invalida una dirección — tras una ceremonia que acaba de crear la SignerList. */
export function forgetAccountQuorum(address: string): void {
  cache.delete(address);
  inflight.delete(address);
}

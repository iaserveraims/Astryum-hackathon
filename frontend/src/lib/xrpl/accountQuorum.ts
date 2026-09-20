'use client';

/**
 * accountQuorum — ¿esta cuenta XRPL firma sola, o por quórum?
 *
 * La pregunta la contesta la CADENA y nada más. Ni una marca de `localStorage`
 * (no viaja entre navegadores), ni el registro de cuentas gobernadas (una
 * cuenta personal reforzada no está en él), ni si la wallet está «conectada»
 * (una cuenta con la llave maestra deshabilitada NO PUEDE conectarse: no le
 * queda ninguna llave capaz de hacerlo). Cada uno de esos atajos ya falló.
 */

/**
 * UN SOLO NODO ERA UN SOLO PUNTO DE «NO LO SÉ».
 *
 * This asked `xrplcluster.com` and nothing else, so one sick balancer member
 * turned every account in the house into `null` — and `null` is the answer that
 * used to fall through to a single signature with a `Sequence` Xaman fills in.
 * The cure for an unread fact is to READ IT SOMEWHERE ELSE before deciding
 * anything, exactly as the broadcast path already does (`SUBMIT_NODES`).
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
 * Ask the nodes IN ORDER and stop at the first real answer. `null`
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

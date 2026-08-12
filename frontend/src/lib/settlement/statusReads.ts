/**
 * statusReads — las lecturas de settlement que pegan al BACKEND (no a la cadena
 * pública). Framework-free a propósito, como tracker.ts / settlement.ts: la
 * mitad testeable en node, sin React ni wagmi.
 *
 * CRÍTICO (bug 2026-07-29): `mint-status` y `council-order/status` viven tras
 * `requireSiweAuth`. Sin la cabecera Bearer devuelven 401, el tracker lee
 * `null` para siempre y el toast NUNCA marca "settled" aunque la orden SÍ se
 * ejecutó on-chain (observado: dispatches con isTransactionIdUsed=true y el
 * toast colgado en "Still settling on Flare…"). Estas lecturas son READ-ONLY
 * (Astryum solo vigila; invariante #1 intacto) — la cabecera solo prueba quién
 * pregunta, no mueve nada.
 */
import { getApiBase } from '../env';

/** Bearer del token guardado (o {} en SSR / sin sesión). */
export function settlementAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** GET /flare-demo/mint-status — executed flag, o null cuando la lectura falló. */
export async function fetchMintExecuted(xrplHash: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${getApiBase()}/flare-demo/mint-status/${xrplHash}`, {
      headers: settlementAuthHeader(),
      credentials: 'include',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { executed?: boolean };
    return typeof body.executed === 'boolean' ? body.executed : null;
  } catch {
    return null; // red caída ≠ pendiente — retry without changing state
  }
}

/** GET /xrpl-defi/council-order/status — executed flag, o null cuando falló. */
export async function fetchCouncilOrderExecuted(xrplHash: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${getApiBase()}/xrpl-defi/council-order/status?txId=${xrplHash}`, {
      headers: settlementAuthHeader(),
      credentials: 'include',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { executed?: boolean };
    return typeof body.executed === 'boolean' ? body.executed : null;
  } catch {
    return null;
  }
}

'use client';

/**
 * paFold — the visual fold of self-managed accounts.
 *
 * ONE mapping, shared by every surface: for each XRPL wallet in the list,
 * resolve its Flare Smart Account (paOwnership, session-cached). A PA whose
 * owner is present in the same list is ABSORBED: the aggregated store folds
 * its value/positions into the owner's row (portfolioMerge), the lists hide
 * its card, and the owner wears a small Flare badge instead. VISUAL ONLY —
 * the PA keeps existing everywhere it matters (rails, prepares, unmint; the
 * unmint door moves onto the owner's row).
 */

import { useEffect, useState } from 'react';
import { resolvePersonalAccountOf } from './paOwnership';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export function foldKey(address: string): string {
  return address.startsWith('0x') ? address.toLowerCase() : address;
}

/** Smart-Account registry rows, by walletType — the two values its writers
 *  use (see walletIdentity.curatedTypeLabel, same closed set). */
export function isSmartAccountType(walletType?: string): boolean {
  const wt = (walletType ?? '').trim().toLowerCase();
  return wt === 'smart-account' || wt === 'flare smart account';
}

/**
 * An orphan
 * holding NOTHING is registry plumbing, not capital, so personal list
 * surfaces hide it. The "never hide value" rule stands: an orphan PA with
 * real value stays visible, always. Threshold mirrors the dust floor the
 * aggregate uses elsewhere (one cent).
 */
export function isHiddenEmptyOrphanPa(
  walletType: string | undefined,
  valueUSD: number | null | undefined,
): boolean {
  return isSmartAccountType(walletType) && (valueUSD ?? 0) < 0.01;
}

export interface PaFoldMap {
  /** key(PA address) → owner XRPL address (as given). */
  ownerByPa: Map<string, string>;
  /** key(owner XRPL address) → PA address. */
  paByOwner: Map<string, string>;
}

export const EMPTY_FOLD: PaFoldMap = { ownerByPa: new Map(), paByOwner: new Map() };

// El grifo: como mucho CUATRO resoluciones dueña→PA en vuelo.
// Con una docena de wallets, la ráfaga competía con las lecturas de autoridad
// y el portfolio por el mismo backend — y las que caían dejaban FSAs sueltas.
const FOLD_MAX_CONCURRENT = 4;
let foldSlots = 0;
const foldWaiters: Array<() => void> = [];
async function withFoldSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (foldSlots >= FOLD_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => foldWaiters.push(resolve));
  }
  foldSlots += 1;
  try {
    return await fn();
  } finally {
    foldSlots -= 1;
    foldWaiters.shift()?.();
  }
}

/** Resolve the owner↔PA pairs for a wallet list. Best-effort per owner: a
 *  failed read folds nothing for that wallet (the PA stays visible — honest). */
export async function resolvePaFold(addresses: string[]): Promise<PaFoldMap> {
  const owners = [...new Set(addresses.filter((a) => XRPL_RE.test(a)))];
  const ownerByPa = new Map<string, string>();
  const paByOwner = new Map<string, string>();
  await Promise.all(
    owners.map(async (owner) => {
      try {
        const pa = await withFoldSlot(() => resolvePersonalAccountOf(owner));
        if (pa) {
          ownerByPa.set(foldKey(pa), owner);
          paByOwner.set(foldKey(owner), pa);
        }
      } catch {
        /* sin lectura, sin plegado */
      }
    }),
  );
  return { ownerByPa, paByOwner };
}

/** The fold map for a component's wallet list (re-resolves when the SET of
 *  XRPL addresses changes; each resolution is session-cached underneath).
 *  REINTENTO ACOTADO: la resolución corría UNA vez por montaje,
 *  así que un fallo puntual dejaba la FSA suelta como fila toda la visita
 *  («ahora me aparecen como wallets las fsa»). Si el mapa vuelve con menos
 *  parejas que dueñas hay lecturas sin contestar: se agendan hasta dos
 *  pasadas más — los aciertos ya están cacheados, solo repiten los fallos. */
export function usePaFold(addresses: string[]): PaFoldMap {
  const key = [...new Set(addresses.filter((a) => XRPL_RE.test(a)))].sort().join(',');
  const [map, setMap] = useState<PaFoldMap>(EMPTY_FOLD);
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    if (!key) {
      setMap(EMPTY_FOLD);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const owners = key.split(',');
    void resolvePaFold(owners).then((m) => {
      if (cancelled) return;
      setMap(m);
      // Menos parejas que dueñas ≠ prueba de fallo (una dueña puede no tener
      // PA, y ese null sí se cachea) — pero repetir es barato: lo cacheado
      // contesta al instante y solo lo NO contestado vuelve a la red.
      if (retryNonce < 2 && m.paByOwner.size < owners.length) {
        retryTimer = setTimeout(() => setRetryNonce((n) => n + 1), 12_000);
      }
    });
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [key, retryNonce]);
  return map;
}

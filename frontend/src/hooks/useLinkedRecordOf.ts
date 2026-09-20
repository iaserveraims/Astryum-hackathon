'use client';

/**
 * useLinkedRecordOf — EL NOMBRE DEL DUEÑO EN TODO SELECTOR (fundador
 * 2026-09-13: «en todos los sitios que haya que escoger wallet debe aparecer
 * el nickname y la dirección — y no aparece»).
 *
 * Las wallets de SESIÓN (walletStore) llevan la etiqueta autogenerada del
 * conector («Xaman 1 (rwc9…)»), no el apodo que el usuario puso en Wallets —
 * así que todo picker montado sobre la sesión pintaba clones «Xaman 1». Este
 * hook resuelve la fila ENLAZADA por dirección para que cada selector pinte
 * la identidad canónica: walletDisplayName (su apodo manda) + su color/glifo.
 * Sin fila enlazada devuelve undefined y el picker cae a lo que tenía.
 */

import { useCallback, useMemo } from 'react';
import { useMyWallets } from './useMyWallets';
import type { WalletRecord } from '@/lib/portfolioMerge';

export function useLinkedRecordOf(): (address: string) => WalletRecord | undefined {
  const { wallets } = useMyWallets();
  const byAddr = useMemo(() => {
    const m = new Map<string, WalletRecord>();
    for (const w of wallets) m.set(w.address, w);
    return m;
  }, [wallets]);
  return useCallback((address: string) => byAddr.get(address), [byAddr]);
}

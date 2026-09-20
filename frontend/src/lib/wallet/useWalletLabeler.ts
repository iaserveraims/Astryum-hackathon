'use client';

/**
 * useWalletLabeler — EL nombre de cualquier cuenta, con su dueña incluida.
 *
 * Una Smart Account no tiene
 * identidad propia: es el lado Flare de una Xaman, así que su nombre es el de
 * su dueña («Smart Account · <apodo>»).
 */
import { useCallback, useMemo } from 'react';
import { usePaFold, foldKey, isSmartAccountType } from './paFold';
import { smartAccountDisplayName, walletDisplayName, walletDisplayNameMap } from '../walletIdentity';

const XRPL_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

export interface LabelableWallet {
  address: string;
  nickname?: string | null;
  label?: string | null;
  walletType?: string;
  ecosystem?: string;
}

export function useWalletLabeler(
  wallets: LabelableWallet[],
  t: (s: string) => string = (s) => s,
): {
  /** Nombre de una fila de wallet — con dueña si es una Smart Account. */
  labelOf: (w: LabelableWallet) => string;
  /** Nombre por dirección — cubre también PAs fuera de la lista. */
  nameOf: (address: string) => string;
} {
  const xrpls = useMemo(
    () => wallets.map((w) => w.address).filter((a) => XRPL_RE.test(a)),
    [wallets],
  );
  const fold = usePaFold(xrpls);

  const ownerOf = useCallback(
    (paAddress: string): LabelableWallet | null => {
      const ownerAddr = fold.ownerByPa.get(foldKey(paAddress));
      if (!ownerAddr) return null;
      return wallets.find((w) => w.address === ownerAddr) ?? { address: ownerAddr };
    },
    [fold.ownerByPa, wallets],
  );

  // Numbered names for the WHOLE list («MetaMask», «MetaMask 2» — founder):
  // computed once per list so every consumer of this hook agrees
  // on which one is the 2.
  const nameMap = useMemo(() => walletDisplayNameMap(wallets, t), [wallets, t]);

  const labelOf = useCallback(
    (w: LabelableWallet): string => {
      if (isSmartAccountType(w.walletType)) {
        const owner = ownerOf(w.address);
        // The owner's NUMBERED name, so «Smart Account · MetaMask 2» points
        // at the right one when two share a brand.
        const ownerName = owner ? nameMap.get(foldKey(owner.address)) : undefined;
        if (owner && ownerName) return `${t('Smart Account')} · ${ownerName}`;
        return smartAccountDisplayName(w, owner, t);
      }
      return nameMap.get(foldKey(w.address)) ?? walletDisplayName(w, t);
    },
    [ownerOf, nameMap, t],
  );

  const nameOf = useCallback(
    (address: string): string => {
      const key = address.startsWith('0x') ? address.toLowerCase() : address;
      const row = wallets.find(
        (w) => (w.address.startsWith('0x') ? w.address.toLowerCase() : w.address) === key,
      );
      if (row) return labelOf(row);
      // Una dirección suelta que el fold reconoce como PA se nombra por su
      // dueña aunque no tenga fila propia.
      const owner = ownerOf(address);
      if (owner) return smartAccountDisplayName({ address }, owner, t);
      return `${address.slice(0, 6)}…${address.slice(-4)}`;
    },
    [wallets, labelOf, ownerOf, t],
  );

  return { labelOf, nameOf };
}

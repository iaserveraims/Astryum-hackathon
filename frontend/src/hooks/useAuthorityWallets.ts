'use client';

/**
 * The authority-scoped wallet list — what every monetary surface reads once
 * the switcher exists. Same contract as useMyWallets (it wraps it), narrowed
 * to the ACTIVE AUTHORITY:
 */

import { useEffect, useMemo, useState } from 'react';
import { useMyWallets } from './useMyWallets';
import { useAuthorities } from './useAuthorities';
import { useSmartAccountsOf } from './useSmartAccountsOf';
import { addressKey, type Authority } from '@/lib/authority';
import { reinforcedPersonalKeys } from '@/lib/authority/personalQuorum';
import { resolvePersonalAccountOf } from '@/lib/wallet/paOwnership';
import type { WalletRecord } from '@/lib/portfolioMerge';
import { COUNCIL_WALLET_TYPE } from '@/lib/walletIdentity';
import { getLegacyNickname } from '@/components/legacy/legacyLocal';

/** The governed account's Flare Smart Account (PA), null when none/unknown.
 *  Session cache + fetch live in lib/wallet/paOwnership (shared with the PA
 *  action modals so both sides agree on who controls which Smart Account). */
function usePersonalAccount(xrplAddress: string | null): string | null {
  const [pa, setPa] = useState<string | null>(null);
  useEffect(() => {
    if (!xrplAddress) {
      setPa(null);
      return;
    }
    let alive = true;
    resolvePersonalAccountOf(xrplAddress).then((resolved) => {
      if (alive) setPa(resolved);
    });
    return () => {
      alive = false;
    };
  }, [xrplAddress]);
  return xrplAddress ? pa : null;
}

export function useAuthorityWallets(): {
  wallets: WalletRecord[];
  loading: boolean;
  authority: Authority;
  reload: () => void;
} {
  const { wallets: allWallets, loading: walletsLoading, reload } = useMyWallets();
  const { active, authorities, governedCandidates, loading: authoritiesLoading } = useAuthorities();

  const pa = usePersonalAccount(active.kind === 'governed' ? active.address : null);

  // Qué direcciones tienen consejo confirmado. Ya NO sirve para excluirlas
  // (un Legacy es una wallet más) — sirve para dos cosas: añadir
  // como fila las que viven sólo en el registro de cuentas gobernadas, y
  // resolver su Smart Account, que es su segunda pata en Flare.
  const reinforcedKeys = useMemo(() => reinforcedPersonalKeys(authorities), [authorities]);
  const confirmedCouncils = useMemo(
    () =>
      governedCandidates
        .filter((g) => g.hasCouncil === true && !reinforcedKeys.has(addressKey(g.address)))
        .map((g) => g.address),
    [governedCandidates, reinforcedKeys],
  );
  const { byXrpl: councilPas } = useSmartAccountsOf(confirmedCouncils);

  // ── LA SMART ACCOUNT DE UNA WALLET PERSONAL TAMBIÉN ES SU DINERO ──────────
  //
  // Hasta aquí, `useSmartAccountsOf` sólo servía para EXCLUIR: resolvía la PA
  // de cada consejo para sacarla de lo personal. La PA de una wallet PERSONAL
  // no se incluía nunca — entraba en la suma sólo si por casualidad estaba
  // registrada como wallet en `/api/wallets/mine`.
  const personalXrplAddresses = useMemo(() => {
    const councilSet = new Set(confirmedCouncils.map((a) => addressKey(a)));
    return allWallets
      .map((w) => w.address)
      .filter((a) => typeof a === 'string' && a.startsWith('r'))
      .filter((a) => !councilSet.has(addressKey(a)));
  }, [allWallets, confirmedCouncils]);
  const { byXrpl: personalPas } = useSmartAccountsOf(personalXrplAddresses);

  /** Añade las Smart Accounts que falten, sin duplicar las ya registradas.
   *  Mira en los DOS mapas: el de las cuentas personales y el de los consejos
   *  — si sólo mirara uno, la pata de Flare de un Legacy quedaría sin contar. */
  const withSmartAccounts = (rows: WalletRecord[], owners: string[]): WalletRecord[] => {
    const present = new Set(rows.map((w) => addressKey(w.address)));
    const out = [...rows];
    for (const owner of owners) {
      const pa = personalPas[owner] ?? councilPas[owner];
      if (!pa || present.has(addressKey(pa))) continue;
      present.add(addressKey(pa));
      out.push({ address: pa, ecosystem: 'evm', chainId: 14 });
    }
    return out;
  };

  const wallets = useMemo<WalletRecord[]>(() => {
    if (active.kind === 'single') {
      const key = addressKey(active.wallet.address);
      const match = allWallets.filter((w) => addressKey(w.address) === key);
      const rows = match.length > 0 ? match : [active.wallet];
      // Escoger UNA wallet XRPL debe enseñar su capital entero, incluido el que
      // trabaja en Flare por su cuenta — «ni cuando sólo escojo esa wallet».
      const owner = active.wallet.address;
      return typeof owner === 'string' && owner.startsWith('r')
        ? withSmartAccounts(rows, [owner])
        : rows;
    }
    if (active.kind === 'governed') {
      const council: WalletRecord = {
        address: active.address,
        label: active.label,
        ecosystem: active.ecosystem,
        // XRPL pseudo chain id used across the demo rails (portfolioMerge).
        chainId: 1440002,
      };
      // The Legacy's Smart Account produces on Flare — same Legacy, second leg.
      return pa
        ? [council, { address: pa, label: `${active.label ?? 'Legacy'} · Smart Account`, ecosystem: 'flare', chainId: 14 }]
        : [council];
    }
    // Overview: TODA la flota. Los consejos ya no se filtran — y los que no
    // están dados de alta como wallet (viven en el registro de cuentas
    // gobernadas, no en la tabla de wallets) se AÑADEN como fila sintética,
    // porque si no el dinero de un Legacy no estaría en ninguna suma.
    const present = new Set(allWallets.map((w) => addressKey(w.address)));
    // CON SU IDENTIDAD: la fila sintética salía pelada —sin
    // walletType ni label— y en cualquier selector se leía «XRPL wallet»,
    // redonda y gris, mientras la MISMA cuenta en Wallets es una placa índigo
    // con su nombre. Los dos campos que faltaban son los que gobiernan color
    // (walletColor → isCouncilType), cara (WalletFace → Landmark) y nombre
    // (walletDisplayName). Un solo sintetizador, no dos que divergen.
    const labelOfCouncil = (a: string): string | undefined =>
      governedCandidates.find((g) => addressKey(g.address) === addressKey(a))?.label ||
      getLegacyNickname(a) ||
      undefined;
    const withCouncils: WalletRecord[] = [
      ...allWallets,
      ...confirmedCouncils
        .filter((a) => !present.has(addressKey(a)))
        .map((a): WalletRecord => ({
          address: a,
          ecosystem: 'xrpl',
          chainId: 1440002,
          walletType: COUNCIL_WALLET_TYPE,
          label: labelOfCouncil(a),
        })),
    ];
    // …y la Smart Account de CADA cuenta XRPL, personal o consejo: es el lado
    // Flare de esa misma cuenta y su capital cuenta igual.
    return withSmartAccounts(withCouncils, [...personalXrplAddresses, ...confirmedCouncils]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, allWallets, governedCandidates, confirmedCouncils, councilPas, pa, personalPas, personalXrplAddresses]);

  return { wallets, loading: walletsLoading || authoritiesLoading, authority: active, reload };
}

'use client';

/**
 * The authority-scoped wallet list — what every monetary surface reads once
 * the switcher exists. Same contract as useMyWallets (it wraps it), narrowed
 * to the ACTIVE AUTHORITY:
 *
 *   overview → every simple wallet EXCEPT ledger-confirmed councils (founder
 *              2026-07-18: a multisig is not a personal wallet — it lives
 *              inside its Legacy, never in Astryum Personal)
 *   single   → exactly that wallet
 *   governed → the council-governed account itself PLUS its Flare Smart
 *              Account (the PA), resolved via /flare-demo/personal-account —
 *              the Legacy's capital is XRPL rules + Flare production
 *
 * Surfaces that must ALWAYS see everything (the Wallets manager) keep reading
 * useWalletLinking/useMyWallets directly — this hook is the monetary scope.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMyWallets } from './useMyWallets';
import { useAuthorities } from './useAuthorities';
import { useSmartAccountsOf } from './useSmartAccountsOf';
import { addressKey, type Authority } from '@/lib/authority';
import { resolvePersonalAccountOf } from '@/lib/wallet/paOwnership';
import type { WalletRecord } from '@/lib/portfolioMerge';

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
  const { active, governedCandidates, loading: authoritiesLoading } = useAuthorities();

  const pa = usePersonalAccount(active.kind === 'governed' ? active.address : null);

  // A Legacy's Smart Account is NOT a personal wallet either (founder
  // 2026-07-21) — resolve every confirmed council's PA so the overview drops
  // both legs (the council AND its Smart Account), same as the Wallets manager.
  const confirmedCouncils = useMemo(
    () => governedCandidates.filter((g) => g.hasCouncil === true).map((g) => g.address),
    [governedCandidates],
  );
  const { paKeys } = useSmartAccountsOf(confirmedCouncils);

  const wallets = useMemo<WalletRecord[]>(() => {
    if (active.kind === 'single') {
      const key = addressKey(active.wallet.address);
      const match = allWallets.filter((w) => addressKey(w.address) === key);
      return match.length > 0 ? match : [active.wallet];
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
    // Overview (Astryum Personal): a Legacy's wallets are NOT personal — neither
    // the ledger-confirmed council NOR the Smart Account it controls on Flare.
    // Both live inside their Legacy on the governed side.
    const councilKeys = new Set(confirmedCouncils.map((a) => addressKey(a)));
    return allWallets.filter(
      (w) => !councilKeys.has(addressKey(w.address)) && !paKeys.has(addressKey(w.address)),
    );
  }, [active, allWallets, governedCandidates, confirmedCouncils, paKeys, pa]);

  return { wallets, loading: walletsLoading || authoritiesLoading, authority: active, reload };
}

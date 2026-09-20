'use client';

/**
 * useFleetScope — the Summary's capital lens.
 *
 * A fleet SCOPE is a data lens, NOT the product switch: toggling it never
 * navigates, never flips the global productMode/theme, never touches the
 * active authority — the Summary stays put and only the numbers re-scope
 * ("no quiero que togglear las cuentas te saquen del summary").
 */

import { useEffect, useMemo } from 'react';
import { useMyWallets } from './useMyWallets';
import { useAuthorities } from './useAuthorities';
import { useSmartAccountsOf } from './useSmartAccountsOf';
import { addressKey, type GovernedAuthority } from '@/lib/authority';
import { usePortfolioEntries, portfolioKeyOf, type PortfolioEntry } from '@/stores/portfolioStore';
import type { AggregatedPortfolio, WalletRecord } from '@/lib/portfolioMerge';

export type FleetScope = 'all' | 'personal' | 'legacy';

export interface LegacyFleet {
  legacy: GovernedAuthority;
  /** The structure's two legs: council (XRPL) + its Smart Account when known. */
  addresses: string[];
  pa: string | null;
}

export interface ScopedFleet {
  /** Personal rows (registry records — identity for names/colours). */
  personal: WalletRecord[];
  /** One entry per governed structure. */
  legacies: LegacyFleet[];
  /** The address set the chosen scope aggregates over. */
  addresses: string[];
  loading: boolean;
}

export function useScopedFleet(scope: FleetScope): ScopedFleet {
  const { wallets: allWallets, loading: walletsLoading } = useMyWallets();
  const { legacies, loading: authLoading } = useAuthorities();
  const councilAddrs = useMemo(() => legacies.map((g) => g.address), [legacies]);
  const { byXrpl, paKeys } = useSmartAccountsOf(councilAddrs);
  // A personal XRPL wallet's Smart Account is ITS money too (teammate fix
  // a29f35b, mirrored here the same day): the XRPL→PA mapping is
  // deterministic, so the PA counts WITHOUT needing to be registered. The
  // aggregate's paFold then absorbs it into its owner's row — the band shows
  // one wallet, whole.
  const personalXrpl = useMemo(() => {
    const councilSet = new Set(councilAddrs.map((a) => addressKey(a)));
    return allWallets
      .map((w) => w.address)
      .filter((a) => typeof a === 'string' && a.startsWith('r'))
      .filter((a) => !councilSet.has(addressKey(a)));
  }, [allWallets, councilAddrs]);
  const { byXrpl: personalPas } = useSmartAccountsOf(personalXrpl);

  return useMemo(() => {
    const councilKeys = new Set(councilAddrs.map((a) => addressKey(a)));
    // Personal = simple wallets only: a council is not a personal wallet, and
    // neither is the Smart Account it operates (rule, unchanged).
    const personal = allWallets.filter(
      (w) => !councilKeys.has(addressKey(w.address)) && !paKeys.has(addressKey(w.address)),
    );
    const legacyFleets: LegacyFleet[] = legacies.map((g) => {
      const pa = byXrpl[g.address] ?? null;
      return { legacy: g, pa, addresses: pa ? [g.address, pa] : [g.address] };
    });
    const personalAddrs = [
      ...personal.map((w) => w.address),
      // The resolved PAs of personal XRPL wallets — deduped below; the fold
      // will fold each into its owner, so no extra row appears.
      ...personalXrpl.map((a) => personalPas[a]).filter((pa): pa is string => !!pa),
    ];
    const legacyAddrs = legacyFleets.flatMap((f) => f.addresses);
    const addresses =
      scope === 'personal' ? personalAddrs : scope === 'legacy' ? legacyAddrs : [...personalAddrs, ...legacyAddrs];
    // De-dupe defensively (a council that is ALSO connected as a wallet would
    // otherwise be aggregated twice in 'all').
    const seen = new Set<string>();
    const unique = addresses.filter((a) => {
      const k = addressKey(a);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { personal, legacies: legacyFleets, addresses: unique, loading: walletsLoading || authLoading };
  }, [allWallets, legacies, councilAddrs, byXrpl, paKeys, personalXrpl, personalPas, scope, walletsLoading, authLoading]);
}

const EMPTY_ENTRY: PortfolioEntry = { data: null, loading: false, error: null, fetchedAt: 0 };

/**
 * The aggregate for an ARBITRARY wallet set — per-set cache entries beside
 * the authority slot. Sets it has seen paint instantly on return (that is
 * what makes the scope toggle feel in-place instead of a reload).
 */
export function useAggregatedFor(addresses: string[]): {
  data: AggregatedPortfolio | null;
  loading: boolean;
  error: string | null;
} {
  const key = portfolioKeyOf(addresses);
  const entry = usePortfolioEntries((s) => s.entries[key]) ?? EMPTY_ENTRY;
  const loadFor = usePortfolioEntries((s) => s.loadFor);
  // Re-fires when the entry is EMPTIED too (not only on key change): the
  // invalidate handler drops every per-set entry after a position-changing
  // action, and without this dependency a mounted reader kept serving its
  // retained pre-action data until remount (verificador).
  const needsLoad = entry.data == null && !entry.loading && !entry.error;
  useEffect(() => {
    if (addresses.length > 0 && (needsLoad || entry.data == null)) void loadFor(addresses);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, needsLoad]);
  return {
    data: entry.data,
    loading: entry.loading || (addresses.length > 0 && entry.data == null && !entry.error),
    error: entry.error,
  };
}

'use client';

/**
 * The ONE wallet list every dashboard surface reads: SIWE login address folded
 * into GET /api/wallets/mine, deduped. Summary, Portfolio, Capital Map,
 * Positions and Activity all consume this hook so no surface can ever disagree
 * with another about what "your wallets" means.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { hasAuthToken } from '@/lib/authError';
import { dedupeWallets, fetchMyWallets, type WalletRecord } from '@/lib/portfolioMerge';

// Module-scoped cache: the raw /api/wallets/mine list survives client-side
// navigation. Before this, every page mount reset to [] and re-hit the API,
// so each navigation stalled every downstream fetch (portfolio, risk…) until
// the wallet round-trip returned. Cleared on logout via invalidateWalletCache.
let walletListCache: WalletRecord[] | null = null;
export function invalidateWalletCache(): void {
  walletListCache = null;
}

export function useMyWallets(): { wallets: WalletRecord[]; loading: boolean; reload: () => void } {
  const userAddress = useAuthStore((s) => s.user?.address);
  const [list, setList] = useState<WalletRecord[]>(() => walletListCache ?? []);
  // Only "loading" when we have nothing cached to show yet.
  const [loading, setLoading] = useState(() => walletListCache === null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!hasAuthToken()) {
      setLoading(false);
      return;
    }
    let alive = true;
    // Revalidate in the background; show the spinner only on a cold start.
    if (walletListCache === null) setLoading(true);
    fetchMyWallets()
      .then((w) => {
        walletListCache = w;
        if (alive) setList(w);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // userAddress in deps: a different login must refetch, not reuse the cache.
  }, [nonce, userAddress]);

  // Wallets the user toggled out of the dashboard don't count in any monetary
  // surface fed by this hook. They stay visible/manageable in the Wallets tab
  // (which reads useWalletLinking, not this hook).
  const wallets = useMemo(
    () =>
      dedupeWallets(userAddress, list).filter((w) => w.includeInPortfolio !== false),
    [userAddress, list],
  );
  return { wallets, loading, reload: () => setNonce((n) => n + 1) };
}

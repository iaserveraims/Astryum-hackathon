'use client';

/**
 * The ONE wallet list every dashboard surface reads: SIWE login address folded
 * into GET /api/wallets/mine, deduped. Summary, Portfolio, Capital Map,
 * Positions and Activity all consume this hook so no surface can ever disagree
 * with another about what "your wallets" means.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { hasAuthToken } from '@/lib/authError';
import { dedupeWallets, fetchMyWallets, type WalletRecord } from '@/lib/portfolioMerge';

// Module-scoped cache: the raw /api/wallets/mine list survives client-side
// navigation. Before this, every page mount reset to [] and re-hit the API,
// so each navigation stalled every downstream fetch (portfolio, risk…) until
// the wallet round-trip returned. Cleared on logout via invalidateWalletCache.
let walletListCache: WalletRecord[] | null = null;
// In-flight dedupe + freshness window (portfolioStore's `inflight` pattern):
// ~10+ surfaces mount this hook on a dashboard paint and each used to fire its
// own GET /wallets/mine. One request now serves every concurrent instance, and
// a mount within FRESH_MS of the last completed fetch skips the background
// revalidate. Explicit reload() (link/unlink flows) always bypasses both.
const FRESH_MS = 30_000;
let walletFetchedAt = 0;
let walletInflight: Promise<WalletRecord[]> | null = null;

export function invalidateWalletCache(): void {
  walletListCache = null;
  walletFetchedAt = 0;
  walletInflight = null;
}

function fetchMyWalletsDeduped(force: boolean): Promise<WalletRecord[]> {
  if (!force && walletInflight) return walletInflight;
  const run = fetchMyWallets()
    .then((w) => {
      walletListCache = w;
      walletFetchedAt = Date.now();
      return w;
    })
    .finally(() => {
      if (walletInflight === run) walletInflight = null;
    });
  walletInflight = run;
  return run;
}

export function useMyWallets(): { wallets: WalletRecord[]; loading: boolean; reload: () => void } {
  const userAddress = useAuthStore((s) => s.user?.address);
  const [list, setList] = useState<WalletRecord[]>(() => walletListCache ?? []);
  // Only "loading" when we have nothing cached to show yet.
  const [loading, setLoading] = useState(() => walletListCache === null);
  const [nonce, setNonce] = useState(0);
  // reload() must ALWAYS refetch (a just-linked wallet has to appear) — it
  // bypasses the freshness window and the in-flight dedupe.
  const forceRef = useRef(false);
  const lastAddressRef = useRef(userAddress);

  useEffect(() => {
    if (!hasAuthToken()) {
      setLoading(false);
      return;
    }
    // A login change is also a forced refetch — the cache belongs to the
    // previous user (same invariant as the userAddress dep below).
    const force = forceRef.current || lastAddressRef.current !== userAddress;
    forceRef.current = false;
    lastAddressRef.current = userAddress;
    // Fresh enough and nothing in flight → keep the cached paint, skip the
    // background revalidate for this mount.
    if (!force && walletInflight === null && walletListCache !== null && Date.now() - walletFetchedAt < FRESH_MS) {
      setList(walletListCache);
      setLoading(false);
      return;
    }
    let alive = true;
    // Revalidate in the background; show the spinner only on a cold start.
    if (walletListCache === null) setLoading(true);
    fetchMyWalletsDeduped(force)
      .then((w) => {
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
  return {
    wallets,
    loading,
    reload: () => {
      forceRef.current = true;
      setNonce((n) => n + 1);
    },
  };
}

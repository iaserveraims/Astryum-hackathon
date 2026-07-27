'use client';

import { useEffect, useMemo } from 'react';
import { useAuthorityWallets } from './useAuthorityWallets';
import { usePortfolioStore } from '@/stores/portfolioStore';
import type { AggregatedPortfolio } from '@/lib/portfolioMerge';

/**
 * The dashboard's shared read of "the active authority's capital". Every
 * surface calls this instead of fetching on its own: the first caller loads,
 * the store holds the result across navigation, and returning surfaces paint
 * instantly from it. The wallet set follows the AUTHORITY SWITCHER (overview =
 * every simple wallet; single = that wallet; governed = the council account),
 * and the store caches per address-set, so switching back is instant.
 *
 * `data` is null only before the very first load of a wallet set. `loading` is
 * true only when there's nothing to show yet; a background revalidation keeps
 * the previous data on screen and flips `refreshing` instead.
 */
export function useAggregatedPortfolio(): {
  data: AggregatedPortfolio | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => void;
} {
  const { wallets, loading: walletsLoading } = useAuthorityWallets();
  const addressKey = wallets.map((w) => w.address).join(',').toLowerCase();
  const data = usePortfolioStore((s) => s.data);
  const loading = usePortfolioStore((s) => s.loading);
  const refreshing = usePortfolioStore((s) => s.refreshing);
  const error = usePortfolioStore((s) => s.error);
  const load = usePortfolioStore((s) => s.load);
  const clear = usePortfolioStore((s) => s.clear);

  useEffect(() => {
    const addresses = wallets.map((w) => w.address);
    if (addresses.length > 0) {
      void load(addresses);
    } else if (!walletsLoading) {
      // Wallets resolved to none (disconnected) — drop stale portfolio data.
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey, walletsLoading]);

  const reload = useMemo(
    () => () => void load(wallets.map((w) => w.address), { force: true }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addressKey],
  );

  // Still fetching wallets and nothing cached yet reads as loading too.
  const effectiveLoading = loading || (walletsLoading && data == null);
  return { data, loading: effectiveLoading, refreshing, error, reload };
}

/**
 * Invisible background refresh. Mount ONCE in the persistent shell (AppShell)
 * so the whole dashboard shares a single poller: it revalidates the portfolio
 * for the connected wallets every REFRESH_MS and on tab re-focus, updating the
 * shared store (which re-renders whatever surface is on screen). Pages never
 * set up their own interval.
 */
const REFRESH_MS = 90_000;

export function usePortfolioAutoRefresh(): void {
  const { wallets } = useAuthorityWallets();
  const addressKey = wallets.map((w) => w.address).join(',').toLowerCase();
  const load = usePortfolioStore((s) => s.load);

  useEffect(() => {
    const addresses = wallets.map((w) => w.address);
    if (addresses.length === 0) return;

    const tick = () => {
      // Skip work while the tab is hidden — no point scanning chains nobody sees.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void load(addresses);
    };
    const timer = setInterval(tick, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressKey]);
}

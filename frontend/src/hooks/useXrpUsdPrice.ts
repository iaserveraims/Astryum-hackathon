'use client';

/**
 * Live XRP/USD from the app's own FTSO route — the ONE price FXRP amounts are
 * valued with in the withdraw modals (the small "≈ $" lines). Best-effort:
 * null until it resolves and null on failure — the UI simply omits the dollar
 * line rather than inventing a figure (invariant #9: data with a source).
 */

import { useEffect, useState } from 'react';
import { getApiBase } from '@/lib/env';

export function useXrpUsdPrice(): number | null {
  const [price, setPrice] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${getApiBase()}/ftso/price/XRP`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: { priceUSD?: string | number } } | null) => {
        const p = Number(b?.data?.priceUSD);
        if (alive && Number.isFinite(p) && p > 0) setPrice(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return price;
}

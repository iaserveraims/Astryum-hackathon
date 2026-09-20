'use client';

/**
 * /app/home → /app (fusión 2026-08-22): the Summary absorbed the Home — the
 * greeting, the fleet capital, the hidden Wallets surface (?panel=wallets)
 * and the first-run tour live there now. Every old deep-link keeps working:
 * the query string travels along. HomeHub is preserved, unmounted, at
 * components/home/HomeHub.tsx.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomeRedirect() {
  const router = useRouter();
  useEffect(() => {
    const qs = window.location.search.replace(/^\?/, '');
    router.replace(qs ? `/app?${qs}` : '/app');
  }, [router]);
  return null;
}

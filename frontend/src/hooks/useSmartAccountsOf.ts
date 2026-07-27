'use client';

/**
 * useSmartAccountsOf — resolve the Flare Smart Account (Personal Account / PA)
 * of each given XRPL address. The mapping is deterministic
 * (MasterAccountController.getPersonalAccount, read via
 * /flare-demo/personal-account) and session-cached in paOwnership.
 *
 * This is the single source of truth behind one rule (founder 2026-07-21): the
 * wallets a Legacy controls — its council account AND the Smart Account that
 * council operates on Flare — are NOT personal wallets. So:
 *   - Astryum Personal EXCLUDES them (via `paKeys`), same way it already drops
 *     the council multisig itself.
 *   - the governance "Wallets" category LISTS them under their Legacy (via
 *     `byXrpl`, resolving each council → its PA).
 * Read-only throughout: Astryum never signs for either leg (#1).
 */

import { useEffect, useMemo, useState } from 'react';
import { resolvePersonalAccountOf } from '@/lib/wallet/paOwnership';
import { addressKey } from '@/lib/authority';

export function useSmartAccountsOf(xrplAddresses: string[]): {
  /** XRPL address → its resolved Flare Smart Account address. */
  byXrpl: Record<string, string>;
  /** addressKey(PA) of every resolved Smart Account — the exclusion set. */
  paKeys: Set<string>;
} {
  // join: the array identity changes every render in most callers.
  const key = xrplAddresses.filter(Boolean).join(',');
  const [byXrpl, setByXrpl] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    for (const x of xrplAddresses) {
      if (!x) continue;
      void resolvePersonalAccountOf(x).then((pa) => {
        if (alive && pa) {
          setByXrpl((m) => (m[x] === pa ? m : { ...m, [x]: pa }));
        }
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Derive paKeys from the CURRENT inputs only, not from every value ever
  // resolved: byXrpl accumulates within a session (a resolved PA is never
  // pruned), so a council that has left `xrplAddresses` (disconnected, un-
  // observed, or a transient ledger read that dropped its hasCouncil) must not
  // keep its Smart Account excluded from Astryum Personal. Keyed off the same
  // join so both legs of a Legacy are treated consistently.
  const paKeys = useMemo(() => {
    const set = new Set<string>();
    for (const x of key.split(',')) {
      const pa = byXrpl[x];
      if (pa) set.add(addressKey(pa));
    }
    return set;
  }, [key, byXrpl]);

  return { byXrpl, paKeys };
}

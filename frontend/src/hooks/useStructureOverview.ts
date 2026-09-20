'use client';

/**
 * The capital read of ONE structure (E1, plan del mes §4).
 *
 * GovernedAuthority already carries the council's SHAPE (quorum, health,
 * pending signatures) from useAuthorities. This hook adds what the structure
 * cards show about its MONEY, read live per account:
 */

import { useEffect, useState } from 'react';
import {
  xrplLegacy,
  xrplSavings,
  type LegacyVaultState,
  type XrplEscrowRow,
  type XrplSpendable,
} from '@/services/v1Api';

export interface StructureOverviewRead {
  spendable: XrplSpendable | null;
  escrows: XrplEscrowRow[] | null;
  vault: LegacyVaultState | null;
  /** The backend said this Legacy has no cage — a fact, not an error. */
  noCage: boolean;
  /** Both reads failed — the surface says "could not read", never zeros. */
  error: boolean;
}

export interface StructureOverview extends StructureOverviewRead {
  loading: boolean;
  /** ISO of the next FUTURE escrow release, if any. */
  nextReleaseISO: string | null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; read: StructureOverviewRead }>();
const inflight = new Map<string, Promise<StructureOverviewRead>>();

export function invalidateStructureOverviewCache(): void {
  cache.clear();
  inflight.clear();
}

/** Next future release among the escrows (LegacySummaryPanel's rule). */
export function nextReleaseISO(escrows: XrplEscrowRow[] | null): string | null {
  if (!escrows) return null;
  const now = Date.now();
  const future = escrows
    .map((e) => e.finishAfterISO)
    .filter((iso): iso is string => !!iso && new Date(iso).getTime() > now)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return future[0] ?? null;
}

async function readOverview(address: string): Promise<StructureOverviewRead> {
  const [esc, vault] = await Promise.allSettled([
    xrplSavings.escrows(address),
    xrplLegacy.vaultState(address),
  ]);
  let vaultState: LegacyVaultState | null = null;
  let noCage = false;
  if (vault.status === 'fulfilled') {
    vaultState = vault.value;
  } else {
    const body = (vault.reason as { body?: { error?: string } })?.body;
    if (body?.error === 'NO_CAGE_FOR_LEGACY') noCage = true;
  }
  return {
    spendable: esc.status === 'fulfilled' ? esc.value.account : null,
    escrows: esc.status === 'fulfilled' ? esc.value.escrows : null,
    vault: vaultState,
    noCage,
    error: esc.status === 'rejected' && vault.status === 'rejected' && !noCage,
  };
}

const EMPTY: StructureOverviewRead = {
  spendable: null,
  escrows: null,
  vault: null,
  noCage: false,
  error: false,
};

export function useStructureOverview(address: string | null): StructureOverview {
  const [read, setRead] = useState<StructureOverviewRead | null>(() =>
    address ? (cache.get(address)?.read ?? null) : null,
  );

  useEffect(() => {
    if (!address) {
      setRead(null);
      return;
    }
    const cached = cache.get(address);
    if (cached && Date.now() - cached.at < TTL_MS) {
      setRead(cached.read);
      return;
    }
    let alive = true;
    // Share ONE in-flight read per address across every mounted card
    // (readOverview never rejects — failures come back as flags).
    let pending = inflight.get(address);
    if (!pending) {
      const started = readOverview(address).then((r) => {
        cache.set(address, { at: Date.now(), read: r });
        if (inflight.get(address) === started) inflight.delete(address);
        return r;
      });
      inflight.set(address, started);
      pending = started;
    }
    void pending.then((r) => {
      if (alive) setRead(r);
    });
    return () => {
      alive = false;
    };
  }, [address]);

  const r = read ?? EMPTY;
  return {
    ...r,
    loading: read === null && !!address,
    nextReleaseISO: nextReleaseISO(r.escrows),
  };
}

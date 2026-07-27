'use client';

/**
 * paOwnership — maps a Flare Personal Account (Smart Account) back to the
 * linked XRPL account that CONTROLS it.
 *
 * Why this exists (incidente 2026-07-19): the PA action modals used to send
 * the CONNECTED Xaman address to the prepare endpoints. When the user had a
 * different XRPL account active than the one owning the Smart Account, the
 * backend derived the WRONG PA (empty) and every amount died in
 * INSUFFICIENT_SHARES with zero explanation. The 0xFE order must be signed
 * and paid by the XRPL account that controls the PA anyway (the executor
 * rejects any other sender), so the request must always pin THAT account —
 * Xaman enforces the pinned `Account` at signing time.
 *
 * Resolution is deterministic (MasterAccountController.getPersonalAccount),
 * read via the backend's /flare-demo/personal-account and cached per session.
 */

import { useEffect, useMemo, useState } from 'react';
import { getApiBase } from '../env';

const API_BASE = getApiBase();

// xrpl address → PA address (as returned) | null = resolved to "no PA".
// Absent = not asked yet. Errors are NOT cached so a flaky call retries.
const paCache = new Map<string, string | null>();

const XRPL_CLASSIC_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** The Smart Account of one XRPL address (session-cached; null = none/unknown). */
export async function resolvePersonalAccountOf(xrplAddress: string): Promise<string | null> {
  if (paCache.has(xrplAddress)) return paCache.get(xrplAddress) ?? null;
  try {
    const res = await fetch(
      `${API_BASE}/flare-demo/personal-account?xrpl=${encodeURIComponent(xrplAddress)}`,
      { headers: authHeaders(), credentials: 'include' },
    );
    if (!res.ok) return null; // not cached — retried on next call
    const body = (await res.json().catch(() => null)) as { personalAccount?: string } | null;
    const resolved = body?.personalAccount ?? null;
    paCache.set(xrplAddress, resolved);
    return resolved;
  } catch {
    return null; // not cached — retried on next call
  }
}

export interface OwningXrpl {
  /** The linked XRPL account whose Smart Account is `ownerEvm`; null while
   *  resolving or when no linked XRPL account controls it. */
  owningXrpl: string | null;
  /** true while candidate PAs are still being resolved. */
  resolving: boolean;
}

/**
 * Find which of the user's XRPL addresses controls the Smart Account
 * `ownerEvm`. Pass `null` as ownerEvm to skip (e.g. EVM-held positions).
 */
export function useOwningXrpl(ownerEvm: string | null, candidateXrpls: string[]): OwningXrpl {
  const candidates = useMemo(
    () => [...new Set(candidateXrpls.filter((a) => XRPL_CLASSIC_RE.test(a)))],
    // join: the array identity changes every render in most callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidateXrpls.join('|')],
  );
  const [state, setState] = useState<OwningXrpl>({ owningXrpl: null, resolving: !!ownerEvm });

  useEffect(() => {
    if (!ownerEvm || candidates.length === 0) {
      setState({ owningXrpl: null, resolving: false });
      return;
    }
    const target = ownerEvm.toLowerCase();
    let alive = true;
    setState((s) => (s.resolving ? s : { ...s, resolving: true }));
    Promise.all(
      candidates.map(async (xrpl) => ({ xrpl, pa: await resolvePersonalAccountOf(xrpl) })),
    )
      .then((pairs) => {
        if (!alive) return;
        const hit = pairs.find((p) => p.pa?.toLowerCase() === target);
        setState({ owningXrpl: hit?.xrpl ?? null, resolving: false });
      })
      .catch(() => {
        if (alive) setState({ owningXrpl: null, resolving: false });
      });
    return () => {
      alive = false;
    };
  }, [ownerEvm, candidates]);

  return state;
}

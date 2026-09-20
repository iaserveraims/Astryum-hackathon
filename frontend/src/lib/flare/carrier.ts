'use client';

/**
 * carrier — the LIVE minimum carrier of every 0xFE dispatch (founder
 * 2026-08-17: the carrier stops being a user knob). The backend computes it
 * from live protocol fees (minting floor + executor fee + 0.05 margin,
 * floored at 0.35 XRP) so it can never block an operation; the flows send
 * this figure as `amountXrpForMint` and show it read-only.
 *
 * Fallback is the OLD default (1 XRP): if the read fails we'd rather
 * over-carry — the excess mints as FXRP into the user's own account, never
 * lost — than under-carry and have the prepare rejected. Cached 5 minutes,
 * shared across every modal of the page session.
 */

import { useEffect, useState } from 'react';
import { getApiBase } from '@/lib/env';

export const CARRIER_FALLBACK_XRP = 1;

let cached: { value: number; at: number } | null = null;
let inflight: Promise<number> | null = null;
const TTL_MS = 5 * 60_000;

function authHeaders(): Record<string, string> {
  try {
    const token = window.localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function getCarrierXrp(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${getApiBase()}/flare-demo/carrier`, {
        headers: authHeaders(),
        credentials: 'include',
      });
      if (!res.ok) return cached?.value ?? CARRIER_FALLBACK_XRP;
      const body = (await res.json()) as { carrierXrp?: number };
      const v = body.carrierXrp;
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        cached = { value: v, at: Date.now() };
        return v;
      }
      return cached?.value ?? CARRIER_FALLBACK_XRP;
    } catch {
      return cached?.value ?? CARRIER_FALLBACK_XRP;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The live carrier for the current modal — fallback until the read lands. */
export function useCarrierXrp(): number {
  const [xrp, setXrp] = useState<number>(cached?.value ?? CARRIER_FALLBACK_XRP);
  useEffect(() => {
    let cancelled = false;
    void getCarrierXrp().then((v) => {
      if (!cancelled) setXrp(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return xrp;
}

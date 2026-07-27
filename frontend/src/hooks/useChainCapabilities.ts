"use client";

import { useEffect, useState } from "react";
import { getApiBase } from "../lib/env";

/**
 * Per-chain capability matrix (audit P2-3), served by
 * GET /api/integrations/chains/capabilities. The UI consumes this instead of a
 * single `enabled` flag so the support frontier is honest.
 */
export interface ChainCapabilityRow {
  name: string;
  enabled: boolean;
  tier: number;
  discovery: boolean;
  balances: boolean;
  positions: boolean;
  prepare: boolean;
  sign: boolean;
  reconcile: boolean;
}

export function useChainCapabilities() {
  const [chains, setChains] = useState<Record<number, ChainCapabilityRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Public metadata endpoint — no auth needed.
        const resp = await fetch(`${getApiBase()}/integrations/chains/capabilities`, {
          headers: { Accept: "application/json" },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled) setChains(data.chains ?? {});
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e : new Error("Failed to load chain capabilities"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { chains, loading, error };
}

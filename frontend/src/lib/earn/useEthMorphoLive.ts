'use client';

/**
 * useEthMorphoLive — live data + runtime gate for the two eth-morpho cards in
 * Earn «Choose a strategy» (BuildSpec B5-UI paso 2).
 */
import { useEffect, useState } from 'react';
import { getApiBase } from '../env';
import { getUserRegion } from '../region';
import { setEthRailLive } from '../portfolioMerge';

const API_BASE = getApiBase();

// Local copy of the Bearer header builder (private in FlareDemoEarn today);
// Builder A's F1 infra will unify these — swap to the shared one when it lands.
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface EthMorphoMarketLive {
  lltvPct: number;
  utilizationPct: number;
  availableLiquidityBase: string;
  decimals: { collateral: number; loan: number };
  borrowAprPct: number | null;
  borrowAprSource: string;
}

export interface EthMorphoVaultLive {
  assetDecimals: number;
  totalAssetsBase: string;
  apyPct: number | null;
  netApyPct: number | null;
  performanceFeePct: number | null;
  apySource: string;
}

export interface EthMorphoLive {
  /** null = still unknown (first load); false = module off OR unreachable (fail-closed). */
  active: boolean | null;
  market: EthMorphoMarketLive | null;
  vault: EthMorphoVaultLive | null;
  asOf: string | null;
}

/**
 * The lend-only card's yield entry, in the exact YieldEntry shape LiveYieldChip
 * paints. Pure — tested. Never invents: no source ⇒ kind 'none' with an honest
 * label.
 */
export function lendYieldEntry(vault: EthMorphoVaultLive | null):
  | { kind: 'apy'; pct: number; source: string; note?: string }
  | { kind: 'none'; pct: null; source: null; label: string } {
  const pct = vault?.netApyPct ?? vault?.apyPct ?? null;
  if (vault == null || pct == null) {
    return { kind: 'none', pct: null, source: null, label: 'live rate on Morpho — source unavailable' };
  }
  const hasSplit =
    vault.netApyPct != null && vault.apyPct != null && vault.netApyPct !== vault.apyPct;
  return {
    kind: 'apy',
    pct,
    source: vault.apySource,
    // Invariant #9 breakdown: net includes incentives — say so next to the figure.
    note: hasSplit ? `base ${vault.apyPct}% — net includes incentives` : undefined,
  };
}

/** The carry card's borrow-cost chip data (the amber "you pay" idiom). Pure. */
export function carryBorrowCost(market: EthMorphoMarketLive | null):
  | { asset: 'RLUSD'; aprPct: number; source: string }
  | null {
  if (market == null || market.borrowAprPct == null) return null;
  return { asset: 'RLUSD', aprPct: market.borrowAprPct, source: market.borrowAprSource };
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useEthMorphoLive(): EthMorphoLive {
  const [state, setState] = useState<EthMorphoLive>({
    active: null, market: null, vault: null, asOf: null,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const status = await fetchJson<{ active?: boolean }>('/eth-morpho/status');
      if (!alive) return;
      // H10 — el mismo interruptor gobierna la VISIBILIDAD de la posición en
      // el portfolio: sin esto, un kill caliente escondía las cards y dejaba
      // el dinero de Ethereum en pantalla. Se publica desde aquí porque este
      // hook ya pregunta por `/status`: cero peticiones nuevas.
      setEthRailLive(status?.active === true);
      if (status?.active !== true) {
        // Off or unreachable — fail-closed, and DROP stale market data so a
        // hot kill-switch never leaves live-looking figures behind.
        setState({ active: false, market: null, vault: null, asOf: null });
        return;
      }
      const region = encodeURIComponent(getUserRegion() ?? '');
      const [market, vault] = await Promise.all([
        fetchJson<EthMorphoMarketLive>(`/eth-morpho/market?region=${region}`),
        fetchJson<EthMorphoVaultLive>(`/eth-morpho/vault?region=${region}`),
      ]);
      if (!alive) return;
      setState((prev) => ({
        active: true,
        // Keep last good data through a transient read failure (same honesty
        // as useStrategyYields): stale-but-sourced beats a flicker to nothing.
        market: market ?? prev.market,
        vault: vault ?? prev.vault,
        asOf: new Date().toISOString(),
      }));
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return state;
}

'use client';

/**
 * useVenueYields — el TIPO ACTUAL de cada destino de una bóveda gestionada,
 * como dato del protocolo con su fuente y su hora (invariante #9), leído del
 * mismo `/flare-demo/yields` que alimenta las cartas de Earn. Una bóveda
 * gestionada NO tiene un APY propio: lo que gana es la mezcla de lo que el
 * gestor coloca en cada destino y cuándo. Lo honesto es enseñar, destino a
 * destino, lo que ese protocolo publica ahora — y decir que es suyo.
 *
 * Sin lectura → sin número (jamás inventado): la ficha lo dice y enlaza al
 * protocolo. Firelight no publica hoy un tipo que podamos leer: sale como
 * «sin tipo publicado» con su enlace.
 */

import { useEffect, useState } from 'react';
import { getApiBase } from '../env';
import { venueIdentity } from './venueIdentity';

export type VenueYield =
  | { kind: 'apr' | 'apy'; pct: number; source: string; note?: string; baseAprPct?: number; rewardApyPct?: number }
  | { kind: 'none'; pct: null; source: null; label: string };

type YieldMap = Record<string, VenueYield>;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Qué clave del mapa de Earn corresponde a cada destino verificado. */
export function venueYieldKey(address: string): string | null {
  const id = venueIdentity(address);
  if (!id.known) return null;
  if (id.name === 'Kinetic') return 'e3';
  if (id.name === 'Firelight') return 'v-firelight';
  return null;
}

let cache: { yields: YieldMap; asOf: string | null; at: number } | null = null;

export function useVenueYields(): { yields: YieldMap | null; asOf: string | null; loading: boolean } {
  const [state, setState] = useState<{ yields: YieldMap | null; asOf: string | null; loading: boolean }>(
    cache ? { yields: cache.yields, asOf: cache.asOf, loading: false } : { yields: null, asOf: null, loading: true },
  );
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Los tipos se mueven despacio: una lectura por minuto basta, compartida
      // entre fichas (caché de módulo).
      if (cache && Date.now() - cache.at < 60_000) return;
      try {
        const res = await fetch(`${getApiBase()}/flare-demo/yields`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { yields?: YieldMap; asOf?: string };
        if (json.yields) cache = { yields: json.yields, asOf: json.asOf ?? null, at: Date.now() };
        if (!cancelled && json.yields) setState({ yields: json.yields, asOf: json.asOf ?? null, loading: false });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      }
    };
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);
  return state;
}

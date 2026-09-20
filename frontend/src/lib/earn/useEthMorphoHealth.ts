'use client';

/**
 * useEthMorphoHealth — el riesgo de Ethereum, para la ÚNICA tira de salud.
 *
 * El hueco que cierra (auditorí, hallazgo B): la tira de
 * `/app/strategies` lee `useAggregatedPortfolio()`, que no tiene adapter para
 * morpho-blue. Con una deuda VIVA en Ethereum el snapshot devolvía
 * `healthFactor == null`, y esa rama pintaba literalmente:
 */
import { useEffect, useState } from 'react';
import { getApiBase } from '../env';
import { getUserRegion } from '../region';
import { setEthRailLive } from '../portfolioMerge';
import { scanEthMorpho, worstHealthFactor, healthByWallet } from './ethMorphoPosition';

const API_BASE = getApiBase();

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export interface EthMorphoHealth {
  /** El peor HF de las posiciones CON deuda en Ethereum. null = no hay deuda leída. */
  healthFactor: number | null;
  /**
   * HF por dirección, solo las que tienen deuda VIVA en Ethereum. Lo necesitan
   * las superficies que pintan una fila POR WALLET (Home): decirle «sana» a la
   * wallet que sostiene el carry porque OTRA está limpia sería la misma mentira
   * en versión granular.
   */
  byWallet: Record<string, number>;
  /** null = el carril no contestó; false = apagado (nada que vigilar aquí). */
  active: boolean | null;
  /** true = alguna dirección no se pudo leer ⇒ prohibido afirmar «sin riesgo». */
  unknown: boolean;
  loading: boolean;
}

export function useEthMorphoHealth(addrs: string[]): EthMorphoHealth {
  const [state, setState] = useState<EthMorphoHealth>({
    healthFactor: null, byWallet: {}, active: null, unknown: false, loading: true,
  });
  // Las direcciones llegan como array nuevo en cada render; la clave estable
  // evita un bucle de fetch (y de reads a Ethereum) por cada repintado.
  const key = addrs.map((a) => a.toLowerCase()).sort().join(',');

  useEffect(() => {
    let alive = true;
    const list = key ? key.split(',') : [];
    if (list.length === 0) {
      setState({ healthFactor: null, byWallet: {}, active: null, unknown: false, loading: false });
      return;
    }
    const load = async () => {
      const scan = await scanEthMorpho(list, {
        apiBase: API_BASE,
        headers: authHeaders,
        region: getUserRegion() ?? null,
        onRailStatus: setEthRailLive,
      });
      if (!alive) return;
      setState({
        healthFactor: worstHealthFactor(scan.reads),
        byWallet: healthByWallet(scan.reads),
        active: scan.active,
        // Un carril que no contesta es tan «no lo sé» como una dirección que
        // falla: en ambos casos podría haber deuda que no estamos viendo.
        unknown: scan.unreadable.length > 0 || scan.active === null,
        loading: false,
      });
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    if (typeof window !== 'undefined') window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onFocus);
    };
  }, [key]);

  return state;
}

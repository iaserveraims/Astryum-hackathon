'use client';

/**
 * useFxrpBalances — dónde tiene el FXRP la wallet elegida, y cuánto.
 *
 * Cierra el hueco que dejaba escribir la cantidad a ciegas: la entrada ocurre en
 * Ethereum y el endpoint de saldo nativo solo sabe leer Flare, así que la línea
 * de disponible y el botón MAX se ocultaban a propósito (una cifra de Flare bajo
 * una etiqueta de Ethereum sería mentira). El carril lee ahora sus dos cadenas.
 */
import { useEffect, useState } from 'react';
import { getApiBase } from '../env';
import { getUserRegion } from '../region';

const API_BASE = getApiBase();

export interface FxrpBalancesLive {
  /** Base units o null = ilegible. Nunca 0 por defecto. */
  fxrpEthereumBase: string | null;
  fxrpFlareBase: string | null;
  rlusdEthereumBase: string | null;
  fxrpDecimals: number | null;
  rlusdDecimals: number | null;
  loading: boolean;
  /** true = alguna lectura falló ⇒ prohibido afirmar «no tienes». */
  unreadable: boolean;
}

const EMPTY: FxrpBalancesLive = {
  fxrpEthereumBase: null, fxrpFlareBase: null, rlusdEthereumBase: null,
  fxrpDecimals: null, rlusdDecimals: null, loading: false, unreadable: false,
};

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('auth_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/** Lee los saldos del carril para `wallet`. Pasar null desactiva la lectura. */
export function useFxrpBalances(wallet: string | null | undefined): FxrpBalancesLive {
  const [state, setState] = useState<FxrpBalancesLive>(EMPTY);
  const key = wallet && /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : '';

  useEffect(() => {
    if (!key) {
      setState(EMPTY);
      return;
    }
    let alive = true;
    setState({ ...EMPTY, loading: true });
    const region = getUserRegion();
    const url = `${API_BASE}/eth-morpho/balances?wallet=${encodeURIComponent(key)}${
      region ? `&region=${encodeURIComponent(region)}` : ''
    }`;
    fetch(url, { headers: authHeaders(), credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: {
        fxrp?: { ethereumBase?: string | null; flareBase?: string | null; decimals?: number | null };
        rlusd?: { ethereumBase?: string | null; decimals?: number | null };
      } | null) => {
        if (!alive) return;
        if (!body) {
          // El carril no contestó: es «no lo sé», no «no tienes».
          setState({ ...EMPTY, unreadable: true });
          return;
        }
        const fxrpEthereumBase = body.fxrp?.ethereumBase ?? null;
        const fxrpFlareBase = body.fxrp?.flareBase ?? null;
        setState({
          fxrpEthereumBase,
          fxrpFlareBase,
          rlusdEthereumBase: body.rlusd?.ethereumBase ?? null,
          fxrpDecimals: body.fxrp?.decimals ?? null,
          rlusdDecimals: body.rlusd?.decimals ?? null,
          loading: false,
          unreadable: fxrpEthereumBase == null || fxrpFlareBase == null,
        });
      })
      .catch(() => {
        if (alive) setState({ ...EMPTY, unreadable: true });
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return state;
}

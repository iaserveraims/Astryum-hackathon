'use client';

/**
 * ExchangeStaleLockScope — UN SOLO CANDADO POR PANTALLA (R5).
 *
 * EL FALLO. `useStaleOrderLock` guarda el candado en estado de React y lo
 * escribe en `sessionStorage`, pero solo lo LEE al montar. Dos consolas de la
 * misma pantalla que llamaran al hook cada una por su cuenta acaban con dos
 * copias del mismo candado: «I checked» libera la del componente donde se
 * pulsó (y borra el almacén), y la otra se queda cerrada hasta que se
 * desmonta y vuelve a montar. La persona lee «comprobado» en un sitio y
 * «pausado» en el de al lado, sobre el MISMO pago.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useStaleOrderLock } from '../xrpl/XamanSingleSign';

export type ExchangeStaleLock = ReturnType<typeof useStaleOrderLock>;

const StaleLockContext = createContext<ExchangeStaleLock | null>(null);

/** Mounts the ONE lock of this screen and hands it to every console below. */
export function ExchangeStaleLockScope({ children }: { children: ReactNode }) {
  const lock = useStaleOrderLock();
  return <StaleLockContext.Provider value={lock}>{children}</StaleLockContext.Provider>;
}

/** The screen's shared lock — or an own one when this console is mounted alone. */
export function useExchangeStaleLock(): ExchangeStaleLock {
  const shared = useContext(StaleLockContext);
  const own = useStaleOrderLock();
  return shared ?? own;
}

'use client';

/**
 * ExchangeStaleLockScope — UN SOLO CANDADO POR PANTALLA (productizer it. 19, R5).
 *
 * EL FALLO. `useStaleOrderLock` guarda el candado en estado de React y lo
 * escribe en `sessionStorage`, pero solo lo LEE al montar. Dos consolas de la
 * misma pantalla que llamaran al hook cada una por su cuenta acaban con dos
 * copias del mismo candado: «I checked» libera la del componente donde se
 * pulsó (y borra el almacén), y la otra se queda cerrada hasta que se
 * desmonta y vuelve a montar. La persona lee «comprobado» en un sitio y
 * «pausado» en el de al lado, sobre el MISMO pago.
 *
 * EL ARREGLO. La pantalla monta el candado UNA vez y lo reparte. Quien
 * compone pide `useExchangeStaleLock()`: dentro del scope recibe el candado
 * compartido, así que soltarlo libera la pantalla entera de una vez.
 *
 * LO QUE NO CAMBIA. La REGLA sigue siendo la de `staleLockBlocks`: una SALIDA
 * jamás se para, un veredicto que no se pudo comprobar (`unchecked`) no pausa
 * nada, y una confirmación explícita de la persona pasa por encima. Compartir
 * el candado no gatea ni un botón más: hace que los que ya se gateaban se
 * suelten juntos.
 *
 * FUERA DEL SCOPE no se rompe nada: quien no tenga un proveedor encima cae en
 * su propio candado local, exactamente como antes. El hook local se llama
 * siempre (las reglas de los hooks no admiten condicionales) y queda inerte
 * cuando hay uno compartido.
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

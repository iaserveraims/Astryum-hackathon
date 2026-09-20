'use client';

/**
 * ExchangeStationContext — lo que el ESCENARIO (ExchangeStage) le dice a las
 * piezas que ya existían (ExchangeDesk, ClientApp) sin reescribirlas:
 *
 *  · `station`: qué estación se está enseñando. Con valor, el desk pinta SOLO
 *    esa (una a la vez, como las estaciones del Legacy y de la mesa del
 *    gestor); con null, todas — la vía libre del que ya sabe.
 *  · `hints`: si las notas al pie inline de cada estación se ven. Apagadas
 *    por defecto (fundador 2026-09-11: «todo el tema de tutoriales tiene que
 *    quedar escondido detrás de botones»); la explicación vive en el tour y
 *    en el «?» de cada paso.
 *
 * Fuera del escenario (la consola de /app/admin/institutional/exchange monta
 * ExchangeDesk a pelo) el contexto es null y NADA cambia: todas las
 * estaciones, con sus notas, como siempre.
 */

import { createContext, useContext } from 'react';

export interface ExchangeStageState {
  station: string | null;
  hints: boolean;
}

export const ExchangeStationContext = createContext<ExchangeStageState | null>(null);

export function useExchangeStage(): ExchangeStageState | null {
  return useContext(ExchangeStationContext);
}

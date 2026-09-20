'use client';

/**
 * ExchangeStationContext — lo que el ESCENARIO (ExchangeStage) le dice a las
 * piezas que ya existían (ExchangeDesk, ClientApp) sin reescribirlas:
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

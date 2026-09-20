import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Los dos holders de la cartera agregada — el hueco de la autoridad
 * (usePortfolioStore, lo lee el PortfolioSyncBadge) y las entradas por
 * conjunto (usePortfolioEntries, lo lee la cifra del Home vía useFleet) —
 * piden en vista general la MISMA flota a la vez.
 *
 * Fundador 19-sep: «entro en Home, tarda mucho y no carga; voy a Portfolio,
 * vuelvo y aparece todo». Compartían el mapa de vuelos en curso: el segundo
 * en llegar devolvía la promesa del primero SIN escribir su propio estado, y
 * su entrada se quedaba vacía hasta remontar la página. Cada holder tiene que
 * acabar con sus datos, llegue primero o segundo.
 */

const { loadMock } = vi.hoisted(() => ({ loadMock: vi.fn() }));
vi.mock('@/lib/portfolioMerge', () => ({
  EVM_ADDRESS_RE: /^0x[a-fA-F0-9]{40}$/,
  setPortfolioInvalidateHandler: () => {},
  loadAggregatedPortfolio: loadMock,
}));

import { usePortfolioStore, usePortfolioEntries, portfolioKeyOf } from '../portfolioStore';

const FLEET = ['rP49LEexampleCouncilAddr1234567', '0xBD5709ff00000000000000000000000000000001'];
const RESULT = { perWallet: [{ address: FLEET[1] }], merged: null } as never;

/** Un solo vuelo de red para el conjunto, como hace loadAggregatedPortfolio. */
function oneSharedFlight() {
  let resolve!: (v: unknown) => void;
  const flight = new Promise((r) => {
    resolve = r;
  });
  loadMock.mockImplementation(() => flight);
  return () => resolve(RESULT);
}

describe('portfolioStore — dos holders, la misma flota', () => {
  beforeEach(() => {
    loadMock.mockReset();
    usePortfolioStore.getState().clear();
    usePortfolioEntries.setState({ entries: {} });
  });

  it('el badge (hueco de la autoridad) llega primero y la cifra del Home (entrada) igualmente recibe sus datos', async () => {
    const land = oneSharedFlight();
    const a = usePortfolioStore.getState().load(FLEET);
    const b = usePortfolioEntries.getState().loadFor(FLEET);
    land();
    await Promise.all([a, b]);

    const entry = usePortfolioEntries.getState().entries[portfolioKeyOf(FLEET)];
    expect(entry?.data).toBe(RESULT);
    expect(entry?.loading).toBe(false);
    expect(usePortfolioStore.getState().data).toBe(RESULT);
  });

  it('en orden inverso, el hueco de la autoridad tampoco se queda vacío', async () => {
    const land = oneSharedFlight();
    const b = usePortfolioEntries.getState().loadFor(FLEET);
    const a = usePortfolioStore.getState().load(FLEET);
    land();
    await Promise.all([a, b]);

    expect(usePortfolioStore.getState().data).toBe(RESULT);
    expect(usePortfolioStore.getState().loading).toBe(false);
    expect(usePortfolioEntries.getState().entries[portfolioKeyOf(FLEET)]?.data).toBe(RESULT);
  });

  it('mientras la lectura está en vuelo, la entrada se declara cargando (no un vacío mudo)', async () => {
    const land = oneSharedFlight();
    const a = usePortfolioStore.getState().load(FLEET);
    const b = usePortfolioEntries.getState().loadFor(FLEET);

    expect(usePortfolioEntries.getState().entries[portfolioKeyOf(FLEET)]?.loading).toBe(true);
    // Aterrizar: los mapas de vuelos son de módulo y sobreviven al test.
    land();
    await Promise.all([a, b]);
  });

  it('dentro de un mismo holder se sigue deduplicando: dos superficies montando a la vez, un solo vuelo', async () => {
    const land = oneSharedFlight();
    const b1 = usePortfolioEntries.getState().loadFor(FLEET);
    const b2 = usePortfolioEntries.getState().loadFor(FLEET);
    land();
    await Promise.all([b1, b2]);

    expect(loadMock).toHaveBeenCalledTimes(1);
  });
});

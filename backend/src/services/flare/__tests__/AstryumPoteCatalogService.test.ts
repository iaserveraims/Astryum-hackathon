/**
 * El catálogo de potes — y las dos reglas que no negocia.
 *
 * 1. ORDEN NEUTRO. Sin ranking, sin destacados, sin ordenar por rendimiento.
 *    Ordenar es elegir, y elegir por el usuario es lo que separa publicar un
 *    catálogo de recomendar un producto (dictamen 3, Z12).
 *
 * 2. «No pude leer» NUNCA es «no existe». Un pote ilegible aparece marcado, no
 *    escondido. Esconderlo lo borraría del catálogo de su propio dueño sin
 *    decir por qué — exactamente lo que hizo la jaula sin registrar.
 */
import { ethers } from 'ethers';
import {
  listPotes,
  listPoteAddresses,
  readPoteSummary,
  resolveCouncilAddresses,
} from '../AstryumPoteCatalogService';

const FACTORY = '0xc221e9f447e65edae16a4af64d3a7a67e2ee3783';
const POTE_1 = '0xb0b0000000000000000000000000000000000001';
const POTE_2 = '0xb0b0000000000000000000000000000000000002';
const POTE_3 = '0xb0b0000000000000000000000000000000000003';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const COUNCIL_R = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';

/** Un pote que responde a todo, para poder describir el que NO responde. */
function healthyPote(over: Record<string, unknown> = {}) {
  return {
    name: async () => 'Astryum Pote A',
    symbol: async () => 'apA-FXRP',
    asset: async () => ASSET,
    totalAssets: async () => 1_000_000n,
    COOLDOWN: async () => 0n,
    BUFFER_FLOOR_BPS: async () => 1000n,
    maxVenueBps: async () => 10_000n,
    venueCount: async () => 1n,
    venues: async () => ({
      target: '0xaaaa000000000000000000000000000000000001',
      kind: 1n,
      readyAt: 0n,
      retired: false,
    }),
    userGate: async () => ethers.ZeroAddress,
    decimals: async () => 6n,
    ...over,
  };
}

/**
 * Enruta cada `new ethers.Contract(addr, ...)` a su doble. El catálogo habla con
 * la factory, con cada pote y con el ERC-20 del activo, así que el doble tiene
 * que distinguirlos por dirección.
 */
function mockChain(routes: Record<string, unknown>) {
  jest.spyOn(ethers, 'Contract').mockImplementation((addr: string) => {
    const key = String(addr).toLowerCase();
    return (routes[key] ?? healthyPote()) as unknown as ethers.Contract;
  });
}

const provider = {} as ethers.Provider;

afterEach(() => jest.restoreAllMocks());

describe('orden neutro — el catálogo no elige por nadie', () => {
  it('devuelve los potes en ORDEN DE CREACIÓN, no por tamaño', async () => {
    const byIndex = [POTE_1, POTE_2, POTE_3];
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 3n,
        allVaults: async (i: bigint) => byIndex[Number(i)],
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [],
      },
      // El más grande se crea el ÚLTIMO: si algo ordenara por tamaño, saldría
      // primero. Sale último, que es lo que se quiere.
      [POTE_3]: healthyPote({ totalAssets: async () => 999_999_999n }),
    });

    const potes = await listPotes(provider, FACTORY);

    expect(potes.map((p) => p.pote.toLowerCase())).toEqual([POTE_1, POTE_2, POTE_3]);
    expect(BigInt(potes[2].totalAssets!)).toBeGreaterThan(BigInt(potes[0].totalAssets!));
  });

  it('un catálogo vacío es una lista vacía, no un error', async () => {
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 0n,
        allVaults: async () => POTE_1,
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [],
      },
    });

    await expect(listPotes(provider, FACTORY)).resolves.toEqual([]);
  });

  it('una factory que no es dirección devuelve lista vacía sin tocar cadena', async () => {
    const spy = jest.spyOn(ethers, 'Contract');
    await expect(listPotes(provider, 'no-soy-una-direccion')).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('«no pude leer» nunca es «no existe»', () => {
  it('un pote ilegible SIGUE en el catálogo, marcado', async () => {
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 2n,
        allVaults: async (i: bigint) => [POTE_1, POTE_2][Number(i)],
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [],
      },
      [POTE_2]: {
        name: async () => {
          throw new Error('RPC 429');
        },
      },
    });

    const potes = await listPotes(provider, FACTORY);

    // Los DOS están. El que no se pudo leer se dice, no se esconde.
    expect(potes).toHaveLength(2);
    expect(potes[1].unreadable).toBe(true);
    expect(potes[1].pote.toLowerCase()).toBe(POTE_2);
    // Y su estado es null, no cero: cero sería una afirmación falsa.
    expect(potes[1].totalAssets).toBeNull();
    expect(potes[1].name).toBeNull();
  });

  it('un venue ilegible no tumba el pote entero', async () => {
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 1n,
        allVaults: async () => POTE_1,
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [],
      },
      [POTE_1]: healthyPote({
        venueCount: async () => 2n,
        venues: async (i: bigint) => {
          if (Number(i) === 1) throw new Error('venue ilegible');
          return { target: '0xaaaa000000000000000000000000000000000001', kind: 1n, readyAt: 0n, retired: false };
        },
      }),
    });

    const potes = await listPotes(provider, FACTORY);

    expect(potes[0].unreadable).toBe(false);
    expect(potes[0].venues).toHaveLength(1); // el legible sigue ahí
  });

  it('si los eventos no se dejan consultar, los potes siguen — solo sin dueño visible', async () => {
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 1n,
        allVaults: async () => POTE_1,
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => {
          throw new Error('rango de bloques rechazado');
        },
      },
    });

    const potes = await listPotes(provider, FACTORY);

    expect(potes).toHaveLength(1);
    expect(potes[0].councilXrplAddress).toBeNull();
    expect(potes[0].unreadable).toBe(false); // el pote sí se leyó
  });
});

describe('la allowlist va entera y visible — el usuario decide con ella delante', () => {
  it('expone cada venue con su estado, incluidos los que aún no están listos', async () => {
    const future = Math.floor(Date.now() / 1000) + 30 * 86_400;
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 1n,
        allVaults: async () => POTE_1,
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [],
      },
      [POTE_1]: healthyPote({
        venueCount: async () => 2n,
        venues: async (i: bigint) =>
          Number(i) === 0
            ? { target: '0xaaaa000000000000000000000000000000000001', kind: 1n, readyAt: 0n, retired: false }
            : { target: '0xbbbb000000000000000000000000000000000002', kind: 0n, readyAt: BigInt(future), retired: false },
      }),
    });

    const [pote] = await listPotes(provider, FACTORY);

    expect(pote.venues).toHaveLength(2);
    expect(pote.venues[0].readyInSeconds).toBe(0);
    // Un venue propuesto y todavía en cuarentena se VE, con su cuenta atrás:
    // que el gestor haya propuesto algo es información del depositante.
    expect(pote.venues[1].readyInSeconds).toBeGreaterThan(0);
  });
});

describe('la r-address del consejo sale del evento, porque on-chain solo queda su hash', () => {
  it('empareja cada pote con su cuenta XRPL', async () => {
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 1n,
        allVaults: async () => POTE_1,
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [
          { args: { vault: POTE_1, councilAddress: COUNCIL_R } },
        ],
      },
    });

    const map = await resolveCouncilAddresses(provider, FACTORY);
    expect(map.get(POTE_1)).toBe(COUNCIL_R);

    const [pote] = await listPotes(provider, FACTORY);
    expect(pote.councilXrplAddress).toBe(COUNCIL_R);
  });
});

describe('piezas sueltas', () => {
  it('listPoteAddresses recorre el array de la factory', async () => {
    mockChain({
      [FACTORY]: {
        vaultCount: async () => 2n,
        allVaults: async (i: bigint) => [POTE_1, POTE_2][Number(i)],
      },
    });

    const out = await listPoteAddresses(provider, FACTORY);
    expect(out.map((a) => a.toLowerCase())).toEqual([POTE_1, POTE_2]);
  });

  it('readPoteSummary marca la puerta de entrada cuando hay userGate', async () => {
    mockChain({
      [POTE_1]: healthyPote({ userGate: async () => '0x9999000000000000000000000000000000000009' }),
    });

    const s = await readPoteSummary(provider, POTE_1);
    expect(s.gated).toBe(true);
    expect(s.unreadable).toBe(false);
  });

  it('readPoteSummary nunca lanza: devuelve el pote marcado como ilegible', async () => {
    mockChain({
      [POTE_1]: {
        name: async () => {
          throw new Error('boom');
        },
      },
    });

    const s = await readPoteSummary(provider, POTE_1);
    expect(s.unreadable).toBe(true);
    expect(s.pote.toLowerCase()).toBe(POTE_1);
  });
});

describe('un throw SÍNCRONO no puede llevarse el proceso por delante', () => {
  /**
   * El caso real: un pote nacido de una factory anterior que no expone todos los
   * métodos del ABI actual. `c.maxVenueBps` es undefined y la llamada revienta
   * EN EL SITIO, no como promesa — dejando huérfanas las que ya se crearon. Un
   * rechazo sin dueño tumba el proceso en Node moderno, que es como murió el
   * backend con los 429 de Flare.
   */
  it('un pote al que le faltan métodos se marca ilegible, sin rechazos huérfanos', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    mockChain({
      [FACTORY]: {
        vaultCount: async () => 1n,
        allVaults: async () => POTE_1,
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [],
      },
      // Responde a name() con un rechazo Y no tiene el resto de métodos: las dos
      // formas de fallar a la vez, que es exactamente el caso peligroso.
      [POTE_1]: {
        name: async () => {
          throw new Error('RPC 429');
        },
      },
    });

    const potes = await listPotes(provider, FACTORY);
    // Dar una vuelta al bucle de eventos: los rechazos huérfanos se reportan
    // asíncronamente, así que comprobarlo antes no probaría nada.
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', onUnhandled);

    expect(potes).toHaveLength(1);
    expect(potes[0].unreadable).toBe(true);
    expect(unhandled).toEqual([]);
  });
});

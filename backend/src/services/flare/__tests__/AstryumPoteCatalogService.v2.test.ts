/**
 * El catálogo, segunda generación: los potes de las JAULAS entran en la misma
 * lista que los potes sueltos, con las mismas dos reglas (orden de creación;
 * «no pude leer» ≠ «no existe») y tres datos más: generación, jaula y tope por
 * cuenta.
 */
import { ethers } from 'ethers';
import { listCagePotes, listPotes, readPoteSummary, resolveCageCouncils } from '../AstryumPoteCatalogService';

const CAGE_FACTORY = '0xfac0000000000000000000000000000000000002';
const CAGE_1 = '0xca9e000000000000000000000000000000000001';
const CAGE_2 = '0xca9e000000000000000000000000000000000002';
const POTE_A = '0xb0b0000000000000000000000000000000000011';
const POTE_B = '0xb0b0000000000000000000000000000000000012';
const POTE_C = '0xb0b0000000000000000000000000000000000021';
const V1_FACTORY = '0xc221e9f447e65edae16a4af64d3a7a67e2ee3783';
const POTE_V1 = '0xb0b0000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const COUNCIL_1 = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const COUNCIL_2 = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';

function v2Pote(over: Record<string, unknown> = {}) {
  return {
    name: async () => 'Pote de jaula',
    symbol: async () => 'pj-FXRP',
    asset: async () => ASSET,
    totalAssets: async () => 5_000_000n,
    COOLDOWN: async () => 0n,
    BUFFER_FLOOR_BPS: async () => 1000n,
    maxVenueBps: async () => 10_000n,
    venueCount: async () => 0n,
    userGate: async () => ethers.ZeroAddress,
    maxDepositPerUser: async () => 50_000_000n,
    decimals: async () => 6n,
    ...over,
  };
}
/** Un pote v1: NO tiene `maxDepositPerUser` — el método ni existe. */
function v1Pote() {
  const p = v2Pote();
  delete (p as Record<string, unknown>).maxDepositPerUser;
  return p;
}

function mockChain(routes: Record<string, unknown>) {
  jest.spyOn(ethers, 'Contract').mockImplementation((addr: string) => {
    const key = String(addr).toLowerCase();
    return (routes[key] ?? v2Pote()) as unknown as ethers.Contract;
  });
}
const provider = {} as ethers.Provider;
afterEach(() => jest.restoreAllMocks());

const cageFactory = {
  cageCount: async () => 2n,
  allCages: async (i: bigint) => [CAGE_1, CAGE_2][Number(i)],
  filters: { CageCreated: () => ({}) },
  queryFilter: async () => [
    { args: { cage: CAGE_1, councilAddress: COUNCIL_1 } },
    { args: { cage: CAGE_2, councilAddress: COUNCIL_2 } },
  ],
};

describe('listCagePotes — jaula a jaula, pote a pote, en orden de creación', () => {
  it('enumera los potes de cada jaula con su jaula, su consejo y su tope por cuenta', async () => {
    mockChain({
      [CAGE_FACTORY]: cageFactory,
      [CAGE_1]: { poteCount: async () => 2n, potes: async (i: bigint) => [POTE_A, POTE_B][Number(i)] },
      [CAGE_2]: { poteCount: async () => 1n, potes: async () => POTE_C },
    });
    const out = await listCagePotes(provider, CAGE_FACTORY);
    expect(out.map((p) => p.pote.toLowerCase())).toEqual([POTE_A, POTE_B, POTE_C]);
    expect(out.every((p) => p.generation === 'v2')).toBe(true);
    expect(out[0].cage?.toLowerCase()).toBe(CAGE_1);
    expect(out[2].cage?.toLowerCase()).toBe(CAGE_2);
    expect(out[0].councilXrplAddress).toBe(COUNCIL_1);
    expect(out[2].councilXrplAddress).toBe(COUNCIL_2);
    expect(out[0].maxDepositPerUser).toBe('50000000');
    expect(out[0].unreadable).toBe(false);
  });

  it('una jaula cuyos potes no se dejan enumerar se salta; las demás siguen', async () => {
    mockChain({
      [CAGE_FACTORY]: cageFactory,
      [CAGE_1]: { poteCount: async () => { throw new Error('rpc'); } },
      [CAGE_2]: { poteCount: async () => 1n, potes: async () => POTE_C },
    });
    const out = await listCagePotes(provider, CAGE_FACTORY);
    expect(out.map((p) => p.pote.toLowerCase())).toEqual([POTE_C]);
  });

  it('un pote de jaula ilegible SIGUE en el catálogo, marcado y con su jaula', async () => {
    mockChain({
      [CAGE_FACTORY]: cageFactory,
      [CAGE_1]: { poteCount: async () => 1n, potes: async () => POTE_A },
      [CAGE_2]: { poteCount: async () => 0n },
      [POTE_A]: v2Pote({ name: async () => { throw new Error('rpc'); } }),
    });
    const [p] = await listCagePotes(provider, CAGE_FACTORY);
    expect(p.unreadable).toBe(true);
    expect(p.generation).toBe('v2');
    expect(p.cage?.toLowerCase()).toBe(CAGE_1);
    expect(p.councilXrplAddress).toBe(COUNCIL_1);
  });

  it('sin eventos legibles, los potes siguen — solo sin dueño visible', async () => {
    mockChain({
      [CAGE_FACTORY]: { ...cageFactory, queryFilter: async () => { throw new Error('range'); } },
      [CAGE_1]: { poteCount: async () => 1n, potes: async () => POTE_A },
      [CAGE_2]: { poteCount: async () => 0n },
    });
    expect((await resolveCageCouncils(provider, CAGE_FACTORY)).size).toBe(0);
    const [p] = await listCagePotes(provider, CAGE_FACTORY);
    expect(p.councilXrplAddress).toBeNull();
    expect(p.unreadable).toBe(false);
  });

  it('una factory que no es dirección devuelve lista vacía sin tocar cadena', async () => {
    const spy = jest.spyOn(ethers, 'Contract');
    expect(await listCagePotes(provider, 'nope')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('la v1 sigue igual, y se distingue', () => {
  it('un pote v1 sale como generation v1, sin jaula y con maxDepositPerUser null (el método no existe)', async () => {
    mockChain({
      [V1_FACTORY]: {
        vaultCount: async () => 1n,
        allVaults: async () => POTE_V1,
        filters: { StackCreated: () => ({}) },
        queryFilter: async () => [],
      },
      [POTE_V1]: v1Pote(),
    });
    const [p] = await listPotes(provider, V1_FACTORY);
    expect(p.generation).toBe('v1');
    expect(p.cage).toBeNull();
    expect(p.maxDepositPerUser).toBeNull();
    expect(p.unreadable).toBe(false); // que falte el tope no hace ilegible al pote
  });

  it('readPoteSummary lleva el origen tal cual y el tope 0 como «sin tope», no como null', async () => {
    mockChain({ [POTE_A]: v2Pote({ maxDepositPerUser: async () => 0n }) });
    const p = await readPoteSummary(provider, POTE_A, COUNCIL_1, { generation: 'v2', cage: CAGE_1 });
    expect(p.maxDepositPerUser).toBe('0');
    expect(p.cage).toBe(CAGE_1);
  });
});

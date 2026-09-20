/**
 * resolveRunPote — la resolución GENERACIÓN-primero (X4, 9-sep). Lo que aquí se
 * fija: (1) la cage factory v2 se consulta ANTES que la v1 (el hazard
 * multi-registro del 28-ago); (2) una jaula nacida SIN pote aún resuelve v2 con
 * `pote: null` — la ventana E2a→E2b, el caso que regresa en silencio; (3) un
 * factory ilegible NUNCA lanza ni decide la generación: se cae al siguiente y,
 * sin nada legible, se devuelve null («no pude leer» no es «no tienes nada»).
 */
import { ethers as realEthers } from 'ethers';

const CAGE = realEthers.getAddress('0x' + 'ab'.repeat(20));
const BRIDGE = realEthers.getAddress('0x' + 'bc'.repeat(20));
const POTE = realEthers.getAddress('0x' + 'cd'.repeat(20));
const V1_VAULT = realEthers.getAddress('0x' + 'de'.repeat(20));
const V1_BRIDGE = realEthers.getAddress('0x' + 'ef'.repeat(20));
const COUNCIL = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';

// El orden de consulta es parte del contrato: v2 primero, SIEMPRE.
const consulted: string[] = [];

const resolveAstryumCage = jest.fn();
const resolveAstryumPote = jest.fn();
jest.mock('../../flare/AstryumCageCreationService', () => ({
  resolveAstryumCage: (...a: unknown[]) => {
    consulted.push('v2');
    return resolveAstryumCage(...a);
  },
}));
jest.mock('../../flare/AstryumPoteCreationService', () => ({
  resolveAstryumPote: (...a: unknown[]) => {
    consulted.push('v1');
    return resolveAstryumPote(...a);
  },
}));

// Solo se sustituye Contract (las lecturas de la jaula); el resto de ethers es real.
let cageReads: { poteCount: () => Promise<bigint>; potes: (i: number) => Promise<string> };
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: function Contract() {
        return cageReads;
      },
    },
  };
});

import { resolveRunPote } from '../resolveRunPote';

const provider = {} as never;

describe('resolveRunPote (generación primero)', () => {
  beforeEach(() => {
    consulted.length = 0;
    resolveAstryumCage.mockReset();
    resolveAstryumPote.mockReset();
    process.env.ASTRYUM_CAGE_FACTORY_ADDRESS = '0x' + '11'.repeat(20);
    process.env.ASTRYUM_FACTORY_ADDRESS = '0x' + '22'.repeat(20);
    cageReads = { poteCount: async () => 1n, potes: async () => POTE.toLowerCase() };
  });
  afterAll(() => {
    delete process.env.ASTRYUM_CAGE_FACTORY_ADDRESS;
    delete process.env.ASTRYUM_FACTORY_ADDRESS;
  });

  it('jaula con potes → v2 con el ÚLTIMO pote (checksummed), su bridge y su jaula', async () => {
    resolveAstryumCage.mockResolvedValue({ cage: CAGE, bridge: BRIDGE });
    cageReads = { poteCount: async () => 2n, potes: async (i: number) => (i === 1 ? POTE.toLowerCase() : V1_VAULT) };
    const r = await resolveRunPote(provider, COUNCIL);
    expect(r).toEqual({ generation: 'v2', pote: POTE, bridge: BRIDGE, cage: CAGE });
  });

  it('jaula nacida SIN pote (la ventana E2a→E2b) → v2 con pote:null, jamás v1', async () => {
    resolveAstryumCage.mockResolvedValue({ cage: CAGE, bridge: BRIDGE });
    cageReads = { poteCount: async () => 0n, potes: async () => POTE };
    const r = await resolveRunPote(provider, COUNCIL);
    expect(r).toEqual({ generation: 'v2', pote: null, bridge: BRIDGE, cage: CAGE });
    expect(consulted).toEqual(['v2']); // la v1 NI SE MIRA: la jaula ya decidió la generación
  });

  it('sin jaula → cae a v1, y la cage factory se consultó PRIMERO', async () => {
    resolveAstryumCage.mockResolvedValue(null);
    resolveAstryumPote.mockResolvedValue({ vault: V1_VAULT, bridge: V1_BRIDGE });
    const r = await resolveRunPote(provider, COUNCIL);
    expect(r).toEqual({ generation: 'v1', pote: V1_VAULT, bridge: V1_BRIDGE, cage: null });
    expect(consulted).toEqual(['v2', 'v1']);
  });

  it('la cage factory LANZA → no decide la generación: se cae a v1 sin lanzar', async () => {
    resolveAstryumCage.mockRejectedValue(new Error('rpc down'));
    resolveAstryumPote.mockResolvedValue({ vault: V1_VAULT, bridge: V1_BRIDGE });
    const r = await resolveRunPote(provider, COUNCIL);
    expect(r?.generation).toBe('v1');
  });

  it('nada legible en ningún factory → null, jamás throw', async () => {
    resolveAstryumCage.mockRejectedValue(new Error('rpc down'));
    resolveAstryumPote.mockRejectedValue(new Error('rpc down'));
    await expect(resolveRunPote(provider, COUNCIL)).resolves.toBeNull();
  });

  it('v1 con vault en cero → null (un registro vacío no es un pote)', async () => {
    resolveAstryumCage.mockResolvedValue(null);
    resolveAstryumPote.mockResolvedValue({ vault: realEthers.ZeroAddress, bridge: V1_BRIDGE });
    await expect(resolveRunPote(provider, COUNCIL)).resolves.toBeNull();
  });
});

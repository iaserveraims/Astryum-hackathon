/**
 * El estado de un pote gobernado por una JAULA (v2): el director efectivo es el
 * de la jaula, y el estado lo dice (`governance.cage`). Un pote v1 —cuyo
 * consejo es un bridge sin `isMyPote`— sigue exactamente igual que antes.
 */
import { ethers } from 'ethers';
import { readPoteState } from '../AstryumPoteStateService';

const POTE = '0xb0b0000000000000000000000000000000000011';
const CAGE = '0xca9e000000000000000000000000000000000001';
const BRIDGE_V1 = '0xb41d000000000000000000000000000000000001';
const ASSET = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const DESK = '0xd35c000000000000000000000000000000000001';
const REF = '0x' + '11'.repeat(32);

function pote(council: string) {
  return {
    name: async () => 'p',
    symbol: async () => 'p',
    decimals: async () => 9n,
    asset: async () => ASSET,
    totalAssets: async () => 1_000_000n,
    totalSupply: async () => 1_000_000_000n,
    convertToAssets: async () => 1_000_000n,
    COOLDOWN: async () => 0n,
    BUFFER_FLOOR_BPS: async () => 1000n,
    freeBalance: async () => 1_000_000n,
    earmarkedAssets: async () => 0n,
    totalClaimable: async () => 0n,
    maxVenueBps: async () => 10_000n,
    venueCount: async () => 0n,
    redeemTicketCount: async () => 0n,
    council: async () => council,
    constitutionRef: async () => REF,
    director: async () => ethers.ZeroAddress, // el asiento del POTE: vacío
    directorUntil: async () => 0n,
    payeeCount: async () => 0n,
    maxDepositPerUser: async () => 0n,
  };
}
const asset = { symbol: async () => 'FXRP', decimals: async () => 6n };

function mockChain(routes: Record<string, unknown>) {
  jest.spyOn(ethers, 'Contract').mockImplementation((addr: string) => {
    const r = routes[String(addr).toLowerCase()];
    if (!r) throw new Error(`sin doble para ${addr}`);
    return r as unknown as ethers.Contract;
  });
}
afterEach(() => jest.restoreAllMocks());
const provider = {} as ethers.Provider;

describe('readPoteState — el director efectivo', () => {
  it('pote v2: la jaula responde isMyPote y presta su director cedido', async () => {
    mockChain({
      [POTE]: pote(CAGE),
      [ASSET]: asset,
      [CAGE]: {
        isMyPote: async (p: string) => p.toLowerCase() === POTE,
        director: async () => DESK,
        directorUntil: async () => 1_900_000_000n,
      },
    });
    const s = await readPoteState({ rpcUrl: 'x', pote: POTE, provider });
    expect(s.governance.cage?.toLowerCase()).toBe(CAGE);
    expect(s.governance.director.toLowerCase()).toBe(DESK);
    expect(s.governance.directorUntil).toBe(1_900_000_000);
    expect(s.governance.council.toLowerCase()).toBe(CAGE);
  });

  it('pote v1: el consejo es un bridge sin isMyPote → sin jaula, el asiento del pote manda', async () => {
    mockChain({
      [POTE]: pote(BRIDGE_V1),
      [ASSET]: asset,
      [BRIDGE_V1]: { isMyPote: async () => { throw new Error('no such selector'); } },
    });
    const s = await readPoteState({ rpcUrl: 'x', pote: POTE, provider });
    expect(s.governance.cage).toBeNull();
    expect(s.governance.director).toBe(ethers.ZeroAddress);
    expect(s.governance.directorUntil).toBe(0);
  });

  it('una jaula que responde «no es mío» no se toma como jaula de este pote', async () => {
    mockChain({
      [POTE]: pote(CAGE),
      [ASSET]: asset,
      [CAGE]: { isMyPote: async () => false, director: async () => DESK, directorUntil: async () => 1n },
    });
    const s = await readPoteState({ rpcUrl: 'x', pote: POTE, provider });
    expect(s.governance.cage).toBeNull();
    expect(s.governance.director).toBe(ethers.ZeroAddress);
  });
});

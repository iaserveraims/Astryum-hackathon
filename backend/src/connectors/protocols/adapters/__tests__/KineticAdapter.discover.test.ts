/**
 * KineticAdapter.discoverPositions — the scan that feeds the positions board
 * and the withdraw modal's legs (balance + MAX).
 *
 * The bug this pins down (2026-07-14): getAssetsIn only lists ENTERED markets,
 * and a plain supply (E3 lend-only, carry re-supply) deliberately never calls
 * enterMarkets — so the supply existed on-chain but the scan returned nothing,
 * the modal showed no balance and the assets looked unwithdrawable. The fix
 * unions the entered set with every getAllMarkets() market where the wallet
 * holds kToken shares (cheap balanceOf probe).
 */
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({ getHttpProvider: () => ({}) }),
  },
}));

const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const WALLET = '0xeabcd745598916b0131ece397c8d6a332088462c';

// Lend-only wallet: FXRP supplied WITHOUT enterMarkets → getAssetsIn is [].
const CHAIN: Record<string, Record<string, unknown>> = {
  [ISO_COMPTROLLER.toLowerCase()]: {
    getAssetsIn: [] as string[],
    getAllMarkets: [KFXRP_ISO, KUSDT0_ISO],
  },
  [KFXRP_ISO.toLowerCase()]: {
    balanceOf: 9_500_000n, // kToken shares → the probe sees the supply
    balanceOfUnderlying: 9_600_014n,
    borrowBalanceCurrent: 0n,
    underlying: FXRP,
    symbol: 'ikFXRP',
  },
  [KUSDT0_ISO.toLowerCase()]: {
    balanceOf: 0n, // nothing here → the probe must skip it
    balanceOfUnderlying: 0n,
    borrowBalanceCurrent: 0n,
    underlying: '0x0000000000000000000000000000000000000009',
    symbol: 'ikUSDT0',
  },
  [FXRP.toLowerCase()]: {
    symbol: 'FXRP',
    decimals: 6,
  },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = CHAIN[address.toLowerCase()] ?? {};
      for (const fn of Object.keys(state)) {
        const impl = async () => state[fn]; // read late → tests can mutate state
        (impl as unknown as { staticCall: () => Promise<unknown> }).staticCall = impl;
        this[fn] = impl;
      }
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

import { KineticAdapter } from '../KineticAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';

beforeAll(() => {
  delete process.env.KINETIC_COMPTROLLER; // one comptroller keeps the fixture small
  process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
  process.env.KINETIC_KFXRP_ISO = KFXRP_ISO;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  resetAddressCache();
});

afterAll(() => {
  delete process.env.KINETIC_ISO_COMPTROLLER;
  delete process.env.KINETIC_KFXRP_ISO;
  delete process.env.KINETIC_KUSDT0_ISO;
  resetAddressCache();
});

describe('KineticAdapter.discoverPositions — lend-only supplies (no enterMarkets)', () => {
  it('finds a supply the wallet never entered (getAssetsIn empty → balanceOf probe)', async () => {
    const positions = await new KineticAdapter().discoverPositions(WALLET);
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.kind).toBe('SUPPLY');
    expect(p.amount).toBe(9_600_014n);
    const raw = p.raw as { iso: boolean; symbol: string; cToken: string };
    expect(raw.iso).toBe(true);
    expect(raw.symbol).toBe('FXRP'); // the UNDERLYING's symbol — feeds the legs
    expect(raw.cToken).toBe(KFXRP_ISO);
  });

  it('does not duplicate a market that is BOTH entered and probed', async () => {
    CHAIN[ISO_COMPTROLLER.toLowerCase()].getAssetsIn = [KFXRP_ISO];
    const positions = await new KineticAdapter().discoverPositions(WALLET);
    CHAIN[ISO_COMPTROLLER.toLowerCase()].getAssetsIn = [];
    expect(positions).toHaveLength(1);
  });

  it('falls back to the entered set alone when getAllMarkets is unavailable', async () => {
    const saved = CHAIN[ISO_COMPTROLLER.toLowerCase()].getAllMarkets;
    delete CHAIN[ISO_COMPTROLLER.toLowerCase()].getAllMarkets;
    CHAIN[ISO_COMPTROLLER.toLowerCase()].getAssetsIn = [KFXRP_ISO];
    const positions = await new KineticAdapter().discoverPositions(WALLET);
    CHAIN[ISO_COMPTROLLER.toLowerCase()].getAllMarkets = saved;
    CHAIN[ISO_COMPTROLLER.toLowerCase()].getAssetsIn = [];
    expect(positions).toHaveLength(1); // entered market still scanned
  });
});

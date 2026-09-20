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

/** it. 31 — a read that does NOT answer (the public RPC's 429). */
const DOWN = '__rpc_down__';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = CHAIN[address.toLowerCase()] ?? {};
      for (const fn of Object.keys(state)) {
        const impl = async () => {
          // read late → tests can mutate state
          if (state[fn] === DOWN) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
          return state[fn];
        };
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

  it('falls back to the entered set alone when getAllMarkets is unavailable — and SAYS the lend-only side could not be seen', async () => {
    const saved = CHAIN[ISO_COMPTROLLER.toLowerCase()].getAllMarkets;
    delete CHAIN[ISO_COMPTROLLER.toLowerCase()].getAllMarkets;
    CHAIN[ISO_COMPTROLLER.toLowerCase()].getAssetsIn = [KFXRP_ISO];
    try {
      // Ola 0 — the partial read serves the entered market AND names the read
      // it could not make; the all-or-nothing entry turns that into a throw.
      const { positions, unreadable } = await new KineticAdapter().discoverPositionsPartial(WALLET);
      expect(positions).toHaveLength(1); // entered market still scanned
      expect(unreadable).toEqual([
        expect.objectContaining({ what: `getAllMarkets on comptroller ${ISO_COMPTROLLER}`, market: ISO_COMPTROLLER }),
      ]);
      await expect(new KineticAdapter().discoverPositions(WALLET)).rejects.toThrow(/getAllMarkets on comptroller/);
    } finally {
      CHAIN[ISO_COMPTROLLER.toLowerCase()].getAllMarkets = saved;
      CHAIN[ISO_COMPTROLLER.toLowerCase()].getAssetsIn = [];
    }
  });
});

/**
 * it. 31 — THE BOARD READ THE DEBT SOFT. `borrowBalanceCurrent.staticCall(…)
 * .catch(() => 0n)` showed a wallet with live USDT0 debt as debt-free whenever
 * the node 429'd — and the guided unwind read that zero as «nothing to repay».
 * Money reads (shares probe, supply, debt) now RISE, typed and naming the
 * market; the engine drops the adapter from THIS sweep and names it to the
 * person. Metadata reads (symbol, underlying) keep their soft fallbacks.
 */
describe('KineticAdapter.discoverPositions — an unread debt is not a zero debt (it. 31)', () => {
  it('a 429 on borrowBalanceCurrent RISES as KINETIC_POSITION_UNREADABLE naming the market', async () => {
    const k = CHAIN[KFXRP_ISO.toLowerCase()];
    const saved = k.borrowBalanceCurrent;
    k.borrowBalanceCurrent = DOWN;
    try {
      await expect(new KineticAdapter().discoverPositions(WALLET)).rejects.toThrow(/KINETIC_POSITION_UNREADABLE/);
      await expect(new KineticAdapter().discoverPositions(WALLET)).rejects.toThrow(new RegExp(`borrowBalanceCurrent on market ${KFXRP_ISO}`));
    } finally {
      k.borrowBalanceCurrent = saved;
    }
  });

  it('a 429 on the balanceOf PROBE of a market rises too — «could not read whether you hold shares» is not «you hold none»', async () => {
    const k = CHAIN[KUSDT0_ISO.toLowerCase()];
    const saved = k.balanceOf;
    k.balanceOf = DOWN;
    try {
      await expect(new KineticAdapter().discoverPositions(WALLET)).rejects.toThrow(/balanceOf on market/);
    } finally {
      k.balanceOf = saved;
    }
  });

  it('CONTROL — a metadata read failing (symbol) keeps the position, with a soft label', async () => {
    const k = CHAIN[KFXRP_ISO.toLowerCase()];
    const saved = k.symbol;
    k.symbol = DOWN;
    try {
      const positions = await new KineticAdapter().discoverPositions(WALLET);
      expect(positions).toHaveLength(1);
      expect((positions[0].raw as { cTokenSymbol: string }).cTokenSymbol).toBe('cUNKNOWN');
    } finally {
      k.symbol = saved;
    }
  });
});

/**
 * Ola 0 (15-sep) — DEGRADE PER MARKET, NOT PER PROTOCOL.
 *
 * it. 31 was right to make the probe rise; it was wrong to let it take the
 * whole adapter with it. The carry holder (FXRP supplied, USDT0 borrowed)
 * opened Positions under the gateway's routine 429, ONE probe of a market
 * they never touched did not answer, and their supply, their debt and their
 * «Repay» door were gone from the board — with no sentence about it.
 *
 * `discoverPositionsPartial` is what the board route and the portfolio engine
 * read now: the markets that answered are served, the one that did not is
 * NAMED. `discoverPositions` keeps all-or-nothing for the legacy callers.
 */
const USDT0 = '0x0000000000000000000000000000000000000009';
const KSFLR_ISO = '0x00000000000000000000000000000000000000aa';

describe('ola 0 · discoverPositionsPartial — one market down does not blank the others', () => {
  beforeAll(() => {
    CHAIN[USDT0.toLowerCase()] = { symbol: 'USDT0', decimals: 6 };
  });

  it('(a) the carry is served with a 429 on the probe of an UNRELATED market — and that market is named', async () => {
    // Third market the wallet never touched; its probe does not answer.
    CHAIN[KSFLR_ISO.toLowerCase()] = { balanceOf: DOWN };
    const comp = CHAIN[ISO_COMPTROLLER.toLowerCase()];
    const savedAll = comp.getAllMarkets;
    comp.getAllMarkets = [KFXRP_ISO, KUSDT0_ISO, KSFLR_ISO];
    // The carry: FXRP supply + USDT0 debt, both entered.
    comp.getAssetsIn = [KFXRP_ISO, KUSDT0_ISO];
    const kU = CHAIN[KUSDT0_ISO.toLowerCase()];
    const savedBorrow = kU.borrowBalanceCurrent;
    kU.borrowBalanceCurrent = 5_000_000n;
    try {
      const { positions, unreadable } = await new KineticAdapter().discoverPositionsPartial(WALLET);
      const kinds = positions.map((p) => `${p.kind}:${(p.raw as { symbol: string }).symbol}`).sort();
      expect(kinds).toEqual(['BORROW:USDT0', 'SUPPLY:FXRP']);
      expect(unreadable).toEqual([
        expect.objectContaining({ what: `balanceOf on market ${KSFLR_ISO}`, market: KSFLR_ISO }),
      ]);
      expect(unreadable[0].reason).toMatch(/429/);
      // The legacy entry still refuses to hand out a list with a hole in it.
      await expect(new KineticAdapter().discoverPositions(WALLET)).rejects.toThrow(/balanceOf on market/);
    } finally {
      comp.getAllMarkets = savedAll;
      comp.getAssetsIn = [];
      kU.borrowBalanceCurrent = savedBorrow;
      delete CHAIN[KSFLR_ISO.toLowerCase()];
    }
  });

  it('(c) getAssetsIn down → EVERY market is read in full, so a USDT0 debt with zero kUSDT0 shares cannot hide', async () => {
    const comp = CHAIN[ISO_COMPTROLLER.toLowerCase()];
    const savedEntered = comp.getAssetsIn;
    comp.getAssetsIn = DOWN;
    const kU = CHAIN[KUSDT0_ISO.toLowerCase()];
    const savedBorrow = kU.borrowBalanceCurrent;
    kU.borrowBalanceCurrent = 5_000_000n; // live debt; balanceOf stays 0n (a borrow mints no shares)
    try {
      const { positions, unreadable } = await new KineticAdapter().discoverPositionsPartial(WALLET);
      const kinds = positions.map((p) => `${p.kind}:${(p.raw as { symbol: string }).symbol}`).sort();
      expect(kinds).toEqual(['BORROW:USDT0', 'SUPPLY:FXRP']);
      // Everything that matters was read: nothing is unreadable.
      expect(unreadable).toEqual([]);
    } finally {
      comp.getAssetsIn = savedEntered;
      kU.borrowBalanceCurrent = savedBorrow;
    }
  });

  it('getAssetsIn AND getAllMarkets down → the comptroller is named unreadable, never «no positions»', async () => {
    const comp = CHAIN[ISO_COMPTROLLER.toLowerCase()];
    const savedEntered = comp.getAssetsIn;
    const savedAll = comp.getAllMarkets;
    comp.getAssetsIn = DOWN;
    comp.getAllMarkets = DOWN;
    try {
      const { positions, unreadable } = await new KineticAdapter().discoverPositionsPartial(WALLET);
      expect(positions).toEqual([]);
      expect(unreadable).toEqual([
        expect.objectContaining({ what: `getAssetsIn/getAllMarkets on comptroller ${ISO_COMPTROLLER}`, market: ISO_COMPTROLLER }),
      ]);
    } finally {
      comp.getAssetsIn = savedEntered;
      comp.getAllMarkets = savedAll;
    }
  });

  it('a money read down on ONE entered market names that market and serves the other (no half-market: supply without its debt read is not emitted)', async () => {
    const comp = CHAIN[ISO_COMPTROLLER.toLowerCase()];
    comp.getAssetsIn = [KFXRP_ISO, KUSDT0_ISO];
    const kU = CHAIN[KUSDT0_ISO.toLowerCase()];
    const savedBorrow = kU.borrowBalanceCurrent;
    kU.borrowBalanceCurrent = DOWN;
    try {
      const { positions, unreadable } = await new KineticAdapter().discoverPositionsPartial(WALLET);
      expect(positions.map((p) => `${p.kind}:${(p.raw as { symbol: string }).symbol}`)).toEqual(['SUPPLY:FXRP']);
      expect(unreadable).toEqual([
        expect.objectContaining({ what: `borrowBalanceCurrent on market ${KUSDT0_ISO}`, market: KUSDT0_ISO }),
      ]);
    } finally {
      comp.getAssetsIn = [];
      kU.borrowBalanceCurrent = savedBorrow;
    }
  });
});

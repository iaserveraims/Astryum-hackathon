/**
 * Ola 0 (15-sep) — `GET /api/positions/:wallet` UNDER ONE 429.
 *
 * THE FAILURE (two reviewers). The carry holder (FXRP supplied + USDT0
 * borrowed on Kinetic ISO) opens Positions while the public gateway 429s ONE
 * of the ~20 reads the Kinetic adapter makes — the `balanceOf` probe of a
 * market they never touched. it. 31 made that probe throw; the adapter's two
 * `Promise.all`s carried the throw up; this route answered HTTP 200 with
 * `{ protocolId: 'kinetic', error, positions: [] }`; the board only read
 * `positions`. Result: zero Kinetic rows, zero «Repay» door, zero sentence.
 *
 * THE CONSUMER UNDER TEST: the real router, the real KineticAdapter and the
 * real FirelightAdapter, over a fake node that refuses exactly the reads we
 * name. Assertions are over the JSON the board receives.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));
// The route's other imports drag the control plane, the scan service and
// Prisma in; none of them is on the path under test.
jest.mock('../../control-plane/ControlPlane', () => ({ controlPlane: { call: jest.fn() } }));
jest.mock('../../services/PositionScanService', () => ({ positionScanService: { scanWalletOnChain: jest.fn() } }));
jest.mock('../../services/PositionPersistenceService', () => ({
  positionPersistenceEnabled: () => false,
  positionPersistenceService: { persistScan: jest.fn() },
}));

const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';
const KSFLR_ISO = '0x00000000000000000000000000000000000000aa';
const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
const USDT0 = '0x0000000000000000000000000000000000000009';
const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const WALLET = '0xeabcd745598916b0131ece397c8d6a332088462c';

/** A read that does NOT answer (the public gateway's 429). */
const DOWN = '__rpc_down__';

/**
 * The carry: FXRP supplied, USDT0 borrowed, both entered. A third market
 * (kSFLR) the wallet never touched — its probe 429s. stXRP's `balanceOf`
 * (the Firelight anchor) 429s too, so that adapter falls entirely.
 */
const CHAIN: Record<string, Record<string, unknown>> = {
  [ISO_COMPTROLLER.toLowerCase()]: {
    getAssetsIn: [KFXRP_ISO, KUSDT0_ISO],
    getAllMarkets: [KFXRP_ISO, KUSDT0_ISO, KSFLR_ISO],
  },
  [KFXRP_ISO.toLowerCase()]: {
    balanceOf: 9_500_000n,
    balanceOfUnderlying: 9_600_014n,
    borrowBalanceCurrent: 0n,
    underlying: FXRP,
    symbol: 'ikFXRP',
  },
  [KUSDT0_ISO.toLowerCase()]: {
    balanceOf: 0n,
    balanceOfUnderlying: 0n,
    borrowBalanceCurrent: 5_000_000n,
    underlying: USDT0,
    symbol: 'ikUSDT0',
  },
  [KSFLR_ISO.toLowerCase()]: { balanceOf: DOWN },
  [FXRP.toLowerCase()]: { symbol: 'FXRP', decimals: 6 },
  [USDT0.toLowerCase()]: { symbol: 'USDT0', decimals: 6 },
  [STXRP.toLowerCase()]: { balanceOf: DOWN, pendingRewards: 0n, convertToAssets: 0n },
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      const state = CHAIN[address.toLowerCase()] ?? {};
      for (const fn of Object.keys(state)) {
        const impl = async () => {
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

// Only the two adapters this suite is about — the real classes.
jest.mock('../../connectors/protocols/adapters', () => {
  const { KineticAdapter } = jest.requireActual('../../connectors/protocols/adapters/KineticAdapter');
  const { FirelightAdapter } = jest.requireActual('../../connectors/protocols/adapters/FirelightAdapter');
  return {
    registerFlareAdapters: (registry: { registerAdapter: (a: unknown) => void }) => {
      registry.registerAdapter(new KineticAdapter());
      registry.registerAdapter(new FirelightAdapter());
    },
  };
});

import positionsRouter from '../positions';
import { resetAddressCache } from '../../config/protocolAddresses';

const app = express();
app.use(express.json());
app.use('/api/positions', positionsRouter);

beforeAll(() => {
  delete process.env.KINETIC_COMPTROLLER;
  process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
  process.env.KINETIC_KFXRP_ISO = KFXRP_ISO;
  process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
  process.env.FIRELIGHT_STXRP = STXRP;
  process.env.FIRELIGHT_STAKING = STXRP;
  resetAddressCache();
});

afterAll(() => {
  delete process.env.KINETIC_ISO_COMPTROLLER;
  delete process.env.KINETIC_KFXRP_ISO;
  delete process.env.KINETIC_KUSDT0_ISO;
  delete process.env.FIRELIGHT_STXRP;
  delete process.env.FIRELIGHT_STAKING;
  resetAddressCache();
});

type Block = {
  protocolId: string;
  positions: Array<{ kind: string; raw: { symbol?: string } }>;
  unreadable?: Array<{ what: string; reason: string; market?: string }>;
  error?: string;
};

describe('ola 0 · GET /api/positions/:wallet degrades per market, and says what it could not read', () => {
  it('(a) the carry rows are SERVED with a 429 on the probe of an unrelated market — and that market is named in the block', async () => {
    const res = await request(app).get(`/api/positions/${WALLET}`);
    expect(res.status).toBe(200);
    const kinetic = (res.body.results as Block[]).find((b) => b.protocolId === 'kinetic')!;
    expect(kinetic).toBeDefined();
    expect(kinetic.error).toBeUndefined();
    // Both legs of the carry — the supply AND the debt that carries the Repay door.
    expect(kinetic.positions.map((p) => `${p.kind}:${p.raw.symbol}`).sort()).toEqual(['BORROW:USDT0', 'SUPPLY:FXRP']);
    // And the market that did not answer, named, with the node's own reason.
    expect(kinetic.unreadable).toEqual([
      expect.objectContaining({ what: `balanceOf on market ${KSFLR_ISO}`, market: KSFLR_ISO, reason: expect.stringMatching(/429/) }),
    ]);
  });

  it('an adapter that falls ENTIRELY keeps the it. 29 shape — `error` + no rows — still HTTP 200 beside the ones that answered', async () => {
    const res = await request(app).get(`/api/positions/${WALLET}`);
    const firelight = (res.body.results as Block[]).find((b) => b.protocolId === 'firelight')!;
    expect(firelight.positions).toEqual([]);
    expect(firelight.error).toMatch(/429/);
    expect(firelight.unreadable).toBeUndefined();
  });

  it('CONTROL — with every read answering, no block carries `unreadable` or `error`', async () => {
    const savedProbe = CHAIN[KSFLR_ISO.toLowerCase()].balanceOf;
    const savedStx = CHAIN[STXRP.toLowerCase()].balanceOf;
    CHAIN[KSFLR_ISO.toLowerCase()].balanceOf = 0n;
    CHAIN[STXRP.toLowerCase()].balanceOf = 0n;
    // Firelight's queue: the fake vault has no currentPeriod → the queue read
    // fails at the ANCHOR, which is a whole-adapter throw by design. Give it one.
    Object.assign(CHAIN[STXRP.toLowerCase()], { currentPeriod: 224n, withdrawalsOf: 0n, isWithdrawClaimed: false });
    try {
      const res = await request(app).get(`/api/positions/${WALLET}`);
      for (const b of res.body.results as Block[]) {
        expect(b.unreadable).toBeUndefined();
        expect(b.error).toBeUndefined();
      }
      const kinetic = (res.body.results as Block[]).find((b) => b.protocolId === 'kinetic')!;
      expect(kinetic.positions).toHaveLength(2);
    } finally {
      CHAIN[KSFLR_ISO.toLowerCase()].balanceOf = savedProbe;
      CHAIN[STXRP.toLowerCase()].balanceOf = savedStx;
    }
  });
});

/**
 * A DEGRADED SNAPSHOT IS NOT A FACT: it does not replace the
 * last complete copy, it is not persisted, and it says what it could not read.
 */

// Degraded fresh cache dies at once, so the next read falls to the STALE copy.
process.env.PORTFOLIO_DEGRADED_CACHE_TTL_S = '0';

jest.mock('../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));

jest.mock('../../../database/redisClient', () => ({
  getRedis: () => null,
}));

const prismaCreate = jest.fn(async () => ({}));
const prismaLatestRow = { current: null as null | Record<string, unknown> };
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    wallet: {
      // The wallet IS registered — persistence would otherwise no-op for every snapshot.
      findFirst: jest.fn(async () => ({ id: 'w1', userId: 'u1' })),
      findMany: jest.fn(async () => []),
    },
    portfolioSnapshot: {
      create: (...args: unknown[]) => prismaCreate(...(args as [])),
      findFirst: jest.fn(async () => prismaLatestRow.current),
      findMany: jest.fn(async () => []),
    },
  },
}));

const WALLET = '0x000000000000000000000000000000000000abcd';
const XRPL_WALLET = 'rDcohqb2qWkiVdqmKXqBY6kE7qsmaXHbB1';

const row = (protocolId: string, asset: string, kind = 'SUPPLY') => ({
  protocolId,
  chainId: 14,
  wallet: WALLET,
  kind,
  asset,
  amount: 5_000_000n,
  raw: { symbol: 'FXRP', decimals: 6 },
  discoveredAt: new Date(),
});

const normalize = (raw: Record<string, unknown>) => ({
  protocolId: raw.protocolId,
  chainId: raw.chainId,
  wallet: raw.wallet,
  kind: raw.kind,
  asset: raw.asset,
  amount: raw.amount,
  amountUSD: 0,
  priceUSD: 0,
  metadata: raw.raw,
  takenAt: raw.discoveredAt,
});

/** Healthy, whole-adapter semantics (no partial method). */
const healthy = {
  protocolId: 'ftso-fake',
  chainId: 14,
  isActive: true,
  discoverPositions: jest.fn(async () => [row('ftso-fake', '0xA000000000000000000000000000000000000001', 'STAKE')]),
  normalizePosition: normalize,
  getMetrics: async () => ({}),
  simulateAction: async () => ({}),
  buildTransactionIntent: async () => ({}),
};

/** Kinetic-shaped: can degrade PER MARKET through discoverPositionsPartial. */
const kineticState = { probeDown: false, allDown: false };
const kinetic = {
  ...healthy,
  protocolId: 'kinetic-fake',
  discoverPositions: jest.fn(async () => {
    throw new Error('legacy entry must not be used by the engine when a partial one exists');
  }),
  discoverPositionsPartial: jest.fn(async () => {
    if (kineticState.allDown) throw new Error('KINETIC_POSITION_UNREADABLE: getAssetsIn/getAllMarkets did not answer (429)');
    return {
      positions: [
        row('kinetic-fake', '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', 'SUPPLY'),
        row('kinetic-fake', '0x0000000000000000000000000000000000000009', 'BORROW'),
      ],
      unreadable: kineticState.probeDown
        ? [{ what: 'balanceOf on market 0x00000000000000000000000000000000000000aa', reason: '429 Too Many Requests', market: '0x00000000000000000000000000000000000000aa' }]
        : [],
    };
  }),
};

jest.mock('../../../connectors/protocols/adapters', () => ({
  registerFlareAdapters: (registry: { registerAdapter: (a: unknown) => void }) => {
    registry.registerAdapter(healthy);
    registry.registerAdapter(kinetic);
  },
}));

jest.mock('../../normalisation/NormalisationEngine', () => {
  const real = jest.requireActual('../../normalisation/NormalisationEngine');
  return { ...real, createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 0 }) };
});

jest.mock('../../../integrations/providers/portfolio/OnChainBalanceProvider', () => ({
  onChainBalanceProvider: { id: 'onchain-balance', call: jest.fn(async () => ({ data: [], source: {}, cached: false })) },
  readManagedPotePositions: jest.fn(async () => []),
}));
jest.mock('../../../integrations/providers/portfolio/CoinStatsProvider', () => ({
  coinStatsProvider: { id: 'coinstats-portfolio', call: jest.fn() },
}));
jest.mock('../../../integrations/providers/portfolio/DeBankPortfolioProvider', () => ({
  deBankPortfolioProvider: { id: 'debank-portfolio', call: jest.fn() },
}));

const xrplCall = jest.fn();
jest.mock('../../../integrations/providers/portfolio/XrplBalanceProvider', () => ({
  xrplBalanceProvider: { id: 'xrpl-balance', call: (...a: unknown[]) => xrplCall(...(a as [])) },
}));

import { PortfolioEngine } from '../PortfolioEngine';

const OPTS = { forceRefresh: true, persist: false, includeExternal: false } as const;
const engine = () => PortfolioEngine.getInstance();

beforeEach(() => {
  kineticState.probeDown = false;
  kineticState.allDown = false;
  prismaCreate.mockClear();
  prismaLatestRow.current = null;
});

describe('ola 0 · a partially-read adapter is served, and named as partial', () => {
  test('one market down → the carry rows ARE in positions and unreadable carries partial:true + the read', async () => {
    kineticState.probeDown = true;
    const snap = await engine().getPortfolio(WALLET, 14, OPTS);
    const kineticRows = snap.positions.filter((p) => p.protocolId === 'kinetic-fake');
    expect(kineticRows.map((p) => p.kind).sort()).toEqual(['BORROW', 'SUPPLY']);
    expect(snap.unreadable).toEqual([
      expect.objectContaining({
        protocolId: 'kinetic-fake',
        partial: true,
        reads: [expect.objectContaining({ what: expect.stringMatching(/balanceOf on market/), market: '0x00000000000000000000000000000000000000aa' })],
      }),
    ]);
    expect(snap.unreadable?.[0].reason).toMatch(/balanceOf on market/);
  });

  test('the engine reads the PARTIAL entry when the adapter has one (the legacy throw is never reached)', async () => {
    await engine().getPortfolio(WALLET, 14, OPTS);
    expect(kinetic.discoverPositionsPartial).toHaveBeenCalled();
    expect(kinetic.discoverPositions).not.toHaveBeenCalled();
  });
});

describe('ola 0 · the degraded snapshot does not replace the last complete copy', () => {
  test('complete → degraded (forced) → plain read serves the COMPLETE copy, not the degraded one', async () => {
    // 1. A complete sweep: both adapters answer.
    const complete = await engine().getPortfolio(WALLET, 14, OPTS);
    expect(complete.unreadable).toBeUndefined();
    expect(complete.positions.some((p) => p.protocolId === 'kinetic-fake')).toBe(true);

    // 2. The forced refresh after a settlement lands on a 429: Kinetic falls entirely.
    kineticState.allDown = true;
    const degraded = await engine().getPortfolio(WALLET, 14, OPTS);
    expect(degraded.unreadable).toEqual([expect.objectContaining({ protocolId: 'kinetic-fake' })]);
    expect(degraded.positions.some((p) => p.protocolId === 'kinetic-fake')).toBe(false);

    // 3. The next plain read (fresh degraded cache already dead: TTL 0) falls
    //    to the stale copy — which must still be the COMPLETE one.
    const served = await engine().getPortfolio(WALLET, 14, { persist: false, includeExternal: false });
    expect(served.positions.some((p) => p.protocolId === 'kinetic-fake')).toBe(true);
    expect(served.unreadable).toBeUndefined();
    // Let the coalesced background refresh settle before the next test.
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe('ola 0 · the degraded snapshot is not persisted as a fact — not even forced', () => {
  test('complete + persist:true → a row is written; degraded + persist:true → nothing is written', async () => {
    await engine().getPortfolio(WALLET, 14, { forceRefresh: true, persist: true, includeExternal: false });
    expect(prismaCreate).toHaveBeenCalledTimes(1);

    prismaCreate.mockClear();
    kineticState.allDown = true;
    const degraded = await engine().getPortfolio(WALLET, 14, { forceRefresh: true, persist: true, includeExternal: false });
    expect(degraded.unreadable?.length).toBeGreaterThan(0);
    expect(prismaCreate).not.toHaveBeenCalled();

    // A PARTIAL read (one market) is degraded too: no row either.
    prismaCreate.mockClear();
    kineticState.allDown = false;
    kineticState.probeDown = true;
    await engine().getPortfolio(WALLET, 14, { forceRefresh: true, persist: true, includeExternal: false });
    expect(prismaCreate).not.toHaveBeenCalled();
  });
});

describe('ola 0 · getLatestSnapshot keeps a row\'s unreadable (rowToSnapshot no longer drops it)', () => {
  test('a persisted row carrying performance.unreadable comes back with it', async () => {
    prismaLatestRow.current = {
      totalValue: 12,
      performance: {
        netWorthUSD: 12,
        collateralUSD: 12,
        debtUSD: 0,
        unreadable: [{ protocolId: 'kinetic', reason: 'adapter kinetic timed out after 15000ms' }],
      },
      positions: [],
      allocation: { byProtocol: {}, byAsset: {}, byKind: {} },
      takenAt: new Date('2026-09-15T10:00:00Z'),
    };
    const snap = await engine().getLatestSnapshot(WALLET, 14);
    expect(snap.unreadable).toEqual([{ protocolId: 'kinetic', reason: 'adapter kinetic timed out after 15000ms' }]);
  });
});

describe('ola 0 · the non-EVM path is the same family: an XRPL read that fails is named, not zeroed', () => {
  test('provider throws → snapshot.unreadable names it, positions are a lower bound, nothing persisted', async () => {
    xrplCall.mockRejectedValueOnce(new Error('ECONNRESET: xrplcluster did not answer'));
    const snap = await engine().getPortfolio(XRPL_WALLET, 14, { forceRefresh: true, persist: true, includeExternal: false });
    expect(snap.unreadable).toEqual([{ protocolId: 'xrpl-balance', reason: expect.stringMatching(/xrplcluster/) }]);
    expect(snap.positions).toEqual([]);
    expect(prismaCreate).not.toHaveBeenCalled();
  });

  test('CONTROL — provider answers → no unreadable, and the row IS persisted', async () => {
    xrplCall.mockResolvedValueOnce({ data: [], source: {}, cached: false });
    const snap = await engine().getPortfolio(XRPL_WALLET, 14, { forceRefresh: true, persist: true, includeExternal: false });
    expect(snap).not.toHaveProperty('unreadable');
    expect(prismaCreate).toHaveBeenCalledTimes(1);
  });
});

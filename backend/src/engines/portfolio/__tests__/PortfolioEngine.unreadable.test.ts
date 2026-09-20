/**
 * The snapshot SAYS which adapter could not be read (to the person,
 * not only to the log).
 */

jest.mock('../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));

jest.mock('../../../database/redisClient', () => ({
  getRedis: () => null,
}));

jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    wallet: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
    portfolioSnapshot: {
      create: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
  },
}));

const WALLET = '0x000000000000000000000000000000000000abcd';

/** Two adapters: one answers (with one row), one does NOT (the throw). */
const healthy = {
  protocolId: 'kinetic-fake',
  chainId: 14,
  isActive: true,
  discoverPositions: jest.fn(async () => [
    {
      protocolId: 'kinetic-fake',
      chainId: 14,
      wallet: WALLET,
      kind: 'SUPPLY',
      asset: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE',
      amount: 5_000_000n,
      raw: { symbol: 'FXRP', decimals: 6 },
      discoveredAt: new Date(),
    },
  ]),
  normalizePosition: (raw: Record<string, unknown>) => ({
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
  }),
  getMetrics: async () => ({}),
  simulateAction: async () => ({}),
  buildTransactionIntent: async () => ({}),
};
const broken = {
  ...healthy,
  protocolId: 'firelight-fake',
  discoverPositions: jest.fn(async () => {
    throw new Error('FIRELIGHT_QUEUE_UNREADABLE: withdrawal queue did not answer (VAULT_QUEUE_UNREADABLE: withdrawalsOf(220) did not answer)');
  }),
};

jest.mock('../../../connectors/protocols/adapters', () => ({
  registerFlareAdapters: (registry: { registerAdapter: (a: unknown) => void }) => {
    registry.registerAdapter(healthy);
    registry.registerAdapter(broken);
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

import { PortfolioEngine } from '../PortfolioEngine';

describe('The snapshot names the adapter that could not be read', () => {
  test('a throwing adapter lands in snapshot.unreadable with its reason; the healthy one still contributes', async () => {
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
      includeExternal: false,
    });

    // The healthy adapter's row is there.
    expect(snapshot.positions.some((p) => p.protocolId === 'kinetic-fake')).toBe(true);
    // The broken one is absent from positions — and SAID, not just logged.
    expect(snapshot.positions.some((p) => p.protocolId === 'firelight-fake')).toBe(false);
    expect(snapshot.unreadable).toEqual([
      { protocolId: 'firelight-fake', reason: expect.stringMatching(/FIRELIGHT_QUEUE_UNREADABLE/) },
    ]);
    expect(snapshot.unreadable?.[0].reason).toMatch(/withdrawalsOf\(220\)/);
  });

  test('the field survives JSON serialisation exactly as /api/portfolio ships the snapshot', async () => {
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
      includeExternal: false,
    });
    const wire = JSON.parse(JSON.stringify(snapshot, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    expect(wire.unreadable).toEqual([{ protocolId: 'firelight-fake', reason: expect.any(String) }]);
  });

  test('CONTROL — when every adapter answers, the snapshot carries no `unreadable` key at all', async () => {
    broken.discoverPositions.mockImplementationOnce(async () => []);
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
      includeExternal: false,
    });
    expect(snapshot).not.toHaveProperty('unreadable');
  });
});

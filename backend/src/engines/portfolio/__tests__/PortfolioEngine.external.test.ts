/**
 * PortfolioEngine — external multichain provider gating (BUG-1 regression).
 *
 * OnChainBalanceProvider needs NO API key (public RPC + DeFiLlama prices), so
 * it must ALWAYS run when includeExternal is requested — even on deployments
 * without COINSTATS_API_KEY / DEBANK_API_KEY. Those two providers stay gated
 * by their respective keys.
 *
 * All I/O is mocked: no RPC, no Redis, no Prisma, no FTSO.
 */

jest.mock('../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));

// No Redis in tests — cache read/write paths are skipped (getRedis() → null).
jest.mock('../../../database/redisClient', () => ({
  getRedis: () => null,
}));

jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    wallet: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    portfolioSnapshot: {
      create: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
  },
}));

// Keep the Flare adapter registry empty — this suite only exercises the
// external (non-Flare) provider gating.
jest.mock('../../../connectors/protocols/adapters', () => ({
  registerFlareAdapters: jest.fn(),
}));

// Skip the FTSO price provider (no network).
jest.mock('../../normalisation/NormalisationEngine', () => {
  const real = jest.requireActual('../../normalisation/NormalisationEngine');
  return {
    ...real,
    createFTSOPriceProvider: async () => ({ getPriceUSD: async () => 0 }),
  };
});

jest.mock('../../../integrations/providers/portfolio/OnChainBalanceProvider', () => ({
  onChainBalanceProvider: { id: 'onchain-balance', call: jest.fn() },
}));
jest.mock('../../../integrations/providers/portfolio/CoinStatsProvider', () => ({
  coinStatsProvider: { id: 'coinstats-portfolio', call: jest.fn() },
}));
jest.mock('../../../integrations/providers/portfolio/DeBankPortfolioProvider', () => ({
  deBankPortfolioProvider: { id: 'debank-portfolio', call: jest.fn() },
}));

import { PortfolioEngine } from '../PortfolioEngine';
import { onChainBalanceProvider } from '../../../integrations/providers/portfolio/OnChainBalanceProvider';
import { coinStatsProvider } from '../../../integrations/providers/portfolio/CoinStatsProvider';
import { deBankPortfolioProvider } from '../../../integrations/providers/portfolio/DeBankPortfolioProvider';
import type { CanonicalPosition } from '../../../canonical/types/Position';
import type { SourceRecord } from '../../../canonical/types/Source';

const WALLET = '0x000000000000000000000000000000000000abcd';

function sourceRecord(providerId: string): SourceRecord {
  return {
    providerId,
    providerType: 'chain',
    trustLevel: 'onchain_verified',
    fetchedAt: new Date().toISOString(),
    traceId: 'trace-test',
  };
}

function onchainEthPosition(): CanonicalPosition {
  const source = sourceRecord('onchain-balance');
  return {
    id: `onchain:1:${WALLET}:ETH`,
    wallet: WALLET,
    chainId: 1,
    protocol: 'wallet',
    kind: 'free',
    assets: [
      {
        asset: {
          symbol: 'ETH',
          address: '0x0000000000000000000000000000000000000000',
          chainId: 1,
          decimals: 18,
          priceUSD: 3000,
          source,
        },
        amount: '1',
        amountUSD: 3000,
      },
    ],
    source,
  };
}

const onChainCall = onChainBalanceProvider.call as jest.Mock;
const coinStatsCall = coinStatsProvider.call as jest.Mock;
const deBankCall = deBankPortfolioProvider.call as jest.Mock;

const savedEnv = {
  COINSTATS_API_KEY: process.env.COINSTATS_API_KEY,
  DEBANK_API_KEY: process.env.DEBANK_API_KEY,
};

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('PortfolioEngine external provider gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.COINSTATS_API_KEY;
    delete process.env.DEBANK_API_KEY;
    onChainCall.mockResolvedValue({
      data: [onchainEthPosition()],
      source: sourceRecord('onchain-balance'),
      cached: false,
    });
    coinStatsCall.mockResolvedValue({
      data: [],
      source: sourceRecord('coinstats-portfolio'),
      cached: false,
    });
    deBankCall.mockResolvedValue({
      data: [],
      source: sourceRecord('debank-portfolio'),
      cached: false,
    });
  });

  test('no CoinStats/DeBank keys + includeExternal → OnChainBalanceProvider still runs', async () => {
    const snapshot = await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
      includeExternal: true,
    });

    expect(onChainCall).toHaveBeenCalledTimes(1);
    expect(onChainCall).toHaveBeenCalledWith(
      'portfolio.getPositions',
      { walletAddress: WALLET },
      expect.objectContaining({ wallet: WALLET }),
    );
    // Key-gated providers must NOT be called without their keys
    expect(coinStatsCall).not.toHaveBeenCalled();
    expect(deBankCall).not.toHaveBeenCalled();

    // The key-less on-chain balance survives into the snapshot
    const external = snapshot.positions.find((p) => p.protocolId === 'wallet-1');
    expect(external).toBeDefined();
    expect(external?.asset).toBe('ETH');
    expect(external?.amountUSD).toBe(3000);
    expect(snapshot.totalUSD).toBe(3000);
  });

  test('default options (includeExternal omitted) still run the on-chain provider without keys', async () => {
    await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
    });

    expect(onChainCall).toHaveBeenCalledTimes(1);
    expect(coinStatsCall).not.toHaveBeenCalled();
    expect(deBankCall).not.toHaveBeenCalled();
  });

  test('includeExternal: false disables all external providers', async () => {
    await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
      includeExternal: false,
    });

    expect(onChainCall).not.toHaveBeenCalled();
    expect(coinStatsCall).not.toHaveBeenCalled();
    expect(deBankCall).not.toHaveBeenCalled();
  });

  test('CoinStats/DeBank run only when their respective keys are set', async () => {
    process.env.COINSTATS_API_KEY = 'test-coinstats-key';
    process.env.DEBANK_API_KEY = 'test-debank-key';

    await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
      includeExternal: true,
    });

    expect(onChainCall).toHaveBeenCalledTimes(1);
    expect(coinStatsCall).toHaveBeenCalledTimes(1);
    expect(deBankCall).toHaveBeenCalledTimes(1);
  });

  // Regression (2026-07-04): the external multichain reader re-reported the
  // SAME native FLR the Flare NativeBalanceAdapter already read, so the wallet
  // balance appeared twice ('wallet' + 'wallet-14') and inflated totals. The
  // engine must drop external rows whose (chain, wallet-bucket, kind, asset)
  // the on-chain read already covers — and keep unrelated external rows.
  // NOTE: registers a stub adapter in the shared registry; keep this test LAST.
  test('external re-read of an on-chain wallet balance is dropped (FLR double count)', async () => {
    const { ProtocolRegistry } = await import('../../../connectors/protocols/ProtocolRegistry');
    const { NATIVE_TOKEN_ADDRESS } = await import('../../../connectors/protocols/adapters/NativeBalanceAdapter');

    const stubAdapter = {
      protocolId: 'wallet',
      chainId: 14,
      isActive: true,
      discoverPositions: jest.fn(async () => [
        {
          protocolId: 'wallet',
          chainId: 14,
          wallet: WALLET,
          kind: 'FREE',
          asset: NATIVE_TOKEN_ADDRESS,
          amount: 10n ** 18n, // 1 FLR
          raw: { symbol: 'FLR', decimals: 18, native: true },
          discoveredAt: new Date(),
        },
      ]),
      getMetrics: jest.fn(async () => ({})),
    };
    ProtocolRegistry.getInstance().registerAdapter(stubAdapter as never);

    const source = sourceRecord('onchain-balance');
    const flareDuplicate: CanonicalPosition = {
      id: `onchain:14:${WALLET}:FLR`,
      wallet: WALLET,
      chainId: 14,
      protocol: 'wallet',
      kind: 'free',
      assets: [
        {
          asset: { symbol: 'FLR', address: NATIVE_TOKEN_ADDRESS, chainId: 14, decimals: 18, priceUSD: 0.02, source },
          amount: '1',
          amountUSD: 1.13,
        },
      ],
      source,
    };
    onChainCall.mockResolvedValue({
      data: [onchainEthPosition(), flareDuplicate],
      source,
      cached: false,
    });

    const snapshot = await PortfolioEngine.getInstance().getPortfolio(WALLET, 14, {
      forceRefresh: true,
      persist: false,
      includeExternal: true,
    });

    // FLR appears ONCE — the verified on-chain read; the external echo is gone.
    const flrRows = snapshot.positions.filter((p) => p.asset === 'FLR');
    expect(flrRows).toHaveLength(1);
    expect(flrRows[0].protocolId).toBe('wallet');
    expect(snapshot.positions.some((p) => p.protocolId === 'wallet-14')).toBe(false);

    // Unrelated external rows (ETH on chain 1) still flow through.
    expect(snapshot.positions.some((p) => p.protocolId === 'wallet-1' && p.asset === 'ETH')).toBe(true);
  });
});

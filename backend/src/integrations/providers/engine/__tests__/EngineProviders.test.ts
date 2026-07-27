import { PortfolioAggregationProvider } from '../PortfolioAggregationProvider';
import { RiskNormalizationProvider } from '../RiskNormalizationProvider';
import type { PortfolioSnapshot } from '../../../../engines/portfolio/SnapshotBuilder';
import type { RiskSnapshot } from '../../../../engines/risk/types';
import type { CanonicalPosition } from '../../../../canonical/types/Position';
import type { CanonicalRisk } from '../../../../canonical/types/Risk';

const mkSnapshot = (): PortfolioSnapshot => ({
  wallet: '0xAbc0000000000000000000000000000000000001',
  chainId: 14,
  totalUSD: 1500,
  collateralUSD: 1000,
  debtUSD: 200,
  netWorthUSD: 1300,
  positions: [
    {
      protocolId: 'kinetic',
      chainId: 14,
      kind: 'SUPPLY',
      asset: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
      amount: '1000000000000000000',
      amountUSD: 1000,
      priceUSD: 1,
      metrics: { hf: 1.8, ltv: 0.4 },
      metadata: { token: 'WFLR', decimals: 18 },
      takenAt: new Date(),
    },
    {
      protocolId: 'kinetic',
      chainId: 14,
      kind: 'BORROW',
      asset: '0x0000000000000000000000000000000000000002',
      amount: '200000000',
      amountUSD: 200,
      priceUSD: 1,
      metrics: { hf: 1.8 },
      metadata: { token: 'USDC', decimals: 6 },
      takenAt: new Date(),
    },
    {
      protocolId: 'sparkdex',
      chainId: 14,
      kind: 'LP',
      asset: '0x0000000000000000000000000000000000000003',
      amount: '500000000000000000',
      amountUSD: 500,
      priceUSD: 1,
      metrics: { inRange: true, apy: 0.12 },
      metadata: { token: 'WFLR-USDC' },
      takenAt: new Date(),
    },
  ],
  breakdown: {
    byProtocol: { kinetic: 800, sparkdex: 500 },
    byAsset: {},
    byKind: { SUPPLY: 1000, BORROW: 200, LP: 500, STAKE: 0, REWARD: 0, FREE: 0 },
  },
  takenAt: new Date(),
});

describe('PortfolioAggregationProvider', () => {
  const traceId = 'trace-test-1';

  it('emits CanonicalPosition[] with mapped kinds and source tag', async () => {
    const fakeEngine = {
      getPortfolio: jest.fn().mockResolvedValue(mkSnapshot()),
    } as any;
    const provider = new PortfolioAggregationProvider(fakeEngine);

    const result = await provider.call<unknown, CanonicalPosition[]>(
      'engine.portfolio.getCanonicalPositions',
      { wallet: '0xAbc0000000000000000000000000000000000001' },
      { traceId },
    );

    expect(fakeEngine.getPortfolio).toHaveBeenCalledWith(
      '0xAbc0000000000000000000000000000000000001',
      14,
      { forceRefresh: undefined },
    );
    expect(result.data).toHaveLength(3);
    expect(result.data.map((p) => p.kind)).toEqual(['collateral', 'debt', 'lp']);
    expect(result.data[0].assets[0].asset.symbol).toBe('WFLR');
    expect(result.data[0].metrics?.healthFactor).toBe(1.8);
    expect(result.data[2].metrics?.inRange).toBe(true);
    expect(result.source.providerId).toBe('engine-portfolio');
    expect(result.source.providerType).toBe('engine');
    expect(result.source.trustLevel).toBe('aggregator');
    expect(result.source.traceId).toBe(traceId);
  });

  it('rejects unknown capability', async () => {
    const provider = new PortfolioAggregationProvider({ getPortfolio: jest.fn() } as any);
    await expect(
      provider.call('engine.portfolio.bogus', { wallet: '0x00' }, { traceId }),
    ).rejects.toThrow(/unsupported_capability/);
  });

  it('rejects missing wallet', async () => {
    const provider = new PortfolioAggregationProvider({ getPortfolio: jest.fn() } as any);
    await expect(
      provider.call('engine.portfolio.getCanonicalPositions', {}, { traceId }),
    ).rejects.toThrow(/wallet required/);
  });

  it('marks source.stale when snapshot is older than 90s', async () => {
    const old = mkSnapshot();
    (old as any).takenAt = new Date(Date.now() - 200_000);
    const provider = new PortfolioAggregationProvider({
      getPortfolio: jest.fn().mockResolvedValue(old),
    } as any);
    const result = await provider.call(
      'engine.portfolio.getCanonicalPositions',
      { wallet: '0xAbc0000000000000000000000000000000000001' },
      { traceId },
    );
    expect(result.source.stale).toBe(true);
  });

  it('health() returns healthy', async () => {
    const provider = new PortfolioAggregationProvider({ getPortfolio: jest.fn() } as any);
    const h = await provider.health();
    expect(h.status).toBe('healthy');
  });

  it('aggregates via router across multiple healthy protocol providers', async () => {
    const { IntegrationRegistry } = await import('../../../registry/IntegrationRegistry');
    const reg = new IntegrationRegistry();

    const mkProvider = (id: string, posChainId: number) => ({
      id,
      type: 'protocol' as const,
      trustLevel: 'protocol_native' as const,
      priority: 90,
      capabilities: ['protocol.discoverPositions'] as const,
      health: async () => ({ status: 'healthy' as const, lastCheckAt: new Date().toISOString() }),
      call: jest.fn().mockResolvedValue({
        data: [
          {
            id: `${id}:pos:0`,
            wallet: '0xAbc',
            chainId: posChainId,
            protocol: id,
            kind: 'collateral',
            assets: [],
            metrics: {},
            source: {
              providerId: id,
              providerType: 'protocol',
              trustLevel: 'protocol_native',
              fetchedAt: new Date().toISOString(),
              traceId: 'router-trace',
            },
          },
        ],
        source: {
          providerId: id,
          providerType: 'protocol',
          trustLevel: 'protocol_native',
          fetchedAt: new Date().toISOString(),
          traceId: 'router-trace',
        },
        cached: false,
      }),
    });

    const a = mkProvider('kinetic', 14);
    const b = mkProvider('sparkdex', 14);
    const offChain = mkProvider('other', 1); // wrong chainId, must be filtered
    reg.register(a as any);
    reg.register(b as any);
    reg.register(offChain as any);
    reg.updateHealth('kinetic', { status: 'healthy', lastCheckAt: new Date().toISOString() });
    reg.updateHealth('sparkdex', { status: 'healthy', lastCheckAt: new Date().toISOString() });
    reg.updateHealth('other', { status: 'healthy', lastCheckAt: new Date().toISOString() });

    const provider = new PortfolioAggregationProvider({ getPortfolio: jest.fn() } as any, reg);
    const result = await provider.call<unknown, CanonicalPosition[]>(
      'engine.portfolio.getCanonicalPositionsViaRouter',
      { wallet: '0xAbc' },
      { traceId: 'router-trace' },
    );

    expect(result.data).toHaveLength(2);
    expect(result.data.map((p) => p.protocol).sort()).toEqual(['kinetic', 'sparkdex']);
    expect(result.source.providerId).toBe('engine-portfolio');
    expect(result.source.traceId).toBe('router-trace');
    // Per-position SourceRecord preserved from upstream provider
    expect(result.data[0].source.providerType).toBe('protocol');
  });

  it('router path isolates failing providers and returns surviving slice', async () => {
    const { IntegrationRegistry } = await import('../../../registry/IntegrationRegistry');
    const reg = new IntegrationRegistry();

    const ok = {
      id: 'wflr',
      type: 'protocol' as const,
      trustLevel: 'protocol_native' as const,
      priority: 90,
      capabilities: ['protocol.discoverPositions'] as const,
      health: async () => ({ status: 'healthy' as const, lastCheckAt: new Date().toISOString() }),
      call: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'wflr:p:0',
            wallet: '0xAbc',
            chainId: 14,
            protocol: 'wflr',
            kind: 'free',
            assets: [],
            metrics: {},
            source: {
              providerId: 'wflr',
              providerType: 'protocol',
              trustLevel: 'protocol_native',
              fetchedAt: new Date().toISOString(),
              traceId: 't',
            },
          },
        ],
        source: {
          providerId: 'wflr',
          providerType: 'protocol',
          trustLevel: 'protocol_native',
          fetchedAt: new Date().toISOString(),
          traceId: 't',
        },
        cached: false,
      }),
    };
    const broken = {
      id: 'kinetic',
      type: 'protocol' as const,
      trustLevel: 'protocol_native' as const,
      priority: 90,
      capabilities: ['protocol.discoverPositions'] as const,
      health: async () => ({ status: 'healthy' as const, lastCheckAt: new Date().toISOString() }),
      call: jest.fn().mockRejectedValue(new Error('rpc down')),
    };
    reg.register(ok as any);
    reg.register(broken as any);
    reg.updateHealth('wflr', { status: 'healthy', lastCheckAt: new Date().toISOString() });
    reg.updateHealth('kinetic', { status: 'healthy', lastCheckAt: new Date().toISOString() });

    const provider = new PortfolioAggregationProvider({ getPortfolio: jest.fn() } as any, reg);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await provider.call<unknown, CanonicalPosition[]>(
      'engine.portfolio.getCanonicalPositionsViaRouter',
      { wallet: '0xAbc' },
      { traceId: 't' },
    );
    warn.mockRestore();

    expect(result.data).toHaveLength(1);
    expect(result.data[0].protocol).toBe('wflr');
  });

  it('router path skips disabled / down providers', async () => {
    const { IntegrationRegistry } = await import('../../../registry/IntegrationRegistry');
    const reg = new IntegrationRegistry();
    const disabledCall = jest.fn();
    const disabled = {
      id: 'kinetic',
      type: 'protocol' as const,
      trustLevel: 'protocol_native' as const,
      priority: 90,
      capabilities: ['protocol.discoverPositions'] as const,
      health: async () => ({ status: 'disabled' as const, lastCheckAt: new Date().toISOString() }),
      call: disabledCall,
    };
    reg.register(disabled as any);
    reg.updateHealth('kinetic', { status: 'disabled', lastCheckAt: new Date().toISOString() });

    const provider = new PortfolioAggregationProvider({ getPortfolio: jest.fn() } as any, reg);
    const result = await provider.call<unknown, CanonicalPosition[]>(
      'engine.portfolio.getCanonicalPositionsViaRouter',
      { wallet: '0xAbc' },
      { traceId: 't' },
    );
    expect(disabledCall).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(0);
  });
});

describe('RiskNormalizationProvider', () => {
  const traceId = 'trace-test-2';

  const mkRisk = (): RiskSnapshot => ({
    scope: 'PORTFOLIO',
    scopeId: '0xAbc',
    healthFactor: 1.6,
    ltv: 0.5,
    riskLevel: 'WARNING',
    riskScore: 55,
    warnings: ['HF below comfort'],
    assumptions: [],
    drivers: [
      { name: 'lending-hf', contribution: 0.6 },
      { name: 'concentration', contribution: 0.3 },
    ],
    computedAt: new Date(),
  });

  it('emits CanonicalRisk with mapped level + drivers', async () => {
    const fakeEngine = { getPortfolioRisk: jest.fn().mockResolvedValue(mkRisk()) } as any;
    const provider = new RiskNormalizationProvider(fakeEngine);

    const result = await provider.call<unknown, CanonicalRisk>(
      'engine.risk.getCanonicalRisk',
      { wallet: '0xAbc0000000000000000000000000000000000001' },
      { traceId },
    );

    expect(result.data.level).toBe('moderate');
    expect(result.data.score).toBe(55);
    expect(result.data.drivers).toHaveLength(2);
    expect(result.data.drivers[0].code).toBe('lending-hf');
    expect(result.data.drivers[0].severity).toBeCloseTo(0.6);
    expect(result.data.warnings).toContain('HF below comfort');
    expect(result.source.providerId).toBe('engine-risk');
    expect(result.source.trustLevel).toBe('aggregator');
  });

  it('maps CRITICAL → critical and clamps score 0..100', async () => {
    const r = mkRisk();
    r.riskLevel = 'CRITICAL';
    r.riskScore = 200; // out of range
    const provider = new RiskNormalizationProvider({
      getPortfolioRisk: jest.fn().mockResolvedValue(r),
    } as any);
    const result = await provider.call<unknown, CanonicalRisk>(
      'engine.risk.getCanonicalRisk',
      { wallet: '0xAbc0000000000000000000000000000000000001' },
      { traceId },
    );
    expect(result.data.level).toBe('critical');
    expect(result.data.score).toBe(100);
  });

  it('maps SAFE+WATCH → safe', async () => {
    const r = mkRisk();
    r.riskLevel = 'WATCH';
    const provider = new RiskNormalizationProvider({
      getPortfolioRisk: jest.fn().mockResolvedValue(r),
    } as any);
    const result = await provider.call<unknown, CanonicalRisk>(
      'engine.risk.getCanonicalRisk',
      { wallet: '0xAbc0000000000000000000000000000000000001' },
      { traceId },
    );
    expect(result.data.level).toBe('safe');
  });
});

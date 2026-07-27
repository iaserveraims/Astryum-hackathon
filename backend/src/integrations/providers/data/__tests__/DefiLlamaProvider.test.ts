// Updated to the current DefiLlamaProvider contract (was obsolete vs the
// refactored provider): prisma-singleton persistence, trustLevel
// 'indexer_verified', capabilities data.getProtocols/getKnownContracts/
// syncProtocolRegistry/…, and syncProtocolRegistry() → number.

jest.mock('../../../../database/prismaClient', () => ({
  prisma: {
    protocolContract: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    protocolPool: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

import { DefiLlamaProvider } from '../DefiLlamaProvider';
import { prisma } from '../../../../database/prismaClient';

const mockUpsert = prisma.protocolContract.upsert as jest.Mock;

const A1 = '0x' + 'a'.repeat(40);
const A2 = '0x' + 'b'.repeat(40);
const A3 = '0x' + 'c'.repeat(40);

const SAMPLE_PROTOCOLS = [
  { name: 'Aave V3', slug: 'aave-v3', category: 'Lending', chains: ['Ethereum'], url: 'https://aave.com', audits: '2', audit_links: ['https://audit/aave'], address: `ethereum:${A1}` },
  { name: 'Plain Proto', slug: 'plain', category: 'Dexes', chains: ['Ethereum'], address: A2 },
  { name: 'Poly Proto', slug: 'poly', category: 'Yield', chains: ['Polygon'], address: `polygon:${A3}` },
  { name: 'No Addr', slug: 'noaddr', category: 'Dexes', chains: ['Ethereum'], address: null },
  { name: 'Solana Proto', slug: 'sol', category: 'Dexes', chains: ['Solana'], address: 'solana:abc' },
];

function mockFetchOk(body: unknown) {
  return jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch;
}

describe('DefiLlamaProvider', () => {
  afterEach(() => {
    global.fetch = undefined as unknown as typeof fetch;
    jest.clearAllMocks();
  });

  test('static metadata: indexer-verified data provider with the real capabilities', () => {
    const p = new DefiLlamaProvider();
    expect(p.id).toBe('defillama');
    expect(p.type).toBe('data');
    expect(p.trustLevel).toBe('indexer_verified');
    expect(p.capabilities).toEqual(
      expect.arrayContaining(['data.getProtocols', 'data.getKnownContracts', 'data.syncProtocolRegistry']),
    );
  });

  test('call(data.getProtocols) returns the protocol list stamped with a SourceRecord', async () => {
    global.fetch = mockFetchOk(SAMPLE_PROTOCOLS);
    const p = new DefiLlamaProvider();
    const r = await p.call('data.getProtocols', {}, { traceId: 't-1' } as never);
    expect(Array.isArray(r.data)).toBe(true);
    expect((r.data as unknown[]).length).toBe(5);
    expect(r.cached).toBe(false);
    expect(r.source.providerId).toBe('defillama');
    expect(r.source.traceId).toBe('t-1');
  });

  test('call(unknown capability) throws', async () => {
    const p = new DefiLlamaProvider();
    await expect(
      p.call('data.totallyBogus' as never, {}, { traceId: 't' } as never),
    ).rejects.toThrow(/unknown capability/i);
  });

  test('syncProtocolRegistry upserts per (protocol, mapped chain) and returns the count', async () => {
    global.fetch = mockFetchOk(SAMPLE_PROTOCOLS);
    const p = new DefiLlamaProvider();
    const count = await p.syncProtocolRegistry();
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThan(0);
    // Each successful upsert increments the returned count.
    expect(mockUpsert).toHaveBeenCalledTimes(count);
  });

  test('health() is healthy when /protocols responds ok', async () => {
    global.fetch = mockFetchOk([]);
    const p = new DefiLlamaProvider();
    const h = await p.health();
    expect(h.status).toBe('healthy');
  });
});

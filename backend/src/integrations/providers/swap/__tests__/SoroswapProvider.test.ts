/**
 * SoroswapProvider — Stellar DEX aggregator (ISO 20022 basket, #3).
 *
 * Verifies the Jupiter-style contract: self-disables without a key, posts to
 * /quote and /build, and returns an UNSIGNED XDR (the user signs in their
 * Stellar wallet — Astryum never signs). `fetch` is mocked; no network.
 */

import { SoroswapProvider } from '../SoroswapProvider';

const ASSET_IN = 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
const ASSET_OUT = 'CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV';
const WALLET = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('SoroswapProvider', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.SOROSWAP_API_KEY;
  });

  test('health is disabled without SOROSWAP_API_KEY', async () => {
    delete process.env.SOROSWAP_API_KEY;
    const p = new SoroswapProvider();
    expect((await p.health()).status).toBe('disabled');
  });

  test('health is healthy once SOROSWAP_API_KEY is set', async () => {
    process.env.SOROSWAP_API_KEY = 'sk_test';
    const p = new SoroswapProvider();
    expect((await p.health()).status).toBe('healthy');
  });

  test('getQuote throws without a key', async () => {
    delete process.env.SOROSWAP_API_KEY;
    const p = new SoroswapProvider();
    await expect(
      p.getQuote({ assetIn: ASSET_IN, assetOut: ASSET_OUT, amount: '10000000' }),
    ).rejects.toThrow(/SOROSWAP_API_KEY/);
  });

  test('getQuote POSTs /quote and parses the route', async () => {
    process.env.SOROSWAP_API_KEY = 'sk_test';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        assetIn: ASSET_IN,
        assetOut: ASSET_OUT,
        amountIn: '10000000',
        amountOut: '9990000',
        priceImpactPct: '0.1',
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new SoroswapProvider();
    const q = await p.getQuote({ assetIn: ASSET_IN, assetOut: ASSET_OUT, amount: '10000000' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/quote');
    expect(q.amountOut).toBe('9990000');
    expect(q.tradeType).toBe('EXACT_IN');
    expect(q._rawQuote).toBeDefined();
  });

  test('prepareSwap returns the UNSIGNED xdr (Astryum never signs)', async () => {
    process.env.SOROSWAP_API_KEY = 'sk_test';
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ xdr: 'AAAA_unsigned_envelope' }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const p = new SoroswapProvider();
    const quote = {
      assetIn: ASSET_IN,
      assetOut: ASSET_OUT,
      amountIn: '1',
      amountOut: '1',
      tradeType: 'EXACT_IN' as const,
      protocols: ['sdex'],
      priceImpactPct: null,
      fee: { bps: 30, referralId: '' },
      source: { providerId: 'soroswap', fetchedAt: '' },
      _rawQuote: { foo: 'bar' },
    };

    const res = await p.prepareSwap({ quote, from: WALLET });

    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/build');
    expect(res.xdr).toBe('AAAA_unsigned_envelope');
    expect(res.fee.disclosed).toBe(true);
  });
});

import { LiFiProvider } from '../LiFiProvider';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.LIFI_FEE_BPS;
  delete process.env.LIFI_API_KEY;
  delete process.env.ASTRYUM_FEE_WALLET;
});

function mockOkJson(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function mockHttpError(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(`error ${status}`),
  } as unknown as Response);
}

const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

describe('LiFiProvider', () => {
  describe('health()', () => {
    it('returns healthy on successful /chains ping', async () => {
      mockOkJson({ chains: [{ id: 1 }, { id: 137 }] });
      const provider = new LiFiProvider();
      const h = await provider.health();
      expect(h.status).toBe('healthy');
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded on HTTP error', async () => {
      mockHttpError(503);
      const provider = new LiFiProvider();
      const h = await provider.health();
      expect(h.status).toBe('degraded');
      expect(h.reason).toMatch(/503/);
    });

    it('returns down on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const provider = new LiFiProvider();
      const h = await provider.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ECONNREFUSED/);
    });
  });

  describe('supportsChain()', () => {
    it('returns true for supported EVM chains', () => {
      const provider = new LiFiProvider();
      expect(provider.supportsChain(1)).toBe(true);       // Ethereum
      expect(provider.supportsChain(42161)).toBe(true);   // Arbitrum
      expect(provider.supportsChain(8453)).toBe(true);    // Base
      expect(provider.supportsChain(137)).toBe(true);     // Polygon
    });

    it('returns false for Flare (14) — use internal adapters', () => {
      const provider = new LiFiProvider();
      expect(provider.supportsChain(14)).toBe(false);
    });

    it('returns false for Solana (use JupiterSwapProvider)', () => {
      const provider = new LiFiProvider();
      expect(provider.supportsChain(999)).toBe(false);
    });
  });

  describe('getQuote()', () => {
    const quoteParams = {
      fromChain: 1,
      toChain: 42161,
      fromToken: USDC_ETH,
      toToken: USDC_ARB,
      fromAmount: '1000000000', // 1000 USDC
      fromAddress: '0xUserWallet000000000000000000000000000001',
    };

    const mockQuoteBody = {
      id: 'quote-abc123',
      type: 'lifi',
      tool: 'stargate',
      estimate: {
        fromAmount: '1000000000',
        toAmount: '998500000',
        toAmountMin: '993507500',
        priceImpact: '0.001',
        executionDuration: 20,
        gasCosts: [{ estimate: '50000' }],
      },
      transactionRequest: {
        from: '0xUserWallet000000000000000000000000000001',
        to: '0xLiFiDiamond0000000000000000000000000001',
        data: '0xdeadbeef',
        value: '0x0',
        gasLimit: '400000',
      },
    };

    it('returns quote with fee disclosure', async () => {
      process.env.ASTRYUM_FEE_WALLET = '0xFeeWallet000000000000000000000000000001';
      process.env.LIFI_FEE_BPS = '15';
      mockOkJson(mockQuoteBody);

      const provider = new LiFiProvider();
      const result = await provider.getQuote(quoteParams);

      expect(result.id).toBe('quote-abc123');
      expect(result.tool).toBe('stargate');
      expect(result.fromChain).toBe(1);
      expect(result.toChain).toBe(42161);
      expect(result.toAmount).toBe('998500000');
      expect(result.toAmountMin).toBe('993507500');
      expect(result.tx.to).toBe('0xLiFiDiamond0000000000000000000000000001');
      expect(result.tx.data).toBe('0xdeadbeef');
      expect(result.tx.chainId).toBe(1);
      expect(result.fee.bps).toBe(15);
      expect(result.fee.recipientWallet).toBe('0xFeeWallet000000000000000000000000000001');
      expect(result.fee.disclosed).toBe(true);
    });

    it('uses default fee of 15 bps when env not set', async () => {
      mockOkJson(mockQuoteBody);
      const provider = new LiFiProvider();
      const result = await provider.getQuote(quoteParams);
      expect(result.fee.bps).toBe(15);
    });

    it('embeds integrator=astryum and fee in query string', async () => {
      process.env.LIFI_FEE_BPS = '15';
      mockOkJson(mockQuoteBody);
      const provider = new LiFiProvider();
      await provider.getQuote(quoteParams);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('integrator=astryum');
      expect(calledUrl).toContain('fee=0.0015');
    });

    it('throws for Flare fromChain=14 with helpful message', async () => {
      const provider = new LiFiProvider();
      await expect(
        provider.getQuote({ ...quoteParams, fromChain: 14 }),
      ).rejects.toThrow(/Flare/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws for Flare toChain=14', async () => {
      const provider = new LiFiProvider();
      await expect(
        provider.getQuote({ ...quoteParams, toChain: 14 }),
      ).rejects.toThrow(/Flare/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('propagates HTTP errors', async () => {
      mockHttpError(400);
      const provider = new LiFiProvider();
      await expect(provider.getQuote(quoteParams)).rejects.toThrow(/HTTP 400/);
    });

    it('uses LIFI_API_KEY header when set', async () => {
      process.env.LIFI_API_KEY = 'my-api-key-123';
      mockOkJson(mockQuoteBody);
      const provider = new LiFiProvider();
      await provider.getQuote(quoteParams);
      const calledHeaders = mockFetch.mock.calls[0][1]?.headers as Record<string, string>;
      expect(calledHeaders['x-lifi-api-key']).toBe('my-api-key-123');
    });

    it('same-chain swap (toChain === fromChain) is allowed', async () => {
      mockOkJson({ ...mockQuoteBody, type: 'swap' });
      const provider = new LiFiProvider();
      const result = await provider.getQuote({ ...quoteParams, toChain: 1 });
      expect(result.fromChain).toBe(1);
      expect(result.toChain).toBe(1);
    });
  });

  describe('getRoutes()', () => {
    const routesParams = {
      fromChainId: 1,
      toChainId: 42161,
      fromTokenAddress: USDC_ETH,
      toTokenAddress: USDC_ARB,
      fromAmount: '1000000000',
      fromAddress: '0xUserWallet000000000000000000000000000001',
    };

    it('returns routes list with bestRoute', async () => {
      mockOkJson({
        routes: [
          {
            id: 'route-1',
            fromAmount: '1000000000',
            toAmount: '999000000',
            toAmountMin: '994000000',
            gasCostUSD: '2.50',
            steps: [{ tool: 'stargate', type: 'cross', action: { fromChainId: 1, toChainId: 42161 } }],
          },
          {
            id: 'route-2',
            fromAmount: '1000000000',
            toAmount: '997000000',
            toAmountMin: '992000000',
            gasCostUSD: '1.80',
            steps: [{ tool: 'hop', type: 'cross', action: { fromChainId: 1, toChainId: 42161 } }],
          },
        ],
      });

      const provider = new LiFiProvider();
      const result = await provider.getRoutes(routesParams);

      expect(result.routes).toHaveLength(2);
      expect(result.bestRoute).not.toBeNull();
      expect(result.bestRoute?.id).toBe('route-1');
      expect(result.routes[0].steps[0].tool).toBe('stargate');
      expect(result.source.providerId).toBe('lifi');
    });

    it('returns empty routes and null bestRoute when API returns none', async () => {
      mockOkJson({ routes: [] });
      const provider = new LiFiProvider();
      const result = await provider.getRoutes(routesParams);
      expect(result.routes).toHaveLength(0);
      expect(result.bestRoute).toBeNull();
    });

    it('throws for unsupported chains', async () => {
      const provider = new LiFiProvider();
      await expect(
        provider.getRoutes({ ...routesParams, fromChainId: 14 }),
      ).rejects.toThrow(/not supported/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('embeds integrator and fee in POST body', async () => {
      process.env.LIFI_FEE_BPS = '15';
      mockOkJson({ routes: [] });
      const provider = new LiFiProvider();
      await provider.getRoutes(routesParams);
      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.integrator).toBe('astryum');
      expect(callBody.fee).toBeCloseTo(0.0015);
      expect(callBody.options.fee).toBeCloseTo(0.0015);
    });

    it('propagates HTTP errors', async () => {
      mockHttpError(422);
      const provider = new LiFiProvider();
      await expect(provider.getRoutes(routesParams)).rejects.toThrow(/HTTP 422/);
    });
  });

  describe('prepareIntent()', () => {
    it('returns IntentPayload with astryumRelays:false', async () => {
      process.env.ASTRYUM_FEE_WALLET = '0xFeeWallet000000000000000000000000000001';
      mockOkJson({
        id: 'q1',
        type: 'lifi',
        tool: 'stargate',
        estimate: {
          fromAmount: '1000000000',
          toAmount: '998500000',
          toAmountMin: '993507500',
          priceImpact: '0.001',
          executionDuration: 20,
        },
        transactionRequest: {
          from: '0xUser',
          to: '0xLiFi',
          data: '0xintentdata',
          value: '0x0',
          gasLimit: '400000',
        },
      });

      const provider = new LiFiProvider();
      const intent = await provider.prepareIntent({
        fromChain: 1,
        toChain: 42161,
        fromToken: USDC_ETH,
        toToken: USDC_ARB,
        fromAmount: '1000000000',
        fromAddress: '0xUser',
      });

      expect(intent.intentId).toBeTruthy();
      expect(intent.status).toBe('pending_user_review');
      expect(intent.tx.chainId).toBe(1);
      expect(intent.tx.data).toBe('0xintentdata');
      expect(intent.authorization.astryumRelays).toBe(false);
      expect(intent.authorization.userMustAuthorize).toBe(true);
      expect(intent.referralAttribution.disclosedToUser).toBe(true);
      expect(intent.metadata.action).toBe('bridge'); // cross-chain
      expect(intent.metadata.protocol).toContain('lifi:stargate');
      expect(intent.expiry.ttlSeconds).toBe(300);
    });

    it('sets action=swap when same-chain', async () => {
      mockOkJson({
        id: 'q2',
        type: 'swap',
        tool: 'uniswap-v3',
        estimate: { fromAmount: '1000000000', toAmount: '998000000', toAmountMin: '993000000' },
        transactionRequest: { from: '0xUser', to: '0xRouter', data: '0xswapdata', value: '0x0', gasLimit: '200000' },
      });

      const provider = new LiFiProvider();
      const intent = await provider.prepareIntent({
        fromChain: 1,
        toChain: 1,
        fromToken: USDC_ETH,
        toToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        fromAmount: '1000000000',
        fromAddress: '0xUser',
      });

      expect(intent.metadata.action).toBe('swap');
    });
  });

  describe('call() dispatcher', () => {
    it('swap.getQuote routes to getQuote()', async () => {
      mockOkJson({
        id: 'q1',
        type: 'swap',
        tool: 'uniswap-v3',
        estimate: { fromAmount: '1000', toAmount: '990', toAmountMin: '985' },
        transactionRequest: { from: '0xU', to: '0xR', data: '0x', value: '0x0', gasLimit: '200000' },
      });

      const provider = new LiFiProvider();
      const result = await provider.call<unknown, unknown>(
        'swap.getQuote',
        {
          fromChain: 1, toChain: 1,
          fromToken: USDC_ETH, toToken: '0xWETH',
          fromAmount: '1000', fromAddress: '0xUser',
        },
        { traceId: 'trace-lifi' },
      );
      expect((result.data as any).tool).toBe('uniswap-v3');
      expect(result.source.providerId).toBe('lifi');
      expect(result.source.traceId).toBe('trace-lifi');
    });

    it('bridge.getRoute routes to getRoutes()', async () => {
      mockOkJson({ routes: [] });
      const provider = new LiFiProvider();
      const result = await provider.call<unknown, unknown>(
        'bridge.getRoute',
        {
          fromChainId: 1, toChainId: 42161,
          fromTokenAddress: USDC_ETH, toTokenAddress: USDC_ARB,
          fromAmount: '1000', fromAddress: '0xUser',
        },
        { traceId: 'trace-bridge' },
      );
      expect((result.data as any).routes).toHaveLength(0);
      expect((result.data as any).bestRoute).toBeNull();
    });

    it('throws on unknown capability', async () => {
      const provider = new LiFiProvider();
      await expect(
        provider.call('bridge.unknown', {}, { traceId: 'x' }),
      ).rejects.toThrow(/unsupported capability/);
    });
  });
});

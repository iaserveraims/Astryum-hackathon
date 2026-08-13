import { EnsoProvider } from '../EnsoProvider';

// Isolates EnsoProvider from real network — all fetch calls are mocked.

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.ENSO_API_KEY;
  delete process.env.ENSO_FEE_BPS;
  delete process.env.ASTRYUM_FEE_WALLET;
  delete process.env.ASTRYUM_ENSO_REFERRAL_CODE;
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

describe('EnsoProvider', () => {
  describe('health()', () => {
    it('returns disabled when ENSO_API_KEY not set', async () => {
      const provider = new EnsoProvider();
      const h = await provider.health();
      expect(h.status).toBe('disabled');
      expect(h.reason).toMatch(/ENSO_API_KEY/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns healthy on successful protocols fetch', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockOkJson([{ slug: 'aave-v3' }]);
      const provider = new EnsoProvider();
      const h = await provider.health();
      expect(h.status).toBe('healthy');
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded on HTTP error', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockHttpError(503);
      const provider = new EnsoProvider();
      const h = await provider.health();
      expect(h.status).toBe('degraded');
      expect(h.reason).toMatch(/503/);
    });

    it('returns down on network error', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const provider = new EnsoProvider();
      const h = await provider.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ECONNREFUSED/);
    });
  });

  describe('canHandle()', () => {
    it('returns false when API key not set', async () => {
      const provider = new EnsoProvider();
      const result = await provider.canHandle('aave-v3', 1, 'deposit');
      expect(result).toBe(false);
    });

    it('returns false for Flare chainId=14 (use internal adapters)', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      const provider = new EnsoProvider();
      const result = await provider.canHandle('kinetic', 14, 'supply');
      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns true when protocol is in supported list', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockOkJson([{ slug: 'aave-v3' }, { slug: 'compound-v3' }, { slug: 'uniswap-v3' }]);
      const provider = new EnsoProvider();
      const result = await provider.canHandle('aave-v3', 1, 'deposit');
      expect(result).toBe(true);
    });

    it('returns false when protocol is not in supported list', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockOkJson([{ slug: 'aave-v3' }, { slug: 'compound-v3' }]);
      const provider = new EnsoProvider();
      const result = await provider.canHandle('unknown-protocol', 1, 'deposit');
      expect(result).toBe(false);
    });

    it('returns false on network error (graceful degradation)', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      const provider = new EnsoProvider();
      const result = await provider.canHandle('aave-v3', 1, 'deposit');
      expect(result).toBe(false);
    });

    it('caches protocols list and reuses across calls', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockOkJson([{ slug: 'aave-v3' }]);
      const provider = new EnsoProvider();
      await provider.canHandle('aave-v3', 1, 'deposit');
      await provider.canHandle('compound-v3', 1, 'deposit');
      // Should only call fetch once (second call uses cache)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getRoute()', () => {
    const routeParams = {
      chainId: 1,
      fromAddress: '0xUser0000000000000000000000000000000000001',
      tokenIn: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      tokenOut: '0x0000000000000000000000000000000000000000', // ETH
      amountIn: '1000000000', // 1000 USDC
    };

    it('throws when ENSO_API_KEY not set', async () => {
      const provider = new EnsoProvider();
      await expect(provider.getRoute(routeParams)).rejects.toThrow(/ENSO_API_KEY/);
    });

    it('throws for Flare chainId=14', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      const provider = new EnsoProvider();
      await expect(provider.getRoute({ ...routeParams, chainId: 14 })).rejects.toThrow(/not supported/);
    });

    it('returns route result with fee disclosure', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      process.env.ASTRYUM_FEE_WALLET = '0xFeeWallet0000000000000000000000000000000';
      process.env.ENSO_FEE_BPS = '15';

      mockOkJson({
        tx: { to: '0xEnsoRouter', data: '0xabcdef', value: '0', gas: '200000' },
        amountOut: '500000000000000000',
        priceImpact: 0.12,
      });

      const provider = new EnsoProvider();
      const result = await provider.getRoute(routeParams);

      expect(result.tx.to).toBe('0xEnsoRouter');
      expect(result.tx.data).toBe('0xabcdef');
      expect(result.amountOut).toBe('500000000000000000');
      expect(result.priceImpact).toBe(0.12);
      expect(result.fee.bps).toBe(15);
      expect(result.fee.recipientWallet).toBe('0xFeeWallet0000000000000000000000000000000');

      // Verify fee was sent in query string
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('fee=');
      expect(calledUrl).toContain('0xFeeWallet');
    });

    it('propagates API errors', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockHttpError(400);
      const provider = new EnsoProvider();
      await expect(provider.getRoute(routeParams)).rejects.toThrow(/HTTP 400/);
    });
  });

  describe('getBundleCalldata()', () => {
    const bundleParams = {
      chainId: 1,
      fromAddress: '0xUser0000000000000000000000000000000000001',
      actions: [
        {
          protocol: 'aave-v3',
          action: 'deposit',
          tokenIn: ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
          tokenOut: ['0xBcca60bB61934080951369a648Fb03DF4F96263C'],
          amountIn: ['1000000000'],
        },
        {
          protocol: 'aave-v3',
          action: 'borrow',
          tokenIn: ['0xBcca60bB61934080951369a648Fb03DF4F96263C'],
          tokenOut: ['0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
          amountIn: ['500000000000000000'],
        },
      ],
    };

    it('throws when ENSO_API_KEY not set', async () => {
      const provider = new EnsoProvider();
      await expect(provider.getBundleCalldata(bundleParams)).rejects.toThrow(/ENSO_API_KEY/);
    });

    it('throws for empty actions array', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      const provider = new EnsoProvider();
      await expect(provider.getBundleCalldata({ ...bundleParams, actions: [] })).rejects.toThrow(/at least one action/);
    });

    it('returns bundle result with correct bundleSize', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      process.env.ASTRYUM_FEE_WALLET = '0xFeeWallet0000000000000000000000000000000';

      mockOkJson({
        tx: { to: '0xEnsoBundle', data: '0xbundledata', value: '0', gas: '450000' },
      });

      const provider = new EnsoProvider();
      const result = await provider.getBundleCalldata(bundleParams);

      expect(result.tx.to).toBe('0xEnsoBundle');
      expect(result.tx.data).toBe('0xbundledata');
      expect(result.bundleSize).toBe(2);
      expect(result.fee.bps).toBe(15); // default

      // Verify POST body contains actions and fee
      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.actions).toHaveLength(2);
      expect(callBody.fee).toBeDefined();
      expect(callBody.fromAddress).toBe(bundleParams.fromAddress);
    });
  });

  describe('prepareBundle()', () => {
    it('returns valid IntentPayload with astryumRelays:false', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      process.env.ASTRYUM_FEE_WALLET = '0xFeeWallet0000000000000000000000000000000';

      mockOkJson({
        tx: { to: '0xEnsoRouter', data: '0xcalldata', value: '0', gas: '300000' },
      });

      const provider = new EnsoProvider();
      const intent = await provider.prepareBundle({
        chainId: 1,
        fromAddress: '0xUser',
        actions: [
          {
            protocol: 'aave-v3',
            action: 'deposit',
            tokenIn: ['0xUsdc'],
            tokenOut: ['0xAUsdc'],
            amountIn: ['1000000000'],
          },
        ],
      });

      expect(intent.intentId).toBeTruthy();
      expect(intent.status).toBe('pending_user_review');
      expect(intent.tx.chainId).toBe(1);
      expect(intent.tx.data).toBe('0xcalldata');
      expect(intent.authorization.astryumRelays).toBe(false);
      expect(intent.authorization.userMustAuthorize).toBe(true);
      expect(intent.referralAttribution.disclosedToUser).toBe(true);
      expect(intent.metadata.protocol).toBe('enso');
      expect(intent.metadata.preparedBy).toBe('astryum');
      expect(intent.expiry.ttlSeconds).toBe(300);
    });
  });

  describe('resolveIntent()', () => {
    it('builds EnsoBundleParams from pool descriptor', () => {
      const provider = new EnsoProvider();
      const params = provider.resolveIntent(
        {
          protocol: 'aave-v3',
          chainId: 1,
          tokenIn: '0xUsdc',
          tokenOut: '0xAUsdc',
          action: 'deposit',
        },
        '0xUserWallet',
        '1000000000',
      );
      expect(params.chainId).toBe(1);
      expect(params.fromAddress).toBe('0xUserWallet');
      expect(params.actions).toHaveLength(1);
      expect(params.actions[0].protocol).toBe('aave-v3');
      expect(params.actions[0].amountIn).toEqual(['1000000000']);
    });
  });

  describe('call() dispatcher', () => {
    it('defi.canHandle routes to canHandle()', async () => {
      process.env.ENSO_API_KEY = 'test-key';
      mockOkJson([{ slug: 'aave-v3' }]);
      const provider = new EnsoProvider();
      const result = await provider.call<unknown, boolean>(
        'defi.canHandle',
        { protocol: 'aave-v3', chainId: 1, action: 'deposit' },
        { traceId: 'test-trace' },
      );
      expect(result.data).toBe(true);
      expect(result.source.providerId).toBe('enso');
      expect(result.source.traceId).toBe('test-trace');
    });

    it('throws on unknown capability', async () => {
      const provider = new EnsoProvider();
      await expect(
        provider.call('defi.unknown', {}, { traceId: 'x' }),
      ).rejects.toThrow(/unsupported capability/);
    });
  });
});

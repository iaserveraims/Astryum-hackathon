/**
 * MoonPayTradeProvider — unit tests (FASE 8)
 * All HTTP calls mocked. B2B gate tested via env vars.
 */

import { MoonPayTradeProvider } from '../MoonPayTradeProvider';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function okJson(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response);
}

function httpError(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(`error ${status}`),
  } as unknown as Response);
}

function ctx() {
  return { traceId: 'test-moonpay-trade', wallet: '0xUser' };
}

function enableProvider() {
  process.env.MOONPAY_TRADE_API_KEY = 'test-b2b-key';
  process.env.MOONPAY_TRADE_ENABLED = 'true';
  process.env.DEFIBRO_FEE_WALLET = '0xFeeWallet';
}

afterEach(() => {
  mockFetch.mockReset();
  delete process.env.MOONPAY_TRADE_API_KEY;
  delete process.env.MOONPAY_TRADE_ENABLED;
  delete process.env.MOONPAY_TRADE_FEE_BPS;
  delete process.env.DEFIBRO_FEE_WALLET;
});

const mockQuoteResponse = {
  quoteId: 'qt-abc-123',
  fromAmount: '1000000000000000000',
  toToken: null,
  toAmount: null,
  estimatedApy: 0.045,
  gasCostUSD: '4.20',
  priceImpactBps: null,
  validUntil: '2099-01-01T00:00:00.000Z',
  tx: {
    to: '0xAavePool',
    data: '0xdeadbeef01',
    value: '0',
    gasLimit: '250000',
  },
};

describe('MoonPayTradeProvider', () => {
  describe('id and capabilities', () => {
    const provider = new MoonPayTradeProvider();
    it('has correct id', () => expect(provider.id).toBe('moonpay-trade'));
    it('includes defi.getQuote', () => expect(provider.capabilities).toContain('defi.getQuote'));
    it('includes defi.prepareExecution', () => expect(provider.capabilities).toContain('defi.prepareExecution'));
  });

  describe('health() — disabled when env vars not set', () => {
    it('returns disabled status without API key', async () => {
      const provider = new MoonPayTradeProvider();
      const h = await provider.health();
      expect(h.status).toBe('disabled');
      expect(h.reason).toMatch(/MOONPAY_TRADE_API_KEY/);
    });

    it('returns disabled when key set but ENABLED not true', async () => {
      process.env.MOONPAY_TRADE_API_KEY = 'key';
      // MOONPAY_TRADE_ENABLED not set
      const provider = new MoonPayTradeProvider();
      const h = await provider.health();
      expect(h.status).toBe('disabled');
    });

    it('returns healthy when enabled and API responds', async () => {
      enableProvider();
      okJson({ status: 'ok' });
      const provider = new MoonPayTradeProvider();
      const h = await provider.health();
      expect(h.status).toBe('healthy');
    });

    it('returns degraded on HTTP error', async () => {
      enableProvider();
      httpError(503);
      const provider = new MoonPayTradeProvider();
      const h = await provider.health();
      expect(h.status).toBe('degraded');
    });
  });

  describe('getQuote() — B2B gate', () => {
    it('throws when not enabled', async () => {
      const provider = new MoonPayTradeProvider();
      await expect(
        provider.getQuote({
          protocol: 'aave_v3',
          action: 'supply',
          chainId: 1,
          fromToken: '0xUSDC',
          fromAmount: '1000000000000000000',
          walletAddress: '0xUser',
        }),
      ).rejects.toThrow(/not enabled/);
    });

    it('throws when ENABLED=true but no API key', async () => {
      process.env.MOONPAY_TRADE_ENABLED = 'true';
      const provider = new MoonPayTradeProvider();
      await expect(
        provider.getQuote({
          protocol: 'aave_v3',
          action: 'supply',
          chainId: 1,
          fromToken: '0xUSDC',
          fromAmount: '1000000000000000000',
          walletAddress: '0xUser',
        }),
      ).rejects.toThrow(/not enabled/);
    });

    it('returns quote when enabled and API responds', async () => {
      enableProvider();
      okJson(mockQuoteResponse);
      const provider = new MoonPayTradeProvider();
      const result = await provider.getQuote({
        protocol: 'aave_v3',
        action: 'supply',
        chainId: 1,
        fromToken: '0xUSDC',
        fromAmount: '1000000000000000000',
        walletAddress: '0xUser',
      });

      expect(result.quoteId).toBe('qt-abc-123');
      expect(result.estimatedApy).toBeCloseTo(0.045);
      expect(result.tx.to).toBe('0xAavePool');
      expect(result.fee.disclosed).toBe(true);
      expect(result.fee.bps).toBe(20);  // default
    });

    it('respects MOONPAY_TRADE_FEE_BPS env var', async () => {
      enableProvider();
      process.env.MOONPAY_TRADE_FEE_BPS = '30';
      okJson(mockQuoteResponse);
      const provider = new MoonPayTradeProvider();
      const result = await provider.getQuote({
        protocol: 'morpho_blue', action: 'supply', chainId: 1,
        fromToken: '0xUSDC', fromAmount: '500000000', walletAddress: '0xUser',
      });
      expect(result.fee.bps).toBe(30);
    });

    it('throws on HTTP error', async () => {
      enableProvider();
      httpError(401);
      const provider = new MoonPayTradeProvider();
      await expect(
        provider.getQuote({
          protocol: 'aave_v3', action: 'borrow', chainId: 42161,
          fromToken: '0xWETH', fromAmount: '1000000000000000000', walletAddress: '0xUser',
        }),
      ).rejects.toThrow(/HTTP 401/);
    });
  });

  describe('prepareExecution()', () => {
    it('returns IntentPayload with correct fields', async () => {
      enableProvider();
      okJson(mockQuoteResponse);
      const provider = new MoonPayTradeProvider();
      const intent = await provider.prepareExecution({
        protocol: 'aave_v3',
        action: 'supply',
        chainId: 1,
        fromToken: '0xUSDC',
        fromAmount: '1000000000000000000',
        walletAddress: '0xUser',
      });

      expect(intent.intentId).toBeDefined();
      expect(intent.status).toBe('pending_user_review');
      expect(intent.tx.to).toBe('0xAavePool');
      expect(intent.authorization.defibroRelays).toBe(false);
      expect(intent.authorization.userMustAuthorize).toBe(true);
      expect(intent.referralAttribution.disclosedToUser).toBe(true);
      expect(intent.metadata.protocol).toContain('moonpay-trade:aave_v3');
      expect(intent.metadata.description).toContain('4.50%');  // estimatedApy formatted
    });
  });

  describe('call() dispatcher', () => {
    it('routes defi.getQuote', async () => {
      enableProvider();
      okJson(mockQuoteResponse);
      const provider = new MoonPayTradeProvider();
      const result = await provider.call('defi.getQuote', {
        protocol: 'morpho_blue', action: 'supply', chainId: 1,
        fromToken: '0xUSDC', fromAmount: '1e18', walletAddress: '0xUser',
      }, ctx());
      expect(result.source.providerId).toBe('moonpay-trade');
    });

    it('throws on unknown capability', async () => {
      const provider = new MoonPayTradeProvider();
      await expect(
        provider.call('swap.getQuote', {}, ctx()),
      ).rejects.toThrow(/unsupported capability/);
    });
  });
});

/**
 * F8SwapProviders — unit tests
 * Covers SquidRouterProvider and CoWSwapProvider (FASE 8).
 * All HTTP calls are mocked — no network required.
 */

import { SquidRouterProvider } from '../SquidRouterProvider';
import { CoWSwapProvider } from '../CoWSwapProvider';

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

function netError(msg = 'ECONNREFUSED') {
  mockFetch.mockRejectedValueOnce(new Error(msg));
}

function ctx() {
  return { traceId: 'test-trace-f8', wallet: '0xUser' };
}

afterEach(() => {
  mockFetch.mockReset();
  delete process.env.SQUID_FEE_BPS;
  delete process.env.SQUID_INTEGRATOR_ID;
  delete process.env.DEFIBRO_FEE_WALLET;
  delete process.env.DEFIBRO_COW_APP_CODE;
});

// ─── SquidRouterProvider ───────────────────────────────────────────────────────

describe('SquidRouterProvider', () => {
  const provider = new SquidRouterProvider();

  describe('id and capabilities', () => {
    it('has correct id', () => expect(provider.id).toBe('squid'));
    it('includes swap.getQuote', () => expect(provider.capabilities).toContain('swap.getQuote'));
    it('includes swap.prepareSwap', () => expect(provider.capabilities).toContain('swap.prepareSwap'));
    it('includes bridge.getRoute', () => expect(provider.capabilities).toContain('bridge.getRoute'));
    it('includes bridge.getDepositStatus', () => expect(provider.capabilities).toContain('bridge.getDepositStatus'));
  });

  describe('supportsChain()', () => {
    it('true for ETH (1)', () => expect(provider.supportsChain(1)).toBe(true));
    it('true for Polygon (137)', () => expect(provider.supportsChain(137)).toBe(true));
    it('true for Arbitrum (42161)', () => expect(provider.supportsChain(42161)).toBe(true));
    it('true for Base (8453)', () => expect(provider.supportsChain(8453)).toBe(true));
    it('false for Flare (14) — use internal adapters', () => expect(provider.supportsChain(14)).toBe(false));
    it('false for unlisted chain (99999)', () => expect(provider.supportsChain(99999)).toBe(false));
  });

  describe('health()', () => {
    it('healthy on successful /v2/chains ping', async () => {
      okJson({ chains: [{ chainId: '1' }, { chainId: '137' }] });
      const h = await provider.health();
      expect(h.status).toBe('healthy');
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('degraded on HTTP error', async () => {
      httpError(503);
      const h = await provider.health();
      expect(h.status).toBe('degraded');
      expect(h.reason).toMatch(/503/);
    });

    it('down on network error', async () => {
      netError('ECONNREFUSED');
      const h = await provider.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ECONNREFUSED/);
    });
  });

  describe('getQuote()', () => {
    const baseParams = {
      fromAddress: '0xUserWallet',
      fromChain: 1,
      fromToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC ETH
      fromAmount: '1000000',  // 1 USDC
      toChain: 137,
      toToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',   // USDC Polygon
    };

    const mockRouteResponse = {
      route: {
        estimate: {
          fromAmount: '1000000',
          toAmount: '990000',
          toAmountMin: '985000',
          sendAmount: '1000000',
          exchangeRate: '0.99',
          aggregatePriceImpact: '0.001',
          aggregateSlippage: '0.015',
          estimatedRouteDuration: 180,
          feeCosts: [{ name: 'bridge_fee', amount: '5000', amountUSD: '0.005', token: { symbol: 'USDC', decimals: 6 } }],
          gasCosts: [{ type: 'SEND', amount: '0.002', amountUSD: '3.5', token: { symbol: 'ETH', decimals: 18 } }],
        },
        transactionRequest: {
          targetAddress: '0xSquidRouter',
          data: '0xdeadbeef',
          value: '0',
          gasLimit: '450000',
          gasPrice: '20000000000',
        },
      },
    };

    it('parses Squid route response correctly', async () => {
      okJson(mockRouteResponse);
      const result = await provider.getQuote(baseParams);

      expect(result.fromChain).toBe(1);
      expect(result.toChain).toBe(137);
      expect(result.toAmount).toBe('990000');
      expect(result.toAmountMin).toBe('985000');
      expect(result.estimatedDuration).toBe(180);
      expect(result.tx).not.toBeNull();
      expect(result.tx!.to).toBe('0xSquidRouter');
      expect(result.tx!.data).toBe('0xdeadbeef');
      expect(result.tx!.chainId).toBe(1);
    });

    it('includes fee metadata (disclosed)', async () => {
      okJson(mockRouteResponse);
      const result = await provider.getQuote(baseParams);

      expect(result.fee.disclosed).toBe(true);
      expect(result.fee.bps).toBe(15);  // default
    });

    it('respects SQUID_FEE_BPS env var', async () => {
      process.env.SQUID_FEE_BPS = '25';
      okJson(mockRouteResponse);
      const result = await provider.getQuote(baseParams);
      expect(result.fee.bps).toBe(25);
    });

    it('throws when fromChain is Flare (14)', async () => {
      await expect(
        provider.getQuote({ ...baseParams, fromChain: 14 }),
      ).rejects.toThrow(/not supported/);
    });

    it('throws when toChain is Flare (14)', async () => {
      await expect(
        provider.getQuote({ ...baseParams, toChain: 14 }),
      ).rejects.toThrow(/not supported/);
    });

    it('throws on HTTP error from Squid API', async () => {
      httpError(429);
      await expect(provider.getQuote(baseParams)).rejects.toThrow(/HTTP 429/);
    });

    it('tx is null when quoteOnly=true', async () => {
      okJson({ route: { estimate: mockRouteResponse.route.estimate, transactionRequest: null } });
      const result = await provider.getQuote({ ...baseParams, quoteOnly: true });
      expect(result.tx).toBeNull();
    });
  });

  describe('getStatus()', () => {
    it('parses status response', async () => {
      okJson({ status: 'success', toChainTxHash: '0xABC123' });
      const result = await provider.getStatus({ txHash: '0xDEF', fromChainId: 1, toChainId: 137 });
      expect(result.status).toBe('success');
      expect(result.toChainTxHash).toBe('0xABC123');
    });

    it('handles not_found status', async () => {
      okJson({ status: 'not_found' });
      const result = await provider.getStatus({ txHash: '0x000', fromChainId: 1, toChainId: 137 });
      expect(result.status).toBe('not_found');
    });
  });

  describe('call() dispatcher', () => {
    it('routes swap.getQuote to getQuote()', async () => {
      okJson({ route: { estimate: { fromAmount: '100', toAmount: '99', toAmountMin: '98', estimatedRouteDuration: 60 }, transactionRequest: { targetAddress: '0x1', data: '0x', value: '0', gasLimit: '100000' } } });
      const result = await provider.call('swap.getQuote', {
        fromAddress: '0xUser', fromChain: 1, fromToken: '0xA', fromAmount: '100', toChain: 137, toToken: '0xB',
      }, ctx());
      expect(result.data).toBeDefined();
      expect(result.source.providerId).toBe('squid');
    });

    it('throws on unknown capability', async () => {
      await expect(
        provider.call('unknown.capability', {}, ctx()),
      ).rejects.toThrow(/unsupported capability/);
    });
  });
});

// ─── CoWSwapProvider ──────────────────────────────────────────────────────────

describe('CoWSwapProvider', () => {
  const provider = new CoWSwapProvider();

  describe('id and capabilities', () => {
    it('has correct id', () => expect(provider.id).toBe('cowswap'));
    it('includes swap.getQuote', () => expect(provider.capabilities).toContain('swap.getQuote'));
    it('includes swap.prepareSwap', () => expect(provider.capabilities).toContain('swap.prepareSwap'));
  });

  describe('supportsChain()', () => {
    it('true for Ethereum (1)', () => expect(provider.supportsChain(1)).toBe(true));
    it('true for Gnosis (100)', () => expect(provider.supportsChain(100)).toBe(true));
    it('true for Arbitrum (42161)', () => expect(provider.supportsChain(42161)).toBe(true));
    it('true for Base (8453)', () => expect(provider.supportsChain(8453)).toBe(true));
    it('false for Flare (14)', () => expect(provider.supportsChain(14)).toBe(false));
    it('false for Polygon (137) — not in CoW supported set', () => expect(provider.supportsChain(137)).toBe(false));
  });

  describe('health()', () => {
    it('healthy on successful /version ping', async () => {
      okJson({ version: '2.0.0' });
      const h = await provider.health();
      expect(h.status).toBe('healthy');
    });

    it('degraded on HTTP error', async () => {
      httpError(502);
      const h = await provider.health();
      expect(h.status).toBe('degraded');
      expect(h.reason).toMatch(/502/);
    });

    it('down on network error', async () => {
      netError('timeout');
      const h = await provider.health();
      expect(h.status).toBe('down');
    });
  });

  describe('getQuote()', () => {
    const baseParams = {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',  // USDC
      buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7',   // USDT
      sellAmountBeforeFee: '1000000',
      from: '0xUserWallet',
      chainId: 1,
    };

    const mockCowQuoteResponse = {
      id: 42,
      quote: {
        sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        receiver: '0xUserWallet',
        sellAmount: '999000',
        buyAmount: '998000',
        validTo: 1999999999,
        appData: '0xabc',
        feeAmount: '1000',
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        signingScheme: 'eip712',
      },
      expiration: '2099-01-01T00:00:00.000Z',
    };

    it('parses CoW quote response correctly', async () => {
      okJson(mockCowQuoteResponse);
      const result = await provider.getQuote(baseParams);

      expect(result.quoteId).toBe(42);
      expect(result.chainId).toBe(1);
      expect(result.sellAmount).toBe('999000');
      expect(result.buyAmount).toBe('998000');
      expect(result.feeAmount).toBe('1000');
      expect(result.order.signingScheme).toBe('eip712');
    });

    it('includes GPv2 contract addresses', async () => {
      okJson(mockCowQuoteResponse);
      const result = await provider.getQuote(baseParams);

      expect(result.vaultRelayer).toBe('0xC92E8bdf79f0507f65a392b0ab4667716BFE0110');
      expect(result.settlementContract).toBe('0x9008D19f58AAbD9eD0D60971565AA8510560ab41');
    });

    it('approvalNeeded=true for ERC-20 sellToken', async () => {
      okJson(mockCowQuoteResponse);
      const result = await provider.getQuote(baseParams);
      expect(result.approvalNeeded).toBe(true);
    });

    it('approvalNeeded=false for native ETH sellToken', async () => {
      okJson(mockCowQuoteResponse);
      const result = await provider.getQuote({
        ...baseParams,
        sellToken: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      });
      expect(result.approvalNeeded).toBe(false);
    });

    it('fee model is surplus_sharing (not BPS)', async () => {
      okJson(mockCowQuoteResponse);
      const result = await provider.getQuote(baseParams);
      expect(result.fee.model).toBe('surplus_sharing');
      expect(result.fee.disclosed).toBe(true);
    });

    it('throws when chainId is not supported', async () => {
      await expect(
        provider.getQuote({ ...baseParams, chainId: 137 }),
      ).rejects.toThrow(/not supported/);
    });

    it('throws when chainId is Flare (14)', async () => {
      await expect(
        provider.getQuote({ ...baseParams, chainId: 14 }),
      ).rejects.toThrow(/not supported/);
    });

    it('throws on HTTP error from CoW API', async () => {
      httpError(400);
      await expect(provider.getQuote(baseParams)).rejects.toThrow(/HTTP 400/);
    });
  });

  describe('prepareIntent()', () => {
    const baseParams = {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      buyToken: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      sellAmountBeforeFee: '1000000',
      from: '0xUserWallet',
      chainId: 1,
    };

    it('returns IntentPayload with approval tx for ERC-20', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: 1,
          quote: { sellToken: baseParams.sellToken, buyToken: baseParams.buyToken, receiver: baseParams.from, sellAmount: '999000', buyAmount: '998000', validTo: 9999999, appData: '0x', feeAmount: '1000', kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20', signingScheme: 'eip712' },
        }),
      } as unknown as Response);

      const intent = await provider.prepareIntent(baseParams);

      expect(intent.intentId).toBeDefined();
      expect(intent.status).toBe('pending_user_review');
      // ERC-20 approval tx targets the sell token contract
      expect(intent.tx.to.toLowerCase()).toBe(baseParams.sellToken.toLowerCase());
      expect(intent.tx.data).toMatch(/^0x095ea7b3/);  // approve() selector
      expect(intent.authorization.defibroRelays).toBe(false);
      expect(intent.authorization.userMustAuthorize).toBe(true);
      expect(intent.referralAttribution.disclosedToUser).toBe(true);
    });

    it('defibroRelays is always false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 2, quote: { sellToken: baseParams.sellToken, buyToken: baseParams.buyToken, receiver: baseParams.from, sellAmount: '999000', buyAmount: '998000', validTo: 9999999, appData: '0x', feeAmount: '1000', kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20', signingScheme: 'eip712' } }),
      } as unknown as Response);

      const intent = await provider.prepareIntent(baseParams);
      expect(intent.authorization.defibroRelays).toBe(false);
    });
  });

  describe('call() dispatcher', () => {
    it('routes swap.getQuote to getQuote()', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 1, quote: { sellToken: '0xA', buyToken: '0xB', receiver: '0xU', sellAmount: '100', buyAmount: '99', validTo: 9999999, appData: '0x', feeAmount: '1', kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20', signingScheme: 'eip712' } }),
      } as unknown as Response);

      const result = await provider.call('swap.getQuote', {
        sellToken: '0xA', buyToken: '0xB', sellAmountBeforeFee: '100', from: '0xU', chainId: 1,
      }, ctx());

      expect(result.data).toBeDefined();
      expect(result.source.providerId).toBe('cowswap');
    });

    it('throws on unknown capability', async () => {
      await expect(
        provider.call('defi.getRoute', {}, ctx()),
      ).rejects.toThrow(/unsupported capability/);
    });
  });
});

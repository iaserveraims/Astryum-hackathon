import { JupiterSwapProvider } from '../JupiterSwapProvider';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.JUPITER_FEE_BPS;
  delete process.env.JUPITER_FEE_ACCOUNT;
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

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describe('JupiterSwapProvider', () => {
  describe('health()', () => {
    it('returns healthy on successful quote ping', async () => {
      mockOkJson({ outAmount: '5000000', routePlan: [] });
      const provider = new JupiterSwapProvider();
      const h = await provider.health();
      expect(h.status).toBe('healthy');
      expect(h.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded on HTTP error', async () => {
      mockHttpError(503);
      const provider = new JupiterSwapProvider();
      const h = await provider.health();
      expect(h.status).toBe('degraded');
      expect(h.reason).toMatch(/503/);
    });

    it('returns down on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const provider = new JupiterSwapProvider();
      const h = await provider.health();
      expect(h.status).toBe('down');
      expect(h.reason).toMatch(/ECONNREFUSED/);
    });
  });

  describe('getQuote()', () => {
    const quoteParams = {
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: '1000000000', // 1 SOL in lamports
    };

    const mockQuoteBody = {
      inputMint: SOL_MINT,
      inAmount: '1000000000',
      outputMint: USDC_MINT,
      outAmount: '150000000',
      otherAmountThreshold: '149250000',
      slippageBps: 50,
      priceImpactPct: '0.01',
      platformFee: { amount: '300000', feeBps: 20 },
      routePlan: [{ swapInfo: {}, percent: 100 }],
      contextSlot: 999999,
    };

    it('returns quote with fee disclosure', async () => {
      process.env.JUPITER_FEE_ACCOUNT = 'AstryumFeeAccount11111111111111111111111111111';
      process.env.JUPITER_FEE_BPS = '20';
      mockOkJson(mockQuoteBody);

      const provider = new JupiterSwapProvider();
      const result = await provider.getQuote(quoteParams);

      expect(result.inputMint).toBe(SOL_MINT);
      expect(result.outputMint).toBe(USDC_MINT);
      expect(result.outAmount).toBe('150000000');
      expect(result.platformFee.feeBps).toBe(20);
      expect(result.platformFee.recipientAccount).toBe('AstryumFeeAccount11111111111111111111111111111');
      expect(result.routePlan).toHaveLength(1);
      expect(result.contextSlot).toBe(999999);
      expect(result._rawQuote).toBeDefined();
    });

    it('uses default fee of 20 bps when env not set', async () => {
      mockOkJson(mockQuoteBody);
      const provider = new JupiterSwapProvider();
      const result = await provider.getQuote(quoteParams);
      expect(result.platformFee.feeBps).toBe(20);
    });

    it('embeds platformFeeBps in query string', async () => {
      process.env.JUPITER_FEE_BPS = '25';
      mockOkJson(mockQuoteBody);
      const provider = new JupiterSwapProvider();
      await provider.getQuote(quoteParams);
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('platformFeeBps=25');
    });

    it('passes custom slippageBps', async () => {
      mockOkJson(mockQuoteBody);
      const provider = new JupiterSwapProvider();
      await provider.getQuote({ ...quoteParams, slippageBps: 100 });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('slippageBps=100');
    });

    it('propagates HTTP errors', async () => {
      mockHttpError(429);
      const provider = new JupiterSwapProvider();
      await expect(provider.getQuote(quoteParams)).rejects.toThrow(/HTTP 429/);
    });
  });

  describe('prepareSwap()', () => {
    const mockRawQuote = {
      inputMint: SOL_MINT,
      inAmount: '1000000000',
      outputMint: USDC_MINT,
      outAmount: '150000000',
      otherAmountThreshold: '149250000',
      slippageBps: 50,
      routePlan: [],
    };

    const mockQuoteResult = {
      inputMint: SOL_MINT,
      inAmount: '1000000000',
      outputMint: USDC_MINT,
      outAmount: '150000000',
      otherAmountThreshold: '149250000',
      slippageBps: 50,
      priceImpactPct: '0.01',
      platformFee: { amount: '300000', feeBps: 20, recipientAccount: 'FeeAcct' },
      routePlan: [],
      contextSlot: 999999,
      source: { providerId: 'jupiter', fetchedAt: new Date().toISOString() },
      _rawQuote: mockRawQuote,
    };

    it('returns base64 swapTransaction', async () => {
      process.env.JUPITER_FEE_ACCOUNT = 'AstryumFeeAccount11111111111111111111111111111';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          swapTransaction: 'base64encodedtransaction==',
          lastValidBlockHeight: 123456,
          prioritizationFeeLamports: 1000,
        }),
        text: () => Promise.resolve(''),
      } as unknown as Response);

      const provider = new JupiterSwapProvider();
      const result = await provider.prepareSwap({
        quote: mockQuoteResult,
        userPublicKey: 'UserWalletPublicKey11111111111111111111111111111',
      });

      expect(result.swapTransaction).toBe('base64encodedtransaction==');
      expect(result.lastValidBlockHeight).toBe(123456);
      expect(result.fee.bps).toBe(20);
      expect(result.fee.disclosed).toBe(true);
      expect(result.fee.recipientAccount).toBe('AstryumFeeAccount11111111111111111111111111111');

      // Verify feeAccount sent in POST body
      const callBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(callBody.feeAccount).toBe('AstryumFeeAccount11111111111111111111111111111');
      expect(callBody.userPublicKey).toBe('UserWalletPublicKey11111111111111111111111111111');
      expect(callBody.quoteResponse).toEqual(mockRawQuote);
    });

    it('throws when quote has no _rawQuote', async () => {
      const provider = new JupiterSwapProvider();
      await expect(
        provider.prepareSwap({
          quote: { ...mockQuoteResult, _rawQuote: undefined },
          userPublicKey: 'SomeKey',
        }),
      ).rejects.toThrow(/valid quote/);
    });

    it('propagates HTTP errors from /swap', async () => {
      mockHttpError(400);
      const provider = new JupiterSwapProvider();
      await expect(
        provider.prepareSwap({ quote: mockQuoteResult, userPublicKey: 'SomeKey' }),
      ).rejects.toThrow(/HTTP 400/);
    });
  });

  describe('buildIntentPayload()', () => {
    it('returns astryumRelays:false and Solana chainKey', () => {
      process.env.JUPITER_FEE_ACCOUNT = 'FeeAcct';
      const provider = new JupiterSwapProvider();
      const swap = {
        swapTransaction: 'base64tx==',
        lastValidBlockHeight: 12345,
        prioritizationFeeLamports: 500,
        fee: { bps: 20, recipientAccount: 'FeeAcct', disclosed: true as const },
        source: { providerId: 'jupiter', fetchedAt: new Date().toISOString() },
      };
      const quote = {
        inputMint: SOL_MINT,
        inAmount: '1000000000',
        outputMint: USDC_MINT,
        outAmount: '150000000',
        otherAmountThreshold: '0',
        slippageBps: 50,
        priceImpactPct: '0',
        platformFee: { amount: '0', feeBps: 20, recipientAccount: 'FeeAcct' },
        routePlan: [],
        contextSlot: 0,
        source: { providerId: 'jupiter', fetchedAt: new Date().toISOString() },
        _rawQuote: {},
      };
      const intent = provider.buildIntentPayload(swap, quote, 'UserWallet');

      expect(intent.intentId).toBeTruthy();
      expect(intent.status).toBe('pending_user_review');
      expect(intent.tx.chainKey).toBe('solana:mainnet');
      expect(intent.tx.data).toBe('base64tx==');
      expect(intent.authorization.astryumRelays).toBe(false);
      expect(intent.authorization.userMustAuthorize).toBe(true);
      expect(intent.referralAttribution.disclosedToUser).toBe(true);
      expect(intent.expiry.ttlSeconds).toBe(60); // Solana block validity window
    });
  });

  describe('call() dispatcher', () => {
    it('swap.getQuote routes to getQuote()', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          inputMint: SOL_MINT,
          inAmount: '1000',
          outputMint: USDC_MINT,
          outAmount: '150',
          otherAmountThreshold: '149',
          slippageBps: 50,
          priceImpactPct: '0',
          platformFee: { amount: '3', feeBps: 20 },
          routePlan: [],
          contextSlot: 1,
        }),
        text: () => Promise.resolve(''),
      } as unknown as Response);

      const provider = new JupiterSwapProvider();
      const result = await provider.call<unknown, unknown>(
        'swap.getQuote',
        { inputMint: SOL_MINT, outputMint: USDC_MINT, amount: '1000' },
        { traceId: 'test-trace' },
      );
      expect((result.data as any).outputMint).toBe(USDC_MINT);
      expect(result.source.providerId).toBe('jupiter');
      expect(result.source.traceId).toBe('test-trace');
    });

    it('throws on unknown capability', async () => {
      const provider = new JupiterSwapProvider();
      await expect(
        provider.call('swap.unknown', {}, { traceId: 'x' }),
      ).rejects.toThrow(/unsupported capability/);
    });
  });
});

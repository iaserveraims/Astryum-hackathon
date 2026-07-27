jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

import { WFLRAdapter } from '../WFLRAdapter';

const WALLET = '0x000000000000000000000000000000000000abcd';
const WNAT = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const PRICE_SNAPSHOT = { takenAt: new Date(), prices: {} };
const CTX = { owner: WALLET, sessionId: 'sess-1', priceSnapshot: PRICE_SNAPSHOT };

describe('WFLRAdapter', () => {
  test('isActive=true (WNAT is fixed mainnet contract)', () => {
    expect(new WFLRAdapter().isActive).toBe(true);
  });

  test('simulateAction wrap returns success + gas estimate', async () => {
    const a = new WFLRAdapter();
    const result = await a.simulateAction({
      kind: 'wrap',
      protocolId: 'wflr',
      chainId: 14,
      wallet: WALLET,
      inputs: { amount: 100n * 10n ** 18n, flrPriceUSD: 0.02 },
    });
    expect(result.success).toBe(true);
    expect(result.gasEstimate).toBe(60_000n);
    expect(result.netUSDImpact).toBe(0);
    expect(result.isStale).toBe(false);
  });

  test('simulateAction unwrap returns success + larger gas estimate', async () => {
    const a = new WFLRAdapter();
    const result = await a.simulateAction({
      kind: 'unwrap',
      protocolId: 'wflr',
      chainId: 14,
      wallet: WALLET,
      inputs: { amount: 50n * 10n ** 18n, flrPriceUSD: 0.02 },
    });
    expect(result.success).toBe(true);
    expect(result.gasEstimate).toBe(80_000n);
  });

  test('simulateAction warns when amount is 0', async () => {
    const a = new WFLRAdapter();
    const result = await a.simulateAction({
      kind: 'wrap',
      protocolId: 'wflr',
      chainId: 14,
      wallet: WALLET,
      inputs: { amount: 0n },
    });
    expect(result.success).toBe(false);
    expect(result.warnings.some((w) => /must be > 0/.test(w))).toBe(true);
  });

  test('buildTransactionIntent wrap → deposit() selector + value=amount', async () => {
    const a = new WFLRAdapter();
    const amount = 10n * 10n ** 18n;
    const intent = await a.buildTransactionIntent(
      {
        kind: 'wrap',
        protocolId: 'wflr',
        chainId: 14,
        wallet: WALLET,
        inputs: { amount, flrPriceUSD: 0.02 },
      },
      CTX
    );
    expect(intent.txData?.to.toLowerCase()).toBe(WNAT.toLowerCase());
    expect(intent.txData?.data).toBe('0xd0e30db0'); // deposit() selector
    expect(intent.txData?.value).toBe(amount);
    expect(intent.txData?.chainId).toBe(14);
    expect(intent.action).toBe('wrap');
    expect(intent.protocolId).toBe('wflr');
  });

  test('buildTransactionIntent unwrap → withdraw(uint256) calldata + value=0', async () => {
    const a = new WFLRAdapter();
    const amount = 25n * 10n ** 18n;
    const intent = await a.buildTransactionIntent(
      {
        kind: 'unwrap',
        protocolId: 'wflr',
        chainId: 14,
        wallet: WALLET,
        inputs: { amount, flrPriceUSD: 0.02 },
      },
      CTX
    );
    expect(intent.txData?.to.toLowerCase()).toBe(WNAT.toLowerCase());
    expect(intent.txData?.value).toBe(0n);
    // withdraw(uint256) selector is 0x2e1a7d4d
    expect(intent.txData?.data.startsWith('0x2e1a7d4d')).toBe(true);
    expect(intent.action).toBe('unwrap');
  });

  test('buildTransactionIntent rejects unsupported action', async () => {
    const a = new WFLRAdapter();
    await expect(
      a.buildTransactionIntent(
        {
          kind: 'swap',
          protocolId: 'wflr',
          chainId: 14,
          wallet: WALLET,
          inputs: { amount: 1n },
        },
        CTX
      )
    ).rejects.toThrow();
  });
});

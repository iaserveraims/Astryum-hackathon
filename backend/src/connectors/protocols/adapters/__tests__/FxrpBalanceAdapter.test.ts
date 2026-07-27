/**
 * FxrpBalanceAdapter — free FXRP in the wallet becomes a portfolio position.
 *
 * The contract under test: a positive balanceOf emits ONE RawPosition under
 * the 'wallet' dedupe bucket with 6 decimals declared, zero balance emits
 * nothing, and the NormalisationEngine turns the row into asset 'FXRP'
 * priced as XRP — even with no FXRP_TOKEN env configured.
 */
const BALANCE_OF = jest.fn<Promise<bigint>, [string]>();

jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

// The live registry resolution is RPC — pin it to a fixed token address.
const FXRP_TOKEN = '0x8b4abA9C4BAB1C1a8144E579adB6DA6b6a577A5E';
jest.mock('../../flare/FlareDirectMintService', () => ({
  resolveFxrpToken: jest.fn(async () => FXRP_TOKEN),
}));

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      Contract: jest.fn().mockImplementation(() => ({ balanceOf: BALANCE_OF })),
    },
  };
});

import { FxrpBalanceAdapter } from '../FxrpBalanceAdapter';
import { NormalisationEngine } from '../../../../engines/normalisation/NormalisationEngine';

const WALLET = '0x000000000000000000000000000000000000abcd';

describe('FxrpBalanceAdapter', () => {
  beforeEach(() => {
    BALANCE_OF.mockReset();
    delete process.env.FXRP_TOKEN;
  });

  test('is always active — live resolution needs no env', () => {
    expect(new FxrpBalanceAdapter().isActive).toBe(true);
  });

  test('positive balance → one FREE position in the wallet bucket, 6 decimals', async () => {
    BALANCE_OF.mockResolvedValue(2_500_000n); // 2.5 FXRP in UBA (drops)
    const positions = await new FxrpBalanceAdapter().discoverPositions(WALLET);
    expect(positions).toHaveLength(1);
    const p = positions[0];
    expect(p.protocolId).toBe('wallet'); // dedupe bucket shared with native FLR
    expect(p.kind).toBe('FREE');
    expect(p.asset).toBe(FXRP_TOKEN);
    expect(p.amount).toBe(2_500_000n);
    expect(p.raw).toMatchObject({ symbol: 'FXRP', decimals: 6 });
  });

  test('zero balance → no position (never invents one)', async () => {
    BALANCE_OF.mockResolvedValue(0n);
    await expect(new FxrpBalanceAdapter().discoverPositions(WALLET)).resolves.toEqual([]);
  });

  test('normalises to asset FXRP priced as XRP without FXRP_TOKEN env', async () => {
    BALANCE_OF.mockResolvedValue(2_500_000n);
    const raws = await new FxrpBalanceAdapter().discoverPositions(WALLET);
    const [n] = await NormalisationEngine.unify(raws, {
      priceProvider: { getPriceUSD: async (symbol) => (symbol === 'XRP' ? 2 : 0) },
    });
    expect(n.asset).toBe('FXRP');
    expect(n.priceUSD).toBe(2); // priced via the XRP feed
    expect(n.amountUSD).toBeCloseTo(5); // 2.5 FXRP × $2 with 6 decimals
  });
});

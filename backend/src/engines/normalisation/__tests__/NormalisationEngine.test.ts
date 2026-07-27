/**
 * Regression suite for the vault-receipt tracking bug (2026-07-12): the first
 * live Firelight position rendered as "0x4C18…" with qty 0.0000 / $0.00
 * because (a) the adapter's stXRP address fell through canonicaliseAsset
 * unresolved and (b) the engine assumed 18 decimals over a 6-decimal share
 * balance. Every receipt token (stXRP, sFLR, earnXRP, Kinetic underlyings)
 * goes through the paths pinned here.
 */
import { NormalisationEngine } from '../NormalisationEngine';
import type { RawPosition } from '../../../types/domain/Position';

const STXRP_ADDR = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const SFLR_ADDR = '0x12e605bc104e93B45e1aD99F9e555f659051c2BB';

const PRICES: Record<string, number> = { XRP: 1.1, FLR: 0.02, USDT: 1.0 };
const priceProvider = {
  async getPriceUSD(symbol: string): Promise<number> {
    if (!(symbol in PRICES)) throw new Error(`no feed: ${symbol}`);
    return PRICES[symbol];
  },
};

function rawPosition(overrides: Partial<RawPosition>): RawPosition {
  return {
    protocolId: 'test',
    chainId: 14,
    wallet: '0xe7A124A08933d246398382be0Ce246157D9750a6',
    kind: 'STAKE',
    asset: STXRP_ADDR,
    amount: 0n,
    raw: {},
    discoveredAt: new Date('2026-07-12T00:00:00Z'),
    ...overrides,
  };
}

describe('NormalisationEngine — receipt-token valuation', () => {
  test('Firelight stXRP: 6-dec shares + ERC-4626 underlying → real USD, share qty, readable symbol', async () => {
    // 4.694962 stXRP whose convertToAssets() says 4.750000 FXRP.
    const [n] = await NormalisationEngine.unify(
      [
        rawPosition({
          protocolId: 'firelight',
          amount: 4_694_962n,
          raw: {
            token: 'stXRP',
            decimals: 6,
            underlying: { symbol: 'XRP', amount: '4750000', decimals: 6 },
          },
        }),
      ],
      { priceProvider },
    );
    expect(n.asset).toBe('stXRP'); // not the 0x4C18… address
    expect(n.amountUSD).toBeCloseTo(4.75 * 1.1, 6); // underlying × XRP spot
    // priceUSD is the effective per-share price so qty (USD/price) = shares.
    expect(n.amountUSD / n.priceUSD).toBeCloseTo(4.694962, 6);
  });

  test('without decimals in raw the 18-dec default collapses a 6-dec balance — the adapter MUST send them', async () => {
    const [n] = await NormalisationEngine.unify(
      [rawPosition({ amount: 4_694_962n, raw: { token: 'stXRP' } })],
      { priceProvider },
    );
    // Documents the failure mode the fix prevents: ~$5e-12, displays as $0.00.
    expect(n.amountUSD).toBeLessThan(0.000001);
  });

  test('Sceptre sFLR: valued via pooledFlr (FTSO has no sFLR feed), symbol stays sFLR', async () => {
    const [n] = await NormalisationEngine.unify(
      [
        rawPosition({
          protocolId: 'sceptre',
          asset: SFLR_ADDR,
          amount: 10n * 10n ** 18n, // 10 sFLR
          raw: {
            token: 'sFLR',
            decimals: 18,
            pooledFlr: (12n * 10n ** 18n).toString(),
            underlying: { symbol: 'FLR', amount: (12n * 10n ** 18n).toString(), decimals: 18 },
          },
        }),
      ],
      { priceProvider },
    );
    expect(n.asset).toBe('sFLR');
    expect(n.amountUSD).toBeCloseTo(12 * 0.02, 9);
    expect(n.amountUSD / n.priceUSD).toBeCloseTo(10, 9); // qty = shares
  });

  test('Kinetic FXRP supply: underlying-denominated amount, 6 decimals, FXRP display + XRP pricing', async () => {
    const [n] = await NormalisationEngine.unify(
      [
        rawPosition({
          protocolId: 'kinetic',
          kind: 'SUPPLY',
          asset: '0x0000000000000000000000000000000000000FXR'.slice(0, 42),
          amount: 5_000_000n, // 5 FXRP supplied
          raw: { symbol: 'FXRP', decimals: 6, cTokenSymbol: 'kFXRP' },
        }),
      ],
      { priceProvider },
    );
    expect(n.asset).toBe('FXRP');
    expect(n.amountUSD).toBeCloseTo(5 * 1.1, 6);
  });

  test('USDT0 debt prices at the USDT feed (bridged 1:1 redenomination)', async () => {
    const [n] = await NormalisationEngine.unify(
      [
        rawPosition({
          protocolId: 'kinetic',
          kind: 'BORROW',
          amount: 3_000_000n, // 3 USDT0
          raw: { symbol: 'USDT0', decimals: 6 },
        }),
      ],
      { priceProvider },
    );
    expect(n.asset).toBe('USDT0');
    expect(n.amountUSD).toBeCloseTo(3, 6);
  });

  test('malformed/zero underlying blocks are ignored — falls back to symbol × amount', async () => {
    const [zero, malformed] = await NormalisationEngine.unify(
      [
        rawPosition({
          amount: 2_000_000n,
          raw: { token: 'stXRP', decimals: 6, underlying: { symbol: 'XRP', amount: '0', decimals: 6 } },
        }),
        rawPosition({
          amount: 2_000_000n,
          raw: { token: 'stXRP', decimals: 6, underlying: 'not-an-object' },
        }),
      ],
      { priceProvider },
    );
    // stXRP resolves to the XRP feed → 2 × 1.1 in both fallback cases.
    expect(zero.amountUSD).toBeCloseTo(2.2, 6);
    expect(malformed.amountUSD).toBeCloseTo(2.2, 6);
  });

  test('no declared symbol and unknown address still falls through to the raw asset', async () => {
    const addr = '0x00000000000000000000000000000000DeaDBeef';
    const [n] = await NormalisationEngine.unify(
      [rawPosition({ asset: addr, amount: 1n, raw: {} })],
      { priceProvider },
    );
    expect(n.asset).toBe(addr);
    expect(n.amountUSD).toBe(0);
  });
});

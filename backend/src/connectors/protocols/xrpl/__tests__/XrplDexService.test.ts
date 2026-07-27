import { buildOfferCreate, buildOfferCancel } from '../XrplDexService';
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';
import { OfferCreateFlags } from 'xrpl';

const ACCOUNT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const RLUSD_ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De';
const RLUSD = { currency: 'RLUSD', issuer: RLUSD_ISSUER, value: '100' };

const ORIGINAL_TAG = process.env.XRPL_SOURCE_TAG;

afterEach(() => {
  if (ORIGINAL_TAG === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL_TAG;
  _resetXrplSourceTagCache();
});

describe('buildOfferCreate — native DEX orders', () => {
  test('market-style swap XRP→RLUSD (tfImmediateOrCancel)', () => {
    const { xrplTx, disclosure } = buildOfferCreate({
      account: ACCOUNT,
      takerGets: '50000000', // sell 50 XRP
      takerPays: RLUSD, // buy RLUSD
      flags: { immediateOrCancel: true },
    });
    expect(xrplTx.TransactionType).toBe('OfferCreate');
    expect(xrplTx.TakerGets).toBe('50000000');
    expect(xrplTx.TakerPays).toEqual(RLUSD);
    expect(xrplTx.Flags).toBe(OfferCreateFlags.tfImmediateOrCancel);
    expect(disclosure.facts.orderKind).toContain('market-style');
  });

  test('plain limit order carries no Flags field', () => {
    const { xrplTx, disclosure } = buildOfferCreate({
      account: ACCOUNT,
      takerGets: RLUSD,
      takerPays: '25000000',
    });
    expect('Flags' in xrplTx).toBe(false);
    expect(disclosure.facts.orderKind).toContain('limit order');
  });

  test('sell + fillOrKill combine as a bitmask', () => {
    const { xrplTx } = buildOfferCreate({
      account: ACCOUNT,
      takerGets: '1000000',
      takerPays: RLUSD,
      flags: { fillOrKill: true, sell: true },
    });
    expect(xrplTx.Flags).toBe(OfferCreateFlags.tfFillOrKill | OfferCreateFlags.tfSell);
  });

  test('IOC and FOK together are rejected (temINVALID_FLAG on-ledger)', () => {
    expect(() =>
      buildOfferCreate({
        account: ACCOUNT,
        takerGets: '1',
        takerPays: RLUSD,
        flags: { immediateOrCancel: true, fillOrKill: true },
      }),
    ).toThrow(/mutually exclusive/);
  });

  test('passive contradicts IOC', () => {
    expect(() =>
      buildOfferCreate({
        account: ACCOUNT,
        takerGets: '1',
        takerPays: RLUSD,
        flags: { passive: true, immediateOrCancel: true },
      }),
    ).toThrow(/passive contradicts/);
  });

  test('rejects IOU amounts without a valid issuer', () => {
    expect(() =>
      buildOfferCreate({
        account: ACCOUNT,
        takerGets: '1000000',
        takerPays: { currency: 'RLUSD', issuer: 'bad', value: '10' },
      }),
    ).toThrow(/issuer must be a valid XRPL address/);
  });

  test('expiration must be in the future and converts to Ripple epoch', () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { xrplTx } = buildOfferCreate({
      account: ACCOUNT,
      takerGets: '1000000',
      takerPays: RLUSD,
      expirationISO: future,
    });
    // Ripple epoch = Unix - 946684800 → far smaller than Unix seconds
    expect(xrplTx.Expiration).toBeLessThan(Date.now() / 1000);
    expect(() =>
      buildOfferCreate({
        account: ACCOUNT,
        takerGets: '1000000',
        takerPays: RLUSD,
        expirationISO: new Date(Date.now() - 1000).toISOString(),
      }),
    ).toThrow(/must be in the future/);
  });

  test('stamps the SourceTag when configured', () => {
    process.env.XRPL_SOURCE_TAG = '777';
    _resetXrplSourceTagCache();
    const { xrplTx } = buildOfferCreate({ account: ACCOUNT, takerGets: '1000000', takerPays: RLUSD });
    expect(xrplTx.SourceTag).toBe(777);
  });
});

describe('buildOfferCancel', () => {
  test('composes a valid unsigned OfferCancel', () => {
    const { xrplTx, disclosure } = buildOfferCancel({ account: ACCOUNT, offerSequence: 987 });
    expect(xrplTx.TransactionType).toBe('OfferCancel');
    expect(xrplTx.OfferSequence).toBe(987);
    expect(disclosure.disclosedToUser).toBe(true);
  });

  test('rejects zero/negative sequence', () => {
    expect(() => buildOfferCancel({ account: ACCOUNT, offerSequence: 0 })).toThrow(/positive integer/);
  });
});

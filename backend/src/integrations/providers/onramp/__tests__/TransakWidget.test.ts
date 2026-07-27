// D4 — Transak white-label widget URL builder.
// PARTNER_API_KEY is captured at module load, so each case re-requires the module
// with the desired env via jest.resetModules().

describe('buildTransakWidgetUrl (D4)', () => {
  const ORIGINAL = process.env.TRANSAK_API_KEY;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.TRANSAK_API_KEY;
    else process.env.TRANSAK_API_KEY = ORIGINAL;
    jest.resetModules();
  });

  function load(key: string | undefined): (p: any) => string {
    jest.resetModules();
    if (key === undefined) delete process.env.TRANSAK_API_KEY;
    else process.env.TRANSAK_API_KEY = key;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../TransakProvider').buildTransakWidgetUrl;
  }

  test('throws when TRANSAK_API_KEY is not set', () => {
    const build = load(undefined);
    expect(() => build({ walletAddress: '0xabc', cryptoCurrency: 'usdc' })).toThrow(/TRANSAK_API_KEY/);
  });

  test('builds a widget URL with apiKey, wallet, crypto, side and a locked wallet form', () => {
    const build = load('pk_test_123');
    const url = build({
      walletAddress: '0xWallet',
      cryptoCurrency: 'usdc',
      fiatCurrency: 'eur',
      fiatAmount: 100,
      network: 'flare',
      side: 'BUY',
      partnerOrderId: 'oid-1',
    });
    expect(url.startsWith('https://global.transak.com?')).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('apiKey')).toBe('pk_test_123');
    expect(q.get('walletAddress')).toBe('0xWallet');
    expect(q.get('cryptoCurrencyCode')).toBe('USDC');
    expect(q.get('fiatCurrency')).toBe('EUR');
    expect(q.get('fiatAmount')).toBe('100');
    expect(q.get('network')).toBe('flare');
    expect(q.get('productsAvailed')).toBe('BUY');
    expect(q.get('partnerOrderId')).toBe('oid-1');
    expect(q.get('disableWalletAddressForm')).toBe('true');
  });

  test('defaults side to BUY and omits optional params', () => {
    const build = load('pk');
    const q = new URL(build({ walletAddress: '0xW', cryptoCurrency: 'eth' })).searchParams;
    expect(q.get('productsAvailed')).toBe('BUY');
    expect(q.get('cryptoCurrencyCode')).toBe('ETH');
    expect(q.get('fiatAmount')).toBeNull();
    expect(q.get('network')).toBeNull();
  });
});

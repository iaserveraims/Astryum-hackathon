import {
  getXrplSourceTag,
  withSourceTag,
  _resetXrplSourceTagCache,
  astryumOperationalXrplAccounts,
  attributionForSigner,
} from '../xrplSourceTag';

const ORIGINAL = process.env.XRPL_SOURCE_TAG;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL;
  _resetXrplSourceTagCache();
});

describe('xrplSourceTag — the Make Waves project tag', () => {
  test('unset env → undefined tag, txjson untouched (no SourceTag key)', () => {
    delete process.env.XRPL_SOURCE_TAG;
    _resetXrplSourceTagCache();
    expect(getXrplSourceTag()).toBeUndefined();
    const tx = withSourceTag({ TransactionType: 'Payment', Amount: '1' });
    expect('SourceTag' in tx).toBe(false);
  });

  test('valid UInt32 → stamped on the txjson', () => {
    process.env.XRPL_SOURCE_TAG = '2606160020';
    _resetXrplSourceTagCache();
    expect(getXrplSourceTag()).toBe(2606160020);
    const tx = withSourceTag({ TransactionType: 'Payment', Amount: '1' });
    expect(tx.SourceTag).toBe(2606160020);
    // the original fields survive the stamp
    expect(tx.TransactionType).toBe('Payment');
    expect(tx.Amount).toBe('1');
  });

  test.each([
    ['not a number', 'abc'],
    ['negative', '-5'],
    ['float', '1.5'],
    ['above UInt32', String(2 ** 32)],
    ['empty string', '   '],
  ])('invalid value (%s) → ignored, tx goes untagged', (_name, raw) => {
    process.env.XRPL_SOURCE_TAG = raw;
    _resetXrplSourceTagCache();
    expect(getXrplSourceTag()).toBeUndefined();
    expect('SourceTag' in withSourceTag({ a: 1 })).toBe(false);
  });

  test('zero is a valid UInt32 tag', () => {
    process.env.XRPL_SOURCE_TAG = '0';
    _resetXrplSourceTagCache();
    expect(getXrplSourceTag()).toBe(0);
    expect(withSourceTag({ a: 1 }).SourceTag).toBe(0);
  });
});

describe('attributionForSigner — Astryum-operated accounts never carry the tag', () => {
  const KEYS = [
    'ASTRYUM_ORDER_ANCHOR',
    'LEGACY_ORDER_ANCHOR',
    'MANAGER_CREDENTIAL_ISSUERS',
    'ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS',
    'DEMO_EXCHANGE_OMNIBUS_SEED',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      process.env[k] = '';
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('every configured operational account is recognised, comma lists and spaces included', () => {
    process.env.ASTRYUM_ORDER_ANCHOR = 'rAnchorV2';
    process.env.LEGACY_ORDER_ANCHOR = 'rAnchorLegacy';
    process.env.MANAGER_CREDENTIAL_ISSUERS = 'rNotary1, rNotary2';
    process.env.ASTRYUM_OPERATIONAL_XRPL_ACCOUNTS = ' rOmnibus ';
    const ops = astryumOperationalXrplAccounts();
    expect([...ops].sort()).toEqual(['rAnchorLegacy', 'rAnchorV2', 'rNotary1', 'rNotary2', 'rOmnibus']);
    for (const a of ops) expect(attributionForSigner(a)).toBe('operational');
  });

  test('any other account is a user signer', () => {
    process.env.ASTRYUM_ORDER_ANCHOR = 'rAnchorV2';
    expect(attributionForSigner('rSomeManager')).toBe('user');
  });

  test('nothing configured → everyone is a user (empty set, no accidental match on "")', () => {
    expect(astryumOperationalXrplAccounts().size).toBe(0);
    expect(attributionForSigner('')).toBe('user');
  });

  test('the demo exchange OMNIBUS is operational by derivation from its seed — no env list needed (T&C §7)', () => {
    // Canonical public vector (utils/xrplSecret header): the genesis seed opens
    // rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh. Not a key anyone funds.
    const OMNIBUS = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
    process.env.DEMO_EXCHANGE_OMNIBUS_SEED = 'snoPBrXtMeMyMHUVTgbuqAfg1SUTb';
    process.env.XRPL_SOURCE_TAG = '2607090002';
    _resetXrplSourceTagCache();
    expect(astryumOperationalXrplAccounts().has(OMNIBUS)).toBe(true);
    expect(attributionForSigner(OMNIBUS)).toBe('operational');
    expect('SourceTag' in withSourceTag({ TransactionType: 'Payment', Account: OMNIBUS }, attributionForSigner(OMNIBUS))).toBe(false);
    // A client of the desk is still a user.
    expect(attributionForSigner('rSubject')).toBe('user');
  });

  test('an omnibus seed that derives nothing adds nothing, never throws, never logs the seed', () => {
    const spies = [
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
    ];
    try {
      process.env.DEMO_EXCHANGE_OMNIBUS_SEED = 'sNotARealSeedAtAll123';
      expect(() => astryumOperationalXrplAccounts()).not.toThrow();
      expect(astryumOperationalXrplAccounts().size).toBe(0);
      for (const s of spies) expect(s.mock.calls.flat().join(' ')).not.toContain('sNotARealSeedAtAll123');
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  test('end to end: an operational signer gets NO tag even with XRPL_SOURCE_TAG set', () => {
    process.env.XRPL_SOURCE_TAG = '2607090002';
    _resetXrplSourceTagCache();
    process.env.MANAGER_CREDENTIAL_ISSUERS = 'rNotary1';
    expect('SourceTag' in withSourceTag({ TransactionType: 'CredentialCreate' }, attributionForSigner('rNotary1'))).toBe(false);
    expect(withSourceTag({ TransactionType: 'CredentialAccept' }, attributionForSigner('rSubject')).SourceTag).toBe(2607090002);
  });
});

import { buildConstitutionAnchor, decodeUriHex } from '../XrplDidService';
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';

const ACCOUNT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const SHA256 = 'a'.repeat(64);

const ORIGINAL_TAG = process.env.XRPL_SOURCE_TAG;

afterEach(() => {
  if (ORIGINAL_TAG === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL_TAG;
  _resetXrplSourceTagCache();
});

describe('buildConstitutionAnchor — the Legacy constitution DIDSet (vía b)', () => {
  test('composes a valid unsigned DIDSet with the document hash + URI', () => {
    const { xrplTx, disclosure } = buildConstitutionAnchor({
      account: ACCOUNT,
      documentSha256Hex: SHA256,
      documentUri: 'ipfs://QmConstitutionV1',
    });
    expect(xrplTx.TransactionType).toBe('DIDSet');
    expect(xrplTx.Account).toBe(ACCOUNT);
    expect(xrplTx.Data).toBe(SHA256.toUpperCase());
    // URI travels hex-encoded per XLS-40, and round-trips back to the string
    expect(decodeUriHex(xrplTx.URI)).toBe('ipfs://QmConstitutionV1');
    // never signed, never submitted
    expect('TxnSignature' in xrplTx).toBe(false);
    expect('SigningPubKey' in xrplTx).toBe(false);
    // invariant #6 + honest copy: a DID registers, it does NOT enforce
    expect(disclosure.disclosedToUser).toBe(true);
    expect(disclosure.astryumSigns).toBe(false);
    expect(disclosure.facts.enforcesByItself).toBe(false);
    expect(disclosure.facts.amendableByQuorum).toBe(true);
    expect(disclosure.note).toMatch(/does not enforce/);
    expect(disclosure.note).not.toMatch(/testament|inherit|will\b/i);
  });

  test('URI is optional — hash-only anchor is valid', () => {
    const { xrplTx } = buildConstitutionAnchor({ account: ACCOUNT, documentSha256Hex: SHA256 });
    expect(xrplTx.Data).toBe(SHA256.toUpperCase());
    expect(xrplTx.URI).toBeUndefined();
  });

  test('stamps the Make Waves SourceTag when configured', () => {
    process.env.XRPL_SOURCE_TAG = '123456789';
    _resetXrplSourceTagCache();
    const { xrplTx } = buildConstitutionAnchor({ account: ACCOUNT, documentSha256Hex: SHA256 });
    expect(xrplTx.SourceTag).toBe(123456789);
  });

  test('rejects a hash that is not a SHA-256 hex digest', () => {
    for (const bad of ['deadbeef', 'z'.repeat(64), '', SHA256 + 'aa']) {
      expect(() =>
        buildConstitutionAnchor({ account: ACCOUNT, documentSha256Hex: bad }),
      ).toThrow(/64 hex chars/);
    }
  });

  test('rejects a URI over the 256-byte XLS-40 field limit, and a blank one', () => {
    expect(() =>
      buildConstitutionAnchor({
        account: ACCOUNT,
        documentSha256Hex: SHA256,
        documentUri: 'x'.repeat(257),
      }),
    ).toThrow(/256-byte/);
    expect(() =>
      buildConstitutionAnchor({ account: ACCOUNT, documentSha256Hex: SHA256, documentUri: '   ' }),
    ).toThrow(/blank/);
  });

  test('rejects an invalid account', () => {
    expect(() =>
      buildConstitutionAnchor({ account: '0xNotXrpl', documentSha256Hex: SHA256 }),
    ).toThrow(/not a valid XRPL address/);
  });
});

describe('decodeUriHex — defensive URI decoding', () => {
  test('returns undefined for garbage instead of throwing', () => {
    expect(decodeUriHex(undefined)).toBeUndefined();
    expect(decodeUriHex('')).toBeUndefined();
    expect(decodeUriHex(42)).toBeUndefined();
  });
});

import { getXrplSourceTag, withSourceTag, _resetXrplSourceTagCache } from '../xrplSourceTag';

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

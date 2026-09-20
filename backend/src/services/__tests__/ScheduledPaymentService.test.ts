/**
 * M1 — the personal Payment composer, pure logic (no RPC, no DB).
 *
 * What matters: `Account` is PINNED, the SourceTag
 * rides every composed tx, and every invalid rule fails with a sentence the
 * run can surface — never a half-composed payment.
 */
import { composeScheduledPaymentTx } from '../ScheduledPaymentService';
import { _resetXrplSourceTagCache } from '../../config/xrplSourceTag';

const OWNER = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const DESTINATION = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';

// The tag is env-driven (unset ⇒ untagged is VALID); pin it here so the test
// asserts the stamped path — the one production runs with (2607090002).
beforeAll(() => {
  process.env.XRPL_SOURCE_TAG = '2607090002';
  _resetXrplSourceTagCache();
});
afterAll(() => {
  delete process.env.XRPL_SOURCE_TAG;
  _resetXrplSourceTagCache();
});

describe('composeScheduledPaymentTx', () => {
  it('composes an UNSIGNED Payment with Account pinned and the SourceTag', () => {
    const c = composeScheduledPaymentTx(OWNER, { destination: DESTINATION, amountDrops: '10000000' });
    expect(c.owner).toBe(OWNER);
    expect(c.xrplTx).toEqual(
      expect.objectContaining({
        TransactionType: 'Payment',
        Account: OWNER, // pinned — Xaman must not fill this in
        Destination: DESTINATION,
        Amount: '10000000',
        SourceTag: 2607090002,
      }),
    );
    // unsigned: no signature material of any kind
    expect(c.xrplTx).not.toHaveProperty('TxnSignature');
    expect(c.xrplTx).not.toHaveProperty('SigningPubKey');
    expect(c.summary).toContain('10 XRP');
  });

  it('carries an optional memo (hex, capped) and DestinationTag (uint32)', () => {
    const c = composeScheduledPaymentTx(OWNER, {
      destination: DESTINATION,
      amountDrops: '1000000',
      memo: 'seguro del coche',
      destinationTag: 7,
    });
    expect(c.xrplTx).toEqual(expect.objectContaining({ DestinationTag: 7 }));
    const memos = (c.xrplTx as { Memos?: Array<{ Memo: { MemoData: string } }> }).Memos;
    expect(Buffer.from(memos![0].Memo.MemoData, 'hex').toString('utf8')).toBe('seguro del coche');
    expect(c.summary).toContain('(tag 7)');
  });

  it('refuses everything a broken rule could describe, with a readable reason', () => {
    expect(() => composeScheduledPaymentTx('0xNotAnRAddress', { destination: DESTINATION, amountDrops: '1' }))
      .toThrow(/not an r-address/);
    expect(() => composeScheduledPaymentTx(OWNER, { destination: 'nowhere', amountDrops: '1' }))
      .toThrow(/destination/);
    expect(() => composeScheduledPaymentTx(OWNER, { destination: OWNER, amountDrops: '1' }))
      .toThrow(/differ from the paying wallet/);
    expect(() => composeScheduledPaymentTx(OWNER, { destination: DESTINATION, amountDrops: '0' }))
      .toThrow(/amountDrops > 0/);
    expect(() => composeScheduledPaymentTx(OWNER, { destination: DESTINATION }))
      .toThrow(/amountDrops > 0/);
    expect(() => composeScheduledPaymentTx(OWNER, { destination: DESTINATION, amountDrops: '1', destinationTag: -1 }))
      .toThrow(/destinationTag/);
    expect(() => composeScheduledPaymentTx(OWNER, { destination: DESTINATION, amountDrops: '1', destinationTag: 4294967296 }))
      .toThrow(/destinationTag/);
  });

  it('drops are exact integers — no float ever touches the amount', () => {
    // 123456789 drops = 123.456789 XRP, representable; the composer must pass
    // the STRING through untouched (parseBaseUnits already guarded the UI).
    const c = composeScheduledPaymentTx(OWNER, { destination: DESTINATION, amountDrops: '123456789' });
    expect((c.xrplTx as { Amount: string }).Amount).toBe('123456789');
  });
});

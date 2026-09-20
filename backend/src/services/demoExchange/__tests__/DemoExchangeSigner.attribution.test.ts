/**
 * The demo exchange omnibus seed is held by this backend, so everything it
 * signs is Astryum's own scripted activity. The Make Waves project tag must
 * never ride on it (T&C §7: self-dealing / scripted transactions disqualify).
 */
import { omnibusTxForSigning, readSignerConfig } from '../DemoExchangeSigner';

const ORIGINAL = process.env.DEMO_EXCHANGE_SOURCE_TAG_ATTRIBUTION;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DEMO_EXCHANGE_SOURCE_TAG_ATTRIBUTION;
  else process.env.DEMO_EXCHANGE_SOURCE_TAG_ATTRIBUTION = ORIGINAL;
});

describe('omnibusTxForSigning — what the seed actually signs', () => {
  it('strips a SourceTag a builder stamped, and pins the omnibus account', () => {
    const tx = omnibusTxForSigning(
      { TransactionType: 'Payment', Account: 'rWhoever', Destination: 'rClient', Amount: '1000000', SourceTag: 2607090002 },
      'rOmnibus',
    );
    expect('SourceTag' in tx).toBe(false);
    expect(tx.Account).toBe('rOmnibus');
    expect(tx.Destination).toBe('rClient');
    expect(tx.Amount).toBe('1000000');
  });

  it('does not mutate the caller\'s txjson', () => {
    const original = { TransactionType: 'Payment', SourceTag: 1 };
    omnibusTxForSigning(original, 'rOmnibus');
    expect(original.SourceTag).toBe(1);
  });
});

describe('readSignerConfig — the attribution is not a setting', () => {
  it("is 'operational' even when the old env switch says 'user'", () => {
    process.env.DEMO_EXCHANGE_SOURCE_TAG_ATTRIBUTION = 'user';
    expect(readSignerConfig().attribution).toBe('operational');
  });

  it("is 'operational' with the switch unset", () => {
    delete process.env.DEMO_EXCHANGE_SOURCE_TAG_ATTRIBUTION;
    expect(readSignerConfig().attribution).toBe('operational');
  });
});

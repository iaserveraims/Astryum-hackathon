import { buildEscrowCancel, buildEscrowCreate, buildEscrowFinish } from '../XrplEscrowService';
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';

const ACCOUNT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const OTHER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

const ORIGINAL_TAG = process.env.XRPL_SOURCE_TAG;

afterEach(() => {
  if (ORIGINAL_TAG === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL_TAG;
  _resetXrplSourceTagCache();
});

function futureISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe('buildEscrowCreate — the savings escrow (XRP only)', () => {
  test('composes a valid unsigned self-escrow with FinishAfter', () => {
    const { xrplTx, disclosure } = buildEscrowCreate({
      account: ACCOUNT,
      amountDrops: '5000000',
      finishAfterISO: futureISO(30),
    });
    expect(xrplTx.TransactionType).toBe('EscrowCreate');
    expect(xrplTx.Account).toBe(ACCOUNT);
    expect(xrplTx.Destination).toBe(ACCOUNT); // self-escrow default
    expect(xrplTx.Amount).toBe('5000000'); // XRP drops string, never IOU
    expect(typeof xrplTx.FinishAfter).toBe('number');
    expect(xrplTx.CancelAfter).toBeUndefined();
    // never signed, never submitted
    expect('TxnSignature' in xrplTx).toBe(false);
    expect('SigningPubKey' in xrplTx).toBe(false);
    // invariant #6 disclosure
    expect(disclosure.disclosedToUser).toBe(true);
    expect(disclosure.defibroSigns).toBe(false);
    expect(disclosure.facts.selfEscrow).toBe(true);
    expect(disclosure.facts.amountXrp).toBe(5); // dropsToXrp returns a number in xrpl.js 4.x
    // the owner reserve is ALWAYS disclosed, figure or not (#6)
    expect(disclosure.note).toMatch(/owner reserve/);
  });

  test('discloses the live owner reserve figure when the route provides it', () => {
    const { disclosure } = buildEscrowCreate({
      account: ACCOUNT,
      amountDrops: '5000000',
      finishAfterISO: futureISO(30),
      ownerReserveXrp: 0.2,
    });
    expect(disclosure.note).toContain('0.2 XRP right now');
    expect(disclosure.facts.ownerReserveXrp).toBe(0.2);
  });

  test('stamps the Make Waves SourceTag when configured', () => {
    process.env.XRPL_SOURCE_TAG = '123456789';
    _resetXrplSourceTagCache();
    const { xrplTx } = buildEscrowCreate({
      account: ACCOUNT,
      amountDrops: '1000000',
      finishAfterISO: futureISO(7),
    });
    expect(xrplTx.SourceTag).toBe(123456789);
  });

  test('CancelAfter must come after FinishAfter', () => {
    expect(() =>
      buildEscrowCreate({
        account: ACCOUNT,
        amountDrops: '1000000',
        finishAfterISO: futureISO(30),
        cancelAfterISO: futureISO(10),
      }),
    ).toThrow(/cancelAfterISO must be after/);
  });

  test('rejects a past FinishAfter', () => {
    expect(() =>
      buildEscrowCreate({
        account: ACCOUNT,
        amountDrops: '1000000',
        finishAfterISO: new Date(Date.now() - 86_400_000).toISOString(),
      }),
    ).toThrow(/must be in the future/);
  });

  test.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['decimal XRP not drops', '1.5'],
    ['IOU-ish value', 'RLUSD'],
  ])('rejects non-drops amount (%s) — XRP only by construction', (_n, amountDrops) => {
    expect(() =>
      buildEscrowCreate({ account: ACCOUNT, amountDrops, finishAfterISO: futureISO(1) }),
    ).toThrow(/positive integer amount of drops/);
  });

  test('rejects invalid addresses', () => {
    expect(() =>
      buildEscrowCreate({ account: 'not-an-address', amountDrops: '1', finishAfterISO: futureISO(1) }),
    ).toThrow(/not a valid XRPL address/);
    expect(() =>
      buildEscrowCreate({
        account: ACCOUNT,
        destination: '0xEvmAddressNotXrpl',
        amountDrops: '1000000',
        finishAfterISO: futureISO(1),
      }),
    ).toThrow(/destination is not a valid/);
  });
});

describe('buildEscrowFinish — permissionless release', () => {
  test('composes a valid unsigned EscrowFinish for any sender', () => {
    const { xrplTx, disclosure } = buildEscrowFinish({
      account: OTHER, // a keeper — not the owner
      owner: ACCOUNT,
      offerSequence: 42,
    });
    expect(xrplTx.TransactionType).toBe('EscrowFinish');
    expect(xrplTx.Account).toBe(OTHER);
    expect(xrplTx.Owner).toBe(ACCOUNT);
    expect(xrplTx.OfferSequence).toBe(42);
    expect(disclosure.facts.permissionlessAfterFinishAfter).toBe(true);
  });

  test('rejects a negative offerSequence', () => {
    expect(() => buildEscrowFinish({ account: OTHER, owner: ACCOUNT, offerSequence: -1 })).toThrow(
      /non-negative integer/,
    );
  });
});

describe('buildEscrowCancel — permissionless recovery (the promise the Create disclosure makes)', () => {
  test('composes a valid unsigned EscrowCancel for any sender', () => {
    const { xrplTx, disclosure } = buildEscrowCancel({
      account: OTHER, // a keeper — not the owner
      owner: ACCOUNT,
      offerSequence: 42,
    });
    expect(xrplTx.TransactionType).toBe('EscrowCancel');
    expect(xrplTx.Account).toBe(OTHER);
    expect(xrplTx.Owner).toBe(ACCOUNT);
    expect(xrplTx.OfferSequence).toBe(42);
    // never signed, never submitted
    expect('TxnSignature' in xrplTx).toBe(false);
    expect('SigningPubKey' in xrplTx).toBe(false);
    // invariant #6 — the cancel's one load-bearing fact: funds go to the OWNER
    expect(disclosure.disclosedToUser).toBe(true);
    expect(disclosure.defibroSigns).toBe(false);
    expect(disclosure.facts.fundsReturnToOwner).toBe(true);
    expect(disclosure.facts.permissionlessAfterCancelAfter).toBe(true);
    expect(disclosure.note).toMatch(/returns to the account that created/);
  });

  test('stamps the Make Waves SourceTag when configured', () => {
    process.env.XRPL_SOURCE_TAG = '123456789';
    _resetXrplSourceTagCache();
    const { xrplTx } = buildEscrowCancel({ account: OTHER, owner: ACCOUNT, offerSequence: 7 });
    expect(xrplTx.SourceTag).toBe(123456789);
  });

  test('rejects invalid addresses and a negative offerSequence', () => {
    expect(() => buildEscrowCancel({ account: 'nope', owner: ACCOUNT, offerSequence: 1 })).toThrow(
      /not a valid XRPL address/,
    );
    expect(() => buildEscrowCancel({ account: OTHER, owner: 'nope', offerSequence: 1 })).toThrow(
      /not a valid XRPL address/,
    );
    expect(() => buildEscrowCancel({ account: OTHER, owner: ACCOUNT, offerSequence: -1 })).toThrow(
      /non-negative integer/,
    );
  });
});

/**
 * buildSignerListSet — composing the council from zero (ADR-008/009 Capa 0).
 * These pin the safety-critical validation: no impossible quorum, no self-signer,
 * no duplicates, the 32-signer cap, and the honest margin-0 warning.
 */
import { _resetXrplSourceTagCache } from '../../../../config/xrplSourceTag';
import { buildSignerListSet, buildDisableMaster } from '../XrplCouncilService';

const ACCOUNT = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';
const A = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const B = 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY';
const C = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const D = 'rGb1VJkxmMzZLbWRFfu9Xh5GVjZGYR4d3x';
const E = 'rBGVzjE5JcbZs2toRRLLrE6z62HmmGNSxa';

const TAG = 2607090002;
const ORIGINAL = process.env.XRPL_SOURCE_TAG;
beforeEach(() => {
  process.env.XRPL_SOURCE_TAG = String(TAG);
  _resetXrplSourceTagCache();
});
afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.XRPL_SOURCE_TAG;
  else process.env.XRPL_SOURCE_TAG = ORIGINAL;
  _resetXrplSourceTagCache();
});

const w1 = (account: string) => ({ account, weight: 1 });

describe('buildSignerListSet', () => {
  it('composes the recommended 3-of-5 with SourceTag and a healthy margin', () => {
    const out = buildSignerListSet({ account: ACCOUNT, quorum: 3, signers: [A, B, C, D, E].map(w1) });
    expect(out.xrplTx.TransactionType).toBe('SignerListSet');
    expect(out.xrplTx.Account).toBe(ACCOUNT);
    expect(out.xrplTx.SignerQuorum).toBe(3);
    expect(out.xrplTx.SignerEntries).toHaveLength(5);
    expect(out.xrplTx.SourceTag).toBe(TAG);
    expect(out.disclosure.disclosedToUser).toBe(true);
    expect(out.disclosure.defibroSigns).toBe(false);
    expect(out.disclosure.facts.quorumMargin).toBe(2);
  });

  it('warns in the note when the margin is zero (3-of-3)', () => {
    const out = buildSignerListSet({ account: ACCOUNT, quorum: 3, signers: [A, B, C].map(w1) });
    expect(out.disclosure.facts.quorumMargin).toBe(0);
    expect(out.disclosure.note).toContain('margin 0');
  });

  it('rejects an impossible quorum (would never reach it → permanent lock)', () => {
    expect(() => buildSignerListSet({ account: ACCOUNT, quorum: 4, signers: [A, B, C].map(w1) })).toThrow(/exceeds the total signer weight/);
  });

  it('rejects the account signing on its own list', () => {
    expect(() => buildSignerListSet({ account: ACCOUNT, quorum: 1, signers: [w1(ACCOUNT)] })).toThrow(/its own SignerList/);
  });

  it('rejects duplicate signers', () => {
    expect(() => buildSignerListSet({ account: ACCOUNT, quorum: 2, signers: [w1(A), w1(A)] })).toThrow(/duplicate signer/);
  });

  it('rejects more than 32 signers', () => {
    const many = Array.from({ length: 33 }, (_, i) => w1(`${A}${i}`.slice(0, 34)));
    expect(() => buildSignerListSet({ account: ACCOUNT, quorum: 1, signers: many })).toThrow(/at most 32/);
  });

  it('rejects a non-positive or non-integer weight', () => {
    expect(() => buildSignerListSet({ account: ACCOUNT, quorum: 1, signers: [{ account: A, weight: 0 }] })).toThrow(/weight must be/);
  });

  it('supports weighted signers (quorum against summed weight)', () => {
    const out = buildSignerListSet({ account: ACCOUNT, quorum: 3, signers: [{ account: A, weight: 3 }, { account: B, weight: 1 }, { account: C, weight: 1 }] });
    expect(out.disclosure.facts.totalWeight).toBe(5);
    // losing the weight-3 signer drops to 2 < 3 → margin 0
    expect(out.disclosure.facts.quorumMargin).toBe(0);
  });
});

describe('buildDisableMaster', () => {
  it('composes AccountSet(asfDisableMaster) with SourceTag, disclosed and unsigned', () => {
    const out = buildDisableMaster({ account: ACCOUNT });
    expect(out.xrplTx.TransactionType).toBe('AccountSet');
    expect(out.xrplTx.Account).toBe(ACCOUNT);
    expect(out.xrplTx.SetFlag).toBe(4); // asfDisableMaster
    expect(out.xrplTx.SourceTag).toBe(TAG);
    expect(out.disclosure.disclosedToUser).toBe(true);
    expect(out.disclosure.defibroSigns).toBe(false);
    expect(out.disclosure.facts.reversibleWithoutQuorum).toBe(false);
    // The note must be honest about the irreversible, quorum-only consequence.
    expect(out.disclosure.note).toMatch(/master key/i);
    expect(out.disclosure.note).toMatch(/quorum/i);
  });

  it('rejects an invalid XRPL address', () => {
    expect(() => buildDisableMaster({ account: 'not-an-address' })).toThrow(/valid XRPL address/);
  });
});

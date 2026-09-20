/**
 * The omnibus never signs a payment twice: a submission is resolved from the
 * ledger, and «dead, sign again» needs the full-range miss AND a validated
 * ledger past LastLedgerSequence (xrpl.org, Reliable Transaction Submission).
 */
import { journalPlan, parseTxLookup, resolveSubmission, searchWindow } from '../submissionVerdict';

describe('journalPlan — a request the run calls pending, checked against what was actually signed', () => {
  it('no journal entry, or one the ledger proved dead → fulfil (sign)', () => {
    expect(journalPlan(null)).toBe('fulfil');
    expect(journalPlan(undefined)).toBe('fulfil');
    expect(journalPlan({ status: 'expired' })).toBe('fulfil');
  });
  it('a signed payment the run forgot (concurrent save) → resolve from the ledger, never sign again', () => {
    expect(journalPlan({ status: 'submitting' })).toBe('resolve');
  });
  it('a settled or failed payment the run forgot → finish its bookkeeping', () => {
    expect(journalPlan({ status: 'settled' })).toBe('finish-settled');
    expect(journalPlan({ status: 'failed' })).toBe('finish-failed');
  });
  it('an unrecognised status of a signed entry → resolve, not sign', () => {
    expect(journalPlan({ status: 'weird' })).toBe('resolve');
  });
});

describe('parseTxLookup — the `tx` result, both api versions', () => {
  it('validated with a result', () => {
    expect(parseTxLookup({ validated: true, meta: { TransactionResult: 'tesSUCCESS' } })).toEqual({ kind: 'validated', result: 'tesSUCCESS' });
    expect(parseTxLookup({ validated: true, metaData: { TransactionResult: 'tecUNFUNDED_PAYMENT' } })).toEqual({ kind: 'validated', result: 'tecUNFUNDED_PAYMENT' });
  });
  it('validated without a readable result is not a verdict', () => {
    expect(parseTxLookup({ validated: true })).toEqual({ kind: 'unreadable' });
  });
  it('found but not validated is in flight', () => {
    expect(parseTxLookup({ validated: false, meta: { TransactionResult: 'tesSUCCESS' } })).toEqual({ kind: 'in-flight' });
  });
  it('txnNotFound carries searched_all only when the server says so', () => {
    expect(parseTxLookup({ status: 'error', error: 'txnNotFound', searched_all: true })).toEqual({ kind: 'not-found', searchedAll: true });
    expect(parseTxLookup({ status: 'error', error: 'txnNotFound', searched_all: false })).toEqual({ kind: 'not-found', searchedAll: false });
    expect(parseTxLookup({ status: 'error', error: 'txnNotFound' })).toEqual({ kind: 'not-found', searchedAll: false });
  });
  it('other errors and garbage are unreadable', () => {
    expect(parseTxLookup({ status: 'error', error: 'noNetwork' })).toEqual({ kind: 'unreadable' });
    expect(parseTxLookup(null)).toEqual({ kind: 'unreadable' });
  });
});

describe('resolveSubmission — sign again ONLY when the ledger proves the payment is dead', () => {
  const LLS = 1000;
  it('validated tesSUCCESS settles; any other validated result fails, terminally', () => {
    expect(resolveSubmission({ lookup: { kind: 'validated', result: 'tesSUCCESS' }, validatedLedgerIndex: 990, lastLedgerSequence: LLS })).toEqual({ kind: 'settled' });
    expect(resolveSubmission({ lookup: { kind: 'validated', result: 'tecNO_DST' }, validatedLedgerIndex: 990, lastLedgerSequence: LLS })).toEqual({ kind: 'failed', code: 'tecNO_DST' });
  });
  it('full-range miss AND validated ledger past LastLedgerSequence → expired', () => {
    expect(resolveSubmission({ lookup: { kind: 'not-found', searchedAll: true }, validatedLedgerIndex: 1001, lastLedgerSequence: LLS })).toEqual({ kind: 'expired' });
  });
  it('a miss while LastLedgerSequence has not passed yet → wait (it can still get in)', () => {
    expect(resolveSubmission({ lookup: { kind: 'not-found', searchedAll: true }, validatedLedgerIndex: 1000, lastLedgerSequence: LLS })).toEqual({ kind: 'wait' });
  });
  it('a miss the server could not fully search → wait, even past LastLedgerSequence', () => {
    expect(resolveSubmission({ lookup: { kind: 'not-found', searchedAll: false }, validatedLedgerIndex: 5000, lastLedgerSequence: LLS })).toEqual({ kind: 'wait' });
  });
  it('unknown validated ledger, in flight, or unreadable → wait', () => {
    expect(resolveSubmission({ lookup: { kind: 'not-found', searchedAll: true }, validatedLedgerIndex: null, lastLedgerSequence: LLS })).toEqual({ kind: 'wait' });
    expect(resolveSubmission({ lookup: { kind: 'in-flight' }, validatedLedgerIndex: 5000, lastLedgerSequence: LLS })).toEqual({ kind: 'wait' });
    expect(resolveSubmission({ lookup: { kind: 'unreadable' }, validatedLedgerIndex: 5000, lastLedgerSequence: LLS })).toEqual({ kind: 'wait' });
  });
});

describe('searchWindow — the `tx` range stays valid', () => {
  it('uses the signing ledger as the lower bound', () => {
    expect(searchWindow(980, 1000)).toEqual({ min: 980, max: 1000 });
  });
  it('falls back to 20 ledgers back, and never inverts', () => {
    expect(searchWindow(undefined, 1000)).toEqual({ min: 980, max: 1000 });
    expect(searchWindow(1200, 1000)).toEqual({ min: 1000, max: 1000 });
  });
  it('caps the range at 1000 ledgers', () => {
    expect(searchWindow(1, 5000)).toEqual({ min: 4001, max: 5000 });
  });
});

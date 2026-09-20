/**
 * submissionVerdict — what a signed-and-persisted XRPL payment of the demo
 * exchange omnibus became, decided from the ledger alone. Pure: no network.
 *
 * The rule comes from xrpl.org (Reliable Transaction Submission, and the `tx`
 * method's Not Found Response):
 *   · persist the signed hash BEFORE submitting;
 *   · a transaction is final only once it appears in a VALIDATED ledger;
 *   · it can never be included in a ledger whose index is past its
 *     LastLedgerSequence;
 *   · `tx` with both `min_ledger` and `max_ledger` answers `txnNotFound` with
 *     `searched_all: true` only when the server searched that whole range and
 *     the transaction is in none of it. `txnNotFound` alone proves nothing.
 *
 * So a payment is dead — and signing a new one is safe — only when BOTH hold:
 * the full range was searched and missed, AND the last validated ledger is
 * already past LastLedgerSequence. Everything else is "wait".
 */

export type TxLookup =
  /** Found in a validated ledger, with its final result code. */
  | { kind: 'validated'; result: string }
  /** Found, but not yet in a validated ledger. */
  | { kind: 'in-flight' }
  /** `txnNotFound`; `searchedAll` only true when the server covered the whole range. */
  | { kind: 'not-found'; searchedAll: boolean }
  /** No usable answer (other RPC error, validated without a result…). */
  | { kind: 'unreadable' };

export type SubmissionVerdict =
  | { kind: 'settled' }
  | { kind: 'failed'; code: string }
  | { kind: 'expired' }
  | { kind: 'wait' };

/** Reads the `result` object of a JSON-RPC `tx` call (api_version 1 or 2). */
export function parseTxLookup(result: unknown): TxLookup {
  if (!result || typeof result !== 'object') return { kind: 'unreadable' };
  const r = result as Record<string, unknown>;
  if (r.status === 'error' || typeof r.error === 'string') {
    if (r.error === 'txnNotFound') return { kind: 'not-found', searchedAll: r.searched_all === true };
    return { kind: 'unreadable' };
  }
  if (r.validated === true) {
    const meta = (r.meta ?? r.metaData) as { TransactionResult?: unknown } | undefined;
    const code = typeof meta?.TransactionResult === 'string' ? meta.TransactionResult : '';
    // «Validated» without a result we can read is not a verdict.
    return code ? { kind: 'validated', result: code } : { kind: 'unreadable' };
  }
  return { kind: 'in-flight' };
}

export function resolveSubmission(input: {
  lookup: TxLookup;
  /** Index of the last validated ledger, read BEFORE the `tx` lookup on the same node. */
  validatedLedgerIndex: number | null;
  lastLedgerSequence: number;
}): SubmissionVerdict {
  const { lookup, validatedLedgerIndex, lastLedgerSequence } = input;
  if (lookup.kind === 'validated') {
    return lookup.result === 'tesSUCCESS' ? { kind: 'settled' } : { kind: 'failed', code: lookup.result };
  }
  if (
    lookup.kind === 'not-found' &&
    lookup.searchedAll &&
    typeof validatedLedgerIndex === 'number' &&
    Number.isFinite(validatedLedgerIndex) &&
    Number.isFinite(lastLedgerSequence) &&
    validatedLedgerIndex > lastLedgerSequence
  ) {
    return { kind: 'expired' };
  }
  return { kind: 'wait' };
}

export type JournalPlan = 'fulfil' | 'resolve' | 'finish-settled' | 'finish-failed';

/**
 * What to do with a request the run says is 'pending', given the durable
 * submission journal. A journal entry means the omnibus key ALREADY signed a
 * payment for this request: the run lost that fact (a concurrent save), the
 * ledger did not. Only an entry the ledger proved dead lets it be signed again.
 */
export function journalPlan(entry: { status: string } | null | undefined): JournalPlan {
  if (!entry || entry.status === 'expired') return 'fulfil';
  if (entry.status === 'settled') return 'finish-settled';
  if (entry.status === 'failed') return 'finish-failed';
  // 'submitting' — or any shape we do not recognise for a signed payment:
  // read the ledger, never sign blind.
  return 'resolve';
}

/** The `tx` search window: [submittedAtLedger, lastLedgerSequence], at most 1000 ledgers (xrpl.org). */
export function searchWindow(submittedAtLedger: number | undefined, lastLedgerSequence: number): { min: number; max: number } {
  const max = lastLedgerSequence;
  let min = typeof submittedAtLedger === 'number' && Number.isFinite(submittedAtLedger) ? submittedAtLedger : max - 20;
  if (min > max) min = max;
  if (max - min > 999) min = max - 999;
  return { min: Math.max(1, min), max };
}

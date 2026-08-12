/**
 * The rules that stand between a family and an account nobody can ever open.
 *
 * Since 2026-08-03 the council is created in the Xaman Multisign xApp (Xaman
 * refuses a `SignerListSet` composed by any app — 401 / code 1217), so Astryum
 * no longer holds the transaction: it holds the CHECK. These assertions are the
 * whole of that check. If one of them regresses, the panel cheerfully waves a
 * family through into a signer list the ledger will accept and no quorum can
 * ever satisfy — and by the time anyone notices, the master key is disabled.
 */

import { describe, expect, it } from 'vitest';
import {
  compareCouncilPlan,
  formatPlanProblem,
  normalizeCouncilPlan,
  validateCouncilPlan,
} from '../councilPlan';

// Real mainnet-shaped addresses (checksum-valid) so the checksum guard is
// exercised for real, not stubbed away.
const A = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const B = 'rsuUjfWxrACCAwGQDsNeZUhpzXf1n1NK5Z';
const C = 'rGWrZyQqhTp9Xu7G5Pkayo7bXjH4k4QYpf';
const ACCOUNT = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';

/** The checksum validator the UI injects (xrpl.js in the app). */
const isValid = (a: string) => [A, B, C, ACCOUNT].includes(a);

const rows = (...accounts: string[]) => accounts.map((account) => ({ account, weight: '1' }));

describe('validateCouncilPlan', () => {
  it('accepts a 3-signer, quorum-2 plan', () => {
    expect(validateCouncilPlan(ACCOUNT, rows(A, B, C), '2', isValid)).toBeNull();
  });

  it('REFUSES a quorum above the total weight — the account would lock forever', () => {
    const problem = validateCouncilPlan(ACCOUNT, rows(A, B), '3', isValid);
    expect(problem?.message).toContain('lock forever');
    // The arithmetic travels with the message so the person sees WHY.
    expect(problem?.detail).toBe('(3 > 2)');
  });

  it('catches an address that is one character off (checksum, not shape)', () => {
    // Shape-valid, checksum-invalid: exactly the typo a family makes copying a
    // relative's address by hand. A regex alone lets this through.
    const typo = `${A.slice(0, -1)}X`;
    const problem = validateCouncilPlan(ACCOUNT, rows(A, typo), '2', isValid);
    expect(problem?.detail).toBe(typo);
  });

  it('refuses the governed account as one of its own signers', () => {
    expect(validateCouncilPlan(ACCOUNT, rows(A, ACCOUNT), '2', isValid)?.message).toContain(
      'its own signers',
    );
  });

  it('refuses a duplicated signer', () => {
    expect(validateCouncilPlan(ACCOUNT, rows(A, A, B), '2', isValid)?.detail).toBe(A);
  });

  it('refuses a fractional or zero weight, and a fractional or zero quorum', () => {
    expect(
      validateCouncilPlan(ACCOUNT, [{ account: A, weight: '1.5' }], '1', isValid),
    ).not.toBeNull();
    expect(validateCouncilPlan(ACCOUNT, [{ account: A, weight: '0' }], '1', isValid)).not.toBeNull();
    expect(validateCouncilPlan(ACCOUNT, rows(A, B), '', isValid)?.message).toContain('quorum must be');
  });

  it('ignores blank rows — unfinished typing is not a signer', () => {
    const withBlank = [...rows(A, B), { account: '   ', weight: '1' }];
    expect(validateCouncilPlan(ACCOUNT, withBlank, '2', isValid)).toBeNull();
    expect(normalizeCouncilPlan(withBlank, '2').signers).toHaveLength(2);
  });

  it('reports an empty plan rather than composing nothing', () => {
    expect(validateCouncilPlan(ACCOUNT, [], '2', isValid)?.message).toContain('at least one signer');
  });
});

describe('normalizeCouncilPlan', () => {
  it('computes the margin — the keys you can lose before nothing can pass', () => {
    const plan = normalizeCouncilPlan(rows(A, B, C), '2');
    expect(plan.totalWeight).toBe(3);
    expect(plan.quorum).toBe(2);
    expect(plan.margin).toBe(1);
  });
});

describe('formatPlanProblem', () => {
  const t = (s: string) => s;
  it('reads an address detail after a colon and arithmetic as an aside', () => {
    expect(formatPlanProblem({ message: 'Bad address', detail: A }, t)).toBe(`Bad address: ${A}`);
    expect(formatPlanProblem({ message: 'Too high', detail: '(3 > 2)' }, t)).toBe('Too high (3 > 2)');
    expect(formatPlanProblem({ message: 'Alone' }, t)).toBe('Alone');
  });
});

describe('compareCouncilPlan', () => {
  const council = { quorum: 2, signers: [{ account: A, weight: 1 }, { account: B, weight: 1 }] };

  it('confirms a council that is what the family meant', () => {
    expect(compareCouncilPlan(rows(A, B), '2', council).matches).toBe(true);
  });

  it('names the signer that never made it onto the ledger', () => {
    const cmp = compareCouncilPlan(rows(A, B, C), '2', council);
    expect(cmp.matches).toBe(false);
    expect(cmp.missing).toEqual([C]);
  });

  it('names a signer on the ledger that nobody planned', () => {
    const cmp = compareCouncilPlan(rows(A), '2', council);
    expect(cmp.unexpected).toEqual([B]);
  });

  it('catches a quorum typed as something else — the silent one', () => {
    const cmp = compareCouncilPlan(rows(A, B), '1', council);
    expect(cmp.quorumMatches).toBe(false);
    expect(cmp.matches).toBe(false);
  });

  it('catches a weight that differs', () => {
    const cmp = compareCouncilPlan([{ account: A, weight: '2' }, { account: B, weight: '1' }], '2', council);
    expect(cmp.weightMismatch).toEqual([{ account: A, planned: 2, onLedger: 1 }]);
  });
});

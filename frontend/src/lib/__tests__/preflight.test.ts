import { describe, it, expect } from 'vitest';
import { preflightSaysFail } from '../preflight';

// The sign button degrades ONLY on a PROVEN dry-run failure: an unavailable
// simulator (node down / no `simulate`) must never scare the user into
// thinking the operation is broken — that is the council posture.
describe('preflightSaysFail', () => {
  it('true only when the dry-run RAN and failed', () => {
    expect(preflightSaysFail({ available: true, willSucceed: false, reason: 'x' })).toBe(true);
  });
  it('false when the dry-run succeeded, was unavailable, or is absent', () => {
    expect(preflightSaysFail({ available: true, willSucceed: true })).toBe(false);
    expect(preflightSaysFail({ available: false, willSucceed: false })).toBe(false);
    expect(preflightSaysFail(undefined)).toBe(false);
    expect(preflightSaysFail(null)).toBe(false);
  });
});

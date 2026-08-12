/**
 * Legal acceptance gate — the pure logic behind GET /me `legal` and
 * POST /auth/legal-accept (founder 2026-07-30: both published legal pages
 * must be presented at first dashboard entry and the acceptance recorded).
 */
import {
  computeLegalStatus,
  withLegalAcceptance,
  PRIVACY_NOTICE_VERSION,
} from '../legalAcceptance';

const TERMS = '2026-07-30';

describe('computeLegalStatus — who gets the gate', () => {
  it('requires the gate for a blank account (wallet-first / SIWE users)', () => {
    expect(computeLegalStatus(null, TERMS).required).toBe(true);
    expect(computeLegalStatus(undefined, TERMS).required).toBe(true);
    expect(computeLegalStatus({}, TERMS).required).toBe(true);
  });

  it('requires the gate for an account that accepted an OLDER terms version (the €50-cap bump)', () => {
    const prefs = {
      legal: { termsVersion: '2026-07-26', privacyVersion: PRIVACY_NOTICE_VERSION, acceptedAt: 'x' },
    };
    expect(computeLegalStatus(prefs, TERMS).required).toBe(true);
  });

  it('requires the gate when only the register click-wrap exists (privacy never presented)', () => {
    // Fresh email signup: demoTerms current, but the privacy notice record is missing.
    const prefs = { demoTerms: { version: TERMS, acceptedAt: 'x' } };
    expect(computeLegalStatus(prefs, TERMS).required).toBe(true);
  });

  it('does NOT require the gate once the unified record carries both current versions', () => {
    const prefs = withLegalAcceptance({}, TERMS);
    expect(computeLegalStatus(prefs, TERMS).required).toBe(false);
  });

  it('register click-wrap at the current version satisfies the TERMS half (no double-ask semantics)', () => {
    const prefs = {
      demoTerms: { version: TERMS, acceptedAt: 'x' },
      legal: { termsVersion: 'stale', privacyVersion: PRIVACY_NOTICE_VERSION, acceptedAt: 'x' },
    };
    // terms via demoTerms fallback + privacy via legal ⇒ gate closed
    expect(computeLegalStatus(prefs, TERMS).required).toBe(false);
  });

  it('always reports the CURRENT versions for the client to display', () => {
    const s = computeLegalStatus(null, TERMS);
    expect(s.termsVersion).toBe(TERMS);
    expect(s.privacyVersion).toBe(PRIVACY_NOTICE_VERSION);
  });
});

describe('withLegalAcceptance — the record that gets stored', () => {
  it('stamps both versions and an ISO timestamp', () => {
    const now = new Date('2026-07-30T18:00:00Z');
    const merged = withLegalAcceptance(null, TERMS, now) as {
      legal: { termsVersion: string; privacyVersion: string; acceptedAt: string };
    };
    expect(merged.legal).toEqual({
      termsVersion: TERMS,
      privacyVersion: PRIVACY_NOTICE_VERSION,
      acceptedAt: '2026-07-30T18:00:00.000Z',
    });
  });

  it('preserves sibling preference keys (demoTerms from register, anything else)', () => {
    const prev = { demoTerms: { version: '2026-07-26', acceptedAt: 'x' }, theme: 'dark' };
    const merged = withLegalAcceptance(prev, TERMS) as Record<string, unknown>;
    expect(merged.demoTerms).toEqual(prev.demoTerms);
    expect(merged.theme).toBe('dark');
    expect((merged.legal as { termsVersion: string }).termsVersion).toBe(TERMS);
  });

  it('a non-object preferences value (corruption) is replaced, not crashed on', () => {
    for (const junk of ['oops', 42, [1, 2]]) {
      const merged = withLegalAcceptance(junk, TERMS) as { legal?: unknown };
      expect(merged.legal).toBeDefined();
    }
  });

  it('round-trip: accepting closes the gate; a later terms bump re-opens it exactly once', () => {
    const accepted = withLegalAcceptance({}, TERMS);
    expect(computeLegalStatus(accepted, TERMS).required).toBe(false);
    // Material change to /demo-terms → version bump → gate re-opens…
    expect(computeLegalStatus(accepted, '2026-09-01').required).toBe(true);
    // …and closes again after re-acceptance of the new version.
    const reAccepted = withLegalAcceptance(accepted, '2026-09-01');
    expect(computeLegalStatus(reAccepted, '2026-09-01').required).toBe(false);
  });
});

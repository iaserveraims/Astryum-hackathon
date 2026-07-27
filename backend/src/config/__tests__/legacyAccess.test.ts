import {
  getLegacyAccessEmails,
  hasLegacyToggleAccess,
  isLegacyEnabledForAll,
  _resetLegacyAccessCache,
} from '../legacyAccess';

const ENV = process.env;
beforeEach(() => {
  _resetLegacyAccessCache();
  process.env = { ...ENV };
  delete process.env.LEGACY_ENABLED;
  delete process.env.LEGACY_ACCESS_EMAILS;
});
afterAll(() => {
  process.env = ENV;
});

describe('legacyAccess — LEGACY_ENABLED switch is FAIL-CLOSED (off ⇒ allowlist only)', () => {
  it('everything unset ⇒ Legacy is OFF for everyone (deploy hides it, nothing to configure wrong)', () => {
    expect(isLegacyEnabledForAll()).toBe(false);
    expect(hasLegacyToggleAccess('anyone@example.com')).toBe(false);
    expect(hasLegacyToggleAccess(null)).toBe(false);
    expect(hasLegacyToggleAccess(undefined)).toBe(false);
  });

  it("only the literal 'true' opens Legacy for everyone (case-insensitive, trimmed)", () => {
    for (const on of ['true', 'TRUE', ' True ']) {
      process.env.LEGACY_ENABLED = on;
      expect(isLegacyEnabledForAll()).toBe(true);
      expect(hasLegacyToggleAccess('anyone@example.com')).toBe(true);
    }
  });

  it('malformed switch values read as OFF (absence/typo ≠ open)', () => {
    for (const bad of ['false', '1', 'yes', 'on', '', '   ', 'ture']) {
      process.env.LEGACY_ENABLED = bad;
      expect(isLegacyEnabledForAll()).toBe(false);
      expect(hasLegacyToggleAccess('anyone@example.com')).toBe(false);
    }
  });

  it('switch on ⇒ the allowlist is irrelevant (unlisted accounts enter too)', () => {
    process.env.LEGACY_ENABLED = 'true';
    process.env.LEGACY_ACCESS_EMAILS = 'founder@astryum.xyz';
    expect(hasLegacyToggleAccess('someone-else@example.com')).toBe(true);
  });
});

describe('legacyAccess — LEGACY_ACCESS_EMAILS is the exception list while the switch is off', () => {
  it('only the listed emails see the toggle', () => {
    process.env.LEGACY_ACCESS_EMAILS = 'founder@astryum.xyz';
    expect(hasLegacyToggleAccess('founder@astryum.xyz')).toBe(true);
    expect(hasLegacyToggleAccess('someone-else@example.com')).toBe(false);
  });

  it('is comma-separated, case-insensitive and trimmed (same shape as ADMIN_EMAILS)', () => {
    process.env.LEGACY_ACCESS_EMAILS = ' Founder@Astryum.xyz , second@example.com ,, ';
    expect(getLegacyAccessEmails().size).toBe(2);
    expect(hasLegacyToggleAccess('founder@astryum.xyz')).toBe(true);
    expect(hasLegacyToggleAccess('SECOND@EXAMPLE.COM')).toBe(true);
    expect(hasLegacyToggleAccess('third@example.com')).toBe(false);
  });

  it('accounts without email are out (SIWE-only logins cannot be listed)', () => {
    process.env.LEGACY_ACCESS_EMAILS = 'founder@astryum.xyz';
    expect(hasLegacyToggleAccess(null)).toBe(false);
    expect(hasLegacyToggleAccess(undefined)).toBe(false);
    expect(hasLegacyToggleAccess('')).toBe(false);
  });

  it('re-parses when the env value changes (cache keyed by raw value)', () => {
    process.env.LEGACY_ACCESS_EMAILS = 'a@x.com';
    expect(hasLegacyToggleAccess('b@x.com')).toBe(false);
    process.env.LEGACY_ACCESS_EMAILS = 'a@x.com,b@x.com';
    expect(hasLegacyToggleAccess('b@x.com')).toBe(true);
  });
});

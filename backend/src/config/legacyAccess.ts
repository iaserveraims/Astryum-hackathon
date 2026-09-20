/**
 * Legacy product gate.
 *
 * Two envs, evaluated in order:
 */

/** The global switch: only the literal 'true' opens Legacy for everyone. */
export function isLegacyEnabledForAll(): boolean {
  return (process.env.LEGACY_ENABLED ?? '').trim().toLowerCase() === 'true';
}

// Cached by raw value so a Railway env edit + restart re-parses, but steady
// state costs one string compare (same pattern as demoCap's exempt lists).
let cached: { raw: string; set: Set<string> } | null = null;

export function getLegacyAccessEmails(): Set<string> {
  const raw = process.env.LEGACY_ACCESS_EMAILS ?? '';
  if (!cached || cached.raw !== raw) {
    cached = {
      raw,
      set: new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
    };
  }
  return cached.set;
}

/**
 * Whether this account gets the Legacy product toggle. Consumed by
 * GET /auth/me. With the switch off, accounts without an email (pure SIWE
 * logins) can never be listed, so they don't see the toggle — list-by-email
 * is the same identity the other founder doors already use.
 */
export function hasLegacyToggleAccess(email: string | null | undefined): boolean {
  if (isLegacyEnabledForAll()) return true;
  if (!email) return false;
  return getLegacyAccessEmails().has(email.trim().toLowerCase());
}

/** Test hook — drops the parse cache between cases. */
export function _resetLegacyAccessCache(): void {
  cached = null;
}

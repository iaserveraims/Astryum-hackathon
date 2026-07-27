/**
 * Legacy product gate (founder 2026-07-26; hardened same day: "el Legacy debe
 * estar desactivado para todos — solo entran las cuentas escritas").
 *
 * Two envs, evaluated in order:
 *
 *   · LEGACY_ENABLED — the global true/false switch. 'true' (case-insensitive)
 *     ⇒ the Personal↔Legacy toggle is visible to every account and the
 *     allowlist is irrelevant. Anything else — 'false', unset, a typo —
 *     ⇒ Legacy is OFF for everyone…
 *   · …except LEGACY_ACCESS_EMAILS: with the switch off, ONLY the listed
 *     account emails keep the toggle. Off + empty list ⇒ nobody sees it.
 *
 * FAIL-CLOSED on purpose (founder order): a missing/malformed switch reads as
 * OFF, so deploying this code hides Legacy until the founders either list
 * themselves in Railway or flip LEGACY_ENABLED=true.
 *
 * Deliberately its OWN allowlist (same rule as DEMO_CAP_EXEMPT_EMAILS vs
 * ADMIN_EMAILS): the admin panel and the Legacy product are different powers,
 * and adding someone to one list must never silently open the other.
 *
 * CLIENT hint only, like isAdmin on /auth/me: it decides whether the toggle
 * really switches or opens the in-development popup (the toggle itself stays
 * visible to everyone in the beta). It does not (and must not) guard any
 * capital operation — every governed-account read/write keeps its own
 * server-side auth.
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

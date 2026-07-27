/**
 * User region — the client half of the per-jurisdiction interruptor
 * (CLAUDE.md invariant #5 / backend/src/services/JurisdictionService.ts).
 *
 * Astryum never guesses this from IP or browser language: the DeFi execution
 * geofence is fail-closed, so an unset region simply means the execution
 * module stays hidden/blocked until the user picks one explicitly. Monitoring,
 * fiat and tax never depend on this value.
 *
 * Device-local (localStorage) only — this is a UI preference, not identity;
 * it travels to the backend as the `region` field callers attach to
 * DeFi-execution requests (JurisdictionService normalizes it the same way:
 * trim().toUpperCase()).
 */

const STORAGE_KEY = 'astryum.region';

/** ISO-3166-alpha-2 (2 letters) or the rarer alpha-3 (3 letters), A–Z only. */
const REGION_CODE_RE = /^[A-Z]{2,3}$/;

/**
 * Reads the user's chosen region. Returns `null` when unset, empty, or not a
 * plausible 2–3 letter code — callers should treat `null` exactly like the
 * backend does: unknown region, so gated modules fail closed.
 */
export function getUserRegion(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    return REGION_CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * Sets (or clears, with `null`) the user's chosen region. Invalid input
 * (fails the 2–3 letter check) clears storage rather than saving garbage —
 * same fail-closed posture as the read side.
 */
export function setUserRegion(code: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (code == null) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const normalized = code.trim().toUpperCase();
    if (!REGION_CODE_RE.test(normalized)) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    /* quota/availability failures are non-fatal — region just won't persist */
  }
}

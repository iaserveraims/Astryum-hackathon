/**
 * Which doors this origin gets — the one rule, in one place.
 *
 * Email, Google and Apple are not deleted (they stay wired and
 * tested); they are hidden where the single door works, and they surface where
 * it cannot.
 */
import type { XrplIdentityConfig } from './xrplIdentity/login';
import { xrplIdentityRedirectUri } from './xrplIdentity/login';

export type LegacyDoorsOverride = 'on' | 'off' | null;

export function legacyDoorsOverride(): LegacyDoorsOverride {
  const raw = process.env.NEXT_PUBLIC_LEGACY_AUTH_DOORS;
  if (raw === 'true') return 'on';
  if (raw === 'false') return 'off';
  return null;
}

/**
 * True when the XRP Identity door can actually complete on this origin: the
 * provider is configured AND our callback URI is one it will redirect back to.
 *
 * A door that is visible but answers `xrplid_redirect_not_registered` on click
 * is worse than no door — that lesson is already paid for (the beta bounce,).
 */
export function xrplIdentityUsableHere(config: XrplIdentityConfig | null): boolean {
  if (!config?.clientId) return false;
  if (typeof window === 'undefined') return false;
  return config.redirectUris.includes(xrplIdentityRedirectUri());
}

export interface DoorsInput {
  config: XrplIdentityConfig | null;
  /** Has the config request come back? Before it does we know nothing. */
  resolved: boolean;
}

/**
 * Whether to paint the XRP Identity button.
 *
 * Normally: only where it can actually complete, because a door that answers
 * `xrplid_redirect_not_registered` on click is worse than no door — that lesson
 * is already paid for (the beta bounce).
 *
 * The exception is the rule that outranks it: **never leave a card with zero
 * doors.** If somebody forces the old rail off on an origin where this one is
 * not registered either, hiding both would produce a login screen with no way
 * in at all. Then this door shows, and the click says plainly what is wrong —
 * a visible door that explains itself beats a blank card that does not.
 */
export function xrplIdentityDoorVisible({ config, resolved }: DoorsInput): boolean {
  if (!resolved || !config?.clientId) return false;
  if (xrplIdentityUsableHere(config)) return true;
  return legacyDoorsOverride() === 'off';
}

/**
 * Whether to show email / Google / Apple / passkey.
 *
 * Unresolved means "not yet": showing them while the answer is in flight would
 * flash in production exactly the doors we are hiding, and a flash is a promise
 * we then take back. The forced-on override skips the wait — it exists for the
 * moment somebody is locked out and every second counts.
 */
export function legacyDoorsVisible({ config, resolved }: DoorsInput): boolean {
  const override = legacyDoorsOverride();
  if (override === 'on') return true;
  if (override === 'off') return false;
  if (!resolved) return false;
  return !xrplIdentityUsableHere(config);
}

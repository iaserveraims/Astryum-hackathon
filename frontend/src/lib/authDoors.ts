/**
 * Which doors this origin gets — the one rule, in one place.
 *
 * Founder decision 2026-08-17: in production Astryum has ONE entrance, XRP
 * Identity. Email, Google and Apple are not deleted (they stay wired and
 * tested); they are hidden where the single door works, and they surface where
 * it cannot.
 *
 * The trigger is deliberately NOT "is this astryum.xyz". It is the honest
 * question: **can the XRP Identity door work on this origin at all?** The
 * provider only accepts redirect URIs its operator registered, so on a Vercel
 * preview or on localhost that door is physically dead — and an origin with no
 * working door is a site nobody can enter, including us.
 *
 * That framing pays for itself three ways:
 *   · preview and local dev keep a way in, with no flag to remember,
 *   · the day `localhost` gets registered, dev goes single-door on its own,
 *   · and if the redirect allowlist is ever broken in production, the old rail
 *     reappears instead of locking everyone out.
 *
 * Manual override, for the case the rule cannot see — their SSO is up, our
 * config is right, and yet nobody can get in (an outage at the provider):
 *   NEXT_PUBLIC_LEGACY_AUTH_DOORS = 'true'  → force the old doors on
 *                                  = 'false' → force them off, everywhere
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
 * is worse than no door — that lesson is already paid for (the beta bounce,
 * 2026-08-07).
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
 * is already paid for (the beta bounce, 2026-08-07).
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

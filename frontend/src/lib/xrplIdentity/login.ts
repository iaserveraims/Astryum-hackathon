/**
 * XRP Identity (account.xrpl.in) — the browser half of the front door.
 *
 * Astryum's main entrance is the XRPL ecosystem's own OpenID Connect provider.
 * This module runs authorization_code + PKCE (S256):
 *
 *   1. generate a code verifier + state, keep them in sessionStorage,
 *   2. redirect to the provider's /auth with the S256 challenge,
 *   3. the callback page reads `code`, checks `state`, and hands both the code
 *      and the verifier to the backend, which does the token exchange.
 *
 * The browser never holds a token and never holds a secret: the client is
 * PUBLIC, so there is no secret to hold (invariant 2 intact). The client id is
 * fetched from our backend rather than baked in as NEXT_PUBLIC_*, so Railway
 * env stays the single source of truth.
 *
 * What this door establishes: WHO the person is. Which XRPL account they
 * control is a separate, stronger claim, proven by signature on the
 * wallet-binding rail — this never replaces that.
 */
import { getApiBase } from '../env';

const VERIFIER_KEY = 'xrplid_pkce_verifier';
const STATE_KEY = 'xrplid_state';
const RETURN_KEY = 'xrplid_return_to';

export interface XrplIdentityConfig {
  clientId: string;
  authorizeUrl: string;
  scopes: string;
  redirectUris: string[];
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

async function s256Challenge(verifier: string): Promise<string> {
  // TextEncoder allocates a fresh, exactly-sized buffer, so handing `.buffer`
  // to subtle.digest is the whole view — and it keeps the call typed across
  // the TS 5.7 Uint8Array generic change.
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  return base64url(new Uint8Array(digest));
}

/** The redirect URI this origin uses. Must be one the backend allowlists. */
export function xrplIdentityRedirectUri(): string {
  return `${window.location.origin}/auth/xrpl-identity/callback`;
}

export async function fetchXrplIdentityConfig(): Promise<XrplIdentityConfig | null> {
  try {
    const res = await fetch(`${getApiBase()}/auth/oauth/xrplid/config`);
    if (!res.ok) return null;
    return (await res.json()) as XrplIdentityConfig;
  } catch {
    return null;
  }
}

/**
 * Kick off the redirect. Throws if the provider is not configured yet, so the
 * caller can keep the button honest instead of sending the user nowhere.
 */
export async function beginXrplIdentityLogin(returnTo?: string): Promise<void> {
  const config = await fetchXrplIdentityConfig();
  if (!config) throw new Error('xrplid_not_configured');

  const redirectUri = xrplIdentityRedirectUri();
  if (config.redirectUris.length > 0 && !config.redirectUris.includes(redirectUri)) {
    // Fail loudly here rather than bouncing the user to a provider error page.
    throw new Error('xrplid_redirect_not_registered');
  }

  const verifier = randomBase64url(64);
  const state = randomBase64url(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  if (returnTo) sessionStorage.setItem(RETURN_KEY, returnTo);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scopes,
    state,
    code_challenge: await s256Challenge(verifier),
    code_challenge_method: 'S256',
  });

  window.location.assign(`${config.authorizeUrl}?${params.toString()}`);
}

export interface CallbackParams {
  code: string;
  state: string;
}

/**
 * Consume the one-shot PKCE material. Returns null when `state` does not match
 * what we stored — a mismatched state is a CSRF attempt, not a retry.
 */
export function consumeCallback(params: CallbackParams): { codeVerifier: string; returnTo: string } | null {
  const storedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const returnTo = sessionStorage.getItem(RETURN_KEY) ?? '/app';

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(RETURN_KEY);

  if (!storedState || !verifier || storedState !== params.state) return null;
  return { codeVerifier: verifier, returnTo };
}

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

/**
 * Survives the tab: set on logout, read by the next authorize request. Lives in
 * localStorage on purpose — sessionStorage would forget it the moment the user
 * closes the tab after signing out, which is the common case.
 */
const ASK_ACCOUNT_KEY = 'xrplid_ask_account';

/**
 * Which journey this attempt is on, carried INSIDE the `state` parameter.
 *
 * It has to travel in the URL, and this is why: a popup's sessionStorage is a
 * COPY taken at `window.open`, and everything we write afterwards — the flow
 * marker, the PKCE material, all of it — lands in the opener only. The popup
 * comes home to a storage that is a snapshot of a moment before any of it
 * existed. A marker kept there is therefore always missing exactly when it is
 * read. (Cost us a broken production login on 2026-08-18.)
 *
 * `state` has none of that problem: the provider returns it verbatim in the
 * callback URL, so the page that lands can read it with no storage at all. The
 * opener still compares the WHOLE string against what it stored — the prefix
 * says which door to use, it proves nothing on its own.
 *
 * The marker also separates a real popup from a /login tab that merely HAS an
 * opener (landing → target=_blank → full redirect). Without it, that tab would
 * post its code into the landing page and close itself.
 */
const POPUP_STATE_PREFIX = 'p-';
const REDIRECT_STATE_PREFIX = 'r-';

/** True when the answer in this URL belongs to a popup journey. */
export function stateSaysPopup(state: string | null | undefined): boolean {
  return typeof state === 'string' && state.startsWith(POPUP_STATE_PREFIX);
}

/** postMessage envelope the callback sends home. Same-origin only, both ends. */
export const XRPLID_MESSAGE = 'xrplid_callback';

/**
 * The provider keeps its own SSO cookie, so a second login normally sails
 * straight through on whichever account is still signed in there. After an
 * explicit logout that is the wrong answer — leaving means "not this account,
 * or not now". Calling this makes the next authorize request carry
 * `prompt=login`, so the door asks again.
 *
 * Probed against the provider (2026-08-17): `prompt=login` and `prompt=consent`
 * are accepted; `prompt=select_account` is rejected with
 * `unsupported prompt value requested` — node-oidc-provider only ships the
 * default prompt set, so `login` is the strongest re-ask we have.
 */
export function requestAccountChoiceOnNextLogin(): void {
  try {
    localStorage.setItem(ASK_ACCOUNT_KEY, '1');
  } catch {
    /* private mode / storage disabled — the fast path is an acceptable fallback */
  }
}

function consumeAccountChoiceRequest(): boolean {
  try {
    if (localStorage.getItem(ASK_ACCOUNT_KEY) !== '1') return false;
    localStorage.removeItem(ASK_ACCOUNT_KEY);
    return true;
  } catch {
    return false;
  }
}

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
    // Timed on purpose: this answer decides which doors the card paints, so a
    // hung request would leave the login screen with no way in at all.
    const res = await fetch(`${getApiBase()}/auth/oauth/xrplid/config`, {
      signal: AbortSignal.timeout(6_000),
    });
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
export async function beginXrplIdentityLogin(
  returnTo?: string,
  opts?: { forceAccountChoice?: boolean },
): Promise<void> {
  const url = await prepareAuthorizeUrl('redirect', returnTo, opts);
  window.location.assign(url);
}

/**
 * Build the authorize URL and stash the one-shot PKCE material. Shared by both
 * shapes of the journey — leaving the page, or opening a popup — so the two can
 * never drift apart on scope, PKCE or prompt.
 */
async function prepareAuthorizeUrl(
  mode: 'popup' | 'redirect',
  returnTo?: string,
  opts?: { forceAccountChoice?: boolean },
): Promise<string> {
  const config = await fetchXrplIdentityConfig();
  if (!config) throw new Error('xrplid_not_configured');

  const redirectUri = xrplIdentityRedirectUri();
  if (config.redirectUris.length > 0 && !config.redirectUris.includes(redirectUri)) {
    // Fail loudly here rather than bouncing the user to a provider error page.
    throw new Error('xrplid_redirect_not_registered');
  }

  const verifier = randomBase64url(64);
  // The journey rides in the state so the landing page can read it with no
  // storage at all — see POPUP_STATE_PREFIX for why storage cannot work here.
  const state =
    (mode === 'popup' ? POPUP_STATE_PREFIX : REDIRECT_STATE_PREFIX) + randomBase64url(16);
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

  // Ask again instead of riding the provider's SSO cookie: either the caller
  // asked explicitly ("use another account") or the user logged out last time.
  // The flag is consumed even when the caller forced it, so it never lingers.
  const askedByFlag = consumeAccountChoiceRequest();
  if (opts?.forceAccountChoice || askedByFlag) params.set('prompt', 'login');

  return `${config.authorizeUrl}?${params.toString()}`;
}

// ─── Popup journey ───────────────────────────────────────────────────────────
// The provider forbids framing outright (`X-Frame-Options: DENY`,
// `frame-ancestors 'none'`, checked 2026-08-17) and offers no password grant —
// so an in-page login is impossible, and would be phishing training even if it
// weren't: the user must SEE account.xrpl.in in the address bar. A popup is the
// honest middle ground — their door, on top of our page, which never unloads.

/**
 * Open the window. MUST be called synchronously from the click handler: any
 * `await` before this and Safari/Firefox count it as an unrequested popup and
 * block it. Returns null when blocked, and the caller falls back to the
 * full-page redirect.
 */
export function openXrplIdentityPopup(): Window | null {
  const w = 480;
  const h = 720;
  // Center on the CURRENT screen, not the primary one — multi-monitor setups
  // otherwise open the door on a display the user is not looking at.
  const left = Math.max(0, (window.screenX ?? 0) + ((window.outerWidth || w) - w) / 2);
  const top = Math.max(0, (window.screenY ?? 0) + ((window.outerHeight || h) - h) / 3);
  const popup = window.open(
    'about:blank',
    'xrplIdentity',
    `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`,
  );
  return popup && !popup.closed ? popup : null;
}

export interface PopupLoginResult {
  code: string;
  codeVerifier: string;
  returnTo: string;
}

/**
 * Drive the popup and wait for it to hand back the authorization code.
 *
 * Resolves null when the user simply closed the window — a cancellation is not
 * an error and must not paint one. Throws with the same codes as the redirect
 * path (`state_mismatch`, provider errors) so the caller has one copy table.
 */
export async function runXrplIdentityPopupLogin(
  popup: Window,
  returnTo?: string,
  opts?: { forceAccountChoice?: boolean },
): Promise<PopupLoginResult | null> {
  let url: string;
  try {
    url = await prepareAuthorizeUrl('popup', returnTo, opts);
  } catch (err) {
    popup.close();
    throw err;
  }

  popup.location.href = url;

  return new Promise<PopupLoginResult | null>((resolve, reject) => {
    let settled = false;
    let closeTimer: ReturnType<typeof setInterval> | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      if (closeTimer) clearInterval(closeTimer);
      try {
        if (!popup.closed) popup.close();
      } catch {
        /* already gone */
      }
      fn();
    };

    function onMessage(event: MessageEvent) {
      // Same origin only, and only from the window we opened: a message from
      // anywhere else is somebody else's code trying to seed us one.
      if (event.origin !== window.location.origin) return;
      if (event.source !== popup) return;
      const data = event.data as { type?: string; code?: string; state?: string; error?: string };
      if (data?.type !== XRPLID_MESSAGE) return;

      if (data.error) {
        finish(() => reject(new Error(data.error as string)));
        return;
      }
      if (!data.code || !data.state) {
        finish(() => reject(new Error('state_mismatch')));
        return;
      }
      const consumed = consumeCallback({ code: data.code, state: data.state });
      if (!consumed) {
        finish(() => reject(new Error('state_mismatch')));
        return;
      }
      finish(() => resolve({ code: data.code as string, codeVerifier: consumed.codeVerifier, returnTo: consumed.returnTo }));
    }

    window.addEventListener('message', onMessage);

    // The user can always just close the window. There is no event for that,
    // only polling — and the poll is also our floor against a popup that dies
    // mid-flight, so the button never stays stuck in "signing".
    closeTimer = setInterval(() => {
      if (popup.closed) finish(() => resolve(null));
    }, 500);
  });
}

/**
 * True when this document is the popup coming home AND still has a window to
 * come home to. Both halves must agree: the state says popup, and an opener is
 * there to receive it. See POPUP_STATE_PREFIX.
 *
 * When the state says popup but the opener is gone (the tab was closed, or the
 * browser severed the link), this is false and the caller must say so — that is
 * an orphaned window, not a CSRF attempt, and the two deserve different words.
 */
export function isXrplIdentityPopupCallback(state: string | null | undefined): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (!stateSaysPopup(state)) return false;
    return Boolean(window.opener && window.opener !== window);
  } catch {
    return false;
  }
}

/**
 * Hand the result to the opener and close. Never touches the PKCE material:
 * the verifier lives in the OPENER's sessionStorage (our copy is a clone that
 * dies with this window), and the opener is the one that redeems the code.
 */
export function postCallbackToOpener(payload: { code?: string; state?: string; error?: string }): void {
  window.opener?.postMessage({ type: XRPLID_MESSAGE, ...payload }, window.location.origin);
  window.close();
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

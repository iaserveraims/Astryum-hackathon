/**
 * OAuth (Google / Apple) — browser side.
 *
 * Both providers run entirely in the browser popup and yield an OpenID
 * Connect id_token; the backend (/api/auth/oauth/:provider) is the ONLY
 * place that token is trusted — it verifies signature/iss/aud/exp against
 * the provider's JWKS before any account is touched.
 *
 * Feature-flagged per provider by its NEXT_PUBLIC_* client id (public by
 * design — client ids are not secrets; the flows here never see one).
 * Unset → the login page keeps its honest "channel not open" notice.
 *
 *   NEXT_PUBLIC_GOOGLE_CLIENT_ID   …apps.googleusercontent.com (Web client)
 *   NEXT_PUBLIC_APPLE_CLIENT_ID    the Services ID (e.g. xyz.astryum.web)
 *   NEXT_PUBLIC_APPLE_REDIRECT_URI must EXACTLY match a Return URL registered
 *                                  on the Services ID; defaults to
 *                                  `${origin}/login`. Apple requires https +
 *                                  a registered domain (no localhost).
 */

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? '';
export const APPLE_CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID?.trim() ?? '';

export function googleOAuthEnabled(): boolean {
  return GOOGLE_CLIENT_ID.length > 0;
}
export function appleOAuthEnabled(): boolean {
  return APPLE_CLIENT_ID.length > 0;
}

function appleRedirectUri(): string {
  const explicit = process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return typeof window !== 'undefined' ? `${window.location.origin}/login` : '';
}

// ── Script loaders (one per provider, idempotent) ─────────────────────────────

function loadScript(src: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return;
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`${id}_failed`)));
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`${id}_failed`));
    document.head.appendChild(script);
  });
}

// ── Google Identity Services ──────────────────────────────────────────────────

interface GsiButtonConfig {
  theme?: string;
  size?: string;
  width?: number;
  text?: string;
  shape?: string;
  logo_alignment?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: string }) => void;
          renderButton: (el: HTMLElement, config: GsiButtonConfig) => void;
        };
      };
    };
    AppleID?: {
      auth: {
        init: (config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }) => void;
        signIn: () => Promise<{
          authorization: { id_token: string; code: string; state?: string };
          user?: { email?: string; name?: { firstName?: string; lastName?: string } };
        }>;
      };
    };
  }
}

/**
 * Render the official "Sign in with Google" button into `container` and call
 * `onCredential(idToken)` when the popup completes. Google mandates its own
 * branding for id_token issuance, so the button is theirs (filled_black fits
 * the card); everything after the credential is ours.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  onCredential: (idToken: string) => void,
): Promise<void> {
  if (!googleOAuthEnabled()) throw new Error('google_not_configured');
  await loadScript('https://accounts.google.com/gsi/client', 'google-gsi-client');
  const google = window.google;
  if (!google) throw new Error('google_gsi_unavailable');
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => {
      if (response?.credential) onCredential(response.credential);
    },
  });
  google.accounts.id.renderButton(container, {
    theme: 'filled_black',
    size: 'large',
    text: 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width: Math.min(400, Math.max(180, Math.floor(container.clientWidth || 210))),
  });
}

// ── Sign in with Apple ────────────────────────────────────────────────────────

export interface AppleSignInResult {
  idToken: string;
  /** Apple sends the name ONLY on the very first authorization. */
  profile?: { firstName?: string; lastName?: string };
}

export async function appleSignIn(): Promise<AppleSignInResult> {
  if (!appleOAuthEnabled()) throw new Error('apple_not_configured');
  await loadScript(
    'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
    'apple-auth-js',
  );
  const AppleID = window.AppleID;
  if (!AppleID) throw new Error('apple_js_unavailable');
  AppleID.auth.init({
    clientId: APPLE_CLIENT_ID,
    scope: 'name email',
    redirectURI: appleRedirectUri(),
    usePopup: true,
  });
  const res = await AppleID.auth.signIn();
  const idToken = res?.authorization?.id_token;
  if (!idToken) throw new Error('apple_no_token');
  const name = res.user?.name;
  return {
    idToken,
    profile: name ? { firstName: name.firstName, lastName: name.lastName } : undefined,
  };
}

// ── Shared ────────────────────────────────────────────────────────────────────

/**
 * Non-authoritative peek at a JWT payload (display only — the backend is the
 * verifier). Returns {} on anything malformed.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

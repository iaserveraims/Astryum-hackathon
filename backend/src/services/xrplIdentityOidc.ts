/**
 * xrplIdentityOidc — the XRP Identity (account.xrpl.in) authorization-code
 * exchange.
 *
 * Astryum's front door is the XRPL ecosystem's own identity provider. The
 * browser runs authorization_code + PKCE (S256) and never sees a token: it
 * hands the one-time `code` to this backend, which exchanges it at the
 * provider's /token endpoint and returns the id_token to the existing
 * verification rail (oauthVerify → AuthService.oauthLogin).
 *
 * Why the exchange is server-side even though the client is public:
 *   · the id_token never rides in a URL fragment or browser history,
 *   · the audience/issuer check happens where we control it,
 *   · and if the operator ever moves us to a confidential client, only this
 *     file changes — the secret stays server-side by construction.
 *
 * INVARIANT 2 (no secrets in client code): the registered client is PUBLIC —
 * `token_endpoint_auth_method: "none"` — so there is NO secret to leak. The
 * optional XRPL_IDENTITY_CLIENT_SECRET below exists only because we do not
 * control the registration; if the operator issues a confidential client it is
 * read here, server-side, and never reaches the browser.
 *
 * What this does NOT give us — stated so nobody builds on a wrong assumption:
 * the id_token carries `sub, roles, preferred_username, email, email_verified`
 * and nothing else. No XRPL address, no credential, no KYC. It answers "who is
 * this person", never "which ledger account do they control". That second
 * question has exactly one honest answer and we already implement it: a
 * signature, via the wallet-binding rail (routes/walletBindings.ts).
 *
 * Config (all server-side; never NEXT_PUBLIC_*):
 *   XRPL_IDENTITY_CLIENT_ID      — the registered client id (also the `aud`)
 *   XRPL_IDENTITY_REDIRECT_URIS  — comma-separated allowlist of registered URIs
 *   XRPL_IDENTITY_CLIENT_SECRET  — optional, only if issued a confidential client
 */

export const XRPL_IDENTITY_ISSUER = 'https://account.xrpl.in';
export const XRPL_IDENTITY_AUTHORIZE_URL = `${XRPL_IDENTITY_ISSUER}/auth`;
export const XRPL_IDENTITY_TOKEN_URL = `${XRPL_IDENTITY_ISSUER}/token`;
export const XRPL_IDENTITY_END_SESSION_URL = `${XRPL_IDENTITY_ISSUER}/session/end`;

/** Scopes we ask for — the minimum that identifies a person. Nothing else. */
export const XRPL_IDENTITY_SCOPES = 'openid profile email';

const TOKEN_TIMEOUT_MS = 8_000;

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

export function xrplIdentityConfigured(): boolean {
  return Boolean(process.env.XRPL_IDENTITY_CLIENT_ID?.trim());
}

/**
 * The registered redirect URIs, server-side. The provider enforces its own
 * allowlist, but we pin ours too: a code must come back to a URI we published,
 * not to whatever the caller claims it used.
 */
export function allowedRedirectUris(): string[] {
  return (process.env.XRPL_IDENTITY_REDIRECT_URIS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

export interface ExchangeInput {
  /** One-time authorization code from the provider's redirect. */
  code: string;
  /** The PKCE verifier the browser generated for this attempt. */
  codeVerifier: string;
  /** Which registered redirect URI the browser used. Must be on the allowlist. */
  redirectUri: string;
}

/**
 * Exchange an authorization code for an id_token. Returns the raw id_token —
 * unverified on purpose: verification belongs to oauthVerify, which owns the
 * JWKS cache, the algorithm allowlist and the audience/issuer checks.
 *
 * Throws Error with code: xrplid_not_configured | xrplid_redirect_not_allowed |
 *   xrplid_token_http_<status> | xrplid_token_malformed | xrplid_no_id_token |
 *   xrplid_token_unreachable
 */
export async function exchangeCodeForIdToken(input: ExchangeInput): Promise<string> {
  const clientId = process.env.XRPL_IDENTITY_CLIENT_ID?.trim();
  if (!clientId) fail('xrplid_not_configured');

  const allowed = allowedRedirectUris();
  if (allowed.length === 0 || !allowed.includes(input.redirectUri)) {
    fail('xrplid_redirect_not_allowed');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    code_verifier: input.codeVerifier,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  // Confidential-client fallback: client_secret_basic, server-side only.
  const secret = process.env.XRPL_IDENTITY_CLIENT_SECRET?.trim();
  if (secret) {
    headers.Authorization = `Basic ${Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(secret)}`,
    ).toString('base64')}`;
  }

  let res: Response;
  try {
    res = await fetch(XRPL_IDENTITY_TOKEN_URL, {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch {
    fail('xrplid_token_unreachable');
  }

  if (!res.ok) fail(`xrplid_token_http_${res.status}`);

  let json: { id_token?: unknown };
  try {
    json = (await res.json()) as { id_token?: unknown };
  } catch {
    fail('xrplid_token_malformed');
  }

  const idToken = json.id_token;
  if (typeof idToken !== 'string' || !idToken) fail('xrplid_no_id_token');
  return idToken;
}

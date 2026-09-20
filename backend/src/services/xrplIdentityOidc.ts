/**
 * xrplIdentityOidc — the XRP Identity (account.xrpl.in) authorization-code
 * exchange.
 */

export const XRPL_IDENTITY_ISSUER = 'https://account.xrpl.in';
export const XRPL_IDENTITY_AUTHORIZE_URL = `${XRPL_IDENTITY_ISSUER}/auth`;
export const XRPL_IDENTITY_TOKEN_URL = `${XRPL_IDENTITY_ISSUER}/token`;
export const XRPL_IDENTITY_END_SESSION_URL = `${XRPL_IDENTITY_ISSUER}/session/end`;
export const XRPL_IDENTITY_USERINFO_URL = `${XRPL_IDENTITY_ISSUER}/userinfo`;

/** Scopes we ask for — the minimum that identifies a person. Nothing else. */
export const XRPL_IDENTITY_SCOPES = 'openid profile email';

/**
 * `profile:read` — the key to the user's connected XRPL wallet.
 *
 * The question and its answer, so nobody re-runs the experiment: the provider's
 * profile page lets a user connect an XRPL wallet with Xaman, and we asked
 * whether that address rides along at login. Measured over real logins with the scope granted: the `/userinfo` endpoint does NOT carry it — it
 * returns `sub, roles, preferred_username, email, email_verified` and nothing
 * more, with or without the scope.
 */
export function xrplIdentityProfileScopeEnabled(): boolean {
  return process.env.XRPL_IDENTITY_PROFILE_SCOPE === 'true';
}

export function xrplIdentityScopes(): string {
  return xrplIdentityProfileScopeEnabled()
    ? `${XRPL_IDENTITY_SCOPES} profile:read`
    : XRPL_IDENTITY_SCOPES;
}

const TOKEN_TIMEOUT_MS = 8_000;
const USERINFO_TIMEOUT_MS = 6_000;

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
  return (await exchangeCodeForTokens(input)).idToken;
}

export interface ExchangedTokens {
  idToken: string;
  /** Present when the provider issues one — the key to /userinfo. */
  accessToken?: string;
}

/**
 * Same exchange, but keeping the access token too. Split out rather than
 * changing the old signature: every caller that only ever wanted identity keeps
 * working, and the access token stays where it is used, not everywhere.
 */
export async function exchangeCodeForTokens(input: ExchangeInput): Promise<ExchangedTokens> {
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

  let json: { id_token?: unknown; access_token?: unknown };
  try {
    json = (await res.json()) as { id_token?: unknown; access_token?: unknown };
  } catch {
    fail('xrplid_token_malformed');
  }

  const idToken = json.id_token;
  if (typeof idToken !== 'string' || !idToken) fail('xrplid_no_id_token');
  const accessToken = typeof json.access_token === 'string' ? json.access_token : undefined;
  return { idToken, accessToken };
}

// ─── The wallet question ─────────────────────────────────────────────────────

/** One claim, described without ever repeating what it said. */
export interface ClaimShape {
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';
  /** The claim is a string shaped like an XRPL classic address. */
  xrplAddress?: boolean;
  /** Present but empty — the difference between "not offered" and "not set". */
  empty?: boolean;
}

export interface IdentityProbe {
  at: string;
  scopesRequested: string;
  idTokenClaims: string[];
  userinfo:
    | { ok: true; claims: ClaimShape[] }
    | { ok: false; error: string };
  /** The Account API answer — the operator's documented way in. */
  accountApi?:
    | { ok: true; walletPresent: boolean; looksLikeXrplAddress: boolean }
    | { ok: false; error: string };
}

const XRPL_CLASSIC_ADDRESS = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/**
 * The operator's Account API — where the connected wallet actually lives.
 *
 * Thomas Hussenet: the address is NOT exposed over OIDC, but a
 * client holding `profile:read` can read it here. Same access token, different
 * host: the profile app, not the issuer.
 *
 * His clarification, which decides everything we may do with it: their backend
 * **stores the address the wallet connector returned and does not
 * independently verify or persist cryptographic proof of ownership**. So this
 * is a user-ASSOCIATED hint, not an identity-attested wallet — weaker even than
 * the second-hand proof we assumed. Read-only display is its ceiling. Anything
 * that moves value stays behind our own challenge and the user's signature.
 */
export const XRPL_IDENTITY_ACCOUNT_API = 'https://profile.xrpl.in/account/user-info';

/**
 * Read the wallet the user connected in their XRP Identity profile.
 *
 * Returns null when there is none, when the call fails, or when what comes back
 * is not a classic XRPL address — a caller must never have to tell "absent"
 * from "broken" by inspecting a half-parsed object. Never throws: this sits
 * beside a login.
 */
export async function fetchXrplIdentityWallet(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(XRPL_IDENTITY_ACCOUNT_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // The documented body. `items: []` asks for no per-app payload — we want
      // the account block, not everybody's data about this person.
      body: JSON.stringify({ apps: { items: [] } }),
      signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { account?: { xrplWallet?: { address?: unknown } | null } };
    const address = body?.account?.xrplWallet?.address;
    if (typeof address !== 'string' || !XRPL_CLASSIC_ADDRESS.test(address)) return null;
    return address;
  } catch {
    return null;
  }
}

/** Same call, reporting SHAPE only — for the diagnostic, which keeps no values. */
async function probeAccountApi(accessToken: string): Promise<IdentityProbe['accountApi']> {
  try {
    const res = await fetch(XRPL_IDENTITY_ACCOUNT_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ apps: { items: [] } }),
      signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const body = (await res.json()) as { account?: { xrplWallet?: { address?: unknown } | null } };
    const address = body?.account?.xrplWallet?.address;
    return {
      ok: true,
      walletPresent: body?.account?.xrplWallet != null,
      looksLikeXrplAddress: typeof address === 'string' && XRPL_CLASSIC_ADDRESS.test(address),
    };
  } catch (err) {
    return { ok: false, error: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

// Last few probes, in memory. Not persisted on purpose: this is a question we
// ask once and then act on, not a log we keep about people.
const probes: IdentityProbe[] = [];

export function recentIdentityProbes(): IdentityProbe[] {
  return [...probes];
}

function describe(value: unknown): ClaimShape['kind'] {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  return t === 'string' || t === 'number' || t === 'boolean' ? t : 'object';
}

/**
 * Ask /userinfo what it is willing to tell us, and record the ANSWER'S SHAPE.
 *
 * Names and types only — no values are stored or logged. We are trying to learn
 * whether an XRPL address is reachable at all, and that question is answered by
 * `{ name: 'xrpl_address', kind: 'string', xrplAddress: true }` just as well as
 * by the address itself, without keeping anybody's wallet in our memory.
 *
 * Never throws: this runs beside a login, and a diagnostic must not be able to
 * cost somebody their entrance.
 */
export async function probeUserInfo(accessToken: string, idTokenClaims: string[]): Promise<void> {
  // Both questions on the same token, in parallel — the Account API is now the
  // interesting one, and a slow /userinfo must not delay its answer.
  const accountApi = probeAccountApi(accessToken);

  const record = async (userinfo: IdentityProbe['userinfo']) => {
    probes.unshift({
      at: new Date().toISOString(),
      scopesRequested: xrplIdentityScopes(),
      idTokenClaims,
      userinfo,
      accountApi: await accountApi,
    });
    probes.length = Math.min(probes.length, 5);
  };

  try {
    const res = await fetch(XRPL_IDENTITY_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(USERINFO_TIMEOUT_MS),
    });
    if (!res.ok) {
      await record({ ok: false, error: `http_${res.status}` });
      return;
    }
    const body = (await res.json()) as Record<string, unknown>;
    await record({
      ok: true,
      claims: Object.entries(body).map(([name, value]) => {
        const kind = describe(value);
        const shape: ClaimShape = { name, kind };
        if (kind === 'string') {
          const s = value as string;
          if (!s) shape.empty = true;
          else if (XRPL_CLASSIC_ADDRESS.test(s)) shape.xrplAddress = true;
        }
        return shape;
      }),
    });
  } catch (err) {
    await record({ ok: false, error: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'unreachable' });
  }
}

/**
 * oauthVerify — cryptographic verification of third-party identity tokens.
 *
 * The frontend obtains an OpenID Connect id_token (Google Identity Services
 * popup / Sign in with Apple JS / the XRP Identity authorization-code+PKCE
 * exchange) and it reaches /api/auth/oauth/*. NOTHING in that token is trusted
 * until this module has:
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export type OAuthProvider = 'google' | 'apple' | 'xrplid';

export interface OAuthClaims {
  provider: OAuthProvider;
  /** Stable subject id at the provider — the anchor we store as `oauthSub`. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
  givenName?: string;
  familyName?: string;
  name?: string;
}

interface ProviderConfig {
  jwksUrl: string;
  issuers: string[];
  audienceEnv: string;
  /**
   * Signing algorithms this provider is allowed to use. Kept per-provider and
   * narrow on purpose: an id_token arriving with an algorithm its issuer never
   * uses is an attack, not config drift.
   */
  algs: jwt.Algorithm[];
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    // Google documents both forms of iss.
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    audienceEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    algs: ['RS256'],
  },
  apple: {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    audienceEnv: 'APPLE_OAUTH_CLIENT_ID',
    algs: ['RS256'],
  },
  xrplid: {
    // Verified against https://account.xrpl.in/.well-known/openid-configuration:
    // issuer, jwks_uri, and id_token_signing_alg_values_supported
    // ["EdDSA","RS256","ES256"]. Our client is registered as RS256 — the value
    // the whole rail already verifies — so the narrow list stays narrow.
    jwksUrl: 'https://account.xrpl.in/jwks',
    issuers: ['https://account.xrpl.in'],
    audienceEnv: 'XRPL_IDENTITY_CLIENT_ID',
    algs: ['RS256'],
  },
};

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'apple' || value === 'xrplid';
}

export function oauthProviderConfigured(provider: OAuthProvider): boolean {
  return Boolean(process.env[PROVIDERS[provider].audienceEnv]?.trim());
}

function allowedAudiences(provider: OAuthProvider): string[] {
  return (process.env[PROVIDERS[provider].audienceEnv] ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

// ── JWKS cache ────────────────────────────────────────────────────────────────
// One fetch per provider per hour in the happy path; an unknown kid (key
// rotation) forces a refetch, floored to once per minute so a bad token can't
// turn us into a JWKS hammer.

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

interface JwksCacheEntry {
  keys: Jwk[];
  fetchedAt: number;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_RETRY_FLOOR_MS = 60 * 1000;
const jwksCache = new Map<string, JwksCacheEntry>();

/** Test hook — inject a JWKS so unit tests never touch the network. */
export function _setJwksForTests(url: string, keys: Jwk[]): void {
  jwksCache.set(url, { keys, fetchedAt: Date.now() });
}

async function fetchJwks(url: string): Promise<Jwk[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
  if (!res.ok) throw new Error(`jwks_fetch_${res.status}`);
  const json = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(json.keys)) throw new Error('jwks_malformed');
  return json.keys;
}

async function getSigningKey(url: string, kid: string): Promise<crypto.KeyObject> {
  let entry = jwksCache.get(url);
  const now = Date.now();
  const stale = !entry || now - entry.fetchedAt > JWKS_TTL_MS;
  const missing = entry && !entry.keys.some((k) => k.kid === kid);
  if (stale || (missing && now - (entry?.fetchedAt ?? 0) > JWKS_RETRY_FLOOR_MS)) {
    entry = { keys: await fetchJwks(url), fetchedAt: now };
    jwksCache.set(url, entry);
  }
  const jwk = entry?.keys.find((k) => k.kid === kid);
  if (!jwk) {
    throw Object.assign(new Error('oauth_unknown_key'), { code: 'oauth_unknown_key' });
  }
  return crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
}

// ── Verification ──────────────────────────────────────────────────────────────

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

export async function verifyOAuthIdToken(provider: OAuthProvider, idToken: string): Promise<OAuthClaims> {
  const config = PROVIDERS[provider];
  const audiences = allowedAudiences(provider);
  if (audiences.length === 0) fail('oauth_not_configured');

  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') fail('oauth_token_malformed');
  const { kid, alg } = decoded.header;
  // An algorithm the issuer does not use is an attack, not config drift.
  if (!kid || !config.algs.includes(alg as jwt.Algorithm)) fail('oauth_token_malformed');

  let key: crypto.KeyObject;
  try {
    key = await getSigningKey(config.jwksUrl, kid);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    fail(code === 'oauth_unknown_key' ? 'oauth_unknown_key' : 'oauth_jwks_unavailable');
  }

  let payload: jwt.JwtPayload;
  try {
    // jsonwebtoken types want non-empty tuples; both lists are guaranteed
    // non-empty (audiences checked above, issuers are literals).
    payload = jwt.verify(idToken, key, {
      algorithms: config.algs,
      audience: audiences as [string, ...string[]],
      issuer: config.issuers as [string, ...string[]],
    }) as jwt.JwtPayload;
  } catch {
    fail('oauth_token_invalid');
  }

  if (typeof payload.sub !== 'string' || !payload.sub) fail('oauth_token_invalid');

  const email = typeof payload.email === 'string' && payload.email.includes('@')
    ? payload.email.toLowerCase().trim()
    : null;
  // Google: boolean email_verified. Apple: boolean OR the string "true".
  const rawVerified = (payload as Record<string, unknown>).email_verified;
  const emailVerified = rawVerified === true || rawVerified === 'true';

  return {
    provider,
    sub: payload.sub,
    email,
    emailVerified,
    givenName: typeof payload.given_name === 'string' ? payload.given_name : undefined,
    familyName: typeof payload.family_name === 'string' ? payload.family_name : undefined,
    name: typeof payload.name === 'string' ? payload.name : undefined,
  };
}

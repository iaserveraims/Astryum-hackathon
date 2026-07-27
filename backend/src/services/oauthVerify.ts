/**
 * oauthVerify — cryptographic verification of Google / Apple identity tokens.
 *
 * The frontend obtains an OpenID Connect id_token in the browser (Google
 * Identity Services popup / Sign in with Apple JS) and POSTs it to
 * /api/auth/oauth/:provider. NOTHING in that token is trusted until this
 * module has:
 *
 *   1. fetched the provider's published JWKS (cached in-process),
 *   2. verified the RS256 signature against the key the token names (kid),
 *   3. checked issuer, audience (our client id) and expiry via jwt.verify.
 *
 * Zero new dependencies — same philosophy as AuthService's scrypt: Node's
 * crypto.createPublicKey() imports the JWK natively (Node 17+), and the
 * existing `jsonwebtoken` does the claim checks.
 *
 * Feature-flagged per provider by its client-id env var; the route answers
 * 503 oauth_not_configured until the env is set. Comma-separated values are
 * accepted (e.g. a web + an iOS client id later).
 *
 *   GOOGLE_OAUTH_CLIENT_ID  → aud for Google  (…apps.googleusercontent.com)
 *   APPLE_OAUTH_CLIENT_ID   → aud for Apple   (the Services ID, e.g. xyz.astryum.web)
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export type OAuthProvider = 'google' | 'apple';

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
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    // Google documents both forms of iss.
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    audienceEnv: 'GOOGLE_OAUTH_CLIENT_ID',
  },
  apple: {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    audienceEnv: 'APPLE_OAUTH_CLIENT_ID',
  },
};

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === 'google' || value === 'apple';
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
  // Both providers sign id_tokens with RS256; anything else is an attack, not
  // a config drift.
  if (alg !== 'RS256' || !kid) fail('oauth_token_malformed');

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
      algorithms: ['RS256'],
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

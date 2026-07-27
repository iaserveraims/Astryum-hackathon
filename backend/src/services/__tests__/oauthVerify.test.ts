/**
 * oauthVerify — cryptographic verification of Google/Apple id_tokens.
 *
 * No network: a locally-generated RSA keypair plays the provider, its public
 * JWK is injected into the JWKS cache via _setJwksForTests, and tokens are
 * signed with the private half. Under test: the full happy path (claims out),
 * audience/issuer/expiry rejection, algorithm pinning (RS256 only), unknown
 * kid, and the per-provider config gate.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import {
  _setJwksForTests,
  isOAuthProvider,
  oauthProviderConfigured,
  verifyOAuthIdToken,
} from '../oauthVerify';

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const AUD = 'test-client.apps.googleusercontent.com';
const KID = 'test-key-1';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

const ORIGINAL_GOOGLE = process.env.GOOGLE_OAUTH_CLIENT_ID;
const ORIGINAL_APPLE = process.env.APPLE_OAUTH_CLIENT_ID;

beforeAll(() => {
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  _setJwksForTests(GOOGLE_JWKS_URL, [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' } as never]);
});

beforeEach(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = AUD;
  delete process.env.APPLE_OAUTH_CLIENT_ID;
});

afterAll(() => {
  if (ORIGINAL_GOOGLE === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  else process.env.GOOGLE_OAUTH_CLIENT_ID = ORIGINAL_GOOGLE;
  if (ORIGINAL_APPLE === undefined) delete process.env.APPLE_OAUTH_CLIENT_ID;
  else process.env.APPLE_OAUTH_CLIENT_ID = ORIGINAL_APPLE;
});

function signGoogleToken(
  payload: Record<string, unknown>,
  opts: { audience?: string; issuer?: string; expiresIn?: string | number; keyid?: string } = {},
): string {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    keyid: opts.keyid ?? KID,
    audience: opts.audience ?? AUD,
    issuer: opts.issuer ?? 'https://accounts.google.com',
    subject: 'google-sub-42',
    expiresIn: (opts.expiresIn ?? '5m') as never,
  });
}

describe('verifyOAuthIdToken — happy path', () => {
  test('a well-signed Google token yields normalized claims', async () => {
    const token = signGoogleToken({
      email: 'Ada@Gmail.com',
      email_verified: true,
      name: 'Ada Lovelace',
      given_name: 'Ada',
      family_name: 'Lovelace',
    });
    const claims = await verifyOAuthIdToken('google', token);
    expect(claims).toEqual({
      provider: 'google',
      sub: 'google-sub-42',
      email: 'ada@gmail.com', // lowercased
      emailVerified: true,
      givenName: 'Ada',
      familyName: 'Lovelace',
      name: 'Ada Lovelace',
    });
  });

  test('email_verified as the string "true" (Apple quirk) still counts as verified', async () => {
    const token = signGoogleToken({ email: 'x@y.com', email_verified: 'true' });
    const claims = await verifyOAuthIdToken('google', token);
    expect(claims.emailVerified).toBe(true);
  });
});

describe('verifyOAuthIdToken — rejection', () => {
  test('wrong audience → oauth_token_invalid', async () => {
    const token = signGoogleToken({ email: 'x@y.com' }, { audience: 'someone-else' });
    await expect(verifyOAuthIdToken('google', token)).rejects.toMatchObject({ code: 'oauth_token_invalid' });
  });

  test('wrong issuer → oauth_token_invalid', async () => {
    const token = signGoogleToken({ email: 'x@y.com' }, { issuer: 'https://evil.example' });
    await expect(verifyOAuthIdToken('google', token)).rejects.toMatchObject({ code: 'oauth_token_invalid' });
  });

  test('expired token → oauth_token_invalid', async () => {
    const token = signGoogleToken({ email: 'x@y.com' }, { expiresIn: -60 });
    await expect(verifyOAuthIdToken('google', token)).rejects.toMatchObject({ code: 'oauth_token_invalid' });
  });

  test('HS256 token (algorithm confusion) → oauth_token_malformed, signature never checked', async () => {
    const hs = jwt.sign({ email: 'x@y.com' }, 'shared-secret', {
      algorithm: 'HS256',
      keyid: KID,
      audience: AUD,
      issuer: 'https://accounts.google.com',
      subject: 'google-sub-42',
    });
    await expect(verifyOAuthIdToken('google', hs)).rejects.toMatchObject({ code: 'oauth_token_malformed' });
  });

  test('unknown kid (fresh cache) → oauth_unknown_key without refetching', async () => {
    const token = signGoogleToken({ email: 'x@y.com' }, { keyid: 'rotated-away' });
    await expect(verifyOAuthIdToken('google', token)).rejects.toMatchObject({ code: 'oauth_unknown_key' });
  });

  test('garbage input → oauth_token_malformed', async () => {
    await expect(verifyOAuthIdToken('google', 'not-a-jwt')).rejects.toMatchObject({ code: 'oauth_token_malformed' });
  });

  test('provider without client-id env → oauth_not_configured', async () => {
    const token = signGoogleToken({ email: 'x@y.com' });
    await expect(verifyOAuthIdToken('apple', token)).rejects.toMatchObject({ code: 'oauth_not_configured' });
  });
});

describe('config helpers', () => {
  test('isOAuthProvider narrows exactly google|apple', () => {
    expect(isOAuthProvider('google')).toBe(true);
    expect(isOAuthProvider('apple')).toBe(true);
    expect(isOAuthProvider('github')).toBe(false);
  });

  test('oauthProviderConfigured follows the env', () => {
    expect(oauthProviderConfigured('google')).toBe(true);
    expect(oauthProviderConfigured('apple')).toBe(false);
    process.env.APPLE_OAUTH_CLIENT_ID = 'xyz.astryum.web';
    expect(oauthProviderConfigured('apple')).toBe(true);
  });
});

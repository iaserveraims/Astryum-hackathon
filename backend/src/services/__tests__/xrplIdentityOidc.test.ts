/**
 * xrplIdentityOidc — the XRP Identity authorization-code exchange.
 *
 * The security control worth testing here is the redirect allowlist: a code
 * must only ever be redeemed against a URI we published. The provider enforces
 * its own list, but ours is the one we control, so it gets a test.
 */
import {
  XRPL_IDENTITY_TOKEN_URL,
  allowedRedirectUris,
  exchangeCodeForIdToken,
  xrplIdentityConfigured,
} from '../xrplIdentityOidc';

const REDIRECT = 'https://astryum.xyz/auth/xrpl-identity/callback';
const VERIFIER = 'a'.repeat(64);

const originalFetch = global.fetch;

function mockTokenResponse(body: unknown, ok = true, status = 200): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  process.env.XRPL_IDENTITY_CLIENT_ID = 'astryum-web';
  process.env.XRPL_IDENTITY_REDIRECT_URIS = `${REDIRECT},http://localhost:3000/auth/xrpl-identity/callback`;
  delete process.env.XRPL_IDENTITY_CLIENT_SECRET;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('config helpers', () => {
  test('configured follows the client id env', () => {
    expect(xrplIdentityConfigured()).toBe(true);
    delete process.env.XRPL_IDENTITY_CLIENT_ID;
    expect(xrplIdentityConfigured()).toBe(false);
  });

  test('the redirect allowlist is parsed and trimmed', () => {
    process.env.XRPL_IDENTITY_REDIRECT_URIS = ` ${REDIRECT} , , http://localhost:3000/cb `;
    expect(allowedRedirectUris()).toEqual([REDIRECT, 'http://localhost:3000/cb']);
  });
});

describe('exchangeCodeForIdToken', () => {
  test('exchanges a code and returns the raw id_token', async () => {
    const fetchMock = mockTokenResponse({ id_token: 'header.payload.sig' });

    const idToken = await exchangeCodeForIdToken({
      code: 'abc',
      codeVerifier: VERIFIER,
      redirectUri: REDIRECT,
    });

    expect(idToken).toBe('header.payload.sig');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(XRPL_IDENTITY_TOKEN_URL);

    // PKCE, not a secret: the verifier and the public client id carry the proof.
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    expect(body.get('code_verifier')).toBe(VERIFIER);
    expect(body.get('client_id')).toBe('astryum-web');
    expect(body.get('redirect_uri')).toBe(REDIRECT);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  test('a redirect URI off the allowlist is refused before any network call', async () => {
    const fetchMock = mockTokenResponse({ id_token: 'nope' });

    await expect(
      exchangeCodeForIdToken({
        code: 'abc',
        codeVerifier: VERIFIER,
        redirectUri: 'https://evil.example/callback',
      }),
    ).rejects.toMatchObject({ code: 'xrplid_redirect_not_allowed' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an empty allowlist refuses everything (fail-closed)', async () => {
    delete process.env.XRPL_IDENTITY_REDIRECT_URIS;
    await expect(
      exchangeCodeForIdToken({ code: 'abc', codeVerifier: VERIFIER, redirectUri: REDIRECT }),
    ).rejects.toMatchObject({ code: 'xrplid_redirect_not_allowed' });
  });

  test('missing client id → not configured', async () => {
    delete process.env.XRPL_IDENTITY_CLIENT_ID;
    await expect(
      exchangeCodeForIdToken({ code: 'abc', codeVerifier: VERIFIER, redirectUri: REDIRECT }),
    ).rejects.toMatchObject({ code: 'xrplid_not_configured' });
  });

  test('a token response without id_token is rejected', async () => {
    mockTokenResponse({ access_token: 'only-this' });
    await expect(
      exchangeCodeForIdToken({ code: 'abc', codeVerifier: VERIFIER, redirectUri: REDIRECT }),
    ).rejects.toMatchObject({ code: 'xrplid_no_id_token' });
  });

  test('a non-2xx token response surfaces its status', async () => {
    mockTokenResponse({}, false, 400);
    await expect(
      exchangeCodeForIdToken({ code: 'abc', codeVerifier: VERIFIER, redirectUri: REDIRECT }),
    ).rejects.toMatchObject({ code: 'xrplid_token_http_400' });
  });

  test('a confidential client sends Basic auth, and the secret never leaves the server', async () => {
    process.env.XRPL_IDENTITY_CLIENT_SECRET = 's3cr3t';
    const fetchMock = mockTokenResponse({ id_token: 'tok' });

    await exchangeCodeForIdToken({ code: 'abc', codeVerifier: VERIFIER, redirectUri: REDIRECT });

    const [, init] = fetchMock.mock.calls[0];
    const auth = (init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Basic /);
    expect(Buffer.from(auth.slice(6), 'base64').toString()).toBe('astryum-web:s3cr3t');
    // The secret is never echoed into the form body.
    expect(init.body as string).not.toContain('s3cr3t');
  });
});

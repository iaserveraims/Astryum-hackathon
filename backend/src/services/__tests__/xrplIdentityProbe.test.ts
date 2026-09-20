/**
 * The wallet question, and the rule that makes it safe to ask.
 *
 * We want to know whether XRP Identity hands us an XRPL address at /userinfo
 * once `profile:read` is granted. The probe answers that by recording the SHAPE
 * of the response — names and types — and the thing worth testing is the
 * promise attached to it: **no value ever gets stored**. A diagnostic that
 * quietly kept people's wallet addresses in memory would be a worse problem
 * than the one it solves.
 */
import {
  XRPL_IDENTITY_ACCOUNT_API,
  fetchXrplIdentityWallet,
  XRPL_IDENTITY_SCOPES,
  XRPL_IDENTITY_USERINFO_URL,
  probeUserInfo,
  recentIdentityProbes,
  xrplIdentityProfileScopeEnabled,
  xrplIdentityScopes,
} from '../xrplIdentityOidc';

const ADDRESS = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const originalFetch = global.fetch;

function mockUserInfo(body: unknown, ok = true, status = 200): jest.Mock {
  const fn = jest.fn().mockResolvedValue({ ok, status, json: async () => body } as unknown as Response);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  process.env.XRPL_IDENTITY_PROFILE_SCOPE = 'true';
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.XRPL_IDENTITY_PROFILE_SCOPE;
  jest.restoreAllMocks();
});

describe('the profile scope', () => {
  test('is off unless explicitly turned on — the front door keeps its minimum', () => {
    delete process.env.XRPL_IDENTITY_PROFILE_SCOPE;
    expect(xrplIdentityProfileScopeEnabled()).toBe(false);
    expect(xrplIdentityScopes()).toBe(XRPL_IDENTITY_SCOPES);

    process.env.XRPL_IDENTITY_PROFILE_SCOPE = 'true';
    expect(xrplIdentityScopes()).toBe('openid profile email profile:read');
  });

  test('only the literal true opens it — a stray value must not widen the ask', () => {
    process.env.XRPL_IDENTITY_PROFILE_SCOPE = '1';
    expect(xrplIdentityProfileScopeEnabled()).toBe(false);
  });
});

describe('probeUserInfo', () => {
  test('flags an address-shaped claim WITHOUT keeping the address', async () => {
    mockUserInfo({
      sub: 'user-1',
      email: 'someone@example.com',
      xrpl_address: ADDRESS,
      email_verified: true,
      avatar: null,
      roles: ['user'],
      empty_field: '',
    });

    await probeUserInfo('an-access-token', ['sub', 'email']);
    const [probe] = recentIdentityProbes();

    expect(probe.userinfo.ok).toBe(true);
    if (!probe.userinfo.ok) throw new Error('unreachable');
    const byName = Object.fromEntries(probe.userinfo.claims.map((c) => [c.name, c]));

    expect(byName.xrpl_address).toEqual({ name: 'xrpl_address', kind: 'string', xrplAddress: true });
    expect(byName.email).toEqual({ name: 'email', kind: 'string' });
    expect(byName.email_verified.kind).toBe('boolean');
    expect(byName.avatar.kind).toBe('null');
    expect(byName.roles.kind).toBe('array');
    // "not offered" and "offered but unset" are different answers.
    expect(byName.empty_field.empty).toBe(true);

    // The promise: nothing anybody said comes back out of here.
    const serialised = JSON.stringify(probe);
    expect(serialised).not.toContain(ADDRESS);
    expect(serialised).not.toContain('someone@example.com');
    expect(serialised).not.toContain('an-access-token');
  });

  test('records the scopes that were in force, so a stale answer is recognisable', async () => {
    mockUserInfo({ sub: 'user-1' });
    await probeUserInfo('tok', ['sub']);
    expect(recentIdentityProbes()[0].scopesRequested).toBe('openid profile email profile:read');
  });

  test('a refused or unreachable /userinfo is recorded, never thrown', async () => {
    mockUserInfo({}, false, 403);
    await expect(probeUserInfo('tok', ['sub'])).resolves.toBeUndefined();
    expect(recentIdentityProbes()[0].userinfo).toEqual({ ok: false, error: 'http_403' });

    global.fetch = jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    await expect(probeUserInfo('tok', ['sub'])).resolves.toBeUndefined();
    expect(recentIdentityProbes()[0].userinfo).toEqual({ ok: false, error: 'unreachable' });
  });

  test('asks the provider with the bearer token and keeps only the last few probes', async () => {
    const fetchMock = mockUserInfo({ sub: 'user-1' });
    await probeUserInfo('tok', ['sub']);

    // Both questions go out together now, so find the one we mean rather than
    // assuming an order the code is free to change.
    const call = fetchMock.mock.calls.find((c: unknown[]) => c[0] === XRPL_IDENTITY_USERINFO_URL);
    expect(call).toBeDefined();
    expect((call![1].headers as Record<string, string>).Authorization).toBe('Bearer tok');

    for (let i = 0; i < 8; i++) await probeUserInfo('tok', ['sub']);
    expect(recentIdentityProbes().length).toBeLessThanOrEqual(5);
  });
});

/**
 * The Account API — the operator's documented way to the connected wallet
 * (Thomas Hussenet, 2026-08-19), since OIDC does not carry it.
 *
 * The ceiling matters as much as the plumbing: their backend stores what the
 * wallet connector returned and does NOT verify or persist proof of ownership.
 * So the address is a user-associated hint. These tests pin that we read it
 * correctly, and that a malformed or absent one becomes a clean null rather
 * than something a caller might mistake for a verified binding.
 */
describe('fetchXrplIdentityWallet', () => {
  test('reads the connected address from account.xrplWallet.address', async () => {
    const fetchMock = mockUserInfo({ account: { xrplWallet: { address: ADDRESS } } });

    await expect(fetchXrplIdentityWallet('tok')).resolves.toBe(ADDRESS);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(XRPL_IDENTITY_ACCOUNT_API);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    // The documented body: the account block, not everybody's data about them.
    expect(JSON.parse(init.body as string)).toEqual({ apps: { items: [] } });
  });

  test('a disconnected wallet is null, not an empty-ish object', async () => {
    mockUserInfo({ account: { xrplWallet: null } });
    await expect(fetchXrplIdentityWallet('tok')).resolves.toBeNull();
  });

  test('anything that is not a classic XRPL address is refused', async () => {
    for (const address of ['', 'not-an-address', '0x1234', 'rShort', 123]) {
      mockUserInfo({ account: { xrplWallet: { address } } });
      await expect(fetchXrplIdentityWallet('tok')).resolves.toBeNull();
    }
  });

  test('a refused or unreachable call is null, never a throw beside a login', async () => {
    mockUserInfo({}, false, 403);
    await expect(fetchXrplIdentityWallet('tok')).resolves.toBeNull();

    global.fetch = jest.fn().mockRejectedValue(new Error('boom')) as unknown as typeof fetch;
    await expect(fetchXrplIdentityWallet('tok')).resolves.toBeNull();
  });

  test('the probe records the Account API answer WITHOUT the address', async () => {
    mockUserInfo({ account: { xrplWallet: { address: ADDRESS } }, sub: 'user-1' });
    await probeUserInfo('tok', ['sub']);

    const [probe] = recentIdentityProbes();
    expect(probe.accountApi).toEqual({ ok: true, walletPresent: true, looksLikeXrplAddress: true });
    expect(JSON.stringify(probe)).not.toContain(ADDRESS);
  });
});

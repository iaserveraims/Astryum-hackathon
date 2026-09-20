/**
 * Now: the lookup carries txjson.Account (and whether it is a multisign
 * request) so the backend can decide; a null answer injects nothing; a token
 * the browser slipped into the body never rides the push-for-someone path; and
 * the plain QR path is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
  },
}));

import { POST } from '../create-payload/route';
import { rememberPushToken } from '../pushTokens';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';

const fetchMock = vi.fn();
const ORIGINAL_ENV = { ...process.env };

function makeReq(body: unknown, authorization: string | null = 'Bearer jwt') {
  return {
    json: async () => body,
    headers: new Headers(authorization ? { authorization } : {}),
  } as unknown as Parameters<typeof POST>[0];
}

/** Backend lookup answers `token`; Xaman answers a created payload. */
function route(token: string | null) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/xaman/push-tokens')) {
      return { ok: true, json: async () => ({ userToken: token }) };
    }
    return { ok: true, status: 200, json: async () => ({ uuid: 'u-1', pushed: !!token }) };
  });
}

function xamanBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([u]) => String(u).startsWith('https://xumm.app'));
  return JSON.parse(String(call?.[1]?.body));
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.XAMAN_API_KEY = 'key';
  process.env.XAMAN_API_SECRET = 'secret';
  process.env.BACKEND_API_URL = 'https://backend.test/api';
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

const councilRequest = (extra: Record<string, unknown> = {}) => ({
  txjson: { TransactionType: 'Payment', Account: COUNCIL },
  options: { submit: false, multisign: true, signers: [MEMBER_B] },
  pushPayloadFor: MEMBER_B,
  ...extra,
});

describe('create-payload — push tokens only where the backend allows', () => {
  it('forwards txjson.Account and the multisign flag to the lookup, and injects the allowed token', async () => {
    route('server-allowed-token');
    await POST(makeReq(councilRequest()));

    const lookup = fetchMock.mock.calls.find(([u]) => String(u).includes('/xaman/push-tokens'));
    const qs = new URL(String(lookup?.[0])).searchParams;
    expect(qs.get('address')).toBe(MEMBER_B);
    expect(qs.get('account')).toBe(COUNCIL);
    expect(qs.get('multisign')).toBe('1');
    expect(lookup?.[1]?.headers).toEqual({ Authorization: 'Bearer jwt' });

    const sent = xamanBody();
    expect(sent.user_token).toBe('server-allowed-token');
    expect(sent.pushPayloadFor).toBeUndefined();
  });

  it('a null answer injects nothing — and a token the browser slipped in is stripped', async () => {
    route(null);
    await POST(makeReq(councilRequest({ user_token: 'browser-supplied-token' })));

    const sent = xamanBody();
    expect(sent).not.toHaveProperty('user_token');
    expect(sent.txjson).toEqual({ TransactionType: 'Payment', Account: COUNCIL });
  });

  it('the QR path (no pushPayloadFor) never asks the backend and forwards the payload as before', async () => {
    route('should-not-be-used');
    const body = { txjson: { TransactionType: 'SignIn' }, options: { submit: false } };
    await POST(makeReq(body));

    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/xaman/push-tokens'))).toBe(false);
    expect(xamanBody()).toEqual(body);
  });

  it('without a session header there is no lookup and no token', async () => {
    route('never');
    await POST(makeReq(councilRequest(), null));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/xaman/push-tokens'))).toBe(false);
    expect(xamanBody()).not.toHaveProperty('user_token');
  });
});

describe('rememberPushToken — only the payload uuid travels', () => {
  it('posts { payloadUuid } and nothing the browser could forge', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    await rememberPushToken('3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b', 'Bearer jwt');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://backend.test/api/xaman/push-tokens');
    expect(JSON.parse(String(init.body))).toEqual({ payloadUuid: '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b' });
  });
});

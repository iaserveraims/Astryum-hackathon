/**
 * productizer 13-sep, H2b — Xaman push tokens had no owner.
 *
 * POST stored whatever {xrplAddress, userToken} a session claimed, so anyone
 * could file THEIR token under a council member's address and receive that
 * member's ceremony pushes. GET returned anyone's token, and the payload route
 * injected it into an arbitrary txjson: a branded sign request on a stranger's
 * phone. These pin the floor: the token comes from Xaman's own record of who
 * signed, and it is only handed out for the session's own proven address or a
 * co-signer of the same SignerList on a multisign request.
 */
import express from 'express';
import request from 'supertest';

const mockKvGet = jest.fn();
const mockKvUpsert = jest.fn();
jest.mock('../../services/persistence/backgroundJobKv', () => ({
  kvGet: (...a: unknown[]) => mockKvGet(...a),
  kvUpsert: (...a: unknown[]) => mockKvUpsert(...a),
}));

const mockProven = jest.fn();
jest.mock('../../services/identity/provenAddresses', () => ({
  ...jest.requireActual('../../services/identity/provenAddresses'),
  provenAddressesOf: (...a: unknown[]) => mockProven(...a),
}));

const mockSignerCouncil = jest.fn();
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: { getSignerCouncil: (...a: unknown[]) => mockSignerCouncil(...a) },
}));

import pushTokensRouter from '../xamanPushTokens';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const STRANGER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
const UUID = '3f1c2a9e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';

function buildApp(session: { userId: string; walletAddress: string } | null = { userId: 'user-a', walletAddress: MEMBER_A }) {
  const app = express();
  app.use(express.json());
  if (session) {
    app.use((req, _res, next) => {
      (req as express.Request).siwe = { ...session, sessionId: 's1' };
      next();
    });
  }
  app.use('/api/xaman/push-tokens', pushTokensRouter);
  return app;
}

const fetchMock = jest.fn();
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };

function xamanAnswers(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValue({ ok, status, json: async () => body });
}

const signedPayload = (overrides: Record<string, unknown> = {}) => ({
  meta: { signed: true, resolved: true },
  application: { issued_user_token: 'xaman-issued-token-for-a' },
  response: { account: MEMBER_A, resolved_at: new Date().toISOString() },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  process.env.XAMAN_API_KEY = 'key';
  process.env.XAMAN_API_SECRET = 'secret';
  mockKvGet.mockResolvedValue(null);
  mockKvUpsert.mockResolvedValue(undefined);
  mockProven.mockResolvedValue([MEMBER_A]);
  mockSignerCouncil.mockResolvedValue({
    quorum: 2,
    masterKeyDisabled: true,
    signers: [{ account: MEMBER_A, weight: 1 }, { account: MEMBER_B, weight: 1 }],
  });
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  process.env = { ...ORIGINAL_ENV };
});

describe('POST /api/xaman/push-tokens — the token comes from Xaman, never from the caller', () => {
  it('no session → 401, nothing read, nothing stored', async () => {
    const res = await request(buildApp(null)).post('/api/xaman/push-tokens').send({ payloadUuid: UUID });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockKvUpsert).not.toHaveBeenCalled();
  });

  it('the old forged shape {xrplAddress, userToken} is refused outright', async () => {
    const res = await request(buildApp())
      .post('/api/xaman/push-tokens')
      .send({ xrplAddress: MEMBER_B, userToken: 'attacker-token-000' });
    expect(res.status).toBe(400);
    expect(mockKvUpsert).not.toHaveBeenCalled();
  });

  it('a forged address/token riding next to the uuid is ignored — Xaman says who signed', async () => {
    xamanAnswers(signedPayload());
    const res = await request(buildApp())
      .post('/api/xaman/push-tokens')
      .send({ payloadUuid: UUID, xrplAddress: MEMBER_B, userToken: 'attacker-token-000' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, stored: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://xumm.app/api/v1/platform/payload/${UUID}`);
    expect(init.headers).toEqual({ 'X-API-Key': 'key', 'X-API-Secret': 'secret' });
    expect(mockKvUpsert).toHaveBeenCalledTimes(1);
    const [, , key, payload] = mockKvUpsert.mock.calls[0];
    expect(key).toBe(MEMBER_A);
    expect(payload).toMatchObject({ xrplAddress: MEMBER_A, userToken: 'xaman-issued-token-for-a' });
    // The token never travels back to the caller.
    expect(JSON.stringify(res.body)).not.toContain('xaman-issued-token');
  });

  it('an UNSIGNED payload is refused (409) and nothing is stored', async () => {
    xamanAnswers(signedPayload({ meta: { signed: false, resolved: true } }));
    const res = await request(buildApp()).post('/api/xaman/push-tokens').send({ payloadUuid: UUID });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYLOAD_NOT_SIGNED');
    expect(mockKvUpsert).not.toHaveBeenCalled();
  });

  it('a Xaman read failure is a generic 502 — the upstream body is not reflected', async () => {
    xamanAnswers({ error: { code: 404, reference: 'internal-ref' } }, false, 404);
    const res = await request(buildApp()).post('/api/xaman/push-tokens').send({ payloadUuid: UUID });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'XAMAN_READ_FAILED' });
    expect(mockKvUpsert).not.toHaveBeenCalled();
  });

  it('replaying an older signed payload never overwrites a fresher token', async () => {
    xamanAnswers(signedPayload({ response: { account: MEMBER_A, resolved_at: new Date(Date.now() - 86_400_000).toISOString() } }));
    mockKvGet.mockResolvedValue({ xrplAddress: MEMBER_A, userToken: 'fresh-token-xx', at: new Date().toISOString() });
    const res = await request(buildApp()).post('/api/xaman/push-tokens').send({ payloadUuid: UUID });
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe(false);
    expect(mockKvUpsert).not.toHaveBeenCalled();
  });

  it('without server Xaman credentials nothing is read (503)', async () => {
    delete process.env.XAMAN_API_SECRET;
    const res = await request(buildApp()).post('/api/xaman/push-tokens').send({ payloadUuid: UUID });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/xaman/push-tokens — only your own phone, or a co-signer of the same council', () => {
  const tokenRow = (address: string) => ({ xrplAddress: address, userToken: `token-of-${address}`, at: new Date().toISOString() });
  beforeEach(() => {
    mockKvGet.mockImplementation(async (_t: string, _f: string, key: string) => tokenRow(key));
  });

  it('no session → 401; missing account → 400', async () => {
    expect((await request(buildApp(null)).get('/api/xaman/push-tokens').query({ address: MEMBER_A, account: MEMBER_A })).status).toBe(401);
    expect((await request(buildApp()).get('/api/xaman/push-tokens').query({ address: MEMBER_A })).status).toBe(400);
  });

  it('the session\'s own proven address gets its token', async () => {
    const res = await request(buildApp()).get('/api/xaman/push-tokens').query({ address: MEMBER_A, account: MEMBER_A });
    expect(res.status).toBe(200);
    expect(res.body.userToken).toBe(`token-of-${MEMBER_A}`);
    expect(mockProven).toHaveBeenCalledWith('user-a', MEMBER_A);
  });

  it('a FOREIGN address → null, and its row is never even read', async () => {
    const res = await request(buildApp()).get('/api/xaman/push-tokens').query({ address: STRANGER, account: STRANGER });
    expect(res.status).toBe(200);
    expect(res.body.userToken).toBeNull();
    expect(mockKvGet).not.toHaveBeenCalled();
    expect(mockSignerCouncil).not.toHaveBeenCalled();
  });

  it('a co-signer of the same SignerList, on a multisign request → token', async () => {
    const res = await request(buildApp())
      .get('/api/xaman/push-tokens')
      .query({ address: MEMBER_B, account: COUNCIL, multisign: '1' });
    expect(res.status).toBe(200);
    expect(res.body.userToken).toBe(`token-of-${MEMBER_B}`);
    expect(mockSignerCouncil).toHaveBeenCalledWith(COUNCIL);
  });

  it('the same co-signer WITHOUT multisign → null (a council tx is never single-signed by a member)', async () => {
    const res = await request(buildApp()).get('/api/xaman/push-tokens').query({ address: MEMBER_B, account: COUNCIL });
    expect(res.body.userToken).toBeNull();
    expect(mockKvGet).not.toHaveBeenCalled();
  });

  it('a session holding NO seat in that SignerList → null', async () => {
    mockProven.mockResolvedValue([STRANGER]);
    const res = await request(buildApp({ userId: 'user-x', walletAddress: STRANGER }))
      .get('/api/xaman/push-tokens')
      .query({ address: MEMBER_B, account: COUNCIL, multisign: '1' });
    expect(res.body.userToken).toBeNull();
    expect(mockKvGet).not.toHaveBeenCalled();
  });

  it('a target that is NOT in the SignerList → null', async () => {
    const res = await request(buildApp())
      .get('/api/xaman/push-tokens')
      .query({ address: STRANGER, account: COUNCIL, multisign: '1' });
    expect(res.body.userToken).toBeNull();
  });

  it('an unreadable ledger is not a seat → null', async () => {
    mockSignerCouncil.mockRejectedValue(new Error('websocket down'));
    const res = await request(buildApp())
      .get('/api/xaman/push-tokens')
      .query({ address: MEMBER_B, account: COUNCIL, multisign: '1' });
    expect(res.status).toBe(200);
    expect(res.body.userToken).toBeNull();
  });
});

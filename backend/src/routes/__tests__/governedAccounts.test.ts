const mockFindMany = jest.fn();
const mockUpsert = jest.fn();
const mockUpdateMany = jest.fn();

/**
 * The live session the POST now proves inside its own transaction. `live` is what the row lock + session read see; flip it to
 * simulate a takeover that committed while the request was in flight.
 */
const live = { userRows: 1, user: null as unknown, session: null as unknown };

jest.mock('../../database/prismaClient', () => {
  const client: Record<string, unknown> = {
    governedAccount: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      upsert: (...a: unknown[]) => mockUpsert(...a),
      updateMany: (...a: unknown[]) => mockUpdateMany(...a),
    },
    user: {
      updateMany: async () => ({ count: live.userRows }),
      findUnique: async () => live.user,
    },
    session: { findUnique: async () => live.session },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

import express from 'express';
import request from 'supertest';
import governedAccountsRouter from '../governedAccounts';

const USER_ID = 'user-1';
const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';

function buildApp(withSession = true) {
  const app = express();
  app.use(express.json());
  if (withSession) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: { userId: string } }).siwe = {
        userId: USER_ID,
        sessionId: 's1',
        walletAddress: '0x0',
      } as never;
      next();
    });
  }
  app.use('/api/governed-accounts', governedAccountsRouter);
  return app;
}

beforeEach(() => {
  mockFindMany.mockReset();
  mockUpsert.mockReset();
  mockUpdateMany.mockReset();
  live.userRows = 1;
  live.user = { isActive: true, preferences: null };
  live.session = {
    id: 's1',
    userId: USER_ID,
    isActive: true,
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3_600_000),
  };
});

describe('GET /api/governed-accounts', () => {
  test('no session → 401, prisma untouched', async () => {
    const res = await request(buildApp(false)).get('/api/governed-accounts');
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  test('lists only the caller\'s active pointers', async () => {
    mockFindMany.mockResolvedValue([{ id: 'g1', ecosystem: 'xrpl', address: COUNCIL, label: null, createdAt: new Date(0) }]);
    const res = await request(buildApp()).get('/api/governed-accounts');
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, removedAt: null } }),
    );
  });
});

describe('POST /api/governed-accounts', () => {
  test('valid XRPL address → upsert scoped to the user, revives removed rows', async () => {
    mockUpsert.mockResolvedValue({ id: 'g1', ecosystem: 'xrpl', address: COUNCIL, label: 'Familia', createdAt: new Date(0) });
    const res = await request(buildApp())
      .post('/api/governed-accounts')
      .send({ address: COUNCIL, label: 'Familia' });
    expect(res.status).toBe(201);
    expect(res.body.account.address).toBe(COUNCIL);
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg.where).toEqual({
      userId_ecosystem_address: { userId: USER_ID, ecosystem: 'xrpl', address: COUNCIL },
    });
    expect(arg.update.removedAt).toBeNull();
  });

  test('non-XRPL address → 400, nothing written', async () => {
    const res = await request(buildApp())
      .post('/api/governed-accounts')
      .send({ address: '0xEabCD745000000000000000000000000000000cd' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_XRPL_ADDRESS');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  test('unsupported ecosystem → 400 (only xrpl is readable today)', async () => {
    const res = await request(buildApp())
      .post('/api/governed-accounts')
      .send({ address: COUNCIL, ecosystem: 'evm' });
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  /**
   * A pointer says which councils the authority
   * switcher shows. A request that passed requireSiweAuth before a takeover
   * would otherwise land AFTER it and plant the intruder's council on the owner.
   */
  describe('a takeover that commits while the request is in flight', () => {
    test.each([
      ['the session was revoked', () => { (live.session as { isActive: boolean }).isActive = false; }],
      ['the account is disabled', () => { live.user = { isActive: false, preferences: null }; }],
      ['the session predates the credential epoch', () => {
        const epoch = new Date().toISOString();
        live.user = { isActive: true, preferences: { security: { credentialsEpoch: epoch, takeoverAt: epoch } } };
        (live.session as { createdAt: Date }).createdAt = new Date(Date.now() - 3_600_000);
      }],
    ])('%s → 401 session_revoked and NO row is written', async (_label, kill) => {
      kill();
      const res = await request(buildApp())
        .post('/api/governed-accounts')
        .send({ address: COUNCIL, label: 'Familia' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('session_revoked');
      expect(typeof res.body.detail).toBe('string');
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });
});

describe('PATCH + DELETE /api/governed-accounts/:id', () => {
  test('rename is scoped to the caller (updateMany where userId)', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 });
    const res = await request(buildApp())
      .patch('/api/governed-accounts/g1')
      .send({ label: 'Consejo familiar' });
    expect(res.status).toBe(200);
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'g1', userId: USER_ID, removedAt: null } }),
    );
  });

  test('delete is a soft-remove; someone else\'s row → 404', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 });
    const res = await request(buildApp()).delete('/api/governed-accounts/not-mine');
    expect(res.status).toBe(404);
    const arg = mockUpdateMany.mock.calls[0][0];
    expect(arg.data.removedAt).toBeInstanceOf(Date);
  });
});

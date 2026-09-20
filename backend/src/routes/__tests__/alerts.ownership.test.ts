/**
 * productizer 13-sep — the alert inbox had no owner.
 *
 * GET matched the wallet by address alone (any session read anyone's inbox by
 * typing a public address) and PATCH /:id/read acknowledged any alert id.
 * These fail on the code as it shipped before the fix.
 */
import express from 'express';
import request from 'supertest';

const mockWalletFindMany = jest.fn();
const mockWalletFindFirst = jest.fn();
const mockAlertFindMany = jest.fn();
const mockAlertFindUnique = jest.fn();
const mockAlertUpdate = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: {
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
      findFirst: (...a: unknown[]) => mockWalletFindFirst(...a),
    },
    alert: {
      findMany: (...a: unknown[]) => mockAlertFindMany(...a),
      findUnique: (...a: unknown[]) => mockAlertFindUnique(...a),
      update: (...a: unknown[]) => mockAlertUpdate(...a),
    },
  },
}));

import alertsRouter from '../alerts';

const USER = 'user-1';
const ADDRESS = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';

function buildApp(userId: string | null = USER) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  app.use('/api/alerts', alertsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAlertFindMany.mockResolvedValue([]);
});

describe('GET /api/alerts — only the session user\'s wallets', () => {
  it('looks the address up among THIS user\'s wallet rows', async () => {
    mockWalletFindMany.mockResolvedValue([{ id: 'w1' }]);
    mockAlertFindMany.mockResolvedValue([{ id: 'a1', walletId: 'w1' }]);

    const res = await request(buildApp()).get('/api/alerts').query({ address: ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(mockWalletFindMany).toHaveBeenCalledWith({
      where: { userId: USER, address: { equals: ADDRESS, mode: 'insensitive' } },
      select: { id: true },
    });
  });

  it('someone else\'s address reads as an empty inbox', async () => {
    mockWalletFindMany.mockResolvedValue([]); // no row of THIS user has that address

    const res = await request(buildApp('user-stranger')).get('/api/alerts').query({ address: ADDRESS });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, alerts: [] });
    expect(mockAlertFindMany.mock.calls[0][0].where.walletId).toEqual({ in: [] });
  });

  it('no session → 401', async () => {
    const res = await request(buildApp(null)).get('/api/alerts').query({ address: ADDRESS });
    expect(res.status).toBe(401);
    expect(mockWalletFindMany).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/alerts/:id/read — only an alert on one of your wallets', () => {
  it('own alert → acknowledged', async () => {
    mockAlertFindUnique.mockResolvedValue({ id: 'a1', walletId: 'w1' });
    mockWalletFindFirst.mockResolvedValue({ id: 'w1' });
    mockAlertUpdate.mockResolvedValue({ id: 'a1', acknowledged: true });

    const res = await request(buildApp()).patch('/api/alerts/a1/read').send({});

    expect(res.status).toBe(200);
    expect(mockWalletFindFirst).toHaveBeenCalledWith({ where: { id: 'w1', userId: USER }, select: { id: true } });
    expect(mockAlertUpdate).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { acknowledged: true } });
  });

  it('another user\'s alert → the same 404 as a missing one, nothing written', async () => {
    mockAlertFindUnique.mockResolvedValue({ id: 'a1', walletId: 'w-other' });
    mockWalletFindFirst.mockResolvedValue(null);

    const res = await request(buildApp()).patch('/api/alerts/a1/read').send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('alert_not_found');
    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });

  it('a missing id and an alert with no wallet both 404 without writing', async () => {
    mockAlertFindUnique.mockResolvedValueOnce(null);
    expect((await request(buildApp()).patch('/api/alerts/nope/read').send({})).status).toBe(404);
    mockAlertFindUnique.mockResolvedValueOnce({ id: 'a2', walletId: null });
    expect((await request(buildApp()).patch('/api/alerts/a2/read').send({})).status).toBe(404);
    expect(mockAlertUpdate).not.toHaveBeenCalled();
  });

  it('no session → 401', async () => {
    const res = await request(buildApp(null)).patch('/api/alerts/a1/read').send({});
    expect(res.status).toBe(401);
    expect(mockAlertFindUnique).not.toHaveBeenCalled();
  });
});

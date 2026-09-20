/**
 * IDOR — rules are scoped to the session user. Another user must get exactly
 * the answer a missing id gets (404), and nothing may be written before the
 * ownership check: no update, no delete, no composed payment, no runs read.
 */
const mockWalletFindFirst = jest.fn();
const mockWalletFindMany = jest.fn();
const mockProtocolFindFirst = jest.fn();
const mockRuleCreate = jest.fn();
const mockRuleFindMany = jest.fn();
const mockRuleFindUnique = jest.fn();
const mockRuleUpdate = jest.fn();
const mockRuleDelete = jest.fn();
const mockRunFindMany = jest.fn();
const mockCompose = jest.fn();

/** The session the create re-checks inside its transaction; tests flip it. */
const mockLiveSession = { active: true };

jest.mock('../../database/prismaClient', () => {
  const client: Record<string, unknown> = {
    wallet: {
      findFirst: (...a: unknown[]) => mockWalletFindFirst(...a),
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
    },
    protocol: { findFirst: (...a: unknown[]) => mockProtocolFindFirst(...a) },
    automationRule: {
      create: (...a: unknown[]) => mockRuleCreate(...a),
      findMany: (...a: unknown[]) => mockRuleFindMany(...a),
      findUnique: (...a: unknown[]) => mockRuleFindUnique(...a),
      update: (...a: unknown[]) => mockRuleUpdate(...a),
      delete: (...a: unknown[]) => mockRuleDelete(...a),
    },
    automationRun: { findMany: (...a: unknown[]) => mockRunFindMany(...a) },
    user: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ isActive: true, preferences: null }),
    },
    session: {
      findUnique: async ({ where }: any) => ({
        id: where.id,
        userId: 'u1',
        isActive: mockLiveSession.active,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 3_600_000),
      }),
    },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

jest.mock('../../services/ScheduledPaymentService', () => ({
  composeScheduledPaymentTx: (...a: unknown[]) => mockCompose(...a),
}));

import express from 'express';
import request from 'supertest';
import rulesRouter from '../rules';

function makeApp(userId?: string) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: unknown }).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  app.use('/api/rules', rulesRouter);
  return app;
}

const owner = makeApp('u1');
const other = makeApp('u2');

// Stored EIP-55; callers may send lowercase.
const EVM_WALLET = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const WALLET_ROW = { id: 'w1', address: EVM_WALLET, chainId: 14, userId: 'u1' };
const RULE = {
  id: 'rule-1',
  walletId: 'w1',
  name: 'Domiciliación',
  enabled: true,
  action: {
    kind: 'scheduledPayment',
    params: { destination: 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh', amountDrops: '1000000' },
  },
  wallet: { address: EVM_WALLET, userId: 'u1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  // Prisma does not filter by user on its own: these fakes answer the WHERE
  // the route actually sends, so a missing userId filter would leak here too.
  mockWalletFindMany.mockImplementation(async ({ where }: any) => {
    if (where.userId !== WALLET_ROW.userId) return [];
    if (where.address && where.address.equals.toLowerCase() !== WALLET_ROW.address.toLowerCase()) return [];
    return [{ id: WALLET_ROW.id }];
  });
  mockWalletFindFirst.mockImplementation(async ({ where }: any) => {
    if (where.userId !== WALLET_ROW.userId) return null;
    const addr = typeof where.address === 'string' ? where.address : where.address.equals;
    return addr.toLowerCase() === WALLET_ROW.address.toLowerCase() ? WALLET_ROW : null;
  });
  mockRuleFindUnique.mockImplementation(async ({ where }: any) => (where.id === RULE.id ? RULE : null));
  mockRuleFindMany.mockResolvedValue([RULE]);
  mockRuleUpdate.mockImplementation(async ({ data }: any) => ({ ...RULE, ...data }));
  mockRuleDelete.mockResolvedValue(RULE);
  mockRunFindMany.mockResolvedValue([{ id: 'run-1' }]);
  mockCompose.mockReturnValue({ xrplTx: { TransactionType: 'Payment' }, summary: 'pay' });
  mockLiveSession.active = true;
});

const createBody = {
  walletAddress: EVM_WALLET,
  chainId: 14,
  name: 'Protect',
  trigger: { type: 'HF_BELOW', threshold: 1.5 },
};

describe('The owner, with a session that died mid-request (4.4)', () => {
  it('POST / → 401 session_revoked and NO rule is created', async () => {
    mockRuleCreate.mockResolvedValue({ id: 'rule-new' });
    mockLiveSession.active = false;

    const res = await request(owner).post('/api/rules').send(createBody);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_revoked');
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('with the session alive the same request creates the rule', async () => {
    mockRuleCreate.mockResolvedValue({ id: 'rule-new' });

    const res = await request(owner).post('/api/rules').send(createBody);

    expect(res.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledTimes(1);
  });
});

describe('another user (u2) — every rule route answers 404 and writes nothing', () => {
  it('GET /?address= of u1 wallet → 404, rules never read', async () => {
    const res = await request(other).get('/api/rules').query({ address: EVM_WALLET });
    expect(res.status).toBe(404);
    expect(mockRuleFindMany).not.toHaveBeenCalled();
  });

  it('POST / onto u1 wallet → 404 wallet_not_registered, nothing created', async () => {
    const res = await request(other).post('/api/rules').send(createBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('wallet_not_registered');
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('PATCH /:id (rewriting the payment destination) → 404, update not called', async () => {
    const res = await request(other)
      .patch('/api/rules/rule-1')
      .send({ action: { kind: 'scheduledPayment', params: { destination: 'rAttacker1111111111111111111', amountDrops: '1' } } });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'rule_not_found' });
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });

  it('POST /:id/enable → 404, update not called', async () => {
    const res = await request(other).post('/api/rules/rule-1/enable');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'rule_not_found' });
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });

  it('POST /:id/disable → 404, update not called', async () => {
    const res = await request(other).post('/api/rules/rule-1/disable');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'rule_not_found' });
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });

  it('DELETE /:id → 404, delete not called', async () => {
    const res = await request(other).delete('/api/rules/rule-1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'rule_not_found' });
    expect(mockRuleDelete).not.toHaveBeenCalled();
  });

  it('POST /:id/scheduled-payment/prepare → 404, nothing composed', async () => {
    const res = await request(other).post('/api/rules/rule-1/scheduled-payment/prepare');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'rule_not_found' });
    expect(mockCompose).not.toHaveBeenCalled();
  });

  it('GET /:id/runs → 404, runs never read', async () => {
    const res = await request(other).get('/api/rules/rule-1/runs');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'rule_not_found' });
    expect(mockRunFindMany).not.toHaveBeenCalled();
  });

  it('a foreign rule is indistinguishable from a missing one', async () => {
    const foreign = await request(other).post('/api/rules/rule-1/enable');
    const missing = await request(owner).post('/api/rules/no-such-rule/enable');
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe('the owner (u1) — unchanged behaviour', () => {
  it('GET /?address= (lowercase of an EIP-55 row) → 200', async () => {
    const res = await request(owner).get('/api/rules').query({ address: EVM_WALLET.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('POST / → 201 bound to the owner wallet', async () => {
    mockRuleCreate.mockResolvedValue({ id: 'rule-2' });
    const res = await request(owner).post('/api/rules').send(createBody);
    expect(res.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ walletId: 'w1' }) }),
    );
  });

  it('PATCH /:id → 200', async () => {
    const res = await request(owner).patch('/api/rules/rule-1').send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(mockRuleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'rule-1' }, data: expect.objectContaining({ name: 'Renamed' }) }),
    );
  });

  it('POST /:id/enable and /disable → 200', async () => {
    expect((await request(owner).post('/api/rules/rule-1/enable')).status).toBe(200);
    expect((await request(owner).post('/api/rules/rule-1/disable')).status).toBe(200);
    expect(mockRuleUpdate).toHaveBeenCalledTimes(2);
  });

  it('DELETE /:id → 204', async () => {
    const res = await request(owner).delete('/api/rules/rule-1');
    expect(res.status).toBe(204);
    expect(mockRuleDelete).toHaveBeenCalledWith({ where: { id: 'rule-1' } });
  });

  it('POST /:id/scheduled-payment/prepare → 200 composed from the owner wallet', async () => {
    const res = await request(owner).post('/api/rules/rule-1/scheduled-payment/prepare');
    expect(res.status).toBe(200);
    expect(mockCompose).toHaveBeenCalledWith(EVM_WALLET, RULE.action.params);
    expect(res.body.disclosure.disclosedToUser).toBe(true);
  });

  it('GET /:id/runs → 200', async () => {
    const res = await request(owner).get('/api/rules/rule-1/runs');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

describe('no session', () => {
  it('→ 401 before any lookup', async () => {
    const res = await request(makeApp()).get('/api/rules/rule-1/runs');
    expect(res.status).toBe(401);
    expect(mockRuleFindUnique).not.toHaveBeenCalled();
  });
});

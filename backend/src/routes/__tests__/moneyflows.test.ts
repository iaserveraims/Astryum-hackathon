const mockWalletFindMany = jest.fn();
const mockRuleFindMany = jest.fn();
const mockRuleUpdateMany = jest.fn();
const mockRuleDeleteMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: { findMany: (...a: unknown[]) => mockWalletFindMany(...a) },
    automationRule: {
      findMany: (...a: unknown[]) => mockRuleFindMany(...a),
      updateMany: (...a: unknown[]) => mockRuleUpdateMany(...a),
      deleteMany: (...a: unknown[]) => mockRuleDeleteMany(...a),
    },
  },
}));

import express from 'express';
import request from 'supertest';
import moneyflowsRouter from '../moneyflows';

const USER_ID = 'user-1';

/** requireSiweAuth sets req.siwe in production; every wallet lookup is scoped to it. */
function buildApp(userId: string | null = USER_ID) {
  const a = express();
  a.use(express.json());
  if (userId) {
    a.use((req, _res, next) => {
      (req as express.Request).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  a.use('/api/moneyflows', moneyflowsRouter);
  return a;
}
const app = buildApp();

const WALLET = '0xEabCD745000000000000000000000000000000cd';

const VALID_CMF = {
  version: 'cmf/0.1',
  id: 'cmf-test-0001',
  name: 'Protege mi carry',
  description: 'Si el HF baja de 1.5, prepara un repay de 25 USDT0 que tú firmas.',
  direction: 'protect',
  origin: { source: 'ai_copilot' },
  steps: [
    {
      level: 1,
      trigger: { kind: 'health-factor', comparator: 'below', threshold: 1.5 },
      actions: [
        { verb: 'repay', asset: { symbol: 'USDT0' }, amount: { type: 'absolute', value: '25' }, venue: { protocolId: 'kinetic' } },
      ],
    },
  ],
  policy: { cooldownMinutes: 60, disclosedToUser: true },
};

beforeEach(() => {
  mockWalletFindMany.mockReset();
  mockRuleFindMany.mockReset();
  mockRuleUpdateMany.mockReset();
  mockRuleDeleteMany.mockReset();
});

describe('POST /api/moneyflows/translate — deterministic dry-run, zero writes', () => {
  test('valid CMF → rule payloads with canonicalRef (nothing persisted)', async () => {
    const res = await request(app).post('/api/moneyflows/translate').send({ cmf: VALID_CMF });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('sign-at-trigger');
    expect(res.body.rules).toHaveLength(1);
    expect(res.body.rules[0].canonicalRef).toBe('cmf-test-0001');
    expect(res.body.rules[0].action.params.amount).toBe('25000000');
    // read-only module: no prisma delegate was touched
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    expect(mockRuleFindMany).not.toHaveBeenCalled();
  });

  test('malformed CMF → 400 with zod issues', async () => {
    const res = await request(app)
      .post('/api/moneyflows/translate')
      .send({ cmf: { ...VALID_CMF, policy: { cooldownMinutes: 0, disclosedToUser: true } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_cmf');
  });

  test('valid shape but untranslatable → 422 with readable errors (explicit degradation)', async () => {
    const res = await request(app)
      .post('/api/moneyflows/translate')
      .send({
        cmf: {
          ...VALID_CMF,
          steps: [
            {
              ...VALID_CMF.steps[0],
              trigger: { kind: 'price', asset: { symbol: 'XRP' }, comparator: 'below', threshold: 2 },
            },
          ],
        },
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('cmf_not_translatable');
    expect(res.body.errors.map((e: { code: string }) => e.code)).toContain('trigger_not_supported');
  });
});

describe('GET /api/moneyflows — rules grouped by canonicalRef', () => {
  test('groups a wallet\'s CMF rules into flows and strips the · L suffix', async () => {
    mockWalletFindMany.mockResolvedValue([{ id: 'w1' }]);
    mockRuleFindMany.mockResolvedValue([
      { id: 'r1', name: 'Protege mi carry · L1', canonicalRef: 'cmf-a', enabled: true },
      { id: 'r2', name: 'Protege mi carry · L2', canonicalRef: 'cmf-a', enabled: false },
      { id: 'r3', name: 'Compound FTSO · L1', canonicalRef: 'cmf-b', enabled: false },
    ]);
    const res = await request(app).get('/api/moneyflows').query({ address: WALLET });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const [a, b] = res.body.flows;
    expect(a).toMatchObject({ canonicalRef: 'cmf-a', name: 'Protege mi carry', enabled: true });
    expect(a.rules).toHaveLength(2);
    expect(b).toMatchObject({ canonicalRef: 'cmf-b', name: 'Compound FTSO', enabled: false });
    // only canonicalRef-linked rules were queried
    expect(mockRuleFindMany.mock.calls[0][0].where.canonicalRef).toEqual({ not: null });
  });

  // El schema es deliberadamente laxo desde 2026-07-19 (min(4).max(64)): la
  // regex EVM-only devolvía 400 a toda wallet XRPL (r…). "Inválida" hoy =
  // demasiado corta para CUALQUIER chain; una dirección desconocida pero
  // bien formada devuelve lista vacía, no error.
  test('invalid address (too short for any chain) → 400', async () => {
    const res = await request(app).get('/api/moneyflows').query({ address: 'xx' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/moneyflows/capability — the honest matrix', () => {
  // The matrix moved twice in the window and this pin moved WITH the truth:
  // 'price' became real on Flare (M3, live FTSO vs the rule's baseline) and
  // XRPL stopped being ∅ (M4: transfer/supply over the live rule rails).
  test('Flare lists real triggers only; XRPL lists what its live rails serve', async () => {
    const res = await request(app).get('/api/moneyflows/capability');
    expect(res.status).toBe(200);
    const flare = res.body.chains.find((c: { chain: string }) => c.chain === 'eip155:14');
    expect(flare.mode).toBe('sign-at-trigger');
    expect(flare.triggers).toEqual(['health-factor', 'ltv', 'reward', 'idle-balance', 'time', 'price']);
    const xrpl = res.body.chains.find((c: { chain: string }) => c.chain === 'xrpl:0');
    expect(xrpl.mode).toBe('sign-at-trigger');
    expect(xrpl.verbs).toEqual(['transfer', 'supply']);
    expect(xrpl.triggers).toEqual(['time', 'idle-balance', 'price']);
  });
});

describe('flow-level revoke — pause/resume/delete by canonicalRef (guardarraíl: revocación instantánea)', () => {
  const REF = 'cmf-test-0001';

  test('pause flips every rule of the flow off, scoped to the caller wallet', async () => {
    mockWalletFindMany.mockResolvedValue([{ id: 'w1' }]);
    mockRuleFindMany.mockResolvedValue([{ id: 'r1', expiresAt: null }, { id: 'r2', expiresAt: null }]);
    mockRuleUpdateMany.mockResolvedValue({ count: 2 });
    const res = await request(app).post(`/api/moneyflows/${REF}/pause`).send({ address: WALLET });
    expect(res.status).toBe(200);
    expect(res.body.paused).toBe(2);
    expect(mockRuleUpdateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['r1', 'r2'] } },
      data: { enabled: false },
    });
  });

  test('resume re-arms only unexpired rules; a fully expired flow → 409 flow_expired', async () => {
    mockWalletFindMany.mockResolvedValue([{ id: 'w1' }]);
    mockRuleFindMany.mockResolvedValue([{ id: 'r1', expiresAt: new Date('2020-01-01') }]);
    mockRuleUpdateMany.mockResolvedValue({ count: 0 }); // the expiry filter matched nothing
    const res = await request(app).post(`/api/moneyflows/${REF}/resume`).send({ address: WALLET });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('flow_expired');
    // The updateMany carried the not-expired filter (TTL cannot be resurrected by resume)
    expect(mockRuleUpdateMany.mock.calls[0][0].where.OR).toBeDefined();
  });

  test('delete removes the whole flow; unknown flow → 404', async () => {
    mockWalletFindMany.mockResolvedValue([{ id: 'w1' }]);
    mockRuleFindMany.mockResolvedValue([{ id: 'r1', expiresAt: null }]);
    mockRuleDeleteMany.mockResolvedValue({ count: 1 });
    const ok = await request(app).delete(`/api/moneyflows/${REF}`).query({ address: WALLET });
    expect(ok.status).toBe(200);
    expect(ok.body.deleted).toBe(1);

    mockRuleFindMany.mockResolvedValue([]);
    const miss = await request(app).delete(`/api/moneyflows/nope-ref`).query({ address: WALLET });
    expect(miss.status).toBe(404);
  });
});

/**
 * productizer 13-sep — a public address is not a key.
 *
 * The wallet lookups matched the address ALONE, so any session listed, paused,
 * resumed or deleted another user's flows by typing their address. These fail
 * on the code as it shipped before the fix (no userId in any `where`).
 */
describe('ownership — every wallet lookup is the session user\'s', () => {
  const REF = 'cmf-test-0001';

  test('GET asks for THIS user\'s wallet rows with that address', async () => {
    mockWalletFindMany.mockResolvedValue([{ id: 'w1' }]);
    mockRuleFindMany.mockResolvedValue([]);
    await request(app).get('/api/moneyflows').query({ address: WALLET });
    expect(mockWalletFindMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, address: { equals: WALLET, mode: 'insensitive' } },
      select: { id: true },
    });
  });

  test('a foreign address reads as an empty list', async () => {
    mockWalletFindMany.mockResolvedValue([]); // no row of this user carries it
    mockRuleFindMany.mockResolvedValue([]);
    const res = await request(buildApp('user-stranger')).get('/api/moneyflows').query({ address: WALLET });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, flows: [] });
    expect(mockRuleFindMany.mock.calls[0][0].where.walletId).toEqual({ in: [] });
  });

  test('pause / resume / delete on a foreign address → 404 and nothing is touched', async () => {
    mockWalletFindMany.mockResolvedValue([]);
    const stranger = buildApp('user-stranger');

    expect((await request(stranger).post(`/api/moneyflows/${REF}/pause`).send({ address: WALLET })).status).toBe(404);
    expect((await request(stranger).post(`/api/moneyflows/${REF}/resume`).send({ address: WALLET })).status).toBe(404);
    expect((await request(stranger).delete(`/api/moneyflows/${REF}`).query({ address: WALLET })).status).toBe(404);

    expect(mockRuleFindMany).not.toHaveBeenCalled();
    expect(mockRuleUpdateMany).not.toHaveBeenCalled();
    expect(mockRuleDeleteMany).not.toHaveBeenCalled();
    for (const call of mockWalletFindMany.mock.calls) {
      expect(call[0].where.userId).toBe('user-stranger');
    }
  });

  test('no session → 401 on every wallet-scoped route', async () => {
    const anon = buildApp(null);
    expect((await request(anon).get('/api/moneyflows').query({ address: WALLET })).status).toBe(401);
    expect((await request(anon).post(`/api/moneyflows/${REF}/pause`).send({ address: WALLET })).status).toBe(401);
    expect((await request(anon).post(`/api/moneyflows/${REF}/resume`).send({ address: WALLET })).status).toBe(401);
    expect((await request(anon).delete(`/api/moneyflows/${REF}`).query({ address: WALLET })).status).toBe(401);
    expect(mockWalletFindMany).not.toHaveBeenCalled();
  });
});

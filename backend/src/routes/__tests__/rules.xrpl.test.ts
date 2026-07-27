/**
 * A.1 — rules are chain-agnostic: an XRPL wallet can create/list rules.
 * The old EVM-only address schema 400'd every XRPL rule BEFORE the wallet
 * lookup — the same failure class as Flare's F1 (registered wallet, 404 rule).
 */
const mockWalletFindFirst = jest.fn();
const mockWalletFindMany = jest.fn();
const mockProtocolFindFirst = jest.fn();
const mockRuleCreate = jest.fn();
const mockRuleFindMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: {
      findFirst: (...a: unknown[]) => mockWalletFindFirst(...a),
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
    },
    protocol: { findFirst: (...a: unknown[]) => mockProtocolFindFirst(...a) },
    automationRule: {
      create: (...a: unknown[]) => mockRuleCreate(...a),
      findMany: (...a: unknown[]) => mockRuleFindMany(...a),
    },
  },
}));

import express from 'express';
import request from 'supertest';
import rulesRouter from '../rules';

const app = express();
app.use(express.json());
app.use('/api/rules', rulesRouter);

const XRPL_WALLET = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const XRPL_WALLET_ROW = { id: 'w-xrpl-1', address: XRPL_WALLET, chainId: -1, userId: 'u1' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/rules — XRPL savings-escrow rule (A.1 + B.1)', () => {
  const body = {
    walletAddress: XRPL_WALLET,
    chainId: 1440002,
    name: 'Ahorro semanal',
    trigger: { type: 'IDLE_BALANCE', asset: 'XRP', minUSD: 50 },
    action: { kind: 'escrow', params: { amountDrops: '10000000', lockDays: 30 } },
  };

  it('creates a rule for a registered XRPL wallet (chainId −1 row found via fallback)', async () => {
    // First lookup (address+chainId 1440002) misses; the any-chain fallback hits.
    mockWalletFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(XRPL_WALLET_ROW);
    mockRuleCreate.mockResolvedValue({ id: 'rule-1', ...body });

    const res = await request(app).post('/api/rules').send(body);
    expect(res.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ walletId: 'w-xrpl-1' }) }),
    );
  });

  it('unregistered XRPL wallet → 404 wallet_not_registered (not 400 invalid_body)', async () => {
    mockWalletFindFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/rules').send(body);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('wallet_not_registered');
  });

  it('TIME_TRIGGER rules validate (DCA rail)', async () => {
    mockWalletFindFirst.mockResolvedValueOnce(XRPL_WALLET_ROW);
    mockRuleCreate.mockResolvedValue({ id: 'rule-2' });
    const res = await request(app)
      .post('/api/rules')
      .send({ ...body, name: 'DCA semanal', trigger: { type: 'TIME_TRIGGER', cron: '0 9 * * 1' } });
    expect(res.status).toBe(201);
  });

  it('still rejects a malformed address (neither EVM nor XRPL)', async () => {
    const res = await request(app).post('/api/rules').send({ ...body, walletAddress: 'not-a-wallet' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
  });
});

describe('GET /api/rules — XRPL address accepted', () => {
  it('lists rules for an XRPL wallet', async () => {
    mockWalletFindMany.mockResolvedValue([{ id: 'w-xrpl-1' }]);
    mockRuleFindMany.mockResolvedValue([{ id: 'rule-1', name: 'Ahorro semanal' }]);
    const res = await request(app).get('/api/rules').query({ address: XRPL_WALLET });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

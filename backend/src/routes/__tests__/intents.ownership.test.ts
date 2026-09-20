/**
 * IDOR — intents are scoped to the session user. An intent belongs to whoever
 * owns a wallet row for `intent.owner` (case-insensitive). Anyone else gets
 * the 404 a missing id gets, and no FSM transition runs before the check.
 */
const mockWalletFindMany = jest.fn();
const mockGetIntent = jest.fn();
const mockListUserIntents = jest.fn();
const mockCancelIntent = jest.fn();
const mockTransition = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: { findMany: (...a: unknown[]) => mockWalletFindMany(...a) },
  },
}));

jest.mock('../../engines/intent/IntentEngine', () => ({
  IntentEngine: {
    getInstance: () => ({
      getIntent: (...a: unknown[]) => mockGetIntent(...a),
      listUserIntents: (...a: unknown[]) => mockListUserIntents(...a),
      cancelIntent: (...a: unknown[]) => mockCancelIntent(...a),
      transition: (...a: unknown[]) => mockTransition(...a),
    }),
  },
}));

import express from 'express';
import request from 'supertest';
import intentsRouter from '../intents';

function makeApp(userId?: string) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: unknown }).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  app.use('/api/intents', intentsRouter);
  return app;
}

const owner = makeApp('u1');
const other = makeApp('u2');

// Wallet row stored EIP-55; the intent carries the lowercase form.
const EVM_WALLET = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const INTENT = { id: 'intent-1', owner: EVM_WALLET.toLowerCase(), status: 'proposed' };
const EVM_HASH = `0x${'ab'.repeat(32)}`;
const XRPL_HASH = 'C'.repeat(64);

beforeEach(() => {
  jest.clearAllMocks();
  mockWalletFindMany.mockImplementation(async ({ where }: any) =>
    where.userId === 'u1' ? [{ address: EVM_WALLET }] : [{ address: '0x1111111111111111111111111111111111111111' }],
  );
  mockGetIntent.mockImplementation(async (id: string) => (id === INTENT.id ? INTENT : null));
  mockListUserIntents.mockResolvedValue([INTENT]);
  mockCancelIntent.mockResolvedValue({ ...INTENT, status: 'expired' });
  mockTransition.mockImplementation(async (_id: string, to: string, payload?: { txHash?: string }) => ({
    ...INTENT,
    status: to,
    txHash: payload?.txHash,
  }));
});

describe('another user (u2) — 404 and no transition', () => {
  it('GET /?address= of u1 wallet → 404, intents never listed', async () => {
    const res = await request(other).get('/api/intents').query({ address: EVM_WALLET });
    expect(res.status).toBe(404);
    expect(mockListUserIntents).not.toHaveBeenCalled();
  });

  it('GET /:id → 404 intent_not_found', async () => {
    const res = await request(other).get('/api/intents/intent-1');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'intent_not_found' });
  });

  it('POST /:id/cancel → 404, cancelIntent not called', async () => {
    const res = await request(other).post('/api/intents/intent-1/cancel').send({ reason: 'x' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'intent_not_found' });
    expect(mockCancelIntent).not.toHaveBeenCalled();
  });

  it('POST /:id/submitted → 404, transition not called', async () => {
    const res = await request(other).post('/api/intents/intent-1/submitted').send({ txHash: EVM_HASH });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'intent_not_found' });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('a foreign intent is indistinguishable from a missing one', async () => {
    const foreign = await request(other).get('/api/intents/intent-1');
    const missing = await request(owner).get('/api/intents/no-such-intent');
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe('the owner (u1) — unchanged behaviour', () => {
  it('GET /?address= (lowercase of an EIP-55 row) → 200', async () => {
    const res = await request(owner).get('/api/intents').query({ address: EVM_WALLET.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(mockListUserIntents).toHaveBeenCalledWith(EVM_WALLET.toLowerCase());
  });

  it('GET /:id → 200', async () => {
    const res = await request(owner).get('/api/intents/intent-1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('intent-1');
  });

  it('POST /:id/cancel → 200', async () => {
    const res = await request(owner).post('/api/intents/intent-1/cancel').send({ reason: 'changed my mind' });
    expect(res.status).toBe(200);
    expect(mockCancelIntent).toHaveBeenCalledWith('intent-1', 'changed my mind');
  });

  it('POST /:id/submitted with an EVM hash → SIGNED then SUBMITTED', async () => {
    const res = await request(owner).post('/api/intents/intent-1/submitted').send({ txHash: EVM_HASH });
    expect(res.status).toBe(200);
    expect(mockTransition).toHaveBeenNthCalledWith(1, 'intent-1', 'SIGNED');
    expect(mockTransition).toHaveBeenNthCalledWith(2, 'intent-1', 'SUBMITTED', { txHash: EVM_HASH });
  });

  it('POST /:id/submitted with an XRPL hash → 200', async () => {
    const res = await request(owner).post('/api/intents/intent-1/submitted').send({ txHash: XRPL_HASH });
    expect(res.status).toBe(200);
  });

  it('POST /:id/submitted with an EIP-5792 hex bundle id (no tx hash came back) → 200', async () => {
    // The settlement tracker keeps the call-bundle id as the reference when
    // getCallsStatus returns no transactionHash; a hash-only rule blocked the
    // legitimate owner with a 400.
    const BUNDLE_ID = `0x${'cd'.repeat(40)}`;
    const res = await request(owner).post('/api/intents/intent-1/submitted').send({ txHash: BUNDLE_ID });
    expect(res.status).toBe(200);
    expect(mockTransition).toHaveBeenNthCalledWith(2, 'intent-1', 'SUBMITTED', { txHash: BUNDLE_ID });
  });

  it.each([
    ['too short', 'abcd'],
    ['0x + 63 hex', `0x${'a'.repeat(63)}`],
    ['non-hex', 'z'.repeat(64)],
    ['a call id that is not hex', 'batch-123'],
  ])('POST /:id/submitted rejects a non-hash txHash (%s) → 400, no transition', async (_label, bad) => {
    const res = await request(owner).post('/api/intents/intent-1/submitted').send({ txHash: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_body');
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('no session', () => {
  it('→ 401 before any lookup', async () => {
    const res = await request(makeApp()).get('/api/intents/intent-1');
    expect(res.status).toBe(401);
    expect(mockGetIntent).not.toHaveBeenCalled();
  });
});

/**
 * productizer it. 22, «Menor» / it. 23 — THE CHALLENGE DOOR HAS A LIMIT, AND IT
 * SAYS SO IN ITS OWN WORDS.
 *
 * `POST /challenge` had no rate limit at all: a stolen session could mint
 * challenges in a loop, and (before the same iteration's burn) grind each one
 * with unlimited signature attempts. The cap lives in StepUpAuth; here is the
 * plumbing that turns it into an answer a screen can read — 429 with a real
 * `Retry-After` and `retryable: true`, never the 400 that would read as «what
 * you sent is wrong» nor the generic 503 that promises a retry in two seconds.
 */
const mockGetConfig = jest.fn();
const mockSetConfig = jest.fn();
jest.mock('../../services/StepUpLockService', () => ({
  getConfig: (...a: unknown[]) => mockGetConfig(...a),
  setConfig: (...a: unknown[]) => mockSetConfig(...a),
}));

jest.mock('../../middleware/requireStepUp', () => ({
  requireStepUp: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockBindingFindFirst = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: { walletBinding: { findFirst: (...a: unknown[]) => mockBindingFindFirst(...a) } },
}));

import express from 'express';
import request from 'supertest';
import securityStepUpRouter from '../securityStepUp';
import { _resetStepUpChallengesForTests } from '../../services/StepUpAuth';

const ADDRESS = '0x1111111111111111111111111111111111111111';

function buildApp(userId = 'user-1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { siwe: unknown }).siwe = {
      userId,
      sessionId: 's1',
      walletAddress: ADDRESS,
    } as never;
    next();
  });
  app.use('/api/security/step-up', securityStepUpRouter);
  return app;
}

let errSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  _resetStepUpChallengesForTests();
  mockGetConfig.mockResolvedValue({ grantTtlSeconds: 300 });
  mockBindingFindFirst.mockResolvedValue({ id: 'b1' });
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

describe('POST /api/security/step-up/challenge — the per-user cap', () => {
  it('issues challenges up to the cap, then answers 429 with a wait and a sentence', async () => {
    const app = buildApp();
    for (let i = 0; i < 20; i += 1) {
      const ok = await request(app).post('/api/security/step-up/challenge').send({
        feature: 'goals',
        action: 'write',
        address: ADDRESS,
      });
      expect(ok.status).toBe(200);
    }

    const res = await request(app).post('/api/security/step-up/challenge').send({
      feature: 'goals',
      action: 'write',
      address: ADDRESS,
    });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('TOO_MANY_STEP_UP_CHALLENGES');
    expect(res.body.retryable).toBe(true);
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBe(String(res.body.retryAfterSeconds));
    // It says what did NOT happen, and never blames the person's signature.
    expect(res.body.detail).toMatch(/Nothing was changed and nothing was granted/i);
    expect(res.body.detail).not.toMatch(/signature/i);
  });

  it('the cap is per account — another session is untouched by it', async () => {
    const one = buildApp('user-1');
    for (let i = 0; i < 20; i += 1) {
      await request(one).post('/api/security/step-up/challenge').send({ feature: 'goals', action: 'write', address: ADDRESS });
    }
    const blocked = await request(one)
      .post('/api/security/step-up/challenge')
      .send({ feature: 'goals', action: 'write', address: ADDRESS });
    expect(blocked.status).toBe(429);

    const other = await request(buildApp('user-2'))
      .post('/api/security/step-up/challenge')
      .send({ feature: 'goals', action: 'write', address: ADDRESS });
    expect(other.status).toBe(200);
    expect(typeof other.body.nonce).toBe('string');
  });

  it('a bad address is still the caller\'s 400 — the cap did not swallow it', async () => {
    const res = await request(buildApp())
      .post('/api/security/step-up/challenge')
      .send({ feature: 'goals', action: 'write', address: '0xnope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/security/step-up/verify — a burned nonce is a verdict, not a 503', () => {
  it('a second attempt on a spent challenge is nonce_unknown, not a fault of ours', async () => {
    const app = buildApp();
    const ch = await request(app)
      .post('/api/security/step-up/challenge')
      .send({ feature: 'goals', action: 'write', address: ADDRESS });

    const body = {
      feature: 'goals',
      action: 'write',
      address: ADDRESS,
      nonce: ch.body.nonce,
      message: ch.body.message,
      signature: '0xdeadbeef',
    };
    const first = await request(app).post('/api/security/step-up/verify').send(body);
    expect(first.status).toBe(422);
    expect(first.body).toEqual({ error: 'signature_invalid', retryable: false });

    const second = await request(app).post('/api/security/step-up/verify').send(body);
    expect(second.status).toBe(422);
    expect(second.body.error).toBe('nonce_unknown');
  });

  it('a failure of OURS is still the retryable 503, never a verdict about the signature', async () => {
    const app = buildApp();
    mockGetConfig.mockRejectedValueOnce(new Error('pool exhausted'));
    const res = await request(app).post('/api/security/step-up/verify').send({
      feature: 'goals',
      action: 'write',
      address: ADDRESS,
      nonce: 'whatever',
      message: 'Nonce: whatever',
      signature: '0xdeadbeef',
    });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'STEP_UP_UNAVAILABLE', retryable: true });
    expect(res.body.detail).toMatch(/that is us, not your signature/i);
  });
});

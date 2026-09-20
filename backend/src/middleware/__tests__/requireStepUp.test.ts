/**
 * EL RADIO DEL STEP-UP, Y POR QUÉ LA LECTURA NO SE CIERRA.
 *
 * Turned a failed read of the step-up lock table from «grant» into
 * «refuse», which was right: an unreadable lock table must not let someone edit
 * the very protection they could not be shown to have. The comment justifying
 * it said «the only door this guards is the one that CHANGES the step-up
 * matrix». That was FALSE. With STEP_UP_ENABLED=1 the same middleware also
 * fronts four whole routers through `stepUpGuard`, reads included:
 *
 *   /api/wallets/bindings · /api/rules · /api/moneyflows · /api/alerts
 *
 * So a database blip answered 503 to GET /api/wallets/bindings — the proven
 * addresses of this account — and to the rules, moneyflows and alerts that
 * watch somebody's capital. «No pude leer» had become «you may not look at your
 * own money».
 *
 * The rule now: fail closed on WRITES, open on READS. A GET changes nothing,
 * signs nothing and undoes nothing, so refusing it buys no safety; a refused
 * write costs a retry and nothing else.
 */
const mockIsLocked = jest.fn();
jest.mock('../../services/StepUpLockService', () => ({
  isLocked: (...a: unknown[]) => mockIsLocked(...a),
}));
jest.mock('../../services/StepUpAuth', () => ({
  verifyGrant: jest.fn().mockReturnValue({ ok: false }),
}));

import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requireStepUp, stepUpGuard } from '../requireStepUp';

const OLD_ENV = process.env.STEP_UP_ENABLED;

function buildApp(guard: express.RequestHandler) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { siwe: unknown }).siwe = { userId: 'u1', sessionId: 's1', walletAddress: '0xabc' };
    next();
  });
  app.use('/api/rules', guard);
  app.get('/api/rules', (_req, res) => { res.json({ ok: true, read: true }); });
  app.post('/api/rules', (_req, res) => { res.json({ ok: true, wrote: true }); });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STEP_UP_ENABLED = '1';
});
afterAll(() => {
  if (OLD_ENV === undefined) delete process.env.STEP_UP_ENABLED;
  else process.env.STEP_UP_ENABLED = OLD_ENV;
});

describe('an unreadable lock table never hides a person from their own money', () => {
  it('a READ passes through — nothing changes, so nothing is protected by refusing', async () => {
    mockIsLocked.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp(stepUpGuard('rules_alerts'))).get('/api/rules');

    expect(res.status).toBe(200);
    expect(res.body.read).toBe(true);
  });

  it('a WRITE still refuses, and says so as a retry rather than a fault of the caller', async () => {
    mockIsLocked.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp(stepUpGuard('rules_alerts'))).post('/api/rules').send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('STEP_UP_LOCK_UNREADABLE');
    expect(res.body.retryable).toBe(true);
    expect(res.body.detail).toMatch(/Nothing was changed/i);
  });

  it('the matrix door itself (requireStepUp write) keeps failing closed', async () => {
    mockIsLocked.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp(requireStepUp('wallet_security', 'write'))).post('/api/rules').send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('STEP_UP_LOCK_UNREADABLE');
  });

  it('an explicit read guard is open too — the action decides, not the HTTP verb alone', async () => {
    mockIsLocked.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp(requireStepUp('rules_alerts', 'read'))).get('/api/rules');

    expect(res.status).toBe(200);
  });
});

describe('nothing else moved', () => {
  it('a READABLE lock still gates the read: 403 without a grant', async () => {
    mockIsLocked.mockResolvedValue(true);

    const res = await request(buildApp(stepUpGuard('rules_alerts'))).get('/api/rules');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('STEP_UP_REQUIRED');
    expect(res.body.action).toBe('read');
  });

  it('a READABLE lock still gates the write: 403 without a grant', async () => {
    mockIsLocked.mockResolvedValue(true);

    const res = await request(buildApp(stepUpGuard('rules_alerts'))).post('/api/rules').send({});

    expect(res.status).toBe(403);
    expect(res.body.action).toBe('write');
  });

  it('an unlocked cell passes, read and write alike', async () => {
    mockIsLocked.mockResolvedValue(false);
    const app = buildApp(stepUpGuard('rules_alerts'));

    expect((await request(app).get('/api/rules')).status).toBe(200);
    expect((await request(app).post('/api/rules').send({})).status).toBe(200);
  });

  it('the global kill-switch still short-circuits everything (the table is never read)', async () => {
    process.env.STEP_UP_ENABLED = '0';
    mockIsLocked.mockRejectedValue(new Error('should never be called'));

    const res = await request(buildApp(stepUpGuard('rules_alerts'))).post('/api/rules').send({});

    expect(res.status).toBe(200);
    expect(mockIsLocked).not.toHaveBeenCalled();
  });
});

/**
 * The comment in requireStepUp.ts names its own blast radius. A comment that
 * drifts from the wiring is how the last one became false — so the wiring is
 * asserted, not trusted.
 */
describe('the radius written in the middleware is the radius that is mounted', () => {
  const INDEX = readFileSync(join(__dirname, '..', '..', 'index-simple.ts'), 'utf8');

  it.each([
    ['/api/wallets/bindings', 'wallet_security'],
    ['/api/rules', 'rules_alerts'],
    ['/api/moneyflows', 'rules_alerts'],
    ['/api/alerts', 'rules_alerts'],
  ])('%s is still fronted by stepUpGuard(%s) — reads included', (path, feature) => {
    const line = INDEX.split('\n').find((l) => l.includes(`'${path}'`) && l.includes('stepUpGuard'));
    expect(line).toBeDefined();
    expect(line).toContain(`stepUpGuard('${feature}')`);
  });

  it('requireStepUp.ts lists those four paths in its own reasoning', () => {
    const SRC = readFileSync(join(__dirname, '..', 'requireStepUp.ts'), 'utf8');
    for (const path of ['/api/wallets/bindings', '/api/rules', '/api/moneyflows', '/api/alerts']) {
      expect(SRC).toContain(path);
    }
    // The old claim survives only as a quotation that the next paragraph
    // refutes — deleting it would hide the mistake instead of recording it
    // (nothing built is destroyed; the reasoning is what future readers need).
    expect(SRC).toContain('THE RADIUS IN THAT COMMENT WAS WRONG');
    // And the fail-closed is narrowed in code, not just in prose.
    expect(SRC).toContain("if (action === 'read') return next();");
  });
});

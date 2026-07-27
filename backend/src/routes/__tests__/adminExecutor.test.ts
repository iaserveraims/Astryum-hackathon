/**
 * adminExecutor — el modal de desatasco de /app/admin (Sistema).
 *
 * Qué se prueba y por qué:
 *  1. MISMAS PUERTAS que el panel: sin envs la superficie 404ea (ni revela que
 *     existe); una x-admin-key errónea es 401. El POST mueve estado del
 *     watcher — un gate flojo aquí sería un botón de operador abierto a
 *     cualquiera.
 *  2. Validación del POST: hash que no es un tx hash XRPL de 64-hex → 400;
 *     op fuera de 'retry'|'park' → 400. Nada llega al watcher sin pasarlas.
 *  3. Passthrough: GET /stuck devuelve el snapshot del watcher + checkedAt;
 *     POST /unstick entrega (hash, op, reason) tal cual y devuelve el
 *     resultado del watcher sin adornarlo.
 *
 * El watcher real se stubbea: su comportamiento (park/retry/kick) tiene su
 * propia suite en services/flare/__tests__/DirectMintExecutorService.unstick.test.ts.
 */

// requireAdmin vive en adminPanel.ts, que arrastra prisma + waitlist (mailer)
// + requireSiweAuth al cargar el módulo — mismos stubs que adminPanel.test.ts.
jest.mock('../../database/prismaClient', () => ({ prisma: {} }));
jest.mock('../../services/waitlistMailer', () => ({
  sendWaitlistWelcome: jest.fn(),
  mailerDiag: jest.fn(),
  verifyMailer: jest.fn(),
  testSend: jest.fn(),
}));
jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: jest.fn(async (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
    res.status(401).json({ error: 'UNAUTHENTICATED' });
  }),
}));

const mockListStuck = jest.fn();
const mockUnstick = jest.fn();
jest.mock('../../services/flare/DirectMintExecutorService', () => ({
  directMintExecutorWatcher: {
    listStuck: (...a: unknown[]) => mockListStuck(...a),
    unstick: (...a: unknown[]) => mockUnstick(...a),
  },
}));

import express from 'express';
import request from 'supertest';
import adminExecutorRouter from '../adminExecutor';
import { _resetKeyFailuresForTests } from '../adminPanel';

const PANEL_KEY = 'orbital-hangar-9';
const HASH = 'A'.repeat(64);
const ORIGINAL_ADMIN_EMAILS = process.env.ADMIN_EMAILS;
const ORIGINAL_ADMIN_PANEL_KEY = process.env.ADMIN_PANEL_KEY;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin-executor', adminExecutorRouter);
  return app;
}

beforeEach(() => {
  mockListStuck.mockReset();
  mockUnstick.mockReset();
  _resetKeyFailuresForTests();
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_PANEL_KEY;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_EMAILS === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  if (ORIGINAL_ADMIN_PANEL_KEY === undefined) delete process.env.ADMIN_PANEL_KEY;
  else process.env.ADMIN_PANEL_KEY = ORIGINAL_ADMIN_PANEL_KEY;
});

describe('gate — las mismas puertas que el panel', () => {
  it('404 cuando NINGÚN env está configurado (la superficie no existe)', async () => {
    const res = await request(buildApp()).get('/api/admin-executor/stuck');
    expect(res.status).toBe(404);
    expect(mockListStuck).not.toHaveBeenCalled();
  });

  it('401 con x-admin-key errónea; el watcher jamás se toca', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const res = await request(buildApp())
      .post('/api/admin-executor/unstick')
      .set('x-admin-key', 'wrong')
      .send({ hash: HASH, op: 'retry' });
    expect(res.status).toBe(401);
    expect(mockUnstick).not.toHaveBeenCalled();
  });
});

describe('GET /stuck', () => {
  it('devuelve el snapshot del watcher + checkedAt', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const snapshot = {
      pending: [{ hash: HASH, direction: 'entrante', action: 'e1' }],
      parked: [],
      watcher: { enabled: true, hasKey: true, running: false, lastTickAt: null },
    };
    mockListStuck.mockResolvedValue(snapshot);
    const res = await request(buildApp()).get('/api/admin-executor/stuck').set('x-admin-key', PANEL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.pending).toEqual(snapshot.pending);
    expect(res.body.watcher.enabled).toBe(true);
    expect(typeof res.body.checkedAt).toBe('string');
  });
});

describe('POST /unstick — validación antes de tocar el watcher', () => {
  beforeEach(() => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
  });

  it('400 INVALID_HASH cuando no es un tx hash XRPL de 64-hex', async () => {
    const res = await request(buildApp())
      .post('/api/admin-executor/unstick')
      .set('x-admin-key', PANEL_KEY)
      .send({ hash: '0xdeadbeef', op: 'retry' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_HASH');
    expect(mockUnstick).not.toHaveBeenCalled();
  });

  it("400 INVALID_OP fuera de 'retry'|'park'", async () => {
    const res = await request(buildApp())
      .post('/api/admin-executor/unstick')
      .set('x-admin-key', PANEL_KEY)
      .send({ hash: HASH, op: 'delete' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_OP');
    expect(mockUnstick).not.toHaveBeenCalled();
  });

  it('entrega (hash, op, reason) tal cual y devuelve el resultado del watcher', async () => {
    const result = { ok: true, op: 'park', hash: HASH, detail: 'aparcado', kicked: false, envSkipListed: false };
    mockUnstick.mockResolvedValue(result);
    const res = await request(buildApp())
      .post('/api/admin-executor/unstick')
      .set('x-admin-key', PANEL_KEY)
      .send({ hash: HASH, op: 'park', reason: 'lo miro mañana' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(result);
    expect(mockUnstick).toHaveBeenCalledWith(HASH, 'park', 'lo miro mañana');
  });
});

/**
 * adminAnchorGate — armar la puerta del ancla v2 desde /app/admin.
 *
 * Qué se fija:
 *  1. MISMAS PUERTAS que el panel: sin envs, 404 (la superficie no existe);
 *     x-admin-key errónea, 401 — y el armador jamás se toca. Este router SÍ
 *     firma (con la clave operativa del ancla): un gate flojo aquí sería la
 *     puerta del ancla en manos de cualquiera.
 *  2. Armar es SECO por defecto: `POST /arm` sin `dryRun: false` explícito no
 *     firma nada. Encender una puerta de consenso en mainnet es un acto que se
 *     pide dos veces.
 *  3. Las negativas tipadas del armador salen legibles: sin ancla/seed → 503,
 *     ancla compartida con el Legacy → 409 (armarla dejaría fuera a consejos
 *     sin título).
 *
 * El armador real se stubbea: su plan (qué conjuntos, qué reserva) tiene su
 * propia suite pura en services/__tests__/XrplAnchorGateService.exactSet.test.ts.
 */

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

const mockArm = jest.fn();
const mockDisarm = jest.fn();
const mockRead = jest.fn();
const mockConfig = jest.fn();
jest.mock('../../services/XrplAnchorGateOps', () => ({
  armAnchorGate: (...a: unknown[]) => mockArm(...a),
  disarmAnchorGate: (...a: unknown[]) => mockDisarm(...a),
  readAnchorGateState: (...a: unknown[]) => mockRead(...a),
  anchorGateConfig: (...a: unknown[]) => mockConfig(...a),
  configuredGateSets: () => [],
  anchorGateDrift: () => ({ missing: [], extra: [] }),
}));

import express from 'express';
import request from 'supertest';
import router from '../adminAnchorGate';
import { _resetKeyFailuresForTests } from '../adminPanel';

const PANEL_KEY = 'orbital-hangar-9';
const ANCHOR = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const KEYS = ['ADMIN_EMAILS', 'ADMIN_PANEL_KEY', 'ASTRYUM_ORDER_ANCHOR', 'ASTRYUM_ANCHOR_SEED'] as const;
const saved: Record<string, string | undefined> = {};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin-anchor-gate', router);
  return app;
}

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  mockArm.mockReset();
  mockDisarm.mockReset();
  mockRead.mockReset();
  mockConfig.mockReset();
  _resetKeyFailuresForTests();
});

afterAll(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('gate — las mismas puertas que el panel', () => {
  it('404 sin ningún env: la superficie no existe', async () => {
    const res = await request(buildApp()).post('/api/admin-anchor-gate/arm').send({ dryRun: false });
    expect(res.status).toBe(404);
    expect(mockArm).not.toHaveBeenCalled();
  });

  it('401 con x-admin-key errónea; el armador jamás se toca', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const res = await request(buildApp()).post('/api/admin-anchor-gate/arm').set('x-admin-key', 'wrong').send({ dryRun: false });
    expect(res.status).toBe(401);
    expect(mockArm).not.toHaveBeenCalled();
  });
});

describe('POST /arm — seco por defecto', () => {
  it('sin dryRun explícito NO firma: el armador recibe dryRun=true', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockArm.mockResolvedValue({ anchor: ANCHOR, dryRun: true, submitted: [] });
    const res = await request(buildApp()).post('/api/admin-anchor-gate/arm').set('x-admin-key', PANEL_KEY).send({});
    expect(res.status).toBe(200);
    expect(mockArm).toHaveBeenCalledWith({ dryRun: true, objectsOnly: false });
  });

  it('objectsOnly pasa tal cual (fase 1: conjuntos sin flag)', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockArm.mockResolvedValue({ anchor: ANCHOR, dryRun: false, submitted: [] });
    await request(buildApp()).post('/api/admin-anchor-gate/arm').set('x-admin-key', PANEL_KEY).send({ dryRun: false, objectsOnly: true });
    expect(mockArm).toHaveBeenLastCalledWith({ dryRun: false, objectsOnly: true });
  });

  it('dryRun: true también es seco; solo { dryRun: false } arma de verdad', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockArm.mockResolvedValue({ anchor: ANCHOR, dryRun: false, submitted: [{ kind: 'AccountSet', hash: 'H', result: 'tesSUCCESS' }] });
    await request(buildApp()).post('/api/admin-anchor-gate/arm').set('x-admin-key', PANEL_KEY).send({ dryRun: true });
    expect(mockArm).toHaveBeenLastCalledWith({ dryRun: true, objectsOnly: false });
    const res = await request(buildApp()).post('/api/admin-anchor-gate/arm').set('x-admin-key', PANEL_KEY).send({ dryRun: false });
    expect(mockArm).toHaveBeenLastCalledWith({ dryRun: false, objectsOnly: false });
    expect(res.body.submitted[0].result).toBe('tesSUCCESS');
  });

  it('negativas tipadas del armador: sin seed → 503; ancla compartida con el Legacy → 409', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    const err = (code: string) => Object.assign(new Error(code), { code });
    mockArm.mockRejectedValueOnce(err('SEED_NOT_CONFIGURED'));
    let res = await request(buildApp()).post('/api/admin-anchor-gate/arm').set('x-admin-key', PANEL_KEY).send({ dryRun: false });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('SEED_NOT_CONFIGURED');
    mockArm.mockRejectedValueOnce(err('SHARED_ANCHOR'));
    res = await request(buildApp()).post('/api/admin-anchor-gate/arm').set('x-admin-key', PANEL_KEY).send({ dryRun: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('SHARED_ANCHOR');
  });
});

describe('POST /disarm — el kill-switch, también seco por defecto', () => {
  it('pasa dryRun tal cual', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    mockDisarm.mockResolvedValue({ anchor: ANCHOR, dryRun: true, submitted: [] });
    const res = await request(buildApp()).post('/api/admin-anchor-gate/disarm').set('x-admin-key', PANEL_KEY).send({});
    expect(res.status).toBe(200);
    expect(mockDisarm).toHaveBeenCalledWith({ dryRun: true });
  });
});

describe('GET / — el estado, con lo que un juez comprueba', () => {
  it('503 sin ASTRYUM_ORDER_ANCHOR; con él, estado + plan + verify', async () => {
    process.env.ADMIN_PANEL_KEY = PANEL_KEY;
    let res = await request(buildApp()).get('/api/admin-anchor-gate').set('x-admin-key', PANEL_KEY);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ANCHOR_NOT_CONFIGURED');

    process.env.ASTRYUM_ORDER_ANCHOR = ANCHOR;
    mockConfig.mockImplementation(() => {
      throw Object.assign(new Error('ASTRYUM_ANCHOR_SEED sin definir'), { code: 'SEED_NOT_CONFIGURED' });
    });
    mockRead.mockResolvedValue({
      anchor: ANCHOR,
      depositAuth: false,
      credentialSets: [],
      accounts: [],
      balanceXrp: 4.000025,
      ledgerReserveXrp: 1,
      ownerCount: 0,
      baseReserveXrp: 1,
      ownerReserveXrp: 0.2,
      readAtISO: '2026-09-17T00:00:00.000Z',
    });
    res = await request(buildApp()).get('/api/admin-anchor-gate').set('x-admin-key', PANEL_KEY);
    expect(res.status).toBe(200);
    expect(res.body.state.depositAuth).toBe(false);
    expect(res.body.plan.setFlag).toBe(true);
    expect(res.body.configError).toMatch(/ASTRYUM_ANCHOR_SEED/);
    expect(res.body.seed.configured).toBe(false);
    expect(res.body.verify.accountInfo).toMatch(/0x01000000/);
  });
});

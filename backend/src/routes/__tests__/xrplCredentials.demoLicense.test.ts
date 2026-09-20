/**
 * La licencia de DEMO del notario — quién puede pedirla.
 *
 * Y al aprobar el cierre: «hay que reubicar los
 * issuing de credentials demo en la consola admin».
 */
import express from 'express';
import request from 'supertest';

const mockWalletFindFirst = jest.fn();
const mockUserFindUnique = jest.fn();
const mockIssueAifmDemo = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    wallet: { findFirst: (...a: unknown[]) => mockWalletFindFirst(...a) },
    user: { findUnique: (...a: unknown[]) => mockUserFindUnique(...a) },
  },
}));

jest.mock('../../services/ManagerNotaryIssuer', () => {
  class NotaryIssuerError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'NotaryIssuerError';
    }
  }
  return { NotaryIssuerError, issueAifmDemo: (...a: unknown[]) => mockIssueAifmDemo(...a) };
});

import router, { demoLicenseLimiter } from '../xrplCredentials';

const SUBJECT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const OTHER = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const LINK = 'https://registers.esma.europa.eu/publication/searchRegister?core=esma_registers_aifm';
const FOUNDER_EMAIL = 'founder@astryum.test';
const URL = '/api/xrpl-credentials/notary/issue-aifm-demo';

/** Una app con la sesión ya puesta, como la deja el `requireSiweAuth` del montaje real. */
function appFor(userId: string | null) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      req.siwe = { userId, sessionId: 'sess', walletAddress: SUBJECT };
      next();
    });
  }
  app.use('/api/xrpl-credentials', router);
  return app;
}

const issued = { txHash: 'ABC', result: 'tesSUCCESS', subject: SUBJECT, credentialType: 'AIFM', uri: LINK };

const SAVED = { emails: process.env.ADMIN_EMAILS, key: process.env.ADMIN_PANEL_KEY };

beforeEach(() => {
  jest.resetAllMocks();
  demoLicenseLimiter._reset();
  delete process.env.ALLOW_NO_AUTH;
  delete process.env.ADMIN_PANEL_KEY;
  process.env.ADMIN_EMAILS = FOUNDER_EMAIL;
});

afterAll(() => {
  if (SAVED.emails === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = SAVED.emails;
  if (SAVED.key === undefined) delete process.env.ADMIN_PANEL_KEY; else process.env.ADMIN_PANEL_KEY = SAVED.key;
});

const asFounder = () => mockUserFindUnique.mockResolvedValue({ email: FOUNDER_EMAIL, emailVerified: true });

describe('POST notary/issue-aifm-demo — solo fundadores', () => {
  it('una cuenta corriente recibe 403 y el emisor ni se toca', async () => {
    mockUserFindUnique.mockResolvedValue({ email: 'judge@example.com', emailVerified: true });

    const res = await request(appFor('judge-1')).post(URL).send({ subject: SUBJECT, type: 'CASP', uri: LINK });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_AN_ADMIN');
    expect(mockIssueAifmDemo).not.toHaveBeenCalled();
  });

  it('un email de la allowlist SIN verificar tampoco pasa', async () => {
    mockUserFindUnique.mockResolvedValue({ email: FOUNDER_EMAIL, emailVerified: false });

    const res = await request(appFor('squatter-1')).post(URL).send({ subject: SUBJECT, uri: LINK });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_AN_ADMIN');
    expect(mockIssueAifmDemo).not.toHaveBeenCalled();
  });

  it('con el panel sin configurar la ruta ni admite que existe (404)', async () => {
    delete process.env.ADMIN_EMAILS;

    const res = await request(appFor('judge-1')).post(URL).send({ subject: SUBJECT, uri: LINK });

    expect(res.status).toBe(404);
    expect(mockIssueAifmDemo).not.toHaveBeenCalled();
  });

  it('un fundador emite, y para CUALQUIER sujeto: no se mira si la wallet es suya', async () => {
    asFounder();
    mockIssueAifmDemo.mockResolvedValue({ ...issued, subject: OTHER, credentialType: 'CASP' });

    const res = await request(appFor('founder-1')).post(URL).send({ subject: OTHER, type: 'CASP', uri: LINK });

    expect(res.status).toBe(200);
    expect(res.body.credentialType).toBe('CASP');
    expect(mockIssueAifmDemo).toHaveBeenCalledWith({ subject: OTHER, credentialType: 'CASP', uri: LINK });
    // La regla de «wallet propia» se retiró con la puerta de admin de vuelta.
    expect(mockWalletFindFirst).not.toHaveBeenCalled();
  });

  it('una r-address inválida es 400 sin tocar al emisor', async () => {
    asFounder();

    const res = await request(appFor('founder-1')).post(URL).send({ subject: 'not-an-address' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SUBJECT');
    expect(mockIssueAifmDemo).not.toHaveBeenCalled();
  });

  it('el flag apagado lo dice el servicio: ISSUER_DISABLED → 503', async () => {
    asFounder();
    const { NotaryIssuerError } = jest.requireMock('../../services/ManagerNotaryIssuer');
    mockIssueAifmDemo.mockRejectedValue(new NotaryIssuerError('ISSUER_DISABLED', 'la emisión de licencia de DEMO está apagada'));

    const res = await request(appFor('founder-1')).post(URL).send({ subject: SUBJECT, uri: LINK });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ISSUER_DISABLED');
  });

  it('una licencia ya vigente de este emisor es 409, no una segunda emisión', async () => {
    asFounder();
    const { NotaryIssuerError } = jest.requireMock('../../services/ManagerNotaryIssuer');
    mockIssueAifmDemo.mockRejectedValue(new NotaryIssuerError('ALREADY_VALID', 'ya sostienes una credencial AIFM vigente'));

    const res = await request(appFor('founder-1')).post(URL).send({ subject: SUBJECT, uri: LINK });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_VALID');
  });

  it('el tope sigue en pie para un fundador: la séptima en una hora es 429 con Retry-After', async () => {
    asFounder();
    mockIssueAifmDemo.mockResolvedValue(issued);

    for (let i = 0; i < 6; i += 1) {
      const ok = await request(appFor('founder-1')).post(URL).send({ subject: SUBJECT, uri: LINK });
      expect(ok.status).toBe(200);
    }
    const res = await request(appFor('founder-1')).post(URL).send({ subject: SUBJECT, uri: LINK });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(mockIssueAifmDemo).toHaveBeenCalledTimes(6);
  });

  it('sin sesión no hay licencia (401)', async () => {
    const res = await request(appFor(null)).post(URL).send({ subject: SUBJECT, uri: LINK });

    expect(res.status).toBe(401);
    expect(mockIssueAifmDemo).not.toHaveBeenCalled();
  });
});

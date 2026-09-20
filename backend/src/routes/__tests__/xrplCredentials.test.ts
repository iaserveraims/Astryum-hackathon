/**
 * La bandeja de credenciales XLS-70 — lo que hace y, sobre todo, lo que NO hace.
 *
 * Astryum no emite y no acepta por nadie. Esta superficie tiene exactamente dos
 * verbos: LEER lo que el ledger dice de una cuenta, y COMPONER sin firmar el
 * `CredentialAccept` que firma el SUJETO. Un tercer verbo aquí (emitir) la
 * convertiría en «Astryum verifica» — y por eso hay un test que vigila que no
 * exista.
 */
import express from 'express';
import request from 'supertest';

jest.mock('../../services/XrplCredentialVerifier', () => ({
  ...jest.requireActual('../../services/XrplCredentialVerifier'),
  readAccountCredentials: jest.fn(),
}));

import router from '../xrplCredentials';
import { readAccountCredentials } from '../../services/XrplCredentialVerifier';

const app = express();
app.use(express.json());
app.use('/api/xrpl-credentials', router);

const SUBJECT = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const ISSUER = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';

function summary(state: 'valid' | 'pending-acceptance' | 'expired') {
  return {
    account: SUBJECT,
    credentials: [
      {
        issuer: ISSUER,
        subject: SUBJECT,
        credentialType: 'KYC',
        credentialTypeHex: '4b5943',
        expiresAtISO: '2027-01-01T00:00:00.000Z',
        accepted: state !== 'pending-acceptance',
        state,
        issuerAccepted: false,
        reserveHeldBy: state === 'pending-acceptance' ? 'issuer' : 'subject',
      },
    ],
    hasAcceptedValidCredential: state === 'valid',
    issuerAllowlistConfigured: false,
    readAtISO: '2026-08-27T00:00:00.000Z',
  };
}

beforeEach(() => jest.resetAllMocks());

describe('GET — leer lo que el ledger dice', () => {
  it('devuelve las credenciales con su estado y cuenta las pendientes de aceptar', async () => {
    (readAccountCredentials as jest.Mock).mockResolvedValue(summary('pending-acceptance'));

    const res = await request(app).get(`/api/xrpl-credentials?account=${SUBJECT}`);

    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(1);
    expect(res.body.credentials[0].state).toBe('pending-acceptance');
    expect(res.body.credentials[0].issuer).toBe(ISSUER);
    expect(res.body.pendingAcceptance).toBe(1);
    // El emisor se nombra; Astryum no aparece como verificador.
    expect(res.body.note).toMatch(/no emite/);
  });

  it('«no pude leer» es un 502 que lo dice, no una lista vacía', async () => {
    (readAccountCredentials as jest.Mock).mockRejectedValue(new Error('xrpl down'));

    const res = await request(app).get(`/api/xrpl-credentials?account=${SUBJECT}`);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('CREDENTIALS_READ_FAILED');
  });

  it('rechaza una cuenta que no es r-address sin tocar el ledger', async () => {
    const res = await request(app).get('/api/xrpl-credentials?account=0xabc');
    expect(res.status).toBe(400);
    expect(readAccountCredentials).not.toHaveBeenCalled();
  });
});

describe('POST accept/prepare — componer, sin firmar, lo que firma el sujeto', () => {
  it('compone un CredentialAccept cuyo Account es el SUJETO y el Issuer el tercero', async () => {
    const res = await request(app)
      .post('/api/xrpl-credentials/accept/prepare')
      .send({ issuer: ISSUER, subject: SUBJECT, credentialType: 'KYC' });

    expect(res.status).toBe(200);
    expect(res.body.txjson.TransactionType).toBe('CredentialAccept');
    expect(res.body.txjson.Account).toBe(SUBJECT);
    expect(res.body.txjson.Issuer).toBe(ISSUER);
    expect(res.body.signer).toBe('subject');
    expect(res.body.disclosure.astryumSigns).toBe(false);
  });

  it('el disclosure dice quién emitió, que aceptar es su firma, y que queda público para siempre', async () => {
    const res = await request(app)
      .post('/api/xrpl-credentials/accept/prepare')
      .send({ issuer: ISSUER, subject: SUBJECT });

    const text = (res.body.disclosure.lines as string[]).join(' ');
    expect(text).toContain(ISSUER);
    expect(text).toMatch(/no Astryum/);
    expect(text).toMatch(/para siempre/);
  });

  it('rechaza issuer o subject inválidos', async () => {
    expect((await request(app).post('/api/xrpl-credentials/accept/prepare').send({ issuer: 'x', subject: SUBJECT })).status).toBe(400);
    expect((await request(app).post('/api/xrpl-credentials/accept/prepare').send({ issuer: ISSUER, subject: 'x' })).status).toBe(400);
  });
});

describe('lo que esta superficie NO tiene', () => {
  it('no existe ningún endpoint de emisión: Astryum jamás emite', async () => {
    for (const path of ['/api/xrpl-credentials/issue/prepare', '/api/xrpl-credentials/create/prepare']) {
      const res = await request(app).post(path).send({ issuer: ISSUER, subject: SUBJECT });
      expect(res.status).toBe(404);
    }
  });
});

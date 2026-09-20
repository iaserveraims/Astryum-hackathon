/**
 * El KYC del exchange, UNA CREDENCIAL POR CASILLA, en las RUTAS (fundador 14-sep,
 * «solo B»): la raíz del run emite `KYC-<tag>` con el omnibus como sujeto.
 *
 * Lo que se fija:
 *  - depositar y poner a trabajar piden la credencial de SU casilla, aceptada y
 *    vigente;
 *  - **un cliente SIN wallet XRPL propia opera** en cuanto su casilla tiene KYC
 *    (es el porqué de B);
 *  - **una SALIDA no pasa por la puerta**: `withdraw` se pide igual sin
 *    credencial, con ella caducada y con el ledger ilegible;
 *  - un ledger ilegible es 503, jamás un 409 «no tienes credencial»;
 *  - la lectura de estado dice qué emitir por casilla.
 */
import express from 'express';
import request from 'supertest';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';
import type { CredentialsSummary } from '../../services/XrplCredentialVerifier';

const ROOT = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const T0 = new Date(0).toISOString();
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

let store: DemoRun;
let credentials: CredentialsSummary['credentials'] = [];
let readThrows: string | null = null;
const mockSaveRun = jest.fn(async () => undefined);
const mockRead = jest.fn(async (account: string) => {
  if (readThrows) throw new Error(readThrows);
  return { account, credentials, hasAcceptedValidCredential: false, issuerAllowlistConfigured: false, readAtISO: T0 };
});

jest.mock('../../services/demoExchange/DemoExchangeStore', () => {
  const actual = jest.requireActual('../../services/demoExchange/DemoExchangeStore');
  return {
    ...actual,
    loadRun: jest.fn(async (id: string) => (id === store.runId ? store : null)),
    listRuns: jest.fn(async () => [store]),
    saveRun: (...a: unknown[]) => mockSaveRun(...(a as [])),
  };
});

jest.mock('../../services/XrplCredentialVerifier', () => ({
  readAccountCredentials: (...a: unknown[]) => mockRead(...(a as [string])),
}));

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: `s-${user}`, walletAddress: req.header('x-test-wallet') ?? '' };
    next();
  },
}));

import router from '../demoExchange';
import { clearClientCredentialCache } from '../../services/demoExchange/clientCredentialGate';

/** La credencial de una casilla tal como la lee el ledger. */
function cred(tag: number, over: Record<string, unknown> = {}) {
  return {
    issuer: ROOT,
    subject: OMNIBUS,
    credentialType: `KYC-${tag}`,
    credentialTypeHex: hex(`KYC-${tag}`),
    ledgerIndex: null,
    expiresAtISO: '2028-01-01T00:00:00.000Z',
    uri: null,
    accepted: true,
    state: 'valid' as const,
    issuerAccepted: false,
    reserveHeldBy: 'subject' as const,
    ...over,
  };
}

function freshRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'KYC exchange',
    councilAddress: ROOT,
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [
      // Ana: con wallet XRPL propia (la que usa para retirar).
      { id: 'ana', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', ownerUserId: 'ana', xrplAddress: WALLET, xrplAddressProof: 'session', xrpOnExchangeDrops: '5000000', createdAt: T0 },
      // Bo: SOLO passkey, sin wallet XRPL — el caso que B desbloquea.
      { id: 'bo', runId: 'run1', label: 'Bo', tag: 102, kyc: 'none', ownerUserId: 'bo', xrpOnExchangeDrops: '5000000', createdAt: T0 },
    ],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
  } as unknown as DemoRun;
}

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);
const as = (user: string) => ({ 'x-test-user': user, Authorization: 'Bearer test' });

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, emails: process.env.ADMIN_EMAILS, key: process.env.ADMIN_PANEL_KEY, gate: process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL, type: process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE };
beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_PANEL_KEY;
});
beforeEach(() => {
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  delete process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL; // el defecto ES exigirla
  delete process.env.DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE;
  store = freshRun();
  credentials = [];
  readThrows = null;
  clearClientCredentialCache();
  mockSaveRun.mockClear();
  mockRead.mockClear();
});
afterAll(() => {
  for (const [k, v] of [['INSTITUTIONAL_POTES_ENABLED', SAVED.flag], ['DATABASE_URL', SAVED.db], ['ADMIN_EMAILS', SAVED.emails], ['ADMIN_PANEL_KEY', SAVED.key], ['DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL', SAVED.gate], ['DEMO_EXCHANGE_CLIENT_CREDENTIAL_TYPE', SAVED.type]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const deposit = (who: 'ana' | 'bo') => request(app).post(`/api/demo-exchange/runs/run1/clients/${who}/deposit-instructions`).set(as(who)).send({ amountXrp: '1' });
const ask = (who: 'ana' | 'bo', kind: 'put-to-work' | 'withdraw') => request(app).post(`/api/demo-exchange/runs/run1/clients/${who}/requests`).set(as(who)).send({ kind, amountXrp: '1' });

describe('sin el KYC de su casilla no entra capital', () => {
  it('el depósito se rehúsa, dice qué credencial falta y que la salida NO se gatea', async () => {
    const res = await deposit('ana');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CLIENT_NOT_CREDENTIALED');
    expect(res.body.detail).toMatch(/Taking money out is never gated/i);
    expect(res.body.credential).toEqual({ issuer: ROOT, subject: OMNIBUS, credentialType: 'KYC-101' });
  });

  it('el ledger se lee sobre el OMNIBUS (el sujeto), no sobre la wallet del cliente', async () => {
    await deposit('ana');
    expect(mockRead).toHaveBeenCalledWith(OMNIBUS, expect.anything());
    expect(mockRead).not.toHaveBeenCalledWith(WALLET, expect.anything());
  });

  it('«poner a trabajar» se rehúsa igual', async () => {
    expect((await ask('ana', 'put-to-work')).body.error).toBe('CLIENT_NOT_CREDENTIALED');
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('el KYC de OTRA casilla no abre esta', async () => {
    credentials = [cred(102)];
    expect((await deposit('ana')).body.error).toBe('CLIENT_NOT_CREDENTIALED');
  });

  it('emitida y sin aceptar por el omnibus: se dice que falta cerrar la ceremonia', async () => {
    credentials = [cred(101, { state: 'pending-acceptance', accepted: false })];
    expect((await deposit('ana')).body.error).toBe('CLIENT_CREDENTIAL_PENDING');
  });

  it('caducada: se renueva — y el código lo dice', async () => {
    credentials = [cred(101, { state: 'expired' })];
    expect((await deposit('ana')).body.error).toBe('CLIENT_CREDENTIAL_EXPIRED');
  });
});

describe('con el KYC de su casilla, opera — tenga o no wallet XRPL propia', () => {
  it('el depósito sale con su tag y su destino', async () => {
    credentials = [cred(101)];
    const res = await deposit('ana');
    expect(res.status).toBe(200);
    expect(res.body.xrplTx).toMatchObject({ Destination: OMNIBUS, DestinationTag: 101 });
  });

  it('«poner a trabajar» se acepta', async () => {
    credentials = [cred(101)];
    expect((await ask('ana', 'put-to-work')).status).toBe(201);
  });

  it('un cliente SOLO passkey (sin wallet XRPL) opera en cuanto su casilla tiene KYC', async () => {
    credentials = [cred(102)];
    expect((await deposit('bo')).status).toBe(200);
    expect((await ask('bo', 'put-to-work')).status).toBe(201);
  });
});

describe('LA SALIDA NO SE GATEA — nunca', () => {
  it('sin ninguna credencial, el cliente pide su retirada igual', async () => {
    const res = await ask('ana', 'withdraw');
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ kind: 'withdraw', status: 'pending' });
  });

  it('con la credencial de su casilla CADUCADA, la retirada sigue abierta', async () => {
    credentials = [cred(101, { state: 'expired' })];
    expect((await ask('ana', 'withdraw')).status).toBe(201);
  });

  it('con el ledger ilegible, la retirada sigue abierta', async () => {
    readThrows = 'websocket closed';
    expect((await ask('ana', 'withdraw')).status).toBe(201);
  });
});

describe('fail-closed sin mentir, interruptor, y lectura por casilla', () => {
  it('ledger ilegible en una ENTRADA: 503 CREDENTIALS_UNREADABLE, jamás «no tienes credencial»', async () => {
    readThrows = 'websocket closed';
    const res = await deposit('ana');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('CREDENTIALS_UNREADABLE');
  });

  it('con DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL=false el gate no se aplica (ensayo sin ceremonia)', async () => {
    process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
    expect((await deposit('ana')).status).toBe(200);
  });

  it('GET /credentials dice, por casilla, qué credencial le toca y si la tiene — con UNA lectura del omnibus', async () => {
    credentials = [cred(101)];
    // 20-sep: la lista por casilla es de la mesa (o del dueño del exchange).
    process.env.ADMIN_PANEL_KEY = 'founder-test-key';
    const res = await request(app).get('/api/demo-exchange/runs/run1/credentials').set({ 'x-admin-key': 'founder-test-key' });
    // Un cliente ve el KYC de SU casilla y de ninguna más; sin sesión, nada; un extraño, 404.
    const own = await request(app).get('/api/demo-exchange/runs/run1/credentials').set(as('ana'));
    expect(own.body.clients.map((c: { clientId: string }) => c.clientId)).toEqual(['ana']);
    expect((await request(app).get('/api/demo-exchange/runs/run1/credentials')).status).toBe(401);
    expect((await request(app).get('/api/demo-exchange/runs/run1/credentials').set(as('nobody'))).status).toBe(404);
    expect(res.status).toBe(200);
    expect(res.body.required).toBe(true);
    expect(res.body.clients).toEqual([
      expect.objectContaining({ clientId: 'ana', tag: 101, credentialType: 'KYC-101', issuer: ROOT, subject: OMNIBUS, ok: true }),
      expect.objectContaining({ clientId: 'bo', tag: 102, credentialType: 'KYC-102', ok: false, code: 'CLIENT_NOT_CREDENTIALED' }),
    ]);
    expect(mockRead).toHaveBeenCalledTimes(1);
  });
});

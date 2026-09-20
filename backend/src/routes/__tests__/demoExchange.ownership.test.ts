/**
 * UN EXCHANGE ES DE QUIEN LO CREÓ.
 *
 * Hasta hoy un exchange no tenía dueño — `POST /runs` leía la sesión para
 * comprobar el omnibus y la tiraba — y TODA lectura era pública: `GET /runs`
 * listaba todos a cualquiera, y con el id, `GET /runs/:id` servía la ficha de cada
 * cliente de un exchange ajeno (etiqueta, tag, r-address, cuenta de passkey, saldo,
 * KYC), más `/chain`, `/credentials`, `/omnibus` y un dossier en markdown.
 */
import express from 'express';
import request from 'supertest';
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';

let mockRuns: DemoRun[] = [];

jest.mock('../../services/demoExchange/DemoExchangeStore', () => {
  const actual = jest.requireActual('../../services/demoExchange/DemoExchangeStore');
  return {
    ...actual,
    loadRun: jest.fn(async (id: string) => mockRuns.find((r) => r.runId === id) ?? null),
    listRuns: jest.fn(async () => mockRuns),
    saveRun: jest.fn(async () => undefined),
  };
});

jest.mock('../../services/demoExchange/DemoRunVerifier', () => {
  const actual = jest.requireActual('../../services/demoExchange/DemoRunVerifier');
  return {
    ...actual,
    // Sin cadena: una fila de hechos por ficha, que es lo que hay que filtrar.
    readClientFacts: jest.fn(async (run: DemoRun) => run.clients.map((c) => ({ clientId: c.id, passkeyAccount: c.passkeyAccount }))),
    verifyRun: jest.fn(async () => undefined),
  };
});

// /chain lee el DID del consejo en la XRPL: sin red en un test (y sin un socket
// abierto que deje a jest colgado al terminar).
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: { getDidObject: jest.fn(async () => null) },
}));

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: `s-${user}`, walletAddress: '' };
    next();
  },
}));

import router, { accessToRun, ownsRun } from '../demoExchange';
import { _resetKeyFailuresForTests } from '../adminPanel';

const T0 = new Date(0).toISOString();
const admin = { 'x-admin-key': 'founder-test-key' };
const as = (user: string) => ({ 'x-test-user': user, Authorization: 'Bearer test' });

const row = (id: string, runId: string, tag: number, ownerUserId?: string) =>
  ({ id, runId, label: id, tag, kyc: 'none', xrpOnExchangeDrops: '1000000', createdAt: T0, ...(ownerUserId ? { ownerUserId } : {}) });

function run(runId: string, extra: Partial<DemoRun> & { clients?: unknown[] } = {}): DemoRun {
  return {
    runId,
    seq: 1,
    label: runId,
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7',
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
    ...extra,
  } as unknown as DemoRun;
}

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, emails: process.env.ADMIN_EMAILS, key: process.env.ADMIN_PANEL_KEY };
beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ADMIN_EMAILS;
  process.env.ADMIN_PANEL_KEY = 'founder-test-key';
});
beforeEach(() => {
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  _resetKeyFailuresForTests();
  mockRuns = [
    // de Olga: dos clientes, Ana y Bo, cada uno con su cuenta de Astryum
    run('olga-ex', {
      createdByUserId: 'olga',
      clients: [row('ana', 'olga-ex', 101, 'ana'), row('bo', 'olga-ex', 102, 'bo')],
      receipts: [
        { id: 'rc-ana', runId: 'olga-ex', step: 'E2_DEPOSIT', chain: 'xrpl', clientId: 'ana', at: T0, checks: [] },
        { id: 'rc-bo', runId: 'olga-ex', step: 'E2_DEPOSIT', chain: 'xrpl', clientId: 'bo', at: T0, checks: [] },
      ],
      requests: [
        { id: 'rq-ana', kind: 'withdraw', clientId: 'ana', drops: '1', status: 'queued', at: T0 },
        { id: 'rq-bo', kind: 'withdraw', clientId: 'bo', drops: '1', status: 'queued', at: T0 },
      ],
      structures: [{ id: 'st1' }],
      provenDepositSenders: { ana: ['rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf'] },
    } as never),
    // de Pau
    run('pau-ex', { createdByUserId: 'pau' }),
    // anterior al: sin creador
    run('legacy-ex'),
  ];
});
afterAll(() => {
  for (const [k, v] of [['INSTITUTIONAL_POTES_ENABLED', SAVED.flag], ['DATABASE_URL', SAVED.db], ['ADMIN_EMAILS', SAVED.emails], ['ADMIN_PANEL_KEY', SAVED.key]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const ids = (res: { body: { runs: Array<{ runId: string }> } }) => res.body.runs.map((r) => r.runId).sort();

describe('la regla, pura', () => {
  it('un exchange con creador es SOLO de su creador — también entre fundadores', () => {
    expect(ownsRun({ createdByUserId: 'olga' }, { admin: false, userId: 'olga' })).toBe(true);
    expect(ownsRun({ createdByUserId: 'olga' }, { admin: false, userId: 'pau' })).toBe(false);
    expect(ownsRun({ createdByUserId: 'olga' }, { admin: true, userId: 'pau' })).toBe(false);
    expect(ownsRun({ createdByUserId: 'olga' }, { admin: true })).toBe(false);
  });

  it('Uno sin creador (anterior al) es de los fundadores, y de nadie más', () => {
    expect(ownsRun({}, { admin: true })).toBe(true);
    expect(ownsRun({}, { admin: false, userId: 'olga' })).toBe(false);
  });

  it('el acceso: fundador > dueño > cliente > nadie', () => {
    const r = mockRuns[0];
    expect(accessToRun(r, { admin: true }).level).toBe('admin');
    expect(accessToRun(r, { admin: false, userId: 'olga' }).level).toBe('owner');
    const member = accessToRun(r, { admin: false, userId: 'ana' });
    expect(member.level).toBe('member');
    expect(member.level === 'member' && [...member.clientIds]).toEqual(['ana']);
    expect(accessToRun(r, { admin: false, userId: 'zoe' }).level).toBe('none');
    expect(accessToRun(r, { admin: false }).level).toBe('none');
  });
});

describe('GET /runs — la lista es la de TUS exchanges', () => {
  it('sin sesión ni puerta de fundador: 401', async () => {
    expect((await request(app).get('/api/demo-exchange/runs')).status).toBe(401);
  });

  it('cada creador ve el suyo; un cliente y un extraño, ninguno', async () => {
    expect(ids(await request(app).get('/api/demo-exchange/runs').set(as('olga')))).toEqual(['olga-ex']);
    expect(ids(await request(app).get('/api/demo-exchange/runs').set(as('pau')))).toEqual(['pau-ex']);
    expect(ids(await request(app).get('/api/demo-exchange/runs').set(as('ana')))).toEqual([]);
    expect(ids(await request(app).get('/api/demo-exchange/runs').set(as('zoe')))).toEqual([]);
  });

  it('Un fundador ve los anteriores al, no los de otro creador — salvo `?all=1`, que es del panel', async () => {
    expect(ids(await request(app).get('/api/demo-exchange/runs').set(admin))).toEqual(['legacy-ex']);
    expect(ids(await request(app).get('/api/demo-exchange/runs?all=1').set(admin))).toEqual(['legacy-ex', 'olga-ex', 'pau-ex']);
  });

  it('`?all=1` sin puerta de admin no abre nada', async () => {
    expect(ids(await request(app).get('/api/demo-exchange/runs?all=1').set(as('olga')))).toEqual(['olga-ex']);
    expect(ids(await request(app).get('/api/demo-exchange/runs?all=1').set(as('zoe')))).toEqual([]);
  });
});

describe('GET /runs/:id — el exchange de otro no existe', () => {
  it('un extraño y el creador de OTRO exchange reciben el mismo 404 que por un id inventado', async () => {
    const made = await request(app).get('/api/demo-exchange/runs/nope').set(as('zoe'));
    for (const who of ['zoe', 'pau']) {
      const res = await request(app).get('/api/demo-exchange/runs/olga-ex').set(as(who));
      expect(res.status).toBe(404);
      expect(res.body).toEqual(made.body);
    }
  });

  it('el dueño lo lee entero, y el creador no viaja en el cuerpo', async () => {
    const res = await request(app).get('/api/demo-exchange/runs/olga-ex').set(as('olga'));
    expect(res.status).toBe(200);
    expect(res.body.run.clients.map((c: { id: string }) => c.id)).toEqual(['ana', 'bo']);
    expect(JSON.stringify(res.body)).not.toContain('createdByUserId');
    expect(JSON.stringify(res.body)).not.toContain('ownerUserId');
  });

  it('un CLIENTE lee su exchange y, de todo lo demás, solo lo suyo', async () => {
    const res = await request(app).get('/api/demo-exchange/runs/olga-ex').set(as('ana'));
    expect(res.status).toBe(200);
    const r = res.body.run;
    // lo del exchange que necesita para operar
    expect(r).toMatchObject({ runId: 'olga-ex', label: 'olga-ex', omnibusAddress: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', status: 'open' });
    // y de las filas, las suyas
    expect(r.clients.map((c: { id: string }) => c.id)).toEqual(['ana']);
    expect(r.receipts.map((x: { id: string }) => x.id)).toEqual(['rc-ana']);
    expect(r.requests.map((x: { id: string }) => x.id)).toEqual(['rq-ana']);
    expect(r.structures).toBeUndefined();
    expect(r.provenDepositSenders).toBeUndefined();
    expect(r.appliedTxHashes).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/"bo"|rc-bo|rq-bo/);
  });
});

describe('las demás lecturas del exchange', () => {
  it('/chain: el pote y el consejo son del exchange; los hechos de cada casilla, de su cliente', async () => {
    const owner = await request(app).get('/api/demo-exchange/runs/olga-ex/chain').set(as('olga'));
    expect(owner.body.clients.map((c: { clientId: string }) => c.clientId)).toEqual(['ana', 'bo']);
    const member = await request(app).get('/api/demo-exchange/runs/olga-ex/chain').set(as('bo'));
    expect(member.status).toBe(200);
    expect(member.body.clients.map((c: { clientId: string }) => c.clientId)).toEqual(['bo']);
    expect((await request(app).get('/api/demo-exchange/runs/olga-ex/chain').set(as('zoe'))).status).toBe(404);
    expect((await request(app).get('/api/demo-exchange/runs/olga-ex/chain')).status).toBe(401);
  });

  it('el dossier en markdown lleva una fila por cliente: del dueño y de la mesa, no de un cliente', async () => {
    expect((await request(app).get('/api/demo-exchange/runs/olga-ex/proof.md').set(as('olga'))).status).toBe(200);
    expect((await request(app).get('/api/demo-exchange/runs/olga-ex/proof.md').set(admin)).status).toBe(200);
    expect((await request(app).get('/api/demo-exchange/runs/olga-ex/proof.md').set(as('ana'))).status).toBe(404);
    expect((await request(app).get('/api/demo-exchange/runs/olga-ex/proof.md').set(as('zoe'))).status).toBe(404);
    expect((await request(app).get('/api/demo-exchange/runs/olga-ex/proof.md')).status).toBe(401);
  });

  it('si este despliegue guarda una llave de omnibus es cosa de la mesa', async () => {
    expect((await request(app).get('/api/demo-exchange/autopilot').set(as('olga'))).status).toBe(404);
    expect((await request(app).get('/api/demo-exchange/autopilot')).status).toBe(401);
    expect((await request(app).get('/api/demo-exchange/autopilot').set(admin)).status).toBe(200);
  });

  it('POST /verify: un cliente no verifica el recibo de otro', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/olga-ex/verify').set(as('ana')).send({ receiptId: 'rc-bo' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RECEIPT_NOT_FOUND');
    expect((await request(app).post('/api/demo-exchange/runs/olga-ex/verify').set(as('zoe')).send({})).status).toBe(404);
    expect((await request(app).post('/api/demo-exchange/runs/olga-ex/verify').send({})).status).toBe(401);
  });
});

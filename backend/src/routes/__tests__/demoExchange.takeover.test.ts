/**
 * Takeover coordination (productizer it. 10): a User taken over through OAuth
 * carries `preferences.security.takeoverAt`. Nothing trusted on that user id
 * before it is proof of the person holding the session now:
 *  - a WalletBinding linked before it is not wallet proof;
 *  - a client row owned since before it needs a re-claim: its session is refused
 *    (CLIENT_RECLAIM_REQUIRED), `mine` is false, and only a founder re-opens it;
 *  - an unreadable user row is never «no takeover» (503 / unreadable).
 */
import express from 'express';
import request from 'supertest';
// Esta suite prueba OTRAS reglas y no tiene ledger: el KYC del exchange (14-sep)
// se prueba en clientCredentialGate.test y demoExchange.credentialGate.test.
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';

let store: DemoRun;
const mockSaveRun = jest.fn(async () => undefined);
const mockPrefs: Record<string, unknown> = {};
const mockState = { userReadFails: false, bindingQueryIgnoresLinkedAt: false };
const mockBindings: Array<{ userId: string; address: string; linkedAt: Date }> = [];

jest.mock('../../services/demoExchange/DemoExchangeStore', () => {
  const actual = jest.requireActual('../../services/demoExchange/DemoExchangeStore');
  return {
    ...actual,
    loadRun: jest.fn(async (id: string) => (id === store.runId ? store : null)),
    listRuns: jest.fn(async () => [store]),
    saveRun: (...a: unknown[]) => mockSaveRun(...(a as [])),
  };
});

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (mockState.userReadFails) throw new Error('pooler down');
        return where.id in mockPrefs ? { preferences: mockPrefs[where.id], email: null, emailVerified: false } : null;
      }),
    },
    walletBinding: {
      findFirst: jest.fn(async ({ where }: { where: { userId: string; address: string; linkedAt?: { gte: Date } } }) => {
        const gte = mockState.bindingQueryIgnoresLinkedAt ? undefined : where.linkedAt?.gte;
        const row = mockBindings.find((b) => b.userId === where.userId && b.address === where.address && (!gte || b.linkedAt >= gte));
        return row ? { id: 'wb1', linkedAt: row.linkedAt } : null;
      }),
    },
  },
}));

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: `s-${user}`, walletAddress: '' };
    next();
  },
}));

import router, { hashClaimCode } from '../demoExchange';
import { _resetKeyFailuresForTests } from '../adminPanel';
import { TakeoverUnreadableError, ownershipPredatesTakeover, takeoverAtOf } from '../../services/demoExchange/takeover';
import { payoutWalletProven } from '../../services/demoExchange/payoutProof';

const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const TAKEOVER = '2020-01-01T00:00:00.000Z';
const BEFORE = '2019-06-01T00:00:00.000Z';
const AFTER = '2021-01-01T00:00:00.000Z';

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);
const admin = { 'x-admin-key': 'founder-test-key' };
const as = (user: string) => ({ 'x-test-user': user, Authorization: 'Bearer test' });

function freshRun(): DemoRun {
  const row = (id: string, tag: number, extra: Record<string, unknown>) => ({ id, runId: 'run1', label: id, tag, kyc: 'none', xrpOnExchangeDrops: '5000000', createdAt: BEFORE, ...extra });
  return {
    runId: 'run1',
    seq: 1,
    label: 'Takeover',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: BEFORE,
    status: 'open',
    clients: [
      // owned by "victim" since BEFORE the takeover of that login
      row('stale', 101, { ownerUserId: 'victim', ownedSince: BEFORE }),
      // owned by "victim" since AFTER it (re-claimed)
      row('fresh', 102, { ownerUserId: 'victim', ownedSince: AFTER }),
      // owned by "plain", whose login was never taken over; legacy row without ownedSince
      row('plain', 103, { ownerUserId: 'plain' }),
    ],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
  } as unknown as DemoRun;
}

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, emails: process.env.ADMIN_EMAILS, key: process.env.ADMIN_PANEL_KEY };
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://takeover-test';
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.ADMIN_PANEL_KEY = 'founder-test-key';
  delete process.env.ADMIN_EMAILS;
});
afterAll(() => {
  for (const [k, v] of [['INSTITUTIONAL_POTES_ENABLED', SAVED.flag], ['DATABASE_URL', SAVED.db], ['ADMIN_EMAILS', SAVED.emails], ['ADMIN_PANEL_KEY', SAVED.key]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(() => {
  store = freshRun();
  mockSaveRun.mockClear();
  for (const k of Object.keys(mockPrefs)) delete mockPrefs[k];
  mockPrefs.victim = { theme: 'dark', security: { takeoverAt: TAKEOVER } };
  mockPrefs.plain = { theme: 'light' };
  mockState.userReadFails = false;
  mockState.bindingQueryIgnoresLinkedAt = false;
  mockBindings.length = 0;
});
afterEach(() => _resetKeyFailuresForTests());

describe('takeover preference (pure)', () => {
  /**
   * productizer it. 16 (R4 4.3): ABSENT is «no takeover»; UNREADABLE is not.
   * The lax reader turned a malformed mark into null — «there was no takeover» —
   * exactly where it is decided whether the previous holder of a login still
   * owns an exchange account. It now throws, like the database failure this file
   * already knew how to refuse, and reads through the identity module's own
   * strict reader (the same one the cage ack and the legal click-wrap use).
   */
  it('missing → no takeover; a mark that cannot be read is never «there was none»', () => {
    expect(takeoverAtOf(null)).toBeNull();
    expect(takeoverAtOf(undefined)).toBeNull();
    expect(takeoverAtOf({ theme: 'dark' })).toBeNull();
    expect(takeoverAtOf({ security: {} })).toBeNull();
    expect(() => takeoverAtOf({ security: 'x' })).toThrow(TakeoverUnreadableError);
    expect(() => takeoverAtOf({ security: { takeoverAt: 'not a date' } })).toThrow(TakeoverUnreadableError);
    expect(() => takeoverAtOf('not preferences')).toThrow(TakeoverUnreadableError);
    expect(takeoverAtOf({ security: { takeoverAt: TAKEOVER } })?.toISOString()).toBe(TAKEOVER);
  });

  it('ownership established before the takeover (ownedSince, else createdAt) predates it; an undatable row with a takeover does too', () => {
    const at = new Date(TAKEOVER);
    expect(ownershipPredatesTakeover({ ownedSince: BEFORE, createdAt: BEFORE }, at)).toBe(true);
    expect(ownershipPredatesTakeover({ ownedSince: AFTER, createdAt: BEFORE }, at)).toBe(false);
    expect(ownershipPredatesTakeover({ createdAt: BEFORE }, at)).toBe(true);
    expect(ownershipPredatesTakeover({ createdAt: 'garbage' }, at)).toBe(true);
    expect(ownershipPredatesTakeover({ createdAt: BEFORE }, null)).toBe(false);
  });
});

describe('wallet proof ignores bindings linked before the takeover', () => {
  const proof = (user: string) => request(app).get(`/api/demo-exchange/wallet-proof?addresses=${WALLET}`).set(as(user));

  it('linked before → not proof; linked after → binding; no takeover → binding', async () => {
    mockBindings.push({ userId: 'victim', address: WALLET, linkedAt: new Date(BEFORE) });
    expect((await proof('victim')).body.wallets[0]).toEqual({ address: WALLET, proof: null, unreadable: false });
    mockBindings[0].linkedAt = new Date(AFTER);
    expect((await proof('victim')).body.wallets[0].proof).toBe('binding');
    mockBindings.push({ userId: 'plain', address: WALLET, linkedAt: new Date(BEFORE) });
    expect((await proof('plain')).body.wallets[0].proof).toBe('binding');
  });

  it('defense in depth: even if the query answered an old binding, it is not proof', async () => {
    mockState.bindingQueryIgnoresLinkedAt = true;
    mockBindings.push({ userId: 'victim', address: WALLET, linkedAt: new Date(BEFORE) });
    expect((await proof('victim')).body.wallets[0].proof).toBeNull();
  });

  it('the user row cannot be read → unreadable, never «no takeover»', async () => {
    mockBindings.push({ userId: 'victim', address: WALLET, linkedAt: new Date(AFTER) });
    mockState.userReadFails = true;
    expect((await proof('victim')).body.wallets[0]).toEqual({ address: WALLET, proof: null, unreadable: true });
  });
});

describe('client rows owned since before the takeover need a re-claim', () => {
  const ask = (cid: string, user: string) => request(app).post(`/api/demo-exchange/runs/run1/clients/${cid}/requests`).set(as(user)).send({ kind: 'put-to-work', amountXrp: '1' });

  it('the session is refused on the stale row (403 CLIENT_RECLAIM_REQUIRED, nothing saved); a re-claimed row and an untouched login work', async () => {
    const stale = await ask('stale', 'victim');
    expect(stale.status).toBe(403);
    expect(stale.body.error).toBe('CLIENT_RECLAIM_REQUIRED');
    expect((await request(app).post('/api/demo-exchange/runs/run1/clients/stale/deposit-instructions').set(as('victim')).send({ amountXrp: '1' })).body.error).toBe('CLIENT_RECLAIM_REQUIRED');
    expect((await request(app).patch('/api/demo-exchange/runs/run1/clients/stale').set(as('victim')).send({ label: 'mine' })).body.error).toBe('CLIENT_RECLAIM_REQUIRED');
    expect(mockSaveRun).not.toHaveBeenCalled();
    expect((await ask('fresh', 'victim')).status).toBe(201);
    expect((await ask('plain', 'plain')).status).toBe(201);
  });

  it('the takeover mark cannot be read → 503 OWNERSHIP_UNREADABLE, nothing saved', async () => {
    mockState.userReadFails = true;
    const res = await ask('fresh', 'victim');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('OWNERSHIP_UNREADABLE');
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  /**
   * it. 16 (R4 4.3): a MALFORMED mark is the same refusal as a database that is
   * down. Read leniently it came back as «no takeover», so the stale row went on
   * answering to the login the owner had recovered — «no pude leer» as permission
   * in the place that decides whose account this is.
   */
  it('a takeover mark that exists but cannot be parsed is refused too — never «there was no takeover»', async () => {
    mockPrefs.victim = { theme: 'dark', security: { takeoverAt: 'not a date' } };
    const res = await ask('fresh', 'victim');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('OWNERSHIP_UNREADABLE');
    expect(mockSaveRun).not.toHaveBeenCalled();
    // …and the stale row is not served as theirs either (display fails closed).
    const view = await request(app).get('/api/demo-exchange/runs/run1').set(as('victim'));
    expect(view.body.run.clients.filter((c: { mine: boolean }) => c.mine)).toEqual([]);
    // it. 33 (2): …and the body SAYS the mark could not be used — its own cause,
    // retryable — instead of letting `mine:false` read as «not your account».
    expect(view.body.viewerUnreadable).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', retryable: true, cause: 'unreadable-mark' });
    expect(view.body.viewerUnreadable.detail).toMatch(/administrator can repair/i);
    // A wallet binding under that unreadable mark proves nothing.
    mockBindings.push({ userId: 'victim', address: WALLET, linkedAt: new Date(AFTER) });
    const proof = await request(app).get(`/api/demo-exchange/wallet-proof?addresses=${WALLET}`).set(as('victim'));
    expect(proof.body.wallets[0]).toEqual({ address: WALLET, proof: null, unreadable: true });
  });

  it('`mine` is false on the stale row, true on the re-claimed one', async () => {
    const res = await request(app).get('/api/demo-exchange/runs/run1').set(as('victim'));
    const mine = res.body.run.clients.filter((c: { mine: boolean }) => c.mine).map((c: { id: string }) => c.id);
    expect(mine).toEqual(['fresh']);
    // a usable mark: no «could not read» on the body
    expect(res.body.viewerUnreadable).toBeUndefined();
  });

  /**
   * it. 33 (agente C, 2) — THE CONSUMER OF `mine:false` IS A PERSON'S ACCOUNT.
   * The client book reloads through GET /runs/:id every 20 s; a database blink
   * while reading the mark used to answer the owner's row as `owned:true,
   * mine:false` with nothing else, and `useExchangeClient` turned that into
   * «Open an account». The display still fails closed; the body now says why.
   */
  it('it. 33: a database that does not answer while reading the mark → `mine:[]` AND `viewerUnreadable` (read-failed, retryable) on the body', async () => {
    mockState.userReadFails = true;
    const view = await request(app).get('/api/demo-exchange/runs/run1').set(as('victim'));
    expect(view.status).toBe(200);
    expect(view.body.run.clients.filter((c: { mine: boolean }) => c.mine)).toEqual([]);
    expect(view.body.run.clients.find((c: { id: string }) => c.id === 'fresh')).toMatchObject({ owned: true, mine: false });
    expect(view.body.viewerUnreadable).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', retryable: true, cause: 'read-failed' });
    expect(view.body.viewerUnreadable.detail).toMatch(/in a moment/i);
    // an anonymous reader has no mark to read
    const anon = await request(app).get('/api/demo-exchange/runs/run1');
    expect(anon.body.viewerUnreadable).toBeUndefined();
  });

  it('it. 33: the self-serve alta answers `viewerUnreadable` too when the mark cannot be used — the fresh row must not read as somebody else’s', async () => {
    mockState.userReadFails = true;
    const PASSKEY2 = '0x1111111111111111111111111111111111111111';
    const res = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('newcomer')).send({ label: 'Nuria', passkeyAccount: PASSKEY2 });
    expect(res.status).toBe(201);
    expect(res.body.client).toMatchObject({ owned: true });
    expect(res.body.viewerUnreadable).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', retryable: true, cause: 'read-failed' });
  });

  it('only a founder re-opens it: a claim code resets the stale owner (NOTE receipt); the holder claims it and uses it; a current owner keeps theirs (409)', async () => {
    const issued = await request(app).patch('/api/demo-exchange/runs/run1/clients/stale').set(admin).send({ issueClaimCode: true });
    expect(issued.status).toBe(200);
    const code = issued.body.claimCode as string;
    expect(code).toBeTruthy();
    const row = store.clients.find((c) => c.id === 'stale')!;
    expect(row.ownerUserId).toBeUndefined();
    expect(row.claimCodeHash).toBe(hashClaimCode(code));
    expect(store.receipts.some((r) => r.step === 'NOTE' && /re-claim/.test(r.note ?? ''))).toBe(true);

    const claimed = await request(app).patch('/api/demo-exchange/runs/run1/clients/stale').set(as('victim')).send({ claimCode: code });
    expect(claimed.status).toBe(200);
    expect(claimed.body.client.mine).toBe(true);
    expect(Date.parse(row.ownedSince!)).toBeGreaterThan(Date.parse(TAKEOVER));
    expect((await ask('stale', 'victim')).status).toBe(201);

    const kept = await request(app).patch('/api/demo-exchange/runs/run1/clients/fresh').set(admin).send({ issueClaimCode: true });
    expect(kept.status).toBe(409);
    expect(kept.body.error).toBe('CLIENT_ALREADY_OWNED');
  });
});

/**
 * productizer it. 29 (1.2) — UNA MARCA DE TOMA DE POSESIÓN ADELANTADA TAPIABA AL
 * DUEÑO FUERA DE SU PROPIA CASILLA.
 *
 * `ownershipPredatesTakeover` compara `ownedSince` contra la marca, así que una
 * marca en el FUTURO gana esa comparación contra TODAS las filas: ninguna fecha
 * es posterior a un instante que aún no ha ocurrido. El dueño recibía 403
 * `CLIENT_RECLAIM_REQUIRED` en `POST …/requests` — RETIRADA INCLUIDA —, en el
 * `PATCH` de su fila y en el `DELETE` de su propia petición muerta. No podía
 * sacar su dinero, ni soltar la petición que lo retenía, ni arreglar nada: solo
 * un fundador reabre una fila. Nadie decidió ese cierre.
 *
 * Leerla como «no hubo toma de posesión» sería el error contrario (it. 16). La
 * respuesta es la que este fichero ya tenía para una base de datos que no
 * contesta: 503 «no se cambió nada; inténtalo otra vez» — y aquí es verdad, que
 * el reloj de pared pasa la marca solo.
 */
describe('it. 29: a takeover mark dated AHEAD of our clock is not a floor', () => {
  const FUTURE = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const ask = (cid: string, user: string, kind: 'put-to-work' | 'withdraw') =>
    request(app).post(`/api/demo-exchange/runs/run1/clients/${cid}/requests`).set(as(user)).send({ kind, amountXrp: '1' });

  beforeEach(() => {
    mockPrefs.victim = { theme: 'dark', security: { takeoverAt: FUTURE } };
  });

  it('pure: the mark parses, and is still refused — with a sentence that does not call it unreadable', () => {
    expect(() => takeoverAtOf({ security: { takeoverAt: FUTURE } })).toThrow(TakeoverUnreadableError);
    expect(() => takeoverAtOf({ security: { takeoverAt: FUTURE } })).toThrow(/dated later than our clock/i);
    // It really does heal, with nothing written: the same row, a later clock.
    const later = new Date(Date.parse(FUTURE) + 1000);
    expect(takeoverAtOf({ security: { takeoverAt: FUTURE } }, later)?.toISOString()).toBe(FUTURE);
  });

  /** THE ONE THAT MATTERS: the exit is not stopped by a 403 only a founder lifts. */
  it('the owner WITHDRAWAL is answered 503 «try again», never 403 CLIENT_RECLAIM_REQUIRED', async () => {
    const res = await ask('fresh', 'victim', 'withdraw');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('OWNERSHIP_UNREADABLE');
    expect(res.body.error).not.toBe('CLIENT_RECLAIM_REQUIRED');
    // it. 31 (cabo de D): the write doors used to serve the error message
    // TRUNCATED at 80 chars inside the detail. Now it is the same honest body
    // as the portal — cause, `retryable`, and the sentence that says what
    // works (waiting) and what does not (re-linking, a claim code).
    expect(res.body.retryable).toBe(true);
    expect(res.body.cause).toBe('ahead-of-clock');
    expect(res.body.detail).toMatch(/dated later than our own clock/i);
    expect(res.body.detail).toMatch(/nothing was changed and nothing is lost/i);
    expect(res.body.detail).toMatch(/re-linking a wallet will not help/i);
    expect(res.body.detail).not.toMatch(/so it cannot da\)|\(\.\.\.\)/);
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('and neither is retracting the dead request that holds the money, nor repairing the row', async () => {
    store.requests = [{ id: 'rq-dead', kind: 'put-to-work', clientId: 'fresh', drops: '1000000', status: 'pending', createdAt: BEFORE, updatedAt: BEFORE }] as unknown as typeof store.requests;
    const del = await request(app).delete('/api/demo-exchange/runs/run1/clients/fresh/requests/rq-dead').set(as('victim'));
    expect(del.status).toBe(503);
    expect(del.body.error).toBe('OWNERSHIP_UNREADABLE');
    const patch = await request(app).patch('/api/demo-exchange/runs/run1/clients/fresh').set(as('victim')).send({ label: 'mine' });
    expect(patch.status).toBe(503);
    expect(patch.body.error).toBe('OWNERSHIP_UNREADABLE');
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('a binding under that mark is «could not read», not a silent «not proven»', async () => {
    mockBindings.push({ userId: 'victim', address: WALLET, linkedAt: new Date(AFTER) });
    const proof = await request(app).get(`/api/demo-exchange/wallet-proof?addresses=${WALLET}`).set(as('victim'));
    expect(proof.body.wallets[0]).toEqual({ address: WALLET, proof: null, unreadable: true });
  });

  it('the display fails closed too: nothing is served as theirs while the floor is unusable — and the body says so (it. 33)', async () => {
    const view = await request(app).get('/api/demo-exchange/runs/run1').set(as('victim'));
    expect(view.body.run.clients.filter((c: { mine: boolean }) => c.mine)).toEqual([]);
    // it. 33 (2): `mine:[]` alone let the client screen say «Open an account» to
    // the owner of a funded row. The cause travels, with the it. 29 sentence.
    expect(view.body.viewerUnreadable).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', retryable: true, cause: 'ahead-of-clock' });
    expect(view.body.viewerUnreadable.detail).toMatch(/dated later than our own clock/i);
    expect(view.body.viewerUnreadable.detail).toMatch(/no claim code is needed/i);
  });

  /**
   * productizer it. 31 (agente D, 4.2) — …PERO EL PORTAL NO ES EL DISPLAY, Y LA
   * PRUEBA DE ARRIBA CONSAGRABA EL SILENCIO.
   *
   * `GET /runs/for-account` es la PRIMERA llamada del cliente (ExchangeClientApp
   * → ClientPortal): decide de qué exchange es y si su fila es suya. Con la marca
   * adelantada, `viewerTakeover` la convertía en «ahora», `ownershipPredatesTakeover`
   * daba `true` para toda fila, y la respuesta era `200 { found:false,
   * heldElsewhere:{ reclaimRequired:true } }`: «Your sign-in changed since you
   * opened it: the exchange has to confirm it is you again with a claim code» —
   * una acción de FUNDADOR, sin botón y sin reintento. Los 503 de retirada de
   * arriba ni se alcanzaban: la persona no pasaba del portal. La prueba de
   * arriba solo miraba `mine:[]`, así que este cierre pasó dos iteraciones.
   */
  describe('the PORTAL (GET /runs/for-account) answers «I could not read», never «reclaim»', () => {
    const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
    const forAccount = (user?: string) => {
      const req = request(app).get(`/api/demo-exchange/runs/for-account?account=${PASSKEY}`);
      return user ? req.set(as(user)) : req;
    };
    beforeEach(() => {
      store.clients.find((c) => c.id === 'fresh')!.passkeyAccount = PASSKEY;
    });

    it('a mark AHEAD of our clock → 503 OWNERSHIP_UNREADABLE, retryable, with the it. 29 sentence — not reclaimRequired', async () => {
      const res = await forAccount('victim');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', retryable: true, cause: 'ahead-of-clock' });
      expect(res.body.found).toBeUndefined();
      expect(res.body.heldElsewhere).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toMatch(/reclaim/i);
      // The sentence says what is true of THIS cause, and none of the false remedies.
      expect(res.body.detail).toMatch(/dated later than our own clock/i);
      expect(res.body.detail).toMatch(/clears on its own/i);
      expect(res.body.detail).toMatch(/no claim code is needed/i);
      expect(res.body.detail).toMatch(/administrator can check that date/i);
      expect(res.body.detail).not.toMatch(/could not be read/i);
      expect(res.body.detail).not.toMatch(/in a moment/i);
    });

    it('a mark that does not PARSE → the same 503, its own cause, and no «clears on its own»', async () => {
      mockPrefs.victim = { theme: 'dark', security: { takeoverAt: 'not a date' } };
      const res = await forAccount('victim');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', retryable: true, cause: 'unreadable-mark' });
      expect(res.body.detail).toMatch(/could not be read/i);
      expect(res.body.detail).toMatch(/administrator can repair/i);
      expect(res.body.detail).not.toMatch(/clears on its own/i);
      expect(JSON.stringify(res.body)).not.toMatch(/reclaim/i);
    });

    it('a database that does not answer → the same 503, «read-failed», and «in a moment» is honest there', async () => {
      mockState.userReadFails = true;
      const res = await forAccount('victim');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: 'OWNERSHIP_UNREADABLE', retryable: true, cause: 'read-failed' });
      expect(res.body.detail).toMatch(/in a moment/i);
    });

    /** THE CHAIN: the same row, the clock past the mark, nothing written — found. */
    it('a mark in the PAST → found:true, the row is theirs', async () => {
      mockPrefs.victim = { theme: 'dark', security: { takeoverAt: TAKEOVER } };
      const res = await forAccount('victim');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ found: true, runId: 'run1' });
      expect(res.body.client.mine).toBe(true);
    });

    it('a row owned since BEFORE a readable mark still says reclaimRequired — that answer is for a real takeover only', async () => {
      mockPrefs.victim = { theme: 'dark', security: { takeoverAt: TAKEOVER } };
      store.clients.find((c) => c.id === 'fresh')!.passkeyAccount = undefined;
      store.clients.find((c) => c.id === 'stale')!.passkeyAccount = PASSKEY;
      const res = await forAccount('victim');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ found: false, heldElsewhere: { reclaimRequired: true } });
    });

    it('there is no anonymous reader any more: the portal asks for a session (20-sep)', async () => {
      const res = await forAccount();
      expect(res.status).toBe(401);
    });
  });

  /** THE CHAIN, END TO END: the clock passes the mark and the person is back in. */
  it('once the clock is past the mark the same session works again, with nothing written in between', async () => {
    expect((await ask('fresh', 'victim', 'withdraw')).status).toBe(503);
    expect(mockSaveRun).not.toHaveBeenCalled();
    mockPrefs.victim = { theme: 'dark', security: { takeoverAt: TAKEOVER } };
    expect((await ask('fresh', 'victim', 'put-to-work')).status).toBe(201);
  });

  it('an untouched login is not disturbed by another account mark', async () => {
    expect((await ask('plain', 'plain', 'put-to-work')).status).toBe(201);
  });
});

describe('it. 12 (2.2): re-opening a row DETACHES the destinations set before the takeover', () => {
  const SQUATTER_WALLET = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
  const SQUATTER_PASSKEY = '0x9999999999999999999999999999999999999999';
  const OWNER_PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
  const squat = () => {
    const row = store.clients.find((c) => c.id === 'stale')!;
    Object.assign(row, { xrplAddress: SQUATTER_WALLET, xrplAddressProof: 'session', passkeyAccount: SQUATTER_PASSKEY, autoInvest: true, kyc: 'both' });
    store.provenDepositSenders = { stale: [SQUATTER_WALLET], plain: [WALLET] };
    return row;
  };
  const issue = () => request(app).patch('/api/demo-exchange/runs/run1/clients/stale').set(admin).send({ issueClaimCode: true });

  it('payout wallet + proof, Flare account, deposit senders, auto-invest and KYC are cleared; the NOTE says what was detached; pending requests are refused; the old wallet is no payout proof', async () => {
    const row = squat();
    store.requests = [{ id: 'rq1', kind: 'withdraw', clientId: 'stale', drops: '1000000', status: 'pending', createdAt: BEFORE, updatedAt: BEFORE }];
    expect(payoutWalletProven(store, 'stale', SQUATTER_WALLET)).toBe(true);

    const res = await issue();
    expect(res.status).toBe(200);
    expect(row).toMatchObject({ ownerUserId: undefined, xrplAddress: undefined, xrplAddressProof: undefined, passkeyAccount: undefined, autoInvest: undefined, kyc: 'none' });
    expect(store.provenDepositSenders).toEqual({ plain: [WALLET] });
    expect(payoutWalletProven(store, 'stale', SQUATTER_WALLET)).toBe(false);
    expect(store.requests![0]).toMatchObject({ status: 'refused' });
    const note = store.receipts.find((r) => r.step === 'NOTE' && r.clientId === 'stale')!;
    expect(note.expect).toMatchObject({ detachedXrplAddress: SQUATTER_WALLET, detachedPasskeyAccount: SQUATTER_PASSKEY, detachedDepositSenders: SQUATTER_WALLET, detachedAutoInvest: true, detachedKyc: 'both', refusedRequests: 1 });
    expect(note.note).toContain(SQUATTER_WALLET);
    // the account resolves by the squatter's passkey no more
    const byPasskey = await request(app).get(`/api/demo-exchange/runs/for-account?account=${SQUATTER_PASSKEY}`).set(as('plain'));
    expect(byPasskey.body.found).toBe(false);

    // the rightful holder claims it and sets THEIR OWN Flare account (no «already claimed» refusal)
    const claimed = await request(app).patch('/api/demo-exchange/runs/run1/clients/stale').set(as('victim')).send({ claimCode: res.body.claimCode, passkeyAccount: OWNER_PASSKEY });
    expect(claimed.status).toBe(200);
    expect(row.passkeyAccount).toBe(OWNER_PASSKEY);
  });

  it('a payment still moving to those destinations (a submitting withdraw) → 409 PAYMENT_IN_FLIGHT, nothing detached, nothing saved', async () => {
    const row = squat();
    store.requests = [{ id: 'rq2', kind: 'withdraw', clientId: 'stale', drops: '1000000', status: 'submitting', txHash: 'A'.repeat(64), createdAt: BEFORE, updatedAt: BEFORE }];
    const res = await issue();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(row).toMatchObject({ ownerUserId: 'victim', xrplAddress: SQUATTER_WALLET, passkeyAccount: SQUATTER_PASSKEY });
    expect(mockSaveRun).not.toHaveBeenCalled();
  });
});

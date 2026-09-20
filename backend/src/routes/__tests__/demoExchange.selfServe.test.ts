/**
 * The demo exchange's client self-serve routes must not be a path to someone
 * else's money (productizer cycle, iterations 3 and 4):
 *  - a SESSION is required for every self-serve mutation (401 anonymous);
 *  - rows have OWNERS: a desk-created row is claimed only with its one-time
 *    claim code; nobody else mutates a row they do not own;
 *  - a payout wallet written by a non-admin must be PROVEN to the session
 *    (login wallet or signed binding) — and that proof is payout proof;
 *  - the circular payout proof (write a wallet on a victim's row, send 1 drop,
 *    withdraw) has no first step any more;
 *  - money-movement receipts cannot be posted; the receipt book is capped;
 *  - one XRPL wallet = one client of the run.
 */
import express from 'express';
import request from 'supertest';
// Esta suite prueba OTRAS reglas y no tiene ledger: el KYC del exchange (14-sep)
// se prueba en clientCredentialGate.test y demoExchange.credentialGate.test.
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';
import { payoutWalletProven } from '../../services/demoExchange/payoutProof';
import { classifyOmnibusTxs, type OmnibusTx } from '../../services/demoExchange/OmnibusWatcher';

let store: DemoRun;
// 18-sep: más exchanges en el mismo almacén (cliente POR exchange). Vacío por defecto.
let mockExtraRuns: DemoRun[] = [];
const mockSaveRun = jest.fn(async () => undefined);

jest.mock('../../services/demoExchange/DemoExchangeStore', () => {
  const actual = jest.requireActual('../../services/demoExchange/DemoExchangeStore');
  return {
    ...actual,
    loadRun: jest.fn(async (id: string) => [store, ...mockExtraRuns].find((r) => r.runId === id) ?? null),
    listRuns: jest.fn(async () => [store, ...mockExtraRuns]),
    saveRun: (...a: unknown[]) => mockSaveRun(...(a as [])),
  };
});

// The SIWE session of a test request: `x-test-user` (+ `x-test-wallet`, the
// wallet the login signature proved). No header = no session.
jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: `s-${user}`, walletAddress: req.header('x-test-wallet') ?? '' };
    next();
  },
}));

import router, { hashClaimCode } from '../demoExchange';
import { _resetKeyFailuresForTests } from '../adminPanel';

const WALLET_A = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const WALLET_B = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const ATTACKER_WALLET = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';
const PASSKEY = '0x1111111111111111111111111111111111111111';
const OTHER_PASSKEY = '0x2222222222222222222222222222222222222222';
const CODE = 'ABCD-EF01-2345-6789-ABCD';
const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';

const T0 = new Date(0).toISOString();
const row = (id: string, tag: number, extra: Record<string, unknown> = {}) => ({ id, runId: 'run1', label: id, tag, kyc: 'none', xrpOnExchangeDrops: '0', createdAt: T0, ...extra });

function freshRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Test exchange',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [
      // owned by alice, funded, no wallet yet (deposited before registering one)
      row('alice', 101, { ownerUserId: 'alice', xrpOnExchangeDrops: '5000000' }),
      // owned by bob, holds WALLET_A
      row('bob', 102, { ownerUserId: 'bob', xrplAddress: WALLET_A, xrplAddressProof: 'session' }),
      // desk-created, unowned, with a claim code
      row('desk', 103, { claimCodeHash: hashClaimCode(CODE), xrpOnExchangeDrops: '2000000' }),
      // legacy: passkey on file, no owner, no code
      row('legacy', 104, { passkeyAccount: PASSKEY }),
      // the victim of the circular-proof attack: owned, funded by a 'return', no wallet
      row('victim', 105, { ownerUserId: 'victim', xrpOnExchangeDrops: '7000000', passkeyAccount: OTHER_PASSKEY }),
    ],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
  } as unknown as DemoRun;
}

const client = (id: string) => store.clients.find((c) => c.id === id)!;
const as = (user: string, wallet = '') => ({ 'x-test-user': user, 'x-test-wallet': wallet, Authorization: 'Bearer test' });

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, emails: process.env.ADMIN_EMAILS, key: process.env.ADMIN_PANEL_KEY };
beforeAll(() => {
  delete process.env.DATABASE_URL; // only the session wallet counts as proof
  delete process.env.ADMIN_EMAILS;
  delete process.env.ADMIN_PANEL_KEY;
});
beforeEach(() => {
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  store = freshRun();
  mockExtraRuns = [];
  mockSaveRun.mockClear();
});
afterAll(() => {
  for (const [k, v] of [['INSTITUTIONAL_POTES_ENABLED', SAVED.flag], ['DATABASE_URL', SAVED.db], ['ADMIN_EMAILS', SAVED.emails], ['ADMIN_PANEL_KEY', SAVED.key]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('a session is required for every self-serve mutation', () => {
  it.each([
    ['post', '/runs/run1/clients', { label: 'Anon' }],
    ['patch', '/runs/run1/clients/desk', { claimCode: CODE }],
    ['post', '/runs/run1/clients/alice/requests', { kind: 'withdraw', amountXrp: '1' }],
    ['post', '/runs/run1/clients/alice/deposit-instructions', { amountXrp: '1' }],
    ['post', '/runs/run1/receipts', { step: 'NOTE', chain: 'none' }],
  ] as const)('anonymous %s %s → 401, nothing saved', async (method, path, body) => {
    const res = await request(app)[method](`/api/demo-exchange${path}`).send(body);
    expect(res.status).toBe(401);
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('reads need a door (20-sep), and what they serve never carries the claim hash, the owner id or the creator id', async () => {
    expect((await request(app).get('/api/demo-exchange/runs/run1')).status).toBe(401);
    expect((await request(app).get('/api/demo-exchange/runs')).status).toBe(401);
    // Quien no es ni dueño ni cliente recibe lo mismo que por un id inventado.
    expect((await request(app).get('/api/demo-exchange/runs/run1').set(as('zoe'))).status).toBe(404);

    // Un CLIENTE lee su exchange, y de las fichas solo la suya.
    const member = await request(app).get('/api/demo-exchange/runs/run1').set(as('alice'));
    expect(member.status).toBe(200);
    expect(member.body.run.clients.map((c: { id: string }) => c.id)).toEqual(['alice']);
    expect(member.body.run.clients[0]).toMatchObject({ owned: true, mine: true });
    expect(JSON.stringify(member.body)).not.toContain('bob');

    // La mesa lo lee entero.
    process.env.ADMIN_PANEL_KEY = 'founder-test-key';
    const res = await request(app).get('/api/demo-exchange/runs/run1').set({ 'x-admin-key': 'founder-test-key' });
    expect(res.status).toBe(200);
    for (const body of [res.body, member.body]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain('claimCodeHash');
      expect(text).not.toContain('ownerUserId');
      expect(text).not.toContain('createdByUserId');
    }
    const desk = res.body.run.clients.find((c: { id: string }) => c.id === 'desk');
    expect(desk).toMatchObject({ owned: false, claimable: true, mine: false });
  });

  it('a session sees which rows are its own', async () => {
    const res = await request(app).get('/api/demo-exchange/runs/run1').set(as('alice'));
    const mine = res.body.run.clients.filter((c: { mine: boolean }) => c.mine).map((c: { id: string }) => c.id);
    expect(mine).toEqual(['alice']);
  });
});

describe('ownership: claim codes and NOT_YOUR_CLIENT', () => {
  it('claiming an unowned desk row without the code → 403 CLAIM_CODE_REQUIRED', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/desk').set(as('carol')).send({ passkeyAccount: PASSKEY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CLAIM_CODE_REQUIRED');
    expect(client('desk').ownerUserId).toBeUndefined();
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('a wrong code → 403 CLAIM_CODE_INVALID', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/desk').set(as('carol')).send({ claimCode: 'FFFF-FFFF-FFFF-FFFF-FFFF' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CLAIM_CODE_INVALID');
  });

  it('the right code makes the session the owner — once; the code is spent', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/desk').set(as('carol')).send({ claimCode: CODE.toLowerCase(), passkeyAccount: OTHER_PASSKEY });
    expect(res.status).toBe(200);
    expect(client('desk').ownerUserId).toBe('carol');
    expect(client('desk').claimCodeHash).toBeUndefined();
    expect(res.body.client).toMatchObject({ mine: true, owned: true, claimable: false });

    const replay = await request(app).patch('/api/demo-exchange/runs/run1/clients/desk').set(as('mallory')).send({ claimCode: CODE, label: 'mine now' });
    expect(replay.status).toBe(403);
    expect(replay.body.error).toBe('NOT_YOUR_CLIENT');
  });

  it('a legacy row (passkey, no owner, no code) is not claimable self-serve', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/legacy').set(as('carol')).send({ passkeyAccount: PASSKEY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CLAIM_CODE_REQUIRED');
  });

  it("a non-owner cannot PATCH, request, compose deposits or post receipts about someone else's row", async () => {
    const patch = await request(app).patch('/api/demo-exchange/runs/run1/clients/alice').set(as('mallory')).send({ autoInvest: true, label: 'x' });
    expect(patch.status).toBe(403);
    expect(patch.body.error).toBe('NOT_YOUR_CLIENT');
    const req = await request(app).post('/api/demo-exchange/runs/run1/clients/alice/requests').set(as('mallory')).send({ kind: 'put-to-work', amountXrp: '1' });
    expect(req.status).toBe(403);
    const dep = await request(app).post('/api/demo-exchange/runs/run1/clients/alice/deposit-instructions').set(as('mallory')).send({ amountXrp: '1' });
    expect(dep.status).toBe(403);
    const rc = await request(app).post('/api/demo-exchange/runs/run1/receipts').set(as('mallory')).send({ step: 'NOTE', chain: 'none', clientId: 'alice' });
    expect(rc.status).toBe(403);
    expect(client('alice').autoInvest).toBeUndefined();
    expect(store.requests).toHaveLength(0);
    expect(store.receipts).toHaveLength(0);
  });

  it('an unowned row takes no requests either (claim it first)', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/clients/desk/requests').set(as('carol')).send({ kind: 'withdraw', amountXrp: '1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_YOUR_CLIENT');
  });

  it('the owner acts on their own row', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/clients/alice/requests').set(as('alice')).send({ kind: 'put-to-work', amountXrp: '1' });
    expect(res.status).toBe(201);
    expect(store.requests).toHaveLength(1);
  });

  it('kyc / ownerUserId / issueClaimCode are founder-only fields', async () => {
    for (const body of [{ kyc: 'both' }, { ownerUserId: 'alice' }, { issueClaimCode: true }]) {
      const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/alice').set(as('alice')).send(body);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('ADMIN_ONLY_FIELD');
    }
  });

  it('a self-serve alta is owned by its session', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('dave')).send({ label: 'Dave', passkeyAccount: '0x3333333333333333333333333333333333333333' });
    expect(res.status).toBe(201);
    expect(res.body.claimCode).toBeUndefined();
    expect(store.clients[store.clients.length - 1].ownerUserId).toBe('dave');
  });

  it('it. 12 (2.6c): one owner opens at most N rows per run (default 5, env-overridable) — the tag range is everyone\'s', async () => {
    const open = (n: number) => request(app).post('/api/demo-exchange/runs/run1/clients').set(as('spammer')).send({ label: `S${n}` });
    for (let i = 0; i < 5; i++) expect((await open(i)).status).toBe(201);
    const sixth = await open(6);
    expect(sixth.status).toBe(409);
    expect(sixth.body).toMatchObject({ error: 'CLIENTS_PER_OWNER_LIMIT', limit: 5 });
    expect(sixth.body.detail).toMatch(/limit 5/);
    expect(store.clients.filter((c) => c.ownerUserId === 'spammer')).toHaveLength(5);
    // another owner is not affected; the cap is configurable
    expect((await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('someone')).send({ label: 'Else' })).status).toBe(201);
    process.env.DEMO_EXCHANGE_MAX_CLIENTS_PER_OWNER = '1';
    try {
      expect((await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('someone')).send({ label: 'Else 2' })).body.error).toBe('CLIENTS_PER_OWNER_LIMIT');
    } finally {
      delete process.env.DEMO_EXCHANGE_MAX_CLIENTS_PER_OWNER;
    }
  });
});

describe('passkey duplicates are per owner', () => {
  it("someone else's row with my passkey does not lock me out (the passkey address is public)", async () => {
    // 'victim' row carries OTHER_PASSKEY and is owned by 'victim'; erin opens her own.
    const res = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('erin')).send({ label: 'Erin', passkeyAccount: OTHER_PASSKEY });
    expect(res.status).toBe(201);
  });

  it('the same owner cannot open two rows for one passkey', async () => {
    const first = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('erin')).send({ label: 'Erin', passkeyAccount: '0x4444444444444444444444444444444444444444' });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('erin')).send({ label: 'Erin 2', passkeyAccount: '0x4444444444444444444444444444444444444444' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('ACCOUNT_ALREADY_A_CLIENT');
  });

  it('/runs/for-account: an authenticated caller gets THEIR row, never another owner\'s', async () => {
    store.clients.push(row('erinRow', 106, { ownerUserId: 'erin', passkeyAccount: OTHER_PASSKEY }) as unknown as DemoRun['clients'][number]);
    const mine = await request(app).get(`/api/demo-exchange/runs/for-account?account=${OTHER_PASSKEY}`).set(as('erin'));
    expect(mine.body.client.id).toBe('erinRow');
    const stranger = await request(app).get(`/api/demo-exchange/runs/for-account?account=${OTHER_PASSKEY}`).set(as('zoe'));
    expect(stranger.body.found).toBe(false);
    // 14-sep: y se le DICE que esa llave ya tiene cuenta en ese exchange (nunca de quién),
    // para que no abra una segunda ficha para la misma llave.
    expect(stranger.body.heldElsewhere).toEqual({ exchange: expect.objectContaining({ runId: 'run1' }), reclaimRequired: false });
    expect(JSON.stringify(stranger.body.heldElsewhere)).not.toContain('erin');
    // 20-sep: el portal ya no contesta a una lectura anónima.
    const anon = await request(app).get(`/api/demo-exchange/runs/for-account?account=${OTHER_PASSKEY}`);
    expect(anon.status).toBe(401);
  });
});

/**
 * 18-sep (fundador: «cuando crea una cuenta a un exchange es al que ha pedido
 * acceso y le han dado la verificación, sino no está dentro de ese exchange»):
 * ser cliente es POR EXCHANGE. La misma llave pide acceso a otro exchange con su
 * propia ficha (su tag, su KYC); dentro de UN exchange sigue siendo una ficha.
 */
describe('a passkey is one client PER EXCHANGE', () => {
  const KEY = '0x5555555555555555555555555555555555555555';
  const secondRun = (): DemoRun =>
    ({ ...freshRun(), runId: 'run2', seq: 2, label: 'Second exchange', councilAddress: 'rEvD7wxmbwng8skmqNu8R6wAUQQVVXXACv', omnibusAddress: 'r4yp47QPbB3XcVurs8pbE75k7EwQ1GEBAa', clients: [] }) as unknown as DemoRun;

  it('the same owner opens an account at a SECOND exchange with the same passkey', async () => {
    mockExtraRuns = [secondRun()];
    const first = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('erin')).send({ label: 'Erin', passkeyAccount: KEY });
    expect(first.status).toBe(201);
    const second = await request(app).post('/api/demo-exchange/runs/run2/clients').set(as('erin')).send({ label: 'Erin', passkeyAccount: KEY });
    expect(second.status).toBe(201);
    expect(mockExtraRuns[0].clients.filter((c) => c.passkeyAccount === KEY)).toHaveLength(1);
    // …y dentro del MISMO exchange sigue siendo una sola ficha.
    const again = await request(app).post('/api/demo-exchange/runs/run2/clients').set(as('erin')).send({ label: 'Erin 2', passkeyAccount: KEY });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('ACCOUNT_ALREADY_A_CLIENT');
    expect(again.body.runId).toBe('run2');
  });

  it('/runs/for-account: a client of one exchange sees its account AND the exchanges it can still ask to join', async () => {
    mockExtraRuns = [secondRun()];
    store.clients.push(row('erinRow', 106, { ownerUserId: 'erin', passkeyAccount: KEY }) as unknown as DemoRun['clients'][number]);
    const res = await request(app).get(`/api/demo-exchange/runs/for-account?account=${KEY}`).set(as('erin'));
    expect(res.body.found).toBe(true);
    expect(res.body.runId).toBe('run1');
    expect(res.body.memberships.map((m: { runId: string }) => m.runId)).toEqual(['run1']);
    expect(res.body.joinable.map((r: { runId: string }) => r.runId)).toEqual(['run2']);
  });

  it('with accounts at both, «Enter» gets both and nothing is joinable', async () => {
    const r2 = secondRun();
    r2.clients.push(row('erinRow2', 201, { runId: 'run2', ownerUserId: 'erin', passkeyAccount: KEY }) as unknown as DemoRun['clients'][number]);
    mockExtraRuns = [r2];
    store.clients.push(row('erinRow', 106, { ownerUserId: 'erin', passkeyAccount: KEY }) as unknown as DemoRun['clients'][number]);
    const res = await request(app).get(`/api/demo-exchange/runs/for-account?account=${KEY}`).set(as('erin'));
    expect(res.body.memberships.map((m: { runId: string }) => m.runId).sort()).toEqual(['run1', 'run2']);
    expect(res.body.joinable).toEqual([]);
  });

  it('an exchange where this key already has a row of ANOTHER session is not offered to join (14-sep: no second row for one key)', async () => {
    mockExtraRuns = [secondRun()];
    // 'victim' (run1) carries OTHER_PASSKEY and belongs to someone else.
    const res = await request(app).get(`/api/demo-exchange/runs/for-account?account=${OTHER_PASSKEY}`).set(as('zoe'));
    expect(res.body.found).toBe(false);
    expect(res.body.heldElsewhere.exchange.runId).toBe('run1');
    expect(res.body.joinable.map((r: { runId: string }) => r.runId)).toEqual(['run2']);
  });

  it('a closed exchange is never joinable', async () => {
    mockExtraRuns = [{ ...secondRun(), status: 'closed' } as DemoRun];
    const res = await request(app).get(`/api/demo-exchange/runs/for-account?account=${KEY}`).set(as('erin'));
    expect(res.body.joinable.map((r: { runId: string }) => r.runId)).toEqual(['run1']);
  });
});

describe('the payout wallet must be proven to the session', () => {
  it('an unproven wallet on my own row → 403 WALLET_NOT_PROVEN', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/alice').set(as('alice', WALLET_B)).send({ xrplAddress: ATTACKER_WALLET });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WALLET_NOT_PROVEN');
    expect(client('alice').xrplAddress).toBeUndefined();
  });

  it('an unproven wallet at alta → 403', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('dave', WALLET_B)).send({ label: 'Dave', xrplAddress: ATTACKER_WALLET });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WALLET_NOT_PROVEN');
  });

  it('a session-proven wallet is accepted on a FUNDED row (no CLIENT_HAS_ACTIVITY) and is payout proof', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/alice').set(as('alice', WALLET_B)).send({ xrplAddress: WALLET_B });
    expect(res.status).toBe(200);
    expect(client('alice')).toMatchObject({ xrplAddress: WALLET_B, xrplAddressProof: 'session' });
    expect(payoutWalletProven(store, 'alice', WALLET_B)).toBe(true);
  });

  it('set once: the owner cannot re-point it → 409 CLIENT_WALLET_ALREADY_SET', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/bob').set(as('bob', WALLET_B)).send({ xrplAddress: WALLET_B });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CLIENT_WALLET_ALREADY_SET');
  });

  it("one XRPL wallet, one client: a proven wallet another client holds → 409", async () => {
    const post = await request(app).post('/api/demo-exchange/runs/run1/clients').set(as('dave', WALLET_A)).send({ label: 'Shadow', xrplAddress: WALLET_A });
    expect(post.status).toBe(409);
    expect(post.body.error).toBe('WALLET_ALREADY_A_CLIENT');
    const patch = await request(app).patch('/api/demo-exchange/runs/run1/clients/alice').set(as('alice', WALLET_A)).send({ xrplAddress: WALLET_A });
    expect(patch.status).toBe(409);
    expect(patch.body.error).toBe('WALLET_ALREADY_A_CLIENT');
  });
});

describe('iteration-4 attack: the circular payout proof', () => {
  it('writing a wallet on the victim row, 1 drop in, withdraw → never a payout', async () => {
    // Step 1: point the victim's payout wallet at the attacker's (proven) wallet.
    const wallet = await request(app).patch('/api/demo-exchange/runs/run1/clients/victim').set(as('mallory', ATTACKER_WALLET)).send({ xrplAddress: ATTACKER_WALLET });
    expect(wallet.status).toBe(403);
    expect(client('victim').xrplAddress).toBeUndefined();

    // Step 2: 1 drop from the attacker's wallet to the victim's tag is a 'return',
    // not a deposit — the row has no wallet for it to match.
    const tx: OmnibusTx = { hash: 'D'.repeat(64), account: ATTACKER_WALLET, destination: OMNIBUS, destinationTag: 105, drops: '1', dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'in' };
    const [classified] = classifyOmnibusTxs([tx], store.clients);
    expect(classified.kind).toBe('return');

    // Step 3: the withdraw request itself.
    const withdraw = await request(app).post('/api/demo-exchange/runs/run1/clients/victim/requests').set(as('mallory', ATTACKER_WALLET)).send({ kind: 'withdraw', amountXrp: '7' });
    expect(withdraw.status).toBe(403);
    expect(store.requests).toHaveLength(0);
    expect(payoutWalletProven(store, 'victim', ATTACKER_WALLET)).toBe(false);
  });
});

describe('open receipts route', () => {
  it.each(['U1_DEPOSIT', 'U4_EXIT_XRP', 'E5_PUT_TO_WORK', 'E8_WITHDRAW'])('refuses a posted %s receipt (the watcher writes those)', async (step) => {
    const res = await request(app)
      .post('/api/demo-exchange/runs/run1/receipts')
      .set(as('alice'))
      .send({ step, chain: 'xrpl', txHash: 'A'.repeat(64), clientId: 'alice', expect: { from: WALLET_B } });
    expect(res.status).toBe(400);
    expect(store.receipts).toHaveLength(0);
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it('still accepts the evidence steps the client app posts about its own row', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/receipts').set(as('alice')).send({ step: 'E3_CREDENTIAL', chain: 'xrpl', txHash: 'B'.repeat(64), clientId: 'alice' });
    expect(res.status).toBe(201);
  });

  it('it. 12 (2.6a): a receipt about NO client is the exchange\'s own evidence — a session → 403 RECEIPT_CLIENT_REQUIRED, nothing saved', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/receipts').set(as('alice')).send({ step: 'NOTE', chain: 'none', note: 'filler' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('RECEIPT_CLIENT_REQUIRED');
    expect(store.receipts).toHaveLength(0);
    expect(mockSaveRun).not.toHaveBeenCalled();
  });

  it("accepts the owner's own U4_EXIT_XRP on Flare (the Face ID exit batch)", async () => {
    const res = await request(app)
      .post('/api/demo-exchange/runs/run1/receipts')
      .set(as('alice'))
      .send({ step: 'U4_EXIT_XRP', chain: 'flare', txHash: 'C'.repeat(64), clientId: 'alice' });
    expect(res.status).toBe(201);
    expect(store.receipts).toHaveLength(1);
  });

  it('expect is bounded: ≤20 keys, values ≤200 chars', async () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v']));
    const tooMany = await request(app).post('/api/demo-exchange/runs/run1/receipts').set(as('alice')).send({ step: 'NOTE', chain: 'none', clientId: 'alice', expect: many });
    expect(tooMany.status).toBe(400);
    const tooLong = await request(app).post('/api/demo-exchange/runs/run1/receipts').set(as('alice')).send({ step: 'NOTE', chain: 'none', clientId: 'alice', expect: { note: 'x'.repeat(201) } });
    expect(tooLong.status).toBe(400);
    const nested = await request(app).post('/api/demo-exchange/runs/run1/receipts').set(as('alice')).send({ step: 'NOTE', chain: 'none', clientId: 'alice', expect: { a: { b: 1 } } });
    expect(nested.status).toBe(400);
  });

  it('a run with 500 receipts takes no more from a non-admin → 409 RUN_RECEIPTS_FULL', async () => {
    store.receipts = Array.from({ length: 500 }, (_, i) => ({ id: `rc${i}`, runId: 'run1', step: 'NOTE', chain: 'none', at: T0, checks: [] })) as DemoRun['receipts'];
    const res = await request(app).post('/api/demo-exchange/runs/run1/receipts').set(as('alice')).send({ step: 'NOTE', chain: 'none', clientId: 'alice' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RUN_RECEIPTS_FULL');
  });
});

describe('a founder session', () => {
  beforeEach(() => {
    process.env.ADMIN_PANEL_KEY = 'founder-test-key';
  });
  afterEach(() => {
    _resetKeyFailuresForTests();
    delete process.env.ADMIN_PANEL_KEY;
  });
  const admin = { 'x-admin-key': 'founder-test-key' };

  it('desk alta → an UNOWNED row and a one-time claim code that the client then redeems', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/clients').set(admin).send({ label: 'Invited' });
    expect(res.status).toBe(201);
    expect(res.body.claimCode).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
    const created = store.clients[store.clients.length - 1];
    expect(created.ownerUserId).toBeUndefined();
    expect(created.claimCodeHash).toBe(hashClaimCode(res.body.claimCode));
    expect(JSON.stringify(res.body.run)).not.toContain('claimCodeHash');

    const claim = await request(app).patch(`/api/demo-exchange/runs/run1/clients/${created.id}`).set(as('frank')).send({ claimCode: res.body.claimCode, passkeyAccount: PASSKEY });
    expect(claim.status).toBe(200);
    expect(created.ownerUserId).toBe('frank');
  });

  it('binds a funded row and writes a wallet (proof = admin, not payout proof by itself)', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/desk').set(admin).send({ passkeyAccount: PASSKEY, xrplAddress: WALLET_B });
    expect(res.status).toBe(200);
    expect(client('desk')).toMatchObject({ xrplAddress: WALLET_B, xrplAddressProof: 'admin' });
    expect(payoutWalletProven(store, 'desk', WALLET_B)).toBe(false);
  });

  it('issues a claim code for a legacy row', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/legacy').set(admin).send({ issueClaimCode: true });
    expect(res.status).toBe(200);
    expect(client('legacy').claimCodeHash).toBe(hashClaimCode(res.body.claimCode));
  });

  it('a wrong admin key is not a founder: back to the session rule', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/desk').set({ 'x-admin-key': 'not-the-key' }).send({ passkeyAccount: PASSKEY });
    expect(res.status).toBe(401);
  });

  it('even a founder cannot give one wallet to two clients', async () => {
    const res = await request(app).patch('/api/demo-exchange/runs/run1/clients/alice').set(admin).send({ xrplAddress: WALLET_A });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('WALLET_ALREADY_A_CLIENT');
  });
});

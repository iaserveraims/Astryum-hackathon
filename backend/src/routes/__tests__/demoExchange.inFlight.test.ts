/**
 * What is in flight is reserved, at every door that composes an omnibus payment
 * (productizer cycle, it. 6):
 *  - the client requests route refuses what is already spoken for
 *    (INSUFFICIENT_AVAILABLE_BALANCE);
 *  - the desk payout (/withdraw/prepare) refuses PAYMENT_IN_FLIGHT, stamps a
 *    LastLedgerSequence and records the hand-off server-side — a desk that lost
 *    its pending state (the stage unmounted it, a reload) cannot pay twice;
 *  - the desk reservation closes by the ledger (mirror applied / LLS passed after
 *    a scan) or by an explicit release, never by a guess;
 *  - a deleted run's seq is never handed out again (tag reuse);
 *  - /wallet-proof serves the server's own proof verdict.
 * It. 10: a put-to-work reservation is matched ONLY by the memo stored on it,
 * over a bounded window; a memo-less one only if no unexplained 0xFE is there.
 */
import express from 'express';
import request from 'supertest';
// Esta suite prueba OTRAS reglas y no tiene ledger: el KYC del exchange (14-sep)
// se prueba en clientCredentialGate.test y demoExchange.credentialGate.test.
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
import type { DemoRun, DeskPayment } from '../../services/demoExchange/DemoExchangeStore';
import type { OmnibusTx } from '../../services/demoExchange/OmnibusWatcher';
import type { OmnibusHandoff, ReportedTx } from '../../services/demoExchange/deskPaymentReads';

let ledgerIndex: number | null = 1000;
let scanTxs: OmnibusTx[] = [];
/** What the bounded window reads (scanOmnibusWindow / scanOmnibusWindowUntil) return — independent of the 2-page scan. */
let mockWindowTxs: OmnibusTx[] = [];
let mockHandoffByMemo: Record<string, OmnibusHandoff> = {};
let mockTx: ReportedTx = { found: false };
const mockCoreVault = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

jest.mock('../../services/demoExchange/OmnibusWatcher', () => {
  const actual = jest.requireActual('../../services/demoExchange/OmnibusWatcher');
  return {
    ...actual,
    currentValidatedLedgerIndex: jest.fn(async () => ledgerIndex),
    scanOmnibus: jest.fn(async () => scanTxs),
    scanOmnibusWindow: jest.fn(async () => mockWindowTxs),
    scanOmnibusWindowUntil: jest.fn(async (_o: string, opts: { stop?: (t: OmnibusTx) => boolean }) => {
      const rows: OmnibusTx[] = [];
      for (const t of mockWindowTxs) {
        rows.push(t);
        if (opts.stop?.(t)) return { rows, match: t };
      }
      return { rows };
    }),
  };
});

jest.mock('../../services/demoExchange/deskPaymentReads', () => ({
  findHandoffByMemo: jest.fn(async (memo: string) => mockHandoffByMemo[memo.toUpperCase()] ?? null),
  readXrplTx: jest.fn(async () => mockTx),
  readCoreVaultAddress: jest.fn(async () => mockCoreVault),
  mintExecutedOnFlare: jest.fn(async () => true),
}));

jest.mock('../../services/demoExchange/DemoRunVerifier', () => ({
  explorerUrl: () => undefined,
  flareProvider: () => ({}),
  readClientFacts: jest.fn(async () => []),
  verifyRun: jest.fn(async (run: DemoRun) => run),
}));

jest.mock('../../services/demoExchange/resolveRunPote', () => ({ resolveRunPote: async () => null }));

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { header: (h: string) => string | undefined; siwe?: unknown }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const user = req.header('x-test-user');
    if (!user) return void res.status(401).json({ error: 'missing_bearer_token' });
    req.siwe = { userId: user, sessionId: `s-${user}`, walletAddress: req.header('x-test-wallet') ?? '' };
    next();
  },
}));

import router from '../demoExchange';
import { _resetKeyFailuresForTests } from '../adminPanel';
import { __resetDemoExchangeMemoryForTests, loadRun, saveRun } from '../../services/demoExchange/DemoExchangeStore';
import { _resetSubmissionJournal, writeSubmission } from '../../services/demoExchange/submissionJournal';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const OTHER = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const T0 = new Date(0).toISOString();
const HASH = 'C'.repeat(64);
const FE_HASH = 'D'.repeat(64);
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
const CORE_VAULT = mockCoreVault;
const MEMO = 'FE' + 'AB'.repeat(20);

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);

const admin = { 'x-admin-key': 'founder-test-key' };
const as = (user: string, wallet = '') => ({ 'x-test-user': user, 'x-test-wallet': wallet, Authorization: 'Bearer test' });

function seedRun(balanceDrops = '2000000'): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'In flight',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [{ id: 'c1', runId: 'run1', label: 'Alice', tag: 101, kyc: 'none', ownerUserId: 'alice', passkeyAccount: PASSKEY, xrplAddress: WALLET, xrplAddressProof: 'session', xrpOnExchangeDrops: balanceDrops, createdAt: T0 }],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
  };
}

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, key: process.env.ADMIN_PANEL_KEY, emails: process.env.ADMIN_EMAILS };
beforeAll(() => {
  delete process.env.DATABASE_URL; // the real store, in memory
  delete process.env.ADMIN_EMAILS;
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.ADMIN_PANEL_KEY = 'founder-test-key';
});
afterAll(() => {
  for (const [k, v] of [['INSTITUTIONAL_POTES_ENABLED', SAVED.flag], ['DATABASE_URL', SAVED.db], ['ADMIN_PANEL_KEY', SAVED.key], ['ADMIN_EMAILS', SAVED.emails]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(async () => {
  __resetDemoExchangeMemoryForTests();
  _resetSubmissionJournal();
  ledgerIndex = 1000;
  scanTxs = [];
  mockWindowTxs = [];
  mockHandoffByMemo = {};
  mockTx = { found: false };
  await saveRun(seedRun());
});
afterEach(() => _resetKeyFailuresForTests());

const prepare = (amountXrp: string) => request(app).post('/api/demo-exchange/runs/run1/withdraw/prepare').set(admin).send({ clientId: 'c1', amountXrp });
const ask = (kind: string, amountXrp: string) => request(app).post('/api/demo-exchange/runs/run1/clients/c1/requests').set(as('alice')).send({ kind, amountXrp });
const payoutTx = (drops: string, li = 1001): OmnibusTx => ({ hash: HASH, account: OMNIBUS, destination: WALLET, drops, dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'out', ledgerIndex: li });

describe('client requests: what is in flight is reserved', () => {
  it('withdraw X then put-to-work X with X at the exchange → 409 INSUFFICIENT_AVAILABLE_BALANCE naming the reserve', async () => {
    const first = await ask('withdraw', '2');
    expect(first.status).toBe(201);
    const second = await ask('put-to-work', '2');
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    expect(second.body.reservedDrops).toBe('2000000');
    expect(second.body.detail).toMatch(/2\.000000 XRP of it are reserved/);
    expect((await loadRun('run1'))!.requests).toHaveLength(1);
  });

  it('a request that fits in what is left is accepted', async () => {
    expect((await ask('withdraw', '1.5')).status).toBe(201);
    expect((await ask('put-to-work', '0.5')).status).toBe(201);
  });

  it('a submitting request the watcher already mirrored does not reserve twice', async () => {
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rq1', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'submitting', txHash: HASH, createdAt: T0, updatedAt: T0 }];
    run.appliedTxHashes = [`out:${HASH}`];
    run.clients[0].xrpOnExchangeDrops = '1000000'; // already debited by the watcher
    await saveRun(run);
    expect((await ask('put-to-work', '1')).status).toBe(201);
  });
});

describe('desk payout: PAYMENT_IN_FLIGHT and the server-side hand-off', () => {
  it('refuses while the client has a pending autopilot request', async () => {
    expect((await ask('withdraw', '1')).status).toBe(201);
    const res = await prepare('1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.inFlight[0]).toMatchObject({ source: 'request', kind: 'withdraw', status: 'pending' });
  });

  it('stamps LastLedgerSequence and records the hand-off; a second compose (the desk lost its state) is refused', async () => {
    const res = await prepare('2');
    expect(res.status).toBe(200);
    expect(res.body.xrplTx.LastLedgerSequence).toBe(1100);
    expect(res.body.deskPayment).toMatchObject({ kind: 'withdraw', status: 'prepared', lastLedgerSequence: 1100, drops: '2000000' });
    expect((await loadRun('run1'))!.deskPayments).toHaveLength(1);

    const again = await prepare('2');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('PAYMENT_IN_FLIGHT');
    // …and the client cannot ask for the same XRP while the desk holds it
    const asked = await ask('put-to-work', '1');
    expect(asked.status).toBe(409);
    expect(asked.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
  });

  it('signed → still in flight until the watcher mirrors it; then settled and the balance is debited once', async () => {
    const { body } = await prepare('2');
    const signed = await request(app).post(`/api/demo-exchange/runs/run1/desk-payments/${body.deskPayment.id}/signed`).set(admin).send({ txHash: HASH.toLowerCase() });
    expect(signed.status).toBe(200);
    expect(signed.body.deskPayment).toMatchObject({ status: 'signed', txHash: HASH });

    ledgerIndex = 5000; // the LLS is long past — a SIGNED payment is not released by it
    expect((await prepare('1')).body.error).toBe('PAYMENT_IN_FLIGHT');

    scanTxs = [payoutTx('2000000')];
    const after = await prepare('1');
    expect(after.status).toBe(409);
    expect(after.body.error).toBe('INSUFFICIENT_LEDGER_BALANCE'); // not in flight any more: simply spent
    const run = (await loadRun('run1'))!;
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(run.deskPayments![0].status).toBe('settled');
  });

  it('an unreported hand-off closes only once the ledger is past its LastLedgerSequence', async () => {
    expect((await prepare('1')).status).toBe(200);
    ledgerIndex = 1100; // the payment could still enter ledger 1100
    expect((await prepare('1')).body.error).toBe('PAYMENT_IN_FLIGHT');
    ledgerIndex = 1101;
    const res = await prepare('1');
    expect(res.status).toBe(200);
    const run = (await loadRun('run1'))!;
    expect(run.deskPayments!.map((p) => p.status)).toEqual(['released', 'prepared']);
  });

  it('…and if it DID land before its LastLedgerSequence, the scan debits it before anything new is composed', async () => {
    expect((await prepare('2')).status).toBe(200);
    ledgerIndex = 1200;
    scanTxs = [payoutTx('2000000', 1050)];
    const res = await prepare('1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_LEDGER_BALANCE');
  });

  it('no validated ledger → 503, nothing prepared; an unscannable omnibus → 502', async () => {
    ledgerIndex = null;
    const noLedger = await prepare('1');
    expect(noLedger.status).toBe(503);
    expect(noLedger.body.error).toBe('LEDGER_UNREADABLE');
    ledgerIndex = 1000;
    const { scanOmnibus } = jest.requireMock('../../services/demoExchange/OmnibusWatcher') as { scanOmnibus: jest.Mock };
    scanOmnibus.mockRejectedValueOnce(new Error('rippled frozen'));
    const noScan = await prepare('1');
    expect(noScan.status).toBe(502);
    expect((await loadRun('run1'))!.deskPayments ?? []).toHaveLength(0);
  });

  it('release: a prepared hand-off is released (Back); a signed one only by force', async () => {
    const { body } = await prepare('1');
    const released = await request(app).delete(`/api/demo-exchange/runs/run1/desk-payments/${body.deskPayment.id}`).set(admin);
    expect(released.status).toBe(200);
    expect(released.body.deskPayment.status).toBe('released');

    const second = await prepare('1');
    expect(second.status).toBe(200);
    await request(app).post(`/api/demo-exchange/runs/run1/desk-payments/${second.body.deskPayment.id}/signed`).set(admin).send({ txHash: HASH });
    const refused = await request(app).delete(`/api/demo-exchange/runs/run1/desk-payments/${second.body.deskPayment.id}`).set(admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('DESK_PAYMENT_SIGNED');
    const forced = await request(app).delete(`/api/demo-exchange/runs/run1/desk-payments/${second.body.deskPayment.id}?force=1`).set(admin);
    expect(forced.body.deskPayment.status).toBe('released');
  });

  it('the desk routes are founder-only: a client session is refused and nothing is recorded', async () => {
    const prep = await request(app).post('/api/demo-exchange/runs/run1/withdraw/prepare').set(as('alice')).send({ clientId: 'c1', amountXrp: '1' });
    expect([401, 404]).toContain(prep.status);
    const reserve = await request(app).post('/api/demo-exchange/runs/run1/desk-payments').set(as('alice')).send({ clientId: 'c1', kind: 'put-to-work', amountXrp: '1' });
    expect([401, 404]).toContain(reserve.status);
    expect((await loadRun('run1'))!.deskPayments ?? []).toHaveLength(0);
  });
});

/* ── productizer it. 8 / it. 10 ─────────────────────────────────────────── */

const W = () => jest.requireMock('../../services/demoExchange/OmnibusWatcher') as { scanOmnibusWindow: jest.Mock; scanOmnibusWindowUntil: jest.Mock };
const R = () => jest.requireMock('../../services/demoExchange/deskPaymentReads') as { findHandoffByMemo: jest.Mock; readXrplTx: jest.Mock; mintExecutedOnFlare: jest.Mock };
/** 450 unrelated omnibus txs: more than the 2 × 200 rows any page-capped scan reads. */
const filler = (n = 450): OmnibusTx[] =>
  Array.from({ length: n }, (_, i) => ({ hash: i.toString(16).toUpperCase().padStart(64, '0'), account: OTHER, destination: OMNIBUS, destinationTag: 9_999, drops: '1', dateISO: T0, result: 'tesSUCCESS', validated: true, direction: 'in' as const, ledgerIndex: 1010 }));
const feTx = (memo: string, hash = FE_HASH, result = 'tesSUCCESS'): OmnibusTx => ({ hash, account: OMNIBUS, destination: CORE_VAULT, drops: '2000000', dateISO: T0, result, validated: true, direction: 'out', memoHex: memo, ledgerIndex: 1010 });
const handoff = (over: Partial<OmnibusHandoff> = {}): OmnibusHandoff => ({
  memoHex: MEMO,
  userOpHash: '0x' + 'ab'.repeat(32),
  grossXrpDrops: '2000000',
  userOpData: `0x1234${PASSKEY.slice(2).toLowerCase()}5678`,
  xrplAddress: OMNIBUS,
  action: 'demo-exchange-desk',
  signedAt: null,
  signedTxHash: null,
  status: 'queued',
  createdAt: new Date().toISOString(),
  ...over,
});
const reportedFe = (over: Partial<Extract<ReportedTx, { found: true }>> = {}): ReportedTx => ({ found: true, hash: HASH, validated: true, result: 'tesSUCCESS', type: 'Payment', account: OMNIBUS, destination: CORE_VAULT, drops: '2000000', memoHex: MEMO, ledgerIndex: 1010, ...over });
const reserve = (amountXrp = '2') => request(app).post('/api/demo-exchange/runs/run1/desk-payments').set(admin).send({ clientId: 'c1', kind: 'put-to-work', amountXrp });
const release = (id: string) => request(app).delete(`/api/demo-exchange/runs/run1/desk-payments/${id}`).set(admin);
/** What prepare-put-to-work stores on the reservation (its own route is covered in demoExchange.putToWork.test). */
async function stampPrepared(id: string, over: Partial<DeskPayment> = { memoHex: MEMO, userOpHash: '0x' + 'ab'.repeat(32), lastLedgerSequence: 1100 }) {
  const run = (await loadRun('run1'))!;
  Object.assign(run.deskPayments!.find((d) => d.id === id)!, over);
  await saveRun(run);
}

describe('desk put-to-work reservation', () => {
  it('reserve → PAYMENT_IN_FLIGHT for a second compose → record (verified against the ledger) settles it and debits once', async () => {
    const res = await reserve('2');
    expect(res.status).toBe(201);
    const id = res.body.deskPayment.id;
    expect((await request(app).post('/api/demo-exchange/runs/run1/desk-payments').set(admin).send({ clientId: 'c1', kind: 'put-to-work', amountXrp: '1' })).body.error).toBe('PAYMENT_IN_FLIGHT');
    // it. 29: a memo-less reservation has nothing signed, so it no longer holds
    // its owner's payout (the exit is never gated by a desk bookmark).
    expect((await prepare('1')).status).toBe(200);

    mockTx = reportedFe();
    mockHandoffByMemo[MEMO] = handoff(); // a memo-less reservation: the hand-off proves client, receiver and drops
    const rec = await request(app).post('/api/demo-exchange/runs/run1/put-to-work/record').set(admin).send({ clientId: 'c1', drops: '2000000', txHash: HASH, deskPaymentId: id });
    expect(rec.status).toBe(201);
    const run = (await loadRun('run1'))!;
    expect(run.deskPayments![0]).toMatchObject({ status: 'settled', txHash: HASH, memoHex: MEMO });
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
  });

  it('a withdraw is never reserved through this route (it needs the LLS of /withdraw/prepare)', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/desk-payments').set(admin).send({ clientId: 'c1', kind: 'withdraw', amountXrp: '1' });
    expect(res.status).toBe(400);
  });

  it('the desk never supplies the memo at reservation (it. 10) → 400, nothing reserved', async () => {
    const res = await request(app).post('/api/demo-exchange/runs/run1/desk-payments').set(admin).send({ clientId: 'c1', kind: 'put-to-work', amountXrp: '1', memoHex: MEMO });
    expect(res.status).toBe(400);
    expect((await loadRun('run1'))!.deskPayments ?? []).toHaveLength(0);
  });
});

describe('desk payout: past its LastLedgerSequence it closes only on an EXHAUSTIVE read (it. 8)', () => {
  it('the window read fails → the reservation stays in flight, nothing is composed', async () => {
    expect((await prepare('1')).status).toBe(200);
    ledgerIndex = 1101;
    W().scanOmnibusWindow.mockRejectedValueOnce(new Error('OMNIBUS_WINDOW_NOT_EXHAUSTED'));
    const res = await prepare('1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect((await loadRun('run1'))!.deskPayments!.map((p) => p.status)).toEqual(['prepared']);
  });

  it('THE bug: >400 omnibus txs, the 2-page scan missed the payout, the exhaustive read finds it → debited once and settled, never released', async () => {
    const first = await prepare('2');
    expect(first.body.deskPayment).toMatchObject({ createdAtLedger: 1000, destination: WALLET });
    ledgerIndex = 1200;
    scanTxs = []; // the page-capped scan sees nothing
    mockWindowTxs = [...filler(), { ...payoutTx('2000000', 1060), lastLedgerSequence: 1100 }];
    const res = await prepare('1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_LEDGER_BALANCE');
    expect(W().scanOmnibusWindow).toHaveBeenLastCalledWith(OMNIBUS, { ledgerIndexMin: 1000, ledgerIndexMax: 1100 });
    const run = (await loadRun('run1'))!;
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(run.deskPayments![0]).toMatchObject({ status: 'settled', txHash: HASH });
    expect(run.receipts.filter((r) => r.step === 'E8_WITHDRAW')).toHaveLength(1);
  });

  it('a payout with ANOTHER LastLedgerSequence is not this one: proven absent → released', async () => {
    expect((await prepare('1')).status).toBe(200);
    ledgerIndex = 1101;
    mockWindowTxs = [...filler(), { ...payoutTx('1000000', 1050), lastLedgerSequence: 1077 }];
    expect((await prepare('1')).status).toBe(200);
    const run = (await loadRun('run1'))!;
    expect(run.deskPayments!.map((p) => p.status)).toEqual(['released', 'prepared']);
    expect(run.deskPayments![0].closedBy).toMatch(/451 omnibus txs .* read in full/);
  });

  it('DELETE of a prepared payout already on the ledger → 409 DESK_PAYMENT_EXECUTED, settled + debited', async () => {
    const { body } = await prepare('2');
    mockWindowTxs = [{ ...payoutTx('2000000', 1001), lastLedgerSequence: 1100 }];
    const res = await release(body.deskPayment.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DESK_PAYMENT_EXECUTED');
    const run = (await loadRun('run1'))!;
    expect(run.deskPayments![0].status).toBe('settled');
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
  });
});

describe('desk put-to-work: «Release» needs chain proof the 0xFE did not and cannot execute (it. 8 / it. 10)', () => {
  it('the reservation stamps the validated ledger; an unreadable ledger reserves nothing (503)', async () => {
    const ok = await reserve();
    expect(ok.status).toBe(201);
    expect(ok.body.deskPayment.createdAtLedger).toBe(1000);
    await release(ok.body.deskPayment.id);
    ledgerIndex = null;
    const res = await reserve();
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('LEDGER_UNREADABLE');
    expect((await loadRun('run1'))!.deskPayments).toHaveLength(1);
  });

  it('Back before the hand-off: nothing on the ledger → released with its proof, over a bounded forward read', async () => {
    const { body } = await reserve();
    mockWindowTxs = filler();
    const res = await release(body.deskPayment.id);
    expect(res.status).toBe(200);
    expect(res.body.deskPayment.status).toBe('released');
    expect(res.body.deskPayment.closedBy).toMatch(/read in full/);
    expect(W().scanOmnibusWindowUntil).toHaveBeenLastCalledWith(OMNIBUS, expect.objectContaining({ ledgerIndexMin: 1000, ledgerIndexMax: 1000 }));
  });

  it('THE bug: the server-composed 0xFE was validated but never recorded → 409 DESK_PAYMENT_EXECUTED, settled + debited once; a later withdraw cannot pay it again', async () => {
    const { body } = await reserve('2');
    await stampPrepared(body.deskPayment.id);
    ledgerIndex = 1050;
    mockHandoffByMemo[MEMO] = handoff({ signedAt: new Date().toISOString(), signedTxHash: FE_HASH });
    mockWindowTxs = [...filler(), feTx(MEMO)];
    const res = await release(body.deskPayment.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DESK_PAYMENT_EXECUTED');
    expect(res.body.mintExecuted).toBe(true);
    expect(R().mintExecutedOnFlare).toHaveBeenCalledWith(FE_HASH);
    let run = (await loadRun('run1'))!;
    expect(run.deskPayments![0]).toMatchObject({ status: 'settled', txHash: FE_HASH, memoHex: MEMO });
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(run.receipts.filter((r) => r.step === 'E5_PUT_TO_WORK')).toHaveLength(1);

    const pay = await prepare('1');
    expect(pay.status).toBe(409);
    expect(pay.body.error).toBe('INSUFFICIENT_LEDGER_BALANCE');
    // releasing again changes nothing, debits nothing
    expect((await release(body.deskPayment.id)).status).toBe(200);
    run = (await loadRun('run1'))!;
    expect(run.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(run.deskPayments![0].status).toBe('settled');
  });

  it('no heuristic any more: a hand-off with the same drops and receiver does NOT make an unknown 0xFE this memo-less reservation — it blocks as unaccounted', async () => {
    const { body } = await reserve('2');
    mockHandoffByMemo[MEMO] = handoff({ signedAt: new Date().toISOString(), signedTxHash: FE_HASH });
    mockWindowTxs = [...filler(), feTx(MEMO)];
    const res = await release(body.deskPayment.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DESK_PAYMENT_UNACCOUNTED_ON_LEDGER');
    expect(res.body.hashes).toEqual([FE_HASH]);
    const run = (await loadRun('run1'))!;
    expect(run.deskPayments![0].status).toBe('prepared');
    expect(run.clients[0].xrpOnExchangeDrops).toBe('2000000');
  });

  it('a memo reservation is never blocked by an unrelated 0xFE of the omnibus (signed outside Astryum) — once its LastLedgerSequence is past', async () => {
    const { body } = await reserve('2');
    await stampPrepared(body.deskPayment.id);
    mockWindowTxs = [feTx('FE' + '99'.repeat(20))];
    ledgerIndex = 1101;
    const res = await release(body.deskPayment.id);
    expect(res.status).toBe(200);
    expect(res.body.deskPayment.status).toBe('released');
  });

  it('it. 12 (2.3): «Release orphan» / «Back» with the window OPEN and the hand-off NOT reported signed → 409 WAIT_FOR_LAST_LEDGER with the ledgers and seconds left; released after the LLS', async () => {
    const { body } = await reserve('2');
    await stampPrepared(body.deskPayment.id);
    ledgerIndex = 1060;
    const early = await release(body.deskPayment.id);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ error: 'WAIT_FOR_LAST_LEDGER', lastLedgerSequence: 1100, ledgersLeft: 41, secondsLeft: 164 });
    expect(early.body.detail).toMatch(/until XRPL ledger 1100/);
    let run = (await loadRun('run1'))!;
    expect(run.deskPayments![0].status).toBe('prepared');
    expect(run.clients[0].xrpOnExchangeDrops).toBe('2000000');
    // a withdraw of the same drops is still refused while it waits
    expect((await prepare('1')).body.error).toBe('PAYMENT_IN_FLIGHT');
    ledgerIndex = 1101;
    expect((await release(body.deskPayment.id)).status).toBe(200);
    run = (await loadRun('run1'))!;
    expect(run.deskPayments![0].status).toBe('released');
  });

  it('legacy memo attached by PATCH only when the hand-off store proves it; matched exactly; an unreadable MAC still settles on the XRPL fact', async () => {
    const { body } = await reserve('2');
    const id = body.deskPayment.id;
    const patch = (memoHex: string) => request(app).patch(`/api/demo-exchange/runs/run1/desk-payments/${id}`).set(admin).send({ memoHex });
    // no hand-off carries it / the hand-off names another receiver → refused
    expect((await patch(MEMO)).body.error).toBe('DESK_PAYMENT_HANDOFF_UNVERIFIED');
    mockHandoffByMemo[MEMO] = handoff({ userOpData: '0xbeef' });
    expect((await patch(MEMO)).body.error).toBe('DESK_PAYMENT_HANDOFF_UNVERIFIED');
    mockHandoffByMemo[MEMO] = handoff();
    const attach = await patch(MEMO.toLowerCase());
    expect(attach.status).toBe(200);
    expect(attach.body.deskPayment).toMatchObject({ memoHex: MEMO, userOpHash: '0x' + 'ab'.repeat(32) });
    expect((await patch('FE00')).body.error).toBe('DESK_PAYMENT_HANDOFF_MISMATCH');
    mockWindowTxs = [feTx(MEMO)];
    R().mintExecutedOnFlare.mockRejectedValueOnce(new Error('flare rpc down'));
    const res = await release(id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DESK_PAYMENT_EXECUTED');
    expect(res.body.mintExecuted).toBeNull();
    expect((await loadRun('run1'))!.clients[0].xrpOnExchangeDrops).toBe('0');
  });

  /**
   * productizer it. 16 (R1 1.2) — EL 0xFE ATADO A MANO TRAE SU VENTANA.
   * PATCH guardaba memo y userOpHash pero no `lastLedgerSequence`, y
   * `putToWorkWindow` necesita LAS DOS cosas para responder `wait`: sin ella la
   * ruta de release leía la reserva como «ya no puede aterrizar» y liberaba un
   * 0xFE que la propia fila declara firmable — el gemelo del omnibus.
   */
  it('the hand-off attached by hand brings its WINDOW: nothing is released while its 0xFE can still be signed', async () => {
    const { body } = await reserve('2');
    const id = body.deskPayment.id;
    mockHandoffByMemo[MEMO] = handoff({ lastLedgerSequence: 1100 });
    const attach = await request(app).patch(`/api/demo-exchange/runs/run1/desk-payments/${id}`).set(admin).send({ memoHex: MEMO });
    expect(attach.status).toBe(200);
    expect(attach.body.deskPayment.lastLedgerSequence).toBe(1100);
    expect((await loadRun('run1'))!.deskPayments![0].lastLedgerSequence).toBe(1100);

    ledgerIndex = 1060;
    const early = await release(id);
    expect(early.status).toBe(409);
    expect(early.body).toMatchObject({ error: 'WAIT_FOR_LAST_LEDGER', lastLedgerSequence: 1100, ledgersLeft: 41 });
    expect((await loadRun('run1'))!.deskPayments![0].status).toBe('prepared');

    ledgerIndex = 1101;
    expect((await release(id)).status).toBe(200);
  });

  it('a hand-off composed WITHOUT a window (unreadable ledger, a row older than it. 15) attaches without inventing one', async () => {
    const { body } = await reserve('2');
    const id = body.deskPayment.id;
    mockHandoffByMemo[MEMO] = handoff({ lastLedgerSequence: null });
    const attach = await request(app).patch(`/api/demo-exchange/runs/run1/desk-payments/${id}`).set(admin).send({ memoHex: MEMO });
    expect(attach.status).toBe(200);
    expect(attach.body.deskPayment.lastLedgerSequence).toBeUndefined();
  });

  it('memo-less: a 0xFE of the omnibus nobody accounts for blocks the release (409); one already accounted does not', async () => {
    const { body } = await reserve('2');
    mockWindowTxs = [feTx('FE' + '99'.repeat(20))];
    const blocked = await release(body.deskPayment.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('DESK_PAYMENT_UNACCOUNTED_ON_LEDGER');
    let run = (await loadRun('run1'))!;
    expect(run.deskPayments![0].status).toBe('prepared');
    expect(run.clients[0].xrpOnExchangeDrops).toBe('2000000');

    run.appliedTxHashes.push(`out:${FE_HASH}`); // e.g. an autopilot put-to-work already mirrored
    await saveRun(run);
    expect((await release(body.deskPayment.id)).status).toBe(200);
  });

  it('before its LastLedgerSequence, a hand-off reported SIGNED but not on the ledger may still land → 409; one that failed on the ledger does not block', async () => {
    const { body } = await reserve('2');
    await stampPrepared(body.deskPayment.id);
    mockHandoffByMemo[MEMO] = handoff({ signedAt: new Date().toISOString(), signedTxHash: FE_HASH });
    const blocked = await release(body.deskPayment.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('DESK_PAYMENT_SIGNED_NOT_ON_LEDGER');
    mockWindowTxs = [feTx(MEMO, FE_HASH, 'tecPATH_DRY')]; // validated, moved no XRP, its Sequence is spent
    // no longer «signed off ledger», but its window is still open: it waits for the LLS (it. 12)
    expect((await release(body.deskPayment.id)).body.error).toBe('WAIT_FOR_LAST_LEDGER');
    ledgerIndex = 1101;
    expect((await release(body.deskPayment.id)).status).toBe(200);
  });

  it('past its LastLedgerSequence and absent it can never land → released without reading the hand-off store, over [createdAtLedger, LLS] only', async () => {
    const { body } = await reserve('2');
    await stampPrepared(body.deskPayment.id);
    mockHandoffByMemo[MEMO] = handoff({ signedAt: new Date().toISOString(), signedTxHash: FE_HASH });
    ledgerIndex = 50_000;
    R().findHandoffByMemo.mockClear();
    const res = await release(body.deskPayment.id);
    expect(res.status).toBe(200);
    expect(res.body.deskPayment.closedBy).toMatch(/can never land/);
    expect(R().findHandoffByMemo).not.toHaveBeenCalled();
    expect(W().scanOmnibusWindowUntil).toHaveBeenLastCalledWith(OMNIBUS, expect.objectContaining({ ledgerIndexMin: 1000, ledgerIndexMax: 1100 }));
  });

  it('a memo-less reservation reads a BOUNDED window, never unbounded history', async () => {
    const { body } = await reserve('2');
    ledgerIndex = 50_000;
    expect((await release(body.deskPayment.id)).status).toBe(200);
    expect(W().scanOmnibusWindowUntil).toHaveBeenLastCalledWith(OMNIBUS, expect.objectContaining({ ledgerIndexMin: 1000, ledgerIndexMax: 3000 }));
  });

  it('ledger, window or hand-off store unreadable → 503, never released', async () => {
    const { body } = await reserve('2');
    await stampPrepared(body.deskPayment.id);
    ledgerIndex = null;
    expect((await release(body.deskPayment.id)).status).toBe(503);
    ledgerIndex = 1000;
    W().scanOmnibusWindowUntil.mockRejectedValueOnce(new Error('OMNIBUS_WINDOW_HISTORY_MISSING'));
    expect((await release(body.deskPayment.id)).body.error).toBe('DESK_PAYMENT_UNPROVABLE');
    R().findHandoffByMemo.mockRejectedValueOnce(new Error('pooler down'));
    expect((await release(body.deskPayment.id)).status).toBe(503);
    expect((await loadRun('run1'))!.deskPayments![0].status).toBe('prepared');
  });
});

describe('a payout wallet is never re-pointed with a payment in flight (it. 8)', () => {
  const repoint = () => request(app).patch('/api/demo-exchange/runs/run1/clients/c1').set(admin).send({ xrplAddress: OTHER });

  it('pending withdraw request → 409 PAYMENT_IN_FLIGHT, wallet unchanged', async () => {
    expect((await ask('withdraw', '1')).status).toBe(201);
    const res = await repoint();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect((await loadRun('run1'))!.clients[0].xrplAddress).toBe(WALLET);
  });

  it('open desk payment → 409; a submitting withdraw → 409; nothing in flight → re-pointed', async () => {
    const { body } = await prepare('1');
    expect((await repoint()).status).toBe(409);
    await release(body.deskPayment.id);
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rq1', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'submitting', txHash: HASH, createdAt: T0, updatedAt: T0 }];
    await saveRun(run);
    expect((await repoint()).status).toBe(409);
    run.requests = [];
    await saveRun(run);
    const ok = await repoint();
    expect(ok.status).toBe(200);
    expect(ok.body.client.xrplAddress).toBe(OTHER);
  });
});

describe('tags: a deleted run never gives its seq to a new run', () => {
  const create = () => request(app).post('/api/demo-exchange/runs').set(admin).send({ councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG', omnibusAddress: OMNIBUS });

  it('create (seq 2) → delete it → create again → seq 3, not 2 (its tags 201… stay its clients\')', async () => {
    const a = await create();
    expect(a.status).toBe(201);
    expect(a.body.run.seq).toBe(2);
    expect((await request(app).delete(`/api/demo-exchange/runs/${a.body.run.runId}`).set(admin)).status).toBe(200);
    const b = await create();
    expect(b.status).toBe(201);
    expect(b.body.run.seq).toBe(3);
  });

  it('deleting a run created before the mark existed raises the mark too', async () => {
    const legacy = { ...seedRun(), runId: 'run7', seq: 7 };
    await saveRun(legacy);
    // it. 31: la ficha sembrada tiene 2 XRP de un cliente — borrar con dinero
    // dentro pide `force=1` (lo que se prueba aquí es la marca de seq).
    expect((await request(app).delete('/api/demo-exchange/runs/run7?force=1').set(admin)).status).toBe(200);
    expect((await create()).body.run.seq).toBe(8);
  });
});

describe('tag ranges: no range ever assigned is handed out again (it. 8)', () => {
  const createOn = (body: Record<string, unknown>) => request(app).post('/api/demo-exchange/runs').set(admin).send({ councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG', omnibusAddress: OMNIBUS, ...body });

  it("a deleted run's DECLARED range stays its own on that omnibus; another omnibus may use it", async () => {
    const a = await createOn({ tagBase: 5000, tagCount: 50 });
    expect(a.status).toBe(201);
    expect((await request(app).delete(`/api/demo-exchange/runs/${a.body.run.runId}`).set(admin)).status).toBe(200);
    const clash = await createOn({ tagBase: 5040 });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toBe('TAG_RANGE_OVERLAP');
    expect((await createOn({ tagBase: 5050 })).status).toBe(201);
    expect((await createOn({ tagBase: 5000, omnibusAddress: OTHER })).status).toBe(201);
  });

  it('a classic run skips a seq whose classic tags a past declared range holds', async () => {
    const declared = await createOn({ tagBase: 301, tagCount: 99 }); // seq 2, holds 301…399
    expect(declared.body.run.seq).toBe(2);
    await request(app).delete(`/api/demo-exchange/runs/${declared.body.run.runId}`).set(admin);
    const classic = await createOn({});
    expect(classic.status).toBe(201);
    expect(classic.body.run.seq).toBe(4); // seq 3 = tags 301…399: skipped
  });

  it('a run created before ranges were recorded records its declared range when deleted', async () => {
    await saveRun({ ...seedRun(), runId: 'run9', seq: 9, tagBase: 7000, tagCount: 20 });
    // it. 31: idem — la ficha sembrada lleva saldo de cliente; `force=1`.
    expect((await request(app).delete('/api/demo-exchange/runs/run9?force=1').set(admin)).status).toBe(200);
    expect((await createOn({ tagBase: 7010 })).body.error).toBe('TAG_RANGE_OVERLAP');
  });
});

describe('/wallet-proof: the server verdict the client site shows', () => {
  it('the session login wallet is proven; any other connected wallet needs a signed binding; no session → 401', async () => {
    const res = await request(app).get(`/api/demo-exchange/wallet-proof?addresses=${WALLET},${OTHER}`).set(as('alice', WALLET));
    expect(res.status).toBe(200);
    expect(res.body.sessionWallet).toBe(WALLET);
    expect(res.body.wallets).toEqual([
      { address: WALLET, proof: 'session', unreadable: false },
      { address: OTHER, proof: null, unreadable: false },
    ]);
    const emailLogin = await request(app).get(`/api/demo-exchange/wallet-proof?addresses=${WALLET}`).set(as('bob'));
    expect(emailLogin.body.sessionWallet).toBeNull();
    expect(emailLogin.body.wallets[0].proof).toBeNull();
    expect((await request(app).get(`/api/demo-exchange/wallet-proof?addresses=${WALLET}`)).status).toBe(401);
  });
});

/**
 * it. 27 — UNA ENTRADA MUERTA NO PUEDE RETENER LA SALIDA DE SU DUEÑO.
 *
 * El caso real, por las rutas de verdad: alguien deposita, el autopiloto le
 * fabrica una put-to-work que muere porque todavía no ha creado su cuenta Flare
 * (o el pote no ha nacido, o el asiento estaba ocupado), y esa petición se queda
 * `pending` indefinidamente — el autopiloto la deja así a propósito, y no existía
 * ninguna ruta para retirarla. Hasta esta iteración reservaba el saldo entero: la
 * retirada que llegaba detrás recibía 409 `INSUFFICIENT_AVAILABLE_BALANCE` y el
 * servidor le decía que su dinero estaba «reservado por pagos en vuelo» cuando no
 * se había firmado nada nunca.
 *
 * Lo que SÍ sigue reteniendo es lo que tiene bytes firmados: una petición
 * 'submitting' y un pago de mesa abierto. Ahí el 409 es lo único que separa a
 * este cliente de cobrar dos veces.
 */
describe('it. 27: una entrada muerta no retiene la salida', () => {
  /** Una put-to-work que el autopiloto dejó pendiente y que no puede firmarse nunca. */
  async function deadEntry(drops = '2000000'): Promise<void> {
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rqDead', kind: 'put-to-work', clientId: 'c1', drops, status: 'pending', createdAt: T0, updatedAt: T0, reason: 'NO_CLIENT_ACCOUNT: the client has no Flare account yet (Face ID)' }];
    await saveRun(run);
  }

  it('la RUTA de peticiones acepta la retirada de su dueño con una entrada muerta delante', async () => {
    await deadEntry();
    const res = await ask('withdraw', '2');
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ kind: 'withdraw', status: 'pending', drops: '2000000' });
  });

  it('y la RUTA del pago a mano la compone igual (la palanca que promete el runbook)', async () => {
    await deadEntry();
    const res = await prepare('2');
    expect(res.status).toBe(200);
    expect(res.body.xrplTx).toMatchObject({ Destination: WALLET, Amount: '2000000' });
  });

  it('lo que SÍ retiene sigue reteniendo: una entrada ya FIRMADA', async () => {
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rqSigned', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'submitting', txHash: FE_HASH, lastLedgerSequence: 1100, createdAt: T0, updatedAt: T0 }];
    await saveRun(run);
    const res = await ask('withdraw', '2');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
  });

  it('una retirada pendiente sigue bloqueando el pago a mano — y el 409 nombra la palanca', async () => {
    expect((await ask('withdraw', '1')).status).toBe(201);
    const res = await prepare('1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.withdrawableRequestIds).toHaveLength(1);
    expect(res.body.detail).toMatch(/DELETE \/api\/demo-exchange\/runs\/:id\/clients\/:cid\/requests\//);
  });
});

/** it. 27 — la puerta para RETIRAR de la cola lo que nadie ha firmado. */
describe('it. 27: retirar una petición de la cola', () => {
  const cancel = (rid: string, headers: Record<string, string>) =>
    request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/requests/${rid}`).set(headers);

  it('su dueño la retira, el saldo queda libre y puede volver a pedir', async () => {
    const asked = await ask('put-to-work', '2');
    expect(asked.status).toBe(201);
    const rid = asked.body.request.id;

    const res = await cancel(rid, as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.request).toMatchObject({ id: rid, status: 'refused' });
    expect(res.body.request.reason).toMatch(/^WITHDRAWN_BY_THE_CLIENT/);

    const live = (await loadRun('run1'))!;
    expect(live.receipts.some((r) => /withdrawn from the queue before anything was signed/.test(r.note ?? ''))).toBe(true);
    // Y el dinero vuelve a estar disponible entero.
    expect((await ask('withdraw', '2')).status).toBe(201);
  });

  it('la de otro no se toca', async () => {
    const asked = await ask('put-to-work', '1');
    const res = await cancel(asked.body.request.id, as('mallory'));
    expect(res.status).toBe(403);
  });

  it('una que el journal dice FIRMADA no se retira: el ledger la decide', async () => {
    const asked = await ask('withdraw', '1');
    const rid = asked.body.request.id;
    await writeSubmission({ requestId: rid, runId: 'run1', kind: 'withdraw', clientId: 'c1', drops: '1000000', txHash: HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status: 'submitting', updatedAt: T0 });

    const res = await cancel(rid, as('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect((await loadRun('run1'))!.requests![0].status).toBe('pending');
  });

  it('una que ya no está pendiente tampoco', async () => {
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rqS', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'submitting', txHash: HASH, lastLedgerSequence: 1100, createdAt: T0, updatedAt: T0 }];
    await saveRun(run);
    const res = await cancel('rqS', admin);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('REQUEST_NOT_PENDING');
  });

  it('una que no existe es 404', async () => {
    expect((await cancel('rqNope', admin)).status).toBe(404);
  });
});

/**
 * it. 29 — LA ASIMETRÍA SE APOYA EN EL JOURNAL, NO EN `status`.
 *
 * La it. 27 eximió a toda entrada 'pending' de retener la salida de su dueño
 * porque «una pending no tiene hash, ni asiento, ni blob». El `submissionJournal`
 * existe porque eso es falso: un guardado concurrente devuelve a 'pending' una
 * petición YA firmada y viva en su ventana. Con esa entrada en la cola, la mesa
 * componía la salida de los mismos drops y el ómnibus pagaba 2×.
 */
describe('it. 29: la exención la concede el journal', () => {
  /** El run dice 'pending'; el journal dice lo que diga `status`. */
  async function clobberedEntry(status: 'submitting' | 'settled' | 'failed' | 'expired'): Promise<void> {
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rqClob', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'pending', createdAt: T0, updatedAt: T0 }];
    await saveRun(run);
    await writeSubmission({ requestId: 'rqClob', runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '2000000', txHash: FE_HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, memoHex: MEMO, status, updatedAt: T0 });
  }

  it('CADENA (a): con el journal diciendo que la entrada está firmada, el pago a mano NO se compone', async () => {
    await clobberedEntry('submitting');
    const res = await prepare('2');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.inFlight.map((p: { id: string }) => p.id)).toEqual(['rqClob']);
    // y no se nombra ninguna palanca falsa: una entrada firmada no tiene puerta
    expect(res.body.withdrawableRequestIds).toBeUndefined();
    expect((await loadRun('run1'))!.deskPayments ?? []).toHaveLength(0);
  });

  it('CADENA (a): y la RUTA de peticiones tampoco acepta la retirada sobre esos drops', async () => {
    await clobberedEntry('submitting');
    const res = await ask('withdraw', '2');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    expect(res.body.reservedDrops).toBe('2000000');
  });

  it('un entry que el ledger declaró MUERTO (expired) sí exime: esa entrada nunca pagará', async () => {
    await clobberedEntry('expired');
    expect((await prepare('2')).status).toBe(200);
  });

  it('sin entradas pendientes por delante, la salida no lee el journal en absoluto (el caso normal)', async () => {
    const journal = jest.requireActual('../../services/demoExchange/submissionJournal') as typeof import('../../services/demoExchange/submissionJournal');
    const spy = jest.spyOn(journal, 'readSubmission');
    expect((await prepare('1')).status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * it. 29 — UNA RESERVA DE MESA DE LA QUE NUNCA SE COMPUSO NADA.
 *
 * `POST /runs/:id/desk-payments` deja una reserva `prepared` de put-to-work sin
 * memo y sin un solo byte firmado. No caducaba nunca, retenía la salida de su
 * dueño, su única puerta era un DELETE de admin que contesta 503 sin XRPL, y el
 * 409 no nombraba ninguna palanca.
 */
describe('it. 29: la reserva de mesa abandonada', () => {
  const releaseOwn = (pid: string, headers: Record<string, string>) =>
    request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/desk-payments/${pid}`).set(headers);

  it('CADENA (b): no bloquea la retirada de su dueño — ni por la ruta de peticiones ni por el pago a mano', async () => {
    const reserved = await reserve('2');
    expect(reserved.status).toBe(201);
    expect(reserved.body.deskPayment).toMatchObject({ kind: 'put-to-work', status: 'prepared' });
    expect(reserved.body.deskPayment.memoHex).toBeUndefined();

    expect((await ask('withdraw', '2')).status).toBe(201);
    // (se retira la petición para poder probar la otra puerta con el mismo saldo)
    const rid = (await loadRun('run1'))!.requests![0].id;
    expect((await request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/requests/${rid}`).set(as('alice'))).status).toBe(200);
    const paid = await prepare('2');
    expect(paid.status).toBe(200);
    expect(paid.body.xrplTx).toMatchObject({ Destination: WALLET, Amount: '2000000' });
  });

  it('pero sí bloquea OTRA entrada, y ese 409 nombra SU puerta', async () => {
    const { body } = await reserve('2');
    const res = await reserve('1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.releasableDeskPaymentIds).toEqual([body.deskPayment.id]);
    expect(res.body.detail).toContain(`DELETE /api/demo-exchange/runs/:id/clients/:cid/desk-payments/${body.deskPayment.id}`);
  });

  it('su dueño la suelta sin leer el ledger (la puerta que no era solo de admin), y queda dicho', async () => {
    ledgerIndex = 1000;
    const { body } = await reserve('2');
    ledgerIndex = null; // el XRPL no se lee: la puerta de admin contestaría 503
    const res = await releaseOwn(body.deskPayment.id, as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.deskPayment.status).toBe('released');
    expect(res.body.deskPayment.closedBy).toMatch(/released by its owner; no 0xFE was ever composed/);
    const live = (await loadRun('run1'))!;
    expect(live.receipts.some((r) => /desk reservation of 2\.000000 XRP was released before any 0xFE was composed/.test(r.note ?? ''))).toBe(true);
    // y se puede volver a reservar
    ledgerIndex = 1000;
    expect((await reserve('2')).status).toBe(201);
  });

  it('la de otro no se toca; una con memo (0xFE compuesto) no se suelta por aquí', async () => {
    const { body } = await reserve('2');
    expect((await releaseOwn(body.deskPayment.id, as('mallory'))).status).toBe(403);
    const run = (await loadRun('run1'))!;
    run.deskPayments![0].memoHex = MEMO;
    await saveRun(run);
    const res = await releaseOwn(body.deskPayment.id, as('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DESK_PAYMENT_NOT_RELEASABLE_HERE');
    expect(res.body.detail).toContain(`DELETE /api/demo-exchange/runs/:id/desk-payments/${body.deskPayment.id}`);
    expect((await loadRun('run1'))!.deskPayments![0].status).toBe('prepared');
    // y con memo SÍ retiene la salida: ahí puede haber un 0xFE vivo
    expect((await ask('withdraw', '2')).status).toBe(409);
  });
});

/** it. 29 — el DELETE mira el MISMO subconjunto del journal que el autopiloto (`journalPlan`). */
describe('it. 29: el DELETE de una petición usa journalPlan', () => {
  const cancel = (rid: string, headers: Record<string, string>) =>
    request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/requests/${rid}`).set(headers);

  async function pendingWithJournal(status: 'settled' | 'failed' | 'expired'): Promise<string> {
    const asked = await ask('put-to-work', '1');
    const rid = asked.body.request.id as string;
    await writeSubmission({ requestId: rid, runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', txHash: FE_HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status, code: status === 'failed' ? 'tecPATH_DRY' : undefined, updatedAt: T0 });
    return rid;
  }

  it('CADENA (d): un entry SETTLED —el pago entró en el ledger— no se puede borrar', async () => {
    const rid = await pendingWithJournal('settled');
    const res = await cancel(rid, as('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.detail).toMatch(/entered a validated ledger/);
    const live = (await loadRun('run1'))!;
    expect(live.requests![0].status).toBe('pending');
    expect(live.receipts.some((r) => /No payment existed/.test(r.note ?? ''))).toBe(false);
  });

  it('it. 31: uno FAILED (resultado validado ≠ tes, los drops nunca salieron) SÍ cede — reconciliado aquí mismo, sin esperar a un tick', async () => {
    const rid = await pendingWithJournal('failed');
    const res = await cancel(rid, admin);
    expect(res.status).toBe(200);
    expect(res.body.reconciled).toBe('failed-on-ledger');
    expect(res.body.request.status).toBe('refused');
    expect(res.body.request.reason).toMatch(/^XRPL_tecPATH_DRY:/);
    const live = (await loadRun('run1'))!;
    expect(live.requests![0].status).toBe('refused');
    // la negativa dejó su recibo con el código del ledger, y el saldo vuelve a estar disponible
    expect(live.receipts.some((r) => /XRPL_tecPATH_DRY/.test(r.note ?? ''))).toBe(true);
    expect((await ask('put-to-work', '1')).status).toBe(201);
  });

  it('it. 31: un entry MALFORMADO (sin hash) no revienta el DELETE en 500 — contesta 409 y lo dice', async () => {
    const asked = await ask('put-to-work', '1');
    const rid = asked.body.request.id as string;
    await writeSubmission({ requestId: rid, runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', txHash: undefined as unknown as string, lastLedgerSequence: undefined as unknown as number, submittedAtLedger: 1000, status: 'submitting', updatedAt: T0 });
    const res = await cancel(rid, as('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.detail).toMatch(/no hash recorded/);
  });

  it('uno EXPIRED sí: el ledger lo declaró muerto', async () => {
    const rid = await pendingWithJournal('expired');
    expect((await cancel(rid, as('alice'))).status).toBe(200);
  });
});

/**
 * 18-sep — LA MESA TOMA LA PETICIÓN PARA FIRMARLA POR QR (fundador: «el
 * autopilot hay que sacarlo no visible y que se haga a través de QR»). Una
 * retirada pendiente bloquea a propósito el pago a mano (PAYMENT_IN_FLIGHT): la
 * mesa la toma (misma cesión, nada firmado) y compone su pago del omnibus.
 */
describe('18-sep: la mesa toma la petición para servirla por QR', () => {
  const take = (rid: string, headers: Record<string, string>) =>
    request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/requests/${rid}?takenByDesk=1`).set(headers);

  it('el operador la toma, queda escrito que se sirve a mano, y el pago de la mesa se compone', async () => {
    const asked = await ask('withdraw', '1');
    expect(asked.status).toBe(201);
    expect((await prepare('1')).body.error).toBe('PAYMENT_IN_FLIGHT');

    const res = await take(asked.body.request.id, admin);
    expect(res.status).toBe(200);
    expect(res.body.request.reason).toMatch(/^TAKEN_BY_THE_DESK/);
    const live = (await loadRun('run1'))!;
    expect(live.receipts.some((r) => /taken by the exchange desk to be signed from the omnibus by QR/.test(r.note ?? ''))).toBe(true);

    const pay = await prepare('1');
    expect(pay.status).toBe(200);
    expect(pay.body.xrplTx).toMatchObject({ Destination: WALLET, Amount: '1000000' });
  });

  it('el cliente no puede escribir que la tomó la mesa: el flag solo vale para el operador', async () => {
    const asked = await ask('put-to-work', '1');
    const res = await take(asked.body.request.id, as('alice'));
    expect(res.status).toBe(200);
    expect(res.body.request.reason).toMatch(/^WITHDRAWN_BY_THE_CLIENT/);
  });

  it('lo firmado no se toma: el journal manda igual que al retirarla', async () => {
    const asked = await ask('withdraw', '1');
    const rid = asked.body.request.id;
    await writeSubmission({ requestId: rid, runId: 'run1', kind: 'withdraw', clientId: 'c1', drops: '1000000', txHash: HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status: 'submitting', updatedAt: T0 });
    const res = await take(rid, admin);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
  });
});

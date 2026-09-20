/**
 * LAS RUTAS QUE UNA PERSONA REAL TOCA, contra el router de verdad.
 *
 *  (1) Una run `closed` no es un interruptor sobre la salida: cerrar con algo en
 *      vuelo se rechaza y lo nombra; cerrada, `POST …/requests withdraw` sigue
 *      contestando 201 con la verdad, y `put-to-work` un 409 RUN_CLOSED honesto.
 *      Borrar con dinero de clientes dentro pide `force=1`.
 *  (3) La puerta del dueño llega al dueño: `POST …/requests` devuelve `inFlight`
 *      e ids y nombra la puerta — en el 409 INSUFFICIENT_AVAILABLE_BALANCE y en
 *      el 409 REQUEST_PENDING (la entrada muerta delante de otra entrada).
 *  (4) El 409 de la reserva de mesa con memo dice la verdad sobre lo que retiene.
 */
import express from 'express';
import request from 'supertest';
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
import type { DemoRun } from '../../services/demoExchange/DemoExchangeStore';
import type { OmnibusTx } from '../../services/demoExchange/OmnibusWatcher';

let ledgerIndex: number | null = 1000;

jest.mock('../../services/demoExchange/OmnibusWatcher', () => {
  const actual = jest.requireActual('../../services/demoExchange/OmnibusWatcher');
  return {
    ...actual,
    currentValidatedLedgerIndex: jest.fn(async () => ledgerIndex),
    scanOmnibus: jest.fn(async () => [] as OmnibusTx[]),
    scanOmnibusWindow: jest.fn(async () => [] as OmnibusTx[]),
    scanOmnibusWindowUntil: jest.fn(async () => ({ rows: [] as OmnibusTx[] })),
  };
});
jest.mock('../../services/demoExchange/deskPaymentReads', () => ({
  findHandoffByMemo: jest.fn(async () => null),
  readXrplTx: jest.fn(async () => ({ found: false })),
  readCoreVaultAddress: jest.fn(async () => 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh'),
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
const opsAlerts: Array<{ level: string; message: string }> = [];
jest.mock('../../services/OpsAlertService', () => ({
  opsAlert: jest.fn(async (_s: string, level: string, message: string) => {
    opsAlerts.push({ level, message });
  }),
}));

import router from '../demoExchange';
import { _resetKeyFailuresForTests } from '../adminPanel';
import { __resetDemoExchangeMemoryForTests, loadRun, saveRun } from '../../services/demoExchange/DemoExchangeStore';
import { _resetSubmissionJournal, writeSubmission } from '../../services/demoExchange/submissionJournal';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
const T0 = new Date(0).toISOString();
const MEMO = 'FE' + 'AB'.repeat(20);
const FE_HASH = 'D'.repeat(64);

const app = express();
app.use(express.json());
app.use('/api/demo-exchange', router);

const admin = { 'x-admin-key': 'founder-test-key' };
const as = (user: string, wallet = '') => ({ 'x-test-user': user, 'x-test-wallet': wallet, Authorization: 'Bearer test' });

function seedRun(balanceDrops = '2000000', over: Partial<DemoRun> = {}): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Closed & doors',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [{ id: 'c1', runId: 'run1', label: 'Alice', tag: 101, kyc: 'none', ownerUserId: 'alice', passkeyAccount: PASSKEY, xrplAddress: WALLET, xrplAddressProof: 'session', xrpOnExchangeDrops: balanceDrops, createdAt: T0 }],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
    ...over,
  };
}

const SAVED = { flag: process.env.INSTITUTIONAL_POTES_ENABLED, db: process.env.DATABASE_URL, key: process.env.ADMIN_PANEL_KEY, emails: process.env.ADMIN_EMAILS };
beforeAll(() => {
  delete process.env.DATABASE_URL;
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
  opsAlerts.length = 0;
  await saveRun(seedRun());
});
afterEach(() => _resetKeyFailuresForTests());

const ask = (kind: string, amountXrp: string, headers: Record<string, string> = as('alice')) =>
  request(app).post('/api/demo-exchange/runs/run1/clients/c1/requests').set(headers).send({ kind, amountXrp });
const patchRun = (body: Record<string, unknown>) => request(app).patch('/api/demo-exchange/runs/run1').set(admin).send(body);
const reserve = (amountXrp: string) => request(app).post('/api/demo-exchange/runs/run1/desk-payments').set(admin).send({ clientId: 'c1', kind: 'put-to-work', amountXrp });

describe('(1) cerrar una toma no gatea la salida', () => {
  it('cerrar con una petición viva → 409 RUN_HAS_LIVE_WORK que la nombra; la toma sigue abierta', async () => {
    expect((await ask('withdraw', '1')).status).toBe(201);
    const res = await patchRun({ status: 'closed' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RUN_HAS_LIVE_WORK');
    expect(res.body.requests).toHaveLength(1);
    expect(res.body.requests[0]).toMatchObject({ kind: 'withdraw', status: 'pending' });
    expect(res.body.detail).toMatch(/DELETE \/runs\/:id\/clients\/:cid\/requests\/:rid/);
    expect((await loadRun('run1'))!.status).toBe('open');
  });

  it('cerrar con una reserva de mesa abierta → 409; sin nada en vuelo → 200 aunque haya saldos (su salida sigue abierta)', async () => {
    const r = await reserve('1');
    expect(r.status).toBe(201);
    const refused = await patchRun({ status: 'closed' });
    expect(refused.status).toBe(409);
    expect(refused.body.deskPayments).toHaveLength(1);
    // la suelta su dueño (nada compuesto) y entonces cierra — con 2 XRP del cliente dentro
    expect((await request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/desk-payments/${r.body.deskPayment.id}`).set(as('alice'))).status).toBe(200);
    const closed = await patchRun({ status: 'closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.run.status).toBe('closed');
  });

  it('CONSUMIDOR: en una toma cerrada, la retirada sigue entrando (201, y el recibo dice la verdad); la entrada recibe RUN_CLOSED', async () => {
    expect((await patchRun({ status: 'closed', autopilot: false })).status).toBe(200);
    const exit = await ask('withdraw', '1');
    expect(exit.status).toBe(201);
    expect(exit.body.servedBy).toBe('desk');
    expect(exit.body.run.status).toBe('closed');
    const live = (await loadRun('run1'))!;
    const note = live.receipts.find((x) => /Client requested withdraw/.test(x.note ?? ''));
    expect(note?.note).toMatch(/waiting for the exchange/);
    expect(note?.note).toMatch(/the desk is closed: withdrawals keep being paid/);
    expect(note?.note).not.toMatch(/autopilot will fulfil/);

    const entry = await ask('put-to-work', '0.5');
    expect(entry.status).toBe(409);
    expect(entry.body.error).toBe('RUN_CLOSED');
    expect(entry.body.detail).toMatch(/can be withdrawn at any time/);
  });

  it('borrar una toma con dinero de clientes → 409 RUN_HAS_CLIENT_MONEY con los hechos; con force=1 borra y lo grita en ops', async () => {
    const refused = await request(app).delete('/api/demo-exchange/runs/run1').set(admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('RUN_HAS_CLIENT_MONEY');
    expect(refused.body.clients).toEqual([{ id: 'c1', label: 'Alice', tag: 101, xrpOnExchangeDrops: '2000000', inPote: false }]);
    expect(await loadRun('run1')).not.toBeNull();

    const forced = await request(app).delete('/api/demo-exchange/runs/run1?force=1').set(admin);
    expect(forced.status).toBe(200);
    expect(await loadRun('run1')).toBeNull();
    expect(opsAlerts.some((a) => a.level === 'critical' && /DELETED by force/.test(a.message))).toBe(true);
  });

  it('borrar una toma vacía (sin saldos ni vuelo) sigue siendo un 200 sin force', async () => {
    __resetDemoExchangeMemoryForTests();
    await saveRun(seedRun('0'));
    expect((await request(app).delete('/api/demo-exchange/runs/run1').set(admin)).status).toBe(200);
  });

  /**
   * LAS PARTICIPACIONES CUENTAN. Un cliente cuyo XRP ya
   * está en el pote (entrada `done`, espejo a 0) no era «funded», y la toma se
   * borraba sin `force` con la ficha y el tag que su salida a XRP necesita.
   */
  it('Espejo a 0 pero una entrada EJECUTADA (put-to-work done) sin salida después → 409 RUN_HAS_CLIENT_MONEY con `inPote`; con una salida registrada después → 200', async () => {
    const T1 = '2026-09-01T00:00:00.000Z';
    const T2 = '2026-09-02T00:00:00.000Z';
    __resetDemoExchangeMemoryForTests();
    await saveRun(seedRun('0', { requests: [{ id: 'rqDone', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'done', txHash: FE_HASH, createdAt: T1, updatedAt: T1 }] }));
    const refused = await request(app).delete('/api/demo-exchange/runs/run1').set(admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('RUN_HAS_CLIENT_MONEY');
    expect(refused.body.clients).toEqual([{ id: 'c1', label: 'Alice', tag: 101, xrpOnExchangeDrops: '0', inPote: true }]);
    expect(refused.body.detail).toMatch(/1 client\(s\) with capital put to work through this desk and no exit recorded since/);
    expect(await loadRun('run1')).not.toBeNull();

    // an exit of that client recorded AFTER the entry → nothing of theirs is left behind
    const run = (await loadRun('run1'))!;
    run.receipts.push({ id: 'rcpt-exit', runId: 'run1', clientId: 'c1', step: 'U4_EXIT', chain: 'flare', txHash: '0x' + 'a'.repeat(64), at: T2, checks: [] });
    await saveRun(run);
    expect((await request(app).delete('/api/demo-exchange/runs/run1').set(admin)).status).toBe(200);
  });

  it('Una salida ANTERIOR a la última entrada no la tapa (sigue dentro) — y un recibo E5 o una reserva de mesa settled también cuentan', async () => {
    const T1 = '2026-09-01T00:00:00.000Z';
    const T2 = '2026-09-02T00:00:00.000Z';
    __resetDemoExchangeMemoryForTests();
    await saveRun(seedRun('0', {
      receipts: [
        { id: 'r-exit', runId: 'run1', clientId: 'c1', step: 'U4_EXIT_XRP', chain: 'flare', txHash: '0x' + 'b'.repeat(64), at: T1, checks: [] },
        { id: 'r-e5', runId: 'run1', clientId: 'c1', step: 'E5_PUT_TO_WORK', chain: 'xrpl', txHash: FE_HASH, at: T2, checks: [] },
      ],
    }));
    const refused = await request(app).delete('/api/demo-exchange/runs/run1').set(admin);
    expect(refused.status).toBe(409);
    expect(refused.body.clients[0].inPote).toBe(true);

    __resetDemoExchangeMemoryForTests();
    await saveRun(seedRun('0', { deskPayments: [{ id: 'dpS', kind: 'put-to-work', clientId: 'c1', drops: '2000000', status: 'settled', txHash: FE_HASH, memoHex: MEMO, createdAt: T1, updatedAt: T1 }] }));
    expect((await request(app).delete('/api/demo-exchange/runs/run1').set(admin)).status).toBe(409);
    // …and force still deletes, saying it in ops with the in-pote mark
    const forced = await request(app).delete('/api/demo-exchange/runs/run1?force=1').set(admin);
    expect(forced.status).toBe(200);
    expect(opsAlerts.some((a) => a.level === 'critical' && /DELETED by force/.test(a.message))).toBe(true);
  });
});

describe('(3) la puerta del dueño llega al dueño en POST …/requests', () => {
  it('CONSUMIDOR: una entrada MUERTA delante de otra entrada → 409 REQUEST_PENDING con `withdrawableRequestIds` y la puerta nombrada', async () => {
    const first = await ask('put-to-work', '1');
    expect(first.status).toBe(201);
    // el autopiloto la dejó «muerta» (NO_CLIENT_ACCOUNT), como hace a propósito
    const run = (await loadRun('run1'))!;
    run.requests![0].reason = 'NO_CLIENT_ACCOUNT: the client has no Flare account yet (Face ID)';
    await saveRun(run);

    const second = await ask('put-to-work', '0.5');
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('REQUEST_PENDING');
    expect(second.body.withdrawableRequestIds).toEqual([first.body.request.id]);
    expect(second.body.detail).toContain(`DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/${first.body.request.id}`);
    // …y esa puerta cede al dueño
    const door = await request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/requests/${first.body.request.id}`).set(as('alice'));
    expect(door.status).toBe(200);
    expect((await ask('put-to-work', '0.5')).status).toBe(201);
  });

  it('una salida pendiente delante de una entrada → 409 INSUFFICIENT_AVAILABLE_BALANCE con `inFlight`, ids y puerta', async () => {
    const exit = await ask('withdraw', '2');
    expect(exit.status).toBe(201);
    const res = await ask('put-to-work', '1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    expect(res.body.inFlight).toHaveLength(1);
    expect(res.body.inFlight[0]).toMatchObject({ source: 'request', kind: 'withdraw', status: 'pending', id: exit.body.request.id, releasable: true });
    expect(res.body.withdrawableRequestIds).toEqual([exit.body.request.id]);
    expect(res.body.detail).toContain(`DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/${exit.body.request.id}`);
    expect(res.body.detail).toMatch(/cedes only if nothing was signed/);
  });

  it('una reserva de mesa sin memo delante de una entrada → `releasableDeskPaymentIds` y SU puerta', async () => {
    const r = await reserve('2');
    expect(r.status).toBe(201);
    const res = await ask('put-to-work', '1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    expect(res.body.inFlight[0]).toMatchObject({ source: 'desk', kind: 'put-to-work', releasable: true });
    expect(res.body.releasableDeskPaymentIds).toEqual([r.body.deskPayment.id]);
    expect(res.body.detail).toContain(`DELETE /api/demo-exchange/runs/:id/clients/:cid/desk-payments/${r.body.deskPayment.id}`);
  });

  it('lo que SÍ está firmado no se nombra como palanca: la entrada con journal `submitting` retiene la salida sin puerta', async () => {
    const first = await ask('put-to-work', '2');
    await writeSubmission({ requestId: first.body.request.id, runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '2000000', txHash: FE_HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status: 'submitting', updatedAt: T0 });
    const res = await ask('withdraw', '1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('INSUFFICIENT_AVAILABLE_BALANCE');
    expect(res.body.inFlight).toHaveLength(1);
    expect(res.body.inFlight[0].releasable).toBe(false);
    expect(res.body.withdrawableRequestIds).toBeUndefined();
    expect(res.body.detail).not.toMatch(/DELETE/);
  });
});

describe('(5) un entry `failed` del journal (validado ≠ tes) no es «lo firmado»', () => {
  it('no retiene la salida de su dueño (201), y frente a otra entrada se nombra su puerta, que reconcilia y cede', async () => {
    const first = await ask('put-to-work', '2');
    await writeSubmission({ requestId: first.body.request.id, runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '2000000', txHash: FE_HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status: 'failed', code: 'tecPATH_DRY', updatedAt: T0 });
    // la salida sale: los drops de un pago validado como fallido nunca se movieron
    const exit = await ask('withdraw', '2');
    expect(exit.status).toBe(201);
    // y la entrada muerta sigue teniendo puerta: REQUEST_PENDING la nombra…
    const again = await ask('put-to-work', '1');
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('REQUEST_PENDING');
    expect(again.body.withdrawableRequestIds).toEqual([first.body.request.id]);
    // …y el DELETE del dueño la reconcilia (XRPL_tecPATH_DRY) en vez de remitir a un tick
    const door = await request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/requests/${first.body.request.id}`).set(as('alice'));
    expect(door.status).toBe(200);
    expect(door.body.reconciled).toBe('failed-on-ledger');
    expect(door.body.request.reason).toMatch(/^XRPL_tecPATH_DRY:/);
  });
});

describe('(4) el 409 de la reserva con memo dice la verdad', () => {
  it('«it does hold that XRP, including against your withdrawal», y hasta qué ledger', async () => {
    const r = await reserve('2');
    const run = (await loadRun('run1'))!;
    run.deskPayments![0].memoHex = MEMO;
    run.deskPayments![0].lastLedgerSequence = 1090;
    await saveRun(run);
    const res = await request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/desk-payments/${r.body.deskPayment.id}`).set(as('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DESK_PAYMENT_NOT_RELEASABLE_HERE');
    expect(res.body.detail).not.toMatch(/It does not hold your withdrawal/);
    expect(res.body.detail).toMatch(/does hold that XRP, including against your withdrawal/);
    expect(res.body.detail).toMatch(/until XRPL ledger 1090/);
    // This take has NO autopilot and the loop is not running here —
    // «releases it on its own» would be a promise nobody keeps. The sentence
    // says what is true: the desk closes it against the ledger.
    expect(res.body.sweepRunning).toBe(false);
    expect(res.body.detail).not.toMatch(/releases it on its own/);
    expect(res.body.detail).toMatch(/the desk proves it absent against the ledger and releases it/);
    expect(res.body.detail).toMatch(/will not happen by itself/);
    // y es verdad: la salida queda retenida mientras la ventana esté abierta
    expect((await ask('withdraw', '2')).status).toBe(409);
  });

  it('Con el bucle VIVO la promesa «releases it on its own» vale también en una toma sin autopilot — porque el barrido de mesa corre ahí (manualDeskSweep.test)', async () => {
    const { demoExchangeAutopilot } = await import('../../services/demoExchange/DemoExchangeAutopilot');
    const running = jest.spyOn(demoExchangeAutopilot, 'isRunning').mockReturnValue(true);
    try {
      const r = await reserve('2');
      const run = (await loadRun('run1'))!;
      run.deskPayments![0].memoHex = MEMO;
      run.deskPayments![0].lastLedgerSequence = 1090;
      await saveRun(run);
      const res = await request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/desk-payments/${r.body.deskPayment.id}`).set(as('alice'));
      expect(res.status).toBe(409);
      expect(res.body.sweepRunning).toBe(true);
      expect(res.body.detail).toMatch(/releases it on its own/);
      expect(res.body.detail).not.toMatch(/will not happen by itself/);
    } finally {
      running.mockRestore();
    }
  });
});

/**
 * `servedBy` says who ACTUALLY serves: `run.autopilot` means the
 * take is meant for the loop, not that the loop is running (start() exits
 * without a seed or the flags). With it down, the 201 must not promise «in a
 * few seconds».
 */
describe('(7) servedBy comes from the live loop, not from the flag', () => {
  it('autopilot:true but no loop running → servedBy desk and the receipt says «waiting for the exchange»; with the loop up → autopilot', async () => {
    const { demoExchangeAutopilot } = await import('../../services/demoExchange/DemoExchangeAutopilot');
    const run = (await loadRun('run1'))!;
    run.autopilot = true;
    await saveRun(run);
    const down = await ask('withdraw', '0.5');
    expect(down.status).toBe(201);
    expect(down.body.servedBy).toBe('desk');
    expect((await loadRun('run1'))!.receipts.find((x) => /Client requested withdraw/.test(x.note ?? ''))?.note).toMatch(/waiting for the exchange/);

    const running = jest.spyOn(demoExchangeAutopilot, 'isRunning').mockReturnValue(true);
    try {
      const up = await ask('put-to-work', '0.5');
      expect(up.status).toBe(201);
      expect(up.body.servedBy).toBe('autopilot');
    } finally {
      running.mockRestore();
    }
  });
});

/**
 * UN ENTRY MALFORMADO DEL JOURNAL TIENE PUERTA DE ADMIN.
 * `submitting` sin hash / sin LastLedgerSequence: nadie puede seguirlo en el
 * ledger ni probarlo muerto, retenía la salida de su dueño para siempre y el
 * DELETE contestaba 409 «no hash recorded» al dueño Y al admin. El runbook
 * nombraba una puerta que no existía. Ahora existe (`?closeMalformed=1`, solo
 * operador), y el 409 la nombra.
 */
describe('(4) el entry malformado: la puerta del operador', () => {
  const del = (rid: string, headers: Record<string, string>, q = '') =>
    request(app).delete(`/api/demo-exchange/runs/run1/clients/c1/requests/${rid}${q}`).set(headers);
  async function malformedPending(): Promise<string> {
    const asked = await ask('put-to-work', '1');
    const rid = asked.body.request.id as string;
    await writeSubmission({ requestId: rid, runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', txHash: undefined as unknown as string, lastLedgerSequence: undefined as unknown as number, submittedAtLedger: 1000, userOpHash: '0x' + '2'.repeat(64), status: 'submitting', updatedAt: T0 });
    return rid;
  }

  it('el DUEÑO no puede (no puede saber): 409 que lo dice y remite al exchange — también con el flag', async () => {
    const rid = await malformedPending();
    const res = await del(rid, as('alice'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.malformed).toBe(true);
    expect(res.body.detail).toMatch(/no hash recorded/);
    expect(res.body.detail).toMatch(/the exchange desk checks the omnibus history and closes it/);
    expect(res.body.detail).not.toMatch(/reconciles it on its next tick/);
    expect((await del(rid, as('alice'), '?closeMalformed=1')).status).toBe(409);
    expect((await loadRun('run1'))!.requests![0].status).toBe('pending');
  });

  it('el ADMIN sin el flag: 409 que NOMBRA la puerta; con el flag: cierra — journal expired con código, petición refused con motivo, recibo, ops, y el saldo vuelve', async () => {
    const rid = await malformedPending();
    const named = await del(rid, admin);
    expect(named.status).toBe(409);
    expect(named.body.operatorDoor).toBe(`DELETE /api/demo-exchange/runs/:id/clients/:cid/requests/${rid}?closeMalformed=1`);
    expect(named.body.detail).toContain('?closeMalformed=1');

    const closed = await del(rid, admin, '?closeMalformed=1');
    expect(closed.status).toBe(200);
    expect(closed.body.reconciled).toBe('malformed-closed-by-operator');
    expect(closed.body.request.status).toBe('refused');
    expect(closed.body.request.reason).toMatch(/^JOURNAL_ENTRY_MALFORMED_CLOSED: closed by an operator/);
    const { readSubmission } = await import('../../services/demoExchange/submissionJournal');
    expect(await readSubmission(rid)).toMatchObject({ status: 'expired', code: 'CLOSED_BY_OPERATOR_MALFORMED' });
    const live = (await loadRun('run1'))!;
    expect(live.requests![0].status).toBe('refused');
    expect(live.receipts.some((r) => /closed by an operator: its submission journal entry was malformed/.test(r.note ?? ''))).toBe(true);
    expect(opsAlerts.some((a) => a.level === 'warn' && /malformed/.test(a.message))).toBe(true);
    // the XRP it held is available again: a new entry — and a withdrawal — go through
    expect((await ask('withdraw', '2')).status).toBe(201);
  });

  it('un `submitting` SIN hash en el run (el otro lado del mismo estado) lo cierra el operador; el dueño recibe REQUEST_NOT_PENDING como siempre', async () => {
    const run = (await loadRun('run1'))!;
    run.requests = [{ id: 'rqSub', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'submitting', createdAt: T0, updatedAt: T0 }];
    await saveRun(run);
    expect((await del('rqSub', as('alice'))).body.error).toBe('REQUEST_NOT_PENDING');
    expect((await del('rqSub', admin)).body.error).toBe('REQUEST_NOT_PENDING');
    const closed = await del('rqSub', admin, '?closeMalformed=1');
    expect(closed.status).toBe(200);
    expect(closed.body.reconciled).toBe('malformed-closed-by-operator');
    expect((await loadRun('run1'))!.requests![0].status).toBe('refused');
  });

  it('el flag NO abre nada bien formado: un entry `submitting` con hash y ventana sigue siendo del ledger (409, sin `malformed`)', async () => {
    const asked = await ask('put-to-work', '1');
    const rid = asked.body.request.id as string;
    await writeSubmission({ requestId: rid, runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', txHash: FE_HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status: 'submitting', updatedAt: T0 });
    const res = await del(rid, admin, '?closeMalformed=1');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PAYMENT_IN_FLIGHT');
    expect(res.body.malformed).toBeUndefined();
    expect(res.body.detail).toMatch(/reconciles it on its next tick/);
    expect((await loadRun('run1'))!.requests![0].status).toBe('pending');
  });
});

/**
 * Cerrar no espera a una entrada pendiente que nadie
 * firmó: es lo que el tick de la toma cerrada haría con ella (RUN_CLOSED). Lo
 * firmado, y lo que no se pudo leer, sigue contando.
 */
describe('(7) RUN_HAS_LIVE_WORK no cuenta entradas pendientes que el propio cierre cerraría', () => {
  it('una put-to-work pendiente sin journal → el cierre pasa (200) y la cierra con RUN_CLOSED y recibo; una RETIRADA pendiente sigue impidiéndolo', async () => {
    const entry = await ask('put-to-work', '1');
    expect(entry.status).toBe(201);
    const closed = await patchRun({ status: 'closed' });
    expect(closed.status).toBe(200);
    expect(closed.body.run.status).toBe('closed');
    const live = (await loadRun('run1'))!;
    expect(live.requests![0]).toMatchObject({ status: 'refused' });
    expect(live.requests![0].reason).toMatch(/^RUN_CLOSED:/);
    expect(live.receipts.some((r) => /Desk closed: the pending put-to-work/.test(r.note ?? ''))).toBe(true);
    // the money is still the client's to take out
    expect((await ask('withdraw', '1')).status).toBe(201);
  });

  it('una entrada pendiente que el journal dice FIRMADA (submitting) sigue siendo trabajo vivo → 409', async () => {
    const entry = await ask('put-to-work', '1');
    await writeSubmission({ requestId: entry.body.request.id, runId: 'run1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', txHash: FE_HASH, lastLedgerSequence: 1100, submittedAtLedger: 1000, status: 'submitting', updatedAt: T0 });
    const refused = await patchRun({ status: 'closed' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('RUN_HAS_LIVE_WORK');
    expect(refused.body.requests).toHaveLength(1);
    expect((await loadRun('run1'))!.status).toBe('open');
  });
});

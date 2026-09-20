/**
 * What a client can still ask the omnibus to pay, given what is in flight
 * (productizer cycle, it. 6), and the run seq that is never handed out twice.
 * Pure — no RPC, no DB.
 */
import {
  __resetDemoExchangeMemoryForTests,
  bumpSeqHighWater,
  movementKey,
  nextRunSeq,
  readSeqHighWater,
  type ClientRequest,
  type DemoRun,
  type DeskPayment,
} from '../DemoExchangeStore';
import { availableDrops, deskPaymentOpen, deskReservationNothingSigned, paymentsInFlight, requestReserves, reservedDrops, sweepDeskPayments, type Against } from '../availableBalance';

const T0 = new Date(0).toISOString();
const XRP = (n: number) => String(n * 1_000_000);

function rq(id: string, kind: ClientRequest['kind'], xrp: number, status: ClientRequest['status'], extra: Partial<ClientRequest> = {}): ClientRequest {
  return { id, kind, clientId: 'c1', drops: XRP(xrp), status, createdAt: T0, updatedAt: T0, ...extra };
}

function dp(id: string, kind: DeskPayment['kind'], xrp: number, status: DeskPayment['status'], extra: Partial<DeskPayment> = {}): DeskPayment {
  return { id, kind, clientId: 'c1', drops: XRP(xrp), status, createdAt: T0, updatedAt: T0, ...extra };
}

function run(balanceXrp: number, over: Partial<DemoRun> = {}): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'take 1',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7',
    policy: 'A',
    createdAt: T0,
    status: 'open',
    clients: [{ id: 'c1', runId: 'run1', label: 'Ana', tag: 101, kyc: 'none', xrpOnExchangeDrops: XRP(balanceXrp), createdAt: T0 }],
    receipts: [],
    requests: [],
    appliedTxHashes: [],
    ...over,
  };
}

const HASH = 'A'.repeat(64);

describe('availableDrops — requests', () => {
  test('pending and submitting requests reserve; the rest do not', () => {
    const r = run(10, {
      requests: [
        rq('p', 'withdraw', 1, 'pending'),
        rq('s', 'put-to-work', 2, 'submitting', { txHash: HASH }),
        rq('signed', 'put-to-work', 3, 'signed', { txHash: 'B'.repeat(64) }), // finishSubmission already debited it
        rq('done', 'withdraw', 3, 'done'),
        rq('refused', 'withdraw', 3, 'refused'),
      ],
    });
    expect(reservedDrops(r, 'c1')).toBe(BigInt(XRP(3)));
    expect(availableDrops(r, 'c1')).toBe(BigInt(XRP(7)));
  });

  test('THE bug: withdraw X submitting (outcome unread) leaves nothing for put-to-work X', () => {
    const r = run(1, { requests: [rq('w', 'withdraw', 1, 'submitting', { txHash: HASH })] });
    expect(availableDrops(r, 'c1')).toBe(BigInt(0));
  });

  test('a submitting request whose hash the watcher already mirrored is not counted twice', () => {
    const r = run(4, { requests: [rq('w', 'withdraw', 1, 'submitting', { txHash: HASH })], appliedTxHashes: [movementKey('withdraw', HASH)] });
    expect(reservedDrops(r, 'c1')).toBe(BigInt(0));
    expect(availableDrops(r, 'c1')).toBe(BigInt(XRP(4)));
  });

  test('excluding the request being served: FIFO — two pending requests never reserve each other', () => {
    const r = run(1, { requests: [rq('first', 'withdraw', 1, 'pending'), rq('second', 'put-to-work', 1, 'pending')] });
    expect(availableDrops(r, 'c1', 'first')).toBe(BigInt(XRP(1))); // the one ahead is served
    expect(availableDrops(r, 'c1', 'second')).toBe(BigInt(0)); // the one behind waits
  });

  test('other clients do not count; never negative; unknown client = 0', () => {
    const r = run(1, { requests: [rq('mine', 'withdraw', 3, 'pending'), { ...rq('other', 'withdraw', 5, 'pending'), clientId: 'c2' }] });
    expect(reservedDrops(r, 'c1')).toBe(BigInt(XRP(3)));
    expect(availableDrops(r, 'c1')).toBe(BigInt(0));
    expect(availableDrops(r, 'ghost')).toBe(BigInt(0));
  });
});

describe('desk payments', () => {
  test('prepared and signed reserve; settled and released do not', () => {
    const r = run(10, {
      deskPayments: [dp('a', 'withdraw', 1, 'prepared', { lastLedgerSequence: 1100 }), dp('b', 'put-to-work', 2, 'prepared'), dp('c', 'withdraw', 3, 'signed', { txHash: HASH }), dp('d', 'withdraw', 4, 'settled'), dp('e', 'withdraw', 4, 'released')],
    });
    expect(reservedDrops(r, 'c1')).toBe(BigInt(XRP(6)));
    expect(paymentsInFlight(r, 'c1').map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('a prepared payout closes ONLY past its LastLedgerSequence AND proven absent by an exhaustive read', () => {
    const r = run(5);
    const p = dp('a', 'withdraw', 1, 'prepared', { lastLedgerSequence: 1100 });
    const proven = new Set(['a']);
    expect(deskPaymentOpen(r, p)).toBe(true); // no view: no ledger closes anything
    expect(deskPaymentOpen(r, p, { validatedLedgerIndex: 1100, payoutsProvenAbsent: proven })).toBe(true); // could still enter ledger 1100
    // it. 8: past the LLS alone is NOT enough — a page-capped scan can miss a validated payout
    expect(deskPaymentOpen(r, p, { validatedLedgerIndex: 1101 })).toBe(true);
    expect(deskPaymentOpen(r, p, { validatedLedgerIndex: 1101, payoutsProvenAbsent: new Set(['other']) })).toBe(true);
    expect(deskPaymentOpen(r, p, { validatedLedgerIndex: 1101, payoutsProvenAbsent: proven })).toBe(false);
    // a put-to-work reservation has no LLS: no ledger view closes it, not even a stray proof
    expect(deskPaymentOpen(r, dp('b', 'put-to-work', 1, 'prepared', { lastLedgerSequence: 10 }), { validatedLedgerIndex: 99_999_999, payoutsProvenAbsent: new Set(['b']) })).toBe(true);
  });

  test('a signed desk payment reserves until the mirror applied its hash', () => {
    const r = run(5);
    const p = dp('a', 'withdraw', 1, 'signed', { txHash: HASH, lastLedgerSequence: 1100 });
    expect(deskPaymentOpen(r, p, { validatedLedgerIndex: 5000 })).toBe(true); // the ledger view never releases a signed one
    r.appliedTxHashes.push(movementKey('withdraw', HASH));
    expect(deskPaymentOpen(r, p)).toBe(false);
  });

  test('sweepDeskPayments: applied → settled, past LLS + proven absent → released, unproven or live untouched', () => {
    const r = run(5, {
      appliedTxHashes: [movementKey('withdraw', HASH)],
      deskPayments: [
        dp('applied', 'withdraw', 1, 'signed', { txHash: HASH }),
        dp('expired', 'withdraw', 1, 'prepared', { lastLedgerSequence: 10 }),
        dp('unproven', 'withdraw', 1, 'prepared', { lastLedgerSequence: 10 }),
        dp('live', 'withdraw', 1, 'prepared', { lastLedgerSequence: 5000 }),
        dp('mint', 'put-to-work', 1, 'prepared'),
      ],
    });
    expect(sweepDeskPayments(r, { validatedLedgerIndex: 100, payoutsProvenAbsent: new Set(['expired', 'live', 'mint']) })).toBe(2);
    expect(r.deskPayments!.map((p) => p.status)).toEqual(['settled', 'released', 'prepared', 'prepared', 'prepared']);
  });

  test('a desk payment reserves for the autopilot too (excluding a request does not exclude the desk)', () => {
    const r = run(1, { requests: [rq('w', 'withdraw', 1, 'pending')], deskPayments: [dp('a', 'withdraw', 1, 'prepared', { lastLedgerSequence: 1100 })] });
    expect(availableDrops(r, 'c1', 'w')).toBe(BigInt(0));
  });
});

describe('run seq high-water (tags of a deleted run are never reused)', () => {
  const SAVED_DB = process.env.DATABASE_URL;
  beforeAll(() => {
    delete process.env.DATABASE_URL;
  });
  afterAll(() => {
    if (SAVED_DB !== undefined) process.env.DATABASE_URL = SAVED_DB;
  });
  beforeEach(() => __resetDemoExchangeMemoryForTests());

  test('nextRunSeq = max(high-water, live max) + 1', () => {
    expect(nextRunSeq([], 0)).toBe(1);
    expect(nextRunSeq([{ seq: 1 }, { seq: 4 }], 2)).toBe(5);
    // the last run (seq 4) was deleted: live max is 3, the mark still says 4
    expect(nextRunSeq([{ seq: 1 }, { seq: 3 }], 4)).toBe(5);
  });

  test('the mark only rises', async () => {
    expect(await readSeqHighWater()).toBe(0);
    await bumpSeqHighWater(5);
    await bumpSeqHighWater(3);
    expect(await readSeqHighWater()).toBe(5);
  });
});

/**
 * it. 27 — LA RESERVA ES ASIMÉTRICA: UNA ENTRADA PENDIENTE NO RETIENE LA SALIDA.
 *
 * Una petición 'pending' reservaba SIEMPRE. El autopiloto deja pendiente a
 * propósito toda entrada que quizá pueda firmarse más tarde, y hay estados que no
 * se arreglan nunca (`NO_CLIENT_ACCOUNT` mientras el cliente no cree su cuenta
 * Flare), así que esa entrada retenia el saldo de su dueño para siempre.
 *
 * it. 29 — Y LA EXENCIÓN LA CONCEDE UNA PRUEBA, NO EL `status`. Un guardado
 * concurrente del run devuelve a 'pending' una petición YA firmada; por eso la
 * exención viaja como `Against.provenUnsigned` (leído del journal). Sin la prueba
 * —o con una entrada que el journal dice firmada— la entrada retiene como antes.
 */
describe('it. 27/29 — una entrada pendiente PROBADA sin firma no retiene la salida de su dueño', () => {
  const entry = rq('entry', 'put-to-work', 2, 'pending');
  const exit = rq('exit', 'withdraw', 2, 'pending');
  /** El journal la declaró nunca firmada. */
  const OUT_PROVEN: Against = { kind: 'withdraw', provenUnsigned: new Set(['entry']) };
  /** Dirección sin prueba (journal no consultado, o ilegible): fail-closed. */
  const OUT_BLIND: Against = { kind: 'withdraw' };
  const IN: Against = { kind: 'put-to-work' };

  test('`requestReserves`: la entrada pendiente no cuenta contra una salida SOLO con la prueba del journal; sí contra otra entrada', () => {
    const r = run(2, { requests: [entry] });
    expect(requestReserves(r, entry)).toBe(true); // sin dirección: lo estricto de siempre
    expect(requestReserves(r, entry, IN)).toBe(true);
    expect(requestReserves(r, entry, OUT_PROVEN)).toBe(false);
    // it. 29 — la dirección sola no exime: sin prueba, retiene.
    expect(requestReserves(r, entry, OUT_BLIND)).toBe(true);
    expect(requestReserves(r, entry, { kind: 'withdraw', provenUnsigned: new Set(['someone-else']) })).toBe(true);
    // Y una salida pendiente retiene SIEMPRE: es lo que su dueño ya pidió.
    expect(requestReserves(r, exit, OUT_PROVEN)).toBe(true);
    expect(requestReserves(r, exit, IN)).toBe(true);
  });

  test('it. 29 — CADENA (a): el journal dice que la entrada está firmada → la salida NO se compone (la entrada retiene)', () => {
    // La fila del run dice 'pending' (un guardado concurrente la devolvió ahí),
    // pero el journal no la exime: `againstFor` no la mete en `provenUnsigned`.
    const r = run(2, { requests: [entry] });
    const againstWithSignedEntry: Against = { kind: 'withdraw', provenUnsigned: new Set<string>() };
    expect(requestReserves(r, entry, againstWithSignedEntry)).toBe(true);
    expect(availableDrops(r, 'c1', undefined, {}, againstWithSignedEntry)).toBe(BigInt(0));
    expect(paymentsInFlight(r, 'c1', {}, undefined, againstWithSignedEntry).map((p) => p.id)).toEqual(['entry']);
  });

  test('it. 29 — un pending CON hash retiene aunque el journal lo exima: hay bytes firmados', () => {
    const withHash = rq('entry', 'put-to-work', 2, 'pending', { txHash: HASH });
    const r = run(2, { requests: [withHash] });
    expect(requestReserves(r, withHash, OUT_PROVEN)).toBe(true);
  });

  test('el saldo disponible PARA SALIR ignora la entrada muerta (probada sin firma)', () => {
    const r = run(2, { requests: [entry] });
    expect(availableDrops(r, 'c1')).toBe(BigInt(0));
    expect(availableDrops(r, 'c1', undefined, {}, OUT_PROVEN)).toBe(BigInt(XRP(2)));
    expect(paymentsInFlight(r, 'c1', {}, undefined, OUT_PROVEN)).toEqual([]);
  });

  test('una entrada FIRMADA sí retiene: ahí hay un pago que podría pagarse dos veces', () => {
    const signed = rq('signed', 'put-to-work', 2, 'submitting', { txHash: HASH });
    const r = run(2, { requests: [signed] });
    expect(availableDrops(r, 'c1', undefined, {}, { kind: 'withdraw', provenUnsigned: new Set(['signed']) })).toBe(BigInt(0));
  });

  test('la salida pesa esté donde esté en la cola: sirviendo la entrada de delante, la salida de detrás la retiene', () => {
    const r = run(2, { requests: [rq('entry', 'put-to-work', 2, 'pending'), rq('exit', 'withdraw', 2, 'pending')] });
    // Antes: FIFO puro — la entrada se servía y la salida moría detrás.
    expect(availableDrops(r, 'c1', 'entry', {}, IN)).toBe(BigInt(0));
    // Y al revés, la salida pasa: la entrada probada sin firma no la retiene.
    expect(availableDrops(r, 'c1', 'exit', {}, OUT_PROVEN)).toBe(BigInt(XRP(2)));
  });

  test('`releasable` nombra lo que tiene puerta: una petición pendiente sin hash sí; una submitting no', () => {
    const r = run(4, { requests: [rq('p', 'withdraw', 1, 'pending'), rq('s', 'withdraw', 1, 'submitting', { txHash: HASH })] });
    const flags = Object.fromEntries(paymentsInFlight(r, 'c1').map((p) => [p.id, p.releasable]));
    expect(flags).toEqual({ p: true, s: false });
  });
});

/**
 * it. 29 — LA MISMA ASIMETRÍA EN LA MESA. `POST /runs/:id/desk-payments` abre una
 * reserva `prepared` de put-to-work SIN memo y sin un solo byte firmado, no caduca
 * por ledger (solo un withdraw cierra ahí) y retenía la salida de su dueño para
 * siempre; su única puerta era un DELETE de admin que contesta 503 sin XRPL.
 */
describe('it. 29 — una reserva de MESA de la que nunca se compuso nada no retiene la salida de su dueño', () => {
  const OUT: Against = { kind: 'withdraw', provenUnsigned: new Set<string>() };
  const IN: Against = { kind: 'put-to-work' };
  const abandoned = dp('desk', 'put-to-work', 2, 'prepared');

  test('`deskReservationNothingSigned`: solo put-to-work + prepared + sin memo + sin hash', () => {
    expect(deskReservationNothingSigned(abandoned)).toBe(true);
    expect(deskReservationNothingSigned(dp('m', 'put-to-work', 2, 'prepared', { memoHex: 'ABCD' }))).toBe(false);
    expect(deskReservationNothingSigned(dp('h', 'put-to-work', 2, 'prepared', { txHash: HASH }))).toBe(false);
    expect(deskReservationNothingSigned(dp('s', 'put-to-work', 2, 'signed', { txHash: HASH }))).toBe(false);
    expect(deskReservationNothingSigned(dp('w', 'withdraw', 2, 'prepared', { lastLedgerSequence: 1100 }))).toBe(false);
  });

  test('CADENA (b): la reserva abandonada no bloquea la retirada; sí bloquea otra entrada', () => {
    const r = run(2, { deskPayments: [abandoned] });
    expect(deskPaymentOpen(r, abandoned)).toBe(true); // sin dirección: lo estricto
    expect(deskPaymentOpen(r, abandoned, {}, IN)).toBe(true);
    expect(deskPaymentOpen(r, abandoned, {}, OUT)).toBe(false);
    expect(availableDrops(r, 'c1', undefined, {}, IN)).toBe(BigInt(0));
    expect(availableDrops(r, 'c1', undefined, {}, OUT)).toBe(BigInt(XRP(2)));
    expect(paymentsInFlight(r, 'c1', {}, undefined, OUT)).toEqual([]);
    // y para el autopiloto sirviendo la salida del cliente, igual
    const r2 = run(2, { requests: [rq('exit', 'withdraw', 2, 'pending')], deskPayments: [abandoned] });
    expect(availableDrops(r2, 'c1', 'exit', {}, OUT)).toBe(BigInt(XRP(2)));
  });

  test('una reserva de mesa CON memo (el servidor compuso un 0xFE) sigue reteniendo la salida', () => {
    const composed = dp('desk', 'put-to-work', 2, 'prepared', { memoHex: 'ABCD', lastLedgerSequence: 1100 });
    const r = run(2, { deskPayments: [composed] });
    expect(deskPaymentOpen(r, composed, {}, OUT)).toBe(true);
    expect(availableDrops(r, 'c1', undefined, {}, OUT)).toBe(BigInt(0));
    expect(paymentsInFlight(r, 'c1', {}, undefined, OUT).map((p) => [p.id, p.releasable])).toEqual([['desk', false]]);
  });

  test('frente a otra ENTRADA la reserva abandonada aparece como `releasable`: el 409 nombra su puerta', () => {
    const r = run(2, { deskPayments: [abandoned] });
    expect(paymentsInFlight(r, 'c1', {}, undefined, IN).map((p) => [p.source, p.id, p.releasable])).toEqual([['desk', 'desk', true]]);
  });

  test('el barrido no la cierra: soltarla es un acto con puerta, no un efecto del tiempo', () => {
    const r = run(2, { deskPayments: [abandoned] });
    expect(sweepDeskPayments(r, { validatedLedgerIndex: 99_999_999, payoutsProvenAbsent: new Set(['desk']) })).toBe(0);
    expect(r.deskPayments![0].status).toBe('prepared');
  });
});

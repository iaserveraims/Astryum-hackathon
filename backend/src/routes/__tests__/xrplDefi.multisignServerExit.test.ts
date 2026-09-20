/**
 * productizer it. 13 (finding 4.1) — an institutional council's EXIT is signable
 * from anywhere, even without the exit token.
 *
 * The recall of ExchangeDesk / OperatorConsole and the creator exit reach
 * `/multisign/prepare` with no token; under an allowlist with no region they got
 * 451 everywhere. The coordinator now asks what the SERVER composed: the single
 * memo names a composed council order of this account (bytes, exit action,
 * Destination/Amount) or a queued 0xFE handoff of this account with an exit label
 * (Amount, Core Vault) → flag-only. An entry on the same account stays gated.
 */
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';

jest.mock('../councilProposals', () => ({
  findLiveProposal: jest.fn(async () => null),
  findUnresolvedSeat: jest.fn(async () => null),
  recordCeremonySeat: jest.fn(async () => undefined),
  sessionIsCouncilMember: jest.fn(async () => false),
  sessionMayReadCouncil: jest.fn(async () => false),
}));
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({ xrplProvider: {} }));
const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplMultisigCoordinator'),
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
}));
const mockReadOrder = jest.fn();
/**
 * it. 19 (finding 2.7 / R4 #3) — the classifier's distinguishable reasons are an
 * oracle over other people's memos, so they travel only to a caller who proves this
 * account. This is that verdict's knob; the default is «yes, it is their council»,
 * which is what every case below is about, and one case turns it off.
 */
const mockProvesCouncil = jest.fn(async () => true);
/**
 * it. 21 (finding 2.8): the door asks ONE floor now — the READ floor (proven OR
 * registered). This knob is that floor; it defaults to whatever the proof says, so
 * every case below is unchanged, and one case sets them apart on purpose.
 */
const mockMayReadCouncil = jest.fn<Promise<boolean>, unknown[]>();
/**
 * it. 21 (finding 2.8): the door now asks ONE floor — the READ floor (proven OR
 * registered), the one it. 19 opened on purpose so a cosignatory known only to the
 * `wallet` registry stops getting an opaque 409 on their own exit. Same knob.
 */
jest.mock('../../services/flare/ComposedCouncilOrderStore', () => ({
  ...jest.requireActual('../../services/flare/ComposedCouncilOrderStore'),
  getComposedCouncilOrderStrict: (...a: unknown[]) => mockReadOrder(...a),
  sessionProvesCouncil: () => mockProvesCouncil(),
  sessionMayReadCouncilAccount: () => mockMayReadCouncil(),
}));
const mockReadHandoff = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  findQueuedHandoffByMemo: (...a: unknown[]) => mockReadHandoff(...a),
  // it. 29: `xrplDefi.ts` now imports the pure memo reader from the store
  // (`zeroFeMemoOf` delegates to it). It is pure — keep the real one, or every
  // prepare in this suite dies 400 PREPARE_FAILED «is not a function».
  zeroFeMemoOfTx: jest.requireActual('../../services/flare/DirectMintHandoffStore').zeroFeMemoOfTx,
}));
// it. 15: the any-state lookup reads `background_jobs` itself (the store's reads are
// queued-only and swallow database errors).
const mockHandoffRows = jest.fn(async () => [] as Array<{ payload: Record<string, unknown>; status: string }>);
jest.mock('../../database/prismaClient', () => ({
  prisma: { backgroundJob: { findMany: () => mockHandoffRows() } },
}));
const CORE_VAULT = 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXXX'.slice(0, 33);
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  readDirectMintParams: jest.fn(async () => ({ paymentAddress: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX' })),
}));
jest.mock('../../services/flare/flareProvider', () => ({ flareReadProvider: jest.fn(() => ({})) }));

import xrplDefiRouter from '../xrplDefi';

const app = express();
app.use(express.json());
app.use('/api/xrpl-defi', xrplDefiRouter);

const PIN = '/api/xrpl-defi/multisign/prepare';
const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const OTHER = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const ANCHOR = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const ORDER_DATA = '0xdeadbeef';
const MEMO = ethers.keccak256(ORDER_DATA).slice(2).toUpperCase();
const orderTx = (over: Record<string, unknown> = {}) => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: ANCHOR,
  Amount: '1',
  Memos: [{ Memo: { MemoData: MEMO } }],
  ...over,
});
const record = (over: Record<string, unknown> = {}) => ({
  council: COUNCIL,
  orderData: ORDER_DATA,
  action: 'recall',
  destination: ANCHOR,
  amount: '1',
  ...over,
});
/**
 * it. 29: the REAL 0xFE shape — 42 bytes / 84 hex, the whole Smart Account
 * instruction. This suite carried a 64-hex stand-in (`'FE'.repeat(32)`), which is
 * how the handoff branch below passed here while `singleMemoHex` threw every real
 * 0xFE memo away in production.
 */
const HANDOFF_MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const handoffTx = (over: Record<string, unknown> = {}) => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: CORE_VAULT,
  Amount: '2000000',
  Memos: [{ Memo: { MemoData: HANDOFF_MEMO } }],
  ...over,
});

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  delete process.env.DATABASE_URL;
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  // An allowlist and NO region in the body: what the institutional screens send.
  process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES,AD';
  mockReadOrder.mockResolvedValue(null);
  mockReadHandoff.mockResolvedValue(null);
  mockHandoffRows.mockResolvedValue([]);
  mockProvesCouncil.mockResolvedValue(true);
  mockMayReadCouncil.mockImplementation(() => mockProvesCouncil());
  mockPrepare.mockImplementation(async (_r: unknown, input: { account: string; xrplTx: Record<string, unknown> }) => ({
    multisigTx: { ...input.xrplTx, Account: input.account, Sequence: 11, Fee: '36', SigningPubKey: '' },
    council: { quorum: 2, masterKeyDisabled: true, signers: [] },
    fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
    preflight: { available: true, willSucceed: true, balanceChanges: [] },
  }));
});
afterAll(() => {
  process.env = ENV;
});

describe('a council order the server composed', () => {
  it('institutional recall, multisig, allowlist and NO region, no token → pinned (200)', async () => {
    mockReadOrder.mockResolvedValue(record());
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(res.status).toBe(200);
    expect(mockReadOrder).toHaveBeenCalledWith(MEMO);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });

  it('an ENTRY composed for the same account stays gated (451, not-an-exit)', async () => {
    mockReadOrder.mockResolvedValue(record({ action: 'direct-to' }));
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(res.status).toBe(451);
    expect(res.body.exitClassification).toBe('not-an-exit');
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it.each([
    ['another council’s recall', record({ council: OTHER }), orderTx(), 'other-account'],
    ['bytes that no longer hash to the memo', record({ orderData: '0xbeef' }), orderTx(), 'bytes-mismatch'],
    ['a Destination other than the one composed', record(), orderTx({ Destination: OTHER }), 'destination-mismatch'],
    ['an Amount other than the one composed', record(), orderTx({ Amount: '999' }), 'amount-mismatch'],
    ['a record without the composed Destination (older row)', record({ destination: undefined }), orderTx(), 'destination-mismatch'],
  ])('%s → 451', async (_label, rec, tx, reason) => {
    mockReadOrder.mockResolvedValue(rec);
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: tx });
    expect(res.status).toBe(451);
    expect(res.body.exitClassification).toBe(reason);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('several memos, or an unknown one, keep the full gate', async () => {
    mockReadOrder.mockResolvedValue(record());
    const two = await request(app)
      .post(PIN)
      .send({ account: COUNCIL, xrplTx: orderTx({ Memos: [{ Memo: { MemoData: MEMO } }, { Memo: { MemoData: MEMO } }] }) });
    expect(two.status).toBe(451);
    expect(two.body.exitClassification).toBe('no-single-memo');
    mockReadOrder.mockResolvedValue(null);
    const unknown = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(unknown.status).toBe(451);
    expect(unknown.body.exitClassification).toBe('unknown-memo');
  });

  it('a store we could not read is 503 with a retry, NEVER a 451 about the region (it. 15, 3.3)', async () => {
    mockReadOrder.mockRejectedValue(new Error('db down'));
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'EXIT_CLASSIFICATION_UNREADABLE', exitClassification: 'unreadable', retryable: true });
    expect(String(res.body.detail)).toMatch(/never refused for your region/i);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('the flag still closes everything (503), before any lookup', async () => {
    delete process.env.XRPL_DEFI_ENABLED;
    mockReadOrder.mockResolvedValue(record());
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(res.status).toBe(503);
    expect(mockReadOrder).not.toHaveBeenCalled();
  });

  /**
   * productizer it. 17 (finding 3.3) — THE LOOKUP IS NOT A PRIVILEGE OF THE BLOCKED
   * REGIONS. It used to run only when the geofence was about to answer 451, so the
   * one thing it knows that matters everywhere — «the 0xFE this payment carries can
   * no longer be signed» — was withheld from the councils whose region was allowed:
   * they signed the corpse and spent the carrier for nothing (see the handoff
   * describe below, which now also holds in an allowed region).
   */
  it('an allowed region is pinned all the same — and the lookup still runs', async () => {
    delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx(), region: 'ES' });
    expect(res.status).toBe(200);
    expect(mockReadOrder).toHaveBeenCalled();
  });
});

describe('a 0xFE handoff the server composed', () => {
  it('the creator exit (council multisig) → pinned (200)', async () => {
    mockReadHandoff.mockResolvedValue({ xrplAddress: COUNCIL, action: 'astryum-creator-exit', grossXrpDrops: '2000000' });
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: handoffTx({ Destination: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX' }) });
    expect(res.status).toBe(200);
    expect(mockReadHandoff).toHaveBeenCalledWith(HANDOFF_MEMO);
  });

  it('an entry handoff for the same account stays gated', async () => {
    mockReadHandoff.mockResolvedValue({ xrplAddress: COUNCIL, action: 'astryum-pote-fund', grossXrpDrops: '2000000' });
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: handoffTx({ Destination: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX' }) });
    expect(res.status).toBe(451);
    expect(res.body.exitClassification).toBe('not-an-exit');
  });

  it('an exit whose 0xFE was superseded is 409 handoff-not-signable — the region is not the reason (it. 15, 3.3)', async () => {
    // No queued row: the same memo is looked up in ANY state, straight off the table.
    process.env.DATABASE_URL = 'postgres://test';
    mockReadHandoff.mockResolvedValue(null);
    mockHandoffRows.mockResolvedValue([
      { payload: { xrplAddress: COUNCIL, action: 'astryum-pote-exit', grossXrpDrops: '2000000', memoHex: HANDOFF_MEMO }, status: 'superseded' },
    ]);
    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: handoffTx({ Destination: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX' }) });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'EXIT_HANDOFF_NOT_SIGNABLE', exitClassification: 'handoff-not-signable', handoffStatus: 'superseded' });
    expect(String(res.body.detail)).toMatch(/prepare the exit again/i);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  /**
   * productizer it. 17 (finding 3.3) — THE SAME TRUTH IN AN ALLOWED REGION. The
   * council whose region the geofence lets through used to get a 200 over a dead
   * 0xFE: it gathered the quorum, signed, and the carrier was spent on a payment
   * that could never mint. Same 409, same words, no region involved.
   */
  it('a superseded 0xFE is 409 in an ALLOWED region too — never a signed corpse', async () => {
    delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
    process.env.DATABASE_URL = 'postgres://test';
    mockReadHandoff.mockResolvedValue(null);
    mockHandoffRows.mockResolvedValue([
      { payload: { xrplAddress: COUNCIL, action: 'astryum-pote-exit', grossXrpDrops: '2000000', memoHex: HANDOFF_MEMO }, status: 'superseded' },
    ]);
    const res = await request(app)
      .post(PIN)
      .send({ account: COUNCIL, xrplTx: handoffTx({ Destination: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX' }), region: 'ES' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'EXIT_HANDOFF_NOT_SIGNABLE', handoffStatus: 'superseded' });
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  /**
   * it. 19 (finding 2.7 / R4 #3 and #8) — THE CLASSIFIER STOPS ANSWERING STRANGERS.
   *
   * Paste any account and any memo and the reasons said whether the server had
   * composed an order for it, whether that order was an exit, whether the amount
   * matched and whether its 0xFE had already been executed. Now every distinguishable
   * reason collapses, under ONE status, into one sentence that carries nothing — and
   * refuses nothing that was not refused already: an exit the server DOES recognise is
   * still composed for whoever asks.
   */
  it('a caller who does not prove the account gets ONE generic sentence, never the reason', async () => {
    mockProvesCouncil.mockResolvedValue(false);
    process.env.DATABASE_URL = 'postgres://test';
    mockReadHandoff.mockResolvedValue(null);
    mockHandoffRows.mockResolvedValue([
      { payload: { xrplAddress: COUNCIL, action: 'astryum-pote-exit', grossXrpDrops: '2000000', memoHex: HANDOFF_MEMO }, status: 'superseded' },
    ]);
    const stale = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: handoffTx({ Destination: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX' }) });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('CANNOT_PREPARE_HERE');
    expect(stale.body.handoffStatus).toBeUndefined();
    expect(stale.body.exitClassification).toBeUndefined();

    // The same sentence, the same status, when the store could not be read at all.
    mockHandoffRows.mockResolvedValue([]);
    mockReadOrder.mockRejectedValue(new Error('db down'));
    const unreadable = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(unreadable.status).toBe(409);
    expect(unreadable.body.error).toBe('CANNOT_PREPARE_HERE');

    // And a 451 stays a 451 — that one IS about the region — but carries no reason.
    mockReadOrder.mockResolvedValue(record({ action: 'direct-to' }));
    const gated = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(gated.status).toBe(451);
    expect(gated.body.exitClassification).toBeUndefined();

    // THE POINT: a recognised exit is composed for them exactly as before.
    mockReadOrder.mockResolvedValue(record());
    const exit = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });
    expect(exit.status).toBe(200);
  });

  it('an exit handoff paid anywhere but the Core Vault, or another amount, stays gated', async () => {
    mockReadHandoff.mockResolvedValue({ xrplAddress: COUNCIL, action: 'astryum-pote-exit', grossXrpDrops: '2000000' });
    const dest = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: handoffTx({ Destination: OTHER }) });
    expect(dest.body.exitClassification).toBe('destination-mismatch');
    const amount = await request(app)
      .post(PIN)
      .send({ account: COUNCIL, xrplTx: handoffTx({ Destination: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX', Amount: '1' }) });
    expect(amount.body.exitClassification).toBe('amount-mismatch');
    expect(mockPrepare).not.toHaveBeenCalled();
  });
});


/**
 * productizer it. 21 (finding 2.8) — DOS SUELOS EN EL MISMO HANDLER.
 *
 * Para DAR LA RAZÓN de un rechazo la puerta exigía PRUEBA
 * (`sessionProvesCouncil`); diez líneas más abajo, para nombrar la fila que tiene el
 * asiento, bastaba proven-O-registrado (`sessionMayReadCouncil`) — el suelo de
 * LECTURA que la it. 19 abrió a propósito, porque los bytes que firma un
 * cosignatario salen de una lectura. Así que el cosignatario para el que se escribió
 * aquel arreglo abría la propuesta en la bandeja y aquí recibía un 409 opaco, sin
 * paso siguiente, sobre la salida de su propia familia.
 */
describe('it. 21 (2.8) — un solo suelo para «¿se te puede decir por qué?»', () => {
  it('un cosignatario que NO prueba pero SÍ puede leer recibe la razón, no el 409 genérico', async () => {
    mockReadOrder.mockRejectedValue(new Error('store down')); // clasificación ilegible
    mockProvesCouncil.mockResolvedValue(false);
    mockMayReadCouncil.mockResolvedValue(true);

    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('EXIT_CLASSIFICATION_UNREADABLE');
    expect(res.body.retryable).toBe(true);
  });

  it('quien no prueba NI puede leer sigue recibiendo la frase genérica', async () => {
    mockReadOrder.mockRejectedValue(new Error('store down'));
    mockProvesCouncil.mockResolvedValue(false);
    mockMayReadCouncil.mockResolvedValue(false);

    const res = await request(app).post(PIN).send({ account: COUNCIL, xrplTx: orderTx() });

    expect(res.status).toBe(409);
    expect(res.body.error).not.toBe('EXIT_CLASSIFICATION_UNREADABLE');
    expect(JSON.stringify(res.body)).not.toContain('unreadable');
  });
});

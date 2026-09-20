/**
 * The omnibus never pays the same balance twice (productizer cycle, it. 6).
 * A request in 'submitting' (signed, submit threw, outcome unread) used to
 * reserve nothing: with X deposited, «withdraw X» + «put X to work» were BOTH
 * signed and the omnibus paid 2X. Now what is in flight is reserved.
 */
import type { DemoRun } from '../DemoExchangeStore';
// Esta suite prueba OTRAS reglas y no tiene ledger: el KYC al ejecutar (14-sep)
// se prueba en DemoExchangeAutopilot.kycAtFulfil.test.
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const CORE_VAULT = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';

let runsToServe: DemoRun[] = [];
const kv = new Map<string, Record<string, unknown>>();
let hashCounter = 0;

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockLookup = jest.fn();

jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async (jobType: string, _kf: string, key: string) => kv.get(`${jobType}:${key}`) ?? null),
  kvGetStrict: jest.fn(async (jobType: string, _kf: string, key: string) => kv.get(`${jobType}:${key}`) ?? null),
  kvUpsert: jest.fn(async (jobType: string, _kf: string, key: string, payload: Record<string, unknown>) => {
    kv.set(`${jobType}:${key}`, JSON.parse(JSON.stringify(payload)));
  }),
  kvList: jest.fn(async () => []),
  kvDelete: jest.fn(async () => undefined),
}));

jest.mock('../DemoExchangeStore', () => {
  const actual = jest.requireActual('../DemoExchangeStore');
  return {
    ...actual,
    listRuns: jest.fn(async () => runsToServe),
    loadRun: jest.fn(async (id: string) => runsToServe.find((r) => r.runId === id) ?? null),
    saveRun: jest.fn(async () => undefined),
  };
});

jest.mock('../DemoExchangeSync', () => ({
  syncOmnibus: jest.fn(async () => ({ credited: [] })),
  makeReceipt: (_run: unknown, r: Record<string, unknown>) => ({ id: `rc_${Math.random().toString(36).slice(2)}`, ...r }),
}));

jest.mock('../DemoExchangeSigner', () => ({
  readSignerConfig: () => ({ enabled: true, address: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', seedPresent: true, maxTxDrops: '10000000', dailyCapDrops: '100000000', attribution: 'operational' }),
  assessPayment: () => ({ ok: true }),
  readOmnibusAppointment: async () => null,
  spentToday: async () => BigInt(0),
  sweepStaleReservations: async () => [],
  recordSpend: async () => undefined,
  // it. 23 (1.4): the spend is RESERVED before the blob leaves and given
  // back when the ledger proves the payment never entered.
  reserveSpend: async () => undefined,
  releaseSpend: async () => undefined,
  signAndSubmit: jest.fn(),
  signForSubmission: (...a: unknown[]) => mockSign(...a),
  submitSignedBlob: (...a: unknown[]) => mockSubmit(...a),
  lookupSubmission: (...a: unknown[]) => mockLookup(...a),
}));

jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}) }));
jest.mock('../../ops/agentHeartbeats', () => ({ markAgentTick: () => undefined }));
jest.mock('../../flare/DirectMintHandoffStore', () => ({
  markHandoffSignedByMemo: async () => true,
  markHandoffParkedByUserOpHash: async () => true,
}));
jest.mock('../../flare/AstryumPoteStateService', () => ({
  readPoteState: async () => ({ asset: { address: '0x' + 'a'.repeat(40) } }),
}));
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  NonceSeatTakenError: class NonceSeatTakenError extends Error {},
  readDirectMintParams: async () => ({ paymentAddress: 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm' }),
  computeNetMint: (drops: bigint) => ({ supplyUBA: drops - BigInt(1000) }),
  // The builder stamps the window and hands it back; the signer honours it (the
  // mock signature below carries the same LastLedgerSequence).
  buildDirectMintHandoff: async (_p: unknown, input: { grossXrpDrops: bigint }) => ({
    xrplPayment: { TransactionType: 'Payment', Account: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', Destination: 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm', Amount: input.grossXrpDrops.toString(), LastLedgerSequence: 1000 },
    memoHex: 'FE' + '0'.repeat(82),
    userOpHash: '0x' + '1'.repeat(64),
    lastLedgerSequence: 1000,
  }),
}));

// El canal de ops es un efecto lateral de estas pruebas, no su objeto (it. 25).
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { _resetSubmissionJournal } from '../submissionJournal';

type Kind = 'withdraw' | 'put-to-work';

/** One client with exactly 1 XRP at the exchange and TWO pending requests of 1 XRP each. */
function doubleAskRun(order: [Kind, Kind]): DemoRun {
  const T0 = new Date(0).toISOString();
  return {
    runId: 'run1',
    seq: 1,
    label: 'Double spend',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: T0,
    poteAddress: '0x' + 'b'.repeat(40),
    registryAddress: '0x' + '0'.repeat(40), // no on-chain gate to read
    clients: [{ id: 'c1', runId: 'run1', label: 'Client', tag: 101, kyc: 'none', xrplAddress: WALLET, passkeyAccount: PASSKEY, xrpOnExchangeDrops: '1000000', createdAt: T0 }],
    requests: order.map((kind, i) => ({ id: `rq${i + 1}`, kind, clientId: 'c1', drops: '1000000', status: 'pending' as const, createdAt: T0, updatedAt: T0 })),
    receipts: [],
    appliedTxHashes: [],
    provenDepositSenders: { c1: [WALLET] },
  } as unknown as DemoRun;
}

const ORIGINAL_DB = process.env.DATABASE_URL;
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://available-test';
});
afterAll(() => {
  if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB;
});

beforeEach(() => {
  kv.clear();
  _resetSubmissionJournal();
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockLookup.mockReset();
  hashCounter = 0;
  // Every signature is a distinct payment: a second call would be a second payout.
  mockSign.mockImplementation(async () => {
    hashCounter++;
    const hash = String(hashCounter).repeat(64).slice(0, 64);
    return { txBlob: `BLOB_${hashCounter}`, hash, lastLedgerSequence: 1000, submittedAtLedger: 980 };
  });
});

describe('withdraw X + put-to-work X with X at the exchange', () => {
  it.each([
    [['withdraw', 'put-to-work'] as [Kind, Kind]],
    [['put-to-work', 'withdraw'] as [Kind, Kind]],
  ])('%j — the first submit throws → exactly ONE signature, and it is the EXIT', async (order) => {
    const autopilot = new DemoExchangeAutopilot();
    const live = doubleAskRun(order);
    runsToServe = [live];
    mockSubmit.mockRejectedValue(new Error('socket hang up'));

    // it. 27 — EL ORDEN DE LA COLA YA NO DECIDE QUIÉN COBRA. Antes esto era FIFO
    // puro: con `['put-to-work','withdraw']` se firmaba la ENTRADA y la retirada
    // de su dueño quedaba detrás hasta morir en `INSUFFICIENT_LEDGER_BALANCE`.
    // La reserva es asimétrica desde esta iteración: una entrada meramente
    // pendiente —sin hash, sin asiento, sin blob— no retiene la salida de su
    // dueño, y una salida pendiente sí retiene la entrada, esté donde esté en la
    // cola. Sale la misma cantidad de firmas que antes (UNA); lo que cambia es
    // cuál. Y como la asimetría es total, no hay bloqueo mutuo posible.
    const exit = live.requests!.findIndex((r) => r.kind === 'withdraw');
    const entry = live.requests!.findIndex((r) => r.kind === 'put-to-work');

    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(live.requests![exit].status).toBe('submitting');
    expect(live.requests![entry].status).toBe('pending');
    expect(live.requests![entry].reason).toMatch(/^INSUFFICIENT_AVAILABLE_BALANCE/);

    // Next tick: the payout is still in flight — still one signature.
    mockLookup.mockResolvedValue({ lookup: { kind: 'not-found', searchedAll: false }, validatedLedgerIndex: 990 });
    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(live.requests![entry].status).toBe('pending');

    // The ledger settles the payout: the balance is debited; the entry can never be paid.
    mockLookup.mockResolvedValue({ lookup: { kind: 'validated', result: 'tesSUCCESS' }, validatedLedgerIndex: 995 });
    await autopilot.tick();
    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(live.clients[0].xrpOnExchangeDrops).toBe('0');
    expect(live.requests![entry].status).toBe('pending');
    expect(live.requests![entry].reason).toMatch(/^INSUFFICIENT_LEDGER_BALANCE/);
  });

  /**
   * it. 27 — UNA ENTRADA MUERTA NO RETIENE LA SALIDA DE SU DUEÑO (el autopiloto).
   *
   * El caso real: alguien deposita, el autopiloto le fabrica una put-to-work que
   * muere porque todavía no ha creado su cuenta Flare, y esa petición se queda
   * `pending` indefinidamente. Antes reservaba el saldo entero y la retirada que
   * llegaba detrás se quedaba con `INSUFFICIENT_AVAILABLE_BALANCE` para siempre:
   * el servidor decía que su dinero estaba «reservado por pagos en vuelo» cuando
   * no se había firmado nada nunca.
   */
  it('una put-to-work MUERTA (sin cuenta Flare) no impide que su due\u00f1o cobre', async () => {
    const autopilot = new DemoExchangeAutopilot();
    const live = doubleAskRun(['put-to-work', 'withdraw']);
    live.clients[0].passkeyAccount = undefined; // la entrada no puede firmarse: NO_CLIENT_ACCOUNT
    const exitRequest = live.requests!.pop()!; // todavía no ha pedido salir
    runsToServe = [live];
    mockSubmit.mockResolvedValue({ result: 'tesSUCCESS' });

    // Primero muere la entrada, sola, y se queda pendiente para siempre.
    await autopilot.tick();
    expect(mockSign).not.toHaveBeenCalled();
    expect(live.requests![0].status).toBe('pending');
    expect(live.requests![0].reason).toMatch(/^NO_CLIENT_ACCOUNT/);

    // Ahora su dueño pide su dinero. La entrada muerta no lo retiene.
    live.requests!.push(exitRequest);
    await autopilot.tick();

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(live.requests![1].status).toBe('done');
    expect(live.clients[0].xrpOnExchangeDrops).toBe('0');
    // Y la entrada sigue ahí, pendiente, sin haber firmado jamás nada.
    expect(live.requests![0].status).toBe('pending');
  });

  it('a desk payout handed to Xaman reserves the balance: the autopilot does not sign the same XRP', async () => {
    const autopilot = new DemoExchangeAutopilot();
    const live = doubleAskRun(['withdraw', 'put-to-work']);
    live.requests = [live.requests![0]];
    live.deskPayments = [{ id: 'dp1', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'signed', txHash: 'D'.repeat(64), createdAt: live.createdAt, updatedAt: live.createdAt }];
    runsToServe = [live];
    await autopilot.tick();
    expect(mockSign).not.toHaveBeenCalled();
    expect(live.requests![0].reason).toMatch(/^INSUFFICIENT_AVAILABLE_BALANCE/);
  });

  it('it. 8: a receipt of the SAME hash booked to another client is not this client\'s debit (finishSubmission matches the client)', async () => {
    const autopilot = new DemoExchangeAutopilot();
    const live = doubleAskRun(['withdraw', 'put-to-work']);
    live.requests = [live.requests![0]];
    live.clients[0].xrpOnExchangeDrops = '2000000';
    live.clients.push({ id: 'c2', runId: 'run1', label: 'Other', tag: 102, kyc: 'none', xrpOnExchangeDrops: '0', createdAt: live.createdAt });
    // the first signature will be hash '1…1'; a stale E8 of that hash sits on client c2
    live.receipts = [{ id: 'rc_other', runId: 'run1', clientId: 'c2', step: 'E8_WITHDRAW', chain: 'xrpl', txHash: '1'.repeat(64), at: live.createdAt, checks: [] }];
    runsToServe = [live];
    mockSubmit.mockResolvedValue({ result: 'tesSUCCESS' });
    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(live.clients[0].xrpOnExchangeDrops).toBe('1000000');
    expect(live.receipts.filter((r) => r.step === 'E8_WITHDRAW' && r.clientId === 'c1')).toHaveLength(1);
  });

  it('with enough for both, both are served (the reserve is not a queue jam)', async () => {
    const autopilot = new DemoExchangeAutopilot();
    const live = doubleAskRun(['withdraw', 'put-to-work']);
    live.clients[0].xrpOnExchangeDrops = '2000000';
    runsToServe = [live];
    mockSubmit.mockResolvedValue({ result: 'tesSUCCESS' });
    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(2);
    expect(live.clients[0].xrpOnExchangeDrops).toBe('0');
  });
});

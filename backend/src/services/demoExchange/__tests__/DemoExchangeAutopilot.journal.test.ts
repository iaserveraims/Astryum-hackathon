/**
 * The omnibus key never signs the same request twice — even when a concurrent
 * save of the run (public /verify, /omnibus) puts a signed request back to
 * 'pending' (productizer cycle, iteration 3). The durable submission journal
 * holds what was signed; the ledger decides what happened to it; and only a
 * payment the ledger proves dead is signed again.
 */
import type { DemoRun } from '../DemoExchangeStore';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const HASH_1 = 'A'.repeat(64);
const HASH_2 = 'B'.repeat(64);

let runsToServe: DemoRun[] = [];
const kv = new Map<string, Record<string, unknown>>();

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockLookup = jest.fn();
const mockRecordSpend = jest.fn(async () => undefined);

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
    // The tick serves each run from a fresh load inside its lock; here the load
    // hands back the very object the test inspects.
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
  recordSpend: (...a: unknown[]) => mockRecordSpend(...(a as [])),
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
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  readDirectMintParams: async () => {
    throw new Error('no Flare in this test');
  },
}));

// El canal de ops es un efecto lateral de estas pruebas, no su objeto (it. 25).
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { _resetSubmissionJournal } from '../submissionJournal';

/** A withdraw of 1 XRP, pending, by a client whose wallet the watcher proved. */
function pendingWithdrawRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Journal test',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: new Date(0).toISOString(),
    clients: [{ id: 'c1', runId: 'run1', label: 'Client', tag: 101, kyc: 'none', xrplAddress: WALLET, xrpOnExchangeDrops: '5000000', createdAt: new Date(0).toISOString() }],
    requests: [{ id: 'rq1', kind: 'withdraw', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }],
    receipts: [],
    appliedTxHashes: [],
    provenDepositSenders: { c1: [WALLET] },
  } as unknown as DemoRun;
}

const signed = (hash: string) => ({ txBlob: `BLOB_${hash.slice(0, 4)}`, hash, lastLedgerSequence: 1000, submittedAtLedger: 980 });
const withdrawReceipts = (run: DemoRun) => run.receipts.filter((r) => r.step === 'E8_WITHDRAW');

// The journal goes through the database path (kv mocked above).
const ORIGINAL_DB = process.env.DATABASE_URL;
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://journal-test';
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
  mockRecordSpend.mockClear();
});

describe('DemoExchangeAutopilot + submission journal', () => {
  it('a concurrent save that reverts a signed request to pending does NOT produce a second signature', async () => {
    const autopilot = new DemoExchangeAutopilot();
    const snapshot = pendingWithdrawRun(); // what /verify loaded BEFORE the autopilot signed

    // Tick 1: signed and journaled; the submit answer is lost.
    const live = pendingWithdrawRun();
    runsToServe = [live];
    mockSign.mockResolvedValueOnce(signed(HASH_1));
    mockSubmit.mockRejectedValueOnce(new Error('socket hang up'));
    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(live.requests?.[0].status).toBe('submitting');

    // /verify saves its stale copy whole: the request is 'pending' again, no
    // hash. And the process restarted: only the database remembers the signature.
    runsToServe = [snapshot];
    _resetSubmissionJournal();
    mockLookup.mockResolvedValue({ lookup: { kind: 'validated', result: 'tesSUCCESS' }, validatedLedgerIndex: 990 });
    await autopilot.tick();

    expect(mockSign).toHaveBeenCalledTimes(1); // never signed again
    const req = snapshot.requests?.[0];
    expect(req?.status).toBe('done');
    expect(req?.txHash).toBe(HASH_1);
    expect(snapshot.clients[0].xrpOnExchangeDrops).toBe('4000000'); // debited once
    expect(withdrawReceipts(snapshot)).toHaveLength(1);
  });

  it('a settled payment the run forgot is finished from the journal — no signature, no double debit', async () => {
    const autopilot = new DemoExchangeAutopilot();
    const live = pendingWithdrawRun();
    runsToServe = [live];
    mockSign.mockResolvedValueOnce(signed(HASH_1));
    mockSubmit.mockResolvedValueOnce({ result: 'tesSUCCESS' });
    await autopilot.tick();
    expect(live.requests?.[0].status).toBe('done');
    expect(live.clients[0].xrpOnExchangeDrops).toBe('4000000');

    // A stale whole-run save wipes the bookkeeping; the journal says 'settled'.
    const stale = pendingWithdrawRun();
    runsToServe = [stale];
    await autopilot.tick();

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockLookup).not.toHaveBeenCalled();
    expect(stale.requests?.[0].status).toBe('done');
    expect(stale.clients[0].xrpOnExchangeDrops).toBe('4000000');
    expect(withdrawReceipts(stale)).toHaveLength(1);
  });

  it('a payment the ledger proves dead IS signed again — the journal never jams the queue', async () => {
    const autopilot = new DemoExchangeAutopilot();
    const live = pendingWithdrawRun();
    runsToServe = [live];

    mockSign.mockResolvedValueOnce(signed(HASH_1));
    mockSubmit.mockRejectedValueOnce(new Error('socket hang up'));
    await autopilot.tick();
    expect(live.requests?.[0].status).toBe('submitting');

    // Full range searched, validated ledger past LastLedgerSequence → expired.
    mockLookup.mockResolvedValueOnce({ lookup: { kind: 'not-found', searchedAll: true }, validatedLedgerIndex: 1001 });
    await autopilot.tick();
    expect(live.requests?.[0].status).toBe('pending');
    expect(mockSign).toHaveBeenCalledTimes(1);

    mockSign.mockResolvedValueOnce(signed(HASH_2));
    mockSubmit.mockResolvedValueOnce({ result: 'tesSUCCESS' });
    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(2);
    expect(live.requests?.[0].status).toBe('done');
    expect(live.requests?.[0].txHash).toBe(HASH_2);
    expect(live.clients[0].xrpOnExchangeDrops).toBe('4000000');
  });

  it('a journal that cannot be READ is not «never signed»: no signature, the request waits with JOURNAL_UNREADABLE', async () => {
    // After a restart the in-process copy is empty; a database hiccup used to
    // read as «no entry» and authorise a second signature.
    const { kvGetStrict } = jest.requireMock('../../persistence/backgroundJobKv') as { kvGetStrict: jest.Mock };
    kvGetStrict.mockRejectedValueOnce(new Error('connection terminated'));
    const autopilot = new DemoExchangeAutopilot();
    const live = pendingWithdrawRun();
    runsToServe = [live];
    await autopilot.tick();
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(live.requests?.[0].status).toBe('pending');
    expect(live.requests?.[0].reason).toMatch(/^JOURNAL_UNREADABLE/);

    // The database answers again: the request is served normally.
    mockSign.mockResolvedValueOnce(signed(HASH_1));
    mockSubmit.mockResolvedValueOnce({ result: 'tesSUCCESS' });
    await autopilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(live.requests?.[0].status).toBe('done');
  });

  it('if the journal is not verifiably in the database, nothing is submitted', async () => {
    // The real kvUpsert LOGS a database failure and returns — it never throws.
    const { kvUpsert } = jest.requireMock('../../persistence/backgroundJobKv') as { kvUpsert: jest.Mock };
    kvUpsert.mockImplementationOnce(async () => undefined);
    const autopilot = new DemoExchangeAutopilot();
    const live = pendingWithdrawRun();
    runsToServe = [live];
    mockSign.mockResolvedValueOnce(signed(HASH_1));
    await autopilot.tick();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(live.requests?.[0].status).toBe('pending');
  });
});

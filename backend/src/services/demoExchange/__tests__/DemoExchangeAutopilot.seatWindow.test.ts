/**
 * The autopilot's 0xFE and its nonce seat bound the SAME ledgers, and the seat is
 * never declared signed before the run says so (R1 1.1/1.5):
 *
 *  · the builder is asked for a LastLedgerSequence (`lastLedgerWindow`) and the
 *    payment that gets signed carries exactly the one it handed back — a seat
 *    that expires by a clock while the payment is still signable is how a twin
 *    was composed and both were signed;
 *  · without a readable ledger nothing is signed and the seat is freed;
 *  · `persistSubmission` saves the RUN before marking the seat signed: a failed
 *    save must never leave a 'signed' seat holding a blob that was never sent.
 */
import type { DemoRun } from '../DemoExchangeStore';
// Esta suite prueba OTRAS reglas y no tiene ledger: el KYC al ejecutar
// se prueba en DemoExchangeAutopilot.kycAtFulfil.test.
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const CORE_VAULT = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
const MEMO = 'FE' + '0'.repeat(82);
const T0 = new Date(0).toISOString();

let runsToServe: DemoRun[] = [];
const kv = new Map<string, Record<string, unknown>>();
/** What the builder mock hands back as its window (null = the ledger could not be read). */
let handoffLls: number | null = 1000;
const buildCalls: Array<Record<string, unknown>> = [];

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockLookup = jest.fn();
const mockSaveRun = jest.fn(async () => undefined);
const mockMarkSigned = jest.fn(async () => true);
const mockReleaseQueued = jest.fn(async () => true);

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
    saveRun: (...a: unknown[]) => mockSaveRun(...(a as [])),
  };
});

jest.mock('../DemoExchangeSync', () => ({
  syncOmnibus: jest.fn(async () => ({ credited: [] })),
  makeReceipt: (_run: unknown, r: Record<string, unknown>) => ({ id: `rc_${Math.random().toString(36).slice(2)}`, ...r }),
}));

jest.mock('../DemoExchangeSigner', () => ({
  readSignerConfig: () => ({ enabled: true, address: OMNIBUS, seedPresent: true, maxTxDrops: '10000000', dailyCapDrops: '100000000', attribution: 'operational' }),
  assessPayment: () => ({ ok: true }),
  readOmnibusAppointment: async () => null,
  spentToday: async () => BigInt(0),
  sweepStaleReservations: async () => [],
  recordSpend: async () => undefined,
  // The spend is RESERVED before the blob leaves and given
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
  markHandoffSignedByMemo: (...a: unknown[]) => mockMarkSigned(...(a as [])),
  markHandoffParkedByUserOpHash: jest.fn(async () => true),
  releaseQueuedHandoffByMemo: (...a: unknown[]) => mockReleaseQueued(...(a as [])),
}));
jest.mock('../../flare/AstryumPoteStateService', () => ({
  readPoteState: async () => ({ asset: { address: '0x' + 'a'.repeat(40) } }),
}));
jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => ({
  NonceSeatTakenError: class NonceSeatTakenError extends Error {},
  readDirectMintParams: async () => ({ paymentAddress: CORE_VAULT }),
  computeNetMint: (drops: bigint) => ({ supplyUBA: drops - BigInt(1000) }),
  buildDirectMintHandoff: async (_p: unknown, input: Record<string, unknown>) => {
    buildCalls.push(input);
    return {
      xrplPayment: {
        TransactionType: 'Payment',
        Account: OMNIBUS,
        Destination: CORE_VAULT,
        Amount: String(input.grossXrpDrops),
        ...(handoffLls === null ? {} : { LastLedgerSequence: handoffLls }),
      },
      memoHex: MEMO,
      userOpHash: '0x' + '1'.repeat(64),
      lastLedgerSequence: handoffLls,
    };
  },
}));

// El canal de ops es un efecto lateral de estas pruebas, no su objeto.
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { _resetSubmissionJournal } from '../submissionJournal';

/** One client with 1 XRP at the exchange asking to put it to work. */
function putToWorkRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Seat window',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: T0,
    poteAddress: '0x' + 'b'.repeat(40),
    registryAddress: '0x' + '0'.repeat(40), // no on-chain gate to read
    clients: [{ id: 'c1', runId: 'run1', label: 'Client', tag: 101, kyc: 'none', passkeyAccount: PASSKEY, xrpOnExchangeDrops: '1000000', createdAt: T0 }],
    requests: [{ id: 'rq1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'pending', createdAt: T0, updatedAt: T0 }],
    receipts: [],
    appliedTxHashes: [],
  } as unknown as DemoRun;
}

const ORIGINAL_DB = process.env.DATABASE_URL;
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://seat-window-test';
});
afterAll(() => {
  if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB;
});

beforeEach(() => {
  kv.clear();
  _resetSubmissionJournal();
  buildCalls.length = 0;
  handoffLls = 1000;
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockLookup.mockReset();
  mockSaveRun.mockReset();
  mockSaveRun.mockResolvedValue(undefined);
  mockMarkSigned.mockReset();
  mockMarkSigned.mockResolvedValue(true);
  mockReleaseQueued.mockReset();
  mockReleaseQueued.mockResolvedValue(true);
  mockSign.mockImplementation(async () => ({ txBlob: 'BLOB', hash: 'A'.repeat(64), lastLedgerSequence: handoffLls ?? 0, submittedAtLedger: 980 }));
  mockSubmit.mockResolvedValue({ result: 'tesSUCCESS' });
});

describe('the 0xFE of the autopilot and its nonce seat bound the same ledgers', () => {
  it('asks the builder for a window and signs the payment with the LastLedgerSequence it handed back', async () => {
    const live = putToWorkRun();
    runsToServe = [live];
    await new DemoExchangeAutopilot().tick();

    expect(buildCalls).toHaveLength(1);
    expect(typeof buildCalls[0].lastLedgerWindow).toBe('number');
    expect(Number(buildCalls[0].lastLedgerWindow)).toBeGreaterThan(0);
    expect(buildCalls[0].attribution).toBe('operational');
    expect(mockSign).toHaveBeenCalledTimes(1);
    const signedTx = mockSign.mock.calls[0][0] as Record<string, unknown>;
    expect(signedTx.LastLedgerSequence).toBe(1000);
    expect(mockSubmit).toHaveBeenCalledTimes(1);
  });

  it('a 0xFE without a window (the ledger could not be read) is never signed, and its seat is freed', async () => {
    handoffLls = null;
    const live = putToWorkRun();
    runsToServe = [live];
    await new DemoExchangeAutopilot().tick();

    expect(mockSign).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    // This 0xFE is signed here with Astryum's own seed and never reached a
// wallet, so its seat is freed at once instead of waiting out the window.
expect(mockReleaseQueued).toHaveBeenCalledWith(MEMO, { neverHandedOut: true });
    expect(live.requests![0].status).toBe('pending');
    expect(live.requests![0].reason).toMatch(/^LEDGER_UNREADABLE/);
  });

  it('the seat is marked signed only AFTER the run is stored: a save that cannot be proven marks nothing and submits nothing', async () => {
    mockSaveRun.mockRejectedValue(new Error('P2028: transaction already closed'));
    const live = putToWorkRun();
    runsToServe = [live];
    await new DemoExchangeAutopilot().tick();

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockMarkSigned).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('with the run stored, the seat is marked signed with the hash that was submitted', async () => {
    const live = putToWorkRun();
    runsToServe = [live];
    await new DemoExchangeAutopilot().tick();

    expect(mockMarkSigned).toHaveBeenCalledWith(MEMO, 'A'.repeat(64));
    // …and never before the run: the save of the submission comes first.
    expect(mockSaveRun.mock.invocationCallOrder[0]).toBeLessThan(mockMarkSigned.mock.invocationCallOrder[0]);
  });
});

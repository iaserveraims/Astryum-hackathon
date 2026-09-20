/**
 * El KYC de la casilla se relee AL EJECUTAR, no solo al pedir.
 *
 * El gate de las rutas mira la credencial cuando el cliente pide «poner a
 * trabajar»; el autopilot firma ticks después. Si entre medias la credencial
 * caducó o se revocó, la llave del omnibus firmaba igual. Lo que se fija:
 *  - sin la credencial de su casilla, el put-to-work se rehúsa FINAL y nada se
 *    firma (final para liberar la reserva: una petición colgada reservaría saldo
 *    y podría estorbar una retirada);
 *  - **una retirada se firma igual sin credencial** — la salida jamás se gatea;
 *  - con `KYC-<tag>` vigente, se firma;
 *  - con el ledger ilegible, la petición espera (pendiente), ni se firma ni se
 *    rehúsa: «no pude leer» no es «no la tiene».
 */
import type { DemoRun } from '../DemoExchangeStore';

const ROOT = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const WALLET = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
const T0 = new Date(0).toISOString();
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

let runsToServe: DemoRun[] = [];
const kv = new Map<string, Record<string, unknown>>();
let credentials: Array<Record<string, unknown>> = [];
let readThrows: string | null = null;

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockLookup = jest.fn();
const mockRead = jest.fn(async (account: string) => {
  if (readThrows) throw new Error(readThrows);
  return { account, credentials, hasAcceptedValidCredential: false, issuerAllowlistConfigured: false, readAtISO: T0 };
});

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
  // The spend is RESERVED before the blob leaves and given
  // back when the ledger proves the payment never entered.
  reserveSpend: async () => undefined,
  releaseSpend: async () => undefined,
  signAndSubmit: jest.fn(),
  signForSubmission: (...a: unknown[]) => mockSign(...a),
  submitSignedBlob: (...a: unknown[]) => mockSubmit(...a),
  lookupSubmission: (...a: unknown[]) => mockLookup(...a),
}));

jest.mock('../../XrplCredentialVerifier', () => ({
  readAccountCredentials: (...a: unknown[]) => mockRead(...(a as [string])),
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
  buildDirectMintHandoff: async (_p: unknown, input: { grossXrpDrops: bigint }) => ({
    xrplPayment: { TransactionType: 'Payment', Account: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', Destination: 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm', Amount: input.grossXrpDrops.toString(), LastLedgerSequence: 1000 },
    memoHex: 'FE' + '0'.repeat(82),
    userOpHash: '0x' + '1'.repeat(64),
    lastLedgerSequence: 1000,
  }),
}));

// El canal de ops es un efecto lateral de estas pruebas, no su objeto.
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { _resetSubmissionJournal } from '../submissionJournal';
import { clearClientCredentialCache } from '../clientCredentialGate';

/** La credencial de la casilla 101 tal como la lee el ledger sobre el omnibus. */
function kyc101(over: Record<string, unknown> = {}) {
  return {
    issuer: ROOT,
    subject: OMNIBUS,
    credentialType: 'KYC-101',
    credentialTypeHex: hex('KYC-101'),
    ledgerIndex: null,
    expiresAtISO: '2028-01-01T00:00:00.000Z',
    uri: null,
    accepted: true,
    state: 'valid',
    issuerAccepted: false,
    reserveHeldBy: 'subject',
    ...over,
  };
}

/** Un cliente con 1 XRP en el exchange y UNA petición pendiente del tipo dado. */
function runWith(kind: 'put-to-work' | 'withdraw'): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'KYC at fulfil',
    councilAddress: ROOT,
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: T0,
    poteAddress: '0x' + 'b'.repeat(40),
    registryAddress: '0x' + '0'.repeat(40), // sin puerta on-chain que leer
    clients: [{ id: 'c1', runId: 'run1', label: 'Client', tag: 101, kyc: 'none', xrplAddress: WALLET, passkeyAccount: PASSKEY, xrpOnExchangeDrops: '1000000', createdAt: T0 }],
    requests: [{ id: 'rq1', kind, clientId: 'c1', drops: '1000000', status: 'pending' as const, createdAt: T0, updatedAt: T0 }],
    receipts: [],
    appliedTxHashes: [],
    provenDepositSenders: { c1: [WALLET] },
  } as unknown as DemoRun;
}

const ORIGINAL = { db: process.env.DATABASE_URL, gate: process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL, accept: process.env.DEMO_EXCHANGE_AUTO_ACCEPT_KYC };
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://kyc-at-fulfil-test';
  // Este fichero mira el gate AL EJECUTAR; la aceptación automática del KYC
  // (que también lee las credenciales en cada tick) tiene su propio test.
  process.env.DEMO_EXCHANGE_AUTO_ACCEPT_KYC = 'false';
});
afterAll(() => {
  for (const [k, v] of [['DATABASE_URL', ORIGINAL.db], ['DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL', ORIGINAL.gate], ['DEMO_EXCHANGE_AUTO_ACCEPT_KYC', ORIGINAL.accept]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  delete process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL; // el defecto ES exigirla
  kv.clear();
  _resetSubmissionJournal();
  clearClientCredentialCache();
  credentials = [];
  readThrows = null;
  mockRead.mockClear();
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockLookup.mockReset();
  mockSign.mockImplementation(async () => ({ txBlob: 'BLOB', hash: 'A'.repeat(64), lastLedgerSequence: 1000, submittedAtLedger: 980 }));
  // Lo que se afirma es si la llave FIRMÓ (el gate la dejó pasar), no el envío.
  mockSubmit.mockRejectedValue(new Error('network down in test'));
  mockLookup.mockResolvedValue({ found: false });
});

async function tickOnce(kind: 'put-to-work' | 'withdraw') {
  const live = runWith(kind);
  runsToServe = [live];
  await new DemoExchangeAutopilot().tick();
  return live.requests![0];
}

describe('el autopilot relee el KYC de la casilla antes de firmar un put-to-work', () => {
  it('sin la credencial de su casilla: rehúsa FINAL y la llave no firma nada', async () => {
    const req = await tickOnce('put-to-work');
    expect(mockSign).not.toHaveBeenCalled();
    expect(req.status).toBe('refused');
    expect(req.reason).toMatch(/^CLIENT_NOT_CREDENTIALED/);
    expect(mockRead).toHaveBeenCalledWith(OMNIBUS, expect.anything());
  });

  it('con la credencial CADUCADA entre la petición y el tick: rehúsa, no firma', async () => {
    credentials = [kyc101({ state: 'expired' })];
    const req = await tickOnce('put-to-work');
    expect(mockSign).not.toHaveBeenCalled();
    expect(req.reason).toMatch(/^CLIENT_CREDENTIAL_EXPIRED/);
  });

  it('con KYC-101 vigente sobre el omnibus: la llave firma', async () => {
    credentials = [kyc101()];
    await tickOnce('put-to-work');
    expect(mockSign).toHaveBeenCalled();
  });

  it('ledger ilegible: la petición ESPERA — ni se firma ni se rehúsa', async () => {
    readThrows = 'websocket closed';
    const req = await tickOnce('put-to-work');
    expect(mockSign).not.toHaveBeenCalled();
    expect(req.status).toBe('pending');
    expect(req.reason).toMatch(/^CREDENTIALS_UNREADABLE/);
  });
});

describe('LA SALIDA NO SE GATEA — tampoco en el autopilot', () => {
  it('una retirada sin ninguna credencial se firma igual, y el gate ni se consulta', async () => {
    await tickOnce('withdraw');
    expect(mockSign).toHaveBeenCalled();
    expect(mockRead).not.toHaveBeenCalled();
  });
});

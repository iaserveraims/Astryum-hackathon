/**
 * El autopilot ACEPTA el KYC que la raíz ya emitió. La raíz firma UNA vez en Xaman; la caja acepta sola.
 *
 * Lo que se fija:
 *  - con `KYC-<tag>` EMITIDA por la raíz y sin aceptar: la llave del omnibus
 *    firma un CredentialAccept exacto (sin campos de más) y deja recibo;
 *  - vigente, ausente o de otro emisor: no firma nada;
 *  - una aceptación enviada no se repite en el tick siguiente aunque el ledger
 *    aún la lea pendiente;
 *  - gate apagado o `DEMO_EXCHANGE_AUTO_ACCEPT_KYC=false`: ni lee.
 */
import type { DemoRun } from '../DemoExchangeStore';

const ROOT = 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG';
const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const STRANGER = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const T0 = new Date(0).toISOString();
const hex = (s: string) => Buffer.from(s, 'utf8').toString('hex').toUpperCase();

let runsToServe: DemoRun[] = [];
let credentials: Array<Record<string, unknown>> = [];

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockSpentToday = jest.fn(async () => BigInt(0));
const mockRead = jest.fn(async (account: string) => ({ account, credentials, hasAcceptedValidCredential: false, issuerAllowlistConfigured: false, readAtISO: T0 }));

jest.mock('../../persistence/backgroundJobKv', () => ({
  kvGet: jest.fn(async () => null),
  kvGetStrict: jest.fn(async () => null),
  kvUpsert: jest.fn(async () => undefined),
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
  readSignerConfig: () => ({ enabled: true, address: 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7', seedPresent: true, maxTxDrops: BigInt(10_000_000), dailyCapDrops: BigInt(100_000_000), attribution: 'operational' }),
  // La política REAL: lo que se prueba es qué deja firmar la puerta.
  assessCredentialAccept: jest.requireActual('../DemoExchangeSigner').assessCredentialAccept,
  assessPayment: () => ({ ok: true }),
  readOmnibusAppointment: async () => null,
  spentToday: (...a: unknown[]) => mockSpentToday(...(a as [])),
  sweepStaleReservations: async () => [],
  recordSpend: async () => undefined,
  // The spend is RESERVED before the blob leaves and given
  // back when the ledger proves the payment never entered.
  reserveSpend: async () => undefined,
  releaseSpend: async () => undefined,
  signForSubmission: (...a: unknown[]) => mockSign(...a),
  submitSignedBlob: (...a: unknown[]) => mockSubmit(...a),
  lookupSubmission: jest.fn(),
}));

jest.mock('../../XrplCredentialVerifier', () => ({
  readAccountCredentials: (...a: unknown[]) => mockRead(...(a as [string])),
}));
jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}) }));
jest.mock('../../ops/agentHeartbeats', () => ({ markAgentTick: () => undefined }));

// El canal de ops es un efecto lateral de estas pruebas, no su objeto.
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { clearClientCredentialCache } from '../clientCredentialGate';

function kyc101(over: Record<string, unknown> = {}) {
  return {
    issuer: ROOT,
    subject: OMNIBUS,
    credentialType: 'KYC-101',
    credentialTypeHex: hex('KYC-101'),
    ledgerIndex: null,
    expiresAtISO: '2028-01-01T00:00:00.000Z',
    uri: null,
    accepted: false,
    state: 'pending-acceptance',
    issuerAccepted: false,
    reserveHeldBy: 'issuer',
    ...over,
  };
}

function freshRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'KYC accept',
    councilAddress: ROOT,
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: T0,
    clients: [{ id: 'c1', runId: 'run1', label: 'Client', tag: 101, kyc: 'none', xrpOnExchangeDrops: '0', createdAt: T0 }],
    requests: [],
    receipts: [],
    appliedTxHashes: [],
  } as unknown as DemoRun;
}

const ORIGINAL = { gate: process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL, accept: process.env.DEMO_EXCHANGE_AUTO_ACCEPT_KYC };
afterAll(() => {
  for (const [k, v] of [['DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL', ORIGINAL.gate], ['DEMO_EXCHANGE_AUTO_ACCEPT_KYC', ORIGINAL.accept]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  delete process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL;
  delete process.env.DEMO_EXCHANGE_AUTO_ACCEPT_KYC;
  clearClientCredentialCache();
  credentials = [];
  mockRead.mockClear();
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockSpentToday.mockReset();
  mockSpentToday.mockResolvedValue(BigInt(0));
  (jest.requireMock('../../OpsAlertService') as { opsAlert: jest.Mock }).opsAlert.mockClear();
  mockSign.mockImplementation(async () => ({ txBlob: 'BLOB', hash: 'C'.repeat(64), lastLedgerSequence: 1000, submittedAtLedger: 980 }));
  mockSubmit.mockResolvedValue({ txHash: 'C'.repeat(64), result: 'tesSUCCESS', validated: true });
});

describe('el autopilot acepta el KYC de la casilla que la raíz emitió', () => {
  it('emitida por la raíz y pendiente: firma un CredentialAccept exacto y deja recibo E3_CREDENTIAL', async () => {
    credentials = [kyc101()];
    const run = freshRun();
    runsToServe = [run];
    await new DemoExchangeAutopilot().tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(mockSign).toHaveBeenCalledWith({ TransactionType: 'CredentialAccept', Account: OMNIBUS, Issuer: ROOT, CredentialType: hex('KYC-101') });
    const receipt = run.receipts.find((r) => r.step === 'E3_CREDENTIAL');
    expect(receipt).toMatchObject({ chain: 'xrpl', txHash: 'C'.repeat(64), clientId: 'c1' });
  });

  it('una aceptación enviada no se repite en el tick siguiente aunque el ledger aún la lea pendiente', async () => {
    credentials = [kyc101()];
    runsToServe = [freshRun()];
    const pilot = new DemoExchangeAutopilot();
    await pilot.tick();
    clearClientCredentialCache();
    runsToServe = [freshRun()];
    await pilot.tick();
    expect(mockSign).toHaveBeenCalledTimes(1);
  });

  it('ya vigente: no firma nada', async () => {
    credentials = [kyc101({ accepted: true, state: 'valid', reserveHeldBy: 'subject' })];
    runsToServe = [freshRun()];
    await new DemoExchangeAutopilot().tick();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('sin credencial emitida: no firma nada (emitir es de la raíz, jamás de la caja)', async () => {
    runsToServe = [freshRun()];
    await new DemoExchangeAutopilot().tick();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('pendiente pero emitida por OTRO: no es la de la casilla, no firma', async () => {
    credentials = [kyc101({ issuer: STRANGER })];
    runsToServe = [freshRun()];
    await new DemoExchangeAutopilot().tick();
    expect(mockSign).not.toHaveBeenCalled();
  });

  /**
   * EL RADIO DE LA OPERATIVA PROPIA CUANDO EL TOPE ES ILEGIBLE.
   * Aceptar cuesta reserva del ledger y es un acto de NUESTRA caja. Sin poder
   * leer el libro del día no hay ninguna cota sobre lo que esta llave gasta —ni
   * de importe ni de número de firmas, así que no gasta, y se avisa por el
   * canal de ops (el recibo viviría en la misma base que acaba de fallar).
   * Ninguna salida de cliente pasa por aquí ni se detiene por esto.
   */
  it('con el libro de gasto ILEGIBLE la caja no acepta nada este tick, y suena el canal de ops', async () => {
    mockSpentToday.mockRejectedValue(new Error('P1001 database unreachable'));
    credentials = [kyc101()];
    runsToServe = [freshRun()];

    await new DemoExchangeAutopilot().tick();

    expect(mockSign).not.toHaveBeenCalled();
    const { opsAlert } = jest.requireMock('../../OpsAlertService') as { opsAlert: jest.Mock };
    expect(opsAlert.mock.calls.some((c) => /holds ALL of its own operation/.test(String(c[2])))).toBe(true);
  });

  it('con DEMO_EXCHANGE_AUTO_ACCEPT_KYC=false o con el gate apagado: ni lee el ledger', async () => {
    credentials = [kyc101()];
    process.env.DEMO_EXCHANGE_AUTO_ACCEPT_KYC = 'false';
    runsToServe = [freshRun()];
    await new DemoExchangeAutopilot().tick();
    delete process.env.DEMO_EXCHANGE_AUTO_ACCEPT_KYC;
    process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';
    runsToServe = [freshRun()];
    await new DemoExchangeAutopilot().tick();
    expect(mockRead).not.toHaveBeenCalled();
    expect(mockSign).not.toHaveBeenCalled();
  });
});

/**
 * productizer it. 19 (R1 1.1) — EL GEMELO QUE ENCENDIÓ NUESTRO PROPIO ARREGLO.
 *
 * La mesa compone su put-to-work sin `preparedByProven` (el fundador no prueba
 * el omnibus con su sesión: lo firma en Xaman), así que su fila quedaba marcada
 * «de quien no prueba». Desde la it. 17, el autopilot —flujo servidor de una
 * cuenta operativa— aparta SOLA cualquier fila así, sin 409 y sin aviso. Con la
 * run declarada, eso significaba: la mesa entrega un Payment a Xaman, el tick
 * siguiente lo desplaza, compone OTRO en el mismo nonce, y los dos son
 * firmables. Pago doble con la llave del omnibus, con el XRP del cliente ya en
 * el Core Vault.
 *
 * Lo que se fija aquí:
 *  1. el tick declara `serverComposed: true`, igual que la mesa — ninguna de las
 *     dos composiciones del servidor puede desplazar a la otra;
 *  2. con la fila de la mesa viva, el tick ESPERA: no firma, no envía, la
 *     petición sigue pendiente con su motivo, y la reserva de la mesa (su memo y
 *     su ventana) queda intacta.
 *
 * La regla del asiento vive en el constructor (`buildDirectMintHandoff`); aquí
 * se refleja como CONTRATO en el mock: una fila compuesta por el servidor es
 * titular del asiento y nadie la aparta automáticamente.
 */
import type { DemoRun } from '../DemoExchangeStore';
// Esta suite prueba OTRAS reglas y no tiene ledger: el KYC al ejecutar (14-sep)
// se prueba en DemoExchangeAutopilot.kycAtFulfil.test.
process.env.DEMO_EXCHANGE_REQUIRE_CLIENT_CREDENTIAL = 'false';

const OMNIBUS = 'rLcoFM9XF8CL5GoFyMACguhdnDtwkNYDn7';
const CORE_VAULT = 'rK4tsuGhmbhaNQuvucL8n1RKLtARBCp3qm';
const PASSKEY = '0x4011015268644de37061D6C9b734b1738A8933C8';
/** El memo del 0xFE que la MESA dejó abierto en Xaman. */
const DESK_MEMO = 'FE' + 'DE'.repeat(41);
/** El que compondría el autopilot si el asiento estuviera libre. */
const AUTOPILOT_MEMO = 'FE' + 'A0'.repeat(41);
const T0 = new Date(0).toISOString();

/** El asiento PA+nonce del omnibus, tal y como lo lleva el constructor. */
interface SeatRow {
  memoHex: string;
  serverComposed: boolean;
  preparedByProven: boolean;
}
let seat: SeatRow[] = [];
const buildCalls: Array<Record<string, unknown>> = [];
const kv = new Map<string, Record<string, unknown>>();

const mockSign = jest.fn();
const mockSubmit = jest.fn();
const mockSaveRun = jest.fn(async () => undefined);
let runsToServe: DemoRun[] = [];

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
  // it. 23 (1.4): the spend is RESERVED before the blob leaves and given
  // back when the ledger proves the payment never entered.
  reserveSpend: async () => undefined,
  releaseSpend: async () => undefined,
  signAndSubmit: jest.fn(),
  signForSubmission: (...a: unknown[]) => mockSign(...a),
  submitSignedBlob: (...a: unknown[]) => mockSubmit(...a),
  lookupSubmission: jest.fn(),
}));

jest.mock('../DemoRunVerifier', () => ({ flareProvider: () => ({}) }));
jest.mock('../../ops/agentHeartbeats', () => ({ markAgentTick: () => undefined }));
jest.mock('../../flare/DirectMintHandoffStore', () => ({
  markHandoffSignedByMemo: jest.fn(async () => true),
  markHandoffParkedByUserOpHash: jest.fn(async () => true),
  releaseQueuedHandoffByMemo: jest.fn(async () => true),
}));
jest.mock('../../flare/AstryumPoteStateService', () => ({
  readPoteState: async () => ({ asset: { address: '0x' + 'a'.repeat(40) } }),
}));

jest.mock('../../../connectors/protocols/flare/FlareDirectMintService', () => {
  class NonceSeatTakenError extends Error {}
  return {
    NonceSeatTakenError,
    readDirectMintParams: async () => ({ paymentAddress: CORE_VAULT }),
    computeNetMint: (drops: bigint) => ({ supplyUBA: drops - BigInt(1000) }),
    /**
     * El CONTRATO del asiento que fija la it. 19: quien compone desde un flujo
     * servidor de una cuenta operativa puede apartar el borrador de un extraño,
     * pero JAMÁS una fila que el propio servidor compuso (`serverComposed`) —
     * esa sigue viva en el Xaman de alguien. Si queda titular, 409.
     */
    buildDirectMintHandoff: async (_p: unknown, input: Record<string, unknown>) => {
      buildCalls.push(input);
      const ownServerFlow = input.serverComposed === true || input.preparedByProven === true;
      const holders = seat.filter((row) => !(ownServerFlow && !row.serverComposed && !row.preparedByProven));
      if (holders.length > 0) {
        throw new NonceSeatTakenError(`NONCE_SEAT_TAKEN: ${holders.map((h) => h.memoHex.slice(0, 10)).join(', ')}`);
      }
      seat = [{ memoHex: AUTOPILOT_MEMO, serverComposed: input.serverComposed === true, preparedByProven: input.preparedByProven === true }];
      return {
        xrplPayment: {
          TransactionType: 'Payment',
          Account: OMNIBUS,
          Destination: CORE_VAULT,
          Amount: String(input.grossXrpDrops),
          LastLedgerSequence: 1090,
        },
        memoHex: AUTOPILOT_MEMO,
        userOpHash: '0x' + '1'.repeat(64),
        lastLedgerSequence: 1090,
      };
    },
  };
});

// El canal de ops es un efecto lateral de estas pruebas, no su objeto (it. 25).
jest.mock('../../OpsAlertService', () => ({ opsAlert: jest.fn(async () => undefined) }));
// it. 34 — el paso 0 del tick lee el ledger validado (`currentValidatedLedgerIndex`)
// en cuanto hay una reserva de mesa `prepared` con LLS — que es exactamente el
// fixture de esta suite. Sin este mock, cada `tick()` golpeaba un nodo XRPL
// público (la suite era flaky desde la it. 31: «WS fallback falló: rate limit»).
// Un índice ANTERIOR al LLS de la reserva (1090): nada que barrer, la reserva
// sigue viva, que es lo que esta suite afirma.
jest.mock('../OmnibusWatcher', () => ({ currentValidatedLedgerIndex: jest.fn(async () => 1050) }));

import { DemoExchangeAutopilot } from '../DemoExchangeAutopilot';
import { _resetSubmissionJournal } from '../submissionJournal';

/**
 * Una toma con DOS clientes: la mesa compone para Ada y el autopilot atiende la
 * petición de Bo. El asiento de nonce es de la Personal Account del OMNIBUS, así
 * que lo comparten los dos — que es exactamente por dónde entra el gemelo (un
 * segundo 0xFE del mismo cliente ya lo para la reserva de saldo disponible).
 */
function putToWorkRun(): DemoRun {
  return {
    runId: 'run1',
    seq: 1,
    label: 'Twin seat',
    councilAddress: 'r1ypgoqtdQG71bMK7g2KdjReekZH1MuoG',
    omnibusAddress: OMNIBUS,
    policy: 'A',
    status: 'open',
    autopilot: true,
    createdAt: T0,
    poteAddress: '0x' + 'b'.repeat(40),
    registryAddress: '0x' + '0'.repeat(40),
    clients: [
      { id: 'c1', runId: 'run1', label: 'Ada', tag: 101, kyc: 'none', passkeyAccount: PASSKEY, xrpOnExchangeDrops: '1000000', createdAt: T0 },
      { id: 'c2', runId: 'run1', label: 'Bo', tag: 102, kyc: 'none', passkeyAccount: PASSKEY, xrpOnExchangeDrops: '1000000', createdAt: T0 },
    ],
    requests: [{ id: 'rq1', kind: 'put-to-work', clientId: 'c2', drops: '1000000', status: 'pending', createdAt: T0, updatedAt: T0 }],
    receipts: [],
    appliedTxHashes: [],
  } as unknown as DemoRun;
}

/** Lo que la MESA deja tras componer para Ada: su reserva con memo y ventana, y el asiento tomado. */
function deskComposes(run: DemoRun): void {
  (run as unknown as { deskPayments: unknown[] }).deskPayments = [
    { id: 'dp1', kind: 'put-to-work', clientId: 'c1', drops: '1000000', status: 'prepared', memoHex: DESK_MEMO, userOpHash: '0x' + '9'.repeat(64), lastLedgerSequence: 1090, createdAtLedger: 1000, createdAt: T0, updatedAt: T0 },
  ];
  // La fila de la mesa: compuesta POR EL SERVIDOR, sin prueba de sesión.
  seat = [{ memoHex: DESK_MEMO, serverComposed: true, preparedByProven: false }];
}

const ORIGINAL_DB = process.env.DATABASE_URL;
beforeAll(() => { process.env.DATABASE_URL = 'postgres://twin-seat-test'; });
afterAll(() => {
  if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB;
});

beforeEach(() => {
  kv.clear();
  _resetSubmissionJournal();
  buildCalls.length = 0;
  seat = [];
  runsToServe = [];
  mockSign.mockReset();
  mockSubmit.mockReset();
  mockSaveRun.mockReset();
  mockSaveRun.mockResolvedValue(undefined);
  mockSign.mockImplementation(async () => ({ txBlob: 'BLOB', hash: 'A'.repeat(64), lastLedgerSequence: 1090, submittedAtLedger: 1000 }));
  mockSubmit.mockResolvedValue({ result: 'tesSUCCESS' });
});

describe('el 0xFE del autopilot se declara compuesto por el servidor', () => {
  it('pasa serverComposed: true — sin eso, apartaría la fila de la mesa en silencio', async () => {
    const live = putToWorkRun();
    runsToServe = [live];
    await new DemoExchangeAutopilot().tick();

    expect(buildCalls).toHaveLength(1);
    expect(buildCalls[0].serverComposed).toBe(true);
    expect(buildCalls[0].action).toBe('demo-exchange-autopilot');
    expect(buildCalls[0].attribution).toBe('operational');
  });
});

describe('el gemelo: la mesa compone → el autopilot NO la aparta', () => {
  it('con el 0xFE de la mesa vivo, el tick espera: no firma, no envía y la reserva queda intacta', async () => {
    const live = putToWorkRun();
    deskComposes(live);
    runsToServe = [live];

    await new DemoExchangeAutopilot().tick();

    // Se intentó componer, y el asiento contestó que no.
    expect(buildCalls).toHaveLength(1);
    expect(buildCalls[0].serverComposed).toBe(true);
    // Nada firmado, nada enviado: no hay un segundo Payment firmable.
    expect(mockSign).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    // La fila de la MESA sigue siendo la titular del asiento, con su memo.
    expect(seat).toEqual([{ memoHex: DESK_MEMO, serverComposed: true, preparedByProven: false }]);
    const desk = (live as unknown as { deskPayments: Array<Record<string, unknown>> }).deskPayments[0];
    expect(desk).toMatchObject({ status: 'prepared', memoHex: DESK_MEMO, lastLedgerSequence: 1090 });
    // Y la petición del cliente sigue pendiente, con su motivo — no rechazada.
    expect(live.requests![0].status).toBe('pending');
    expect(live.requests![0].reason).toMatch(/NONCE_SEAT_TAKEN/);
  });

  it('el borrador de un EXTRAÑO (ni probado ni del servidor) sí se aparta: el tick sigue trabajando', async () => {
    const live = putToWorkRun();
    seat = [{ memoHex: 'FE' + '11'.repeat(41), serverComposed: false, preparedByProven: false }];
    runsToServe = [live];

    await new DemoExchangeAutopilot().tick();

    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(seat[0].memoHex).toBe(AUTOPILOT_MEMO);
  });
});

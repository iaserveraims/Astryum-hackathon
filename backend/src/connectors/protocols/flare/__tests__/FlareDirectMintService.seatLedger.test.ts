/**
 * productizer-it15 §K1 — EL ASIENTO DE NONCE LO DECIDE LA FÍSICA DEL LEDGER.
 *
 * Lo que falló (it14 §1.1): el TTL del asiento (5 min) era más corto que la
 * ventana de firma del 0xFE de la mesa (~6-7 min), y el builder no ponía
 * `LastLedgerSequence` en ningún handoff — la mesa la añadía después, así que el
 * registro la desconocía. En el minuto 5 el asiento se declaraba libre, se
 * componía el gemelo en el mismo nonce y se firmaba: pago doble SIN atacante.
 *
 * Ahora todo 0xFE sale con su ventana, el registro la guarda, y el asiento se
 * decide leyendo el ledger: por delante de la LLS no caduca; pasada, solo se
 * sustituye tras leer ENTERA la ventana de la cuenta sin su memo; un `tec` la
 * libera (no entregó XRP: FAssets exige status == PAYMENT_SUCCESS); e «ilegible»
 * jamás libera nada.
 *
 * La cadena se finge en ethers.Contract (PA + nonce 7); el store, en su módulo.
 */
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));

const AM = '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8';
const MAC = '0x434936d47503353f06750db1a444dbdc5f0ad37c';
const FXRP = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
const CORE_VAULT = 'rfkXSaCZKTg1EZzec2rLDyrWHxRVJdtVXj';
const PA = '0x1111111111111111111111111111111111111111';

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class MockContract {
    constructor(public address: string) {}
    async getContractAddressByName(name: string): Promise<string> {
      return name === 'AssetManagerFXRP' ? AM : MAC;
    }
    async fAsset() { return FXRP; }
    async directMintingPaymentAddress() { return CORE_VAULT; }
    async getDirectMintingMinimumFeeUBA() { return 100000n; }
    async getDirectMintingFeeBIPS() { return 10n; }
    async getDirectMintingExecutorFeeUBA() { return 200000n; }
    async assetMintingGranularityUBA() { return 1n; }
    async getPersonalAccount(_xrpl: string) { return PA; }
    async getNonce(_pa: string) { return 7n; }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: MockContract } };
});

const mockQueued = jest.fn();
const mockSuperseded = jest.fn();
const mockSave = jest.fn();
const mockVerify = jest.fn();
const mockMarkSigned = jest.fn();
const mockMarkFailed = jest.fn();
const mockLedger = jest.fn();
const mockWindow = jest.fn();
jest.mock('../../../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../../../services/flare/DirectMintHandoffStore'),
  findQueuedHandoffsByPersonalAccount: (...a: unknown[]) => mockQueued(...a),
  markHandoffsSuperseded: (...a: unknown[]) => mockSuperseded(...a),
  listParked0xFe: async () => [],
  saveHandoffRecord: (...a: unknown[]) => mockSave(...a),
  verifyHandoffPaymentOnLedger: (...a: unknown[]) => mockVerify(...a),
  markHandoffSignedByMemo: (...a: unknown[]) => mockMarkSigned(...a),
  markHandoffLedgerFailedByMemo: (...a: unknown[]) => mockMarkFailed(...a),
  readValidatedLedgerIndex: (...a: unknown[]) => mockLedger(...a),
  readHandoffMemoWindow: (...a: unknown[]) => mockWindow(...a),
}));

import {
  buildDirectMintHandoff,
  buildExecuteUserOpCallData,
  buildPackedUserOp,
  classifySeatConflicts,
  resolveLastLedgerWindow,
  defaultLastLedgerWindow,
  setOperationalAccountResolver,
  resolveOperationalAccount,
  NonceSeatTakenError,
  SeatStateUnreadableError,
  _resetAssetManagerCache,
} from '../FlareDirectMintService';
import { HandoffSeatStateUnreadableError } from '../../../../services/flare/DirectMintHandoffStore';
import type { BuildDirectMintInput } from '../FlareDirectMintService';
import { _resetMacCache } from '../FlareSmartAccountService';

const USER = 'rUserXrplAddr';
const KFXRP = '0xd1b7a5efa9bd88f291f7a4563a8f6185c0249cb3';
const H1 = 'A'.repeat(64);
const MIN = 60_000;
const VALIDATED = 90_000_000;
const fakeProvider = {} as never;
const PARAMS = {
  fxrpToken: FXRP,
  paymentAddress: CORE_VAULT,
  minFeeUBA: 100000n,
  feeBIPS: 10n,
  executorFeeUBA: 200000n,
  granularityUBA: 1n,
};
const ago = (ms: number) => new Date(Date.now() - ms);

/** Una fila 'queued' que ocupa el MISMO asiento (PA + nonce 7) con OTRO userOp. */
async function conflictRow(over: Record<string, unknown> = {}) {
  const callData = await buildExecuteUserOpCallData([{ to: KFXRP, calldata: '0xdeadbeef', value: '0' }]);
  const op = await buildPackedUserOp({ sender: PA, nonce: 7n, callData });
  return {
    userOpHash: op.userOpHash,
    userOpData: op.dataHex,
    memoHex: 'FEAA',
    xrplAddress: USER,
    personalAccount: PA,
    grossXrpDrops: '20000000',
    supplyUBA: '0',
    executorFeeUBA: '200000',
    walletId: 0,
    createdAt: ago(1 * MIN),
    // por defecto: compuesta hace poco, con su ventana POR DELANTE del validado
    composedLedgerIndex: VALIDATED - 20,
    lastLedgerSequence: VALIDATED + 100,
    ...over,
  };
}

const build = (over: Partial<BuildDirectMintInput> = {}) =>
  buildDirectMintHandoff(
    fakeProvider,
    {
      xrplAddress: USER,
      grossXrpDrops: 20_000_000n,
      innerCalls: [{ to: KFXRP, calldata: '0x095ea7b3', value: '0' }],
      action: 'pa-unmint',
      ...over,
    },
    { params: PARAMS },
  );

const ENV_KEYS = [
  'HANDOFF_SEAT_TTL_MIN',
  'HANDOFF_REPORTED_SIGNATURE_WINDOW_MIN',
  'HANDOFF_LLS_WINDOW',
  'HANDOFF_PAYLOAD_EXPIRY_MIN',
  'HANDOFF_UNREADABLE_DISPLACE_MIN',
] as const;
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  jest.clearAllMocks();
  _resetAssetManagerCache();
  _resetMacCache();
  for (const k of ENV_KEYS) delete process.env[k];
  mockQueued.mockResolvedValue([]);
  mockSuperseded.mockResolvedValue(undefined);
  mockSave.mockResolvedValue(true);
  mockMarkSigned.mockResolvedValue(true);
  mockMarkFailed.mockResolvedValue(true);
  mockLedger.mockResolvedValue(VALIDATED);
  mockWindow.mockResolvedValue({ state: 'absent', rowsRead: 3 });
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

describe('every 0xFE carries its ledger window (contrato C1)', () => {
  it('stamps LastLedgerSequence = validated + the payload window and persists it with the composing ledger', async () => {
    const handoff = await build({ preparedByUserId: 'alice', preparedByProven: true });

    expect(handoff.xrplPayment.LastLedgerSequence).toBe(VALIDATED + defaultLastLedgerWindow());
    expect(handoff.lastLedgerSequence).toBe(VALIDATED + defaultLastLedgerWindow());
    expect(handoff.composedLedgerIndex).toBe(VALIDATED);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        lastLedgerSequence: VALIDATED + defaultLastLedgerWindow(),
        composedLedgerIndex: VALIDATED,
        preparedByUserId: 'alice',
        preparedByProven: true,
      }),
    );
  });

  // productizer-it17 §L1 (it16 R1 1.5): la ventana plana de 150 ledgers (~10 min)
  // congelaba el asiento casi el doble de lo que el payload vive. Ahora se mide
  // contra la caducidad del payload: 5 min → 90 ledgers (~6 min).
  it('the default window covers the payload expiry plus a minute, and moves with it (contrato C3)', () => {
    expect(defaultLastLedgerWindow()).toBe(5 * 15 + 15); // 90 ledgers ≈ 6 min
    process.env.HANDOFF_PAYLOAD_EXPIRY_MIN = '10';
    expect(defaultLastLedgerWindow()).toBe(10 * 15 + 15);
    expect(resolveLastLedgerWindow(undefined)).toBe(165);
    process.env.HANDOFF_PAYLOAD_EXPIRY_MIN = '0.1'; // acotada por abajo a 1 min
    expect(defaultLastLedgerWindow()).toBe(30);
  });

  it('every 0xFE says when its Xaman payload stops being signable (contrato C3)', async () => {
    const before = Date.now();
    const handoff = await build();
    expect(handoff.payloadExpiryMin).toBe(5);
    const expiresAt = Date.parse(handoff.payloadExpiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * MIN);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * MIN + 1000);
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ payloadExpiresAt: handoff.payloadExpiresAt }));
  });

  it('the caller’s window wins over the env, and the env over the default (the desk passes 100)', async () => {
    expect((await build({ lastLedgerWindow: 100 })).lastLedgerSequence).toBe(VALIDATED + 100);
    process.env.HANDOFF_LLS_WINDOW = '80';
    expect((await build()).lastLedgerSequence).toBe(VALIDATED + 80);
    expect((await build({ lastLedgerWindow: 100 })).lastLedgerSequence).toBe(VALIDATED + 100);
  });

  it('a window out of range is clamped, never trusted raw', () => {
    expect(resolveLastLedgerWindow(0)).toBe(defaultLastLedgerWindow()); // 0 no es una ventana
    expect(resolveLastLedgerWindow(1)).toBe(10);
    expect(resolveLastLedgerWindow(99_999)).toBe(1000);
    expect(resolveLastLedgerWindow(undefined)).toBe(defaultLastLedgerWindow());
  });

  it('the validated ledger unreadable → composed WITHOUT a window, and that row keeps the old TTL rule', async () => {
    mockLedger.mockResolvedValue(null);
    const legacy = await conflictRow({ createdAt: ago(10 * MIN), lastLedgerSequence: null, composedLedgerIndex: null });
    mockQueued.mockResolvedValue([legacy]);

    const handoff = await build();
    expect('LastLedgerSequence' in handoff.xrplPayment).toBe(false);
    expect(handoff.lastLedgerSequence).toBeNull();
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ lastLedgerSequence: null, composedLedgerIndex: null }));
    // regla antigua: más viejo que el TTL y sin informe → se invalida solo
    expect(mockSuperseded).toHaveBeenCalledWith([legacy.userOpHash]);
    expect(mockWindow).not.toHaveBeenCalled();
  });
});

/**
 * productizer-it23 §Q1 1.1 — EL BUILDER SE NIEGA A ESCRIBIR UNA FILA AMBIGUA.
 *
 * `preparedByProven:false` + `preparedByProofUnreadable:false` es una frase:
 * «pregunté, y esta sesión no tiene esa cuenta» — la que hace la fila
 * desplazable. Un llamador que olvida la segunda marca la escribía sin decirla,
 * y con la tienda de pruebas parpadeando eso paría una SALIDA desplazable que el
 * propio dueño apartaba al reintentar (it22 Q1 1.1, cuatro revisores).
 */
describe('una fila que no sabe decir qué le pasó a la prueba nace en el lado seguro (§Q1 1.1)', () => {
  it('sin la marca, la fila se guarda como DESCONOCIDA, nunca como «no probada»', async () => {
    await build({ preparedByUserId: 'alice' }); // el llamador olvidadizo
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ preparedByProven: false, preparedByProofUnreadable: true }),
    );
  });

  it('quien SÍ preguntó y recibió un no, lo dice — y esa fila sigue siendo desplazable', async () => {
    await build({ preparedByProven: false, preparedByProofUnreadable: false });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ preparedByProven: false, preparedByProofUnreadable: false }),
    );
  });

  it('una prueba de verdad manda sobre todo lo demás', async () => {
    await build({ preparedByProven: true, preparedByProofUnreadable: true });
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ preparedByProven: true, preparedByProofUnreadable: false }),
    );
  });
});

/**
 * productizer-it23 §Q1 1.3 — LA CEREMONIA MULTIFIRMA FIRMA BYTES QUE PUEDEN
 * ENTRAR. Sus payloads viven 24 h (`expire: 1440`) porque un quórum firma a
 * velocidad humana; componer ese 0xFE con la ventana de una firma simple dejaba
 * su `LastLedgerSequence` atrás a los seis minutos, así que el consejo acababa
 * firmando algo que el ledger ya no admite: la salida institucional multifirma
 * no podía completarse.
 */
describe('un 0xFE que firma un QUÓRUM se compone con SU ventana (§Q1 1.3)', () => {
  const CEREMONY_LEDGERS = 1440 * 15 + 15;

  it('signingCeremony estira la caducidad del payload Y la ventana de ledger, a la vez', async () => {
    const before = Date.now();
    const handoff = await build({ signingCeremony: true, action: 'astryum-pote-request-exit' });
    expect(handoff.payloadExpiryMin).toBe(1440);
    expect(handoff.lastLedgerSequence).toBe(VALIDATED + CEREMONY_LEDGERS);
    // la ventana CUBRE el payload: nada que se firme dentro de las 24 h muere por LLS
    expect(CEREMONY_LEDGERS * 4 * 1000).toBeGreaterThanOrEqual(1440 * MIN);
    const expiresAt = Date.parse(handoff.payloadExpiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 1440 * MIN);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({ payloadExpiryMin: 1440, lastLedgerSequence: VALIDATED + CEREMONY_LEDGERS }),
    );
  });

  it('el techo lo pone el servidor: nadie declara una vida mayor que la de Xaman', async () => {
    const handoff = await build({ payloadExpiryMin: 60 * 24 * 7 }); // una semana
    expect(handoff.payloadExpiryMin).toBe(1440);
  });

  it('sin declarar nada, el autodetect ve el SignerList — y un «no pude leer» no estira nada', async () => {
    const quorum = await buildDirectMintHandoff(
      fakeProvider,
      { xrplAddress: USER, grossXrpDrops: 20_000_000n, innerCalls: [{ to: KFXRP, calldata: '0x095ea7b3', value: '0' }], action: 'pa-unmint' },
      { params: PARAMS, readSignerQuorum: async () => 'quorum' },
    );
    expect(quorum.payloadExpiryMin).toBe(1440);

    const unknown = await buildDirectMintHandoff(
      fakeProvider,
      { xrplAddress: USER, grossXrpDrops: 20_000_000n, innerCalls: [{ to: KFXRP, calldata: '0x095ea7b3', value: '0' }], action: 'pa-unmint' },
      { params: PARAMS, readSignerQuorum: async () => 'unknown' },
    );
    expect(unknown.payloadExpiryMin).toBe(5);
    expect(unknown.lastLedgerSequence).toBe(VALIDATED + defaultLastLedgerWindow());
  });

  // La otra mitad: a la media hora, el asiento de esa ceremonia NO está libre —
  // su payload sigue firmable. La MISMA fila sin declarar su vida se da por
  // muerta por el reloj y se aparta, que es como el quórum se quedaba sin asiento
  // (y luego sin ledger) mientras seguía juntando firmas.
  it('y su asiento sigue ocupado a la media hora, donde el de una firma simple ya se habría soltado', async () => {
    const dates = {
      createdAt: ago(30 * MIN),
      composedLedgerIndex: VALIDATED - 1000,
      lastLedgerSequence: VALIDATED + CEREMONY_LEDGERS - 1000,
      preparedByProven: true,
    };
    mockQueued.mockResolvedValue([await conflictRow({ ...dates, payloadExpiryMin: 1440 })]);
    const err = await build({ preparedByProven: true }).catch((e) => e);
    expect(err).toBeInstanceOf(NonceSeatTakenError);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();

    jest.clearAllMocks();
    mockLedger.mockResolvedValue(VALIDATED);
    mockWindow.mockResolvedValue({ state: 'absent', rowsRead: 3 });
    mockSave.mockResolvedValue(true);
    // La misma ceremonia compuesta como una firma simple: su ventana (90 ledgers)
    // ya pasó hace rato, la ventana se lee sin su memo y el asiento se suelta —
    // con el payload de 24 h todavía firmable en los móviles del consejo.
    const stale = await conflictRow({
      ...dates,
      composedLedgerIndex: VALIDATED - 1000,
      lastLedgerSequence: VALIDATED - 910, // compuesta con 90 ledgers, media hora atrás
    });
    mockQueued.mockResolvedValue([stale]);
    await expect(build({ preparedByProven: true })).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([stale.userOpHash]);
  });
});

describe('the seat is decided by the ledger, not by a clock (§K1)', () => {
  it('TTL expired but the window still AHEAD → NOT substituted: the twin never gets composed', async () => {
    // El escenario exacto de it14 §1.1: el borrador tiene 30 min (6× el TTL) y su
    // Payment TODAVÍA puede entrar. Un re-prepare no puede tomar ese asiento.
    const row = await conflictRow({ createdAt: ago(30 * MIN), preparedByUserId: 'owner', preparedByProven: true });
    mockQueued.mockResolvedValue([row]);

    const err = await build({ preparedByUserId: 'owner', preparedByProven: true }).catch((e) => e);
    expect(err).toBeInstanceOf(NonceSeatTakenError);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(err.lastLedgerSequence).toBe(VALIDATED + 100);
    expect(err.secondsLeft).toBe(101 * 4); // 101 ledgers × ~4 s: la cuenta atrás real
    expect(err.message).toContain(`ledger ${VALIDATED + 100}`);
    expect(err.message).not.toContain('se libera solo en 5 min'); // el reloj ya no manda aquí
    expect(mockSuperseded).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('…and neither does an authorized supersede over a draft the proven owner prepared', async () => {
    const row = await conflictRow({ createdAt: ago(30 * MIN), preparedByUserId: 'owner', preparedByProven: true });
    mockQueued.mockResolvedValue([row]);

    const err = await build({ supersedePendingNonce: true, supersedeAuthorized: true, preparedByUserId: 'founder' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('reads the window from the composing ledger to the validated one (nothing older, nothing invented)', async () => {
    mockQueued.mockResolvedValue([await conflictRow()]);
    await build().catch(() => undefined);
    expect(mockWindow).toHaveBeenCalledWith(
      expect.objectContaining({ memoHex: 'FEAA', xrplAddress: USER }),
      { ledgerIndexMin: VALIDATED - 20, ledgerIndexMax: VALIDATED },
    );
  });

  it('the window shows a tesSUCCESS with that memo → marked signed and NONCE_SEAT_TAKEN_SIGNED', async () => {
    const row = await conflictRow();
    mockQueued.mockResolvedValue([row]);
    mockWindow.mockResolvedValue({ state: 'signed', txHash: H1, ledgerResult: 'tesSUCCESS' });

    const err = await build({ supersedePendingNonce: true, supersedeAuthorized: true }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN_SIGNED');
    expect(err.retryable).toBe(false);
    expect(mockMarkSigned).toHaveBeenCalledWith('FEAA', H1, 'tesSUCCESS');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('a tec* Payment FREES the seat: it delivered no XRP, so the mint can never execute', async () => {
    const row = await conflictRow();
    mockQueued.mockResolvedValue([row]);
    mockWindow.mockResolvedValue({ state: 'failed', txHash: H1, ledgerResult: 'tecUNFUNDED_PAYMENT' });

    await expect(build()).resolves.toBeDefined(); // compone sin pedir supersede
    expect(mockMarkFailed).toHaveBeenCalledWith('FEAA', H1, 'tecUNFUNDED_PAYMENT');
    expect(mockMarkSigned).not.toHaveBeenCalled();
  });

  it('a row already marked signed with a tec result is freed too (filas de it13)', async () => {
    const row = await conflictRow({ signedAt: ago(20 * MIN).toISOString(), signedTxHash: H1, signedLedgerResult: 'tecPATH_DRY' });
    mockQueued.mockResolvedValue([row]);

    await expect(build()).resolves.toBeDefined();
    expect(mockMarkFailed).toHaveBeenCalledWith('FEAA', H1, 'tecPATH_DRY');
  });

  it('past its window and read IN FULL without the memo → substitutable, no supersede needed', async () => {
    const row = await conflictRow({ createdAt: ago(30 * MIN), lastLedgerSequence: VALIDATED - 10, composedLedgerIndex: VALIDATED - 160 });
    mockQueued.mockResolvedValue([row]);

    await expect(build()).resolves.toBeDefined();
    expect(mockWindow).toHaveBeenCalledWith(expect.anything(), { ledgerIndexMin: VALIDATED - 160, ledgerIndexMax: VALIDATED - 10 });
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
  });

  // it17 §1.3: la ÚNICA puerta llega mucho después (ventana + 30 min y sesión que
  // prueba la cuenta, en su propio bloque); aquí, recién pasada, no hay escape.
  it('past its window but UNREADABLE → NONCE_SEAT_UNREADABLE, with no escape by time or by supersede', async () => {
    const row = await conflictRow({ createdAt: ago(12 * MIN), lastLedgerSequence: VALIDATED - 10, composedLedgerIndex: VALIDATED - 160 });
    mockQueued.mockResolvedValue([row]);
    mockWindow.mockResolvedValue({ state: 'unreadable', detail: 'the node searched ledgers [89999990, 89999995], asked [89999840, 89999990]' });

    const err = await build({ supersedePendingNonce: true, supersedeAuthorized: true }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    // productizer-it21 §P2 2.3 — su prosa siempre dijo «vuelve a intentarlo», y
    // ahora el campo lo dice también: `retryable: false` con ese texto era la
    // contradicción que la pantalla pintaba como callejón. Sobre una SALIDA (esta
    // build es `pa-unmint`) sale además como 503, no como 409: no hay conflicto
    // probado, hay una lectura que falló.
    expect(err.retryable).toBe(true);
    expect(err).toBeInstanceOf(SeatStateUnreadableError);
    expect(err.message).toContain('the node searched ledgers'); // el motivo, legible
    // Y dice CUÁNDO deja de ser un muro: el instante en que quien prueba la
    // cuenta puede desplazarlo (ventana + margen), no un «espera y ya veremos».
    expect(err.secondsLeft).toBeGreaterThan(0);
    // it23 §Q1 §3.7 — y lo dice EN INGLÉS: esta frase acaba en el `detail` de
    // una pantalla de salida inglesa, y el filtro del frontend tiraba el
    // castellano entero, motivo y fecha incluidos.
    expect(err.message).toMatch(/can be displaced by whoever proves this XRPL account|this seat can be displaced/);
    expect(err.message).not.toMatch(/Vuelve a intentarlo|el PA /);
    expect(mockSuperseded).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  // …y sobre una ENTRADA sigue siendo un 409 (`NonceSeatTakenError` a secas):
  // ahí sí hay una fila de alguien ocupando el asiento y la entrada espera.
  it('…y sobre una ENTRADA el mismo caso sigue siendo un conflicto, ya reintentable', async () => {
    mockQueued.mockResolvedValue([
      await conflictRow({ createdAt: ago(12 * MIN), lastLedgerSequence: VALIDATED - 10, composedLedgerIndex: VALIDATED - 160 }),
    ]);
    mockWindow.mockResolvedValue({ state: 'unreadable', detail: 'no fresh node answered' });

    const err = await build({ action: 'e1' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(err).not.toBeInstanceOf(SeatStateUnreadableError);
    expect(err.retryable).toBe(true);
  });

  it('a conflict WITH a window and no readable validated ledger → unreadable, never «free»', async () => {
    mockLedger.mockResolvedValue(null);
    mockQueued.mockResolvedValue([await conflictRow({ createdAt: ago(10 * MIN) })]);

    const err = await build({ supersedePendingNonce: true, supersedeAuthorized: true }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(mockWindow).not.toHaveBeenCalled();
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('a window that has not closed a single ledger yet is «absent», not a ledger read', async () => {
    mockQueued.mockResolvedValue([await conflictRow({ composedLedgerIndex: VALIDATED + 5 })]);
    // Entrada a propósito: sobre una SALIDA esta misma fila (que nadie probó) se
    // aparta sola desde it19 §M1 1.5, y aquí lo que se prueba es la lectura.
    const err = await build({ action: 'e1' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockWindow).not.toHaveBeenCalled();
  });
});

describe('supersede over a draft whose window is ahead (§K1 regla 3)', () => {
  const owner = { supersedePendingNonce: true, supersedeAuthorized: true, preparedByProven: true, preparedByUserId: 'owner' };

  it('the PROVEN owner displaces a draft prepared by someone who proves nothing', async () => {
    const row = await conflictRow({ preparedByUserId: 'stranger', preparedByProven: false });
    mockQueued.mockResolvedValue([row]);

    await expect(build(owner)).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
  });

  it("and a stranger's own report does not gate the owner (it14 §1.3)", async () => {
    const row = await conflictRow({
      preparedByUserId: 'stranger',
      preparedByProven: false,
      reportedTxHash: H1,
      reportedTxHashes: [H1],
      reportedAt: ago(1 * MIN).toISOString(),
      reportedByProven: false,
    });
    mockQueued.mockResolvedValue([row]);

    await expect(build(owner)).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
    expect(mockVerify).not.toHaveBeenCalled(); // con ventana manda el ledger, no el informe
  });

  it('a report from a session that PROVES the account does gate it: that Payment may be alive', async () => {
    const row = await conflictRow({
      preparedByUserId: 'stranger',
      preparedByProven: false,
      reportedTxHash: H1,
      reportedTxHashes: [H1],
      reportedByProven: true,
    });
    mockQueued.mockResolvedValue([row]);

    const err = await build(owner).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('a draft prepared by the PROVEN owner is not displaced by another authorized session', async () => {
    const row = await conflictRow({ preparedByUserId: 'owner', preparedByProven: true });
    mockQueued.mockResolvedValue([row]);

    const err = await build({ ...owner, preparedByUserId: 'founder' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(err.retryable).toBe(false);
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  // productizer-it19 §M1 1.2 — LA MISMA ESPERA POR LAS DOS PUERTAS. Esta rama
  // desplazaba una fila con la ventana VIVA solo porque su preparador decía que
  // no la había firmado: exactamente el gemelo que `/handoff/release` se niega a
  // crear, alcanzable desde un botón. Decir «no la firmé» desde el navegador no
  // borra el payload del móvil, así que ahora espera lo mismo — y cuando el
  // payload ya no puede firmarse y la ventana se leyó sin su memo, desplaza.
  it('its own preparer displaces it ONCE the payload can no longer be signed, and never after a report', async () => {
    const live = await conflictRow({ preparedByUserId: 'alice', preparedByProven: true });
    mockQueued.mockResolvedValue([live]);
    const tooEarly = await build({ supersedePendingNonce: true, preparedByUserId: 'alice' }).catch((e) => e);
    expect(tooEarly.code).toBe('NONCE_SEAT_TAKEN'); // el payload sigue firmable: se espera
    expect(mockSuperseded).not.toHaveBeenCalled();

    const clean = await conflictRow({
      preparedByUserId: 'alice',
      preparedByProven: true,
      payloadExpiresAt: ago(1000).toISOString(), // el payload ya no se puede firmar…
    });
    mockQueued.mockResolvedValue([clean]);
    mockWindow.mockResolvedValue({ state: 'absent', rowsRead: 3 }); // …y nada suyo entró
    await expect(build({ supersedePendingNonce: true, preparedByUserId: 'alice' })).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([clean.userOpHash]);

    mockSuperseded.mockClear();
    const reported = await conflictRow({
      preparedByUserId: 'alice',
      preparedByProven: true,
      reportedTxHash: H1,
      reportedTxHashes: [H1],
      reportedByProven: true,
    });
    mockQueued.mockResolvedValue([reported]);
    const err = await build({ supersedePendingNonce: true, preparedByUserId: 'alice' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('retryable says whether THIS session could free it — no «Retry» loop over somebody else’s draft', async () => {
    const stranger = await conflictRow({ preparedByUserId: 'stranger', preparedByProven: false });
    mockQueued.mockResolvedValue([stranger]);
    // El dueño probado ya ni siquiera ve el 409 (it17 §1.4): esa fila se aparta sola.
    await expect(build({ preparedByProven: true, preparedByUserId: 'owner' })).resolves.toBeDefined();

    // Sobre una ENTRADA, quien no prueba nada sigue viendo el 409 sin «Retry»
    // (una salida ya no la tapia esa fila — it19 §M1 1.5, probado más abajo).
    const others = await build({ action: 'e1', preparedByProven: false, preparedByUserId: 'nobody' }).catch((e) => e);
    expect(others.retryable).toBe(false);
  });

  it('a draft whose window could not be read is never displaced blindly', async () => {
    mockQueued.mockResolvedValue([await conflictRow({ preparedByUserId: 'stranger', preparedByProven: false })]);
    mockWindow.mockResolvedValue({ state: 'unreadable', detail: 'no fresh node answered' });

    const err = await build(owner).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });
});

/**
 * productizer-it17 §L1 — EL EXTRAÑO YA NO TAPIA EL ASIENTO, Y UN NODO CAÍDO
 * TAMPOCO PARA SIEMPRE (it16 R1 1.3/1.4/1.6).
 */
describe('a draft nobody proven prepared never blocks the account (§1.4)', () => {
  const stranger = { preparedByUserId: 'stranger', preparedByProven: false };

  it('the proven owner composes straight through — the stranger’s row is set aside, no supersede asked', async () => {
    const row = await conflictRow(stranger);
    mockQueued.mockResolvedValue([row]);

    await expect(build({ preparedByProven: true, preparedByUserId: 'owner' })).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
  });

  it('…and neither does it block the autopilot on an account Astryum operates', async () => {
    setOperationalAccountResolver((addr) => addr === USER); // el omnibus de una run (contrato C1)
    try {
      mockQueued.mockResolvedValue([await conflictRow(stranger)]);
      // Sin la etiqueta de un flujo servidor, esa cuenta ni se toca.
      const refused = await build({ action: 'e1' }).catch((e) => e);
      expect(refused.code).toBe('OPERATIONAL_ACCOUNT_HANDOFF_REFUSED');
      // Con ella, el asiento del extraño no le impide componer.
      await expect(build({ action: 'demo-exchange-autopilot' })).resolves.toBeDefined();
    } finally {
      setOperationalAccountResolver(null);
    }
  });

  it('it still blocks ITS OWN preparer repeating without proving the account (ENTRADA)', async () => {
    mockQueued.mockResolvedValue([await conflictRow(stranger)]);
    const err = await build({ action: 'e1', preparedByUserId: 'stranger', preparedByProven: false }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(err.memoHex).toBe('FEAA'); // contrato C3: su propio memo sí se le dice — puede liberarlo
  });

  // productizer-it21 §P1 1.1 — LA ETIQUETA DE SALIDA YA NO ES AUTORIDAD SOBRE LA
  // CUENTA DE OTRO. La it. 19 dejó que cualquier SALIDA apartara la fila de quien
  // no prueba nada, para que un extraño no tapiara al dueño sin binding; pero
  // `action` la fija la ruta y `xrplAddress` viene del CUERPO, así que la puerta
  // valía en las dos direcciones: un extraño llamaba `/pa-unmint/prepare` con la
  // dirección de la víctima y le apartaba su borrador VIVO — dos payloads
  // firmables en el mismo nonce, y el aviso decía «sign only ONE of the two»
  // (it20 N1 1.1). Ahora una fila VIVA solo la aparta quien PRUEBA la cuenta.
  it('una SALIDA de quien no prueba nada ya NO aparta el borrador VIVO de otro (it21 §1.1)', async () => {
    const row = await conflictRow(stranger);
    mockQueued.mockResolvedValue([row]);
    const err = await build({ action: 'pa-unmint', preparedByUserId: 'nobody', preparedByProven: false }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  // …y la intención de it18 §1.5 sigue viva por la mitad honesta: el dueño de
  // verdad PRUEBA la cuenta y la fila del extraño se aparta sola, sin ceremonia.
  it('…pero el dueño PROBADO sí la aparta sobre esa misma salida', async () => {
    const row = await conflictRow(stranger);
    mockQueued.mockResolvedValue([row]);
    const handoff = await build({ action: 'pa-unmint', preparedByUserId: 'owner', preparedByProven: true });
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
    expect(handoff.seatWarning).toMatch(/sign only ONE of the two/);
  });

  // productizer-it21 §P1 1.4 — «NO PUDE LEER LA PRUEBA» NO ES «NO LA PROBÓ». Con
  // la tienda de pruebas caída toda fila nueva se guardaba `preparedByProven:
  // false`, es decir, clasificada como borrador de un extraño y por tanto
  // desplazable: el parpadeo de base de datos entregaba el asiento. La fila que
  // lleva `preparedByProofUnreadable` no la aparta nadie por no estar probada.
  it('una fila cuya PRUEBA no se pudo leer no la aparta ni el dueño probado (it21 §1.4)', async () => {
    mockQueued.mockResolvedValue([await conflictRow({ ...stranger, preparedByProofUnreadable: true })]);
    const err = await build({ preparedByProven: true, preparedByUserId: 'owner' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('…ni un supersede autorizado de otra sesión', async () => {
    mockQueued.mockResolvedValue([await conflictRow({ ...stranger, preparedByProofUnreadable: true })]);
    const err = await build({ supersedePendingNonce: true, supersedeAuthorized: true, preparedByUserId: 'owner' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  // …y una fila que YA NO PUEDE FIRMARSE la aparta cualquiera, también sin
  // prueba: apartarla no crea ningún gemelo, y no tapiar es lo que importa.
  it('…y una fila que ya no puede firmarse la aparta hasta una salida sin prueba', async () => {
    const dead = await conflictRow({
      ...stranger,
      createdAt: ago(30 * MIN),
      composedLedgerIndex: VALIDATED - 160,
      lastLedgerSequence: VALIDATED - 10,
    });
    mockQueued.mockResolvedValue([dead]);
    mockWindow.mockResolvedValue({ state: 'absent', rowsRead: 12 }); // ventana leída entera, sin su memo

    await expect(build({ action: 'pa-unmint', preparedByUserId: 'nobody', preparedByProven: false })).resolves.toBeDefined();
    expect(mockSuperseded).toHaveBeenCalledWith([dead.userOpHash]);
  });

  // …pero una fila que compuso NUESTRO PROPIO SERVIDOR no se aparta jamás sola,
  // ni para una salida: ahí hay un payload que el fundador puede firmar y el XRP
  // de un cliente esperando (it18 R1 1.1, contrato C1).
  it('una fila serverComposed no la aparta ni una salida', async () => {
    const desk = await conflictRow({ ...stranger, serverComposed: true, action: 'demo-exchange-desk' });
    mockQueued.mockResolvedValue([desk]);
    const err = await build({ action: 'pa-unmint', preparedByUserId: 'nobody', preparedByProven: false }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('a stranger gets no memo with the refusal (contrato C2)', async () => {
    mockQueued.mockResolvedValue([await conflictRow({ ...stranger, preparedByProven: true })]);
    const err = await build({ preparedByUserId: 'nobody' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN');
    expect(err.memoHex).toBeUndefined();
  });

  it('a SIGNED row still blocks everyone, proven or not (ahí hay dinero en vuelo)', async () => {
    mockQueued.mockResolvedValue([
      await conflictRow({ ...stranger, signedAt: ago(2 * MIN).toISOString(), signedLedgerResult: 'tesSUCCESS' }),
    ]);
    const err = await build({ preparedByProven: true, preparedByUserId: 'owner' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_TAKEN_SIGNED');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });
});

describe('an unreadable window long past does not wall the seat for ever (§1.3)', () => {
  /** Fila cuya ventana pasó hace mucho y que ningún nodo puede leer. */
  const longPast = async () =>
    conflictRow({
      createdAt: ago(60 * MIN),
      composedLedgerIndex: VALIDATED - 200,
      lastLedgerSequence: VALIDATED - 110,
      preparedByUserId: 'owner',
      preparedByProven: true,
    });

  beforeEach(() => mockWindow.mockResolvedValue({ state: 'unreadable', detail: 'no fresh node answered' }));

  it('a session that PROVES the account displaces it, and is told exactly what it displaced', async () => {
    const row = await longPast();
    mockQueued.mockResolvedValue([row]);

    const handoff = await build({ preparedByProven: true, preparedByUserId: 'founder' });
    expect(mockSuperseded).toHaveBeenCalledWith([row.userOpHash]);
    expect(handoff.seatWarning).toMatch(/could not be checked on any XRPL node/);
    expect(handoff.seatWarning).toMatch(/only one of the two can execute/);
  });

  it('a stranger never displaces it — «no pude leer» sigue sin ser permiso', async () => {
    mockQueued.mockResolvedValue([await longPast()]);
    const err = await build({ preparedByUserId: 'stranger', preparedByProven: false }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('and never INSIDE its window, however proven the session is', async () => {
    // Ventana POR DELANTE (aún firmable) y sin leer: ni el dueño probado la aparta.
    mockQueued.mockResolvedValue([
      await conflictRow({ createdAt: ago(60 * MIN), lastLedgerSequence: VALIDATED + 100, preparedByUserId: 'stranger', preparedByProven: false }),
    ]);
    const err = await build({ supersedePendingNonce: true, supersedeAuthorized: true, preparedByProven: true }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('a window that passed only moments ago still waits (the grace is not a shortcut)', async () => {
    mockQueued.mockResolvedValue([
      await conflictRow({ createdAt: ago(2 * MIN), composedLedgerIndex: VALIDATED - 200, lastLedgerSequence: VALIDATED - 110 }),
    ]);
    const err = await build({ preparedByProven: true, preparedByUserId: 'owner' }).catch((e) => e);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(mockSuperseded).not.toHaveBeenCalled();
  });
});

/**
 * productizer-it19 §M1 1.4 — «NO PUDE LEER» NI CONCEDE NI RETIRA UN ASIENTO.
 *
 * Con la tabla de handoffs ilegible, el guard devolvía `[]` (indistinguible de
 * «esta cuenta no tiene ningún 0xFE pendiente») y el `catch` se tragaba el fallo:
 * se componía a ciegas sobre un asiento que podía estar ocupado. Y con el
 * registro de runs nunca leído, una cuenta operativa se leía como cuenta de
 * usuario: su asiento quedaba tomable por cualquiera. Ahora una ENTRADA espera; y
 * una SALIDA pasa igual, porque una salida no se gatea jamás.
 */
describe('un estado de asiento ILEGIBLE no se compone a ciegas (§1.4)', () => {
  beforeEach(() => {
    mockQueued.mockRejectedValue(new HandoffSeatStateUnreadableError('the 0xFE seats of 0x1111 could not be read: db down'));
  });

  it('una ENTRADA se refusa, con código y reintento — y no compone ni guarda nada', async () => {
    const err = await build({ action: 'e1' }).catch((e) => e);
    expect(err).toBeInstanceOf(SeatStateUnreadableError);
    expect(err.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/^SEAT_STATE_UNREADABLE/);
    expect(err.message).toMatch(/nothing was composed/i);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockSuperseded).not.toHaveBeenCalled();
  });

  it('…y una SALIDA se compone igual, llevándose escrito que no se pudo comprobar', async () => {
    const handoff = await build({ action: 'pa-unmint' });
    expect(handoff.seatWarning).toMatch(/could not be read just now/);
    expect(handoff.seatWarning).toMatch(/only one of the two can execute/);
    expect(mockSave).toHaveBeenCalled();
  });

  it('sin base de datos (scripts CLI) el guard simplemente no aplica', async () => {
    mockQueued.mockResolvedValue([]); // lo que devuelve el store sin DATABASE_URL
    const handoff = await build({ action: 'e1' });
    expect(handoff.seatWarning).toBeUndefined();
  });
});

describe('una cuenta operativa que no se pudo comprobar no es «de usuario» (§1.4)', () => {
  afterEach(() => setOperationalAccountResolver(null));

  it('un resolver que nunca llegó a leer su fuente responde «unknown», no «no»', async () => {
    setOperationalAccountResolver(() => false, { ready: () => false });
    expect(await resolveOperationalAccount(USER)).toBe('unknown');
    setOperationalAccountResolver(() => false, { ready: () => true });
    expect(await resolveOperationalAccount(USER)).toBe('no'); // leído y respondido: es un «no» de verdad
    setOperationalAccountResolver(() => false); // sin el hook, el comportamiento de it17
    expect(await resolveOperationalAccount(USER)).toBe('no');
  });

  // productizer-it21 §P1 1.6 — …Y UNA SALIDA SIN PRUEBA TAMPOCO PASA POR ENCIMA
  // DE UNA CUENTA QUE QUIZÁ OPERAMOS. `action` la fija la ruta pero `xrplAddress`
  // viene del CUERPO: con el registro ilegible, cualquiera escribía el omnibus de
  // la mesa en un `/pa-unmint/prepare` y se llevaba el asiento que sirve a todos
  // los clientes de esa run (it20 N1 1.6). La salida NO se gatea: recibe el mismo
  // 503 reintentable — y probando la cuenta compone al instante.
  it('con «unknown», una ENTRADA ajena espera y una SALIDA SIN PRUEBA espera igual (503)', async () => {
    setOperationalAccountResolver(() => false, { ready: () => false });
    const err = await build({ action: 'e1' }).catch((e) => e);
    expect(err).toBeInstanceOf(SeatStateUnreadableError);
    expect(err.message).toMatch(/run register could not be read/);

    const exit = await build({ action: 'pa-unmint' }).catch((e) => e);
    expect(exit).toBeInstanceOf(SeatStateUnreadableError);
    expect(exit.retryable).toBe(true); // espera, jamás un «no»
    expect(exit.message).toMatch(/signing in with it \(or binding it\) proves it/);

    // La salida de quien PRUEBA la cuenta compone igual que siempre.
    await expect(build({ action: 'pa-unmint', preparedByProven: true })).resolves.toBeDefined();
    // Y el flujo servidor de Astryum tampoco se para por no poder leer la lista.
    await expect(build({ action: 'demo-exchange-autopilot' })).resolves.toBeDefined();
  });
});

describe('classifySeatConflicts — la ventana de ledger, pura', () => {
  const now = 1_700_000_000_000;
  const ttl = 5 * MIN;
  type Row = {
    id: string;
    createdAt?: Date;
    signedAt?: string | null;
    signedLedgerResult?: string | null;
    lastLedgerSequence?: number | null;
    composedLedgerIndex?: number | null;
  };
  const classify = (rows: Row[], validated: number | null, windows: Record<string, ReturnType<typeof win>> = {}) =>
    classifySeatConflicts(rows, ttl, now, undefined, {
      validatedLedgerIndex: validated,
      windowOf: (c) => windows[c.id],
    });
  const win = (v: Record<string, unknown>) => v as never;
  const old = { createdAt: new Date(now - 60 * MIN) };

  it('window ahead → aheadOfLls and fresh, however old the draft', () => {
    const r = { id: 'a', ...old, lastLedgerSequence: 100, composedLedgerIndex: 50 };
    const out = classify([r], 90, { a: win({ state: 'absent', rowsRead: 0 }) });
    expect(out.aheadOfLls).toEqual([r]);
    expect(out.fresh).toEqual([r]);
    expect(out.stale).toEqual([]);
    expect(out.aheadUnverified).toEqual([]);
  });

  it('window ahead but unread → aheadUnverified (holds the seat, nobody displaces it)', () => {
    const r = { id: 'a', ...old, lastLedgerSequence: 100 };
    const out = classify([r], 90);
    expect(out.aheadOfLls).toEqual([r]);
    expect(out.aheadUnverified).toEqual([r]);
  });

  it('past the window, read in full and absent → stale; unreadable → unreadable', () => {
    const a = { id: 'a', ...old, lastLedgerSequence: 100 };
    const b = { id: 'b', ...old, lastLedgerSequence: 100 };
    const out = classify([a, b], 200, { a: win({ state: 'absent', rowsRead: 9 }), b: win({ state: 'unreadable', detail: 'x' }) });
    expect(out.stale).toEqual([a]);
    expect(out.unreadable).toEqual([b]);
    expect(out.fresh).toEqual([b]);
  });

  it('signed/failed in the window beat everything, at any distance from the LLS', () => {
    const a = { id: 'a', ...old, lastLedgerSequence: 100 };
    const b = { id: 'b', ...old, lastLedgerSequence: 100 };
    const out = classify([a, b], 200, {
      a: win({ state: 'signed', txHash: H1, ledgerResult: 'tesSUCCESS' }),
      b: win({ state: 'failed', txHash: H1, ledgerResult: 'tecNO_DST' }),
    });
    expect(out.signed).toEqual([a]);
    expect(out.validatedByLedger).toEqual([a]);
    expect(out.ledgerFailed).toEqual([b]);
    expect(out.stale).toEqual([]);
  });

  it('no validated ledger → every windowed row is unreadable, never stale', () => {
    const r = { id: 'a', ...old, lastLedgerSequence: 100 };
    const out = classify([r], null);
    expect(out.unreadable).toEqual([r]);
    expect(out.stale).toEqual([]);
  });

  it('a signed row with a tec result is ledgerFailed; with tesSUCCESS it stays signed', () => {
    const tec = { id: 'a', ...old, signedAt: 'x', signedLedgerResult: 'tecUNFUNDED_PAYMENT' };
    const tes = { id: 'b', ...old, signedAt: 'x', signedLedgerResult: 'tesSUCCESS' };
    const out = classify([tec, tes], 200);
    expect(out.ledgerFailed).toEqual([tec]);
    expect(out.signed).toEqual([tes]);
  });

  it('rows without a window keep the it13 buckets (TTL decides, and drafts are displaceable)', () => {
    const fresh = { id: 'a', createdAt: new Date(now - 1000) };
    const stale = { id: 'b', ...old };
    const out = classify([fresh, stale], 200);
    expect(out.drafts).toEqual([fresh]);
    expect(out.stale).toEqual([stale]);
  });
});

/**
 * LA CADENA ENTERA DE LA CLASIFICACIÓN DE SALIDA,
 * CON UN MEMO DE 0xFE DE VERDAD Y SIN SUSTITUIR AL CLASIFICADOR.
 */
import express from 'express';
import request from 'supertest';
import { singleMemoHex } from '../../services/councilExitToken';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const CORE_VAULT = 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX';

/**
 * EL MEMO DE UN 0xFE DE VERDAD: `FE` + walletId + comisión del executor + los 32
 * bytes del userOpHash = 42 bytes / 84 hex. Es exactamente la forma que afirma
 * `FlareDirectMintService.test.ts` («→ 42-byte memo, uppercase, no 0x, starts FE»).
 */
const ZERO_FE_MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const GROSS_DROPS = '2000000';

const SIGNERS = [
  { account: MEMBER_A, weight: 1 },
  { account: MEMBER_B, weight: 1 },
];

/* ── Los STORES, que es lo único que un test no puede tener ───────────────── */

const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockWalletFindMany = jest.fn();
const mockBackgroundJobFindMany = jest.fn();
const mockCacheUpsert = jest.fn();
const mockCacheDeleteMany = jest.fn();
const mockCacheFindUnique = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    councilProposal: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
      update: jest.fn(async () => ({})),
    },
    wallet: { findMany: (...a: unknown[]) => mockWalletFindMany(...a) },
    backgroundJob: { findMany: (...a: unknown[]) => mockBackgroundJobFindMany(...a) },
    cacheEntry: {
      findUnique: (...a: unknown[]) => mockCacheFindUnique(...a),
      upsert: (...a: unknown[]) => mockCacheUpsert(...a),
      deleteMany: (...a: unknown[]) => mockCacheDeleteMany(...a),
    },
  },
}));

const mockQueuedHandoff = jest.fn();
const mockStamp = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  findQueuedHandoffByMemo: (...a: unknown[]) => mockQueuedHandoff(...a),
  stampCeremonyPin: (...a: unknown[]) => mockStamp(...a),
}));

const mockComposedOrder = jest.fn();
const mockMayReadCouncil = jest.fn();
jest.mock('../../services/flare/ComposedCouncilOrderStore', () => ({
  ...jest.requireActual('../../services/flare/ComposedCouncilOrderStore'),
  getComposedCouncilOrderStrict: (...a: unknown[]) => mockComposedOrder(...a),
  sessionMayReadCouncilAccount: (...a: unknown[]) => mockMayReadCouncil(...a),
}));

/** El Destination que paga TODO mint 0xFE: el Core Vault, leído de la cadena. */
const mockMintParams = jest.fn();
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readDirectMintParams: (...a: unknown[]) => mockMintParams(...a),
}));
jest.mock('../../services/flare/flareProvider', () => ({
  ...jest.requireActual('../../services/flare/flareProvider'),
  flareReadProvider: () => ({}),
}));

jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: {
    getAccountSequence: jest.fn(async () => 11),
    getSignerCouncil: jest.fn(async () => ({ quorum: 2, signers: SIGNERS })),
  },
}));

const mockProvenAddresses = jest.fn<Promise<string[]>, unknown[]>();
const mockProveMembership = jest.fn();
jest.mock('../../services/identity/provenAddresses', () => ({
  ...jest.requireActual('../../services/identity/provenAddresses'),
  provenAddressesOf: (...a: unknown[]) => mockProvenAddresses(...a),
  proveMembership: (...a: unknown[]) => mockProveMembership(...a),
}));

const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplMultisigCoordinator'),
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
}));

import xrplDefiRouter from '../xrplDefi';
import { __resetSequenceCache } from '../councilProposals';

const URL = '/api/xrpl-defi/multisign/prepare';

/** Los bytes que el consejo firma: el 0xFE de una salida, con su memo real. */
const zeroFeTx = (over: Record<string, unknown> = {}) => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: CORE_VAULT,
  Amount: GROSS_DROPS,
  Memos: [{ Memo: { MemoData: ZERO_FE_MEMO } }],
  ...over,
});

const pinned = {
  multisigTx: { ...zeroFeTx(), Sequence: 11, SigningPubKey: '' },
  council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
  fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
  preflight: { available: true, willSucceed: true, balanceChanges: [] },
  sequence: { pinned: 11, ledgerNext: 11, source: 'ledger' as const },
};

function buildApp(userId: string | null = 'user-1') {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: unknown }).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  app.use('/api/xrpl-defi', xrplDefiRouter);
  return app;
}

/** Una fila de 0xFE tal como la guarda `buildDirectMintHandoff`. */
const handoffRow = (action: string, over: Record<string, unknown> = {}) => ({
  xrplAddress: COUNCIL,
  action,
  grossXrpDrops: GROSS_DROPS,
  memoHex: ZERO_FE_MEMO,
  ...over,
});

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  __resetSequenceCache();
  process.env = { ...ENV };
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  process.env.DATABASE_URL = 'postgres://test/test'; // `readHandoffAnyState` no lee sin ella
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  // El arnés imita la regla de pinado del propio coordinador: solo toma el asiento
  // pedido cuando ESE es el siguiente libre del ledger (pinar uno ya pasado
  // compondría un cadáver tefPAST_SEQ).
  mockPrepare.mockImplementation(async (_reader: unknown, input: { pinSequence?: number | null }) => {
    const ledgerNext = 11;
    const requested = typeof input?.pinSequence === 'number' ? input.pinSequence : undefined;
    return {
      ...pinned,
      sequence: {
        pinned: ledgerNext,
        ledgerNext,
        ...(requested !== undefined ? { requested } : {}),
        source: requested === ledgerNext ? 'contested-seat' : 'ledger',
        ...(requested !== undefined && requested < ledgerNext ? { requestedSeatConsumed: true } : {}),
      },
    };
  });
  mockFindFirst.mockResolvedValue(null);
  mockFindMany.mockResolvedValue([]);
  mockWalletFindMany.mockResolvedValue([]);
  mockBackgroundJobFindMany.mockResolvedValue([]);
  mockCacheUpsert.mockResolvedValue({});
  mockCacheDeleteMany.mockResolvedValue({ count: 0 });
  mockCacheFindUnique.mockResolvedValue(null);
  mockStamp.mockResolvedValue({ stamped: true });
  mockQueuedHandoff.mockResolvedValue(null);
  mockComposedOrder.mockResolvedValue(null);
  mockMayReadCouncil.mockResolvedValue(true);
  mockMintParams.mockResolvedValue({ paymentAddress: CORE_VAULT });
  mockProvenAddresses.mockResolvedValue([MEMBER_A]);
  mockProveMembership.mockImplementation(async (...a: unknown[]) => {
    const members = (a[2] as string[]) ?? [];
    return { owned: members.filter((m) => m === MEMBER_A), storeReadable: true, failure: null, refusal: null };
  });
});
afterAll(() => {
  process.env = ENV;
});

describe('El memo de un 0xFE se LEE (la premisa de todo lo demás)', () => {
  it('84 hex, no 64: la longitud que la regla anterior tiraba a la basura', () => {
    expect(ZERO_FE_MEMO).toHaveLength(84);
    expect(singleMemoHex(zeroFeTx())).toBe(ZERO_FE_MEMO);
  });
});

describe('UNA SALIDA NO TOMA LA VALLA GEOGRÁFICA', () => {
  /**
   * EL FALLO ENTERO, EN UN TEST. Región bloqueada + un 0xFE de salida real. Antes el memo no se leía, `isExit` quedaba `false` y esto contestaba 451 sobre
   * la salida de un consejo — con el `exitToken` caducado a los 15 min mientras una
   * ceremonia de quórum dura hasta 24 h.
   */
  it('un 0xFE de salida compone (200) desde una región bloqueada, sin token ninguno', async () => {
    process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US';
    mockQueuedHandoff.mockResolvedValue(handoffRow('astryum-pote-exit'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx(), region: 'US' });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(res.body.multisigTx.Sequence).toBe(11);
    // …y la clasificación corrió de verdad: se preguntó por ESTE memo.
    expect(mockQueuedHandoff).toHaveBeenCalledWith(ZERO_FE_MEMO);
  });

  it('tampoco bajo lista blanca sin región — el caso que dejaba 451 en todas partes', async () => {
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES';
    mockQueuedHandoff.mockResolvedValue(handoffRow('pa-withdraw-transfer:fxrp->xrpl'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(200);
  });

  /** La otra mitad de la regla: la valla sigue entera para lo que ABRE exposición. */
  it('una ENTRADA con la misma forma de memo SIGUE tomando la valla (451)', async () => {
    process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US';
    mockQueuedHandoff.mockResolvedValue(handoffRow('pa-fxrp-entry:e1'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx(), region: 'US' });

    expect(res.status).toBe(451);
    expect(String(res.body.error)).toContain('GEOFENCE_BLOCKED');
    expect(res.body.exitClassification).toBe('not-an-exit');
  });

  /** Y el interruptor del módulo sigue por delante de todo. */
  it('la bandera del módulo apagada cierra igual, salida incluida', async () => {
    process.env.XRPL_DEFI_ENABLED = 'false';
    mockQueuedHandoff.mockResolvedValue(handoffRow('astryum-pote-exit'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('XRPL_DEFI_DISABLED');
  });
});

describe('EL AVISO DE «ESTE PAYLOAD YA NO ES FIRMABLE» SUENA', () => {
  /** . Con el lector de 64 hex este 409 no se emitió ni una vez. */
  it.each([
    ['superseded', /superseded/i],
    ['completed', /already went through/i],
    ['parked', /no longer waiting/i],
  ])('un 0xFE %s da 409 EXIT_HANDOFF_NOT_SIGNABLE, no un prepare sobre un cadáver', async (status, expected) => {
    mockQueuedHandoff.mockResolvedValue(null);
    mockBackgroundJobFindMany.mockResolvedValue([
      { payload: handoffRow('astryum-pote-exit'), status },
    ]);

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EXIT_HANDOFF_NOT_SIGNABLE');
    expect(res.body.handoffStatus).toBe(status);
    expect(String(res.body.detail)).toMatch(expected);
    // Y jamás se le echa la culpa a la región.
    expect(String(res.body.detail)).toMatch(/nothing to do with your region/i);
    // NADA se compuso: el portador no se quema.
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  /** Se dice en TODAS las regiones, no solo donde la valla iba a contestar. */
  it('también desde una región permitida', async () => {
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES';
    mockBackgroundJobFindMany.mockResolvedValue([{ payload: handoffRow('astryum-pote-exit'), status: 'completed' }]);

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx(), region: 'ES' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('EXIT_HANDOFF_NOT_SIGNABLE');
  });

  /** La razón exacta es un oráculo sobre el memo de otro. */
  it('a quien no acredita la cuenta se le da la frase genérica, no el estado del 0xFE', async () => {
    mockMayReadCouncil.mockResolvedValue(false);
    mockBackgroundJobFindMany.mockResolvedValue([{ payload: handoffRow('astryum-pote-exit'), status: 'superseded' }]);

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('CANNOT_PREPARE_HERE');
    expect(res.body.handoffStatus).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('superseded');
  });

  /** Una fila `queued` encontrada solo por la lectura de cualquier estado sigue siendo firmable. */
  it('un 0xFE todavía en cola no es un cadáver: compone', async () => {
    mockBackgroundJobFindMany.mockResolvedValue([{ payload: handoffRow('astryum-pote-exit'), status: 'queued' }]);

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(200);
  });
});

describe('Las guardas de asiento ven una SALIDA, no una entrada', () => {
  const liveRow = {
    id: 'p9',
    title: 'Pago proveedor',
    txType: 'Payment',
    txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11 },
    signerList: SIGNERS,
  };

  /**
   * Daño 3: sin clasificación, una salida de 0xFE caía en `LIVE_PROPOSAL_EXISTS`
   * (422) por la propuesta de otro. La salida toma el asiento; la entrada es la que
   * lo pierde.
   */
  it('una propuesta viva rival no cierra la salida: 200 con el aviso', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    mockQueuedHandoff.mockResolvedValue(handoffRow('vault-withdraw:firelight'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(200);
    expect(res.body.seatContest).toMatchObject({ proposalId: 'p9', pinnedSequence: 11 });
    expect(mockPrepare).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ pinSequence: 11 }));
  });

  it('la misma fila rival SÍ refuse una entrada (422) — la regla no se debilitó', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    mockQueuedHandoff.mockResolvedValue(handoffRow('astryum-pote-fund'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('LIVE_PROPOSAL_EXISTS');
  });

  /**
   * «No pude leer» no es permiso, ni castigo, ni un hecho: compone como salida (para
   * no tapiar una) pero NO se queda con el asiento de nadie (2.6).
   */
  it('un store caído es «unreadable»: compone, avisa, y no toma el asiento ajeno', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    mockQueuedHandoff.mockRejectedValue(new Error('db down'));
    mockBackgroundJobFindMany.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(200);
    expect(res.body.exitClassification).toBe('unreadable');
    expect(mockPrepare).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.not.objectContaining({ pinSequence: expect.anything() }),
    );
  });
});

/**
 * productizer it. 27 (§4) — LA CADENA DEL CERROJO: QUIEN PINA, MARCA.
 *
 * `releaseAbandonedCeremonySeat` solo puede soltar el asiento de nonce de un 0xFE
 * antes de tiempo si esos bytes llevan la `Sequence` FIJADA por el coordinador
 * multifirma — es el argumento entero (dos Payments con el mismo número no pueden
 * entrar los dos). Desde it. 27 la puerta EXIGE esa marca, así que la marca tiene
 * que existir: la escribe el único sitio que pina, `POST /multisign/prepare`.
 *
 * Probar la puerta sin probar quién escribe la marca es el fallo recurrente de
 * este ciclo (un arreglo entero sin llamador). Aquí se pide un prepare REAL y se
 * mira que el asiento quede marcado con el memo de ESOS bytes y con la Sequence
 * que el coordinador acaba de fijar.
 */
import express from 'express';
import request from 'supertest';

const mockCacheUpsert = jest.fn();
const mockCacheDeleteMany = jest.fn();
const mockCacheFindUnique = jest.fn();
/** it. 29: la lectura de cualquier estado del 0xFE va directa a `background_jobs`. */
const mockBackgroundJobFindMany = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    councilProposal: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    wallet: { findMany: jest.fn(async () => []) },
    backgroundJob: { findMany: (...a: unknown[]) => mockBackgroundJobFindMany(...a) },
    cacheEntry: {
      findUnique: (...a: unknown[]) => mockCacheFindUnique(...a),
      upsert: (...a: unknown[]) => mockCacheUpsert(...a),
      deleteMany: (...a: unknown[]) => mockCacheDeleteMany(...a),
    },
  },
}));

jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: { getAccountSequence: jest.fn(async () => 11) },
}));

const mockProvenAddresses = jest.fn<Promise<string[]>, unknown[]>();
const mockProveMembership = jest.fn();
jest.mock('../../services/identity/provenAddresses', () => ({
  ...jest.requireActual('../../services/identity/provenAddresses'),
  provenAddressesOf: (...a: unknown[]) => mockProvenAddresses(...a),
  proveMembership: (...a: unknown[]) => mockProveMembership(...a),
}));

/**
 * ── productizer it. 29 — AQUÍ YA NO SE SUSTITUYE AL CLASIFICADOR ───────────────
 *
 * Esta suite mockeaba `classifyCouncilExitByMemo` (y `verifyCouncilExitToken`), así
 * que probaba la puerta con la función que decide si estos bytes son una SALIDA
 * reemplazada por una que sí clasifica. Debajo, la de verdad devolvía
 * `no-single-memo` para TODO 0xFE — `singleMemoHex` exigía 64 hex y el memo de un
 * 0xFE mide 84, como afirma el propio test de abajo. La rama entera sobrevivió
 * muerta porque el arnés la tapaba.
 *
 * Ahora corre de verdad y lo que se sustituye son los STORES, que es lo único que
 * un test no puede tener. El token tampoco se mockea: sin `exitToken` en el cuerpo,
 * el verificador real contesta `absent`, que es exactamente lo que fingía el mock.
 */
const mockQueuedHandoff = jest.fn();
const mockComposedOrder = jest.fn();
const mockMintParams = jest.fn();
jest.mock('../../services/flare/ComposedCouncilOrderStore', () => ({
  ...jest.requireActual('../../services/flare/ComposedCouncilOrderStore'),
  getComposedCouncilOrderStrict: (...a: unknown[]) => mockComposedOrder(...a),
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readDirectMintParams: (...a: unknown[]) => mockMintParams(...a),
}));
jest.mock('../../services/flare/flareProvider', () => ({
  ...jest.requireActual('../../services/flare/flareProvider'),
  flareReadProvider: () => ({}),
}));

const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplMultisigCoordinator'),
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
}));

const mockStamp = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  stampCeremonyPin: (...a: unknown[]) => mockStamp(...a),
  findQueuedHandoffByMemo: (...a: unknown[]) => mockQueuedHandoff(...a),
}));

import xrplDefiRouter from '../xrplDefi';
import { zeroFeMemoOf } from '../xrplDefi';
import { singleMemoHex } from '../../services/councilExitToken';
import { __resetSequenceCache } from '../councilProposals';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const URL = '/api/xrpl-defi/multisign/prepare';

const SIGNERS = [
  { account: MEMBER_A, weight: 1 },
  { account: MEMBER_B, weight: 1 },
];

/** Los bytes que una ceremonia firma: el 0xFE de una salida, con su memo. */
const CORE_VAULT = 'rCoreVault111111111111111111111111';
const zeroFeTx = () => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: CORE_VAULT,
  Amount: '1000000',
  Memos: [{ Memo: { MemoData: MEMO } }],
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

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  __resetSequenceCache();
  process.env = { ...ENV };
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  mockPrepare.mockResolvedValue(pinned);
  mockCacheUpsert.mockResolvedValue({});
  mockCacheDeleteMany.mockResolvedValue({ count: 0 });
  mockCacheFindUnique.mockResolvedValue(null);
  mockStamp.mockResolvedValue({ stamped: true });
  mockProvenAddresses.mockResolvedValue([MEMBER_A]);
  mockProveMembership.mockImplementation(async (...a: unknown[]) => {
    const members = (a[2] as string[]) ?? [];
    return { owned: members.filter((m) => m === MEMBER_A), storeReadable: true, failure: null, refusal: null };
  });
  // Por defecto: los stores no conocen este memo, así que la clasificación REAL
  // contesta `unknown-memo` — la ceremonia ordinaria, igual que antes.
  process.env.DATABASE_URL = 'postgres://test/test';
  mockQueuedHandoff.mockResolvedValue(null);
  mockComposedOrder.mockResolvedValue(null);
  mockBackgroundJobFindMany.mockResolvedValue([]);
  mockMintParams.mockResolvedValue({ paymentAddress: CORE_VAULT });
});
afterAll(() => {
  process.env = ENV;
});

describe('el prepare marca los bytes que acaba de pinar', () => {
  it('el memo del 0xFE y la Sequence fijada quedan en el asiento', async () => {
    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(200);
    expect(mockStamp).toHaveBeenCalledWith(MEMO, COUNCIL, 11, { sittingId: expect.any(String) });
  });

  /**
   * it. 34 (E) — EL NOMBRE DEL SITTING NACE AQUÍ Y VIAJA A LOS TRES SITIOS. El
   * servidor genera un id por prepare y lo escribe en el pin, en el arriendo y en
   * la respuesta: el MISMO en los tres. Sin eso, la liberación tardía de un
   * sitting no se distingue de la del siguiente (la carrera del bus). Un segundo
   * prepare de la misma sesión y los mismos bytes recibe OTRO id.
   */
  it('genera un id de sitting por prepare — el mismo en el pin, el arriendo y la respuesta; distinto en el siguiente', async () => {
    const first = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });
    expect(first.status).toBe(200);
    const id1 = first.body.sittingId;
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(8);
    expect(mockStamp).toHaveBeenLastCalledWith(MEMO, COUNCIL, 11, { sittingId: id1 });
    expect(mockCacheUpsert).toHaveBeenCalledTimes(1);
    expect(mockCacheUpsert.mock.calls[0][0].create.data.sittingId).toBe(id1);
    expect(mockCacheUpsert.mock.calls[0][0].update.data.sittingId).toBe(id1);

    const second = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });
    expect(second.status).toBe(200);
    const id2 = second.body.sittingId;
    expect(typeof id2).toBe('string');
    expect(id2).not.toBe(id1);
    expect(mockStamp).toHaveBeenLastCalledWith(MEMO, COUNCIL, 11, { sittingId: id2 });
    expect(mockCacheUpsert.mock.calls[1][0].update.data.sittingId).toBe(id2);
  });

  it('el id NUNCA sale del cuerpo de la petición: uno enviado por el cliente se ignora', async () => {
    const res = await request(buildApp())
      .post(URL)
      .send({ account: COUNCIL, xrplTx: zeroFeTx(), sittingId: 'chosen-by-the-client' });
    expect(res.status).toBe(200);
    expect(res.body.sittingId).not.toBe('chosen-by-the-client');
    expect(mockStamp).toHaveBeenLastCalledWith(MEMO, COUNCIL, 11, { sittingId: res.body.sittingId });
  });

  /**
   * LA MARCA ES UN HECHO DE ESTE PREPARE, NO UNA CUESTIÓN DE REGISTRO. Quién
   * ARRIENDA la Sequence es deliberadamente estrecho (una sesión que tenga un
   * asiento registrado de este consejo); qué bytes se pinaron es cierto igual. Un
   * cosignatario que la app solo conoce como dirección registrada compone como
   * siempre — y sus bytes quedan marcados, así que su ceremonia también podrá
   * devolver el asiento en vez de tapiar la salida 24 h.
   */
  it('también cuando la sesión no puede ARRENDAR el asiento de Sequence', async () => {
    mockProvenAddresses.mockResolvedValue([]);
    mockProveMembership.mockResolvedValue({ owned: [], storeReadable: true, failure: null, refusal: null });

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(200);
    expect(mockCacheUpsert).not.toHaveBeenCalled(); // no arrendó
    expect(mockStamp).toHaveBeenCalledWith(MEMO, COUNCIL, 11, { sittingId: expect.any(String) }); // pero marcó
    // it. 34 (E): y el id viaja igual — quien no arrienda también libera por él.
    expect(res.body.sittingId).toBe(mockStamp.mock.calls[0][3].sittingId);
  });

  /**
   * it. 29 — LA CLASIFICACIÓN CORRE, Y CORRE SOBRE ESTE MEMO. Con la regla de 64
   * hex el clasificador soltaba `no-single-memo` antes de preguntarle nada a nadie:
   * ningún store llegaba a verse. Que se pregunte por ESTOS 84 hex es la prueba de
   * que la rama está viva.
   */
  it('el clasificador pregunta por el memo REAL de estos bytes, no lo tira por su longitud', async () => {
    mockQueuedHandoff.mockResolvedValue({ xrplAddress: COUNCIL, action: 'astryum-pote-exit', grossXrpDrops: '1000000' });

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });

    expect(res.status).toBe(200);
    expect(mockQueuedHandoff).toHaveBeenCalledWith(MEMO);
    expect(mockStamp).toHaveBeenCalledWith(MEMO, COUNCIL, 11, { sittingId: expect.any(String) });
  });

  it('unos bytes sin memo de 0xFE no marcan ningún asiento', async () => {
    const res = await request(buildApp())
      .post(URL)
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'SignerListSet', Account: COUNCIL } });

    expect(res.status).toBe(200);
    expect(mockStamp).not.toHaveBeenCalled();
  });

  /**
   * Una marca que no se puede escribir NUNCA tira la ceremonia: la puerta de
   * liberación queda tan cerrada como antes de it25 §4 (el asiento se suelta solo,
   * por su ventana), que es prudente — pero el consejo firma igual.
   */
  it('un store caído no impide componer la ceremonia', async () => {
    mockStamp.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp()).post(URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });
    expect(res.status).toBe(200);
    expect(res.body.multisigTx.Sequence).toBe(11);
  });
});

describe('zeroFeMemoOf — el memo de un 0xFE no tiene la forma de una orden de consejo', () => {
  it('lee la instrucción entera del Smart Account, no solo un keccak de 32 bytes', () => {
    expect(zeroFeMemoOf(zeroFeTx())).toBe(MEMO);
    expect(MEMO.length).toBeGreaterThan(64); // por esto `singleMemoHex` daba null hasta it. 29
  });

  /**
   * it. 29 — LAS DOS LECTURAS DEL MISMO MEMO NO PUEDEN VOLVER A SEPARARSE. La it. 27
   * escribió `zeroFeMemoOf` con el rango bueno JUSTO AL LADO de `singleMemoHex`, que
   * seguía en 64 hex — y el clasificador, que usa el segundo, quedó muerto un ciclo
   * entero sin que nadie lo notara. Este test es el cable entre los dos.
   */
  it('`zeroFeMemoOf` y `singleMemoHex` leen EXACTAMENTE el mismo memo', () => {
    expect(singleMemoHex(zeroFeTx())).toBe(zeroFeMemoOf(zeroFeTx()));
    const lower = { ...zeroFeTx(), Memos: [{ Memo: { MemoData: '0x' + MEMO.toLowerCase() } }] };
    expect(singleMemoHex(lower)).toBe(zeroFeMemoOf(lower));
    const noMemo = { TransactionType: 'SignerListSet', Account: COUNCIL };
    expect(singleMemoHex(noMemo)).toBe(zeroFeMemoOf(noMemo));
  });

  it('normaliza `0x` y minúsculas — el memo viaja como lo escriba quien lo escriba', () => {
    const tx = { ...zeroFeTx(), Memos: [{ Memo: { MemoData: '0x' + MEMO.toLowerCase() } }] };
    expect(zeroFeMemoOf(tx)).toBe(MEMO);
  });

  it('nada que no sea UN memo hexadecimal nombra un asiento', () => {
    expect(zeroFeMemoOf({ TransactionType: 'Payment' })).toBeNull();
    expect(zeroFeMemoOf({ Memos: [] })).toBeNull();
    expect(zeroFeMemoOf({ Memos: [{ Memo: { MemoData: 'no-es-hex' } }] })).toBeNull();
    expect(
      zeroFeMemoOf({ Memos: [{ Memo: { MemoData: MEMO } }, { Memo: { MemoData: MEMO } }] }),
    ).toBeNull();
    expect(zeroFeMemoOf(null)).toBeNull();
  });
});

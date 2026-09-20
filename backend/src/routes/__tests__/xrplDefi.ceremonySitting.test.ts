/**
 * productizer it. 34 (E) — LA CARRERA DEL BUS: UNA LIBERACIÓN TARDÍA BAJO UNA
 * CEREMONIA VIVA, PORQUE EL SERVIDOR NO DISTINGUÍA SITTINGS.
 *
 * LA PERSONA. Escape en `signing`: la limpieza de desmontaje dispara
 * `/multisign/release` fire-and-forget (`keepalive`) y el bus rechaza ABANDONED,
 * que desde it. 31 se lee como 'review' → la superficie ofrece firmar otra vez →
 * `sendIntent` → nuevo sitting → `/multisign/prepare` de la MISMA sesión y los
 * MISMOS bytes: `recordCeremonySeat` upserta el arriendo por cuenta y
 * `stampCeremonyPin` re-estampa la misma Sequence. Si la liberación del primero
 * aterriza DESPUÉS: suelta el arriendo (mismo usuario → `heldTheLease`), lee el
 * pin, sustituye el reloj (`holderEndedCeremony`), ventana `absent` → el asiento
 * de nonce queda LIBRE bajo la ceremonia que la familia sigue firmando. Cualquier
 * otro 0xFE de esa cuenta (otra pestaña, otro operador) compone encima.
 *
 * EL ARREGLO. `/multisign/prepare` genera un id de sitting, lo escribe en el
 * arriendo y en el pin y lo devuelve; `/multisign/release` exige el mismo: otro
 * id es un no-op (`stale-sitting`, `seat.released:false`, la fila no se toca).
 *
 * LA FASE, con el arriendo REAL (`councilProposals.releaseCeremonySeatFor`) y el
 * store REAL (`DirectMintHandoffStore`) sobre una base fingida en memoria: dos
 * prepares de la misma sesión sobre los mismos bytes, y la liberación del
 * primero llegando después del segundo. Mutación: quitar la comparación del id
 * en el arriendo (`ceremonySittingIsStale` en `releaseCeremonySeatFor`) o en el
 * pin (`releaseAbandonedCeremonySeat`) → el asiento se suelta → rojo.
 */
import express from 'express';
import request from 'supertest';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const PREPARE_URL = '/api/xrpl-defi/multisign/prepare';
const RELEASE_URL = '/api/xrpl-defi/multisign/release';
const SIGNERS = [
  { account: MEMBER_A, weight: 1 },
  { account: MEMBER_B, weight: 1 },
];

/* ── la base fingida: la tabla del 0xFE y la del arriendo, en memoria ────────── */
const mockRows: Array<{ id: number; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date }> = [];
const mockLeases = new Map<string, { data: unknown; tags: string[]; expiresAt: Date }>();
const mockDb = { down: false };

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    councilProposal: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
    },
    wallet: { findMany: jest.fn(async () => []) },
    cacheEntry: {
      findUnique: async ({ where }: { where: { cacheKey: string } }) => {
        if (mockDb.down) throw new Error('db down');
        const r = mockLeases.get(where.cacheKey);
        return r ? { data: r.data, expiresAt: r.expiresAt } : null;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { cacheKey: string };
        create: { data: unknown; tags: string[]; expiresAt: Date };
        update: { data: unknown; tags: string[]; expiresAt: Date };
      }) => {
        if (mockDb.down) throw new Error('db down');
        const cur = mockLeases.get(where.cacheKey);
        mockLeases.set(where.cacheKey, cur ? { ...cur, ...update } : { data: create.data, tags: create.tags, expiresAt: create.expiresAt });
        return {};
      },
      deleteMany: async ({ where }: { where: { cacheKey?: string; tags?: { has: string }; expiresAt?: { lt: Date } } }) => {
        if (mockDb.down) throw new Error('db down');
        if (where.cacheKey) return { count: mockLeases.delete(where.cacheKey) ? 1 : 0 };
        let count = 0;
        for (const [k, v] of mockLeases) {
          if (where.tags?.has && v.tags.includes(where.tags.has) && where.expiresAt?.lt && v.expiresAt < where.expiresAt.lt) {
            mockLeases.delete(k);
            count += 1;
          }
        }
        return { count };
      },
    },
    backgroundJob: {
      // La clasificación de salida del prepare lee «cualquier estado» por aquí; no
      // hay filas que no sean la nuestra, y la nuestra no es una salida (sin `action`).
      findMany: async () => (mockDb.down ? Promise.reject(new Error('db down')) : []),
      findFirst: async ({
        where,
      }: {
        where: { jobType: string; status?: string; payload?: { path: string[]; equals: unknown } };
      }) => {
        if (mockDb.down) throw new Error('db down');
        return (
          mockRows.find(
            (r) =>
              r.jobType === where.jobType &&
              (where.status === undefined || r.status === where.status) &&
              (!where.payload || r.payload[where.payload.path[0]] === where.payload.equals),
          ) ?? null
        );
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        if (mockDb.down) throw new Error('db down');
        const row = mockRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
  },
}));

jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: {
    getAccountSequence: jest.fn(async () => 11),
    getSignerCouncil: jest.fn(async () => ({ quorum: 2, masterKeyDisabled: true, signers: SIGNERS })),
  },
}));

const mockProvenAddresses = jest.fn<Promise<string[]>, unknown[]>();
const mockProveMembership = jest.fn();
jest.mock('../../services/identity/provenAddresses', () => ({
  ...jest.requireActual('../../services/identity/provenAddresses'),
  provenAddressesOf: (...a: unknown[]) => mockProvenAddresses(...a),
  provenAddressesDetailed: async () => ({ addresses: [MEMBER_A], floorReadable: true, failure: null }),
  proveMembership: (...a: unknown[]) => mockProveMembership(...a),
}));

const mockComposedOrder = jest.fn();
jest.mock('../../services/flare/ComposedCouncilOrderStore', () => ({
  ...jest.requireActual('../../services/flare/ComposedCouncilOrderStore'),
  getComposedCouncilOrderStrict: (...a: unknown[]) => mockComposedOrder(...a),
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readDirectMintParams: async () => ({ paymentAddress: 'rCoreVault111111111111111111111111' }),
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

/** El ledger, fingido en el transporte del store REAL: la ventana se lee entera y dice «ausente». */
const mockXrplJsonRpc = jest.fn(async (method: string, params: Record<string, unknown>) => {
  if (method === 'ledger') return { ledger_index: 90_000_100 };
  if (method === 'account_tx') {
    return { ledger_index_min: params.ledger_index_min, ledger_index_max: params.ledger_index_max, transactions: [] };
  }
  throw new Error(`unexpected rpc ${method}`);
});
jest.mock('../../services/flare/DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockXrplJsonRpc(...(a as [string, Record<string, unknown>])),
  xrplHttpEndpoints: () => [],
}));

const mockAuthority = jest.fn();
jest.mock('../../services/flare/handoffAuthority', () => ({
  ...jest.requireActual('../../services/flare/handoffAuthority'),
  sessionAuthorityOnXrplAccount: (...a: unknown[]) => mockAuthority(...a),
}));

jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: () => ({ allowed: true }) },
}));

import xrplDefiRouter from '../xrplDefi';
import { __resetSequenceCache } from '../councilProposals';
import { __resetUnwrittenCeremonyPins, ceremonyPinOf, stampCeremonyPin } from '../../services/flare/DirectMintHandoffStore';
import { handoffCeremonyExpiryMin } from '../../services/flare/handoffAuthority';

const zeroFeTx = () => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: 'rCoreVault111111111111111111111111',
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

/** Una fila de ceremonia recién compuesta para ese memo: ventana larga, sin firmar, sin pin. */
function queueCeremonyRow(over: Record<string, unknown> = {}): void {
  mockRows.length = 0;
  mockRows.push({
    id: 1,
    jobType: '0xfe-handoff',
    status: 'queued',
    createdAt: new Date(Date.now() - 60_000),
    payload: {
      memoHex: MEMO,
      xrplAddress: COUNCIL,
      userOpHash: '0x' + 'aa'.repeat(32),
      payloadExpiryMin: handoffCeremonyExpiryMin(),
      lastLedgerSequence: 90_021_600,
      composedLedgerIndex: 90_000_000,
      ...over,
    },
  });
}
const row = () => mockRows[0].payload;
const lease = () => mockLeases.get(`council-ceremony-seat:${COUNCIL}`)?.data as { sittingId?: string | null; preparedByUserId?: string | null } | undefined;

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
const app = buildApp();

/** «Sign now» — un prepare de la sesión sobre estos bytes; devuelve el nombre del sitting. */
async function prepareSitting(): Promise<string> {
  const res = await request(app).post(PREPARE_URL).send({ account: COUNCIL, xrplTx: zeroFeTx() });
  expect(res.status).toBe(200);
  expect(typeof res.body.sittingId).toBe('string');
  return res.body.sittingId as string;
}

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  __resetSequenceCache();
  __resetUnwrittenCeremonyPins();
  process.env = { ...ENV, DATABASE_URL: 'postgres://test', XRPL_DEFI_ENABLED: 'true', LEGACY_ENABLED: 'true' };
  mockDb.down = false;
  mockLeases.clear();
  queueCeremonyRow();
  mockPrepare.mockResolvedValue(pinned);
  mockComposedOrder.mockResolvedValue(null);
  // La sesión tiene un asiento PROBADO en este consejo: arrienda.
  mockProvenAddresses.mockResolvedValue([MEMBER_A]);
  mockProveMembership.mockImplementation(async (...a: unknown[]) => {
    const members = (a[2] as string[]) ?? [];
    return { owned: members.filter((m) => m === MEMBER_A), storeReadable: true, failure: null, refusal: null };
  });
  // Por defecto, la sesión NO prueba la cuenta: sin arriendo, la puerta del pin no se abre sola.
  mockAuthority.mockResolvedValue({ mayAct: false, refusal: null, failure: null, outcome: 'not-proven' });
});
afterAll(() => {
  process.env = ENV;
});

describe('(a) la carrera del bus — la liberación tardía del sitting #1 aterriza después del prepare del #2', () => {
  it('el prepare escribe el MISMO id en el arriendo, en el pin y en la respuesta; el siguiente prepare los sustituye', async () => {
    const first = await prepareSitting();
    expect(lease()?.sittingId).toBe(first);
    expect(row().ceremonySittingId).toBe(first);
    expect(ceremonyPinOf(row())).toBe(11);

    const second = await prepareSitting();
    expect(second).not.toBe(first);
    expect(lease()?.sittingId).toBe(second); // upsert por cuenta: el más reciente manda…
    expect(row().ceremonySittingId).toBe(second); // …y el pin, re-estampado, también
    expect(lease()?.preparedByUserId).toBe('user-1'); // misma sesión: lo que antes no se distinguía
  });

  it('la liberación con el id del sitting #1 es un NO-OP: 200 stale-sitting, el arriendo sigue, la fila sigue `queued`', async () => {
    const first = await prepareSitting();
    const second = await prepareSitting();

    // La limpieza de desmontaje del sitting #1 (keepalive), aterrizando ahora.
    const late = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: first });

    expect(late.status).toBe(200);
    expect(late.body.released).toBe(false);
    expect(late.body.reason).toBe('stale-sitting');
    expect(late.body.seat).toMatchObject({ released: false, reason: 'stale-sitting' });
    expect(String(late.body.seat.detail)).toMatch(/newer sitting/i);
    // NADA se tocó: el arriendo es del #2, la fila del 0xFE sigue en cola con el pin del #2.
    expect(lease()?.sittingId).toBe(second);
    expect(mockRows[0].status).toBe('queued');
    expect(row().ceremonySittingId).toBe(second);
    // …y ni siquiera se preguntó al ledger por la ventana: el pin no se abrió.
    expect(mockXrplJsonRpc).not.toHaveBeenCalled();
  });

  it('la liberación con el id del sitting VIVO (#2) sí suelta: arriendo fuera, fila superseded', async () => {
    await prepareSitting();
    const second = await prepareSitting();

    const res = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: second });

    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(res.body.seat).toMatchObject({ released: true, reason: 'ceremony-ended', pin: 'row' });
    expect(lease()).toBeUndefined();
    expect(mockRows[0].status).toBe('superseded');
  });

  it('el orden completo de la carrera: #1 prepara, #2 prepara, llega la tardía del #1 (no-op), y el #2 sigue pudiendo cancelar', async () => {
    const first = await prepareSitting();
    const second = await prepareSitting();
    const late = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: first });
    expect(late.body.reason).toBe('stale-sitting');
    expect(mockRows[0].status).toBe('queued');

    const own = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: second });
    expect(own.body.released).toBe(true);
    expect(own.body.seat.released).toBe(true);
    expect(mockRows[0].status).toBe('superseded');
  });

  /**
   * (b) «Back» en `preparing` + «Sign now» antes de que vuelva el prepare #1: el
   * prepare #1 aterriza en un sitting muerto y libera con SU id. Desde el servidor
   * es la misma secuencia que (a): dos prepares, y una liberación con el id del
   * primero. Lo que cambia es que ANTES de que vuelva el prepare #1, la limpieza
   * de aquel sitting libera con `sittingId: null` — un sitting sin nombre. Eso no
   * alcanza el arriendo ni el pin del #2, que sí lo tienen.
   */
  it('(b) un sitting SIN nombre (`sittingId: null`) no alcanza un arriendo ni un pin con nombre', async () => {
    const live = await prepareSitting();

    const res = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ released: false, reason: 'stale-sitting' });
    expect(lease()?.sittingId).toBe(live);
    expect(mockRows[0].status).toBe('queued');
  });

  /**
   * Sin arriendo (la sesión no tiene asiento registrado en este consejo, o ya
   * caducó) la puerta del pin sigue pidiendo PROBAR la cuenta — y, probada, el
   * pin también distingue sittings: el id viejo no lo abre.
   */
  it('sin arriendo y con la cuenta probada: el pin también rechaza el id del sitting anterior', async () => {
    mockProvenAddresses.mockResolvedValue([]);
    mockProveMembership.mockResolvedValue({ owned: [], storeReadable: true, failure: null, refusal: null });
    const first = await prepareSitting();
    const second = await prepareSitting();
    expect(lease()).toBeUndefined(); // nadie arrendó
    expect(row().ceremonySittingId).toBe(second);
    mockAuthority.mockResolvedValue({ mayAct: true, refusal: null, failure: null, outcome: 'proven' });

    const late = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: first });
    expect(late.status).toBe(200);
    expect(late.body.reason).toBe('no-seat');
    expect(late.body.seat).toMatchObject({ released: false, reason: 'stale-sitting', pin: 'row' });
    expect(mockRows[0].status).toBe('queued');

    const own = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: second });
    expect(own.body.seat).toMatchObject({ released: true, reason: 'ceremony-ended' });
    expect(mockRows[0].status).toBe('superseded');
  });

  it('el id de OTRA sesión sigue siendo NOT_THE_LESSEE antes que cualquier cosa: la propiedad va primero', async () => {
    const first = await prepareSitting();
    const stranger = buildApp('user-2');
    const res = await request(stranger).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: first });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_THE_LESSEE');
    expect(lease()?.sittingId).toBe(first);
    expect(mockRows[0].status).toBe('queued');
  });
});

describe('(c) control — compatibilidad con lo que había', () => {
  /**
   * Un cliente ANTERIOR a este campo no manda `sittingId`: para él la puerta es la
   * de siempre. Se conserva a propósito (un navegador sin recargar no puede quedarse
   * sin puerta 24 h); el precio es que ESE cliente sigue expuesto a la carrera, y
   * este test lo deja escrito en vez de fingir lo contrario.
   */
  it('sin `sittingId` en el cuerpo, la liberación se comporta como antes: suelta', async () => {
    await prepareSitting();
    await prepareSitting();

    const res = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO });

    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(res.body.seat.released).toBe(true);
    expect(mockRows[0].status).toBe('superseded');
  });

  it('un arriendo y un pin ANTERIORES al campo (sin nombre) los suelta cualquier id — no hay con qué comparar', async () => {
    // Lo que había en la base el día del despliegue: arriendo y pin sin `sittingId`.
    mockLeases.set(`council-ceremony-seat:${COUNCIL}`, {
      data: { account: COUNCIL, pinnedSequence: 11, txType: 'Payment', preparedAt: new Date().toISOString(), preparedByUserId: 'user-1' },
      tags: ['council-ceremony-seat'],
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    row().ceremonyPinnedSequence = 11;
    row().ceremonyPinnedAt = new Date().toISOString();

    const res = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: 'a-sitting-that-reloaded' });

    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(res.body.seat.released).toBe(true);
    expect(mockRows[0].status).toBe('superseded');
  });

  it('un `sittingId` que no es una cadena (ni null) es un cuerpo inválido', async () => {
    const res = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: 42 });
    expect(res.status).toBe(400);
  });

  it('el pin del tempo asíncrono (una PROPUESTA posterior sobre los mismos bytes) también deja obsoleta a la ceremonia', async () => {
    const first = await prepareSitting();
    // `POST /council-proposals` estampa el pin con el id de la propuesta (no arrienda).
    expect(await stampCeremonyPin(MEMO, COUNCIL, 11, { sittingId: 'proposal-p1' })).toEqual({ stamped: true });

    const res = await request(app).post(RELEASE_URL).send({ account: COUNCIL, memoHex: MEMO, sittingId: first });

    // El arriendo SÍ era de este sitting (la propuesta no arrienda) y se suelta;
    // el asiento de nonce, en cambio, es de la propuesta ahora — y se queda.
    expect(res.status).toBe(200);
    expect(res.body.released).toBe(true);
    expect(res.body.seat).toMatchObject({ released: false, reason: 'stale-sitting' });
    expect(mockRows[0].status).toBe('queued');
  });
});

/**
 * productizer it. 29 (§2) — EL TEMPO ASÍNCRONO PINA Y SUELTA IGUAL QUE EL SÍNCRONO.
 *
 * Dos coordinadores fijan una `Sequence` sobre una cuenta de consejo y componen el
 * mismo 0xFE: `/xrpl-defi/multisign/prepare` (la ceremonia en vivo) y
 * `POST /council-proposals` (la bandeja asíncrona). Desde it. 27 la puerta que
 * suelta el asiento de nonce antes de tiempo exige la MARCA del coordinador
 * (`stampCeremonyPin`) — y solo el primero la escribía. El segundo pinaba igual,
 * no marcaba nada, y retirar la propuesta (`POST /:id/withdraw`) escribía
 * `status: 'withdrawn'` sin tocar el asiento: aunque alguien cableara la llamada,
 * la puerta contestaba `not-pinned-by-us`. Un consejo que retiraba una propuesta
 * seguía sin poder componer su siguiente salida durante 24 h.
 *
 * Aquí se ejecuta la CADENA con el store REAL (`DirectMintHandoffStore`) sobre una
 * base fingida: se crea la propuesta y se mira la fila del 0xFE; se retira la
 * propuesta y se mira que la fila quede superseded y que la respuesta lo diga en el
 * mismo campo y con la misma gramática que la puerta de la ceremonia.
 */
import express from 'express';
import request from 'supertest';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const USER_ID = 'user-1';
const MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
/** The hash the node handed back to the emitting browser (uppercase, as the store keeps it). */
const HASH = 'C0DE'.repeat(16);
const SIGNERS = [
  { account: MEMBER_A, weight: 1 },
  { account: MEMBER_B, weight: 1 },
];

/* ── la base fingida: la tabla de propuestas y la del 0xFE, en memoria ────────── */
const mockRows: Array<{ id: number; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date }> = [];
const mockDb = { down: false };
const mockProposalFindUnique = jest.fn();
const mockProposalUpdate = jest.fn();
const mockProposalCreate = jest.fn();
const mockProposalFindFirst = jest.fn();
const mockProposalFindMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    councilProposal: {
      findFirst: (...a: unknown[]) => mockProposalFindFirst(...a),
      findMany: (...a: unknown[]) => mockProposalFindMany(...a),
      findUnique: (...a: unknown[]) => mockProposalFindUnique(...a),
      create: (...a: unknown[]) => mockProposalCreate(...a),
      update: (...a: unknown[]) => mockProposalUpdate(...a),
    },
    councilProposalSignature: { findMany: jest.fn(async () => []) },
    wallet: { findMany: jest.fn(async () => []) },
    cacheEntry: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    backgroundJob: {
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

const mockProvenAddresses = jest.fn<Promise<string[]>, unknown[]>();
const mockProveMembership = jest.fn();
jest.mock('../../services/identity/provenAddresses', () => ({
  ...jest.requireActual('../../services/identity/provenAddresses'),
  provenAddressesOf: (...a: unknown[]) => mockProvenAddresses(...a),
  provenAddressesDetailed: async () => ({ addresses: [MEMBER_A], floorReadable: true, failure: null }),
  proveMembership: (...a: unknown[]) => mockProveMembership(...a),
}));

jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: {
    getAccountSequence: jest.fn(async () => 11),
    getSignerCouncil: jest.fn(async () => ({ quorum: 2, masterKeyDisabled: true, signers: SIGNERS })),
  },
}));

const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplMultisigCoordinator'),
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
}));

/**
 * El ledger, fingido en el transporte que el store REAL usa: el validado está
 * dentro de la ventana de la fila y la cuenta no tiene ningún Payment con ese memo
 * — la ventana se lee ENTERA y dice «ausente».
 */
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

jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: () => ({ allowed: true }) },
}));

process.env.LEGACY_ENABLED = 'true';

import councilProposalsRouter, { __resetSequenceCache } from '../councilProposals';
import { __resetUnwrittenCeremonyPins, ceremonyPinOf } from '../../services/flare/DirectMintHandoffStore';
import { handoffCeremonyExpiryMin } from '../../services/flare/handoffAuthority';

/** El 0xFE que el consejo firma, tal y como lo devuelve el coordinador: Sequence FIJADA. */
const zeroFeTx = (over: Record<string, unknown> = {}) => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: 'rCoreVault111111111111111111111111',
  Amount: '1000000',
  Memos: [{ Memo: { MemoData: MEMO } }],
  ...over,
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

function liveProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    account: COUNCIL,
    createdByUserId: USER_ID,
    title: null,
    txType: 'Payment',
    txjson: pinned.multisigTx,
    quorum: 2,
    signerList: SIGNERS,
    status: 'collecting',
    txHash: null,
    positionsAnchor: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

function buildApp(userId: string | null = USER_ID) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: unknown }).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  app.use('/api/council/proposals', councilProposalsRouter);
  return app;
}

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  __resetSequenceCache();
  __resetUnwrittenCeremonyPins();
  process.env = { ...ENV, DATABASE_URL: 'postgres://test', XRPL_DEFI_ENABLED: 'true', LEGACY_ENABLED: 'true' };
  mockDb.down = false;
  queueCeremonyRow();
  mockProvenAddresses.mockResolvedValue([MEMBER_A]);
  mockProveMembership.mockImplementation(async (...a: unknown[]) => {
    const members = (a[2] as string[]) ?? [];
    return { owned: members.filter((m) => m === MEMBER_A), storeReadable: true, failure: null, refusal: null };
  });
  mockProposalFindFirst.mockResolvedValue(null);
  mockProposalFindMany.mockResolvedValue([]);
  mockPrepare.mockResolvedValue(pinned);
  mockProposalCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...liveProposal(),
    ...data,
    signatures: [],
  }));
});
afterAll(() => {
  process.env = ENV;
});

describe('POST /council-proposals — el segundo coordinador que pina, ahora MARCA', () => {
  it('crear la propuesta deja la fila del 0xFE marcada con la Sequence que el coordinador fijó', async () => {
    expect(ceremonyPinOf(row())).toBeNull();

    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: zeroFeTx(), title: 'Exit' });

    expect(res.status).toBe(201);
    expect(ceremonyPinOf(row())).toBe(11);
    expect(typeof row().ceremonyPinnedAt).toBe('string');
  });

  it('unos bytes sin 0xFE no marcan nada — no hay asiento de nonce que nombrar', async () => {
    mockPrepare.mockResolvedValue({
      ...pinned,
      multisigTx: { TransactionType: 'SignerListSet', Account: COUNCIL, Sequence: 11, SigningPubKey: '' },
    });
    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'SignerListSet', Account: COUNCIL } });

    expect(res.status).toBe(201);
    expect(ceremonyPinOf(row())).toBeNull();
  });

  /**
   * Best-effort, como en la ceremonia: la BD que rechaza la marca no deshace una
   * propuesta que ya existe. Y el hecho no se pierde: queda en la memoria del
   * proceso (it. 29 §3) para que la retirada pueda actuar sobre él.
   */
  it('una BD caída al marcar no tira la propuesta', async () => {
    mockDb.down = true;
    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: zeroFeTx(), title: 'Exit' });
    expect(res.status).toBe(201);
    expect(ceremonyPinOf(row())).toBeNull(); // no se pudo escribir…
    mockDb.down = false;
    const { unwrittenCeremonyPinOf } = await import('../../services/flare/DirectMintHandoffStore');
    expect(unwrittenCeremonyPinOf(MEMO, COUNCIL)).toBe(11); // …pero consta
  });
});

describe('POST /:id/withdraw — retirar la propuesta devuelve el asiento de nonce', () => {
  it('con la marca del coordinador, retirar suelta el asiento y lo dice en `seat`', async () => {
    // La propuesta se creó por la puerta de arriba: la fila lleva la marca.
    await request(buildApp()).post('/api/council/proposals').send({ account: COUNCIL, xrplTx: zeroFeTx() });
    expect(ceremonyPinOf(row())).toBe(11);

    mockProposalFindUnique.mockResolvedValue(liveProposal());
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));

    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('withdrawn');
    expect(res.body.seat).toMatchObject({ released: true, reason: 'ceremony-ended', pin: 'row' });
    expect(mockRows[0].status).toBe('superseded');
  });

  it('sin marca y con el payload vivo: la propuesta se retira igual, y `seat` dice la cuenta atrás — no una pared', async () => {
    // Fila anterior a it. 27 (o marcada desde otra réplica): sin pin.
    mockProposalFindUnique.mockResolvedValue(liveProposal());
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));

    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('withdrawn');
    expect(res.body.seat).toMatchObject({ released: false, reason: 'not-pinned-by-us', pin: 'none', code: 'WAIT_FOR_PAYLOAD_EXPIRY' });
    expect(res.body.seat.secondsLeft).toBeGreaterThan(0);
    expect(String(res.body.seat.detail)).toMatch(/no record/i);
    expect(String(res.body.seat.detail)).not.toMatch(/was not pinned by/i);
    expect(mockRows[0].status).toBe('queued');
  });

  it('la marca que la BD no dejó escribir al crear se recupera al retirar', async () => {
    mockDb.down = true;
    await request(buildApp()).post('/api/council/proposals').send({ account: COUNCIL, xrplTx: zeroFeTx() });
    mockDb.down = false;
    expect(ceremonyPinOf(row())).toBeNull();

    mockProposalFindUnique.mockResolvedValue(liveProposal());
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');

    expect(res.status).toBe(200);
    expect(res.body.seat).toMatchObject({ released: true, reason: 'ceremony-ended', pin: 'recovered' });
    expect(mockRows[0].status).toBe('superseded');
  });

  /**
   * productizer it. 33 (B1 del cuadro de la it. 32) — EL GEMELO DEL COORDINADOR ASÍNCRONO.
   *
   * El miembro B pulsa «Combine & broadcast» en la bandeja; el nodo devuelve el hash
   * y el navegador lo reporta a `/handoff/signed` (202 PENDING_LEDGER: la fila
   * RECUERDA el hash). Cuatro segundos después el proponente A, que sigue viendo la
   * fila `ready`, la retira para recomponer. Con el pin de la ceremonia,
   * `holderEndedCeremony` sustituye el reloj y la ventana se lee `absent` porque el
   * Payment aún no validó: sin el informe, el asiento se soltaba con el Payment en
   * vuelo y el siguiente prepare componía otro 0xFE sobre el mismo nonce.
   *
   * La FASE: la fila lleva el informe que escribe la ruta real
   * (`recordHandoffSignatureReport`), la ventana se lee entera y vacía, y la
   * retirada — que sigue siendo válida — NO suelta el asiento. Mutación: quitar el
   * informe (la línea que lo escribe) → `released: true` → rojo.
   */
  it('con un informe de firma en la fila (el emisor reportó el hash), retirar la propuesta NO suelta el asiento', async () => {
    await request(buildApp()).post('/api/council/proposals').send({ account: COUNCIL, xrplTx: zeroFeTx() });
    expect(ceremonyPinOf(row())).toBe(11);
    // Lo que `/handoff/signed` escribe cuando el nodo devolvió el hash y el ledger
    // aún no lo validó: el escritor REAL del store, sobre la misma fila.
    const { recordHandoffSignatureReport, reportedTxHashesOf } = await import('../../services/flare/DirectMintHandoffStore');
    expect(await recordHandoffSignatureReport(MEMO, HASH, { userId: 'user-2', proven: false })).toBe(true);
    expect(reportedTxHashesOf(row() as { reportedTxHash?: string; reportedTxHashes?: string[] })).toEqual([HASH]);
    // La ventana sigue leyéndose ENTERA y VACÍA (el Payment no ha validado): es
    // exactamente el hueco de 4-20 s en que el proponente retira.
    mockProposalFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));

    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('withdrawn'); // la retirada sigue siendo válida…
    expect(res.body.seat.released).toBe(false); // …lo que no suelta es el asiento
    expect(res.body.seat.pin).toBe('row');
    expect(res.body.seat.retryable).toBe(true); // el ledger decide: o muestra el Payment o cierra la ventana
    expect(String(res.body.seat.detail)).toMatch(/signature was reported/i);
    expect(String(res.body.seat.detail)).not.toMatch(/still signable/i);
    expect(mockRows[0].status).toBe('queued');
    // La ventana SÍ se leyó (entera y vacía): lo que retiene es el informe, no una lectura que faltó.
    expect(mockXrplJsonRpc.mock.calls.map((c) => c[0])).toContain('account_tx');
  });

  /**
   * productizer it. 34 (E) — EL TEMPO ASÍNCRONO USA EL MISMO NOMBRE: EL ID DE LA PROPUESTA.
   *
   * Crear la propuesta estampa el pin con `proposal.id`; retirarla lo devuelve por
   * ese nombre. Si OTRO sitting (una ceremonia en vivo, otra propuesta) volvió a
   * pinar esos bytes después, la propuesta se retira igual — pero su asiento ya no
   * es suyo: `seat.reason === 'stale-sitting'` y la fila no se toca. El test de
   * arriba («con la marca del coordinador, retirar suelta el asiento») es el
   * control con el id correcto. Mutación: quitar la comparación del id en
   * `releaseAbandonedCeremonySeat` → la retirada suelta el asiento del otro → rojo.
   */
  it('(d) crear la propuesta estampa el pin con el id de la PROPUESTA', async () => {
    const res = await request(buildApp()).post('/api/council/proposals').send({ account: COUNCIL, xrplTx: zeroFeTx() });
    expect(res.status).toBe(201);
    expect(res.body.proposal.id).toBe('p1');
    expect(row().ceremonySittingId).toBe('p1');
  });

  it('(d) retirar una propuesta cuyos bytes re-pinó un sitting POSTERIOR no suelta ese asiento: stale-sitting, fila `queued`', async () => {
    await request(buildApp()).post('/api/council/proposals').send({ account: COUNCIL, xrplTx: zeroFeTx() });
    expect(row().ceremonySittingId).toBe('p1');
    // La ceremonia en vivo (`/multisign/prepare`) re-estampa los mismos bytes con SU id.
    const { stampCeremonyPin } = await import('../../services/flare/DirectMintHandoffStore');
    expect(await stampCeremonyPin(MEMO, COUNCIL, 11, { sittingId: 'ceremony-sitting-2' })).toEqual({ stamped: true });

    mockProposalFindUnique.mockResolvedValue(liveProposal());
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('withdrawn'); // la retirada sigue siendo válida…
    expect(res.body.seat).toMatchObject({ released: false, reason: 'stale-sitting', pin: 'row' });
    expect(String(res.body.seat.detail)).toMatch(/newer sitting/i);
    expect(mockRows[0].status).toBe('queued'); // …lo que no suelta es el asiento del otro
    expect(row().ceremonySittingId).toBe('ceremony-sitting-2');
    // Y la ventana ni se leyó: el pin no se abrió.
    expect(mockXrplJsonRpc.mock.calls.map((c) => c[0])).not.toContain('account_tx');
  });

  it('(d) control: retirar con el pin de ESTA propuesta suelta — y la fila queda superseded', async () => {
    await request(buildApp()).post('/api/council/proposals').send({ account: COUNCIL, xrplTx: zeroFeTx() });
    mockProposalFindUnique.mockResolvedValue(liveProposal());
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');
    expect(res.body.seat).toMatchObject({ released: true, reason: 'ceremony-ended', pin: 'row' });
    expect(mockRows[0].status).toBe('superseded');
  });

  it('una propuesta cuyos bytes no son un 0xFE se retira sin campo `seat`', async () => {
    mockProposalFindUnique.mockResolvedValue(
      liveProposal({ txjson: { TransactionType: 'SignerListSet', Account: COUNCIL, Sequence: 11 } }),
    );
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');
    expect(res.status).toBe(200);
    expect(res.body.seat).toBeUndefined();
  });

  /**
   * «No pude leer» no cambia el veredicto de la retirada ni se pinta verde: la
   * propuesta queda retirada y el asiento se cuenta como ilegible, reintentable.
   */
  it('una BD caída al soltar: la retirada sigue siendo retirada, y el asiento se dice ilegible', async () => {
    await request(buildApp()).post('/api/council/proposals').send({ account: COUNCIL, xrplTx: zeroFeTx() });
    mockProposalFindUnique.mockResolvedValue(liveProposal());
    mockProposalUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    mockDb.down = true;

    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');

    expect(res.status).toBe(200);
    expect(res.body.proposal.status).toBe('withdrawn');
    expect(res.body.seat).toMatchObject({ released: false, code: 'SEAT_STATE_UNREADABLE', retryable: true });
  });
});

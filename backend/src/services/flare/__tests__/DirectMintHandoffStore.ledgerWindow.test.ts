/**
 * productizer-it15 §K1 — las lecturas de ledger con las que se decide un asiento
 * de nonce, y la lápida de un Payment que entró y falló.
 *
 * `readHandoffMemoWindow` es la ÚNICA lectura con la que se puede concluir que un
 * 0xFE firmado no existe — y por tanto reutilizar su asiento. Por eso exige las
 * tres cosas que separan «no está» de «no lo vi»: nodo fresco, el rango que el
 * nodo dice haber buscado cubre el pedido, y el marcador agotado. Cualquier duda
 * es 'unreadable', jamás 'absent'.
 *
 * `markHandoffLedgerFailedByMemo` libera el asiento de un `tec`: la tx consumió
 * el Sequence XRPL pero no entregó XRP al Core Vault, y FAssets exige
 * `status == PAYMENT_SUCCESS` (DirectMintingFacet → verifyXRPPaymentSuccess), así
 * que ese dispatch no puede ejecutar jamás.
 */
const mockRows: Array<{ id: number; jobType: string; status: string; payload: Record<string, unknown>; createdAt: Date }> = [];
/** productizer-it21 §P1 1.2/1.4 — la BD caída, que es el mundo que estos arreglos describen. */
const mockDb = { down: false };
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
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
      findMany: async ({ where }: { where: { jobType: string; status?: string } }) => {
        if (mockDb.down) throw new Error('db down');
        return mockRows.filter(
          (r) => r.jobType === where.jobType && (where.status === undefined || r.status === where.status),
        );
      },
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        if (mockDb.down) throw new Error('db down');
        const row = mockRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  },
}));

const mockRpc = jest.fn();
jest.mock('../DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockRpc(...a),
}));

import {
  classifyHandoffRelease,
  findQueuedHandoffByMemo,
  listParked0xFe,
  markHandoffLedgerFailedByMemo,
  markHandoffSignedByMemo,
  readHandoffMemoWindow,
  readValidatedLedgerIndex,
  releaseQueuedHandoffByMemo,
  releaseQueuedHandoffDetailed,
  stampHandoffPayloadExpiry,
} from '../DirectMintHandoffStore';

const MEMO = 'FE' + 'AB'.repeat(20);
const OWNER = 'rOwnerXrplAccount';
const HASH = 'a'.repeat(64);
const WINDOW = { ledgerIndexMin: 100, ledgerIndexMax: 200 };
const rec = { xrplAddress: OWNER, memoHex: MEMO };

/** Una entrada de account_tx (api v1: `tx` plano; v2 la anida en `tx_json`). */
const entry = (over: { account?: string; memo?: string; result?: string; type?: string; v2?: boolean; hash?: string } = {}) => {
  const tx = {
    TransactionType: over.type ?? 'Payment',
    Account: over.account ?? OWNER,
    Destination: 'rCoreVault111111111111111111111111',
    Amount: '20000000',
    Memos: [{ Memo: { MemoData: over.memo ?? MEMO } }],
    hash: over.hash ?? HASH.toUpperCase(),
  };
  const top = { meta: { TransactionResult: over.result ?? 'tesSUCCESS' }, validated: true, hash: over.hash ?? HASH.toUpperCase() };
  return over.v2 ? { ...top, tx_json: tx } : { ...top, tx };
};
const page = (transactions: unknown[], over: Record<string, unknown> = {}) => ({
  ledger_index_min: 100,
  ledger_index_max: 200,
  transactions,
  ...over,
});

const SAVED = process.env.DATABASE_URL;
beforeEach(() => {
  mockRows.length = 0;
  mockDb.down = false;
  jest.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://fake';
});
afterAll(() => {
  if (SAVED === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = SAVED;
});

const queuedRow = (payload: Record<string, unknown> = {}, status = 'queued') => {
  const row = {
    id: mockRows.length + 1,
    jobType: '0xfe-handoff',
    status,
    createdAt: new Date(),
    payload: { memoHex: MEMO, userOpHash: '0x' + '11'.repeat(32), xrplAddress: OWNER, ...payload },
  };
  mockRows.push(row);
  return row;
};

describe('readValidatedLedgerIndex', () => {
  it('reads the validated index on a FRESH node (both rippled shapes)', async () => {
    mockRpc.mockResolvedValue({ ledger_index: 90_000_123 });
    expect(await readValidatedLedgerIndex()).toBe(90_000_123);
    expect(mockRpc).toHaveBeenCalledWith('ledger', { ledger_index: 'validated' }, undefined, { requireFresh: true });

    mockRpc.mockResolvedValue({ ledger: { ledger_index: 90_000_124 } });
    expect(await readValidatedLedgerIndex()).toBe(90_000_124);
  });

  it('an unreadable ledger is null — never a guessed window', async () => {
    mockRpc.mockRejectedValue(new Error('xrpl_endpoint_stale'));
    expect(await readValidatedLedgerIndex()).toBeNull();
    mockRpc.mockResolvedValue({ ledger_index: 'not a number' });
    expect(await readValidatedLedgerIndex()).toBeNull();
    mockRpc.mockResolvedValue({});
    expect(await readValidatedLedgerIndex()).toBeNull();
  });
});

describe('readHandoffMemoWindow — «no está» solo tras leerla entera', () => {
  it('a complete read without the memo is ABSENT (marker drained, fresh node, full range)', async () => {
    mockRpc.mockResolvedValue(page([entry({ memo: 'FE' + 'CD'.repeat(20) }), entry({ account: 'rSomebodyElse' })]));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toEqual({ state: 'absent', rowsRead: 2 });
    expect(mockRpc).toHaveBeenCalledWith(
      'account_tx',
      { account: OWNER, ledger_index_min: 100, ledger_index_max: 200, limit: 200, forward: true },
      undefined,
      { requireFresh: true },
    );
  });

  it('paginates until the marker is gone, and the memo found on a later page wins', async () => {
    mockRpc
      .mockResolvedValueOnce(page([entry({ memo: 'FE' + 'CD'.repeat(20) })], { marker: 'next' }))
      .mockResolvedValueOnce(page([entry()]));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toEqual({ state: 'signed', txHash: HASH.toUpperCase(), ledgerResult: 'tesSUCCESS' });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect((mockRpc.mock.calls[1][1] as { marker?: unknown }).marker).toBe('next');
  });

  it('a tec* with that memo is FAILED, and a tesSUCCESS later in the window still beats it', async () => {
    mockRpc.mockResolvedValue(page([entry({ result: 'tecUNFUNDED_PAYMENT' })]));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toEqual({
      state: 'failed',
      txHash: HASH.toUpperCase(),
      ledgerResult: 'tecUNFUNDED_PAYMENT',
    });

    mockRpc.mockResolvedValue(page([entry({ result: 'tecPATH_DRY' }), entry({ hash: 'B'.repeat(64), v2: true })]));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toMatchObject({ state: 'signed', txHash: 'B'.repeat(64) });
  });

  it('a node that served a NARROWER range is unreadable — a shallow history is not an absence', async () => {
    mockRpc.mockResolvedValue(page([], { ledger_index_min: 150 }));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toMatchObject({ state: 'unreadable' });
    mockRpc.mockResolvedValue(page([], { ledger_index_max: 180 }));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toMatchObject({ state: 'unreadable' });
  });

  it('a node that does not state the range it searched is unreadable', async () => {
    mockRpc.mockResolvedValue({ transactions: [] });
    expect(await readHandoffMemoWindow(rec, WINDOW)).toMatchObject({ state: 'unreadable' });
  });

  it('a transport failure is unreadable, with the reason attached', async () => {
    mockRpc.mockRejectedValue(new Error('xrpl_http_429'));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toEqual({ state: 'unreadable', detail: 'ledger read: xrpl_http_429' });
  });

  it('a page cap never turns into an absence', async () => {
    mockRpc.mockResolvedValue(page([], { marker: 'always-more' }));
    expect(await readHandoffMemoWindow(rec, WINDOW)).toMatchObject({ state: 'unreadable' });
  });

  it('a malformed window or an empty memo is unreadable, and reads nothing', async () => {
    expect(await readHandoffMemoWindow(rec, { ledgerIndexMin: 200, ledgerIndexMax: 100 })).toMatchObject({ state: 'unreadable' });
    expect(await readHandoffMemoWindow({ xrplAddress: OWNER, memoHex: '' }, WINDOW)).toMatchObject({ state: 'unreadable' });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

/**
 * productizer-it17 §L1 (it16 R1 1.3) — la lectura de la ventana ROTA DE NODO.
 * `xrplJsonRpc` solo rota ante error de transporte o `status:'error'`; un nodo que
 * responde BIEN con historia corta daba 'unreadable', y 'unreadable' no libera
 * jamás un asiento: la salida del usuario quedaba tapiada por UN servidor.
 */
describe('readHandoffMemoWindow — un nodo corto no tapia el asiento', () => {
  const stub = jest.fn();
  const endpoints = ['https://node-a', 'https://node-b', 'https://node-c'];

  beforeEach(() => stub.mockReset());

  it('retries on another endpoint when the first serves a narrower range', async () => {
    stub
      .mockResolvedValueOnce(page([], { ledger_index_min: 150 })) // historia corta
      .mockResolvedValueOnce(page([entry()])); // el segundo nodo sí la tiene
    expect(await readHandoffMemoWindow(rec, WINDOW, { rpc: stub, endpoints })).toMatchObject({ state: 'signed' });
    expect(stub).toHaveBeenCalledTimes(2);
    expect(stub.mock.calls[0][2]).toBeUndefined(); // el primer intento usa la rotación propia
    expect(stub.mock.calls[1][2]).toBe('https://node-a'); // luego ancla uno distinto
  });

  it('a 429 on one node does not decide the seat either', async () => {
    stub.mockRejectedValueOnce(new Error('xrpl_http_429')).mockResolvedValueOnce(page([]));
    expect(await readHandoffMemoWindow(rec, WINDOW, { rpc: stub, endpoints })).toMatchObject({ state: 'absent' });
  });

  it('when no node can read it, the verdict is still unreadable — and says how many were tried', async () => {
    stub.mockResolvedValue(page([], { ledger_index_min: 150 }));
    const out = await readHandoffMemoWindow(rec, WINDOW, { rpc: stub, endpoints });
    expect(out).toMatchObject({ state: 'unreadable' });
    expect((out as { detail: string }).detail).toMatch(/4 XRPL endpoints tried/);
    expect(stub).toHaveBeenCalledTimes(4); // sin preferido + 3 endpoints
  });
});

describe('classifyHandoffRelease — soltar antes de tiempo ES el gemelo (§L1)', () => {
  const now = Date.parse('2026-09-14T12:00:00.000Z');
  const base = { createdAt: new Date(now - 60_000), lastLedgerSequence: 90_000_100 };

  it('waits while the Xaman payload can still be signed, and says how long', () => {
    const v = classifyHandoffRelease(
      { ...base, payloadExpiresAt: new Date(now + 120_000).toISOString() },
      { nowMs: now, validatedLedgerIndex: 90_000_000 },
    );
    expect(v.release).toBe(false);
    expect(v.code).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
    expect(v.secondsLeft).toBe(120);
    expect(v.lastLedgerSequence).toBe(90_000_100);
    expect(v.detail).toMatch(/still signable in Xaman/);
  });

  // productizer-it19 §M1 1.3 — EL RELOJ NO BASTA. Un Payment firmado al minuto 4
  // y validado al 5:02 existe aunque el payload haya caducado: soltar su asiento
  // por reloj es el gemelo (it18 R1 1.3). Hace falta además que la ventana del
  // memo se haya leído ENTERA sin él.
  it('the clock alone never frees it: the memo window must have been read absent (a)', () => {
    const expired = { ...base, payloadExpiresAt: new Date(now - 1000).toISOString() };
    const unread = classifyHandoffRelease(expired, { nowMs: now, validatedLedgerIndex: 90_000_000 });
    expect(unread.release).toBe(false);
    expect(unread.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(unread.needsWindow).toBe(true); // «léela y vuelve a preguntar»
    expect(
      classifyHandoffRelease(expired, { nowMs: now, validatedLedgerIndex: 90_000_000, windowState: 'absent' }),
    ).toEqual({ release: true, reason: 'payload-expired' });
    // …y una ventana ilegible (recién pasada) no suelta nada.
    expect(
      classifyHandoffRelease(expired, { nowMs: now, validatedLedgerIndex: 90_000_000, windowState: 'unreadable' }).release,
    ).toBe(false);
  });

  it('frees it once the ledger passed its LastLedgerSequence and the window came back absent (b)', () => {
    const v = classifyHandoffRelease(
      { ...base, payloadExpiresAt: new Date(now + 120_000).toISOString() },
      { nowMs: now, validatedLedgerIndex: 90_000_101, windowState: 'absent' },
    );
    expect(v).toEqual({ release: true, reason: 'window-passed' });
  });

  it('a window that shows the Payment landed is a SIGNED seat, not a free one', () => {
    const v = classifyHandoffRelease(
      { ...base, payloadExpiresAt: new Date(now - 1000).toISOString() },
      { nowMs: now, validatedLedgerIndex: 90_000_101, windowState: 'signed' },
    );
    expect(v.release).toBe(false);
    expect(v.code).toBe('NONCE_SEAT_TAKEN_SIGNED');
  });

  // it17 §1.3, ahora también al liberar: un nodo caído no puede tapiar un asiento
  // para siempre. Pasada su ventana + el margen, se suelta.
  it('an unreadable window long past its ledger frees itself all the same', () => {
    const v = classifyHandoffRelease(
      { createdAt: new Date(now - 90 * 60_000), lastLedgerSequence: 90_000_100, composedLedgerIndex: 90_000_010 },
      { nowMs: now, validatedLedgerIndex: 90_000_200, windowState: 'unreadable' },
    );
    expect(v).toEqual({ release: true, reason: 'window-long-past' });
  });

  it('a row with no window keeps the old rule (c)', () => {
    expect(classifyHandoffRelease({ createdAt: new Date(now) }, { nowMs: now, validatedLedgerIndex: null })).toEqual({
      release: true,
      reason: 'no-window',
    });
  });

  it('a reported or signed payment is never freed by expiry', () => {
    expect(
      classifyHandoffRelease(
        { ...base, payloadExpiresAt: new Date(now - 1000).toISOString(), reportedTxHash: HASH.toUpperCase() },
        { nowMs: now, validatedLedgerIndex: 90_000_000, windowState: 'absent' },
      ).code,
    ).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
    expect(classifyHandoffRelease({ ...base, signedAt: '2026-09-14T11:59:00.000Z' }, { nowMs: now, validatedLedgerIndex: null }).code).toBe(
      'NONCE_SEAT_TAKEN_SIGNED',
    );
    expect(classifyHandoffRelease({ ...base }, { nowMs: now, validatedLedgerIndex: null, reportBlocks: true }).code).toBe(
      'NONCE_SEAT_TAKEN_REPORTED',
    );
  });

  it('rows composed before it17 date the payload from their own createdAt', () => {
    const old = { createdAt: new Date(now - 6 * 60_000), lastLedgerSequence: 90_000_100 };
    expect(
      classifyHandoffRelease(old, { nowMs: now, validatedLedgerIndex: 90_000_000, windowState: 'absent' }).release,
    ).toBe(true);
    const young = { createdAt: new Date(now - 60_000), lastLedgerSequence: 90_000_100 };
    const live = classifyHandoffRelease(young, { nowMs: now, validatedLedgerIndex: 90_000_000, windowState: 'absent' });
    expect(live.release).toBe(false);
    expect(live.code).toBe('WAIT_FOR_PAYLOAD_EXPIRY'); // su payload aún puede firmarse
  });
});

describe('releaseQueuedHandoffByMemo — la fila solo sale de «queued» cuando ya no se puede firmar', () => {
  it('refuses inside the live window and leaves the row queued', async () => {
    const row = queuedRow({ lastLedgerSequence: 90_000_100, payloadExpiresAt: new Date(Date.now() + 90_000).toISOString() });
    const out = await releaseQueuedHandoffDetailed(MEMO, { validatedLedgerIndex: 90_000_000 });
    expect(out.released).toBe(false);
    expect(out.verdict?.code).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
    expect(row.status).toBe('queued');
  });

  // productizer-it19 §M1 1.3 — caducado NO basta: antes de soltar, se lee la
  // ventana del memo. Si vuelve vacía, se suelta; si no se pudo leer, se espera.
  it('frees it after the payload expired unsigned AND its window came back empty', async () => {
    const row = queuedRow({
      lastLedgerSequence: 90_000_100,
      composedLedgerIndex: 90_000_000,
      payloadExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const readWindow = jest.fn(async () => ({ state: 'absent' as const, rowsRead: 2 }));
    expect(await releaseQueuedHandoffByMemo(MEMO, { validatedLedgerIndex: 90_000_050, readWindow })).toBe(true);
    expect(readWindow).toHaveBeenCalledWith(expect.objectContaining({ memoHex: MEMO }), {
      ledgerIndexMin: 90_000_000,
      ledgerIndexMax: 90_000_050,
    });
    expect(row.status).toBe('superseded');
  });

  it('…and never on the clock alone when that window could not be read', async () => {
    const row = queuedRow({
      lastLedgerSequence: 90_000_100,
      composedLedgerIndex: 90_000_000,
      payloadExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const readWindow = jest.fn(async () => ({ state: 'unreadable' as const, detail: 'no fresh node answered' }));
    const out = await releaseQueuedHandoffDetailed(MEMO, { validatedLedgerIndex: 90_000_050, readWindow });
    expect(out.released).toBe(false);
    expect(out.verdict?.code).toBe('NONCE_SEAT_UNREADABLE');
    expect(out.verdict?.retryable).toBe(true);
    expect(row.status).toBe('queued');
  });

  it('a window that shows the Payment landed leaves the seat taken, not freed', async () => {
    const row = queuedRow({
      lastLedgerSequence: 90_000_100,
      composedLedgerIndex: 90_000_000,
      payloadExpiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const readWindow = jest.fn(async () => ({ state: 'signed' as const, txHash: HASH.toUpperCase(), ledgerResult: 'tesSUCCESS' }));
    const out = await releaseQueuedHandoffDetailed(MEMO, { validatedLedgerIndex: 90_000_050, readWindow });
    expect(out.released).toBe(false);
    expect(out.verdict?.code).toBe('NONCE_SEAT_TAKEN_SIGNED');
    expect(row.status).toBe('queued');
  });

  it('never frees a signed one, however expired its payload', async () => {
    const row = queuedRow({
      signedAt: new Date().toISOString(),
      lastLedgerSequence: 90_000_100,
      payloadExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await releaseQueuedHandoffByMemo(MEMO)).toBe(false);
    expect(row.status).toBe('queued');
  });

  it('the server flow whose 0xFE never left this backend frees it at once', async () => {
    const row = queuedRow({ lastLedgerSequence: 90_000_100, payloadExpiresAt: new Date(Date.now() + 90_000).toISOString() });
    expect(await releaseQueuedHandoffByMemo(MEMO, { neverHandedOut: true })).toBe(true);
    expect(row.status).toBe('superseded');
  });

  it('a row with no window still frees itself the old way, with no ledger read', async () => {
    const row = queuedRow();
    mockRpc.mockRejectedValue(new Error('no node'));
    expect(await releaseQueuedHandoffByMemo(MEMO)).toBe(true);
    expect(row.status).toBe('superseded');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

/**
 * productizer-it19 (contrato C2) — el reloj del asiento lo pone quien CREA el
 * payload, y el servidor lo acota. Nadie puede alargar un asiento diciendo que su
 * payload vive 24 horas (la ceremonia multifirma pide `expire: 1440`): pasada la
 * LastLedgerSequence ese Payment no entra ni firmado.
 */
describe('stampHandoffPayloadExpiry — hacia adelante, y nunca más allá de la ventana', () => {
  const created = () => mockRows[0].createdAt.getTime();

  it('moves the clock forward when the payload was created later than the compose', async () => {
    const row = queuedRow({
      composedLedgerIndex: 90_000_000,
      lastLedgerSequence: 90_000_090, // ventana de 90 ledgers ≈ 6 min
      payloadExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const wanted = new Date(Date.now() + 4 * 60_000).toISOString();
    const out = await stampHandoffPayloadExpiry(MEMO, wanted);
    expect(out.stamped).toBe(true);
    expect(out.payloadExpiresAt).toBe(wanted);
    expect(row.payload.payloadExpiresAt).toBe(wanted);
  });

  it('a 24-hour payload is capped at the ledger window, not written as a day', async () => {
    const row = queuedRow({
      composedLedgerIndex: 90_000_000,
      lastLedgerSequence: 90_000_090,
      payloadExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const out = await stampHandoffPayloadExpiry(MEMO, new Date(Date.now() + 24 * 3600_000).toISOString());
    expect(out.stamped).toBe(true);
    // techo = createdAt + 90 ledgers × 4 s = 6 min (y como mucho «ahora + 5 min»)
    expect(Date.parse(out.payloadExpiresAt as string)).toBeLessThanOrEqual(created() + 90 * 4000);
    expect(Date.parse(row.payload.payloadExpiresAt as string)).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
  });

  it('never moves it backwards, and never touches a signed row', async () => {
    const forward = new Date(Date.now() + 4 * 60_000).toISOString();
    const row = queuedRow({ composedLedgerIndex: 90_000_000, lastLedgerSequence: 90_000_090, payloadExpiresAt: forward });
    const back = await stampHandoffPayloadExpiry(MEMO, new Date(Date.now() + 30_000).toISOString());
    expect(back).toMatchObject({ stamped: false, reason: 'not-forward' });
    expect(row.payload.payloadExpiresAt).toBe(forward);

    mockRows.length = 0;
    const signed = queuedRow({ signedAt: new Date().toISOString(), payloadExpiresAt: forward });
    expect(await stampHandoffPayloadExpiry(MEMO, new Date(Date.now() + 5 * 60_000).toISOString())).toMatchObject({
      stamped: false,
      reason: 'signed',
    });
    expect(signed.payload.payloadExpiresAt).toBe(forward);
  });

  it('an unknown memo, a junk instant or no DB write nothing', async () => {
    queuedRow({ lastLedgerSequence: 90_000_090 });
    expect(await stampHandoffPayloadExpiry('FE' + 'CD'.repeat(20), new Date().toISOString())).toMatchObject({ reason: 'no-row' });
    expect(await stampHandoffPayloadExpiry(MEMO, 'not an instant')).toMatchObject({ stamped: false, reason: 'unparseable' });
    delete process.env.DATABASE_URL;
    expect(await stampHandoffPayloadExpiry(MEMO, new Date().toISOString())).toMatchObject({ stamped: false });
  });
});

describe('markHandoffLedgerFailedByMemo — el tec libera el asiento', () => {
  it('takes the row out of «queued» and writes why it died, without deleting it', async () => {
    const row = queuedRow();
    expect(await markHandoffLedgerFailedByMemo(MEMO, HASH, 'tecUNFUNDED_PAYMENT')).toBe(true);
    expect(row.status).toBe('superseded');
    expect(row.payload.ledgerFailedResult).toBe('tecUNFUNDED_PAYMENT');
    expect(row.payload.ledgerFailedTxHash).toBe(HASH.toUpperCase());
    expect(typeof row.payload.ledgerFailedAt).toBe('string');
    expect(row.payload.userOpHash).toBeDefined(); // los bytes siguen localizables
  });

  it('a row signed with a REAL success is never freed by this door', async () => {
    const row = queuedRow({ signedAt: '2026-09-14T10:00:00.000Z', signedLedgerResult: 'tesSUCCESS' });
    expect(await markHandoffLedgerFailedByMemo(MEMO, HASH, 'tecPATH_DRY')).toBe(false);
    expect(row.status).toBe('queued');
  });

  it('a row the executor sweep marked (no result recorded) is not freed either', async () => {
    const row = queuedRow({ signedAt: '2026-09-14T10:00:00.000Z' });
    expect(await markHandoffLedgerFailedByMemo(MEMO, HASH, 'tecNO_DST')).toBe(false);
    expect(row.status).toBe('queued');
  });

  it('a row already marked tec IS freed (it13 rows that took the seat for good)', async () => {
    const row = queuedRow({ signedAt: '2026-09-14T10:00:00.000Z', signedLedgerResult: 'tecUNFUNDED_PAYMENT' });
    expect(await markHandoffLedgerFailedByMemo(MEMO, HASH, 'tecUNFUNDED_PAYMENT')).toBe(true);
    expect(row.status).toBe('superseded');
  });

  it('an unknown memo or no DB writes nothing', async () => {
    expect(await markHandoffLedgerFailedByMemo('FE' + 'CD'.repeat(20), HASH, 'tecNO_DST')).toBe(false);
    delete process.env.DATABASE_URL;
    expect(await markHandoffLedgerFailedByMemo(MEMO, HASH, 'tecNO_DST')).toBe(false);
  });
});

describe('markHandoffSignedByMemo — un tec JAMÁS es «firmada»', () => {
  it('refuses a tec result and leaves the row untouched', async () => {
    const row = queuedRow();
    expect(await markHandoffSignedByMemo(MEMO, HASH, 'tecUNFUNDED_PAYMENT')).toBe(false);
    expect(row.payload.signedAt).toBeUndefined();
    expect(row.status).toBe('queued');
  });

  it('still marks a tesSUCCESS, with its ledger result', async () => {
    const row = queuedRow();
    expect(await markHandoffSignedByMemo(MEMO, HASH, 'tesSUCCESS')).toBe(true);
    expect(typeof row.payload.signedAt).toBe('string');
    expect(row.payload.signedLedgerResult).toBe('tesSUCCESS');
  });
});

/**
 * productizer-it21 §P1 1.2 (contrato C1) — «NO PUDE LEER» NO ES «NO HABÍA NADA».
 *
 * El `catch` del release devolvía `{ released: false }` PELADO. La ruta lo
 * contestaba 200, la pantalla lo leía «no había asiento que liberar» y ofrecía
 * preparar otra orden: se componía a ciegas sobre un nonce que podía seguir
 * ocupado, con su payload vivo en un móvil. Es la lección de `kvUpsert` otra vez,
 * en código nuestro de la iteración anterior.
 */
describe('releaseQueuedHandoffDetailed — la BD caída sale TIPADA, no como «nada que liberar»', () => {
  it('un fallo de lectura devuelve el veredicto SEAT_STATE_UNREADABLE, reintentable', async () => {
    queuedRow({ lastLedgerSequence: 90_000_100, payloadExpiresAt: new Date(Date.now() - 1000).toISOString() });
    mockDb.down = true;

    const out = await releaseQueuedHandoffDetailed(MEMO, { validatedLedgerIndex: 90_000_050 });
    expect(out.released).toBe(false);
    expect(out.verdict?.code).toBe('SEAT_STATE_UNREADABLE');
    expect(out.verdict?.retryable).toBe(true);
    expect(out.verdict?.release).toBe(false);
    expect(out.verdict?.detail).toMatch(/could not read/i);
  });

  it('…y un memo que de verdad no existe sigue siendo un «nada que liberar» sin veredicto', async () => {
    const out = await releaseQueuedHandoffDetailed('FE' + 'CD'.repeat(20));
    expect(out.released).toBe(false);
    expect(out.verdict).toBeUndefined(); // la BD contestó: no hay fila, y eso es un hecho
  });
});

/**
 * productizer-it21 §P1 1.2 — el mismo `null` que mentía en la otra lectura: las
 * tres rutas del handoff preguntan por aquí antes de decidir.
 */
describe('findQueuedHandoffByMemo — estricta cuando la respuesta decide un asiento', () => {
  it('con `strict` un fallo de BD LANZA, en vez de parecer «no hay fila»', async () => {
    queuedRow();
    mockDb.down = true;
    await expect(findQueuedHandoffByMemo(MEMO, { strict: true })).rejects.toMatchObject({
      code: 'SEAT_STATE_UNREADABLE',
    });
  });

  it('sin `strict` sigue degradando a null (llamadores que solo enriquecen una vista)', async () => {
    queuedRow();
    mockDb.down = true;
    expect(await findQueuedHandoffByMemo(MEMO)).toBeNull();
  });

  it('y con la BD en pie devuelve la fila, estricta o no', async () => {
    queuedRow();
    expect((await findQueuedHandoffByMemo(MEMO, { strict: true }))?.memoHex).toBe(MEMO);
  });
});

/**
 * productizer-it21 §P1 1.4 — LOS APARCADOS NO RESUCITAN POR UN PARPADEO.
 *
 * `kvList` convierte cualquier fallo en `[]`, y el guard de asiento usa esta
 * lista para EXCLUIR filas aparcadas: vacía por un parpadeo, un dispatch muerto
 * volvía a ocupar el asiento y una SALIDA moría en `NONCE_SEAT_TAKEN_SIGNED`, no
 * reintentable (el incidente del 12-sep).
 */
describe('listParked0xFe — estricta para quien decide un asiento', () => {
  const parkedRow = () => {
    mockRows.push({
      id: mockRows.length + 1,
      jobType: '0xfe-parked',
      status: 'completed',
      createdAt: new Date(),
      payload: { hash: 'A'.repeat(64), reason: 'permanent', source: 'permanent', parkedAt: new Date().toISOString(), memoHex: MEMO },
    });
  };

  it('con `strict` un fallo de BD LANZA en vez de devolver una lista vacía', async () => {
    parkedRow();
    mockDb.down = true;
    await expect(listParked0xFe({ strict: true })).rejects.toThrow();
  });

  it('sin `strict` sigue degradando a [] (panel y barrido: ahí una lista corta es ruido)', async () => {
    parkedRow();
    mockDb.down = true;
    expect(await listParked0xFe()).toEqual([]);
  });

  it('y con la BD en pie las dos formas ven lo mismo', async () => {
    parkedRow();
    expect((await listParked0xFe({ strict: true })).map((r) => r.memoHex)).toEqual([MEMO]);
    expect((await listParked0xFe()).map((r) => r.memoHex)).toEqual([MEMO]);
  });
});

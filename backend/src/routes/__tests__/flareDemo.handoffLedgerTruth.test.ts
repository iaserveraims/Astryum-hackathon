/**
 * productizer-it9 — a 0xFE handoff is marked SIGNED by the ledger, never by the
 * client's word, and only its owner (or a verified founder) may release it.
 *
 * What failed: `POST /handoff/signed` marked `signedAt` for whatever memo any
 * session posted — the seat of somebody else's account then stayed taken for good
 * (NONCE_SEAT_TAKEN_SIGNED) and the demo exchange reservations blocked. And
 * `POST /handoff/release` freed any account's prepared handoff by memo.
 *
 * The store's own verifier runs for real here (`verifyHandoffPaymentOnLedger`);
 * only the XRPL transport and the DB rows are faked.
 */
import express from 'express';
import request from 'supertest';

const mockRpc = jest.fn();
jest.mock('../../services/flare/DirectMintExecutorService', () => ({
  ...jest.requireActual('../../services/flare/DirectMintExecutorService'),
  xrplJsonRpc: (...a: unknown[]) => mockRpc(...a),
}));

const mockFind = jest.fn();
const mockMark = jest.fn();
const mockRelease = jest.fn();
const mockMarkFailed = jest.fn();
const mockReport = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  findQueuedHandoffByMemo: (...a: unknown[]) => mockFind(...a),
  markHandoffSignedByMemo: (...a: unknown[]) => mockMark(...a),
  releaseQueuedHandoffByMemo: (...a: unknown[]) => mockRelease(...a),
  // it19 §M1 1.3 — el veredicto del release lo da el store (y lee la ventana del
  // memo si hace falta). Se finge con la regla real sobre la fila de `mockFind`,
  // con la ventana leída y vacía: en estas pruebas nada aterrizó en el ledger.
  releaseQueuedHandoffDetailed: async (memo: string, opts?: { reportBlocks?: boolean }) => {
    const store = jest.requireActual('../../services/flare/DirectMintHandoffStore');
    const row = await mockFind(memo);
    if (!row) return { released: false };
    const validated = await store.readValidatedLedgerIndex();
    const verdict = store.classifyHandoffRelease(row, {
      nowMs: Date.now(),
      validatedLedgerIndex: validated,
      reportBlocks: opts?.reportBlocks === true,
      windowState: 'absent',
    });
    if (!verdict.release) return { released: false, verdict };
    return { released: await mockRelease(memo), verdict };
  },
  markHandoffLedgerFailedByMemo: (...a: unknown[]) => mockMarkFailed(...a),
  recordHandoffSignatureReport: (...a: unknown[]) => mockReport(...a),
}));

const mockProven = jest.fn();
// it19: la puerta de autoridad pregunta por `proveAddress` (ver handoffAuthority).
jest.mock('../../services/identity/provenAddresses', () => {
  const actual = jest.requireActual('../../services/identity/provenAddresses');
  return {
    ...actual,
    provenAddressesOf: (...a: unknown[]) => mockProven(...a),
    proveAddress: async (userId: unknown, sessionWallet: unknown, address: unknown) => {
      const addresses = (await mockProven(userId, sessionWallet)) ?? [];
      const proven = actual.includesAddress(addresses, address);
      return {
        proven,
        storeReadable: true,
        failure: null,
        addresses,
        refusal: proven ? null : { status: 403, error: 'ADDRESS_NOT_PROVEN', detail: 'not proven', retryable: false },
      };
    },
  };
});

const mockUserFind = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: { user: { findUnique: (...a: unknown[]) => mockUserFind(...a) } },
}));
jest.mock('../adminPanel', () => ({
  isAdminEmail: (email: string | null | undefined) => email === 'founder@astryum.xyz',
}));

import flareDemoRouter from '../flareDemo';

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const user = req.header('x-test-user');
  if (user) {
    (req as express.Request & { siwe: unknown }).siwe = {
      userId: user,
      sessionId: `s-${user}`,
      walletAddress: req.header('x-test-wallet') ?? '',
    };
  }
  next();
});
app.use('/api/flare-demo', flareDemoRouter);

const OWNER = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const OTHER = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const MEMO = 'FE' + 'ab'.repeat(20); // stored as the prepare returned it
const HASH = 'a'.repeat(64);

const row = (over: Record<string, unknown> = {}) => ({
  userOpHash: '0x' + '11'.repeat(32),
  userOpData: '0x',
  memoHex: MEMO,
  xrplAddress: OWNER,
  personalAccount: '0xeeee000000000000000000000000000000000001',
  grossXrpDrops: '500000',
  supplyUBA: '0',
  executorFeeUBA: '200000',
  walletId: 0,
  createdAt: new Date(),
  ...over,
});

/** `tx` as rippled answers it (api v1: flat; `v2` nests the tx in tx_json). */
const ledgerTx = (over: { validated?: boolean; result?: string; account?: string; memo?: string; type?: string; v2?: boolean } = {}) => {
  const tx = {
    TransactionType: over.type ?? 'Payment',
    Account: over.account ?? OWNER,
    Destination: 'rCoreVault11111111111111111111111',
    Amount: '500000',
    Memos: [{ Memo: { MemoData: over.memo ?? MEMO.toUpperCase() } }],
  };
  const top = { validated: over.validated ?? true, meta: { TransactionResult: over.result ?? 'tesSUCCESS' } };
  return over.v2 ? { ...top, tx_json: tx } : { ...top, ...tx };
};

const ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ENV };
  delete process.env.FLARE_DEFI_ENABLED;
  mockMark.mockResolvedValue(true);
  mockRelease.mockResolvedValue(true);
  mockMarkFailed.mockResolvedValue(true);
  mockReport.mockResolvedValue(true);
  mockProven.mockResolvedValue([]);
  mockUserFind.mockResolvedValue(null);
});
afterAll(() => {
  process.env = ENV;
});

describe('POST /handoff/signed — the ledger says it, not the client', () => {
  const post = (body: Record<string, unknown>) =>
    request(app).post('/api/flare-demo/handoff/signed').set('x-test-user', 'stranger').send(body);

  it('rejects a missing or malformed txHash before reading anything', async () => {
    expect((await post({ memoHex: MEMO })).body.error).toBe('INVALID_TX_HASH');
    expect((await post({ memoHex: MEMO, txHash: 'zz' })).status).toBe(400);
    expect((await post({ txHash: HASH })).body.error).toBe('MISSING_MEMO');
    expect(mockFind).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('no queued row under the memo → marked:false, no ledger read', async () => {
    mockFind.mockResolvedValue(null);
    const res = await post({ memoHex: MEMO, txHash: HASH });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marked: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('a VALIDATED Payment from the handoff account with its memo → marked, on a FRESH node, result recorded', async () => {
    mockFind.mockResolvedValue(row());
    mockRpc.mockResolvedValue(ledgerTx());
    const res = await post({ memoHex: MEMO, txHash: HASH });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marked: true, ledgerResult: 'tesSUCCESS' });
    expect(mockRpc).toHaveBeenCalledWith('tx', { transaction: HASH, binary: false }, undefined, { requireFresh: true });
    expect(mockMark).toHaveBeenCalledWith(MEMO, HASH.toUpperCase(), 'tesSUCCESS');
  });

  // productizer-it15 §K1 (it14 §1.4) — un tec* entró en el ledger pero NO entregó
  // XRP al Core Vault: FAssets exige `status == PAYMENT_SUCCESS` para el direct
  // minting, así que ese dispatch no puede ejecutar jamás. Marcarlo «firmado»
  // tapiaba el asiento para siempre; ahora lo LIBERA (api v2 shape).
  it('a tec* result frees the seat instead of taking it for good (api v2 shape)', async () => {
    mockFind.mockResolvedValue(row());
    mockRpc.mockResolvedValue(ledgerTx({ result: 'tecUNFUNDED_PAYMENT', v2: true }));
    const res = await post({ memoHex: MEMO, txHash: HASH });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ marked: false, ledgerResult: 'tecUNFUNDED_PAYMENT', seatFreed: true });
    expect(mockMark).not.toHaveBeenCalled();
    expect(mockMarkFailed).toHaveBeenCalledWith(MEMO, HASH.toUpperCase(), 'tecUNFUNDED_PAYMENT');
  });

  it('not validated yet → 202 PENDING_LEDGER, nothing marked (the executor sweep will)', async () => {
    mockFind.mockResolvedValue(row());
    mockRpc.mockResolvedValue(ledgerTx({ validated: false }));
    const res = await post({ memoHex: MEMO, txHash: HASH });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ marked: false, status: 'PENDING_LEDGER' });
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('tx not found / no fresh node → 202, nothing marked («could not read» is not «signed»)', async () => {
    mockFind.mockResolvedValue(row());
    mockRpc.mockRejectedValue(new Error('txnNotFound'));
    const res = await post({ memoHex: MEMO, txHash: HASH });
    expect(res.status).toBe(202);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it.each([
    ['another account', { account: OTHER }],
    ['another memo', { memo: 'FE' + 'CD'.repeat(20) }],
    ['not a Payment', { type: 'AccountSet' }],
  ])('a validated tx from %s → 409 HANDOFF_TX_MISMATCH, nothing marked', async (_label, over) => {
    mockFind.mockResolvedValue(row());
    mockRpc.mockResolvedValue(ledgerTx(over));
    const res = await post({ memoHex: MEMO, txHash: HASH });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('HANDOFF_TX_MISMATCH');
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('an already-signed row answers marked without a ledger read', async () => {
    mockFind.mockResolvedValue(row({ signedAt: new Date().toISOString() }));
    const res = await post({ memoHex: MEMO, txHash: HASH });
    expect(res.body).toEqual({ marked: true, alreadySigned: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('POST /handoff/release — only the owner (or a verified founder) frees the seat', () => {
  const post = (user: string, wallet = '') =>
    request(app)
      .post('/api/flare-demo/handoff/release')
      .set('x-test-user', user)
      .set('x-test-wallet', wallet)
      .send({ memoHex: MEMO });

  it('nothing queued under the memo → released:false, never a 403', async () => {
    mockFind.mockResolvedValue(null);
    const res = await post('anyone');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: false });
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('a session that PROVED the handoff account releases it', async () => {
    mockFind.mockResolvedValue(row());
    mockProven.mockResolvedValue([OWNER]);
    const res = await post('owner', OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: true });
    expect(mockProven).toHaveBeenCalledWith('owner', OWNER);
    expect(mockRelease).toHaveBeenCalledWith(MEMO);
  });

  it('ANOTHER session gets 403 NOT_THE_HANDOFF_OWNER and the seat stands', async () => {
    mockFind.mockResolvedValue(row());
    mockProven.mockResolvedValue([OTHER]);
    const res = await post('stranger', OTHER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_THE_HANDOFF_OWNER');
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('a founder with a VERIFIED allowlisted email may release; an unverified one may not', async () => {
    process.env.DATABASE_URL = 'postgres://test';
    mockFind.mockResolvedValue(row());
    mockUserFind.mockResolvedValue({ email: 'founder@astryum.xyz', emailVerified: true });
    expect((await post('founder')).body).toEqual({ released: true });

    mockRelease.mockClear();
    mockUserFind.mockResolvedValue({ email: 'founder@astryum.xyz', emailVerified: false });
    expect((await post('squatter')).status).toBe(403);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  // productizer-it23 §Q1 1.6 — …Y TAMPOCO ES CASTIGO. Hasta aquí, un fallo del
  // propio módulo de pruebas (no pudo ni cargarse, no pudo ni preguntar) salía
  // como 403 NO reintentable: a quien intentaba SOLTAR su asiento se le contaba
  // una avería nuestra como «no has probado esa cuenta», y liberar el asiento es
  // justo lo que devuelve la salida. Ahora sale el 503 reintentable que ese
  // estado ES — y sigue sin soltar nada, que es la otra mitad de «no pude leer».
  it('a proven-address read that throws is neither permission nor punishment (503, and nothing released)', async () => {
    mockFind.mockResolvedValue(row());
    mockProven.mockRejectedValue(new Error('db down'));
    const res = await post('stranger');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROOF_STORE_UNREADABLE', retryable: true, released: false });
    expect(res.body.detail).toMatch(/try again/i);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  // productizer-it15 §K1 (contrato C3) — las dos razones por las que liberar
  // sería el bug del gemelo salen con su código, no como un «false» mudo que
  // dejaba a la consola ofreciendo «Retry, freeing the seat» en bucle.
  it('an already SIGNED order is not released, and says why', async () => {
    mockProven.mockResolvedValue([OWNER]);
    mockFind.mockResolvedValue(row({ signedAt: new Date().toISOString() }));
    const res = await post('owner', OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ released: false, code: 'NONCE_SEAT_TAKEN_SIGNED', retryable: false });
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('a signature reported by a session that PROVES the account holds the seat too', async () => {
    mockProven.mockResolvedValue([OWNER]);
    mockFind.mockResolvedValue(row({ reportedTxHash: HASH.toUpperCase(), reportedByProven: true }));
    const res = await post('owner', OWNER);
    expect(res.body).toMatchObject({ released: false, code: 'NONCE_SEAT_TAKEN_REPORTED' });
    expect(mockRelease).not.toHaveBeenCalled();
  });

  // it14 §1.3: un informe de un extraño no puede gatear al dueño.
  it('a stranger’s report does NOT stop the proven owner from releasing', async () => {
    mockProven.mockResolvedValue([OWNER]);
    mockFind.mockResolvedValue(row({ preparedByUserId: 'stranger', reportedTxHash: HASH.toUpperCase(), reportedByProven: false }));
    const res = await post('owner', OWNER);
    expect(res.body).toEqual({ released: true });
    expect(mockRelease).toHaveBeenCalledWith(MEMO);
  });

  it('the preparer cannot release around their OWN report', async () => {
    mockFind.mockResolvedValue(row({ preparedByUserId: 'preparer', reportedTxHash: HASH.toUpperCase(), reportedByProven: false }));
    const res = await post('preparer');
    expect(res.body).toMatchObject({ released: false, code: 'NONCE_SEAT_TAKEN_REPORTED' });
    expect(mockRelease).not.toHaveBeenCalled();
  });
});

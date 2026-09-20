/**
 * The flare-demo prepare routes hand the 0xFE builder WHO is
 * preparing and whether that session may displace somebody else's draft; the
 * preparer can release their own draft; a pending signature report is kept; and
 * every prepare that redeems FXRP to XRP discloses the redemption fee (§4.2, C3)
 * and pa-unmint says whether the redeem rides its own mint (§4.4, C4).
 *
 * The chain is mocked at the FlareDirectMintService / adapter / preflight seams;
 * the route logic and the handoffAuthority verdict run for real.
 */
import express from 'express';
import request from 'supertest';

const mockFeeBips = jest.fn();
const mockBuild = jest.fn();
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  // `seatClaimOf` asks the SignerList before every 0xFE composition;
  // unmocked that is a LIVE account_info. `{}` = ordinary single-sig account.
  signingCeremonyFor: jest.fn(async () => ({})),
  readRedemptionFeeBips: (...a: unknown[]) => mockFeeBips(...a),
  readDirectMintParams: jest.fn(async () => ({ minFeeUBA: 100_000n, feeBIPS: 10n, executorFeeUBA: 200_000n })),
  computeNetMint: jest.fn(() => ({ netToPersonalAccountUBA: 500_000n, supplyUBA: 500_000n })),
  mintFeeDisclosure: jest.fn(() => ({})),
  readFxrpBalance: jest.fn(async () => 20_000_000n),
  readMinimumRedeemAmountUBA: jest.fn(async () => 5_000_000n),
  buildRedeemToXrplCall: jest.fn(async () => ({ to: '0x2a3fe068cd92178554cabcf7c95adf49b4b0b6a8', calldata: '0xab', value: '0' })),
  buildDirectMintHandoff: (...a: unknown[]) => mockBuild(...a),
  resolveRedemptionExecutor: jest.fn(async () => '0x0000000000000000000000000000000000000000'),
}));
jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareSmartAccountService'),
  resolvePersonalAccount: jest.fn(async () => '0xeeee000000000000000000000000000000000001'),
}));
jest.mock('../../connectors/protocols/adapters/KineticAdapter', () => {
  const actual = jest.requireActual('../../connectors/protocols/adapters/KineticAdapter');
  class KineticAdapter extends actual.KineticAdapter {
    async buildIsoWithdrawFxrp() {
      return [{ to: '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3', calldata: '0x852a12e3', value: '0' }];
    }
  }
  return { ...actual, KineticAdapter };
});
jest.mock('../../connectors/protocols/adapters/FirelightAdapter', () => {
  const actual = jest.requireActual('../../connectors/protocols/adapters/FirelightAdapter');
  class FirelightAdapter extends actual.FirelightAdapter {
    async readPendingWithdrawals() {
      return {
        currentPeriod: 224,
        currentPeriodEnd: null,
        pending: [{ period: 223, claimable: true, claimableAt: null, queuedFxrpBase: '5000000', estFxrpBase: '5000000' }],
        // The sweep now MARKS unread periods instead of throwing.
        unreadablePeriods: [],
        scannedPeriods: [223],
      };
    }
    async buildClaimWithdrawBatch() {
      return [{ to: '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3', calldata: '0xb13acedd', value: '0' }];
    }
  }
  return { ...actual, FirelightAdapter };
});
jest.mock('../../services/flare/preparePreflight', () => ({
  ...jest.requireActual('../../services/flare/preparePreflight'),
  preflightXrplPayment: jest.fn(async () => ({ ok: true })),
  preflightEvmCalls: jest.fn(async () => ({ ok: true })),
  mergePreflights: jest.fn(() => ({ ok: true })),
}));

const mockProven = jest.fn();
/** Veredicto completo forzado (p. ej. la tienda de pruebas ILEGIBLE); undefined = el de siempre. */
const mockProveVerdict = jest.fn();
// it19: `handoffAuthority` pregunta por `proveAddress` (que devuelve además el
// cuerpo que se debe a quien no pudimos comprobar). Se finge sobre la misma lista
// de siempre — una llamada intra-módulo no ve el mock de su vecina, así que hay
// que fingir LA función que se llama, no la que usa por dentro.
jest.mock('../../services/identity/provenAddresses', () => {
  const actual = jest.requireActual('../../services/identity/provenAddresses');
  return {
    ...actual,
    provenAddressesOf: (...a: unknown[]) => mockProven(...a),
    proveAddress: async (userId: unknown, sessionWallet: unknown, address: unknown, purpose: unknown) => {
      const forced = await mockProveVerdict(userId, sessionWallet, address, purpose);
      if (forced) return forced;
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

const mockFind = jest.fn();
const mockRelease = jest.fn();
/** Veredicto forzado de `releaseQueuedHandoffDetailed`; undefined = la regla real. */
const mockReleaseVerdict = jest.fn();
const mockReport = jest.fn();
const mockMarkFailed = jest.fn();
/** Controlable: hace falta un `false` (escritura que no entró). */
const mockMark = jest.fn();
/** Las ENTRADAS del SignerList que la ruta del informe lee del ledger. */
const mockSignerEntries = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  findQueuedHandoffByMemo: (...a: unknown[]) => mockFind(...a),
  releaseQueuedHandoffByMemo: (...a: unknown[]) => mockRelease(...a),
  // La ruta ya no clasifica por su cuenta: el veredicto (y la
  // lectura de la ventana del memo que haga falta) los da el store, en un sitio.
  // Aquí se finge esa función con la REGLA REAL sobre la fila que `mockFind`
  // devuelve, con la ventana leída y vacía — que es el mundo de estas pruebas.
  releaseQueuedHandoffDetailed: async (memo: string, opts?: { reportBlocks?: boolean }) => {
    const store = jest.requireActual('../../services/flare/DirectMintHandoffStore');
    // Un veredicto forzado (la BD caída) para probar el mapeo 503.
    const forced = await mockReleaseVerdict(memo, opts);
    if (forced) return forced;
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
  recordHandoffSignatureReport: (...a: unknown[]) => mockReport(...a),
  markHandoffLedgerFailedByMemo: (...a: unknown[]) => mockMarkFailed(...a),
  markHandoffSignedByMemo: (...a: unknown[]) => mockMark(...a),
  readXrplSignerEntries: (...a: unknown[]) => mockSignerEntries(...a),
}));
/** «¿esta sesión pertenece a ESTE consejo?», el mismo predicado de las otras cuatro puertas. */
const mockIsMember = jest.fn();
jest.mock('../councilProposals', () => ({
  sessionIsCouncilMember: (...a: unknown[]) => mockIsMember(...a),
}));
const mockRpc = jest.fn();
jest.mock('../../services/flare/DirectMintExecutorService', () => ({
  ...jest.requireActual('../../services/flare/DirectMintExecutorService'),
  xrplJsonRpc: (...a: unknown[]) => mockRpc(...a),
}));

import flareDemoRouter from '../flareDemo';
import { NonceSeatTakenError, OperationalAccountHandoffError } from '../../connectors/protocols/flare/FlareDirectMintService';
import { resetAddressCache } from '../../config/protocolAddresses';
import { _resetDemoCapState } from '../../config/demoCap';
import { _resetFeeLedgerForTests } from '../../services/flare/ExecutorFuelService';

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

const XRPL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const MEMO = 'FE' + 'AB'.repeat(20);
const HASH = 'c'.repeat(64);
const ENV = { ...process.env };

const handoff = () => ({
  personalAccount: '0xeeee000000000000000000000000000000000001',
  xrplPayment: { TransactionType: 'Payment' },
  memoHex: MEMO,
  userOpData: '0x',
  net: { netToPersonalAccountUBA: 500_000n, mintingFeeUBA: 100_000n, executorFeeUBA: 200_000n, supplyUBA: 500_000n },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockProveVerdict.mockReset(); // un veredicto forzado no se hereda entre pruebas
  mockReleaseVerdict.mockReset();
  process.env = { ...ENV };
  process.env.FLARE_DEFI_ENABLED = 'true';
  process.env.KINETIC_KFXRP_ISO = '0xD1b7A5eFa9bd88F291F7A4563a8f6185c0249CB3';
  process.env.KINETIC_ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
  process.env.FXRP_TOKEN = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';
  process.env.FIRELIGHT_STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
  delete process.env.DATABASE_URL;
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  delete process.env.DEMO_MAX_XRP_PER_TX;
  delete process.env.DEMO_MAX_XRP_PER_ADDRESS_PER_DAY;
  delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
  delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
  resetAddressCache();
  _resetDemoCapState();
  _resetFeeLedgerForTests();
  mockBuild.mockImplementation(async () => handoff());
  mockFeeBips.mockResolvedValue(20);
  mockProven.mockResolvedValue([]);
  mockRelease.mockResolvedValue(true);
  mockReport.mockResolvedValue(true);
  mockMarkFailed.mockResolvedValue(true);
  mockMark.mockResolvedValue(true);
  mockSignerEntries.mockResolvedValue({ state: 'unknown' });
  mockIsMember.mockResolvedValue(false);
});
afterAll(() => {
  process.env = ENV;
});

describe('0xFE prepares — who prepares, and whether supersede may displace (§2.1, C1/C2)', () => {
  const unmint = (user: string, extra: Record<string, unknown> = {}, wallet = '') =>
    request(app)
      .post('/api/flare-demo/pa-unmint/prepare')
      .set('x-test-user', user)
      .set('x-test-wallet', wallet)
      .send({ xrplAddress: XRPL, amountFxrpBase: '10000000', amountXrpForMint: 1, ...extra });

  it('supersede from a session that has NOT proven the account → supersedeAuthorized:false', async () => {
    mockProven.mockResolvedValue(['rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY']);
    const res = await unmint('u-stranger', { supersede: true });
    expect(res.status).toBe(200);
    expect(mockBuild.mock.calls[0][1]).toMatchObject({
      xrplAddress: XRPL,
      supersedePendingNonce: true,
      preparedByUserId: 'u-stranger',
      supersedeAuthorized: false,
    });
  });

  it('supersede from a session that PROVED the account → supersedeAuthorized:true', async () => {
    mockProven.mockResolvedValue([XRPL]);
    await unmint('u-owner', { supersede: true }, XRPL);
    expect(mockBuild.mock.calls[0][1]).toMatchObject({ supersedePendingNonce: true, preparedByUserId: 'u-owner', supersedeAuthorized: true });
  });

  // §K1 (contrato C2): la prueba se lee SIEMPRE y viaja al
  // registro — un borrador de quien no prueba la cuenta lo desplaza el dueño
  // probado, y la UI necesita saber si reintentar tiene sentido.
  it('no supersede asked → the proof still rides the row as preparedByProven', async () => {
    mockProven.mockResolvedValue([XRPL]);
    await unmint('u-1', {}, XRPL);
    expect(mockBuild.mock.calls[0][1]).toMatchObject({
      supersedePendingNonce: false,
      preparedByUserId: 'u-1',
      supersedeAuthorized: false,
      preparedByProven: true,
    });
  });

  it('a session that proves nothing prepares with preparedByProven:false', async () => {
    mockProven.mockResolvedValue(['rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY']);
    await unmint('u-stranger');
    expect(mockBuild.mock.calls[0][1]).toMatchObject({ preparedByProven: false, supersedeAuthorized: false });
  });

  it('an anonymous request prepares with preparedByUserId:null', async () => {
    await request(app).post('/api/flare-demo/pa-unmint/prepare').send({ xrplAddress: XRPL, amountFxrpBase: '10000000', amountXrpForMint: 1, supersede: true });
    expect(mockBuild.mock.calls[0][1]).toMatchObject({ preparedByUserId: null, supersedeAuthorized: false, preparedByProven: false });
  });

  it('an operational account refused by the builder → 403 OPERATIONAL_ACCOUNT_HANDOFF_REFUSED', async () => {
    mockBuild.mockRejectedValue(new OperationalAccountHandoffError('OPERATIONAL_ACCOUNT_HANDOFF_REFUSED: rOmnibus'));
    const res = await unmint('u-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('OPERATIONAL_ACCOUNT_HANDOFF_REFUSED');
  });
});

// §K1 (contrato C3) — cada tipo de asiento sale con su código:
// la consola ya no ofrece «Retry, freeing the seat» sobre lo que no puede liberar.
describe('0xFE prepares — the seat error carries its machine code (C3)', () => {
  const unmint = () =>
    request(app)
      .post('/api/flare-demo/pa-unmint/prepare')
      .set('x-test-user', 'u-1')
      .send({ xrplAddress: XRPL, amountFxrpBase: '10000000', amountXrpForMint: 1 });

  it.each([
    ['NONCE_SEAT_TAKEN_SIGNED', false],
    ['NONCE_SEAT_TAKEN_REPORTED', false],
    ['NONCE_SEAT_UNREADABLE', false],
  ] as const)('%s → 409 with that code, retryable %s', async (code, retryable) => {
    mockBuild.mockRejectedValue(new NonceSeatTakenError(`${code}: el PA …`, { code, retryable }));
    const res = await unmint();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(code);
    expect(res.body.retryable).toBe(retryable);
  });

  it('a live draft answers NONCE_SEAT_TAKEN with the ledger countdown', async () => {
    mockBuild.mockRejectedValue(
      new NonceSeatTakenError('NONCE_SEAT_TAKEN: el PA …', {
        code: 'NONCE_SEAT_TAKEN',
        retryable: true,
        lastLedgerSequence: 90_000_100,
        secondsLeft: 404,
      }),
    );
    const res = await unmint();
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      error: 'NONCE_SEAT_TAKEN',
      retryable: true,
      lastLedgerSequence: 90_000_100,
      secondsLeft: 404,
    });
  });

  it('an error built by an older caller (message only) still maps to its code', async () => {
    mockBuild.mockRejectedValue(new NonceSeatTakenError('NONCE_SEAT_TAKEN_SIGNED: el PA …'));
    expect((await unmint()).body.error).toBe('NONCE_SEAT_TAKEN_SIGNED');
  });
});

describe('POST /pa-unmint/prepare — ridesOwnMint is exposed (§4.4, C4)', () => {
  it.each([
    ['10000000', false], // 10 FXRP ≤ 20 free
    ['20400000', true], // needs the 0.5 FXRP this very Payment mints
  ])('amount %s → ridesOwnMint %s', async (amountFxrpBase, rides) => {
    const res = await request(app).post('/api/flare-demo/pa-unmint/prepare').send({ xrplAddress: XRPL, amountFxrpBase, amountXrpForMint: 1 });
    expect(res.status).toBe(200);
    expect(res.body.disclosure.ridesOwnMint).toBe(rides);
    expect(res.body.disclosure.redemptionFeeBips).toBe(20);
  });
});

describe('redemption fee on every prepare that unmints (§4.2, C3)', () => {
  const withdraw = { xrplAddress: XRPL, asset: 'fxrp', amountBase: '5000000', amountXrpForMint: 1, unmintToXrpl: true };
  const claim = { xrplAddress: XRPL, period: 223, amountXrpForMint: 1, unmintToXrpl: true };

  it.each([
    ['/pa-withdraw-transfer/prepare', withdraw],
    ['/vault-claim/prepare', claim],
  ])('%s discloses the live fee on what it redeems (5 + 0.5 FXRP)', async (path, body) => {
    const res = await request(app).post(`/api/flare-demo${path}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure).toMatchObject({ redemptionFeeBips: 20, redemptionFeeFxrp: 0.011, fxrpRedeemed: 5.5 });
    expect(res.body.disclosure.redemptionFeeLine).toContain('0.2%');
    expect(res.body.disclosure.redemptionFeeLine).toContain('0.011 FXRP');
  });

  it.each([
    ['/pa-withdraw-transfer/prepare', withdraw],
    ['/vault-claim/prepare', claim],
  ])('%s with an unreadable fee → null on both fields and a line that says NOT zero', async (path, body) => {
    mockFeeBips.mockResolvedValue(null);
    const res = await request(app).post(`/api/flare-demo${path}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.disclosure.redemptionFeeBips).toBeNull();
    expect(res.body.disclosure.redemptionFeeFxrp).toBeNull();
    expect(res.body.disclosure.redemptionFeeLine).toMatch(/could not be read/);
    expect(res.body.disclosure.redemptionFeeLine).toMatch(/NOT zero/);
  });

  it('a claim that does not unmint carries no redemption fee', async () => {
    const res = await request(app).post('/api/flare-demo/vault-claim/prepare').send({ ...claim, unmintToXrpl: false });
    expect(res.status).toBe(200);
    expect(res.body.disclosure).not.toHaveProperty('redemptionFeeBips');
    expect(mockFeeBips).not.toHaveBeenCalled();
  });
});

describe('POST /handoff/release — the preparer may release their own draft (§1.2)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    userOpHash: '0x' + '11'.repeat(32),
    userOpData: '0x',
    memoHex: MEMO,
    xrplAddress: XRPL,
    personalAccount: '0xeeee000000000000000000000000000000000001',
    grossXrpDrops: '500000',
    supplyUBA: '0',
    executorFeeUBA: '200000',
    walletId: 0,
    createdAt: new Date(),
    ...over,
  });
  const release = (user: string) =>
    request(app).post('/api/flare-demo/handoff/release').set('x-test-user', user).send({ memoHex: MEMO });

  it('the session whose user prepared it releases it without a proven address', async () => {
    mockFind.mockResolvedValue(row({ preparedByUserId: 'u-email' }));
    const res = await release('u-email');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: true });
    expect(mockRelease).toHaveBeenCalledWith(MEMO);
  });

  it('another user (no proof) still gets 403 and the seat stands', async () => {
    mockFind.mockResolvedValue(row({ preparedByUserId: 'u-email' }));
    const res = await release('u-other');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_THE_HANDOFF_OWNER');
    expect(mockRelease).not.toHaveBeenCalled();
  });

  // Liberar TU asiento es una SALIDA: si la tienda de
  // pruebas no se pudo leer, la respuesta es 503 «vuelve a intentarlo», nunca un
  // 403 que le quita a alguien su llave por un fallo transitorio nuestro.
  it('an unreadable proof store answers 503 on this exit, never a 403', async () => {
    mockFind.mockResolvedValue(row({ preparedByUserId: 'u-email' }));
    mockProveVerdict.mockResolvedValue({
      proven: false,
      storeReadable: false,
      failure: 'read-failed',
      addresses: [],
      refusal: { status: 503, error: 'PROOF_STORE_UNREADABLE', detail: 'could not read', retryable: true },
    });
    const res = await release('u-other');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROOF_STORE_UNREADABLE', retryable: true, released: false });
    expect(mockRelease).not.toHaveBeenCalled();
    expect(mockProveVerdict).toHaveBeenCalledWith('u-other', expect.anything(), XRPL, 'exit');
  });

  // §L1 — esta puerta miraba `signedAt` e informes
  // y NUNCA la ventana: el preparador cancelaba, el prepare siguiente componía
  // otro userOp en el mismo nonce, y el payload viejo seguía firmable en el móvil.
  // Soltar el asiento mientras el payload vive ES lo que crea el gemelo.
  it('inside the live payload window it answers 409 with the countdown, and frees nothing', async () => {
    mockFind.mockResolvedValue(
      row({
        preparedByUserId: 'u-email',
        lastLedgerSequence: 90_000_100,
        payloadExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    );
    mockRpc.mockResolvedValue({ ledger_index: 90_000_000 }); // el ledger validado sigue dentro
    const res = await release('u-email');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('WAIT_FOR_PAYLOAD_EXPIRY');
    expect(res.body.retryable).toBe(true);
    expect(res.body.secondsLeft).toBeGreaterThan(0);
    expect(res.body.detail).toMatch(/still signable in Xaman/);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('once that payload expired unsigned, the same call frees the seat', async () => {
    mockFind.mockResolvedValue(
      row({
        preparedByUserId: 'u-email',
        lastLedgerSequence: 90_000_100,
        payloadExpiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    mockRpc.mockResolvedValue({ ledger_index: 90_000_000 });
    const res = await release('u-email');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: true });
    expect(mockRelease).toHaveBeenCalledWith(MEMO);
  });

  it('and so does a ledger already past its LastLedgerSequence', async () => {
    mockFind.mockResolvedValue(
      row({
        preparedByUserId: 'u-email',
        lastLedgerSequence: 90_000_100,
        payloadExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      }),
    );
    mockRpc.mockResolvedValue({ ledger_index: 90_000_101 });
    expect((await release('u-email')).body).toEqual({ released: true });
  });
});

/**
 * EL RELOJ DEL ASIENTO LO PONE QUIEN CREA EL
 * PAYLOAD. Se estampaba al componer, pero el `expire` de Xaman corre desde que el
 * payload se crea: una firma viva a los 4:30 se daba por muerta a los 5:01 y su
 * asiento se entregaba a un segundo 0xFE.
 */
describe('POST /handoff/payload-opened — la caducidad real, de quien la sabe', () => {
  const MEMO_ROW = {
    memoHex: MEMO,
    xrplAddress: XRPL,
    preparedByUserId: 'u-preparer',
    lastLedgerSequence: 90_000_090,
    composedLedgerIndex: 90_000_000,
    createdAt: new Date(),
  };
  const post = (user: string, body: Record<string, unknown>) =>
    request(app).post('/api/flare-demo/handoff/payload-opened').set('x-test-user', user).send(body);
  const expiresAt = () => new Date(Date.now() + 4 * 60_000).toISOString();

  beforeEach(() => mockFind.mockResolvedValue(MEMO_ROW));

  it('rejects a body without a memo or with a junk instant, before touching anything', async () => {
    expect((await post('u-preparer', { expiresAt: expiresAt() })).body.error).toBe('MISSING_MEMO');
    expect((await post('u-preparer', { memoHex: MEMO, expiresAt: 'soon' })).body.error).toBe('INVALID_EXPIRY');
  });

  it('an unknown memo answers «nothing stamped» without confirming anything', async () => {
    mockFind.mockResolvedValue(null);
    const res = await post('u-preparer', { memoHex: MEMO, expiresAt: expiresAt() });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ stamped: false });
  });

  it('a stranger cannot move the clock of somebody else’s seat', async () => {
    const res = await post('u-other', { memoHex: MEMO, expiresAt: expiresAt() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_THE_HANDOFF_OWNER');
  });

  it('the preparer moves it, and the answer carries the minutes the payload must live', async () => {
    const res = await post('u-preparer', { memoHex: MEMO, expiresAt: expiresAt() });
    expect(res.status).toBe(200);
    expect(res.body.payloadExpiryMin).toBe(5);
    // Sin DATABASE_URL el store no escribe; lo que importa aquí es la puerta.
    expect(res.body).toHaveProperty('stamped');
  });

  it('a session that PROVED the account may move it too', async () => {
    mockProven.mockResolvedValue([XRPL]);
    const res = await post('u-other', { memoHex: MEMO, expiresAt: expiresAt() });
    expect(res.status).toBe(200);
  });
});

describe('POST /handoff/signed — a pending signature is remembered, never marked (§1.1)', () => {
  const post = (user = 'anyone') =>
    request(app).post('/api/flare-demo/handoff/signed').set('x-test-user', user).send({ memoHex: MEMO, txHash: HASH });

  beforeEach(() => {
    mockFind.mockResolvedValue({ memoHex: MEMO, xrplAddress: XRPL, preparedByUserId: 'u-preparer', createdAt: new Date() });
  });

  it('the PREPARER’s report is recorded → 202 PENDING_LEDGER, reported:true', async () => {
    mockRpc.mockResolvedValue({ validated: false });
    const res = await post('u-preparer');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ marked: false, status: 'PENDING_LEDGER', reported: true });
    expect(mockReport).toHaveBeenCalledWith(MEMO, HASH, { userId: 'u-preparer', proven: false });
  });

  it('a session that PROVES the account reports as proven', async () => {
    mockProven.mockResolvedValue([XRPL]);
    mockRpc.mockResolvedValue({ validated: false });
    await request(app)
      .post('/api/flare-demo/handoff/signed')
      .set('x-test-user', 'u-owner')
      .set('x-test-wallet', XRPL)
      .send({ memoHex: MEMO, txHash: HASH });
    expect(mockReport).toHaveBeenCalledWith(MEMO, HASH, { userId: 'u-owner', proven: true });
  });

  // §K1: el memo viaja en la vista pública de una
  // run. Ocho informes falsos llenaban la lista y el aviso real se descartaba;
  // a los 15 min, sustitución y gemelo. Un extraño ya no escribe NADA — y la
  // respuesta es la misma que la del legítimo: no se le confirma el memo.
  it('a STRANGER’s report is not stored, and the answer gives nothing away', async () => {
    mockRpc.mockResolvedValue({ validated: false });
    const res = await post('u-stranger');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ marked: false, status: 'PENDING_LEDGER', reported: false });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('eight stranger reports in a row still store nothing', async () => {
    mockRpc.mockResolvedValue({ validated: false });
    for (let i = 0; i < 8; i++) {
      const res = await request(app)
        .post('/api/flare-demo/handoff/signed')
        .set('x-test-user', `mallory-${i}`)
        .send({ memoHex: MEMO, txHash: i.toString(16).repeat(64).slice(0, 64) });
      expect(res.status).toBe(202);
    }
    expect(mockReport).not.toHaveBeenCalled();
  });

  // Un tec* se marcaba firmado para siempre — bloqueaba el nonce por
  // algo que no entrega XRP y que FAssets no puede ejecutar jamás.
  it('a VALIDATED tec* frees the seat instead of taking it for good', async () => {
    mockRpc.mockResolvedValue({
      validated: true,
      meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' },
      TransactionType: 'Payment',
      Account: XRPL,
      Memos: [{ Memo: { MemoData: MEMO } }],
    });
    const res = await post('u-preparer');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ marked: false, ledgerResult: 'tecUNFUNDED_PAYMENT', seatFreed: true });
    expect(res.body.detail).toMatch(/never execute/);
    expect(mockMarkFailed).toHaveBeenCalledWith(MEMO, HASH.toUpperCase(), 'tecUNFUNDED_PAYMENT');
  });

  it('a validated tx that is not this handoff’s → 409, nothing recorded', async () => {
    mockRpc.mockResolvedValue({
      validated: true,
      meta: { TransactionResult: 'tesSUCCESS' },
      TransactionType: 'Payment',
      Account: 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY',
      Memos: [{ Memo: { MemoData: MEMO } }],
    });
    const res = await post();
    expect(res.status).toBe(409);
    expect(mockReport).not.toHaveBeenCalled();
  });
});

/**
 * §P1 1.2 / §P2 2.2 (contrato C1) — «NO PUDE LEER» YA NO SE
 * DISFRAZA DE HECHO EN NINGUNA DE LAS TRES PUERTAS DEL HANDOFF.
 *
 * Un 200 `{released:false}` la pantalla lo lee «no había asiento que liberar» y
 * ofrece preparar otra orden; un 409 afirma que hay algo ahí. Cuando la base de
 * datos no contesta, las dos afirmaciones son falsas y la única honesta es 503.
 */
/**
 * EL EMISOR DEL TEMPO ASÍNCRONO ES UN TERCER REPORTERO.
 *
 * En la bandeja de propuestas, el miembro que combina y emite el 0xFE rara vez
 * es la sesión que lo preparó, y prueba SU dirección, no la del consejo. Con
 * `proven || samePreparer` su informe contestaba 202 y no guardaba NADA — y un
 * retiro posterior de la propuesta soltaba el asiento con el Payment en vuelo.
 * La puerta que ya contesta «¿esta sesión pertenece a ESTE consejo?» en las
 * otras cuatro contesta aquí, sobre el SignerList leído del ledger.
 */
describe('POST /handoff/signed — a proven SignerList member may report (B1)', () => {
  const MEMBER = 'rMemberXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const post = (user: string, wallet = '') =>
    request(app)
      .post('/api/flare-demo/handoff/signed')
      .set('x-test-user', user)
      .set('x-test-wallet', wallet)
      .send({ memoHex: MEMO, txHash: HASH });

  beforeEach(() => {
    mockFind.mockResolvedValue({ memoHex: MEMO, xrplAddress: XRPL, preparedByUserId: 'u-preparer', createdAt: new Date() });
    mockRpc.mockResolvedValue({ validated: false });
  });

  it('neither preparer nor prover, but on the account’s SignerList → the report is STORED', async () => {
    mockSignerEntries.mockResolvedValue({ state: 'read', accounts: [MEMBER, 'rOtherMemberYYYYYYYYYYYYYYYYYYYYYY'] });
    mockIsMember.mockResolvedValue(true);
    const res = await post('u-member-b', MEMBER);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ marked: false, status: 'PENDING_LEDGER', reported: true });
    // The list came off the ledger for THIS account, and the predicate was asked
    // with the session's login wallet — the same question the other doors ask.
    expect(mockSignerEntries).toHaveBeenCalledWith(XRPL);
    expect(mockIsMember).toHaveBeenCalledWith(
      'u-member-b',
      { signerList: [{ account: MEMBER }, { account: 'rOtherMemberYYYYYYYYYYYYYYYYYYYYYY' }] },
      MEMBER,
    );
    expect(mockReport).toHaveBeenCalledWith(MEMO, HASH, { userId: 'u-member-b', proven: false });
  });

  it('on nobody’s SignerList → still a stranger: nothing stored, same 202', async () => {
    mockSignerEntries.mockResolvedValue({ state: 'read', accounts: [MEMBER] });
    mockIsMember.mockResolvedValue(false);
    const res = await post('u-mallory', 'rMalloryZZZZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ reported: false });
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('SignerList unreadable → grants nothing, asks nobody, and SAYS so', async () => {
    mockSignerEntries.mockResolvedValue({ state: 'unknown' });
    const res = await post('u-member-b', MEMBER);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ reported: false, signerListRead: 'unknown' });
    expect(String(res.body.detail)).toMatch(/could not read this account.s signer list/i);
    expect(mockIsMember).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
  });

  it('the preparer and the prover never pay for the ledger read', async () => {
    await post('u-preparer');
    mockProven.mockResolvedValue([XRPL]);
    await post('u-owner', XRPL);
    expect(mockSignerEntries).not.toHaveBeenCalled();
  });
});

describe('las tres puertas del handoff con la BD caída → 503, jamás 200 ni 409', () => {
  const dbDown = () =>
    Object.assign(new Error('the 0xFE queued under memo … could not be read: db down'), { code: 'SEAT_STATE_UNREADABLE' });

  it('/handoff/release con la lectura de la fila caída → 503 SEAT_STATE_UNREADABLE', async () => {
    mockFind.mockRejectedValue(dbDown());
    const res = await request(app).post('/api/flare-demo/handoff/release').set('x-test-user', 'u-1').send({ memoHex: MEMO });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'SEAT_STATE_UNREADABLE', released: false, retryable: true });
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('/handoff/release con el veredicto ilegible del store → 503, no el 409 de un conflicto', async () => {
    mockFind.mockResolvedValue({ memoHex: MEMO, xrplAddress: XRPL, preparedByUserId: 'u-1', createdAt: new Date() });
    mockReleaseVerdict.mockResolvedValue({
      released: false,
      verdict: { release: false, code: 'SEAT_STATE_UNREADABLE', retryable: true, detail: 'could not read' },
    });
    const res = await request(app).post('/api/flare-demo/handoff/release').set('x-test-user', 'u-1').send({ memoHex: MEMO });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'SEAT_STATE_UNREADABLE', released: false, retryable: true });
  });

  it('…y un memo que de verdad no existe sigue siendo el 200 «no había nada» de siempre', async () => {
    mockFind.mockResolvedValue(null);
    const res = await request(app).post('/api/flare-demo/handoff/release').set('x-test-user', 'u-1').send({ memoHex: MEMO });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: false });
  });

  it('/handoff/payload-opened con la BD caída → 503, en vez de «no hay nada que sellar»', async () => {
    mockFind.mockRejectedValue(dbDown());
    const res = await request(app)
      .post('/api/flare-demo/handoff/payload-opened')
      .set('x-test-user', 'u-1')
      .send({ memoHex: MEMO, expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'SEAT_STATE_UNREADABLE', stamped: false, retryable: true });
  });
});

/**
 * §R1 — LA TERCERA PUERTA: `/handoff/signed` LEÍA BLANDO.
 *
 * Era la única de las tres que seguía leyendo con la forma tolerante (anotado
 * «Menor» en la y abierto desde entonces), y es la que sostiene el asiento:
 * un parpadeo de base de datos convertía el aviso de una firma REAL en un 200
 * «marked:false» — el informe se perdía en silencio, nada sostenía el asiento y el
 * TTL podía retirarlo con el Payment firmado todavía vivo en el móvil de alguien.
 * Y su puerta de autoridad pedía la forma BOOLEANA, que colapsa «no la ha
 * probado» y «no pude leer» en el mismo `false`: el informe del DUEÑO acababa
 * descartado con la misma cara que el de un extraño.
 */
describe('POST /handoff/signed con la BD caída — 503 reintentable, jamás un asiento retirado (§R1)', () => {
  const dbDown = () =>
    Object.assign(new Error('the 0xFE queued under memo … could not be read: db down'), { code: 'SEAT_STATE_UNREADABLE' });
  const queued = (over: Record<string, unknown> = {}) => ({
    memoHex: MEMO,
    xrplAddress: XRPL,
    preparedByUserId: 'u-preparer',
    createdAt: new Date(),
    ...over,
  });
  const unreadableProof = (failure: string, refusal: Record<string, unknown>) => ({
    proven: false,
    storeReadable: false,
    failure,
    addresses: [],
    refusal,
  });
  const post = (user: string, wallet = '') =>
    request(app)
      .post('/api/flare-demo/handoff/signed')
      .set('x-test-user', user)
      .set('x-test-wallet', wallet)
      .send({ memoHex: MEMO, txHash: HASH });

  // §R1 1.1 — la lectura de la fila, en ESTRICTO.
  it('la lectura de la fila caída → 503 SEAT_STATE_UNREADABLE, sin tocar el ledger ni escribir nada', async () => {
    mockFind.mockRejectedValue(dbDown());
    const res = await post('u-preparer');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'SEAT_STATE_UNREADABLE', marked: false, retryable: true });
    expect(res.body.detail).toMatch(/again in a moment/i);
    // La forma ESTRICTA es la que hace que el store LANCE en vez de tragarse el
    // fallo y contestar `null`: sin ella este 503 no existe en producción.
    expect(mockFind).toHaveBeenCalledWith(MEMO, { strict: true });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
  });

  // §R1 1.2 — EL CASO DEL ENCARGO: la tienda de pruebas parpadea mientras el
  // dueño avisa de SU firma. Antes: `proven:false`, informe descartado, 202
  // «recibido» y asiento retirable. Ahora: 503, y la fila NO queda marcada «de
  // quien no prueba» porque no se escribe nada.
  it('la tienda de pruebas ilegible no descarta el aviso del dueño en silencio (503, y nada marcado)', async () => {
    mockFind.mockResolvedValue(queued());
    mockRpc.mockResolvedValue({ validated: false });
    mockProveVerdict.mockResolvedValue(
      unreadableProof('read-failed', {
        status: 503,
        error: 'PROOF_STORE_UNREADABLE',
        detail: 'could not read your wallet proofs — try again in a moment',
        retryable: true,
      }),
    );
    const res = await post('u-owner', XRPL);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROOF_STORE_UNREADABLE', marked: false, reported: false, retryable: true });
    // Ni un informe «no probado» escrito a su nombre, ni un asiento cerrado.
    expect(mockReport).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockProveVerdict).toHaveBeenCalledWith('u-owner', XRPL, XRPL, 'exit');
  });

  // …y una causa DETERMINISTA no promete «vuelve a intentarlo» para siempre: sale
  // con su código 409, que dice qué pasa y qué se puede hacer.
  it.each([
    ['no-user-row', 'ACCOUNT_RECORD_MISSING'],
    ['unreadable-floor', 'PROOF_FLOOR_UNREADABLE'],
  ])('una causa determinista (%s) sale con SU código, no como silencio', async (failure, error) => {
    mockFind.mockResolvedValue(queued());
    mockRpc.mockResolvedValue({ validated: false });
    mockProveVerdict.mockResolvedValue(
      unreadableProof(failure, { status: 409, error, detail: 'deterministic', retryable: false }),
    );
    const res = await post('u-owner', XRPL);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error, marked: false, reported: false, retryable: false });
    expect(mockReport).not.toHaveBeenCalled();
  });

  // …y al PREPARADOR no se le gatea por un fallo de lectura nuestro: su informe se
  // guarda igual (la salida jamás se gatea), marcado como no probado — que es lo
  // único que sabemos de él.
  it('el preparador sigue pudiendo avisar aunque la tienda de pruebas no conteste', async () => {
    mockFind.mockResolvedValue(queued());
    mockRpc.mockResolvedValue({ validated: false });
    mockProveVerdict.mockResolvedValue(
      unreadableProof('read-failed', { status: 503, error: 'PROOF_STORE_UNREADABLE', detail: 'x', retryable: true }),
    );
    const res = await post('u-preparer');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ marked: false, status: 'PENDING_LEDGER', reported: true });
    expect(mockReport).toHaveBeenCalledWith(MEMO, HASH, { userId: 'u-preparer', proven: false });
  });

  // §R1 1.3 — el informe se guarda o se falla RUIDOSAMENTE.
  it('un informe que no se pudo escribir no se contesta «recibido»: 503, y se dice que nada sostiene el asiento', async () => {
    mockFind.mockResolvedValue(queued());
    mockRpc.mockResolvedValue({ validated: false });
    mockReport.mockResolvedValue(false); // la escritura se tragó su fallo de BD
    const res = await post('u-preparer');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      error: 'SEAT_STATE_UNREADABLE',
      marked: false,
      reported: false,
      retryable: true,
      status: 'PENDING_LEDGER',
    });
    expect(res.body.detail).toMatch(/again in a moment/i);
  });

  it('…pero si la relectura demuestra que SÍ entró, la respuesta sigue siendo el 202 de siempre', async () => {
    mockFind.mockResolvedValue(queued({ reportedTxHash: HASH.toUpperCase() }));
    mockRpc.mockResolvedValue({ validated: false });
    mockReport.mockResolvedValue(false);
    const res = await post('u-preparer');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ marked: false, status: 'PENDING_LEDGER' });
  });

  it('una firma VALIDADA que no se pudo escribir → 503, jamás un 200 «marked:false» mudo', async () => {
    mockFind.mockResolvedValue(queued());
    mockRpc.mockResolvedValue({
      validated: true,
      meta: { TransactionResult: 'tesSUCCESS' },
      TransactionType: 'Payment',
      Account: XRPL,
      Memos: [{ Memo: { MemoData: MEMO } }],
    });
    mockMark.mockResolvedValue(false);
    const res = await post('u-preparer');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'SEAT_STATE_UNREADABLE', marked: false, retryable: true });
    expect(res.body.detail).toMatch(/validated on the XRP Ledger/i);
  });

  // §R1 1.4 — y el tec* que no se pudo liberar no promete un asiento libre.
  it('un tec* cuya liberación no se escribió no dice «its nonce seat is free»', async () => {
    mockFind.mockResolvedValue(queued());
    mockRpc.mockResolvedValue({
      validated: true,
      meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' },
      TransactionType: 'Payment',
      Account: XRPL,
      Memos: [{ Memo: { MemoData: MEMO } }],
    });
    mockMarkFailed.mockResolvedValue(false);
    const res = await post('u-preparer');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'SEAT_STATE_UNREADABLE', seatFreed: false, retryable: true });
    expect(res.body.detail).not.toMatch(/seat is free/i);
    expect(res.body.detail).toMatch(/still held here/i);
  });

  // …y un memo que de verdad no existe sigue siendo el 200 de siempre: «no pude
  // leer» es lo único que cambia de respuesta.
  it('un memo que de verdad no existe sigue contestando 200 marked:false', async () => {
    mockFind.mockResolvedValue(null);
    const res = await post('u-preparer');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ marked: false });
  });
});

/**
 * LA SALIDA NO SE CASTIGA CON UNA LECTURA FALLIDA, Y
 * TAMPOCO SE QUEDA MARCADA «DE QUIEN NO PRUEBA».
 *
 * `seatClaimOf` usaba la forma booleana, que colapsa «no pude leer» y «no lo has
 * probado» en el mismo `false`: la fila se componía marcada como de un extraño
 * —justo la que §1.1 deja desplazable— y el usuario acababa en un 409 definitivo.
 */
describe('seatClaimOf — el 503 de la tienda de pruebas sobrevive hasta la respuesta (§2.2)', () => {
  const unmint = (user: string) =>
    request(app)
      .post('/api/flare-demo/pa-unmint/prepare')
      .set('x-test-user', user)
      .send({ xrplAddress: XRPL, amountFxrpBase: '10000000', amountXrpForMint: 1 });

  const unreadable = (failure: string, refusal: Record<string, unknown>) => ({
    proven: false,
    storeReadable: false,
    failure,
    addresses: [],
    refusal,
  });

  it('una SALIDA con la tienda ILEGIBLE (causa transitoria) → 503 reintentable, y no compone nada', async () => {
    mockProveVerdict.mockResolvedValue(
      unreadable('read-failed', { status: 503, error: 'PROOF_STORE_UNREADABLE', detail: 'could not read', retryable: true }),
    );
    const res = await unmint('u-1');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROOF_STORE_UNREADABLE', retryable: true });
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockProveVerdict).toHaveBeenCalledWith('u-1', expect.anything(), XRPL, 'exit');
  });

  // Lo que no puede pasar es que esa fila quede
  // marcada «de quien no prueba» y por tanto desplazable: viaja
  // `preparedByProofUnreadable`, que es «no pude preguntar», no «no la probó».
  it.each([
    ['no-user-row', 'ACCOUNT_RECORD_MISSING'],
    ['unreadable-floor', 'PROOF_FLOOR_UNREADABLE'],
  ])('una causa determinista (%s) compone la salida, marcada «no pude preguntar»', async (failure, error) => {
    mockProveVerdict.mockResolvedValue(unreadable(failure, { status: 409, error, detail: 'deterministic', retryable: false }));
    const res = await unmint('u-1');
    expect(res.status).toBe(200);
    expect(mockBuild.mock.calls[0][1]).toMatchObject({
      preparedByProven: false,
      preparedByProofUnreadable: true,
      supersedeAuthorized: false,
    });
  });

  it('una sesión que sí prueba compone con preparedByProofUnreadable:false', async () => {
    mockProven.mockResolvedValue([XRPL]);
    await unmint('u-1');
    expect(mockBuild.mock.calls[0][1]).toMatchObject({ preparedByProven: true, preparedByProofUnreadable: false });
  });

  it('una ENTRADA con la tienda ilegible sigue fallando cerrada, sin 503', async () => {
    mockProveVerdict.mockResolvedValue({
      proven: false,
      storeReadable: false,
      failure: 'read-failed',
      addresses: [],
      refusal: { status: 403, error: 'ADDRESS_NOT_PROVEN', detail: 'no', retryable: false },
    });
    const res = await request(app)
      .post('/api/flare-demo/pa-fxrp-entry/prepare')
      .set('x-test-user', 'u-1')
      .send({ xrplAddress: XRPL, amountXrp: 1 });
    expect(res.status).not.toBe(503);
  });
});

/**
 * NINGUNA PUERTA COLAPSA EL CÓDIGO DE OTRA.
 *
 * Las dos puertas del handoff miraban solo el 503 y convertían todo lo demás en
 * un 403 `NOT_THE_HANDOFF_OWNER` cuya frase —«lo preparó otra sesión, para una
 * cuenta que esta no ha probado»— es FALSA cuando lo que pasó es que falta el
 * registro de la cuenta (`ACCOUNT_RECORD_MISSING`) o su bloque de seguridad no se
 * puede leer (`PROOF_FLOOR_UNREADABLE`): dos 409 deterministas cuya prosa nombra
 * las dos salidas reales (entrar con esa wallet, o que un admin repare la fila).
 */
describe('los 409 deterministas del veredicto salen con su código (§Q1 1.6)', () => {
  const missingRecord = {
    proven: false,
    storeReadable: false,
    failure: 'no-user-row',
    addresses: [],
    refusal: {
      status: 409,
      error: 'ACCOUNT_RECORD_MISSING',
      detail: 'We could not find the account record behind this session. Sign in with the wallet that controls this address.',
      retryable: false,
    },
  };
  const unreadableFloor = {
    ...missingRecord,
    failure: 'unreadable-floor',
    refusal: {
      status: 409,
      error: 'PROOF_FLOOR_UNREADABLE',
      detail: "This account's security record cannot be read, so linked wallets stay out until it is repaired.",
      retryable: false,
    },
  };

  it('/handoff/release no disfraza «falta el registro de la cuenta» de «no eres el dueño»', async () => {
    mockFind.mockResolvedValue({ memoHex: MEMO, xrplAddress: XRPL, preparedByUserId: 'u-owner', createdAt: new Date() });
    mockProveVerdict.mockResolvedValue(missingRecord);
    const res = await request(app).post('/api/flare-demo/handoff/release').set('x-test-user', 'u-other').send({ memoHex: MEMO });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'ACCOUNT_RECORD_MISSING', retryable: false, released: false });
    expect(res.body.detail).toContain('Sign in with the wallet');
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it('/handoff/payload-opened tampoco, y el 403 honesto sigue siendo el suyo', async () => {
    mockFind.mockResolvedValue({
      memoHex: MEMO,
      xrplAddress: XRPL,
      preparedByUserId: 'u-owner',
      lastLedgerSequence: 90_000_090,
      composedLedgerIndex: 90_000_000,
      createdAt: new Date(),
    });
    mockProveVerdict.mockResolvedValue(unreadableFloor);
    const stamped = await request(app)
      .post('/api/flare-demo/handoff/payload-opened')
      .set('x-test-user', 'u-other')
      .send({ memoHex: MEMO, expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    expect(stamped.status).toBe(409);
    expect(stamped.body).toMatchObject({ error: 'PROOF_FLOOR_UNREADABLE', retryable: false, stamped: false });

    mockProveVerdict.mockReset();
    mockProven.mockResolvedValue([]); // la tienda SÍ se leyó: ahí el 403 es verdad
    const stranger = await request(app)
      .post('/api/flare-demo/handoff/payload-opened')
      .set('x-test-user', 'u-other')
      .send({ memoHex: MEMO, expiresAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe('NOT_THE_HANDOFF_OWNER');
  });
});

/**
 * LA VENTANA DE FIRMA VIAJA CON CADA 0xFE.
 *
 * El frontend ya sabe aprender `payloadExpiryMin`, pero ningún
 * prepare de este router lo contestaba: el cliente se quedaba con su constante de
 * 5 min escrita a mano y, el día que el servidor baje la suya, el asiento se
 * suelta con el payload aún firmable — el gemelo. Ahora sale en la respuesta, y
 * es la del dispatch: una ceremonia dice sus 24 h.
 */
describe('cada 0xFE contesta la ventana con la que el servidor lo mide (§Q1 1.2)', () => {
  const prepare = () =>
    request(app)
      .post('/api/flare-demo/pa-unmint/prepare')
      .set('x-test-user', 'u-1')
      .send({ xrplAddress: XRPL, amountFxrpBase: '10000000', amountXrpForMint: 1 });

  it('el prepare lleva payloadExpiryMin y la caducidad ya estampada', async () => {
    const payloadExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    mockBuild.mockImplementation(async () => ({ ...handoff(), payloadExpiryMin: 5, payloadExpiresAt }));
    const res = await prepare();
    expect(res.status).toBe(200);
    expect(res.body.payloadExpiryMin).toBe(5);
    expect(res.body.payloadExpiresAt).toBe(payloadExpiresAt);
  });

  it('y si ese 0xFE lo firma un quórum, la cifra que viaja es la suya (24 h)', async () => {
    mockBuild.mockImplementation(async () => ({ ...handoff(), payloadExpiryMin: 1440 }));
    expect((await prepare()).body.payloadExpiryMin).toBe(1440);
  });

  it('un handoff antiguo sin la cifra no deja al cliente inventándosela: sale la del servidor', async () => {
    mockBuild.mockImplementation(async () => handoff());
    expect((await prepare()).body.payloadExpiryMin).toBe(5);
  });
});

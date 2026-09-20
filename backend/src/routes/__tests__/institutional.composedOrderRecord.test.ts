/**
 * LA ORDEN FIRMADA SE ENTREGA SIN NAVEGADOR.
 *
 * `/pote-council-order/prepare` y `/cage-order/prepare` RECUERDAN la orden
 * compuesta (memo, bytes, cuenta, Sequence/LastLedgerSequence fijadas, ledger de
 * composición) antes de entregarla, para que el vigía del relé la lleve a Flare
 * aunque la pantalla que firma se cierre. Sin poder recordarla → 503
 * ORDER_RECOVERY_UNRECORDED y ninguna orden firmable sale. `/cage-create` (0xFE)
 * no pasa por aquí: su executor barre el Core Vault solo.
 *
 * Hermético: el mismo arnés que institutional.orderSequencePin.test.ts.
 */
import express from 'express';
import request from 'supertest';

const COUNCIL = 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY';
const FACTORY = '0xfac0000000000000000000000000000000000001';
const CAGE_ADDR = '0xca9e000000000000000000000000000000000002';
const BRIDGE = '0xb41d000000000000000000000000000000000003';
const VALIDATED = 90_000_000;
let mockExistingCage: { cage: string; bridge: string } | null = null;

const mockXrplJsonRpc = jest.fn();
jest.mock('../../services/flare/DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockXrplJsonRpc(...a),
}));

const mockRecord = jest.fn();
jest.mock('../../services/flare/ComposedCouncilOrderStore', () => ({
  ...jest.requireActual('../../services/flare/ComposedCouncilOrderStore'),
  recordComposedCouncilOrder: (...a: unknown[]) => mockRecord(...a),
}));

jest.mock('../../services/flare/LegacyCageResolver', () => ({
  ...jest.requireActual('../../services/flare/LegacyCageResolver'),
  isCageV2Council: jest.fn(async () => false),
  cageForCouncil: jest.fn(async () => ({
    chain: 'flare',
    rpcUrl: 'http://rpc.invalid',
    sourceId: 'XRP',
    explorerTx: '',
    bridge: BRIDGE,
    vault: CAGE_ADDR,
    orderAnchor: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  })),
  astryumCageFactoryAddress: jest.fn(() => FACTORY),
}));

jest.mock('../../services/ManagerCredentialGate', () => ({
  managerGateConfig: jest.fn(() => ({ enabled: false })),
  checkManagerCredential: jest.fn(),
  managerGateRefusal: jest.fn(),
}));

const MEMO = 'AB'.repeat(32);
const orderTx = () => ({
  TransactionType: 'Payment',
  Account: COUNCIL,
  Destination: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  Amount: '1',
  Memos: [{ Memo: { MemoData: MEMO } }],
});
const order = { action: 'recall', orderHash: `0x${'ab'.repeat(32)}`, memoHex: MEMO, orderData: '0xdead', nonce: 7, summary: 's' };
const disclosure = { disclosedToUser: true, astryumSigns: false, note: '', facts: {} };

const mockBuildCouncilOrder = jest.fn(async () => ({ xrplTx: orderTx(), order, disclosure }));
jest.mock('../../connectors/protocols/xrpl/XrplCouncilOrderService', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplCouncilOrderService'),
  buildCouncilOrderHandoff: (...a: unknown[]) => mockBuildCouncilOrder(...(a as [])),
  legacyNetworkConfig: () => ({
    chain: 'flare',
    rpcUrl: 'http://rpc.invalid',
    sourceId: 'XRP',
    explorerTx: '',
    orderAnchor: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  }),
}));

const mockBuildCageOrder = jest.fn(async () => ({ xrplTx: orderTx(), order, disclosure }));
jest.mock('../../connectors/protocols/xrpl/AstryumCageOrderService', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/AstryumCageOrderService'),
  buildCageOrderHandoff: (...a: unknown[]) => mockBuildCageOrder(...(a as [])),
}));

class MockCageCreationError extends Error {
  code = 'X';
}
jest.mock('../../services/flare/AstryumCageCreationService', () => ({
  resolveAstryumCage: jest.fn(async () => mockExistingCage),
  predictCageAddresses: jest.fn(async () => ({ cage: CAGE_ADDR, bridge: BRIDGE })),
  buildCageCreationBatch: jest.fn(() => []),
  readFactoryTerms: jest.fn(async () => ({
    creationFee: 0n,
    treasury: '0x0000000000000000000000000000000000000009',
    registry: '0x0000000000000000000000000000000000000008',
    freePotesPerCage: 3,
    maxPayeeBpsAllowed: 2000,
  })),
  validateCageParams: jest.fn(),
  CageCreationError: MockCageCreationError,
}));

jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  readDirectMintParams: jest.fn(async () => ({})),
  computeNetMint: jest.fn(() => ({ supplyUBA: 1_000_000n })),
  buildDirectMintHandoff: jest.fn(async () => ({
    personalAccount: '0x00000000000000000000000000000000000000pa',
    memoHex: 'FE'.repeat(32),
    userOpData: '0x',
    xrplPayment: { TransactionType: 'Payment', Account: COUNCIL, Destination: 'rCoreVault1111111111111111111', Amount: '2000000', Memos: [] },
  })),
  mintFeeDisclosure: jest.fn(() => ({})),
}));
jest.mock('../../connectors/protocols/flare/FlareSmartAccountService', () => ({
  resolvePersonalAccount: jest.fn(async () => '0x1111111111111111111111111111111111111111'),
}));
jest.mock('../../services/dryRun/DryRunExecutor', () => ({ dryRunRigActive: jest.fn(async () => true) }));

const mockRecent = jest.fn();
const mockFate = jest.fn();
jest.mock('../../services/flare/CouncilOrderRelayLauncher', () => ({
  ...jest.requireActual('../../services/flare/CouncilOrderRelayLauncher'),
  recentSameCouncilOrder: (...a: unknown[]) => mockRecent(...a),
  readCouncilOrderFate: (...a: unknown[]) => mockFate(...a),
}));

import '../../database/prismaClient';
import institutionalRouter from '../institutional';
import { xrplProvider } from '../../integrations/providers/chain/XRPLProvider';
import { ComposedOrderUnrecordedError, councilOrderContentKey } from '../../services/flare/ComposedCouncilOrderStore';
import {
  CouncilOrderFateUnreadableError,
  FATE_READS_PER_SESSION_PER_MIN,
  _resetCouncilOrderFateLimiter,
} from '../../services/flare/CouncilOrderRelayLauncher';

const app = express();
app.use(express.json());
app.use('/api/institutional', institutionalRouter);

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, JWT_SECRET: 'k'.repeat(40) };
  delete process.env.DATABASE_URL;
  delete process.env.FLARE_EXECUTOR_ENABLED;
  process.env.INSTITUTIONAL_POTES_ENABLED = 'true';
  process.env.FXRP_TOKEN = '0xad552a648c74d49e10027ab8a618a3ad4901c5be';
  delete process.env.DEFI_EXEC_ENABLED;
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  process.env.DEFI_EXEC_BLOCKED_REGIONS = 'US,CN';
  mockXrplJsonRpc.mockReset();
  mockXrplJsonRpc.mockResolvedValue({ validated: true, ledger_index: VALIDATED, account_data: { Sequence: 4242 } });
  mockRecord.mockReset();
  mockRecord.mockResolvedValue({ recorded: true });
  mockRecent.mockReset();
  mockRecent.mockResolvedValue(null);
  mockFate.mockReset();
  _resetCouncilOrderFateLimiter();
  jest.spyOn(xrplProvider, 'getDidObject').mockResolvedValue({ dataHex: 'ab'.repeat(32) } as never);
});
afterAll(() => {
  process.env = ENV;
});

const ORDER_ROUTES: Array<[string, Record<string, unknown>, 'pote-council-order' | 'cage-order']> = [
  ['/pote-council-order/prepare', { council: COUNCIL, action: 'recall', venueId: 0, amount: '1000' }, 'pote-council-order'],
  ['/cage-order/prepare', { council: COUNCIL, action: 'end-cession', params: {} }, 'cage-order'],
];

describe.each(ORDER_ROUTES)('%s — la orden compuesta queda recordada para su entrega', (path, body, route) => {
  beforeEach(() => {
    mockExistingCage = path === '/cage-order/prepare' ? { cage: CAGE_ADDR, bridge: BRIDGE } : null;
  });

  it('recuerda memo, bytes, cuenta, asiento fijado y ledger ANTES de entregar la orden', async () => {
    const res = await request(app).post(`/api/institutional${path}`).send(body);
    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const arg = mockRecord.mock.calls[0][0];
    expect(arg).toMatchObject({
      route,
      action: body.action,
      council: COUNCIL,
      order: { orderData: '0xdead', memoHex: MEMO },
      pin: { sequence: 4242, lastLedgerSequence: VALIDATED + 150, validatedLedgerIndex: VALIDATED },
    });
    // Lo recordado es EXACTAMENTE lo que se entrega a firmar.
    expect(arg.pinnedTx).toEqual(res.body.xrplTx);
    expect(arg.pinnedTx.Sequence).toBe(4242);
  });

  // Solo en /cage-order: su `end-cession` NO es salida y llega al registro con este
  // arnés. En /pote-council-order la única no-salida es `direct-to`, que antes lee
  // el estado del pote on-chain (no simulado aquí); su `recall` es salida y se
  // prueba en el bloque de abajo. Las dos rutas comparten recordComposedOrderOr503.
  (route === 'cage-order' ? it : it.skip)('una acción que NO es salida, sin poder recordarla → 503 ORDER_RECOVERY_UNRECORDED y NINGUNA orden firmable', async () => {
    mockRecord.mockRejectedValue(new ComposedOrderUnrecordedError(MEMO, 'db down'));
    const res = await request(app).post(`/api/institutional${path}`).send(body);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ORDER_RECOVERY_UNRECORDED');
    expect(res.body).not.toHaveProperty('xrplTx');
  });

  it('sin Sequence legible no se compone ni se recuerda nada', async () => {
    mockXrplJsonRpc.mockRejectedValue(new Error('xrpl_endpoint_stale'));
    const res = await request(app).post(`/api/institutional${path}`).send(body);
    expect(res.status).toBe(503);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

/**
 * LA SALIDA JAMÁS SE GATEA: el registro es una red de
 * seguridad. Si no se puede escribir, un recall/evacuate se entrega IGUAL — con
 * `recoveryWarning` — en vez de dejar al holder sin salida por una BD caída.
 */
// El recall de /cage-order valida sus `params` antes del compositor simulado; la
// misma función con `exit: CAGE_EXIT_ACTIONS.has(action)` se cubre aquí por el pote.
const EXIT_ROUTES: Array<[string, Record<string, unknown>, { cage: string; bridge: string } | null]> = [
  ['/pote-council-order/prepare', { council: COUNCIL, action: 'recall', venueId: 0, amount: '1000' }, null],
];

describe.each(EXIT_ROUTES)('%s — una SALIDA no se gatea por no poder recordarla', (path, body, cage) => {
  it('registro fallido → 200, la orden sale y la respuesta avisa (recoveryWarning)', async () => {
    mockExistingCage = cage;
    mockRecord.mockRejectedValue(new ComposedOrderUnrecordedError(MEMO, 'db down'));
    const res = await request(app).post(`/api/institutional${path}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body.xrplTx).toBeDefined();
    expect(res.body.xrplTx.Sequence).toBe(4242);
    expect(String(res.body.recoveryWarning)).toContain('ORDER_RECOVERY_UNRECORDED');
  });

  it('registro correcto → 200 sin aviso', async () => {
    mockExistingCage = cage;
    const res = await request(app).post(`/api/institutional${path}`).send(body);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('recoveryWarning');
  });
});

/**
 * Lo que la pantalla necesita saber para no prometer de más
 * (`serverDelivery`) y para no componer la orden dos veces (`COUNCIL_ORDER_IN_FLIGHT`).
 */
describe('/15 — serverDelivery, token de salida y la orden repetida', () => {
  const RECALL = { council: COUNCIL, action: 'recall', venueId: 0, amount: '1000' };
  const END_CESSION = { council: COUNCIL, action: 'end-cession', params: {} };
  const IN_FLIGHT = {
    memoHex: MEMO,
    xrplTxHash: 'C'.repeat(64),
    launchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    state: 'executed' as const,
  };

  it('la respuesta dice si el servidor la recordó y si el executor corre', async () => {
    mockExistingCage = null;
    process.env.FLARE_EXECUTOR_ENABLED = 'true';
    const ok = await request(app).post('/api/institutional/pote-council-order/prepare').send(RECALL);
    expect(ok.body.serverDelivery).toEqual({ recorded: true, executorEnabled: true });
    mockRecord.mockRejectedValue(new ComposedOrderUnrecordedError(MEMO, 'db down'));
    const unrecorded = await request(app).post('/api/institutional/pote-council-order/prepare').send(RECALL);
    expect(unrecorded.body.serverDelivery).toEqual({ recorded: false, executorEnabled: true });
  });

  it('un recall del pote lleva exitToken (simetría con el Legacy)', async () => {
    mockExistingCage = null;
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(RECALL);
    expect(typeof res.body.exitToken).toBe('string');
    expect(typeof res.body.exitTokenExpiresAt).toBe('string');
  });

  it('la MISMA orden ejecutada hace 5 min → 409 SAME_ORDER_RECENTLY_LAUNCHED, sin componer ni recordar', async () => {
    mockExistingCage = { cage: CAGE_ADDR, bridge: BRIDGE };
    mockRecent.mockResolvedValue(IN_FLIGHT);
    const res = await request(app).post('/api/institutional/cage-order/prepare').send(END_CESSION);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'SAME_ORDER_RECENTLY_LAUNCHED', xrplTxHash: IN_FLIGHT.xrplTxHash, state: 'executed' });
    expect(res.body).not.toHaveProperty('xrplTx');
    expect(mockRecord).not.toHaveBeenCalled();
    // y la pregunta se hizo por CONTENIDO, no por estado del relé
    expect(mockRecent).toHaveBeenCalledWith(
      COUNCIL,
      councilOrderContentKey({ council: COUNCIL, action: 'end-cession', params: {} }),
      expect.anything(),
    );
  });

  it('confirmAnotherOrder: true la deja pasar', async () => {
    mockExistingCage = { cage: CAGE_ADDR, bridge: BRIDGE };
    mockRecent.mockResolvedValue(IN_FLIGHT);
    const res = await request(app).post('/api/institutional/cage-order/prepare').send({ ...END_CESSION, confirmAnotherOrder: true });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('duplicateWarning');
  });

  it('una orden DISTINTA de la que salió pasa sin avisar (venue 0 y luego venue 1 no son la misma)', async () => {
    mockExistingCage = { cage: CAGE_ADDR, bridge: BRIDGE };
    mockRecent.mockImplementation(async (_council: string, key: string) =>
      key === councilOrderContentKey({ council: COUNCIL, action: 'set-user-gate', params: {} }) ? IN_FLIGHT : null,
    );
    const res = await request(app).post('/api/institutional/cage-order/prepare').send(END_CESSION);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('duplicateWarning');
  });

  it('una SALIDA nunca se para: sale con duplicateWarning', async () => {
    mockExistingCage = null;
    mockRecent.mockResolvedValue(IN_FLIGHT);
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(RECALL);
    expect(res.status).toBe(200);
    expect(res.body.xrplTx).toBeDefined();
    expect(String(res.body.duplicateWarning)).toContain(IN_FLIGHT.xrplTxHash);
  });

  /**
   * LA CLAVE SE CALCULA SOBRE LO QUE SE COMPONE.
   * `/cage-order` la sacaba de `req.body.params` CRUDO, antes de que el servidor
   * resolviera el `feePayer` de un `create-pote`: la orden que de verdad se firma
   * lleva ese campo, así que la clave guardada y la consultada eran distintas y la
   * misma orden pasaba dos veces. Ahora la pregunta y el registro usan el mismo
   * objeto: el que recibe el constructor.
   */
  it('cage-order: la clave sale de los params COMPUESTOS (el feePayer que resuelve el servidor)', async () => {
    mockExistingCage = { cage: CAGE_ADDR, bridge: BRIDGE };
    const body = { council: COUNCIL, action: 'create-pote', params: { name: 'Pote A' } };
    const res = await request(app).post('/api/institutional/cage-order/prepare').send(body);
    expect(res.status).toBe(200);
    const composedParams = { name: 'Pote A', feePayer: '0x1111111111111111111111111111111111111111' };
    const composedKey = councilOrderContentKey({ council: COUNCIL, action: 'create-pote', params: composedParams });
    // Preguntada por la clave de lo compuesto…
    expect(mockRecent).toHaveBeenCalledWith(COUNCIL, composedKey, expect.anything());
    expect(mockRecent).not.toHaveBeenCalledWith(
      COUNCIL,
      councilOrderContentKey({ council: COUNCIL, action: 'create-pote', params: { name: 'Pote A' } }),
      expect.anything(),
    );
    // …y guardada con la misma: la próxima composición idéntica la encuentra.
    expect(mockRecord.mock.calls[0][0]).toMatchObject({ contentKey: composedKey });
  });

  it('Lo recordado dice QUIÉN compuso y si controla el consejo (tope por preparador)', async () => {
    mockExistingCage = null;
    const res = await request(app).post('/api/institutional/pote-council-order/prepare').send(RECALL);
    expect(res.status).toBe(200);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      preparedByUserId: null,
      // sin sesión probada, la composición cuenta contra la cola del preparador, no la del consejo
      preparedByProven: false,
      contentKey: councilOrderContentKey({ council: COUNCIL, action: 'recall', params: { venueId: 0, amount: '1000' } }),
      exit: true,
    });
  });
});

describe('GET /council-order/fate', () => {
  it('memo inválido → 400', async () => {
    const res = await request(app).get('/api/institutional/council-order/fate?memo=zz');
    expect(res.status).toBe(400);
    expect(mockFate).not.toHaveBeenCalled();
  });

  it('devuelve el destino tal cual lo lee el servidor', async () => {
    mockFate.mockResolvedValue({ memo: MEMO, state: 'validated', xrplTxHash: 'D'.repeat(64) });
    const res = await request(app).get(`/api/institutional/council-order/fate?memo=${MEMO.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ memo: MEMO, state: 'validated', xrplTxHash: 'D'.repeat(64) });
    expect(mockFate).toHaveBeenCalledWith(MEMO.toLowerCase());
  });

  it('«no pude leer» → 503, jamás unknown', async () => {
    mockFate.mockRejectedValue(new CouncilOrderFateUnreadableError('ledger down'));
    const res = await request(app).get(`/api/institutional/council-order/fate?memo=${MEMO}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('COUNCIL_ORDER_FATE_UNREADABLE');
  });

  /* La lectura cuesta cadena — una sola por memo y 15 s, con tope por sesión. */

  it('el mismo memo dos veces seguidas se lee de la cadena UNA vez', async () => {
    mockFate.mockResolvedValue({ memo: MEMO, state: 'composed' });
    await request(app).get(`/api/institutional/council-order/fate?memo=${MEMO}`);
    const second = await request(app).get(`/api/institutional/council-order/fate?memo=${MEMO.toLowerCase()}`);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ state: 'composed' });
    expect(mockFate).toHaveBeenCalledTimes(1);
  });

  it('un bucle de memos distintos topa con su presupuesto: 429 con Retry-After, sin leer más cadena', async () => {
    mockFate.mockImplementation(async (memo: string) => ({ memo, state: 'composed' }));
    for (let i = 0; i < FATE_READS_PER_SESSION_PER_MIN; i++) {
      const ok = await request(app).get(`/api/institutional/council-order/fate?memo=${i.toString(16).padStart(64, '0')}`);
      expect(ok.status).toBe(200);
    }
    const res = await request(app).get(`/api/institutional/council-order/fate?memo=${'FF'.repeat(32)}`);
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('COUNCIL_ORDER_FATE_RATE_LIMITED');
    expect(res.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers['retry-after']).toBeDefined();
    expect(mockFate).toHaveBeenCalledTimes(FATE_READS_PER_SESSION_PER_MIN);
  });
});

describe('/cage-create/prepare — el 0xFE lo encuentra su executor, no el relé', () => {
  it('no recuerda nada como orden de consejo', async () => {
    mockExistingCage = null;
    const res = await request(app)
      .post('/api/institutional/cage-create/prepare')
      .send({ account: COUNCIL, amountXrp: '2', allowedTargets: [] });
    expect(res.status).toBe(200);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

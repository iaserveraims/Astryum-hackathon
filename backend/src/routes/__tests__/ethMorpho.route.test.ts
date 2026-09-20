/**
 * La ruta del carril FXRP/RLUSD — CERO tests hasta hoy, siete endpoints.
 *
 * Lo que aquí se fija no es la lógica de dinero (esa vive en los servicios y
 * ya está cubierta): es la FRONTERA. Nadie probaba que la flag apagada cierre
 * de verdad, que la geovalla responda 451, que un drift de parámetros salga
 * como 409 (y no como un 500 que la UI pintaría como «error raro»), ni que un
 * RPC caído se distinga de un fallo nuestro. Esa frontera es la que decide si
 * un usuario puede llegar a firmar.
 */
const mockGeo = jest.fn(() => ({ allowed: true }) as { allowed: boolean; reason?: string });
jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: (...a: unknown[]) => mockGeo(...(a as [])) },
}));

// El RPC no se toca en los tests: cada endpoint recibe su lectura por mock.
jest.mock('../../utils/rpcForChain', () => ({ getRpcForChain: jest.fn(() => ({})) }));

// /close/prepare construye el cotizador del swap del hueco (venue de Ethereum por
// env): en test se sustituye por uno inerte — el servicio que lo usa está mockeado.
jest.mock('../../services/ethMorphoReaders', () => ({
  ...jest.requireActual('../../services/ethMorphoReaders'),
  makeEthFillQuoter: jest.fn(() => async () => undefined),
}));

const mockReadSnapshot = jest.fn();
const mockPosition = jest.fn();
const mockComputePosition = jest.fn();
jest.mock('../../services/EthMorphoMarketService', () => ({
  makeEthersMorphoReader: jest.fn(() => ({ position: (...a: unknown[]) => mockPosition(...a) })),
  readMarketSnapshot: (...a: unknown[]) => mockReadSnapshot(...a),
  computeUserPosition: (...a: unknown[]) => mockComputePosition(...a),
}));

// El escáner KWYH (invariante 10). Por defecto limpio; los tests lo tuercen.
const mockGoPlus = jest.fn(async () => ({ data: { verdict: 'safe', flags: [] as string[] } }));
jest.mock('../../integrations/providers/security/GoPlusProvider', () => ({
  goPlusProvider: { call: (...a: unknown[]) => mockGoPlus(...(a as [])) },
}));

const mockPrepare = jest.fn();
const mockClose = jest.fn();
const mockVault = jest.fn();
const mockBridge = jest.fn();
const mockBridgeBack = jest.fn();
jest.mock('../../services/EthMorphoPrepareService', () => ({
  prepareEthMorpho: (...a: unknown[]) => mockPrepare(...a),
  prepareSentoraVault: (...a: unknown[]) => mockVault(...a),
  prepareFxrpBridge: (...a: unknown[]) => mockBridge(...a),
  prepareFxrpBridgeBack: (...a: unknown[]) => mockBridgeBack(...a),
  prepareCloseCarry: (...a: unknown[]) => mockClose(...a),
}));

import express from 'express';
import request from 'supertest';
import router from '../ethMorpho';

const app = express();
app.use(express.json());
app.use('/api/eth-morpho', router);

const WALLET = '0x1111111111111111111111111111111111111111';

const SNAPSHOT = {
  params: { lltv: 770000000000000000n, loanToken: '0xL', collateralToken: '0xC' },
  state: {},
  availableLiquidity: 500n,
  utilization: 0.9,
  oraclePrice: 1n,
  loanDecimals: 18,
  collateralDecimals: 6,
  borrowAprPct: 4.26,
  borrowAprSource: 'AdaptiveCurveIRM borrowRateView (Ethereum, on-chain)',
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.ETH_RLUSD_FXRP_ENABLED = 'true';
  mockGeo.mockReturnValue({ allowed: true });
  mockGoPlus.mockResolvedValue({ data: { verdict: 'safe', flags: [] } });
  mockReadSnapshot.mockResolvedValue(SNAPSHOT);
  mockPosition.mockResolvedValue({ supplyShares: 0n, borrowShares: 0n, collateral: 0n });
  mockComputePosition.mockReturnValue({
    collateral: 5n * 10n ** 6n,
    borrowShares: 1n,
    borrowAssets: 2n * 10n ** 18n,
    maxBorrow: 4n * 10n ** 18n,
    collateralValue: 5n * 10n ** 18n,
    healthFactor: 2,
  });
});

describe('la frontera: flag + geovalla', () => {
  it('con la flag APAGADA todo el carril responde 503 — el kill-switch cierra de verdad', async () => {
    process.env.ETH_RLUSD_FXRP_ENABLED = 'false';
    for (const [method, path] of [
      ['get', '/api/eth-morpho/market'],
      ['get', `/api/eth-morpho/position?wallet=${WALLET}`],
      ['get', '/api/eth-morpho/vault'],
    ] as const) {
      const res = await (request(app) as never as Record<string, (p: string) => Promise<{ status: number; body: { error: string } }>>)[method](path);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('ETH_RLUSD_FXRP_DISABLED');
    }
  });

  it('/status dice la verdad de la flag SIN geovalla — las cards lo leen para esconderse', async () => {
    process.env.ETH_RLUSD_FXRP_ENABLED = 'false';
    const off = await request(app).get('/api/eth-morpho/status');
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);

    process.env.ETH_RLUSD_FXRP_ENABLED = 'true';
    const on = await request(app).get('/api/eth-morpho/status');
    expect(on.body.active).toBe(true);
  });

  it('una región bloqueada responde 451 en una ENTRADA, no 403 ni 500', async () => {
    mockGeo.mockReturnValue({ allowed: false, reason: 'region not allowed' });
    const res = await request(app)
      .post('/api/eth-morpho/prepare')
      .send({ action: 'supply_collateral', user: WALLET, amountBase: '1000000', region: 'US' });
    expect(res.status).toBe(451);
    expect(res.body.error).toContain('GEOFENCE_BLOCKED');
  });
});

/**
 * LAS LECTURAS NO SE GEOFENCEAN (doctrina «LA SALIDA JAMÁS SE GATEA»).
 *
 * Cada modal de salida LEE antes de preparar: EmExitModal lee /position y /market,
 * EmRepayModal y EmBridgeModal leen /market, la retirada lend-only lee /vault. Con
 * esas lecturas en 451, los prepare de salida (ya sin geovalla) eran inalcanzables
 * desde la app en una región bloqueada. Una lectura no abre exposición: solo flag.
 */
describe('las lecturas del carril: solo flag, jamás la geovalla', () => {
  beforeEach(() => {
    mockGeo.mockReturnValue({ allowed: false, reason: 'region not allowed' });
  });

  it('GET /market en región bloqueada → 200 con el snapshot, sin preguntar a la geovalla', async () => {
    mockReadSnapshot.mockResolvedValue({
      ...SNAPSHOT,
      state: { totalSupplyAssets: 1000n, totalBorrowAssets: 900n },
    });
    const res = await request(app).get('/api/eth-morpho/market?region=US');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ chainId: 1, decimals: { collateral: 6, loan: 18 } });
    expect(mockGeo).not.toHaveBeenCalled();
  });

  it('GET /position en región bloqueada → 200 con la posición, sin preguntar a la geovalla', async () => {
    const res = await request(app).get(`/api/eth-morpho/position?wallet=${WALLET}&region=US`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasPosition: true, collateralDecimals: 6, debtDecimals: 18 });
    expect(mockGeo).not.toHaveBeenCalled();
  });

  // /balances, /vault y /preliquidation leen de otras cadenas o de APIs externas
  // que este suite no mockea: su frontera se fija por FUENTE (abajo) y por el 503.

  it('con la flag APAGADA las lecturas siguen respondiendo 503 — el kill-switch se queda', async () => {
    process.env.ETH_RLUSD_FXRP_ENABLED = 'false';
    for (const path of [
      '/api/eth-morpho/market?region=US',
      `/api/eth-morpho/position?wallet=${WALLET}&region=US`,
      `/api/eth-morpho/balances?wallet=${WALLET}&region=US`,
      '/api/eth-morpho/vault?region=US',
      '/api/eth-morpho/preliquidation?region=US',
    ]) {
      const res = await request(app).get(path);
      expect({ path, status: res.status, error: res.body.error }).toEqual({
        path,
        status: 503,
        error: 'ETH_RLUSD_FXRP_DISABLED',
      });
    }
    expect(mockReadSnapshot).not.toHaveBeenCalled();
  });

  describe('por fuente — ninguna lectura llega a la geovalla', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { join } = require('path') as typeof import('path');
    const SOURCE = readFileSync(join(__dirname, '..', 'ethMorpho.ts'), 'utf8');
    const blockOf = (path: string): string => {
      const start = SOURCE.indexOf(`router.get('${path}'`);
      expect({ path, found: start > -1 }).toEqual({ path, found: true });
      const next = SOURCE.indexOf('\nrouter.', start + 10);
      return SOURCE.slice(start, next === -1 ? undefined : next);
    };

    it.each(['/position', '/balances', '/market', '/vault', '/preliquidation'])(
      'GET %s usa gateEthMorphoRead(), nunca gateEthMorpho(region)',
      (path) => {
        const body = blockOf(path);
        expect({ path, read: body.includes('gateEthMorphoRead()') }).toEqual({ path, read: true });
        expect({ path, geofenced: /gateEthMorpho\(|isDefiExecutionAllowed/.test(body) }).toEqual({
          path,
          geofenced: false,
        });
      },
    );

    it('gateEthMorphoRead no toca la geovalla', () => {
      const start = SOURCE.indexOf('function gateEthMorphoRead(');
      expect(start).toBeGreaterThan(-1);
      const body = SOURCE.slice(start, SOURCE.indexOf('\n}\n', start));
      expect(body).not.toContain('isDefiExecutionAllowed');
      expect(body).not.toContain('gateEthMorpho(');
    });
  });
});

/**
 * LA SALIDA JAMÁS SE GATEA (doctrina). Repagar, retirar colateral,
 * cerrar la posición, redimir de la bóveda y traer el FXRP de vuelta a Flare
 * son salidas: solo flag, sin geovalla. Las entradas siguen respondiendo 451.
 */
describe('la geovalla no retiene una salida; las entradas siguen cerradas', () => {
  const OK = { chainId: 1, legs: [], preflight: { ok: true, checks: [] } };
  beforeEach(() => {
    mockGeo.mockReturnValue({ allowed: false, reason: 'region not allowed' });
    mockPrepare.mockResolvedValue(OK);
    mockClose.mockResolvedValue(OK);
    mockVault.mockResolvedValue(OK);
    mockBridge.mockResolvedValue(OK);
    mockBridgeBack.mockResolvedValue(OK);
  });

  const EXITS: Array<[string, Record<string, unknown>]> = [
    ['/close/prepare', { user: WALLET }],
    ['/prepare', { action: 'repay', user: WALLET, repayMode: 'full' }],
    ['/prepare', { action: 'withdraw_collateral', user: WALLET, amountBase: '1000000' }],
    ['/vault/prepare', { action: 'vault_withdraw', user: WALLET, amountBase: '1000' }],
    ['/bridge/prepare', { user: WALLET, amountBase: '1000000', direction: 'to-flare' }],
  ];
  it.each(EXITS)('SALIDA %s en región bloqueada → 200, sin preguntar a la geovalla', async (path, body) => {
    const res = await request(app).post(`/api/eth-morpho${path}`).send({ ...body, region: 'US' });
    expect({ path, status: res.status }).toEqual({ path, status: 200 });
    expect(mockGeo).not.toHaveBeenCalled();
  });

  it('con la flag APAGADA una salida sigue respondiendo 503 — el kill-switch se queda', async () => {
    process.env.ETH_RLUSD_FXRP_ENABLED = 'false';
    const res = await request(app).post('/api/eth-morpho/close/prepare').send({ user: WALLET, region: 'US' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('ETH_RLUSD_FXRP_DISABLED');
    expect(mockClose).not.toHaveBeenCalled();
  });

  const ENTRIES: Array<[string, Record<string, unknown>]> = [
    ['/prepare', { action: 'supply_collateral', user: WALLET, amountBase: '1000000' }],
    ['/prepare', { action: 'open_carry', user: WALLET, amountBase: '1000000', borrowBase: '1' }],
    ['/vault/prepare', { action: 'vault_deposit', user: WALLET, amountBase: '1000' }],
    ['/bridge/prepare', { user: WALLET, amountBase: '1000000', direction: 'to-ethereum' }],
  ];
  it.each(ENTRIES)('ENTRADA %s en región bloqueada → 451', async (path, body) => {
    const res = await request(app).post(`/api/eth-morpho${path}`).send({ ...body, region: 'US' });
    expect(res.status).toBe(451);
    expect(res.body.error).toContain('GEOFENCE_BLOCKED');
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockVault).not.toHaveBeenCalled();
    expect(mockBridge).not.toHaveBeenCalled();
  });

  it('DANGER en /close/prepare: 200 con riskWarnings (cerrar es la salida por excelencia)', async () => {
    mockGoPlus.mockResolvedValue({ data: { verdict: 'danger', flags: ['honeypot'] } });
    const res = await request(app).post('/api/eth-morpho/close/prepare').send({ user: WALLET, region: 'US' });
    expect(res.status).toBe(200);
    expect(mockClose).toHaveBeenCalled();
    expect(res.body.riskWarnings.map((w: { code: string }) => w.code)).toEqual([
      'KWYH_DANGER_FXRP',
      'KWYH_DANGER_RLUSD',
    ]);
  });
});

describe('GET /position — la lectura que hace visible la posición (H1)', () => {
  it('devuelve base units con los decimales LEÍDOS y el HF', async () => {
    const res = await request(app).get(`/api/eth-morpho/position?wallet=${WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      chainId: 1,
      hasPosition: true,
      collateralDecimals: 6,
      debtDecimals: 18, // la asimetría 6/18 viaja, nunca se asume en el cliente
      healthFactor: 2,
      collateralSymbol: 'FXRP',
      debtSymbol: 'RLUSD',
    });
  });

  it('sin deuda, el HF viaja como null — un 0 parecería liquidación', async () => {
    mockComputePosition.mockReturnValue({
      collateral: 5n * 10n ** 6n, borrowShares: 0n, borrowAssets: 0n,
      maxBorrow: 0n, collateralValue: 0n, healthFactor: Infinity,
    });
    const res = await request(app).get(`/api/eth-morpho/position?wallet=${WALLET}`);
    expect(res.body.healthFactor).toBeNull();
    expect(res.body.hasPosition).toBe(true); // colateral sin deuda SIGUE siendo posición
  });

  it('una cuenta sin nada responde hasPosition:false — un cero legítimo, no un fallo', async () => {
    mockComputePosition.mockReturnValue({
      collateral: 0n, borrowShares: 0n, borrowAssets: 0n,
      maxBorrow: 0n, collateralValue: 0n, healthFactor: Infinity,
    });
    const res = await request(app).get(`/api/eth-morpho/position?wallet=${WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.hasPosition).toBe(false);
  });

  it('rechaza una dirección inválida antes de tocar la cadena', async () => {
    const res = await request(app).get('/api/eth-morpho/position?wallet=rXRPLNotEvm');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_WALLET');
    expect(mockReadSnapshot).not.toHaveBeenCalled();
  });

  it('un RPC caído es 503 (no nuestro), un fallo cualquiera es 502', async () => {
    mockReadSnapshot.mockRejectedValueOnce(new Error('UNSUPPORTED_CHAIN: no Ethereum RPC configured'));
    const rpc = await request(app).get(`/api/eth-morpho/position?wallet=${WALLET}`);
    expect(rpc.status).toBe(503);

    mockReadSnapshot.mockRejectedValueOnce(new Error('something else broke'));
    const other = await request(app).get(`/api/eth-morpho/position?wallet=${WALLET}`);
    expect(other.status).toBe(502);
  });
});

describe('POST /prepare — validación y los «no» que importan', () => {
  const body = { action: 'repay', user: WALLET, repayMode: 'full' as const };

  it('un cuerpo inválido es 400 y NUNCA llega al servicio', async () => {
    const res = await request(app).post('/api/eth-morpho/prepare').send({ action: 'nope', user: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('el DRIFT de parámetros sale como 409 — el mercado ya no es el que se firma', async () => {
    mockPrepare.mockRejectedValue(
      Object.assign(new Error('params drifted'), { code: 'MARKET_PARAMS_DRIFT' }),
    );
    const res = await request(app).post('/api/eth-morpho/prepare').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('MARKET_PARAMS_DRIFT');
  });

  it('NO_DEBT y REPAY_EXCEEDS_DEBT son 400 con su código, para que la UI hable claro', async () => {
    for (const code of ['NO_DEBT', 'REPAY_EXCEEDS_DEBT']) {
      mockPrepare.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
      const res = await request(app).post('/api/eth-morpho/prepare').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(code);
    }
  });

  it('el prepare pasa el gate y devuelve lo que compuso el servicio', async () => {
    mockPrepare.mockResolvedValue({ chainId: 1, legs: [], preflight: { ok: true, checks: [] } });
    const res = await request(app).post('/api/eth-morpho/prepare').send(body);
    expect(res.status).toBe(200);
    expect(res.body.chainId).toBe(1);
  });

  it('con la flag apagada el prepare no compone NADA', async () => {
    process.env.ETH_RLUSD_FXRP_ENABLED = 'false';
    const res = await request(app).post('/api/eth-morpho/prepare').send(body);
    expect(res.status).toBe(503);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  describe('el escáner KWYH es un GATE, no un paso de runbook (invariante 10)', () => {
    it('un token en DANGER para una ENTRADA en seco — 409 y sin componer', async () => {
      mockGoPlus.mockResolvedValue({ data: { verdict: 'danger', flags: ['honeypot'] } });
      const res = await request(app)
        .post('/api/eth-morpho/prepare')
        .send({ action: 'supply_collateral', user: WALLET, amountBase: '1000000' });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/^KWYH_DANGER_/);
      expect(res.body.flags).toContain('honeypot');
      expect(mockPrepare).not.toHaveBeenCalled();
    });

    it('LA SALIDA JAMÁS SE GATEA: DANGER en un repay compone igual y el aviso viaja en riskWarnings', async () => {
      mockGoPlus.mockResolvedValue({ data: { verdict: 'danger', flags: ['honeypot'] } });
      mockPrepare.mockResolvedValue({ chainId: 1, legs: [], preflight: { ok: true, checks: [] } });
      const res = await request(app).post('/api/eth-morpho/prepare').send(body);
      expect(res.status).toBe(200);
      expect(mockPrepare).toHaveBeenCalled();
      expect(res.body.chainId).toBe(1);
      expect(res.body.riskWarnings).toHaveLength(2);
      expect(res.body.riskWarnings[0]).toMatchObject({ code: 'KWYH_DANGER_FXRP', token: 'FXRP' });
      expect(res.body.riskWarnings[0].flags).toContain('honeypot');
    });

    it('sin DANGER una salida no lleva riskWarnings — la forma de la respuesta no cambia', async () => {
      mockPrepare.mockResolvedValue({ chainId: 1, legs: [], preflight: { ok: true, checks: [] } });
      const res = await request(app).post('/api/eth-morpho/prepare').send(body);
      expect(res.status).toBe(200);
      expect(res.body.riskWarnings).toBeUndefined();
    });

    it('un escáner CAÍDO no bloquea el carril — best-effort, se compone igual', async () => {
      // Que el proveedor esté de baja no puede dejar sin repagar a alguien
      // con la posición en riesgo: se sigue, y los pre-flights siguen ahí.
      mockGoPlus.mockRejectedValue(new Error('goplus down'));
      mockPrepare.mockResolvedValue({ chainId: 1, legs: [], preflight: { ok: true, checks: [] } });
      const res = await request(app).post('/api/eth-morpho/prepare').send(body);
      expect(res.status).toBe(200);
      expect(mockPrepare).toHaveBeenCalled();
    });

    it('escanea los DOS tokens del mercado, no solo uno', async () => {
      mockPrepare.mockResolvedValue({ chainId: 1, legs: [], preflight: { ok: true, checks: [] } });
      await request(app).post('/api/eth-morpho/prepare').send(body);
      expect(mockGoPlus).toHaveBeenCalledTimes(2);
    });
  });
});

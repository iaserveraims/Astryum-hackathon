/**
 * H5 + H6 — las dos formas en que una regla del mercado de Ethereum podía
 * mentir en silencio:
 *
 * H5: sin fila `morpho-blue@1` en Protocol (slug es @unique global y el seed
 *     solo siembra Flare), `protocolId` quedaba nulo y el tick agrupaba por
 *     `wallet.chainId ?? 14` — escaneando FLARE para una posición de
 *     Ethereum. La acción fija la cadena por construcción.
 * H6: el HF que decide el disparo venía del snapshot de cartera, que no
 *     tiene adapter para morpho-blue ⇒ `healthFactor` vacío ⇒ la protección
 *     NUNCA saltaba. El HF debe leerse del MERCADO.
 *
 * Un fallo silencioso aquí es peor que no tener la regla: el usuario cree
 * que hay una red debajo de su posición apalancada.
 */
jest.mock('../../../database/prismaClient', () => {
  let rules: any[] = [];
  let lastRun: any = null;
  let lastAlert: any = null;
  return {
    prisma: {
      automationRule: {
        findMany: jest.fn(async () => rules),
        update: jest.fn(async () => ({})),
      },
      automationRun: {
        create: jest.fn(async ({ data }: any) => {
          lastRun = data;
          return { id: 'run-em-1', ...data };
        }),
      },
      alert: {
        create: jest.fn(async ({ data }: any) => {
          lastAlert = data;
          return { id: 'alert-em-1', ...data };
        }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __setRules(rs: any[]) {
      rules = rs;
    },
    __lastRun() {
      return lastRun;
    },
    __lastAlert() {
      return lastAlert;
    },
  };
});

const mockCreateIntent = jest.fn();
jest.mock('../../intent/IntentEngine', () => ({
  IntentEngine: { getInstance: () => ({ createIntent: mockCreateIntent }) },
}));

const mockSendToUser = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../services/PushNotificationService', () => ({
  PushNotificationService: { getInstance: () => ({ sendToUser: mockSendToUser }) },
}));

// El HF del MERCADO — la lectura fiable. Devuelve 1.05 (por debajo del 1.10
// de la regla) mientras el snapshot de cartera no sabe nada del mercado.
const mockFireCheck = jest.fn();
jest.mock('../../../services/EthMorphoMarketService', () => ({
  makeEthersMorphoReader: jest.fn(() => ({})),
  emRepayFireCheck: (...a: unknown[]) => mockFireCheck(...a),
}));
jest.mock('../../../utils/rpcForChain', () => ({ getRpcForChain: jest.fn(() => ({})) }));

// La cartera de Flare NO conoce la posición de Ethereum: sin HF. Si el tick
// se apoyara en esto, la regla no dispararía jamás.
const mockGetPortfolio = jest.fn(async () => ({ positions: [] }));
jest.mock('../../portfolio/PortfolioEngine', () => ({
  PortfolioEngine: { getInstance: () => ({ getPortfolio: mockGetPortfolio }) },
}));
jest.mock('../../risk/RiskEngine', () => ({
  RiskEngine: {
    getInstance: () => ({ evaluateSnapshot: jest.fn(() => ({ score: 0, level: 'LOW' })) }),
  },
}));

import { AutomationEngine } from '../AutomationEngine';
import { emRepayPushUrl } from '../emRepayNudge';
import { jurisdictionService } from '../../../services/JurisdictionService';

const prismaModule = jest.requireMock('../../../database/prismaClient') as {
  __setRules: (rs: unknown[]) => void;
  __lastRun: () => { status: string; notes?: string } | null;
  __lastAlert: () => { data?: Record<string, unknown>; message?: string } | null;
};

const OWNER = '0x1111111111111111111111111111111111111111';

function emRule(over: Record<string, unknown> = {}) {
  return {
    id: 'rule-em-1',
    name: 'Protege mi carry en Ethereum',
    enabled: true,
    cooldownMinutes: 0,
    lastTriggeredAt: null,
    trigger: { type: 'HF_BELOW', threshold: 1.1 },
    action: { kind: 'emRepay', params: { mode: 'partial' } },
    // La wallet está registrada bajo Flare (14) — el caso real: la fila de
    // wallet guarda su chain de CONEXIÓN, no la del mercado.
    wallet: { id: 'w1', address: OWNER, chainId: 14, userId: 'user-1' },
    protocol: null, // no existe morpho-blue@1 (H5)
    ...over,
  };
}

describe('AutomationEngine — emRepay (H5 chain pineada · H6 HF del mercado)', () => {
  const ENV = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    mockFireCheck.mockResolvedValue({ ok: true, debtBase: '1000000000000000000', healthFactor: 1.05 });
    // El carril de Ethereum vive tras su flag + su geofence (invariantes #10 y
    // #5) también EN EL TICK: para que una regla se vigile hay que declararlo
    // abierto, igual que en la ruta.
    process.env.ETH_RLUSD_FXRP_ENABLED = 'true';
    delete process.env.DEFI_EXEC_ENABLED;
    delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
    delete process.env.DEFI_EXEC_BLOCKED_REGIONS;
  });
  afterAll(() => { process.env = ENV; });

  it('escanea ETHEREUM aunque la wallet esté registrada en Flare y no haya fila de Protocol', async () => {
    prismaModule.__setRules([emRule()]);
    await new AutomationEngine().tick();
    // La prueba de H5: el portfolio se pidió para chain 1, no para 14.
    expect(mockGetPortfolio).toHaveBeenCalledWith(OWNER, 1);
  });

  it('dispara con el HF del MERCADO aunque la cartera no traiga ninguno', async () => {
    prismaModule.__setRules([emRule()]);
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'INTENT_READY' }),
    );
    // H4: el aviso abre la puerta concreta, no una página muda. Y se compara
    // contra el constructor compartido: si alguien cambia la url en un sitio y
    // no en el otro, el ensayo en seco enseñaría una puerta que el aviso no usa.
    const push = mockSendToUser.mock.calls[0][1] as { url: string };
    expect(push.url).toBe(emRepayPushUrl(OWNER));
    expect(push.url).toContain('paAction=repay');
    expect(push.url).toContain('protocol=morpho-blue');
    expect(push.url).toContain(OWNER);
  });

  /**
   * La MISMA puerta dentro de la app (25-ago-2026). El deep-link vivía solo en
   * el push, así que quien abre Astryum —o quien no tiene push, que es el caso
   * normal en escritorio— leía «repay ready to prepare» en una fila muerta.
   * La Alert es lo que esa lista pinta: si no lleva su puerta, el aviso manda
   * a buscar la posición a mano con la liquidación corriendo (familia H4).
   */
  it('la Alert lleva la MISMA puerta que el push — el aviso se abre desde donde se lee', async () => {
    prismaModule.__setRules([emRule()]);
    await new AutomationEngine().tick();
    const alert = prismaModule.__lastAlert();
    const push = mockSendToUser.mock.calls[0][1] as { url: string };
    expect((alert?.data as { url?: string } | undefined)?.url).toBe(push.url);
    expect((alert?.data as { url?: string } | undefined)?.url).toBe(emRepayPushUrl(OWNER));
  });

  it('NO dispara cuando el HF vivo está por encima del umbral', async () => {
    mockFireCheck.mockResolvedValue({ ok: true, debtBase: '1', healthFactor: 2.4 });
    prismaModule.__setRules([emRule()]);
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(0);
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it('sin deuda viva no hay HF que vigilar: no dispara y no avisa', async () => {
    mockFireCheck.mockResolvedValue({ ok: false, note: 'no live debt' });
    prismaModule.__setRules([emRule()]);
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(0);
    expect(mockSendToUser).not.toHaveBeenCalled();
  });

  it('jamás toca el carril EVM de intents (el repay se compone en la puerta)', async () => {
    prismaModule.__setRules([emRule()]);
    await new AutomationEngine().tick();
    expect(mockCreateIntent).not.toHaveBeenCalled();
  });
});

/**
 * La frontera del carril, EN EL TICK (auditoría 2026-08-17, hallazgo A).
 *
 * El módulo de ejecución DeFi vive tras flag (#10) + geofence (#5), y eso solo
 * estaba en la ruta HTTP. El tick leía Ethereum cada 60 s por wallet con el
 * interruptor apagado, y empujaba al usuario hacia una acción que la ruta le
 * iba a negar — un aviso contra una puerta cerrada.
 */
describe('emRepay: la frontera del carril también manda en el tick', () => {
  const ENV = { ...process.env };
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    mockFireCheck.mockResolvedValue({ ok: true, debtBase: '1000000000000000000', healthFactor: 1.05 });
    process.env.ETH_RLUSD_FXRP_ENABLED = 'true';
    delete process.env.DEFI_EXEC_ENABLED;
    delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { warn.mockRestore(); });
  afterAll(() => { process.env = ENV; });

  it('con el flag APAGADO no dispara, no lee Ethereum, y lo DICE', async () => {
    process.env.ETH_RLUSD_FXRP_ENABLED = 'false';
    prismaModule.__setRules([emRule()]);
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(0);
    // Ni una lectura: el carril apagado no cuesta 1 RPC por wallet y tick.
    expect(mockFireCheck).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
    // Una red que no está y no avisa es peor que no tener red.
    expect(warn.mock.calls.flat().join(' ')).toContain('ETH_RLUSD_FXRP_DISABLED');
  });

  /**
   * LA SALIDA JAMÁS SE GATEA (doctrina 2026-09-13). Un repago protector es un
   * unwind: bajo allowlist el tick (sin región) antes callaba la red de una
   * posición apalancada que ya existe. El flag sigue mandando (test de arriba);
   * el geofence, no.
   */
  it('fuera del geofence la protección SIGUE vigilando: un repago es una salida', async () => {
    process.env.DEFI_EXEC_ALLOWED_REGIONS = 'ES';
    prismaModule.__setRules([emRule()]);
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    expect(mockFireCheck).toHaveBeenCalled();
    expect(mockSendToUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ type: 'INTENT_READY' }));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('GEOFENCE_BLOCKED');
  });

  it('una regla emRepay ni siquiera pregunta al geofence (el flag es la única frontera)', async () => {
    const geoSpy = jest.spyOn(jurisdictionService, 'isDefiExecutionAllowed');
    try {
      prismaModule.__setRules([emRule()]);
      await new AutomationEngine().tick();
      expect(geoSpy).not.toHaveBeenCalled();
    } finally {
      geoSpy.mockRestore();
    }
  });

  it('el corte es del carril, NO del tick: las demás reglas siguen vivas', async () => {
    process.env.ETH_RLUSD_FXRP_ENABLED = 'false';
    // Una regla de Flare junto a la de Ethereum: la primera debe seguir su curso.
    prismaModule.__setRules([
      emRule(),
      {
        ...emRule({ id: 'rule-flare-1' }),
        trigger: { type: 'HF_BELOW', threshold: 0 },  // nunca dispara: solo se comprueba que se evalúa
        action: { kind: 'notify' },
        protocol: { id: 'p1', slug: 'kinetic', chainId: 14 },
      },
    ]);
    const res = await new AutomationEngine().tick();
    expect(res.ruleCount).toBe(2);
    expect(mockGetPortfolio).toHaveBeenCalledWith(OWNER, 14);
  });
});

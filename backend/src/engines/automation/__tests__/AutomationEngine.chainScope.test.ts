/**
 * Chain-scope regression (bug 2026-07-25, destapado por el primer test en vivo
 * del moneyflow HF): la regla NO guarda chainId propio, y la fila Wallet
 * conserva el chain de CONEXIÓN (los connects EVM guardan 1 o null) — el tick
 * agrupaba por wallet.chainId y escaneaba la CHAIN EQUIVOCADA para una regla
 * de Flare creada sobre una wallet enlazada en Ethereum: portfolio vacío →
 * HF undefined → HF_BELOW jamás disparaba, en silencio. El Protocol de la
 * regla (resuelto al crearla contra el chainId de la request — kinetic@14) es
 * el scope autoritativo; wallet.chainId queda solo para reglas sin protocolo
 * (consejo, escrow), cuyo comportamiento no cambia.
 */
jest.mock('../../../database/prismaClient', () => {
  let rules: any[] = [];
  return {
    prisma: {
      automationRule: {
        findMany: jest.fn(async () => rules),
        update: jest.fn(async ({ where, data }: any) => {
          const r = rules.find((x) => x.id === where.id);
          if (r) Object.assign(r, data);
          return r ?? null;
        }),
      },
      automationRun: { create: jest.fn(async ({ data }: any) => ({ id: 'run-cs-1', ...data })) },
      alert: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __setRules(rs: any[]) {
      rules = rs;
    },
  };
});

const mockCreateIntent = jest.fn(async () => ({ id: 'intent-cs-1' }));
jest.mock('../../intent/IntentEngine', () => ({
  IntentEngine: { getInstance: () => ({ createIntent: mockCreateIntent }) },
}));

jest.mock('../../../services/PushNotificationService', () => ({
  PushNotificationService: { getInstance: () => ({ sendToUser: jest.fn().mockResolvedValue(undefined) }) },
}));

jest.mock('../../../services/flare/MarketRatesService', () => ({
  readSupplyAprs: jest.fn(async () => ({})),
}));

const mockGetPortfolio = jest.fn(async () => ({ positions: [] }));
jest.mock('../../portfolio/PortfolioEngine', () => ({
  PortfolioEngine: { getInstance: () => ({ getPortfolio: mockGetPortfolio }) },
}));

// El snapshot de riesgo trae el HF real de la posición ISO (3.33 < umbral 3.5).
jest.mock('../../risk/RiskEngine', () => ({
  RiskEngine: {
    getInstance: () => ({
      evaluateSnapshot: jest.fn(() => ({ score: 10, level: 'LOW', healthFactor: 3.3308 })),
    }),
  },
}));

import { AutomationEngine } from '../AutomationEngine';

const prismaModule = jest.requireMock('../../../database/prismaClient') as {
  __setRules: (rs: unknown[]) => void;
};

const WALLET = '0xEAbcd745598916b0131ece397C8D6a332088462c';

const hfRule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-hf-1',
  name: 'Protect · FXRP',
  enabled: true,
  cooldownMinutes: 0,
  lastTriggeredAt: null,
  expiresAt: null,
  trigger: { type: 'HF_BELOW', threshold: 3.5 },
  action: { kind: 'repay', protocolId: 'kinetic', params: { mode: 'restore', targetHF: 3.5 } },
  // La trampa real del bug: la wallet quedó registrada con su chain de
  // conexión (Ethereum), pero la posición y el protocolo viven en Flare.
  wallet: { id: 'w1', address: WALLET, chainId: 1, userId: 'user-1' },
  protocol: { id: 'proto-kinetic-14', slug: 'kinetic', chainId: 14 },
  ...over,
});

describe('AutomationEngine — chain scope de la regla (protocol.chainId manda)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('regla kinetic@14 sobre wallet conectada en chain 1 → el portfolio se lee en 14 y la regla DISPARA', async () => {
    prismaModule.__setRules([hfRule()]);
    const out = await AutomationEngine.getInstance().tick();

    expect(mockGetPortfolio).toHaveBeenCalledWith(WALLET, 14);
    expect(mockGetPortfolio).not.toHaveBeenCalledWith(WALLET, 1);
    expect(out.firedCount).toBe(1);
    expect(mockCreateIntent).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 14, protocolId: 'kinetic', actionKind: 'repay', walletAddress: WALLET }),
    );
  });

  test('regla SIN protocolo conserva el fallback wallet.chainId ?? 14 (consejo/escrow intactos)', async () => {
    prismaModule.__setRules([
      hfRule({ id: 'rule-hf-2', protocol: null, wallet: { id: 'w2', address: WALLET, chainId: null, userId: 'user-1' } }),
    ]);
    await AutomationEngine.getInstance().tick();
    expect(mockGetPortfolio).toHaveBeenCalledWith(WALLET, 14);
  });
});

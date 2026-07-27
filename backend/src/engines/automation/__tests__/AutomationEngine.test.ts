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
      automationRun: { create: jest.fn(async ({ data }: any) => ({ id: 'run-1', ...data })) },
      alert: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __setRules(rs: any[]) {
      rules = rs;
    },
  };
});

const mockPrepare = jest.fn(async (_type: string, _params: any) => ({
  intentId: 'intent-flow-1',
  metadata: { action: 'stake', protocol: 'sceptre', description: 'Stake FLR for sFLR' },
  expiry: { expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() },
  referralAttribution: { attributionBps: 15, referralWallet: '0xfee', disclosedToUser: true, disclosureText: '0.15% fee' },
  tx: { to: '0x12e605bc', data: '0xdeadbeef', value: '1000000000000000000', chainId: 14, gasLimit: '100000' },
}));

jest.mock('../../../control-plane/IntentPreparationEngine', () => ({
  intentPreparationEngine: { prepare: mockPrepare },
}));

const mockCreateSession = jest.fn(async () => ({ id: 'session-123' }));
jest.mock('../../../partners/RegulatedRelayBoundary', () => ({
  regulatedRelayBoundary: { createAuthorizationSession: mockCreateSession },
}));

const mockSendToUser = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../services/PushNotificationService', () => ({
  PushNotificationService: { getInstance: () => ({ sendToUser: mockSendToUser }) },
}));

jest.mock('../../portfolio/PortfolioEngine', () => ({
  PortfolioEngine: {
    getInstance: () => ({
      getPortfolio: jest.fn(async () => ({
        wallet: '0xabc',
        chainId: 14,
        totalUSD: 1000,
        netWorthUSD: 1000,
        collateralUSD: 0,
        debtUSD: 0,
        positions: [],
        breakdown: { byProtocol: {}, byAsset: {}, byKind: {} },
        takenAt: new Date(),
      })),
    }),
  },
}));

jest.mock('../../risk/RiskEngine', () => ({
  RiskEngine: {
    getInstance: () => ({
      evaluateSnapshot: jest.fn(() => ({
        score: 50,
        level: 'MEDIUM',
        healthFactor: 1.5,
        ltv: 0.5,
        drivers: [],
      })),
    }),
  },
}));

jest.mock('../../intent/IntentEngine', () => ({
  IntentEngine: {
    getInstance: () => ({
      createIntent: jest.fn(async () => ({ id: 'intent-1' })),
    }),
  },
}));

describe('AutomationEngine.tick', () => {
  test('returns zero counts when no rules exist', async () => {
    const mod = require('../../../database/prismaClient');
    (mod as any).__setRules([]);
    const { AutomationEngine } = require('../AutomationEngine');
    const result = await AutomationEngine.getInstance().tick();
    expect(result.ruleCount).toBe(0);
    expect(result.firedCount).toBe(0);
  });

  test('does not fire when trigger does not match', async () => {
    const mod = require('../../../database/prismaClient');
    (mod as any).__setRules([
      {
        id: 'rule-noop',
        enabled: true,
        cooldownMinutes: 0,
        lastTriggeredAt: null,
        trigger: { type: 'HF_BELOW', threshold: 1.2 },
        action: {},
        wallet: { id: 'w1', userId: 'u1', address: '0xabc', chainId: 14 },
        name: 'noop',
      },
    ]);
    const { AutomationEngine } = require('../AutomationEngine');
    const result = await AutomationEngine.getInstance().tick();
    expect(result.ruleCount).toBe(1);
    expect(result.firedCount).toBe(0);
  });

  test('respects cooldown — skips rule fired recently', async () => {
    const mod = require('../../../database/prismaClient');
    (mod as any).__setRules([
      {
        id: 'rule-cd',
        enabled: true,
        cooldownMinutes: 30,
        lastTriggeredAt: new Date(),
        trigger: { type: 'HF_BELOW', threshold: 2.0 },
        action: {},
        wallet: { id: 'w1', userId: 'u1', address: '0xabc', chainId: 14 },
        name: 'cd',
      },
    ]);
    const { AutomationEngine } = require('../AutomationEngine');
    const result = await AutomationEngine.getInstance().tick();
    expect(result.firedCount).toBe(0);
  });
});

describe('AutomationEngine.tick — totalTimesTriggered honesty (instancia #1)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does NOT increment totalTimesTriggered when a fired action errors', async () => {
    const mod = require('../../../database/prismaClient');
    (mod as any).__setRules([
      {
        id: 'rule-err',
        enabled: true,
        cooldownMinutes: 0,
        lastTriggeredAt: null,
        trigger: { type: 'HF_BELOW', threshold: 2.0 }, // HF 1.5 < 2.0 → fires
        action: { kind: 'councilPayment' }, // invalid params + EVM wallet → compose throws → runStatus 'error'
        wallet: { id: 'w1', userId: 'u1', address: '0xabc', chainId: 14 },
        name: 'err',
      },
    ]);
    const { AutomationEngine } = require('../AutomationEngine');
    const result = await AutomationEngine.getInstance().tick();
    expect(result.firedCount).toBe(1); // it DID fire
    const upd = (mod as any).prisma.automationRule.update.mock.calls.find(
      (c: any) => c[0].where.id === 'rule-err',
    );
    expect(upd).toBeDefined();
    expect(upd[0].data.lastTriggeredAt).toBeDefined(); // cooldown still stamped
    expect('totalTimesTriggered' in upd[0].data).toBe(false); // NOT counted as a run
  });

  test('increments totalTimesTriggered when the trigger fires without error', async () => {
    const mod = require('../../../database/prismaClient');
    (mod as any).__setRules([
      {
        id: 'rule-ok',
        enabled: true,
        cooldownMinutes: 0,
        lastTriggeredAt: null,
        trigger: { type: 'HF_BELOW', threshold: 2.0 },
        action: {}, // no kind → runStatus stays 'triggered' (not error)
        wallet: { id: 'w1', userId: 'u1', address: '0xabc', chainId: 14 },
        name: 'ok',
      },
    ]);
    const { AutomationEngine } = require('../AutomationEngine');
    const result = await AutomationEngine.getInstance().tick();
    expect(result.firedCount).toBe(1);
    const upd = (mod as any).prisma.automationRule.update.mock.calls.find(
      (c: any) => c[0].where.id === 'rule-ok',
    );
    expect(upd).toBeDefined();
    expect(upd[0].data.totalTimesTriggered).toEqual({ increment: 1 });
  });
});

describe('AutomationEngine.prepareFlowNode — P11 MoneyFlows V2', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prepares intent payload and authorization session', async () => {
    const { AutomationEngine } = require('../AutomationEngine');
    const engine = AutomationEngine.getInstance();

    const result = await engine.prepareFlowNode(
      { id: 'node-1', type: 'prepare_stake', params: { amount: '1000000000000000000' } },
      { userId: 'user-1', walletAddress: '0xabc1234567890abcdef1234567890abcdef123456', chainId: 14, sessionId: 'flow:dca:1' },
    );

    expect(result.intentPayload.intentId).toBe('intent-flow-1');
    expect(result.authorizationSessionId).toBe('session-123');
    expect(mockPrepare).toHaveBeenCalledWith('prepare_stake', expect.objectContaining({
      walletAddress: '0xabc1234567890abcdef1234567890abcdef123456',
      chainId: 14,
      amount: '1000000000000000000',
    }));
  });

  test('creates authorization session with intent payload', async () => {
    const { AutomationEngine } = require('../AutomationEngine');
    await AutomationEngine.getInstance().prepareFlowNode(
      { id: 'node-2', type: 'prepare_swap', params: { from: 'FLR', to: 'USDC', amount: '500000000000000000' } },
      { userId: 'user-2', walletAddress: '0xabc1234567890abcdef1234567890abcdef123456', sessionId: 'flow:dca:2' },
    );

    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      intentPayload: expect.objectContaining({ intentId: 'intent-flow-1' }),
    }));
  });

  test('sends push notification to user after prepare', async () => {
    const { AutomationEngine } = require('../AutomationEngine');
    await AutomationEngine.getInstance().prepareFlowNode(
      { id: 'node-3', type: 'prepare_supply', params: { amount: '100000000' } },
      { userId: 'user-3', walletAddress: '0xabc1234567890abcdef1234567890abcdef123456', sessionId: 'flow:dca:3', flowId: 'flow-dca' },
    );

    // Push is fire-and-forget (void), so we wait briefly for the microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendToUser).toHaveBeenCalledWith('user-3', expect.objectContaining({
      type: 'INTENT_READY',
      url: '/app/intents',
    }));
  });

  test('returns sessionId and intentId for frontend to redirect to /app/intents', async () => {
    const { AutomationEngine } = require('../AutomationEngine');
    const result = await AutomationEngine.getInstance().prepareFlowNode(
      { id: 'node-4', type: 'prepare_vault_deposit', params: {} },
      { userId: 'user-4', walletAddress: '0xabc1234567890abcdef1234567890abcdef123456', sessionId: 'flow:dca:4' },
    );

    // Frontend uses these to redirect the user to review and sign
    expect(typeof result.intentPayload.intentId).toBe('string');
    expect(typeof result.authorizationSessionId).toBe('string');
    // The engine NEVER auto-authorizes — no further calls expected
    expect(mockSendToUser).toHaveBeenCalledTimes(1);
  });
});

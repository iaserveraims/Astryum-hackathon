/**
 * B.1b — the XRPL savings-escrow rule branch: when an escrow rule fires, the
 * engine NEVER calls the EVM intent path (no adapter exists for XRPL); it
 * nudges the user to the Savings surface instead, where the EscrowCreate is
 * composed fresh and signed in Xaman (N1). Prepare-nothing server-side.
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
      automationRun: { create: jest.fn(async ({ data }: any) => ({ id: 'run-esc-1', ...data })) },
      alert: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __setRules(rs: any[]) {
      rules = rs;
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

const XRPL_WALLET = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

jest.mock('../../portfolio/PortfolioEngine', () => ({
  PortfolioEngine: {
    getInstance: () => ({
      getPortfolio: jest.fn(async () => ({
        wallet: XRPL_WALLET,
        chainId: 1440002,
        totalUSD: 500,
        netWorthUSD: 500,
        collateralUSD: 0,
        debtUSD: 0,
        positions: [
          {
            protocolId: 'wallet-1440002',
            chainId: 1440002,
            kind: 'FREE',
            asset: 'XRP',
            amountUSD: 500,
            metadata: { symbol: 'XRP' },
          },
        ],
        breakdown: { byProtocol: {}, byAsset: {}, byKind: {} },
        takenAt: new Date(),
      })),
    }),
  },
}));

jest.mock('../../risk/RiskEngine', () => ({
  RiskEngine: {
    getInstance: () => ({ evaluateSnapshot: jest.fn(() => ({ score: 10, level: 'LOW' })) }),
  },
}));

import { AutomationEngine } from '../AutomationEngine';

const prismaModule = jest.requireMock('../../../database/prismaClient') as {
  __setRules: (rs: unknown[]) => void;
};

describe('AutomationEngine — XRPL escrow rule (IDLE_BALANCE → Savings nudge)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaModule.__setRules([
      {
        id: 'rule-escrow-1',
        name: 'Ahorro semanal',
        enabled: true,
        cooldownMinutes: 0,
        lastTriggeredAt: null,
        trigger: { type: 'IDLE_BALANCE', asset: 'XRP', minUSD: 100 },
        action: { kind: 'escrow', params: { amountDrops: '10000000', lockDays: 30 } },
        wallet: { id: 'w1', address: XRPL_WALLET, chainId: -1, userId: 'user-1' },
      },
    ]);
  });

  it('fires, skips the EVM intent path, and pushes the Savings nudge', async () => {
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    // invariant: nothing prepared server-side for XRPL — no adapter call
    expect(mockCreateIntent).not.toHaveBeenCalled();
    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'SAVINGS_READY', url: '/app/savings' }),
    );
  });
});

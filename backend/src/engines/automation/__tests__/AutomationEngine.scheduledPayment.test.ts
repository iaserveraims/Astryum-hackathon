/**
 * M1 — the personal «domiciliación» branch: when a scheduledPayment rule
 * fires, the engine NEVER calls the EVM intent path; it VALIDATES the payment
 * (a broken destination fails loudly at fire time, not at the signing door)
 * and nudges the OWNER to Strategies, where the Payment is composed fresh and
 * signed in Xaman. Prepare-nothing-persistent server-side; one signer.
 */
jest.mock('../../../database/prismaClient', () => {
  let rules: any[] = [];
  let lastRun: any = null;
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
      automationRun: {
        create: jest.fn(async ({ data }: any) => {
          lastRun = { id: 'run-sp-1', ...data };
          return lastRun;
        }),
      },
      alert: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __setRules(rs: any[]) {
      rules = rs;
    },
    __lastRun() {
      return lastRun;
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
const DESTINATION = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';

// The portfolio read THROWS on purpose: a personal XRPL wallet may have no
// snapshot at all, and a time-based standing order must still fire (the same
// resilience the council test locks in — TIME needs no portfolio).
jest.mock('../../portfolio/PortfolioEngine', () => ({
  PortfolioEngine: {
    getInstance: () => ({
      getPortfolio: jest.fn(async () => {
        throw new Error('no snapshot for this wallet');
      }),
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
  __lastRun: () => { status: string; notes?: string } | null;
};

function paymentRule(params: Record<string, unknown>) {
  return {
    id: 'rule-sp-1',
    name: 'Seguro del coche',
    enabled: true,
    cooldownMinutes: 0,
    lastTriggeredAt: null,
    // "every minute" so the last occurrence is always within the lookback —
    // the day-of-month shape (`0 12 15 * *`) is TriggerEvaluator.time.test's
    // territory; this test is about the ACTION branch.
    trigger: { type: 'TIME_TRIGGER', cron: '* * * * *' },
    action: { kind: 'scheduledPayment', params },
    wallet: { id: 'w1', address: XRPL_WALLET, chainId: -1, userId: 'user-1' },
  };
}

describe('AutomationEngine — scheduledPayment (TIME_TRIGGER → sign nudge)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fires without a portfolio, skips the EVM intent path, and nudges the owner', async () => {
    prismaModule.__setRules([
      paymentRule({ destination: DESTINATION, amountDrops: '10000000' }),
    ]);
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    // invariant: nothing prepared server-side for XRPL — no adapter call
    expect(mockCreateIntent).not.toHaveBeenCalled();
    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'INTENT_READY', url: '/app/strategies' }),
    );
    expect(prismaModule.__lastRun()).toEqual(
      expect.objectContaining({ status: 'triggered' }),
    );
  });

  it('fails the run LOUDLY when the rule describes a broken payment', async () => {
    // Destination = the paying wallet itself: composable nowhere, and the
    // owner must learn it from the run, not from a dead signing door.
    prismaModule.__setRules([
      paymentRule({ destination: XRPL_WALLET, amountDrops: '10000000' }),
    ]);
    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    expect(mockSendToUser).not.toHaveBeenCalled();
    const run = prismaModule.__lastRun();
    expect(run?.status).toBe('error');
    expect(run?.notes).toContain('scheduled_payment_invalid');
  });
});

/**
 * Governed MoneyFlows (sign-at-trigger, N firmantes): when a council rule
 * fires, the engine COMPOSES a proposal into the council inbox — the QUORUM
 * signs it there. The rule holds zero authority. Also covers the enforced TTL:
 * an expired rule is disabled, never evaluated.
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
      automationRun: { create: jest.fn(async ({ data }: any) => ({ id: 'run-cl-1', ...data })) },
      alert: { create: jest.fn(async () => ({})) },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __setRules(rs: any[]) {
      rules = rs;
    },
    __getRules() {
      return rules;
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

const mockCompose = jest.fn();
const mockCreateProposal = jest.fn();
jest.mock('../../../services/CouncilProposalService', () => ({
  composeCouncilRuleTx: (...a: unknown[]) => mockCompose(...a),
  createCouncilProposalFromRule: (...a: unknown[]) => mockCreateProposal(...a),
}));

const mockReadAprs = jest.fn();
jest.mock('../../../services/flare/MarketRatesService', () => ({
  readSupplyAprs: (...a: unknown[]) => mockReadAprs(...a),
}));

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

// Portfolio read FAILS for the council account — TIME_TRIGGER must still run
// (portfolio-independent triggers cannot freeze on a snapshot error).
jest.mock('../../portfolio/PortfolioEngine', () => ({
  PortfolioEngine: {
    getInstance: () => ({
      getPortfolio: jest.fn(async () => {
        throw new Error('xrpl snapshot unavailable');
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
  __getRules: () => Array<{ id: string; enabled: boolean }>;
};

const councilRule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-council-1',
  name: 'Pago mensual del consejo',
  enabled: true,
  cooldownMinutes: 0,
  lastTriggeredAt: null,
  expiresAt: null,
  // every minute in the cron subset — always due on a fresh rule
  trigger: { type: 'TIME_TRIGGER', cron: '* * * * *' },
  action: {
    kind: 'councilPayment',
    params: { destination: 'rDestinationDestinationDest', amountDrops: '1000000' },
  },
  wallet: { id: 'w1', address: COUNCIL, chainId: -1, userId: 'user-1' },
  ...over,
});

describe('AutomationEngine — governed MoneyFlow (councilPayment → proposal in the inbox)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCompose.mockResolvedValue({
      council: COUNCIL,
      xrplTx: { TransactionType: 'Payment', Account: COUNCIL },
      summary: 'Payment of 1 XRP from the council to rDest…',
    });
  });

  it('fires on TIME even when the portfolio snapshot fails, and creates the proposal', async () => {
    prismaModule.__setRules([councilRule()]);
    mockCreateProposal.mockResolvedValue({ ok: true, proposalId: 'prop-1' });

    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    // the rule composes a PROPOSAL — never an EVM intent, never a signature
    expect(mockCreateIntent).not.toHaveBeenCalled();
    expect(mockCompose).toHaveBeenCalledWith(
      'councilPayment',
      expect.objectContaining({ destination: 'rDestinationDestinationDest' }),
      COUNCIL,
    );
    expect(mockCreateProposal).toHaveBeenCalledWith(
      expect.objectContaining({ account: COUNCIL, createdByUserId: 'user-1' }),
    );
    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ url: '/app/wallets' }),
    );
    // The CREATION path writes an Alert row scoped to the COUNCIL wallet
    // (walletId 'w1'), so GET /alerts?address=<council r-address> — now XRPL-aware
    // — can actually return it. Without this the regex fix is necessary-not-
    // sufficient: the query would work but there would be no row to find.
    const alertCreate = (jest.requireMock('../../../database/prismaClient') as { prisma: { alert: { create: jest.Mock } } }).prisma.alert.create;
    expect(alertCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ walletId: 'w1', userId: 'user-1' }) }),
    );
  });

  it('a busy council (one live proposal per account) is a retry, not an error', async () => {
    prismaModule.__setRules([councilRule()]);
    mockCreateProposal.mockResolvedValue({
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: 'proposal prop-0 collecting',
    });

    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    expect(mockSendToUser).not.toHaveBeenCalled(); // no push spam while queued
  });

  it('an expired rule is disabled and never evaluated (enforced TTL)', async () => {
    prismaModule.__setRules([councilRule({ expiresAt: new Date('2020-01-01T00:00:00Z') })]);

    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(0);
    expect(mockCompose).not.toHaveBeenCalled();
    expect(prismaModule.__getRules()[0].enabled).toBe(false);
  });

  it('APY_BELOW: prefetches live rates once and composes the rotation proposal when the APY drops', async () => {
    const MARKET = '0xad7e7989796414c9572da9854deb1b920724fd09';
    prismaModule.__setRules([
      councilRule({
        id: 'rule-apy-1',
        name: 'Rotación si el APY cae',
        trigger: { type: 'APY_BELOW', market: MARKET, thresholdPct: 3 },
        action: {
          kind: 'councilOrder',
          params: { council: COUNCIL, orderAction: 'move', orderParams: { fromId: 0, toId: 1, amount: '1000000' } },
        },
      }),
    ]);
    mockReadAprs.mockResolvedValue({ [MARKET]: 1.2 }); // live APY under the 3% floor
    mockCreateProposal.mockResolvedValue({ ok: true, proposalId: 'prop-apy-1' });

    const res = await new AutomationEngine().tick();
    expect(res.firedCount).toBe(1);
    expect(mockReadAprs).toHaveBeenCalledTimes(1);
    expect(mockReadAprs).toHaveBeenCalledWith([MARKET]);
    expect(mockCompose).toHaveBeenCalledWith(
      'councilOrder',
      expect.objectContaining({ orderAction: 'move' }),
      COUNCIL,
    );
  });

  it('APY_BELOW: a healthy APY (or a failed read) composes nothing', async () => {
    const MARKET = '0xad7e7989796414c9572da9854deb1b920724fd09';
    prismaModule.__setRules([
      councilRule({
        id: 'rule-apy-2',
        trigger: { type: 'APY_BELOW', market: MARKET, thresholdPct: 3 },
        action: { kind: 'councilOrder', params: { orderAction: 'recall', orderParams: { venueId: 0, amount: '1' } } },
      }),
    ]);
    mockReadAprs.mockResolvedValue({ [MARKET]: 5.5 });
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);

    mockReadAprs.mockResolvedValue({}); // read failed → market omitted → never fires
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);
    expect(mockCompose).not.toHaveBeenCalled();
  });
});

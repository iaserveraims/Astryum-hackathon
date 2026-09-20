/**
 * G3-final (3ª ronda) — the closing notice, and what round 2 broke on
 * its way to fixing the storm. Every test here walks REAL ticks with a fake
 * clock; none of them reads the source.
 */
jest.mock('../../../database/prismaClient', () => {
  let rules: any[] = [];
  let ruleUpdatesFail = false;
  return {
    prisma: {
      automationRule: {
        findMany: jest.fn(async () => rules),
        update: jest.fn(async ({ where, data }: any) => {
          if (ruleUpdatesFail) throw new Error('rules table unavailable');
          const r = rules.find((x) => x.id === where.id);
          if (!r) return null;
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === 'object' && 'increment' in (v as object)) {
              r[k] = (r[k] ?? 0) + (v as { increment: number }).increment;
            } else {
              r[k] = v;
            }
          }
          return r;
        }),
      },
      automationRun: { create: jest.fn() },
      alert: { create: jest.fn() },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __setRules(rs: any[]) {
      rules = rs;
    },
    __getRules() {
      return rules;
    },
    __failRuleUpdates(v: boolean) {
      ruleUpdatesFail = v;
    },
  };
});

jest.mock('../../intent/IntentEngine', () => ({
  IntentEngine: { getInstance: () => ({ createIntent: jest.fn() }) },
}));

const mockSendToUser = jest.fn();
jest.mock('../../../services/PushNotificationService', () => ({
  PushNotificationService: { getInstance: () => ({ sendToUser: mockSendToUser }) },
}));

const mockCompose = jest.fn();
const mockCreateProposal = jest.fn();
jest.mock('../../../services/CouncilProposalService', () => ({
  composeCouncilRuleTx: (...a: unknown[]) => mockCompose(...a),
  createCouncilProposalFromRule: (...a: unknown[]) => mockCreateProposal(...a),
}));

// TIME_TRIGGER is portfolio-independent: the snapshot read fails on purpose.
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
  __getRules: () => Array<{
    id: string;
    lastTriggeredAt: Date | null;
    lastArtefactAt: Date | null;
    totalTimesTriggered: number;
  }>;
  __failRuleUpdates: (v: boolean) => void;
  prisma: {
    alert: { create: jest.Mock };
    automationRun: { create: jest.Mock };
  };
};
const alertCreate = prismaModule.prisma.alert.create;
const runCreate = prismaModule.prisma.automationRun.create;

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

/** Monthly rent, the 1st at 09:00 UTC — the occurrence these tests own. */
const monthlyRule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-final-1',
  name: 'Alquiler mensual del consejo',
  enabled: true,
  cooldownMinutes: 15,
  lastTriggeredAt: null,
  lastArtefactAt: null,
  totalTimesTriggered: 0,
  expiresAt: null,
  trigger: { type: 'TIME_TRIGGER', cron: '0 9 1 * *' },
  action: {
    kind: 'councilPayment',
    params: { destination: 'rDestinationDestinationDest', amountDrops: '1000000' },
  },
  wallet: { id: 'w1', address: COUNCIL, chainId: -1, userId: 'user-1' },
  ...over,
});

const at = (iso: string) => jest.setSystemTime(new Date(iso));
const minutesAfter = (iso: string, m: number) =>
  new Date(Date.parse(iso) + m * 60_000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  prismaModule.__failRuleUpdates(false);

  let runSeq = 0;
  runCreate.mockReset();
  runCreate.mockImplementation(async ({ data }: any) => ({ id: `run-${(runSeq += 1)}`, ...data }));
  alertCreate.mockReset();
  alertCreate.mockResolvedValue({});
  // The default this product actually has: a web user with no registered
  // device. `skipped` is NOT delivery.
  mockSendToUser.mockReset();
  mockSendToUser.mockResolvedValue({ sent: 0, failed: 0, skipped: 1 });
  mockCompose.mockReset();
  mockCompose.mockResolvedValue({
    council: COUNCIL,
    xrplTx: { TransactionType: 'Payment', Account: COUNCIL },
    summary: 'Payment of 1 XRP from the council to rDest',
  });
  mockCreateProposal.mockReset();
  mockCreateProposal.mockResolvedValue({
    ok: false,
    reason: 'LIVE_PROPOSAL_EXISTS',
    detail: 'proposal prop-0 collecting',
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('G3-final blocker 3 — the closing notice is written ONCE, never once a minute', () => {
  /** The rule whose occurrence died at the 36h wall: attempted, never served. */
  const abandoned = (over: Record<string, unknown> = {}) =>
    monthlyRule({
      lastTriggeredAt: new Date('2026-08-02T21:00:20Z'),
      lastArtefactAt: null,
      ...over,
    });

  it('an alert that never lands and a user with no device still cap it at ONE expired run', async () => {
    prismaModule.__setRules([abandoned({ id: 'rule-final-cap-1' })]);
    alertCreate.mockRejectedValue(new Error('alerts table unavailable'));
    const engine = new AutomationEngine();

    at('2026-08-02T22:00:20Z');
    expect((await engine.tick()).firedCount).toBe(0);

    // The run IS the notice: it is what GET /rules/:id/runs returns and what
    // the surfaces reduce through runHealth.summarizeRuns.
    expect(runCreate).toHaveBeenCalledTimes(1);
    expect(runCreate.mock.calls[0][0].data.status).toBe('expired');
    expect(runCreate.mock.calls[0][0].data.triggerData).toMatchObject({
      abandoned: true,
      dueAt: '2026-08-01T09:00:00.000Z',
    });
    // …and because it was written, the occurrence is closed for good.
    expect(prismaModule.__getRules()[0].lastArtefactAt).toEqual(
      new Date('2026-08-02T22:00:20Z'),
    );
    expect(prismaModule.__getRules()[0].totalTimesTriggered).toBe(0); // never a success

    // Round 2 returned unstamped here and re-announced on EVERY tick: ten more
    // ticks were ten more `expired` rows (1.440/day in production).
    for (let i = 1; i <= 10; i += 1) {
      at(minutesAfter('2026-08-02T22:00:20Z', i));
      expect((await engine.tick()).firedCount).toBe(0);
    }
    expect(runCreate).toHaveBeenCalledTimes(1);
  });

  it('and if the STAMP itself keeps failing, the process cap holds the line', async () => {
    // The degenerate case the DB stamp cannot cover: `automationRule.update`
    // throws every time, so `lastArtefactAt` never lands.
    prismaModule.__setRules([abandoned({ id: 'rule-final-cap-2' })]);
    prismaModule.__failRuleUpdates(true);
    const engine = new AutomationEngine();

    for (let i = 0; i <= 5; i += 1) {
      at(minutesAfter('2026-08-02T22:00:20Z', i));
      await engine.tick();
    }

    expect(prismaModule.__getRules()[0].lastArtefactAt).toBeNull(); // stamp never landed
    expect(runCreate).toHaveBeenCalledTimes(1); // …and it was still said ONCE
    expect(alertCreate).toHaveBeenCalledTimes(1);
  });

  it('when NOTHING can be written the closure is not claimed — and no row is left behind', async () => {
    prismaModule.__setRules([abandoned({ id: 'rule-final-cap-3' })]);
    runCreate.mockRejectedValue(new Error('runs table unavailable'));
    alertCreate.mockRejectedValue(new Error('alerts table unavailable'));
    const engine = new AutomationEngine();

    at('2026-08-02T22:00:20Z');
    await engine.tick();

    // An unsaid closure is not a closure: nothing stamped, so it is retried…
    expect(prismaModule.__getRules()[0].lastArtefactAt).toBeNull();
    at('2026-08-02T22:01:20Z');
    await engine.tick();
    expect(runCreate).toHaveBeenCalledTimes(2);
    // …but the retry costs a FAILED WRITE per tick, never a row per tick.
    expect(runCreate.mock.results.every((r) => r.type === 'return')).toBe(true);
  });
});

describe('G3-final blocker 4 — a push that never answers cannot hang the tick', () => {
  it('the tick finishes on its own bound and treats the unread delivery as NOT delivered', async () => {
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-final-hang',
        lastTriggeredAt: new Date('2026-08-02T21:00:20Z'),
        lastArtefactAt: null,
      }),
    ]);
    // Expo accepts the connection and never answers — no AbortSignal exists in
    // PushNotificationService, so round 2 waited for undici's ~300s default
    // with the 60s tick loop blocked behind it.
    mockSendToUser.mockReturnValue(new Promise(() => undefined));
    const engine = new AutomationEngine();

    at('2026-08-02T22:00:20Z');
    const running = engine.tick();
    await jest.advanceTimersByTimeAsync(10_000);
    // Against the round-2 engine this never resolves and the test times out.
    await expect(running).resolves.toEqual({ ruleCount: 1, firedCount: 0 });

    // The run landed, so the closure is real and stamped — the unread push is
    // simply not counted as delivery.
    expect(runCreate).toHaveBeenCalledTimes(1);
    expect(prismaModule.__getRules()[0].lastArtefactAt).toEqual(
      new Date('2026-08-02T22:00:20Z'),
    );
  });

  it('an unread nudge leaves the occurrence OWED — it never burns the month', async () => {
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-final-hang-2',
        name: 'Seguro del coche',
        action: {
          kind: 'scheduledPayment',
          params: { destination: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH', amountDrops: '10000000' },
        },
      }),
    ]);
    alertCreate.mockRejectedValue(new Error('alerts table unavailable'));
    mockSendToUser.mockReturnValue(new Promise(() => undefined));
    const engine = new AutomationEngine();

    at('2026-08-01T09:00:20Z');
    const running = engine.tick();
    await jest.advanceTimersByTimeAsync(10_000);
    expect((await running).firedCount).toBe(1);

    const row = prismaModule.__getRules()[0];
    expect(row.lastTriggeredAt).toEqual(new Date('2026-08-01T09:00:20Z')); // it did fire
    expect(row.lastArtefactAt).toBeNull(); // but nobody was reached
    expect(row.totalTimesTriggered).toBe(0);
  });
});

describe('G3-final blocker 5 — an abandonment nobody can attribute is never announced', () => {
  it('a rule re-pointed at a cron the barren attempt never belonged to says nothing', async () => {
    // PATCH /rules/:id accepts a new `trigger` and clears NEITHER stamp: this
    // barren attempt is the corpse of an HF_BELOW fire. Round 2 sent a HIGH
    // alert + push about a monthly occurrence that never existed.
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-final-repointed',
        lastTriggeredAt: new Date('2026-08-18T10:07:00Z'),
        lastArtefactAt: null,
      }),
    ]);

    at('2026-08-18T11:07:00Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);

    expect(runCreate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
    expect(mockSendToUser).not.toHaveBeenCalled();
    expect(prismaModule.__getRules()[0].lastArtefactAt).toBeNull();
  });

  it('a stamp left over from a month ago, after later occurrences have passed, says nothing', async () => {
    // Disabled after a barren attempt, re-enabled: the
    // schedule has moved on (came and went). Shouting now is a wolf.
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-final-stale',
        lastTriggeredAt: new Date('2026-08-01T09:00:20Z'),
        lastArtefactAt: null,
      }),
    ]);

    at('2026-09-03T12:00:00Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);

    expect(runCreate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
  });

  it('but an engine that was DOWN for days still says the month was abandoned', async () => {
    // The control that keeps the guards from becoming a new silence: no later
    // occurrence has passed, so this IS the news.
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-final-downtime',
        lastTriggeredAt: new Date('2026-08-01T09:00:20Z'),
        lastArtefactAt: null,
      }),
    ]);

    at('2026-08-05T12:00:00Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);

    expect(runCreate).toHaveBeenCalledTimes(1);
    expect(runCreate.mock.calls[0][0].data.status).toBe('expired');
    expect(alertCreate).toHaveBeenCalledTimes(1);
    expect(alertCreate.mock.calls[0][0].data.message).toContain('2026-08-01T09:00:00.000Z');
    expect(alertCreate.mock.calls[0][0].data.message).toContain('will NOT be retried');
  });
});

describe('G3-final blocker 2 — the boundary of the retry floor, walked instead of claimed', () => {
  it('*/15 with the DEFAULT cooldown: one attempt per occurrence, and the next one retries the action 15 min later', async () => {
    // This is a LOCK, not a fix: the DB cooldown guard (15 min by default)
    // sits before the evaluator, so the 14-minute floor of a */15 rule is
    // unreachable and the owed occurrence IS superseded after one attempt.
    // Nothing is burnt — the next occurrence carries the identical action
    // inside the same window — and no abandonment is ever announced. If the
    // engine ever lets a retry through here, this test says so.
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-final-quarter',
        cooldownMinutes: 15,
        trigger: { type: 'TIME_TRIGGER', cron: '*/15 * * * *' },
      }),
    ]);
    const engine = new AutomationEngine();

    at('2026-08-01T09:00:20Z');
    expect((await engine.tick()).firedCount).toBe(1);
    expect(mockCreateProposal).toHaveBeenCalledTimes(1);
    expect(prismaModule.__getRules()[0].lastArtefactAt).toBeNull(); // council busy: owed

    for (let m = 1; m <= 14; m += 1) {
      at(minutesAfter('2026-08-01T09:00:20Z', m));
      expect((await engine.tick()).firedCount).toBe(0);
    }
    expect(mockCreateProposal).toHaveBeenCalledTimes(1); // no retry: the cooldown owns this window

    at('2026-08-01T09:15:20Z');
    expect((await engine.tick()).firedCount).toBe(1);
    expect(mockCreateProposal).toHaveBeenCalledTimes(2); // the action IS attempted again

    // And nothing was ever declared abandoned along the way.
    expect(runCreate.mock.calls.map((c) => c[0].data.status)).not.toContain('expired');
  });
});

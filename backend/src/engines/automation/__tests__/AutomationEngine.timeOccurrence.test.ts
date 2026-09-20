/**
 * G3 (auditorí) — "la ocurrencia quemada".
 *
 * `lastTriggeredAt` served TWO masters: the DB cooldown AND the cron occurrence
 * marker. Because the engine stamped it on EVERY fire, a monthly payment whose
 * fire produced nothing (council busy, compose error) was filed as done and the
 * evaluator (`due <= lastTriggeredAt`) never offered that occurrence again —
 * the payment for that month silently did not happen. These tests walk the
 * clock across real ticks: they FAIL against the pre-split engine, where the
 * retry tick finds nothing due.
 */
jest.mock('../../../database/prismaClient', () => {
  let rules: any[] = [];
  return {
    prisma: {
      automationRule: {
        findMany: jest.fn(async () => rules),
        update: jest.fn(async ({ where, data }: any) => {
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
      automationRun: { create: jest.fn(async ({ data }: any) => ({ id: 'run-g3-1', ...data })) },
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

jest.mock('../../intent/IntentEngine', () => ({
  IntentEngine: { getInstance: () => ({ createIntent: jest.fn() }) },
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

// The portfolio read fails on purpose: TIME_TRIGGER is portfolio-independent.
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
};

const prismaMocks = jest.requireMock('../../../database/prismaClient') as {
  prisma: { alert: { create: jest.Mock }; automationRun: { create: jest.Mock } };
};
const alertCreate = prismaMocks.prisma.alert.create;
const runCreate = prismaMocks.prisma.automationRun.create;

const COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
/** A personal payee — the R4 case pays OUT of the same wallet. */
const DESTINATION = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';

/** Monthly rent: the 1st at 09:00 UTC. The occurrence these tests own. */
const monthlyRule = (over: Record<string, unknown> = {}) => ({
  id: 'rule-monthly-1',
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

describe('AutomationEngine — G3: a calendar occurrence is served by its ARTEFACT', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The clock is walked by hand: the tick reads `new Date()` and both stamps
    // are relative to it. `nextTick`/`setImmediate` stay real so the awaited
    // dynamic imports inside the tick still resolve.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    mockCompose.mockResolvedValue({
      council: COUNCIL,
      xrplTx: { TransactionType: 'Payment', Account: COUNCIL },
      summary: 'Payment of 1 XRP from the council to rDest',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('a busy council does NOT burn the month: it retries after the cooldown and lands the proposal', async () => {
    prismaModule.__setRules([monthlyRule()]);

    // Tick 1, 09:00:20 on the 1st: the occurrence is due, and the council is
    // busy (one live proposal per account) => nothing is produced.
    at('2026-08-01T09:00:20Z');
    mockCreateProposal.mockResolvedValue({
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: 'proposal prop-0 collecting',
    });
    expect((await new AutomationEngine().tick()).firedCount).toBe(1);

    let row = prismaModule.__getRules()[0];
    expect(row.lastTriggeredAt).toEqual(new Date('2026-08-01T09:00:20Z')); // cooldown stamped
    expect(row.lastArtefactAt).toBeNull(); // occurrence NOT served
    expect(row.totalTimesTriggered).toBe(0); // and never counted as done

    // Tick 2, five minutes later: inside the cooldown => silence. This is the
    // half that keeps the fix from becoming a 60s alert siren.
    at('2026-08-01T09:05:20Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);
    expect(mockCreateProposal).toHaveBeenCalledTimes(1);

    // Tick 3, 90 minutes later: cooldown and retry floor are past, the
    // occurrence is still owed => it comes back. The old engine returned 0 here
    // FOREVER (due 09:00 <= lastTriggeredAt 09:00:20) and the month was lost.
    at('2026-08-01T10:30:20Z');
    mockCreateProposal.mockResolvedValue({ ok: true, proposalId: 'prop-1' });
    expect((await new AutomationEngine().tick()).firedCount).toBe(1);

    row = prismaModule.__getRules()[0];
    expect(row.lastArtefactAt).toEqual(new Date('2026-08-01T10:30:20Z')); // served now
    expect(row.totalTimesTriggered).toBe(1);
    expect(mockSendToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ url: '/app/legacy?tab=proposals' }),
    );

    // Tick 4, later the same day: the artefact exists => no second proposal
    // for a month that is already served.
    at('2026-08-01T14:00:00Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);
    expect(mockCreateProposal).toHaveBeenCalledTimes(2);
  });

  it('an ERRORED fire keeps the occurrence owed too, and stops when the ledger answers', async () => {
    prismaModule.__setRules([monthlyRule({ id: 'rule-monthly-2' })]);

    at('2026-08-01T09:00:10Z');
    mockCompose.mockRejectedValueOnce(new Error('xrpl unreachable'));
    expect((await new AutomationEngine().tick()).firedCount).toBe(1);

    let row = prismaModule.__getRules()[0];
    expect(row.lastArtefactAt).toBeNull();
    expect(row.totalTimesTriggered).toBe(0);

    at('2026-08-01T11:00:10Z');
    mockCreateProposal.mockResolvedValue({ ok: true, proposalId: 'prop-2' });
    expect((await new AutomationEngine().tick()).firedCount).toBe(1);

    row = prismaModule.__getRules()[0];
    expect(row.lastArtefactAt).toEqual(new Date('2026-08-01T11:00:10Z'));
    expect(row.totalTimesTriggered).toBe(1);
  });

  it('a rule with the cooldown DISABLED still cannot loop on a failing occurrence', async () => {
    // cooldownMinutes: 0 turns the tick's DB guard off — the evaluator's retry
    // floor is the only thing left between a broken action and 2160 alerts.
    prismaModule.__setRules([monthlyRule({ id: 'rule-monthly-3', cooldownMinutes: 0 })]);
    mockCreateProposal.mockResolvedValue({
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: 'proposal prop-0 collecting',
    });

    at('2026-08-01T09:00:05Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(1);

    // Twenty ticks over the next twenty minutes: not one of them fires again.
    for (let i = 1; i <= 20; i += 1) {
      at(new Date(Date.parse('2026-08-01T09:00:05Z') + i * 60_000).toISOString());
      expect((await new AutomationEngine().tick()).firedCount).toBe(0);
    }
    expect(mockCreateProposal).toHaveBeenCalledTimes(1);
    expect(prismaModule.__getRules()[0].lastArtefactAt).toBeNull();
  });
});

/**
 * G3-tormenta (2ª ronda) — three holes the sceptic MEASURED on the
 * round-1 engine, walked here over real ticks:
 */
describe('AutomationEngine — G3-tormenta: one notice per occurrence, and the burn is said out loud', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    mockCompose.mockResolvedValue({
      council: COUNCIL,
      xrplTx: { TransactionType: 'Payment', Account: COUNCIL },
      summary: 'Payment of 1 XRP from the council to rDest',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('R1: 37 barren fires leave ONE alert and ONE run — and the retries still happen', async () => {
    prismaModule.__setRules([monthlyRule({ id: 'rule-storm-1' })]);
    mockCreateProposal.mockResolvedValue({
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: 'proposal prop-0 collecting',
    });

    // The measured shape: the first attempt plus one per hour, right up to the
    // last minute of the 36h catch-up window.
    const t0 = Date.parse('2026-08-01T09:00:20Z');
    for (let h = 0; h <= 36; h += 1) {
      at(new Date(t0 + h * 3_600_000).toISOString());
      expect((await new AutomationEngine().tick()).firedCount).toBe(1);
    }

    // The chain stays cut: the occurrence is still being retried (that is G3).
    expect(mockCreateProposal).toHaveBeenCalledTimes(37);
    // …but the family is told ONCE. Round-1: 37 alerts and 37 runs.
    expect(alertCreate).toHaveBeenCalledTimes(1);
    expect(runCreate).toHaveBeenCalledTimes(1);
    expect(prismaModule.__getRules()[0].lastArtefactAt).toBeNull();
    expect(prismaModule.__getRules()[0].totalTimesTriggered).toBe(0);
  });

  it('R1: a retry that finally LANDS the proposal is never silenced', async () => {
    prismaModule.__setRules([monthlyRule({ id: 'rule-storm-2' })]);
    mockCreateProposal.mockResolvedValue({
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: 'proposal prop-0 collecting',
    });
    at('2026-08-01T09:00:20Z');
    await new AutomationEngine().tick();
    expect(alertCreate).toHaveBeenCalledTimes(1);

    at('2026-08-01T10:00:20Z');
    mockCreateProposal.mockResolvedValue({ ok: true, proposalId: 'prop-late' });
    await new AutomationEngine().tick();

    // Good news is news: the second alert is the one that says there is
    // something to sign.
    expect(alertCreate).toHaveBeenCalledTimes(2);
    expect(alertCreate.mock.calls[1][0].data.message).toContain('prop-late');
    expect(prismaModule.__getRules()[0].totalTimesTriggered).toBe(1);
  });

  it('R3: when the occurrence leaves the catch-up window the engine SAYS it was abandoned — once', async () => {
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-storm-3',
        lastTriggeredAt: new Date('2026-08-02T21:00:20Z'), // last barren attempt
        lastArtefactAt: null, // nothing was ever produced
      }),
    ]);

    at('2026-08-02T22:00:20Z');
    // Nothing FIRES: nothing is prepared, nothing is offered to sign.
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);
    expect(mockCompose).not.toHaveBeenCalled();

    expect(runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'expired' }) }),
    );
    expect(alertCreate).toHaveBeenCalledTimes(1);
    const alerted = alertCreate.mock.calls[0][0].data;
    expect(alerted.message).toContain('2026-08-01T09:00:00.000Z');
    expect(alerted.message).toContain('will NOT be retried');
    expect(alerted.message).toContain('Nothing was sent');
    // It is a closure, not a success: the "fired ×N" counter does not move.
    expect(prismaModule.__getRules()[0].totalTimesTriggered).toBe(0);
    // Stamped so it is said exactly once…
    expect(prismaModule.__getRules()[0].lastArtefactAt).toEqual(new Date('2026-08-02T22:00:20Z'));

    at('2026-08-02T23:00:20Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(0);
    expect(alertCreate).toHaveBeenCalledTimes(1); // …and never repeated
  });

  it('R4: a nudge that reached NOBODY does not burn the month', async () => {
    prismaModule.__setRules([
      monthlyRule({
        id: 'rule-storm-4',
        name: 'Seguro del coche',
        action: {
          kind: 'scheduledPayment',
          params: { destination: DESTINATION, amountDrops: '10000000' },
        },
      }),
    ]);

    // Both delivery channels fail: the Alert insert throws and the push mock
    // reports no device. Round-1 stamped the occurrence anyway.
    alertCreate.mockRejectedValueOnce(new Error('alerts table unavailable'));
    at('2026-08-01T09:00:20Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(1);

    let row = prismaModule.__getRules()[0];
    expect(row.lastTriggeredAt).toEqual(new Date('2026-08-01T09:00:20Z')); // cooldown: it did fire
    expect(row.lastArtefactAt).toBeNull(); // but nothing reached the owner
    expect(row.totalTimesTriggered).toBe(0);

    // The retry lands the notice — now, and only now, the month is served.
    at('2026-08-01T10:30:20Z');
    expect((await new AutomationEngine().tick()).firedCount).toBe(1);
    row = prismaModule.__getRules()[0];
    expect(row.lastArtefactAt).toEqual(new Date('2026-08-01T10:30:20Z'));
    expect(row.totalTimesTriggered).toBe(1);
  });

  it('R5: the held-retry reason is logged when it CHANGES, not once a minute', async () => {
    // Production runs one instance (index-simple.ts uses getInstance), which is
    // what makes the log dedup real; the test holds one instance for the same
    // reason.
    prismaModule.__setRules([monthlyRule({ id: 'rule-storm-5', cooldownMinutes: 0 })]);
    mockCreateProposal.mockResolvedValue({
      ok: false,
      reason: 'LIVE_PROPOSAL_EXISTS',
      detail: 'proposal prop-0 collecting',
    });
    const engine = new AutomationEngine();
    at('2026-08-01T09:00:05Z');
    await engine.tick();

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    for (let i = 1; i <= 10; i += 1) {
      at(new Date(Date.parse('2026-08-01T09:00:05Z') + i * 60_000).toISOString());
      await engine.tick();
    }
    const held = logSpy.mock.calls.filter((c) => String(c[0]).includes('retry held for'));
    logSpy.mockRestore();
    // Round-1 dropped the reason on the floor at `if (!evalResult.fired) continue`.
    expect(held).toHaveLength(1);
    expect(String(held[0][0])).toContain('did not fire');
  });
});

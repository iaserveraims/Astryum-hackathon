/**
 * TIME_TRIGGER (Fase 3, B.3 enabler) — the cron evaluator that was a stub.
 * Also proves IDLE_BALANCE works on an XRPL-shaped portfolio (A.1).
 */
import {
  TriggerEvaluator,
  parseCron,
  lastCronOccurrence,
  retryFloorMinutes,
  type TriggerContext,
} from '../TriggerEvaluator';
import type { PortfolioSnapshot } from '../../portfolio/SnapshotBuilder';
import type { RiskSnapshot } from '../../risk/types';

/**
 * G3 — the two stamps are now DIFFERENT things: `lastTriggeredAt` is the
 * cooldown (written on every fire) and `lastArtefactAt` is the served
 * occurrence (written only when the fire produced its artefact).
 */
function ctx(
  now: Date,
  stamps: { lastTriggeredAt?: Date | null; lastArtefactAt?: Date | null } | null = null,
  positions: unknown[] = [],
): TriggerContext {
  return {
    portfolio: { positions } as unknown as PortfolioSnapshot,
    risk: {} as RiskSnapshot,
    now,
    lastTriggeredAt: stamps?.lastTriggeredAt ?? null,
    lastArtefactAt: stamps?.lastArtefactAt ?? null,
  };
}

describe('parseCron — supported subset', () => {
  test.each([
    ['* * * * *'],
    ['0 9 * * 1'], // Mondays 09:00 UTC
    ['*/15 * * * *'],
    ['0 0 1,15 * *'],
    ['30 8-17 * * 1-5'],
  ])('accepts %s', (expr) => {
    expect(parseCron(expr)).not.toBeNull();
  });

  test.each([
    ['not a cron'],
    ['* * * *'], // 4 fields
    ['60 * * * *'], // minute out of range
    ['* 24 * * *'], // hour out of range
    ['@daily'], // named schedules unsupported
    ['*/0 * * * *'], // zero step
  ])('rejects %s', (expr) => {
    expect(parseCron(expr)).toBeNull();
  });
});

describe('lastCronOccurrence', () => {
  test('finds the most recent weekly occurrence within the window', () => {
    // Is a Monday. Now = Monday 10:30 UTC → last "Mon 09:00" is today 09:00.
    const m = parseCron('0 9 * * 1')!;
    const due = lastCronOccurrence(m, new Date('2026-07-13T10:30:00Z'));
    expect(due?.toISOString()).toBe('2026-07-13T09:00:00.000Z');
  });

  test('returns null when nothing matches inside the lookback window', () => {
    // Monthly on the 1st, looked at from the 20th — outside the 36h window.
    const m = parseCron('0 0 1 * *')!;
    expect(lastCronOccurrence(m, new Date('2026-07-20T12:00:00Z'))).toBeNull();
  });
});

describe('TIME_TRIGGER — fires once per occurrence, catches up missed ticks', () => {
  const rule = { type: 'TIME_TRIGGER' as const, cron: '0 9 * * 1' };
  const mondayNine = new Date('2026-07-13T09:00:20Z'); // tick 20s past the minute

  test('fires when the occurrence is newer than the last SERVED one', () => {
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(mondayNine, {
        lastTriggeredAt: new Date('2026-07-06T09:00:30Z'),
        lastArtefactAt: new Date('2026-07-06T09:00:30Z'),
      }),
    );
    expect(res.fired).toBe(true);
    expect(res.data?.dueAt).toBe('2026-07-13T09:00:00.000Z');
  });

  test('does NOT re-fire on the next tick of the same occurrence', () => {
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-07-13T09:05:00Z'), {
        lastTriggeredAt: new Date('2026-07-13T09:00:25Z'),
        lastArtefactAt: new Date('2026-07-13T09:00:25Z'),
      }),
    );
    expect(res.fired).toBe(false);
  });

  test('catches up an occurrence missed while the engine was down', () => {
    // Engine slept over Monday 09:00; wakes at 14:00 — still fires (within 36h).
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-07-13T14:00:00Z'), {
        lastTriggeredAt: new Date('2026-07-06T09:00:30Z'),
        lastArtefactAt: new Date('2026-07-06T09:00:30Z'),
      }),
    );
    expect(res.fired).toBe(true);
  });

  test('never-fired rule fires on the first due occurrence', () => {
    const res = TriggerEvaluator.evaluate(rule, ctx(mondayNine, null));
    expect(res.fired).toBe(true);
  });

  test('unsupported cron → readable reason, never a throw', () => {
    const res = TriggerEvaluator.evaluate({ type: 'TIME_TRIGGER', cron: '@daily' }, ctx(mondayNine));
    expect(res.fired).toBe(false);
    expect(res.reason).toContain('unsupported cron');
  });
});

/**
 * G3 (auditorí) — la ocurrencia quemada.
 * The occurrence marker used to be `lastTriggeredAt`, which the engine stamps
 * on EVERY fire — errors and busy-council included. A monthly payment whose
 * fire produced nothing was therefore filed as done and never came back.
 */
describe('TIME_TRIGGER — an occurrence is served by its ARTEFACT, not by the attempt', () => {
  const rule = { type: 'TIME_TRIGGER' as const, cron: '0 9 1 * *' }; // the 1st, 09:00 UTC
  const due = '2026-08-01T09:00:00.000Z';

  test('a failed attempt does NOT consume the occurrence — it comes back after the floor', () => {
    // The old code compared `due <= lastTriggeredAt` and returned fired:false
    // here FOREVER: the payment for this month simply never happened.
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-08-01T11:30:00Z'), {
        lastTriggeredAt: new Date('2026-08-01T09:00:20Z'), // it fired…
        lastArtefactAt: null, // …and produced nothing
      }),
    );
    expect(res.fired).toBe(true);
    expect(res.data?.dueAt).toBe(due);
    expect(res.data?.retry).toBe(true);
  });

  test('the retry is FLOORED — a broken rule with no cooldown cannot alert every tick', () => {
    // Same still-owed occurrence, 5 minutes after the failed attempt.
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-08-01T09:05:00Z'), {
        lastTriggeredAt: new Date('2026-08-01T09:00:20Z'),
        lastArtefactAt: null,
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.reason).toContain('still owed');
  });

  test('an occurrence that DID produce its artefact never fires again', () => {
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-08-01T23:00:00Z'), {
        lastTriggeredAt: new Date('2026-08-01T10:15:00Z'),
        lastArtefactAt: new Date('2026-08-01T10:15:00Z'),
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.reason).toBeUndefined();
  });

  test('the retry floor never delays the FIRST attempt at an occurrence', () => {
    // Stamps from the PREVIOUS month: nothing was attempted for this one.
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-08-01T09:00:10Z'), {
        lastTriggeredAt: new Date('2026-07-01T09:00:20Z'),
        lastArtefactAt: new Date('2026-07-01T09:00:20Z'),
      }),
    );
    expect(res.fired).toBe(true);
    expect(res.data?.retry).toBe(false);
  });
});


/**
 * G3-tormenta (2ª ronda) — the two holes the sceptic MEASURED on the
 * round-1 fix, both of them silent:
 */
describe('G3-tormenta R2 — the retry floor never outlasts the rule own period', () => {
  test('the floor is the gap minus one for sub-hourly crons, the 60m ceiling otherwise', () => {
    const due = new Date('2026-08-01T09:00:00Z');
    expect(retryFloorMinutes(parseCron('*/15 * * * *')!, due)).toBe(14);
    expect(retryFloorMinutes(parseCron('0 * * * *')!, due)).toBe(59);
    expect(retryFloorMinutes(parseCron('* * * * *')!, due)).toBe(1);
    // Daily and monthly: the next occurrence is far away, the ceiling governs.
    expect(retryFloorMinutes(parseCron('0 9 * * *')!, due)).toBe(60);
    expect(retryFloorMinutes(parseCron('0 9 1 * *')!, due)).toBe(60);
  });

  test('a quarter-hourly occurrence that produced nothing IS retried before the next one supersedes it', () => {
    // Round-1 code: floor 60 >= period 15 => fired:false here, forever, so the
    // occurrence got a single attempt and the burn stayed alive in silence.
    const res = TriggerEvaluator.evaluate(
      { type: 'TIME_TRIGGER', cron: '*/15 * * * *' },
      ctx(new Date('2026-08-01T09:14:30Z'), {
        lastTriggeredAt: new Date('2026-08-01T09:00:00Z'),
        lastArtefactAt: null,
      }),
    );
    expect(res.fired).toBe(true);
    expect(res.data?.retry).toBe(true);
    expect(res.data?.dueAt).toBe('2026-08-01T09:00:00.000Z');
  });

  test('and it is still floored: five minutes in, the same occurrence stays quiet', () => {
    const res = TriggerEvaluator.evaluate(
      { type: 'TIME_TRIGGER', cron: '*/15 * * * *' },
      ctx(new Date('2026-08-01T09:05:00Z'), {
        lastTriggeredAt: new Date('2026-08-01T09:00:00Z'),
        lastArtefactAt: null,
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.reason).toContain('retry held for 14 min');
  });
});

describe('G3-tormenta R3 — an occurrence abandoned at the 36h wall says so', () => {
  const rule = { type: 'TIME_TRIGGER' as const, cron: '0 9 1 * *' };

  test('past the wall, an occurrence that produced nothing reports its abandonment', () => {
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-08-02T22:00:20Z'), {
        lastTriggeredAt: new Date('2026-08-02T21:00:20Z'), // the last barren attempt
        lastArtefactAt: null, // nothing was ever produced
      }),
    );
    expect(res.fired).toBe(false); // nothing is prepared: this is a closing notice
    expect(res.expiredOccurrence).toEqual({
      cron: '0 9 1 * *',
      dueAt: '2026-08-01T09:00:00.000Z',
      lastAttemptAt: '2026-08-02T21:00:20.000Z',
      lookbackHours: 36,
    });
  });

  test('a SERVED occurrence outside the window says nothing — that promise was kept', () => {
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-08-02T22:00:20Z'), {
        lastTriggeredAt: new Date('2026-08-01T10:30:00Z'),
        lastArtefactAt: new Date('2026-08-01T10:30:00Z'),
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.expiredOccurrence).toBeUndefined();
  });

  test('a rule that never fired claims nothing (no attempt, no abandonment)', () => {
    const res = TriggerEvaluator.evaluate(rule, ctx(new Date('2026-08-20T12:00:00Z'), null));
    expect(res.fired).toBe(false);
    expect(res.expiredOccurrence).toBeUndefined();
  });
});

/**
 * G3-final (3ª ronda) — blocker 5: the abandonment notice was
 * FABRICATED. `owedAttempt` is nothing but `lastTriggeredAt`: it says "a fire
 * produced nothing", never "an occurrence of THIS cron produced nothing".
 * Round 2 announced anyway — HIGH alert + push, `dueAt: null` — for a rule
 * whose barren stamp came from a different trigger, or from a month the
 * schedule has long left behind.
 */
describe('G3-final blocker 5 — a barren attempt must be ATTRIBUTABLE before anything is announced', () => {
  const monthly = { type: 'TIME_TRIGGER' as const, cron: '0 9 1 * *' };

  test('a stamp that matches no occurrence of this cron announces NOTHING', () => {
    // `PATCH /rules/:id` takes a partial of the create schema (trigger
    // included) and clears neither stamp: this corpse belongs to an HF_BELOW
    // fire on the 18th, and no occurrence of "the 1st at 09:00" is anywhere
    // near it.
    const res = TriggerEvaluator.evaluate(
      monthly,
      ctx(new Date('2026-08-18T11:07:00Z'), {
        lastTriggeredAt: new Date('2026-08-18T10:07:00Z'),
        lastArtefactAt: null,
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.expiredOccurrence).toBeUndefined();
    expect(res.reason).toContain('belongs to no occurrence');
  });

  test('a stamp whose occurrence has already been superseded announces NOTHING', () => {
    // Disabled after a barren attempt, re-enabled: has
    // come and gone. That abandonment is not news any more.
    const res = TriggerEvaluator.evaluate(
      monthly,
      ctx(new Date('2026-09-03T12:00:00Z'), {
        lastTriggeredAt: new Date('2026-08-01T09:00:20Z'),
        lastArtefactAt: null,
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.expiredOccurrence).toBeUndefined();
    expect(res.reason).toContain('stale stamp');
  });

  test('but days of DOWNTIME never silence a genuine abandonment', () => {
    // The control that stops the guards from becoming a new silence: no later
    // occurrence has passed, so the news still stands — and it names the real
    // date, never null.
    const res = TriggerEvaluator.evaluate(
      monthly,
      ctx(new Date('2026-08-05T12:00:00Z'), {
        lastTriggeredAt: new Date('2026-08-01T09:00:20Z'),
        lastArtefactAt: null,
      }),
    );
    expect(res.fired).toBe(false);
    expect(res.expiredOccurrence).toEqual({
      cron: '0 9 1 * *',
      dueAt: '2026-08-01T09:00:00.000Z',
      lastAttemptAt: '2026-08-01T09:00:20.000Z',
      lookbackHours: 36,
    });
  });

  test('a weekly rule tells the same two stories', () => {
    const weekly = { type: 'TIME_TRIGGER' as const, cron: '0 9 * * 1' }; // Mondays 09:00
    // Monday 09:00 fired barren; Tuesday 21:01 the window closes.
    const genuine = TriggerEvaluator.evaluate(
      weekly,
      ctx(new Date('2026-08-04T21:01:00Z'), {
        lastTriggeredAt: new Date('2026-08-04T20:00:00Z'),
        lastArtefactAt: null,
      }),
    );
    expect(genuine.expiredOccurrence?.dueAt).toBe('2026-08-03T09:00:00.000Z');

    // Three weeks later (a Wednesday, so the last Monday is already outside
    // the 36h window) the schedule has moved on three times over.
    const stale = TriggerEvaluator.evaluate(
      weekly,
      ctx(new Date('2026-08-26T12:00:00Z'), {
        lastTriggeredAt: new Date('2026-08-04T20:00:00Z'),
        lastArtefactAt: null,
      }),
    );
    expect(stale.expiredOccurrence).toBeUndefined();
    expect(stale.reason).toContain('stale stamp');
  });
});

describe('IDLE_BALANCE on an XRPL-shaped portfolio (A.1)', () => {
  const xrplFree = {
    protocolId: 'wallet-1440002',
    chainId: 1440002,
    kind: 'FREE',
    asset: 'XRP',
    amountUSD: 250,
    metadata: { symbol: 'XRP' },
  };
  const xrplLocked = { ...xrplFree, kind: 'LOCKED', protocolId: 'xrpl-escrow', amountUSD: 5000 };

  test('fires on idle XRP above the threshold', () => {
    const res = TriggerEvaluator.evaluate(
      { type: 'IDLE_BALANCE', asset: 'XRP', minUSD: 100 },
      ctx(new Date(), null, [xrplFree]),
    );
    expect(res.fired).toBe(true);
  });

  test('LOCKED (escrowed) XRP does not count as idle', () => {
    const res = TriggerEvaluator.evaluate(
      { type: 'IDLE_BALANCE', asset: 'XRP', minUSD: 100 },
      ctx(new Date(), null, [xrplLocked]),
    );
    expect(res.fired).toBe(false);
  });
});

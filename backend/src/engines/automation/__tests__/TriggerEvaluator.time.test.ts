/**
 * TIME_TRIGGER (Fase 3, B.3 enabler) — the cron evaluator that was a stub.
 * Also proves IDLE_BALANCE works on an XRPL-shaped portfolio (A.1).
 */
import {
  TriggerEvaluator,
  parseCron,
  lastCronOccurrence,
  type TriggerContext,
} from '../TriggerEvaluator';
import type { PortfolioSnapshot } from '../../portfolio/SnapshotBuilder';
import type { RiskSnapshot } from '../../risk/types';

function ctx(now: Date, lastTriggeredAt?: Date | null, positions: unknown[] = []): TriggerContext {
  return {
    portfolio: { positions } as unknown as PortfolioSnapshot,
    risk: {} as RiskSnapshot,
    now,
    lastTriggeredAt,
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
    // 2026-07-13 is a Monday. Now = Monday 10:30 UTC → last "Mon 09:00" is today 09:00.
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

  test('fires when the occurrence is newer than lastTriggeredAt', () => {
    const res = TriggerEvaluator.evaluate(rule, ctx(mondayNine, new Date('2026-07-06T09:00:30Z')));
    expect(res.fired).toBe(true);
    expect(res.data?.dueAt).toBe('2026-07-13T09:00:00.000Z');
  });

  test('does NOT re-fire on the next tick of the same occurrence', () => {
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-07-13T09:05:00Z'), new Date('2026-07-13T09:00:25Z')),
    );
    expect(res.fired).toBe(false);
  });

  test('catches up an occurrence missed while the engine was down', () => {
    // Engine slept over Monday 09:00; wakes at 14:00 — still fires (within 36h).
    const res = TriggerEvaluator.evaluate(
      rule,
      ctx(new Date('2026-07-13T14:00:00Z'), new Date('2026-07-06T09:00:30Z')),
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

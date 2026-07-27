/**
 * APY_BELOW — the governed-rotation trigger ("si el APY cae de X, saca y pon
 * en otro sitio"). Pure evaluation over prefetched rates: fires only on REAL
 * data below threshold; missing data can never fire (invariant #9).
 */
import { TriggerEvaluator, type TriggerConfig } from '../TriggerEvaluator';

const MARKET = '0xAd7e7989796414c9572Da9854DEb1B920724fd09';

const ctx = (rates?: Record<string, number>) => ({
  portfolio: { positions: [] } as never,
  risk: {} as never,
  now: new Date('2026-07-18T12:00:00Z'),
  rates,
});

const trigger = (thresholdPct: number): TriggerConfig => ({
  type: 'APY_BELOW',
  market: MARKET,
  thresholdPct,
});

describe('TriggerEvaluator — APY_BELOW', () => {
  test('fires when the live supply APY is below the threshold (case-insensitive address)', () => {
    const r = TriggerEvaluator.evaluate(trigger(3), ctx({ [MARKET.toLowerCase()]: 1.7 }));
    expect(r.fired).toBe(true);
    expect(r.reason).toMatch(/1\.70% < 3%/);
    expect(r.data).toMatchObject({ supplyAprPct: 1.7, thresholdPct: 3 });
  });

  test('does not fire at/above the threshold', () => {
    expect(TriggerEvaluator.evaluate(trigger(3), ctx({ [MARKET.toLowerCase()]: 3 })).fired).toBe(false);
    expect(TriggerEvaluator.evaluate(trigger(3), ctx({ [MARKET.toLowerCase()]: 8.4 })).fired).toBe(false);
  });

  test('missing rate ⇒ never fires, with an honest reason (no estimates, no silent zeros)', () => {
    const none = TriggerEvaluator.evaluate(trigger(3), ctx({}));
    expect(none.fired).toBe(false);
    expect(none.reason).toMatch(/rate unavailable/);
    const noCtx = TriggerEvaluator.evaluate(trigger(3), ctx(undefined));
    expect(noCtx.fired).toBe(false);
  });
});

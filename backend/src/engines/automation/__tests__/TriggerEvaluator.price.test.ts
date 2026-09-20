/**
 * M3 — PRICE_DROP_PCT deja de ser stub: precio FTSO vivo contra la línea
 * base de la PROPIA regla. Lo que importa: las tres negativas honestas (sin
 * baseline, sin lectura, lectura 0) valen tanto como el disparo — un feed
 * muerto que pareciera un crash del 100% dispararía todas las protecciones
 * a la vez, con firmas de verdad detrás.
 */
import { TriggerEvaluator, type TriggerConfig, type TriggerContext } from '../TriggerEvaluator';

const BASE_CTX: TriggerContext = {
  portfolio: { positions: [] } as never,
  risk: {} as never,
  now: new Date('2026-08-16T12:00:00Z'),
};

function evaluate(trigger: TriggerConfig, prices?: Record<string, number>) {
  return TriggerEvaluator.evaluate(trigger, { ...BASE_CTX, ...(prices ? { prices } : {}) });
}

const RULE: TriggerConfig = { type: 'PRICE_DROP_PCT', asset: 'XRP', pct: 15, baselineUsd: 2.0 };

describe('PRICE_DROP_PCT (M3)', () => {
  it('fires when the live price sits pct% or more below the baseline', () => {
    const r = evaluate(RULE, { XRP: 1.7 }); // −15% exactos
    expect(r.fired).toBe(true);
    expect(r.reason).toContain('15.0% below');
    expect(r.data).toEqual(
      expect.objectContaining({ asset: 'XRP', priceUsd: 1.7, baselineUsd: 2.0, thresholdPct: 15 }),
    );
  });

  it('does not fire above the line — a 14.9% dip is not a 15% rule', () => {
    expect(evaluate(RULE, { XRP: 1.71 }).fired).toBe(false);
  });

  it('never fires without a baseline — legacy stub-era rules say so', () => {
    const r = evaluate({ type: 'PRICE_DROP_PCT', asset: 'XRP', pct: 15 }, { XRP: 0.01 });
    expect(r.fired).toBe(false);
    expect(r.reason).toContain('baselineUsd');
  });

  it('never fires without a live read — missing data is not a crash', () => {
    const r = evaluate(RULE, {});
    expect(r.fired).toBe(false);
    expect(r.reason).toContain('unavailable');
  });

  it('never fires on a 0 price — the provider\'s "could not read" is not a 100% drop', () => {
    expect(evaluate(RULE, { XRP: 0 }).fired).toBe(false);
  });

  it('matches the asset case-insensitively against the UPPERCASED price map', () => {
    const r = evaluate({ type: 'PRICE_DROP_PCT', asset: 'xrp', pct: 10, baselineUsd: 2.0 }, { XRP: 1.5 });
    expect(r.fired).toBe(true);
  });

  it('a price ABOVE baseline is a negative drop and never fires', () => {
    expect(evaluate(RULE, { XRP: 2.5 }).fired).toBe(false);
  });
});

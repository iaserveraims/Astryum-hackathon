/**
 * G8 (auditoría 17-ago) — IDLE_BALANCE deja de desarmarse en SILENCIO.
 *
 * XrplBalanceProvider precia el XRP con UNA llamada a DeFiLlama cuyo camino de
 * fallo devuelve 0, y solo empuja la posición si `xrpUSD >= 1`: una lectura
 * muerta borra el XRP del snapshot entero. La regla de ahorro no encontraba
 * nada y respondía `{fired:false}` a secas — indistinguible de «no hay saldo
 * ocioso» — mientras la superficie la seguía pintando armada.
 *
 * Lo que estos tests fijan: solo una lectura PRECIADA da derecho al silencio;
 * lo desconocido nunca dispara y SIEMPRE lleva razón, como en APY_BELOW y
 * PRICE_DROP_PCT.
 */
import { TriggerEvaluator, type TriggerConfig, type TriggerContext } from '../TriggerEvaluator';

const RULE: TriggerConfig = { type: 'IDLE_BALANCE', asset: 'XRP', minUSD: 100 };

/** Snapshot-shaped position (PortfolioPositionEntry fields the evaluator reads). */
function pos(over: Partial<Record<string, unknown>> = {}) {
  return {
    protocolId: 'wallet-1440002',
    chainId: 1440002,
    kind: 'FREE',
    asset: 'XRP',
    amount: '0',
    amountUSD: 250,
    priceUSD: 2.5,
    metrics: {},
    metadata: {},
    takenAt: new Date('2026-08-17T12:00:00Z'),
    ...over,
  };
}

function evaluate(positions: unknown[], rule: TriggerConfig = RULE) {
  const ctx = {
    portfolio: { positions } as never,
    risk: {} as never,
    now: new Date('2026-08-17T12:00:00Z'),
  } as TriggerContext;
  return TriggerEvaluator.evaluate(rule, ctx);
}

describe('TriggerEvaluator — IDLE_BALANCE (G8: unknown ≠ nothing)', () => {
  test('fires on a priced idle balance above the line (unchanged)', () => {
    const r = evaluate([pos()]);
    expect(r.fired).toBe(true);
    expect(r.reason).toContain('idle XRP');
    expect(r.data).toMatchObject({ positionIds: ['wallet-1440002:XRP:FREE'] });
  });

  test('a PRICED balance below the line is a real "nothing idle" — stays silent', () => {
    const r = evaluate([pos({ amountUSD: 40, priceUSD: 2.5 })]);
    expect(r.fired).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  test('G8: the price read died and the position vanished → never fires, but SAYS SO', () => {
    // Exactly what the XRPL provider leaves behind when DeFiLlama fails: the
    // stablecoin trust line survives ($1 needs no feed), the XRP does not.
    const r = evaluate([
      pos({ asset: 'RLUSD', protocolId: 'wallet-1440002', amountUSD: 500, priceUSD: 1 }),
    ]);
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/no priced XRP balance/);
    expect(r.reason).toMatch(/could not be confirmed/);
  });

  test('an empty snapshot (portfolio read failed upstream) is never reported as "nothing idle"', () => {
    const r = evaluate([]);
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/IDLE_BALANCE/);
  });

  test('an UNPRICED free balance is not "below the threshold" — it is unknown, and says it', () => {
    const r = evaluate([pos({ amountUSD: 0, priceUSD: 0 })]);
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/without a usable USD price/);
  });

  test('a NaN valuation never fires and never passes as a reading', () => {
    const r = evaluate([pos({ amountUSD: Number.NaN, priceUSD: 0 })]);
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/without a usable USD price/);
  });

  test('one unpriced reading poisons the silence even next to a priced one', () => {
    const r = evaluate([
      pos({ amountUSD: 40, priceUSD: 2.5 }),
      pos({ protocolId: 'wallet-1440002-b', amountUSD: 0, priceUSD: 0 }),
    ]);
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/without a usable USD price/);
  });

  test('no crying wolf: a PRICED escrow proves the feed worked, so "no idle XRP" is real', () => {
    // LOCKED XRP priced in the same snapshot ⇒ the provider's price read
    // succeeded ⇒ the absence of a FREE entry is a genuine zero.
    const r = evaluate([pos({ kind: 'LOCKED', protocolId: 'xrpl-escrow', amountUSD: 5000 })]);
    expect(r.fired).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  test('LOCKED (escrowed) XRP still never counts as idle', () => {
    const r = evaluate([pos({ kind: 'LOCKED', protocolId: 'xrpl-escrow', amountUSD: 5000 })]);
    expect(r.fired).toBe(false);
  });

  test('asset matching stays case-insensitive, by symbol metadata or by asset', () => {
    expect(evaluate([pos({ asset: 'xrp' })], { type: 'IDLE_BALANCE', asset: 'XRP', minUSD: 100 }).fired).toBe(true);
    expect(
      evaluate([pos({ asset: 'wallet-token', metadata: { symbol: 'xrp' } })], {
        type: 'IDLE_BALANCE',
        asset: 'xrp',
        minUSD: 100,
      }).fired,
    ).toBe(true);
  });

  test('another asset entirely (priced USDC) does not prove anything about XRP', () => {
    const r = evaluate([pos({ asset: 'USDC', amountUSD: 900, priceUSD: 1 })]);
    expect(r.fired).toBe(false);
    expect(r.reason).toMatch(/no priced XRP balance/);
  });
});

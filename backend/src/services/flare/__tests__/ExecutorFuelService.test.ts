/**
 * ExecutorFuelService — tests de la aritmética pura del combustible.
 * El swap/sweep on-chain es integración mainnet (se valida con el watcher en
 * vivo); aquí se fija el contrato de los planners, que es lo que decide
 * CUÁNTO se swapea/barre y con qué protección de slippage.
 */
import { ethers } from 'ethers';
import { sizeRefuelAmountIn, minOutForQuote, planFxrpSweep } from '../ExecutorFuelService';

const FXRP = (n: string) => ethers.parseUnits(n, 6);
const FLR = (n: string) => ethers.parseEther(n);

describe('sizeRefuelAmountIn', () => {
  // Tipo de sondeo: 10 FXRP → 250 FLR (1 FXRP ≈ 25 FLR, orden de magnitud real
  // con XRP ~$2.5 y FLR ~$0.02).
  const probe = { probeInUBA: FXRP('10'), probeOutWei: FLR('250') };

  it('dimensiona para cubrir lo que falta hasta el target, con +2% de colchón', () => {
    const amountIn = sizeRefuelAmountIn({
      needOutWei: FLR('100'),
      ...probe,
      fxrpBalanceUBA: FXRP('1000'),
      maxPerSwapUBA: FXRP('200'),
    });
    // 100 FLR / 25 FLR-por-FXRP = 4 FXRP; +2% = 4.08 FXRP
    expect(amountIn).toBe(FXRP('4.08'));
  });

  it('capa al saldo propio disponible', () => {
    const amountIn = sizeRefuelAmountIn({
      needOutWei: FLR('100'),
      ...probe,
      fxrpBalanceUBA: FXRP('2'),
      maxPerSwapUBA: FXRP('200'),
    });
    expect(amountIn).toBe(FXRP('2'));
  });

  it('capa al techo por swap (límite de daño ante una cotización rota)', () => {
    const amountIn = sizeRefuelAmountIn({
      needOutWei: FLR('100000'),
      ...probe,
      fxrpBalanceUBA: FXRP('10000'),
      maxPerSwapUBA: FXRP('200'),
    });
    expect(amountIn).toBe(FXRP('200'));
  });

  it('devuelve 0 sin necesidad, sin saldo o con cotización degenerada', () => {
    expect(sizeRefuelAmountIn({ needOutWei: 0n, ...probe, fxrpBalanceUBA: FXRP('10'), maxPerSwapUBA: FXRP('200') })).toBe(0n);
    expect(sizeRefuelAmountIn({ needOutWei: FLR('10'), ...probe, fxrpBalanceUBA: 0n, maxPerSwapUBA: FXRP('200') })).toBe(0n);
    expect(
      sizeRefuelAmountIn({ needOutWei: FLR('10'), probeInUBA: FXRP('10'), probeOutWei: 0n, fxrpBalanceUBA: FXRP('10'), maxPerSwapUBA: FXRP('200') }),
    ).toBe(0n);
  });
});

describe('minOutForQuote', () => {
  it('aplica el slippage máximo en BPS sobre la cotización', () => {
    expect(minOutForQuote(FLR('100'), 100)).toBe(FLR('99')); // 1%
    expect(minOutForQuote(FLR('100'), 0)).toBe(FLR('100'));
  });

  it('acota BPS fuera de rango (nunca minOut negativo ni slippage >100%)', () => {
    expect(minOutForQuote(FLR('100'), 20_000)).toBe(0n);
    expect(minOutForQuote(FLR('100'), -50)).toBe(FLR('100'));
  });
});

describe('planFxrpSweep', () => {
  it('no barre por debajo del umbral (la piñata pequeña no vale un transfer)', () => {
    expect(planFxrpSweep({ fxrpBalanceUBA: FXRP('99'), sweepMinUBA: FXRP('100'), keepUBA: FXRP('50') })).toBe(0n);
  });

  it('barre el exceso sobre el buffer de trabajo cuando cruza el umbral', () => {
    expect(planFxrpSweep({ fxrpBalanceUBA: FXRP('130'), sweepMinUBA: FXRP('100'), keepUBA: FXRP('50') })).toBe(FXRP('80'));
  });

  it('nunca barre en negativo aunque keep > saldo (config incoherente)', () => {
    expect(planFxrpSweep({ fxrpBalanceUBA: FXRP('100'), sweepMinUBA: FXRP('100'), keepUBA: FXRP('150') })).toBe(0n);
  });
});

describe('presupuesto diario de fees FDC — el freno de mano global (incidente 2026-07-18)', () => {
  const { assertDailyFeeBudget, recordFeeSpend, feeBudgetStatus, legacyFeeReserveWei, _resetFeeLedgerForTests, FeeBudgetExceeded } =
    require('../ExecutorFuelService');
  const DAY = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    _resetFeeLedgerForTests();
    delete process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR;
    delete process.env.LEGACY_DAILY_FEE_RESERVE_FLR;
  });

  it('deja pagar mientras la ventana tiene presupuesto y contabiliza el gasto', () => {
    const t0 = 1_000_000;
    expect(() => assertDailyFeeBudget(FLR('20'), t0)).not.toThrow();
    recordFeeSpend(FLR('20'), t0);
    expect(feeBudgetStatus(t0).spentFLR).toBe('20.0');
  });

  it('corta SIN firmar cuando la siguiente fee no cabe (default 120 FLR)', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) recordFeeSpend(FLR('20'), t0); // 120 gastados
    expect(() => assertDailyFeeBudget(FLR('20'), t0)).toThrow(FeeBudgetExceeded);
  });

  it('la ventana rueda a las 24h y vuelve a haber presupuesto', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 6; i++) recordFeeSpend(FLR('20'), t0);
    expect(() => assertDailyFeeBudget(FLR('20'), t0)).toThrow(FeeBudgetExceeded);
    expect(() => assertDailyFeeBudget(FLR('20'), t0 + DAY + 1)).not.toThrow();
    expect(feeBudgetStatus(t0 + DAY + 1).spentFLR).toBe('0.0');
  });

  it('respeta el tope configurado por env', () => {
    process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR = '40';
    const t0 = 1_000_000;
    recordFeeSpend(FLR('20'), t0);
    expect(() => assertDailyFeeBudget(FLR('20'), t0)).not.toThrow();
    recordFeeSpend(FLR('20'), t0);
    expect(() => assertDailyFeeBudget(FLR('20'), t0)).toThrow(FeeBudgetExceeded);
  });

  it('el suelo de Legacy es intocable: 0xFE se capa en tope−reserva, el consejo conserva su combustible', () => {
    process.env.FLARE_EXECUTOR_DAILY_FEE_BUDGET_FLR = '120';
    const RESERVE = FLR('40'); // suelo para Legacy → 0xFE efectivo = 80
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) recordFeeSpend(FLR('20'), t0); // 80 gastados (por 0xFE)
    // 0xFE cede la reserva → ya no puede pagar más (80 + 20 > 120 − 40).
    expect(() => assertDailyFeeBudget(FLR('20'), t0, RESERVE)).toThrow(FeeBudgetExceeded);
    // Legacy (reserva 0 → tope completo) SÍ puede seguir: 80 + 20 = 100 ≤ 120.
    expect(() => assertDailyFeeBudget(FLR('20'), t0)).not.toThrow();
  });

  it('la reserva de Legacy se dimensiona por env (default 40 FLR)', () => {
    expect(legacyFeeReserveWei()).toBe(FLR('40'));
    process.env.LEGACY_DAILY_FEE_RESERVE_FLR = '60';
    expect(legacyFeeReserveWei()).toBe(FLR('60'));
  });

  it('el incidente real NO habría pasado de la ventana: 244 fees × 20 FLR se cortan en la 7ª', () => {
    const t0 = 1_000_000;
    let paid = 0;
    for (let i = 0; i < 244; i++) {
      try {
        assertDailyFeeBudget(FLR('20'), t0 + i * 60_000);
        recordFeeSpend(FLR('20'), t0 + i * 60_000);
        paid++;
      } catch (e) {
        expect(e).toBeInstanceOf(FeeBudgetExceeded);
      }
    }
    expect(paid).toBe(6); // 120 FLR de tope / 20 FLR por fee — no 4.880 FLR
  });
});

describe('computeFeeMarginPct — el guardián FTSO del margen (Tramo 1)', () => {
  const { computeFeeMarginPct } = require('../ExecutorFuelService');

  it('con las medidas del 2026-07-25 el margen sobre coste ronda el 66%', () => {
    // fee 0,2 XRP a $1,0903 = $0,218 · coste 20,4 FLR a $0,00641 = $0,1308
    const pct = computeFeeMarginPct({ execFeeXrp: 0.2, xrpUsd: 1.0903, flrUsd: 0.00641177, costFlr: 20.4 });
    expect(pct).toBeGreaterThan(60);
    expect(pct).toBeLessThan(72);
  });

  it('en el breakeven (ratio XRP/FLR = coste/fee) el margen es 0', () => {
    // 0,2 XRP cubre exactamente 20,4 FLR cuando P_XRP/P_FLR = 102
    const pct = computeFeeMarginPct({ execFeeXrp: 0.2, xrpUsd: 102, flrUsd: 1, costFlr: 20.4 });
    expect(Math.abs(pct as number)).toBeLessThan(1e-9);
  });

  it('si FLR se aprecia más allá del breakeven, el margen es NEGATIVO (cada dispatch pierde)', () => {
    const pct = computeFeeMarginPct({ execFeeXrp: 0.2, xrpUsd: 80, flrUsd: 1, costFlr: 20.4 });
    expect(pct).toBeLessThan(0);
  });

  it('devuelve null ante datos inválidos — un guardián jamás avisa sobre una estimación rota', () => {
    expect(computeFeeMarginPct({ execFeeXrp: 0, xrpUsd: 1, flrUsd: 1, costFlr: 20 })).toBeNull();
    expect(computeFeeMarginPct({ execFeeXrp: 0.2, xrpUsd: NaN, flrUsd: 1, costFlr: 20 })).toBeNull();
    expect(computeFeeMarginPct({ execFeeXrp: 0.2, xrpUsd: 1, flrUsd: -1, costFlr: 20 })).toBeNull();
    expect(computeFeeMarginPct({ execFeeXrp: 0.2, xrpUsd: 1, flrUsd: 1, costFlr: 0 })).toBeNull();
  });
});

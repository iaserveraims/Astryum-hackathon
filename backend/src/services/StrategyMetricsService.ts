import { computeBorrowUsdt0, computeTriggerPrice } from '../connectors/protocols/flare/KineticIsoMath';

/**
 * StrategyMetricsService — the neutral, honest metrics CALCULATOR for the strategy
 * agent (Fix 2).
 *
 * The numbers come from the SAME tested math the prepare flow uses (KineticIsoMath:
 * borrow amount, health factor, liquidation/trigger price) — NEVER from the LLM.
 * The LLM only interprets natural language and PRESENTS this table; it never
 * computes, never highlights, never recommends, and never builds a signable payload.
 *
 * Every option shows the HONEST FULL PICTURE: what you can draw, the resulting HF,
 * the exact liquidation price, and the annual borrow cost. Showing "you can take
 * $200" without the cost + liquidation risk would be dishonest. The table informs a
 * decision; it does not sell one.
 */

const FXRP_DECIMALS = 6; // FXRP UBA == XRP drops (6 dec)

export interface StrategyRatesInput {
  /** Live FTSO XRP/USD (FXRP tracks XRP). */
  fxrpPriceUSD: number;
  /** Live collateral factor of kFXRP ISO (0..1). */
  collateralFactor: number;
  /** Live borrow APR of kUSDT0 ISO (%), or null if it didn't resolve. */
  borrowAprPct?: number | null;
  /** Live supply APR of kFXRP ISO (%), or null if it didn't resolve. */
  supplyAprPct?: number | null;
}

export interface StrategyOption {
  kind: 'lend-only' | 'carry';
  label: string;
  borrowRatio: number | null; // fraction of max borrow capacity used (null = lend-only)
  entryHF: number | null; // health factor at entry (null = no debt)
  borrowUsd: number | null; // USDT0 you can borrow
  liquidationPriceUSD: number | null; // XRP price at which the position liquidates (null = no debt)
  annualBorrowCostUsd: number | null; // interest cost/year on the borrow (null if rate unknown)
  supplyYieldUsdPerYear: number | null; // what the FXRP collateral earns/year (null if rate unknown)
  noDebt: boolean;
  noLiquidationRisk: boolean;
}

export interface StrategyMetrics {
  amountXrp: number;
  collateralValueUSD: number;
  fxrpPriceUSD: number;
  collateralFactor: number;
  borrowAprPct: number | null;
  supplyAprPct: number | null;
  targetUsd: number | null;
  options: StrategyOption[]; // neutral, complete, unranked
  notes: string[];
}

export class StrategyMetricsService {
  /**
   * Compute the full option table for `amountXrp` of collateral. Always includes
   * the debt-free lend-only option plus a spread of carry ratios; when a target USD
   * is given, adds the exact-target option too. Options are returned UNRANKED.
   */
  static computeCarryOptions(
    amountXrp: number,
    rates: StrategyRatesInput,
    opts?: { targetUsd?: number; ratios?: number[] },
  ): StrategyMetrics {
    if (!(amountXrp > 0)) throw new Error('STRATEGY_METRICS_BAD_AMOUNT');
    if (!(rates.fxrpPriceUSD > 0)) throw new Error('STRATEGY_METRICS_BAD_PRICE');
    if (!(rates.collateralFactor > 0 && rates.collateralFactor <= 1))
      throw new Error('STRATEGY_METRICS_BAD_CF');

    const supplyUBA = BigInt(Math.round(amountXrp * 10 ** FXRP_DECIMALS));
    const collateralValueUSD = amountXrp * rates.fxrpPriceUSD;
    const maxBorrowUSD = collateralValueUSD * rates.collateralFactor;
    const supplyYieldUsdPerYear =
      rates.supplyAprPct != null ? collateralValueUSD * (rates.supplyAprPct / 100) : null;
    const notes: string[] = [];

    const options: StrategyOption[] = [
      {
        kind: 'lend-only',
        label: 'Solo supply (sin préstamo)',
        borrowRatio: null,
        entryHF: null,
        borrowUsd: null,
        liquidationPriceUSD: null,
        annualBorrowCostUsd: null,
        supplyYieldUsdPerYear,
        noDebt: true,
        noLiquidationRisk: true,
      },
    ];

    const ratios = new Set<number>(opts?.ratios ?? [0.2, 0.35, 0.5]);
    const targetUsd = opts?.targetUsd ?? null;
    if (targetUsd != null && targetUsd > 0) {
      const targetRatio = targetUsd / maxBorrowUSD;
      if (targetRatio > 0 && targetRatio <= 1) ratios.add(Number(targetRatio.toFixed(4)));
      else
        notes.push(
          `Para sacar $${targetUsd.toFixed(0)} harían falta más XRP o superar el máximo prestable ` +
            `(~$${maxBorrowUSD.toFixed(0)} al 100% de tu capacidad, que además sería HF≈1 y liquidación inmediata).`,
        );
    }

    for (const ratio of [...ratios].sort((a, b) => a - b)) {
      if (!(ratio > 0 && ratio <= 1)) continue;
      const b = computeBorrowUsdt0({
        supplyUBA,
        fxrpPriceUSD: rates.fxrpPriceUSD,
        collateralFactor: rates.collateralFactor,
        borrowRatio: ratio,
      });
      const trigger = computeTriggerPrice({
        supplyUBA,
        borrowUsdt0Base: b.borrowUsdt0Base,
        collateralFactor: rates.collateralFactor,
        targetHF: 1, // price at HF=1 IS the liquidation price
      });
      const entryHF = b.borrowValueUSD > 0 ? b.maxBorrowUSD / b.borrowValueUSD : Infinity;
      options.push({
        kind: 'carry',
        label: `Carry — usas el ${Math.round(ratio * 100)}% de tu capacidad de préstamo`,
        borrowRatio: ratio,
        entryHF,
        borrowUsd: b.borrowUsdt0Human,
        liquidationPriceUSD: trigger.triggerPriceUSD,
        annualBorrowCostUsd:
          rates.borrowAprPct != null ? b.borrowUsdt0Human * (rates.borrowAprPct / 100) : null,
        supplyYieldUsdPerYear,
        noDebt: false,
        noLiquidationRisk: false,
      });
    }

    return {
      amountXrp,
      collateralValueUSD,
      fxrpPriceUSD: rates.fxrpPriceUSD,
      collateralFactor: rates.collateralFactor,
      borrowAprPct: rates.borrowAprPct ?? null,
      supplyAprPct: rates.supplyAprPct ?? null,
      targetUsd,
      options,
      notes,
    };
  }

  /**
   * Render the metrics as a NEUTRAL text table for the LLM context — numbers from
   * the tested math, no ranking, no "best". The LLM presents this; it doesn't
   * recompute or reorder.
   */
  static toContextTable(m: StrategyMetrics): string {
    const usd = (n: number | null) => (n == null ? 'n/d' : `$${n.toFixed(2)}`);
    const price = (n: number | null) => (n == null ? '—' : `$${n.toFixed(4)}`);
    const hf = (n: number | null) => (n == null ? '—' : n === Infinity ? '∞' : n.toFixed(2));
    const lines: string[] = [];
    lines.push(
      `Capital: ${m.amountXrp} XRP ≈ ${usd(m.collateralValueUSD)} (precio FXRP/USD ${price(m.fxrpPriceUSD)}, ` +
        `factor de colateral ${(m.collateralFactor * 100).toFixed(0)}%` +
        `${m.borrowAprPct != null ? `, interés préstamo ${m.borrowAprPct.toFixed(2)}%/año` : ', interés préstamo n/d'}` +
        `${m.supplyAprPct != null ? `, supply ${m.supplyAprPct.toFixed(2)}%/año` : ''}).`,
    );
    if (m.targetUsd != null) lines.push(`Objetivo indicado: sacar ~$${m.targetUsd.toFixed(0)} sin vender el XRP.`);
    lines.push('OPCIONES (todas, sin orden de preferencia — el usuario decide):');
    for (const o of m.options) {
      if (o.kind === 'lend-only') {
        lines.push(
          `- ${o.label}: 0 deuda · sin riesgo de liquidación · el XRP sigue siendo tuyo · ` +
            `${o.supplyYieldUsdPerYear != null ? `gana ~${usd(o.supplyYieldUsdPerYear)}/año` : 'rendimiento = tasa de supply en vivo'}. ` +
            `No sacas dólares (no hay préstamo).`,
        );
      } else {
        lines.push(
          `- ${o.label}: sacas ${usd(o.borrowUsd)} en USDT0 · HF ${hf(o.entryHF)} · ` +
            `precio de liquidación ${price(o.liquidationPriceUSD)} (si el XRP cae ahí, te liquidan) · ` +
            `coste ${o.annualBorrowCostUsd != null ? usd(o.annualBorrowCostUsd) + '/año de interés' : 'interés n/d'}.`,
        );
      }
    }
    for (const n of m.notes) lines.push(`Nota: ${n}`);
    return lines.join('\n');
  }
}

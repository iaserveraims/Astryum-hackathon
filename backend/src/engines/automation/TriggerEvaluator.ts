import type { PortfolioSnapshot } from '../portfolio/SnapshotBuilder';
import type { RiskSnapshot } from '../risk/types';

/**
 * V1 trigger types — discriminated union mirroring CLAUDE.md §21.
 * Adapter for `AutomationRule.trigger` JSON field.
 */
export type TriggerConfig =
  | { type: 'HF_BELOW'; threshold: number }
  | { type: 'HF_CRITICAL' } // fixed at HF<1.2
  | { type: 'LTV_ABOVE'; threshold: number }
  | { type: 'LIQUIDATION_DISTANCE_USD'; minBuffer: number }
  | { type: 'OUT_OF_RANGE'; positionId?: string }
  | { type: 'OUT_OF_RANGE_DURATION'; minutes: number; positionId?: string }
  | { type: 'PRICE_DROP_PCT'; asset: string; pct: number }
  | { type: 'REWARD_THRESHOLD'; minUSD: number }
  | { type: 'IDLE_BALANCE'; asset: string; minUSD: number }
  | { type: 'TIME_TRIGGER'; cron: string }
  // Governed rotation ("si el APY cae de X, saca y pon en otro sitio"):
  // fires when a venue's live supply APY drops below thresholdPct. The rate
  // comes PREFETCHED in ctx.rates (MarketRatesService — protocol data with a
  // source, invariant #9); missing data can never fire the rule.
  | { type: 'APY_BELOW'; market: string; thresholdPct: number };

export interface TriggerContext {
  portfolio: PortfolioSnapshot;
  risk: RiskSnapshot;
  now: Date;
  /** When the rule last fired — TIME_TRIGGER needs it to catch up missed ticks. */
  lastTriggeredAt?: Date | null;
  /** Live supply APY (%) by LOWERCASED market address — prefetched per tick. */
  rates?: Record<string, number>;
}

// ── Cron evaluation (TIME_TRIGGER) ───────────────────────────────────────────
// Supported subset of 5-field cron (minute hour day-of-month month day-of-week):
// `*`, `*/n`, exact values, comma lists and ranges (`1-5`). No named months/days.

/** Parses one cron field into a predicate, or null when the syntax is unsupported. */
function parseCronField(field: string, min: number, max: number): ((v: number) => boolean) | null {
  const parts = field.split(',');
  const preds: Array<(v: number) => boolean> = [];
  for (const part of parts) {
    if (part === '*') {
      preds.push(() => true);
    } else if (/^\*\/\d+$/.test(part)) {
      const step = Number(part.slice(2));
      if (step <= 0) return null;
      preds.push((v) => (v - min) % step === 0);
    } else if (/^\d+-\d+$/.test(part)) {
      const [lo, hi] = part.split('-').map(Number);
      if (lo < min || hi > max || lo > hi) return null;
      preds.push((v) => v >= lo && v <= hi);
    } else if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < min || n > max) return null;
      preds.push((v) => v === n);
    } else {
      return null;
    }
  }
  return (v) => preds.some((p) => p(v));
}

interface CronMatcher {
  minute: (v: number) => boolean;
  hour: (v: number) => boolean;
  dayOfMonth: (v: number) => boolean;
  month: (v: number) => boolean;
  dayOfWeek: (v: number) => boolean;
}

/** Parses a 5-field cron expression; null when malformed/unsupported. */
export function parseCron(expr: string): CronMatcher | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const dayOfMonth = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12);
  const dayOfWeek = parseCronField(fields[4], 0, 6);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function cronMatches(m: CronMatcher, d: Date): boolean {
  return (
    m.minute(d.getUTCMinutes()) &&
    m.hour(d.getUTCHours()) &&
    m.dayOfMonth(d.getUTCDate()) &&
    m.month(d.getUTCMonth() + 1) &&
    m.dayOfWeek(d.getUTCDay())
  );
}

/** How far back a missed occurrence still fires (catch-up window). */
const CRON_LOOKBACK_MINUTES = 36 * 60;

/**
 * The most recent cron occurrence at or before `now` (UTC, minute precision),
 * scanning back at most CRON_LOOKBACK_MINUTES. Null when none in the window.
 */
export function lastCronOccurrence(m: CronMatcher, now: Date): Date | null {
  const cursor = new Date(now);
  cursor.setUTCSeconds(0, 0);
  for (let i = 0; i <= CRON_LOOKBACK_MINUTES; i += 1) {
    if (cronMatches(m, cursor)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 1);
  }
  return null;
}

export interface TriggerEvalResult {
  fired: boolean;
  reason?: string;
  data?: Record<string, unknown>;
}

export class TriggerEvaluator {
  static evaluate(rule: TriggerConfig, ctx: TriggerContext): TriggerEvalResult {
    switch (rule.type) {
      case 'HF_BELOW':
        if (
          ctx.risk.healthFactor !== undefined &&
          ctx.risk.healthFactor < rule.threshold
        ) {
          return {
            fired: true,
            reason: `HF ${ctx.risk.healthFactor.toFixed(2)} < ${rule.threshold}`,
            data: { hf: ctx.risk.healthFactor, threshold: rule.threshold },
          };
        }
        return { fired: false };

      case 'HF_CRITICAL':
        if (
          ctx.risk.healthFactor !== undefined &&
          ctx.risk.healthFactor < 1.2
        ) {
          return {
            fired: true,
            reason: `HF ${ctx.risk.healthFactor.toFixed(2)} below CRITICAL 1.2`,
            data: { hf: ctx.risk.healthFactor },
          };
        }
        return { fired: false };

      case 'LTV_ABOVE':
        if (ctx.risk.ltv !== undefined && ctx.risk.ltv > rule.threshold) {
          return {
            fired: true,
            reason: `LTV ${(ctx.risk.ltv * 100).toFixed(0)}% > ${(rule.threshold * 100).toFixed(0)}%`,
            data: { ltv: ctx.risk.ltv, threshold: rule.threshold },
          };
        }
        return { fired: false };

      case 'LIQUIDATION_DISTANCE_USD':
        if (
          ctx.risk.liquidationDistanceUSD !== undefined &&
          ctx.risk.liquidationDistanceUSD < rule.minBuffer
        ) {
          return {
            fired: true,
            reason: `liquidation buffer $${ctx.risk.liquidationDistanceUSD.toFixed(0)} < $${rule.minBuffer}`,
            data: { buffer: ctx.risk.liquidationDistanceUSD, minBuffer: rule.minBuffer },
          };
        }
        return { fired: false };

      case 'OUT_OF_RANGE': {
        const lps = ctx.portfolio.positions.filter(
          (p) =>
            p.kind === 'LP' &&
            p.metrics?.inRange === false &&
            (rule.positionId
              ? `${p.protocolId}:${p.asset}:${p.kind}` === rule.positionId
              : true)
        );
        if (lps.length > 0) {
          return {
            fired: true,
            reason: `${lps.length} LP position(s) out of range`,
            data: { positionIds: lps.map((p) => `${p.protocolId}:${p.asset}:${p.kind}`) },
          };
        }
        return { fired: false };
      }

      case 'OUT_OF_RANGE_DURATION':
        // V1 stub: requires duration tracking which is not yet wired.
        return { fired: false, reason: 'OUT_OF_RANGE_DURATION not implemented in V1' };

      case 'PRICE_DROP_PCT': {
        const positionsForAsset = ctx.portfolio.positions.filter(
          (p) =>
            String(p.metadata?.symbol ?? '').toUpperCase() === rule.asset.toUpperCase() ||
            p.asset.toLowerCase() === rule.asset.toLowerCase()
        );
        // V1 minimal: needs price history baseline which is not yet wired.
        // Mark as stub to avoid false positives.
        if (positionsForAsset.length === 0) return { fired: false };
        return { fired: false, reason: 'PRICE_DROP_PCT requires price history baseline (not in V1)' };
      }

      case 'REWARD_THRESHOLD': {
        const rewards = ctx.portfolio.positions.filter(
          (p) => p.kind === 'REWARD' && p.amountUSD > rule.minUSD
        );
        if (rewards.length > 0) {
          const total = rewards.reduce((acc, r) => acc + r.amountUSD, 0);
          return {
            fired: true,
            reason: `pending rewards $${total.toFixed(0)} > $${rule.minUSD}`,
            data: { totalUSD: total, count: rewards.length },
          };
        }
        return { fired: false };
      }

      case 'IDLE_BALANCE': {
        const idle = ctx.portfolio.positions.filter(
          (p) =>
            p.kind === 'FREE' &&
            (String(p.metadata?.symbol ?? '').toUpperCase() === rule.asset.toUpperCase() ||
              p.asset.toLowerCase() === rule.asset.toLowerCase()) &&
            p.amountUSD > rule.minUSD
        );
        if (idle.length > 0) {
          return {
            fired: true,
            reason: `idle ${rule.asset} > $${rule.minUSD}`,
            data: { positionIds: idle.map((p) => `${p.protocolId}:${p.asset}:${p.kind}`) },
          };
        }
        return { fired: false };
      }

      case 'APY_BELOW': {
        const rate = ctx.rates?.[rule.market.toLowerCase()];
        if (rate === undefined) {
          // No data ⇒ no trigger. A rule must never fire on an estimate or a
          // failed read (invariant #9) — the reason keeps the run log honest.
          return { fired: false, reason: `APY_BELOW: live rate unavailable for ${rule.market}` };
        }
        if (rate < rule.thresholdPct) {
          return {
            fired: true,
            reason: `supply APY ${rate.toFixed(2)}% < ${rule.thresholdPct}% (market ${rule.market.slice(0, 10)}…)`,
            data: { market: rule.market, supplyAprPct: rate, thresholdPct: rule.thresholdPct },
          };
        }
        return { fired: false };
      }

      case 'TIME_TRIGGER': {
        const matcher = parseCron(rule.cron);
        if (!matcher) {
          return { fired: false, reason: `TIME_TRIGGER: unsupported cron "${rule.cron}"` };
        }
        const due = lastCronOccurrence(matcher, ctx.now);
        if (!due) return { fired: false };
        // Fire once per occurrence: only when the latest due time is NEWER
        // than the last firing (catches occurrences missed between ticks).
        if (ctx.lastTriggeredAt && due.getTime() <= ctx.lastTriggeredAt.getTime()) {
          return { fired: false };
        }
        return {
          fired: true,
          reason: `scheduled time reached (${rule.cron} → ${due.toISOString()})`,
          data: { cron: rule.cron, dueAt: due.toISOString() },
        };
      }

      default:
        return { fired: false };
    }
  }
}

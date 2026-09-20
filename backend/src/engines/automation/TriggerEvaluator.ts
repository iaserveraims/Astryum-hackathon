import type { PortfolioSnapshot } from '../portfolio/SnapshotBuilder';
import type { RiskSnapshot } from '../risk/types';

/**
 * V1 trigger types — discriminated union
 * Adapter for `AutomationRule.trigger` JSON field.
 */
export type TriggerConfig =
  | { type: 'HF_BELOW'; threshold: number }
  | { type: 'HF_CRITICAL' } // fixed at HF<1.2
  | { type: 'LTV_ABOVE'; threshold: number }
  | { type: 'LIQUIDATION_DISTANCE_USD'; minBuffer: number }
  | { type: 'OUT_OF_RANGE'; positionId?: string }
  | { type: 'OUT_OF_RANGE_DURATION'; minutes: number; positionId?: string }
  // Price protection (M3): fires when the asset's LIVE FTSO price
  // sits `pct`% (or more) below `baselineUsd` — the price the owner saw when
  // they wrote the rule. The baseline lives IN the rule on purpose: no price
  // history storage, fully deterministic, auditable in the rule the owner
  // reviewed. Re-arming to a new baseline = editing/recreating the rule.
  | { type: 'PRICE_DROP_PCT'; asset: string; pct: number; baselineUsd?: number }
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
  /**
   * Cooldown stamp — the engine writes it on EVERY fire, artefact or not.
   * G3 (auditorí): this is deliberately NO LONGER the "occurrence
   * already served" marker (see `lastArtefactAt`); TIME_TRIGGER only uses it
   * to space RETRIES of an occurrence still owed.
   */
  lastTriggeredAt?: Date | null;
  /**
   * Last fire that actually produced its ARTEFACT (council proposal, prepared
   * intent, actionable nudge) — stamped by the engine only in that case.
   * TIME_TRIGGER's occurrence marker: a calendar occurrence counts as served
   * when its artefact exists, never merely because the engine tried.
   */
  lastArtefactAt?: Date | null;
  /** Live supply APY (%) by LOWERCASED market address — prefetched per tick. */
  rates?: Record<string, number>;
  /** Live FTSO prices (USD) by UPPERCASED symbol — prefetched per tick.
   *  A FAILED read never lands here (the provider's 0 means "could not
   *  read", and a 0 treated as a price would look like a 100% crash). */
  prices?: Record<string, number>;
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
 * G3 — DEFAULT minimum spacing between RETRIES of one still-owed occurrence.
 * Releasing the occurrence (so a failed fire can be retried) is only half the
 * fix: the DB cooldown normally paces the retries, but `cooldownMinutes: 0`
 * disables that guard, and a calendar rule that keeps failing would then fire
 * — and alert — every 60s for the whole 36h lookback. A first attempt is never
 * delayed by this; only a retry of the same occurrence is.
 *
 * It is a CEILING, not the value: see `retryFloorMinutes` (G3-tormenta R2).
 */
const TIME_TRIGGER_RETRY_FLOOR_MINUTES = 60;

/**
 * G3-final (blocker 5) — how far forward the abandonment guard is willing to
 * scan for a LATER occurrence before it simply calls the stamp stale.
 *
 * 45 days: longer than the sparsest cadence the product offers (monthly), so a
 * genuine abandonment is always decided by the scan and never by this cap;
 * past it the barren stamp predates at least one whole month of the schedule
 * and is stale by any measure. It also keeps the forward scan bounded — this
 * branch runs on every tick of a rule stuck in that state.
 */
const STALE_ABANDONMENT_SCAN_CAP_MINUTES = 45 * 24 * 60;

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

/**
 * Minutes from `from` (EXCLUSIVE) to the next matching minute, or null when
 * none lands within `maxScan` minutes. Deliberately bounded: the only caller
 * needs to know whether the next occurrence arrives BEFORE the retry ceiling,
 * so a monthly rule never pays for a 44 640-minute scan.
 */
function minutesToNextOccurrence(m: CronMatcher, from: Date, maxScan: number): number | null {
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  for (let i = 1; i <= maxScan; i += 1) {
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    if (cronMatches(m, cursor)) return i;
  }
  return null;
}

/**
 * G3-tormenta (R2) — the retry floor of an occurrence, capped by the rule's OWN
 * period.
 */
export function retryFloorMinutes(m: CronMatcher, due: Date): number {
  const gap = minutesToNextOccurrence(m, due, TIME_TRIGGER_RETRY_FLOOR_MINUTES);
  if (gap === null) return TIME_TRIGGER_RETRY_FLOOR_MINUTES;
  return Math.max(1, gap - 1);
}

export interface TriggerEvalResult {
  fired: boolean;
  reason?: string;
  data?: Record<string, unknown>;
  /**
   * G3-tormenta (R3) — a calendar occurrence that WAS attempted, never produced
   * its artefact, and has now fallen out of the catch-up window: it will never
   * be retried. This is NOT a fire (nothing is prepared, nothing is offered to
   * sign) — it is the closing notice the engine owes the family, because the
   * last thing they were told was "retries after cooldown" and that promise has
   * quietly expired.
   * Consumer: AutomationEngine.tick — one alert + one `expired` run, once.
   */
  expiredOccurrence?: {
    cron: string;
    dueAt: string;
    lastAttemptAt: string;
    lookbackHours: number;
  };
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
        // Real since M3: live FTSO price vs the rule's OWN
        // baseline. Three honest refusals before any fire:
        //  - no baseline in the rule → it cannot mean anything (legacy rules
        //    from the stub era say so instead of guessing a baseline);
        //  - no live price this tick → a rule must never fire on a missing
        //    or failed read (invariant #9);
        //  - a non-positive price → that is the provider's "could not read",
        //    and treating it as a price would look like a 100% crash.
        // No position requirement on purpose: a price watch is a watch — the
        // ACTION decides whether capital is involved.
        const baseline = rule.baselineUsd;
        if (!(typeof baseline === 'number' && baseline > 0)) {
          return { fired: false, reason: 'PRICE_DROP_PCT: rule has no baselineUsd — edit/recreate it to arm the watch' };
        }
        const price = ctx.prices?.[rule.asset.toUpperCase()];
        if (price === undefined || !(price > 0)) {
          return { fired: false, reason: `PRICE_DROP_PCT: live price unavailable for ${rule.asset}` };
        }
        const dropPct = (1 - price / baseline) * 100;
        if (dropPct >= rule.pct) {
          return {
            fired: true,
            reason: `${rule.asset} $${price.toFixed(4)} is ${dropPct.toFixed(1)}% below the rule's baseline $${baseline.toFixed(4)} (≥ ${rule.pct}%)`,
            data: { asset: rule.asset, priceUsd: price, baselineUsd: baseline, dropPct, thresholdPct: rule.pct },
          };
        }
        return { fired: false };
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
        // G8 (auditorí) — this arm used to collapse THREE different
        // worlds into one silent `{ fired: false }`:
        //   (a) the balance was read and there is nothing idle above the line;
        //   (b) the balance is there but nobody could put a USD price on it;
        //   (c) the asset is not in the snapshot at all.
        // (c) is not hypothetical: XrplBalanceProvider prices XRP through a
        // single DeFiLlama call whose failure path returns 0, and it only
        // pushes the native position when `xrpUSD >= 1` — so ONE dead HTTP
        // read makes every XRP position (free, escrow, cage) vanish from the
        // snapshot. The savings rule then found nothing, answered `false`
        // with NO reason, and the surface kept painting it as an armed watch.
        // Its siblings never behaved like that: APY_BELOW and PRICE_DROP_PCT
        // both say out loud when their source is missing. Same contract here:
        // an unknown balance can never fire (invariant #9) AND can never be
        // reported as "nothing idle" — only a PRICED reading earns that.
        const wanted = rule.asset.toUpperCase();
        const isWantedAsset = (p: { asset: string; metadata: Record<string, unknown> }): boolean =>
          String(p.metadata?.symbol ?? '').toUpperCase() === wanted ||
          p.asset.toUpperCase() === wanted;

        const freeMatches = ctx.portfolio.positions.filter((p) => p.kind === 'FREE' && isWantedAsset(p));
        const idle = freeMatches.filter(
          (p) => Number.isFinite(p.amountUSD) && p.amountUSD > rule.minUSD
        );
        if (idle.length > 0) {
          return {
            fired: true,
            reason: `idle ${rule.asset} > $${rule.minUSD}`,
            data: { positionIds: idle.map((p) => `${p.protocolId}:${p.asset}:${p.kind}`) },
          };
        }

        // World (b): the position IS in the snapshot but carries no usable USD
        // price, so "below the threshold" was never established — it was assumed.
        const unvalued = freeMatches.filter(
          (p) => !Number.isFinite(p.amountUSD) || !(p.priceUSD > 0)
        );
        if (unvalued.length > 0) {
          return {
            fired: false,
            reason: `IDLE_BALANCE: ${rule.asset} balance found without a usable USD price — could not tell idle from not idle`,
          };
        }

        // World (a): priced readings exist and none clears the line. This is
        // the only branch entitled to stay silent about the free balance.
        if (freeMatches.length > 0) return { fired: false };

        // World (c): no FREE reading for this asset. The only sound proof that
        // the price feed actually worked this tick lives in the SAME snapshot
        // (same provider, same read): any other position denominated in the
        // asset — an escrow, the cage — that came back priced. Note this must
        // NOT lean on ctx.prices: that map is FTSO and the snapshot is priced
        // by the provider's own source, so a live FTSO quote would prove
        // nothing about the read that actually dropped the position.
        const pricedElsewhere = ctx.portfolio.positions.some(
          (p) => isWantedAsset(p) && p.priceUSD > 0 && Number.isFinite(p.amountUSD)
        );
        if (pricedElsewhere) return { fired: false };
        return {
          fired: false,
          reason: `IDLE_BALANCE: no priced ${rule.asset} balance in this snapshot — "nothing idle" could not be confirmed (a failed price read drops the position entirely)`,
        };
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
        // An attempt that produced no artefact leaves its occurrence OWED: the
        // cooldown stamp (written on every fire) sits AFTER the artefact stamp,
        // or there is no artefact stamp at all.
        const owedAttempt =
          ctx.lastTriggeredAt &&
          (!ctx.lastArtefactAt || ctx.lastArtefactAt.getTime() < ctx.lastTriggeredAt.getTime())
            ? ctx.lastTriggeredAt
            : null;

        const due = lastCronOccurrence(matcher, ctx.now);
        if (!due) {
          // G3-tormenta (R3) — the 36h wall used to be a silent burn: the
          // occurrence simply stopped being due, the retries stopped, and the
          // last line in the family's inbox still read "council busy — retries
          // after cooldown". A promise that expires has to SAY it expired.
          // Said ONCE: the engine stamps `lastArtefactAt` when the notice
          // lands, which clears `owedAttempt` for every later tick.
          if (owedAttempt) {
            // G3-final (blocker 5) — TWO attribution guards before anybody is
            // told a payment was abandoned. `owedAttempt` is just
            // `lastTriggeredAt`: it says "some fire produced nothing", NOT
            // "an occurrence of THIS cron produced nothing". Two ways it lies:
            const missed = lastCronOccurrence(matcher, owedAttempt);
            if (!missed) {
              return {
                fired: false,
                reason: `TIME_TRIGGER: the barren attempt at ${owedAttempt.toISOString()} belongs to no occurrence of "${rule.cron}" (the trigger was changed under it) — nothing to abandon, nothing announced`,
              };
            }
            const minutesSinceMissed = Math.floor(
              (ctx.now.getTime() - missed.getTime()) / 60_000,
            );
            const supersededBy =
              minutesSinceMissed > STALE_ABANDONMENT_SCAN_CAP_MINUTES
                ? 1 // older than any cadence we accept: stale by any measure
                : minutesToNextOccurrence(matcher, missed, minutesSinceMissed);
            if (supersededBy !== null) {
              return {
                fired: false,
                reason: `TIME_TRIGGER: the occurrence ${missed.toISOString()} produced nothing, but later occurrences of "${rule.cron}" have already passed (stale stamp — the rule was off or re-armed) — not announced`,
              };
            }
            return {
              fired: false,
              reason: `TIME_TRIGGER: the occurrence last attempted at ${owedAttempt.toISOString()} produced nothing and has left the ${CRON_LOOKBACK_MINUTES / 60}h catch-up window — abandoned`,
              expiredOccurrence: {
                cron: rule.cron,
                dueAt: missed.toISOString(),
                lastAttemptAt: owedAttempt.toISOString(),
                lookbackHours: CRON_LOOKBACK_MINUTES / 60,
              },
            };
          }
          return { fired: false };
        }
        // Fire once per occurrence: only when the latest due time is NEWER than
        // the last fire that actually PRODUCED something (catches occurrences
        // missed between ticks).
        //
        // G3 (auditorí) — this used to read `lastTriggeredAt`, which the
        // engine stamps on EVERY fire, errors and busy-council included. So an
        // occurrence whose fire failed came back as `due <= lastTriggeredAt`
        // (now > due, always) and was never offered again: the monthly payment
        // silently did not happen and the next chance was a month away, while
        // the surface still said "watching". The occurrence is now measured
        // against `lastArtefactAt` — stamped only when the artefact exists.
        if (ctx.lastArtefactAt && due.getTime() <= ctx.lastArtefactAt.getTime()) {
          return { fired: false };
        }
        // The occurrence is still owed. If we ALREADY attempted it (the
        // cooldown stamp sits at or after the due time) this is a RETRY, and
        // retries are floored so a rule with the cooldown disabled cannot turn
        // a broken action into a 60s alert siren. See the constant above.
        const attemptedAt =
          owedAttempt && owedAttempt.getTime() >= due.getTime() ? owedAttempt : null;
        // G3-tormenta (R2): the floor is the rule's own period when that period
        // is shorter than the ceiling — otherwise the retry never happens.
        const floorMinutes = retryFloorMinutes(matcher, due);
        if (
          attemptedAt &&
          ctx.now.getTime() - attemptedAt.getTime() < floorMinutes * 60_000
        ) {
          return {
            fired: false,
            reason: `TIME_TRIGGER: occurrence ${due.toISOString()} still owed (last attempt produced nothing) — retry held for ${floorMinutes} min`,
          };
        }
        return {
          fired: true,
          reason: `scheduled time reached (${rule.cron} → ${due.toISOString()})`,
          data: { cron: rule.cron, dueAt: due.toISOString(), retry: attemptedAt !== null },
        };
      }

      default:
        return { fired: false };
    }
  }
}

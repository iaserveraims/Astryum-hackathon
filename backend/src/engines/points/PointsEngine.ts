import { prisma } from '../../database/prismaClient';

/**
 * Points / Gamification engine V1 FINAL.
 *
 * Off-chain, no transferibles. Idempotent grants vía PointsLedger.idempotencyKey.
 * Caps anti-abuse por evento (daily/weekly/monthly).
 *
 * No hay token on-chain. Power → Credits via burn opcional.
 */

export type EventType =
  | 'ONBOARDING_COMPLETED'
  | 'FIRST_WALLET_CONNECTED'
  | 'FIRST_PORTFOLIO_SNAPSHOT'
  | 'FIRST_RISK_REVIEW'
  | 'FIRST_RULE_CREATED'
  | 'ALERT_REVIEWED'
  | 'DEFENSIVE_ACTION_SIGNED'
  | 'TX_CONFIRMED'
  | 'WEEKLY_ACTIVE'
  | 'HEALTHY_HF_7_DAYS'
  | 'BUG_REPORT_ACCEPTED'
  | 'STRATEGY_TEMPLATE_CREATED';

interface EventConfig {
  points: number;
  power: number;
  credits: number;
  /** undefined = no cap; 'lifetime' = once per user; daily/weekly/monthly = window cap */
  cap?: 'lifetime' | { window: 'daily' | 'weekly' | 'monthly'; max: number };
}

const CATALOG: Record<EventType, EventConfig> = {
  ONBOARDING_COMPLETED: { points: 100, power: 50, credits: 10, cap: 'lifetime' },
  FIRST_WALLET_CONNECTED: { points: 50, power: 20, credits: 0, cap: 'lifetime' },
  FIRST_PORTFOLIO_SNAPSHOT: { points: 20, power: 10, credits: 0, cap: 'lifetime' },
  FIRST_RISK_REVIEW: { points: 30, power: 15, credits: 0, cap: 'lifetime' },
  FIRST_RULE_CREATED: { points: 50, power: 25, credits: 5, cap: 'lifetime' },
  ALERT_REVIEWED: { points: 5, power: 2, credits: 0, cap: { window: 'daily', max: 10 } },
  DEFENSIVE_ACTION_SIGNED: { points: 100, power: 50, credits: 5 },
  TX_CONFIRMED: { points: 20, power: 10, credits: 0, cap: { window: 'daily', max: 50 } },
  WEEKLY_ACTIVE: { points: 50, power: 25, credits: 5, cap: { window: 'weekly', max: 1 } },
  HEALTHY_HF_7_DAYS: { points: 100, power: 50, credits: 10, cap: { window: 'weekly', max: 1 } },
  BUG_REPORT_ACCEPTED: { points: 200, power: 100, credits: 20 },
  STRATEGY_TEMPLATE_CREATED: { points: 75, power: 30, credits: 5, cap: { window: 'monthly', max: 5 } },
};

export interface GrantInput {
  userId: string;
  eventType: EventType;
  /** Required: ensures duplicate calls are no-op (e.g. retries from cron). */
  idempotencyKey: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface GrantResult {
  granted: boolean;
  pointsDelta: number;
  powerDelta: number;
  creditsDelta: number;
  reason: 'ok' | 'duplicate' | 'cap_reached' | 'lifetime_used' | 'unknown_event' | 'mock_mode';
  ledgerId?: string;
}

function levelFromPower(power: number): number {
  if (power >= 5000) return 5;
  if (power >= 2000) return 4;
  if (power >= 500) return 3;
  if (power >= 100) return 2;
  return 1;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // ISO week starts Mon
  x.setUTCDate(x.getUTCDate() - diff);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setUTCDate(1);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export class PointsEngine {
  private static instance: PointsEngine | null = null;
  static getInstance(): PointsEngine {
    if (!this.instance) this.instance = new PointsEngine();
    return this.instance;
  }

  /**
   * Idempotent grant. Checks duplicate (by idempotencyKey unique constraint),
   * lifetime/window caps, then writes ledger row + updates account.
   *
   * Anti-abuse: refuses to grant when NEXT_PUBLIC_USE_MOCK_DATA=true (catches
   * tests/dev sessions accidentally writing real points).
   */
  async grant(input: GrantInput): Promise<GrantResult> {
    if (process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true') {
      return this.zero('mock_mode');
    }

    const cfg = CATALOG[input.eventType];
    if (!cfg) return this.zero('unknown_event');

    // 1) Duplicate check (cheap — relies on @unique constraint as safety net)
    const existing = await prisma.pointsLedger.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    }).catch(() => null);
    if (existing) return this.zero('duplicate');

    // 2) Cap check
    if (cfg.cap === 'lifetime') {
      const lifetime = await prisma.pointsLedger.count({
        where: { userId: input.userId, eventType: input.eventType },
      });
      if (lifetime > 0) return this.zero('lifetime_used');
    } else if (cfg.cap) {
      const since =
        cfg.cap.window === 'daily'
          ? startOfDay(new Date())
          : cfg.cap.window === 'weekly'
            ? startOfWeek(new Date())
            : startOfMonth(new Date());
      const count = await prisma.pointsLedger.count({
        where: {
          userId: input.userId,
          eventType: input.eventType,
          createdAt: { gte: since },
        },
      });
      if (count >= cfg.cap.max) return this.zero('cap_reached');
    }

    // 3) Write ledger + update account in a single transaction
    const ledger = await prisma.$transaction(async (tx) => {
      const row = await tx.pointsLedger.create({
        data: {
          userId: input.userId,
          eventType: input.eventType,
          pointsDelta: cfg.points,
          powerDelta: cfg.power,
          creditsDelta: cfg.credits,
          reason: input.reason ?? input.eventType,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ? (input.metadata as object) : undefined,
        },
      });

      const account = await tx.pointsAccount.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          totalPoints: cfg.points,
          power: cfg.power,
          credits: cfg.credits,
          level: levelFromPower(cfg.power),
        },
        update: {
          totalPoints: { increment: cfg.points },
          power: { increment: cfg.power },
          credits: { increment: cfg.credits },
        },
      });

      // Recompute level if power crossed a threshold
      const newLevel = levelFromPower(account.power);
      if (newLevel !== account.level) {
        await tx.pointsAccount.update({
          where: { userId: input.userId },
          data: { level: newLevel },
        });
      }

      return row;
    });

    return {
      granted: true,
      pointsDelta: cfg.points,
      powerDelta: cfg.power,
      creditsDelta: cfg.credits,
      reason: 'ok',
      ledgerId: ledger.id,
    };
  }

  /** Best-effort grant — never throws. Used when called from non-critical paths. */
  async grantSafe(input: GrantInput): Promise<GrantResult> {
    try {
      return await this.grant(input);
    } catch (err) {
      console.warn('[points] grant failed:', (err as Error).message);
      return this.zero('unknown_event');
    }
  }

  async getAccount(userId: string) {
    const acc = await prisma.pointsAccount.findUnique({ where: { userId } });
    if (!acc) {
      return {
        userId,
        totalPoints: 0,
        power: 0,
        credits: 0,
        level: 1,
      };
    }
    return acc;
  }

  async getLedger(userId: string, limit = 50) {
    return prisma.pointsLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getBadges(userId: string) {
    const earned = await prisma.userBadge.findMany({ where: { userId } });
    const all = await prisma.gamificationBadge.findMany();
    const earnedCodes = new Set(earned.map((b) => b.badgeCode));
    return {
      earned,
      locked: all.filter((b) => !earnedCodes.has(b.code)),
    };
  }

  /**
   * Convert N power → credits (10:1 default ratio). User-initiated burn.
   */
  async convertPowerToCredits(userId: string, power: number): Promise<{
    power: number;
    credits: number;
    newAccount: { totalPoints: number; power: number; credits: number; level: number };
  }> {
    if (power <= 0) throw new Error('invalid_power_amount');
    const ratio = 10;
    const account = await prisma.pointsAccount.findUnique({ where: { userId } });
    if (!account) throw new Error('no_points_account');
    if (account.power < power) throw new Error('insufficient_power');

    const creditsGained = Math.floor(power / ratio);
    const updated = await prisma.pointsAccount.update({
      where: { userId },
      data: {
        power: { decrement: power },
        credits: { increment: creditsGained },
        level: levelFromPower(account.power - power),
      },
    });

    // Audit in ledger as a synthetic event
    await prisma.pointsLedger.create({
      data: {
        userId,
        eventType: 'POWER_BURN',
        pointsDelta: 0,
        powerDelta: -power,
        creditsDelta: creditsGained,
        reason: `burn ${power} power → ${creditsGained} credits`,
        idempotencyKey: `power-burn:${userId}:${Date.now()}`,
      },
    });

    return {
      power,
      credits: creditsGained,
      newAccount: {
        totalPoints: updated.totalPoints,
        power: updated.power,
        credits: updated.credits,
        level: updated.level,
      },
    };
  }

  private zero(reason: GrantResult['reason']): GrantResult {
    return {
      granted: false,
      pointsDelta: 0,
      powerDelta: 0,
      creditsDelta: 0,
      reason,
    };
  }
}

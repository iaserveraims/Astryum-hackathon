/**
 * V1.1 cooldown bookkeeping for AutomationEngine rules. Tracks when a rule
 * last produced a broadcasted intent and reports whether a new run would
 * violate the rule's cooldown window.
 *
 * In-memory only — survives the process lifetime, which matches how
 * AutomationEngine.tick() runs in-process every 60s. Persistence (Prisma
 * `AutomationRun.intentBroadcastAt` index) is a follow-up: when the engine
 * lands the run, it can both call `markBroadcast(...)` here and write to DB,
 * giving us crash-safe cooldowns across restarts.
 *
 * Spec: docs/POLICY_GUARD.md §9.
 */
export interface CooldownStatus {
  readonly active: boolean;
  readonly remainingSeconds: number;
  readonly lastBroadcastAt?: string;
}

export class CooldownService {
  private readonly lastBroadcastByRule = new Map<string, number>();

  /** Record that a rule successfully produced a broadcast / signed intent. */
  markBroadcast(ruleId: string, at: Date = new Date()): void {
    if (!ruleId) return;
    this.lastBroadcastByRule.set(ruleId, at.getTime());
  }

  /**
   * Returns whether the rule is currently under its cooldown window.
   * `cooldownMinutes <= 0` disables the gate (immediate re-fire allowed).
   */
  status(ruleId: string, cooldownMinutes: number, now: Date = new Date()): CooldownStatus {
    if (!ruleId || !cooldownMinutes || cooldownMinutes <= 0) {
      return { active: false, remainingSeconds: 0 };
    }
    const last = this.lastBroadcastByRule.get(ruleId);
    if (!last) return { active: false, remainingSeconds: 0 };
    const elapsedMs = now.getTime() - last;
    const cooldownMs = cooldownMinutes * 60 * 1000;
    if (elapsedMs >= cooldownMs) {
      return { active: false, remainingSeconds: 0, lastBroadcastAt: new Date(last).toISOString() };
    }
    return {
      active: true,
      remainingSeconds: Math.ceil((cooldownMs - elapsedMs) / 1000),
      lastBroadcastAt: new Date(last).toISOString(),
    };
  }

  /** Test/admin helper. */
  reset(ruleId?: string): void {
    if (ruleId) this.lastBroadcastByRule.delete(ruleId);
    else this.lastBroadcastByRule.clear();
  }
}

export const cooldownService = new CooldownService();

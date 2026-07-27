import { EventEmitter } from 'events';
import { ethers } from 'ethers';
import { Prisma } from '@prisma/client';
import { prisma } from '../database/prismaClient';
import { oraclePriceRouter } from '../integrations/oracle/OraclePriceRouter';
import { getRpcForChain } from '../utils/rpcForChain';
import { getTokenBalance } from '../utils/getTokenBalance';

/**
 * Emitted when a rule fires. index-simple.ts subscribes and forwards to
 * the user's Socket.IO room (`user:<userId>`).
 */
export const triggerBus = new EventEmitter();

export type ConditionType =
  | 'PRICE_BELOW'
  | 'PRICE_ABOVE'
  | 'BALANCE_BELOW'
  | 'POSITION_VALUE_BELOW'
  | 'DEFI_POSITION_DETECTED'
  | 'onchain_event'
  | 'wallet_activity'
  | 'schedule';

export interface TriggerRuleInput {
  userId: string;
  name: string;
  description?: string;
  conditionType: ConditionType;
  conditionParams: Record<string, unknown>;
  notificationTemplate?: string;
  cooldownMinutes?: number;
  suggestedActionType?: string;
  suggestedActionParams?: Record<string, unknown>;
}

export interface FiredRule {
  ruleId: string;
  ruleName: string;
  userId: string;
  conditionType: string;
  message: string;
  firedAt: string;
  suggestedActionType?: string;
  suggestedActionParams?: Record<string, unknown>;
  priceContext?: { asset: string; price: number; source: string };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function isInCooldown(rule: { lastFiredAt: Date | null; cooldownMinutes: number }, now: Date): boolean {
  if (!rule.lastFiredAt) return false;
  return now.getTime() - rule.lastFiredAt.getTime() < rule.cooldownMinutes * 60_000;
}

function buildEventTopics(eventSignature: string, topicFilters?: string[]): (string | null)[] {
  const sig = ethers.id(eventSignature); // keccak256 of the human-readable signature
  const topics: (string | null)[] = [sig];
  if (topicFilters) {
    for (const f of topicFilters) topics.push(f || null);
  }
  return topics;
}

// ─── IntentTriggerService ─────────────────────────────────────────────────────

/**
 * IntentTriggerService
 *
 * Evaluates TriggerRules and sends NOTIFICATIONS only.
 * NEVER auto-opens MoonPay. NEVER auto-creates partner sessions.
 * NEVER auto-executes anything. Notify and let the user decide.
 *
 * When a rule fires:
 *   1. Persist to NotificationLog
 *   2. Emit on triggerBus → index-simple.ts forwards to WS room
 *   3. Return FiredRule[] for logging
 */
export class IntentTriggerService {
  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async createRule(input: TriggerRuleInput): Promise<object> {
    return prisma.triggerRule.create({
      data: {
        userId: input.userId,
        name: input.name,
        description: input.description,
        conditionType: input.conditionType,
        conditionParams: input.conditionParams as object,
        notificationTemplate: input.notificationTemplate,
        cooldownMinutes: input.cooldownMinutes ?? 60,
        suggestedActionType: input.suggestedActionType,
        suggestedActionParams: input.suggestedActionParams
          ? (input.suggestedActionParams as object)
          : undefined,
        enabled: true,
      },
    });
  }

  async listRules(userId: string): Promise<object[]> {
    return prisma.triggerRule.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async toggleRule(id: string, userId: string, enabled: boolean): Promise<object> {
    const rule = await prisma.triggerRule.findFirst({ where: { id, userId } });
    if (!rule) throw new Error('RULE_NOT_FOUND');
    return prisma.triggerRule.update({ where: { id }, data: { enabled } });
  }

  async deleteRule(id: string, userId: string): Promise<void> {
    const rule = await prisma.triggerRule.findFirst({ where: { id, userId } });
    if (!rule) throw new Error('RULE_NOT_FOUND');
    await prisma.triggerRule.delete({ where: { id } });
  }

  // ─── Context-based evaluation (testable, used by cron with pre-fetched data) ─

  /**
   * Evaluate active rules against a pre-fetched context.
   * Accepts prices and newPositionWatchlistIds so tests can mock them without
   * hitting real oracles or the DB for live data.
   */
  async evaluateActive(context: {
    prices?: Record<string, number>;
    newPositionWatchlistIds?: string[];
  }): Promise<FiredRule[]> {
    const rules = await prisma.triggerRule.findMany({ where: { enabled: true } });
    if (rules.length === 0) return [];

    const now = new Date();
    const fired: FiredRule[] = [];

    for (const rule of rules) {
      if (isInCooldown(rule, now)) continue;
      const params = rule.conditionParams as Record<string, unknown>;

      let triggered = false;

      if (rule.conditionType === 'PRICE_BELOW' && context.prices) {
        const price = context.prices[params.asset as string];
        triggered = price != null && price < Number(params.threshold);
      } else if (rule.conditionType === 'PRICE_ABOVE' && context.prices) {
        const price = context.prices[params.asset as string];
        triggered = price != null && price > Number(params.threshold);
      } else if (rule.conditionType === 'DEFI_POSITION_DETECTED' && context.newPositionWatchlistIds) {
        triggered = context.newPositionWatchlistIds.includes(params.watchlistId as string);
      }

      if (!triggered) continue;

      const firedRule: FiredRule = {
        ruleId: rule.id,
        ruleName: rule.name,
        userId: rule.userId,
        conditionType: rule.conditionType,
        message: rule.notificationTemplate ?? `Rule "${rule.name}" triggered`,
        firedAt: now.toISOString(),
        suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
        suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
      };
      fired.push(firedRule);

      await prisma.triggerRule
        .update({ where: { id: rule.id }, data: { lastFiredAt: now, timesTriggered: { increment: 1 } } })
        .catch(() => { /* non-fatal */ });

      triggerBus.emit('rule:fired', {
        userId: firedRule.userId,
        ruleId: firedRule.ruleId,
        ruleName: firedRule.ruleName,
        message: firedRule.message,
        suggestedActionType: firedRule.suggestedActionType ?? 'notify_only',
        firedAt: firedRule.firedAt,
      });
    }

    return fired;
  }

  // ─── Full evaluation (called by cron every 60s) ──────────────────────────

  async evaluateAll(): Promise<FiredRule[]> {
    const rules = await prisma.triggerRule.findMany({ where: { enabled: true } });
    if (rules.length === 0) return [];

    const now = new Date();
    const allFired: FiredRule[] = [];

    // Group rules by type for efficient batch processing
    const byType = rules.reduce<Record<string, typeof rules[number][]>>((acc, r) => {
      (acc[r.conditionType] ??= []).push(r);
      return acc;
    }, {});

    // ── Price rules (dual-oracle: FTSO + Redstone) ──────────────────────────
    const priceRules = [
      ...(byType['PRICE_BELOW'] ?? []),
      ...(byType['PRICE_ABOVE'] ?? []),
    ];
    if (priceRules.length > 0) {
      const activeAssets = [
        ...new Set(
          priceRules
            .map((r) => (r.conditionParams as Record<string, unknown>).asset as string)
            .filter(Boolean),
        ),
      ];

      let prices: Awaited<ReturnType<typeof oraclePriceRouter.getPrices>> = {};
      if (activeAssets.length > 0) {
        prices = await oraclePriceRouter.getPrices(activeAssets).catch(() => ({}));
      }

      for (const rule of priceRules) {
        if (isInCooldown(rule, now)) continue;
        const params = rule.conditionParams as Record<string, unknown>;
        const resolved = prices[params.asset as string];
        if (!resolved || resolved.isStale) continue;

        const threshold = Number(params.threshold);
        const triggered =
          rule.conditionType === 'PRICE_BELOW'
            ? resolved.usdPrice < threshold
            : resolved.usdPrice > threshold;

        if (!triggered) continue;

        const dir = rule.conditionType === 'PRICE_BELOW' ? 'dropped below' : 'rose above';
        const message =
          rule.notificationTemplate ??
          `${params.asset} ${dir} $${threshold} (current: $${resolved.usdPrice.toFixed(4)}, source: ${resolved.source})`;

        allFired.push({
          ruleId: rule.id,
          ruleName: rule.name,
          userId: rule.userId,
          conditionType: rule.conditionType,
          message,
          firedAt: now.toISOString(),
          suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
          suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
          priceContext: { asset: params.asset as string, price: resolved.usdPrice, source: resolved.source },
        });
      }
    }

    // ── Balance rules ────────────────────────────────────────────────────────
    for (const rule of byType['BALANCE_BELOW'] ?? []) {
      if (isInCooldown(rule, now)) continue;
      const params = rule.conditionParams as Record<string, unknown>;
      try {
        const balance = await getTokenBalance(
          params.walletAddress as string,
          params.tokenAddress as string | undefined,
          Number(params.chainId ?? 14),
        );
        const threshold = BigInt(String(params.threshold ?? '0'));
        if (balance >= threshold) continue;

        allFired.push({
          ruleId: rule.id,
          ruleName: rule.name,
          userId: rule.userId,
          conditionType: rule.conditionType,
          message:
            rule.notificationTemplate ??
            `Wallet ${params.walletAddress} balance fell below threshold`,
          firedAt: now.toISOString(),
          suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
          suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
        });
      } catch {
        /* skip if chain unavailable */
      }
    }

    // ── Position value rules (DB-based) ──────────────────────────────────────
    let positionValues: Record<string, number> = {};
    const posValRules = byType['POSITION_VALUE_BELOW'] ?? [];
    if (posValRules.length > 0) {
      try {
        const groups = await prisma.deFiPosition.groupBy({
          by: ['watchlistId'],
          _sum: { valueUSD: true },
          where: { confidenceLevel: { not: 'unknown' } },
        });
        for (const g of groups) {
          positionValues[g.watchlistId] = Number(g._sum.valueUSD ?? 0);
        }
      } catch { /* skip if model not migrated */ }

      for (const rule of posValRules) {
        if (isInCooldown(rule, now)) continue;
        const params = rule.conditionParams as Record<string, unknown>;
        const value = positionValues[params.watchlistId as string];
        if (value == null || value >= Number(params.threshold)) continue;

        allFired.push({
          ruleId: rule.id,
          ruleName: rule.name,
          userId: rule.userId,
          conditionType: rule.conditionType,
          message:
            rule.notificationTemplate ??
            `DeFi position value dropped below $${params.threshold} USD`,
          firedAt: now.toISOString(),
          suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
          suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
        });
      }
    }

    // ── DeFi position detected ────────────────────────────────────────────────
    let newPositionWatchlistIds: string[] = [];
    const defiDetectRules = byType['DEFI_POSITION_DETECTED'] ?? [];
    if (defiDetectRules.length > 0) {
      try {
        const recent = await prisma.deFiPosition.findMany({
          where: {
            detectedAt: { gte: new Date(now.getTime() - 65_000) }, // last tick window
          },
          select: { watchlistId: true },
        });
        newPositionWatchlistIds = [...new Set(recent.map((p) => p.watchlistId))];
      } catch { /* skip */ }

      for (const rule of defiDetectRules) {
        if (isInCooldown(rule, now)) continue;
        const params = rule.conditionParams as Record<string, unknown>;
        if (!newPositionWatchlistIds.includes(params.watchlistId as string)) continue;

        allFired.push({
          ruleId: rule.id,
          ruleName: rule.name,
          userId: rule.userId,
          conditionType: rule.conditionType,
          message:
            rule.notificationTemplate ?? `New DeFi position detected for watched wallet`,
          firedAt: now.toISOString(),
          suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
          suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
        });
      }
    }

    // ── On-chain event rules (getLogs with block tracking) ──────────────────
    for (const rule of byType['onchain_event'] ?? []) {
      if (isInCooldown(rule, now)) continue;
      const params = rule.conditionParams as Record<string, unknown>;
      const chainId = Number(params.chainId ?? 14);
      try {
        const rpc = getRpcForChain(chainId);
        const currentBlock = await rpc.getBlockNumber();
        const fromBlock =
          rule.lastProcessedBlock != null
            ? Number(rule.lastProcessedBlock) + 1
            : currentBlock - 1000; // first run: scan last ~1000 blocks

        const logs = await rpc.getLogs({
          address: params.contractAddress as string,
          topics: buildEventTopics(
            params.eventSignature as string,
            params.topicFilters as string[] | undefined,
          ),
          fromBlock,
          toBlock: currentBlock,
        });

        // Always update lastProcessedBlock even when no events found,
        // so the next tick starts from where we left off.
        await prisma.triggerRule.update({
          where: { id: rule.id },
          data: { lastProcessedBlock: BigInt(currentBlock) },
        });

        if (logs.length > 0) {
          allFired.push({
            ruleId: rule.id,
            ruleName: rule.name,
            userId: rule.userId,
            conditionType: rule.conditionType,
            message:
              rule.notificationTemplate ??
              `Event ${params.eventSignature} detected on ${params.contractAddress} (${logs.length} log(s))`,
            firedAt: now.toISOString(),
            suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
            suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
          });
        }
      } catch {
        /* skip if chain unavailable or RPC error */
      }
    }

    // ── Wallet activity rules (uses ChainExplorerProvider) ──────────────────
    for (const rule of byType['wallet_activity'] ?? []) {
      if (isInCooldown(rule, now)) continue;
      const params = rule.conditionParams as Record<string, unknown>;
      try {
        const { chainExplorerProvider } = await import(
          '../integrations/providers/explorer/ChainExplorerProvider'
        );
        const txs = await chainExplorerProvider.getTransactions(
          params.walletAddress as string,
          Number(params.chainId ?? 14),
        );

        const cutoff = now.getTime() - 65_000; // last tick window
        const recentTxs = txs.filter(
          (tx: { timestamp: Date }) => new Date(tx.timestamp).getTime() > cutoff,
        );

        if (recentTxs.length === 0) continue;

        allFired.push({
          ruleId: rule.id,
          ruleName: rule.name,
          userId: rule.userId,
          conditionType: rule.conditionType,
          message:
            rule.notificationTemplate ??
            `Wallet activity detected for ${params.walletAddress} (${recentTxs.length} tx(s))`,
          firedAt: now.toISOString(),
          suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
          suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
        });
      } catch {
        /* skip if explorer unavailable */
      }
    }

    // ── Schedule rules ───────────────────────────────────────────────────────
    for (const rule of byType['schedule'] ?? []) {
      if (isInCooldown(rule, now)) continue;
      const params = rule.conditionParams as Record<string, unknown>;
      let triggered = false;

      if (params.intervalMinutes) {
        // Interval-based: fire if enough time has passed since last fire
        const intervalMs = Number(params.intervalMinutes) * 60_000;
        const lastFired = rule.lastFiredAt?.getTime() ?? 0;
        triggered = now.getTime() - lastFired >= intervalMs;
      }
      // cronExpression support would require a cron parser — deferred

      if (!triggered) continue;

      allFired.push({
        ruleId: rule.id,
        ruleName: rule.name,
        userId: rule.userId,
        conditionType: rule.conditionType,
        message:
          rule.notificationTemplate ?? `Scheduled trigger fired`,
        firedAt: now.toISOString(),
        suggestedActionType: (rule as unknown as Record<string, unknown>).suggestedActionType as string | undefined,
        suggestedActionParams: (rule as unknown as Record<string, unknown>).suggestedActionParams as Record<string, unknown> | undefined,
      });
    }

    // ── Persist + dispatch all fired rules ───────────────────────────────────
    for (const fired of allFired) {
      // Update rule state
      await prisma.triggerRule
        .update({
          where: { id: fired.ruleId },
          data: { lastFiredAt: now, timesTriggered: { increment: 1 } },
        })
        .catch(() => { /* non-fatal */ });

      // Persist to NotificationLog
      await prisma.notificationLog
        .create({
          data: {
            userId: fired.userId,
            type: 'RULE_FIRED',
            title: `Regla activada: ${fired.ruleName}`,
            body: fired.message,
            payload: {
              ruleId: fired.ruleId,
              conditionType: fired.conditionType,
              suggestedActionType: fired.suggestedActionType ?? 'notify_only',
              suggestedActionParams: (fired.suggestedActionParams ?? {}) as Prisma.InputJsonValue,
              priceContext: (fired.priceContext ?? null) as Prisma.InputJsonValue,
            },
            status: 'pending',
          },
        })
        .catch(() => { /* non-fatal — WS delivery still goes through */ });

      // Push to Socket.IO via triggerBus (index-simple.ts subscribes)
      triggerBus.emit('rule:fired', {
        userId: fired.userId,
        ruleId: fired.ruleId,
        ruleName: fired.ruleName,
        message: fired.message,
        suggestedActionType: fired.suggestedActionType ?? 'notify_only',
        priceContext: fired.priceContext ?? null,
        firedAt: fired.firedAt,
      });
    }

    return allFired;
  }
}

export const intentTriggerService = new IntentTriggerService();

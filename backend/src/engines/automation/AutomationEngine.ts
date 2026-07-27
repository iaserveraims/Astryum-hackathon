import { prisma } from '../../database/prismaClient';
import { PortfolioEngine } from '../portfolio/PortfolioEngine';
import { RiskEngine } from '../risk/RiskEngine';
import { IntentEngine } from '../intent/IntentEngine';
import { intentPreparationEngine } from '../../control-plane/IntentPreparationEngine';
import { regulatedRelayBoundary } from '../../partners/RegulatedRelayBoundary';
import { PushNotificationService } from '../../services/PushNotificationService';
import { cooldownService } from '../../control-plane/policy/CooldownService';
import {
  TriggerEvaluator,
  type TriggerConfig,
} from './TriggerEvaluator';
import type { ProtocolActionKind } from '../../types/domain/Protocol';

/**
 * V2: Prepared flow node action types. Only prepare_* nodes are allowed —
 * no node type triggers direct execution. Every node creates a pending
 * IntentAuthorizationSession that the user must review before authorization.
 */
export type FlowNodeType =
  | 'prepare_swap'
  | 'prepare_supply'
  | 'prepare_borrow'
  | 'prepare_repay'
  | 'prepare_stake'
  | 'prepare_unstake'
  | 'prepare_vault_deposit'
  | 'prepare_vault_withdraw'
  | 'prepare_swap_and_supply'
  | 'prepare_claim_rewards'
  | 'prepare_bridge';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  params: Record<string, unknown>;
}

/**
 * AutomationEngine V1/V2 — prepare-only.
 *
 * V1 tick (every 60s):
 *  1. Load enabled rules (group by walletAddress)
 *  2. Compute portfolio + risk per wallet (cached 30s)
 *  3. Evaluate each rule with TriggerEvaluator
 *  4. If fired AND cooldown ok:
 *     a. Create Alert
 *     b. (best-effort) Prepare TransactionIntent via IntentEngine
 *     c. Persist AutomationRun(status='intent_prepared' | 'triggered' | 'error')
 *     d. NEVER broadcast. NEVER sign.
 *
 * V2 addition: prepareFlowNode() — see method doc below.
 */
export class AutomationEngine {
  private static instance: AutomationEngine | null = null;
  static getInstance(): AutomationEngine {
    if (!this.instance) this.instance = new AutomationEngine();
    return this.instance;
  }

  async tick(): Promise<{ ruleCount: number; firedCount: number }> {
    let rules;
    try {
      rules = await prisma.automationRule.findMany({
        where: { enabled: true },
        include: { wallet: true, protocol: true },
      });
    } catch (err) {
      console.warn('[automation] tick: rules read failed:', (err as Error).message);
      return { ruleCount: 0, firedCount: 0 };
    }

    if (rules.length === 0) return { ruleCount: 0, firedCount: 0 };

    // Group by wallet to avoid recomputing portfolio per rule.
    //
    // Chain resolution (bug 2026-07-25): the rule stores NO chainId of its own —
    // and the Wallet row keeps its CONNECT-time chain (EVM connects store 1 or
    // null), so grouping by wallet.chainId scanned the WRONG chain for a Flare
    // rule on an Ethereum-linked wallet: empty portfolio → HF undefined →
    // HF_BELOW never fired, silently. The rule's Protocol (resolved at create
    // time against the request's chainId — kinetic@14) is the authoritative
    // scope; wallet.chainId remains only for protocol-less rules (council
    // payments, savings escrow), whose behavior is unchanged.
    const byWallet = new Map<string, typeof rules>();
    for (const r of rules) {
      const ruleChainId = r.protocol?.chainId ?? r.wallet.chainId ?? 14;
      const key = `${r.wallet.address}:${ruleChainId}`;
      if (!byWallet.has(key)) byWallet.set(key, []);
      byWallet.get(key)!.push(r);
    }

    let firedCount = 0;
    const now = new Date();

    // Prefetch the live supply APYs every APY_BELOW rule needs — ONE read per
    // tick for all rules (the evaluator stays pure/sync over ctx.rates).
    let rates: Record<string, number> = {};
    const apyMarkets = rules
      .map((r) => r.trigger as TriggerConfig)
      .filter((t): t is Extract<TriggerConfig, { type: 'APY_BELOW' }> => t?.type === 'APY_BELOW')
      .map((t) => t.market);
    if (apyMarkets.length > 0) {
      try {
        const { readSupplyAprs } = await import('../../services/flare/MarketRatesService');
        rates = await readSupplyAprs(apyMarkets);
      } catch (err) {
        console.warn('[automation] APY prefetch failed (APY rules skip this tick):', (err as Error).message);
      }
    }

    for (const [key, walletRules] of byWallet) {
      const [address, chainIdStr] = key.split(':');
      const chainId = parseInt(chainIdStr, 10) || 14;

      let portfolio;
      try {
        portfolio = await PortfolioEngine.getInstance().getPortfolio(address, chainId);
      } catch (err) {
        console.warn(`[automation] portfolio read failed for ${address}:`, (err as Error).message);
        // Portfolio-independent triggers (TIME_TRIGGER) must still run — a
        // council account whose snapshot fails would otherwise silently freeze
        // its scheduled rules. Empty snapshot; state-reading triggers no-op.
        portfolio = { positions: [] } as never;
      }
      const risk = RiskEngine.getInstance().evaluateSnapshot(portfolio);

      for (const rule of walletRules) {
        // Enforced TTL: an expired rule is disabled, never evaluated (guardarraíl
        // MoneyFlows — caduca sola; renovarla es un acto explícito del dueño).
        if (rule.expiresAt && rule.expiresAt.getTime() <= now.getTime()) {
          try {
            await prisma.automationRule.update({
              where: { id: rule.id },
              data: { enabled: false },
            });
            console.log(`[automation] rule ${rule.id} (${rule.name}) expired ${rule.expiresAt.toISOString()} — disabled`);
          } catch {
            /* next tick retries the disable */
          }
          continue;
        }
        // Cooldown
        if (
          rule.lastTriggeredAt &&
          rule.cooldownMinutes > 0 &&
          now.getTime() - rule.lastTriggeredAt.getTime() <
            rule.cooldownMinutes * 60_000
        ) {
          continue;
        }

        const trigger = rule.trigger as TriggerConfig;
        const evalResult = TriggerEvaluator.evaluate(trigger, {
          portfolio,
          risk,
          now,
          lastTriggeredAt: rule.lastTriggeredAt,
          rates,
        });

        if (!evalResult.fired) continue;

        firedCount += 1;

        // Per V1: prepare-only
        const ruleAction = (rule.action as { kind?: ProtocolActionKind; protocolId?: string; positionId?: string; params?: Record<string, unknown> }) ?? {};

        let intentId: string | undefined;
        let runStatus: 'triggered' | 'intent_prepared' | 'proposal_created' | 'error' = 'triggered';
        let runNotes = evalResult.reason ?? null;

        if (ruleAction.kind === 'councilPayment' || ruleAction.kind === 'councilOrder') {
          // Governed MoneyFlow (sign-at-trigger, N firmantes): the trigger
          // COMPOSES a proposal into the council inbox; the QUORUM signs it
          // there. The rule holds zero authority — nothing moves without the
          // quorum. One live proposal per account (XRPL pins one Sequence):
          // a busy council is a retry-after-cooldown, not an error.
          try {
            const { composeCouncilRuleTx, createCouncilProposalFromRule } = await import(
              '../../services/CouncilProposalService'
            );
            const composed = await composeCouncilRuleTx(
              ruleAction.kind,
              (ruleAction.params ?? {}) as Record<string, unknown>,
              rule.wallet.address,
            );
            const outcome = await createCouncilProposalFromRule({
              account: composed.council,
              xrplTx: composed.xrplTx,
              title: `${rule.name} — ${composed.summary}`.slice(0, 120),
              createdByUserId: rule.wallet.userId,
            });
            if (outcome.ok) {
              runStatus = 'proposal_created';
              runNotes = `${runNotes ?? 'trigger fired'} — proposal ${outcome.proposalId} in the council inbox (quorum signs)`;
              cooldownService.markBroadcast(rule.id, now);
              void PushNotificationService.getInstance()
                .sendToUser(rule.wallet.userId, {
                  type: 'INTENT_READY',
                  title: `MoneyFlow: ${rule.name} — council proposal ready`,
                  body: `${composed.summary} — the quorum reviews and signs in the inbox. Nothing moves without those signatures.`,
                  url: '/app/wallets',
                  data: { ruleId: rule.id, proposalId: outcome.proposalId, trigger: trigger.type },
                })
                .catch((err: Error) => console.warn('[automation] push failed:', err.message));
            } else if (outcome.reason === 'LIVE_PROPOSAL_EXISTS') {
              runStatus = 'triggered';
              runNotes = `${runNotes ?? 'trigger fired'} — council busy (one live proposal per account); retries after cooldown`;
              cooldownService.markBroadcast(rule.id, now);
            } else {
              runStatus = 'error';
              runNotes = `council_proposal_failed (${outcome.reason}): ${outcome.detail}`;
            }
          } catch (err) {
            runStatus = 'error';
            runNotes = `council_compose_failed: ${(err as Error).message}`;
          }
        } else if (ruleAction.kind === 'escrow') {
          // XRPL savings-escrow (B.1, N1): nothing is prepared server-side —
          // the EscrowCreate txjson is composed FRESH in the Savings surface
          // when the user acts (FinishAfter must be relative to signing time,
          // not trigger time) and signed in Xaman. The trigger's job is the
          // nudge; the alert + push below carry the prefill.
          runStatus = 'triggered';
          runNotes = `${runNotes ?? 'trigger fired'} — savings escrow suggested`;
          cooldownService.markBroadcast(rule.id, now);
          void PushNotificationService.getInstance()
            .sendToUser(rule.wallet.userId, {
              type: 'SAVINGS_READY',
              title: `Automation: ${rule.name} — idle XRP detected`,
              body: `${evalResult.reason ?? 'trigger fired'} — set it aside from the Savings surface (you sign in Xaman).`,
              url: '/app/savings',
              data: {
                ruleId: rule.id,
                trigger: trigger.type,
                params: ruleAction.params ?? {},
              },
            })
            .catch((err: Error) => console.warn('[automation] push failed:', err.message));
        } else if (ruleAction.kind && ruleAction.protocolId) {
          try {
            const intent = await IntentEngine.getInstance().createIntent({
              walletAddress: rule.wallet.address,
              chainId,
              sessionId: `automation:${rule.id}`,
              protocolId: ruleAction.protocolId,
              actionKind: ruleAction.kind,
              positionId: ruleAction.positionId,
              params: ruleAction.params ?? {},
              source: 'automation',
              ruleId: rule.id,
              ruleCooldownMinutes: rule.cooldownMinutes ?? undefined,
            });
            intentId = intent.id;
            runStatus = 'intent_prepared';
            // V1.1 in-memory cooldown — mirrors the DB-level lastTriggeredAt
            // update below, but lets PolicyGuard short-circuit subsequent
            // ticks without paying a DB round-trip.
            cooldownService.markBroadcast(rule.id, now);
          } catch (err) {
            runStatus = 'error';
            runNotes = `intent_prepare_failed: ${(err as Error).message}`;
          }
        }

        // Create AutomationRun
        let runId: string | undefined;
        try {
          const run = await prisma.automationRun.create({
            data: {
              ruleId: rule.id,
              intentId,
              triggeredAt: now,
              triggerData: (evalResult.data ?? {}) as object,
              status: runStatus,
              notes: runNotes ?? undefined,
            },
          });
          runId = run.id;
        } catch (err) {
          console.warn('[automation] AutomationRun create failed:', (err as Error).message);
        }

        // Create Alert (best-effort)
        try {
          await prisma.alert.create({
            data: {
              userId: rule.wallet.userId,
              walletId: rule.wallet.id,
              type: trigger.type,
              priority:
                runStatus === 'error'
                  ? 'LOW'
                  : trigger.type === 'HF_CRITICAL' || trigger.type === 'HF_BELOW'
                    ? 'CRITICAL'
                    : 'MEDIUM',
              severity: trigger.type === 'HF_CRITICAL' ? 'CRITICAL' : 'HIGH',
              triggerType: trigger.type,
              title: `Automation: ${rule.name}`,
              message: runNotes ?? 'trigger fired',
              data: (evalResult.data ?? {}) as object,
              automationRunId: runId,
            },
          });
        } catch (err) {
          console.warn('[automation] alert create failed:', (err as Error).message);
        }

        // Notify the user to review + sign. The intent is prepared-only; the
        // user signs in their wallet (EVM for A2 compound, Xaman Payment for A1
        // repay). Astryum never signs. STOP after push.
        if (runStatus === 'intent_prepared' && intentId) {
          void PushNotificationService.getInstance()
            .sendToUser(rule.wallet.userId, {
              type: 'INTENT_READY',
              title: `Automation: ${rule.name} — action ready`,
              body: `${runNotes ?? 'trigger fired'} — review and sign in your wallet.`,
              url: '/app/intents',
              data: { intentId, ruleId: rule.id, trigger: trigger.type },
            })
            .catch((err: Error) =>
              console.warn('[automation] push failed:', err.message),
            );
        }

        // Update rule cooldown. "Éxito no ganado" guard (instancia #1): a fired
        // trigger whose action ERRORED is not a successful run — stamp the
        // cooldown (it did fire) but do NOT inflate totalTimesTriggered, which
        // the MoneyFlows / Movements / Legacy surfaces read verbatim as
        // "fired ×N" / "N nudges". Counting errors there is the disease.
        try {
          await prisma.automationRule.update({
            where: { id: rule.id },
            data: {
              lastTriggeredAt: now,
              ...(runStatus === 'error' ? {} : { totalTimesTriggered: { increment: 1 } }),
            },
          });
        } catch {
          /* ignore */
        }
      }
    }

    return { ruleCount: rules.length, firedCount };
  }

  /**
   * Intent Reminder Engine — prepareFlowNode()
   *
   * MoneyFlows are scheduled opportunity preparations, NOT autonomous executions.
   * Every scheduled node:
   *   1. Prepares a NEW IntentPayload (no reuse)
   *   2. Creates a NEW IntentAuthorizationSession (single-use, expiring)
   *   3. Notifies the user to review
   *   4. STOPS — never authorizes automatically, never relays
   *
   * No signature reuse. No standing approvals. No background execution.
   */
  async prepareFlowNode(
    node: FlowNode,
    context: {
      userId: string;
      walletAddress: string;
      chainId?: number;
      sessionId: string;
      ruleId?: string;
      flowId?: string;
    },
  ): Promise<{
    intentPayload: Awaited<ReturnType<typeof intentPreparationEngine.prepare>>;
    authorizationSessionId: string;
  }> {
    const chainId = context.chainId ?? 14;

    // 1. Prepare a new IntentPayload (no reuse of any prior payload)
    const intentPayload = await intentPreparationEngine.prepare(node.type, {
      walletAddress: context.walletAddress,
      chainId,
      sessionId: context.sessionId,
      ...node.params,
    });

    // 2. Create a new IntentAuthorizationSession (single-use, 5-minute expiry)
    const session = await regulatedRelayBoundary.createAuthorizationSession({
      userId: context.userId,
      intentPayload,
    });

    // 3. Notify the user — they must review before authorizing
    void PushNotificationService.getInstance()
      .sendToUser(context.userId, {
        type: 'INTENT_READY',
        title: 'Prepared opportunity awaiting your review',
        body: `${intentPayload.metadata.description} — review before authorizing.`,
        url: '/app/intents',
        data: {
          intentId: intentPayload.intentId,
          sessionId: session.id,
          nodeType: node.type,
          flowId: context.flowId,
          ruleId: context.ruleId,
        },
      })
      .catch((err: Error) =>
        console.warn('[automation] push notification failed:', err.message),
      );

    // 4. Audit log
    try {
      await prisma.auditLog.create({
        data: {
          userId: context.userId,
          action: 'flow:prepareFlowNode',
          resource: intentPayload.intentId,
          newValues: {
            nodeType: node.type,
            flowId: context.flowId,
            ruleId: context.ruleId,
            sessionId: session.id,
            walletAddress: context.walletAddress,
            attributionBps: intentPayload.referralAttribution.attributionBps,
            referralWallet: intentPayload.referralAttribution.referralWallet,
          },
        },
      });
    } catch (err) {
      console.warn('[automation] audit log failed:', (err as Error).message);
    }

    // 5. STOP — no auto-authorize, no relay, no execution
    return { intentPayload, authorizationSessionId: session.id };
  }
}

import { z } from 'zod';
import { PortfolioEngine } from '../engines/portfolio/PortfolioEngine';
import { RiskEngine } from '../engines/risk/RiskEngine';
import { SimulationEngine } from '../engines/simulation/SimulationEngine';
import { StrategyEngine } from '../engines/strategy/StrategyEngine';
import { IntentEngine } from '../engines/intent/IntentEngine';
import { prisma } from '../database/prismaClient';

const STALE_TIMESTAMP_MS = 90 * 1000;

/**
 * Structured AI response (Zod-validated).
 *
 * 2026-06-01 audit Cat 4.1 — MiCA framing:
 *   The previous `recommendations` field was framed as advice and risked
 *   classification under MiCA Article 3(1)(16)(8) "providing advice on
 *   crypto-assets". It has been renamed to `signals` — informational context
 *   the user MAY consider, not a recommendation that they SHOULD act on.
 *   The legacy field name is kept as an alias for backward compatibility but
 *   carries the same content with the same disclaimer.
 */
const SignalEntrySchema = z.object({
  kind: z.string(),
  protocolId: z.string().optional(),
  asset: z.string().optional(),
  amountUSD: z.number().optional(),
  reason: z.string(),
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  simulationResultId: z.string().optional(),
});

export const AIResponseSchema = z.object({
  summary: z.string(),
  riskAssessment: z
    .object({
      level: z.string(),
      score: z.number(),
      drivers: z.array(z.object({ name: z.string(), contribution: z.number() })),
      explanation: z.string(),
    })
    .optional(),
  /** Contextual signals (informational, not advice — see disclaimer field). */
  signals: z.array(SignalEntrySchema).optional(),
  /** @deprecated alias for `signals` — kept for old consumers, will be removed. */
  recommendations: z.array(SignalEntrySchema).optional(),
  confidence: z.number().min(0).max(1),
  dataTimestamp: z.string(),
  warnings: z.array(z.string()),
  /**
   * MiCA-compliant disclaimer. Always populated. Frontend MUST render this
   * verbatim alongside any user-facing AI output.
   */
  disclaimer: z.string(),
});

export type AIResponse = z.infer<typeof AIResponseSchema>;

const MICA_DISCLAIMER =
  'Astryum AI provides informational context only. This is not investment ' +
  'advice under MiCA Article 3(1)(16)(8). Signals reflect deterministic ' +
  'computations over your portfolio data — they do not constitute a ' +
  'recommendation to buy, sell, or hold any crypto-asset.';

/**
 * AI Copilot V1 — deterministic templates over engine outputs.
 *
 * No external LLM call in V1. Template responses use:
 *   - PortfolioEngine snapshot
 *   - RiskEngine evaluation
 *   - StrategyEngine recommendations
 *   - IntentEngine for intent detail
 *
 * If `ANTHROPIC_API_KEY` is available a future iteration can swap the templates
 * for tool-calling chat. Until then, output is structured + validated.
 */
export class AICopilot {
  private static instance: AICopilot | null = null;
  static getInstance(): AICopilot {
    if (!this.instance) this.instance = new AICopilot();
    return this.instance;
  }

  async explainRisk(walletAddress: string, chainId: number = 14): Promise<AIResponse> {
    const portfolio = await PortfolioEngine.getInstance().getPortfolio(walletAddress, chainId);
    const risk = RiskEngine.getInstance().evaluateSnapshot(portfolio);
    const warnings: string[] = [];
    const ageMs = Date.now() - portfolio.takenAt.getTime();
    if (ageMs > STALE_TIMESTAMP_MS) {
      warnings.push(`portfolio data ${Math.round(ageMs / 1000)}s old`);
    }

    const drivers = risk.drivers.length
      ? risk.drivers
          .map((d) => `${d.name} (${(d.contribution * 100).toFixed(0)}%)`)
          .join(', ')
      : 'none';

    const explanation = [
      `Portfolio total: $${portfolio.totalUSD.toFixed(2)}.`,
      `Net worth: $${portfolio.netWorthUSD.toFixed(2)}.`,
      risk.healthFactor !== undefined
        ? `Worst HF: ${risk.healthFactor.toFixed(2)}.`
        : 'No lending positions detected.',
      risk.ltv !== undefined
        ? `Aggregate LTV: ${(risk.ltv * 100).toFixed(0)}%.`
        : '',
      `Risk score ${risk.riskScore}/100 → ${risk.riskLevel}.`,
      `Drivers: ${drivers}.`,
      ...risk.warnings,
    ]
      .filter(Boolean)
      .join(' ');

    const summary =
      risk.riskLevel === 'SAFE'
        ? 'Portfolio in safe range; no defensive action needed.'
        : risk.riskLevel === 'WATCH'
          ? 'Portfolio is healthy but worth monitoring.'
          : risk.riskLevel === 'WARNING'
            ? 'Portfolio shows warning-level risk; consider defensive actions.'
            : risk.riskLevel === 'DANGER'
              ? 'Portfolio is in danger; act soon to reduce risk.'
              : 'Portfolio at CRITICAL risk; immediate action required.';

    const response: AIResponse = {
      summary,
      riskAssessment: {
        level: risk.riskLevel,
        score: risk.riskScore,
        drivers: risk.drivers,
        explanation,
      },
      confidence: 0.85,
      dataTimestamp: portfolio.takenAt.toISOString(),
      warnings,
      disclaimer: MICA_DISCLAIMER,
    };

    return AIResponseSchema.parse(response);
  }

  /**
   * Return deterministic CONTEXTUAL SIGNALS detected against the user's
   * portfolio — never framed as recommendations or advice.
   *
   * 2026-06-01 audit Cat 4.1: renamed from `recommendActions` to comply with
   * MiCA Article 3(1)(16)(8). The legacy method name is kept as a thin alias
   * for callers that haven't migrated yet.
   */
  async getContextualSignals(walletAddress: string, chainId: number = 14): Promise<AIResponse> {
    const recs = await StrategyEngine.getInstance().detectDefensiveSignals(walletAddress, chainId);
    const portfolio = await PortfolioEngine.getInstance().getPortfolio(walletAddress, chainId);
    const warnings: string[] = [];
    const ageMs = Date.now() - portfolio.takenAt.getTime();
    if (ageMs > STALE_TIMESTAMP_MS) {
      warnings.push(`portfolio data ${Math.round(ageMs / 1000)}s old`);
    }

    const top = recs[0];
    // Framing: "detected" / "signals" — never "recommend" / "should".
    const summary =
      top?.kind === 'noAction'
        ? 'No defensive signals detected at this time.'
        : `${recs.length} contextual signal(s) detected; highest priority: ${top.kind} (${top.priority}).`;

    const signals = recs.map((r) => ({
      kind: r.kind,
      protocolId: r.protocolId,
      asset: r.asset,
      amountUSD: r.amountUSD,
      reason: r.reason,
      priority: r.priority,
    }));

    return AIResponseSchema.parse({
      summary,
      signals,
      // Legacy alias for any frontend that hasn't migrated yet — same payload.
      recommendations: signals,
      confidence: 0.75,
      dataTimestamp: portfolio.takenAt.toISOString(),
      warnings,
      disclaimer: MICA_DISCLAIMER,
    });
  }

  /** @deprecated renamed to `getContextualSignals` (2026-06-01 audit Cat 4.1). */
  async recommendActions(walletAddress: string, chainId: number = 14): Promise<AIResponse> {
    return this.getContextualSignals(walletAddress, chainId);
  }

  async explainIntent(intentId: string): Promise<AIResponse> {
    const intent = await IntentEngine.getInstance().getIntent(intentId);
    if (!intent) {
      return AIResponseSchema.parse({
        summary: `Intent ${intentId} not found.`,
        confidence: 0,
        dataTimestamp: new Date().toISOString(),
        warnings: ['intent_not_found'],
        disclaimer: MICA_DISCLAIMER,
      });
    }
    const impact = (intent.impact as Record<string, unknown>) ?? {};
    const sim = (intent.simulation as Record<string, unknown>) ?? {};
    const lines = [
      `Action: ${intent.action} on ${intent.protocolId}.`,
      impact.newHF !== undefined
        ? `Resulting HF ≈ ${Number(impact.newHF).toFixed(2)}.`
        : '',
      impact.newLTV !== undefined
        ? `Resulting LTV ≈ ${(Number(impact.newLTV) * 100).toFixed(0)}%.`
        : '',
      impact.gasEstimateUSD !== undefined
        ? `Gas ≈ $${Number(impact.gasEstimateUSD).toFixed(2)}.`
        : '',
      `Status: ${intent.status}; expires ${intent.expiresAt.toISOString()}.`,
      ...(intent.warnings ?? []),
    ].filter(Boolean);

    void sim; // reserved for future detailed render

    return AIResponseSchema.parse({
      summary: intent.explanation || lines[0],
      confidence: 0.9,
      dataTimestamp: intent.simulatedAt.toISOString(),
      warnings: intent.warnings ?? [],
      disclaimer: MICA_DISCLAIMER,
    });
  }

  /**
   * Free-form chat. V1: dispatches to explainRisk/getContextualSignals/explainIntent
   * based on heuristic keyword match. Returns explicit "no LLM" notice if nothing matches.
   */
  async chat(walletAddress: string, message: string, chainId: number = 14): Promise<AIResponse> {
    const m = message.toLowerCase();
    if (/intent\s+([a-z0-9-]+)/i.test(message)) {
      const id = (message.match(/intent\s+([a-z0-9-]+)/i) || [])[1];
      if (id) return this.explainIntent(id);
    }
    if (/(risk|liquid|hf|health|safe)/.test(m)) {
      return this.explainRisk(walletAddress, chainId);
    }
    if (/(signal|what.*do|protect|defens|context)/.test(m)) {
      return this.getContextualSignals(walletAddress, chainId);
    }
    if (/(simulate|drop|crash|down)/.test(m)) {
      const dropMatch = message.match(/(\d+)\s*%/);
      const dropPct = dropMatch ? Math.min(99, parseInt(dropMatch[1], 10)) : 20;
      const result = await SimulationEngine.getInstance().simulateMarketDrop(
        walletAddress,
        dropPct,
        chainId
      );
      return AIResponseSchema.parse({
        summary: `If the market drops ${dropPct}%, portfolio risk goes from score ${result.before.riskScore} (${result.before.riskLevel}) to ${result.after.riskScore} (${result.after.riskLevel}).`,
        confidence: 0.7,
        dataTimestamp: result.computedAt.toISOString(),
        warnings: result.after.warnings,
        disclaimer: MICA_DISCLAIMER,
      });
    }

    return AIResponseSchema.parse({
      summary:
        'V1 Copilot does not yet support free-form chat. Try "explain my risk", "what signals do you detect", "what if FLR drops 20%", or "explain intent <id>".',
      confidence: 0.3,
      dataTimestamp: new Date().toISOString(),
      warnings: ['llm-not-wired-in-v1'],
      disclaimer: MICA_DISCLAIMER,
    });
  }
}

void prisma;

/**
 * GoalParserService
 *
 * Converts natural-language goal text into a structured GoalRequest payload.
 * Uses the Anthropic SDK with tool_use to guarantee a parseable JSON output.
 * Falls back to a sensible default if the AI call fails so the UX never blocks.
 */

import Anthropic from '@anthropic-ai/sdk';
import { agentKeyService } from './AgentKeyService';

export interface ParsedGoal {
  targetMonthlyUSD: number;
  riskTolerance: 'low' | 'medium' | 'high';
  timeHorizon: 'indefinite' | '6_months' | '1_year' | '3_years' | '5_years';
  summary: string;
}

const GOAL_TOOL: Anthropic.Tool = {
  name: 'parse_goal',
  description: 'Extract a structured financial goal from the user\'s natural language input.',
  input_schema: {
    type: 'object' as const,
    properties: {
      targetMonthlyUSD: {
        type: 'number',
        description: 'Target monthly income in USD. If the user stated a yearly figure, divide by 12. If unclear, use 500.',
      },
      riskTolerance: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Risk tolerance inferred from the text. Prefer "low" if unsure.',
      },
      timeHorizon: {
        type: 'string',
        enum: ['indefinite', '6_months', '1_year', '3_years', '5_years'],
        description: 'Investment horizon. Use "indefinite" if the user did not specify.',
      },
      summary: {
        type: 'string',
        description: 'One-sentence plain-language summary of the goal for display.',
      },
    },
    required: ['targetMonthlyUSD', 'riskTolerance', 'timeHorizon', 'summary'],
  },
};

class GoalParserService {
  async parse(rawText: string, userId: string): Promise<ParsedGoal> {
    let apiKey: string;
    let model: string;
    try {
      const res = await agentKeyService.resolveKey(userId);
      apiKey = res.key;
      model = res.model;
    } catch {
      // Fall back to env key if user has no key configured
      apiKey = process.env.ANTHROPIC_API_KEY ?? '';
      model = 'claude-haiku-4-5-20251001';
    }

    if (!apiKey) {
      return this._defaultGoal(rawText);
    }

    try {
      const client = new Anthropic({ apiKey });
      const resp = await client.messages.create({
        model,
        max_tokens: 512,
        system: [
          'You are a financial goal interpreter for Astryum.',
          'Extract a structured financial goal from the user\'s text.',
          'Always call the parse_goal tool — never respond with plain text.',
          'Be conservative: when risk or horizon is ambiguous, choose the safer option.',
        ].join(' '),
        messages: [{ role: 'user', content: rawText }],
        tools: [GOAL_TOOL],
        tool_choice: { type: 'auto' },
      });

      const toolUse = resp.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (toolUse && toolUse.name === 'parse_goal') {
        const inp = toolUse.input as ParsedGoal;
        return {
          targetMonthlyUSD: Number(inp.targetMonthlyUSD) || 500,
          riskTolerance: inp.riskTolerance ?? 'low',
          timeHorizon: inp.timeHorizon ?? 'indefinite',
          summary: inp.summary ?? rawText.slice(0, 120),
        };
      }
    } catch (err) {
      console.warn('[GoalParserService] AI call failed, using default:', (err as Error).message);
    }

    return this._defaultGoal(rawText);
  }

  private _defaultGoal(rawText: string): ParsedGoal {
    // Heuristic fallback: look for numbers like "1000", "€1,000", "$500"
    const amountMatch = rawText.match(/[\$€£]?\s*(\d[\d,.]+)/);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 500;
    const lower = rawText.toLowerCase();
    const risk = lower.includes('aggress') || lower.includes('alto riesgo') || lower.includes('high risk')
      ? 'high'
      : lower.includes('moderate') || lower.includes('medio')
        ? 'medium'
        : 'low';

    return {
      targetMonthlyUSD: amount,
      riskTolerance: risk,
      timeHorizon: 'indefinite',
      summary: rawText.slice(0, 120),
    };
  }
}

export const goalParserService = new GoalParserService();

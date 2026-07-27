export type GuardDecision = 'allow' | 'block';

export interface GuardResult {
  decision: GuardDecision;
  blockedReason?: string;
  // When blocked, this safe fallback message replaces the AI response
  safeFallback?: string;
}

// Patterns that classify a response as blocked investment advice or auto-execution
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\b(you should (buy|sell|hold|swap|invest))\b/i,
    reason: 'recommend_buy_sell_hold',
  },
  {
    pattern: /\b(best (protocol|yield|apr|apy|pool|strategy|investment))\b/i,
    reason: 'rank_protocols_as_best',
  },
  {
    pattern: /\b(i recommend (buying|selling|holding|swapping|investing))\b/i,
    reason: 'recommend_buy_sell_hold',
  },
  {
    pattern: /\b(guaranteed (return|yield|profit|income))\b/i,
    reason: 'investment_guarantee',
  },
  {
    pattern: /\b(auto[- ]?(open|create|start|execute|run|trigger))\b/i,
    reason: 'auto_create_partner_session',
  },
  {
    pattern: /\b(i (will|am going to|shall) (execute|submit|broadcast|send|sign))\b/i,
    reason: 'auto_trigger_execution',
  },
  {
    pattern: /\b(optimis(e|ing|ize|izing) your portfolio)\b/i,
    reason: 'optimize_portfolio_allocation',
  },
  {
    pattern: /\b(maximize (your )?(yield|returns|profit))\b/i,
    reason: 'optimize_portfolio_allocation',
  },
];

// Patterns that are explicitly allowed (override block if matched)
const ALLOWED_INTENTS = [
  'explain_user_data',
  'summarize_positions',
  'explain_risk_metrics',
  'draft_rule_after_user_request',
  'prepare_intent_draft_after_explicit_confirmation',
];

const SAFE_FALLBACK =
  'I can help you understand your current Astryum data — positions, interactions, trigger rules, and tax events. ' +
  'I cannot give investment advice or execute transactions. What would you like to know about your data?';

/**
 * AIResponseGuardService
 *
 * Classifies AI responses before sending to the frontend.
 * Blocks investment advice, auto-execution language, and portfolio optimization claims.
 * Allows explanatory, read-only, and user-initiated drafting responses.
 */
export class AIResponseGuardService {
  inspect(responseText: string): GuardResult {
    for (const { pattern, reason } of BLOCKED_PATTERNS) {
      if (pattern.test(responseText)) {
        return {
          decision: 'block',
          blockedReason: reason,
          safeFallback: SAFE_FALLBACK,
        };
      }
    }
    return { decision: 'allow' };
  }

  /**
   * Filter a response: returns either the original text (if allowed) or
   * the safe fallback message (if blocked). Logs the block reason.
   */
  filter(responseText: string): string {
    const result = this.inspect(responseText);
    if (result.decision === 'block') {
      return result.safeFallback ?? SAFE_FALLBACK;
    }
    return responseText;
  }

  getAllowedIntents(): string[] {
    return [...ALLOWED_INTENTS];
  }
}

export const aiResponseGuardService = new AIResponseGuardService();

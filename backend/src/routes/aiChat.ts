import { Router, Request, Response } from 'express';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { safeErrorDetail } from '../utils/safeError';
import { aiContextService } from '../services/AIContextService';
import { aiResponseGuardService } from '../services/AIResponseGuardService';

const router = Router();
router.use(requireSiweAuth);

const SYSTEM_PROMPT = `You are the Astryum assistant. You help users understand their crypto portfolio data.

STRICT RULES — you must follow these without exception:
1. You ONLY discuss the user's actual Astryum data provided in the context.
2. You NEVER give investment advice, buy/sell/hold recommendations, or yield optimization suggestions.
3. You NEVER claim to execute transactions, sign anything, or automate actions.
4. You NEVER recommend specific protocols as "best" or "safest".
5. You NEVER make claims about guaranteed returns.
6. You answer questions about data: positions, interactions, trigger rules, tax events, capital summary.
7. If asked about investment decisions, say: "I can only help you understand your data. For financial advice, consult a qualified professional."
8. Always acknowledge data is estimated and sourced from indexers (not directly on-chain verified unless stated).`;

/**
 * POST /api/ai/chat
 * AI assistant with real user context. Never gives investment advice.
 * Uses Anthropic API if ANTHROPIC_API_KEY is set; returns template response otherwise.
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    const userId = req.siwe!.userId;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'MISSING_MESSAGE' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: 'MESSAGE_TOO_LONG', maxLength: 2000 });
    }

    // Build real user context + generate a guarded response.
    const { response: safeResponse, contextBuiltAt } = await generateAiChatResponse(userId, message);

    return res.json({
      response: safeResponse,
      contextBuiltAt,
      source: {
        providerId: 'astryum-ai',
        trustLevel: 'aggregator',
        fetchedAt: new Date().toISOString(),
      },
      disclaimer:
        'Astryum AI does not give investment advice. ' +
        'Data sourced from indexers — verify on-chain before acting.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'AI_CHAT_FAILED', detail: safeErrorDetail(err) });
  }
});

/**
 * GET /api/ai/context
 * Return the AI context snapshot for the authenticated user (for debugging/transparency).
 */
router.get('/context', async (req: Request, res: Response) => {
  try {
    const userId = req.siwe!.userId;
    const context = await aiContextService.buildContext(userId);
    return res.json({
      context,
      note: 'This is the real user context provided to the AI assistant.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'AI_CONTEXT_FAILED', detail: safeErrorDetail(err) });
  }
});

/**
 * Build the real user context and return a guarded assistant response.
 * Shared by the HTTP route and the authenticated WebSocket `ai_chat` channel so
 * both speak to the real assistant — there is no mock/echo path.
 */
export async function generateAiChatResponse(
  userId: string,
  message: string,
): Promise<{ response: string; contextBuiltAt: string }> {
  const context = await aiContextService.buildContext(userId);

  const rawResponse = process.env.ANTHROPIC_API_KEY
    ? await _callAnthropic(message, context, userId)
    : _templateResponse(message, context);

  return {
    response: aiResponseGuardService.filter(rawResponse),
    contextBuiltAt: (context as any).contextBuiltAt,
  };
}

async function _callAnthropic(
  message: string,
  context: object,
  _userId: string,
): Promise<string> {
  // Dynamic require so the server starts normally even without the @anthropic-ai/sdk package.
  // If the package is absent at runtime, we fall back to the template response gracefully.
  let Anthropic: any;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    return _templateResponse(message, context);
  }

  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  const contextJson = JSON.stringify(context, null, 2);

  const response = await client.messages.create({
    model: process.env.AI_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `User context:\n${contextJson}\n\nUser question: ${message}`,
      },
    ],
  });

  const block = response.content?.[0];
  if (block?.type === 'text') return block.text;
  return _templateResponse(message, context);
}

function _templateResponse(message: string, context: any): string {
  const lowerMsg = message.toLowerCase();
  const summary = context.capitalSummary ?? {};

  if (lowerMsg.includes('position') || lowerMsg.includes('portfolio')) {
    const count = summary.totalPositions ?? 0;
    const value = summary.estimatedTotalValueUSD ?? 0;
    return (
      `You have ${count} detected DeFi position(s) across ${summary.totalWallets ?? 0} watched wallet(s), ` +
      `with an estimated total value of $${value.toFixed(2)} USD. ` +
      `These are estimates from indexer data — verify on-chain before acting.`
    );
  }

  if (lowerMsg.includes('interact') || lowerMsg.includes('history')) {
    const count = summary.totalInteractions ?? 0;
    return `Astryum has detected ${count} historical DeFi interaction(s) across your watched wallets.`;
  }

  if (lowerMsg.includes('rule') || lowerMsg.includes('trigger')) {
    const count = context.triggerRules?.length ?? 0;
    return `You have ${count} trigger rule(s) configured. Trigger rules send notifications only — they never auto-execute transactions.`;
  }

  if (lowerMsg.includes('tax')) {
    const count = context.recentTaxEvents?.length ?? 0;
    return (
      `Astryum has recorded ${count} recent tax event(s) for your account. ` +
      `You can export them from /api/tax/export/csv or /api/tax/export/json. ` +
      `Astryum does not calculate taxes — this is raw data for your accountant.`
    );
  }

  return (
    `I can see your Astryum data: ${summary.totalWallets ?? 0} watched wallet(s), ` +
    `${summary.totalPositions ?? 0} DeFi position(s), ` +
    `${summary.totalInteractions ?? 0} interactions. ` +
    `Ask me about your positions, interactions, trigger rules, or tax events.`
  );
}

export default router;

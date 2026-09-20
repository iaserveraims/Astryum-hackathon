/**
 * /api/agent — AI Agent routes
 *
 * P-AGENT-1: chat (SSE streaming), conversations CRUD, settings
 * P-AGENT-2: MCP catalog/connect/disconnect, document upload/list/delete
 * P-AGENT-3: agent rules CRUD + manual trigger
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { asyncHandler } from '../middleware/asyncHandler';
import { prisma } from '../database/prismaClient';
import { agentKeyService } from '../services/AgentKeyService';
import { agentContextBuilder } from '../services/AgentContextBuilder';
import { MCP_CATALOG, getCatalogEntry } from '../config/mcpCatalog';
import { PushNotificationService } from '../services/PushNotificationService';
import {
  isSessionRevoked,
  isTransactionBusy,
  respondBusyRetry,
  respondSessionRevoked,
  withLiveSession,
  type LiveSessionRef,
} from '../services/identity/liveSession';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getUserId(req: Request): string {
  return (req as any).siwe?.userId ?? 'dev-user';
}

/** The session a write must still be able to prove (identity/liveSession). */
function sessionRef(req: Request): LiveSessionRef | undefined {
  return (req as any).siwe as LiveSessionRef | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// P-AGENT-1: CHAT — POST /api/agent/chat  (Server-Sent Events streaming)
// ─────────────────────────────────────────────────────────────────────────────

const ChatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().optional(),
});

// Wrapped whole: the conversation/message/context awaits BEFORE the SSE
// section have no try/catch — a rejection there must reach the error
// middleware instead of hanging the client.
router.post('/chat', asyncHandler(async (req: Request, res: Response) => {
  const parse = ChatBodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }

  const userId = getUserId(req);
  const { message, conversationId: maybeConvId } = parse.data;

  // Get or create conversation. A conversation id from the body must be THIS
  // user's: unscoped, the message below was appended to a stranger's history
  // (and the reply built from it), which is both a leak and an injection into
  // someone else's copilot. Same scoping the builder now applies to the history.
  let convId = maybeConvId;
  if (convId) {
    const owned = await prisma.agentConversation.findFirst({
      where: { id: convId, userId },
      select: { id: true },
    });
    if (!owned) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
  }
  if (!convId) {
    const conv = await prisma.agentConversation.create({
      data: {
        userId,
        title: message.slice(0, 60),
        updatedAt: new Date(),
      },
    });
    convId = conv.id;
  }

  // Persist user message
  await prisma.agentMessage.create({
    data: { conversationId: convId, role: 'user', content: message },
  });

  // Build context
  const ctx = await agentContextBuilder.build(userId, convId);

  // Resolve API key
  let keyRes: { key: string; source: 'user' | 'astryum'; model: string };
  try {
    keyRes = await agentKeyService.resolveKey(userId);
  } catch (err: any) {
    res.status(402).json({ error: 'NO_API_KEY', message: err.message });
    return;
  }

  // Build system prompt
  const systemParts: string[] = [
    'You are the Astryum AI Agent — a financial assistant for DeFi portfolio management.',
    'You help users understand their portfolio, analyze risk, and build strategies.',
    'You NEVER give investment advice, price predictions, or recommendations to buy/sell.',
    'You NEVER auto-execute transactions or propose on-chain actions spontaneously.',
    'Always be factual, clear, and concise. Cite your data sources.',
  ];

  if (ctx.internalContext) {
    systemParts.push('\n--- USER PORTFOLIO CONTEXT ---\n' + ctx.internalContext);
  }

  if (ctx.documents.length) {
    const docSummary = ctx.documents
      .map((d) => `[${d.filename}]: ${d.content.slice(0, 500)}`)
      .join('\n');
    systemParts.push('\n--- USER DOCUMENTS ---\n' + docSummary);
  }

  if (ctx.mcpServers.length) {
    const mcpList = ctx.mcpServers.map((m) => `${m.serverName} (tools: ${m.tools.join(', ')})`).join('; ');
    systemParts.push(`\n--- CONNECTED MCP SERVERS ---\n${mcpList}`);
  }

  const systemPrompt = systemParts.join('\n');

  // Build messages array from history
  const historyMessages: Anthropic.MessageParam[] = ctx.history
    .slice(-18) // last 18 messages (leave room for current)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  // Add current user message
  historyMessages.push({ role: 'user', content: message });

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Conversation-Id', convId);
  res.flushHeaders();

  const client = new Anthropic({ apiKey: keyRes.key });
  let fullResponse = '';

  try {
    const stream = client.messages.stream({
      model: keyRes.model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: historyMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const chunk = event.delta.text;
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: 'delta', text: chunk, conversationId: convId })}\n\n`);
      }
    }

    // Persist assistant message
    await prisma.agentMessage.create({
      data: { conversationId: convId, role: 'assistant', content: fullResponse },
    });

    // Update conversation timestamp
    await prisma.agentConversation.update({
      where: { id: convId },
      data: { updatedAt: new Date() },
    });

    res.write(`data: ${JSON.stringify({ type: 'done', conversationId: convId })}\n\n`);
  } catch (err: any) {
    const msg = err?.message ?? 'LLM error';
    res.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
  } finally {
    res.end();
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// P-AGENT-1: CONVERSATIONS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/agent/conversations
router.get('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const convs = await prisma.agentConversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  res.json({ conversations: convs });
}));

// GET /api/agent/conversations/:id
router.get('/conversations/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const conv = await prisma.agentConversation.findFirst({
    where: { id: req.params.id, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conv) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  res.json(conv);
}));

// DELETE /api/agent/conversations/:id
router.delete('/conversations/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const conv = await prisma.agentConversation.findFirst({ where: { id: req.params.id, userId } });
  if (!conv) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  await prisma.agentConversation.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// P-AGENT-1: SETTINGS (API key + model)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/agent/settings
router.get('/settings', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const keyRecord = await agentKeyService.getUserKeyRecord(userId);
  const mcpConns = await prisma.userMCPConnection.findMany({
    where: { userId },
    select: { serverId: true, serverName: true, isActive: true, connectedAt: true },
  });
  res.json({
    apiKey: keyRecord
      ? { model: keyRecord.model, addedAt: keyRecord.addedAt, lastUsedAt: keyRecord.lastUsedAt, hasKey: true }
      : { hasKey: false },
    mcpConnections: mcpConns,
  });
}));

// PUT /api/agent/settings  — save/update Anthropic API key + model
router.put('/settings', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const schema = z.object({
    apiKey: z.string().min(10).optional(),
    model: z.enum(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7']).optional(),
    removeKey: z.boolean().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }

  const { apiKey, model, removeKey } = parse.data;

  if (removeKey) {
    await agentKeyService.deleteUserKey(userId);
    res.json({ removed: true });
    return;
  }

  if (apiKey) {
    const validation = await agentKeyService.validateKey(apiKey);
    if (!validation.valid) {
      res.status(422).json({ error: 'INVALID_API_KEY', message: validation.error });
      return;
    }
    // The key decides whose Anthropic account the copilot's prompts go to, and
    // `validateKey` above is a network round-trip — the widest window a takeover
    // has to slip a key onto the owner. Live-session check inside the write
    // (4.1).
    try {
      await agentKeyService.saveUserAPIKey(userId, apiKey, model, sessionRef(req));
    } catch (err) {
      if (isSessionRevoked(err)) {
        respondSessionRevoked(res);
        return;
      }
      // Contention with the takeover's long transaction is a WAIT, not a fault:
      // 503 «try again» (3.6), never a 500 that reads as «we broke».
      if (isTransactionBusy(err)) {
        respondBusyRetry(res);
        return;
      }
      throw err;
    }
    res.json({ saved: true, model: model ?? 'claude-sonnet-4-6' });
    return;
  }

  if (model) {
    const rec = await prisma.userAnthropicKey.findUnique({ where: { userId } });
    if (rec) {
      await prisma.userAnthropicKey.update({ where: { userId }, data: { model } });
    }
    res.json({ updated: true, model });
    return;
  }

  res.status(400).json({ error: 'NOTHING_TO_UPDATE' });
}));

// ─────────────────────────────────────────────────────────────────────────────
// P-AGENT-2: MCP CATALOG + CONNECTIONS
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/agent/mcp/catalog
router.get('/mcp/catalog', (_req: Request, res: Response) => {
  res.json({ catalog: MCP_CATALOG });
});

// POST /api/agent/mcp/connect
router.post('/mcp/connect', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const schema = z.object({
    serverId: z.string().min(1),
    apiKey: z.string().optional(),
    serverUrl: z.string().url().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }

  const { serverId, apiKey, serverUrl } = parse.data;
  const entry = getCatalogEntry(serverId);
  const serverName = entry?.name ?? serverId;

  let apiKeyEnc: string | undefined;
  if (apiKey) {
    apiKeyEnc = agentKeyService.encryptValue(apiKey);
  }

  // A custom `serverUrl` + key decides where the owner's context is sent: a
  // connection attached by a previous holder after a takeover would forward it
  // to their server. Live-session check inside the write (4.4).
  let conn;
  try {
    conn = await withLiveSession(sessionRef(req), (tx) =>
      tx.userMCPConnection.upsert({
        where: { userId_serverId: { userId, serverId } },
        create: { userId, serverId, serverName, serverUrl, apiKeyEnc, isActive: true },
        update: { serverUrl, apiKeyEnc, isActive: true, connectedAt: new Date() },
      }),
    );
  } catch (err) {
    if (isSessionRevoked(err)) {
      respondSessionRevoked(res);
      return;
    }
    // Contention with the takeover's long transaction is a WAIT, not a fault:
    // 503 «try again» (3.6), never a 500 that reads as «we broke».
    if (isTransactionBusy(err)) {
      respondBusyRetry(res);
      return;
    }
    throw err;
  }

  res.json({ connected: true, serverId: conn.serverId, serverName: conn.serverName });
}));

// DELETE /api/agent/mcp/:serverId
router.delete('/mcp/:serverId', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const { serverId } = req.params;
  await prisma.userMCPConnection.deleteMany({ where: { userId, serverId } });
  res.json({ disconnected: true, serverId });
}));

// ─────────────────────────────────────────────────────────────────────────────
// P-AGENT-2: DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DOC_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ['text/plain', 'text/markdown', 'application/json'];

// POST /api/agent/documents/upload
// Accepts raw text body. For PDF we'd use a multipart upload — keeping text-first for now.
router.post('/documents/upload', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const schema = z.object({
    filename: z.string().min(1).max(255),
    contentType: z.enum(['pdf', 'txt', 'md', 'json']),
    content: z.string().min(1).max(MAX_DOC_BYTES),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }

  const { filename, contentType, content } = parse.data;
  const sizeBytes = Buffer.byteLength(content, 'utf8');

  // A document is authority: AgentContextBuilder pastes it into the copilot's
  // system prompt. One uploaded by a previous account holder whose request lands
  // after a takeover would speak to the owner in their own assistant, so the
  // session is re-proved inside the write (4.4).
  let doc;
  try {
    doc = await withLiveSession(sessionRef(req), (tx) =>
      tx.agentDocument.create({
        data: { userId, filename, contentType, content, sizeBytes, source: 'user_upload' },
      }),
    );
  } catch (err) {
    if (isSessionRevoked(err)) {
      respondSessionRevoked(res);
      return;
    }
    // Contention with the takeover's long transaction is a WAIT, not a fault:
    // 503 «try again» (3.6), never a 500 that reads as «we broke».
    if (isTransactionBusy(err)) {
      respondBusyRetry(res);
      return;
    }
    throw err;
  }

  res.json({ id: doc.id, filename: doc.filename, sizeBytes: doc.sizeBytes, uploadedAt: doc.uploadedAt });
}));

// GET /api/agent/documents
router.get('/documents', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const docs = await prisma.agentDocument.findMany({
    where: { userId },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, filename: true, contentType: true, sizeBytes: true, source: true, uploadedAt: true },
  });
  res.json({ documents: docs });
}));

// DELETE /api/agent/documents/:id
router.delete('/documents/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const doc = await prisma.agentDocument.findFirst({ where: { id: req.params.id, userId } });
  if (!doc) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  await prisma.agentDocument.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
}));

// ─────────────────────────────────────────────────────────────────────────────
// P-AGENT-3: AGENT RULES CRUD
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGER_TYPES = ['schedule', 'app_open', 'price_threshold', 'portfolio_change', 'market_event', 'manual'] as const;

const RuleCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  triggerType: z.enum(TRIGGER_TYPES),
  triggerConfig: z.record(z.unknown()),
  prompt: z.string().min(1).max(4000),
  outputChannel: z.enum(['chat', 'notification', 'both']).default('both'),
  mcpServersReq: z.array(z.string()).default([]),
});

// GET /api/agent/rules
router.get('/rules', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const rules = await prisma.agentRule.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ rules });
}));

// POST /api/agent/rules
router.post('/rules', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const parse = RuleCreateSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }

  const { triggerConfig, ...rest } = parse.data;
  // Same rule as documents: a rule is a prompt the agent will run for whoever
  // holds the account. Written only while this session is still live.
  let rule;
  try {
    rule = await withLiveSession(sessionRef(req), (tx) =>
      (tx.agentRule as any).create({ data: { userId, ...rest, triggerConfig } }),
    );
  } catch (err) {
    if (isSessionRevoked(err)) {
      respondSessionRevoked(res);
      return;
    }
    // Contention with the takeover's long transaction is a WAIT, not a fault:
    // 503 «try again» (3.6), never a 500 that reads as «we broke».
    if (isTransactionBusy(err)) {
      respondBusyRetry(res);
      return;
    }
    throw err;
  }
  res.status(201).json(rule);
}));

// PUT /api/agent/rules/:id
router.put('/rules/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const existing = await prisma.agentRule.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }

  const schema = RuleCreateSchema.partial().extend({ isActive: z.boolean().optional() });
  const parse = schema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'INVALID_BODY', details: parse.error.flatten() });
    return;
  }

  const { triggerConfig: tc, ...restData } = parse.data;
  const updated = await prisma.agentRule.update({
    where: { id: req.params.id },
    data: { ...restData, ...(tc !== undefined ? { triggerConfig: tc as any } : {}) },
  });
  res.json(updated);
}));

// DELETE /api/agent/rules/:id
router.delete('/rules/:id', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const existing = await prisma.agentRule.findFirst({ where: { id: req.params.id, userId } });
  if (!existing) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  await prisma.agentRule.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
}));

// POST /api/agent/rules/:id/trigger  — manual trigger
router.post('/rules/:id/trigger', asyncHandler(async (req: Request, res: Response) => {
  const userId = getUserId(req);
  const rule = await prisma.agentRule.findFirst({ where: { id: req.params.id, userId } });
  if (!rule) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }

  // Create a fresh conversation for this rule execution
  const conv = await prisma.agentConversation.create({
    data: { userId, title: `[Rule] ${rule.name}`, updatedAt: new Date() },
  });

  // Persist the rule's prompt as a user message
  await prisma.agentMessage.create({
    data: { conversationId: conv.id, role: 'user', content: rule.prompt },
  });

  // Update lastTriggeredAt
  await prisma.agentRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });

  // Run the agent (non-streaming for rule execution — collect full response)
  let responseText = '';
  try {
    const keyRes = await agentKeyService.resolveKey(userId);
    const ctx = await agentContextBuilder.build(userId, conv.id);

    const systemPrompt = [
      'You are the Astryum AI Agent executing an automated rule.',
      'Be concise and factual. No investment advice.',
      ctx.internalContext ? '\n--- PORTFOLIO CONTEXT ---\n' + ctx.internalContext : '',
    ].join('\n');

    const client = new Anthropic({ apiKey: keyRes.key });
    const msg = await client.messages.create({
      model: keyRes.model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: rule.prompt }],
    });

    responseText = (msg.content[0] as any).text ?? '';
    await prisma.agentMessage.create({
      data: { conversationId: conv.id, role: 'assistant', content: responseText },
    });
  } catch (err: any) {
    responseText = `Error executing rule: ${err.message}`;
  }

  // Send push notification if rule has notification output
  if (rule.outputChannel === 'notification' || rule.outputChannel === 'both') {
    try {
      const pushSvc = PushNotificationService.getInstance();
      await pushSvc.sendToUser(userId, {
        type: 'INTENT_READY',
        title: `Rule: ${rule.name}`,
        body: responseText.slice(0, 200),
        data: { ruleId: rule.id, conversationId: conv.id },
      });
    } catch {
      // Non-blocking
    }
  }

  res.json({ triggered: true, conversationId: conv.id, response: responseText });
}));

export default router;

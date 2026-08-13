import { prisma } from '../database/prismaClient';
import { agentKeyService } from './AgentKeyService';
import { getCatalogEntry } from '../config/mcpCatalog';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ActiveMCPServer {
  serverId: string;
  serverName: string;
  tools: string[];
}

export interface AgentContext {
  history: ConversationMessage[];
  internalContext: string | null;   // NormalizedAIUserContext (<800 tokens)
  documents: Array<{ id: string; filename: string; contentType: string; content: string }>;
  mcpServers: ActiveMCPServer[];
  rules: Array<{ id: string; name: string; triggerType: string; isActive: boolean }>;
  keySource: 'user' | 'astryum';
  model: string;
}

export class AgentContextBuilder {
  private static instance: AgentContextBuilder;
  static getInstance(): AgentContextBuilder {
    if (!this.instance) this.instance = new AgentContextBuilder();
    return this.instance;
  }

  async build(userId: string, conversationId: string): Promise<AgentContext> {
    const [history, documents, mcpConnections, rules, keyRes] = await Promise.all([
      this.getHistory(conversationId, 20),
      this.getDocuments(userId),
      this.getMCPServers(userId),
      this.getRules(userId),
      agentKeyService.resolveKey(userId).catch(() => null),
    ]);

    const internalContext = await this.buildInternalContext(userId);

    return {
      history,
      internalContext,
      documents,
      mcpServers: mcpConnections,
      rules,
      keySource: keyRes?.source ?? 'astryum',
      model: keyRes?.model ?? 'claude-haiku-4-5-20251001',
    };
  }

  private async getHistory(conversationId: string, limit: number): Promise<ConversationMessage[]> {
    const msgs = await prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { role: true, content: true },
    });
    return msgs as ConversationMessage[];
  }

  private async getDocuments(userId: string) {
    return prisma.agentDocument.findMany({
      where: { userId },
      orderBy: { uploadedAt: 'desc' },
      take: 10,
      select: { id: true, filename: true, contentType: true, content: true },
    });
  }

  private async getMCPServers(userId: string): Promise<ActiveMCPServer[]> {
    const conns = await prisma.userMCPConnection.findMany({
      where: { userId, isActive: true },
      select: { serverId: true, serverName: true },
    });
    return conns.map((c) => {
      const entry = getCatalogEntry(c.serverId);
      return {
        serverId: c.serverId,
        serverName: c.serverName,
        tools: entry?.tools ?? [],
      };
    });
  }

  private async getRules(userId: string) {
    return prisma.agentRule.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, triggerType: true, isActive: true },
    });
  }

  /**
   * Builds a compact NormalizedAIUserContext (<800 tokens).
   * Includes: portfolio summary, risk overview, active alerts, active rules count.
   * Returns null if no data is available.
   */
  private async buildInternalContext(userId: string): Promise<string | null> {
    try {
      // Get wallet bindings for this user
      const bindings = await prisma.walletBinding.findMany({
        where: { userId, isActive: true },
        select: { address: true, chainType: true, mode: true },
      });
      if (!bindings.length) return null;

      // Get latest positions from Capital Map
      const positions = await prisma.position.findMany({
        where: { wallet: { address: { in: bindings.map((b) => b.address) } } },
        orderBy: { updatedAt: 'desc' },
        take: 30,
        select: {
          protocolId: true,
          amountUSD: true,
          chainId: true,
          updatedAt: true,
        },
      });

      // Get active alerts
      const alerts = await prisma.alert.findMany({
        where: { acknowledged: false },
        orderBy: { timestamp: 'desc' },
        take: 5,
        select: { message: true, priority: true, timestamp: true },
      });

      // Active rules count
      const rulesCount = await prisma.agentRule.count({ where: { userId, isActive: true } });

      // Build compact summary
      const totalUSD = positions.reduce((s, p) => s + (Number(p.amountUSD) || 0), 0);
      const byProtocol: Record<string, number> = {};
      for (const p of positions) {
        if (p.protocolId) byProtocol[p.protocolId] = (byProtocol[p.protocolId] ?? 0) + (Number(p.amountUSD) || 0);
      }

      const topProtocols = Object.entries(byProtocol)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, usd]) => `${name}: $${usd.toFixed(0)}`)
        .join(', ');

      const alertSummary = alerts.length
        ? alerts.map((a) => `[${a.priority}] ${a.message}`).join('; ')
        : 'No active alerts';

      const context = [
        `PORTFOLIO SUMMARY (as of ${new Date().toISOString()}):`,
        `  Total value: $${totalUSD.toFixed(2)}`,
        `  Wallets: ${bindings.length} (${bindings.map((b) => b.address.slice(0, 8) + '...').join(', ')})`,
        `  Positions: ${positions.length}`,
        `  Top protocols: ${topProtocols || 'none'}`,
        `ALERTS: ${alertSummary}`,
        `AGENT RULES ACTIVE: ${rulesCount}`,
      ].join('\n');

      return context;
    } catch {
      return null;
    }
  }
}

export const agentContextBuilder = AgentContextBuilder.getInstance();

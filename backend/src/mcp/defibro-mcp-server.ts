#!/usr/bin/env node
/**
 * Defibro MCP Server (V1) — JSON-RPC 2.0 over stdio.
 *
 * Self-contained: no @modelcontextprotocol/sdk dependency. Implements:
 *   initialize, tools/list, tools/call
 *
 * Exposes V1 tools per CLAUDE.md §11 + V1 prompt B12. Tools that PREPARE
 * intents are exposed; tools that SIGN/SUBMIT are NOT (R6 — MCP cannot
 * broadcast).
 *
 * Run: `npm run mcp:dev` (ts-node) or `node dist/mcp/defibro-mcp-server.js`.
 * Register: `claude mcp add defibro -- node ./backend/dist/mcp/defibro-mcp-server.js`
 */

import { PortfolioEngine } from '../engines/portfolio/PortfolioEngine';
import { RiskEngine } from '../engines/risk/RiskEngine';
import { SimulationEngine } from '../engines/simulation/SimulationEngine';
import { StrategyEngine } from '../engines/strategy/StrategyEngine';
import { IntentEngine } from '../engines/intent/IntentEngine';
import { AICopilot } from '../services/AICopilot';
import { PositionPerformanceService } from '../services/PositionPerformanceService';
import { prisma } from '../database/prismaClient';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  handler: (args: Record<string, any>) => Promise<unknown>;
}

function asAddress(v: unknown): string {
  if (typeof v !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(v)) {
    throw new Error('walletAddress must be a 0x-prefixed 40-char hex string');
  }
  return v;
}

const TOOLS: ToolDef[] = [
  // ---------- LECTURA ----------
  {
    name: 'get_user_portfolio',
    description: 'Returns aggregated portfolio snapshot for a wallet on Flare',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        chainId: { type: 'integer', default: 14 },
      },
    },
    handler: async (a) =>
      PortfolioEngine.getInstance().getPortfolio(asAddress(a.walletAddress), a.chainId ?? 14),
  },
  {
    name: 'get_portfolio_breakdown',
    description: 'Per-protocol/per-asset/per-kind breakdown',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        chainId: { type: 'integer', default: 14 },
      },
    },
    handler: async (a) =>
      PortfolioEngine.getInstance().getBreakdown(asAddress(a.walletAddress), a.chainId ?? 14),
  },
  {
    name: 'get_positions',
    description: 'Raw positions list across active adapters',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        chainId: { type: 'integer', default: 14 },
      },
    },
    handler: async (a) => {
      const snapshot = await PortfolioEngine.getInstance().getPortfolio(
        asAddress(a.walletAddress),
        a.chainId ?? 14
      );
      return snapshot.positions;
    },
  },
  {
    name: 'get_alerts',
    description: 'Alerts for a wallet (optionally only unread)',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        unreadOnly: { type: 'boolean', default: false },
      },
    },
    handler: async (a) => {
      const wallets = await prisma.wallet.findMany({
        where: { address: asAddress(a.walletAddress) },
        select: { id: true },
      });
      const walletIds = wallets.map((w) => w.id);
      return prisma.alert.findMany({
        where: {
          walletId: { in: walletIds },
          ...(a.unreadOnly ? { acknowledged: false } : {}),
        },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
    },
  },
  {
    name: 'get_rules',
    description: 'Automation rules for a wallet',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: { walletAddress: { type: 'string' } },
    },
    handler: async (a) => {
      const wallets = await prisma.wallet.findMany({
        where: { address: asAddress(a.walletAddress) },
        select: { id: true },
      });
      return prisma.automationRule.findMany({
        where: { walletId: { in: wallets.map((w) => w.id) } },
        orderBy: { createdAt: 'desc' },
      });
    },
  },

  // ---------- RIESGO ----------
  {
    name: 'get_portfolio_risk',
    description: 'Portfolio-level RiskSnapshot (HF, LTV, score, drivers)',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        chainId: { type: 'integer', default: 14 },
      },
    },
    handler: async (a) =>
      RiskEngine.getInstance().getPortfolioRisk(asAddress(a.walletAddress), a.chainId ?? 14),
  },
  {
    name: 'simulate_market_drop',
    description: 'Stress test: shock asset(s) down by N% and recompute risk',
    inputSchema: {
      type: 'object',
      required: ['walletAddress', 'dropPct'],
      properties: {
        walletAddress: { type: 'string' },
        chainId: { type: 'integer', default: 14 },
        dropPct: { type: 'number' },
        asset: { type: 'string' },
      },
    },
    handler: async (a) =>
      RiskEngine.getInstance().simulateMarketDrop(
        asAddress(a.walletAddress),
        a.chainId ?? 14,
        Number(a.dropPct),
        a.asset
      ),
  },
  {
    name: 'simulate_repay',
    description: 'Simulate repaying a debt position. Returns SimulationResult with id.',
    inputSchema: {
      type: 'object',
      required: ['walletAddress', 'protocolId', 'params'],
      properties: {
        walletAddress: { type: 'string' },
        protocolId: { type: 'string' },
        positionId: { type: 'string' },
        params: { type: 'object' },
      },
    },
    handler: async (a) =>
      SimulationEngine.getInstance().simulateRepay({
        walletAddress: asAddress(a.walletAddress),
        protocolId: a.protocolId,
        positionId: a.positionId,
        params: a.params,
      }),
  },
  {
    name: 'simulate_add_collateral',
    description: 'Simulate adding collateral. Returns SimulationResult with id.',
    inputSchema: {
      type: 'object',
      required: ['walletAddress', 'protocolId', 'params'],
      properties: {
        walletAddress: { type: 'string' },
        protocolId: { type: 'string' },
        positionId: { type: 'string' },
        params: { type: 'object' },
      },
    },
    handler: async (a) =>
      SimulationEngine.getInstance().simulateAddCollateral({
        walletAddress: asAddress(a.walletAddress),
        protocolId: a.protocolId,
        positionId: a.positionId,
        params: a.params,
      }),
  },

  // ---------- STRATEGY ----------
  {
    name: 'detect_defensive_signals',
    description:
      'Deterministic defensive signals computed from the portfolio. Informational only — NOT investment advice under MiCA Article 3(1)(16)(8).',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        chainId: { type: 'integer', default: 14 },
      },
    },
    handler: async (a) =>
      StrategyEngine.getInstance().detectDefensiveSignals(asAddress(a.walletAddress), a.chainId ?? 14),
  },

  // ---------- AI ----------
  {
    name: 'explain_risk',
    description: 'AI Copilot summary of current portfolio risk',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        chainId: { type: 'integer', default: 14 },
      },
    },
    handler: async (a) =>
      AICopilot.getInstance().explainRisk(asAddress(a.walletAddress), a.chainId ?? 14),
  },

  // ---------- V2 TOOLS (portfolio performance, strategies, flows, pending sigs) ----------
  {
    name: 'get_position_performance',
    description: 'Returns performance data for a specific position (APY at entry vs current, PnL USD)',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: {
        walletAddress: { type: 'string' },
        positionId: { type: 'string' },
      },
    },
    handler: async (a) => {
      const where: any = { wallet: { address: asAddress(a.walletAddress) } };
      if (a.positionId) where.id = a.positionId;
      const positions = await prisma.position.findMany({ where, take: 20, orderBy: { updatedAt: 'desc' } });
      return Promise.all(
        positions.map(async (p) => ({
          id: p.id,
          protocolId: p.protocolId,
          kind: p.kind,
          amountUSD: p.amountUSD,
          chainId: p.chainId,
          updatedAt: p.updatedAt,
          // Real net P&L + debt growth from PositionSnapshot history (C2).
          // Honest empty-state until the position has >= 2 snapshots.
          performance: await PositionPerformanceService.compute(p.id),
        })),
      );
    },
  },
  {
    name: 'get_strategies',
    description: 'Returns user strategies (name, description, active MoneyFlows count)',
    inputSchema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string' } },
    },
    handler: async (a) => {
      return prisma.automationRule.findMany({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    },
  },
  {
    name: 'get_moneyflows',
    description: 'Returns active MoneyFlows (triggers, node types, last run)',
    inputSchema: {
      type: 'object',
      properties: { activeOnly: { type: 'boolean', default: true } },
    },
    handler: async (_a) => {
      return prisma.automationRule.findMany({
        where: { enabled: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    },
  },
  {
    name: 'get_pending_signatures',
    description: 'Returns TransactionIntents that are pending user signature',
    inputSchema: {
      type: 'object',
      required: ['walletAddress'],
      properties: { walletAddress: { type: 'string' } },
    },
    handler: async (a) => {
      return prisma.transactionIntent.findMany({
        where: { owner: asAddress(a.walletAddress), status: 'proposed' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
    },
  },
  {
    name: 'create_moneyflow_draft',
    description: 'Returns a JSON draft of a MoneyFlow config from natural language. User must validate before activating.',
    inputSchema: {
      type: 'object',
      required: ['description'],
      properties: {
        description: { type: 'string' },
        walletAddress: { type: 'string' },
      },
    },
    handler: async (a) => {
      // Returns a structured draft — does NOT create anything. User validates via UI.
      return {
        draft: true,
        description: a.description,
        suggestedConfig: {
          triggerType: 'manual',
          triggerConfig: {},
          actions: [],
          note: 'Review and configure trigger + actions in the MoneyFlows builder before activating.',
        },
        message: 'Draft created. Open /app/flows to configure and activate.',
      };
    },
  },
  {
    name: 'create_strategy_draft',
    description: 'Returns a JSON draft of a Strategy config from natural language. User must validate before saving.',
    inputSchema: {
      type: 'object',
      required: ['description'],
      properties: {
        description: { type: 'string' },
        name: { type: 'string' },
      },
    },
    handler: async (a) => {
      return {
        draft: true,
        name: a.name ?? 'New Strategy',
        description: a.description,
        suggestedConfig: {
          positionAssignments: [],
          note: 'Review and assign positions in the Strategy builder before saving.',
        },
        message: 'Draft created. Open /app/strategies to configure and save.',
      };
    },
  },

  // ---------- PREPARATION (creates intent, does NOT broadcast) ----------
  {
    name: 'prepare_repay',
    description:
      'Create READY_TO_SIGN TransactionIntent for repaying. User signs in wallet. MCP NEVER broadcasts.',
    inputSchema: {
      type: 'object',
      required: ['walletAddress', 'sessionId', 'protocolId', 'params'],
      properties: {
        walletAddress: { type: 'string' },
        sessionId: { type: 'string' },
        protocolId: { type: 'string' },
        positionId: { type: 'string' },
        params: { type: 'object' },
      },
    },
    handler: async (a) =>
      IntentEngine.getInstance().createIntent({
        walletAddress: asAddress(a.walletAddress),
        sessionId: a.sessionId,
        protocolId: a.protocolId,
        actionKind: 'repay',
        positionId: a.positionId,
        params: a.params,
        source: 'ai',
      }),
  },
  {
    name: 'prepare_add_collateral',
    description: 'Create READY_TO_SIGN intent for adding collateral. User signs.',
    inputSchema: {
      type: 'object',
      required: ['walletAddress', 'sessionId', 'protocolId', 'params'],
      properties: {
        walletAddress: { type: 'string' },
        sessionId: { type: 'string' },
        protocolId: { type: 'string' },
        positionId: { type: 'string' },
        params: { type: 'object' },
      },
    },
    handler: async (a) =>
      IntentEngine.getInstance().createIntent({
        walletAddress: asAddress(a.walletAddress),
        sessionId: a.sessionId,
        protocolId: a.protocolId,
        actionKind: 'addCollateral',
        positionId: a.positionId,
        params: a.params,
        source: 'ai',
      }),
  },
];

const TOOLS_INDEX = new Map(TOOLS.map((t) => [t.name, t]));

function send(resp: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(resp) + '\n');
}

async function handle(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'defibro-mcp', version: '1.0.0' },
          capabilities: { tools: {} },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        },
      };

    case 'tools/call': {
      const name = (req.params?.name as string) ?? '';
      const args = ((req.params?.arguments as Record<string, unknown>) ?? {}) as Record<string, any>;
      const tool = TOOLS_INDEX.get(name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `tool_not_found: ${name}` },
        };
      }
      try {
        const result = await tool.handler(args);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  result,
                  (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
                  2
                ),
              },
            ],
          },
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `method_not_found: ${req.method}` },
      };
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line);
    } catch {
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'parse_error' },
      });
      continue;
    }
    handle(req)
      .then(send)
      .catch((err) =>
        send({
          jsonrpc: '2.0',
          id: req.id ?? null,
          error: {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          },
        })
      );
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// eslint-disable-next-line no-console
process.stderr.write('[defibro-mcp] ready (stdio)\n');

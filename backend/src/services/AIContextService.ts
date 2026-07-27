import { prisma } from '../database/prismaClient';

export interface AIUserContext {
  userId: string;
  wallets: Array<{
    address: string;
    chainId: number;
    label: string | null;
    lastSyncedAt: string | null;
  }>;
  defiPositions: Array<{
    chainId: number;
    protocol: string;
    contractType: string;
    asset: string;
    valueUSD: string;
    confidenceLevel: string;
    riskLevel: string | null;
  }>;
  recentInteractions: Array<{
    chainId: number;
    protocol: string;
    interactionType: string;
    confidenceLevel: string;
    lastSeenAt: string;
  }>;
  triggerRules: Array<{
    id: string;
    name: string;
    conditionType: string;
    enabled: boolean;
  }>;
  recentTaxEvents: Array<{
    eventType: string;
    assetOut: string;
    amountOut: string;
    source: string;
    timestamp: string;
  }>;
  capitalSummary: {
    totalWallets: number;
    totalPositions: number;
    totalInteractions: number;
    estimatedTotalValueUSD: number;
  };
  contextBuiltAt: string;
  // Privacy note: no private keys, no session tokens, no raw wallet credentials
}

/**
 * AIContextService
 *
 * Builds a structured, read-only context snapshot of a user's Astryum data
 * to enrich AI assistant responses with real user data.
 *
 * NEVER includes: private keys, session tokens, raw wallet credentials,
 * webhook secrets, API keys, or any other sensitive credentials.
 */
export class AIContextService {
  async buildContext(userId: string): Promise<AIUserContext> {
    const [wallets, positions, interactions, triggerRules, taxEvents] = await Promise.all([
      prisma.walletWatchlist.findMany({
        where: { userId, isActive: true },
        select: { address: true, chainId: true, label: true, lastSyncedAt: true },
        take: 20,
      }),
      prisma.deFiPosition.findMany({
        where: {
          watchlist: { userId },
          confidenceLevel: { not: 'unknown' },
        },
        select: {
          chainId: true,
          protocol: true,
          contractType: true,
          asset: true,
          valueUSD: true,
          confidenceLevel: true,
          riskLevel: true,
        },
        orderBy: { valueUSD: 'desc' },
        take: 30,
      }),
      prisma.deFiInteraction.findMany({
        where: { watchlist: { userId } },
        select: {
          chainId: true,
          protocol: true,
          interactionType: true,
          confidenceLevel: true,
          lastSeenAt: true,
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 20,
      }),
      prisma.triggerRule.findMany({
        where: { userId },
        select: { id: true, name: true, conditionType: true, enabled: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.taxEvent.findMany({
        where: { userId },
        select: { eventType: true, assetOut: true, amountOut: true, source: true, timestamp: true },
        orderBy: { timestamp: 'desc' },
        take: 10,
      }),
    ]);

    const totalValueUSD = positions.reduce((sum, p) => sum + Number(p.valueUSD), 0);

    return {
      userId,
      wallets: wallets.map((w) => ({
        address: w.address,
        chainId: w.chainId,
        label: w.label,
        lastSyncedAt: w.lastSyncedAt?.toISOString() ?? null,
      })),
      defiPositions: positions.map((p) => ({
        chainId: p.chainId,
        protocol: p.protocol,
        contractType: p.contractType,
        asset: p.asset,
        valueUSD: String(p.valueUSD),
        confidenceLevel: p.confidenceLevel,
        riskLevel: p.riskLevel,
      })),
      recentInteractions: interactions.map((i) => ({
        chainId: i.chainId,
        protocol: i.protocol,
        interactionType: i.interactionType,
        confidenceLevel: i.confidenceLevel,
        lastSeenAt: i.lastSeenAt.toISOString(),
      })),
      triggerRules: triggerRules.map((r) => ({
        id: r.id,
        name: r.name,
        conditionType: r.conditionType,
        enabled: r.enabled,
      })),
      recentTaxEvents: taxEvents.map((e) => ({
        eventType: e.eventType,
        assetOut: e.assetOut,
        amountOut: String(e.amountOut),
        source: e.source,
        timestamp: e.timestamp.toISOString(),
      })),
      capitalSummary: {
        totalWallets: wallets.length,
        totalPositions: positions.length,
        totalInteractions: interactions.length,
        estimatedTotalValueUSD: totalValueUSD,
      },
      contextBuiltAt: new Date().toISOString(),
    };
  }
}

export const aiContextService = new AIContextService();

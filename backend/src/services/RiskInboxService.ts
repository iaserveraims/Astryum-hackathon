import { prisma } from '../database/prismaClient';

/**
 * RiskInboxService — D8 Risk Inbox, backed by the existing Alert model (no migration).
 *
 * A risk item is an Alert the user must triage. When the fix is an on-chain action
 * (e.g. revoke a risky allowance), the UNSIGNED intent rides in `data.reviewAndSign`
 * so the UI can offer "Review & Sign" — the user signs it themselves. Astryum never
 * signs and never auto-resolves.
 */

export type RiskItemType = 'security' | 'protocol_risk' | 'liquidation' | 'approval_risk' | 'bridge_risk';
export type RiskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AddRiskItemInput {
  userId: string;
  walletId?: string;
  type: RiskItemType;
  priority: RiskPriority;
  title: string;
  message: string;
  /** Unsigned intent the user can sign to resolve (e.g. { to, calldata, value }). */
  reviewAndSign?: { to: string; calldata: string; value?: string; kind?: string };
  data?: Record<string, unknown>;
}

export class RiskInboxService {
  async add(input: AddRiskItemInput): Promise<{ id: string }> {
    const row = await prisma.alert.create({
      data: {
        userId: input.userId,
        walletId: input.walletId,
        type: input.type,
        priority: input.priority,
        title: input.title,
        message: input.message,
        acknowledged: false,
        data: {
          source: 'risk_inbox',
          ...(input.reviewAndSign ? { reviewAndSign: input.reviewAndSign } : {}),
          ...(input.data ?? {}),
        },
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  /** Open (unacknowledged) risk items for a user, highest priority first. */
  async list(userId: string): Promise<unknown[]> {
    return prisma.alert.findMany({
      where: { userId, acknowledged: false, type: { in: ['security', 'protocol_risk', 'liquidation', 'approval_risk', 'bridge_risk'] } },
      orderBy: [{ priority: 'asc' }, { timestamp: 'desc' }],
      take: 100,
    });
  }

  /** Acknowledge (dismiss/resolve) a risk item — ownership-scoped. */
  async acknowledge(id: string, userId: string): Promise<boolean> {
    const res = await prisma.alert.updateMany({
      where: { id, userId },
      data: { acknowledged: true },
    });
    return res.count > 0;
  }
}

export const riskInboxService = new RiskInboxService();

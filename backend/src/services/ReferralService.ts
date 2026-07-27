import { prisma } from '../database/prismaClient';

const PAYOUT_PCT = Number(process.env.REFERRAL_PAYOUT_PCT ?? '10');    // % of platform fee
const PAYOUT_MONTHS = Number(process.env.REFERRAL_PAYOUT_MONTHS ?? '6');

function generateCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export type ConversionStage = 'registered' | 'goal_created' | 'delegation_accepted' | 'first_yield';

export interface ReferralStats {
  code: string;
  referralUrl: string;
  clickCount: number;
  conversions: {
    total: number;
    registered: number;
    goalCreated: number;
    delegationAccepted: number;
    firstYield: number;
  };
  pendingPayoutUSD: number;
  totalPaidUSD: number;
}

export class ReferralService {
  /** Get or create a referral link for a manager. */
  async getOrCreateLink(managerId: string): Promise<{ code: string; referralUrl: string }> {
    let referral = await prisma.managerReferral.findUnique({ where: { managerId } });

    if (!referral) {
      let code = generateCode();
      // Retry on collision (extremely unlikely but safe)
      let attempts = 0;
      while (attempts < 5) {
        const existing = await prisma.managerReferral.findUnique({ where: { code } });
        if (!existing) break;
        code = generateCode();
        attempts++;
      }
      referral = await prisma.managerReferral.create({ data: { managerId, code } });
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://defibro.app';
    return { code: referral.code, referralUrl: `${baseUrl}/register?ref=${referral.code}` };
  }

  /** Record a click on the referral link (anonymous). */
  async recordClick(code: string): Promise<void> {
    await prisma.managerReferral.updateMany({
      where: { code },
      data: { clickCount: { increment: 1 } },
    });
  }

  /** Called on user registration with a referral code. */
  async trackRegistration(code: string, referredUserId: string): Promise<void> {
    const referral = await prisma.managerReferral.findUnique({ where: { code } });
    if (!referral) return;

    // Idempotent: skip if already tracked for this user
    const existing = await prisma.referralConversion.findUnique({ where: { referredUserId } });
    if (existing) return;

    await prisma.referralConversion.create({
      data: {
        referralId: referral.id,
        referredUserId,
        stage: 'registered',
      },
    });
  }

  /** Advance conversion stage for a referred user. */
  async advanceStage(
    referredUserId: string,
    stage: ConversionStage,
    extra?: { goalRequestId?: string; mandateId?: string },
  ): Promise<void> {
    const conversion = await prisma.referralConversion.findUnique({ where: { referredUserId } });
    if (!conversion) return;

    const stageOrder: ConversionStage[] = ['registered', 'goal_created', 'delegation_accepted', 'first_yield'];
    const currentIdx = stageOrder.indexOf(conversion.stage as ConversionStage);
    const newIdx = stageOrder.indexOf(stage);
    if (newIdx <= currentIdx) return; // only advance forward

    await prisma.referralConversion.update({
      where: { referredUserId },
      data: {
        stage,
        ...(extra?.goalRequestId && { goalRequestId: extra.goalRequestId }),
        ...(extra?.mandateId && { mandateId: extra.mandateId }),
      },
    });
  }

  /** Get referral stats for a manager. */
  async getStats(managerId: string): Promise<ReferralStats | null> {
    const referral = await prisma.managerReferral.findUnique({
      where: { managerId },
      include: { conversions: true },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://defibro.app';
    if (!referral) {
      return null;
    }

    const conv = referral.conversions;
    const pendingPayoutUSD = conv
      .filter((c) => c.payoutUSD && !c.paidAt)
      .reduce((sum, c) => sum + (c.payoutUSD ?? 0), 0);
    const totalPaidUSD = conv
      .filter((c) => c.paidAt)
      .reduce((sum, c) => sum + (c.payoutUSD ?? 0), 0);

    return {
      code: referral.code,
      referralUrl: `${baseUrl}/register?ref=${referral.code}`,
      clickCount: referral.clickCount,
      conversions: {
        total: conv.length,
        registered: conv.filter((c) => c.stage === 'registered').length,
        goalCreated: conv.filter((c) => c.stage === 'goal_created').length,
        delegationAccepted: conv.filter((c) => c.stage === 'delegation_accepted').length,
        firstYield: conv.filter((c) => c.stage === 'first_yield').length,
      },
      pendingPayoutUSD,
      totalPaidUSD,
    };
  }

  /** Calculate and record payout for a conversion that reached first_yield. */
  async recordYieldPayout(referredUserId: string, platformFeeUSD: number): Promise<void> {
    const conversion = await prisma.referralConversion.findUnique({ where: { referredUserId } });
    if (!conversion || conversion.paidAt) return;

    const payoutUSD = (platformFeeUSD * PAYOUT_PCT) / 100;

    await prisma.referralConversion.update({
      where: { referredUserId },
      data: {
        stage: 'first_yield',
        payoutUSD,
        paidAt: new Date(),
      },
    });
  }

  /** Admin: list all referrals with stats. */
  async adminListAll() {
    return prisma.managerReferral.findMany({
      include: { conversions: true, manager: { select: { userId: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  get payoutPct(): number { return PAYOUT_PCT; }
  get payoutMonths(): number { return PAYOUT_MONTHS; }
}

export const referralService = new ReferralService();

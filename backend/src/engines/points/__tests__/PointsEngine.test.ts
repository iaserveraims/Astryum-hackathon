// In-memory Prisma stub for points + ledger
jest.mock('../../../database/prismaClient', () => {
  type LedgerRow = {
    id: string;
    userId: string;
    eventType: string;
    pointsDelta: number;
    powerDelta: number;
    creditsDelta: number;
    reason: string;
    idempotencyKey: string;
    metadata: any;
    createdAt: Date;
  };
  let seq = 0;
  const ledger: LedgerRow[] = [];
  const accounts = new Map<string, any>();
  const badges: any[] = [];
  const userBadges: any[] = [];

  return {
    prisma: {
      pointsLedger: {
        findUnique: jest.fn(async ({ where }: any) =>
          ledger.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null
        ),
        count: jest.fn(async ({ where }: any) => {
          return ledger.filter((r) => {
            if (where.userId && r.userId !== where.userId) return false;
            if (where.eventType && r.eventType !== where.eventType) return false;
            if (where.createdAt?.gte && r.createdAt < where.createdAt.gte) return false;
            return true;
          }).length;
        }),
        create: jest.fn(async ({ data }: any) => {
          const row: LedgerRow = {
            id: `ledger-${++seq}`,
            createdAt: new Date(),
            metadata: data.metadata ?? null,
            ...data,
          };
          ledger.push(row);
          return row;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          ledger.filter((r) => r.userId === where.userId).reverse()
        ),
      },
      pointsAccount: {
        findUnique: jest.fn(async ({ where }: any) => accounts.get(where.userId) ?? null),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const existing = accounts.get(where.userId);
          if (!existing) {
            const fresh = { ...create };
            accounts.set(where.userId, fresh);
            return fresh;
          }
          const next = { ...existing };
          if (update.totalPoints?.increment) next.totalPoints = (next.totalPoints ?? 0) + update.totalPoints.increment;
          if (update.power?.increment) next.power = (next.power ?? 0) + update.power.increment;
          if (update.credits?.increment) next.credits = (next.credits ?? 0) + update.credits.increment;
          accounts.set(where.userId, next);
          return next;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const acc = accounts.get(where.userId);
          if (!acc) throw new Error('not found');
          const next = { ...acc };
          if (data.power?.decrement) next.power -= data.power.decrement;
          if (data.power?.increment) next.power += data.power.increment;
          if (data.credits?.increment) next.credits += data.credits.increment;
          if (typeof data.level === 'number') next.level = data.level;
          accounts.set(where.userId, next);
          return next;
        }),
      },
      gamificationBadge: { findMany: jest.fn(async () => badges) },
      userBadge: { findMany: jest.fn(async ({ where }: any) => userBadges.filter((b) => b.userId === where.userId)) },
      $transaction: jest.fn(async (fn: any) => {
        // Take the same prisma proxy as `tx` parameter
        const txProxy = require('../../../database/prismaClient').prisma;
        return fn(txProxy);
      }),
    },
  };
});

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_USE_MOCK_DATA;
});

describe('PointsEngine', () => {
  test('grant ONBOARDING_COMPLETED awards once (lifetime cap)', async () => {
    const { PointsEngine } = await import('../PointsEngine');
    const engine = PointsEngine.getInstance();

    const r1 = await engine.grant({
      userId: 'user-1',
      eventType: 'ONBOARDING_COMPLETED',
      idempotencyKey: 'onboarding:user-1',
    });
    expect(r1.granted).toBe(true);
    expect(r1.pointsDelta).toBe(100);

    const r2 = await engine.grant({
      userId: 'user-1',
      eventType: 'ONBOARDING_COMPLETED',
      idempotencyKey: 'onboarding:user-1:retry',
    });
    expect(r2.granted).toBe(false);
    expect(r2.reason).toBe('lifetime_used');
  });

  test('idempotencyKey blocks duplicate grants', async () => {
    const { PointsEngine } = await import('../PointsEngine');
    const engine = PointsEngine.getInstance();

    const r1 = await engine.grant({
      userId: 'user-2',
      eventType: 'TX_CONFIRMED',
      idempotencyKey: 'tx:0xdeadbeef',
    });
    expect(r1.granted).toBe(true);

    const r2 = await engine.grant({
      userId: 'user-2',
      eventType: 'TX_CONFIRMED',
      idempotencyKey: 'tx:0xdeadbeef',
    });
    expect(r2.granted).toBe(false);
    expect(r2.reason).toBe('duplicate');
  });

  test('daily cap on ALERT_REVIEWED (10/day)', async () => {
    const { PointsEngine } = await import('../PointsEngine');
    const engine = PointsEngine.getInstance();

    let granted = 0;
    for (let i = 0; i < 12; i++) {
      const r = await engine.grant({
        userId: 'user-3',
        eventType: 'ALERT_REVIEWED',
        idempotencyKey: `alert:user-3:${i}`,
      });
      if (r.granted) granted++;
    }
    expect(granted).toBe(10);
  });

  test('mock mode short-circuits grants', async () => {
    process.env.NEXT_PUBLIC_USE_MOCK_DATA = 'true';
    const { PointsEngine } = await import('../PointsEngine');
    const engine = PointsEngine.getInstance();
    const r = await engine.grant({
      userId: 'user-4',
      eventType: 'ONBOARDING_COMPLETED',
      idempotencyKey: 'mock:test',
    });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('mock_mode');
  });

  test('unknown event returns unknown_event', async () => {
    const { PointsEngine } = await import('../PointsEngine');
    const engine = PointsEngine.getInstance();
    const r = await engine.grant({
      userId: 'user-5',
      // @ts-expect-error testing runtime safety
      eventType: 'DOES_NOT_EXIST',
      idempotencyKey: 'bogus:1',
    });
    expect(r.granted).toBe(false);
    expect(r.reason).toBe('unknown_event');
  });
});

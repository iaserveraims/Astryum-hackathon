jest.mock('../../../database/prismaClient', () => {
  const intents = new Map<string, any>();
  let seq = 0;
  return {
    prisma: {
      transactionIntent: {
        findUnique: jest.fn(async ({ where }: any) => intents.get(where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const cur = intents.get(where.id);
          if (!cur) throw new Error('not_found');
          const updated = { ...cur, ...data };
          intents.set(where.id, updated);
          return updated;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          let rows = Array.from(intents.values());
          if (where.owner) rows = rows.filter((r) => r.owner === where.owner);
          if (where.status?.in) rows = rows.filter((r) => where.status.in.includes(r.status));
          return rows;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let count = 0;
          for (const id of where.id?.in ?? []) {
            const cur = intents.get(id);
            if (cur) {
              intents.set(id, { ...cur, ...data });
              count++;
            }
          }
          return { count };
        }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    __seedIntent(intent: any) {
      const id = intent.id ?? `intent-${++seq}`;
      intents.set(id, { id, ...intent });
      return id;
    },
  };
});

describe('IntentEngine FSM transitions', () => {
  test('proposed → SIGNED → SUBMITTED → CONFIRMED happy path', async () => {
    const mod = require('../../../database/prismaClient');
    const id = (mod as any).__seedIntent({
      status: 'proposed',
      owner: '0xowner',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const { IntentEngine } = await import('../IntentEngine');
    const engine = IntentEngine.getInstance();

    const a = await engine.transition(id, 'SIGNED');
    expect(a.status).toBe('signed');

    const b = await engine.transition(id, 'SUBMITTED', { txHash: '0xfeed' });
    expect(b.status).toBe('broadcast');
    expect(b.txHash).toBe('0xfeed');

    const c = await engine.transition(id, 'CONFIRMED', { blockNumber: 12345 });
    expect(c.status).toBe('confirmed');
    expect(c.confirmedAt).toBeInstanceOf(Date);
  });

  test('rejects invalid transition (proposed → CONFIRMED skips SIGNED+SUBMITTED)', async () => {
    const mod = require('../../../database/prismaClient');
    const id = (mod as any).__seedIntent({
      status: 'proposed',
      owner: '0xowner',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { IntentEngine } = await import('../IntentEngine');
    await expect(
      IntentEngine.getInstance().transition(id, 'CONFIRMED')
    ).rejects.toThrow(/invalid_transition/);
  });

  test('expireStaleIntents flips proposed past expiresAt to expired', async () => {
    const mod = require('../../../database/prismaClient');
    (mod as any).__seedIntent({
      id: 'fresh',
      status: 'proposed',
      owner: '0xa',
      expiresAt: new Date(Date.now() + 10_000),
    });
    (mod as any).__seedIntent({
      id: 'stale',
      status: 'proposed',
      owner: '0xa',
      expiresAt: new Date(Date.now() - 10_000),
    });

    // Need findMany to filter by expiresAt < now — adapt the mock
    mod.prisma.transactionIntent.findMany = jest.fn(async ({ where }: any) => {
      const all = ['fresh', 'stale']
        .map((id) => mod.prisma.transactionIntent.findUnique({ where: { id } }))
        .map((p) => p);
      const resolved = await Promise.all(all);
      return resolved.filter((r: any) =>
        r &&
        where.status?.in?.includes(r.status) &&
        r.expiresAt < where.expiresAt.lt
      );
    });

    const { IntentEngine } = await import('../IntentEngine');
    const expired = await IntentEngine.getInstance().expireStaleIntents();
    expect(expired).toBe(1);
  });
});

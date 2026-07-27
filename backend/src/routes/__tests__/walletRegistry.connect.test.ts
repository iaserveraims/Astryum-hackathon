/**
 * Regression: POST /api/wallets/connect — auto-primary vs the partial unique
 * index `wallets_one_primary_per_user_ecosystem` (ONE isPrimary=true per
 * userId+ecosystem, WHERE isPrimary).
 *
 * Bug (2026-07-11): the auto-primary gate counted wallets with purpose IN
 * (sign, both). Two watch-only wallets of the same ecosystem (e.g. two Xaman
 * addresses added from the tracker) therefore BOTH computed "first in
 * ecosystem" → both isPrimary=true → the second insert 500'd with
 * "Unique constraint failed on the fields: (userId, ecosystem)".
 *
 * The gate must mirror the index: grant primary only when no wallet of that
 * ecosystem is currently primary. Prisma is faked in-memory, including the
 * partial-unique behaviour, so this is hermetic.
 */
import express from 'express';
import request from 'supertest';

// ── In-memory prisma fake (only what /connect touches) ──────────────────────
interface Row {
  id: string;
  userId: string;
  walletType: string;
  address: string;
  network: string;
  chainId: number | null;
  caip2: string | null;
  nickname: string | null;
  isConnected: boolean;
  permissions: object;
  ecosystem: string;
  isPrimary: boolean;
  purpose: string;
}
const rows: Row[] = [];
let seq = 0;

const tx = {
  wallet: {
    findUnique: async ({ where }: any) => {
      const k = where.userId_address_network;
      return (
        rows.find(
          (r) => r.userId === k.userId && r.address === k.address && r.network === k.network,
        ) ?? null
      );
    },
    findMany: async ({ where }: any) =>
      rows
        .filter((r) => r.userId === where.userId && r.ecosystem === where.ecosystem)
        .map((r) => ({ nickname: r.nickname })),
    count: async ({ where }: any) =>
      rows.filter(
        (r) =>
          r.userId === where.userId &&
          r.ecosystem === where.ecosystem &&
          (where.isPrimary === undefined || r.isPrimary === where.isPrimary) &&
          (where.purpose === undefined || where.purpose.in.includes(r.purpose)),
      ).length,
    create: async ({ data }: any) => {
      // Enforce the PARTIAL unique index exactly like Postgres does.
      if (
        data.isPrimary &&
        rows.some(
          (r) => r.userId === data.userId && r.ecosystem === data.ecosystem && r.isPrimary,
        )
      ) {
        const err = new Error(
          'Unique constraint failed on the fields: (`userId`,`ecosystem`)',
        ) as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      const row: Row = { id: `w${++seq}`, chainId: null, caip2: null, nickname: null, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  },
  walletBinding: {
    findFirst: async () => null, // watch-only flows have no tx-binding
  },
};

const prismaFake = {
  $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  wallet: {
    // PATCH /mine/:id reads the row outside the transaction.
    findFirst: async ({ where }: any) => {
      const r = rows.find((x) => x.id === where.id && x.userId === where.userId);
      return r ? { id: r.id, ecosystem: r.ecosystem, purpose: r.purpose, permissions: r.permissions } : null;
    },
  },
};
jest.mock('../../database/prismaClient', () => ({ prisma: prismaFake }));
jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: any, _res: any, next: any) => {
    req.siwe = { userId: 'u1', sessionId: 's1', walletAddress: '0x0' };
    next();
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const walletRegistryRouter = require('../walletRegistry').default;

const app = express();
app.use(express.json());
app.use('/api/wallets', walletRegistryRouter);

const XRPL_1 = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const XRPL_2 = 'rJzpr3FMsGRtL4HjxnzAsKza3xGftbYumN'; // the address from the bug report

function connectXrpl(address: string) {
  return request(app).post('/api/wallets/connect').send({
    address,
    walletType: 'xaman',
    network: 'xrpl',
    ecosystem: 'xrpl',
    purpose: 'watch',
  });
}

beforeEach(() => {
  rows.length = 0;
  seq = 0;
});

describe('POST /api/wallets/connect — one primary per ecosystem', () => {
  it('first watch-only wallet of an ecosystem becomes primary', async () => {
    const res = await connectXrpl(XRPL_1);
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.isPrimary).toBe(true);
  });

  it('second watch-only wallet of the SAME ecosystem succeeds as non-primary (regression)', async () => {
    await connectXrpl(XRPL_1);
    const res = await connectXrpl(XRPL_2);
    expect(res.status).toBe(200); // was 500 CONNECT_FAILED (P2002) before the fix
    expect(res.body.data.wallet.isPrimary).toBe(false);
    expect(rows.filter((r) => r.ecosystem === 'xrpl' && r.isPrimary)).toHaveLength(1);
  });

  it('a second ecosystem still gets its own primary', async () => {
    await connectXrpl(XRPL_1);
    const res = await request(app).post('/api/wallets/connect').send({
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      walletType: 'metamask',
      network: 'flare',
      chainId: 14,
      ecosystem: 'evm',
      purpose: 'watch',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.wallet.isPrimary).toBe(true);
  });

  it('re-connecting the same address updates instead of creating a duplicate', async () => {
    await connectXrpl(XRPL_1);
    const res = await connectXrpl(XRPL_1);
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
  });
});

describe('POST /api/wallets/connect — auto-nickname "<Chain> N"', () => {
  const XRPL_3 = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh';

  it('names tracked wallets sequentially per rail: XRPL 1, XRPL 2 / Flare 1', async () => {
    const a = await connectXrpl(XRPL_1);
    const b = await connectXrpl(XRPL_2);
    expect(a.body.data.wallet.nickname).toBe('XRPL 1');
    expect(b.body.data.wallet.nickname).toBe('XRPL 2');

    const c = await request(app).post('/api/wallets/connect').send({
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      walletType: 'metamask',
      network: 'flare',
      chainId: 14,
      ecosystem: 'evm',
      purpose: 'watch',
    });
    expect(c.body.data.wallet.nickname).toBe('Flare 1');
  });

  it('never reuses a number after a deletion (next = max + 1)', async () => {
    await connectXrpl(XRPL_1); // XRPL 1
    await connectXrpl(XRPL_2); // XRPL 2
    rows.splice(rows.findIndex((r) => r.address === XRPL_1), 1); // delete XRPL 1
    const res = await connectXrpl(XRPL_3);
    expect(res.body.data.wallet.nickname).toBe('XRPL 3'); // not a duplicate "XRPL 2"
  });

  it('an explicit nickname from the client wins over the auto-name', async () => {
    const res = await request(app).post('/api/wallets/connect').send({
      address: XRPL_1,
      walletType: 'xaman',
      network: 'xrpl',
      ecosystem: 'xrpl',
      purpose: 'watch',
      nickname: 'Mi Xaman',
    });
    expect(res.body.data.wallet.nickname).toBe('Mi Xaman');
  });

  it('PATCH /mine/:id persists includeInPortfolio inside permissions (dashboard toggle)', async () => {
    const created = await connectXrpl(XRPL_1);
    const id = created.body.data.wallet.id;

    const off = await request(app)
      .patch(`/api/wallets/mine/${id}`)
      .send({ includeInPortfolio: false });
    expect(off.status).toBe(200);
    expect((off.body.data.wallet.permissions as any).includeInPortfolio).toBe(false);

    const on = await request(app)
      .patch(`/api/wallets/mine/${id}`)
      .send({ includeInPortfolio: true });
    expect(on.status).toBe(200);
    expect((on.body.data.wallet.permissions as any).includeInPortfolio).toBe(true);
  });

  it('PATCH /mine/:id persists icon inside permissions (wallet identity glyph)', async () => {
    const created = await connectXrpl(XRPL_1);
    const id = created.body.data.wallet.id;

    const set = await request(app)
      .patch(`/api/wallets/mine/${id}`)
      .send({ icon: 'comet' });
    expect(set.status).toBe(200);
    expect((set.body.data.wallet.permissions as any).icon).toBe('comet');

    const cleared = await request(app)
      .patch(`/api/wallets/mine/${id}`)
      .send({ icon: null });
    expect(cleared.status).toBe(200);
    expect((cleared.body.data.wallet.permissions as any).icon).toBeNull();

    const invalid = await request(app)
      .patch(`/api/wallets/mine/${id}`)
      .send({ icon: 'Not Valid!' });
    expect(invalid.status).toBe(400);
  });

  it('non-Flare EVM chains get no auto-name (out of the two demo rails)', async () => {
    const res = await request(app).post('/api/wallets/connect').send({
      address: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
      walletType: 'metamask',
      network: 'ethereum',
      chainId: 1,
      ecosystem: 'evm',
      purpose: 'watch',
    });
    expect(res.body.data.wallet.nickname).toBeNull();
  });
});

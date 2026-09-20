/**
 * Regression: POST /api/wallets/connect — auto-primary vs the partial unique
 * index `wallets_one_primary_per_user_ecosystem` (ONE isPrimary=true per
 * userId+ecosystem, WHERE isPrimary).
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

/** Active tx-bindings, so DELETE /mine/:id can be asserted on. */
const bindingRows: { id: string; userId: string; address: string; isActive: boolean }[] = [];

/**
 * The live session /connect now proves INSIDE its own transaction. Flip `live` to simulate a takeover that commits while the
 * request is in flight — `TrialCapService` alone is a pricing round-trip.
 */
const live = {
  userRows: 1,
  user: null as unknown,
  session: null as unknown,
};
function resetLiveSession() {
  live.userRows = 1;
  live.user = { isActive: true, preferences: null };
  live.session = {
    id: 's1',
    userId: 'u1',
    isActive: true,
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 3_600_000),
  };
}
resetLiveSession();

const liveSessionModels = {
  user: {
    updateMany: async () => ({ count: live.userRows }),
    findUnique: async () => live.user,
  },
  session: { findUnique: async () => live.session },
};
Object.assign(tx, liveSessionModels);

const prismaFake = {
  $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  ...liveSessionModels,
  wallet: {
    // PATCH and DELETE /mine/:id read the row outside the transaction.
    findFirst: async ({ where }: any) => {
      const r = rows.find((x) => x.id === where.id && x.userId === where.userId);
      return r
        ? {
            id: r.id,
            address: r.address,
            ecosystem: r.ecosystem,
            purpose: r.purpose,
            permissions: r.permissions,
          }
        : null;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((x) => x.id === where.id);
      const [row] = rows.splice(i, 1);
      return row;
    },
    update: tx.wallet.update,
  },
  walletBinding: {
    updateMany: async ({ where, data }: any) => {
      const targets = bindingRows.filter(
        (b) =>
          b.userId === where.userId &&
          where.address.in.includes(b.address) &&
          b.isActive === where.isActive,
      );
      targets.forEach((b) => Object.assign(b, data));
      return { count: targets.length };
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
  bindingRows.length = 0;
  seq = 0;
  resetLiveSession();
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

/**
 * Bug: a Xaman r-address reached /connect declared as
 * `ecosystem: 'evm', network: 'flare', chainId: 14` (the Wallets page
 * auto-registers `user.address`, which falls back to the first linked wallet).
 * It was stored lower-cased under the EVM rail and auto-named "Flare 2" — a
 * phantom twin of the user's real XRPL wallet, with no balance and no way to
 * delete it. The ecosystem must follow the ADDRESS, never the caller's claim.
 */
describe('POST /api/wallets/connect — the ecosystem must match the address', () => {
  it('rejects an XRPL address declared as EVM (phantom "Flare N" regression)', async () => {
    const res = await request(app).post('/api/wallets/connect').send({
      address: XRPL_2.toLowerCase(),
      walletType: 'siwe',
      network: 'flare',
      chainId: 14,
      caip2: 'eip155:14',
      ecosystem: 'evm',
      purpose: 'watch',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ADDRESS_ECOSYSTEM_MISMATCH');
    expect(rows).toHaveLength(0);
  });

  it('rejects an EVM address declared as XRPL', async () => {
    const res = await request(app).post('/api/wallets/connect').send({
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      walletType: 'manual',
      network: 'xrpl',
      ecosystem: 'xrpl',
      purpose: 'watch',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ADDRESS_ECOSYSTEM_MISMATCH');
    expect(rows).toHaveLength(0);
  });

  it('still accepts each address on its own rail', async () => {
    expect((await connectXrpl(XRPL_1)).status).toBe(200);
    const evm = await request(app).post('/api/wallets/connect').send({
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      walletType: 'metamask',
      network: 'flare',
      chainId: 14,
      ecosystem: 'evm',
      purpose: 'watch',
    });
    expect(evm.status).toBe(200);
    expect(rows).toHaveLength(2);
  });
});

/**
 * A wallet row is a DESTINATION: the send modal
 * pre-fills the primary of an ecosystem and the router picks it to sign with. A
 * request that passed requireSiweAuth before an account takeover would otherwise
 * land after it and make the intruder's address the owner's primary wallet,
 * without a single signature from them.
 */
describe('POST /api/wallets/connect — a takeover in flight plants nothing', () => {
  it.each([
    ['the session was revoked', () => { (live.session as { isActive: boolean }).isActive = false; }],
    ['the account is disabled (a quarantine row)', () => { live.user = { isActive: false, preferences: null }; }],
    ['the user row is gone', () => { live.userRows = 0; }],
    ['the session predates the credential epoch', () => {
      const epoch = new Date().toISOString();
      live.user = { isActive: true, preferences: { security: { credentialsEpoch: epoch, takeoverAt: epoch } } };
      (live.session as { createdAt: Date }).createdAt = new Date(Date.now() - 3_600_000);
    }],
  ])('%s → 401 session_revoked and NO wallet row', async (_label, kill) => {
    kill();
    const res = await connectXrpl(XRPL_1);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_revoked');
    // A readable English sentence, never a raw error chain (5.6).
    expect(res.body.detail).toMatch(/session is no longer valid/i);
    expect(rows).toHaveLength(0);
  });

  it('a live session still connects (the guard is not a wall)', async () => {
    expect((await connectXrpl(XRPL_1)).status).toBe(200);
    expect(rows).toHaveLength(1);
  });
});

describe('DELETE /api/wallets/mine/:id', () => {
  it('deactivates a case-sensitive XRPL binding (it only matched lower-case before)', async () => {
    const created = await connectXrpl(XRPL_1);
    bindingRows.push({ id: 'b1', userId: 'u1', address: XRPL_1, isActive: true });

    const res = await request(app).delete(`/api/wallets/mine/${created.body.data.wallet.id}`);

    expect(res.status).toBe(200);
    expect(rows).toHaveLength(0);
    expect(bindingRows[0].isActive).toBe(false); // stayed true before the fix
  });
});

describe('POST /api/wallets/connect — nickname is the USER\'s, never invented', () => {
  // The "<Chain> N" auto-nickname generator was RETIRED. No nickname from the client = NULL
  // stored; the frontend shows the provider name or the short address.
  it('stores NULL when the client sends no nickname (no "<Chain> N" invention)', async () => {
    const a = await connectXrpl(XRPL_1);
    const b = await connectXrpl(XRPL_2);
    expect(a.body.data.wallet.nickname ?? null).toBeNull();
    expect(b.body.data.wallet.nickname ?? null).toBeNull();

    const c = await request(app).post('/api/wallets/connect').send({
      address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      walletType: 'metamask',
      network: 'flare',
      chainId: 14,
      ecosystem: 'evm',
      purpose: 'watch',
    });
    expect(c.body.data.wallet.nickname ?? null).toBeNull();
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

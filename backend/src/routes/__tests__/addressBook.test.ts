/**
 * Address book — CRUD + normalization contract.
 *
 * The critical behavior: EVM addresses are stored lowercase (case-insensitive,
 * dedupe via the unique index) but XRPL classic addresses are stored VERBATIM —
 * base58 is case-sensitive and lowercasing one corrupts it.
 */
import express from 'express';
import request from 'supertest';

// ── In-memory prisma fake (only what the route touches) ─────────────────────
interface Row {
  id: string;
  userId: string;
  label: string;
  address: string;
  chainId: number | null;
  ens: string | null;
  createdAt: Date;
}
const rows: Row[] = [];
let seq = 0;

// The session the write re-checks inside its transaction (identity/liveSession).
const session = { id: 's1', userId: 'u1', isActive: true, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) };
const account = { id: 'u1', isActive: true, preferences: null as unknown };

const prismaFake: any = {
  $transaction: async (fn: any) => fn(prismaFake),
  user: {
    updateMany: async ({ where }: any) => ({ count: where.id === account.id ? 1 : 0 }),
    findUnique: async ({ where }: any) => (where.id === account.id ? { ...account } : null),
  },
  session: {
    findUnique: async ({ where }: any) => (where.id === session.id ? { ...session } : null),
  },
  addressBookEntry: {
    findMany: async ({ where }: any) =>
      rows
        .filter((r) => r.userId === where.userId && (where.chainId == null || r.chainId === where.chainId))
        .sort((a, b) => a.label.localeCompare(b.label)),
    findFirst: async ({ where }: any) =>
      rows.find((r) => r.id === where.id && r.userId === where.userId) ?? null,
    create: async ({ data }: any) => {
      const dupe = rows.find(
        (r) => r.userId === data.userId && r.address === data.address && r.chainId === (data.chainId ?? null),
      );
      if (dupe) throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
      const row: Row = {
        id: `ab${++seq}`,
        userId: data.userId,
        label: data.label,
        address: data.address,
        chainId: data.chainId ?? null,
        ens: data.ens ?? null,
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: any) => {
      const i = rows.findIndex((r) => r.id === where.id);
      if (i >= 0) rows.splice(i, 1);
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
const addressBookRouter = require('../addressBook').default;

const app = express();
app.use(express.json());
app.use('/api/address-book', addressBookRouter);

const EVM_MIXED = '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d';
const XRPL_ADDR = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';

beforeEach(() => {
  rows.length = 0;
  seq = 0;
  session.isActive = true;
  session.createdAt = new Date();
  account.isActive = true;
  account.preferences = null;
});

describe('POST /api/address-book — the session is re-checked inside the write', () => {
  it('a session revoked mid-request (account takeover) → 401, no contact saved', async () => {
    session.isActive = false;
    const res = await request(app).post('/api/address-book').send({ label: 'x', address: XRPL_ADDR });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_revoked');
    expect(rows).toHaveLength(0);
  });

  it('a session born BEFORE the credential epoch (it escaped the sweep) → 401', async () => {
    const epoch = new Date();
    account.preferences = { security: { credentialsEpoch: epoch.toISOString(), takeoverAt: epoch.toISOString() } };
    session.createdAt = new Date(epoch.getTime() - 60_000);
    const res = await request(app).post('/api/address-book').send({ label: 'x', address: XRPL_ADDR });
    expect(res.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it('a disabled account (the takeover quarantine row) → 401', async () => {
    account.isActive = false;
    const res = await request(app).post('/api/address-book').send({ label: 'x', address: XRPL_ADDR });
    expect(res.status).toBe(401);
    expect(rows).toHaveLength(0);
  });
});

describe('POST /api/address-book', () => {
  it('stores an EVM address lowercased', async () => {
    const res = await request(app)
      .post('/api/address-book')
      .send({ label: 'Ledger fría', address: EVM_MIXED, chainId: 14 });
    expect(res.status).toBe(201);
    expect(res.body.entry.address).toBe(EVM_MIXED.toLowerCase());
  });

  it('stores an XRPL classic address VERBATIM (base58 is case-sensitive)', async () => {
    const res = await request(app)
      .post('/api/address-book')
      .send({ label: 'Xaman de María', address: XRPL_ADDR });
    expect(res.status).toBe(201);
    expect(res.body.entry.address).toBe(XRPL_ADDR);
  });

  it.each(['0x1234', 'not-an-address', 'rIL0O', ''])(
    'rejects a malformed address (%s)',
    async (bad) => {
      const res = await request(app).post('/api/address-book').send({ label: 'x', address: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    },
  );

  it('409s on a duplicate address (case-insensitively for EVM)', async () => {
    await request(app).post('/api/address-book').send({ label: 'a', address: EVM_MIXED });
    const res = await request(app)
      .post('/api/address-book')
      .send({ label: 'b', address: EVM_MIXED.toLowerCase() });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ENTRY_ALREADY_EXISTS');
  });
});

describe('GET / PATCH / DELETE /api/address-book', () => {
  it('lists the user entries sorted by label', async () => {
    await request(app).post('/api/address-book').send({ label: 'zeta', address: XRPL_ADDR });
    await request(app).post('/api/address-book').send({ label: 'alfa', address: EVM_MIXED });
    const res = await request(app).get('/api/address-book');
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: any) => e.label)).toEqual(['alfa', 'zeta']);
  });

  it('renames an entry and deletes it', async () => {
    const created = await request(app).post('/api/address-book').send({ label: 'old', address: XRPL_ADDR });
    const id = created.body.entry.id;

    const patched = await request(app).patch(`/api/address-book/${id}`).send({ label: 'new' });
    expect(patched.status).toBe(200);
    expect(patched.body.entry.label).toBe('new');

    const deleted = await request(app).delete(`/api/address-book/${id}`);
    expect(deleted.status).toBe(204);
    const list = await request(app).get('/api/address-book');
    expect(list.body.entries).toHaveLength(0);
  });

  it('404s on foreign/unknown ids', async () => {
    const res = await request(app).patch('/api/address-book/nope').send({ label: 'x' });
    expect(res.status).toBe(404);
  });
});

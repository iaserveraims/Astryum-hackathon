/**
 * productizer it. 16 (4.1) — POST /api/wallets/embedded/create is the WIDEST
 * window in the repo: creating the Turnkey sub-org is a round-trip to a partner,
 * and the wallet row used to be written afterwards with no further check. An
 * account takeover that commits while that call is in the air would re-plant the
 * wallet on the owner's account — `isPrimary`, purpose 'sign', i.e. the address
 * the send modal pre-fills and the router picks.
 *
 * The rule this suite pins: the live-session check runs AFTER Turnkey returns
 * and BEFORE the row is written, and when it refuses the refusal is LOUD —
 * a 401 the user can read, plus a log line naming the orphaned sub-org, never a
 * silent drop and never a 500.
 */

const walletCreate = jest.fn();
const walletCount = jest.fn(async () => 0);

/** What the row lock + session read see inside the transaction. */
const live = {
  userRows: 1,
  user: null as unknown,
  session: null as unknown,
};
function resetLive() {
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
resetLive();

jest.mock('../../database/prismaClient', () => {
  const client: Record<string, unknown> = {
    wallet: {
      create: (...a: unknown[]) => walletCreate(...a),
      count: (...a: unknown[]) => walletCount(),
      findMany: async () => [],
      findFirst: async () => null,
    },
    walletBinding: { findMany: async () => [], findFirst: async () => null },
    user: {
      updateMany: async () => ({ count: live.userRows }),
      findUnique: async () => live.user,
    },
    session: { findUnique: async () => live.session },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

/** The partner call: it SUCCEEDS — the sub-org really exists after it. */
const createWallet = jest.fn(async () => ({ subOrgId: 'suborg-42', address: '0x' + 'a'.repeat(40) }));
jest.mock('../../services/wallet/TurnkeyEmbeddedService', () => ({
  turnkeyEmbeddedService: {
    createWallet: (...a: unknown[]) => createWallet(...(a as [])),
    unavailableReason: () => null,
  },
  TurnkeyNotConfiguredError: class extends Error {},
}));

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: any, _res: any, next: any) => {
    req.siwe = { userId: 'u1', sessionId: 's1', walletAddress: '0x0' };
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import walletRegistryRouter from '../walletRegistry';

const app = express();
app.use(express.json());
app.use('/api/wallets', walletRegistryRouter);

const PASSKEY = { challenge: 'c', attestation: { credentialId: 'i', clientDataJson: '{}', attestationObject: 'o' } };
const ORIGINAL_FLAG = process.env.EMBEDDED_WALLET_ENABLED;

beforeEach(() => {
  process.env.EMBEDDED_WALLET_ENABLED = 'true';
  resetLive();
  walletCreate.mockReset();
  walletCreate.mockImplementation(async ({ data }: any) => ({ id: 'w1', ...data }));
  createWallet.mockClear();
});
afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.EMBEDDED_WALLET_ENABLED;
  else process.env.EMBEDDED_WALLET_ENABLED = ORIGINAL_FLAG;
});

describe('POST /api/wallets/embedded/create — the session is re-checked after Turnkey', () => {
  it('a live session attaches the wallet', async () => {
    const res = await request(app).post('/api/wallets/embedded/create').send({ passkey: PASSKEY });
    expect(res.status).toBe(201);
    expect(res.body.data.subOrgId).toBe('suborg-42');
    expect(walletCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the session was revoked mid-flight', () => { (live.session as { isActive: boolean }).isActive = false; }],
    ['the account was quarantined', () => { live.user = { isActive: false, preferences: null }; }],
    ['the session predates the credential epoch', () => {
      const epoch = new Date().toISOString();
      live.user = { isActive: true, preferences: { security: { credentialsEpoch: epoch, takeoverAt: epoch } } };
      (live.session as { createdAt: Date }).createdAt = new Date(Date.now() - 3_600_000);
    }],
  ])('%s → 401 session_revoked, NO wallet row, and it is not silent', async (_label, kill) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    kill();

    const res = await request(app).post('/api/wallets/embedded/create').send({ passkey: PASSKEY });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_revoked');
    // The user is told the wallet was NOT attached — not left guessing.
    expect(res.body.detail).toMatch(/was NOT attached/i);
    expect(walletCreate).not.toHaveBeenCalled();
    // Turnkey DID create the sub-org: the id reaches the log so it can be
    // reconciled. Nothing is quietly dropped (invariant #11).
    expect(createWallet).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(' ')).toContain('suborg-42');
    warn.mockRestore();
  });
});

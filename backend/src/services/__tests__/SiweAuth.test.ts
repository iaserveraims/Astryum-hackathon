import { ethers } from 'ethers';

// Mock Prisma — Session.create returns canned row, User.upsert via xrplAddress
jest.mock('../../database/prismaClient', () => {
  const sessions = new Map<string, any>();
  let userSeq = 0;
  const users = new Map<string, any>(); // xrplAddress → user
  const usersById = new Map<string, any>(); // id → user (verifyToken reads by id)
  (globalThis as any).__siweUsers = users;
  (globalThis as any).__siweUsersById = usersById;
  (globalThis as any).__siweSessions = sessions;
  return {
    prisma: {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          (where.id !== undefined ? usersById.get(where.id) : users.get(where.xrplAddress)) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          // isActive defaults to true in the schema; the fake must say so, or
          // verifyToken's account-active check (4.5) refuses every token.
          const u = { id: `user-${++userSeq}`, isActive: true, preferences: null, ...data };
          users.set(data.xrplAddress, u);
          usersById.set(u.id, u);
          return u;
        }),
      },
      session: {
        create: jest.fn(async ({ data }: any) => {
          const s = { id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...data };
          sessions.set(s.id, s);
          return s;
        }),
        findUnique: jest.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
        update: jest.fn(async ({ where, data }: any) => {
          const s = sessions.get(where.id);
          if (!s) throw new Error('not found');
          const updated = { ...s, ...data };
          sessions.set(where.id, updated);
          return updated;
        }),
      },
      walletBinding: {
        findMany: jest.fn(async () => []),
        upsert: jest.fn(async ({ create }: any) => ({ id: 'binding-1', ...create })),
      },
    },
  };
});

describe('SiweAuth', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-32-chars-minimum-zzzzzz';
    // These tests exercise SIWE mechanics (nonce/signature/session), not the
    // closed-beta door — with the gate at its fail-closed default a first
    // login could not create its user. The gate has its own suite
    // (config/__tests__/betaGate.test.ts), including the wallet-first case.
    process.env.BETA_REGISTRATION_OPEN = 'true';
  });

  test('issueNonce returns nonce + ttl, rejects invalid address', async () => {
    const { issueNonce } = await import('../SiweAuth');
    const wallet = ethers.Wallet.createRandom();
    const { nonce, expiresAt } = issueNonce(wallet.address);
    expect(nonce).toMatch(/^[a-f0-9]+$/);
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(() => issueNonce('not-an-address')).toThrow();
  });

  test('verifySiweAndIssueToken: full happy path', async () => {
    const { issueNonce, buildSiweMessage, verifySiweAndIssueToken, verifyToken } = await import('../SiweAuth');
    const wallet = ethers.Wallet.createRandom();
    const { nonce } = issueNonce(wallet.address);
    const message = buildSiweMessage({ address: wallet.address }, nonce, new Date());
    const signature = await wallet.signMessage(message);

    const result = await verifySiweAndIssueToken({
      address: wallet.address,
      nonce,
      message,
      signature,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });

    expect(result.token).toBeTruthy();
    expect(result.sessionId).toMatch(/^session-/);
    expect(result.walletAddress).toBe(wallet.address.toLowerCase());

    // Token round-trip
    const verified = await verifyToken(result.token);
    expect(verified.walletAddress).toBe(wallet.address.toLowerCase());
    expect(verified.sessionId).toBe(result.sessionId);
  });

  test('rejects bad signature', async () => {
    const { issueNonce, buildSiweMessage, verifySiweAndIssueToken } = await import('../SiweAuth');
    const wallet = ethers.Wallet.createRandom();
    const otherWallet = ethers.Wallet.createRandom();
    const { nonce } = issueNonce(wallet.address);
    const message = buildSiweMessage({ address: wallet.address }, nonce, new Date());
    // Sign with the wrong wallet
    const signature = await otherWallet.signMessage(message);

    await expect(
      verifySiweAndIssueToken({
        address: wallet.address,
        nonce,
        message,
        signature,
      })
    ).rejects.toMatchObject({ code: 'signature_invalid' });
  });

  test('nonce can only be used once', async () => {
    const { issueNonce, buildSiweMessage, verifySiweAndIssueToken } = await import('../SiweAuth');
    const wallet = ethers.Wallet.createRandom();
    const { nonce } = issueNonce(wallet.address);
    const message = buildSiweMessage({ address: wallet.address }, nonce, new Date());
    const signature = await wallet.signMessage(message);

    await verifySiweAndIssueToken({ address: wallet.address, nonce, message, signature });
    await expect(
      verifySiweAndIssueToken({ address: wallet.address, nonce, message, signature })
    ).rejects.toMatchObject({ code: 'nonce_unknown' });
  });

  test('rejects nonce/address mismatch', async () => {
    const { issueNonce, buildSiweMessage, verifySiweAndIssueToken } = await import('../SiweAuth');
    const a = ethers.Wallet.createRandom();
    const b = ethers.Wallet.createRandom();
    const { nonce } = issueNonce(a.address);
    const message = buildSiweMessage({ address: b.address }, nonce, new Date());
    const signature = await b.signMessage(message);

    await expect(
      verifySiweAndIssueToken({ address: b.address, nonce, message, signature })
    ).rejects.toMatchObject({ code: 'nonce_address_mismatch' });
  });

  /**
   * Before this, SUSPENDING AN ACCOUNT DID NOTHING.
   * `verifyToken` never looked at `User.isActive`, so every token already minted
   * kept working: the quarantine row a takeover creates is `isActive:false`, and
   * so would be any account a founder ever disabled. And the JWT's `sub` was
   * never compared with the session's own `userId`, so a session id lifted from
   * one account and pasted into a token for another passed the door — every
   * downstream reader trusts `sub`.
   */
  describe('verifyToken — the account behind the session must still be live', () => {
    async function mintToken() {
      const { issueNonce, buildSiweMessage, verifySiweAndIssueToken } = await import('../SiweAuth');
      const wallet = ethers.Wallet.createRandom();
      const { nonce } = issueNonce(wallet.address);
      const message = buildSiweMessage({ address: wallet.address }, nonce, new Date());
      const signature = await wallet.signMessage(message);
      return verifySiweAndIssueToken({ address: wallet.address, nonce, message, signature });
    }

    test('a disabled account kills its live sessions on the next request', async () => {
      const { verifyToken } = await import('../SiweAuth');
      const result = await mintToken();
      // It works while the account is active…
      expect((await verifyToken(result.token)).sessionId).toBe(result.sessionId);

      const sessions = (globalThis as any).__siweSessions as Map<string, any>;
      const usersById = (globalThis as any).__siweUsersById as Map<string, any>;
      const userId = sessions.get(result.sessionId).userId;
      usersById.get(userId).isActive = false;

      await expect(verifyToken(result.token)).rejects.toMatchObject({ code: 'account_disabled' });
    });

    test('an account that no longer exists is refused, not waved through', async () => {
      const { verifyToken } = await import('../SiweAuth');
      const result = await mintToken();
      const sessions = (globalThis as any).__siweSessions as Map<string, any>;
      const usersById = (globalThis as any).__siweUsersById as Map<string, any>;
      usersById.delete(sessions.get(result.sessionId).userId);
      await expect(verifyToken(result.token)).rejects.toMatchObject({ code: 'account_disabled' });
    });

    test('a token whose sub is not the session owner is invalid', async () => {
      const { verifyToken } = await import('../SiweAuth');
      const mine = await mintToken();
      const theirs = await mintToken();
      const sessions = (globalThis as any).__siweSessions as Map<string, any>;
      // Same session row, a different account's id in `sub`.
      sessions.get(mine.sessionId).userId = sessions.get(theirs.sessionId).userId;
      await expect(verifyToken(mine.token)).rejects.toMatchObject({ code: 'token_invalid' });
    });
  });
});

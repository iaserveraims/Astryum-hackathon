import { ethers } from 'ethers';

// Mock Prisma — Session.create returns canned row, User.upsert via xrplAddress
jest.mock('../../database/prismaClient', () => {
  const sessions = new Map<string, any>();
  let userSeq = 0;
  const users = new Map<string, any>(); // xrplAddress → user
  return {
    prisma: {
      user: {
        findUnique: jest.fn(async ({ where }: any) => users.get(where.xrplAddress) ?? null),
        create: jest.fn(async ({ data }: any) => {
          const u = { id: `user-${++userSeq}`, ...data };
          users.set(data.xrplAddress, u);
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
});

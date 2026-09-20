/**
 * AN EVM BINDING MUST BE SIGNED OVER *ITS* CHALLENGE.
 *
 * `/confirm` recovered the signer of a body-supplied `message` and never looked
 * inside it: any public personal_sign of the victim (a forum proof, another
 * dApp's login text) became a WalletBinding with `signatureProof` — PROVEN for
 * provenAddresses — and linked the caller's KYC to that wallet. The refusal
 * cases below were 201 on the code before this round.
 */
const mockBindingUpsert = jest.fn();
const mockUserFindUnique = jest.fn();
const mockWalletUpdateMany = jest.fn();
const mockUserUpdateMany = jest.fn();
const mockSessionFindUnique = jest.fn();

jest.mock('../../database/prismaClient', () => {
  const client: Record<string, unknown> = {
    walletBinding: { upsert: (...a: unknown[]) => mockBindingUpsert(...a) },
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      updateMany: (...a: unknown[]) => mockUserUpdateMany(...a),
    },
    session: { findUnique: (...a: unknown[]) => mockSessionFindUnique(...a) },
    wallet: { updateMany: (...a: unknown[]) => mockWalletUpdateMany(...a) },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

jest.mock('../../middleware/requireSiweAuth', () => ({
  requireSiweAuth: (req: { siwe?: unknown }, _res: unknown, next: () => void) => {
    req.siwe = { userId: 'attacker-or-owner', sessionId: 's1', walletAddress: '0x0' };
    next();
  },
}));

jest.mock('../../services/PersonaKYCProvider', () => ({
  personaKYCProvider: {
    tagWalletLinked: jest.fn().mockResolvedValue(undefined),
    untagWalletLinked: jest.fn().mockResolvedValue(undefined),
  },
}));

import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import walletBindingsRouter, { evmMessageBindsChallenge } from '../walletBindings';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/wallets/bindings', walletBindingsRouter);
  return app;
}

const wallet = ethers.Wallet.createRandom();
const ADDRESS = wallet.address; // EIP-55
const ADDRESS_LC = ADDRESS.toLowerCase();

async function initiate(app: express.Express, address = ADDRESS) {
  const res = await request(app).post('/api/wallets/bindings/initiate').send({ address, chainType: 'evm' });
  expect(res.status).toBe(200);
  return res.body as { nonce: string; message: string };
}

function confirm(app: express.Express, body: Record<string, unknown>) {
  return request(app)
    .post('/api/wallets/bindings/confirm')
    .send({ address: ADDRESS, chainType: 'evm', mode: 'read_and_receive', ...body });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockResolvedValue({
    kycVerified: true,
    personaInquiryId: 'inq_1',
    isActive: true,
    preferences: null,
  });
  mockBindingUpsert.mockImplementation(async ({ create }: any) => ({ id: 'b1', ...create }));
  mockWalletUpdateMany.mockResolvedValue({ count: 0 });
  // The live-session check the write runs inside its transaction.
  mockUserUpdateMany.mockResolvedValue({ count: 1 });
  mockSessionFindUnique.mockResolvedValue({
    id: 's1',
    userId: 'attacker-or-owner',
    isActive: true,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
});

describe('POST /api/wallets/bindings/confirm — the session is re-checked inside the write', () => {
  it('a takeover that commits during the proof (session revoked) → 401, NOTHING bound', async () => {
    const app = makeApp();
    const { nonce, message } = await initiate(app);
    const signature = await wallet.signMessage(message);
    mockSessionFindUnique.mockResolvedValueOnce({
      id: 's1',
      userId: 'attacker-or-owner',
      isActive: false,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const res = await confirm(app, { nonce, message, signature });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('session_revoked');
    expect(mockBindingUpsert).not.toHaveBeenCalled();
    expect(mockWalletUpdateMany).not.toHaveBeenCalled();
  });

  it('a session born before the credential epoch → 401, nothing bound', async () => {
    const app = makeApp();
    const { nonce, message } = await initiate(app);
    const signature = await wallet.signMessage(message);
    const epoch = new Date();
    mockUserFindUnique.mockResolvedValueOnce({
      kycVerified: true,
      personaInquiryId: 'inq_1',
      isActive: true,
      preferences: { security: { credentialsEpoch: epoch.toISOString(), takeoverAt: epoch.toISOString() } },
    });
    mockSessionFindUnique.mockResolvedValueOnce({
      id: 's1',
      userId: 'attacker-or-owner',
      isActive: true,
      createdAt: new Date(epoch.getTime() - 60_000),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const res = await confirm(app, { nonce, message, signature });

    expect(res.status).toBe(401);
    expect(mockBindingUpsert).not.toHaveBeenCalled();
  });
});

describe('POST /api/wallets/bindings/confirm — EVM', () => {
  it('the honest path: the challenge from /initiate, signed verbatim → 201', async () => {
    const app = makeApp();
    const { nonce, message } = await initiate(app);
    const signature = await wallet.signMessage(message);
    const res = await confirm(app, { nonce, message, signature });
    expect(res.status).toBe(201);
    expect(mockBindingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ address: ADDRESS_LC, signatureProof: signature }) }),
    );
  });

  it("a public personal_sign of the victim (another dApp's text) → 422 MESSAGE_NOT_BOUND_TO_NONCE, nothing bound", async () => {
    const app = makeApp();
    const { nonce } = await initiate(app);
    const publicText = 'Welcome to SomeDapp!\n\nClick to sign in and accept the Terms of Service.';
    const signature = await wallet.signMessage(publicText);
    const res = await confirm(app, { nonce, message: publicText, signature });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('MESSAGE_NOT_BOUND_TO_NONCE');
    expect(mockBindingUpsert).not.toHaveBeenCalled();
    expect(mockUserFindUnique).not.toHaveBeenCalled();
  });

  it('a text carrying the address but an OLD nonce (a replayed earlier challenge) → 422', async () => {
    const app = makeApp();
    const old = await initiate(app);
    const oldSignature = await wallet.signMessage(old.message);
    const fresh = await initiate(app);
    const res = await confirm(app, { nonce: fresh.nonce, message: old.message, signature: oldSignature });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('MESSAGE_NOT_BOUND_TO_NONCE');
    expect(mockBindingUpsert).not.toHaveBeenCalled();
  });

  it('a text carrying the nonce but not the address → 422', async () => {
    const app = makeApp();
    const { nonce } = await initiate(app);
    const text = `Astryum Wallet Binding\nNonce: ${nonce}`;
    const signature = await wallet.signMessage(text);
    const res = await confirm(app, { nonce, message: text, signature });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('MESSAGE_NOT_BOUND_TO_NONCE');
    expect(mockBindingUpsert).not.toHaveBeenCalled();
  });

  it('a refusal does not burn the nonce: the real challenge still confirms afterwards', async () => {
    const app = makeApp();
    const { nonce, message } = await initiate(app);
    const bad = await confirm(app, { nonce, message: 'gm', signature: await wallet.signMessage('gm') });
    expect(bad.status).toBe(422);
    const good = await confirm(app, { nonce, message, signature: await wallet.signMessage(message) });
    expect(good.status).toBe(201);
  });

  it('the address match is case-insensitive (EIP-55 in the text is the same wallet)', async () => {
    const app = makeApp();
    const { nonce } = await initiate(app);
    const text = `Astryum Wallet Binding\nAddress: ${ADDRESS}\nNonce: ${nonce}`;
    const res = await confirm(app, { nonce, message: text, signature: await wallet.signMessage(text) });
    expect(res.status).toBe(201);
  });
});

describe('evmMessageBindsChallenge', () => {
  const nonce = 'ab'.repeat(16);
  it('needs the exact Nonce line and the address', () => {
    expect(evmMessageBindsChallenge(`Address: ${ADDRESS}\nNonce: ${nonce}`, nonce, ADDRESS_LC)).toBe(true);
    expect(evmMessageBindsChallenge(`Address: ${ADDRESS}\nNonce: ${nonce.slice(2)}`, nonce, ADDRESS_LC)).toBe(false);
    expect(evmMessageBindsChallenge(`Address: ${ADDRESS}\n${nonce}`, nonce, ADDRESS_LC)).toBe(false);
    expect(evmMessageBindsChallenge(`Nonce: ${nonce}`, nonce, ADDRESS_LC)).toBe(false);
    expect(evmMessageBindsChallenge(`Address: ${ADDRESS}\nNonce: ${nonce}`, '', ADDRESS_LC)).toBe(false);
  });
});

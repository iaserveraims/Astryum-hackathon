/**
 * A COUNCIL RULE WAS A BACK DOOR INTO ANY COUNCIL'S INBOX.
 *
 * `POST /api/rules` only asked that the rule's wallet be the caller's; a
 * 'councilPayment' / 'councilOrder' action carries a free `params.council`, and
 * on fire the engine created a proposal on THAT council with the caller as
 * proposer — around the 403 NOT_A_COUNCIL_MEMBER of `POST /api/council/proposals`.
 *
 * These run the REAL `sessionIsCouncilMember` (routes/councilProposals) against
 * a wallet-table fake that answers the WHERE the helper sends, and a mocked
 * ledger signer list. Every refusal case was a 201 on the code before this round.
 */
const mockWalletFindFirst = jest.fn();
const mockWalletFindMany = jest.fn();
/** The PROVEN half — signature-backed bindings (see the fake below). */
const mockBindingFindMany = jest.fn();
const mockProtocolFindFirst = jest.fn();
const mockRuleCreate = jest.fn();
const mockRuleFindUnique = jest.fn();
const mockRuleUpdate = jest.fn();

jest.mock('../../database/prismaClient', () => {
  const client: Record<string, unknown> = {
    wallet: {
      findFirst: (...a: unknown[]) => mockWalletFindFirst(...a),
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
    },
    /**
     * Membership is decided by a PROVEN address —
     * an active binding whose challenge the user signed — never by a `wallet` row
     * (anyone can write one naming a council's public signer address). `POST
     * /api/rules` has a session but hands the helper no address, so a binding is the
     * proof it can have.
     */
    walletBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
    protocol: { findFirst: (...a: unknown[]) => mockProtocolFindFirst(...a) },
    automationRule: {
      create: (...a: unknown[]) => mockRuleCreate(...a),
      findUnique: (...a: unknown[]) => mockRuleFindUnique(...a),
      update: (...a: unknown[]) => mockRuleUpdate(...a),
    },
    // Live session for the create's transaction (identity/liveSession).
    user: {
      updateMany: async () => ({ count: 1 }),
      findUnique: async () => ({ isActive: true, preferences: null }),
    },
    session: {
      findUnique: async ({ where }: any) => ({ id: where.id, userId: 'u1', isActive: true, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) }),
    },
  };
  client.$transaction = async (fn: (tx: unknown) => unknown) => fn(client);
  return { prisma: client };
});

const mockSignerCouncil = jest.fn();
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: { getSignerCouncil: (...a: unknown[]) => mockSignerCouncil(...a) },
}));

jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: () => ({ allowed: true }) },
}));

import express from 'express';
import request from 'supertest';
import rulesRouter from '../rules';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
// A checksum-VALID r-address: the route resolves the council with
// isValidClassicAddress, exactly as composeCouncilRuleTx does.
const MEMBER_A = 'rG5qyYZKYw5kx1L44RCdhjdWi59dWZHNG2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
/** Another family's council: its only signer is MEMBER_B, whom u1 does not hold. */
const FOREIGN_COUNCIL = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const EVM_WALLET = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

/** u1 holds the council account row, a seat (MEMBER_A) and an EVM wallet. */
const WALLETS = [
  { id: 'w-council', userId: 'u1', address: COUNCIL, chainId: 1440002 },
  { id: 'w-seat', userId: 'u1', address: MEMBER_A, chainId: 1440002 },
  { id: 'w-evm', userId: 'u1', address: EVM_WALLET, chainId: 14 },
];

function makeApp(userId = 'u1') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { siwe: unknown }).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
    next();
  });
  app.use('/api/rules', rulesRouter);
  return app;
}

const TIME = { type: 'TIME_TRIGGER', cron: '0 9 1 * *' };

function councilBody(params: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    walletAddress: COUNCIL,
    chainId: 1440002,
    name: 'Alquiler mensual',
    trigger: TIME,
    action: { kind: 'councilPayment', params: { destination: MEMBER_B, amountDrops: '1000000', ...params } },
    ...over,
  };
}

const RULE = {
  id: 'rule-1',
  walletId: 'w-council',
  name: 'Alquiler mensual',
  enabled: true,
  action: { kind: 'councilPayment', params: { council: COUNCIL, destination: MEMBER_B, amountDrops: '1000000' } },
  wallet: { address: COUNCIL, userId: 'u1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWalletFindFirst.mockImplementation(async ({ where }: any) => {
    const addr = typeof where.address === 'string' ? where.address : where.address.equals;
    return WALLETS.find((w) => w.userId === where.userId && w.address.toLowerCase() === addr.toLowerCase()) ?? null;
  });
  // The membership helper asks `{ userId, address: { in: members } }`.
  mockWalletFindMany.mockImplementation(async ({ where }: any) => {
    const wanted: string[] = where.address?.in ?? [];
    return WALLETS.filter((w) => w.userId === where.userId && wanted.includes(w.address)).map((w) => ({ address: w.address }));
  });
  // And what it actually reads is the PROOF — u1 signed for every address
  // they hold here, so the ordinary case is unchanged; a stranger has no binding.
  process.env.DATABASE_URL = 'postgres://test';
  mockBindingFindMany.mockImplementation(async ({ where }: any) =>
    WALLETS.filter((w) => w.userId === where.userId).map((w) => ({
      address: w.address,
      signatureProof: 'signed-challenge',
      linkedAt: new Date(0),
    })),
  );
  mockSignerCouncil.mockImplementation(async (account: string) => {
    if (account === COUNCIL) return { quorum: 2, masterKeyDisabled: true, signers: [{ account: MEMBER_A, weight: 1 }, { account: MEMBER_B, weight: 1 }] };
    if (account === FOREIGN_COUNCIL) return { quorum: 1, masterKeyDisabled: true, signers: [{ account: MEMBER_B, weight: 1 }] };
    return null;
  });
  mockProtocolFindFirst.mockResolvedValue(null);
  mockRuleCreate.mockImplementation(async ({ data }: any) => ({ id: 'rule-new', ...data }));
  mockRuleFindUnique.mockImplementation(async ({ where }: any) => (where.id === RULE.id ? RULE : null));
  mockRuleUpdate.mockImplementation(async ({ data }: any) => ({ ...RULE, ...data }));
});

describe('POST /api/rules — a council rule requires a seat on THAT council', () => {
  it('params.council naming a FOREIGN council → 403 NOT_A_COUNCIL_MEMBER, asked against the ledger, nothing created', async () => {
    const res = await request(makeApp()).post('/api/rules').send(councilBody({ council: FOREIGN_COUNCIL }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockSignerCouncil).toHaveBeenCalledWith(FOREIGN_COUNCIL);
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('the same for a councilOrder', async () => {
    const res = await request(makeApp())
      .post('/api/rules')
      .send({
        ...councilBody({}),
        action: { kind: 'councilOrder', params: { council: FOREIGN_COUNCIL, orderAction: 'recall', orderParams: { venueId: 0, amount: '1' } } },
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('a member naming their own council → 201', async () => {
    const res = await request(makeApp()).post('/api/rules').send(councilBody({ council: COUNCIL }));
    expect(res.status).toBe(201);
    expect(mockRuleCreate).toHaveBeenCalledTimes(1);
  });

  it('no params.council → the council is the rule wallet, exactly as composeCouncilRuleTx resolves it', async () => {
    const ok = await request(makeApp()).post('/api/rules').send(councilBody({}));
    expect(ok.status).toBe(201);
    expect(mockSignerCouncil).toHaveBeenCalledWith(COUNCIL);

    // A wallet with no SignerList as the implicit council → 409 NOT_A_COUNCIL.
    const notCouncil = await request(makeApp()).post('/api/rules').send(councilBody({}, { walletAddress: MEMBER_A }));
    expect(notCouncil.status).toBe(409);
    expect(notCouncil.body.error).toBe('NOT_A_COUNCIL');
    expect(mockRuleCreate).toHaveBeenCalledTimes(1);
  });

  it('a signer list that cannot be read → 502 COUNCIL_READ_FAILED, nothing created', async () => {
    mockSignerCouncil.mockRejectedValue(new Error('websocket closed'));
    const res = await request(makeApp()).post('/api/rules').send(councilBody({ council: COUNCIL }));
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('COUNCIL_READ_FAILED');
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('an EVM wallet with no params.council → 400 invalid_council, no ledger read', async () => {
    const res = await request(makeApp())
      .post('/api/rules')
      .send(councilBody({}, { walletAddress: EVM_WALLET, chainId: 14 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_council');
    expect(mockSignerCouncil).not.toHaveBeenCalled();
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('non-council kinds pay for no ledger read', async () => {
    const res = await request(makeApp())
      .post('/api/rules')
      .send({
        walletAddress: MEMBER_A,
        chainId: 1440002,
        name: 'Domiciliación',
        trigger: TIME,
        action: { kind: 'scheduledPayment', params: { destination: MEMBER_B, amountDrops: '1000000' } },
      });
    expect(res.status).toBe(201);
    expect(mockSignerCouncil).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/rules/:id — the council cannot be swapped for a foreign one', () => {
  it('rewriting params.council to a FOREIGN council → 403, update not called', async () => {
    const res = await request(makeApp())
      .patch('/api/rules/rule-1')
      .send({ action: { kind: 'councilPayment', params: { council: FOREIGN_COUNCIL, destination: MEMBER_B, amountDrops: '1' } } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });

  it('dropping params.council falls back to the rule wallet — still checked', async () => {
    mockRuleFindUnique.mockResolvedValue({ ...RULE, wallet: { address: MEMBER_A, userId: 'u1' } });
    const res = await request(makeApp())
      .patch('/api/rules/rule-1')
      .send({ action: { kind: 'councilOrder', params: { orderAction: 'recall', orderParams: {} } } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_A_COUNCIL');
    expect(mockSignerCouncil).toHaveBeenCalledWith(MEMBER_A);
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });

  it('a member keeping (or re-pointing to) their own council → 200', async () => {
    const res = await request(makeApp())
      .patch('/api/rules/rule-1')
      .send({ action: { kind: 'councilPayment', params: { council: COUNCIL, destination: MEMBER_B, amountDrops: '2000000' } } });
    expect(res.status).toBe(200);
    expect(mockRuleUpdate).toHaveBeenCalledTimes(1);
  });

  it('re-sending the council action the rule already holds (cooldown-only edit) pays for no ledger read — a slow ledger cannot 502 it', async () => {
    mockSignerCouncil.mockRejectedValue(new Error('websocket closed'));
    const res = await request(makeApp())
      .patch('/api/rules/rule-1')
      // Same action as stored, keys in another order (RuleEditModal clones it).
      .send({ cooldownMinutes: 60, action: { params: { amountDrops: '1000000', destination: MEMBER_B, council: COUNCIL }, kind: 'councilPayment' } });
    expect(res.status).toBe(200);
    expect(mockSignerCouncil).not.toHaveBeenCalled();
    expect(mockRuleUpdate).toHaveBeenCalledTimes(1);
  });

  it('keys the action schema strips from the STORED action are not a change', async () => {
    mockSignerCouncil.mockRejectedValue(new Error('websocket closed'));
    mockRuleFindUnique.mockResolvedValue({ ...RULE, action: { ...RULE.action, compiledBy: 'moneyflow-v1' } });
    const res = await request(makeApp()).patch('/api/rules/rule-1').send({ cooldownMinutes: 30, action: RULE.action });
    expect(res.status).toBe(200);
    expect(mockSignerCouncil).not.toHaveBeenCalled();
  });

  it('a CHANGED council action (same council, new amount) still reads the ledger — and a failed read still saves nothing', async () => {
    mockSignerCouncil.mockRejectedValue(new Error('websocket closed'));
    const res = await request(makeApp())
      .patch('/api/rules/rule-1')
      .send({ action: { kind: 'councilPayment', params: { council: COUNCIL, destination: MEMBER_B, amountDrops: '9000000' } } });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('COUNCIL_READ_FAILED');
    expect(mockSignerCouncil).toHaveBeenCalledWith(COUNCIL);
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });

  it('turning a non-council rule into a council one with the same params is a change → checked', async () => {
    mockRuleFindUnique.mockResolvedValue({
      ...RULE,
      action: { kind: 'scheduledPayment', params: { council: FOREIGN_COUNCIL, destination: MEMBER_B, amountDrops: '1' } },
    });
    const res = await request(makeApp())
      .patch('/api/rules/rule-1')
      .send({ action: { kind: 'councilPayment', params: { council: FOREIGN_COUNCIL, destination: MEMBER_B, amountDrops: '1' } } });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });

  it('a PATCH that does not touch the action pays for no ledger read', async () => {
    const res = await request(makeApp()).patch('/api/rules/rule-1').send({ name: 'Renombrada' });
    expect(res.status).toBe(200);
    expect(mockSignerCouncil).not.toHaveBeenCalled();
  });

  it("another user's rule stays a 404 before any ledger read", async () => {
    const res = await request(makeApp('u2'))
      .patch('/api/rules/rule-1')
      .send({ action: { kind: 'councilPayment', params: { council: COUNCIL, destination: MEMBER_B, amountDrops: '1' } } });
    expect(res.status).toBe(404);
    expect(mockSignerCouncil).not.toHaveBeenCalled();
    expect(mockRuleUpdate).not.toHaveBeenCalled();
  });
});

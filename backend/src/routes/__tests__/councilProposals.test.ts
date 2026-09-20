const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockSigUpsert = jest.fn();
const mockSigFindMany = jest.fn();
const mockPosFindUnique = jest.fn();
const mockPosCreate = jest.fn();
// puertas-y-permiso: the withdraw/submitted doors now ask whether the session
// owns one of THIS council's member addresses.
// g1-ceremonia: the same question, asked once for a whole listing.
// the ANSWER no longer comes from the
// self-asserted `wallet` table — a council's signer addresses are public, so a
// stranger could type one in, «become» a member and hold the family's Sequence
// for seven days. It comes from `provenAddressesOf`: the signed-in address plus
// signature-backed bindings. This knob IS that list.
const mockProvenAddresses = jest.fn<Promise<string[]>, unknown[]>();
/**
 * The READ verdict asks the DETAILED form, because an empty
 * list and «I could not read the store» are two different answers and answering them
 * the same way closes an exit. Same knob, one extra fact.
 */
const mockProvenDetailed = jest.fn<
  Promise<{ addresses: string[]; floorReadable: boolean; failure: string | null }>,
  unknown[]
>();
/**
 * The router now asks the identity module's MEMBERSHIP VERDICT
 * (`proveMembership`), which is the only thing that can tell «you hold none of these
 * seats» from «I could not ask». Driven by the same knob, so a test still says what
 * this session holds and nothing else.
 */
const mockProveMembership = jest.fn<
  Promise<{
    owned: string[];
    storeReadable: boolean;
    failure: string | null;
    refusal: { status: number; error: string; detail: string; retryable: boolean } | null;
  }>,
  unknown[]
>();
/** «This session has PROVEN these addresses» — the harness's one membership knob. */
const holdsSeats = (addresses: string[]) => {
  mockProvenAddresses.mockResolvedValue(addresses);
  mockProvenDetailed.mockResolvedValue({ addresses, floorReadable: true, failure: null });
  mockProveMembership.mockImplementation(async (...a: unknown[]) => {
    const members = (a[2] as string[]) ?? [];
    return { owned: members.filter((m) => addresses.includes(m)), storeReadable: true, failure: null, refusal: null };
  });
};
/** The proof store itself did not answer — never «you are not a member». */
const proofStoreUnreadable = () => {
  mockProvenAddresses.mockResolvedValue([]);
  mockProvenDetailed.mockResolvedValue({ addresses: [], floorReadable: false, failure: 'read-failed' });
  mockProveMembership.mockResolvedValue({
    owned: [],
    storeReadable: false,
    failure: 'read-failed',
    refusal: {
      status: 503,
      error: 'PROOF_STORE_UNREADABLE',
      detail: 'We could not read your wallet proofs just now. Try again in a moment.',
      retryable: true,
    },
  });
};
jest.mock('../../services/identity/provenAddresses', () => ({
  ...jest.requireActual('../../services/identity/provenAddresses'),
  provenAddressesOf: (...a: unknown[]) => mockProvenAddresses(...a),
  provenAddressesDetailed: (...a: unknown[]) => mockProvenDetailed(...a),
  proveMembership: (...a: unknown[]) => mockProveMembership(...a),
}));
/** ⛔: kept only so an accidental `prisma.wallet` read would be VISIBLE here. */
const mockWalletFindMany = jest.fn();
/** g1-ceremonia: the ceremony lease lives in the generic CacheEntry table. */
const mockCacheFindUnique = jest.fn();
const mockCacheUpsert = jest.fn();
const mockCacheDeleteMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    councilProposal: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
    councilProposalSignature: {
      upsert: (...a: unknown[]) => mockSigUpsert(...a),
      findMany: (...a: unknown[]) => mockSigFindMany(...a),
    },
    councilFormalPosition: {
      findUnique: (...a: unknown[]) => mockPosFindUnique(...a),
      create: (...a: unknown[]) => mockPosCreate(...a),
    },
    wallet: {
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
    },
    cacheEntry: {
      findUnique: (...a: unknown[]) => mockCacheFindUnique(...a),
      upsert: (...a: unknown[]) => mockCacheUpsert(...a),
      deleteMany: (...a: unknown[]) => mockCacheDeleteMany(...a),
    },
  },
}));

// The route hands the provider to the (mocked) coordinator AND — since the
// G1-guard — reads the account's Sequence itself before it dares call a
// proposal expired. That read is the whole point of the guard, so it is a
// first-class mock here.
const mockAccountSequence = jest.fn();
// `POST /` reads the council's signer list off the ledger
// BEFORE anything else, to ask whether this session holds one of its seats.
const mockSignerCouncil = jest.fn();
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: {
    getAccountSequence: (...a: unknown[]) => mockAccountSequence(...a),
    getSignerCouncil: (...a: unknown[]) => mockSignerCouncil(...a),
  },
}));

const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplMultisigCoordinator'),
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
}));

const mockVerifyBlob = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplBlobVerifier', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplBlobVerifier'),
  verifySignerBlob: (...a: unknown[]) => mockVerifyBlob(...a),
}));

// `/:id/submitted` reads the reported hash off
// the ledger before it records it (council membership still rests on wallet
// rows, so the report has to prove itself). Default in beforeEach: a VALIDATED
// transaction of THIS council at the pinned Sequence 7.
const mockXrplJsonRpc = jest.fn();
jest.mock('../../services/flare/DirectMintExecutorService', () => ({
  xrplJsonRpc: (...a: unknown[]) => mockXrplJsonRpc(...a),
}));

jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: () => ({ allowed: true }) },
}));

// §1.3: the router now enforces the Legacy gate server-side. These tests
// exercise the proposal machinery, not the gate (that has its own suite) —
// the global switch opens it without touching the (unmocked) users table.
process.env.LEGACY_ENABLED = 'true';

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { encode, encodeForSigning } from 'ripple-binary-codec';
import { sign as kpSign, deriveAddress as kpDeriveAddress, deriveKeypair, generateSeed } from 'ripple-keypairs';
import { BlobVerificationError } from '../../connectors/protocols/xrpl/XrplBlobVerifier';
import councilProposalsRouter, { __resetSequenceCache } from '../councilProposals';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const USER_ID = 'user-1';

const SIGNERS = [
  { account: MEMBER_A, weight: 1 },
  { account: MEMBER_B, weight: 1 },
];

function liveProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    account: COUNCIL,
    createdByUserId: USER_ID,
    title: null,
    txType: 'Payment',
    txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 },
    quorum: 2,
    signerList: SIGNERS,
    status: 'collecting',
    txHash: null,
    positionsAnchor: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
}

function buildApp(userId: string | null = USER_ID) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: unknown }).siwe = {
        userId,
        sessionId: 's1',
        walletAddress: '0x0',
      };
      next();
    });
  }
  app.use('/api/council/proposals', councilProposalsRouter);
  return app;
}

beforeAll(() => {
  process.env.XRPL_DEFI_ENABLED = 'true';
});

beforeEach(() => {
  for (const m of [mockFindFirst, mockCreate, mockFindMany, mockFindUnique, mockUpdate, mockSigUpsert, mockSigFindMany, mockPosFindUnique, mockPosCreate, mockPrepare, mockVerifyBlob, mockAccountSequence, mockWalletFindMany, mockProvenAddresses, mockProvenDetailed, mockProveMembership, mockCacheFindUnique, mockCacheUpsert, mockCacheDeleteMany]) {
    m.mockReset();
  }
  // The Sequence cache is module state that outlives a request (and a test).
  __resetSequenceCache();
  // G1-cadena: `POST /` now asks for the account's PAST-DEADLINE rows before it
  // pins a new Sequence (findUnresolvedSeat). Default: there are none — every
  // test that cares about that door sets its own rows.
  mockFindMany.mockResolvedValue([]);
  // Default: the session belongs to a member of this council (the ordinary
  // case). The tests that care about a stranger set their own answer.
  holdsSeats([MEMBER_A]);
  // The READ floor also consults the wallet registry (never the write
  // doors). Default: this session registered nothing — the tests that care set rows.
  mockWalletFindMany.mockResolvedValue([]);
  // g1-ceremonia: no ceremony holding the seat unless a test says so.
  mockCacheFindUnique.mockResolvedValue(null);
  mockCacheDeleteMany.mockResolvedValue({ count: 0 });
  // The reported hash is, by default, a validated tx of this council at Sequence 7
  // — and the SAME transaction liveProposal() stores: a Payment
  // with no destination, amount or memo.
  mockXrplJsonRpc.mockReset();
  mockXrplJsonRpc.mockResolvedValue({ validated: true, TransactionType: 'Payment', Account: COUNCIL, Sequence: 7, meta: { TransactionResult: 'tesSUCCESS' } });
  // The ledger's signer list for COUNCIL — MEMBER_A and MEMBER_B.
  mockSignerCouncil.mockReset();
  mockSignerCouncil.mockResolvedValue({ quorum: 2, masterKeyDisabled: true, signers: SIGNERS });
});

/** Two filed positions and the acta memo `/positions/anchor/prepare` composes for them. */
const POSITIONS = [{ contentHash: 'bb'.repeat(32) }, { contentHash: 'aa'.repeat(32) }];
const ACTA_MEMO = `astryum-council-acta/v1:${crypto
  .createHash('sha256')
  .update(['aa'.repeat(32), 'bb'.repeat(32)].join('\n'), 'utf8')
  .digest('hex')}`;

/** A validated tesSUCCESS anchor of THIS acta, as the `tx` method returns it. */
function anchorOnLedger(over: Record<string, unknown> = {}, memo = ACTA_MEMO) {
  return {
    validated: true,
    Account: MEMBER_B,
    Sequence: 3,
    TransactionType: 'Payment',
    Destination: COUNCIL,
    Amount: '1',
    Memos: [{ Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() } }],
    meta: { TransactionResult: 'tesSUCCESS' },
    ...over,
  };
}

describe('POST /api/council/proposals — create pins via the coordinator', () => {
  test('creates the proposal from the PINNED tx and returns the preflight', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockPrepare.mockResolvedValue({
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7, SigningPubKey: '' },
      council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
      fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
      preflight: { available: true, willSucceed: true, balanceChanges: [] },
    });
    mockCreate.mockResolvedValue(liveProposal());

    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL }, title: 'Pago proveedor' });

    expect(res.status).toBe(201);
    expect(res.body.preflight.willSucceed).toBe(true);
    const data = mockCreate.mock.calls[0][0].data;
    expect(data.txjson.SigningPubKey).toBe(''); // stores the pinned tx, not the raw input
    expect(data.quorum).toBe(2);
    expect(data.signerList).toEqual(SIGNERS);
    expect(data.createdByUserId).toBe(USER_ID);
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('a live proposal on the account blocks a second one (Sequence honesty) → 409', async () => {
    mockFindFirst.mockResolvedValue({ id: 'p0', title: null, txType: 'Payment' });
    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('LIVE_PROPOSAL_EXISTS');
    expect(mockPrepare).not.toHaveBeenCalled();
  });
});

/**
 * `POST /` created a proposal for ANY account with a
 * SignerList, for ANY authenticated session. `LIVE_PROPOSAL_EXISTS` then held
 * the real council out for 7 days, renewable. These fail on the code before
 * this round: 201 for the stranger.
 */
describe('Only a member of the council may pin its Sequence (POST /)', () => {
  const compose = (userId: string = USER_ID) =>
    request(buildApp(userId))
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL } });

  test('a stranger → 403 NOT_A_COUNCIL_MEMBER, asked against the LEDGER signer list; nothing pinned or stored', async () => {
    mockFindFirst.mockResolvedValue(null);
    holdsSeats([]); // holds none of the seats

    const res = await compose('stranger');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockSignerCouncil).toHaveBeenCalledWith(COUNCIL);
    // The question is asked of the PROOF, never of `prisma.wallet`.
    expect(mockProveMembership).toHaveBeenCalledWith('stranger', expect.anything(), expect.anything(), 'entry');
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    expect(res.body.detail).toContain('PROVEN address');
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('the refusal comes BEFORE the seat guards: a stranger learns nothing about another council', async () => {
    holdsSeats([]);
    mockFindFirst.mockResolvedValue({ id: 'p0', title: 'Pago al notario', txType: 'Payment' });

    const res = await compose('stranger');

    expect(res.status).toBe(403);
    expect(res.body.proposalId).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('notario');
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockCacheFindUnique).not.toHaveBeenCalled();
  });

  test('a member of the council still composes (201)', async () => {
    mockFindFirst.mockResolvedValue(null);
    holdsSeats([MEMBER_B]);
    mockPrepare.mockResolvedValue({
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7, SigningPubKey: '' },
      council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
      fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
      preflight: { available: true, willSucceed: true, balanceChanges: [] },
    });
    mockCreate.mockResolvedValue(liveProposal({ createdByUserId: 'user-2' }));

    const res = await compose('user-2');

    expect(res.status).toBe(201);
    expect(mockCreate.mock.calls[0][0].data.createdByUserId).toBe('user-2');
  });

  /**
   * THE SEVEN-DAY EXIT A STRANGER COULD CLOSE.
   * A council's signer addresses are on the public ledger; `POST /api/wallets/connect`
   * writes any address with no signature. So «member» by wallet row meant anyone who
   * read the inbox could publish a proposal on somebody else's council and hold its
   * only Sequence for a week. The row is not consulted at all any more.
   */
  test('a `wallet` row is NOT membership; the same address, proven, composes', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockWalletFindMany.mockResolvedValue([{ address: MEMBER_B }]); // registered, never signed
    holdsSeats([]);

    const refused = await compose('typed-it-in');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(refused.body.detail).toContain('PROVEN address');
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();

    // The very same seat, once the session has PROVEN it, opens the door.
    holdsSeats([MEMBER_B]);
    mockPrepare.mockResolvedValue({
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7, SigningPubKey: '' },
      council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
      fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
      preflight: { available: true, willSucceed: true, balanceChanges: [] },
    });
    mockCreate.mockResolvedValue(liveProposal({ createdByUserId: 'typed-it-in' }));
    expect((await compose('typed-it-in')).status).toBe(201);
  });

  test('an account with no SignerList → 409 NOT_A_COUNCIL, before any registry read', async () => {
    mockSignerCouncil.mockResolvedValue(null);
    const res = await compose();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NOT_A_COUNCIL');
    expect(mockProvenAddresses).not.toHaveBeenCalled();
    expect(mockProveMembership).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('an unreadable ledger → 502, nothing composed — "could not read" is never "you are a stranger"', async () => {
    mockSignerCouncil.mockRejectedValue(new Error('websocket down'));
    const res = await compose();
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('COUNCIL_READ_FAILED');
    expect(mockProvenAddresses).not.toHaveBeenCalled();
    expect(mockProveMembership).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('POST /:id/signatures — verified blobs only', () => {
  test('member blob passes the verifier → stored; quorum weight flips status to ready', async () => {
    mockFindUnique.mockResolvedValue(liveProposal());
    mockVerifyBlob.mockReturnValue({ signer: MEMBER_A });
    mockSigUpsert.mockResolvedValue({});
    mockSigFindMany.mockResolvedValue([
      { signerAccount: MEMBER_A, weight: 1 },
      { signerAccount: MEMBER_B, weight: 1 },
    ]);
    mockUpdate.mockResolvedValue({});

    const res = await request(buildApp())
      .post('/api/council/proposals/p1/signatures')
      .send({ signerAccount: MEMBER_A, blobHex: 'AB'.repeat(32) });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    expect(res.body.collectedWeight).toBe(2);
    // The verifier saw the EXACT pinned tx.
    expect(mockVerifyBlob.mock.calls[0][2]).toEqual(liveProposal().txjson);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ready' } }),
    );
  });

  test('a non-member is refused → 403, nothing stored', async () => {
    mockFindUnique.mockResolvedValue(liveProposal());
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/signatures')
      .send({ signerAccount: COUNCIL, blobHex: 'AB'.repeat(32) });
    expect(res.status).toBe(403);
    expect(mockSigUpsert).not.toHaveBeenCalled();
  });

  test('a blob the verifier rejects never lands → 422', async () => {
    mockFindUnique.mockResolvedValue(liveProposal());
    mockVerifyBlob.mockImplementation(() => {
      throw new BlobVerificationError('wrong signer');
    });
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/signatures')
      .send({ signerAccount: MEMBER_A, blobHex: 'AB'.repeat(32) });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('BLOB_REJECTED');
    expect(mockSigUpsert).not.toHaveBeenCalled();
  });

  test('a past-deadline proposal whose seat the LEDGER says is unused is flipped and refuses signatures → 409', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ expiresAt: new Date(Date.now() - 1000) }));
    mockAccountSequence.mockResolvedValue(7); // pinned 7, account still at 7 → never executed
    mockUpdate.mockResolvedValue({});
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/signatures')
      .send({ signerAccount: MEMBER_A, blobHex: 'AB'.repeat(32) });
    expect(res.status).toBe(409);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'expired' } }),
    );
    expect(res.body.ledgerCheck.state).toBe('unused');
    expect(mockSigUpsert).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G1-guard (auditoría Silenciosos · G1 CRÍTICO — pagaba dos veces).
// The old code stamped `expired` at 7 days WITHOUT reading the ledger: a
// proposal that was broadcast but never reported died as "expired", the family
// composed it again with a fresh Sequence, and the council paid twice. Every
// test below fails against that code.
// ─────────────────────────────────────────────────────────────────────────────
describe('G1-guard — the server never calls a proposal expired without reading the ledger', () => {
  const pastDeadline = () =>
    liveProposal({ status: 'ready', expiresAt: new Date(Date.now() - 1000) });

  test('SEQUENCE CONSUMED → never archived as expired; the row keeps its status and says so', async () => {
    mockFindMany.mockResolvedValue([pastDeadline()]);
    mockAccountSequence.mockResolvedValue(9); // pinned 7, account moved past it

    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    // The old code wrote `expired` here — the exact lie that produced the
    // double payment.
    expect(mockUpdate).not.toHaveBeenCalled();
    const [p] = res.body.proposals;
    expect(p.status).toBe('ready');
    expect(p.ledgerCheck).toMatchObject({
      state: 'consumed',
      deadlinePassed: true,
      pinnedSequence: 7,
      accountSequence: 9,
    });
    expect(p.ledgerCheck.detail).toContain('never be broadcast again');
  });

  test('LEDGER UNREADABLE → unverified, nothing written, and it says the read failed', async () => {
    mockFindMany.mockResolvedValue([pastDeadline()]);
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));

    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
    const [p] = res.body.proposals;
    expect(p.status).toBe('ready');
    expect(p.ledgerCheck.state).toBe('unverified');
    expect(p.ledgerCheck.reason).toContain('LEDGER_READ_FAILED');
    expect(p.ledgerCheck.reason).toContain('websocket down');
  });

  test('SEQUENCE UNUSED → the word "expired" is finally true, so it is written once', async () => {
    mockFindMany.mockResolvedValue([pastDeadline()]);
    mockAccountSequence.mockResolvedValue(7); // still the pinned seat
    mockUpdate.mockResolvedValue({});

    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { status: 'expired' } }),
    );
    const [p] = res.body.proposals;
    expect(p.status).toBe('expired');
    expect(p.ledgerCheck).toMatchObject({ state: 'unused', pinnedSequence: 7, accountSequence: 7 });
  });

  test('no readable pinned Sequence → unverified, never expired (the check cannot be faked)', async () => {
    mockFindMany.mockResolvedValue([
      liveProposal({
        status: 'ready',
        expiresAt: new Date(Date.now() - 1000),
        txjson: { TransactionType: 'Payment', Account: COUNCIL },
      }),
    ]);

    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(mockAccountSequence).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(res.body.proposals[0].ledgerCheck).toMatchObject({
      state: 'unverified',
      reason: 'NO_PINNED_SEQUENCE',
      pinnedSequence: null,
    });
  });

  test('a live proposal still inside its deadline is never checked at all (the read stays cheap)', async () => {
    mockFindMany.mockResolvedValue([liveProposal()]);
    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);
    expect(res.status).toBe(200);
    expect(mockAccountSequence).not.toHaveBeenCalled();
    expect(res.body.proposals[0].ledgerCheck).toBeUndefined();
  });

  test('several past-deadline rows of the same account cost ONE ledger read', async () => {
    mockFindMany.mockResolvedValue([
      pastDeadline(),
      { ...pastDeadline(), id: 'p2' },
      { ...pastDeadline(), id: 'p3' },
    ]);
    mockAccountSequence.mockResolvedValue(9);
    await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);
    expect(mockAccountSequence).toHaveBeenCalledTimes(1);
  });

  test('status=live still excludes a past-deadline row the server could not archive', async () => {
    mockFindMany.mockResolvedValue([pastDeadline()]);
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));
    const res = await request(buildApp()).get(
      `/api/council/proposals?accounts=${COUNCIL}&status=live`,
    );
    expect(res.body.proposals).toHaveLength(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a consumed seat refuses new signatures (409) and hands over the ledger verdict', async () => {
    mockFindUnique.mockResolvedValue(pastDeadline());
    mockAccountSequence.mockResolvedValue(9);
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/signatures')
      .send({ signerAccount: MEMBER_A, blobHex: 'AB'.repeat(32) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PROPOSAL_NOT_LIVE');
    expect(res.body.ledgerCheck.state).toBe('consumed');
    expect(mockSigUpsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the a-posteriori hash registration still works past the deadline (the recovery door)', async () => {
    // The whole point: a proposal broadcast but never reported must still be
    // recordable days later. Blind archiving used to make this a 409.
    mockFindUnique.mockResolvedValue(pastDeadline());
    mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted', txHash: 'A'.repeat(64) }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'A'.repeat(64) });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'submitted', txHash: 'A'.repeat(64) } }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G1-cadena — the verdict has to REACH the moment of decision.
//
// Round 1 read the ledger and stopped the server lying. It left three doors
// open, and every test below fails against THAT code (not against the code of
// two rounds ago):
//   · compose: the day after the deadline `POST /` opened anyway, silent about
//     a seat that may already have paid;
//   · withdraw: read `row.status` raw and walked around the guard entirely;
//   · latency: only SUCCESS was cached, so an XRPL outage cost one 4s timeout
//     per row.
// ─────────────────────────────────────────────────────────────────────────────
describe('G1-cadena — composing over an unresolved seat is stopped BEFORE the money moves', () => {
  const staleRow = (overrides: Record<string, unknown> = {}) =>
    liveProposal({ status: 'ready', expiresAt: new Date(Date.now() - 1000), ...overrides });

  function readyToPrepare() {
    mockPrepare.mockResolvedValue({
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11, SigningPubKey: '' },
      council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
      fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
      preflight: { available: true, willSucceed: true, balanceChanges: [] },
    });
    mockCreate.mockResolvedValue(liveProposal());
  }

  test('a CONSUMED prior seat blocks the new proposal and hands back the verdict', async () => {
    mockFindFirst.mockResolvedValue(null); // nothing live inside its deadline
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockResolvedValue(9); // pinned 7, account moved past it
    readyToPrepare();

    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL } });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(res.body.proposalId).toBe('p1');
    expect(res.body.ledgerCheck.state).toBe('consumed');
    expect(res.body.detail).toContain('pays twice');
    // Nothing was pinned: no second Sequence exists to be signed.
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('an UNREADABLE ledger blocks it too — "we could not check" is never "it is fine"', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));
    readyToPrepare();

    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL } });

    expect(res.status).toBe(422);
    expect(res.body.ledgerCheck.state).toBe('unverified');
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  test('an UNUSED prior seat is genuinely expired: it is archived and the compose proceeds', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockResolvedValue(7); // still the pinned seat → never executed
    mockUpdate.mockResolvedValue({});
    readyToPrepare();

    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL } });

    expect(res.status).toBe(201);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { status: 'expired' } }),
    );
    expect(mockPrepare).toHaveBeenCalled();
  });

  test('with no stale rows at all the compose is untouched (the guard costs no ledger read)', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockFindMany.mockResolvedValue([]);
    readyToPrepare();
    const res = await request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL } });
    expect(res.status).toBe(201);
    expect(mockAccountSequence).not.toHaveBeenCalled();
  });
});

describe('G1-cadena — withdraw no longer walks around the guard', () => {
  const consumedRow = () =>
    liveProposal({ status: 'ready', expiresAt: new Date(Date.now() - 1000) });

  test('filing a CONSUMED seat as withdrawn is refused: "withdrawn" would mean it never happened', async () => {
    mockFindUnique.mockResolvedValue(consumedRow());
    mockAccountSequence.mockResolvedValue(9);
    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('LEDGER_CHECK_UNACKNOWLEDGED');
    expect(res.body.ledgerCheck.state).toBe('consumed');
    expect(res.body.detail).toContain('register its transaction hash');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('an UNREADABLE ledger refuses it as well — nothing is archived on a failed read', async () => {
    mockFindUnique.mockResolvedValue(consumedRow());
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));
    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');
    expect(res.status).toBe(409);
    expect(res.body.ledgerCheck.state).toBe('unverified');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the proposer may file it by ACKNOWLEDGING the check — a human statement, never our inference', async () => {
    mockFindUnique.mockResolvedValue(consumedRow());
    mockAccountSequence.mockResolvedValue(9);
    mockUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { status: 'withdrawn' } }),
    );
  });

  test('inside its deadline withdraw is unchanged, and costs no ledger read', async () => {
    mockFindUnique.mockResolvedValue(liveProposal());
    mockUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    const res = await request(buildApp()).post('/api/council/proposals/p1/withdraw');
    expect(res.status).toBe(200);
    expect(mockAccountSequence).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'withdrawn' } }),
    );
  });
});

describe('G1-cadena — a dead XRPL must not hang the inbox', () => {
  test('an UNREADABLE ledger costs ONE read for the whole listing, not one per row', async () => {
    // Round 1 cached only the RESOLVED sequence, so every row paid its own 4s
    // timeout: 100 rows ≈ 400s of a screen that never opens.
    mockFindMany.mockResolvedValue(
      ['p1', 'p2', 'p3', 'p4'].map((id) => liveProposal({ id, status: 'ready', expiresAt: new Date(Date.now() - 1000) })),
    );
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));
    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);
    expect(res.status).toBe(200);
    expect(mockAccountSequence).toHaveBeenCalledTimes(1);
    expect(res.body.proposals).toHaveLength(4);
    for (const p of res.body.proposals) expect(p.ledgerCheck.state).toBe('unverified');
  });
});

describe('GET / — the inbox read', () => {
  test('requires accounts param', async () => {
    const res = await request(buildApp()).get('/api/council/proposals');
    expect(res.status).toBe(400);
  });

  test('lists proposals for the asked accounts', async () => {
    mockFindMany.mockResolvedValue([liveProposal()]);
    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);
    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(mockFindMany.mock.calls[0][0].where.account.in).toEqual([COUNCIL]);
  });
});

describe('POST /:id/positions — the acta, signed for real', () => {
  // A REAL XRPL keypair: the proof chain (sign → decode → verify → derive →
  // memo commitment) runs end-to-end, no mocks in the crypto.
  const seed = generateSeed();
  const { publicKey, privateKey } = deriveKeypair(seed);
  const memberAddress = kpDeriveAddress(publicKey);
  const proposalWithMember = () =>
    liveProposal({ signerList: [{ account: memberAddress, weight: 1 }, ...SIGNERS] });

  function contentFor(stance: string, comment?: string) {
    return JSON.stringify({
      kind: 'astryum-council-position/v1',
      proposalId: 'p1',
      account: COUNCIL,
      member: memberAddress,
      stance,
      ...(comment !== undefined ? { comment } : {}),
      at: '2026-07-18T10:00:00.000Z',
    });
  }

  function signProof(contentJson: string, keys = { publicKey, privateKey }, account = memberAddress) {
    const contentHash = crypto.createHash('sha256').update(contentJson, 'utf8').digest('hex');
    const memo = `astryum-council-position:${contentHash}`;
    const tx = {
      TransactionType: 'AccountSet',
      Account: account,
      SigningPubKey: keys.publicKey,
      Memos: [{ Memo: { MemoData: Buffer.from(memo, 'utf8').toString('hex').toUpperCase() } }],
    };
    const TxnSignature = kpSign(encodeForSigning(tx as never), keys.privateKey);
    return encode({ ...tx, TxnSignature } as never);
  }

  test('a genuinely signed position is stored, immutable fields intact', async () => {
    mockFindUnique.mockResolvedValue(proposalWithMember());
    mockPosFindUnique.mockResolvedValue(null);
    mockPosCreate.mockImplementation((arg: { data: unknown }) => Promise.resolve({ id: 'pos1', ...(arg.data as object) }));

    const contentJson = contentFor('against', 'Demasiado pronto.');
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions')
      .send({ memberAccount: memberAddress, stance: 'against', comment: 'Demasiado pronto.', contentJson, blobHex: signProof(contentJson) });

    expect(res.status).toBe(201);
    const data = mockPosCreate.mock.calls[0][0].data;
    expect(data.stance).toBe('against');
    expect(data.signingPubKey).toBe(publicKey);
    expect(data.contentHash).toBe(crypto.createHash('sha256').update(contentJson, 'utf8').digest('hex'));
  });

  test('signed content that disagrees with the submitted stance → 400, nothing stored', async () => {
    mockFindUnique.mockResolvedValue(proposalWithMember());
    const contentJson = contentFor('for');
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions')
      .send({ memberAccount: memberAddress, stance: 'against', contentJson, blobHex: signProof(contentJson) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CONTENT_MISMATCH');
    expect(mockPosCreate).not.toHaveBeenCalled();
  });

  test('a blob signed by a DIFFERENT key is rejected → 422', async () => {
    mockFindUnique.mockResolvedValue(proposalWithMember());
    mockPosFindUnique.mockResolvedValue(null);
    const otherSeed = generateSeed();
    const other = deriveKeypair(otherSeed);
    const contentJson = contentFor('for');
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions')
      .send({
        memberAccount: memberAddress,
        stance: 'for',
        contentJson,
        blobHex: signProof(contentJson, { publicKey: other.publicKey, privateKey: other.privateKey }),
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('POSITION_PROOF_REJECTED');
    expect(mockPosCreate).not.toHaveBeenCalled();
  });

  test('a position, once fixed, is immutable → 409 on a second attempt', async () => {
    mockFindUnique.mockResolvedValue(proposalWithMember());
    mockPosFindUnique.mockResolvedValue({ id: 'pos1' });
    const contentJson = contentFor('abstain');
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions')
      .send({ memberAccount: memberAddress, stance: 'abstain', contentJson, blobHex: signProof(contentJson) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('POSITION_ALREADY_SET');
    expect(mockPosCreate).not.toHaveBeenCalled();
  });
});

describe('positions batch anchor — 1-drop Payment, integrity already carried by each signature', () => {
  test('no positions → nothing to anchor (409)', async () => {
    mockFindUnique.mockResolvedValue({ ...liveProposal(), positions: [] });
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchor/prepare')
      .send({ emitterAccount: MEMBER_A });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_POSITIONS_TO_ANCHOR');
  });

  test('prepares the unsigned 1-drop Payment with the batch hash in the memo', async () => {
    mockFindUnique.mockResolvedValue({
      ...liveProposal(),
      positions: [{ contentHash: 'bb'.repeat(32) }, { contentHash: 'aa'.repeat(32) }],
    });
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchor/prepare')
      .send({ emitterAccount: MEMBER_A });
    expect(res.status).toBe(200);
    expect(res.body.positionsCount).toBe(2);
    expect(res.body.xrplTx.TransactionType).toBe('Payment');
    expect(res.body.xrplTx.Account).toBe(MEMBER_A);
    expect(res.body.xrplTx.Destination).toBe(COUNCIL);
    expect(res.body.xrplTx.Amount).toBe('1');
    const expectedBatch = crypto
      .createHash('sha256')
      .update(['aa'.repeat(32), 'bb'.repeat(32)].join('\n'), 'utf8')
      .digest('hex');
    expect(res.body.batchHash).toBe(expectedBatch);
    const memoText = Buffer.from(res.body.xrplTx.Memos[0].Memo.MemoData, 'hex').toString('utf8');
    expect(memoText).toBe(`astryum-council-acta/v1:${expectedBatch}`);
  });

  test('already anchored → 409 with the existing hash', async () => {
    mockFindUnique.mockResolvedValue({
      ...liveProposal(),
      positions: [{ contentHash: 'aa'.repeat(32) }],
      positionsAnchor: 'DEADBEEF',
    });
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchor/prepare')
      .send({ emitterAccount: MEMBER_A });
    expect(res.status).toBe(409);
    expect(res.body.txHash).toBe('DEADBEEF');
  });
});

describe('POST /:id/submitted + /:id/withdraw', () => {
  test('submitted before quorum → 409 QUORUM_NOT_MET', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'collecting' }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'A'.repeat(64) });
    expect(res.status).toBe(409);
  });

  test('submitted when ready records the browser-reported hash', async () => {
    const HASH = 'ABCDEF1234567890'.repeat(4); // 64 hex — what a ledger hash IS
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted', txHash: HASH }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: HASH });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'submitted', txHash: HASH } }),
    );
  });

  // Iteration 2 — read, never trust: a string shaped like a hash is not a report.
  test('a hash the ledger does not have (or has not validated) → 409, nothing recorded', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    mockXrplJsonRpc.mockRejectedValue(new Error('txnNotFound'));
    const notFound = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'B'.repeat(64) });
    expect(notFound.status).toBe(409);
    expect(notFound.body.error).toBe('TX_NOT_VALIDATED');

    mockXrplJsonRpc.mockResolvedValue({ validated: false, Account: COUNCIL, Sequence: 7 });
    const unvalidated = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'B'.repeat(64) });
    expect(unvalidated.status).toBe(409);
    expect(unvalidated.body.error).toBe('TX_NOT_VALIDATED');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a validated tx of ANOTHER account, or at another Sequence, is not this proposal's → 409", async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    mockXrplJsonRpc.mockResolvedValue({ validated: true, Account: MEMBER_A, Sequence: 7 });
    const otherAccount = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'C'.repeat(64) });
    expect(otherAccount.status).toBe(409);
    expect(otherAccount.body.error).toBe('TX_NOT_THIS_PROPOSAL');

    // api_version 2 shape: the tx fields nested in tx_json.
    mockXrplJsonRpc.mockResolvedValue({ validated: true, tx_json: { Account: COUNCIL, Sequence: 8 } });
    const otherSequence = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'C'.repeat(64) });
    expect(otherSequence.status).toBe(409);
    expect(otherSequence.body.error).toBe('TX_NOT_THIS_PROPOSAL');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // Validated is not paid: a tec* burns the Sequence and the
  // fee and moves nothing, yet matched account + Sequence and was recorded.
  test('a VALIDATED tec* at the pinned Sequence → 409 TX_FAILED_ON_LEDGER, never marked submitted', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    mockXrplJsonRpc.mockResolvedValue({
      validated: true,
      TransactionType: 'Payment',
      Account: COUNCIL,
      Sequence: 7,
      meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' },
    });

    const res = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'D'.repeat(64) });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TX_FAILED_ON_LEDGER');
    expect(res.body.transactionResult).toBe('tecUNFUNDED_PAYMENT');
    expect(res.body.detail).toContain('tecUNFUNDED_PAYMENT');
    expect(res.body.detail).toContain('nothing moved');
    expect(res.body.detail).toContain('Sequence 7 was spent');
    expect(res.body.detail).toContain('prepared again');
    expect(mockUpdate).not.toHaveBeenCalled();

    // api_version 2 shape: meta beside tx_json.
    mockXrplJsonRpc.mockResolvedValue({
      validated: true,
      tx_json: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 },
      meta: { TransactionResult: 'tecNO_DST_INSUF_XRP' },
    });
    const v2 = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'D'.repeat(64) });
    expect(v2.status).toBe(409);
    expect(v2.body.error).toBe('TX_FAILED_ON_LEDGER');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a validated tx the node returns WITHOUT a result code is not taken as success → 409', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    mockXrplJsonRpc.mockResolvedValue({ validated: true, TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 });
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'D'.repeat(64) });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TX_NOT_VALIDATED');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── The seat is not the transaction ─────────────────────
  // Account + pinned Sequence + tesSUCCESS only proves that SOMETHING of this
  // council used the seat. Every refusal below was a 200 (and, for an order,
  // a launched relay) on the code before this round.
  describe('the reported tx must BE this proposal (type, destination, amount, memos)', () => {
    const MEMO_HEX = Buffer.from('astryum-order/v1:abc', 'utf8').toString('hex').toUpperCase();
    const paymentRow = (txjson: Record<string, unknown> = {}) =>
      liveProposal({
        status: 'ready',
        txjson: {
          TransactionType: 'Payment',
          Account: COUNCIL,
          Sequence: 7,
          Destination: MEMBER_B,
          Amount: '1000000',
          Memos: [{ Memo: { MemoData: MEMO_HEX } }],
          ...txjson,
        },
      });
    const onLedger = (over: Record<string, unknown> = {}) => ({
      validated: true,
      TransactionType: 'Payment',
      Account: COUNCIL,
      Sequence: 7,
      Destination: MEMBER_B,
      Amount: '1000000',
      Memos: [{ Memo: { MemoData: MEMO_HEX.toLowerCase() } }],
      meta: { TransactionResult: 'tesSUCCESS' },
      ...over,
    });
    const report = () =>
      request(buildApp()).post('/api/council/proposals/p1/submitted').send({ txHash: 'E'.repeat(64) });

    test('the same transaction (memo hex in any case) → 200, recorded', async () => {
      mockFindUnique.mockResolvedValue(paymentRow());
      mockXrplJsonRpc.mockResolvedValue(onLedger());
      mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted' }));
      const res = await report();
      expect(res.status).toBe(200);
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    test('api_version 2: tx_json carries the Payment amount as DeliverMax → still the same transaction', async () => {
      mockFindUnique.mockResolvedValue(paymentRow());
      const { Amount, meta, validated, ...fields } = onLedger();
      mockXrplJsonRpc.mockResolvedValue({ validated, meta, tx_json: { ...fields, DeliverMax: Amount } });
      mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted' }));
      const res = await report();
      expect(res.status).toBe(200);
    });

    test('ANOTHER tx type that consumed the pinned seat → 409 TX_NOT_THIS_PROPOSAL, nothing recorded', async () => {
      mockFindUnique.mockResolvedValue(paymentRow());
      mockXrplJsonRpc.mockResolvedValue({
        validated: true,
        TransactionType: 'AccountSet',
        Account: COUNCIL,
        Sequence: 7,
        meta: { TransactionResult: 'tesSUCCESS' },
      });
      const res = await report();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('TX_NOT_THIS_PROPOSAL');
      expect(res.body.detail).toContain('AccountSet');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('another destination → 409', async () => {
      mockFindUnique.mockResolvedValue(paymentRow());
      mockXrplJsonRpc.mockResolvedValue(onLedger({ Destination: MEMBER_A }));
      const res = await report();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('TX_NOT_THIS_PROPOSAL');
      expect(res.body.detail).toContain(MEMBER_A);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('another amount in drops → 409', async () => {
      mockFindUnique.mockResolvedValue(paymentRow());
      mockXrplJsonRpc.mockResolvedValue(onLedger({ Amount: '999999' }));
      const res = await report();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('TX_NOT_THIS_PROPOSAL');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('an IOU amount compares canonically (10.50 ≡ 10.5) but a different issuer or value is refused', async () => {
      const iou = { currency: 'RLS', issuer: MEMBER_A, value: '10.50' };
      mockFindUnique.mockResolvedValue(paymentRow({ Amount: iou }));
      mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted' }));

      mockXrplJsonRpc.mockResolvedValue(onLedger({ Amount: { currency: 'RLS', issuer: MEMBER_A, value: '10.5' } }));
      expect((await report()).status).toBe(200);

      mockUpdate.mockClear();
      mockXrplJsonRpc.mockResolvedValue(onLedger({ Amount: { currency: 'RLS', issuer: MEMBER_B, value: '10.5' } }));
      const otherIssuer = await report();
      expect(otherIssuer.status).toBe(409);
      expect(otherIssuer.body.error).toBe('TX_NOT_THIS_PROPOSAL');

      mockXrplJsonRpc.mockResolvedValue(onLedger({ Amount: { currency: 'RLS', issuer: MEMBER_A, value: '105' } }));
      expect((await report()).status).toBe(409);

      // An XRP drops string where the proposal pays an IOU is not the same tx.
      mockXrplJsonRpc.mockResolvedValue(onLedger({ Amount: '10' }));
      expect((await report()).status).toBe(409);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('different memos (or none) → 409, and an order relay is never launched for it', async () => {
      mockFindUnique.mockResolvedValue(paymentRow());
      mockXrplJsonRpc.mockResolvedValue(
        onLedger({ Memos: [{ Memo: { MemoData: Buffer.from('something else', 'utf8').toString('hex') } }] }),
      );
      const other = await report();
      expect(other.status).toBe(409);
      expect(other.body.error).toBe('TX_NOT_THIS_PROPOSAL');
      expect(other.body.detail).toContain('memos');
      expect(other.body.councilOrder).toBeUndefined();

      const { Memos, ...noMemos } = onLedger();
      mockXrplJsonRpc.mockResolvedValue(noMemos);
      expect((await report()).status).toBe(409);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('a row with NO numeric Sequence no longer accepts any tesSUCCESS tx of the account', async () => {
      // Identity present: a matching tx is accepted, a different one refused.
      const { Sequence, ...unpinned } = (paymentRow().txjson as Record<string, unknown>);
      mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready', txjson: unpinned }));
      mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted' }));
      mockXrplJsonRpc.mockResolvedValue(onLedger({ Sequence: 42 }));
      expect((await report()).status).toBe(200);

      mockUpdate.mockClear();
      mockXrplJsonRpc.mockResolvedValue(onLedger({ Sequence: 43, Destination: MEMBER_A }));
      const different = await report();
      expect(different.status).toBe(409);
      expect(different.body.error).toBe('TX_NOT_THIS_PROPOSAL');
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    test('a row with NO numeric Sequence and nothing else to match on → 409, even for a same-type tx', async () => {
      mockFindUnique.mockResolvedValue(
        liveProposal({ status: 'ready', txjson: { TransactionType: 'AccountSet', Account: COUNCIL } }),
      );
      mockXrplJsonRpc.mockResolvedValue({
        validated: true,
        TransactionType: 'AccountSet',
        Account: COUNCIL,
        Sequence: 99,
        meta: { TransactionResult: 'tesSUCCESS' },
      });
      const res = await report();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('TX_NOT_THIS_PROPOSAL');
      expect(res.body.detail).toContain('pinned no Sequence');
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  test('withdraw by someone other than the proposer → 403', async () => {
    mockFindUnique.mockResolvedValue(liveProposal());
    const res = await request(buildApp('user-2')).post('/api/council/proposals/p1/withdraw');
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
    // The refusal SPEAKS: a bare code is a dead end in front of a family.
    expect(res.body.detail).toContain('only the member who composed it');
    // Inside the deadline the guard costs nothing — no ledger read at all.
    expect(mockAccountSequence).not.toHaveBeenCalled();
  });
});

/**
 * G1-cadena (round 3, finding 3) — THE EXIT THAT DOES NOT DEPEND ON THE PROPOSER.
 *
 * `consumed` is true after ANY later transaction of the account, so a proposal
 * that never gathered its quorum — one that was never assembled into a complete
 * transaction here at all — came back `consumed` and, from that moment, `POST /`
 * answered 422 for ever. Registering a hash needs `ready`; filing needed the
 * proposer. A council whose proposer is not around could never compose again.
 */
describe('G1-cadena — a seat that was never assembled does not hang on one person', () => {
  const staleCollecting = () =>
    liveProposal({ status: 'collecting', expiresAt: new Date(Date.now() - 1000) });

  test('a non-proposer files a past-deadline `collecting` row by acknowledging the check → 200', async () => {
    mockFindUnique.mockResolvedValue(staleCollecting());
    mockAccountSequence.mockResolvedValue(9); // pinned 7 → the seat was used by SOMETHING
    mockUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));

    const res = await request(buildApp('user-2'))
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });

    expect(res.status).toBe(200); // THE REGRESSION: 403 NOT_THE_PROPOSER, for ever
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { status: 'withdrawn' } }),
    );
  });

  test('…but the acknowledgement still is: without it the verdict comes back, in words', async () => {
    mockFindUnique.mockResolvedValue(staleCollecting());
    mockAccountSequence.mockResolvedValue(9);

    const res = await request(buildApp('user-2')).post('/api/council/proposals/p1/withdraw');

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('LEDGER_CHECK_UNACKNOWLEDGED');
    // The prose is the one for a row that was never assembled — it must NOT
    // tell a non-proposer to register a hash the server would refuse (the
    // /submitted door demands `ready`).
    expect(res.body.detail).toContain('never reached its quorum');
    expect(res.body.detail).not.toContain('register its transaction hash');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a past-deadline `ready` row still belongs to its proposer — and says where the other door is', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready', expiresAt: new Date(Date.now() - 1000) }));
    mockAccountSequence.mockResolvedValue(9);

    const res = await request(buildApp('user-2'))
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_THE_PROPOSER');
    expect(res.body.detail).toContain('register its hash instead');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("a `collecting` row INSIDE its deadline is still the proposer's alone", async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'collecting' }));
    const res = await request(buildApp('user-2'))
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the proposer keeps every door: their own past-deadline `ready` row files with the acknowledgement', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready', expiresAt: new Date(Date.now() - 1000) }));
    mockAccountSequence.mockResolvedValue(9);
    mockUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });
    expect(res.status).toBe(200);
  });
});

/**
 * puertas-y-permiso — THE DOORS THAT KNEW NOBODY.
 *
 * `requireLegacyAccess` is the router's only doorman, and with LEGACY_ENABLED
 * it means "any authenticated session" — never "a member of THIS council".
 * Round 3 opened `withdraw` to a non-proposer for a row that never reached its
 * quorum and, doing so, removed the last ownership check on that door: a
 * stranger could file another family's acta as `withdrawn`. `/submitted` was
 * as open before us, and it writes more than a word — the hash becomes the
 * row's ledger truth and launches the FDC relay that spends FLR.
 *
 * These fail on the code as it shipped in adb1e90: both answered 200.
 */
describe('puertas-y-permiso — a council write door only opens for that council', () => {
  const staleCollecting = () =>
    liveProposal({ status: 'collecting', expiresAt: new Date(Date.now() - 1000) });

  test('a stranger cannot file a never-assembled row of a council they are not in → 403', async () => {
    mockFindUnique.mockResolvedValue(staleCollecting());
    mockAccountSequence.mockResolvedValue(9);
    holdsSeats([]); // owns none of this signer list

    const res = await request(buildApp('stranger'))
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the round-3 exit stays open for a MEMBER, and it is asked about THIS signer list', async () => {
    mockFindUnique.mockResolvedValue(staleCollecting());
    mockAccountSequence.mockResolvedValue(9);
    holdsSeats([MEMBER_B]);
    mockUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));

    const res = await request(buildApp('user-2'))
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });

    expect(res.status).toBe(200);
    // Asked of the PROOF, with this session's id and its signed-in address.
    expect(mockProveMembership).toHaveBeenCalledWith('user-2', expect.anything(), expect.anything(), 'entry');
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { status: 'withdrawn' } }),
    );
  });

  test('the proposer keeps their own door, and it costs no registry read', async () => {
    mockFindUnique.mockResolvedValue(staleCollecting());
    mockAccountSequence.mockResolvedValue(9);
    holdsSeats([]); // no wallet row at all
    mockUpdate.mockResolvedValue(liveProposal({ status: 'withdrawn' }));

    const res = await request(buildApp()) // USER_ID composed it
      .post('/api/council/proposals/p1/withdraw')
      .send({ acknowledgeLedgerCheck: true });

    expect(res.status).toBe(200);
    expect(mockProvenAddresses).not.toHaveBeenCalled();
    expect(mockProveMembership).not.toHaveBeenCalled();
  });

  test('a stranger cannot stamp a hash on another council acta → 403, no relay', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    holdsSeats([]);

    const res = await request(buildApp('stranger'))
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'A'.repeat(64) });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the a-posteriori hash door stays open to ANY member — the doctrine withdraw already states', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    holdsSeats([MEMBER_B]);
    mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted', txHash: 'A'.repeat(64) }));

    const res = await request(buildApp('user-2'))
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'A'.repeat(64) });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'submitted', txHash: 'A'.repeat(64) } }),
    );
  });

  test('no session at all is refused before anything is read', async () => {
    const res = await request(buildApp(null))
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'A'.repeat(64) });
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

/**
 * permisos-y-doble-pago — THE DOOR THAT KNEW NOBODY, STILL.
 *
 * Round 3 gave `/submitted` and `/withdraw` an ownership floor and named
 * `/positions/anchored` as out of scope. It reads no session at ALL and stamps
 * a txHash — the acta's on-chain proof — onto ANY row in the table: a stranger
 * could point another family's record at a transaction of their choosing, and
 * FormalPositions renders it as "anchored on-chain" with a link to XRPScan.
 *
 * These fail on the code as it shipped in d533b67: 200 for the stranger, 200
 * with no session.
 */
describe('permisos-y-doble-pago — the acta anchor is recorded by that council only', () => {
  const anchorable = (o: Record<string, unknown> = {}) =>
    liveProposal({ status: 'submitted', positionsAnchor: null, positions: POSITIONS, ...o });
  // The recorded hash is read off the ledger — here, the real anchor.
  beforeEach(() => mockXrplJsonRpc.mockResolvedValue(anchorOnLedger()));

  test('a stranger cannot stamp an anchor hash on another council acta → 403', async () => {
    mockFindUnique.mockResolvedValue(anchorable());
    holdsSeats([]); // owns none of this signer list

    const res = await request(buildApp('stranger'))
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'B'.repeat(64) });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a member of THIS council records it, and the registry is asked about THIS signer list', async () => {
    mockFindUnique.mockResolvedValue(anchorable());
    holdsSeats([MEMBER_B]);
    mockUpdate.mockResolvedValue(anchorable({ positionsAnchor: 'B'.repeat(64) }));

    const res = await request(buildApp('user-2'))
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'B'.repeat(64) });

    expect(res.status).toBe(200);
    // Asked of the PROOF, with this session's id and its signed-in address.
    expect(mockProveMembership).toHaveBeenCalledWith('user-2', expect.anything(), expect.anything(), 'entry');
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { positionsAnchor: 'B'.repeat(64) } }),
    );
  });

  test('the proposer keeps their own door, and it costs no registry read', async () => {
    mockFindUnique.mockResolvedValue(anchorable());
    holdsSeats([]); // no wallet row at all
    mockUpdate.mockResolvedValue(anchorable({ positionsAnchor: 'B'.repeat(64) }));

    const res = await request(buildApp()) // USER_ID composed it
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'B'.repeat(64) });

    expect(res.status).toBe(200);
    expect(mockProvenAddresses).not.toHaveBeenCalled();
    expect(mockProveMembership).not.toHaveBeenCalled();
  });

  test('no session at all is refused before anything is read', async () => {
    const res = await request(buildApp(null))
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'B'.repeat(64) });
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

/**
 * g1-ceremonia — THE SEAT THE CEREMONY HOLDS, SEEN FROM THE ASYNC DOOR.
 *
 * `POST /api/xrpl-defi/multisign/prepare` pins a Sequence and (until this
 * round) wrote nothing anywhere, so this door found nothing live and pinned the
 * same Sequence one click later. The ceremony now leaves a short lease; here is
 * the consumer of it, and every one of the lease's releases.
 *
 * These fail on the code as it shipped in 256a6b0: 201, with a second payload
 * pinned on the seat a sitting was already using.
 */
describe('g1-ceremonia — a ceremony in flight holds the seat against the inbox', () => {
  const leaseRow = (over: Record<string, unknown> = {}) => ({
    data: {
      account: COUNCIL,
      pinnedSequence: 7,
      txType: 'Payment',
      preparedAt: new Date(Date.now() - 60_000).toISOString(),
      preparedByUserId: 'user-9',
    },
    expiresAt: new Date(Date.now() + 20 * 60_000),
    ...over,
  });

  function composeRequest() {
    return request(buildApp())
      .post('/api/council/proposals')
      .send({ account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL } });
  }

  test('a live ceremony refuses the compose (422) and NOTHING is pinned', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCacheFindUnique.mockResolvedValue(leaseRow());
    mockAccountSequence.mockResolvedValue(7); // the seat is still unused

    const res = await composeRequest();

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('CEREMONY_IN_FLIGHT');
    expect(res.body.ceremonySeat.pinnedSequence).toBe(7);
    expect(res.body.ceremonySeat.ledgerSeat).toBe('unused');
    // It SPEAKS: the seat, the danger and the way out.
    expect(res.body.detail).toContain('Sequence 7');
    expect(res.body.detail).toContain('pays twice');
    expect(res.body.detail).toContain('30 minutes');
    // THE POINT: no second Sequence was ever fixed for this council.
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('release #2 — the ledger consumed that seat: the lease is deleted and the compose goes on', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCacheFindUnique.mockResolvedValue(leaseRow());
    mockAccountSequence.mockResolvedValue(9); // pinned 7 → already burnt
    mockPrepare.mockResolvedValue({
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 9, SigningPubKey: '' },
      council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
      fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
      preflight: { available: true, willSucceed: true, balanceChanges: [] },
    });
    mockCreate.mockResolvedValue(liveProposal());

    const res = await composeRequest();

    expect(res.status).toBe(201);
    expect(mockCacheDeleteMany).toHaveBeenCalledWith({
      where: { cacheKey: `council-ceremony-seat:${COUNCIL}` },
    });
  });

  test('release #1 — a lease past its deadline is deleted, never honoured', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCacheFindUnique.mockResolvedValue(leaseRow({ expiresAt: new Date(Date.now() - 1000) }));
    mockPrepare.mockResolvedValue({
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 9, SigningPubKey: '' },
      council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
      fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
      preflight: { available: true, willSucceed: true, balanceChanges: [] },
    });
    mockCreate.mockResolvedValue(liveProposal());

    const res = await composeRequest();

    expect(res.status).toBe(201);
    // An expired lease is not even worth a ledger read.
    expect(mockAccountSequence).not.toHaveBeenCalled();
    expect(mockCacheDeleteMany).toHaveBeenCalledWith({
      where: { cacheKey: `council-ceremony-seat:${COUNCIL}` },
    });
  });

  test('an UNREADABLE ledger keeps the lease — the trace is ours, and it still expires on its own', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCacheFindUnique.mockResolvedValue(leaseRow());
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));

    const res = await composeRequest();

    expect(res.status).toBe(422);
    expect(res.body.ceremonySeat.ledgerSeat).toBe('unreadable');
    // "We could not read" is said as OUR failure, never as a verdict.
    expect(res.body.detail).toContain('a failure of ours');
    expect(mockPrepare).not.toHaveBeenCalled();
    // Nothing is deleted on a failed read.
    expect(mockCacheDeleteMany).not.toHaveBeenCalled();
  });

  test('a lease store that cannot be read leaves the OTHER guards standing', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCacheFindUnique.mockRejectedValue(new Error('cache table gone'));
    mockFindMany.mockResolvedValue([
      liveProposal({ status: 'ready', expiresAt: new Date(Date.now() - 1000) }),
    ]);
    mockAccountSequence.mockResolvedValue(9); // the stale seat WAS consumed
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await composeRequest();

    // The unresolved-seat guard still refuses: losing the lease store must
    // never take protection away, only fail to add it.
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(mockPrepare).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('with no lease at all the compose is untouched, and costs no ledger read', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockPrepare.mockResolvedValue({
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7, SigningPubKey: '' },
      council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
      fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
      preflight: { available: true, willSucceed: true, balanceChanges: [] },
    });
    mockCreate.mockResolvedValue(liveProposal());

    const res = await composeRequest();

    expect(res.status).toBe(201);
    expect(mockAccountSequence).not.toHaveBeenCalled();
  });
});

/**
 * g1-ceremonia — THE PERMISSION HOLE THAT WAS A READ.
 *
 * `GET /` and `GET /:id` had no ownership check at all: any authenticated
 * Legacy session could ask for any council's account and receive the signer
 * list, the pinned txjson with its amounts and destinations, every member's
 * formal position — and on the detail route the signed blobs themselves.
 *
 * These fail on the code as it shipped in 256a6b0: 200, with the whole acta.
 */
describe('g1-ceremonia — the inbox is readable by its own council', () => {
  test('a stranger asking for another family acta gets 403, not an empty inbox', async () => {
    mockFindMany.mockResolvedValue([liveProposal()]);
    holdsSeats([]); // owns none of this signer list

    const res = await request(buildApp('stranger')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(res.body.proposals).toBeUndefined();
  });

  test('a MEMBER reads it, and the registry is asked ONCE for the whole listing', async () => {
    mockFindMany.mockResolvedValue([liveProposal(), liveProposal({ id: 'p2' })]);
    holdsSeats([MEMBER_B]);

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(2);
    // The READ asks the DETAILED proof (the one that can say «I could
    // not read»), still ONCE for the whole listing.
    expect(mockProveMembership).toHaveBeenCalledTimes(1);
    // Asked of the PROOF, with this session's id and its signed-in address.
    expect(mockProveMembership).toHaveBeenCalledWith('user-2', expect.anything(), expect.anything(), 'exit');
    // A READ also consults the registry — once for the whole listing,
    // never once per row. These bytes are the only ones a cosignatory can sign.
    expect(mockWalletFindMany).toHaveBeenCalledTimes(1);
  });

  /**
   * A SIGNER THE REGISTRY KNOWS AND THE PROOF DOES NOT.
   *
   * The bytes a councillor signs come ONLY from these two reads. Closed them
   * to a proven address, so a cosignatory who sits on the SignerList but never signed
   * a binding could not read the exit proposal, could not sign it, and the quorum was
   * never reached: a registry narrowing a way out. Reading (and therefore signing) is
   * open to any address the session holds; every WRITE keeps the proof.
   */
  test('a cosignatory known only to the registry READS the proposal — and the blobs on the detail route', async () => {
    mockFindMany.mockResolvedValue([liveProposal()]);
    holdsSeats([]); // nothing proven at all
    mockWalletFindMany.mockResolvedValue([{ address: MEMBER_A }]);

    const listing = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);
    expect(listing.status).toBe(200);
    expect(listing.body.proposals).toHaveLength(1);

    mockFindUnique.mockResolvedValue(liveProposal());
    const detail = await request(buildApp('user-2')).get('/api/council/proposals/p1');
    expect(detail.status).toBe(200);
    expect(detail.body.proposal.id).toBe('p1');
  });

  test('a registry read that FAILS never takes the proven floor away', async () => {
    mockFindMany.mockResolvedValue([liveProposal()]);
    holdsSeats([MEMBER_A]);
    mockWalletFindMany.mockRejectedValue(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    warn.mockRestore();
  });

  test('a mixed listing hands back only the rows that belong to this session', async () => {
    const foreign = liveProposal({
      id: 'p-foreign',
      createdByUserId: 'someone-else',
      signerList: [{ account: 'rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY', weight: 1 }],
    });
    mockFindMany.mockResolvedValue([liveProposal({ createdByUserId: 'someone-else' }), foreign]);
    holdsSeats([MEMBER_A]);

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    expect(res.body.proposals.map((p: { id: string }) => p.id)).toEqual(['p1']);
  });

  test('the filter runs BEFORE the ledger: a stranger never spends our account_info calls', async () => {
    mockFindMany.mockResolvedValue([
      liveProposal({ createdByUserId: 'someone-else', expiresAt: new Date(Date.now() - 1000) }),
    ]);
    holdsSeats([]);

    const res = await request(buildApp('stranger')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(403);
    expect(mockAccountSequence).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('an account with no proposals is still an empty inbox, not a refusal', async () => {
    mockFindMany.mockResolvedValue([]);
    holdsSeats([]);

    const res = await request(buildApp('stranger')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toEqual([]);
  });

  test('GET /:id — a stranger cannot read the blobs of another council', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    holdsSeats([]);

    const res = await request(buildApp('stranger')).get('/api/council/proposals/p1');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    expect(res.body.proposal).toBeUndefined();
  });

  test('GET /:id — a member of THIS council still gets the full detail', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    holdsSeats([MEMBER_B]);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(200);
    expect(res.body.proposal.id).toBe('p1');
  });

  test('GET /:id — a proposal that does not exist is 404 before anything else', async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await request(buildApp('stranger')).get('/api/council/proposals/nope');

    expect(res.status).toBe(404);
    expect(mockProvenAddresses).not.toHaveBeenCalled();
    expect(mockProveMembership).not.toHaveBeenCalled();
  });

  test('no session at all is refused on both read doors', async () => {
    const list = await request(buildApp(null)).get(`/api/council/proposals?accounts=${COUNCIL}`);
    const detail = await request(buildApp(null)).get('/api/council/proposals/p1');

    expect(list.status).toBe(401);
    expect(detail.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

/**
 * g1-ceremonia — THE ANCHOR: THE VERDICT USED TO ARRIVE AFTER THE
 * LEDGER HAD BEEN SPENT.
 *
 * The flow is prepare → the emitter signs and BROADCASTS on XRPL →
 * `/positions/anchored`. Only that last call checked who was asking, so a
 * stranger paid the drop and the fee first and was refused afterwards — and
 * with `positionsAnchor` still null the button offered itself again: a loop of
 * anchors paid for and never recorded.
 */
describe('g1-ceremonia — the acta anchor is composed for that council only', () => {
  test('a stranger is refused BEFORE any unsigned tx is composed', async () => {
    mockFindUnique.mockResolvedValue({
      ...liveProposal({ createdByUserId: 'someone-else' }),
      positions: [{ contentHash: 'aa'.repeat(32) }],
    });
    holdsSeats([]);

    const res = await request(buildApp('stranger'))
      .post('/api/council/proposals/p1/positions/anchor/prepare')
      .send({ emitterAccount: MEMBER_A });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
    // THE POINT: nothing to sign came back, so nothing could be spent.
    expect(res.body.xrplTx).toBeUndefined();
    expect(res.body.batchHash).toBeUndefined();
  });

  test('a MEMBER of this council still composes the anchor', async () => {
    mockFindUnique.mockResolvedValue({
      ...liveProposal({ createdByUserId: 'someone-else' }),
      positions: [{ contentHash: 'aa'.repeat(32) }],
    });
    holdsSeats([MEMBER_B]);

    const res = await request(buildApp('user-2'))
      .post('/api/council/proposals/p1/positions/anchor/prepare')
      .send({ emitterAccount: MEMBER_B });

    expect(res.status).toBe(200);
    expect(res.body.xrplTx.Account).toBe(MEMBER_B);
  });

  test('no session at all is refused before the proposal is even read', async () => {
    const res = await request(buildApp(null))
      .post('/api/council/proposals/p1/positions/anchor/prepare')
      .send({ emitterAccount: MEMBER_A });

    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

/**
 * g1-ceremonia — THE TWO HALVES OF THE ANCHOR DISAGREED.
 *
 * `prepare` refuses to compose a second anchor (409 ALREADY_ANCHORED) while
 * `/anchored` OVERWROTE the stored hash without a word: the acta's on-chain
 * proof could be repointed at any transaction, and the surface would render the
 * new one as if it had always been it. `prepare` is the half that was right.
 */
describe('g1-ceremonia — an anchored acta is not repointed', () => {
  const anchored = (hash: string) =>
    liveProposal({ status: 'submitted', positionsAnchor: hash });

  test('a DIFFERENT hash over an existing anchor → 409, and nothing is written', async () => {
    mockFindUnique.mockResolvedValue(anchored('A'.repeat(64)));

    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'B'.repeat(64) });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ALREADY_ANCHORED');
    expect(res.body.txHash).toBe('A'.repeat(64)); // the one that stands
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the SAME hash reported twice is idempotent, not an error', async () => {
    mockFindUnique.mockResolvedValue(anchored('A'.repeat(64)));

    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'A'.repeat(64) });

    expect(res.status).toBe(200);
    expect(res.body.proposal.positionsAnchor).toBe('A'.repeat(64));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the first anchor is still recorded normally', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'submitted', positionsAnchor: null, positions: POSITIONS }));
    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger());
    mockUpdate.mockResolvedValue(anchored('B'.repeat(64)));

    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'B'.repeat(64) });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { positionsAnchor: 'B'.repeat(64) } }),
    );
  });
});

/**
 * arriendo-ceremonia — THE ANCHOR BECAME IMMUTABLE WITHOUT A FLOOR.
 *
 * `submittedSchema` was `string().min(8).max(128)` and it guards TWO doors.
 * On `/submitted` a wrong hash was a wrong hash; on `/:id/positions/anchored`
 * round 4 made the first write PERMANENT (a second, different hash is refused
 * with 409 ALREADY_ANCHORED), so eight characters of anything — a truncated
 * paste, half a hash — froze themselves as the acta's on-chain proof for ever,
 * and FormalPositions renders it as if it had always been it. The shape floor
 * `/^[0-9A-Fa-f]{64}$/` already existed in this file, on the relay branch of
 * `/submitted`; it is one constant now and both doors read it.
 *
 * These fail on the code as it shipped in 256a6b0: every one of them was 200.
 */
describe('the ledger hash has a SHAPE, and the immutable door is the one that needed it', () => {
  const TRUNCATED = 'A'.repeat(40);

  test('a truncated hash cannot be frozen as the acta anchor', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'submitted', positionsAnchor: null }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: TRUNCATED });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_BODY');
    // The refusal says what a hash looks like — somebody is copying it from an
    // explorer, and a bare code there sends them back with the same paste.
    expect(String(res.body.detail)).toMatch(/64 hexadecimal/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('non-hex is refused too, however long', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'submitted', positionsAnchor: null }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: 'Z'.repeat(64) });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a real 64-hex hash still anchors, upper or lower case, spaces trimmed', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'submitted', positionsAnchor: null, positions: POSITIONS }));
    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger());
    mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted', positionsAnchor: 'b'.repeat(64) }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/positions/anchored')
      .send({ txHash: `  ${'b'.repeat(64)}  ` });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { positionsAnchor: 'b'.repeat(64) } }),
    );
  });

  test('the same floor guards /submitted — the door that launches the FLR relay', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: TRUNCATED });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

/**
 * THE ANCHOR WAS FROZEN WITHOUT BEING READ.
 *
 * `/positions/anchored` recorded any 64-hex string as the acta's on-chain proof,
 * and round 4 made that record immutable. A tec-failed anchor, a typo that
 * happens to be a real hash, or any unrelated Payment became "anchored on-chain"
 * for ever. These fail on the code before this round: every one was 200.
 */
describe('The acta anchor is read off the ledger before it is frozen', () => {
  const HASH = 'E'.repeat(64);
  const unanchored = (o: Record<string, unknown> = {}) =>
    liveProposal({ status: 'submitted', positionsAnchor: null, positions: POSITIONS, ...o });
  const report = () =>
    request(buildApp()).post('/api/council/proposals/p1/positions/anchored').send({ txHash: HASH });

  test('the anchor prepare composed, validated tesSUCCESS → recorded', async () => {
    mockFindUnique.mockResolvedValue(unanchored());
    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger());
    mockUpdate.mockResolvedValue(unanchored({ positionsAnchor: HASH }));

    const res = await report();

    expect(res.status).toBe(200);
    expect(mockXrplJsonRpc).toHaveBeenCalledWith('tx', { transaction: HASH, binary: false });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { positionsAnchor: HASH } }),
    );
  });

  test('api_version 2 shape (tx_json + meta) is read the same', async () => {
    mockFindUnique.mockResolvedValue(unanchored());
    const { meta, validated, ...fields } = anchorOnLedger();
    mockXrplJsonRpc.mockResolvedValue({ validated, meta, tx_json: fields });
    mockUpdate.mockResolvedValue(unanchored({ positionsAnchor: HASH }));
    const res = await report();
    expect(res.status).toBe(200);
  });

  test('a hash the ledger does not have, or has not validated → 409 ANCHOR_NOT_ON_LEDGER, nothing frozen', async () => {
    mockFindUnique.mockResolvedValue(unanchored());
    mockXrplJsonRpc.mockRejectedValue(new Error('txnNotFound'));
    const notFound = await report();
    expect(notFound.status).toBe(409);
    expect(notFound.body.error).toBe('ANCHOR_NOT_ON_LEDGER');

    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger({ validated: false }));
    const pending = await report();
    expect(pending.status).toBe(409);
    expect(pending.body.error).toBe('ANCHOR_NOT_ON_LEDGER');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a tec-failed anchor → 409 ANCHOR_NOT_ON_LEDGER, naming the code', async () => {
    mockFindUnique.mockResolvedValue(unanchored());
    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger({ meta: { TransactionResult: 'tecNO_DST_INSUF_XRP' } }));
    const res = await report();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ANCHOR_NOT_ON_LEDGER');
    expect(res.body.detail).toContain('tecNO_DST_INSUF_XRP');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the memo of ANOTHER set of positions (one filed after prepare) → 409 ANCHOR_MISMATCH', async () => {
    mockFindUnique.mockResolvedValue(unanchored({ positions: [...POSITIONS, { contentHash: 'cc'.repeat(32) }] }));
    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger()); // memo covers only aa+bb
    const res = await report();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ANCHOR_MISMATCH');
    expect(res.body.detail).toContain('prepare it again');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the memo must be EXACT — one that merely contains the fingerprint does not pass', async () => {
    mockFindUnique.mockResolvedValue(unanchored());
    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger({}, `${ACTA_MEMO} + something else`));
    const res = await report();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ANCHOR_MISMATCH');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a Payment to another account, or a tx that is not a Payment → 409 ANCHOR_MISMATCH', async () => {
    mockFindUnique.mockResolvedValue(unanchored());
    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger({ Destination: MEMBER_A }));
    const elsewhere = await report();
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.error).toBe('ANCHOR_MISMATCH');

    mockXrplJsonRpc.mockResolvedValue(anchorOnLedger({ TransactionType: 'AccountSet' }));
    const notPayment = await report();
    expect(notPayment.status).toBe(409);
    expect(notPayment.body.error).toBe('ANCHOR_MISMATCH');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('a proposal with no positions has nothing to anchor → 409, no ledger read', async () => {
    mockFindUnique.mockResolvedValue(unanchored({ positions: [] }));
    const res = await report();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NO_POSITIONS_TO_ANCHOR');
    expect(mockXrplJsonRpc).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});


/**
 * A STORE WE COULD NOT READ IS NOT A VERDICT
 * ABOUT THE USER.
 *
 * `ownedSignerAddresses` was built on the ambiguous `provenAddressesOf`, so a blink
 * of the database came out of the read doors as 403 «none of your addresses is on
 * this list» — a false statement, over THE ONLY BYTES A COSIGNATORY CAN SIGN. The
 * recall then never reached its quorum, and the reason was a failure of ours wearing
 * a verdict's clothes. The router asks `proveMembership` now, and sends the answer
 * the identity module says is owed.
 */
describe('The read floor says «I could not look», never «you are not a member»', () => {
  test('GET /:id — an unreadable proof store is 503 retryable, not 403', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    proofStoreUnreadable();
    mockWalletFindMany.mockResolvedValue([]);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
    expect(res.body.error).not.toBe('NOT_A_COUNCIL_MEMBER');
    expect(JSON.stringify(res.body)).not.toContain('none of your addresses');
  });

  test('GET / — the same listing answers the same way, and pins nothing', async () => {
    mockFindMany.mockResolvedValue([liveProposal({ createdByUserId: 'someone-else' })]);
    proofStoreUnreadable();
    mockWalletFindMany.mockResolvedValue([]);

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('the WALLET REGISTRY failing on its own is 503 too — not «you are not a member»', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    holdsSeats([]); // proof store readable, nothing proven
    mockWalletFindMany.mockRejectedValue(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('COUNCIL_READ_UNREADABLE');
    expect(res.body.retryable).toBe(true);
    warn.mockRestore();
  });

  test('a PROVEN seat still opens while the registry is down — a failed read never removes proof', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    holdsSeats([MEMBER_A]);
    mockWalletFindMany.mockRejectedValue(new Error('db down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(200);
    expect(res.body.proposal.id).toBe('p1');
    warn.mockRestore();
  });

  test('a store that WAS read and holds nothing is still a plain 403 — the fix is not a bypass', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    holdsSeats([]);
    mockWalletFindMany.mockResolvedValue([]);

    const res = await request(buildApp('stranger')).get('/api/council/proposals/p1');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_A_COUNCIL_MEMBER');
  });
});

/**
 * THE INBOX WAS OPEN TO A
 * SELF-DECLARED ADDRESS.
 *
 * `POST /api/wallets/connect` writes `prisma.wallet` with no signature, and a
 * council's signer addresses are public on the ledger: any session that typed one
 * read that family's acta — title, amounts, destinations, every member's stance and
 * comment, and the signed blobs. Accepted that as the price of not narrowing
 * an exit. The price is no longer necessary: a registered-only address gets the
 * SIGNING MATERIAL (which is all a cosignatory needs, and cannot be hidden from
 * someone being asked to sign it) and none of the DELIBERATION.
 */
describe('A registered-only address reads the bytes, not the family’s words', () => {
  const withActa = (over: Record<string, unknown> = {}) =>
    liveProposal({
      createdByUserId: 'someone-else',
      title: 'Pago a la abuela',
      positions: [{ memberAccount: MEMBER_B, stance: 'against', comment: 'no me fío del destino' }],
      signatures: [{ signerAccount: MEMBER_B, weight: 1, blobHex: 'ab'.repeat(40) }],
      ...over,
    });

  test('GET /:id — the blobs and the pinned tx arrive; the title and the positions do not', async () => {
    mockFindUnique.mockResolvedValue(withActa());
    holdsSeats([]); // nothing proven at all
    mockWalletFindMany.mockResolvedValue([{ address: MEMBER_A }]);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(200);
    // What a cosignatory needs to sign and to combine.
    expect(res.body.proposal.txjson).toEqual({ TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 });
    expect(res.body.proposal.signerList).toEqual(SIGNERS);
    expect(res.body.proposal.quorum).toBe(2);
    expect(res.body.proposal.signatures[0].blobHex).toBe('ab'.repeat(40));
    // What is nobody else's business.
    expect(res.body.proposal.title).toBeNull();
    expect(res.body.proposal.positions).toEqual([]);
    expect(res.body.proposal.access).toBe('registered');
    expect(res.body.proposal.redacted).toEqual(['title', 'positions']);
    expect(JSON.stringify(res.body)).not.toContain('Pago a la abuela');
    expect(JSON.stringify(res.body)).not.toContain('no me fío del destino');
  });

  test('a PROVEN member still reads the whole acta', async () => {
    mockFindUnique.mockResolvedValue(withActa());
    holdsSeats([MEMBER_B]);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Pago a la abuela');
    expect(res.body.proposal.positions).toHaveLength(1);
    expect(res.body.proposal.redacted).toBeUndefined();
  });

  test('the PROPOSER reads their own row in full even with nothing proven', async () => {
    mockFindUnique.mockResolvedValue(withActa({ createdByUserId: 'user-2' }));
    holdsSeats([]);
    mockWalletFindMany.mockResolvedValue([]);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toBe('Pago a la abuela');
  });

  test('GET / — the listing redacts the same way, row by row', async () => {
    mockFindMany.mockResolvedValue([withActa()]);
    holdsSeats([]);
    mockWalletFindMany.mockResolvedValue([{ address: MEMBER_A }]);

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    expect(res.body.proposals).toHaveLength(1);
    expect(res.body.proposals[0].title).toBeNull();
    expect(res.body.proposals[0].positions).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('no me fío del destino');
  });
});

/**
 * SILENCIO DONDE DEBÍA HABER ERROR.
 *
 * 2.4: `councilReadAccess.readable` era un veredicto de UNIÓN — true en cuanto
 * CUALQUIER fila del listado se podía decidir. En un listado mixto (una fila cuyo
 * asiento está en el registro de wallets, otra cuyo asiento solo puede PROBARSE) la
 * primera lo ponía a true, y la segunda caía en `'none'`, el filtro `mine` la tiraba
 * y el cliente recibía un 200 sin ella. Ni 503 ni 403: la fila DESAPARECÍA — y son
 * los únicos bytes que un cosignatario puede firmar.
 *
 * 2.5: `GET /:id` leía la fila sin guarda, así que una base de datos caída salía por
 * el middleware global como un 500 crudo, indistinguible de «esta propuesta no
 * existe».
 */
describe('La legibilidad se decide POR FILA, como el nivel', () => {
  const rowRegistered = () =>
    liveProposal({ id: 'p1', createdByUserId: 'someone-else', signerList: SIGNERS });
  /** Un consejo cuyo único asiento es MEMBER_B: no está en el registro de wallets. */
  const rowProvenOnly = () =>
    liveProposal({
      id: 'p2',
      createdByUserId: 'someone-else',
      signerList: [{ account: MEMBER_B, weight: 1 }],
    });

  test('la fila que solo se podía PROBAR no desaparece: viaja nombrada y con su 503', async () => {
    mockFindMany.mockResolvedValue([rowRegistered(), rowProvenOnly()]);
    proofStoreUnreadable(); // la mitad PROBADA no contesta…
    mockWalletFindMany.mockResolvedValue([{ address: MEMBER_A }]); // …la REGISTRADA sí

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    // La fila decidible se sirve, como siempre.
    expect(res.body.proposals.map((p: { id: string }) => p.id)).toEqual(['p1']);
    // Y LA OTRA NO SE TIRA: se nombra, con el mismo cuerpo que llevaría la respuesta
    // entera si no hubiese nada legible.
    expect(res.body.unreadable).toHaveLength(1);
    expect(res.body.unreadable[0]).toMatchObject({ id: 'p2', retryable: true });
    expect(res.body.unreadable[0].error).not.toBe('NOT_A_COUNCIL_MEMBER');
    // Ni una palabra de deliberación de una fila que no pudimos decidir.
    expect(JSON.stringify(res.body.unreadable)).not.toContain('positions');
  });

  test('con las dos lecturas buenas, la fila ajena sigue siendo un «no eres» — no un 503', async () => {
    mockFindMany.mockResolvedValue([rowRegistered(), rowProvenOnly()]);
    holdsSeats([MEMBER_A]); // la tienda contesta: tengo A, no tengo B
    mockWalletFindMany.mockResolvedValue([]);

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    expect(res.body.proposals.map((p: { id: string }) => p.id)).toEqual(['p1']);
    // El arreglo no es un bypass: sin lectura fallida, una fila ajena simplemente no
    // es mía y no se anuncia como ilegible.
    expect(res.body.unreadable).toBeUndefined();
  });

  test('nada mío y algo indecidible → 503, JAMÁS el 403 que afirma que no eres miembro', async () => {
    mockFindMany.mockResolvedValue([rowProvenOnly()]);
    proofStoreUnreadable();
    mockWalletFindMany.mockResolvedValue([{ address: 'rNOBODYxxxxxxxxxxxxxxxxxxxxxxxxxxx' }]);

    const res = await request(buildApp('user-2')).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(503);
    expect(res.body.retryable).toBe(true);
    expect(res.body.error).not.toBe('NOT_A_COUNCIL_MEMBER');
  });
});

describe('Los errores de GET /:id, dichos como lo que son', () => {
  test('una lectura que falla es 503 reintentable, nunca un 404 ni un 500 crudo', async () => {
    mockFindUnique.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROPOSAL_READ_UNREADABLE', retryable: true });
    // «No pude leer» no es «no existe».
    expect(res.body.error).not.toBe('NOT_FOUND');
  });

  /**
   * LOS DOS 409 DETERMINISTAS, CON SU CÓDIGO ENTERO. Llegan intactos a la pantalla
   * (código + `retryable:false` + la frase que nombra las dos salidas reales), que es
   * lo que un lector del frontend necesita para dejar de pintarlos como «el servidor
   * rechazó esta operación».
   */
  test('ACCOUNT_RECORD_MISSING sale 409 no reintentable, con su frase', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    mockProveMembership.mockResolvedValue({
      owned: [],
      storeReadable: false,
      failure: 'no-user-row',
      refusal: {
        status: 409,
        error: 'ACCOUNT_RECORD_MISSING',
        detail: 'We could not find the account record behind this session.',
        retryable: false,
      },
    });
    mockWalletFindMany.mockResolvedValue([]);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'ACCOUNT_RECORD_MISSING', retryable: false });
    expect(res.body.detail).toBeTruthy();
  });

  test('PROOF_FLOOR_UNREADABLE sale 409 no reintentable, con su frase', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ createdByUserId: 'someone-else' }));
    mockProveMembership.mockResolvedValue({
      owned: [],
      storeReadable: false,
      failure: 'unreadable-floor',
      refusal: {
        status: 409,
        error: 'PROOF_FLOOR_UNREADABLE',
        detail: 'The security block of this account does not parse.',
        retryable: false,
      },
    });
    mockWalletFindMany.mockResolvedValue([]);

    const res = await request(buildApp('user-2')).get('/api/council/proposals/p1');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: 'PROOF_FLOOR_UNREADABLE', retryable: false });
  });
});

/**
 * UNA FILA MALA NO PUEDE TUMBAR UNA RUTA DE LECTURA, Y
 * NINGUNA ESCRITURA PUEDE CORRER FUERA DE SU GUARDA.
 *
 * QUÉ FALLABA EN SILENCIO. `withEffectiveStatus` no es una lectura: cuando el ledger
 * confirma que el asiento fijado por una propuesta vencida nunca se gastó, la ARCHIVA
 * (`prisma.councilProposal.update`). Envolvió el `findUnique` de `GET /:id` en
 * un `try` y dejó esa llamada FUERA; `GET /` no tenía guarda ninguna. Así que un
 * fallo de escritura —o un nodo XRPL raro— sobre UNA sola fila salía por el
 * middleware global como un 500 crudo y se llevaba por delante la bandeja entera del
 * consejo, incluidas las propuestas de una salida que estaba recogiendo firmas.
 *
 * Estos tests fallan con el código: el listado contestaba 500.
 */
describe('Una fila mala no tumba el listado, y nada escribe fuera de la guarda', () => {
  /** Una fila VENCIDA cuyo asiento el ledger dice intacto: la ruta intenta archivarla. */
  const staleRow = (id: string) =>
    liveProposal({ id, expiresAt: new Date(Date.now() - 1000), txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 } });

  test('la fila que no se pudo poner al día viaja en `unreadable`; las demás se sirven', async () => {
    mockFindMany.mockResolvedValue([liveProposal({ id: 'ok' }), staleRow('bad')]);
    mockAccountSequence.mockResolvedValue(7); // 7 no supera a 7 → 'unused' → archiva
    mockUpdate.mockRejectedValue(new Error('db write failed'));

    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(200);
    // LO QUE IMPORTA: la propuesta sana sigue en pantalla.
    expect(res.body.proposals.map((p: { id: string }) => p.id)).toEqual(['ok']);
    // Y LA MALA NO DESAPARECE: se nombra, con su código y su reintento.
    expect(res.body.unreadable).toHaveLength(1);
    expect(res.body.unreadable[0]).toMatchObject({
      id: 'bad',
      account: COUNCIL,
      error: 'PROPOSAL_STATUS_UNREADABLE',
      retryable: true,
    });
    expect(String(res.body.unreadable[0].detail)).toMatch(/\s/); // una frase, no un código
  });

  test('GET /:id — la ESCRITURA que falla es 503 reintentable, jamás un 500 crudo', async () => {
    mockFindUnique.mockResolvedValue(staleRow('p1'));
    mockAccountSequence.mockResolvedValue(7);
    mockUpdate.mockRejectedValue(new Error('db write failed'));

    const res = await request(buildApp()).get('/api/council/proposals/p1');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROPOSAL_STATUS_UNREADABLE', retryable: true });
    expect(res.body.error).not.toBe('NOT_FOUND');
  });

  test('GET / — un listado ilegible es 503 reintentable, nunca un 200 sin propuestas', async () => {
    mockFindMany.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp()).get(`/api/council/proposals?accounts=${COUNCIL}`);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ error: 'PROPOSALS_READ_UNREADABLE', retryable: true });
    // «No pude leer» jamás se sirve como «no tienes nada».
    expect(res.body.proposals).toBeUndefined();
  });
});

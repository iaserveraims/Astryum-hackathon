const mockFindFirst = jest.fn();
const mockCreate = jest.fn();
const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockSigUpsert = jest.fn();
const mockSigFindMany = jest.fn();
const mockPosFindUnique = jest.fn();
const mockPosCreate = jest.fn();

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
  },
}));

// The route only needs the provider as an opaque reader handed to the
// (mocked) coordinator — never called directly in these tests.
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({ xrplProvider: {} }));

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

jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: () => ({ allowed: true }) },
}));

import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { encode, encodeForSigning } from 'ripple-binary-codec';
import { sign as kpSign, deriveAddress as kpDeriveAddress, deriveKeypair, generateSeed } from 'ripple-keypairs';
import { BlobVerificationError } from '../../connectors/protocols/xrpl/XrplBlobVerifier';
import councilProposalsRouter from '../councilProposals';

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
  for (const m of [mockFindFirst, mockCreate, mockFindMany, mockFindUnique, mockUpdate, mockSigUpsert, mockSigFindMany, mockPosFindUnique, mockPosCreate, mockPrepare, mockVerifyBlob]) {
    m.mockReset();
  }
});

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

  test('an expired proposal is lazily flipped and refuses signatures → 409', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ expiresAt: new Date(Date.now() - 1000) }));
    mockUpdate.mockResolvedValue({});
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/signatures')
      .send({ signerAccount: MEMBER_A, blobHex: 'AB'.repeat(32) });
    expect(res.status).toBe(409);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'expired' } }),
    );
    expect(mockSigUpsert).not.toHaveBeenCalled();
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
      .send({ txHash: 'ABCDEF1234567890' });
    expect(res.status).toBe(409);
  });

  test('submitted when ready records the browser-reported hash', async () => {
    mockFindUnique.mockResolvedValue(liveProposal({ status: 'ready' }));
    mockUpdate.mockResolvedValue(liveProposal({ status: 'submitted', txHash: 'ABCDEF1234567890' }));
    const res = await request(buildApp())
      .post('/api/council/proposals/p1/submitted')
      .send({ txHash: 'ABCDEF1234567890' });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'submitted', txHash: 'ABCDEF1234567890' } }),
    );
  });

  test('withdraw by someone other than the proposer → 403', async () => {
    mockFindUnique.mockResolvedValue(liveProposal());
    const res = await request(buildApp('user-2')).post('/api/council/proposals/p1/withdraw');
    expect(res.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

/**
 * puertas-y-permiso — THE THIRD COMPOSE DOOR.
 *
 * A council pins ONE Sequence per proposal, and XRPL burns a Sequence exactly
 * once. Two doors that pin a new one already ask the ledger about the stale
 * ones first (`POST /api/council/proposals` → 422 PRIOR_SEAT_UNRESOLVED, and
 * `CouncilProposalService.createCouncilProposalFromRule`). The SYNCHRONOUS
 * ceremony — `POST /api/xrpl-defi/multisign/prepare`, mounted in LegacyPanel,
 * CouncilOrderCard, CouncilVaultEntry and CageBirthCard — did not: with an
 * unresolved row in the inbox the family composed the same payment here,
 * signed it in one sitting and broadcast it. The council pays twice.
 */
import express from 'express';
import request from 'supertest';

const mockFindMany = jest.fn();
const mockUpdate = jest.fn();
/** permisos-y-doble-pago: the live-proposal half of the guard (findLiveProposal). */
const mockFindFirst = jest.fn();
/** g1-ceremonia: the ceremony lease lives in the generic CacheEntry table. */
const mockCacheUpsert = jest.fn();
const mockCacheDeleteMany = jest.fn();
const mockCacheFindUnique = jest.fn();
/**
 * arriendo-ceremonia: the lease WRITE now asks the wallet registry
 * whether this session holds one of the council's seats — the same predicate
 * (`sessionIsCouncilMember`) the proposal router's doors ask.
 */
const mockWalletFindMany = jest.fn();
/**
 * `readHandoffAnyState` (councilExitToken) reads `background_jobs` STRICTLY
 * — a failure there is «I could not read», never «unknown memo».
 */
const mockBackgroundJobFindMany = jest.fn();
/**
 * Membership is a PROVEN address (the signed-in
 * one, or a signature-backed binding), never a `wallet` row — a council's signer
 * addresses are public. This is the harness's membership knob.
 */
const mockProvenAddresses = jest.fn<Promise<string[]>, unknown[]>();
/**
 * The council router asks the identity module's MEMBERSHIP
 * VERDICT now (`proveMembership`), which can say «I could not read» instead of
 * «you are not a member». Same knob, so a test still only says what this session
 * holds.
 */
const mockProveMembership = jest.fn<
  Promise<{ owned: string[]; storeReadable: boolean; failure: string | null; refusal: unknown | null }>,
  unknown[]
>();
const holdsSeats = (addresses: string[]) => {
  mockProvenAddresses.mockResolvedValue(addresses);
  mockProveMembership.mockImplementation(async (...a: unknown[]) => {
    const members = (a[2] as string[]) ?? [];
    return { owned: members.filter((m) => addresses.includes(m)), storeReadable: true, failure: null, refusal: null };
  });
};
jest.mock('../../services/identity/provenAddresses', () => ({
  ...jest.requireActual('../../services/identity/provenAddresses'),
  provenAddressesOf: (...a: unknown[]) => mockProvenAddresses(...a),
  proveMembership: (...a: unknown[]) => mockProveMembership(...a),
}));
jest.mock('../../database/prismaClient', () => ({
  prisma: {
    councilProposal: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
    wallet: {
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
    },
    backgroundJob: { findMany: (...a: unknown[]) => mockBackgroundJobFindMany(...a) },
    cacheEntry: {
      findUnique: (...a: unknown[]) => mockCacheFindUnique(...a),
      upsert: (...a: unknown[]) => mockCacheUpsert(...a),
      deleteMany: (...a: unknown[]) => mockCacheDeleteMany(...a),
    },
  },
}));

const mockAccountSequence = jest.fn();
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: { getAccountSequence: (...a: unknown[]) => mockAccountSequence(...a) },
}));

/**
 * The door classifies EVERY prepare (finding 3.3), and what it answers
 * decides whether the seat guards refuse or merely warn (finding 2.1).
 */
const mockQueuedHandoff = jest.fn();
const mockComposedOrder = jest.fn();
const mockMintParams = jest.fn();
const mockStampCeremonyPin = jest.fn();
jest.mock('../../services/flare/DirectMintHandoffStore', () => ({
  ...jest.requireActual('../../services/flare/DirectMintHandoffStore'),
  findQueuedHandoffByMemo: (...a: unknown[]) => mockQueuedHandoff(...a),
  stampCeremonyPin: (...a: unknown[]) => mockStampCeremonyPin(...a),
}));
jest.mock('../../services/flare/ComposedCouncilOrderStore', () => ({
  ...jest.requireActual('../../services/flare/ComposedCouncilOrderStore'),
  getComposedCouncilOrderStrict: (...a: unknown[]) => mockComposedOrder(...a),
}));
jest.mock('../../connectors/protocols/flare/FlareDirectMintService', () => ({
  ...jest.requireActual('../../connectors/protocols/flare/FlareDirectMintService'),
  readDirectMintParams: (...a: unknown[]) => mockMintParams(...a),
}));
jest.mock('../../services/flare/flareProvider', () => ({
  ...jest.requireActual('../../services/flare/flareProvider'),
  flareReadProvider: () => ({}),
}));

const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  ...jest.requireActual('../../connectors/protocols/xrpl/XrplMultisigCoordinator'),
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
}));

import xrplDefiRouter from '../xrplDefi';
import { __resetSequenceCache } from '../councilProposals';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const MEMBER_A = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const MEMBER_B = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const USER_ID = 'user-1';
const STRANGER = 'user-stranger';

/**
 * arriendo-ceremonia: the route reads `req.siwe.userId` to decide
 * whether this session may take (and later give back) the council's seat, so
 * these tests need a session — the previous harness had none, which is exactly
 * the shape the DoS took: any caller, any council, a 30-minute block.
 */
function buildApp(userId: string | null = USER_ID) {
  const app = express();
  app.use(express.json());
  if (userId) {
    app.use((req, _res, next) => {
      (req as express.Request & { siwe: unknown }).siwe = { userId, sessionId: 's1', walletAddress: '0x0' };
      next();
    });
  }
  app.use('/api/xrpl-defi', xrplDefiRouter);
  return app;
}
const app = buildApp();

const URL = '/api/xrpl-defi/multisign/prepare';
const RELEASE_URL = '/api/xrpl-defi/multisign/release';
/** An ENTRY: no memo at all, so the real classifier answers `no-single-memo`. */
const BODY = { account: COUNCIL, xrplTx: { TransactionType: 'Payment', Account: COUNCIL } };
/**
 * THE BYTES OF A REAL 0xFE. `FE` + walletId + executor fee + the 32 bytes
 * of the userOpHash = 42 bytes / 84 hex, the shape `FlareDirectMintService` really
 * builds. A 64-hex stand-in would have passed the old reader and hidden the bug all
 * over again, which is why these tests carry the real length.
 */
const ZERO_FE_MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const CORE_VAULT = 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX';
const GROSS_DROPS = '2000000';
const EXIT_BODY = {
  account: COUNCIL,
  xrplTx: {
    TransactionType: 'Payment',
    Account: COUNCIL,
    Destination: CORE_VAULT,
    Amount: GROSS_DROPS,
    Memos: [{ Memo: { MemoData: ZERO_FE_MEMO } }],
  },
};
/** A queued 0xFE EXIT of this council really sits in the store. */
const asExit = () =>
  mockQueuedHandoff.mockResolvedValue({ xrplAddress: COUNCIL, action: 'astryum-pote-exit', grossXrpDrops: GROSS_DROPS });
/** Both handoff reads are down: «I could not read», which is neither yes nor no. */
const unclassified = () => {
  mockQueuedHandoff.mockRejectedValue(new Error('db down'));
  mockBackgroundJobFindMany.mockRejectedValue(new Error('db down'));
};
const SIGNERS = [
  { account: MEMBER_A, weight: 1 },
  { account: MEMBER_B, weight: 1 },
];

/** A lease row as `recordCeremonySeat` stores it, inside its 30 minutes. */
const leaseRow = (preparedByUserId: string | null, expiresInMs = 20 * 60_000) => ({
  data: {
    account: COUNCIL,
    pinnedSequence: 11,
    txType: 'Payment',
    preparedAt: new Date().toISOString(),
    preparedByUserId,
  },
  expiresAt: new Date(Date.now() + expiresInMs),
});

/** A past-deadline proposal of this council, its seat pinned at Sequence 7. */
const staleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  account: COUNCIL,
  title: 'Pago proveedor',
  txType: 'Payment',
  txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 },
  status: 'ready',
  // The row's own signer list decides who reads its title.
  signerList: SIGNERS,
  expiresAt: new Date(Date.now() - 1000),
  ...overrides,
});

const pinned = {
  multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11, SigningPubKey: '' },
  council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
  fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
  preflight: { available: true, willSucceed: true, balanceChanges: [] },
  // The coordinator now reports WHICH seat it took and why.
  sequence: { pinned: 11, ledgerNext: 11, source: 'ledger' as const },
};

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  __resetSequenceCache(); // module state that outlives a request (and a test)
  process.env.XRPL_DEFI_ENABLED = 'true';
  process.env.LEGACY_ENABLED = 'true';
  delete process.env.DEFI_EXEC_ALLOWED_REGIONS;
  mockFindFirst.mockResolvedValue(null); // nothing live inside its deadline
  mockFindMany.mockResolvedValue([]);
  // The harness mirrors the coordinator's own pin rule — a requested
  // seat is taken only when it IS the ledger's next unused Sequence; one the ledger
  // has moved past is ignored (pinning it would compose a tefPAST_SEQ corpse).
  mockPrepare.mockImplementation(async (_reader: unknown, input: { pinSequence?: number | null }) => {
    const ledgerNext = 11;
    const requested = typeof input?.pinSequence === 'number' ? input.pinSequence : undefined;
    const takes = requested === ledgerNext;
    return {
      ...pinned,
      sequence: {
        pinned: ledgerNext,
        ledgerNext,
        ...(requested !== undefined ? { requested } : {}),
        source: takes ? 'contested-seat' : 'ledger',
        ...(requested !== undefined && requested < ledgerNext ? { requestedSeatConsumed: true } : {}),
      },
    };
  });
  mockCacheUpsert.mockResolvedValue({});
  mockCacheDeleteMany.mockResolvedValue({ count: 0 });
  mockCacheFindUnique.mockResolvedValue(null);
  // Default: the session holds one of THIS council's seats (the ordinary case).
  holdsSeats([MEMBER_A]);
  // Default: the stores know nothing about these bytes, so the REAL classification
  // answers `no-single-memo` / `unknown-memo` — the ordinary ceremony, as before.
  process.env.DATABASE_URL = 'postgres://test/test';
  mockQueuedHandoff.mockResolvedValue(null);
  mockComposedOrder.mockResolvedValue(null);
  mockBackgroundJobFindMany.mockResolvedValue([]);
  mockMintParams.mockResolvedValue({ paymentAddress: CORE_VAULT });
  mockStampCeremonyPin.mockResolvedValue({ stamped: true });
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('multisign/prepare — the ceremony asks about the previous seat before pinning a new one', () => {
  it('a CONSUMED prior seat refuses the ceremony (422) and nothing is pinned', async () => {
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockResolvedValue(9); // pinned 7 → the seat was used

    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(res.body.proposalId).toBe('p1');
    expect(res.body.ledgerCheck.state).toBe('consumed');
    // The refusal SPEAKS the verdict — a bare code is a dead end in front of a
    // family about to sign in one sitting.
    expect(res.body.detail).toContain('Pago proveedor');
    expect(res.body.detail).toContain('already used Sequence 7');
    // THE POINT: no new Sequence was ever fixed for this council.
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('an UNREADABLE ledger refuses it too — "could not read" is not "it never happened"', async () => {
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));

    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(res.body.ledgerCheck.state).toBe('unverified');
    expect(mockPrepare).not.toHaveBeenCalled();
    // Nothing was archived on a failed read.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a council with no stale rows composes exactly as before', async () => {
    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(200);
    expect(res.body.multisigTx.Sequence).toBe(11);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    // The guard costs no ledger read when there is nothing stale to judge.
    expect(mockAccountSequence).not.toHaveBeenCalled();
  });

  it('a stale row whose seat the ledger says is UNUSED is archived, and the ceremony goes on', async () => {
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockResolvedValue(7); // never consumed → truly expired
    mockUpdate.mockResolvedValue({});

    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { status: 'expired' } }),
    );
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });
});

/**
 * permisos-y-doble-pago — THE OTHER HALF OF THE SAME SEAT.
 *
 * The round-3 guard above only asks about proposals PAST their deadline. A
 * proposal INSIDE its deadline holds the account's Sequence just as hard:
 * `prepareCouncilMultisig` pins whatever `account_info` calls next-unused,
 * which is that very Sequence. Two collections, one seat — the ledger burns it
 * once, the loser turns into a corpse the inbox still shows as live (inside the
 * deadline nothing reads the ledger), the proposer files that corpse without a
 * verdict, and the council composes the same payment over a fresh Sequence.
 *
 * These fail on the code as it shipped in d533b67: it answered 200 with a
 * freshly pinned Sequence while the inbox row was still collecting.
 */
describe('multisign/prepare — a proposal already collecting owns the seat', () => {
  const liveRow = {
    id: 'p9',
    title: 'Pago proveedor',
    txType: 'Payment',
    txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11 },
    signerList: SIGNERS,
  };

  it('refuses the ceremony (422) and pins nothing while a proposal is live', async () => {
    mockFindFirst.mockResolvedValue(liveRow);

    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('LIVE_PROPOSAL_EXISTS');
    expect(res.body.proposalId).toBe('p9');
    // The refusal SPEAKS, and names the row.
    expect(res.body.detail).toContain('Pago proveedor');
    expect(res.body.detail).toContain('paying twice');
    // g1-ceremonia: it must send the family where the seat is really
    // settled — the inbox — and NOT to the two exits the audit found open.
    // Inside its deadline `withdraw` reads no ledger and issues no verdict, and
    // "let it expire" is the seven-day wait that lands on the seat guard.
    expect(res.body.detail).toContain('inbox');
    expect(res.body.detail).toContain('register the transaction hash');
    expect(res.body.detail).not.toContain('let it expire');
    expect(res.body.detail).not.toMatch(/withdraw it\b/);
    // THE POINT: no second Sequence was ever fixed for this council.
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  /**
   * THE REFUSAL DOES NOT READ OUT ANOTHER FAMILY'S INBOX.
   * The title is free text somebody typed into their own ceremony; the refusal is
   * the same for everyone, and only a session sitting on THAT signer list reads it.
   */
  it('a caller outside that council gets the refusal WITHOUT the row’s title', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    holdsSeats([]); // none of this council's seats, proven or registered

    const res = await request(buildApp(STRANGER)).post(URL).send(BODY);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('LIVE_PROPOSAL_EXISTS');
    expect(res.body.detail).not.toContain('Pago proveedor');
    expect(res.body.detail).toContain('Payment'); // the transaction TYPE, never the name
  });

  it('asks the live question first — no stale scan, no ledger read', async () => {
    mockFindFirst.mockResolvedValue(liveRow);

    await request(app).post(URL).send(BODY);

    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockAccountSequence).not.toHaveBeenCalled();
  });

  it('asks it of THIS account, and only about rows still collecting', async () => {
    await request(app).post(URL).send(BODY);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          account: COUNCIL,
          status: { in: ['collecting', 'ready'] },
          expiresAt: { gt: expect.any(Date) },
        }),
      }),
    );
  });

  it('with the inbox empty the ceremony composes exactly as before', async () => {
    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(200);
    expect(res.body.multisigTx.Sequence).toBe(11);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
  });
});

/**
 * NEITHER GUARD CLOSES AN EXIT.
 *
 * The two refusals above are right for an ENTRY and wrong for a way out: a recall is
 * capital coming back, and it was being held behind somebody else's proposal — until
 * closed membership-by-proof, a proposal a stranger could publish by typing the
 * council's public signer address, refusing the real family for seven days. Same for
 * a database we cannot read: an outage of ours became a 400 «prepare failed» on an
 * exit.
 *
 * XRPL settles the physics: the account has ONE Sequence seat and it is burnt once.
 * What the doctrine settles is WHO LOSES IT — the exit takes the seat, the entry is
 * the one that dies, and the family is told so in plain words (`seatContestWarning`).
 */
describe('multisign/prepare — an EXIT takes the seat; an entry is the one that loses it', () => {
  const liveRow = {
    id: 'p9',
    title: 'Pago proveedor',
    txType: 'Payment',
    txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11 },
    signerList: SIGNERS,
  };
  it('a rival LIVE proposal: the exit is composed (200) with the warning; an entry is still 422', async () => {
    mockFindFirst.mockResolvedValue(liveRow);

    const entry = await request(app).post(URL).send(BODY);
    expect(entry.status).toBe(422);
    expect(entry.body.error).toBe('LIVE_PROPOSAL_EXISTS');

    asExit();
    const exit = await request(app).post(URL).send(EXIT_BODY);
    expect(exit.status).toBe(200);
    expect(exit.body.multisigTx.Sequence).toBe(11);
    // The classification really ran, over the real 84-hex 0xFE memo.
    expect(mockQueuedHandoff).toHaveBeenCalledWith(ZERO_FE_MEMO);
    // The exit is pinned to the rival's seat ON PURPOSE — not to
    // whatever `account_info` happened to answer.
    expect(mockPrepare).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ pinSequence: 11 }));
    expect(exit.body.seatContest).toEqual({ proposalId: 'p9', txType: 'Payment', pinnedSequence: 11 });
    // The warning says what happens to BOTH, and promises nothing it cannot keep.
    expect(exit.body.seatContestWarning).toContain('tefPAST_SEQ');
    expect(exit.body.seatContestWarning).toContain('does not make this exit win the race');
    // Never the other row's title, and never a word about the region.
    expect(String(exit.body.seatContestWarning)).not.toContain('Pago proveedor');
    expect(JSON.stringify(exit.body.seatContest)).not.toContain('Pago proveedor');
    expect(String(exit.body.seatContestWarning)).not.toMatch(/region/i);
  });

  it('an UNRESOLVED prior seat: the exit goes out warned, the entry keeps its 422', async () => {
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockResolvedValue(9); // pinned 7 → the seat was used

    const entry = await request(app).post(URL).send(BODY);
    expect(entry.status).toBe(422);
    expect(entry.body.error).toBe('PRIOR_SEAT_UNRESOLVED');

    asExit();
    const exit = await request(app).post(URL).send(EXIT_BODY);
    expect(exit.status).toBe(200);
    // The stale row pinned Sequence 7 and the ledger has moved past it: pinning it
    // again would compose an exit that is tefPAST_SEQ from birth. It takes the free
    // seat instead, and the warning says exactly that — never a false contest.
    expect(exit.body.seatContestWarning).toContain('already been spent');
    /**
     * AND IT IS NOT A CONTEST, SO IT IS NOT CALLED ONE. The seat was
     * spent before these bytes were composed: `seatContest` (the structured object a
     * screen paints as «you two share a Sequence») is absent, and the notice carries
     * the kind that says what actually happened, with BOTH numbers.
     */
    expect(exit.body.seatContest).toBeUndefined();
    expect(exit.body.seatNotices).toHaveLength(1);
    expect(exit.body.seatNotices[0]).toMatchObject({
      kind: 'seat-already-spent',
      proposalId: 'p1',
      txType: 'Payment',
      theirSequence: 7,
      ourSequence: 11,
    });
    expect(exit.body.seatNotices[0].pinnedSequence).toBeUndefined();
    // It must NOT send the family to settle a payment that may already have landed.
    expect(String(exit.body.seatNotices[0].detail)).toContain('explorer');
    expect(String(exit.body.seatNotices[0].detail)).toContain('may well have been that very');
  });

  /**
   * A TRANSACTION WE COULD NOT CLASSIFY IS TREATED AS AN EXIT.
   *
   * `unreadable` is not «this is an entry»: it is «our store did not answer».
   * let it fall into the ceremony guards, which judge by `isExit`, so a recall was
   * refused 422 by somebody else's proposal because a database of ours was down.
   */
  /**
   * COMPOSING IS NOT THE SAME AS TAKING THE SEAT.
   *
   * Let `exitForSeat` (isExit OR unclassified) govern BOTH the guards and
   * `pinSequence`, so a payload the server could not classify — an ENTRY, as often
   * as not — was composed onto the live proposal's Sequence. The collision the guard
   * exists to prevent was then arranged BY CONSTRUCTION, on a read of ours that
   * failed. Composing it as an exit is right; keeping somebody else's seat is not.
   */
  it('an UNREADABLE classification composes as an exit but does NOT take the rival seat', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    unclassified();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    expect(res.body.exitClassification).toBe('unreadable');
    expect(res.body.seatContestWarning).toContain('could NOT confirm it is an exit');
    expect(res.body.seatContestWarning).toContain('proposal inbox');
    // THE POINT: no `pinSequence` was ever asked for.
    expect(mockPrepare).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.not.objectContaining({ pinSequence: expect.anything() }),
    );
    expect(res.body.seatContestWarning).toContain('NOT pinned to that seat');
  });

  /**
   * THE SCREEN STOPPED INVENTING A RIVAL.
   *
   * Three different warnings shared one string, and the only reader painted all
   * three as «another payload holds the same Sequence» — sending a family to settle
   * a proposal that does not exist. They travel typed now.
   */
  it('the warnings are TYPED: a classification we could not make is not a rival', async () => {
    mockFindFirst.mockResolvedValue(null); // nothing live: no rival at all
    unclassified();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    expect(res.body.seatNotices).toHaveLength(1);
    expect(res.body.seatNotices[0].kind).toBe('unclassified-exit');
    expect(res.body.seatNotices[0].proposalId).toBeUndefined();
    // …and nothing structured that a screen could paint as a contest.
    expect(res.body.seatContest).toBeUndefined();
  });

  it('an inbox we could not READ is its own kind, and names no rival either', async () => {
    mockFindFirst.mockRejectedValue(new Error('db down'));
    asExit();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    const kinds = (res.body.seatNotices as Array<{ kind: string }>).map((n) => n.kind);
    expect(kinds).toEqual(['inbox-unreadable']);
    expect(res.body.seatNotices[0].proposalId).toBeUndefined();
    expect(res.body.seatContest).toBeUndefined();
  });

  it('a REAL rival is the only kind that carries the row to settle', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    asExit();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    expect(res.body.seatNotices).toHaveLength(1);
    expect(res.body.seatNotices[0]).toMatchObject({
      kind: 'rival-seat',
      proposalId: 'p9',
      txType: 'Payment',
      // Populated ONLY because the coordinator really pinned these
      // bytes to 11 — it is a fact about THIS payload, not the rival's number.
      pinnedSequence: 11,
      priority: 1,
    });
    // Never the other family's free text (2.7).
    expect(JSON.stringify(res.body.seatNotices)).not.toContain('Pago proveedor');
  });

  /**
   * THE TWO NOTICES NO LONGER CONTRADICT EACH OTHER.
   *
   * Emitted `rival-seat` on `exitForSeat`, which includes a payload the server
   * could NOT classify — and by 's own split such a payload deliberately takes
   * the NEXT FREE Sequence. So the pair read: «we did not pin this to anybody's seat»
   * next to «that row holds the same Sequence as you, settle it». One of the two was
   * false, and the false one is the one that sends a family to re-settle a payment
   * that may already have landed.
   *
   * Now the kind follows the PIN, and the list arrives sorted by priority, so the
   * headline is the state of the seat and the failed read is the detail below it.
   */
  it('a rival row we did NOT pin to is «seat-not-pinned», never «rival-seat»', async () => {
    mockFindFirst.mockResolvedValue(liveRow);
    unclassified();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    const kinds = (res.body.seatNotices as Array<{ kind: string }>).map((n) => n.kind);
    expect(kinds).toEqual(['seat-not-pinned', 'unclassified-exit']);
    // Nothing structured a screen could paint as a shared seat, and no rival number
    // presented as this payload's own.
    expect(res.body.seatContest).toBeUndefined();
    expect(res.body.seatNotices[0].pinnedSequence).toBeUndefined();
    expect(res.body.seatNotices[0]).toMatchObject({ proposalId: 'p9', theirSequence: 11, priority: 3 });
    expect(res.body.seatNotices[1].priority).toBe(5);
    // The legacy single string still carries both, for a client that only reads it.
    expect(res.body.seatContestWarning).toContain('could NOT confirm it is an exit');
    expect(res.body.seatContestWarning).toContain('id p9');
  });

  /** finding 2.2: a database that cannot be read was coming back as 400 PREPARE_FAILED. */
  it('the inbox unreadable: an entry is 503 and retryable; the exit is composed with the warning', async () => {
    mockFindFirst.mockRejectedValue(new Error('db down'));

    const entry = await request(app).post(URL).send(BODY);
    expect(entry.status).toBe(503);
    expect(entry.body).toMatchObject({ error: 'SEAT_GUARD_UNREADABLE', retryable: true });
    expect(entry.body.detail).toContain('failure of ours');
    expect(mockPrepare).not.toHaveBeenCalled();

    asExit();
    const exit = await request(app).post(URL).send(EXIT_BODY);
    expect(exit.status).toBe(200);
    expect(exit.body.multisigTx.Sequence).toBe(11);
    expect(exit.body.seatContestWarning).toContain('could not read');
  });
});

/**
 * g1-ceremonia — THE TRACE THE CEREMONY NEVER LEFT.
 *
 * `prepareCouncilMultisig` writes nothing, so a pinned Sequence was invisible
 * server-side and the two asynchronous compose doors could pin it again one
 * click later. The ceremony now records a short-lived lease.
 *
 * These fail on the code as it shipped in 256a6b0: no lease was ever written.
 */
describe('multisign/prepare — the ceremony records the seat it just took', () => {
  it('writes the lease with the Sequence that was ACTUALLY pinned, keyed by council', async () => {
    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(200);
    expect(mockCacheUpsert).toHaveBeenCalledTimes(1);
    const call = mockCacheUpsert.mock.calls[0][0];
    expect(call.where.cacheKey).toBe(`council-ceremony-seat:${COUNCIL}`);
    expect(call.create.data.pinnedSequence).toBe(11); // the coordinator's output
    expect(call.create.data.txType).toBe('Payment');
    expect(call.create.tags).toEqual(['council-ceremony-seat']);
    // Release #1 lives in the row itself: 30 minutes, never open-ended.
    const ttlMs = new Date(call.create.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60_000);
  });

  it('release #3: a second ceremony REPLACES the lease instead of being refused by it', async () => {
    await request(app).post(URL).send(BODY);
    mockPrepare.mockResolvedValue({ ...pinned, multisigTx: { ...pinned.multisigTx, Sequence: 12 } });

    const res = await request(app).post(URL).send(BODY);

    // The retry after a stalled QR must never be a dead end.
    expect(res.status).toBe(200);
    expect(mockCacheUpsert).toHaveBeenCalledTimes(2);
    expect(mockCacheUpsert.mock.calls[1][0].update.data.pinnedSequence).toBe(12);
  });

  it('sweeps its own expired leases, and only those', async () => {
    await request(app).post(URL).send(BODY);

    expect(mockCacheDeleteMany).toHaveBeenCalledWith({
      where: { tags: { has: 'council-ceremony-seat' }, expiresAt: { lt: expect.any(Date) } },
    });
  });

  it('nothing is pinned → nothing is leased', async () => {
    mockFindFirst.mockResolvedValue({ id: 'p9', title: 'Pago proveedor', txType: 'Payment' });

    await request(app).post(URL).send(BODY);

    expect(mockCacheUpsert).not.toHaveBeenCalled();
  });

  it('a lease that cannot be stored never fails the sitting (best-effort by design)', async () => {
    mockCacheUpsert.mockRejectedValue(new Error('cache table gone'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(200);
    expect(res.body.multisigTx.Sequence).toBe(11);
    // …but it is said out loud, never reported as done.
    expect(warn).toHaveBeenCalledWith(
      '[council] ceremony seat NOT recorded:',
      'cache table gone',
    );
    warn.mockRestore();
  });

  it('a pin with no readable Sequence leases nothing — a lease with no seat only blocks', async () => {
    mockPrepare.mockResolvedValue({
      ...pinned,
      multisigTx: { TransactionType: 'Payment', Account: COUNCIL, SigningPubKey: '' },
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(app).post(URL).send(BODY);

    expect(res.status).toBe(200);
    expect(mockCacheUpsert).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

/**
 * arriendo-ceremonia — THE LEASE HAD NO OWNERSHIP FLOOR.
 *
 * Round 4 closed the proposal router's READS with `sessionIsCouncilMember` and
 * left the WRITE it had just invented with none. `requireLegacyAccess` with
 * LEGACY_ENABLED means "any authenticated session", so any caller could POST
 * this route with any r-address that has a SignerList and lease that family's
 * Sequence for 30 minutes, repeatedly — blocking `POST /api/council/proposals`
 * and the council's MoneyFlow rule engine. Before the lease existed there was
 * NO persistent effect at all, so this was a brand-new cross-family DoS.
 *
 * These fail on the code as it shipped in 256a6b0: the lease was written for
 * anybody, including a session with no seat and no session at all.
 */
describe('multisign/prepare — only a member of THIS council may take its seat', () => {
  it('a stranger pins bytes but leases NOTHING — the DoS needed the write, not the read', async () => {
    // No PROVEN address of this session is in the council's signer list — and a
    // `wallet` row saying otherwise buys nothing: nobody reads it.
    mockWalletFindMany.mockResolvedValue([{ address: MEMBER_A }]);
    holdsSeats([]);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(buildApp(STRANGER)).post(URL).send(BODY);

    // The compose itself is read-only public ledger material: it still answers.
    expect(res.status).toBe(200);
    expect(res.body.multisigTx.Sequence).toBe(11);
    // THE POINT: no 30-minute block on somebody else's council.
    expect(mockCacheUpsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[council] ceremony seat NOT recorded: session holds no registered seat in',
      COUNCIL,
    );
    warn.mockRestore();
  });

  it('asks the PROOF about THIS session — one predicate, never the wallet table', async () => {
    await request(buildApp()).post(URL).send(BODY);

    expect(mockProveMembership).toHaveBeenCalledWith(USER_ID, expect.anything(), expect.anything(), 'entry');
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    // A member's sitting is leased, and the lease carries WHO took the seat —
    // the field round 4 wrote and nobody read.
    expect(mockCacheUpsert).toHaveBeenCalledTimes(1);
    expect(mockCacheUpsert.mock.calls[0][0].create.data.preparedByUserId).toBe(USER_ID);
  });

  it('no session at all leases nothing (the dev bypass must not block a family either)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await request(buildApp(null)).post(URL).send(BODY);

    expect(res.status).toBe(200);
    expect(mockCacheUpsert).not.toHaveBeenCalled();
    expect(mockProveMembership).not.toHaveBeenCalled(); // no userId, nothing to ask
    warn.mockRestore();
  });
});

/**
 * arriendo-ceremonia — THE DOOR THE LEASE NEVER HAD.
 *
 * `abandon()` in CouncilMultisigFlow killed the Xaman payloads, cleared the
 * screen and claimed in its own comment that "the ceremony gives the seat
 * back", while making no HTTP call whatsoever. One click later «Propose to the
 * council» answered 422 CEREMONY_IN_FLIGHT — "finish or abandon that sitting" —
 * to a family that had just abandoned it, with no way to obey for 30 minutes.
 *
 * These fail on the code as it shipped in 256a6b0: the route did not exist
 * (404) and `releaseCeremonySeat` was private with no caller.
 */
describe('multisign/release — the seat goes back, and only its own lessee may hand it back', () => {
  it('the session that took the seat gets it released — and the row is really deleted', async () => {
    mockCacheFindUnique.mockResolvedValue(leaseRow(USER_ID));

    const res = await request(buildApp()).post(RELEASE_URL).send({ account: COUNCIL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: true });
    expect(mockCacheDeleteMany).toHaveBeenCalledWith({
      where: { cacheKey: `council-ceremony-seat:${COUNCIL}` },
    });
  });

  it('ANOTHER session cannot end a sitting it did not open — 403, and the lease stands', async () => {
    // The sitting belongs to USER_ID; a different session asks for the seat.
    mockCacheFindUnique.mockResolvedValue(leaseRow(USER_ID));

    const res = await request(buildApp(STRANGER)).post(RELEASE_URL).send({ account: COUNCIL });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NOT_THE_LESSEE');
    // Their members may still have signable requests over those exact bytes.
    expect(mockCacheDeleteMany).not.toHaveBeenCalled();
    // And the refusal is prose, not a slug — it says when the seat frees itself.
    expect(res.body.detail).toMatch(/30 minutes/);
  });

  it('nothing leased is an ANSWER, not a refusal: the compose doors are clear either way', async () => {
    mockCacheFindUnique.mockResolvedValue(null);

    const res = await request(buildApp()).post(RELEASE_URL).send({ account: COUNCIL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: false, reason: 'no-seat' });
  });

  it('an expired lease is swept and reported as nothing held', async () => {
    mockCacheFindUnique.mockResolvedValue(leaseRow(USER_ID, -1000));

    const res = await request(buildApp()).post(RELEASE_URL).send({ account: COUNCIL });

    expect(res.status).toBe(200);
    expect(res.body.reason).toBe('no-seat');
    expect(mockCacheDeleteMany).toHaveBeenCalled(); // release #1, the same sweep
  });

  it('a store we cannot READ is never reported as released — "could not read" is not "it is gone"', async () => {
    mockCacheFindUnique.mockRejectedValue(new Error('cache table gone'));

    const res = await request(buildApp()).post(RELEASE_URL).send({ account: COUNCIL });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('SEAT_NOT_RELEASED');
    expect(res.body.detail).toMatch(/not a verdict/);
  });

  it('a DELETE that throws is not a release either', async () => {
    mockCacheFindUnique.mockResolvedValue(leaseRow(USER_ID));
    mockCacheDeleteMany.mockRejectedValue(new Error('write failed'));

    const res = await request(buildApp()).post(RELEASE_URL).send({ account: COUNCIL });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('SEAT_NOT_RELEASED');
  });

  it('a lease with no owner recorded belongs to nobody — it dies at its deadline, not by request', async () => {
    mockCacheFindUnique.mockResolvedValue(leaseRow(null));

    const res = await request(buildApp()).post(RELEASE_URL).send({ account: COUNCIL });

    expect(res.status).toBe(403);
    expect(mockCacheDeleteMany).not.toHaveBeenCalled();
  });

  it('no session → 401, and a body that is not an XRPL account → 400', async () => {
    expect((await request(buildApp(null)).post(RELEASE_URL).send({ account: COUNCIL })).status).toBe(401);
    expect((await request(buildApp()).post(RELEASE_URL).send({ account: '0xdeadbeef' })).status).toBe(400);
    expect(mockCacheDeleteMany).not.toHaveBeenCalled();
  });
});

/**
 * EL AVISO SE DESMENTÍA A SÍ MISMO EN SU PRIMERA FRASE.
 *
 * QUÉ SE VEÍA EN PANTALLA. El aviso `seat-already-spent` se pinta con el titular del
 * cliente («That Sequence has already been used») y el CUERPO es esta prosa del
 * servidor. Y esta prosa arrancaba con «…is collecting signatures in the inbox and is
 * holding the account’s only Sequence», que dice exactamente lo contrario: si el
 * asiento ya se gastó, esa fila NO lo retiene. Dos renglones, dos verdades
 * incompatibles, al lado de un QR — y la conclusión que una familia saca de ahí
 * («pues liquido esa fila») es la que paga dos veces.
 *
 * Había UN solo `lead` para tres físicas. Ahora la frase que afirma que la fila
 * retiene el asiento solo se usa cuando de verdad lo retiene.
 */
describe('Un aviso, una sola cosa dicha', () => {
  it('asiento ya gastado: el aviso NO dice que esa fila retiene la única Sequence', async () => {
    // Una propuesta VIVA de esta cuenta fijada en la Sequence 7; el ledger va por la
    // 11, así que su asiento ya se gastó y estos bytes llevan la siguiente libre.
    mockFindFirst.mockResolvedValue({
      id: 'p9',
      title: 'Pago proveedor',
      txType: 'Payment',
      txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 },
      signerList: SIGNERS,
    });
    asExit();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    expect(res.body.seatNotices).toHaveLength(1);
    const notice = res.body.seatNotices[0];
    expect(notice.kind).toBe('seat-already-spent');
    // LO QUE IMPORTA: el cuerpo ya no afirma lo contrario de su propio titular.
    expect(String(notice.detail)).not.toContain('holding the account’s only Sequence');
    expect(String(notice.detail)).toContain('already been spent');
    // Y sigue diciendo la fila de la que habla, y el paso correcto: el explorador.
    expect(String(notice.detail)).toContain('id p9');
    expect(String(notice.detail)).toContain('explorer');
    // Jamás el título ajeno.
    expect(String(notice.detail)).not.toContain('Pago proveedor');
  });

  it('rival de verdad: ahí SÍ se dice que retiene el asiento, y se manda al explorador antes de liquidar', async () => {
    // Misma cuenta, pero la fila viva está fijada en la 11 — la siguiente libre del
    // ledger — así que estos bytes SÍ toman su asiento a propósito.
    mockFindFirst.mockResolvedValue({
      id: 'p9',
      title: 'Pago proveedor',
      txType: 'Payment',
      txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11 },
      signerList: SIGNERS,
    });
    asExit();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    expect(res.body.seatNotices[0].kind).toBe('rival-seat');
    const detail = String(res.body.seatNotices[0].detail);
    expect(detail).toContain('holding the account’s only Sequence');
    // «liquida esa fila» jamás va primero — el explorador sí.
    expect(detail).toContain('explorer');
    expect(detail.indexOf('explorer')).toBeLessThan(detail.indexOf('settle it in the proposal inbox'));
  });
});

/**
 * EL AVISO QUE LLEVABA DENTRO SU PROPIA NEGACIÓN.
 *
 * La partió el `lead` en `{ holdsSeat, neutral }` y usó el neutro SOLO en
 * `seat-already-spent`. `seat-not-pinned` siguió cogiendo `holdsSeat` — «…is
 * collecting signatures in the inbox and is holding the account’s only Sequence» —
 * y detrás le pegaba `contestPhysics()`, que dice justo lo contrario o admite que no
 * pudo mirarlo. Peor: las dos mitades leen el MISMO `account_info`, así que lo
 * normal es que impriman EL MISMO NÚMERO a los dos lados de un «no fue pinado».
 *
 * Estos tests sujetan la cadena entera: el cuerpo que sale por el cable, no la
 * función de dentro. Una familia lee ese párrafo al lado de un QR.
 */
describe('`seat-not-pinned` no contiene su propia negación', () => {
  const seatNotPinned = (body: { seatNotices?: Array<{ kind: string; detail?: string }> }): string => {
    const found = (body.seatNotices ?? []).find((n) => n.kind === 'seat-not-pinned');
    // El aviso TIENE que salir por el cable: sin él no hay nada que leer.
    expect(found).toBeTruthy();
    return String(found?.detail ?? '');
  };

  it('mismo número a los dos lados: se dice que chocan, en vez de afirmarlo y negarlo', async () => {
    // La fila viva está fijada en la 11, que es la siguiente libre del ledger: el
    // caso NORMAL, porque las dos mitades salen del mismo `account_info`.
    mockFindFirst.mockResolvedValue({
      id: 'p9',
      title: 'Pago proveedor',
      txType: 'Payment',
      txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11 },
      signerList: SIGNERS,
    });
    unclassified();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    const detail = seatNotPinned(res.body);
    // LA AFIRMACIÓN que la quitó de su gemelo y dejó aquí.
    expect(detail).not.toContain('holding the account’s only Sequence');
    // …y LA NEGACIÓN, que sigue estando: juntas eran el aviso.
    expect(detail).toContain('NOT pinned to that seat');
    // Tampoco lo llama «the exit»: su propia física acaba de decir que no lo confirmó.
    expect(detail).not.toContain('composing the exit anyway');
    expect(detail).toContain('could not confirm');
    // Y el número repetido ya no se imprime dos veces como si fueran dos asientos.
    expect(detail).toContain('the number that row is holding (11)');
    expect(detail).toContain('explorer');
    // Jamás el título de otra familia.
    expect(detail).not.toContain('Pago proveedor');
  });

  it('números distintos: se dicen los dos, y este aplica solo — sin veredicto sobre el otro', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'p9',
      title: 'Pago proveedor',
      txType: 'Payment',
      txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 },
      signerList: SIGNERS,
    });
    unclassified();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    const detail = seatNotPinned(res.body);
    expect(detail).not.toContain('holding the account’s only Sequence');
    expect(detail).toContain('it carries Sequence 11 and that row holds 7');
    expect(detail).toContain('two different seats');
    // «No pude leer» no es un veredicto sobre la otra fila.
    expect(detail).toContain('nothing here checked whether it has');
    expect(detail).toContain('explorer');
  });

  it('su Sequence ilegible: no se afirma que la retenga, ni que no', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'p9',
      title: 'Pago proveedor',
      txType: 'Payment',
      // Sin `Sequence` en el txjson: el asiento de esa fila no se pudo leer.
      txjson: { TransactionType: 'Payment', Account: COUNCIL },
      signerList: SIGNERS,
    });
    unclassified();

    const res = await request(app).post(URL).send(EXIT_BODY);

    expect(res.status).toBe(200);
    const detail = seatNotPinned(res.body);
    expect(detail).not.toContain('holding the account’s only Sequence');
    expect(detail).toContain('that row’s own Sequence we could not read');
    expect(detail).toContain('NOT pinned to that seat');
  });
});

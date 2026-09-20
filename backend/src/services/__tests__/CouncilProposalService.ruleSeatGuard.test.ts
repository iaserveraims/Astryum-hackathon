/**
 * G1-cadena (round 3, finding 1) — THE DOUBLE PAYMENT'S WORST PATH: the rule.
 *
 * `POST /` learned in round 2 to ask the ledger about the previous seat before
 * pinning a new Sequence. `createCouncilProposalFromRule` — the door a fired
 * governed MoneyFlow walks through, with NOBODY in front of a screen — did not.
 * And because the guard stopped archiving what it could not disprove, the stale
 * row now stays `ready`/`collecting` for ever, so nothing clears it by itself:
 * a monthly rule composed a fresh, perfectly valid Sequence over a payment that
 * may already have gone out. Every month.
 *
 * These tests run the REAL service against a mocked Prisma and a mocked
 * `account_info` — the same shape the route suite uses — so they fail on the
 * code as it was: there, `prepareCouncilMultisig` and `create` were both called.
 */

const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
/** g1-ceremonia: the ceremony lease the rule path was blind to. */
const mockCacheFindUnique = jest.fn();
const mockCacheDeleteMany = jest.fn();
/** productizer-it6: the trigger-time seat check asks who this owner is. */
const mockWalletFindMany = jest.fn();
/**
 * productizer it. 17 (finding 2.1): and the ANSWER is a PROVEN address — an active
 * `WalletBinding` the user signed a challenge for — never a `wallet` row, which
 * anybody can write by typing a council's public signer address. The rule path has
 * no request, so a binding is the only proof it can have.
 */
const mockBindingFindMany = jest.fn();

jest.mock('../../database/prismaClient', () => ({
  prisma: {
    councilProposal: {
      findFirst: (...a: unknown[]) => mockFindFirst(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
    cacheEntry: {
      findUnique: (...a: unknown[]) => mockCacheFindUnique(...a),
      deleteMany: (...a: unknown[]) => mockCacheDeleteMany(...a),
    },
    wallet: {
      findMany: (...a: unknown[]) => mockWalletFindMany(...a),
    },
    walletBinding: {
      findMany: (...a: unknown[]) => mockBindingFindMany(...a),
    },
    // provenAddresses reads the takeover floor off the user's preferences.
    user: {
      findUnique: async () => ({ preferences: null }),
    },
  },
}));

const mockAccountSequence = jest.fn();
/** productizer-it6: the council's signer list, read off the ledger at trigger time. */
const mockSignerCouncil = jest.fn();
jest.mock('../../integrations/providers/chain/XRPLProvider', () => ({
  xrplProvider: {
    getAccountSequence: (...a: unknown[]) => mockAccountSequence(...a),
    getSignerCouncil: (...a: unknown[]) => mockSignerCouncil(...a),
  },
}));

const mockPrepare = jest.fn();
jest.mock('../../connectors/protocols/xrpl/XrplMultisigCoordinator', () => ({
  prepareCouncilMultisig: (...a: unknown[]) => mockPrepare(...a),
  NotACouncilError: class NotACouncilError extends Error {
    constructor(account: string) {
      super(`${account} has no SignerList — it is not a council account`);
    }
  },
}));

jest.mock('../../services/JurisdictionService', () => ({
  jurisdictionService: { isDefiExecutionAllowed: () => ({ allowed: true }) },
}));

import { createCouncilProposalFromRule } from '../CouncilProposalService';
import { __resetSequenceCache } from '../../routes/councilProposals';

const COUNCIL = 'rsmvJMhhjn6L3oCf29UZE2mtw9kcsKDmrf';
const SIGNERS = [
  { account: 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2', weight: 1 },
  { account: 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w', weight: 1 },
];

/** A past-deadline row the guard refused to archive (pinned Sequence 7). */
const staleRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  account: COUNCIL,
  title: 'Alquiler de mayo',
  txType: 'Payment',
  txjson: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 7 },
  status: 'ready',
  expiresAt: new Date(Date.now() - 1000),
  ...overrides,
});

function readyToPin() {
  mockPrepare.mockResolvedValue({
    multisigTx: { TransactionType: 'Payment', Account: COUNCIL, Sequence: 11, SigningPubKey: '' },
    council: { quorum: 2, masterKeyDisabled: true, signers: SIGNERS },
    fee: { drops: '36', baseFeeDrops: 12, signerCount: 2 },
    preflight: { available: true, willSucceed: true, balanceChanges: [] },
  });
  mockCreate.mockResolvedValue({ id: 'p-new' });
}

const fire = () =>
  createCouncilProposalFromRule({
    account: COUNCIL,
    xrplTx: { TransactionType: 'Payment', Account: COUNCIL, Destination: SIGNERS[0].account, Amount: '1000' },
    title: 'Alquiler — mensual',
    createdByUserId: 'user-1',
  });

beforeEach(() => {
  for (const m of [mockFindFirst, mockFindMany, mockCreate, mockUpdate, mockPrepare, mockAccountSequence, mockCacheFindUnique, mockCacheDeleteMany, mockSignerCouncil, mockWalletFindMany, mockBindingFindMany]) {
    m.mockReset();
  }
  // it. 17: the proof is read from the database, so this path needs one.
  process.env.DATABASE_URL = 'postgres://test';
  __resetSequenceCache();
  // productizer-it6 defaults: COUNCIL has a signer list, and the rule owner
  // (user-1) holds one of its seats — PROVEN by a signed binding (it. 17).
  mockSignerCouncil.mockResolvedValue({ quorum: 2, masterKeyDisabled: true, signers: SIGNERS });
  mockBindingFindMany.mockResolvedValue([
    { address: SIGNERS[0].account, signatureProof: 'signed-challenge', linkedAt: new Date(0) },
  ]);
  mockFindFirst.mockResolvedValue(null); // nothing live INSIDE its deadline
  mockFindMany.mockResolvedValue([]); // …and no stale rows unless a test says so
  mockCacheFindUnique.mockResolvedValue(null); // …and no ceremony holding the seat
  mockCacheDeleteMany.mockResolvedValue({ count: 0 })
});

describe('createCouncilProposalFromRule — the rule may not compose over an unresolved seat', () => {
  it('a CONSUMED prior seat stops the rule: nothing is pinned, nothing is persisted', async () => {
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockResolvedValue(9); // pinned 7, the account moved past it
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('PRIOR_SEAT_UNRESOLVED');
    // The verdict travels in words: the run log and the Alert are what the
    // family reads about a tick nobody watched.
    expect(outcome.detail).toContain('Alquiler de mayo');
    expect(outcome.detail).toContain('Sequence 7');
    expect(outcome.detail).toContain('pays twice');
    // THE REGRESSION: both of these ran, and a second valid Sequence existed.
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('an UNREADABLE ledger stops it too — "we could not check" is never "it is fine"', async () => {
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(outcome.detail).toContain('XRPL could not be read');
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a `collecting` stale row blocks it as well — the seat is pinned before anybody signs', async () => {
    mockFindMany.mockResolvedValue([staleRow({ status: 'collecting' })]);
    mockAccountSequence.mockResolvedValue(9);
    readyToPin();

    const outcome = await fire();

    expect(outcome.reason).toBe('PRIOR_SEAT_UNRESOLVED');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('an UNUSED prior seat is genuinely expired: it is archived and the rule composes', async () => {
    mockFindMany.mockResolvedValue([staleRow()]);
    mockAccountSequence.mockResolvedValue(7); // still the pinned seat → never executed
    mockUpdate.mockResolvedValue({});
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(true);
    expect(outcome.proposalId).toBe('p-new');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: { status: 'expired' } }),
    );
    expect(mockPrepare).toHaveBeenCalled();
  });

  it('with no stale rows the rule path is untouched, and costs no ledger read', async () => {
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(true);
    expect(mockAccountSequence).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });

  it('a live proposal inside its deadline still answers LIVE_PROPOSAL_EXISTS (retry after cooldown)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'p0' });
    readyToPin();

    const outcome = await fire();

    expect(outcome.reason).toBe('LIVE_PROPOSAL_EXISTS');
    // The cheap check still runs first: a busy council pays for no ledger read.
    expect(mockAccountSequence).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });
});

/**
 * g1-ceremonia (round 4) — THE RULE PATH WAS BLIND TO THE SITTING TOO.
 *
 * A synchronous ceremony pins the council's Sequence and used to leave no trace
 * at all, so a governed MoneyFlow firing on a tick could pin the same one with
 * nobody watching. And point 3 of the same round: the live-proposal predicate
 * here was a THIRD literal copy of `findLiveProposal`, in a file that already
 * imports from that module.
 *
 * These fail on the code as it shipped in 256a6b0.
 */
describe('createCouncilProposalFromRule — a ceremony in flight is a busy council', () => {
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

  it('the rule does NOT compose over the seat a sitting is holding', async () => {
    mockCacheFindUnique.mockResolvedValue(leaseRow());
    mockAccountSequence.mockResolvedValue(7); // the seat is still unused
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(false);
    // LIVE_PROPOSAL_EXISTS on purpose: AutomationEngine reads that reason as
    // "council busy → retry after cooldown, do not count this tick as fired",
    // and every other reason as an error with an Alert. A sitting in progress
    // is a busy council, not a broken rule.
    expect(outcome.reason).toBe('LIVE_PROPOSAL_EXISTS');
    expect(outcome.detail).toContain('mid-ceremony');
    expect(outcome.detail).toContain('Sequence 7');
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('an UNREADABLE ledger keeps the lease standing — the rule waits, it does not compose', async () => {
    mockCacheFindUnique.mockResolvedValue(leaseRow());
    mockAccountSequence.mockRejectedValue(new Error('websocket down'));
    readyToPin();

    const outcome = await fire();

    expect(outcome.reason).toBe('LIVE_PROPOSAL_EXISTS');
    expect(outcome.detail).toContain('a failure of ours');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('release #2 — the ledger burnt that seat, so the rule composes on this very tick', async () => {
    mockCacheFindUnique.mockResolvedValue(leaseRow());
    mockAccountSequence.mockResolvedValue(9); // pinned 7 → consumed
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(true);
    expect(outcome.proposalId).toBe('p-new');
    expect(mockCacheDeleteMany).toHaveBeenCalledWith({
      where: { cacheKey: `council-ceremony-seat:${COUNCIL}` },
    });
  });

  it('point 3 (it6): the seat check runs before the live check, so the live check still only runs for a member', async () => {
    readyToPin();
    await fire();
    expect(mockSignerCouncil).toHaveBeenCalledWith(COUNCIL);
    expect(mockFindFirst).toHaveBeenCalled();
  });

  it('point 3: the live check is the SHARED findLiveProposal, not a local copy', async () => {
    readyToPin();

    await fire();

    // The shared guard selects the row's title and type so its refusals can
    // name it; the copy that used to live here selected only the id. it. 19 (2.2):
    // it also reads the pinned txjson and the signer list — the ceremony door pins
    // an exit to the seat this row is holding, and only that council reads its title.
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          account: COUNCIL,
          status: { in: ['collecting', 'ready'] },
          expiresAt: { gt: expect.any(Date) },
        }),
        select: { id: true, title: true, txType: true, txjson: true, signerList: true },
      }),
    );
  });
});

/**
 * productizer-it6 — THE RULE PROPOSED ON ANY COUNCIL ITS OWNER NAMED.
 *
 * `createCouncilProposalFromRule` created the proposal with the rule owner as
 * proposer and asked nothing about the owner's seat. `POST /api/rules` now
 * refuses such a rule; this is the defence in depth at trigger time (existing
 * rules, a member removed from the SignerList, any other writer of rule rows).
 * Every refusal below created a proposal on the code before this round.
 */
describe('createCouncilProposalFromRule — the owner must still sit on the council', () => {
  it('an owner holding none of the ledger signer addresses → NOT_A_COUNCIL_MEMBER; nothing read, pinned or persisted', async () => {
    // it. 17: a `wallet` row naming a seat buys nothing — nobody reads that table.
    mockWalletFindMany.mockResolvedValue([{ address: SIGNERS[0].account }]);
    mockBindingFindMany.mockResolvedValue([]);
    mockFindFirst.mockResolvedValue({ id: 'p-other-family', title: 'Herencia', txType: 'Payment' });
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('NOT_A_COUNCIL_MEMBER');
    expect(outcome.detail).toContain(COUNCIL);
    // Asked against the LEDGER signer list, with the rule owner's user id.
    expect(mockSignerCouncil).toHaveBeenCalledWith(COUNCIL);
    // it. 17: asked of the PROOF (this owner's active, signature-backed bindings).
    expect(mockBindingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', isActive: true } }),
    );
    expect(mockWalletFindMany).not.toHaveBeenCalled();
    // It runs FIRST: another council's live proposal (id, title) never reaches
    // the run notes of a non-member.
    expect(outcome.detail).not.toContain('p-other-family');
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('an account with no SignerList → NOT_A_COUNCIL, nothing persisted', async () => {
    mockSignerCouncil.mockResolvedValue(null);
    readyToPin();

    const outcome = await fire();

    expect(outcome.reason).toBe('NOT_A_COUNCIL');
    expect(outcome.detail).toContain('no SignerList');
    expect(mockBindingFindMany).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('an unreadable signer list → COUNCIL_READ_FAILED — "we could not check" is never "they are a member"', async () => {
    mockSignerCouncil.mockRejectedValue(new Error('websocket down'));
    readyToPin();

    const outcome = await fire();

    expect(outcome.reason).toBe('COUNCIL_READ_FAILED');
    expect(outcome.detail).toContain('websocket down');
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a member composes as before, proposer of record = the rule owner', async () => {
    readyToPin();

    const outcome = await fire();

    expect(outcome.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdByUserId: 'user-1', account: COUNCIL }) }),
    );
  });
});

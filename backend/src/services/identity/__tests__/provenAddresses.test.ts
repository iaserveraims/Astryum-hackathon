/**
 * provenAddresses — only signatures count as proof; the plain wallet table
 * never does, and a failed read never widens the set.
 */

const mockBindingFindMany = jest.fn();
const mockWalletFindMany = jest.fn();
const mockUserFindUnique = jest.fn();
// Present ONLY so a test can assert it is never called: reading proofs must not
// repair, merge or write anything (it. 20, 2.4 — a «repair» of an unparseable
// `security` block is how a pre-takeover binding would come back to life).
const mockUserUpdate = jest.fn();
jest.mock('../../../database/prismaClient', () => ({
  prisma: {
    walletBinding: { findMany: (...a: unknown[]) => mockBindingFindMany(...a) },
    wallet: { findMany: (...a: unknown[]) => mockWalletFindMany(...a) },
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
      updateMany: (...a: unknown[]) => mockUserUpdate(...a),
    },
  },
}));

import {
  PROOF_REFUSALS,
  includesAddress,
  isDeterministicProofFailure,
  proofOutcome,
  proveAddress,
  proveMembership,
  provenAddressesDetailed,
  provenAddressesOf,
  refusalForUnreadableStore,
  sameAddress,
  seatProofFromVerdict,
  sessionAddressClaim,
} from '../provenAddresses';

const XRPL = 'rDarPNJEpCnpBZSfmcquydockkePkjPGA2';
const XRPL_OTHER = 'rLNaPoKeeBjZe2qs6x52yVPZpZ8td4dc6w';
const EVM = '0xEabCD745000000000000000000000000000000cd';

const ORIGINAL_DB = process.env.DATABASE_URL;
beforeEach(() => {
  jest.clearAllMocks();
  // A readable account with no takeover on record, unless a test says otherwise.
  mockUserFindUnique.mockResolvedValue({ preferences: null });
  process.env.DATABASE_URL = 'postgres://test';
});
afterAll(() => {
  if (ORIGINAL_DB === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL_DB;
});

describe('sameAddress / includesAddress', () => {
  it('EVM compares case-insensitively', () => {
    expect(sameAddress(EVM, EVM.toLowerCase())).toBe(true);
    expect(includesAddress([EVM.toLowerCase()], EVM)).toBe(true);
  });

  it('XRPL compares exactly — the case IS the address', () => {
    expect(sameAddress(XRPL, XRPL.toLowerCase())).toBe(false);
    expect(sameAddress(XRPL, XRPL)).toBe(true);
    expect(includesAddress([XRPL_OTHER], XRPL)).toBe(false);
  });

  it('empty values never match', () => {
    expect(sameAddress('', '')).toBe(false);
    expect(includesAddress([XRPL], undefined)).toBe(false);
  });
});

describe('provenAddressesOf', () => {
  it('session address + active bindings WITH a signature proof, deduped', async () => {
    mockBindingFindMany.mockResolvedValue([
      { address: XRPL_OTHER, signatureProof: '0xsig' },
      { address: EVM.toLowerCase(), signatureProof: 'sig' },
      { address: 'rNoProofNoProofNoProofNoProof1', signatureProof: '   ' },
      { address: XRPL, signatureProof: 'dup' },
    ]);
    const out = await provenAddressesOf('user-1', XRPL);
    expect(out).toEqual([XRPL, XRPL_OTHER, EVM.toLowerCase()]);
    expect(mockBindingFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', isActive: true },
      select: { address: true, signatureProof: true, linkedAt: true },
    });
    // The unsigned wallet registry is never consulted as proof.
    expect(mockWalletFindMany).not.toHaveBeenCalled();
  });

  it('after a takeover (preferences.security.takeoverAt) only bindings linked AT or AFTER it count', async () => {
    const takeoverAt = '2026-09-14T10:00:00.000Z';
    mockUserFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt, credentialsEpoch: takeoverAt } } });
    mockBindingFindMany.mockResolvedValue([
      { address: XRPL_OTHER, signatureProof: 'intruder-blob', linkedAt: new Date('2026-09-13T09:00:00.000Z') },
      { address: EVM.toLowerCase(), signatureProof: 'owner-sig', linkedAt: new Date('2026-09-14T10:05:00.000Z') },
      { address: 'rNoDateNoDateNoDateNoDateNoDat', signatureProof: 'sig', linkedAt: null },
    ]);
    const out = await provenAddressesOf('user-1', '');
    expect(out).toEqual([EVM.toLowerCase()]);
    expect(mockUserFindUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { preferences: true } });
  });

  it('a failed user read degrades to the session address too (never widens)', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    mockBindingFindMany.mockResolvedValue([{ address: XRPL_OTHER, signatureProof: 'sig', linkedAt: new Date() }]);
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await provenAddressesOf('user-1', XRPL)).toEqual([XRPL]);
    err.mockRestore();
  });

  it('without DATABASE_URL only the session address is known', async () => {
    delete process.env.DATABASE_URL;
    expect(await provenAddressesOf('user-1', XRPL)).toEqual([XRPL]);
    expect(mockBindingFindMany).not.toHaveBeenCalled();
  });

  it('a failed binding read degrades to the session address, never throws', async () => {
    mockBindingFindMany.mockRejectedValue(new Error('db down'));
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await provenAddressesOf('user-1', EVM)).toEqual([EVM]);
    err.mockRestore();
  });

  it('no session address and no user → empty', async () => {
    expect(await provenAddressesOf(null, '')).toEqual([]);
    expect(mockBindingFindMany).not.toHaveBeenCalled();
  });
});

/**
 * productizer it. 16 (4.3) — this list decides who displaces a 0xFE seat and who
 * controls a council. A `security` block that does not parse used to come out as
 * «there was no takeover», i.e. «could not read» granting permission. It is now
 * read with the same strictness as the cage acknowledgement and the legal
 * click-wrap: unreadable ⇒ no bindings at all.
 */
describe('provenAddressesOf — «no pude leer» el suelo nunca es permiso', () => {
  let err: jest.SpyInstance;
  beforeEach(() => {
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockBindingFindMany.mockResolvedValue([
      { address: XRPL_OTHER, signatureProof: 'sig', linkedAt: new Date('2026-09-14T11:00:00.000Z') },
    ]);
  });
  afterEach(() => err.mockRestore());

  it.each([
    ['preferences that are not an object', 'oops'],
    ['a security block that is not an object', { security: 'nonsense' }],
    ['a takeoverAt that is not an instant', { security: { takeoverAt: 'not a date' } }],
    ['a takeoverAt that is null', { security: { takeoverAt: null } }],
  ])('drops every binding when the mark is unreadable: %s', async (_label, preferences) => {
    mockUserFindUnique.mockResolvedValue({ preferences });
    const out = await provenAddressesDetailed('user-1', XRPL);
    // Only the session address survives: it is THIS login's signature, and a
    // takeover kills every earlier session — so it is never the intruder's.
    expect(out.addresses).toEqual([XRPL]);
    expect(out.floorReadable).toBe(false);
  });

  it('a missing user row is unreadable too, not «no takeover»', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const out = await provenAddressesDetailed('user-1', XRPL);
    expect(out.addresses).toEqual([XRPL]);
    expect(out.floorReadable).toBe(false);
  });

  it('a readable account with no mark still proves its bindings', async () => {
    mockUserFindUnique.mockResolvedValue({ preferences: { security: { credentialsEpoch: 'x' } } });
    const out = await provenAddressesDetailed('user-1', XRPL);
    expect(out.addresses).toEqual([XRPL, XRPL_OTHER]);
    expect(out.floorReadable).toBe(true);
  });

  it('a failed read reports the floor as unreadable as well, and says why', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    expect(await provenAddressesDetailed('user-1', XRPL)).toEqual({
      addresses: [XRPL],
      floorReadable: false,
      failure: 'read-failed',
    });
  });

  it('each way of not reading it is named apart', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    expect((await provenAddressesDetailed('user-1', XRPL)).failure).toBe('no-user-row');
    mockUserFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: 'not a date' } } });
    expect((await provenAddressesDetailed('user-1', XRPL)).failure).toBe('unreadable-floor');
    mockUserFindUnique.mockResolvedValue({ preferences: null });
    expect((await provenAddressesDetailed('user-1', XRPL)).failure).toBeNull();
  });
});

/**
 * productizer it. 18 (3.1) — «no pude leer» is neither permission NOR punishment.
 *
 * The list alone cannot tell «this session proved nothing» from «I could not
 * read», and treating the two alike is what closed EXITS: a transient database
 * failure took away the user's ability to free or displace THEIR OWN 0xFE seat
 * and to sign `pote-exit` / `pa-unmint`. `proveAddress` makes the difference the
 * route's answer: fail-closed on an entry, 503 «try again» on an exit.
 */
describe('proveAddress — the verdict a route owes', () => {
  let err: jest.SpyInstance;
  beforeEach(() => {
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockBindingFindMany.mockResolvedValue([]);
  });
  afterEach(() => err.mockRestore());

  it('a proven address is proven on either path', async () => {
    mockBindingFindMany.mockResolvedValue([{ address: XRPL_OTHER, signatureProof: 'sig', linkedAt: new Date() }]);
    for (const purpose of ['entry', 'exit'] as const) {
      const v = await proveAddress('user-1', XRPL, XRPL_OTHER, purpose);
      expect(v.proven).toBe(true);
      expect(v.refusal).toBeNull();
    }
  });

  it('a READABLE store that does not hold the address is a real no — 403, both paths', async () => {
    for (const purpose of ['entry', 'exit'] as const) {
      const v = await proveAddress('user-1', XRPL, XRPL_OTHER, purpose);
      expect(v.proven).toBe(false);
      expect(v.storeReadable).toBe(true);
      expect(v.refusal).toMatchObject({ status: 403, error: 'ADDRESS_NOT_PROVEN', retryable: false });
    }
  });

  it('an UNREADABLE store on an ENTRY stays fail-closed: 403, no retry promised', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const v = await proveAddress('user-1', XRPL, XRPL_OTHER, 'entry');
    expect(v.proven).toBe(false);
    expect(v.storeReadable).toBe(false);
    expect(v.refusal?.status).toBe(403);
  });

  it('an UNREADABLE store on an EXIT is 503 «try again», NEVER a silent no', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const v = await proveAddress('user-1', XRPL, XRPL_OTHER, 'exit');
    expect(v.proven).toBe(false);
    expect(v.refusal).toMatchObject({ status: 503, error: 'PROOF_STORE_UNREADABLE', retryable: true });
    // The sentence must say nothing was composed and invite a retry.
    expect(v.refusal?.detail).toMatch(/try again/i);
  });

  it('THE LAST KEY OUT: with the store unreadable, the login address still proves itself', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const v = await proveAddress('user-1', XRPL, XRPL, 'exit');
    expect(v.proven).toBe(true);
    expect(v.storeReadable).toBe(false);
    expect(v.refusal).toBeNull();
  });

  it('an empty address is never proven, and never a 503 either', async () => {
    const v = await proveAddress('user-1', XRPL, '  ', 'exit');
    expect(v.proven).toBe(false);
    expect(v.refusal?.status).toBe(403);
  });
});

/**
 * The mitigation above only holds if the login claim survived being minted.
 * `issueSessionForUser` lowercased every address, which is right for EVM and
 * destroys a base58 r-address — so «the wallet you signed in with survives» was
 * false for every session it issued (it. 18, verified over SiweAuth:231 vs :515).
 */
describe('sessionAddressClaim — lowercasing an r-address destroys it', () => {
  it('EVM is lowercased (checksum casing is cosmetic)', () => {
    expect(sessionAddressClaim(EVM)).toBe(EVM.toLowerCase());
  });

  it('XRPL is left exactly as it is, and still matches itself afterwards', () => {
    expect(sessionAddressClaim(XRPL)).toBe(XRPL);
    expect(sameAddress(sessionAddressClaim(XRPL), XRPL)).toBe(true);
    // What the old code did, and why it cost the user their exit:
    expect(sameAddress(XRPL.toLowerCase(), XRPL)).toBe(false);
  });

  it('null / blank become the empty claim, never "null"', () => {
    expect(sessionAddressClaim(null)).toBe('');
    expect(sessionAddressClaim(undefined)).toBe('');
    expect(sessionAddressClaim('   ')).toBe('');
  });
});


/**
 * productizer it. 20, 2.4 — THE 503 THAT NEVER HEALS.
 *
 * `PROOF_STORE_UNREADABLE` said «try again in a moment» for all three causes, and
 * two of them are properties of the stored row, not of the moment: a user row
 * that is gone, and a `security` block that does not parse. For an email/Google
 * user whose only proof is a binding, that was a PERMANENT 503 sitting on top of
 * their exit, with a promise we could not keep. A deterministic cause now answers
 * with what it IS, and with the two doors that are actually open.
 */
describe('proveAddress — a deterministic failure never promises a retry', () => {
  let err: jest.SpyInstance;
  beforeEach(() => {
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockBindingFindMany.mockResolvedValue([]);
  });
  afterEach(() => err.mockRestore());

  it('names which failures waiting cannot fix', () => {
    expect(isDeterministicProofFailure('no-user-row')).toBe(true);
    expect(isDeterministicProofFailure('unreadable-floor')).toBe(true);
    expect(isDeterministicProofFailure('read-failed')).toBe(false);
    expect(isDeterministicProofFailure(null)).toBe(false);
  });

  it('a MISSING USER ROW on an exit is 409, not a 503 that never heals', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const v = await proveAddress('user-1', XRPL, XRPL_OTHER, 'exit');
    expect(v.proven).toBe(false);
    expect(v.failure).toBe('no-user-row');
    expect(v.refusal).toMatchObject({ status: 409, error: 'ACCOUNT_RECORD_MISSING', retryable: false });
    // It says what it is, and what the person and an admin can each do.
    expect(v.refusal?.detail).not.toMatch(/try again in a moment/i);
    expect(v.refusal?.detail).toMatch(/will not fix itself by waiting/i);
    expect(v.refusal?.detail).toMatch(/Sign in with the wallet/i);
    expect(v.refusal?.detail).toMatch(/administrator/i);
  });

  it('an UNPARSEABLE security block on an exit is 409 too, and says re-linking will not help', async () => {
    mockUserFindUnique.mockResolvedValue({ preferences: { security: 'nonsense' } });
    const v = await proveAddress('user-1', XRPL, XRPL_OTHER, 'exit');
    expect(v.failure).toBe('unreadable-floor');
    expect(v.refusal).toMatchObject({ status: 409, error: 'PROOF_FLOOR_UNREADABLE', retryable: false });
    expect(v.refusal?.detail).toMatch(/re-linking one will not help/i);
    expect(v.refusal?.detail).toMatch(/administrator/i);
  });

  it('a FAILED QUERY keeps the retryable 503 — that one really does heal', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const v = await proveAddress('user-1', XRPL, XRPL_OTHER, 'exit');
    expect(v.refusal).toMatchObject({ status: 503, error: 'PROOF_STORE_UNREADABLE', retryable: true });
    expect(v.refusal?.detail).toMatch(/try again in a moment/i);
  });

  /**
   * it. 29: a SECOND code may honestly promise a retry — a mark dated ahead of
   * our clock stops being ahead of it on its own, at a known instant, with
   * nothing written. The invariant is not «one code», it is: a retry is promised
   * exactly where waiting can work, and never on a verdict.
   */
  it('a retry is promised only where waiting can actually work, and always as a 503', () => {
    const MAY_RETRY = new Set(['PROOF_STORE_UNREADABLE', 'PROOF_FLOOR_AHEAD_OF_CLOCK']);
    for (const purpose of ['entry', 'exit'] as const) {
      for (const failure of ['no-user-row', 'unreadable-floor', 'floor-ahead-of-clock', 'read-failed', null] as const) {
        const r = refusalForUnreadableStore(failure, purpose);
        expect(r.retryable).toBe(MAY_RETRY.has(r.error));
        if (r.retryable) expect(r.status).toBe(503);
        // And the verdicts never promise it, whatever the purpose.
        if (!r.retryable) expect(r.detail).not.toMatch(/try again in a moment/i);
      }
    }
  });

  it('an ENTRY stays fail-closed on every cause — nothing here GRANTS anything', async () => {
    for (const preferences of [null as unknown, { security: 'nonsense' }]) {
      if (preferences === null) mockUserFindUnique.mockResolvedValue(null);
      else mockUserFindUnique.mockResolvedValue({ preferences });
      const v = await proveAddress('user-1', XRPL, XRPL_OTHER, 'entry');
      expect(v.proven).toBe(false);
      expect(v.refusal?.retryable).toBe(false);
      expect([403, 409]).toContain(v.refusal?.status);
    }
  });

  /**
   * THE CHOICE, PINNED: an unparseable `security` block is NOT repaired and NOT
   * ignored. Both would resurrect a binding the previous holder attached before
   * the takeover — which is the one thing the floor exists to stop.
   */
  it('a PRE-TAKEOVER binding is never resurrected by an unreadable floor, and nothing is written', async () => {
    mockUserFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: 'not a date' } } });
    mockBindingFindMany.mockResolvedValue([
      { address: XRPL_OTHER, signatureProof: 'sig', linkedAt: new Date('2020-01-01T00:00:00.000Z') },
    ]);
    const v = await proveAddress('user-1', XRPL, XRPL_OTHER, 'exit');
    expect(v.proven).toBe(false);
    expect(v.addresses).toEqual([XRPL]);
    expect(mockUserUpdate).not.toHaveBeenCalled();
    // …and the session's own login address still gets its owner out.
    expect((await proveAddress('user-1', XRPL, XRPL, 'exit')).proven).toBe(true);
  });
});

/**
 * productizer it. 20, 2.1/2.2 — the two shapes the rest of the iteration asks
 * for. Both exist so a caller cannot ask the ambiguous question by accident.
 */
describe('proveMembership — the council read that can say «I could not read»', () => {
  let err: jest.SpyInstance;
  beforeEach(() => {
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockBindingFindMany.mockResolvedValue([]);
  });
  afterEach(() => err.mockRestore());

  it('returns the members this session holds, and no refusal', async () => {
    mockBindingFindMany.mockResolvedValue([{ address: XRPL_OTHER, signatureProof: 'sig', linkedAt: new Date() }]);
    const v = await proveMembership('user-1', XRPL, [XRPL_OTHER, 'rNobody11111111111111111111'], 'exit');
    expect(v.owned).toEqual([XRPL_OTHER]);
    expect(v.storeReadable).toBe(true);
    expect(v.refusal).toBeNull();
  });

  it('a READ store with no match is a real no — the route keeps its own 403 copy', async () => {
    const v = await proveMembership('user-1', XRPL, [XRPL_OTHER], 'exit');
    expect(v.owned).toEqual([]);
    expect(v.storeReadable).toBe(true);
    expect(v.refusal).toBeNull();
  });

  it('a FAILED READ never comes out as «none of your addresses is in this list»', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const v = await proveMembership('user-1', XRPL, [XRPL_OTHER], 'exit');
    expect(v.owned).toEqual([]);
    expect(v.storeReadable).toBe(false);
    expect(v.refusal).toMatchObject({ status: 503, error: 'PROOF_STORE_UNREADABLE', retryable: true });
  });

  it('a deterministic failure refuses deterministically here too', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    const v = await proveMembership('user-1', XRPL, [XRPL_OTHER], 'exit');
    expect(v.refusal).toMatchObject({ status: 409, error: 'ACCOUNT_RECORD_MISSING', retryable: false });
  });

  it('THE COSIGNATORY SIGNED IN WITH A COUNCIL KEY still gets their bytes with the database down', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    const v = await proveMembership('user-1', XRPL, [XRPL, XRPL_OTHER], 'exit');
    expect(v.owned).toEqual([XRPL]);
    expect(v.refusal).toBeNull();
  });

  it('an empty member list is answered, not refused', async () => {
    mockUserFindUnique.mockRejectedValue(new Error('db down'));
    expect(await proveMembership('user-1', XRPL, [], 'exit')).toEqual({
      owned: [],
      storeReadable: true,
      failure: null,
      refusal: null,
    });
  });
});

describe('proofOutcome / seatProofFromVerdict — the seat contract', () => {
  it('the three answers are three, not two', () => {
    expect(proofOutcome({ proven: true, storeReadable: false })).toBe('proven');
    expect(proofOutcome({ proven: false, storeReadable: true })).toBe('not-proven');
    expect(proofOutcome({ proven: false, storeReadable: false })).toBe('could-not-read');
  });

  it('a proven session holds the seat and may supersede', () => {
    const c = seatProofFromVerdict({ proven: true, storeReadable: true, refusal: null }, { supersede: true });
    expect(c).toEqual({
      preparedByProven: true,
      preparedByProofUnreadable: false,
      supersedeAuthorized: true,
      refusal: null,
    });
  });

  it('«I could not read» is marked apart, and never authorises a supersede', () => {
    const refusal = { status: 503, error: 'PROOF_STORE_UNREADABLE', detail: 'x', retryable: true } as const;
    const c = seatProofFromVerdict({ proven: false, storeReadable: false, refusal }, { supersede: true });
    expect(c.preparedByProven).toBe(false);
    // The field that stops a blink of the database from becoming somebody's seat.
    expect(c.preparedByProofUnreadable).toBe(true);
    expect(c.supersedeAuthorized).toBe(false);
    expect(c.refusal).toBe(refusal);
  });

  it('a real no is a real no: not proven, not unreadable, no supersede', () => {
    const refusal = { status: 403, error: 'ADDRESS_NOT_PROVEN', detail: 'x', retryable: false } as const;
    const c = seatProofFromVerdict({ proven: false, storeReadable: true, refusal }, { supersede: true });
    expect(c).toEqual({
      preparedByProven: false,
      preparedByProofUnreadable: false,
      supersedeAuthorized: false,
      refusal,
    });
  });
});


/**
 * productizer it. 23, 2.5 — THE DETERMINISTIC 409s.
 *
 * They are non-retryable, which makes a FALSE one worse than the 503 they
 * replaced: it tells a person with a live session that their account is gone and
 * that waiting will not help, on top of an exit. Two ways they could be false,
 * and both are closed here.
 */
describe('ACCOUNT_RECORD_MISSING is never invented', () => {
  const ORIGINAL_ALLOW = process.env.ALLOW_NO_AUTH;
  const ORIGINAL_ENV = process.env.NODE_ENV;
  afterEach(() => {
    if (ORIGINAL_ALLOW === undefined) delete process.env.ALLOW_NO_AUTH;
    else process.env.ALLOW_NO_AUTH = ORIGINAL_ALLOW;
    process.env.NODE_ENV = ORIGINAL_ENV;
  });

  it('THE DEV BYPASS: `dev-user` has no row by construction — not a missing record', async () => {
    process.env.ALLOW_NO_AUTH = '1';
    process.env.NODE_ENV = 'test';
    mockUserFindUnique.mockResolvedValue(null);

    const v = await proveAddress('dev-user', EVM, XRPL, 'exit');

    expect(mockUserFindUnique).not.toHaveBeenCalled();
    expect(v.storeReadable).toBe(true);
    expect(v.failure).toBeNull();
    // A real, honest no — never the 409 that says the account is gone.
    expect(v.refusal).toMatchObject({ status: 403, error: 'ADDRESS_NOT_PROVEN' });
  });

  it('in PRODUCTION the bypass id is not special — the row is read like anyone else\'s', async () => {
    process.env.ALLOW_NO_AUTH = '1';
    process.env.NODE_ENV = 'production';
    mockBindingFindMany.mockResolvedValue([]);
    mockUserFindUnique.mockResolvedValue({ preferences: null });

    const v = await proveAddress('dev-user', EVM, XRPL, 'exit');

    expect(mockUserFindUnique).toHaveBeenCalled();
    expect(v.storeReadable).toBe(true);
  });

  it('REPLICA LAG / A TRANSACTION BOUNDARY: an absent row is confirmed before it is believed', async () => {
    mockBindingFindMany.mockResolvedValue([{ address: XRPL, signatureProof: '0xsig', linkedAt: new Date(1) }]);
    mockUserFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ preferences: null });

    const v = await proveAddress('user-1', EVM, XRPL, 'exit');

    expect(mockUserFindUnique).toHaveBeenCalledTimes(2);
    expect(v.proven).toBe(true);
    expect(v.refusal).toBeNull();
  });

  it('two independent absent reads ARE the 409 — the state really is that', async () => {
    mockBindingFindMany.mockResolvedValue([]);
    mockUserFindUnique.mockResolvedValue(null);

    const v = await proveAddress('user-1', EVM, XRPL, 'exit');

    expect(mockUserFindUnique).toHaveBeenCalledTimes(2);
    expect(v.refusal).toMatchObject({ status: 409, error: 'ACCOUNT_RECORD_MISSING', retryable: false });
  });

  it('an absence we could NOT confirm is weather — the retryable 503, never the 409', async () => {
    mockBindingFindMany.mockResolvedValue([]);
    mockUserFindUnique.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('pool exhausted'));

    const v = await proveAddress('user-1', EVM, XRPL, 'exit');

    expect(v.failure).toBe('read-failed');
    expect(v.refusal).toMatchObject({ status: 503, error: 'PROOF_STORE_UNREADABLE', retryable: true });
  });
});

/**
 * it. 22, 2.5 — the two 409s reached screens with no reader and degraded to a
 * generic refusal, throwing away the only prose that names a way forward. Every
 * refusal now carries what a reader needs, and the reader never has to know the
 * code to render something true.
 */
/**
 * productizer it. 29 (1.1) — A MARK DATED IN THE FUTURE WAS TAPING AN EMAIL USER
 * OUT OF THEIR OWN CAPITAL, AND OFFERING THEM TWO REMEDIES THAT CANNOT WORK.
 *
 * It. 27 taught the future-mark rule to the legal gate and the cage
 * acknowledgement — the two doors that decide a MODAL — and to neither of the
 * two that decide MONEY. Here the result was worse than the loop it fixed:
 * `readTakeoverAtStrict` said «readable» (it IS readable), so `floorReadable`
 * was set to TRUE — a false statement: the floor was read and is unusable — and
 * the `linkedAt >= takeoverAt` filter then dropped every binding, always. So the
 * exit of a user whose ONLY proof is a binding (email/Google sign-up, no login
 * wallet) came out as 403 `ADDRESS_NOT_PROVEN`, `retryable: false`, under two
 * ways forward that are demonstrably false for that row: «sign in with that
 * wallet» (they have no wallet login) and «link it by signing the binding
 * challenge» (a fresh link is stamped `linkedAt = now`, still below the mark).
 *
 * Nothing about it heals by itself EXCEPT the one thing that does: the wall
 * clock passing the mark. That is what the answer now says.
 */
describe('proveAddress — a takeover mark ahead of our clock', () => {
  const FUTURE = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
  const PAST = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  let err: jest.SpyInstance;

  beforeEach(() => {
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // The realistic row: a binding signed BEFORE the mark, because every binding
    // that can ever exist is signed before a mark that has not happened yet.
    mockBindingFindMany.mockResolvedValue([
      { address: XRPL_OTHER, signatureProof: 'sig', linkedAt: new Date() },
    ]);
    mockUserFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: FUTURE } } });
  });
  afterEach(() => err.mockRestore());

  it('the floor is reported UNUSABLE, not «read fine» — and named apart from the unparseable one', async () => {
    const out = await provenAddressesDetailed('user-1', null);
    expect(out.addresses).toEqual([]);
    // The lie that made the 403 possible: `floorReadable: true` with every
    // binding silently dropped.
    expect(out.floorReadable).toBe(false);
    expect(out.failure).toBe('floor-ahead-of-clock');
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/ahead of our clock/i));
  });

  it('an EXIT is answered «I could not use your floor» — 503, retryable — never «you have not proven that wallet»', async () => {
    const v = await proveAddress('user-1', null, XRPL_OTHER, 'exit');
    expect(v.proven).toBe(false);
    expect(proofOutcome(v)).toBe('could-not-read');
    expect(v.refusal).toMatchObject({ status: 503, error: 'PROOF_FLOOR_AHEAD_OF_CLOCK', retryable: true });
    expect(v.refusal?.error).not.toBe('ADDRESS_NOT_PROVEN');
  });

  it('no way forward it offers is one that cannot work for this row', async () => {
    const v = await proveAddress('user-1', null, XRPL_OTHER, 'exit');
    const said = [v.refusal?.detail ?? '', ...(v.refusal?.ways ?? [])].join(' ');
    // THE REMEDY THAT IS FALSE HERE: re-linking stamps `linkedAt = now`, which is
    // still below the mark. The refusal must say so, not offer it.
    expect(said).not.toMatch(/link it to this account by signing/i);
    expect(said).toMatch(/re-linking one will not help|Re-linking the wallet will not help/i);
    expect(said).toMatch(/dated (later than our own clock|in the future)/i);
    // And it does not claim a row it just read was illegible.
    expect(said).not.toMatch(/cannot be read/i);
    // It does not promise the two things that are false about THIS cause.
    expect(said).not.toMatch(/will not fix itself by waiting/i);
    // It does name the doors that are real.
    expect(said).toMatch(/Try again/i);
    expect(said).toMatch(/Sign in with the wallet that controls this address/);
    expect(said).toMatch(/administrator/i);
  });

  it('an ENTRY stays fail-closed on the same cause — the honest sentence GRANTS nothing', async () => {
    const v = await proveAddress('user-1', null, XRPL_OTHER, 'entry');
    expect(v.proven).toBe(false);
    expect(v.refusal?.status).toBe(503);
    expect(v.refusal?.error).toBe('PROOF_FLOOR_AHEAD_OF_CLOCK');
  });

  it('the session own login address still proves itself — a future mark costs the extra bindings, never the way out', async () => {
    const v = await proveAddress('user-1', XRPL, XRPL, 'exit');
    expect(v.proven).toBe(true);
    expect(v.refusal).toBeNull();
  });

  /**
   * THE CHAIN, END TO END: the same row, the same binding, nothing written —
   * only the clock has moved past the mark. This is why the refusal above is
   * allowed to say «try again».
   */
  it('once the mark is behind the clock the SAME binding proves again, with nothing written', async () => {
    expect((await proveAddress('user-1', null, XRPL_OTHER, 'exit')).proven).toBe(false);
    mockUserFindUnique.mockResolvedValue({ preferences: { security: { takeoverAt: PAST } } });
    const healed = await proveAddress('user-1', null, XRPL_OTHER, 'exit');
    expect(healed.proven).toBe(true);
    expect(healed.storeReadable).toBe(true);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('reading an unusable floor never repairs it', async () => {
    await proveAddress('user-1', null, XRPL_OTHER, 'exit');
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe('every refusal carries what a screen needs', () => {
  const ALL = Object.values(PROOF_REFUSALS);

  it('code, headline, paragraph, the ways forward, and whether a retry helps', () => {
    for (const r of ALL) {
      expect(typeof r.error).toBe('string');
      expect(r.headline && r.headline.length).toBeGreaterThan(0);
      expect(r.detail.length).toBeGreaterThan(40);
      expect(r.ways && r.ways.length).toBeGreaterThanOrEqual(2);
      expect(typeof r.retryable).toBe('boolean');
      // Never the raw code at the user, in any field a screen may print.
      for (const text of [r.headline as string, r.detail, ...(r.ways ?? [])]) {
        expect(text).not.toContain(r.error);
      }
    }
  });

  /**
   * it. 29 — A `Retry-After` IS A NUMBER WE HAVE TO KNOW. Only the retryable
   * refusals may offer waiting at all; among them, only the one whose cause is
   * weather carries a countdown. `PROOF_FLOOR_AHEAD_OF_CLOCK` knows the instant
   * the mark becomes usable but not whether it is three seconds of clock skew or
   * a corrupt date in 2099, so it offers the retry WITHOUT a number rather than
   * put a timer on the wrong one of those.
   */
  it('only a retryable refusal offers waiting, and a Retry-After never sits on a verdict', () => {
    for (const r of ALL) {
      const offersWaiting = (r.ways ?? []).some((w) => /try again|wait/i.test(w));
      expect(offersWaiting).toBe(r.retryable);
      if (r.retryAfterSeconds !== undefined) expect(r.retryable).toBe(true);
    }
    expect(PROOF_REFUSALS.PROOF_STORE_UNREADABLE.retryAfterSeconds).toBeGreaterThan(0);
    expect(PROOF_REFUSALS.PROOF_FLOOR_AHEAD_OF_CLOCK.retryAfterSeconds).toBeUndefined();
  });

  it('the two deterministic 409s name the SAME two real ways out: sign in, or an admin repairs it', () => {
    for (const code of ['ACCOUNT_RECORD_MISSING', 'PROOF_FLOOR_UNREADABLE'] as const) {
      const r = PROOF_REFUSALS[code];
      expect(r.status).toBe(409);
      expect(r.retryable).toBe(false);
      expect(r.ways?.[0]).toMatch(/Sign in with the wallet that controls this address/);
      expect(r.ways?.[1]).toMatch(/administrator/i);
      expect(r.detail).toMatch(/will not fix itself by waiting/i);
      expect(r.detail).toMatch(/nothing was composed and nothing moved/i);
    }
  });

  it('the shared table is never mutated by a caller', () => {
    const a = refusalForUnreadableStore('no-user-row', 'exit');
    a.ways!.push('forged');
    expect(refusalForUnreadableStore('no-user-row', 'exit').ways).toHaveLength(2);
  });
});

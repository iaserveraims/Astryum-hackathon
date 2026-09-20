/**
 * productizer-it9 — the exit classification that travels with a council tx.
 * Unit contract of the MAC: it opens only for the same account, the same bytes
 * (coordinator-pinned fields aside), an exit action, and before it expires.
 */
import {
  COUNCIL_EXIT_TOKEN_TTL_MS,
  COUNCIL_ORDER_EXIT_ACTIONS,
  classifyCouncilExitByMemo,
  councilTxHash,
  isCouncilOrderExitAction,
  isHandoffExitAction,
  issueCouncilExitToken,
  singleMemoHex,
  verifyCouncilExitToken,
} from '../councilExitToken';

const ACCOUNT = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
/**
 * A REAL 0xFE memo: `FE` + walletId + executor fee + the 32 bytes of the userOpHash
 * = 42 bytes / 84 hex (`FlareDirectMintService.test.ts` → «42-byte memo»). NOT a
 * 64-hex keccak, which is the whole point of it. 29.
 */
const ZERO_FE_MEMO = 'FE000000000000030D40' + 'AB'.repeat(32);
const TX = {
  TransactionType: 'Payment',
  Account: ACCOUNT,
  Destination: 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY',
  Amount: '1',
  Memos: [{ Memo: { MemoData: 'ABCDEF' } }],
  SourceTag: 2607090002,
};

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, JWT_SECRET: 'x'.repeat(40) };
});
afterAll(() => {
  process.env = ENV;
});

describe('councilExitToken', () => {
  it('a token verifies for the same account and the same tx, with keys in any order', () => {
    const { exitToken, exitTokenExpiresAt } = issueCouncilExitToken({ account: ACCOUNT, xrplTx: TX, action: 'recall' });
    const reordered = { Memos: TX.Memos, SourceTag: TX.SourceTag, Amount: '1', Destination: TX.Destination, Account: ACCOUNT, TransactionType: 'Payment' };
    expect(verifyCouncilExitToken(exitToken, { account: ACCOUNT, xrplTx: reordered })).toEqual({ ok: true, action: 'recall' });
    const ttl = new Date(exitTokenExpiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(COUNCIL_EXIT_TOKEN_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(COUNCIL_EXIT_TOKEN_TTL_MS);
  });

  it('the fields the coordinator overwrites (Sequence/Fee/SigningPubKey) do not change the hash; anything else does', () => {
    expect(councilTxHash({ ...TX, Sequence: 9, Fee: '36', SigningPubKey: '' })).toBe(councilTxHash(TX));
    expect(councilTxHash({ ...TX, Amount: '2' })).not.toBe(councilTxHash(TX));
    expect(councilTxHash({ ...TX, Memos: [{ Memo: { MemoData: 'ABCDEE' } }] })).not.toBe(councilTxHash(TX));
  });

  it('refuses other bytes, another account, an expired token, a tampered one, another secret', () => {
    const { exitToken } = issueCouncilExitToken({ account: ACCOUNT, xrplTx: TX, action: 'evacuate' });
    expect(verifyCouncilExitToken(exitToken, { account: ACCOUNT, xrplTx: { ...TX, Amount: '1000' } })).toEqual({ ok: false, reason: 'other-tx' });
    expect(verifyCouncilExitToken(exitToken, { account: 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY', xrplTx: TX })).toEqual({ ok: false, reason: 'other-account' });
    expect(verifyCouncilExitToken(exitToken, { account: ACCOUNT, xrplTx: TX }, Date.now() + COUNCIL_EXIT_TOKEN_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });

    const [payload, sig] = exitToken.split('.');
    const forged = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    forged.exp += 24 * 3600_000;
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
    expect(verifyCouncilExitToken(tampered, { account: ACCOUNT, xrplTx: TX })).toEqual({ ok: false, reason: 'bad-signature' });

    process.env.JWT_SECRET = 'y'.repeat(40);
    expect(verifyCouncilExitToken(exitToken, { account: ACCOUNT, xrplTx: TX })).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('absent / malformed tokens never throw', () => {
    expect(verifyCouncilExitToken(undefined, { account: ACCOUNT, xrplTx: TX })).toEqual({ ok: false, reason: 'absent' });
    expect(verifyCouncilExitToken(42, { account: ACCOUNT, xrplTx: TX })).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyCouncilExitToken('a.b.c', { account: ACCOUNT, xrplTx: TX })).toEqual({ ok: false, reason: 'malformed' });
    const { exitToken } = issueCouncilExitToken({ account: ACCOUNT, xrplTx: TX, action: 'recall' });
    expect(verifyCouncilExitToken(exitToken, { account: ACCOUNT, xrplTx: null })).toEqual({ ok: false, reason: 'other-tx' });
  });

  it('only an exit action can be tokenised', () => {
    expect(() => issueCouncilExitToken({ account: ACCOUNT, xrplTx: TX, action: 'direct-to' })).toThrow(/not an exit/);
    expect(() => issueCouncilExitToken({ account: ACCOUNT, xrplTx: TX, action: 'astryum-pote-fund' })).toThrow(/not an exit/);
  });

  it('a 0xFE exit (it. 13 symmetry) can be tokenised and verifies', () => {
    const { exitToken } = issueCouncilExitToken({ account: ACCOUNT, xrplTx: TX, action: 'astryum-creator-exit' });
    expect(verifyCouncilExitToken(exitToken, { account: ACCOUNT, xrplTx: TX })).toEqual({ ok: true, action: 'astryum-creator-exit' });
  });
});

describe('the ONE exit classification (it. 13)', () => {
  it('council orders: exactly recall and evacuate', () => {
    expect([...COUNCIL_ORDER_EXIT_ACTIONS].sort()).toEqual(['evacuate', 'recall']);
    expect(isCouncilOrderExitAction('recall')).toBe(true);
    expect(isCouncilOrderExitAction('direct-to')).toBe(false);
    expect(isCouncilOrderExitAction('recal')).toBe(false);
  });

  it('0xFE handoffs: the exit labels, never an entry, a repay or an unknown label', () => {
    for (const a of [
      'astryum-pote-exit',
      'astryum-pote-exit-fxrp',
      'astryum-pote-request-exit',
      'astryum-pote-claim-exit',
      'astryum-pote-claim-exit-fxrp',
      'astryum-creator-exit',
      'pa-unmint',
      'pa-withdraw-transfer:fxrp->xrpl',
      'pa-withdraw-keep:usdt0',
      'vault-withdraw:firelight',
      'vault-claim',
      'legacy-yield-claim',
    ]) {
      expect({ a, exit: isHandoffExitAction(a) }).toEqual({ a, exit: true });
    }
    for (const a of ['pa-fxrp-entry:e1', 'astryum-pote-create', 'astryum-pote-fund', 'legacy-vault-fund', 'astryum-cage-create', 'pa-repay', 'vault-rotate', '', null, undefined]) {
      expect({ a, exit: isHandoffExitAction(a) }).toEqual({ a, exit: false });
    }
  });

  /**
   * it. 29 — THE BUG THAT KEPT THE WHOLE CLASSIFIER DEAD. This reader demanded
   * EXACTLY 64 hex (a council order's keccak), so the memo of a 0xFE — the whole
   * Smart Account instruction, 42 bytes / 84 hex — read as `null` and every 0xFE
   * came back `no-single-memo`. The two SHAPES are both read now; what tells them
   * apart is the store the memo is found in, never its length.
   */
  it('singleMemoHex: BOTH memo shapes — a council order keccak AND a 0xFE instruction', () => {
    // 32-byte keccak of a council order
    expect(singleMemoHex({ Memos: [{ Memo: { MemoData: 'ab'.repeat(32) } }] })).toBe('AB'.repeat(32));
    // 42-byte 0xFE instruction (the shape FlareDirectMintService really builds)
    expect(ZERO_FE_MEMO).toHaveLength(84);
    expect(singleMemoHex({ Memos: [{ Memo: { MemoData: ZERO_FE_MEMO } }] })).toBe(ZERO_FE_MEMO);
    // …and it normalises `0x` and lowercase, like every other reading of a memo
    expect(singleMemoHex({ Memos: [{ Memo: { MemoData: '0x' + ZERO_FE_MEMO.toLowerCase() } }] })).toBe(ZERO_FE_MEMO);
  });

  it('singleMemoHex: nothing, several, or something that is not hex names no memo', () => {
    expect(singleMemoHex({ Memos: [{ Memo: { MemoData: 'AB' } }] })).toBeNull();
    expect(singleMemoHex({ Memos: [{ Memo: { MemoData: 'AB'.repeat(32) } }, { Memo: { MemoData: 'AB'.repeat(32) } }] })).toBeNull();
    expect(singleMemoHex({ Memos: [{ Memo: { MemoData: 'not-hex-at-all' } }] })).toBeNull();
    expect(singleMemoHex({})).toBeNull();
  });

  it('classifyCouncilExitByMemo never opens for a tx that is not a Payment of this account', async () => {
    const deps = { readComposedOrder: jest.fn(), readHandoff: jest.fn(), readMintDestination: jest.fn() };
    expect(await classifyCouncilExitByMemo({ account: ACCOUNT, xrplTx: { ...TX, TransactionType: 'OfferCreate' } }, deps)).toEqual({ ok: false, reason: 'not-a-payment' });
    expect(await classifyCouncilExitByMemo({ account: ACCOUNT, xrplTx: { ...TX, Account: 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY' } }, deps)).toEqual({ ok: false, reason: 'other-account' });
    expect(deps.readComposedOrder).not.toHaveBeenCalled();
  });
});

/* ── it. 15 (finding 3.3): the refusal has to be true ─────────────────────── */

describe('an exit whose 0xFE is no longer queued', () => {
  // it. 29: the REAL shape — 84 hex, not the 64-hex stand-in these tests used to
  // carry, which is precisely why they never caught the reader that threw it away.
  const MEMO = ZERO_FE_MEMO;
  const exitTx = (over: Record<string, unknown> = {}) => ({
    TransactionType: 'Payment',
    Account: ACCOUNT,
    Destination: 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX',
    Amount: '2000000',
    Memos: [{ Memo: { MemoData: MEMO } }],
    ...over,
  });
  const baseDeps = {
    readComposedOrder: jest.fn(async () => null),
    readHandoff: jest.fn(async () => null),
    readMintDestination: jest.fn(async () => 'rCoreVau1tXXXXXXXXXXXXXXXXXXXXXXX'),
  };

  it.each([
    ['superseded', /superseded/i],
    ['completed', /already went through/i],
    ['parked', /no longer waiting/i],
  ])('a %s exit handoff is «handoff-not-signable», with a line that says what to do', async (status, expected) => {
    const verdict = await classifyCouncilExitByMemo(
      { account: ACCOUNT, xrplTx: exitTx() },
      {
        ...baseDeps,
        readHandoffAnyState: async () => ({ xrplAddress: ACCOUNT, action: 'astryum-pote-exit', grossXrpDrops: '2000000', status }),
      },
    );
    expect(verdict).toMatchObject({ ok: false, reason: 'handoff-not-signable', handoffStatus: status });
    expect(String((verdict as { detail: string }).detail)).toMatch(expected);
    // and it never blames the region
    expect(String((verdict as { detail: string }).detail)).toMatch(/nothing to do with your region/i);
  });

  it('a queued row found only by the any-state read is still a normal, signable exit', async () => {
    expect(
      await classifyCouncilExitByMemo(
        { account: ACCOUNT, xrplTx: exitTx() },
        {
          ...baseDeps,
          readHandoffAnyState: async () => ({ xrplAddress: ACCOUNT, action: 'astryum-pote-exit', grossXrpDrops: '2000000', status: 'queued' }),
        },
      ),
    ).toEqual({ ok: true, source: 'handoff', action: 'astryum-pote-exit' });
  });

  it('an ENTRY or another account is judged as before, never as a stale exit', async () => {
    expect(
      await classifyCouncilExitByMemo(
        { account: ACCOUNT, xrplTx: exitTx() },
        { ...baseDeps, readHandoffAnyState: async () => ({ xrplAddress: ACCOUNT, action: 'astryum-pote-fund', grossXrpDrops: '2000000', status: 'completed' }) },
      ),
    ).toEqual({ ok: false, reason: 'not-an-exit' });
    expect(
      await classifyCouncilExitByMemo(
        { account: ACCOUNT, xrplTx: exitTx() },
        { ...baseDeps, readHandoffAnyState: async () => ({ xrplAddress: 'rQ3fNyLjbvcDaPNS4EAJY8aT9zw3oLjAaY', action: 'astryum-pote-exit', grossXrpDrops: '2000000', status: 'superseded' }) },
      ),
    ).toEqual({ ok: false, reason: 'other-account' });
  });

  it('a database that cannot be read is «unreadable», NEVER «unknown-memo»', async () => {
    expect(
      await classifyCouncilExitByMemo(
        { account: ACCOUNT, xrplTx: exitTx() },
        {
          ...baseDeps,
          readHandoffAnyState: async () => {
            throw new Error('db down');
          },
        },
      ),
    ).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('a memo nobody composed is still unknown', async () => {
    expect(await classifyCouncilExitByMemo({ account: ACCOUNT, xrplTx: exitTx() }, { ...baseDeps, readHandoffAnyState: async () => null })).toEqual({
      ok: false,
      reason: 'unknown-memo',
    });
  });
});

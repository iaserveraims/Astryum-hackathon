const mockBindingFindFirst = jest.fn();
jest.mock('../../database/prismaClient', () => ({
  prisma: { walletBinding: { findFirst: (...a: unknown[]) => mockBindingFindFirst(...a) } },
}));

import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';
import {
  CHALLENGE_RATE_RETRY_AFTER_S,
  _resetStepUpChallengesForTests,
  buildStepUpMessage,
  issueChallenge,
  verifyChallengeAndIssueGrant,
  verifyGrant,
} from '../StepUpAuth';
import { resolveJwtSecret } from '../SiweAuth';

const SECRET = resolveJwtSecret();

function signGrant(claims: Record<string, unknown>, ttl = 300): string {
  return jwt.sign({ typ: 'stepup', sub: 'user-1', ...claims }, SECRET, { expiresIn: ttl });
}

describe('StepUpAuth.verifyGrant', () => {
  it('accepts a matching feature+action grant', () => {
    const token = signGrant({ feat: 'goals', act: 'write' });
    const r = verifyGrant(token, 'goals', 'write');
    expect(r.ok).toBe(true);
    expect(r.userId).toBe('user-1');
  });

  it('a write grant also covers read', () => {
    const token = signGrant({ feat: 'goals', act: 'write' });
    expect(verifyGrant(token, 'goals', 'read').ok).toBe(true);
  });

  it('a read grant does NOT cover write', () => {
    const token = signGrant({ feat: 'goals', act: 'read' });
    expect(verifyGrant(token, 'goals', 'write').ok).toBe(false);
  });

  it('rejects a feature mismatch', () => {
    const token = signGrant({ feat: 'goals', act: 'write' });
    expect(verifyGrant(token, 'moneyflows', 'write').ok).toBe(false);
  });

  it('rejects a non-stepup token', () => {
    const token = jwt.sign({ sub: 'user-1', feat: 'goals', act: 'write' }, SECRET, { expiresIn: 300 });
    expect(verifyGrant(token, 'goals', 'write').ok).toBe(false);
  });

  it('rejects a garbage token', () => {
    expect(verifyGrant('not-a-jwt', 'goals', 'write').ok).toBe(false);
  });
});

describe('StepUpAuth.issueChallenge / buildStepUpMessage', () => {
  const addr = '0x1111111111111111111111111111111111111111';

  it('builds a message containing the nonce and address', () => {
    const msg = buildStepUpMessage('goals', 'write', addr, 'abc123', '2026-01-01T00:00:00Z');
    expect(msg).toContain('Nonce: abc123');
    expect(msg).toContain(addr);
    expect(msg).toContain('No funds are moved');
  });

  it('issues a challenge whose message embeds the nonce', () => {
    const ch = issueChallenge('user-1', 'goals', 'write', addr);
    expect(ch.nonce).toHaveLength(32);
    expect(ch.message).toContain(`Nonce: ${ch.nonce}`);
  });

  it('rejects an invalid address', () => {
    expect(() => issueChallenge('user-1', 'goals', 'write', '0xnope')).toThrow();
  });
});


/**
 * productizer it. 22, «Menor» — A CHALLENGE IS ONE ATTEMPT.
 *
 * The nonce survived a failed signature, so one challenge accepted guess after
 * guess for its whole five-minute TTL — which is the one thing a nonce exists to
 * prevent — and `/challenge` had no cap at all, so a stolen session could mint
 * them in a loop.
 */
describe('StepUpAuth — the nonce is burned by a failed signature', () => {
  const signer = new ethers.Wallet('0x'.padEnd(66, '1'));
  const ADDR = signer.address;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetStepUpChallengesForTests();
    mockBindingFindFirst.mockResolvedValue({ id: 'b1' });
  });

  const verify = (nonce: string, message: string, signature: string) =>
    verifyChallengeAndIssueGrant({
      userId: 'user-1',
      feature: 'goals',
      action: 'write',
      address: ADDR,
      nonce,
      message,
      signature,
      ttlSeconds: 300,
    });

  it('a WRONG signature spends the challenge — the right one no longer works on it', async () => {
    const ch = issueChallenge('user-1', 'goals', 'write', ADDR);
    const other = new ethers.Wallet('0x'.padEnd(66, '2'));
    const wrong = await other.signMessage(ch.message);

    await expect(verify(ch.nonce, ch.message, wrong)).rejects.toMatchObject({ code: 'signature_invalid' });

    const right = await signer.signMessage(ch.message);
    await expect(verify(ch.nonce, ch.message, right)).rejects.toMatchObject({ code: 'nonce_unknown' });
  });

  it('a malformed signature spends it too — no unlimited attempts inside the TTL', async () => {
    const ch = issueChallenge('user-1', 'goals', 'write', ADDR);
    await expect(verify(ch.nonce, ch.message, '0xdeadbeef')).rejects.toMatchObject({ code: 'signature_invalid' });
    await expect(verify(ch.nonce, ch.message, '0xdeadbeef')).rejects.toMatchObject({ code: 'nonce_unknown' });
  });

  it('a nonce offered for a DIFFERENT feature is spent as well', async () => {
    const ch = issueChallenge('user-1', 'goals', 'write', ADDR);
    const sig = await signer.signMessage(ch.message);
    await expect(
      verifyChallengeAndIssueGrant({
        userId: 'user-1',
        feature: 'kyc',
        action: 'write',
        address: ADDR,
        nonce: ch.nonce,
        message: ch.message,
        signature: sig,
        ttlSeconds: 300,
      }),
    ).rejects.toMatchObject({ code: 'nonce_mismatch' });
    await expect(verify(ch.nonce, ch.message, sig)).rejects.toMatchObject({ code: 'nonce_unknown' });
  });

  /**
   * The counterpart, and it is the point: a failure of OURS must never cost the
   * person the challenge they already signed. The binding read is ours.
   */
  it('a wallet that is not linked YET does NOT spend the challenge', async () => {
    const ch = issueChallenge('user-1', 'goals', 'write', ADDR);
    const sig = await signer.signMessage(ch.message);
    mockBindingFindFirst.mockResolvedValueOnce(null);

    await expect(verify(ch.nonce, ch.message, sig)).rejects.toMatchObject({ code: 'wallet_not_linked' });

    // They link it and come straight back: the signature they made still counts.
    const grant = await verify(ch.nonce, ch.message, sig);
    expect(typeof grant.grantToken).toBe('string');
    expect(verifyGrant(grant.grantToken, 'goals', 'write').ok).toBe(true);
  });

  it('a binding read that THROWS does not spend it either', async () => {
    const ch = issueChallenge('user-1', 'goals', 'write', ADDR);
    const sig = await signer.signMessage(ch.message);
    mockBindingFindFirst.mockRejectedValueOnce(new Error('pool exhausted'));

    await expect(verify(ch.nonce, ch.message, sig)).rejects.toThrow('pool exhausted');
    await expect(verify(ch.nonce, ch.message, sig)).resolves.toMatchObject({ grantToken: expect.any(String) });
  });

  it('success still spends it — single use means single use', async () => {
    const ch = issueChallenge('user-1', 'goals', 'write', ADDR);
    const sig = await signer.signMessage(ch.message);
    await verify(ch.nonce, ch.message, sig);
    await expect(verify(ch.nonce, ch.message, sig)).rejects.toMatchObject({ code: 'nonce_unknown' });
  });
});

describe('StepUpAuth — the challenge door has a per-user cap', () => {
  const ADDR = '0x1111111111111111111111111111111111111111';
  beforeEach(() => _resetStepUpChallengesForTests());

  it('refuses past the cap, says how long to wait, and never touches another user', () => {
    for (let i = 0; i < 20; i += 1) expect(issueChallenge('user-1', 'goals', 'write', ADDR).nonce).toHaveLength(32);
    try {
      issueChallenge('user-1', 'goals', 'write', ADDR);
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toMatchObject({ code: 'too_many_challenges', retryAfterSeconds: CHALLENGE_RATE_RETRY_AFTER_S });
    }
    // Per user: a second account is untouched by the first one's grinding.
    expect(issueChallenge('user-2', 'goals', 'write', ADDR).nonce).toHaveLength(32);
  });

  it('an invalid address never consumes the budget', () => {
    for (let i = 0; i < 30; i += 1) {
      expect(() => issueChallenge('user-3', 'goals', 'write', '0xnope')).toThrow();
    }
    expect(issueChallenge('user-3', 'goals', 'write', ADDR).nonce).toHaveLength(32);
  });
});

import jwt from 'jsonwebtoken';
import { verifyGrant, buildStepUpMessage, issueChallenge } from '../StepUpAuth';
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

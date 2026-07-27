import { MandateService, buildDefaultMandate } from '../policy/MandateService';
import { CooldownService } from '../policy/CooldownService';

describe('buildDefaultMandate', () => {
  it('forbids borrow and caps tx at 10k USD', () => {
    const m = buildDefaultMandate('u1');
    expect(m.scope.forbiddenActions).toContain('borrow');
    expect(m.scope.allowedActions).toContain('supply');
    expect(m.scope.allowedActions).toContain('repay');
    expect(m.scope.allowedChains).toEqual([14]);
    expect(m.limits.maxTxValueUSD).toBe(10_000);
    expect(m.limits.maxSlippageBps).toBe(100);
    expect(m.limits.minHealthFactorAfter).toBe(1.3);
    expect(m.approvals.requireManualApprovalAboveUSD).toBe(5_000);
  });
});

describe('MandateService', () => {
  it('returns default for unknown user and stored for known user', () => {
    const svc = new MandateService();
    expect(svc.getActive('alice').id).toBe(buildDefaultMandate('alice').id);
    const stored = svc.set('alice', { limits: { maxTxValueUSD: 50_000 } as never });
    expect(stored.limits.maxTxValueUSD).toBe(50_000);
    expect(svc.getActive('alice').limits.maxTxValueUSD).toBe(50_000);
  });

  it('isExpired honours expiresAt', () => {
    const svc = new MandateService();
    const past = svc.set('u1', { expiresAt: new Date(Date.now() - 1).toISOString() });
    const future = svc.set('u2', { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(svc.isExpired(past)).toBe(true);
    expect(svc.isExpired(future)).toBe(false);
  });

  it('clear removes stored mandate', () => {
    const svc = new MandateService();
    svc.set('alice', { limits: { maxTxValueUSD: 99_999 } as never });
    svc.clear('alice');
    expect(svc.getActive('alice').limits.maxTxValueUSD).toBe(10_000);
  });
});

describe('CooldownService', () => {
  it('reports inactive when never marked', () => {
    const svc = new CooldownService();
    expect(svc.status('rule-1', 5).active).toBe(false);
  });

  it('reports active during the window', () => {
    const svc = new CooldownService();
    svc.markBroadcast('rule-1', new Date());
    const s = svc.status('rule-1', 5);
    expect(s.active).toBe(true);
    expect(s.remainingSeconds).toBeGreaterThan(0);
    expect(s.remainingSeconds).toBeLessThanOrEqual(5 * 60);
  });

  it('reports inactive once the window has elapsed', () => {
    const svc = new CooldownService();
    svc.markBroadcast('rule-1', new Date(Date.now() - 10 * 60 * 1000));
    expect(svc.status('rule-1', 5).active).toBe(false);
  });

  it('disables gating when cooldownMinutes <= 0', () => {
    const svc = new CooldownService();
    svc.markBroadcast('rule-1', new Date());
    expect(svc.status('rule-1', 0).active).toBe(false);
    expect(svc.status('rule-1', -1).active).toBe(false);
  });

  it('reset clears bookkeeping for one or all rules', () => {
    const svc = new CooldownService();
    svc.markBroadcast('a');
    svc.markBroadcast('b');
    svc.reset('a');
    expect(svc.status('a', 5).active).toBe(false);
    expect(svc.status('b', 5).active).toBe(true);
    svc.reset();
    expect(svc.status('b', 5).active).toBe(false);
  });
});

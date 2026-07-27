import { PolicyGuard } from '../PolicyGuard';
import { MandateService, buildDefaultMandate } from '../policy/MandateService';
import { AllowlistService } from '../policy/AllowlistService';
import { CooldownService } from '../policy/CooldownService';
import type { PolicyEvaluable } from '../policy/types';

const KINETIC_KUSDCE = '0xDEeBaBe05BDA7e8C1740873abF715f16164C29B8';
const SUPPLY_SELECTOR = '0xa0712d68';
const REPAY_SELECTOR = '0x0e752702';

function freshIntent(overrides: Partial<PolicyEvaluable> = {}): PolicyEvaluable {
  const now = Date.now();
  return {
    intentId: 'intent-1',
    action: { type: 'supply', targetProtocol: 'kinetic', targetChain: 14 },
    txData: {
      to: KINETIC_KUSDCE,
      data: SUPPLY_SELECTOR + '0'.repeat(64),
      chainId: 14,
    },
    valueUSD: 100,
    slippageBps: 30,
    simulationId: 'sim-1',
    simulatedAt: new Date(now - 5_000).toISOString(),
    pricesFreshAt: new Date(now - 5_000).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    riskAfter: { healthFactor: 2.0, score: 30 },
    ...overrides,
  };
}

function makeGuard(): { guard: PolicyGuard; mandates: MandateService } {
  const mandates = new MandateService();
  const allowlist = new AllowlistService();
  allowlist.load();
  return { guard: new PolicyGuard(mandates, allowlist), mandates };
}

describe('PolicyGuard', () => {
  test('permits a valid Kinetic supply intent', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent(), { userId: 'u1' });
    expect(r.passed).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.errors).toHaveLength(0);
    expect(r.mandateId).toContain('mandate_default_');
  });

  test('P5 — rejects chainId != 14', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(
      freshIntent({
        action: { type: 'supply', targetProtocol: 'kinetic', targetChain: 1 },
      }),
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.blockReason).toMatch(/chain/);
  });

  test('P5 — rejects mismatched txData.chainId', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(
      freshIntent({ txData: { to: KINETIC_KUSDCE, data: SUPPLY_SELECTOR, chainId: 1 } }),
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'chain_not_allowed')).toBe(true);
  });

  test('P6 — rejects contract outside allowlist', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(
      freshIntent({
        txData: {
          to: '0x0000000000000000000000000000000000000bad',
          data: SUPPLY_SELECTOR,
          chainId: 14,
        },
      }),
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'contract_not_allowed')).toBe(true);
  });

  test('P7 — rejects calldata whose selector does not match action', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(
      freshIntent({
        action: { type: 'supply', targetProtocol: 'kinetic', targetChain: 14 },
        txData: { to: KINETIC_KUSDCE, data: REPAY_SELECTOR, chainId: 14 },
      }),
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'selector_mismatch')).toBe(true);
  });

  test('P8 — rejects forbidden action (default mandate forbids borrow)', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(
      freshIntent({
        action: { type: 'borrow', targetProtocol: 'kinetic', targetChain: 14 },
        txData: { to: KINETIC_KUSDCE, data: '0xc5ebeaec', chainId: 14 },
      }),
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'action_forbidden')).toBe(true);
  });

  test('P9 — rejects valueUSD above mandate.maxTxValueUSD', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent({ valueUSD: 50_000 }), { userId: 'u1' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'value_above_max_tx')).toBe(true);
  });

  test('P10 — rejects slippage above mandate.maxSlippageBps', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent({ slippageBps: 500 }), { userId: 'u1' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'slippage_above_max')).toBe(true);
  });

  test('P4 — rejects stale simulation (>90s)', () => {
    const { guard } = makeGuard();
    const old = new Date(Date.now() - 200_000).toISOString();
    const r = guard.evaluate(freshIntent({ simulatedAt: old }), { userId: 'u1' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'simulation_stale')).toBe(true);
  });

  test('P14 — rejects stale prices (>90s)', () => {
    const { guard } = makeGuard();
    const old = new Date(Date.now() - 200_000).toISOString();
    const r = guard.evaluate(freshIntent({ pricesFreshAt: old }), { userId: 'u1' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'prices_stale')).toBe(true);
  });

  test('P12 — rejects expired intent', () => {
    const { guard } = makeGuard();
    const past = new Date(Date.now() - 10_000).toISOString();
    const r = guard.evaluate(freshIntent({ expiresAt: past }), { userId: 'u1' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'intent_expired')).toBe(true);
  });

  test('P13 — rejects post-action HF below mandate.minHealthFactorAfter', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(
      freshIntent({ riskAfter: { healthFactor: 1.1, score: 60 } }),
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'hf_below_mandate_minimum')).toBe(true);
  });

  test('P13 — rejects risk score above mandate.maxRiskScoreAfter', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(
      freshIntent({ riskAfter: { healthFactor: 2.0, score: 95 } }),
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'risk_score_above_mandate_max')).toBe(true);
  });

  test('P3 — rejects intent without simulationId', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent({ simulationId: undefined }), { userId: 'u1' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'simulation_missing')).toBe(true);
  });

  test('manualApprovalRequired flag set above approvals.requireManualApprovalAboveUSD', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent({ valueUSD: 7_500 }), { userId: 'u1' });
    expect(r.passed).toBe(true); // not blocked, just flagged
    expect(r.manualApprovalRequired).toBe(true);
    expect(r.warnings.some((w) => w.startsWith('manual_approval_required_above_'))).toBe(true);
  });

  test('default mandate is applied when user has no explicit mandate', () => {
    const { guard, mandates } = makeGuard();
    const r = guard.evaluate(freshIntent(), { userId: 'fresh-user' });
    const m = mandates.getActive('fresh-user');
    expect(m.id).toBe(buildDefaultMandate('fresh-user').id);
    expect(r.mandateId).toBe(m.id);
  });

  test('expired mandate blocks all intents', () => {
    const mandates = new MandateService();
    mandates.set('u1', { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const allowlist = new AllowlistService();
    allowlist.load();
    const guard = new PolicyGuard(mandates, allowlist);
    const r = guard.evaluate(freshIntent(), { userId: 'u1' });
    expect(r.passed).toBe(false);
    expect(r.blockReason).toBe('mandate_expired');
  });

  test('P9b — cooldown blocks rule re-fire within window, allows after window', () => {
    const mandates = new MandateService();
    const allowlist = new AllowlistService();
    allowlist.load();
    const cooldowns = new CooldownService();
    const guard = new PolicyGuard(mandates, allowlist, cooldowns);

    const intent = freshIntent();
    cooldowns.markBroadcast('rule-1', new Date(Date.now() - 60_000));

    const blocked = guard.evaluate(intent, {
      userId: 'u1',
      ruleId: 'rule-1',
      ruleCooldownMinutes: 5,
    });
    expect(blocked.passed).toBe(false);
    expect(blocked.errors.some((e) => e.code === 'cooldown_active')).toBe(true);

    const ok = guard.evaluate(intent, {
      userId: 'u1',
      ruleId: 'rule-1',
      ruleCooldownMinutes: 0, // disabled cooldown
    });
    expect(ok.passed).toBe(true);

    cooldowns.reset('rule-1');
    const fresh = guard.evaluate(intent, {
      userId: 'u1',
      ruleId: 'rule-1',
      ruleCooldownMinutes: 5,
    });
    expect(fresh.passed).toBe(true);
  });

  test('cooldown only applies when ruleId is provided', () => {
    const cooldowns = new CooldownService();
    cooldowns.markBroadcast('rule-1', new Date());
    const allowlist = new AllowlistService();
    allowlist.load();
    const guard = new PolicyGuard(new MandateService(), allowlist, cooldowns);
    const r = guard.evaluate(freshIntent(), { userId: 'u1' }); // no ruleId
    expect(r.passed).toBe(true);
  });

  test('P11 — rejects unbounded approve without opt-in', () => {
    const { guard } = makeGuard();
    const MAX = 'f'.repeat(64);
    const r = guard.evaluate(
      {
        action: { type: 'supply', targetProtocol: 'kinetic', targetChain: 14 },
        txData: {
          to: KINETIC_KUSDCE,
          data: '0x095ea7b3' + '0'.repeat(24) + '1'.repeat(40) + MAX,
          chainId: 14,
        },
        valueUSD: 100,
        slippageBps: 30,
        simulationId: 'sim-1',
        simulatedAt: new Date().toISOString(),
        pricesFreshAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        riskAfter: { healthFactor: 2.0, score: 30 },
      },
      { userId: 'u1' },
    );
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'approve_unbounded')).toBe(true);
  });

  test('P11 — accepts unbounded approve when optInUnboundedApproval=true', () => {
    const { guard } = makeGuard();
    const MAX = 'f'.repeat(64);
    const r = guard.evaluate(
      {
        action: { type: 'supply', targetProtocol: 'kinetic', targetChain: 14 },
        txData: {
          to: KINETIC_KUSDCE,
          data: '0x095ea7b3' + '0'.repeat(24) + '1'.repeat(40) + MAX,
          chainId: 14,
        },
        valueUSD: 100,
        slippageBps: 30,
        simulationId: 'sim-1',
        simulatedAt: new Date().toISOString(),
        pricesFreshAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        riskAfter: { healthFactor: 2.0, score: 30 },
      },
      { userId: 'u1', optInUnboundedApproval: true },
    );
    // The selector 0x095ea7b3 won't match 'supply' in selectorMap, so this
    // still fails on P7 — but NOT on approve_unbounded.
    expect(r.errors.some((e) => e.code === 'approve_unbounded')).toBe(false);
  });

  test('P15 — rejects intents from down providers', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent(), { userId: 'u1', providerHealth: 'down' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'provider_unhealthy')).toBe(true);
  });

  test('P15 — degraded provider warns but does not block', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent(), { userId: 'u1', providerHealth: 'degraded' });
    expect(r.passed).toBe(true);
    expect(r.warnings).toContain('provider_health_degraded');
  });

  test('P16 — rejects price source whose trustLevel is not oracle/onchain verified', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent(), { userId: 'u1', priceTrustLevel: 'community' });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'price_trust_insufficient')).toBe(true);
  });

  test('P16 — accepts oracle_verified and onchain_verified trust levels', () => {
    const { guard } = makeGuard();
    const a = guard.evaluate(freshIntent(), { userId: 'u1', priceTrustLevel: 'oracle_verified' });
    const b = guard.evaluate(freshIntent(), { userId: 'u1', priceTrustLevel: 'onchain_verified' });
    expect(a.passed).toBe(true);
    expect(b.passed).toBe(true);
  });

  test('P17 — rejects when wallet is not registered to user', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent(), { userId: 'u1', walletRegisteredToUser: false });
    expect(r.passed).toBe(false);
    expect(r.errors.some((e) => e.code === 'wallet_not_registered')).toBe(true);
  });

  test('P18 — rejects missing or invalid SIWE session', () => {
    const { guard } = makeGuard();
    const a = guard.evaluate(freshIntent(), { userId: 'u1', sessionValid: false });
    const b = guard.evaluate(freshIntent(), { userId: 'u1', sessionId: '', sessionValid: true });
    expect(a.passed).toBe(false);
    expect(b.passed).toBe(false);
    expect(a.errors.some((e) => e.code === 'session_invalid')).toBe(true);
  });

  test('P18 — accepts when sessionId present and sessionValid !== false', () => {
    const { guard } = makeGuard();
    const r = guard.evaluate(freshIntent(), {
      userId: 'u1',
      sessionId: 'sess-123',
      sessionValid: true,
    });
    expect(r.passed).toBe(true);
  });

  test('explicit mandate widens forbiddenActions to allow borrow', () => {
    const mandates = new MandateService();
    mandates.set('whale', {
      scope: {
        allowedProtocols: ['kinetic'],
        allowedChains: [14],
        allowedAssets: ['USDC.e', 'FLR'],
        allowedActions: ['supply', 'withdraw', 'borrow', 'repay'],
        forbiddenActions: [],
      },
      limits: {
        maxTxValueUSD: 1_000_000,
        maxDailyValueUSD: 5_000_000,
        maxMonthlyValueUSD: 20_000_000,
        maxSlippageBps: 200,
        minHealthFactorAfter: 1.2,
      },
    });
    const allowlist = new AllowlistService();
    allowlist.load();
    const guard = new PolicyGuard(mandates, allowlist);
    const r = guard.evaluate(
      {
        action: { type: 'borrow', targetProtocol: 'kinetic', targetChain: 14 },
        txData: { to: KINETIC_KUSDCE, data: '0xc5ebeaec' + '0'.repeat(64), chainId: 14 },
        valueUSD: 5_000,
        slippageBps: 50,
        simulationId: 'sim-2',
        simulatedAt: new Date().toISOString(),
        pricesFreshAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        riskAfter: { healthFactor: 1.6, score: 40 },
      },
      { userId: 'whale' },
    );
    expect(r.passed).toBe(true);
  });
});

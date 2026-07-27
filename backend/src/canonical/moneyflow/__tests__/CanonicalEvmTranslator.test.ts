import { translateCmfToEvmRules, toBaseUnits } from '../CanonicalEvmTranslator';
import { CMF_VERSION, type CanonicalMoneyFlow, type CmfStep } from '../CanonicalMoneyFlow';

/** Minimal valid CMF factory — override what each test needs. */
function cmf(overrides: Partial<CanonicalMoneyFlow> = {}): CanonicalMoneyFlow {
  return {
    version: CMF_VERSION,
    id: 'cmf-test-0001',
    name: 'Protege mi carry',
    description: 'Si el HF baja de 1.5, prepara un repay de 25 USDT0 que tú firmas.',
    direction: 'protect',
    origin: { source: 'ai_copilot' },
    steps: [protectStep()],
    policy: { cooldownMinutes: 60, disclosedToUser: true },
    ...overrides,
  };
}

function protectStep(overrides: Partial<CmfStep> = {}): CmfStep {
  return {
    level: 1,
    trigger: { kind: 'health-factor', comparator: 'below', threshold: 1.5 },
    actions: [
      {
        verb: 'repay',
        asset: { symbol: 'USDT0' },
        amount: { type: 'absolute', value: '25' },
        venue: { protocolId: 'kinetic', positionId: 'kinetic:FXRP:BORROW' },
      },
    ],
    ...overrides,
  };
}

describe('toBaseUnits — string math, no floats near money', () => {
  test.each([
    ['25', 6, '25000000'],
    ['25.5', 6, '25500000'],
    ['0.000001', 6, '1'],
    ['1', 18, '1000000000000000000'],
    ['0', 6, '0'],
  ])('%s ×10^%i → %s', (v, d, expected) => {
    expect(toBaseUnits(v, d)).toBe(expected);
  });

  test('rejects more decimal places than the asset has', () => {
    expect(() => toBaseUnits('1.0000001', 6)).toThrow(/decimal places/);
  });
});

describe('CanonicalEvmTranslator — the PROTECT-equivalent flow (happy path)', () => {
  test('1 step → 1 AutomationRule payload with the exact template vocabulary', () => {
    const r = translateCmfToEvmRules(cmf());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chain).toBe('eip155:14');
    expect(r.mode).toBe('sign-at-trigger');
    expect(r.rules).toHaveLength(1);
    const rule = r.rules[0];
    expect(rule.chainId).toBe(14);
    expect(rule.name).toBe('Protege mi carry · L1');
    expect(rule.trigger).toEqual({ type: 'HF_BELOW', threshold: 1.5 });
    expect(rule.action.kind).toBe('repay');
    expect(rule.action.protocolId).toBe('kinetic');
    expect(rule.action.positionId).toBe('kinetic:FXRP:BORROW');
    // 25 USDT0 → base units exactly like the PROTECT template (6 decimals)
    expect(rule.action.params).toEqual({ amount: '25000000' });
    expect(rule.cooldownMinutes).toBe(60);
    expect(rule.maxValueUSD).toBe(10_000); // rules.ts default when policy omits it
    expect(rule.canonicalRef).toBe('cmf-test-0001');
  });

  test('escalones: N steps → N rules linked by the same canonicalRef, sorted by level', () => {
    const r = translateCmfToEvmRules(
      cmf({
        steps: [
          protectStep({
            level: 2,
            trigger: { kind: 'health-factor', comparator: 'below', threshold: 1.3 },
            actions: [{ verb: 'repay', asset: { symbol: 'USDT0' }, amount: { type: 'absolute', value: '60' }, venue: { protocolId: 'kinetic' } }],
          }),
          protectStep({ level: 1 }),
        ],
        policy: { cooldownMinutes: 30, maxAmountPerTriggerUsd: 500, disclosedToUser: true },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules.map((x) => x.name)).toEqual(['Protege mi carry · L1', 'Protege mi carry · L2']);
    expect(new Set(r.rules.map((x) => x.canonicalRef)).size).toBe(1);
    expect(r.rules.every((x) => x.maxValueUSD === 500)).toBe(true);
    expect((r.rules[1].trigger as { threshold: number }).threshold).toBe(1.3);
  });

  test('HARVEST-equivalent: claim-rewards is amount-less; venue params pass through', () => {
    const r = translateCmfToEvmRules(
      cmf({
        steps: [
          {
            level: 1,
            trigger: { kind: 'reward', minUsd: 5 },
            actions: [{ verb: 'claim-rewards', asset: { symbol: 'FLR' }, venue: { protocolId: 'ftso', params: { wrap: true } } }],
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].trigger).toEqual({ type: 'REWARD_THRESHOLD', minUSD: 5 });
    expect(r.rules[0].action.kind).toBe('claimRewards');
    expect(r.rules[0].action.params).toEqual({ wrap: true });
  });

  test('ltv + idle-balance triggers map 1:1; provide/remove-liquidity map to addLiquidity/exitLP', () => {
    const r = translateCmfToEvmRules(
      cmf({
        steps: [
          {
            level: 1,
            trigger: { kind: 'ltv', comparator: 'above', threshold: 0.6 },
            actions: [{ verb: 'remove-liquidity', asset: { symbol: 'FXRP' }, amount: { type: 'absolute', value: '10' }, venue: { protocolId: 'sparkdex' } }],
          },
          {
            level: 2,
            trigger: { kind: 'idle-balance', asset: { symbol: 'usdc' }, minUsd: 100 },
            actions: [{ verb: 'supply', asset: { symbol: 'USDC' }, amount: { type: 'absolute', value: '100' }, venue: { protocolId: 'kinetic' } }],
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].trigger).toEqual({ type: 'LTV_ABOVE', threshold: 0.6 });
    expect(r.rules[0].action.kind).toBe('exitLP');
    expect(r.rules[1].trigger).toEqual({ type: 'IDLE_BALANCE', asset: 'USDC', minUSD: 100 });
    expect(r.rules[1].action.kind).toBe('supply');
  });

  test('expiry is ENFORCED: a far-future policy.expiry is clamped to now+90d on every rule', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    const cap = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const r = translateCmfToEvmRules(
      cmf({ policy: { cooldownMinutes: 60, disclosedToUser: true, expiry: '2099-01-01T00:00:00Z' } }),
      { now },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].expiresAt).toBe(cap);
    expect(r.notes.join(' ')).toMatch(/Enforced expiry/);
  });

  test('expiry absent → the rule still expires (default now+90d — no eternal MoneyFlows)', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    const cap = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const r = translateCmfToEvmRules(cmf(), { now });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].expiresAt).toBe(cap);
  });

  test('a policy.expiry inside the 90-day window passes through untouched', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    const r = translateCmfToEvmRules(
      cmf({ policy: { cooldownMinutes: 60, disclosedToUser: true, expiry: '2026-08-01T00:00:00Z' } }),
      { now },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].expiresAt).toBe(new Date('2026-08-01T00:00:00Z').toISOString());
  });
});

describe('CanonicalEvmTranslator — explicit degradation (never approximates silently)', () => {
  const failCodes = (flow: CanonicalMoneyFlow): string[] => {
    const r = translateCmfToEvmRules(flow);
    expect(r.ok).toBe(false);
    return r.ok ? [] : r.errors.map((e) => e.code);
  };

  test('price trigger is still a stub → trigger_not_supported', () => {
    expect(
      failCodes(cmf({ steps: [protectStep({ trigger: { kind: 'price', asset: { symbol: 'XRP' }, comparator: 'below', threshold: 2 } })] })),
    ).toContain('trigger_not_supported');
  });

  test('time trigger translates to TIME_TRIGGER (evaluator implemented, Fase 3)', () => {
    const r = translateCmfToEvmRules(
      cmf({ steps: [protectStep({ trigger: { kind: 'time', cron: '0 9 * * 1' } })] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].trigger).toEqual({ type: 'TIME_TRIGGER', cron: '0 9 * * 1' });
  });

  test('health-factor "above" (re-leverage) → hf_above_not_supported', () => {
    expect(
      failCodes(cmf({ steps: [protectStep({ trigger: { kind: 'health-factor', comparator: 'above', threshold: 2.6 } })] })),
    ).toContain('hf_above_not_supported');
  });

  test('transfer/bridge verbs → verb_not_supported (cross-ecosystem = C.2, post-F1)', () => {
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'bridge', asset: { symbol: 'XRP' }, amount: { type: 'absolute', value: '10' } }] })] })),
    ).toContain('verb_not_supported');
  });

  test('percent-of-position / to-target amounts → amount_type_not_supported', () => {
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'repay', asset: { symbol: 'USDT0' }, amount: { type: 'percent-of-position', pct: 20 }, venue: { protocolId: 'kinetic' } }] })] })),
    ).toContain('amount_type_not_supported');
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'repay', asset: { symbol: 'USDT0' }, amount: { type: 'to-target', target: 'hf', value: 1.8 }, venue: { protocolId: 'kinetic' } }] })] })),
    ).toContain('amount_type_not_supported');
  });

  test('multi-action step → multi_action_step (one rule per CanonicalStep, §3.1)', () => {
    const step = protectStep();
    step.actions = [step.actions[0], step.actions[0]];
    expect(failCodes(cmf({ steps: [step] }))).toContain('multi_action_step');
  });

  test('unknown asset decimals → unknown_asset_decimals (never guess decimals for money)', () => {
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'supply', asset: { symbol: 'WETH' }, amount: { type: 'absolute', value: '1' } }] })] })),
    ).toContain('unknown_asset_decimals');
  });

  test('zero amount and >decimals precision are rejected', () => {
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'repay', asset: { symbol: 'USDT0' }, amount: { type: 'absolute', value: '0' }, venue: { protocolId: 'kinetic' } }] })] })),
    ).toContain('zero_amount');
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'repay', asset: { symbol: 'USDT0' }, amount: { type: 'absolute', value: '1.0000001' }, venue: { protocolId: 'kinetic' } }] })] })),
    ).toContain('invalid_amount');
  });

  test('amount missing on an amount-bearing verb → amount_required', () => {
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'repay', asset: { symbol: 'USDT0' }, venue: { protocolId: 'kinetic' } }] })] })),
    ).toContain('amount_required');
  });

  test('invariant #4 flows through: acquiring a non-EMT stable fails, repaying it passes', () => {
    // supply USDT0 = acquiring a non-EMT stable → blocked by the validator
    expect(
      failCodes(cmf({ steps: [protectStep({ actions: [{ verb: 'supply', asset: { symbol: 'USDT0' }, amount: { type: 'absolute', value: '10' } }] })] })),
    ).toContain('non_emt_stable');
    // repay USDT0 = de-risking existing debt → fine (the live PROTECT case)
    expect(translateCmfToEvmRules(cmf()).ok).toBe(true);
  });

  test('all errors are collected (not just the first)', () => {
    const r = translateCmfToEvmRules(
      cmf({
        steps: [
          protectStep({ level: 1, trigger: { kind: 'price', asset: { symbol: 'XRP' }, comparator: 'below', threshold: 2 } }),
          protectStep({ level: 1 }), // duplicate level
        ],
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.errors.map((e) => e.code);
    expect(codes).toContain('trigger_not_supported');
    expect(codes).toContain('duplicate_step_levels');
  });
});

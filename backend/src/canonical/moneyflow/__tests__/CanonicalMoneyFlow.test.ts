import {
  CMF_VERSION,
  canonicalMoneyFlowSchema,
  cmfDraftSchema,
  validateCmfInvariants,
  type CanonicalMoneyFlow,
} from '../CanonicalMoneyFlow';

const VALID_DRAFT = {
  name: 'Protege mi carry',
  description: 'Si el HF baja de 1.5, prepara un repay de 25 USDT0 que tú firmas.',
  direction: 'protect' as const,
  steps: [
    {
      level: 1,
      trigger: { kind: 'health-factor' as const, comparator: 'below' as const, threshold: 1.5 },
      actions: [
        {
          verb: 'repay' as const,
          asset: { symbol: 'USDT0' },
          amount: { type: 'absolute' as const, value: '25' },
          venue: { protocolId: 'kinetic' },
        },
      ],
    },
  ],
  policy: { cooldownMinutes: 60, disclosedToUser: true as const },
};

const VALID_CMF: CanonicalMoneyFlow = {
  ...VALID_DRAFT,
  version: CMF_VERSION,
  id: 'cmf-test-0001',
  origin: { source: 'ai_copilot' },
};

describe('CMF v0.1 — zod schemas (shape gate for anything the LLM emits)', () => {
  test('a valid draft parses; a valid full CMF parses', () => {
    expect(cmfDraftSchema.safeParse(VALID_DRAFT).success).toBe(true);
    expect(canonicalMoneyFlowSchema.safeParse(VALID_CMF).success).toBe(true);
  });

  test('disclosedToUser must be the literal true (invariant #6)', () => {
    const bad = { ...VALID_DRAFT, policy: { ...VALID_DRAFT.policy, disclosedToUser: false } };
    expect(cmfDraftSchema.safeParse(bad).success).toBe(false);
  });

  test('cooldownMinutes has a hard floor of 5 (mandatory anti-thrash guard)', () => {
    const bad = { ...VALID_DRAFT, policy: { ...VALID_DRAFT.policy, cooldownMinutes: 0 } };
    expect(cmfDraftSchema.safeParse(bad).success).toBe(false);
  });

  test('unknown verbs, trigger kinds and versions are rejected', () => {
    expect(
      cmfDraftSchema.safeParse({
        ...VALID_DRAFT,
        steps: [{ ...VALID_DRAFT.steps[0], actions: [{ ...VALID_DRAFT.steps[0].actions[0], verb: 'liquidate' }] }],
      }).success,
    ).toBe(false);
    expect(
      cmfDraftSchema.safeParse({
        ...VALID_DRAFT,
        steps: [{ ...VALID_DRAFT.steps[0], trigger: { kind: 'moon-phase', full: true } }],
      }).success,
    ).toBe(false);
    expect(canonicalMoneyFlowSchema.safeParse({ ...VALID_CMF, version: 'cmf/0.2' }).success).toBe(false);
  });

  test('origin.source only accepts user | ai_copilot (audit vocabulary)', () => {
    expect(canonicalMoneyFlowSchema.safeParse({ ...VALID_CMF, origin: { source: 'model' } }).success).toBe(false);
  });

  test('steps are bounded (1..6) and actions per step (1..4)', () => {
    expect(cmfDraftSchema.safeParse({ ...VALID_DRAFT, steps: [] }).success).toBe(false);
    const step = VALID_DRAFT.steps[0];
    expect(
      cmfDraftSchema.safeParse({ ...VALID_DRAFT, steps: [{ ...step, actions: [] }] }).success,
    ).toBe(false);
  });
});

describe('CMF invariants — what shape-validation cannot catch', () => {
  test('clean flow → no violations', () => {
    expect(validateCmfInvariants(VALID_CMF)).toEqual([]);
  });

  test('invariant #4: acquiring a non-EMT stable is a violation; EMTs are fine', () => {
    const acquireUsdt = {
      ...VALID_CMF,
      steps: [
        {
          ...VALID_CMF.steps[0],
          actions: [{ verb: 'supply' as const, asset: { symbol: 'USDT0' }, amount: { type: 'absolute' as const, value: '10' } }],
        },
      ],
    };
    expect(validateCmfInvariants(acquireUsdt).map((v) => v.code)).toContain('non_emt_stable');

    const acquireUsdc = {
      ...VALID_CMF,
      steps: [
        {
          ...VALID_CMF.steps[0],
          actions: [{ verb: 'supply' as const, asset: { symbol: 'USDC' }, amount: { type: 'absolute' as const, value: '10' } }],
        },
      ],
    };
    expect(validateCmfInvariants(acquireUsdc)).toEqual([]);
  });

  test('repay/withdraw of a non-EMT stable is de-risking → allowed (the live PROTECT case)', () => {
    expect(validateCmfInvariants(VALID_CMF)).toEqual([]);
  });

  test('an AI-drafted flow carrying a token address is a violation (translator resolves addresses)', () => {
    const withAddress = {
      ...VALID_CMF,
      steps: [
        {
          ...VALID_CMF.steps[0],
          actions: [
            {
              verb: 'repay' as const,
              asset: { symbol: 'USDT0', address: '0xe7cd86e13AC4309349F30B3435a9d337750fC82D' },
              amount: { type: 'absolute' as const, value: '25' },
            },
          ],
        },
      ],
    };
    expect(validateCmfInvariants(withAddress).map((v) => v.code)).toContain('ai_wrote_address');
    // …but a USER-authored flow may pin an address
    const userFlow = { ...withAddress, origin: { source: 'user' as const } };
    expect(validateCmfInvariants(userFlow).map((v) => v.code)).not.toContain('ai_wrote_address');
  });

  test('duplicate step levels and past expiry are violations', () => {
    const dup = { ...VALID_CMF, steps: [VALID_CMF.steps[0], { ...VALID_CMF.steps[0] }] };
    expect(validateCmfInvariants(dup).map((v) => v.code)).toContain('duplicate_step_levels');

    const expired = {
      ...VALID_CMF,
      policy: { ...VALID_CMF.policy, expiry: '2020-01-01T00:00:00Z' },
    };
    expect(validateCmfInvariants(expired).map((v) => v.code)).toContain('expired_flow');
  });
});

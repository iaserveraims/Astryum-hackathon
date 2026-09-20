/**
 * M4 — the XRPL twin of the EVM translator. What matters: each verb lands on
 * the EXACT rule vocabulary its live rail serves (scheduledPayment /
 * councilPayment / escrow), price floors convert honestly (translation-time
 * baseline, never guessed), and every degradation is a readable error — the
 * canonical language never approximates silently.
 */
import { translateCmfToXrplRules, XRPL_PSEUDO_CHAIN_ID } from '../CanonicalXrplTranslator';
import { CMF_VERSION, type CanonicalMoneyFlow, type CmfStep } from '../CanonicalMoneyFlow';

const DESTINATION = 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH';

function cmf(overrides: Partial<CanonicalMoneyFlow> = {}): CanonicalMoneyFlow {
  return {
    version: CMF_VERSION,
    id: 'cmf-xrpl-0001',
    name: 'Seguro del coche',
    description: 'El día 15 de cada mes, prepara el pago de 10 XRP que tú firmas.',
    direction: 'protect',
    origin: { source: 'ai_copilot' },
    steps: [transferStep()],
    policy: { cooldownMinutes: 60, disclosedToUser: true },
    ...overrides,
  };
}

function transferStep(overrides: Partial<CmfStep> = {}): CmfStep {
  return {
    level: 1,
    trigger: { kind: 'time', cron: '0 12 15 * *' },
    actions: [
      {
        verb: 'transfer',
        asset: { symbol: 'XRP' },
        amount: { type: 'absolute', value: '10' },
        venue: { params: { destination: DESTINATION } },
      },
    ],
    ...overrides,
  };
}

describe('CanonicalXrplTranslator — the recurring payment (happy path)', () => {
  test('transfer + time → ONE scheduledPayment rule in the exact M1 vocabulary', () => {
    const r = translateCmfToXrplRules(cmf());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.chain).toBe('xrpl:0');
    expect(r.mode).toBe('sign-at-trigger');
    expect(r.rules).toHaveLength(1);
    const rule = r.rules[0];
    expect(rule.chainId).toBe(XRPL_PSEUDO_CHAIN_ID);
    expect(rule.trigger).toEqual({ type: 'TIME_TRIGGER', cron: '0 12 15 * *' });
    expect(rule.action.kind).toBe('scheduledPayment');
    expect(rule.action.params).toEqual({ destination: DESTINATION, amountDrops: '10000000' });
    expect(rule.canonicalRef).toBe('cmf-xrpl-0001');
    expect(new Date(rule.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('memo and destinationTag ride into the personal params', () => {
    const r = translateCmfToXrplRules(
      cmf({
        steps: [
          transferStep({
            actions: [
              {
                verb: 'transfer',
                asset: { symbol: 'XRP' },
                amount: { type: 'absolute', value: '1.5' },
                venue: { params: { destination: DESTINATION, memo: 'seguro', destinationTag: 7 } },
              },
            ],
          }),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].action.params).toEqual({
      destination: DESTINATION,
      amountDrops: '1500000',
      memo: 'seguro',
      destinationTag: 7,
    });
  });

  test('governed: the SAME transfer compiles to councilPayment (no destinationTag rail)', () => {
    const r = translateCmfToXrplRules(cmf(), { governed: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].action.kind).toBe('councilPayment');
    expect(r.rules[0].action.params).toEqual({ destination: DESTINATION, amountDrops: '10000000' });
    expect(r.notes[0]).toContain('quorum');
  });

  test('supply + lockDays → the B.1 escrow rule', () => {
    const r = translateCmfToXrplRules(
      cmf({
        steps: [
          transferStep({
            trigger: { kind: 'idle-balance', asset: { symbol: 'XRP' }, minUsd: 50 },
            actions: [
              {
                verb: 'supply',
                asset: { symbol: 'XRP' },
                amount: { type: 'absolute', value: '25' },
                venue: { params: { lockDays: 30 } },
              },
            ],
          }),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].trigger).toEqual({ type: 'IDLE_BALANCE', asset: 'XRP', minUSD: 50 });
    expect(r.rules[0].action.kind).toBe('escrow');
    expect(r.rules[0].action.params).toEqual({ amountDrops: '25000000', lockDays: 30 });
  });
});

describe('price floors — translation-time baseline, never guessed', () => {
  const priceStep = (): CmfStep =>
    transferStep({
      trigger: { kind: 'price', asset: { symbol: 'XRP' }, comparator: 'below', threshold: 1.7 },
    });

  test('floor $1.70 with live $2.00 → PRICE_DROP_PCT 15% anchored to the baseline', () => {
    const r = translateCmfToXrplRules(cmf({ steps: [priceStep()] }), { prices: { XRP: 2.0 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules[0].trigger).toEqual({
      type: 'PRICE_DROP_PCT',
      asset: 'XRP',
      pct: 15,
      baselineUsd: 2.0,
    });
  });

  test('no live read → readable error, never a guessed baseline', () => {
    const r = translateCmfToXrplRules(cmf({ steps: [priceStep()] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe('price_baseline_unavailable');
  });

  test('a floor at or above the market is refused — it would fire immediately', () => {
    const r = translateCmfToXrplRules(cmf({ steps: [priceStep()] }), { prices: { XRP: 1.6 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe('price_floor_above_market');
  });
});

describe('explicit degradation — every refusal is readable', () => {
  test('a non-XRP asset, a missing destination and a governed escrow all say WHY', () => {
    const noDest = transferStep();
    noDest.actions = [{ ...noDest.actions[0], venue: { params: {} } }];
    const iou = transferStep({ level: 2 });
    iou.actions = [{ ...iou.actions[0], asset: { symbol: 'RLUSD' } }];
    const r = translateCmfToXrplRules(cmf({ steps: [noDest, iou] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code).sort()).toEqual(['asset_not_supported', 'destination_required']);

    const governedEscrow = translateCmfToXrplRules(
      cmf({
        steps: [
          transferStep({
            actions: [
              { verb: 'supply', asset: { symbol: 'XRP' }, amount: { type: 'absolute', value: '5' }, venue: { params: { lockDays: 10 } } },
            ],
          }),
        ],
      }),
      { governed: true },
    );
    expect(governedEscrow.ok).toBe(false);
    if (governedEscrow.ok) return;
    expect(governedEscrow.errors[0].code).toBe('governed_escrow_not_a_rule');
  });

  test('percent-of-position stays rejected (the pending §10.8 decision owns it)', () => {
    const s = transferStep();
    s.actions = [{ ...s.actions[0], amount: { type: 'percent-of-position', pct: 50 } }];
    const r = translateCmfToXrplRules(cmf({ steps: [s] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].code).toBe('amount_type_not_supported');
  });

  test('unsupported verbs and triggers name the capability, not a stack trace', () => {
    const swap = transferStep();
    swap.actions = [{ ...swap.actions[0], verb: 'swap' }];
    const hf = transferStep({ level: 2, trigger: { kind: 'health-factor', comparator: 'below', threshold: 1.5 } });
    const r = translateCmfToXrplRules(cmf({ steps: [swap, hf] }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.code).sort()).toEqual(['trigger_not_supported', 'verb_not_supported']);
  });
});

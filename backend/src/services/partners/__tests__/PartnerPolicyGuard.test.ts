import {
  PartnerPolicyGuard,
  PartnerPolicyError,
} from '../PartnerPolicyGuard';

const saved = {
  MOONPAY_ENABLED: process.env.MOONPAY_ENABLED,
  MOONPAY_API_KEY: process.env.MOONPAY_API_KEY,
};

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k as keyof typeof saved];
    else process.env[k] = v;
  }
});

const OK = {
  partnerId: 'moonpay-onramp',
  defibroExecutes: false,
  defibroCustody: false,
  defibroOrderTransmission: false,
};

describe('PartnerPolicyGuard (P19/P20/P21/P26/P27)', () => {
  const g = new PartnerPolicyGuard();

  test('P19 — defibroExecutes must be false', () => {
    process.env.MOONPAY_ENABLED = 'true';
    expect(() => g.assertSessionAllowed({ ...OK, defibroExecutes: true })).toThrow(
      /P19/,
    );
  });

  test('P20 — defibroCustody must be false', () => {
    process.env.MOONPAY_ENABLED = 'true';
    expect(() => g.assertSessionAllowed({ ...OK, defibroCustody: true })).toThrow(
      /P20/,
    );
  });

  test('P20b — defibroOrderTransmission must be false', () => {
    process.env.MOONPAY_ENABLED = 'true';
    expect(() =>
      g.assertSessionAllowed({ ...OK, defibroOrderTransmission: true }),
    ).toThrow(/P20b/);
  });

  test('P21 — partner must be enabled', () => {
    delete process.env.MOONPAY_ENABLED;
    delete process.env.MOONPAY_API_KEY;
    try {
      g.assertSessionAllowed(OK);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(PartnerPolicyError);
      expect((e as PartnerPolicyError).code).toBe('p21_partner_disabled');
    }
  });

  test('passes when all invariants hold and partner enabled', () => {
    process.env.MOONPAY_ENABLED = 'true';
    expect(() => g.assertSessionAllowed(OK)).not.toThrow();
  });

  test('P26 — unverified webhook is rejected', () => {
    expect(() => g.assertWebhookVerified({ valid: false, reason: 'x' })).toThrow(/P26/);
    expect(() => g.assertWebhookVerified({ valid: true })).not.toThrow();
  });

  test('P27 — replayed (terminal) webhook is rejected', () => {
    expect(() => g.assertNotReplayed(true)).toThrow(/P27/);
    expect(() => g.assertNotReplayed(false)).not.toThrow();
  });
});

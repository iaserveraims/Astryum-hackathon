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
  astryumExecutes: false,
  astryumCustody: false,
  astryumOrderTransmission: false,
};

describe('PartnerPolicyGuard (P19/P20/P21/P26/P27)', () => {
  const g = new PartnerPolicyGuard();

  test('P19 — astryumExecutes must be false', () => {
    process.env.MOONPAY_ENABLED = 'true';
    expect(() => g.assertSessionAllowed({ ...OK, astryumExecutes: true })).toThrow(
      /P19/,
    );
  });

  test('P20 — astryumCustody must be false', () => {
    process.env.MOONPAY_ENABLED = 'true';
    expect(() => g.assertSessionAllowed({ ...OK, astryumCustody: true })).toThrow(
      /P20/,
    );
  });

  test('P20b — astryumOrderTransmission must be false', () => {
    process.env.MOONPAY_ENABLED = 'true';
    expect(() =>
      g.assertSessionAllowed({ ...OK, astryumOrderTransmission: true }),
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

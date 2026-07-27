jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({
      getHttpProvider: () => ({}),
    }),
  },
}));

// Reset cached protocolAddresses module between tests so env changes take effect
function freshAdapter(env: Record<string, string | undefined> = {}) {
  jest.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // re-require with current env
  const { KineticAdapter } = require('../KineticAdapter');
  return new KineticAdapter();
}

describe('KineticAdapter', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('isActive=false when KINETIC_COMPTROLLER is not set', () => {
    const a = freshAdapter({ KINETIC_COMPTROLLER: undefined });
    expect(a.isActive).toBe(false);
  });

  test('discoverPositions returns [] when inactive', async () => {
    const a = freshAdapter({ KINETIC_COMPTROLLER: undefined });
    const positions = await a.discoverPositions(
      '0x0000000000000000000000000000000000000001'
    );
    expect(positions).toEqual([]);
  });

  test('simulateAction throws ProtocolInactiveError when inactive', async () => {
    const a = freshAdapter({ KINETIC_COMPTROLLER: undefined });
    await expect(
      a.simulateAction({
        kind: 'repay',
        protocolId: 'kinetic',
        chainId: 14,
        wallet: '0x0000000000000000000000000000000000000001',
        inputs: { amount: 0n },
      })
    ).rejects.toMatchObject({ code: 'protocol_inactive' });
  });

  test('simulateAction (active) computes new HF on repay', async () => {
    const a = freshAdapter({
      KINETIC_COMPTROLLER: '0x000000000000000000000000000000000000beef',
    });
    const result = await a.simulateAction({
      kind: 'repay',
      protocolId: 'kinetic',
      chainId: 14,
      wallet: '0x0000000000000000000000000000000000000001',
      inputs: {
        amount: 100n * 10n ** 18n,
        decimals: 18,
        priceUSD: 1,
        collateralUSD: 1000,
        debtUSD: 500,
        collateralFactor: 0.7,
        flrPriceUSD: 0.02,
      },
    });
    expect(result.success).toBe(true);
    // HF before: (1000*0.7)/500 = 1.4 ; HF after repay 100: (1000*0.7)/400 = 1.75
    expect(result.newHF).toBeCloseTo(1.75, 2);
    expect(result.newLTV).toBeCloseTo(0.4, 2);
    expect(result.netUSDImpact).toBe(-100);
    expect(result.gasEstimate).toBe(250000n);
  });

  test('simulateAction (active) detects critical HF after withdraw', async () => {
    const a = freshAdapter({
      KINETIC_COMPTROLLER: '0x000000000000000000000000000000000000beef',
    });
    const result = await a.simulateAction({
      kind: 'withdraw',
      protocolId: 'kinetic',
      chainId: 14,
      wallet: '0x0000000000000000000000000000000000000001',
      inputs: {
        amount: 800n * 10n ** 18n,
        decimals: 18,
        priceUSD: 1,
        collateralUSD: 1000,
        debtUSD: 500,
        collateralFactor: 0.7,
        flrPriceUSD: 0.02,
      },
    });
    // HF after: (200*0.7)/500 = 0.28 → critical warning
    expect(result.newHF).toBeLessThan(1.2);
    expect(
      result.warnings.some((w: string) => /critical/i.test(w))
    ).toBe(true);
  });
});

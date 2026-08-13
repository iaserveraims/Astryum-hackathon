/**
 * GATE test — the Enso long-tail fallback (universal connector, §1.1).
 *
 * Scenario: ContractRegistry resolves a pool whose contractKind has NO native
 * ACTION_SHAPE encoding (e.g. a Curve stableswap). Before this wiring the pool
 * was display-only (throw ACTION_SHAPE_NOT_FOUND). Now prepare() must fall back
 * to Enso, build calldata to the Enso router, and keep the regulatory invariants
 * (astryumRelays:false, policy gate, fee disclosure).
 *
 * Both the registry and Enso are mocked so the test needs no DB or network.
 */

const ENSO_ROUTER = '0x0000000000000000000000000000000000456789';
const CRV_LP = '0x00000000000000000000000000000000000000cc';
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Pool resolves but kind 'curve_stableswap' is NOT in ACTION_SHAPE_BY_KIND.
jest.mock('../../services/ContractRegistry', () => ({
  contractRegistry: {
    getExecutablePoolForAction: jest.fn(async () => ({
      poolId: 'uuid-curve-dai',
      chain: 'eip155:1',
      chainId: 1,
      protocol: 'curve-dex',
      protocolName: 'Curve',
      symbol: '3pool',
      underlyingTokens: [DAI],
      interactionContractAddress: CRV_LP,
      receiptTokenAddress: CRV_LP,
      contractKind: 'curve_stableswap', // unknown to ACTION_SHAPE_BY_KIND
      morphoMarketParams: null,
      abi: [],
      abiSource: 'defillama',
      cooldownSeconds: null,
      isActive: true,
    })),
  },
}));

const canHandleMock = jest.fn(async () => true);
const getBundleCalldataMock = jest.fn(async () => ({
  tx: { to: ENSO_ROUTER, data: '0xdeadbeef', value: '0', gas: '500000' },
  fee: { bps: 15, recipientWallet: '0xfee' },
  bundleSize: 1,
  source: { providerId: 'enso', fetchedAt: new Date().toISOString() },
}));
const resolveIntentMock = jest.fn(
  (
    pool: { protocol: string; chainId: number; tokenIn: string; tokenOut: string; action: string },
    userWallet: string,
    amount: string,
  ) => ({
    chainId: pool.chainId,
    fromAddress: userWallet,
    actions: [
      {
        protocol: pool.protocol,
        action: pool.action,
        tokenIn: [pool.tokenIn],
        tokenOut: [pool.tokenOut],
        amountIn: [amount],
      },
    ],
  }),
);
const resolveLendingActionMock = jest.fn(
  (
    action: 'borrow' | 'repay',
    p: { protocol: string; chainId: number; asset: string; amount: string; primaryAddress: string; collateral?: string },
    userWallet: string,
  ) => ({
    chainId: p.chainId,
    fromAddress: userWallet,
    actions: [{ protocol: p.protocol, action, args: {} }],
  }),
);
jest.mock('../../integrations/providers/defi/EnsoProvider', () => ({
  ensoProvider: {
    canHandle: (...a: unknown[]) => canHandleMock(...(a as [])),
    getBundleCalldata: (...a: unknown[]) => getBundleCalldataMock(...(a as [])),
    resolveIntent: (
      pool: { protocol: string; chainId: number; tokenIn: string; tokenOut: string; action: string },
      userWallet: string,
      amount: string,
    ) => resolveIntentMock(pool, userWallet, amount),
    resolveLendingAction: (
      action: 'borrow' | 'repay',
      p: { protocol: string; chainId: number; asset: string; amount: string; primaryAddress: string; collateral?: string },
      userWallet: string,
    ) => resolveLendingActionMock(action, p, userWallet),
  },
}));

describe('GATE — Enso long-tail fallback (unknown contractKind)', () => {
  beforeAll(() => {
    process.env.ASTRYUM_FEE_WALLET =
      process.env.ASTRYUM_FEE_WALLET || '0x000000000000000000000000000000000000dEaD';
  });

  afterEach(() => {
    canHandleMock.mockClear();
    getBundleCalldataMock.mockClear();
    resolveIntentMock.mockClear();
    resolveLendingActionMock.mockClear();
  });

  test('unknown kind → routes to Enso, builds calldata, keeps invariants', async () => {
    const { calldataBuilder } = require('../CalldataBuilder');

    const intent = await calldataBuilder.prepare({
      protocolSlug: 'curve-dex',
      actionType: 'supply',
      amount: '1000000000000000000', // 1 DAI (18 decimals)
      asset: DAI,
      userWallet: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      partnerId: 'enso',
      partnerAllowsReferralFee: true,
      partnerRequiresKyc: false,
      userKycVerified: false,
    });

    expect(intent.tx.to).toBe(ENSO_ROUTER);
    expect(intent.tx.data).toBe('0xdeadbeef');
    expect(intent.tx.chainId).toBe(1);
    expect(intent.metadata.protocol).toBe('curve-dex');
    expect(intent.metadata.description).toContain('Enso');
    expect(intent.authorization.astryumRelays).toBe(false);
    expect(intent.policy.passed).toBe(true);
    // actionType 'supply' maps to Enso 'deposit'
    expect(canHandleMock).toHaveBeenCalledWith('curve-dex', 1, 'deposit');
  });

  test('unknown kind but Enso cannot handle → falls through (no Enso intent)', async () => {
    canHandleMock.mockResolvedValueOnce(false);
    const { calldataBuilder } = require('../CalldataBuilder');

    // canHandle=false → Enso declines → no Enso calldata is built and prepare()
    // does NOT silently succeed (it falls through to the legacy paths and errors).
    // We assert the decline behaviour, not the downstream error message (which
    // depends on DB env, unset in this unit test).
    await expect(
      calldataBuilder.prepare({
        protocolSlug: 'curve-dex',
        actionType: 'supply',
        amount: '1',
        asset: DAI,
        userWallet: '0x1111111111111111111111111111111111111111',
        chainId: 1,
        partnerId: 'enso',
        partnerAllowsReferralFee: true,
        partnerRequiresKyc: false,
        userKycVerified: false,
      }),
    ).rejects.toThrow();
    expect(canHandleMock).toHaveBeenCalledWith('curve-dex', 1, 'deposit');
    expect(getBundleCalldataMock).not.toHaveBeenCalled();
  });

  test('withdraw → Enso direction reversed (tokenIn=position, tokenOut=underlying)', async () => {
    const { calldataBuilder } = require('../CalldataBuilder');

    await calldataBuilder.prepare({
      protocolSlug: 'curve-dex',
      actionType: 'withdraw',
      amount: '1000000000000000000',
      asset: DAI,
      userWallet: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      partnerId: 'enso',
      partnerAllowsReferralFee: true,
      partnerRequiresKyc: false,
      userKycVerified: false,
    });

    // deposit: in=underlying,out=position · withdraw: in=position,out=underlying
    expect(canHandleMock).toHaveBeenCalledWith('curve-dex', 1, 'withdraw');
    expect(resolveIntentMock).toHaveBeenCalledWith(
      expect.objectContaining({ tokenIn: CRV_LP, tokenOut: DAI, action: 'withdraw' }),
      '0x1111111111111111111111111111111111111111',
      '1000000000000000000',
    );
  });

  test('borrow → Enso lending action with collateral + primaryAddress', async () => {
    const { calldataBuilder } = require('../CalldataBuilder');

    await calldataBuilder.prepare({
      protocolSlug: 'curve-dex',
      actionType: 'borrow',
      amount: '1000000',
      asset: DAI, // asset to borrow
      collateralAsset: WETH,
      userWallet: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      partnerId: 'enso',
      partnerAllowsReferralFee: true,
      partnerRequiresKyc: false,
      userKycVerified: false,
    });

    expect(canHandleMock).toHaveBeenCalledWith('curve-dex', 1, 'borrow');
    expect(resolveLendingActionMock).toHaveBeenCalledWith(
      'borrow',
      expect.objectContaining({ asset: DAI, collateral: WETH, primaryAddress: CRV_LP }),
      '0x1111111111111111111111111111111111111111',
    );
  });

  test('repay → Enso lending action (no collateral required)', async () => {
    const { calldataBuilder } = require('../CalldataBuilder');

    await calldataBuilder.prepare({
      protocolSlug: 'curve-dex',
      actionType: 'repay',
      amount: '1000000',
      asset: DAI,
      userWallet: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      partnerId: 'enso',
      partnerAllowsReferralFee: true,
      partnerRequiresKyc: false,
      userKycVerified: false,
    });

    expect(canHandleMock).toHaveBeenCalledWith('curve-dex', 1, 'repay');
    expect(resolveLendingActionMock).toHaveBeenCalledWith(
      'repay',
      expect.objectContaining({ asset: DAI, primaryAddress: CRV_LP }),
      '0x1111111111111111111111111111111111111111',
    );
  });

  test('borrow without collateral → declines (no Enso lending build)', async () => {
    const { calldataBuilder } = require('../CalldataBuilder');

    await expect(
      calldataBuilder.prepare({
        protocolSlug: 'curve-dex',
        actionType: 'borrow',
        amount: '1',
        asset: DAI,
        userWallet: '0x1111111111111111111111111111111111111111',
        chainId: 1,
        partnerId: 'enso',
        partnerAllowsReferralFee: true,
        partnerRequiresKyc: false,
        userKycVerified: false,
      }),
    ).rejects.toThrow();
    expect(resolveLendingActionMock).not.toHaveBeenCalled();
  });
});

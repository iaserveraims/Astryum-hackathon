/**
 * Cable 3 — HF must be read against the comptroller that GOVERNS the position.
 *
 * The E1 FXRP-supply / USDT0-borrow position lives in the Kinetic ISO comptroller,
 * NOT the primary one. Before the fix getMetrics hardcoded the primary comptroller,
 * so the stop-loss trigger read a health factor for a market the account isn't in.
 * These tests capture the address getMetrics constructs the Comptroller contract
 * with, proving it routes to `position.metadata.comptroller` and only falls back to
 * the primary when metadata omits it.
 */

// Capture every address a Contract is constructed with (factory may only close over
// identifiers prefixed with `mock`). Liquidity/shortfall/CF are settable per test.
const mockCtorAddresses: string[] = [];
const mockChain = {
  liquidity: 10n ** 18n, // $1 margin
  shortfall: 0n,
  collateralFactorMantissa: 700000000000000000n, // CF 0.7
  usdt0Underlying: '0x1111111111111111111111111111111111111111',
  // Live ISO account state for the restore-mode reads (base units, 6 dec)
  paSupplyUBA: 1_000_000_000n, // 1000 FXRP
  paDebtBase: 500_000_000n, // 500 USDT0
  xrpPriceUSD: 0.75,
};

jest.mock('../../../../engines/normalisation/NormalisationEngine', () => ({
  createFTSOPriceProvider: async () => ({
    getPriceUSD: async () => mockChain.xrpPriceUSD,
  }),
}));

jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: { getInstance: () => ({ getHttpProvider: () => ({}) }) },
}));

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    constructor(address: string) {
      mockCtorAddresses.push(address);
    }
    // [error, liquidity, shortfall]
    async getAccountLiquidity() {
      return [0n, mockChain.liquidity, mockChain.shortfall];
    }
    // markets(cToken) → [isListed, collateralFactorMantissa]
    async markets() {
      return [true, mockChain.collateralFactorMantissa];
    }
    // kUSDT0_ISO.underlying() — the ISO market's USDT0 token (invariant #3)
    async underlying() {
      return mockChain.usdt0Underlying;
    }
    // Live account state reads for restore-mode repays (ethers exposes these
    // nonpayable views via .staticCall — the adapter only uses that form)
    balanceOfUnderlying = { staticCall: async () => mockChain.paSupplyUBA };
    borrowBalanceCurrent = { staticCall: async () => mockChain.paDebtBase };
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

import { KineticAdapter } from '../KineticAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';
import type { NormalizedPosition } from '../../../../types/domain/Position';

const PRIMARY_COMPTROLLER = '0x000000000000000000000000000000000000BEEF';
const ISO_COMPTROLLER = '0x15F69897E6aEBE0463401345543C26d1Fd994abB';
const KUSDT0_ISO = '0xad7e7989796414c9572da9854DEb1B920724fd09';

function borrowPosition(metadata: Record<string, unknown>): NormalizedPosition {
  return {
    protocolId: 'kinetic',
    chainId: 14,
    wallet: '0x0000000000000000000000000000000000000001',
    kind: 'BORROW',
    asset: '0x0000000000000000000000000000000000000002',
    amount: 100n,
    amountUSD: 500,
    priceUSD: 1,
    metadata,
    takenAt: new Date(),
  } as NormalizedPosition;
}

function supplyPosition(metadata: Record<string, unknown>): NormalizedPosition {
  return {
    protocolId: 'kinetic',
    chainId: 14,
    wallet: '0x0000000000000000000000000000000000000001',
    kind: 'SUPPLY',
    asset: '0x0000000000000000000000000000000000000003',
    amount: 500_000_000n,
    amountUSD: 1000,
    priceUSD: 2,
    metadata,
    takenAt: new Date(),
  } as NormalizedPosition;
}

describe('KineticAdapter.getMetrics — comptroller routing (Cable 3)', () => {
  beforeEach(() => {
    mockCtorAddresses.length = 0;
    mockChain.liquidity = 10n ** 18n;
    mockChain.shortfall = 0n;
    mockChain.collateralFactorMantissa = 700000000000000000n;
    process.env.KINETIC_COMPTROLLER = PRIMARY_COMPTROLLER;
    process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
    resetAddressCache();
  });

  test('targets the ISO comptroller when the position lives there', async () => {
    const metrics = await new KineticAdapter().getMetrics(
      borrowPosition({ cToken: KUSDT0_ISO, comptroller: ISO_COMPTROLLER, iso: true }),
    );
    expect(mockCtorAddresses[0]).toBe(ISO_COMPTROLLER);
    // ISO liquidity read succeeded → real metrics, not the error envelope
    expect(metrics.extras?.error).toBeUndefined();
    expect(metrics.extras?.collateralFactor).toBeCloseTo(0.7, 6);
  });

  test('falls back to the primary comptroller when metadata omits it', async () => {
    await new KineticAdapter().getMetrics(borrowPosition({ cToken: KUSDT0_ISO }));
    expect(mockCtorAddresses[0]).toBe(PRIMARY_COMPTROLLER);
  });

  test('returns {} when the cToken is unknown (no read attempted)', async () => {
    const metrics = await new KineticAdapter().getMetrics(borrowPosition({}));
    expect(metrics).toEqual({});
    expect(mockCtorAddresses).toHaveLength(0);
  });
});

/**
 * Value tests for the account-margin math. getAccountLiquidity returns
 * Σ(collateral·CF) − Σdebt, so each leg recovers its missing side from that
 * margin. Before the fix the BORROW-leg HF used collateralUSD (always 0 on a
 * borrow leg) instead of adding the debt back — an above-water account read
 * as HF≈0 — and liquidationPrice demanded debt AND collateral on the SAME leg
 * (impossible: kinds are exclusive), so it was structurally always undefined.
 */
describe('KineticAdapter.getMetrics — HF / LTV / liquidation price values', () => {
  beforeEach(() => {
    mockCtorAddresses.length = 0;
    mockChain.liquidity = 10n ** 18n;
    mockChain.shortfall = 0n;
    mockChain.collateralFactorMantissa = 700000000000000000n;
    process.env.KINETIC_COMPTROLLER = PRIMARY_COMPTROLLER;
    process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
    resetAddressCache();
  });

  const meta = { cToken: KUSDT0_ISO, comptroller: ISO_COMPTROLLER, iso: true };

  test('BORROW leg: HF = (debt + margin) / debt; no LTV/liq-price guessed', async () => {
    // debt $500, margin $1 → Σ(C·CF) = $501 → HF = 1.002
    const m = await new KineticAdapter().getMetrics(borrowPosition(meta));
    expect(m.hf).toBeCloseTo(501 / 500, 9);
    expect(m.ltv).toBeUndefined();
    expect(m.liquidationPrice).toBeUndefined();
  });

  test('BORROW leg under shortfall: HF < 1', async () => {
    // debt $500, shortfall $50 → Σ(C·CF) = $450 → HF = 0.9
    mockChain.liquidity = 0n;
    mockChain.shortfall = 50n * 10n ** 18n;
    const m = await new KineticAdapter().getMetrics(borrowPosition(meta));
    expect(m.hf).toBeCloseTo(0.9, 9);
  });

  test('SUPPLY leg with debt: HF, LTV and liquidation price = price/HF', async () => {
    // collateral $1000 · CF 0.7 = $700 adjusted; margin $1 → implied debt $699
    const m = await new KineticAdapter().getMetrics(supplyPosition(meta));
    expect(m.hf).toBeCloseTo(700 / 699, 9);
    expect(m.ltv).toBeCloseTo(699 / 1000, 9);
    // P_liq = P_now / HF = 2 / (700/699)
    expect(m.liquidationPrice).toBeCloseTo(2 * (699 / 700), 9);
  });

  test('SUPPLY leg with no debt: LTV 0, no HF, no liquidation price', async () => {
    // margin equals the full adjusted collateral → implied debt 0
    mockChain.liquidity = 700n * 10n ** 18n;
    const m = await new KineticAdapter().getMetrics(supplyPosition(meta));
    expect(m.hf).toBeUndefined();
    expect(m.ltv).toBe(0);
    expect(m.liquidationPrice).toBeUndefined();
  });
});

/**
 * PROTECT's automated repay must be SIGNABLE. Before the fix the adapter kept
 * BaseAdapter's default intent (no txData) so the AutomationEngine prepared a
 * repay nobody could sign. Now `repay` carries the SAME batch A1 uses:
 * approve (as preState.prerequisiteCalls) + repayBorrowBehalf(borrower) (txData).
 */
describe('KineticAdapter.buildTransactionIntent — repay carries calldata', () => {
  beforeEach(() => {
    mockCtorAddresses.length = 0;
    mockChain.liquidity = 10n ** 18n;
    mockChain.shortfall = 0n;
    mockChain.collateralFactorMantissa = 700000000000000000n;
    process.env.KINETIC_COMPTROLLER = PRIMARY_COMPTROLLER;
    process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
    process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
    resetAddressCache();
  });

  const BORROWER = '0x00000000000000000000000000000000000000aa';

  test('repay → txData = repayBorrowBehalf on kUSDT0_ISO + approve prerequisite', async () => {
    const intent = await new KineticAdapter().buildTransactionIntent(
      {
        kind: 'repay',
        protocolId: 'kinetic',
        chainId: 14,
        wallet: BORROWER,
        inputs: { amount: '2500000' }, // 2.5 USDT0 base units
      },
      {
        owner: BORROWER,
        sessionId: 'test-session',
        priceSnapshot: { takenAt: new Date(), prices: {} },
      },
    );

    // Signable payload: repayBorrowBehalf(address,uint256) selector 0x2608f818.
    expect(intent.txData).toBeDefined();
    expect(intent.txData!.to).toBe(KUSDT0_ISO);
    expect(intent.txData!.data.startsWith('0x2608f818')).toBe(true);
    expect(intent.txData!.chainId).toBe(14);

    // The approve that must precede the pull, batched by the signing surface:
    // approve(address,uint256) selector 0x095ea7b3, on the ON-CHAIN-resolved
    // underlying (never the kToken — invariant #3).
    const prereqs = intent.preState.prerequisiteCalls ?? [];
    expect(prereqs).toHaveLength(1);
    expect(prereqs[0].to).toBe(mockChain.usdt0Underlying);
    expect(prereqs[0].data.startsWith('0x095ea7b3')).toBe(true);
  });

  test('non-repay kinds keep the default simulation-only intent (no txData)', async () => {
    const intent = await new KineticAdapter().buildTransactionIntent(
      {
        kind: 'supply',
        protocolId: 'kinetic',
        chainId: 14,
        wallet: BORROWER,
        inputs: { amount: '1000000' },
      },
      {
        owner: BORROWER,
        sessionId: 'test-session',
        priceSnapshot: { takenAt: new Date(), prices: {} },
      },
    );
    expect(intent.txData).toBeUndefined();
  });
});

/**
 * F9 — the automated rail speaks A1's restore semantics: `mode:'restore'`
 * computes the LIVE minimum repay to lift HF back to the signed targetHF;
 * `mode:'full'` repays the live outstanding debt. Deterministic math over
 * user-signed parameters (invariant #8) — never a stale fixed number.
 */
describe('KineticAdapter.buildTransactionIntent — restore/full modes', () => {
  beforeEach(() => {
    mockCtorAddresses.length = 0;
    mockChain.liquidity = 10n ** 18n;
    mockChain.shortfall = 0n;
    mockChain.collateralFactorMantissa = 700000000000000000n;
    mockChain.paSupplyUBA = 1_000_000_000n; // 1000 FXRP
    mockChain.paDebtBase = 500_000_000n; // 500 USDT0
    mockChain.xrpPriceUSD = 0.75;
    process.env.KINETIC_COMPTROLLER = PRIMARY_COMPTROLLER;
    process.env.KINETIC_ISO_COMPTROLLER = ISO_COMPTROLLER;
    process.env.KINETIC_KFXRP_ISO = '0x2222222222222222222222222222222222222222';
    process.env.KINETIC_KUSDT0_ISO = KUSDT0_ISO;
    resetAddressCache();
  });

  const BORROWER = '0x00000000000000000000000000000000000000aa';
  const ctx = {
    owner: BORROWER,
    sessionId: 'test-session',
    priceSnapshot: { takenAt: new Date(), prices: {} },
  };

  test("mode 'restore': live minimum repay to reach the signed targetHF", async () => {
    // HF = (1000·0.75·0.7)/500 = 1.05 < target 1.2
    // target debt = (1000·0.75·0.7)/1.2 = 437.5 → repay 62.5 USDT0
    const intent = await new KineticAdapter().buildTransactionIntent(
      {
        kind: 'repay',
        protocolId: 'kinetic',
        chainId: 14,
        wallet: BORROWER,
        inputs: { mode: 'restore', targetHF: 1.2 },
      },
      ctx,
    );
    expect(intent.txData).toBeDefined();
    const { ethers } = jest.requireActual('ethers');
    const iface = new ethers.Interface([
      'function repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)',
    ]);
    const [, repayAmount] = iface.decodeFunctionData('repayBorrowBehalf', intent.txData!.data);
    expect(repayAmount).toBe(62_500_000n);
    expect(intent.warnings.some((w) => w.includes('restore repay'))).toBe(true);
  });

  test("mode 'restore' when HF already above target: honest no-payload intent", async () => {
    mockChain.xrpPriceUSD = 2; // HF = (1000·2·0.7)/500 = 2.8 ≥ 1.2
    const intent = await new KineticAdapter().buildTransactionIntent(
      {
        kind: 'repay',
        protocolId: 'kinetic',
        chainId: 14,
        wallet: BORROWER,
        inputs: { mode: 'restore', targetHF: 1.2 },
      },
      ctx,
    );
    expect(intent.txData).toBeUndefined();
    expect(intent.warnings.some((w) => w.includes('already at/above target'))).toBe(true);
  });

  test("mode 'full': repays the live outstanding debt", async () => {
    const intent = await new KineticAdapter().buildTransactionIntent(
      {
        kind: 'repay',
        protocolId: 'kinetic',
        chainId: 14,
        wallet: BORROWER,
        inputs: { mode: 'full' },
      },
      ctx,
    );
    const { ethers } = jest.requireActual('ethers');
    const iface = new ethers.Interface([
      'function repayBorrowBehalf(address borrower, uint256 repayAmount) returns (uint256)',
    ]);
    const [, repayAmount] = iface.decodeFunctionData('repayBorrowBehalf', intent.txData!.data);
    expect(repayAmount).toBe(500_000_000n);
  });
});


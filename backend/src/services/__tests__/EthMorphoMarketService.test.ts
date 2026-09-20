/**
 * EthMorphoMarketService — B2 data layer tests (plan §13, adjustment #4 of the
 * infrastructure review: liquidity pre-flight BEFORE the signature).
 *
 * Fixtures mirror the real market's shape: FXRP collateral at 6 decimals,
 * RLUSD loan at 18, price at the 1e36×10^(18-6) oracle scale, ~90% utilisation.
 */
import {
  MorphoChainReader,
  MorphoMarketState,
  verifyMarketParams,
  readMarketSnapshot,
  computeUserPosition,
  preflightBorrow,
  preflightBorrowHealth,
  preflightWithdrawCollateral,
  ratePerSecondToAprPct,
  emRepayFireCheck,
  ORACLE_PRICE_SCALE,
} from '../EthMorphoMarketService';
import {
  FXRP_RLUSD_MARKET_ID,
  FXRP_RLUSD_MARKET_PARAMS,
  MorphoMarketParams,
} from '../../connectors/protocols/adapters/MorphoBlueEthAdapter';

const E18 = 10n ** 18n;
const USER = '0x1111111111111111111111111111111111111111';

/** Oracle price for "1 FXRP = 1 RLUSD": 1e36 × 10^(18-6) = 1e48. */
const PRICE_ONE = 10n ** 48n;

const MARKET_STATE: MorphoMarketState = {
  totalSupplyAssets: 5_630_000n * E18,
  totalSupplyShares: 5_630_000n * E18 * 1_000_000n, // ~1e6 shares per asset (virtual scale)
  totalBorrowAssets: 5_080_000n * E18,
  totalBorrowShares: 5_080_000n * E18 * 1_000_000n,
  lastUpdate: 1_755_264_299n,
  fee: 0n,
};

function stubReader(overrides: Partial<{
  params: MorphoMarketParams;
  state: MorphoMarketState;
  price: bigint;
  ratePerSecond: bigint | Error;
  position: { supplyShares: bigint; borrowShares: bigint; collateral: bigint };
}> = {}): MorphoChainReader {
  const params = overrides.params ?? FXRP_RLUSD_MARKET_PARAMS;
  return {
    async idToMarketParams() { return params; },
    async market() { return overrides.state ?? MARKET_STATE; },
    async position() {
      return overrides.position ?? { supplyShares: 0n, borrowShares: 0n, collateral: 0n };
    },
    async oraclePrice() { return overrides.price ?? PRICE_ONE; },
    async borrowRatePerSecond() {
      const r = overrides.ratePerSecond ?? 1_000_000_000n; // ~3.15%/yr in WAD/s
      if (r instanceof Error) throw r;
      return r;
    },
    async erc20Decimals(token: string) {
      return token.toLowerCase() === params.loanToken.toLowerCase() ? 18 : 6;
    },
  };
}

describe('verifyMarketParams — drift refusal', () => {
  it('passes when on-chain params match the pinned set', async () => {
    await expect(verifyMarketParams(stubReader())).resolves.toMatchObject({
      loanToken: FXRP_RLUSD_MARKET_PARAMS.loanToken,
    });
  });

  it('throws MARKET_PARAMS_DRIFT when any field differs (oracle here)', async () => {
    const drifted = { ...FXRP_RLUSD_MARKET_PARAMS, oracle: '0x000000000000000000000000000000000000dEaD' };
    await expect(verifyMarketParams(stubReader({ params: drifted })))
      .rejects.toMatchObject({ code: 'MARKET_PARAMS_DRIFT' });
  });
});

describe('readMarketSnapshot', () => {
  it('computes available liquidity, utilisation and reads 6/18 decimals', async () => {
    const snap = await readMarketSnapshot(stubReader(), FXRP_RLUSD_MARKET_ID);
    expect(snap.availableLiquidity).toBe(550_000n * E18);
    expect(snap.utilization).toBeCloseTo(0.9023, 3);
    expect(snap.loanDecimals).toBe(18);
    expect(snap.collateralDecimals).toBe(6);
    expect(snap.borrowAprSource).toContain('on-chain');
  });

  it('annualises the IRM per-second rate — and never invents it when the view fails', async () => {
    const ok = await readMarketSnapshot(stubReader({ ratePerSecond: 1_000_000_000n }));
    expect(ok.borrowAprPct).toBeCloseTo(3.15, 1);
    const broken = await readMarketSnapshot(stubReader({ ratePerSecond: new Error('irm down') }));
    expect(broken.borrowAprPct).toBeUndefined();
  });
});

describe('ratePerSecondToAprPct', () => {
  it('WAD/s → APR%: 1e9/s ≈ 3.1536%/yr', () => {
    expect(ratePerSecondToAprPct(1_000_000_000n)).toBeCloseTo(3.1536, 3);
  });
});

describe('computeUserPosition — the 6/18 asymmetry end to end', () => {
  const snapshot = { state: MARKET_STATE, oraclePrice: PRICE_ONE, params: FXRP_RLUSD_MARKET_PARAMS };

  it('5 FXRP collateral at price 1.0 → value 5 RLUSD, maxBorrow 3.85 (lltv 0.77)', () => {
    const pos = computeUserPosition(
      { supplyShares: 0n, borrowShares: 0n, collateral: 5_000_000n }, // 5 FXRP @ 6 dec
      snapshot,
    );
    expect(pos.collateralValue).toBe(5n * E18);
    expect(pos.maxBorrow).toBe((5n * E18 * 77n) / 100n);
    expect(pos.healthFactor).toBe(Infinity); // no debt yet
  });

  it('debt shares convert UP and HF = maxBorrow/debt', () => {
    // 2 RLUSD of debt at the market's ~1e6 shares-per-asset scale
    const borrowShares = 2n * E18 * 1_000_000n;
    const pos = computeUserPosition(
      { supplyShares: 0n, borrowShares, collateral: 5_000_000n },
      snapshot,
    );
    // toAssetsUp rounds up: expect ≈ 2e18 (±1 wei of rounding)
    expect(pos.borrowAssets - 2n * E18).toBeLessThanOrEqual(1n);
    expect(pos.borrowAssets - 2n * E18).toBeGreaterThanOrEqual(0n);
    expect(pos.healthFactor).toBeCloseTo(3.85 / 2, 5);
  });
});

describe('preflightBorrow — adjustment #4 (ORDER_WOULD_REVERT pattern)', () => {
  const snap = {
    availableLiquidity: 550_000n * E18,
  } as Awaited<ReturnType<typeof readMarketSnapshot>>;

  it('passes a borrow within liquidity', () => {
    expect(preflightBorrow(snap, 100n * E18)).toEqual({ ok: true });
  });

  it('blocks a borrow above what the pool can lend, with both numbers disclosed', () => {
    const res = preflightBorrow(snap, 550_001n * E18);
    expect(res).toMatchObject({ ok: false, code: 'BORROW_EXCEEDS_LIQUIDITY' });
    if (!res.ok) {
      expect(res.data?.availableLiquidity).toBe((550_000n * E18).toString());
    }
  });

  it('blocks zero/negative', () => {
    expect(preflightBorrow(snap, 0n)).toMatchObject({ ok: false, code: 'AMOUNT_NOT_POSITIVE' });
  });
});

describe('preflightBorrowHealth', () => {
  const position = {
    collateral: 5_000_000n,
    borrowShares: 0n,
    borrowAssets: 3n * E18,
    maxBorrow: (5n * E18 * 77n) / 100n, // 3.85
    collateralValue: 5n * E18,
    healthFactor: 3.85 / 3,
  };

  it('passes while debt-after stays under maxBorrow', () => {
    expect(preflightBorrowHealth(position, (85n * E18) / 100n)).toEqual({ ok: true });
  });

  it('blocks past the liquidation ceiling', () => {
    expect(preflightBorrowHealth(position, 1n * E18))
      .toMatchObject({ ok: false, code: 'BORROW_WOULD_LIQUIDATE' });
  });
});

describe('preflightWithdrawCollateral', () => {
  const snapshot = { oraclePrice: PRICE_ONE, params: FXRP_RLUSD_MARKET_PARAMS };
  const position = {
    collateral: 5_000_000n,
    borrowShares: 0n,
    borrowAssets: 2n * E18,
    maxBorrow: (5n * E18 * 77n) / 100n,
    collateralValue: 5n * E18,
    healthFactor: 3.85 / 2,
  };

  it('allows a withdrawal that keeps debt under the shrunk ceiling', () => {
    // Remaining 3 FXRP → maxBorrow 2.31 > debt 2.0
    expect(preflightWithdrawCollateral(position, snapshot, 2_000_000n)).toEqual({ ok: true });
  });

  it('blocks when remaining collateral no longer covers the debt', () => {
    // Remaining 2 FXRP → maxBorrow 1.54 < debt 2.0
    expect(preflightWithdrawCollateral(position, snapshot, 3_000_000n))
      .toMatchObject({ ok: false, code: 'WITHDRAW_WOULD_LIQUIDATE' });
  });

  it('blocks withdrawing more than the position holds', () => {
    expect(preflightWithdrawCollateral(position, snapshot, 6_000_000n))
      .toMatchObject({ ok: false, code: 'WITHDRAW_EXCEEDS_COLLATERAL' });
  });
});

describe('emRepayFireCheck — the tick validation half of W5/B7 (M1 pattern)', () => {
  it('with live debt: ok + debt base units + live HF for the nudge', async () => {
    const reader = stubReader({
      position: { supplyShares: 0n, borrowShares: 2n * E18 * 1_000_000n, collateral: 5_000_000n },
    });
    const check = await emRepayFireCheck(reader, USER);
    expect(check.ok).toBe(true);
    expect(BigInt(check.debtBase ?? '0')).toBeGreaterThanOrEqual(2n * E18);
    expect(check.healthFactor).toBeCloseTo(3.85 / 2, 3);
  });

  it('debt already closed: NOT ok — a push to repay a vanished debt is the screen-lies family', async () => {
    const reader = stubReader({
      position: { supplyShares: 0n, borrowShares: 0n, collateral: 5_000_000n },
    });
    const check = await emRepayFireCheck(reader, USER);
    expect(check).toMatchObject({ ok: false, note: expect.stringContaining('nothing to repay') });
  });
});

describe('scale sanity', () => {
  it('ORACLE_PRICE_SCALE is 1e36 (decimal asymmetry lives in the price, not here)', () => {
    expect(ORACLE_PRICE_SCALE).toBe(10n ** 36n);
  });
});

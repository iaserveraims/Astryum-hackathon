/**
 * MorphoBlueEthAdapter — encoding tests (B3, plan §13).
 *
 * Selectors are pinned from the CANONICAL SIGNATURE STRINGS via keccak (id()),
 * independent of how the adapter builds its Interface — if the tuple shape
 * drifts, these fail loudly. Args are verified by decode-roundtrip.
 */
import { Interface, id, MaxUint256, getAddress } from 'ethers';
import {
  MORPHO_BLUE_SINGLETON,
  FXRP_RLUSD_MARKET_ID,
  FXRP_RLUSD_MARKET_PARAMS,
  FXRP_ETH,
  RLUSD_ETH,
  buildSupplyCollateralLegs,
  buildBorrowLegs,
  buildRepayLegs,
  buildWithdrawCollateralLegs,
} from '../MorphoBlueEthAdapter';

const USER = '0x1111111111111111111111111111111111111111';
const TUPLE = '(address,address,address,address,uint256)';
const sel = (sig: string) => id(sig).slice(0, 10);

const SELECTORS = {
  supplyCollateral: sel(`supplyCollateral(${TUPLE},uint256,address,bytes)`),
  withdrawCollateral: sel(`withdrawCollateral(${TUPLE},uint256,address,address)`),
  borrow: sel(`borrow(${TUPLE},uint256,uint256,address,address)`),
  repay: sel(`repay(${TUPLE},uint256,uint256,address,bytes)`),
  approve: sel('approve(address,uint256)'),
};

const decodeIface = new Interface([
  `function supplyCollateral(${TUPLE} p, uint256 assets, address onBehalf, bytes data)`,
  `function withdrawCollateral(${TUPLE} p, uint256 assets, address onBehalf, address receiver)`,
  `function borrow(${TUPLE} p, uint256 assets, uint256 shares, address onBehalf, address receiver)`,
  `function repay(${TUPLE} p, uint256 assets, uint256 shares, address onBehalf, bytes data)`,
  'function approve(address spender, uint256 amount)',
]);

describe('market constants (on-chain verified 2026-08-15)', () => {
  it('pins the flagship market params', () => {
    expect(FXRP_RLUSD_MARKET_ID).toBe(
      '0x4fa31e3f8ba345227d44e1cf48559eea53a90dd5311dc006984c060f2f311d96',
    );
    expect(FXRP_RLUSD_MARKET_PARAMS.loanToken).toBe(RLUSD_ETH);
    expect(FXRP_RLUSD_MARKET_PARAMS.collateralToken).toBe(FXRP_ETH);
    expect(FXRP_RLUSD_MARKET_PARAMS.lltv).toBe(770000000000000000n); // 0.77 WAD
  });

  it('addresses are valid and checksummed', () => {
    for (const a of [MORPHO_BLUE_SINGLETON, FXRP_ETH, RLUSD_ETH,
      FXRP_RLUSD_MARKET_PARAMS.oracle, FXRP_RLUSD_MARKET_PARAMS.irm]) {
      expect(getAddress(a)).toBe(a);
    }
  });
});

describe('buildSupplyCollateralLegs', () => {
  const assets = 5_000_000n; // 5 FXRP at 6 decimals
  const legs = buildSupplyCollateralLegs(USER, assets);

  it('is approve(FXRP→singleton, exact) then supplyCollateral', () => {
    expect(legs).toHaveLength(2);
    expect(legs[0].to).toBe(FXRP_ETH);
    expect(legs[0].data.slice(0, 10)).toBe(SELECTORS.approve);
    const ap = decodeIface.decodeFunctionData('approve', legs[0].data);
    expect(ap.spender).toBe(MORPHO_BLUE_SINGLETON);
    expect(ap.amount).toBe(assets); // FINITE, never MaxUint
    expect(ap.amount).not.toBe(MaxUint256);

    expect(legs[1].to).toBe(MORPHO_BLUE_SINGLETON);
    expect(legs[1].data.slice(0, 10)).toBe(SELECTORS.supplyCollateral);
    const sc = decodeIface.decodeFunctionData('supplyCollateral', legs[1].data);
    expect(sc.assets).toBe(assets);
    expect(sc.onBehalf).toBe(USER);
    expect(sc.p[4]).toBe(FXRP_RLUSD_MARKET_PARAMS.lltv); // lltv last in tuple
    expect(sc.p[0]).toBe(RLUSD_ETH);  // loanToken first in tuple
    expect(sc.p[1]).toBe(FXRP_ETH);   // collateralToken second
  });

  it('every leg is non-payable', () => {
    for (const leg of legs) expect(leg.value).toBe('0x0');
  });
});

describe('buildBorrowLegs', () => {
  it('borrows in assets-mode (shares = 0) to the user', () => {
    const assets = 250n * 10n ** 18n; // 250 RLUSD at 18 decimals
    const [leg] = buildBorrowLegs(USER, assets);
    expect(leg.to).toBe(MORPHO_BLUE_SINGLETON);
    expect(leg.data.slice(0, 10)).toBe(SELECTORS.borrow);
    const b = decodeIface.decodeFunctionData('borrow', leg.data);
    expect(b.assets).toBe(assets);
    expect(b.shares).toBe(0n);
    expect(b.onBehalf).toBe(USER);
    expect(b.receiver).toBe(USER);
  });
});

describe('buildRepayLegs', () => {
  it('partial: assets-mode with approve = assets (finite)', () => {
    const assets = 100n * 10n ** 18n;
    const legs = buildRepayLegs(USER, { mode: 'partial', assets });
    expect(legs[0].to).toBe(RLUSD_ETH);
    const ap = decodeIface.decodeFunctionData('approve', legs[0].data);
    expect(ap.amount).toBe(assets);
    const r = decodeIface.decodeFunctionData('repay', legs[1].data);
    expect(r.assets).toBe(assets);
    expect(r.shares).toBe(0n);
  });

  it('full: shares-mode closes LIVE debt with a finite approve cap', () => {
    const fullDebtShares = 987654321n;
    const approveCap = 101n * 10n ** 18n; // debt + buffer, computed by the route
    const legs = buildRepayLegs(USER, { mode: 'full', fullDebtShares, approveCap });
    const ap = decodeIface.decodeFunctionData('approve', legs[0].data);
    expect(ap.amount).toBe(approveCap);
    expect(ap.amount).not.toBe(MaxUint256);
    const r = decodeIface.decodeFunctionData('repay', legs[1].data);
    expect(r.assets).toBe(0n);
    expect(r.shares).toBe(fullDebtShares);
    expect(r.onBehalf).toBe(USER);
  });
});

describe('buildWithdrawCollateralLegs', () => {
  it('withdraws to the user', () => {
    const assets = 1_000_000n; // 1 FXRP
    const [leg] = buildWithdrawCollateralLegs(USER, assets);
    expect(leg.data.slice(0, 10)).toBe(SELECTORS.withdrawCollateral);
    const w = decodeIface.decodeFunctionData('withdrawCollateral', leg.data);
    expect(w.assets).toBe(assets);
    expect(w.onBehalf).toBe(USER);
    expect(w.receiver).toBe(USER);
  });
});

describe('guards', () => {
  it('rejects zero and negative amounts', () => {
    expect(() => buildSupplyCollateralLegs(USER, 0n)).toThrow(/> 0/);
    expect(() => buildBorrowLegs(USER, -1n)).toThrow(/> 0/);
    expect(() => buildRepayLegs(USER, { mode: 'partial', assets: 0n })).toThrow(/> 0/);
    expect(() => buildWithdrawCollateralLegs(USER, 0n)).toThrow(/> 0/);
  });

  it('rejects malformed user addresses', () => {
    expect(() => buildBorrowLegs('not-an-address', 1n)).toThrow(/address/);
  });
});

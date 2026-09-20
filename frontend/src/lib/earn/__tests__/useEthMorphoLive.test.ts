/**
 * Pure helpers of useEthMorphoLive (B5-UI paso 2): the yield entries the two
 * eth-morpho cards paint. Pinned: never an invented figure — no source ⇒ an
 * honest 'none' label (invariant #9), and the base/net incentive split is said
 * next to the number, not hidden.
 */
import { describe, it, expect } from 'vitest';
import {
  lendYieldEntry,
  carryBorrowCost,
  type EthMorphoMarketLive,
  type EthMorphoVaultLive,
} from '../useEthMorphoLive';

const VAULT: EthMorphoVaultLive = {
  assetDecimals: 18,
  totalAssetsBase: '318000000000000000000000000',
  apyPct: 3.06,
  netApyPct: 6.06,
  performanceFeePct: 10,
  apySource: 'Morpho API (blue-api.morpho.org) — netApy includes incentives',
};

const MARKET: EthMorphoMarketLive = {
  lltvPct: 77,
  utilizationPct: 90.23,
  availableLiquidityBase: '550000000000000000000000',
  decimals: { collateral: 6, loan: 18 },
  borrowAprPct: 5.4,
  borrowAprSource: 'AdaptiveCurveIRM borrowRateView (Ethereum, on-chain)',
};

describe('lendYieldEntry', () => {
  it('uses netApy with its source and SAYS the incentives split', () => {
    const y = lendYieldEntry(VAULT);
    expect(y).toMatchObject({ kind: 'apy', pct: 6.06 });
    if (y.kind === 'apy') {
      expect(y.source).toContain('Morpho API');
      expect(y.note).toContain('base 3.06%');
    }
  });

  it('falls back to base apy when net is missing, without a split note', () => {
    const y = lendYieldEntry({ ...VAULT, netApyPct: null });
    expect(y).toMatchObject({ kind: 'apy', pct: 3.06 });
    if (y.kind === 'apy') expect(y.note).toBeUndefined();
  });

  it('never invents: no figures ⇒ honest none label', () => {
    expect(lendYieldEntry({ ...VAULT, apyPct: null, netApyPct: null })).toMatchObject({
      kind: 'none',
      pct: null,
      label: expect.stringContaining('source unavailable'),
    });
    expect(lendYieldEntry(null)).toMatchObject({ kind: 'none' });
  });
});

describe('carryBorrowCost', () => {
  it('carries the borrow APR with its named source', () => {
    expect(carryBorrowCost(MARKET)).toEqual({
      asset: 'RLUSD',
      aprPct: 5.4,
      source: 'AdaptiveCurveIRM borrowRateView (Ethereum, on-chain)',
    });
  });

  it('null when the IRM view was unavailable — the card says so, never guesses', () => {
    expect(carryBorrowCost({ ...MARKET, borrowAprPct: null })).toBeNull();
    expect(carryBorrowCost(null)).toBeNull();
  });
});

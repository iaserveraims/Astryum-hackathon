import { describe, expect, it } from 'vitest';
import {
  EM_DOCUMENTED_DECIMALS,
  boardShowsEmpty,
  decimalsFallbackNote,
  decimalsVerdict,
  isTransientStatus,
  positionReadFailureKind,
  positionWalletOf,
  resolveExitDecimals,
} from '../exitReadState';

/**
 * A failed read on an exit is never a silent dead end, and a fallback on
 * decimals never reaches a signature unless the prepare confirms it.
 */

describe('resolveExitDecimals', () => {
  it('the market read wins when it answered', () => {
    expect(resolveExitDecimals({ side: 'collateral', market: { collateral: 6, loan: 18 } })).toEqual({
      decimals: 6,
      source: 'market',
    });
    expect(resolveExitDecimals({ side: 'loan', market: { collateral: 6, loan: 18 }, positionDecimals: 6 })).toEqual({
      decimals: 18,
      source: 'market',
    });
  });

  it('a failed market read uses another live read, then the documented F4 constants', () => {
    expect(resolveExitDecimals({ side: 'loan', market: null, positionDecimals: 18 })).toEqual({
      decimals: 18,
      source: 'position',
    });
    expect(resolveExitDecimals({ side: 'collateral', market: null })).toEqual({ decimals: 6, source: 'documented' });
    expect(resolveExitDecimals({ side: 'loan', market: {} })).toEqual({ decimals: 18, source: 'documented' });
    expect(EM_DOCUMENTED_DECIMALS).toEqual({ collateral: 6, loan: 18 });
  });

  it('garbage in the market body is not a decimals figure', () => {
    expect(resolveExitDecimals({ side: 'loan', market: { loan: '18' } }).source).toBe('documented');
    expect(resolveExitDecimals({ side: 'loan', market: { loan: -1 } }).source).toBe('documented');
    expect(resolveExitDecimals({ side: 'loan', market: { loan: 1.5 } }).source).toBe('documented');
  });
});

describe('decimalsVerdict', () => {
  it('a fallback reaches review ONLY when the prepare confirms the same decimals', () => {
    const doc = { decimals: 6, source: 'documented' as const };
    expect(decimalsVerdict(doc, 6)).toBe('ok');
    expect(decimalsVerdict(doc, 18)).toBe('mismatch');
    expect(decimalsVerdict(doc, undefined)).toBe('unconfirmed');
    expect(decimalsVerdict({ decimals: 18, source: 'position' }, null)).toBe('unconfirmed');
  });

  it('with the market read, a missing prepare figure is fine — a different one never is', () => {
    const market = { decimals: 18, source: 'market' as const };
    expect(decimalsVerdict(market, undefined)).toBe('ok');
    expect(decimalsVerdict(market, 18)).toBe('ok');
    expect(decimalsVerdict(market, 6)).toBe('mismatch');
  });

  it('the review only carries a fallback note when a fallback was used', () => {
    expect(decimalsFallbackNote('market')).toBeNull();
    expect(decimalsFallbackNote('documented')).toMatch(/confirmed/);
  });
});

describe('position read failures', () => {
  it('451 is region, not «a moment»', () => {
    expect(positionReadFailureKind(451)).toBe('region');
    expect(isTransientStatus(451)).toBe(false);
  });

  it('auth, transient (5xx/429/408/network) and other', () => {
    expect(positionReadFailureKind(401)).toBe('auth');
    expect(positionReadFailureKind(403)).toBe('auth');
    expect(positionReadFailureKind(502)).toBe('transient');
    expect(positionReadFailureKind(429)).toBe('transient');
    expect(positionReadFailureKind(408)).toBe('transient');
    expect(positionReadFailureKind(null)).toBe('transient');
    expect(positionReadFailureKind(404)).toBe('other');
  });

  it('positionWalletOf reads the wallet of a /position URL only', () => {
    const w = '0x62d7aBcDEF0123456789abcdef0123456789ABCD';
    expect(positionWalletOf(`https://api.x/api/eth-morpho/position?wallet=${encodeURIComponent(w)}&region=ES`)).toBe(w);
    expect(positionWalletOf('https://api.x/api/eth-morpho/status')).toBeNull();
    expect(positionWalletOf('https://api.x/api/eth-morpho/market?region=ES')).toBeNull();
    expect(positionWalletOf('https://api.x/api/eth-morpho/position?region=ES')).toBeNull();
  });
});

describe('boardShowsEmpty', () => {
  const base = { loading: false, error: null, positionsCount: 0, unreadableCount: 0, vaultLegUnread: false };
  it('only when every read answered and nothing came back', () => {
    expect(boardShowsEmpty(base)).toBe(true);
    expect(boardShowsEmpty({ ...base, unreadableCount: 1 })).toBe(false);
    expect(boardShowsEmpty({ ...base, vaultLegUnread: true })).toBe(false);
    expect(boardShowsEmpty({ ...base, error: 'boom' })).toBe(false);
    expect(boardShowsEmpty({ ...base, loading: true })).toBe(false);
    expect(boardShowsEmpty({ ...base, positionsCount: 2 })).toBe(false);
  });
});

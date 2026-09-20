import { describe, expect, it } from 'vitest';
import type { PoteState } from '../api';
import { decidePosition, hasShares, type HolderRead } from '../positionRead';

/**
 * VaultDetailPanel said «You are not in this vault.» for every failed read and
 * hid «Leave this vault». These tests fail if a read failure — or an unresolved
 * Personal Account — ever becomes 'out'.
 */

function state(shares?: string): PoteState {
  return {
    pote: '0xpote',
    name: 'Pot',
    symbol: 'aPOT',
    shareDecimals: 6,
    asset: { address: '0xfxrp', symbol: 'FXRP', decimals: 6 },
    totalAssets: '0',
    totalSupply: '0',
    sharePrice: '1',
    cooldownSeconds: 0,
    bufferFloorBps: 0,
    freeBalance: '0',
    earmarkedAssets: '0',
    totalClaimable: '0',
    maxVenueBps: 0,
    venues: [],
    tickets: [],
    governance: { council: '', constitutionRef: '', director: '', directorUntil: 0, payees: [] },
    holder: shares === undefined ? undefined : { address: '0xholder', shares },
  };
}

const ok = (shares?: string): HolderRead => ({ status: 'ok', state: state(shares) });
const failed: HolderRead = { status: 'failed' };
const pending: HolderRead = { status: 'pending' };

describe('decidePosition', () => {
  it('no wallet at all: ask to connect', () => {
    expect(decidePosition({ pa: 'none', reads: [] }).kind).toBe('no-wallet');
  });

  it('reading while any holder or the Personal Account is still pending', () => {
    expect(decidePosition({ pa: 'none', reads: [pending] }).kind).toBe('reading');
    expect(decidePosition({ pa: 'resolving', reads: [ok('0')] }).kind).toBe('reading');
    expect(decidePosition({ pa: 'resolving', reads: [] }).kind).toBe('reading');
  });

  it('a failed read is NEVER "not in this vault"', () => {
    const v = decidePosition({ pa: 'none', reads: [failed] });
    expect(v.kind).toBe('failed');
    const mixed = decidePosition({ pa: 'resolved', reads: [ok('0'), failed] });
    expect(mixed.kind).toBe('failed');
    expect(mixed.kind === 'failed' && mixed.state).toBeTruthy(); // tickets still readable
  });

  it('an unresolved Personal Account is NEVER "not in this vault"', () => {
    const v = decidePosition({ pa: 'failed', reads: [ok('0')] });
    expect(v).toMatchObject({ kind: 'failed', reason: 'personal-account' });
    expect(decidePosition({ pa: 'failed', reads: [] })).toMatchObject({ kind: 'failed', reason: 'personal-account' });
  });

  it('shares found anywhere are shown, flagged incomplete when another holder is unknown', () => {
    expect(decidePosition({ pa: 'resolved', reads: [ok('0'), ok('5')] })).toMatchObject({ kind: 'in', incomplete: false });
    expect(decidePosition({ pa: 'resolved', reads: [failed, ok('5')] })).toMatchObject({ kind: 'in', incomplete: true });
    expect(decidePosition({ pa: 'failed', reads: [ok('5')] })).toMatchObject({ kind: 'in', incomplete: true });
  });

  it('"out" only when every holder was read and none holds shares', () => {
    expect(decidePosition({ pa: 'resolved', reads: [ok('0'), ok('0')] }).kind).toBe('out');
    expect(decidePosition({ pa: 'none', reads: [ok()] }).kind).toBe('out');
  });
});

describe('hasShares', () => {
  it('treats missing, zero and garbage as no shares', () => {
    expect(hasShares(state())).toBe(false);
    expect(hasShares(state('0'))).toBe(false);
    expect(hasShares(state('abc'))).toBe(false);
    expect(hasShares(state('1'))).toBe(true);
    expect(hasShares(null)).toBe(false);
  });
});

/**
 * The pote's read layer — pure logic only (no RPC, no network).
 *
 * Every verdict of the pre-flight corresponds to a REAL revert in
 * AstryumVault (_allocate, requestRedeem, claimRedeem). A pre-flight that
 * does not tell the truth invites the user to sign a doomed transaction.
 */

import {
  checkClaimRedeem,
  checkPoteDirectTo,
  checkRequestRedeem,
  decodePoteVenueKind,
  type AstryumPoteState,
} from '../AstryumPoteStateService';

const FXRP_DEC = 6;
const u = (n: number) => BigInt(Math.round(n * 10 ** FXRP_DEC));
const NOW = 1_787_300_000;

/** A cooldown pote holding 100k FXRP: 60k in Kinetic, 30k in Firelight, 10k free. */
function poteState(over: Partial<AstryumPoteState> = {}): AstryumPoteState {
  return {
    pote: '0xB0B0000000000000000000000000000000000001',
    name: 'Astryum Pote B',
    symbol: 'apB-FXRP',
    shareDecimals: 9,
    asset: { address: '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE', symbol: 'FXRP', decimals: FXRP_DEC },
    totalAssets: u(100_000).toString(),
    totalSupply: (u(100_000) * 1000n).toString(), // offset-3 shares
    sharePrice: (10n ** 6n).toString(),
    cooldownSeconds: 72 * 3600,
    bufferFloorBps: 1000,
    freeBalance: u(10_000).toString(),
    earmarkedAssets: '0',
    totalClaimable: '0',
    maxVenueBps: 10_000,
    venues: [
      { id: 0, target: '0xaaaa000000000000000000000000000000000001', kind: 'compoundv2', readyAt: 0, retired: false, basis: u(60_000).toString(), value: u(60_000).toString(), queuedTotal: '0' },
      { id: 1, target: '0xaaaa000000000000000000000000000000000002', kind: 'erc4626queued', readyAt: 0, retired: false, basis: u(30_000).toString(), value: u(30_000).toString(), queuedTotal: '0' },
    ],
    tickets: [],
    governance: {
      council: '0xcccc000000000000000000000000000000000001',
      constitutionRef: '0x' + '11'.repeat(32),
      director: '0xdddd000000000000000000000000000000000001',
      directorUntil: NOW + 30 * 86_400,
      payees: [{ account: '0xdddd000000000000000000000000000000000001', bps: 1000 }],
    },
    ...over,
  };
}

describe('venue kinds', () => {
  it('decodes the contract enum in its declared order, queued included', () => {
    expect(decodePoteVenueKind(0)).toBe('erc4626');
    expect(decodePoteVenueKind(1)).toBe('compoundv2');
    expect(decodePoteVenueKind(2n)).toBe('erc4626queued');
  });

  it('refuses to guess a kind it does not know', () => {
    expect(() => decodePoteVenueKind(3)).toThrow(/unknown VenueKind/);
  });
});

describe('checkPoteDirectTo mirrors _allocate', () => {
  it('accepts a move that respects the floor and the cap', () => {
    // free 10k, floor = 10% of 100k = 10k → nothing can leave... narrow the
    // floor first so the happy path is a real happy path.
    const s = poteState({ bufferFloorBps: 500 }); // floor 5k
    expect(checkPoteDirectTo(s, 0, u(5_000), NOW)).toEqual({ ok: true });
  });

  it('VENUE_UNKNOWN / VENUE_RETIRED / VENUE_NOT_READY', () => {
    const s = poteState();
    expect(checkPoteDirectTo(s, 7, u(1), NOW)).toMatchObject({ ok: false, code: 'VENUE_UNKNOWN' });

    const retired = poteState();
    retired.venues[0].retired = true;
    expect(checkPoteDirectTo(retired, 0, u(1), NOW)).toMatchObject({ ok: false, code: 'VENUE_RETIRED' });

    const notReady = poteState();
    notReady.venues[0].readyAt = NOW + 86_400;
    expect(checkPoteDirectTo(notReady, 0, u(1), NOW)).toMatchObject({ ok: false, code: 'VENUE_NOT_READY' });
  });

  it('INSUFFICIENT_FREE speaks in the asset, exactly', () => {
    const v = checkPoteDirectTo(poteState({ bufferFloorBps: 0 }), 0, u(10_001), NOW);
    expect(v).toMatchObject({ ok: false, code: 'INSUFFICIENT_FREE' });
    expect((v as { detail?: string }).detail).toContain('10000');
  });

  it('BUFFER_FLOOR_CROSSED — I4 is a floor, not a suggestion', () => {
    // floor = 10k and free = 10k: the director cannot move a single unit.
    expect(checkPoteDirectTo(poteState(), 0, u(1), NOW)).toMatchObject({
      ok: false,
      code: 'BUFFER_FLOOR_CROSSED',
    });
  });

  it('ENTRY_CAP_EXCEEDED forecasts on post-move values, like the contract', () => {
    const s = poteState({ bufferFloorBps: 0, maxVenueBps: 6000 });
    // venue 0 sits at 60k of 100k = 60%; ONE more unit crosses the 60% cap.
    expect(checkPoteDirectTo(s, 0, u(1), NOW)).toMatchObject({ ok: false, code: 'ENTRY_CAP_EXCEEDED' });
    // venue 1 at 30% has room.
    expect(checkPoteDirectTo(s, 1, u(5_000), NOW)).toEqual({ ok: true });
  });
});

describe('checkRequestRedeem mirrors the cooldown gates', () => {
  it('a sync pote sends you to the sync door', () => {
    const s = poteState({ cooldownSeconds: 0 });
    expect(checkRequestRedeem(s, 1n, 10n)).toMatchObject({ ok: false, code: 'SYNC_POTE_USE_REDEEM' });
  });

  it('never lets you request more shares than you hold', () => {
    expect(checkRequestRedeem(poteState(), 11n, 10n)).toMatchObject({ ok: false, code: 'INSUFFICIENT_SHARES' });
    expect(checkRequestRedeem(poteState(), 0n, 10n)).toMatchObject({ ok: false, code: 'ZERO_SHARES' });
  });

  it('estimates assets proportionally — an estimate, never a promise', () => {
    const s = poteState();
    const half = BigInt(s.totalSupply) / 2n;
    const v = checkRequestRedeem(s, half, half);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.estAssets).toBe(u(50_000));
  });
});

describe('checkClaimRedeem is the exit clock (F3)', () => {
  const ticket = { id: 0, receiver: '0xeeee000000000000000000000000000000000001', assets: u(1_000).toString(), maturity: NOW + 3600, claimed: false };

  it('NOT_MATURE carries the exact remaining seconds', () => {
    const s = poteState({ tickets: [ticket] });
    expect(checkClaimRedeem(s, 0, NOW)).toEqual({
      ok: false,
      code: 'NOT_MATURE',
      maturity: NOW + 3600,
      remainingSeconds: 3600,
    });
  });

  it('matured tickets pass; unknown and spent ones refuse', () => {
    const s = poteState({ tickets: [ticket] });
    expect(checkClaimRedeem(s, 0, NOW + 3600)).toEqual({ ok: true });
    expect(checkClaimRedeem(s, 1, NOW)).toMatchObject({ ok: false, code: 'TICKET_UNKNOWN' });

    const spent = poteState({ tickets: [{ ...ticket, claimed: true }] });
    expect(checkClaimRedeem(spent, 0, NOW + 7200)).toMatchObject({ ok: false, code: 'ALREADY_CLAIMED' });
  });
});

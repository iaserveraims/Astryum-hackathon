/**
 * The classifier behind the Summary ring and the Portfolio table.
 *
 * Regression (founder, 2026-08-01): a queued Firelight exit — kind CLAIM —
 * fell through to "idle", so the ring read "Working $0.00 (0%)" while a
 * withdrawal was in flight, and money on its way home sat in the same slate
 * slice as coins doing nothing.
 */
import { describe, it, expect } from 'vitest';
import { positionState, exitInfo, nextArrival } from '../positionKinds';

const claim = (metadata: Record<string, unknown>) => ({ kind: 'CLAIM', metadata });

describe('positionState', () => {
  it('reads deployed capital as earning, whatever the case of the kind', () => {
    for (const kind of ['SUPPLY', 'stake', 'Staking', 'LP', 'reward', 'rewards', 'collateral']) {
      expect(positionState({ kind })).toBe('earning');
    }
  });

  it('reads wallet balance and locked escrow as idle', () => {
    expect(positionState({ kind: 'FREE' })).toBe('idle');
    expect(positionState({ kind: 'LOCKED' })).toBe('idle');
    expect(positionState({ kind: '' })).toBe('idle');
    expect(positionState({})).toBe('idle');
  });

  it('keeps debt out of both sides of the split', () => {
    expect(positionState({ kind: 'BORROW' })).toBe('debt');
    expect(positionState({ kind: 'debt' })).toBe('debt');
  });

  it('a queued exit is in flight — never idle', () => {
    // Firelight: the assets froze at signing, so it is transit, not work.
    expect(positionState(claim({ exiting: true, claimable: false, stillEarning: false }))).toBe('inflight');
    // Already claimable: still in flight until the user signs the claim.
    expect(positionState(claim({ exiting: true, claimable: true, stillEarning: false }))).toBe('inflight');
    // A CLAIM with no metadata at all must not fall back to "idle".
    expect(positionState({ kind: 'CLAIM' })).toBe('inflight');
  });

  it('a queued exit that keeps compounding counts as working (Sceptre cooldown)', () => {
    expect(positionState(claim({ exiting: true, claimable: false, stillEarning: true }))).toBe('earning');
  });
});

describe('exitInfo', () => {
  it('is null for anything that is not a queued exit', () => {
    expect(exitInfo({ kind: 'STAKE', metadata: { availableAt: '2026-08-02T00:00:00.000Z' } })).toBeNull();
  });

  it('carries the venue dates through untouched', () => {
    const info = exitInfo(
      claim({ claimable: false, availableAt: '2026-08-02T13:42:49.000Z', expiresAt: null, stillEarning: false }),
    );
    expect(info).toEqual({
      claimable: false,
      availableAt: '2026-08-02T13:42:49.000Z',
      expiresAt: null,
      stillEarning: false,
    });
  });

  it('never invents a date it was not given', () => {
    expect(exitInfo(claim({ claimable: false }))?.availableAt).toBeNull();
  });
});

describe('nextArrival', () => {
  it('picks the earliest date across every exit in flight', () => {
    const iso = nextArrival([
      claim({ availableAt: '2026-08-05T00:00:00.000Z' }),
      claim({ availableAt: '2026-08-02T13:42:49.000Z' }),
      { kind: 'FREE', metadata: {} },
    ]);
    expect(iso).toBe('2026-08-02T13:42:49.000Z');
  });

  it('is null when no venue could give a date', () => {
    expect(nextArrival([claim({ claimable: true }), { kind: 'STAKE' }])).toBeNull();
    expect(nextArrival([])).toBeNull();
  });
});

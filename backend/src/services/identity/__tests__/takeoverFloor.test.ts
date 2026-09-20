/**
 * readTakeoverFloorStrict.
 *
 * A takeover mark is only ever used ONE way: as a FLOOR that some `now`-ish
 * instant has to clear (a binding's `linkedAt`, a click-wrap's `acceptedAt`, a
 * desk row's `ownedSince`). So «can I read it?» was never the whole question —
 * a mark dated in the FUTURE parses perfectly and loses every one of those
 * comparisons, for ever, for every row. Taught that to the legal gate and
 * to the cage acknowledgement, and to neither of the two readers that decide
 * money. This is the one function all of them share now.
 *
 * Pure and clock-injected: no database, no network, no fake timers.
 */
import {
  markIsAheadOfClock,
  readTakeoverAtStrict,
  readTakeoverFloorStrict,
} from '../credentialsEpoch';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const PAST = '2026-09-01T00:00:00.000Z';
const FUTURE = '2026-09-16T00:00:00.000Z';

describe('markIsAheadOfClock', () => {
  it('only a mark strictly after the clock is ahead of it', () => {
    expect(markIsAheadOfClock(null, NOW)).toBe(false);
    expect(markIsAheadOfClock(new Date(PAST), NOW)).toBe(false);
    expect(markIsAheadOfClock(new Date(NOW), NOW)).toBe(false);
    expect(markIsAheadOfClock(new Date(FUTURE), NOW)).toBe(true);
  });

  /**
   * NO TOLERANCE WINDOW, ON PURPOSE (restated here because this is now
   * the shared rule): a window would buy an interval in which a signature from
   * BEFORE a real takeover counts, to spare a case that heals on its own.
   */
  it('one millisecond ahead is ahead — there is no grace window', () => {
    expect(markIsAheadOfClock(new Date(NOW.getTime() + 1), NOW)).toBe(true);
    expect(markIsAheadOfClock(new Date(NOW.getTime() - 1), NOW)).toBe(false);
  });
});

describe('readTakeoverFloorStrict — the two ways a mark is not a floor', () => {
  it('absent is «there was no takeover», and stays usable', () => {
    for (const preferences of [null, undefined, {}, { security: {} }, { security: { credentialsEpoch: 'x' } }]) {
      expect(readTakeoverFloorStrict(preferences, NOW)).toEqual({ readable: true, at: null, why: null });
    }
  });

  it('a mark in the past is the floor it always was', () => {
    const out = readTakeoverFloorStrict({ security: { takeoverAt: PAST } }, NOW);
    expect(out.readable).toBe(true);
    expect(out.at?.toISOString()).toBe(PAST);
    expect(out.why).toBeNull();
  });

  it('a mark that does not parse is unusable, and says which way', () => {
    for (const preferences of ['oops', [1, 2], { security: 'nonsense' }, { security: { takeoverAt: 'not a date' } }, { security: { takeoverAt: null } }]) {
      const out = readTakeoverFloorStrict(preferences, NOW);
      expect(out.readable).toBe(false);
      expect(out.why).toBe('unreadable');
    }
  });

  /**
   * THE HOLE LEFT. `readTakeoverAtStrict` still says «readable» about
   * this row — it IS readable — which is exactly how every consumer that only
   * asked about legibility went on using an unusable floor.
   */
  it('a mark ahead of the clock is unusable too, and is NOT confused with the unparseable one', () => {
    const preferences = { security: { takeoverAt: FUTURE } };
    expect(readTakeoverAtStrict(preferences)).toEqual({ readable: true, at: new Date(FUTURE) });
    const out = readTakeoverFloorStrict(preferences, NOW);
    expect(out.readable).toBe(false);
    expect(out.why).toBe('ahead-of-clock');
    // The mark itself travels, so a log or an admin screen can show the date.
    expect(out.at?.toISOString()).toBe(FUTURE);
  });

  /** It really does heal: the same row, read later, is an ordinary floor. */
  it('the same row becomes usable once the clock passes the mark — nothing is written', () => {
    const preferences = { security: { takeoverAt: FUTURE } };
    expect(readTakeoverFloorStrict(preferences, NOW).readable).toBe(false);
    const later = new Date(Date.parse(FUTURE) + 1000);
    expect(readTakeoverFloorStrict(preferences, later)).toEqual({
      readable: true,
      at: new Date(FUTURE),
      why: null,
    });
  });

  it('`why` is total: never undefined on either arm, so a caller that forgets to narrow still reads the truth', () => {
    expect(readTakeoverFloorStrict(null, NOW).why).toBeNull();
    expect(readTakeoverFloorStrict({ security: { takeoverAt: FUTURE } }, NOW).why).toBe('ahead-of-clock');
    expect(readTakeoverFloorStrict({ security: 'x' }, NOW).why).toBe('unreadable');
  });
});

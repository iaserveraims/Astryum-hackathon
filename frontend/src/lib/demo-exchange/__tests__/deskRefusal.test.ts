/**
 * Productizer it. 12 — the desk says the refusals of an omnibus payment in flight
 * with their numbers:
 *  - WAIT_FOR_LAST_LEDGER (2.3): a put-to-work release before its LastLedgerSequence
 *    names the ledger and the seconds left, never «could not be released» alone;
 *  - RECORD_NOT_YET_VISIBLE (1.4): a lagging node is «record it again», never
 *    «not this client's put-to-work»;
 *  - recoveryWarning (1.3): shown next to a council order when the server sent one.
 */
import { describe, expect, it } from 'vitest';
import {
  councilOrderExitToken,
  councilOrderRecoveryWarning,
  councilOrderServerWarnings,
  describeCouncilOrderRefusal,
  describeDeskRefusal,
  describeRefusal,
  isCageVerdict,
  isSameOrderRecentlyLaunched,
} from '../api';

const t = (s: string) => s;

describe('describeDeskRefusal', () => {
  it('WAIT_FOR_LAST_LEDGER names the ledger and the seconds left', () => {
    const text = describeDeskRefusal({ status: 409, error: 'WAIT_FOR_LAST_LEDGER', detail: 'server words', lastLedgerSequence: 1100, secondsLeft: 164 }, t);
    expect(text).toContain('XRPL ledger 1100');
    expect(text).toContain('≈ 164 s');
    expect(text).toMatch(/stays in flight/);
  });

  it('WAIT_FOR_LAST_LEDGER without numbers still says what to do, with no invented figure', () => {
    const text = describeDeskRefusal({ status: 409, error: 'WAIT_FOR_LAST_LEDGER' }, t);
    expect(text).toContain('ledger —');
    expect(text).toContain('≈ ? s');
  });

  it('RECORD_NOT_YET_VISIBLE is «record it again», nothing debited', () => {
    const text = describeDeskRefusal({ status: 503, error: 'RECORD_NOT_YET_VISIBLE', retryable: true }, t);
    expect(text).toMatch(/record it again/);
    expect(text).not.toMatch(/not this client/);
  });

  it('anything else falls back to the regular description', () => {
    const r = { status: 409, error: 'DESK_PAYMENT_SIGNED_NOT_ON_LEDGER', detail: 'it may still land' };
    expect(describeDeskRefusal(r, t)).toBe(describeRefusal(r, t));
  });
});

describe('only the CAGE\'s verdict is E7 evidence (it. 14, R2 2.4)', () => {
  it('the codes that mirror a revert of the mandate, on a 409, are the cage saying no', () => {
    for (const error of ['VENUE_UNKNOWN', 'VENUE_RETIRED', 'VENUE_NOT_READY', 'INSUFFICIENT_FREE', 'BUFFER_FLOOR_CROSSED', 'ENTRY_CAP_EXCEEDED', 'CAGE_ORDER_REFUSED']) {
      expect(isCageVerdict({ status: 409, error })).toBe(true);
    }
  });

  it('an operational refusal is NEVER a cage verdict: the same order out, too many pending, unrecorded, the region, the network', () => {
    for (const r of [
      { status: 409, error: 'SAME_ORDER_RECENTLY_LAUNCHED' },
      { status: 409, error: 'COUNCIL_ORDER_IN_FLIGHT' },
      { status: 429, error: 'TOO_MANY_PENDING_ORDERS' },
      { status: 503, error: 'ORDER_RECOVERY_UNRECORDED' },
      { status: 451, error: 'GEOFENCE_BLOCKED' },
      { status: 502, error: 'CHAIN_READ_FAILED' },
      { status: 500, error: 'CAGE_ORDER_FAILED' },
      { status: 0, error: 'HTTP_0' },
      { status: 409, error: 'NO_CAGE' },
      // the same mandate code with a status that is not the pre-flight's
      { status: 500, error: 'BUFFER_FLOOR_CROSSED' },
    ]) {
      expect(isCageVerdict(r)).toBe(false);
    }
    expect(isCageVerdict(null)).toBe(false);
  });

  it('«the same order went out» is the one a person may confirm past — old and new name', () => {
    expect(isSameOrderRecentlyLaunched({ error: 'SAME_ORDER_RECENTLY_LAUNCHED' })).toBe(true);
    expect(isSameOrderRecentlyLaunched({ error: 'COUNCIL_ORDER_IN_FLIGHT' })).toBe(true);
    expect(isSameOrderRecentlyLaunched({ error: 'TOO_MANY_PENDING_ORDERS' })).toBe(false);
    expect(isSameOrderRecentlyLaunched(undefined)).toBe(false);
  });
});

describe('describeCouncilOrderRefusal — words, never a raw code', () => {
  it('says what each operational refusal means', () => {
    expect(describeCouncilOrderRefusal({ status: 409, error: 'SAME_ORDER_RECENTLY_LAUNCHED' }, t)).toMatch(/went out a few minutes ago/);
    expect(describeCouncilOrderRefusal({ status: 429, error: 'TOO_MANY_PENDING_ORDERS' }, t)).toMatch(/too many orders waiting/);
    expect(describeCouncilOrderRefusal({ status: 503, error: 'ORDER_RECOVERY_UNRECORDED' }, t)).toMatch(/nothing was signed/);
    expect(describeCouncilOrderRefusal({ status: 451, error: 'GEOFENCE_BLOCKED' }, t)).toMatch(/region/);
  });

  it('an unknown refusal says nothing was signed — no code, no server Spanish', () => {
    const text = describeCouncilOrderRefusal({ status: 500, error: 'COUNCIL_ORDER_FAILED', detail: 'Falta ASTRYUM_CAGE_FACTORY_ADDRESS.' }, t);
    expect(text).not.toContain('COUNCIL_ORDER_FAILED');
    expect(text).not.toContain('Falta');
    expect(text).toMatch(/nothing was signed/);
  });

  it('a cage verdict keeps the detail that names the number the mandate refused', () => {
    expect(describeCouncilOrderRefusal({ status: 409, error: 'BUFFER_FLOOR_CROSSED', detail: 'liquid floor 10%' }, t)).toBe('liquid floor 10%');
  });
});

describe('what the server attached to a composed order', () => {
  it('lists every warning once, in order, and ignores what is not a string', () => {
    expect(
      councilOrderServerWarnings({ recoveryWarning: ' not recorded ', duplicateWarning: 'same order out', inFlightWarning: 'same order out', serverDelivery: { recorded: false } }),
    ).toEqual(['not recorded', 'same order out']);
    expect(councilOrderServerWarnings({ recoveryWarning: 42 })).toEqual([]);
    expect(councilOrderServerWarnings(null)).toEqual([]);
  });

  it('hands back the exit token when the server issued one', () => {
    expect(councilOrderExitToken({ exitToken: ' tok_1 ' })).toBe('tok_1');
    for (const p of [{}, { exitToken: '' }, { exitToken: 7 }, null, undefined]) expect(councilOrderExitToken(p)).toBeUndefined();
  });
});

describe('councilOrderRecoveryWarning', () => {
  it('returns the server warning when present, null otherwise', () => {
    expect(councilOrderRecoveryWarning({ recoveryWarning: '  the server could not record this order — keep this screen until it is relayed ' })).toBe(
      'the server could not record this order — keep this screen until it is relayed',
    );
    for (const p of [{}, { recoveryWarning: '' }, { recoveryWarning: 42 }, null, undefined]) {
      expect(councilOrderRecoveryWarning(p)).toBeNull();
    }
  });
});

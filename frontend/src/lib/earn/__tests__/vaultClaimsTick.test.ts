import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from '../../../components/legacy/__tests__/extractFromSource';
import {
  claimsQueueUnreadable,
  mergeClaimsTick,
  readOwnerQueue,
  type FetchLike,
  type VaultClaimEntry,
} from '../vaultClaimsTick';
import { describeRetryableRefusal } from '../../xaman/seatRefusal';

/**
 * it. 31 (b) — THE CONSUMER of `/vault-claims`: the watcher's tick, and the
 * tray's «may I go quiet?» guard, run against the exact answer it. 29 taught
 * the route to give.
 *
 * it. 29 fixed the ROUTE: a failed sweep is 502 VAULT_CLAIMS_UNREADABLE, never
 * 200 with an empty `pending`. The hook that consumes it did
 * `if (!res.ok) return null`, that owner contributed no rows, and
 * `setEntries(next)` REPLACED the list. The tray's guard knew `councilUnreadable`
 * and not the claim queue, so with no rows and no notice it printed the quiet
 * marker: «nothing waiting for you». The queued exit — shares already burned,
 * FXRP waiting — vanished exactly as before, one floor up.
 *
 * The tick is `readOwnerQueue` + `mergeClaimsTick` (lib/earn/vaultClaimsTick),
 * which the hook calls verbatim; the guard is `mayClaimNothingWaiting`, pulled
 * out of the shipping SidebarIntents.tsx and executed.
 */

const CARD = join(__dirname, '..', '..', '..', 'components', 'intents', 'SidebarIntents.tsx');
const mayClaimNothingWaiting = extract<
  (hasAnything: boolean, councilUnreadable: boolean, claimsUnreadable?: boolean) => boolean
>(
  readFileSync(CARD, 'utf8'),
  'function mayClaimNothingWaiting(hasAnything: boolean, councilUnreadable: boolean, claimsUnreadable = false): boolean {',
  'function mayClaimNothingWaiting(hasAnything, councilUnreadable, claimsUnreadable = false) {',
  'mayClaimNothingWaiting',
);

const OWNER = '0x8ba1f109551bd432803012645ac136ddd64dba72';
const OTHER = '0x1111111111111111111111111111111111111111';
const API = 'https://api.example';
const t = (s: string) => s;

/** The exact 502 body `/vault-claims` sends since it. 29. */
const REFUSAL_502 = {
  error: 'VAULT_CLAIMS_UNREADABLE',
  retryable: true,
  owner: OWNER,
  vault: 'firelight',
  detail:
    'We could not read the Firelight withdrawal queue right now (withdrawalsOf(209) did not answer). ' +
    'Anything you queued is still queued — the vault holds it for you until you claim it; this is our read ' +
    'failing, never a statement that your queue is empty. Try again in a moment.',
};

function fakeFetch(answers: Record<string, { status: number; body: unknown } | 'throw'>): FetchLike {
  return async (url: string) => {
    const owner = url.slice(url.lastIndexOf('/') + 1);
    const a = answers[owner];
    if (!a) throw new Error(`no fixture for ${owner}`);
    if (a === 'throw') throw new TypeError('Failed to fetch');
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  };
}

/** What the watcher showed on its previous tick: one claimable exit of OWNER. */
const PREV: VaultClaimEntry[] = [
  {
    vault: 'firelight',
    vaultLabel: 'stXRP',
    owner: OWNER,
    period: 223,
    queuedFxrpBase: '5000000',
    estFxrpBase: '5000000',
    claimable: true,
    claimableAt: null,
  },
];

describe('it. 31 (b) · a 502 keeps the last good list and marks the owner unreadable', () => {
  it('readOwnerQueue turns the it. 29 refusal into an UNREADABLE read — never an empty one', async () => {
    const read = await readOwnerQueue(OWNER, fakeFetch({ [OWNER]: { status: 502, body: REFUSAL_502 } }), API, {});
    expect(read.kind).toBe('unreadable');
    expect(read).toMatchObject({ owner: OWNER, status: 502, error: 'VAULT_CLAIMS_UNREADABLE' });
  });

  it('mergeClaimsTick over the previous list KEEPS the claimable row (stale) — the old tick replaced it with nothing', async () => {
    const read = await readOwnerQueue(OWNER, fakeFetch({ [OWNER]: { status: 502, body: REFUSAL_502 } }), API, {});
    const { entries, unreadable } = mergeClaimsTick(PREV, [read]);

    // Before it. 31: entries = [] (the owner contributed no rows) — the Claim
    // button went with them.
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ owner: OWNER, period: 223, claimable: true, stale: true });
    expect(unreadable).toEqual([
      { owner: OWNER, kind: 'all', status: 502, error: 'VAULT_CLAIMS_UNREADABLE', detail: expect.stringMatching(/still queued/) },
    ]);
  });

  it('and the tray may NOT say «nothing waiting» — even with an empty previous list', async () => {
    const read = await readOwnerQueue(OWNER, fakeFetch({ [OWNER]: { status: 502, body: REFUSAL_502 } }), API, {});
    // First tick ever: nothing shown before, the read refused. The old guard
    // saw `hasAnything=false, councilUnreadable=false` → quiet. Not any more.
    const { entries, unreadable } = mergeClaimsTick([], [read]);
    expect(entries).toEqual([]);
    expect(claimsQueueUnreadable(unreadable)).toBe(true);
    expect(mayClaimNothingWaiting(entries.length > 0, false, claimsQueueUnreadable(unreadable))).toBe(false);
    // CONTROL — the same guard with the queue READ and empty still goes quiet.
    expect(mayClaimNothingWaiting(false, false, false)).toBe(true);
    // And the two-argument call sites (council-only) keep their old meaning.
    expect(mayClaimNothingWaiting(false, false)).toBe(true);
    expect(mayClaimNothingWaiting(false, true)).toBe(false);
  });

  it('a network failure is an unreadable read too', async () => {
    const read = await readOwnerQueue(OWNER, fakeFetch({ [OWNER]: 'throw' }), API, {});
    expect(read.kind).toBe('unreadable');
    const { entries } = mergeClaimsTick(PREV, [read]);
    expect(entries).toHaveLength(1);
  });

  it('a 200 WITHOUT a `pending` array is not a read (the it. 29 second door) — the list is kept', async () => {
    const read = await readOwnerQueue(OWNER, fakeFetch({ [OWNER]: { status: 200, body: { owner: OWNER } } }), API, {});
    expect(read.kind).toBe('unreadable');
    expect(read).toMatchObject({ error: 'QUEUE_BODY_UNREADABLE' });
    expect(mergeClaimsTick(PREV, [read]).entries).toHaveLength(1);
  });

  it('one owner refused does not erase ANOTHER owner that answered', async () => {
    const fetch = fakeFetch({
      [OWNER]: { status: 502, body: REFUSAL_502 },
      [OTHER]: {
        status: 200,
        body: {
          owner: OTHER,
          queueRead: 'live',
          unreadablePeriods: [],
          pending: [{ period: 224, queuedFxrpBase: '1000000', estFxrpBase: '1000000', claimable: false, claimableAt: '2026-07-15T13:42:49.000Z' }],
        },
      },
    });
    const reads = await Promise.all([OWNER, OTHER].map((o) => readOwnerQueue(o, fetch, API, {})));
    const { entries, unreadable } = mergeClaimsTick(PREV, reads);
    expect(entries.map((e) => [e.owner, e.period, !!e.stale])).toEqual([
      [OWNER, 223, true],
      [OTHER, 224, false],
    ]);
    expect(unreadable.map((u) => u.owner)).toEqual([OWNER]);
  });

  it('the refusal body has a reader: the screen gets a sentence, never the code', () => {
    const v = describeRetryableRefusal({ status: 502, ...REFUSAL_502 }, t);
    expect(v).not.toBeNull();
    expect(v!.mayRetry).toBe(true);
    expect(v!.text).toContain('still queued');
    expect(v!.text).not.toContain('VAULT_CLAIMS_UNREADABLE');
  });
});

describe('it. 31 (b) · a PARTIAL sweep (200, queueRead "partial") keeps only the unread periods from the last list', () => {
  const partialBody = {
    owner: OWNER,
    queueRead: 'partial',
    unreadablePeriods: [223],
    detail: '1 of 62 withdrawal periods did not answer (223). The entries listed are real; anything queued in an unread period is still queued — we just could not see it this time.',
    pending: [{ period: 225, queuedFxrpBase: '2000000', estFxrpBase: '2000000', claimable: false, claimableAt: '2026-07-16T13:42:49.000Z' }],
  };

  it('the period that did not answer keeps its last good row; the ones that answered are fresh', async () => {
    const read = await readOwnerQueue(OWNER, fakeFetch({ [OWNER]: { status: 200, body: partialBody } }), API, {});
    expect(read.kind).toBe('partial');
    const { entries, unreadable } = mergeClaimsTick(PREV, [read]);
    expect(entries.map((e) => [e.period, !!e.stale])).toEqual([
      [223, true], // claimable first — kept from the last read
      [225, false],
    ]);
    expect(unreadable).toEqual([{ owner: OWNER, kind: 'partial', periods: [223], status: 200, error: null, detail: expect.stringMatching(/still queued/) }]);
    expect(mayClaimNothingWaiting(entries.length > 0, false, claimsQueueUnreadable(unreadable))).toBe(false);
  });

  it('a period that answered ZERO this time is NOT kept from the last list — that one was read', async () => {
    const read = await readOwnerQueue(
      OWNER,
      fakeFetch({ [OWNER]: { status: 200, body: { ...partialBody, unreadablePeriods: [200], pending: [] } } }),
      API,
      {},
    );
    // 223 answered (0 — claimed meanwhile); 200 did not. Only 200 would be kept, and PREV has no 200.
    const { entries } = mergeClaimsTick(PREV, [read]);
    expect(entries).toEqual([]);
  });

  it('CONTROL — a LIVE read replaces the owner outright, and the tray may go quiet on a genuinely empty queue', async () => {
    const read = await readOwnerQueue(
      OWNER,
      fakeFetch({ [OWNER]: { status: 200, body: { owner: OWNER, queueRead: 'live', unreadablePeriods: [], pending: [] } } }),
      API,
      {},
    );
    expect(read.kind).toBe('live');
    const { entries, unreadable } = mergeClaimsTick(PREV, [read]);
    expect(entries).toEqual([]);
    expect(unreadable).toEqual([]);
    expect(mayClaimNothingWaiting(false, false, claimsQueueUnreadable(unreadable))).toBe(true);
  });
});

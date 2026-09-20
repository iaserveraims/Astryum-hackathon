/**
 * ONE unread period is not 62 unread periods (the sweep), and a claim
 * reads ONLY its own period (the scope).
 */
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({ getHttpProvider: () => ({}) }),
  },
}));

const STXRP = '0x4C18Ff3C89632c3Dd62E796c0aFA5c07c4c1B2b3';
const WALLET = '0x000000000000000000000000000000000000abcd';

/** The vault's queue as the fake node serves it. */
const state: {
  currentPeriod: bigint;
  queued: Record<number, bigint>;
  /** Periods whose `withdrawalsOf` answers 429. */
  down: Set<number>;
  /** `currentPeriod()` itself does not answer. */
  anchorDown: boolean;
  calls: number[];
} = { currentPeriod: 224n, queued: {}, down: new Set(), anchorDown: false, calls: [] };

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      if (address.toLowerCase() !== STXRP.toLowerCase()) return;
      this.currentPeriod = async () => {
        if (state.anchorDown) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
        return state.currentPeriod;
      };
      this.currentPeriodEnd = async () => 1_784_122_969n;
      this.nextPeriodEnd = async () => 1_784_209_369n;
      this.withdrawalsOf = async (period: bigint) => {
        const p = Number(period);
        state.calls.push(p);
        if (state.down.has(p)) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
        return state.queued[p] ?? 0n;
      };
      this.isWithdrawClaimed = async () => false;
      // discoverPositions reads these first (shares burned at redeem → 0).
      this.balanceOf = async () => 0n;
      this.pendingRewards = async () => 0n;
      this.convertToAssets = async (v: bigint) => v;
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

import { FirelightAdapter, VaultQueueUnreadableError } from '../FirelightAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';

beforeAll(() => {
  process.env.FIRELIGHT_STXRP = STXRP;
  process.env.FIRELIGHT_STAKING = STXRP;
  resetAddressCache();
});

afterAll(() => {
  delete process.env.FIRELIGHT_STXRP;
  delete process.env.FIRELIGHT_STAKING;
  resetAddressCache();
});

beforeEach(() => {
  state.currentPeriod = 224n;
  state.queued = {};
  state.down = new Set();
  state.anchorDown = false;
  state.calls = [];
});

describe('The sweep marks the unread period instead of taking the other 61 down', () => {
  it('a 429 on the 17th slot of the sweep returns the other 61 and names that period as unread', async () => {
    // Two real exits: one already claimable (223), one still running (224).
    state.queued[223] = 5_000_000n;
    state.queued[224] = 2_000_000n;
    // The frame is currentPeriod+1 … currentPeriod-60 = 62 periods, newest
    // first; its 17th slot is period 209. That one 429s.
    const SLOT_17 = 225 - 16;
    state.down.add(SLOT_17);

    const scan = await new FirelightAdapter().readPendingWithdrawals(WALLET, undefined, 60);

    expect(scan.scannedPeriods).toHaveLength(62);
    expect(scan.scannedPeriods[0]).toBe(225);
    expect(scan.scannedPeriods[16]).toBe(SLOT_17);
    expect(scan.scannedPeriods[61]).toBe(164);
    // The version threw here (VaultQueueUnreadableError(209)) and the
    // two real exits never reached anybody. Now: the 61 that answered are
    // served, the one that did not is NAMED — neither hidden nor invented.
    expect(state.calls).toHaveLength(62);
    expect(scan.pending.map((p) => p.period)).toEqual([224, 223]);
    expect(scan.pending.find((p) => p.period === 223)?.claimable).toBe(true);
    expect(scan.pending.find((p) => p.period === 224)?.claimable).toBe(false);
    expect(scan.unreadablePeriods).toEqual([SLOT_17]);
  });

  it('an unread period is not an EMPTY period: with nothing queued it still shows as unread, never as 0', async () => {
    state.down.add(200);
    const scan = await new FirelightAdapter().readPendingWithdrawals(WALLET, undefined, 60);
    expect(scan.pending).toEqual([]);
    expect(scan.unreadablePeriods).toEqual([200]);
  });

  it('when EVERY period fails the caller can tell («all unread»), and the adapter still does not invent a queue', async () => {
    for (let p = 164; p <= 225; p++) state.down.add(p);
    const scan = await new FirelightAdapter().readPendingWithdrawals(WALLET, undefined, 60);
    expect(scan.pending).toEqual([]);
    expect(scan.unreadablePeriods).toHaveLength(62);
    expect(scan.unreadablePeriods.length).toBe(scan.scannedPeriods.length);
  });

  it('only the ANCHOR (currentPeriod) still takes the read down — typed, so the route says «could not look»', async () => {
    state.anchorDown = true;
    await expect(new FirelightAdapter().readPendingWithdrawals(WALLET, undefined, 60)).rejects.toBeInstanceOf(
      VaultQueueUnreadableError,
    );
    await expect(new FirelightAdapter().readPendingWithdrawals(WALLET, undefined, 60)).rejects.toMatchObject({
      period: null,
      what: 'currentPeriod()',
    });
  });
});

describe('A claim reads ONLY its own period', () => {
  it('scope { period: 223 } issues exactly one withdrawalsOf — the 62-period sweep is not a requirement', async () => {
    state.queued[223] = 5_000_000n;
    // Every OTHER period is down: a claim of 223 must not care.
    for (let p = 164; p <= 225; p++) if (p !== 223) state.down.add(p);

    const scan = await new FirelightAdapter().readPendingWithdrawals(WALLET, undefined, { period: 223 });

    expect(state.calls).toEqual([223]);
    expect(scan.scannedPeriods).toEqual([223]);
    expect(scan.unreadablePeriods).toEqual([]);
    expect(scan.pending).toHaveLength(1);
    expect(scan.pending[0]).toMatchObject({ period: 223, queuedFxrpBase: '5000000', claimable: true });
  });

  it('and when ITS period is the one that fails, it says so — never «nothing queued»', async () => {
    state.down.add(223);
    const scan = await new FirelightAdapter().readPendingWithdrawals(WALLET, undefined, { period: 223 });
    expect(scan.pending).toEqual([]);
    expect(scan.unreadablePeriods).toEqual([223]);
  });
});

describe('The dashboard sweep (discoverPositions) still drops the adapter on an unread slot — and names it', () => {
  it('a 429 inside the 8-period lookback rises as FIRELIGHT_QUEUE_UNREADABLE (the engine names the adapter to the person)', async () => {
    state.down.add(220);
    const a = new FirelightAdapter();
    // stXRP balance / pendingRewards are read through the same fake (0n).
    await expect(a.discoverPositions(WALLET)).rejects.toThrow(/FIRELIGHT_QUEUE_UNREADABLE/);
    await expect(a.discoverPositions(WALLET)).rejects.toThrow(/withdrawalsOf\(220\)/);
  });
});

/**
 * The BOARD survives one unread period too. Saved
 * the sidebar (`readPendingWithdrawals` marks the slot); the board still read
 * `discoverPositions`, which threw on the mark, and the CLAIM row of the
 * period that HAD answered vanished with its Claim button. The route and the
 * engine read `discoverPositionsPartial` now: the row is served, the unread
 * period is named.
 */
describe('ola 0 · discoverPositionsPartial serves the readable CLAIM and names the unread period', () => {
  it('period 223 queued and readable, period 220 down → one CLAIM row + unreadable withdrawalsOf(220)', async () => {
    state.queued[223] = 5_000_000n;
    state.down.add(220);
    const { positions, unreadable } = await new FirelightAdapter().discoverPositionsPartial(WALLET);
    expect(positions.map((p) => p.kind)).toEqual(['CLAIM']);
    expect((positions[0].raw as { firelightClaim: { period: number } }).firelightClaim.period).toBe(223);
    expect(positions[0].amount).toBe(5_000_000n);
    expect(unreadable).toEqual([
      expect.objectContaining({ what: 'withdrawalsOf(220)', market: STXRP }),
    ]);
  });

  it('CONTROL — every period answers → no unreadable key content', async () => {
    state.queued[223] = 5_000_000n;
    const { positions, unreadable } = await new FirelightAdapter().discoverPositionsPartial(WALLET);
    expect(positions).toHaveLength(1);
    expect(unreadable).toEqual([]);
  });
});

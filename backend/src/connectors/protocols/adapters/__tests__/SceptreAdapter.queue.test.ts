/**
 * Sceptre's unlock queue — the 14.5 days when `balanceOf` says zero and the
 * money is still yours.
 *
 * `requestUnlock(shares)` moves the shares into the contract's custody, so the
 * balance read that used to BE the whole adapter reported nothing: a wallet
 * that unstaked simply lost its position from every Astryum surface until it
 * redeemed, two weeks later. These tests pin the queue read, the claim window
 * (cooldownPeriod → +redeemPeriod → overdue) and the `stillEarning` answer.
 *
 * Semantics verified against the verified implementation source (proxy
 * 0x12e605bc… → impl 0xca0fEE77…) on 2026-08-01: `_redeem` prices the request
 * with the exchange rate at `startedAt + cooldownPeriod`, so the stake keeps
 * compounding through the cooldown and stops once it is claimable.
 */
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({ getHttpProvider: () => ({}) }),
  },
}));

const DAY = 86_400;
const COOLDOWN = 1_252_800n; // 14.5 days — live mainnet value
const REDEEM_WINDOW = 172_800n; // 2 days — live mainnet value

/** Contract state the fake ethers.Contract serves. Mutated per test. */
const state: {
  balanceOf: bigint;
  requests: Array<{ startedAt: bigint; shareAmount: bigint }>;
} = { balanceOf: 0n, requests: [] };

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class FakeContract {
    [k: string]: unknown;
    constructor() {
      this.balanceOf = async () => state.balanceOf;
      // 1 share = 1.5 FLR — the protocol's own conversion, never ours.
      this.getPooledFlrByShares = async (s: bigint) => (BigInt(s) * 3n) / 2n;
      this.getUnlockRequestCount = async () => BigInt(state.requests.length);
      this.getPaginatedUnlockRequests = async () => [
        state.requests,
        state.requests.map((_, i) => BigInt(i)),
      ];
      this.cooldownPeriod = async () => COOLDOWN;
      this.redeemPeriod = async () => REDEEM_WINDOW;
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

import { SceptreAdapter } from '../SceptreAdapter';

const WALLET = '0x000000000000000000000000000000000000abcd';
const nowSec = () => BigInt(Math.floor(Date.now() / 1000));

beforeEach(() => {
  state.balanceOf = 0n;
  state.requests = [];
});

describe('SceptreAdapter — unlock queue', () => {
  it('surfaces a cooling-down request as CLAIM, valued in FLR by the protocol', async () => {
    // Requested 1 day ago: 13.5 days of cooldown left.
    state.requests = [{ startedAt: nowSec() - BigInt(DAY), shareAmount: 10n ** 18n }];

    const positions = await new SceptreAdapter().discoverPositions(WALLET);
    expect(positions).toHaveLength(1);

    const p = positions[0];
    expect(p.kind).toBe('CLAIM');
    expect(p.amount).toBe(10n ** 18n);
    const raw = p.raw as Record<string, unknown>;
    expect(raw.exiting).toBe(true);
    expect(raw.claimable).toBe(false);
    // KEEPS compounding while it cools — the rate is taken at the cooldown end.
    expect(raw.stillEarning).toBe(true);
    expect(raw.underlying).toEqual({ symbol: 'FLR', amount: (15n * 10n ** 17n).toString(), decimals: 18 });
    // Claimable in 13.5 days, window shuts 2 days later.
    const availableAt = new Date(String(raw.availableAt)).getTime();
    const expiresAt = new Date(String(raw.expiresAt)).getTime();
    expect(availableAt - Date.now()).toBeGreaterThan(13 * DAY * 1000);
    expect(expiresAt - availableAt).toBe(Number(REDEEM_WINDOW) * 1000);
  });

  it('a request past its cooldown is claimable and no longer earning', async () => {
    state.requests = [{ startedAt: nowSec() - COOLDOWN - BigInt(DAY), shareAmount: 2n * 10n ** 18n }];

    const [p] = await new SceptreAdapter().discoverPositions(WALLET);
    const raw = p.raw as Record<string, unknown>;
    expect(raw.claimable).toBe(true);
    expect(raw.stillEarning).toBe(false);
  });

  it('an EXPIRED request still shows (overdue shares are recoverable, not lost)', async () => {
    state.requests = [
      { startedAt: nowSec() - COOLDOWN - REDEEM_WINDOW - BigInt(DAY), shareAmount: 10n ** 18n },
    ];

    const [p] = await new SceptreAdapter().discoverPositions(WALLET);
    const raw = p.raw as Record<string, unknown>;
    expect(p.kind).toBe('CLAIM');
    expect(raw.claimable).toBe(false);
    expect(raw.stillEarning).toBe(false);
    expect((raw.sceptreUnlock as { expired: boolean }).expired).toBe(true);
  });

  it('reports the staked balance AND the queue side by side', async () => {
    state.balanceOf = 5n * 10n ** 18n;
    state.requests = [{ startedAt: nowSec() - BigInt(DAY), shareAmount: 10n ** 18n }];

    const kinds = (await new SceptreAdapter().discoverPositions(WALLET)).map((p) => p.kind);
    expect(kinds).toEqual(['STAKE', 'CLAIM']);
  });

  it('no stake and no queue → no positions (one cheap count call)', async () => {
    expect(await new SceptreAdapter().discoverPositions(WALLET)).toEqual([]);
  });
});

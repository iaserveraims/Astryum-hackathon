/**
 * Upshift's epoch withdrawals — the third place a queued exit went invisible.
 *
 * `requestRedeem(shares, receiver)` (the fee-free path, used from Upshift's own
 * app) parks the shares on a future calendar-day epoch. `lpToken.balanceOf`
 * stops counting them right away, so without this read the vault position just
 * vanished until the user claimed. Shape verified against the vault impl ABI
 * (proxy 0x373D7d20… → impl 0xc689cC64…) and probed live: earnXRP
 * runs a 1-day lag, Monarq 7.
 */
jest.mock('../../../../services/FlareProvider', () => ({
  FlareProvider: {
    getInstance: () => ({ getHttpProvider: () => ({}) }),
  },
}));

const EARNXRP_VAULT = '0x373D7d201C8134D4a2f7b5c63560da217e3dEA28';
const EARNXRP_TOKEN = '0xE533E447fD7720b2F8654da2B1953Efa06b60bfA';
const WALLET = '0x000000000000000000000000000000000000abcd';

/** Epoch the vault is serving, and the shares queued per epoch day (ISO). */
const state: {
  lpBalance: bigint;
  served: [number, number, number];
  queued: Record<string, bigint>;
  /** Epoch days whose `getBurnableAmountByReceiver` answers 429. */
  down: Set<string>;
} = {
  lpBalance: 0n,
  served: [2026, 8, 1],
  queued: {},
  down: new Set(),
};

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const iso = (y: bigint, m: bigint, d: bigint) =>
    `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
  class FakeContract {
    [k: string]: unknown;
    constructor(address: string) {
      if (address.toLowerCase() === EARNXRP_TOKEN.toLowerCase()) {
        this.balanceOf = async () => state.lpBalance;
        return;
      }
      this.getSharePrice = async () => 1_010_000n; // 1.01 FXRP per share
      this.getWithdrawalEpoch = async () => [
        BigInt(state.served[0]),
        BigInt(state.served[1]),
        BigInt(state.served[2]),
        0n,
      ];
      this.lagDuration = async () => 86_400n; // earnXRP: 1 day
      this.getBurnableAmountByReceiver = async (y: bigint, m: bigint, d: bigint) => {
        if (state.down.has(iso(y, m, d))) throw new Error('could not coalesce error (eth_call: 429 Too Many Requests)');
        return state.queued[iso(y, m, d)] ?? 0n;
      };
    }
  }
  return { ...actual, ethers: { ...actual.ethers, Contract: FakeContract } };
});

import { UpshiftVaultAdapter } from '../UpshiftVaultAdapter';
import { resetAddressCache } from '../../../../config/protocolAddresses';

beforeAll(() => {
  process.env.UPSHIFT_EARNXRP_VAULT = EARNXRP_VAULT;
  process.env.UPSHIFT_EARNXRP_TOKEN = EARNXRP_TOKEN;
  delete process.env.UPSHIFT_MONARQ_VAULT;
  delete process.env.UPSHIFT_MONARQ_TOKEN;
  resetAddressCache();
});

beforeEach(() => {
  state.lpBalance = 0n;
  state.served = [2026, 8, 1];
  state.queued = {};
  state.down = new Set();
});

describe('UpshiftVaultAdapter — epoch withdrawal queue', () => {
  it('surfaces a request scheduled for TOMORROW as CLAIM, not yet claimable', async () => {
    state.queued['2026-08-02'] = 100_000_000n; // 100 shares

    const positions = await new UpshiftVaultAdapter().discoverPositions(WALLET);
    expect(positions).toHaveLength(1);

    const p = positions[0];
    expect(p.kind).toBe('CLAIM');
    expect(p.amount).toBe(100_000_000n);
    const raw = p.raw as Record<string, unknown>;
    expect(raw.exiting).toBe(true);
    expect(raw.claimable).toBe(false);
    expect(raw.availableAt).toBe('2026-08-02T00:00:00.000Z');
    // 100 shares × 1.01 = 101 FXRP waiting.
    expect(raw.underlying).toEqual({ symbol: 'XRP', amount: '101000000', decimals: 6 });
  });

  it('an epoch the vault already serves is claimable', async () => {
    state.queued['2026-08-01'] = 50_000_000n;

    const [p] = await new UpshiftVaultAdapter().discoverPositions(WALLET);
    expect((p.raw as Record<string, unknown>).claimable).toBe(true);
  });

  it('still lists an OLDER unclaimed epoch (money nobody collected)', async () => {
    state.queued['2026-07-30'] = 25_000_000n;

    const [p] = await new UpshiftVaultAdapter().discoverPositions(WALLET);
    expect(p.kind).toBe('CLAIM');
    expect((p.raw as Record<string, unknown>).claimable).toBe(true);
  });

  it('reports the vault balance AND the queued exit side by side', async () => {
    state.lpBalance = 40_000_000n;
    state.queued['2026-08-02'] = 100_000_000n;

    const kinds = (await new UpshiftVaultAdapter().discoverPositions(WALLET)).map((p) => p.kind);
    expect(kinds).toEqual(['SUPPLY', 'CLAIM']);
  });

  it('nothing held and nothing queued → no positions', async () => {
    expect(await new UpshiftVaultAdapter().discoverPositions(WALLET)).toEqual([]);
  });

  /**
   * The `.catch(() => 0n)` on `getBurnableAmountByReceiver` sat in the
   * same function where removed the one on `lagDuration`. A 429 on the
   * day that HELD the queued exit read as «nothing queued that day»: the row
   * vanished and the LP balance next to it looked complete. An unread day now
   * rises; the engine drops the adapter from THIS sweep and names it.
   */
  it('a 429 on the epoch day that holds the queued exit RISES — never «nothing queued that day»', async () => {
    state.lpBalance = 40_000_000n;
    state.queued['2026-08-02'] = 100_000_000n;
    state.down.add('2026-08-02');

    // Before: resolved to [SUPPLY] only — the 100 shares in flight gone.
    await expect(new UpshiftVaultAdapter().discoverPositions(WALLET)).rejects.toThrow(/UPSHIFT_QUEUE_UNREADABLE/);
  });

  it('CONTROL — with every day answering, the same fixture lists SUPPLY and CLAIM', async () => {
    state.lpBalance = 40_000_000n;
    state.queued['2026-08-02'] = 100_000_000n;
    const kinds = (await new UpshiftVaultAdapter().discoverPositions(WALLET)).map((p) => p.kind);
    expect(kinds).toEqual(['SUPPLY', 'CLAIM']);
  });
});

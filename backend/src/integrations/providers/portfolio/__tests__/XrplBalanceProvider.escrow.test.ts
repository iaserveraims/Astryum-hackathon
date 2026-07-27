/**
 * B.1a — escrows reach the dashboard: XrplBalanceProvider emits claimable
 * escrows as kind 'locked' (owned, not spendable, NOT idle, NOT earning).
 */
import { xrplBalanceProvider } from '../XrplBalanceProvider';
import { xrplProvider } from '../../chain/XRPLProvider';
import type { CanonicalPosition } from '../../../../canonical/types/Position';

const WALLET = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const OTHER = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';

afterEach(() => jest.restoreAllMocks());

// 100 XRP on ledger, 1 XRP locked as reserve → 99 spendable. The provider must
// count ONLY the spendable side (the reserve is protocol-locked, not capital).
function mockChain(escrows: unknown[]): void {
  jest.spyOn(xrplProvider, 'getSpendableBalance').mockResolvedValue({
    balanceXrp: 100,
    spendableXrp: 99,
    reserveXrp: 1,
    ownerCount: 0,
    nextObjectReserveXrp: 0.2,
  });
  jest.spyOn(xrplProvider, 'getTokenBalances').mockResolvedValue([]);
  jest.spyOn(xrplProvider, 'getDeFiPositions').mockResolvedValue(escrows as never);
  jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ coins: { 'coingecko:ripple': { price: 2 } } }),
  } as Response);
}

async function positions(): Promise<CanonicalPosition[]> {
  const res = await xrplBalanceProvider.call<{ walletAddress: string }, CanonicalPosition[]>(
    'portfolio.getPositions',
    { walletAddress: WALLET },
    { traceId: 't1' },
  );
  return res.data;
}

describe('XrplBalanceProvider — escrow positions (kind locked)', () => {
  it('emits a self-escrow as locked value on protocol xrpl-escrow', async () => {
    mockChain([
      {
        type: 'escrow',
        currency: 'XRP',
        balance: '25.000000',
        details: { owner: WALLET, destination: WALLET, isOutgoing: true, finishAfter: 800000000, previousTxnID: 'C'.repeat(64) },
      },
    ]);
    const all = await positions();
    const locked = all.find((p) => p.kind === 'locked');
    expect(locked).toBeDefined();
    expect(locked!.protocol).toBe('xrpl-escrow');
    expect(locked!.assets[0].amountUSD).toBe(50); // 25 XRP × $2
    // Free XRP counts the SPENDABLE side only — the ledger reserve is excluded.
    const free = all.find((p) => p.kind === 'free');
    expect(free!.assets[0].amountUSD).toBe(198); // 99 XRP × $2, not 100 × $2
  });

  it('excludes escrows committed to someone else (not this wallet’s value)', async () => {
    mockChain([
      {
        type: 'escrow',
        currency: 'XRP',
        balance: '25.000000',
        details: { owner: WALLET, destination: OTHER, isOutgoing: true, finishAfter: 800000000 },
      },
    ]);
    expect((await positions()).find((p) => p.kind === 'locked')).toBeUndefined();
  });

  it('escrow read failure degrades to balances only (never throws)', async () => {
    jest.spyOn(xrplProvider, 'getSpendableBalance').mockResolvedValue({
      balanceXrp: 100,
      spendableXrp: 99,
      reserveXrp: 1,
      ownerCount: 0,
      nextObjectReserveXrp: 0.2,
    });
    jest.spyOn(xrplProvider, 'getTokenBalances').mockResolvedValue([]);
    jest.spyOn(xrplProvider, 'getDeFiPositions').mockRejectedValue(new Error('ws down'));
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ coins: { 'coingecko:ripple': { price: 2 } } }),
    } as Response);
    const pos = await positions();
    expect(pos.find((p) => p.kind === 'free')).toBeDefined();
    expect(pos.find((p) => p.kind === 'locked')).toBeUndefined();
  });
});

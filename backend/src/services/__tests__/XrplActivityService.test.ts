/**
 * xrplTxToCanonical — the classification contract of the XRPL activity rail.
 *
 * account_tx items (both rippled api_version 1 `tx` and v2 `tx_json` shapes)
 * must map to canonical events with the right ActivityType, a real timestamp
 * (Ripple epoch → ISO), and failed/unvalidated transactions must vanish.
 */
import { xrplTxToCanonical, type AccountTxItem } from '../XrplActivityService';

const WALLET = 'rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh';
const HASH = 'A'.repeat(64);

function item(tx: Record<string, unknown>, overrides: Partial<AccountTxItem> = {}): AccountTxItem {
  return {
    tx: { hash: HASH, ledger_index: 96_000_000, date: 806_000_000, ...tx },
    meta: { TransactionResult: 'tesSUCCESS' },
    validated: true,
    ...overrides,
  };
}

describe('xrplTxToCanonical', () => {
  test.each([
    ['Payment', 'transfer', undefined],
    ['OfferCreate', 'swap', 'XRPL DEX'],
    ['AMMDeposit', 'addLiquidity', 'XRPL AMM'],
    ['AMMWithdraw', 'removeLiquidity', 'XRPL AMM'],
    ['EscrowCreate', 'supply', 'XRPL Escrow'],
    ['EscrowFinish', 'withdraw', 'XRPL Escrow'],
    ['TrustSet', 'approve', undefined],
    ['NFTokenMint', 'other', undefined],
  ])('%s → %s', (txType, expectedType, expectedProtocol) => {
    const ev = xrplTxToCanonical(WALLET, item({ TransactionType: txType }));
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe(expectedType);
    expect(ev!.protocol).toBe(expectedProtocol);
    expect(ev!.txHash).toBe(HASH);
    expect(ev!.blockNumber).toBe(96_000_000);
    expect(ev!.source.providerId).toBe('xrpl-jsonrpc');
    expect(ev!.source.trustLevel).toBe('onchain_verified');
  });

  test('converts the Ripple-epoch date to a real ISO timestamp', () => {
    const ev = xrplTxToCanonical(WALLET, item({ TransactionType: 'Payment', date: 806_000_000 }));
    // 946684800 (Ripple epoch) + 806000000 = 1752684800 → 2025-07-16T…Z
    expect(ev!.timestamp).toBe(new Date(1_752_684_800 * 1000).toISOString());
  });

  test('drops failed transactions (non-tesSUCCESS)', () => {
    const ev = xrplTxToCanonical(
      WALLET,
      item({ TransactionType: 'Payment' }, { meta: { TransactionResult: 'tecUNFUNDED_PAYMENT' } }),
    );
    expect(ev).toBeNull();
  });

  test('drops unvalidated transactions', () => {
    const ev = xrplTxToCanonical(WALLET, item({ TransactionType: 'Payment' }, { validated: false }));
    expect(ev).toBeNull();
  });

  test('handles the rippled api_version 2 shape (tx_json + item-level hash)', () => {
    const ev = xrplTxToCanonical(WALLET, {
      tx_json: { TransactionType: 'Payment', ledger_index: 96_000_001 },
      hash: HASH,
      close_time_iso: '2026-07-01T12:00:00Z',
      meta: { TransactionResult: 'tesSUCCESS' },
      validated: true,
    });
    expect(ev).not.toBeNull();
    expect(ev!.txHash).toBe(HASH);
    expect(ev!.blockNumber).toBe(96_000_001);
    expect(ev!.timestamp).toBe('2026-07-01T12:00:00.000Z');
  });
});

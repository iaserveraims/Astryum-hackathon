/**
 * LSTReceiptMap
 *
 * Maps LST protocol slug → receipt token / underlying token pair.
 * Used by the SnapshotBuilder to prevent double-counting: if a user's portfolio
 * includes stETH (receipt), the ETH that was staked should not also be counted
 * as a free balance. External portfolio providers (Zerion, DeBank) sometimes
 * return both the underlying and the receipt as separate holdings.
 *
 * Deduplication rule:
 *   If positions include a STAKE/SUPPLY entry for a receipt token (e.g. stETH),
 *   subtract that amount from any FREE position denominated in the underlying (ETH).
 *   If the free underlying is fully covered by the receipt, drop it entirely.
 */

export interface LSTPair {
  /** Symbol of the receipt token the user receives */
  receiptSymbol: string;
  /** Symbol of the underlying asset that was deposited */
  underlyingSymbol: string;
}

export const LST_RECEIPT_MAP: Record<string, LSTPair> = {
  'lido':                { receiptSymbol: 'stETH', underlyingSymbol: 'ETH' },
  'rocket-pool':         { receiptSymbol: 'rETH',  underlyingSymbol: 'ETH' },
  'sceptre-staked-flr':  { receiptSymbol: 'sFLR',  underlyingSymbol: 'FLR' },
  'ether.fi':            { receiptSymbol: 'eETH',  underlyingSymbol: 'ETH' },
};

/** All receipt symbols that represent staked underlying (used for lookups by symbol) */
export const RECEIPT_SYMBOLS = new Set(
  Object.values(LST_RECEIPT_MAP).map((p) => p.receiptSymbol.toLowerCase()),
);

/** All underlying symbols that have at least one LST receipt (used to detect candidates) */
export const LST_UNDERLYING_SYMBOLS = new Set(
  Object.values(LST_RECEIPT_MAP).map((p) => p.underlyingSymbol.toLowerCase()),
);

export interface DeduplicatablePosition {
  asset: string;   // token symbol or address
  amountUSD: number;
  kind: string;    // 'STAKE' | 'SUPPLY' | 'FREE' | ...
  protocolId?: string;
  /** `external: true` marks a row from an indexer (CoinStats/DeBank/on-chain
   *  multichain reader). Only those can be the double-count this file exists
   *  to remove — see the WARNING in deduplicateLSTPositions. */
  metadata?: Record<string, unknown>;
}

/** An indexer row, as opposed to a verified read by one of our own adapters. */
function isExternal(p: DeduplicatablePosition): boolean {
  return p.metadata?.external === true;
}

/**
 * Deduplicates LST positions from a list of portfolio positions.
 *
 * Algorithm:
 * 1. Collect total USD value locked in receipt tokens (stETH, rETH, sFLR, eETH).
 * 2. For each FREE position in a matching underlying (ETH, FLR), subtract the
 *    receipt-covered amount. If covered ≥ free amount → remove the free position.
 *    If covered < free amount → reduce free position amount (partial overlap).
 *
 * This is a best-effort heuristic for display purposes — it does not affect
 * on-chain accounting. The exact overlap depends on timing of snapshots from
 * external providers.
 *
 * WARNING — only EXTERNAL rows may be dropped (fixed 2026-08-01). Staking FLR
 * does NOT consume the FLR left in the wallet: they are two real, separate
 * balances. Applied to our own adapters this rule deleted live capital — a
 * wallet holding 1,000 FLR plus $X of sFLR had up to $X of its FREE FLR erased
 * from the dashboard, because NativeBalanceAdapter's eth_getBalance read was
 * mistaken for an indexer's duplicate of the staked underlying. Our adapters
 * read one balance each, straight from the chain; they never double-report, so
 * they are never the duplicate this function is here to remove.
 */
export function deduplicateLSTPositions<T extends DeduplicatablePosition>(
  positions: T[],
): T[] {
  // Map underlying symbol (lowercase) → total USD covered by receipt tokens
  const receiptCoverage: Record<string, number> = {};

  for (const p of positions) {
    const sym = p.asset.toLowerCase();
    // Identify if this position is a receipt token
    for (const pair of Object.values(LST_RECEIPT_MAP)) {
      if (sym === pair.receiptSymbol.toLowerCase() && (p.kind === 'STAKE' || p.kind === 'SUPPLY')) {
        const underlying = pair.underlyingSymbol.toLowerCase();
        receiptCoverage[underlying] = (receiptCoverage[underlying] ?? 0) + p.amountUSD;
        break;
      }
    }
  }

  if (Object.keys(receiptCoverage).length === 0) return positions;

  const result: T[] = [];
  for (const p of positions) {
    const sym = p.asset.toLowerCase();
    if (p.kind === 'FREE' && isExternal(p) && receiptCoverage[sym] !== undefined) {
      const covered = receiptCoverage[sym];
      if (p.amountUSD <= covered) {
        // Fully covered by receipt token(s) — omit this FREE position
        receiptCoverage[sym] -= p.amountUSD;
        continue;
      }
      // Partially covered — reduce amount to the uncovered portion
      receiptCoverage[sym] = 0;
      result.push({ ...p, amountUSD: p.amountUSD - covered });
    } else {
      result.push(p);
    }
  }

  return result;
}

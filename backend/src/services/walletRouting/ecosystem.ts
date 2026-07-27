/**
 * Ecosystem derivation — single source of truth for "what VM does this chain run?"
 *
 * Block G (2026-06-02). Astryum stores `Wallet.ecosystem` as the canonical
 * lowercase string. Pools carry `chainId` (numeric for EVM) and `chain` (CAIP-2
 * string like "eip155:1" or "solana:mainnet"). The router compares ecosystems
 * to decide between single-step and multi-step (bridge) flows.
 *
 * REGULATORY: pure logic, no I/O, no side effects. The router relies on this
 * being deterministic so audit logs are reproducible.
 */

export type Ecosystem =
  | 'evm'
  | 'solana'
  | 'xrpl'
  | 'aptos'
  | 'cosmos'
  | 'stellar'
  | 'algorand'
  | 'bitcoin';

/**
 * Derive ecosystem from a CAIP-2 chain identifier.
 * CAIP-2 format: `{namespace}:{reference}` — see https://chainagnostic.org/.
 */
export function ecosystemForCaip2(caip2: string | null | undefined): Ecosystem | null {
  if (!caip2) return null;
  const lc = caip2.toLowerCase();
  if (lc.startsWith('eip155:'))  return 'evm';
  if (lc.startsWith('solana:'))  return 'solana';
  if (lc.startsWith('xrpl:'))    return 'xrpl';
  if (lc.startsWith('aptos:'))   return 'aptos';
  if (lc.startsWith('cosmos:'))  return 'cosmos';
  if (lc.startsWith('stellar:')) return 'stellar';
  if (lc.startsWith('algorand:')) return 'algorand';
  if (lc.startsWith('bip122:'))  return 'bitcoin';
  return null;
}

/**
 * Derive ecosystem from a numeric EVM chainId. Returns 'evm' for any positive
 * chainId. Non-EVM pools always carry caip2 instead.
 */
export function ecosystemForChainId(chainId: number | null | undefined): Ecosystem | null {
  if (chainId == null) return null;
  if (chainId > 0) return 'evm';
  return null;
}

/**
 * Derive ecosystem from a pool record (uses caip2 first, falls back to chainId).
 * This is the function the router/builder will call most.
 */
export function ecosystemForPool(pool: {
  chainId: number;
  chain: string;
}): Ecosystem | null {
  return ecosystemForCaip2(pool.chain) ?? ecosystemForChainId(pool.chainId);
}

/**
 * Legacy fallback: derive ecosystem from a human network label like
 * "ethereum" / "xrpl" / "solana". Used only for backfilling pre-CAIP-2 rows.
 */
export function ecosystemFromNetworkLabel(network: string | null | undefined): Ecosystem | null {
  if (!network) return null;
  const n = network.toLowerCase();
  if (['xrpl', 'xrp', 'ripple'].includes(n)) return 'xrpl';
  if (['solana', 'sol'].includes(n)) return 'solana';
  if (n === 'aptos') return 'aptos';
  if (['stellar', 'xlm'].includes(n)) return 'stellar';
  if (['algorand', 'algo'].includes(n)) return 'algorand';
  if (['bitcoin', 'btc'].includes(n)) return 'bitcoin';
  if (['cosmos', 'osmosis'].includes(n)) return 'cosmos';
  // EVM is the default catch-all (matches the migration backfill rule).
  if (['ethereum', 'polygon', 'arbitrum', 'base', 'optimism', 'avalanche', 'bsc',
       'gnosis', 'flare', 'fantom', 'celo'].includes(n)) {
    return 'evm';
  }
  return null;
}

/** Helper: true when two ecosystems are NOT compatible (need a bridge). */
export function isCrossEcosystem(a: Ecosystem, b: Ecosystem): boolean {
  return a !== b;
}

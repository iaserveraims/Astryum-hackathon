/**
 * Verified interaction-contract addresses per (kind, chainId[, asset]).
 *
 * Why this exists: DefiLlama's public /pools endpoint returns a UUID, not a
 * contract address (see plan "Conector universal DefiLlama"). For singleton /
 * known-market protocols the interaction contract is fully determined by
 * (kind, chainId[, base asset]) — so we can resolve the address WITHOUT any
 * per-pool address from DefiLlama. This is "Tier A": no Pro key required.
 *
 * Each table is curated from official protocol deployment docs. Addresses are
 * lowercased for case-insensitive comparison. These resolve the address only —
 * they are NOT an execution allowlist (P35 is fed dynamically from resolved
 * active pools; risk is surfaced to the user, not gated here).
 */

/**
 * Compound V3 (Comet) markets — one Comet per (chain, base asset symbol).
 * Curated conservatively: only addresses verified against Compound's official
 * deployment list. A wrong Comet would silently build calldata to the wrong
 * contract, so we prefer fewer-but-correct entries; anything missing falls back
 * to the Pro `pool_old` address (Tier B) or stays inactive.
 */
const COMPOUND_V3_COMET: Readonly<Record<number, Readonly<Record<string, string>>>> = Object.freeze({
  1: {
    USDC: '0xc3d688b66703497daa19211eedff47f25384cdc3',
    WETH: '0xa17581a9e3356d9a858b789d68b4d866e593ae94',
    USDT: '0x3afdc9bca9213a35503b077a6072f3d0d5ab0840',
  },
  8453: {
    USDC:  '0xb125e6687d4313864e53df431d5425969c15eb2f',
    USDBC: '0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf',
  },
  42161: {
    USDC:    '0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf',
    'USDC.E': '0xa5edbdd9646f8dff606d7448e414884c7d905dca',
  },
  137: {
    USDC: '0xf25212e676d1f7f89cd72ffee66158f541246445',
  },
});

/** Lido stETH — submit() entrypoint. Ethereum-only. */
const LIDO_STETH: Readonly<Record<number, string>> = Object.freeze({
  1: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
});

/** Sceptre sFLR ERC-4626 vault on Flare. Env-overridable. */
const SCEPTRE_SFLR: Readonly<Record<number, string>> = Object.freeze({
  14: (process.env.SCEPTRE_SFLR_ADDRESS ?? '0x12e605bc104e93b45e1ad99f9e555f659051c2bb').toLowerCase(),
});

/** Spark Pool (Aave V3 fork — its OWN pool address, distinct from Aave's). */
const SPARK_POOL: Readonly<Record<number, string>> = Object.freeze({
  1:   '0xc13e21b648a5ee794902342038ff3adab66be987', // Ethereum
  100: '0x2dae5307c5e3fd1cf5a72cb6f698f915860607e0', // Gnosis
});

const isAddr = (s: string | undefined): s is string =>
  typeof s === 'string' && /^0x[a-f0-9]{40}$/.test(s);

/** Compound V3 Comet for (chainId, base asset symbol). Symbol matched case-insensitively. */
export function compoundV3CometFor(chainId: number, symbol: string): string | null {
  const byAsset = COMPOUND_V3_COMET[chainId];
  if (!byAsset) return null;
  // DefiLlama symbol for a Comet market is the base asset (e.g. "USDC").
  const key = symbol.trim().toUpperCase();
  const hit = byAsset[key] ?? byAsset[key.replace(/\s+/g, '')];
  return isAddr(hit) ? hit : null;
}

export function lidoStethFor(chainId: number): string | null {
  const a = LIDO_STETH[chainId];
  return isAddr(a) ? a : null;
}

export function sceptreFor(chainId: number): string | null {
  const a = SCEPTRE_SFLR[chainId];
  return isAddr(a) ? a : null;
}

export function sparkPoolFor(chainId: number): string | null {
  const a = SPARK_POOL[chainId];
  return isAddr(a) ? a : null;
}

/** True when a string is a valid lowercased-or-mixed EVM address. */
export function isEvmAddress(s: string | null | undefined): boolean {
  return typeof s === 'string' && /^0x[a-fA-F0-9]{40}$/.test(s);
}

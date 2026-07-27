import { ethers } from 'ethers';

// Per-chain explicit RPC overrides. Flare always has a default.
const EXPLICIT_RPCS: Record<number, string | undefined> = {
  14:    process.env.FLARE_RPC_HTTP    || 'https://flare-api.flare.network/ext/C/rpc',
  1:     process.env.ETHEREUM_RPC_URL,
  137:   process.env.POLYGON_RPC_URL,
  42161: process.env.ARBITRUM_RPC_URL,
  8453:  process.env.BASE_RPC_URL,
  10:    process.env.OPTIMISM_RPC_URL,
};

// Alchemy slug per chainId. Used as fallback when no explicit env var is set.
const ALCHEMY_SLUGS: Record<number, string> = {
  1:     'eth-mainnet',
  137:   'polygon-mainnet',
  42161: 'arb-mainnet',
  8453:  'base-mainnet',
  10:    'opt-mainnet',
  43114: 'avax-mainnet',
  56:    'bnb-mainnet',
};

const CHAIN_NAMES: Record<number, string> = {
  14:    'Flare',
  1:     'Ethereum',
  137:   'Polygon',
  42161: 'Arbitrum',
  8453:  'Base',
  10:    'Optimism',
  43114: 'Avalanche',
  56:    'BSC',
};

const CHAIN_ENV_KEYS: Record<number, string> = {
  1:     'ETHEREUM_RPC_URL',
  137:   'POLYGON_RPC_URL',
  42161: 'ARBITRUM_RPC_URL',
  8453:  'BASE_RPC_URL',
  10:    'OPTIMISM_RPC_URL',
};

/**
 * Returns a JsonRpcProvider for the given chainId.
 * Resolution order:
 *   1. Explicit per-chain env var (ETHEREUM_RPC_URL, POLYGON_RPC_URL, etc.)
 *   2. Alchemy fallback if ALCHEMY_API_KEY is set and chain is supported
 *   3. Throws UNSUPPORTED_CHAIN
 *
 * Flare (14) always uses the public RPC — never Alchemy.
 * BROADCAST_FORBIDDEN: this provider is read-only. Do NOT use for sendTransaction.
 */
export function getRpcForChain(chainId: number): ethers.JsonRpcProvider {
  const explicit = EXPLICIT_RPCS[chainId];
  if (explicit) return new ethers.JsonRpcProvider(explicit);

  // Alchemy fallback for known EVM chains (not Flare)
  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const alchemySlug = ALCHEMY_SLUGS[chainId];
  if (alchemyKey && alchemySlug) {
    return new ethers.JsonRpcProvider(`https://${alchemySlug}.g.alchemy.com/v2/${alchemyKey}`);
  }

  const name = CHAIN_NAMES[chainId];
  const envKey = CHAIN_ENV_KEYS[chainId];
  const hint = envKey ? ` (set ${envKey} or ALCHEMY_API_KEY)` : '';
  throw new Error(`UNSUPPORTED_CHAIN:${chainId}${name ? ` (${name})` : ''}${hint}`);
}

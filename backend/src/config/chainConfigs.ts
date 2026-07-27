/**
 * Chain Configurations for Astryum
 * FLARE EVM MAINNET ONLY - Private Beta
 *
 * NO testnet, NO other chains
 */

export interface ChainConfig {
  chainId: number;
  name: string;
  network: string;
  rpcHttp: string;
  rpcWs: string;
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  isMainnet: boolean;
}

// ONLY Flare Mainnet - No fallbacks
export const FLARE_MAINNET: ChainConfig = {
  chainId: 14,
  name: 'Flare Mainnet',
  network: 'flare',
  rpcHttp: process.env.FLARE_RPC_HTTP || 'https://flare-api.flare.network/ext/C/rpc',
  rpcWs: process.env.FLARE_RPC_WS || 'wss://flare-api.flare.network/ext/C/ws',
  blockExplorer: 'https://flare-explorer.flare.network',
  nativeCurrency: {
    name: 'Flare',
    symbol: 'FLR',
    decimals: 18,
  },
  isMainnet: true,
};

// Active chain configuration - ONLY Flare Mainnet
export const ACTIVE_CHAIN = FLARE_MAINNET;

// Supported chains map - ONLY contains Flare Mainnet
export const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  [FLARE_MAINNET.chainId]: FLARE_MAINNET,
};

// Validation: Ensure we're on mainnet
export function validateMainnetOnly(): void {
  if (!ACTIVE_CHAIN.isMainnet) {
    throw new Error('CRITICAL: Astryum Private Beta requires Flare Mainnet. Testnet is not allowed.');
  }

  if (ACTIVE_CHAIN.chainId !== 14) {
    throw new Error(`CRITICAL: Invalid chain ID. Expected 14 (Flare Mainnet), got ${ACTIVE_CHAIN.chainId}`);
  }
}

// Get chain config by ID
export function getChainConfig(chainId: number): ChainConfig | undefined {
  return SUPPORTED_CHAINS[chainId];
}

// Check if chain is supported
export function isChainSupported(chainId: number): boolean {
  return chainId === FLARE_MAINNET.chainId;
}

// Contract addresses on Flare Mainnet
export const FLARE_CONTRACTS = {
  // Native wrapped token
  WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',

  // FTSO (Flare Time Series Oracle)
  ftso: {
    priceSubmitter: '0x1000000000000000000000000000000000000003',
    ftsoManager: '0x1000000000000000000000000000000000000005',
    ftsoRegistry: '0x1000000000000000000000000000000000000006',
  },

  // Flare Finance - Add real addresses when available
  flareFinance: {
    lendingPool: '', // TODO: Add real address
    priceOracle: '', // TODO: Add real address
  },

  // SparkDex - Add real addresses when available
  sparkdex: {
    router: '', // TODO: Add real address
    factory: '', // TODO: Add real address
  },

  // Tokens
  tokens: {
    WFLR: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d',
    // FXRP and other tokens - add when available
  },
};

export default {
  FLARE_MAINNET,
  ACTIVE_CHAIN,
  SUPPORTED_CHAINS,
  FLARE_CONTRACTS,
  validateMainnetOnly,
  getChainConfig,
  isChainSupported,
};

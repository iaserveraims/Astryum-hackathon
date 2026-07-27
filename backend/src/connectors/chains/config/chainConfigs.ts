/**
 * Chain Configuration Registry
 *
 * Centralized configuration for all supported blockchain networks.
 * Used by protocol connectors, wallet adapters, and bridge services.
 *
 * ARCHIVED 2026-02-02: Non-Flare chains have been archived during Flare-exclusive migration.
 * Previously supported: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, XRPL, Aptos, Axelar, Avalanche
 * Full backup available in: _archived/2026-02-02-pre-flare-migration/config/chainConfigs.ts.full-backup
 *
 * @module chainConfigs
 */

export interface ChainConfig {
  /** Unique chain identifier */
  id: string;

  /** Human-readable chain name */
  name: string;

  /** Chain type */
  type: 'evm' | 'xrpl' | 'aptos' | 'cosmos' | 'other';

  /** Numeric chain ID (for EVM chains) */
  chainId?: number;

  /** Native currency symbol */
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };

  /** RPC endpoints */
  rpcUrls: {
    default: string;
    public?: string[];
    websocket?: string;
  };

  /** Block explorers */
  blockExplorers: {
    default: {
      name: string;
      url: string;
      apiUrl?: string;
    };
  };

  /** Testnet configuration (if available) */
  testnet?: {
    name: string;
    chainId?: number;
    rpcUrls: {
      default: string;
      public?: string[];
    };
    blockExplorer?: string;
    faucet?: string;
  };

  /** Network status */
  isTestnet: boolean;

  /** Additional metadata */
  metadata?: {
    /** Average block time in seconds */
    avgBlockTime?: number;
    /** Consensus mechanism */
    consensus?: string;
    /** Layer type (L1, L2, sidechain) */
    layer?: string;
    /** Parent chain (for L2s) */
    parentChain?: string;
  };
}

/**
 * All supported chain configurations
 *
 * FLARE-EXCLUSIVE: Astryum now supports only Flare Network ecosystem.
 * Access to XRPL and other chains is via Flare's interoperability layer.
 */
export const CHAIN_CONFIGS: Record<string, ChainConfig> = {

  // ============================================
  // FLARE NETWORK ECOSYSTEM (EXCLUSIVE)
  // ============================================

  flare: {
    id: 'flare',
    name: 'Flare Network',
    type: 'evm',
    chainId: 14,
    nativeCurrency: {
      name: 'Flare',
      symbol: 'FLR',
      decimals: 18
    },
    rpcUrls: {
      default: process.env.FLARE_RPC_URL || 'https://flare-api.flare.network/ext/C/rpc',
      public: [
        'https://flare-api.flare.network/ext/C/rpc',
        'https://flare.rpc.thirdweb.com'
      ],
      websocket: 'wss://flare-api.flare.network/ext/bc/C/ws'
    },
    blockExplorers: {
      default: {
        name: 'Flare Explorer',
        url: 'https://flarescan.com',
        apiUrl: 'https://flare-explorer.flare.network/api'
      }
    },
    testnet: {
      name: 'Coston2 Testnet',
      chainId: 114,
      rpcUrls: {
        default: 'https://coston2-api.flare.network/ext/C/rpc',
        public: ['https://coston2-api.flare.network/ext/C/rpc']
      },
      blockExplorer: 'https://coston2-explorer.flare.network',
      faucet: 'https://faucet.flare.network'
    },
    isTestnet: false,
    metadata: {
      avgBlockTime: 2,
      consensus: 'Avalanche Consensus',
      layer: 'L1'
    }
  },

  songbird: {
    id: 'songbird',
    name: 'Songbird Network',
    type: 'evm',
    chainId: 19,
    nativeCurrency: {
      name: 'Songbird',
      symbol: 'SGB',
      decimals: 18
    },
    rpcUrls: {
      default: process.env.SONGBIRD_RPC_URL || 'https://songbird-api.flare.network/ext/C/rpc',
      public: [
        'https://songbird-api.flare.network/ext/C/rpc',
        'https://sgb.ftso.com.au/ext/bc/C/rpc'
      ],
      websocket: 'wss://songbird-api.flare.network/ext/bc/C/ws'
    },
    blockExplorers: {
      default: {
        name: 'Songbird Explorer',
        url: 'https://songbird-explorer.flare.network',
        apiUrl: 'https://songbird-explorer.flare.network/api'
      }
    },
    testnet: {
      name: 'Coston Testnet',
      chainId: 16,
      rpcUrls: {
        default: 'https://coston-api.flare.network/ext/C/rpc',
        public: ['https://coston-api.flare.network/ext/C/rpc']
      },
      blockExplorer: 'https://coston-explorer.flare.network',
      faucet: 'https://faucet.towolabs.com'
    },
    isTestnet: false,
    metadata: {
      avgBlockTime: 2,
      consensus: 'Avalanche Consensus',
      layer: 'L1'
    }
  }

};

/**
 * Get chain configuration by ID
 */
export function getChainConfig(chainId: string): ChainConfig | undefined {
  return CHAIN_CONFIGS[chainId];
}

/**
 * Get all EVM-compatible chains
 */
export function getEVMChains(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS).filter(chain => chain.type === 'evm');
}

/**
 * Get chain by numeric chain ID (EVM only)
 */
export function getChainByChainId(chainId: number): ChainConfig | undefined {
  return Object.values(CHAIN_CONFIGS).find(chain => chain.chainId === chainId);
}

/**
 * Get all mainnet chains
 */
export function getMainnetChains(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS).filter(chain => !chain.isTestnet);
}

/**
 * Check if chain is supported
 */
export function isChainSupported(chainId: string): boolean {
  return chainId in CHAIN_CONFIGS;
}

/**
 * Get chain name by ID
 */
export function getChainName(chainId: string): string {
  return CHAIN_CONFIGS[chainId]?.name || 'Unknown Chain';
}

/**
 * Get native currency symbol
 */
export function getNativeCurrency(chainId: string): string {
  return CHAIN_CONFIGS[chainId]?.nativeCurrency.symbol || 'FLR';
}

/**
 * Export chain IDs as constants for easy import
 *
 * ARCHIVED 2026-02-02: Legacy chain IDs removed (XRPL, APTOS, ETHEREUM, BSC, POLYGON, ARBITRUM, OPTIMISM, BASE, AXELAR, AVALANCHE)
 */
export const CHAIN_IDS = {
  FLARE: 'flare',
  SONGBIRD: 'songbird'
} as const;

export type ChainId = typeof CHAIN_IDS[keyof typeof CHAIN_IDS];

/**
 * FTSO Constants and Contract Addresses
 * Flare Time Series Oracle configuration for Flare and Songbird networks
 */

/**
 * FlareContractRegistry — entry point for FTSOv2 contract discovery.
 * Same address on Flare, Songbird and Coston. We resolve `FtsoV2` from here at
 * runtime instead of hardcoding it (Flare upgrades the impl periodically).
 */
export const FLARE_CONTRACT_REGISTRY = '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019';

/**
 * FTSO Contract Addresses by Network
 *
 * NOTE: post-FTSOv2 (Aug 2024) the v1 voterWhitelister/ftsoManager/priceSubmitter
 * are still deployed but `getFtsoWhitelistedPriceProviders` and friends revert.
 * We keep the addresses for reference/legacy reads but FTSOClient now uses
 * FtsoV2 (resolved via FlareContractRegistry) for all live price reads.
 */
export const FTSO_CONTRACTS = {
  flare: {
    // Main FTSO Registry - entry point for all FTSO operations
    ftsoRegistry: '0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019',

    // Price Submitter Contract - used by data providers
    priceSubmitter: '0x1000000000000000000000000000000000000003',

    // Voter Whitelister - manages data provider whitelist
    voterWhitelister: '0xa76906EfBA6dFAe155FfC4c0eb36cDF0A28ae24D',

    // FTSO Manager - orchestrates price epochs
    ftsoManager: '0xbfA12e4E1411B62EdA8B035d71735667422A6A9e',

    // FTSO Reward Manager - handles reward distribution
    ftsoRewardManager: '0xc5738334b972745067fFa666040fdeADc66Cb925',

    // WNat Token - Wrapped native token for delegation
    wNat: '0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d'
  },
  songbird: {
    // Songbird testnet addresses
    ftsoRegistry: '0x6D222fb4544ba230d4b90BA1BfC0A01A94E6cB23',
    priceSubmitter: '0x1000000000000000000000000000000000000003',
    voterWhitelister: '0xa76906EfBA6dFAe155FfC4c0eb36cDF0A28ae24D',
    ftsoManager: '0xbfA12e4E1411B62EdA8B035d71735667422A6A9e',
    ftsoRewardManager: '0xc5738334b972745067fFa666040fdeADc66Cb925',
    wNat: '0x02f0826ef6aD107Cfc861152B32B52fD11BaB9ED'
  },
  coston: {
    // Coston testnet (for development)
    ftsoRegistry: '0x6D222fb4544ba230d4b90BA1BfC0A01A94E6cB23',
    priceSubmitter: '0x1000000000000000000000000000000000000003',
    voterWhitelister: '0xa76906EfBA6dFAe155FfC4c0eb36cDF0A28ae24D',
    ftsoManager: '0xbfA12e4E1411B62EdA8B035d71735667422A6A9e',
    ftsoRewardManager: '0xc5738334b972745067fFa666040fdeADc66Cb925',
    wNat: '0x767b25A658E8FC8ab6eBbd52043495dB61b4ea91'
  }
} as const;

/**
 * Supported FTSO Asset Symbols
 * These assets have active price feeds on Flare/Songbird
 */
export const FTSO_SYMBOLS = [
  // Native tokens
  'FLR',    // Flare
  'SGB',    // Songbird

  // Major cryptocurrencies
  'BTC',    // Bitcoin
  'ETH',    // Ethereum
  'XRP',    // Ripple
  'LTC',    // Litecoin
  'DOGE',   // Dogecoin
  'ADA',    // Cardano
  'ALGO',   // Algorand
  'BCH',    // Bitcoin Cash
  'DGB',    // DigiByte
  'DOT',    // Polkadot
  'FIL',    // Filecoin
  'SOL',    // Solana
  'AVAX',   // Avalanche
  'MATIC',  // Polygon
  'ARB',    // Arbitrum
  'BNB',    // Binance Coin

  // Layer 2 / Alternative chains
  'XLM',    // Stellar
  'XDC',    // XDC Network

  // Stablecoins
  'USDC',   // USD Coin
  'USDT',   // Tether

  // Fiat currencies
  'USD',    // US Dollar
  'EUR',    // Euro
  'GBP',    // British Pound
  'JPY',    // Japanese Yen
  'KRW',    // Korean Won
  'XAU',    // Gold (Troy Ounce)
  'XAG'     // Silver (Troy Ounce)
] as const;

/**
 * FTSO symbol type for type safety
 */
export type FTSOSymbol = typeof FTSO_SYMBOLS[number];

/**
 * FTSO Update Intervals and Timing Constants
 */
export const FTSO_TIMING = {
  // Standard FTSO price epoch duration (90 seconds)
  UPDATE_INTERVAL: 90000,

  // Price reveal period within epoch (30 seconds)
  REVEAL_PERIOD: 30000,

  // Maximum acceptable price age before considering stale (3 minutes)
  MAX_PRICE_AGE: 180,

  // Warning threshold for price age (2 minutes)
  PRICE_AGE_WARNING: 120,

  // Default cache TTL for price data (30 seconds)
  DEFAULT_CACHE_TTL: 30,

  // Provider statistics refresh interval (5 minutes)
  PROVIDER_STATS_REFRESH: 300000,

  // Historical data retention period (30 days)
  HISTORICAL_RETENTION_DAYS: 30
} as const;

/**
 * Price Movement Thresholds for Significant Move Detection
 */
export const PRICE_MOVEMENT_THRESHOLDS = {
  // Minor movement threshold (1%)
  MINOR: 1,

  // Moderate movement threshold (5%)
  MODERATE: 5,

  // Major movement threshold (10%)
  MAJOR: 10,

  // Extreme movement threshold (20%)
  EXTREME: 20
} as const;

/**
 * Network RPC URLs
 */
export const NETWORK_RPC_URLS = {
  flare: {
    default: 'https://flare-api.flare.network/ext/C/rpc',
    backup: [
      'https://flare.rpc.thirdweb.com',
      'https://rpc.ankr.com/flare'
    ]
  },
  songbird: {
    default: 'https://songbird-api.flare.network/ext/C/rpc',
    backup: [
      'https://songbird.rpc.thirdweb.com'
    ]
  },
  coston: {
    default: 'https://coston-api.flare.network/ext/C/rpc',
    backup: []
  }
} as const;

/**
 * Network Chain IDs
 */
export const NETWORK_CHAIN_IDS = {
  flare: 14,
  songbird: 19,
  coston: 16
} as const;

/**
 * FTSO Decimals Configuration
 * Standard decimals used by FTSO price feeds
 */
export const FTSO_DECIMALS = {
  // Default price decimals (5 decimals = $0.00001 precision)
  DEFAULT: 5,

  // USD price pairs typically use 5 decimals
  USD: 5,

  // Crypto pairs typically use 5 decimals
  CRYPTO: 5,

  // Fiat pairs typically use 5 decimals
  FIAT: 5
} as const;

/**
 * Data Provider Reliability Thresholds
 */
export const PROVIDER_RELIABILITY = {
  // Excellent provider (>95% success rate)
  EXCELLENT: 95,

  // Good provider (>85% success rate)
  GOOD: 85,

  // Average provider (>70% success rate)
  AVERAGE: 70,

  // Poor provider (<70% success rate)
  POOR: 70,

  // Minimum acceptable reliability for consideration
  MINIMUM: 50
} as const;

/**
 * Rate Limiting Configuration
 */
export const RATE_LIMITS = {
  // Max RPC calls per second
  RPC_CALLS_PER_SECOND: 10,

  // Max concurrent RPC calls
  MAX_CONCURRENT_CALLS: 5,

  // Request timeout in milliseconds
  REQUEST_TIMEOUT: 10000,

  // Retry attempts for failed requests
  MAX_RETRIES: 3,

  // Retry delay in milliseconds
  RETRY_DELAY: 1000
} as const;

/**
 * Gas Estimation Constants
 */
export const GAS_ESTIMATES = {
  // Estimated gas for price query
  PRICE_QUERY: 50000,

  // Estimated gas for batch price query
  BATCH_QUERY: 100000,

  // Estimated gas for provider data query
  PROVIDER_QUERY: 80000
} as const;

/**
 * InfluxDB Measurement Names
 */
export const INFLUXDB_MEASUREMENTS = {
  // FTSO price data time-series
  FTSO_PRICES: 'ftso_prices',

  // Data provider statistics
  PROVIDER_STATS: 'ftso_provider_stats',

  // Price movements and alerts
  PRICE_MOVEMENTS: 'ftso_price_movements',

  // System health metrics
  SYSTEM_HEALTH: 'ftso_system_health'
} as const;

/**
 * Redis Key Prefixes
 */
export const REDIS_KEY_PREFIXES = {
  // Price cache keys
  PRICE: 'ftso:price:',

  // Provider cache keys
  PROVIDER: 'ftso:provider:',

  // Registry cache keys
  REGISTRY: 'ftso:registry:',

  // Symbol list cache
  SYMBOLS: 'ftso:symbols',

  // Lock keys for concurrent access control
  LOCK: 'ftso:lock:'
} as const;

/**
 * WebSocket Event Names for FTSO
 */
export const FTSO_WS_EVENTS = {
  // Price update event
  PRICE_UPDATE: 'ftso:priceUpdate',

  // Significant price movement
  SIGNIFICANT_MOVE: 'ftso:significantMove',

  // Stale price warning
  STALE_PRICE: 'ftso:stalePrice',

  // Provider status change
  PROVIDER_UPDATE: 'ftso:providerUpdate',

  // Subscribe to price updates
  SUBSCRIBE: 'ftso:subscribe',

  // Unsubscribe from price updates
  UNSUBSCRIBE: 'ftso:unsubscribe',

  // Error event
  ERROR: 'ftso:error'
} as const;

/**
 * FTSOv2 feed-id category bytes.
 * https://dev.flare.network/ftso/feeds/ — the first byte of the bytes21 feed id
 * encodes the asset class.
 */
export const FEED_CATEGORY = {
  CRYPTO: 0x01,
  FOREX: 0x02,
  COMMODITY: 0x03,
} as const;

const FOREX_SYMBOLS = new Set(['EUR', 'GBP', 'JPY', 'KRW']);
const COMMODITY_SYMBOLS = new Set(['XAU', 'XAG']);

/**
 * Build a bytes21 FTSOv2 feed id from a symbol.
 * Layout: 1 byte category + 20 bytes ASCII of "<SYM>/USD" right-padded with 0x00.
 *
 * Example: FLR → 0x01464c522f55534400000000000000000000000000
 */
export function getFeedId(symbol: string): string {
  let category: number;
  if (FOREX_SYMBOLS.has(symbol)) category = FEED_CATEGORY.FOREX;
  else if (COMMODITY_SYMBOLS.has(symbol)) category = FEED_CATEGORY.COMMODITY;
  else category = FEED_CATEGORY.CRYPTO;

  const feedName = `${symbol}/USD`;
  const nameHex = Buffer.from(feedName, 'utf8').toString('hex').padEnd(40, '0');
  return '0x' + category.toString(16).padStart(2, '0') + nameHex;
}

/**
 * Helper function to validate FTSO symbol
 */
export function isValidFTSOSymbol(symbol: string): symbol is FTSOSymbol {
  return FTSO_SYMBOLS.includes(symbol as FTSOSymbol);
}

/**
 * Helper function to get network configuration
 */
export function getNetworkConfig(network: 'flare' | 'songbird' | 'coston') {
  return {
    contracts: FTSO_CONTRACTS[network],
    chainId: NETWORK_CHAIN_IDS[network],
    rpcUrls: NETWORK_RPC_URLS[network]
  };
}

/**
 * Helper function to format price with correct decimals
 */
export function formatPrice(price: bigint, decimals: number = FTSO_DECIMALS.DEFAULT): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = price / divisor;
  const fractionalPart = price % divisor;

  return `${wholePart}.${fractionalPart.toString().padStart(decimals, '0')}`;
}

/**
 * Helper function to check if price is stale
 */
export function isPriceStale(timestamp: number, maxAge: number = FTSO_TIMING.MAX_PRICE_AGE): boolean {
  const age = Math.floor(Date.now() / 1000) - timestamp;
  return age > maxAge;
}

/**
 * Helper function to calculate price change percentage
 */
export function calculatePriceChange(oldPrice: string, newPrice: string): number {
  const old = parseFloat(oldPrice);
  const current = parseFloat(newPrice);

  if (old === 0) return 0;

  return ((current - old) / old) * 100;
}

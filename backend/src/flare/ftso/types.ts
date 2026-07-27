/**
 * FTSO (Flare Time Series Oracle) Type Definitions
 * Types for Flare Network's decentralized oracle system
 */

/**
 * FTSO Price data with freshness validation
 */
export interface FTSOPrice {
  /** Asset symbol (e.g., FLR, XRP, BTC) */
  symbol: string;

  /** Price as BigNumber string to preserve precision */
  price: string;

  /** Number of decimals in the price */
  decimals: number;

  /** Unix timestamp when price was finalized */
  timestamp: number;

  /** Finalization type (0 = weighted median) */
  finalizationType: number;

  /** Last update date */
  lastUpdate: Date;

  /** Age in seconds since last update */
  age: number;

  /** Price freshness indicator (age < 180 seconds) */
  isFresh: boolean;

  /** Price in USD (computed) */
  priceUSD?: string;

  /** Current epoch ID */
  epochId?: number;
}

/**
 * FTSO Data Provider information
 */
export interface DataProvider {
  /** Provider Ethereum address */
  address: string;

  /** Provider name (if registered) */
  name?: string;

  /** Total vote power as BigNumber string */
  votePower: string;

  /** Vote power as percentage of total */
  votePowerPercentage: number;

  /** Reward rate (0-1) */
  rewardRate: number;

  /** Reliability score (0-100) */
  reliability: number;

  /** Whether provider is currently active */
  isActive: boolean;

  /** Total rewards earned */
  totalRewards?: string;

  /** Number of successful submissions */
  successfulSubmissions?: number;

  /** Total submissions attempted */
  totalSubmissions?: number;
}

/**
 * Vote power information for a provider
 */
export interface VotePowerInfo {
  /** Provider address */
  providerAddress: string;

  /** Current vote power */
  votePower: string;

  /** Vote power percentage */
  votePowerPercentage: number;

  /** Delegated vote power */
  delegatedVotePower?: string;

  /** Timestamp of last update */
  lastUpdate: number;
}

/**
 * FTSO Registry contract information
 */
export interface FTSORegistry {
  /** Registry contract address */
  address: string;

  /** List of all FTSO contract addresses */
  ftsoContracts: Map<string, string>;

  /** Supported asset symbols */
  supportedSymbols: string[];

  /** Current price epoch */
  currentEpoch: number;

  /** Epoch duration in seconds */
  epochDuration: number;
}

/**
 * Price update event emitted by FTSOPriceWatcher
 */
export interface PriceUpdateEvent {
  /** Asset symbol */
  symbol: string;

  /** Previous price */
  oldPrice: string;

  /** New current price */
  newPrice: string;

  /** Percentage change */
  changePercent: number;

  /** Absolute change */
  changeAbsolute: string;

  /** Event timestamp */
  timestamp: number;

  /** Epoch ID when price was updated */
  epochId: number;
}

/**
 * Significant price movement event
 */
export interface SignificantMoveEvent {
  /** Asset symbol */
  symbol: string;

  /** Previous price */
  oldPrice: string;

  /** New current price */
  newPrice: string;

  /** Percentage change */
  changePercent: number;

  /** Threshold that triggered the event (1, 5, or 10) */
  threshold: number;

  /** Direction of movement */
  direction: 'up' | 'down';

  /** Event timestamp */
  timestamp: number;

  /** Time since last significant move */
  timeSinceLastMove?: number;
}

/**
 * Stale price warning event
 */
export interface StalePriceEvent {
  /** Asset symbol */
  symbol: string;

  /** Current price age in seconds */
  age: number;

  /** Last update timestamp */
  lastUpdate: number;

  /** Last known price */
  lastPrice: string;

  /** Event timestamp */
  timestamp: number;
}

/**
 * Provider statistics for monitoring
 */
export interface ProviderStats {
  /** Provider address */
  address: string;

  /** Provider name */
  name?: string;

  /** Current vote power */
  votePower: string;

  /** Vote power percentage */
  votePowerPercentage: number;

  /** Reliability score (0-100) */
  reliability: number;

  /** Reward rate (0-1) */
  rewardRate: number;

  /** Total rewards earned */
  totalRewards: string;

  /** Successful submissions count */
  successfulSubmissions: number;

  /** Total submissions count */
  totalSubmissions: number;

  /** Success rate percentage */
  successRate: number;

  /** Average response time in ms */
  avgResponseTime?: number;

  /** Whether provider is currently active */
  isActive: boolean;

  /** Last seen timestamp */
  lastSeen: number;
}

/**
 * Historical provider data for performance tracking
 */
export interface ProviderHistoricalData {
  /** Provider address */
  providerAddress: string;

  /** Time range start */
  fromDate: Date;

  /** Time range end */
  toDate: Date;

  /** Historical data points */
  dataPoints: ProviderDataPoint[];

  /** Aggregated statistics */
  aggregates: {
    avgReliability: number;
    avgRewardRate: number;
    totalRewards: string;
    totalSubmissions: number;
    successRate: number;
  };
}

/**
 * Single provider data point for historical tracking
 */
export interface ProviderDataPoint {
  /** Timestamp */
  timestamp: number;

  /** Vote power at this time */
  votePower: string;

  /** Reliability score */
  reliability: number;

  /** Reward rate */
  rewardRate: number;

  /** Successful submissions */
  successfulSubmissions: number;

  /** Failed submissions */
  failedSubmissions: number;
}

/**
 * FTSO Client configuration options
 */
export interface FTSOClientConfig {
  /** Network to connect to (flare or songbird) */
  network: 'flare' | 'songbird';

  /** RPC endpoint URL */
  rpcUrl: string;

  /** Cache TTL in seconds (default: 30) */
  cacheTTL?: number;

  /** Enable automatic price watching */
  enableWatcher?: boolean;

  /** Price update interval in milliseconds (default: 90000) */
  updateInterval?: number;

  /** Maximum price age before considering stale (default: 180) */
  maxPriceAge?: number;

  /** Enable provider monitoring */
  enableProviderMonitoring?: boolean;

  /** Logger instance */
  logger?: any;
}

/**
 * Price history query parameters
 */
export interface PriceHistoryQuery {
  /** Asset symbol */
  symbol: string;

  /** Start timestamp */
  fromTimestamp: number;

  /** End timestamp */
  toTimestamp: number;

  /** Granularity (epoch interval) */
  granularity?: number;

  /** Maximum number of results */
  limit?: number;
}

/**
 * Multi-price query parameters
 */
export interface MultiPriceQuery {
  /** List of asset symbols */
  symbols: string[];

  /** Maximum price age to accept */
  maxAge?: number;

  /** Whether to throw on stale prices */
  throwOnStale?: boolean;
}

/**
 * FTSO error types
 */
export class FTSOError extends Error {
  constructor(
    message: string,
    public code: FTSOErrorCode,
    public symbol?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'FTSOError';
  }
}

/**
 * FTSO error codes
 */
export enum FTSOErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_SYMBOL = 'INVALID_SYMBOL',
  STALE_PRICE = 'STALE_PRICE',
  CONTRACT_ERROR = 'CONTRACT_ERROR',
  PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
  INVALID_CONFIGURATION = 'INVALID_CONFIGURATION',
  PRICE_NOT_AVAILABLE = 'PRICE_NOT_AVAILABLE',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED'
}

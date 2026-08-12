/**
 * FTSO Module - Flare Time Series Oracle Integration
 * Entry point for FTSO functionality
 */

export * from './types';
export * from './constants';
export * from './FTSOClient';
export * from './FTSOPriceWatcher';
export * from './DataProviderMonitor';
export * from './ProviderRegistry';

// Re-export commonly used items for convenience
export {
  FTSO_CONTRACTS,
  FTSO_SYMBOLS,
  FTSO_TIMING,
  isValidFTSOSymbol,
  getNetworkConfig
} from './constants';

export {
  FTSOClient
} from './FTSOClient';

export {
  FTSOPriceWatcher
} from './FTSOPriceWatcher';

export {
  DataProviderMonitor
} from './DataProviderMonitor';

export {
  FtsoProviderRegistry
} from './ProviderRegistry';

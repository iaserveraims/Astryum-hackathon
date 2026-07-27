/**
 * FTSOClient — FTSOv2 client for Flare.
 *
 * Migrated from v1 (FtsoRegistry / VoterWhitelister / individual Ftso contracts)
 * to v2 (FtsoV2 contract resolved via FlareContractRegistry). The v1 contracts
 * are still on-chain but their data-provider methods revert post-FSP migration.
 *
 * Public API kept stable so callers (FlareFinanceConnector, NormalisationEngine,
 * routes/data, routes/ftso) don't need changes. v1-only concepts (data
 * providers, per-symbol Ftso contracts, vote power) return empty/synthetic
 * values with a warning instead of crashing.
 */

import { ethers } from 'ethers';
import winston from 'winston';
import {
  FTSOPrice,
  DataProvider,
  VotePowerInfo,
  FTSORegistry,
  FTSOClientConfig,
  FTSOError,
  FTSOErrorCode
} from './types';
import {
  FLARE_CONTRACT_REGISTRY,
  FTSO_SYMBOLS,
  FTSO_TIMING,
  NETWORK_RPC_URLS,
  isValidFTSOSymbol,
  formatPrice,
  getFeedId,
  getNetworkConfig
} from './constants';

const FLARE_CONTRACT_REGISTRY_ABI = [
  'function getContractAddressByName(string memory _name) external view returns (address)'
];

/**
 * FtsoV2 ABI — the canonical post-FSP price oracle on Flare.
 * Returns scaled integer prices with an `int8` decimals exponent (negative for
 * sub-unit prices, e.g. decimals=5 → price units are 10^-5).
 */
const FTSO_V2_ABI = [
  'function getFeedById(bytes21 _feedId) external view returns (uint256 _value, int8 _decimals, uint64 _timestamp)',
  'function getFeedsById(bytes21[] memory _feedIds) external view returns (uint256[] memory _values, int8[] memory _decimals, uint64 _timestamp)',
  'function getFeedByIdInWei(bytes21 _feedId) external view returns (uint256 _value, uint64 _timestamp)'
];

export class FTSOClient {
  private provider: ethers.JsonRpcProvider;
  private contractRegistry: ethers.Contract;
  private ftsoV2Promise: Promise<ethers.Contract> | null = null;
  private logger: winston.Logger;
  private config: FTSOClientConfig;
  private symbolCache: string[] | null = null;
  private lastCacheUpdate: number = 0;

  constructor(config: FTSOClientConfig) {
    this.config = {
      cacheTTL: 30,
      updateInterval: FTSO_TIMING.UPDATE_INTERVAL,
      maxPriceAge: FTSO_TIMING.MAX_PRICE_AGE,
      enableWatcher: false,
      enableProviderMonitoring: false,
      ...config
    };

    const rpcConfig = NETWORK_RPC_URLS[config.network];
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl || rpcConfig.default);

    this.contractRegistry = new ethers.Contract(
      FLARE_CONTRACT_REGISTRY,
      FLARE_CONTRACT_REGISTRY_ABI,
      this.provider
    );

    this.logger = config.logger || winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.label({ label: 'FTSOClient' }),
        winston.format.json()
      ),
      transports: [new winston.transports.Console()]
    });

    this.logger.info('FTSOClient initialized', {
      network: config.network,
      rpcUrl: config.rpcUrl || rpcConfig.default,
      version: 'v2'
    });
  }

  /**
   * Lazily resolve and cache the FtsoV2 contract. Resolved via
   * FlareContractRegistry so we automatically pick up Flare-side upgrades.
   */
  private async getFtsoV2(): Promise<ethers.Contract> {
    if (this.ftsoV2Promise) return this.ftsoV2Promise;
    this.ftsoV2Promise = (async () => {
      const addr: string = await this.contractRegistry.getContractAddressByName('FtsoV2');
      if (!addr || addr === ethers.ZeroAddress) {
        throw new FTSOError(
          'FtsoV2 not registered in FlareContractRegistry',
          FTSOErrorCode.CONTRACT_ERROR
        );
      }
      this.logger.info('FtsoV2 resolved', { address: addr });
      return new ethers.Contract(addr, FTSO_V2_ABI, this.provider);
    })().catch((err) => {
      this.ftsoV2Promise = null;
      throw err;
    });
    return this.ftsoV2Promise;
  }

  // ===============================
  // PUBLIC API — prices
  // ===============================

  async getCurrentPrice(symbol: string): Promise<FTSOPrice> {
    if (!isValidFTSOSymbol(symbol)) {
      throw new FTSOError(`Invalid FTSO symbol: ${symbol}`, FTSOErrorCode.INVALID_SYMBOL, symbol);
    }

    // USD has no on-chain feed (USD/USD == 1). Return a synthetic fresh price
    // so downstream USD-denominated math doesn't have to special-case it.
    if (symbol === 'USD') return this.syntheticUsdPrice();

    try {
      const ftsoV2 = await this.getFtsoV2();
      const feedId = getFeedId(symbol);
      const [value, dec, ts] = await ftsoV2.getFeedById(feedId);
      return this.toFTSOPrice(symbol, value, dec, ts);
    } catch (error) {
      this.logger.error('Error fetching current price (v2)', { symbol, error });
      throw this.handleError(error, symbol);
    }
  }

  async getCurrentPrices(symbols: string[]): Promise<FTSOPrice[]> {
    for (const s of symbols) {
      if (!isValidFTSOSymbol(s)) {
        throw new FTSOError(`Invalid FTSO symbol: ${s}`, FTSOErrorCode.INVALID_SYMBOL, s);
      }
    }
    if (symbols.length === 0) return [];

    // Split USD (synthetic) from on-chain feeds.
    const onChainSymbols = symbols.filter((s) => s !== 'USD');
    if (onChainSymbols.length === 0) {
      return symbols.map(() => this.syntheticUsdPrice());
    }

    try {
      const ftsoV2 = await this.getFtsoV2();
      const feedIds = onChainSymbols.map((s) => getFeedId(s));
      const [values, decs, ts] = await ftsoV2.getFeedsById(feedIds);

      const byOnChain: FTSOPrice[] = onChainSymbols.map((s, i) =>
        this.toFTSOPrice(s, values[i], decs[i], ts)
      );

      // Stitch back in original order, replacing USD slots with synthetic.
      const idx = new Map<string, FTSOPrice>();
      onChainSymbols.forEach((s, i) => idx.set(s, byOnChain[i]));
      return symbols.map((s) =>
        s === 'USD' ? this.syntheticUsdPrice() : (idx.get(s) as FTSOPrice)
      );
    } catch (error) {
      this.logger.error('Error fetching multiple prices (v2)', { symbols, error });
      throw this.handleError(error);
    }
  }

  async getPriceWithFreshness(symbol: string, maxAgeSeconds: number): Promise<FTSOPrice> {
    const price = await this.getCurrentPrice(symbol);
    if (price.age > maxAgeSeconds) {
      throw new FTSOError(
        `Price for ${symbol} is stale (age: ${price.age}s, max: ${maxAgeSeconds}s)`,
        FTSOErrorCode.STALE_PRICE,
        symbol,
        { age: price.age, maxAge: maxAgeSeconds }
      );
    }
    return price;
  }

  async getAllCurrentPrices(): Promise<FTSOPrice[]> {
    const symbols = await this.getSupportedSymbols();
    return this.getCurrentPrices(symbols);
  }

  /**
   * v1 had per-symbol Ftso contracts with `getEpochPrice(epochId)`. v2 has no
   * direct equivalent — historical reads go through the FastUpdater archive
   * which we don't model here. Return current price as a best-effort stub.
   */
  async getEpochPrice(symbol: string, epochId: number): Promise<FTSOPrice> {
    this.logger.warn('getEpochPrice: v2 has no per-epoch read, returning current price', {
      symbol, epochId
    });
    const cur = await this.getCurrentPrice(symbol);
    return { ...cur, epochId };
  }

  async getSupportedSymbols(): Promise<string[]> {
    // v2 doesn't expose a symbol list on-chain — feeds are addressed by id.
    // We return the curated FTSO_SYMBOLS list (validated against feeds we use).
    if (this.symbolCache && (Date.now() - this.lastCacheUpdate) < (this.config.cacheTTL! * 1000)) {
      return this.symbolCache;
    }
    this.symbolCache = [...FTSO_SYMBOLS];
    this.lastCacheUpdate = Date.now();
    return this.symbolCache;
  }

  // ===============================
  // PUBLIC API — providers / registry / epochs (v1 legacy, stubbed)
  // ===============================

  async getDataProviders(_symbol?: string): Promise<DataProvider[]> {
    this.logger.warn('getDataProviders: deprecated post-FTSOv2, returning []');
    return [];
  }

  async getProviderVotePower(providerAddress: string): Promise<VotePowerInfo> {
    this.logger.warn('getProviderVotePower: deprecated post-FTSOv2', { providerAddress });
    return {
      providerAddress,
      votePower: '0',
      votePowerPercentage: 0,
      lastUpdate: Date.now()
    };
  }

  async getFTSORegistry(): Promise<FTSORegistry> {
    const supportedSymbols = await this.getSupportedSymbols();
    let address = FLARE_CONTRACT_REGISTRY;
    try {
      const ftsoV2 = await this.getFtsoV2();
      address = await ftsoV2.getAddress();
    } catch (err) {
      this.logger.warn('Failed to resolve FtsoV2 address for registry view', { err });
    }
    return {
      address,
      ftsoContracts: new Map(),
      supportedSymbols,
      currentEpoch: 0,
      epochDuration: 90
    };
  }

  /**
   * v2 publishes via FastUpdater (sub-block) and Protocol Manager (90s voting
   * rounds). For backward compatibility we synthesise an "epoch id" from the
   * latest feed timestamp / 90s. Good enough for ordering and display.
   */
  async getCurrentEpochId(): Promise<number> {
    try {
      const flr = await this.getCurrentPrice('FLR');
      return Math.floor(flr.timestamp / 90);
    } catch (error) {
      this.logger.error('Error deriving current epoch id', { error });
      throw this.handleError(error);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const testSymbol = this.config.network === 'flare' ? 'FLR' : 'SGB';
      const price = await this.getCurrentPrice(testSymbol);
      return price.isFresh;
    } catch (error) {
      this.logger.error('FTSO health check failed', { error });
      return false;
    }
  }

  clearCache(): void {
    this.symbolCache = null;
    this.lastCacheUpdate = 0;
    this.ftsoV2Promise = null;
    this.logger.info('Cache cleared');
  }

  getNetworkConfig() {
    return getNetworkConfig(this.config.network);
  }

  // ===============================
  // PRIVATE HELPERS
  // ===============================

  /**
   * v2 returns `int8 decimals` (signed exponent: positive = price * 10^dec for
   * fractional prices in solidity uint256). Translate to the v1-shaped FTSOPrice
   * with `decimals` as a non-negative integer for `formatPrice` callers.
   */
  private toFTSOPrice(symbol: string, value: bigint, decimalsRaw: number | bigint, timestamp: bigint | number): FTSOPrice {
    const decN = Number(decimalsRaw);
    const tsN = Number(timestamp);
    const decimals = decN < 0 ? -decN : decN;
    const currentTime = Math.floor(Date.now() / 1000);
    const age = currentTime - tsN;
    const isFresh = age < this.config.maxPriceAge!;

    return {
      symbol,
      price: value.toString(),
      decimals,
      timestamp: tsN,
      finalizationType: 0,
      lastUpdate: new Date(tsN * 1000),
      age,
      isFresh,
      priceUSD: formatPrice(value, decimals)
    };
  }

  private syntheticUsdPrice(): FTSOPrice {
    const ts = Math.floor(Date.now() / 1000);
    return {
      symbol: 'USD',
      price: '100000',
      decimals: 5,
      timestamp: ts,
      finalizationType: 0,
      lastUpdate: new Date(ts * 1000),
      age: 0,
      isFresh: true,
      priceUSD: '1.00000'
    };
  }

  private handleError(error: any, symbol?: string): FTSOError {
    if (error instanceof FTSOError) return error;

    if (error?.message?.includes('network') || error?.code === 'NETWORK_ERROR') {
      return new FTSOError(
        'Network error while communicating with FTSO',
        FTSOErrorCode.NETWORK_ERROR,
        symbol,
        { originalError: error.message }
      );
    }

    if (error?.message?.includes('invalid symbol') || error?.message?.includes('not found')) {
      return new FTSOError(
        `Price not available for symbol: ${symbol}`,
        FTSOErrorCode.PRICE_NOT_AVAILABLE,
        symbol,
        { originalError: error.message }
      );
    }

    return new FTSOError(
      'Contract call failed',
      FTSOErrorCode.CONTRACT_ERROR,
      symbol,
      { originalError: error?.message }
    );
  }
}

/**
 * FTSOPriceWatcher - Real-time price monitoring and event emission
 * Watches FTSO price updates and emits events for price changes, significant moves, and stale prices
 */

import { EventEmitter } from 'events';
import winston from 'winston';
import { FTSOClient } from './FTSOClient';
import {
  FTSOPrice,
  PriceUpdateEvent,
  SignificantMoveEvent,
  StalePriceEvent,
  FTSOClientConfig
} from './types';
import {
  FTSO_TIMING,
  PRICE_MOVEMENT_THRESHOLDS,
  calculatePriceChange
} from './constants';

/**
 * Price watcher configuration
 */
export interface FTSOPriceWatcherConfig extends FTSOClientConfig {
  /** Update interval in milliseconds (default: 90000 - 90 seconds) */
  updateInterval?: number;

  /** Enable significant move detection */
  detectSignificantMoves?: boolean;

  /** Significant move thresholds (default: [1, 5, 10]) */
  significantMoveThresholds?: number[];

  /** Enable stale price detection */
  detectStalePrices?: boolean;

  /** Stale price threshold in seconds (default: 180) */
  stalePriceThreshold?: number;

  /** Auto-start watching on initialization */
  autoStart?: boolean;

  /** Maximum concurrent price fetches */
  maxConcurrentFetches?: number;
}

/**
 * Watched symbol state
 */
interface WatchedSymbol {
  symbol: string;
  lastPrice: FTSOPrice | null;
  lastUpdate: Date;
  lastSignificantMove: Date | null;
  updateCount: number;
  errorCount: number;
  isStale: boolean;
}

/**
 * FTSOPriceWatcher - Monitors FTSO prices and emits events
 *
 * Events:
 * - 'priceUpdate': Emitted when any price updates
 * - 'significantMove': Emitted when price moves beyond threshold
 * - 'stalePrice': Emitted when price becomes stale
 * - 'error': Emitted on errors
 * - 'started': Emitted when watcher starts
 * - 'stopped': Emitted when watcher stops
 */
export class FTSOPriceWatcher extends EventEmitter {
  private ftsoClient: FTSOClient;
  private logger: winston.Logger;
  private config: Required<FTSOPriceWatcherConfig>;
  private watchedSymbols: Map<string, WatchedSymbol> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private priceHistory: Map<string, FTSOPrice[]> = new Map();
  private readonly MAX_HISTORY_SIZE = 100;

  constructor(config: FTSOPriceWatcherConfig) {
    super();

    // Set default configuration
    this.config = {
      updateInterval: FTSO_TIMING.UPDATE_INTERVAL,
      detectSignificantMoves: true,
      significantMoveThresholds: [
        PRICE_MOVEMENT_THRESHOLDS.MINOR,
        PRICE_MOVEMENT_THRESHOLDS.MODERATE,
        PRICE_MOVEMENT_THRESHOLDS.MAJOR
      ],
      detectStalePrices: true,
      stalePriceThreshold: FTSO_TIMING.MAX_PRICE_AGE,
      autoStart: false,
      maxConcurrentFetches: 10,
      cacheTTL: 30,
      enableWatcher: true,
      ...config
    } as Required<FTSOPriceWatcherConfig>;

    // Initialize FTSO client
    this.ftsoClient = new FTSOClient(config);

    // Initialize logger
    this.logger = config.logger || winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.label({ label: 'FTSOPriceWatcher' }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/ftso-watcher.log' })
      ]
    });

    this.logger.info('FTSOPriceWatcher initialized', {
      network: config.network,
      updateInterval: this.config.updateInterval,
      autoStart: this.config.autoStart
    });

    // Auto-start if configured
    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * Start watching prices
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('Price watcher already running');
      return;
    }

    this.logger.info('Starting price watcher', {
      watchedSymbols: Array.from(this.watchedSymbols.keys()),
      updateInterval: this.config.updateInterval
    });

    this.isRunning = true;

    // Start update loop
    this.updateInterval = setInterval(() => {
      this.updatePrices().catch(error => {
        this.logger.error('Error in price update loop', { error });
        this.emit('error', error);
      });
    }, this.config.updateInterval);

    // Initial update
    this.updatePrices().catch(error => {
      this.logger.error('Error in initial price update', { error });
      this.emit('error', error);
    });

    this.emit('started');
  }

  /**
   * Stop watching prices
   */
  stop(): void {
    if (!this.isRunning) {
      this.logger.warn('Price watcher not running');
      return;
    }

    this.logger.info('Stopping price watcher');

    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.emit('stopped');
  }

  /**
   * Watch a specific symbol
   */
  async watchSymbol(symbol: string): Promise<void> {
    if (this.watchedSymbols.has(symbol)) {
      this.logger.warn('Symbol already being watched', { symbol });
      return;
    }

    this.logger.info('Adding symbol to watch list', { symbol });

    // Initialize watched symbol state
    this.watchedSymbols.set(symbol, {
      symbol,
      lastPrice: null,
      lastUpdate: new Date(),
      lastSignificantMove: null,
      updateCount: 0,
      errorCount: 0,
      isStale: false
    });

    // Initialize price history
    this.priceHistory.set(symbol, []);

    // Fetch initial price
    try {
      const price = await this.ftsoClient.getCurrentPrice(symbol);
      this.updateSymbolState(symbol, price);
    } catch (error) {
      this.logger.error('Failed to fetch initial price for symbol', { symbol, error });
    }

    // Start watcher if not already running and we have symbols
    if (!this.isRunning && this.watchedSymbols.size > 0) {
      this.start();
    }
  }

  /**
   * Stop watching a specific symbol
   */
  async unwatchSymbol(symbol: string): Promise<void> {
    if (!this.watchedSymbols.has(symbol)) {
      this.logger.warn('Symbol not being watched', { symbol });
      return;
    }

    this.logger.info('Removing symbol from watch list', { symbol });

    this.watchedSymbols.delete(symbol);
    this.priceHistory.delete(symbol);

    // Stop watcher if no more symbols
    if (this.watchedSymbols.size === 0 && this.isRunning) {
      this.stop();
    }
  }

  /**
   * Watch multiple symbols
   */
  async watchSymbols(symbols: string[]): Promise<void> {
    for (const symbol of symbols) {
      await this.watchSymbol(symbol);
    }
  }

  /**
   * Get list of watched symbols
   */
  getWatchedSymbols(): string[] {
    return Array.from(this.watchedSymbols.keys());
  }

  /**
   * Get last update time for a symbol
   */
  getLastUpdate(symbol: string): Date | null {
    const watched = this.watchedSymbols.get(symbol);
    return watched ? watched.lastUpdate : null;
  }

  /**
   * Get last price for a symbol
   */
  getLastPrice(symbol: string): FTSOPrice | null {
    const watched = this.watchedSymbols.get(symbol);
    return watched ? watched.lastPrice : null;
  }

  /**
   * Get price history for a symbol
   */
  getPriceHistory(symbol: string, limit?: number): FTSOPrice[] {
    const history = this.priceHistory.get(symbol) || [];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get statistics for watched symbols
   */
  getStats() {
    const stats = {
      totalSymbols: this.watchedSymbols.size,
      activeSymbols: 0,
      staleSymbols: 0,
      totalUpdates: 0,
      totalErrors: 0,
      isRunning: this.isRunning,
      updateInterval: this.config.updateInterval
    };

    for (const watched of this.watchedSymbols.values()) {
      if (!watched.isStale) stats.activeSymbols++;
      if (watched.isStale) stats.staleSymbols++;
      stats.totalUpdates += watched.updateCount;
      stats.totalErrors += watched.errorCount;
    }

    return stats;
  }

  /**
   * Check if watcher is running
   */
  isWatcherRunning(): boolean {
    return this.isRunning;
  }

  // ===============================
  // PRIVATE METHODS
  // ===============================

  /**
   * Update all watched prices
   */
  private async updatePrices(): Promise<void> {
    if (this.watchedSymbols.size === 0) {
      return;
    }

    const symbols = Array.from(this.watchedSymbols.keys());

    this.logger.debug('Updating prices', { symbols, count: symbols.length });

    try {
      // Fetch prices in batches to avoid overwhelming the RPC
      const batchSize = this.config.maxConcurrentFetches;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        await this.updatePriceBatch(batch);
      }
    } catch (error) {
      this.logger.error('Error updating prices', { error });
      this.emit('error', error);
    }
  }

  /**
   * Update a batch of prices
   */
  private async updatePriceBatch(symbols: string[]): Promise<void> {
    const promises = symbols.map(symbol => this.updateSinglePrice(symbol));
    await Promise.allSettled(promises);
  }

  /**
   * Update a single price
   */
  private async updateSinglePrice(symbol: string): Promise<void> {
    const watched = this.watchedSymbols.get(symbol);
    if (!watched) return;

    try {
      // Fetch current price
      const newPrice = await this.ftsoClient.getCurrentPrice(symbol);

      // Check for stale price
      if (this.config.detectStalePrices && !newPrice.isFresh) {
        this.handleStalePrice(symbol, newPrice, watched);
      } else {
        watched.isStale = false;
      }

      // Check for price update
      if (watched.lastPrice) {
        this.handlePriceUpdate(symbol, watched.lastPrice, newPrice, watched);
      }

      // Update symbol state
      this.updateSymbolState(symbol, newPrice);

      watched.updateCount++;
    } catch (error) {
      watched.errorCount++;
      this.logger.error('Error updating price for symbol', { symbol, error });
      this.emit('error', { symbol, error });
    }
  }

  /**
   * Handle price update event
   */
  private handlePriceUpdate(
    symbol: string,
    oldPrice: FTSOPrice,
    newPrice: FTSOPrice,
    watched: WatchedSymbol
  ): void {
    // Check if price actually changed
    if (oldPrice.price === newPrice.price) {
      return;
    }

    const changePercent = calculatePriceChange(oldPrice.priceUSD!, newPrice.priceUSD!);
    const changeAbsolute = (parseFloat(newPrice.priceUSD!) - parseFloat(oldPrice.priceUSD!)).toString();

    // Emit price update event
    const updateEvent: PriceUpdateEvent = {
      symbol,
      oldPrice: oldPrice.priceUSD!,
      newPrice: newPrice.priceUSD!,
      changePercent,
      changeAbsolute,
      timestamp: newPrice.timestamp,
      epochId: newPrice.epochId || 0
    };

    this.emit('priceUpdate', updateEvent);

    this.logger.debug('Price updated', {
      symbol,
      oldPrice: oldPrice.priceUSD,
      newPrice: newPrice.priceUSD,
      changePercent: changePercent.toFixed(2) + '%'
    });

    // Check for significant moves
    if (this.config.detectSignificantMoves) {
      this.checkSignificantMove(symbol, oldPrice, newPrice, watched, changePercent);
    }
  }

  /**
   * Check for significant price movements
   */
  private checkSignificantMove(
    symbol: string,
    oldPrice: FTSOPrice,
    newPrice: FTSOPrice,
    watched: WatchedSymbol,
    changePercent: number
  ): void {
    const absChangePercent = Math.abs(changePercent);

    // Check each threshold
    for (const threshold of this.config.significantMoveThresholds) {
      if (absChangePercent >= threshold) {
        const direction: 'up' | 'down' = changePercent > 0 ? 'up' : 'down';

        const moveEvent: SignificantMoveEvent = {
          symbol,
          oldPrice: oldPrice.priceUSD!,
          newPrice: newPrice.priceUSD!,
          changePercent,
          threshold,
          direction,
          timestamp: Date.now(),
          timeSinceLastMove: watched.lastSignificantMove
            ? Date.now() - watched.lastSignificantMove.getTime()
            : undefined
        };

        this.emit('significantMove', moveEvent);

        this.logger.info('Significant price move detected', {
          symbol,
          changePercent: changePercent.toFixed(2) + '%',
          threshold: threshold + '%',
          direction
        });

        watched.lastSignificantMove = new Date();

        // Only emit for the highest threshold crossed
        break;
      }
    }
  }

  /**
   * Handle stale price detection
   */
  private handleStalePrice(symbol: string, price: FTSOPrice, watched: WatchedSymbol): void {
    // Only emit if transitioning from fresh to stale
    if (!watched.isStale) {
      watched.isStale = true;

      const staleEvent: StalePriceEvent = {
        symbol,
        age: price.age,
        lastUpdate: price.timestamp,
        lastPrice: price.priceUSD!,
        timestamp: Date.now()
      };

      this.emit('stalePrice', staleEvent);

      this.logger.warn('Stale price detected', {
        symbol,
        age: price.age,
        threshold: this.config.stalePriceThreshold
      });
    }
  }

  /**
   * Update symbol state with new price
   */
  private updateSymbolState(symbol: string, price: FTSOPrice): void {
    const watched = this.watchedSymbols.get(symbol);
    if (!watched) return;

    watched.lastPrice = price;
    watched.lastUpdate = new Date();

    // Update price history
    const history = this.priceHistory.get(symbol) || [];
    history.push(price);

    // Limit history size
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.shift();
    }

    this.priceHistory.set(symbol, history);
  }
}

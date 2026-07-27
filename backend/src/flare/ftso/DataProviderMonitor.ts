/**
 * DataProviderMonitor - Tracks FTSO data provider performance and reliability
 * Monitors provider statistics, vote power, and reward performance
 */

import winston from 'winston';
import { FTSOClient } from './FTSOClient';
import {
  DataProvider,
  ProviderStats,
  ProviderHistoricalData,
  ProviderDataPoint,
  FTSOClientConfig
} from './types';
import { FTSO_TIMING, PROVIDER_RELIABILITY } from './constants';

/**
 * Provider monitor configuration
 */
export interface DataProviderMonitorConfig extends FTSOClientConfig {
  /** Update interval for provider stats in milliseconds (default: 5 minutes) */
  updateInterval?: number;

  /** Enable automatic monitoring */
  autoStart?: boolean;

  /** Number of days to track history (default: 30) */
  historyRetentionDays?: number;

  /** Minimum reliability threshold for alerts */
  minReliabilityThreshold?: number;
}

/**
 * Provider monitoring state
 */
interface ProviderMonitorState {
  address: string;
  currentStats: ProviderStats;
  history: ProviderDataPoint[];
  lastUpdate: Date;
  updateCount: number;
  alertsTriggered: number;
}

/**
 * DataProviderMonitor - Monitors FTSO data provider performance
 */
export class DataProviderMonitor {
  private ftsoClient: FTSOClient;
  private logger: winston.Logger;
  private config: Required<DataProviderMonitorConfig>;
  private monitoredProviders: Map<string, ProviderMonitorState> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private totalVotePower: bigint = BigInt(0);

  constructor(config: DataProviderMonitorConfig) {
    // Set default configuration
    this.config = {
      updateInterval: FTSO_TIMING.PROVIDER_STATS_REFRESH,
      autoStart: false,
      historyRetentionDays: 30,
      minReliabilityThreshold: PROVIDER_RELIABILITY.AVERAGE,
      cacheTTL: 30,
      enableProviderMonitoring: true,
      ...config
    } as Required<DataProviderMonitorConfig>;

    // Initialize FTSO client
    this.ftsoClient = new FTSOClient(config);

    // Initialize logger
    this.logger = config.logger || winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.label({ label: 'DataProviderMonitor' }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/ftso-provider-monitor.log' })
      ]
    });

    this.logger.info('DataProviderMonitor initialized', {
      network: config.network,
      updateInterval: this.config.updateInterval
    });

    // Auto-start if configured
    if (this.config.autoStart) {
      this.start();
    }
  }

  /**
   * Start monitoring providers
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Provider monitor already running');
      return;
    }

    this.logger.info('Starting provider monitor');

    this.isRunning = true;

    // Load initial provider list
    await this.loadProviders();

    // Start update loop
    this.updateInterval = setInterval(() => {
      this.updateProviderStats().catch(error => {
        this.logger.error('Error in provider stats update loop', { error });
      });
    }, this.config.updateInterval);

    // Initial stats update
    await this.updateProviderStats();
  }

  /**
   * Stop monitoring providers
   */
  stop(): void {
    if (!this.isRunning) {
      this.logger.warn('Provider monitor not running');
      return;
    }

    this.logger.info('Stopping provider monitor');

    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Get statistics for a specific provider
   */
  async getProviderStats(providerAddress: string): Promise<ProviderStats> {
    const state = this.monitoredProviders.get(providerAddress);

    if (state) {
      return state.currentStats;
    }

    // Fetch fresh data if not monitored
    return await this.fetchProviderStats(providerAddress);
  }

  /**
   * Get statistics for all monitored providers
   */
  async getAllProviderStats(): Promise<ProviderStats[]> {
    if (this.monitoredProviders.size === 0) {
      await this.loadProviders();
    }

    return Array.from(this.monitoredProviders.values())
      .map(state => state.currentStats)
      .sort((a, b) => b.votePowerPercentage - a.votePowerPercentage);
  }

  /**
   * Get provider reliability score (0-100)
   */
  async getProviderReliability(providerAddress: string): Promise<number> {
    const stats = await this.getProviderStats(providerAddress);
    return stats.reliability;
  }

  /**
   * Get provider reward rate (0-1)
   */
  async getProviderRewardRate(providerAddress: string): Promise<number> {
    const stats = await this.getProviderStats(providerAddress);
    return stats.rewardRate;
  }

  /**
   * Get provider historical data
   */
  async getProviderHistory(
    providerAddress: string,
    days: number
  ): Promise<ProviderHistoricalData> {
    const state = this.monitoredProviders.get(providerAddress);

    if (!state) {
      throw new Error(`Provider ${providerAddress} not monitored`);
    }

    // Filter history by time range
    const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    const filteredHistory = state.history.filter(
      point => point.timestamp > cutoffTime
    );

    // Calculate aggregates
    const totalSubmissions = filteredHistory.reduce(
      (sum, point) => sum + point.successfulSubmissions + point.failedSubmissions,
      0
    );
    const successfulSubmissions = filteredHistory.reduce(
      (sum, point) => sum + point.successfulSubmissions,
      0
    );

    const avgReliability = filteredHistory.length > 0
      ? filteredHistory.reduce((sum, point) => sum + point.reliability, 0) / filteredHistory.length
      : 0;

    const avgRewardRate = filteredHistory.length > 0
      ? filteredHistory.reduce((sum, point) => sum + point.rewardRate, 0) / filteredHistory.length
      : 0;

    return {
      providerAddress,
      fromDate: new Date(cutoffTime),
      toDate: new Date(),
      dataPoints: filteredHistory,
      aggregates: {
        avgReliability,
        avgRewardRate,
        totalRewards: state.currentStats.totalRewards,
        totalSubmissions,
        successRate: totalSubmissions > 0
          ? (successfulSubmissions / totalSubmissions) * 100
          : 0
      }
    };
  }

  /**
   * Get top providers by vote power
   */
  async getTopProviders(limit: number = 10): Promise<ProviderStats[]> {
    const allStats = await this.getAllProviderStats();
    return allStats.slice(0, limit);
  }

  /**
   * Get providers below reliability threshold
   */
  async getLowReliabilityProviders(): Promise<ProviderStats[]> {
    const allStats = await this.getAllProviderStats();
    return allStats.filter(
      stats => stats.reliability < this.config.minReliabilityThreshold
    );
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    return {
      totalProviders: this.monitoredProviders.size,
      activeProviders: Array.from(this.monitoredProviders.values())
        .filter(state => state.currentStats.isActive).length,
      totalVotePower: this.totalVotePower.toString(),
      averageReliability: this.calculateAverageReliability(),
      isRunning: this.isRunning,
      updateInterval: this.config.updateInterval
    };
  }

  /**
   * Check if monitor is running
   */
  isMonitorRunning(): boolean {
    return this.isRunning;
  }

  // ===============================
  // PRIVATE METHODS
  // ===============================

  /**
   * Load all data providers
   */
  private async loadProviders(): Promise<void> {
    try {
      this.logger.info('Loading data providers');

      const providers = await this.ftsoClient.getDataProviders();

      this.logger.info('Loaded data providers', { count: providers.length });

      // Calculate total vote power
      this.totalVotePower = providers.reduce(
        (sum, provider) => sum + BigInt(provider.votePower),
        BigInt(0)
      );

      // Initialize monitoring state for each provider
      for (const provider of providers) {
        if (!this.monitoredProviders.has(provider.address)) {
          const stats = await this.fetchProviderStats(provider.address);

          this.monitoredProviders.set(provider.address, {
            address: provider.address,
            currentStats: stats,
            history: [],
            lastUpdate: new Date(),
            updateCount: 0,
            alertsTriggered: 0
          });
        }
      }
    } catch (error) {
      this.logger.error('Error loading providers', { error });
      throw error;
    }
  }

  /**
   * Update statistics for all monitored providers
   */
  private async updateProviderStats(): Promise<void> {
    if (this.monitoredProviders.size === 0) {
      return;
    }

    this.logger.debug('Updating provider statistics', {
      count: this.monitoredProviders.size
    });

    const updatePromises = Array.from(this.monitoredProviders.keys()).map(
      address => this.updateSingleProvider(address)
    );

    await Promise.allSettled(updatePromises);
  }

  /**
   * Update a single provider's statistics
   */
  private async updateSingleProvider(providerAddress: string): Promise<void> {
    const state = this.monitoredProviders.get(providerAddress);
    if (!state) return;

    try {
      // Fetch current stats
      const stats = await this.fetchProviderStats(providerAddress);

      // Create historical data point
      const dataPoint: ProviderDataPoint = {
        timestamp: Date.now(),
        votePower: stats.votePower,
        reliability: stats.reliability,
        rewardRate: stats.rewardRate,
        successfulSubmissions: stats.successfulSubmissions,
        failedSubmissions: stats.totalSubmissions - stats.successfulSubmissions
      };

      // Update state
      state.currentStats = stats;
      state.lastUpdate = new Date();
      state.updateCount++;

      // Add to history
      state.history.push(dataPoint);

      // Trim history to retention period
      const cutoffTime = Date.now() - (this.config.historyRetentionDays * 24 * 60 * 60 * 1000);
      state.history = state.history.filter(point => point.timestamp > cutoffTime);

      // Check for reliability alerts
      if (stats.reliability < this.config.minReliabilityThreshold) {
        state.alertsTriggered++;
        this.logger.warn('Provider reliability below threshold', {
          address: providerAddress,
          reliability: stats.reliability,
          threshold: this.config.minReliabilityThreshold
        });
      }
    } catch (error) {
      this.logger.error('Error updating provider stats', {
        address: providerAddress,
        error
      });
    }
  }

  /**
   * Fetch statistics for a specific provider
   */
  private async fetchProviderStats(providerAddress: string): Promise<ProviderStats> {
    try {
      // Get vote power info
      const votePowerInfo = await this.ftsoClient.getProviderVotePower(providerAddress);

      // Calculate vote power percentage
      const votePowerPercentage = this.totalVotePower > BigInt(0)
        ? (Number(BigInt(votePowerInfo.votePower) * BigInt(10000) / this.totalVotePower) / 100)
        : 0;

      // For now, return basic stats
      // In a production system, you would query the FTSO Reward Manager
      // and maintain historical submission data
      const stats: ProviderStats = {
        address: providerAddress,
        votePower: votePowerInfo.votePower,
        votePowerPercentage,
        reliability: this.calculateReliability(providerAddress),
        rewardRate: 0.85, // Would fetch from reward manager
        totalRewards: '0', // Would fetch from reward manager
        successfulSubmissions: 0, // Would track from events
        totalSubmissions: 0, // Would track from events
        successRate: 0,
        isActive: true,
        lastSeen: Date.now()
      };

      // Calculate success rate if we have submission data
      if (stats.totalSubmissions > 0) {
        stats.successRate = (stats.successfulSubmissions / stats.totalSubmissions) * 100;
      }

      return stats;
    } catch (error) {
      this.logger.error('Error fetching provider stats', {
        address: providerAddress,
        error
      });

      // Return default stats on error
      return {
        address: providerAddress,
        votePower: '0',
        votePowerPercentage: 0,
        reliability: 0,
        rewardRate: 0,
        totalRewards: '0',
        successfulSubmissions: 0,
        totalSubmissions: 0,
        successRate: 0,
        isActive: false,
        lastSeen: Date.now()
      };
    }
  }

  /**
   * Calculate reliability score for a provider
   * This is a simplified calculation - in production, you would track actual submission data
   */
  private calculateReliability(providerAddress: string): number {
    const state = this.monitoredProviders.get(providerAddress);

    if (!state || state.history.length === 0) {
      // Default reliability for new providers
      return PROVIDER_RELIABILITY.GOOD;
    }

    // Calculate average reliability from history
    const avgReliability = state.history.reduce(
      (sum, point) => sum + point.reliability,
      0
    ) / state.history.length;

    return avgReliability;
  }

  /**
   * Calculate average reliability across all providers
   */
  private calculateAverageReliability(): number {
    if (this.monitoredProviders.size === 0) {
      return 0;
    }

    const totalReliability = Array.from(this.monitoredProviders.values())
      .reduce((sum, state) => sum + state.currentStats.reliability, 0);

    return totalReliability / this.monitoredProviders.size;
  }
}

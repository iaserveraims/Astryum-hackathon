/**
 * FTSO API Routes
 * REST API endpoints for Flare Time Series Oracle data
 */

import { Router, Request, Response } from 'express';
import { FTSOClient, FTSOPriceWatcher, DataProviderMonitor } from '../flare/ftso';
import { isValidFTSOSymbol } from '../flare/ftso/constants';
import winston from 'winston';

const router = Router();

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.label({ label: 'FTSORoutes' }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/ftso-routes.log' })
  ]
});

// Initialize FTSO services (singleton pattern)
let ftsoClient: FTSOClient;
let priceWatcher: FTSOPriceWatcher;
let providerMonitor: DataProviderMonitor;

// Network from environment or default to flare
const network = (process.env.FLARE_NETWORK || 'flare') as 'flare' | 'songbird';
const rpcUrl = process.env.FLARE_RPC_URL || undefined;

// Initialize services
try {
  ftsoClient = new FTSOClient({
    network,
    rpcUrl,
    cacheTTL: 30,
    logger
  });

  priceWatcher = new FTSOPriceWatcher({
    network,
    rpcUrl,
    autoStart: false,
    detectSignificantMoves: true,
    detectStalePrices: true,
    logger
  });

  providerMonitor = new DataProviderMonitor({
    network,
    rpcUrl,
    autoStart: false,
    logger
  });

  logger.info('FTSO services initialized', { network });
} catch (error) {
  logger.error('Failed to initialize FTSO services', { error });
}

// ===============================
// PRICE ENDPOINTS
// ===============================

/**
 * GET /api/ftso/price/:symbol
 * Get current price for a specific symbol
 */
router.get('/price/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    // Validate symbol
    if (!isValidFTSOSymbol(symbol.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid FTSO symbol: ${symbol}. Use /api/ftso/symbols to get supported symbols.`
      });
    }

    // Get price
    const price = await ftsoClient.getCurrentPrice(symbol.toUpperCase());

    res.json({
      success: true,
      data: price,
      meta: {
        timestamp: new Date(),
        network
      }
    });
  } catch (error: any) {
    logger.error('Error fetching price', { symbol: req.params.symbol, error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch price'
    });
  }
});

/**
 * GET /api/ftso/prices
 * Get current prices for multiple symbols
 * Query params: symbols (comma-separated list)
 */
router.get('/prices', async (req: Request, res: Response) => {
  try {
    const symbolsParam = req.query.symbols as string;

    if (!symbolsParam) {
      return res.status(400).json({
        success: false,
        error: 'Missing symbols parameter. Provide comma-separated list of symbols.'
      });
    }

    // Parse symbols
    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase());

    // Validate symbols
    const invalidSymbols = symbols.filter(s => !isValidFTSOSymbol(s));
    if (invalidSymbols.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid symbols: ${invalidSymbols.join(', ')}`
      });
    }

    // Get prices
    const prices = await ftsoClient.getCurrentPrices(symbols);

    res.json({
      success: true,
      data: prices,
      meta: {
        timestamp: new Date(),
        network,
        count: prices.length
      }
    });
  } catch (error: any) {
    logger.error('Error fetching multiple prices', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch prices'
    });
  }
});

/**
 * GET /api/ftso/prices/all
 * Get current prices for all supported symbols
 */
router.get('/prices/all', async (req: Request, res: Response) => {
  try {
    const prices = await ftsoClient.getAllCurrentPrices();

    res.json({
      success: true,
      data: prices,
      meta: {
        timestamp: new Date(),
        network,
        count: prices.length
      }
    });
  } catch (error: any) {
    logger.error('Error fetching all prices', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch all prices'
    });
  }
});

/**
 * GET /api/ftso/price/:symbol/fresh
 * Get price with freshness validation
 * Query params: maxAge (seconds, default: 180)
 */
router.get('/price/:symbol/fresh', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;
    const maxAge = parseInt(req.query.maxAge as string) || 180;

    if (!isValidFTSOSymbol(symbol.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid FTSO symbol: ${symbol}`
      });
    }

    const price = await ftsoClient.getPriceWithFreshness(symbol.toUpperCase(), maxAge);

    res.json({
      success: true,
      data: price,
      meta: {
        timestamp: new Date(),
        network,
        maxAge
      }
    });
  } catch (error: any) {
    logger.error('Error fetching fresh price', { symbol: req.params.symbol, error });

    // Return 409 Conflict for stale prices
    const statusCode = error.code === 'STALE_PRICE' ? 409 : 500;

    res.status(statusCode).json({
      success: false,
      error: error.message || 'Failed to fetch fresh price',
      code: error.code
    });
  }
});

/**
 * GET /api/ftso/symbols
 * Get list of supported FTSO symbols
 */
router.get('/symbols', async (req: Request, res: Response) => {
  try {
    const symbols = await ftsoClient.getSupportedSymbols();

    res.json({
      success: true,
      data: symbols,
      meta: {
        timestamp: new Date(),
        network,
        count: symbols.length
      }
    });
  } catch (error: any) {
    logger.error('Error fetching symbols', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch symbols'
    });
  }
});

/**
 * GET /api/ftso/epoch/current
 * Get current price epoch ID
 */
router.get('/epoch/current', async (req: Request, res: Response) => {
  try {
    const epochId = await ftsoClient.getCurrentEpochId();

    res.json({
      success: true,
      data: {
        epochId,
        timestamp: Date.now()
      },
      meta: {
        timestamp: new Date(),
        network
      }
    });
  } catch (error: any) {
    logger.error('Error fetching current epoch', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch current epoch'
    });
  }
});

/**
 * GET /api/ftso/price/:symbol/epoch/:epochId
 * Get price for a specific epoch
 */
router.get('/price/:symbol/epoch/:epochId', async (req: Request, res: Response) => {
  try {
    const { symbol, epochId } = req.params;

    if (!isValidFTSOSymbol(symbol.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid FTSO symbol: ${symbol}`
      });
    }

    const price = await ftsoClient.getEpochPrice(
      symbol.toUpperCase(),
      parseInt(epochId)
    );

    res.json({
      success: true,
      data: price,
      meta: {
        timestamp: new Date(),
        network
      }
    });
  } catch (error: any) {
    logger.error('Error fetching epoch price', {
      symbol: req.params.symbol,
      epochId: req.params.epochId,
      error
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch epoch price'
    });
  }
});

// ===============================
// DATA PROVIDER ENDPOINTS
// ===============================

/**
 * GET /api/ftso/providers
 * Get list of all data providers
 * Query params: symbol (optional)
 */
router.get('/providers', async (req: Request, res: Response) => {
  try {
    const symbol = req.query.symbol as string | undefined;

    if (symbol && !isValidFTSOSymbol(symbol.toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid FTSO symbol: ${symbol}`
      });
    }

    const providers = await ftsoClient.getDataProviders(
      symbol ? symbol.toUpperCase() : undefined
    );

    res.json({
      success: true,
      data: providers,
      meta: {
        timestamp: new Date(),
        network,
        count: providers.length,
        symbol
      }
    });
  } catch (error: any) {
    logger.error('Error fetching providers', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch providers'
    });
  }
});

/**
 * GET /api/ftso/provider/:address
 * Get detailed information for a specific provider
 */
router.get('/provider/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Ethereum address format'
      });
    }

    const stats = await providerMonitor.getProviderStats(address);

    res.json({
      success: true,
      data: stats,
      meta: {
        timestamp: new Date(),
        network
      }
    });
  } catch (error: any) {
    logger.error('Error fetching provider stats', { address: req.params.address, error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch provider stats'
    });
  }
});

/**
 * GET /api/ftso/provider/:address/history
 * Get historical data for a provider
 * Query params: days (default: 7)
 */
router.get('/provider/:address/history', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const days = parseInt(req.query.days as string) || 7;

    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Ethereum address format'
      });
    }

    const history = await providerMonitor.getProviderHistory(address, days);

    res.json({
      success: true,
      data: history,
      meta: {
        timestamp: new Date(),
        network,
        days
      }
    });
  } catch (error: any) {
    logger.error('Error fetching provider history', {
      address: req.params.address,
      error
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch provider history'
    });
  }
});

/**
 * GET /api/ftso/providers/top
 * Get top providers by vote power
 * Query params: limit (default: 10)
 */
router.get('/providers/top', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;

    const topProviders = await providerMonitor.getTopProviders(limit);

    res.json({
      success: true,
      data: topProviders,
      meta: {
        timestamp: new Date(),
        network,
        limit
      }
    });
  } catch (error: any) {
    logger.error('Error fetching top providers', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch top providers'
    });
  }
});

// ===============================
// REGISTRY & SYSTEM ENDPOINTS
// ===============================

/**
 * GET /api/ftso/registry
 * Get FTSO registry information
 */
router.get('/registry', async (req: Request, res: Response) => {
  try {
    const registry = await ftsoClient.getFTSORegistry();

    res.json({
      success: true,
      data: {
        ...registry,
        ftsoContracts: Object.fromEntries(registry.ftsoContracts)
      },
      meta: {
        timestamp: new Date(),
        network
      }
    });
  } catch (error: any) {
    logger.error('Error fetching registry', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch registry'
    });
  }
});

/**
 * GET /api/ftso/health
 * Get FTSO system health status
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const isHealthy = await ftsoClient.isHealthy();

    res.json({
      success: true,
      data: {
        healthy: isHealthy,
        network,
        timestamp: Date.now()
      },
      meta: {
        timestamp: new Date(),
        network
      }
    });
  } catch (error: any) {
    logger.error('Error checking FTSO health', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check FTSO health'
    });
  }
});

/**
 * GET /api/ftso/stats
 * Get FTSO monitoring statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const watcherStats = priceWatcher.getStats();
    const providerStats = providerMonitor.getStats();

    res.json({
      success: true,
      data: {
        priceWatcher: watcherStats,
        providerMonitor: providerStats,
        network
      },
      meta: {
        timestamp: new Date(),
        network
      }
    });
  } catch (error: any) {
    logger.error('Error fetching stats', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch stats'
    });
  }
});

// ===============================
// PRICE WATCHER ENDPOINTS
// ===============================

/**
 * GET /api/ftso/watcher/symbols
 * Get list of currently watched symbols
 */
router.get('/watcher/symbols', (req: Request, res: Response) => {
  try {
    const watchedSymbols = priceWatcher.getWatchedSymbols();

    res.json({
      success: true,
      data: watchedSymbols,
      meta: {
        timestamp: new Date(),
        count: watchedSymbols.length
      }
    });
  } catch (error: any) {
    logger.error('Error getting watched symbols', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get watched symbols'
    });
  }
});

/**
 * POST /api/ftso/watcher/watch
 * Add symbol(s) to watch list
 * Body: { symbols: string[] }
 */
router.post('/watcher/watch', async (req: Request, res: Response) => {
  try {
    const { symbols } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'symbols must be a non-empty array'
      });
    }

    // Validate symbols
    const invalidSymbols = symbols.filter(s => !isValidFTSOSymbol(s.toUpperCase()));
    if (invalidSymbols.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid symbols: ${invalidSymbols.join(', ')}`
      });
    }

    // Add symbols to watch
    await priceWatcher.watchSymbols(symbols.map(s => s.toUpperCase()));

    res.json({
      success: true,
      data: {
        watchedSymbols: priceWatcher.getWatchedSymbols()
      },
      meta: {
        timestamp: new Date()
      }
    });
  } catch (error: any) {
    logger.error('Error adding symbols to watch', { error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to add symbols to watch'
    });
  }
});

/**
 * DELETE /api/ftso/watcher/unwatch/:symbol
 * Remove symbol from watch list
 */
router.delete('/watcher/unwatch/:symbol', async (req: Request, res: Response) => {
  try {
    const { symbol } = req.params;

    await priceWatcher.unwatchSymbol(symbol.toUpperCase());

    res.json({
      success: true,
      data: {
        watchedSymbols: priceWatcher.getWatchedSymbols()
      },
      meta: {
        timestamp: new Date()
      }
    });
  } catch (error: any) {
    logger.error('Error removing symbol from watch', { symbol: req.params.symbol, error });
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to remove symbol from watch'
    });
  }
});

// Export router and services for use in other modules
export default router;
export { ftsoClient, priceWatcher, providerMonitor };

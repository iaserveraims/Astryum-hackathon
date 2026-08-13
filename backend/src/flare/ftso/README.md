# FTSO Module - Flare Time Series Oracle Integration

## Overview

The FTSO (Flare Time Series Oracle) module provides real-time, decentralized price feeds from Flare Network's native oracle system. This module enables Astryum to access accurate price data for 30+ assets with 90-second update cycles, directly from the blockchain without external dependencies.

## What is FTSO?

FTSO is Flare Network's decentralized oracle system that provides price feeds through a network of independent data providers. Unlike centralized oracles, FTSO uses a weighted median approach where multiple providers submit prices, and the final price is determined through a decentralized consensus mechanism.

**Key Features:**
- **Decentralized**: No single point of failure
- **Fast Updates**: 90-second price epochs
- **Transparent**: All data providers and their performance are public
- **Accurate**: Weighted median from multiple sources
- **Native**: Built directly into Flare blockchain

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FTSO Module Architecture                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────────┐                │
│  │              │      │                  │                 │
│  │ FTSOClient   │◄─────┤  FTSO Contracts  │                │
│  │              │      │  (Flare Network) │                 │
│  └──────┬───────┘      └──────────────────┘                │
│         │                                                    │
│         ├────────► getCurrentPrice(symbol)                  │
│         ├────────► getCurrentPrices(symbols[])             │
│         ├────────► getDataProviders()                       │
│         └────────► getSupportedSymbols()                    │
│                                                              │
│  ┌──────────────────────────────────────────┐              │
│  │                                           │              │
│  │       FTSOPriceWatcher (EventEmitter)     │              │
│  │                                           │              │
│  │  Events:                                  │              │
│  │  • priceUpdate                            │              │
│  │  • significantMove (1%, 5%, 10%)          │              │
│  │  • stalePrice (age > 180s)                │              │
│  │                                           │              │
│  └────────┬──────────────────────────────────┘              │
│           │                                                  │
│           ▼                                                  │
│  ┌──────────────────┐     ┌─────────────────┐              │
│  │                  │     │                 │               │
│  │ WebSocket        │     │  Redis Cache    │               │
│  │ Broadcast        │     │  (30s TTL)      │               │
│  │                  │     │                 │               │
│  └──────────────────┘     └─────────────────┘              │
│                                                              │
│  ┌──────────────────────────────────────────┐              │
│  │                                           │              │
│  │     DataProviderMonitor                   │              │
│  │                                           │              │
│  │  • Track vote power                       │              │
│  │  • Calculate reliability (0-100)          │              │
│  │  • Monitor reward rates                   │              │
│  │  • 30-day historical data                 │              │
│  │                                           │              │
│  └───────────────────────────────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. FTSOClient

Core client for interacting with FTSO smart contracts.

**Purpose**: Fetch price data and provider information from Flare blockchain

**Key Methods**:
```typescript
// Price queries
await ftsoClient.getCurrentPrice('FLR');
await ftsoClient.getCurrentPrices(['FLR', 'XRP', 'BTC']);
await ftsoClient.getAllCurrentPrices();
await ftsoClient.getPriceWithFreshness('FLR', 180);

// Provider data
await ftsoClient.getDataProviders();
await ftsoClient.getProviderVotePower(address);

// System info
await ftsoClient.getSupportedSymbols();
await ftsoClient.getCurrentEpochId();
await ftsoClient.isHealthy();
```

**Features**:
- Ethers.js v6 integration
- Multi-network support (Flare, Songbird, Coston)
- Contract instance caching
- Symbol validation
- Freshness validation
- Comprehensive error handling

### 2. FTSOPriceWatcher

Real-time price monitoring with event emission.

**Purpose**: Watch price changes and emit events for significant movements

**Events**:
```typescript
watcher.on('priceUpdate', (event: PriceUpdateEvent) => {
  console.log(`${event.symbol}: $${event.newPrice}`);
});

watcher.on('significantMove', (event: SignificantMoveEvent) => {
  console.log(`ALERT: ${event.symbol} moved ${event.changePercent}%`);
});

watcher.on('stalePrice', (event: StalePriceEvent) => {
  console.warn(`${event.symbol} price is ${event.age}s old`);
});
```

**Features**:
- Automatic 90-second price updates
- Configurable movement thresholds (1%, 5%, 10%)
- Price history tracking (100 data points)
- Stale price detection
- Concurrent fetch optimization

### 3. DataProviderMonitor

Monitor and analyze FTSO data provider performance.

**Purpose**: Track provider reliability, vote power, and rewards

**Key Methods**:
```typescript
// Provider statistics
await monitor.getProviderStats(address);
await monitor.getAllProviderStats();
await monitor.getTopProviders(10);

// Performance metrics
await monitor.getProviderReliability(address);
await monitor.getProviderHistory(address, 7);
await monitor.getLowReliabilityProviders();
```

**Features**:
- Reliability scoring (0-100)
- Vote power tracking
- Historical data (30 days)
- Automatic updates (5 minutes)
- Performance alerts

## Supported Assets

The FTSO module supports 30+ asset price feeds:

### Cryptocurrencies
- **Native**: FLR (Flare), SGB (Songbird)
- **Major**: BTC, ETH, XRP, LTC, DOGE, ADA, ALGO, DOT, SOL, AVAX
- **DeFi**: MATIC, ARB, BNB, FIL
- **Layer 1**: BCH, DGB, XLM, XDC

### Stablecoins
- USDC, USDT

### Fiat Currencies
- USD, EUR, GBP, JPY, KRW

### Commodities
- XAU (Gold - Troy Ounce)
- XAG (Silver - Troy Ounce)

## Quick Start

### Installation

```typescript
import { FTSOClient, FTSOPriceWatcher, DataProviderMonitor } from './flare/ftso';
```

### Basic Usage

```typescript
// 1. Initialize client
const ftsoClient = new FTSOClient({
  network: 'flare',
  rpcUrl: 'https://flare-api.flare.network/ext/C/rpc',
  cacheTTL: 30
});

// 2. Get a price
const flrPrice = await ftsoClient.getCurrentPrice('FLR');
console.log(`FLR Price: $${flrPrice.priceUSD}`);
console.log(`Age: ${flrPrice.age}s`);
console.log(`Fresh: ${flrPrice.isFresh}`);

// 3. Get multiple prices
const prices = await ftsoClient.getCurrentPrices(['FLR', 'XRP', 'BTC']);
prices.forEach(price => {
  console.log(`${price.symbol}: $${price.priceUSD}`);
});
```

### Real-Time Monitoring

```typescript
// Initialize watcher
const watcher = new FTSOPriceWatcher({
  network: 'flare',
  autoStart: true,
  detectSignificantMoves: true,
  significantMoveThresholds: [1, 5, 10]
});

// Watch symbols
await watcher.watchSymbols(['FLR', 'XRP', 'BTC']);

// Listen for updates
watcher.on('priceUpdate', (event) => {
  console.log(`${event.symbol} updated: $${event.newPrice} (${event.changePercent.toFixed(2)}%)`);
});

watcher.on('significantMove', (event) => {
  console.log(`🚨 ${event.symbol} ${event.direction} ${event.changePercent.toFixed(2)}% (threshold: ${event.threshold}%)`);
});
```

### Provider Monitoring

```typescript
// Initialize monitor
const monitor = new DataProviderMonitor({
  network: 'flare',
  autoStart: true
});

// Get top providers
const topProviders = await monitor.getTopProviders(10);
topProviders.forEach((provider, index) => {
  console.log(`${index + 1}. ${provider.address}`);
  console.log(`   Vote Power: ${provider.votePowerPercentage.toFixed(2)}%`);
  console.log(`   Reliability: ${provider.reliability}/100`);
});

// Monitor specific provider
const stats = await monitor.getProviderStats('0x...');
console.log(`Reliability: ${stats.reliability}`);
console.log(`Success Rate: ${stats.successRate.toFixed(2)}%`);
```

## API Integration

### REST Endpoints

All FTSO functionality is exposed through REST API at `/api/ftso`:

```bash
# Get single price
GET /api/ftso/price/FLR

# Get multiple prices
GET /api/ftso/prices?symbols=FLR,XRP,BTC

# Get all prices
GET /api/ftso/prices/all

# Get fresh price (validated)
GET /api/ftso/price/FLR/fresh?maxAge=180

# Get supported symbols
GET /api/ftso/symbols

# Get data providers
GET /api/ftso/providers

# Get provider stats
GET /api/ftso/provider/0x.../

# Get system health
GET /api/ftso/health

# Get monitoring stats
GET /api/ftso/stats
```

### Example API Response

```json
{
  "success": true,
  "data": {
    "symbol": "FLR",
    "price": "25000000000",
    "decimals": 5,
    "priceUSD": "0.025",
    "timestamp": 1738454820,
    "age": 45,
    "isFresh": true,
    "epochId": 12345,
    "lastUpdate": "2026-02-02T10:30:00.000Z"
  },
  "meta": {
    "timestamp": "2026-02-02T10:30:45.000Z",
    "network": "flare"
  }
}
```

## Configuration

### FTSOClientConfig

```typescript
interface FTSOClientConfig {
  network: 'flare' | 'songbird' | 'coston';
  rpcUrl?: string; // Optional custom RPC
  cacheTTL?: number; // Cache duration (default: 30s)
  maxPriceAge?: number; // Max age for fresh prices (default: 180s)
  logger?: winston.Logger; // Custom logger
}
```

### FTSOPriceWatcherConfig

```typescript
interface FTSOPriceWatcherConfig extends FTSOClientConfig {
  updateInterval?: number; // Update frequency (default: 90000ms)
  detectSignificantMoves?: boolean; // Enable move detection (default: true)
  significantMoveThresholds?: number[]; // Thresholds (default: [1, 5, 10])
  detectStalePrices?: boolean; // Enable stale detection (default: true)
  stalePriceThreshold?: number; // Stale age (default: 180s)
  autoStart?: boolean; // Start on init (default: false)
  maxConcurrentFetches?: number; // Max concurrent requests (default: 10)
}
```

## Error Handling

### FTSOError

All errors are wrapped in `FTSOError` with detailed context:

```typescript
try {
  const price = await ftsoClient.getCurrentPrice('INVALID');
} catch (error) {
  if (error instanceof FTSOError) {
    console.error(`Error Code: ${error.code}`);
    console.error(`Message: ${error.message}`);
    console.error(`Symbol: ${error.symbol}`);
    console.error(`Details:`, error.details);
  }
}
```

### Error Codes

```typescript
enum FTSOErrorCode {
  NETWORK_ERROR,           // RPC connection failed
  INVALID_SYMBOL,          // Symbol not supported
  STALE_PRICE,            // Price too old
  CONTRACT_ERROR,          // Contract call failed
  PROVIDER_NOT_FOUND,      // Provider doesn't exist
  INVALID_CONFIGURATION,   // Bad config
  PRICE_NOT_AVAILABLE,     // Price not available
  RATE_LIMIT_EXCEEDED      // Too many requests
}
```

## Price Freshness

FTSO prices are considered "fresh" if their age is less than 180 seconds (3 minutes).

```typescript
const price = await ftsoClient.getCurrentPrice('FLR');

if (price.isFresh) {
  // Safe to use for critical operations
  console.log('Fresh price:', price.priceUSD);
} else {
  // Price is stale, may want to wait for update
  console.warn(`Stale price (age: ${price.age}s)`);
}

// Or use validation method
const freshPrice = await ftsoClient.getPriceWithFreshness('FLR', 120);
// Throws FTSOError with STALE_PRICE code if age > 120s
```

## Performance Considerations

### Caching

- **In-Memory**: Symbol lists and contract instances cached
- **TTL**: 30 seconds default (configurable)
- **Redis**: Ready for integration (pending)

### RPC Optimization

- **Batch Requests**: Multiple prices fetched concurrently
- **Rate Limiting**: Configurable max concurrent requests
- **Retry Logic**: Automatic retry with exponential backoff
- **Fallback RPC**: Multiple RPC URLs supported

### Best Practices

1. **Reuse Clients**: Create FTSOClient once, reuse for all queries
2. **Watch Selectively**: Only watch symbols you need
3. **Use Batch Methods**: `getCurrentPrices()` more efficient than multiple `getCurrentPrice()`
4. **Enable Caching**: Use default cache TTL unless real-time critical
5. **Monitor Freshness**: Always check `isFresh` for critical operations

## Integration Examples

### With FlareFinanceConnector

```typescript
import { FTSOClient } from '../flare/ftso';

class FlareFinanceConnector {
  private ftsoClient: FTSOClient;

  constructor() {
    this.ftsoClient = new FTSOClient({ network: 'flare' });
  }

  async getUserAccountData(userAddress: string) {
    // Get account data from lending protocol
    const accountData = await this.lendingPool.getUserAccountData(userAddress);

    // Get current FLR price from FTSO
    const flrPrice = await this.ftsoClient.getCurrentPrice('FLR');

    // Validate freshness
    if (!flrPrice.isFresh) {
      throw new Error('Cannot proceed with stale price data');
    }

    // Calculate USD values
    const collateralUSD = parseFloat(accountData.collateralETH) * parseFloat(flrPrice.priceUSD!);
    const debtUSD = parseFloat(accountData.debtETH) * parseFloat(flrPrice.priceUSD!);

    return {
      ...accountData,
      collateralUSD,
      debtUSD,
      flrPrice: flrPrice.priceUSD
    };
  }
}
```

### With WebSocket Broadcasting

```typescript
import { priceWatcher } from './routes/ftso';
import { webSocketManager } from './services/websocket/WebSocketManager';

// Connect watcher to WebSocket
priceWatcher.on('priceUpdate', (event) => {
  webSocketManager.emitToChannel(
    'ftso:prices',
    'ftso:priceUpdate',
    event,
    { symbol: event.symbol }
  );
});

priceWatcher.on('significantMove', (event) => {
  webSocketManager.broadcastSystemMessage('ftso:significantMove', {
    symbol: event.symbol,
    changePercent: event.changePercent,
    direction: event.direction,
    threshold: event.threshold
  });
});
```

## Testing

### Manual Testing

```bash
# Start backend server
cd backend
npm run dev

# Test endpoints
curl http://localhost:3001/api/ftso/health
curl http://localhost:3001/api/ftso/symbols
curl http://localhost:3001/api/ftso/price/FLR
curl "http://localhost:3001/api/ftso/prices?symbols=FLR,XRP,BTC"
```

### Unit Testing

```typescript
import { FTSOClient } from './FTSOClient';

describe('FTSOClient', () => {
  let client: FTSOClient;

  beforeEach(() => {
    client = new FTSOClient({ network: 'flare' });
  });

  it('should fetch current price', async () => {
    const price = await client.getCurrentPrice('FLR');
    expect(price.symbol).toBe('FLR');
    expect(price.priceUSD).toBeDefined();
    expect(parseFloat(price.priceUSD!)).toBeGreaterThan(0);
  });

  it('should validate symbol', async () => {
    await expect(client.getCurrentPrice('INVALID')).rejects.toThrow();
  });

  it('should detect stale prices', async () => {
    const price = await client.getCurrentPrice('FLR');
    expect(typeof price.isFresh).toBe('boolean');
    expect(typeof price.age).toBe('number');
  });
});
```

## Troubleshooting

### Common Issues

**Issue**: "Network error while communicating with FTSO"
- **Solution**: Check RPC URL, verify network connectivity

**Issue**: "Invalid FTSO symbol: XXX"
- **Solution**: Use `/api/ftso/symbols` to get supported symbols

**Issue**: "Price is stale (age: 300s)"
- **Solution**: Wait for next epoch update (90 seconds), or use less strict maxAge

**Issue**: "Rate limit exceeded"
- **Solution**: Reduce request frequency, implement caching

### Debug Logging

Enable debug logging:

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'debug', // Enable debug logs
  // ... other config
});

const client = new FTSOClient({
  network: 'flare',
  logger
});
```

## Environment Variables

```bash
# Required
FLARE_NETWORK=flare  # or 'songbird' or 'coston'

# Optional
FLARE_RPC_URL=https://flare-api.flare.network/ext/C/rpc
REDIS_URL=redis://localhost:6379
INFLUXDB_URL=http://localhost:8086
```

## Resources

- [Flare Network Documentation](https://docs.flare.network)
- [FTSO Overview](https://docs.flare.network/tech/ftso)
- [Data Provider Guide](https://docs.flare.network/tech/ftso/#data-providers)
- [Contract Addresses](https://docs.flare.network/dev/reference/contracts/)

## License

MIT

## Support

For issues or questions:
1. Check the documentation in `docs/FTSO-COMPLETE-IMPLEMENTATION.md`
2. Review example usage in this README
3. Check API endpoint responses for detailed error messages
4. Enable debug logging for troubleshooting

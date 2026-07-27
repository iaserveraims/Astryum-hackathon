-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'MAX');

-- CreateEnum
CREATE TYPE "ProtocolCategory" AS ENUM ('LENDING', 'DEX', 'STAKING', 'BRIDGE');

-- CreateEnum
CREATE TYPE "PositionKind" AS ENUM ('SUPPLY', 'BORROW', 'LP', 'STAKE', 'REWARD', 'FREE');

-- CreateEnum
CREATE TYPE "TxRecordStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntentAction" AS ENUM ('repay', 'addCollateral', 'withdraw', 'supply', 'borrow', 'harvest', 'exitLP', 'addLiquidity', 'swap', 'stake', 'unstake', 'crossChainSwap');

-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('building', 'proposed', 'expired', 'signed', 'broadcast', 'mempool', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('triggered', 'intent_prepared', 'user_acted', 'expired', 'error');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "xrplAddress" TEXT NOT NULL,
    "evmAddress" TEXT,
    "rootAddress" TEXT,
    "email" TEXT,
    "preferences" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletType" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "chainId" INTEGER,
    "nickname" TEXT,
    "isConnected" BOOLEAN NOT NULL DEFAULT true,
    "permissions" JSONB NOT NULL,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "triggers" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "riskLevel" TEXT,
    "expectedApy" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "protocol" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheck" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "instanceId" TEXT,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "triggerType" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "automationRunId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_confirmations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "asset" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_transaction_confirmations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchType" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "estimatedTotalGas" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "transactions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_transaction_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_executions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "asset" TEXT NOT NULL,
    "txHash" TEXT,
    "priority" TEXT NOT NULL,
    "gasUsed" INTEGER,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_executions" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "nodeId" TEXT,
    "status" TEXT NOT NULL,
    "context" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "strategy_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_optimizations" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currentPerformance" JSONB NOT NULL,
    "suggestedChanges" JSONB NOT NULL,
    "expectedImprovement" DOUBLE PRECISION,
    "riskReduction" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "implementedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_optimizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_strategies" (
    "id" TEXT NOT NULL,
    "originalStrategyId" TEXT,
    "authorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "riskLevel" TEXT NOT NULL,
    "expectedApy" DOUBLE PRECISION,
    "shareType" TEXT NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "triggers" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_metrics" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "tvl" DOUBLE PRECISION NOT NULL,
    "totalSupply" DOUBLE PRECISION,
    "totalBorrow" DOUBLE PRECISION,
    "utilizationRate" DOUBLE PRECISION,
    "averageApy" DOUBLE PRECISION,
    "healthStatus" TEXT NOT NULL,
    "lastUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "protocol_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_data" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "change24h" DOUBLE PRECISION,
    "volume24h" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "lastUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_positions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL,
    "apy" DOUBLE PRECISION,
    "healthFactor" DOUBLE PRECISION,
    "liquidationPrice" DOUBLE PRECISION,
    "lastUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "user_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_metrics" (
    "id" TEXT NOT NULL,
    "metricType" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT,
    "tags" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configurations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastTriggered" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "response" JSONB,
    "statusCode" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "activeUsers" INTEGER NOT NULL DEFAULT 0,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "totalStrategies" INTEGER NOT NULL DEFAULT 0,
    "activeStrategies" INTEGER NOT NULL DEFAULT 0,
    "newStrategies" INTEGER NOT NULL DEFAULT 0,
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTvl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageApy" DOUBLE PRECISION,
    "totalAlerts" INTEGER NOT NULL DEFAULT 0,
    "criticalAlerts" INTEGER NOT NULL DEFAULT 0,
    "apiRequests" INTEGER NOT NULL DEFAULT 0,
    "websocketConnections" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_metrics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalPortfolioValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPositions" INTEGER NOT NULL DEFAULT 0,
    "activeStrategies" INTEGER NOT NULL DEFAULT 0,
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "dailyVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageApy" DOUBLE PRECISION,
    "alertsGenerated" INTEGER NOT NULL DEFAULT 0,
    "sessionsCount" INTEGER NOT NULL DEFAULT 0,
    "apiRequestsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_integrations" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "capabilities" TEXT[],
    "contractAddress" TEXT,
    "apiEndpoint" TEXT,
    "lastSync" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "protocol_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_status" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chainId" INTEGER,
    "rpcUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "blockHeight" TEXT,
    "gasPrice" TEXT,
    "lastBlock" TIMESTAMP(3),
    "responseTime" INTEGER,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "targetId" TEXT,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "triggeredBy" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "emergency_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_metrics" (
    "id" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "userSatisfaction" DOUBLE PRECISION,
    "errorOccurred" BOOLEAN NOT NULL DEFAULT false,
    "errorType" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_entries" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "tags" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccess" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cache_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "language" TEXT NOT NULL DEFAULT 'en',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "notifications" JSONB NOT NULL,
    "alertSettings" JSONB NOT NULL,
    "dashboardLayout" JSONB,
    "tradingPreferences" JSONB,
    "privacySettings" JSONB,
    "advancedMode" BOOLEAN NOT NULL DEFAULT false,
    "betaFeatures" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "permissions" TEXT[],
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsed" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_events" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "blockNumber" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL,
    "eventData" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidation_watches" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "liquidationPrice" DOUBLE PRECISION NOT NULL,
    "healthFactor" DOUBLE PRECISION,
    "riskLevel" TEXT NOT NULL,
    "alertThreshold" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastCheck" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liquidation_watches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gas_prices" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "fast" TEXT NOT NULL,
    "instant" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gas_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_transactions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromNetwork" TEXT NOT NULL,
    "toNetwork" TEXT NOT NULL,
    "fromAsset" TEXT NOT NULL,
    "toAsset" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "bridgeProtocol" TEXT NOT NULL,
    "fromTxHash" TEXT,
    "toTxHash" TEXT,
    "status" TEXT NOT NULL,
    "estimatedTime" INTEGER,
    "actualTime" INTEGER,
    "fees" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "bridge_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletId" TEXT,
    "chainId" INTEGER,
    "totalValue" DOUBLE PRECISION NOT NULL,
    "totalUSD" DECIMAL(38,18),
    "positions" JSONB NOT NULL,
    "allocation" JSONB NOT NULL,
    "performance" JSONB NOT NULL,
    "riskMetrics" JSONB NOT NULL,
    "benchmarkDate" TIMESTAMP(3) NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "minCapital" DOUBLE PRECISION,
    "expectedApy" DOUBLE PRECISION,
    "targetProtocols" TEXT[],
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "triggers" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_data" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "volume24h" DOUBLE PRECISION,
    "marketCap" DOUBLE PRECISION,
    "change1h" DOUBLE PRECISION,
    "change24h" DOUBLE PRECISION,
    "change7d" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_tvl_history" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "tvl" DOUBLE PRECISION NOT NULL,
    "change24h" DOUBLE PRECISION,
    "change7d" DOUBLE PRECISION,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_tvl_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yield_opportunities" (
    "id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "apy" DOUBLE PRECISION NOT NULL,
    "tvl" DOUBLE PRECISION,
    "minDeposit" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUpdate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "yield_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_activities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "executed" BOOLEAN NOT NULL DEFAULT false,
    "executedAt" TIMESTAMP(3),
    "rollback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chains" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rpcHttp" TEXT NOT NULL,
    "rpcWs" TEXT,
    "explorer" TEXT NOT NULL,
    "blockTime" INTEGER NOT NULL,
    "nativeSymbol" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocols" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProtocolCategory" NOT NULL,
    "chainId" INTEGER NOT NULL,
    "riskTier" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "kind" "PositionKind" NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "amountUSD" DECIMAL(38,18) NOT NULL,
    "metadata" JSONB NOT NULL,
    "lastSeenBlock" BIGINT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_snapshots" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(38,18) NOT NULL,
    "amountUSD" DECIMAL(38,18) NOT NULL,
    "priceUSD" DECIMAL(38,18) NOT NULL,
    "hf" DOUBLE PRECISION,
    "ltv" DOUBLE PRECISION,
    "metricsJson" JSONB NOT NULL,

    CONSTRAINT "position_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_intents" (
    "id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" "IntentAction" NOT NULL,
    "protocolId" TEXT NOT NULL,
    "positionId" TEXT,
    "simulationResultId" TEXT,
    "inputs" JSONB NOT NULL,
    "preState" JSONB NOT NULL,
    "simulation" JSONB NOT NULL,
    "simulatedAt" TIMESTAMP(3) NOT NULL,
    "pricesFreshAt" TIMESTAMP(3) NOT NULL,
    "impact" JSONB NOT NULL,
    "riskDelta" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "txData" JSONB,
    "status" "IntentStatus" NOT NULL DEFAULT 'building',
    "txHash" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "blockNumber" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "simulation_results" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "positionId" TEXT,
    "input" JSONB NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "delta" JSONB NOT NULL,
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assumptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gasEstimate" TEXT NOT NULL,
    "gasEstimateUSD" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "pricesFreshAt" TIMESTAMP(3) NOT NULL,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "simulation_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_records" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "status" "TxRecordStatus" NOT NULL DEFAULT 'PENDING',
    "blockNumber" BIGINT,
    "gasUsed" BIGINT,
    "effectiveGasPrice" BIGINT,
    "error" TEXT,
    "receiptJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "transaction_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "protocolId" TEXT,
    "name" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 15,
    "maxValueUSD" DOUBLE PRECISION NOT NULL,
    "totalTimesTriggered" INTEGER NOT NULL DEFAULT 0,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "intentId" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggerData" JSONB NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'triggered',
    "notes" TEXT,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_recommendations" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkedIntentId" TEXT,
    "linkedRuleId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "ai_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_xrplAddress_key" ON "users"("xrplAddress");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "wallets_userId_chainId_idx" ON "wallets"("userId", "chainId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_address_network_key" ON "wallets"("userId", "address", "network");

-- CreateIndex
CREATE INDEX "alerts_userId_priority_acknowledged_idx" ON "alerts"("userId", "priority", "acknowledged");

-- CreateIndex
CREATE INDEX "alerts_walletId_acknowledged_idx" ON "alerts"("walletId", "acknowledged");

-- CreateIndex
CREATE INDEX "ai_conversations_userId_conversationId_createdAt_idx" ON "ai_conversations"("userId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "transaction_confirmations_userId_status_priority_idx" ON "transaction_confirmations"("userId", "status", "priority");

-- CreateIndex
CREATE INDEX "batch_transaction_confirmations_userId_status_priority_idx" ON "batch_transaction_confirmations"("userId", "status", "priority");

-- CreateIndex
CREATE INDEX "transaction_executions_userId_walletId_executedAt_idx" ON "transaction_executions"("userId", "walletId", "executedAt");

-- CreateIndex
CREATE INDEX "transaction_executions_txHash_idx" ON "transaction_executions"("txHash");

-- CreateIndex
CREATE INDEX "strategy_executions_strategyId_status_startedAt_idx" ON "strategy_executions"("strategyId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "strategy_optimizations_strategyId_status_createdAt_idx" ON "strategy_optimizations"("strategyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "shared_strategies_isPublic_likes_idx" ON "shared_strategies"("isPublic", "likes");

-- CreateIndex
CREATE INDEX "shared_strategies_riskLevel_likes_idx" ON "shared_strategies"("riskLevel", "likes");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_metrics_protocolId_key" ON "protocol_metrics"("protocolId");

-- CreateIndex
CREATE INDEX "protocol_metrics_protocolId_lastUpdate_idx" ON "protocol_metrics"("protocolId", "lastUpdate");

-- CreateIndex
CREATE UNIQUE INDEX "price_data_symbol_key" ON "price_data"("symbol");

-- CreateIndex
CREATE INDEX "price_data_symbol_lastUpdate_idx" ON "price_data"("symbol", "lastUpdate");

-- CreateIndex
CREATE INDEX "user_positions_userId_protocol_idx" ON "user_positions"("userId", "protocol");

-- CreateIndex
CREATE UNIQUE INDEX "user_positions_userId_protocol_network_asset_type_key" ON "user_positions"("userId", "protocol", "network", "asset", "type");

-- CreateIndex
CREATE INDEX "system_metrics_metricType_metricName_timestamp_idx" ON "system_metrics"("metricType", "metricName", "timestamp");

-- CreateIndex
CREATE INDEX "api_usage_userId_timestamp_idx" ON "api_usage"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "api_usage_endpoint_timestamp_idx" ON "api_usage"("endpoint", "timestamp");

-- CreateIndex
CREATE INDEX "security_events_userId_eventType_severity_timestamp_idx" ON "security_events"("userId", "eventType", "severity", "timestamp");

-- CreateIndex
CREATE INDEX "background_jobs_status_priority_scheduledAt_idx" ON "background_jobs"("status", "priority", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "configurations_key_key" ON "configurations"("key");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "rate_limits_identifier_windowStart_idx" ON "rate_limits"("identifier", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_identifier_endpoint_key" ON "rate_limits"("identifier", "endpoint");

-- CreateIndex
CREATE INDEX "audit_logs_userId_action_timestamp_idx" ON "audit_logs"("userId", "action", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_resource_timestamp_idx" ON "audit_logs"("resource", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_name_key" ON "feature_flags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_isActive_idx" ON "sessions"("userId", "isActive");

-- CreateIndex
CREATE INDEX "sessions_token_expiresAt_idx" ON "sessions"("token", "expiresAt");

-- CreateIndex
CREATE INDEX "webhooks_userId_isActive_idx" ON "webhooks"("userId", "isActive");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_delivered_createdAt_idx" ON "webhook_deliveries"("webhookId", "delivered", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_date_key" ON "daily_metrics"("date");

-- CreateIndex
CREATE INDEX "user_metrics_userId_date_idx" ON "user_metrics"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "user_metrics_userId_date_key" ON "user_metrics"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_integrations_protocolId_key" ON "protocol_integrations"("protocolId");

-- CreateIndex
CREATE UNIQUE INDEX "network_status_networkId_key" ON "network_status"("networkId");

-- CreateIndex
CREATE INDEX "emergency_actions_userId_actionType_createdAt_idx" ON "emergency_actions"("userId", "actionType", "createdAt");

-- CreateIndex
CREATE INDEX "ai_model_metrics_modelName_requestType_timestamp_idx" ON "ai_model_metrics"("modelName", "requestType", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "cache_entries_cacheKey_key" ON "cache_entries"("cacheKey");

-- CreateIndex
CREATE INDEX "cache_entries_expiresAt_idx" ON "cache_entries"("expiresAt");

-- CreateIndex
CREATE INDEX "cache_entries_tags_idx" ON "cache_entries"("tags");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_isActive_idx" ON "api_keys"("userId", "isActive");

-- CreateIndex
CREATE INDEX "contract_events_network_contractAddress_eventName_idx" ON "contract_events"("network", "contractAddress", "eventName");

-- CreateIndex
CREATE INDEX "contract_events_processed_createdAt_idx" ON "contract_events"("processed", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contract_events_transactionHash_logIndex_key" ON "contract_events"("transactionHash", "logIndex");

-- CreateIndex
CREATE INDEX "liquidation_watches_isActive_riskLevel_lastCheck_idx" ON "liquidation_watches"("isActive", "riskLevel", "lastCheck");

-- CreateIndex
CREATE UNIQUE INDEX "liquidation_watches_userId_protocol_network_asset_key" ON "liquidation_watches"("userId", "protocol", "network", "asset");

-- CreateIndex
CREATE INDEX "gas_prices_network_timestamp_idx" ON "gas_prices"("network", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "gas_prices_network_timestamp_key" ON "gas_prices"("network", "timestamp");

-- CreateIndex
CREATE INDEX "bridge_transactions_userId_status_createdAt_idx" ON "bridge_transactions"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_userId_createdAt_idx" ON "portfolio_snapshots"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_walletId_takenAt_idx" ON "portfolio_snapshots"("walletId", "takenAt");

-- CreateIndex
CREATE INDEX "strategy_templates_category_riskLevel_isPublic_idx" ON "strategy_templates"("category", "riskLevel", "isPublic");

-- CreateIndex
CREATE INDEX "strategy_templates_rating_usageCount_idx" ON "strategy_templates"("rating", "usageCount");

-- CreateIndex
CREATE INDEX "market_data_symbol_timestamp_idx" ON "market_data"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "market_data_symbol_timestamp_key" ON "market_data"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "protocol_tvl_history_protocolId_timestamp_idx" ON "protocol_tvl_history"("protocolId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "protocol_tvl_history_protocolId_timestamp_key" ON "protocol_tvl_history"("protocolId", "timestamp");

-- CreateIndex
CREATE INDEX "yield_opportunities_apy_riskScore_isActive_idx" ON "yield_opportunities"("apy", "riskScore", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "yield_opportunities_protocol_network_asset_category_key" ON "yield_opportunities"("protocol", "network", "asset", "category");

-- CreateIndex
CREATE INDEX "user_activities_userId_timestamp_idx" ON "user_activities"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "user_activities_activity_timestamp_idx" ON "user_activities"("activity", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "migrations_name_key" ON "migrations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "chains_chainId_key" ON "chains"("chainId");

-- CreateIndex
CREATE UNIQUE INDEX "protocols_slug_key" ON "protocols"("slug");

-- CreateIndex
CREATE INDEX "protocols_chainId_category_isActive_idx" ON "protocols"("chainId", "category", "isActive");

-- CreateIndex
CREATE INDEX "positions_walletId_kind_idx" ON "positions"("walletId", "kind");

-- CreateIndex
CREATE INDEX "positions_protocolId_kind_idx" ON "positions"("protocolId", "kind");

-- CreateIndex
CREATE INDEX "positions_chainId_walletId_idx" ON "positions"("chainId", "walletId");

-- CreateIndex
CREATE INDEX "position_snapshots_positionId_takenAt_idx" ON "position_snapshots"("positionId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_intents_txHash_key" ON "transaction_intents"("txHash");

-- CreateIndex
CREATE INDEX "transaction_intents_owner_status_idx" ON "transaction_intents"("owner", "status");

-- CreateIndex
CREATE INDEX "transaction_intents_status_expiresAt_idx" ON "transaction_intents"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "transaction_intents_walletId_createdAt_idx" ON "transaction_intents"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "simulation_results_walletAddress_createdAt_idx" ON "simulation_results"("walletAddress", "createdAt");

-- CreateIndex
CREATE INDEX "simulation_results_positionId_idx" ON "simulation_results"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_intentId_key" ON "transaction_records"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_records_txHash_key" ON "transaction_records"("txHash");

-- CreateIndex
CREATE INDEX "transaction_records_walletAddress_createdAt_idx" ON "transaction_records"("walletAddress", "createdAt");

-- CreateIndex
CREATE INDEX "automation_rules_walletId_enabled_idx" ON "automation_rules"("walletId", "enabled");

-- CreateIndex
CREATE INDEX "automation_runs_ruleId_triggeredAt_idx" ON "automation_runs"("ruleId", "triggeredAt");

-- CreateIndex
CREATE INDEX "ai_recommendations_walletId_createdAt_idx" ON "ai_recommendations"("walletId", "createdAt");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "chains"("chainId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instances" ADD CONSTRAINT "instances_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "automation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_confirmations" ADD CONSTRAINT "transaction_confirmations_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_executions" ADD CONSTRAINT "transaction_executions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_executions" ADD CONSTRAINT "transaction_executions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_executions" ADD CONSTRAINT "strategy_executions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_optimizations" ADD CONSTRAINT "strategy_optimizations_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_strategies" ADD CONSTRAINT "shared_strategies_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "chains"("chainId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "chains"("chainId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "protocols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "chains"("chainId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_snapshots" ADD CONSTRAINT "position_snapshots_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "chains"("chainId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "protocols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_intents" ADD CONSTRAINT "transaction_intents_simulationResultId_fkey" FOREIGN KEY ("simulationResultId") REFERENCES "simulation_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_records" ADD CONSTRAINT "transaction_records_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "transaction_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "protocols"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "transaction_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_linkedIntentId_fkey" FOREIGN KEY ("linkedIntentId") REFERENCES "transaction_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_recommendations" ADD CONSTRAINT "ai_recommendations_linkedRuleId_fkey" FOREIGN KEY ("linkedRuleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

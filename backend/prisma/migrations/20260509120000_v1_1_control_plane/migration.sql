-- V1.1 Control Plane baseline: Mandate (PolicyGuard) + ActivityEvent (canonical timeline)
-- + RewardEvent (canonical rewards aggregator). Hand-authored from prisma/schema.prisma
-- because models were added after Prisma was last connected to a live DB.
-- Apply with: npx prisma migrate deploy

-- CreateTable
CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "scope" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "approvals" JSONB NOT NULL,
    "signature" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mandates_userId_active_idx" ON "mandates"("userId", "active");

-- CreateIndex
CREATE INDEX "mandates_expiresAt_idx" ON "mandates"("expiresAt");

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 14,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL DEFAULT 0,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "type" TEXT NOT NULL,
    "protocol" TEXT,
    "assetIn" JSONB,
    "assetOut" JSONB,
    "source" JSONB NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_events_wallet_txHash_logIndex_key" ON "activity_events"("wallet", "txHash", "logIndex");

-- CreateIndex
CREATE INDEX "activity_events_wallet_timestamp_idx" ON "activity_events"("wallet", "timestamp");

-- CreateIndex
CREATE INDEX "activity_events_wallet_type_idx" ON "activity_events"("wallet", "type");

-- CreateIndex
CREATE INDEX "activity_events_blockNumber_idx" ON "activity_events"("blockNumber");

-- CreateTable
CREATE TABLE "reward_events" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL DEFAULT 14,
    "source" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "assetAddress" TEXT,
    "amount" TEXT NOT NULL,
    "amountUSD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "blockNumber" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "sourceRecord" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reward_events_wallet_source_providerId_blockNumber_key" ON "reward_events"("wallet", "source", "providerId", "blockNumber");

-- CreateIndex
CREATE INDEX "reward_events_wallet_source_idx" ON "reward_events"("wallet", "source");

-- CreateIndex
CREATE INDEX "reward_events_wallet_claimedAt_idx" ON "reward_events"("wallet", "claimedAt");

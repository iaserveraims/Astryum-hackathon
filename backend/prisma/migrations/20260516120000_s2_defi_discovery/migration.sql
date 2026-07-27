-- V1.1 S2 — Read Layer: DeFi Interaction + Verified Position Engine
-- Additive only. Existing tables untouched except two nullable columns on defi_positions.

-- AlterTable: additive nullable columns (existing rows unaffected)
ALTER TABLE "defi_positions" ADD COLUMN "confidenceLevel" TEXT;
ALTER TABLE "defi_positions" ADD COLUMN "sourceProvider" TEXT;

-- CreateTable: protocol contract registry (DefiLlama discovery)
CREATE TABLE "protocol_contracts" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "protocolSlug" TEXT NOT NULL,
    "protocolName" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "chainName" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "auditCount" INTEGER NOT NULL DEFAULT 0,
    "auditLinks" JSONB,
    "sourceUrl" TEXT,
    "trustLevel" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "protocol_contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "protocol_contracts_chainId_contractAddress_key" ON "protocol_contracts"("chainId", "contractAddress");
CREATE INDEX "protocol_contracts_chainId_protocolSlug_idx" ON "protocol_contracts"("chainId", "protocolSlug");
CREATE INDEX "protocol_contracts_protocolSlug_idx" ON "protocol_contracts"("protocolSlug");

-- CreateTable: DeFi interactions (wallet touched a known contract; not an open position)
CREATE TABLE "defi_interactions" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "protocol" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "interactionType" TEXT NOT NULL,
    "confidenceScore" INTEGER NOT NULL DEFAULT 0,
    "confidenceLevel" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "defi_interactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "defi_interactions_watchlistId_txHash_contractAddress_key" ON "defi_interactions"("watchlistId", "txHash", "contractAddress");
CREATE INDEX "defi_interactions_watchlistId_chainId_protocol_idx" ON "defi_interactions"("watchlistId", "chainId", "protocol");

-- AddForeignKey
ALTER TABLE "defi_interactions" ADD CONSTRAINT "defi_interactions_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "wallet_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

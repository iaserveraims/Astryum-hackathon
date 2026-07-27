-- Compensating migration: creates wallet_watchlist, defi_positions, protocol_contracts,
-- and defi_interactions tables if they don't yet exist.
-- The 20260516120000_v1_1_s2_defi_discovery migration failed in some environments
-- because it tried to ALTER TABLE defi_positions before creating it.
-- All statements are IF NOT EXISTS — safe to re-run.

-- CreateTable: wallet_watchlist
CREATE TABLE IF NOT EXISTS "wallet_watchlist" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "address"      TEXT NOT NULL,
    "label"        TEXT,
    "chainId"      INTEGER NOT NULL,
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_watchlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "wallet_watchlist_userId_address_chainId_key"
    ON "wallet_watchlist"("userId", "address", "chainId");
CREATE INDEX IF NOT EXISTS "wallet_watchlist_userId_isActive_idx"
    ON "wallet_watchlist"("userId", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'wallet_watchlist_userId_fkey'
  ) THEN
    ALTER TABLE "wallet_watchlist"
      ADD CONSTRAINT "wallet_watchlist_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateTable: defi_positions
CREATE TABLE IF NOT EXISTS "defi_positions" (
    "id"              TEXT NOT NULL,
    "watchlistId"     TEXT NOT NULL,
    "chainId"         INTEGER NOT NULL,
    "protocol"        TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "contractType"    TEXT NOT NULL,
    "asset"           TEXT NOT NULL,
    "amount"          DECIMAL(65,30) NOT NULL,
    "valueUSD"        DECIMAL(65,30) NOT NULL DEFAULT 0,
    "confidenceScore" INTEGER NOT NULL DEFAULT 100,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'verified',
    "sourceProvider"  TEXT NOT NULL DEFAULT 'internal',
    "metrics"         JSONB,
    "riskLevel"       TEXT,
    "detectedAt"      TIMESTAMP(3) NOT NULL,
    "lastUpdatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "defi_positions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "defi_positions_watchlistId_chainId_protocol_idx"
    ON "defi_positions"("watchlistId", "chainId", "protocol");
CREATE INDEX IF NOT EXISTS "defi_positions_chainId_confidenceScore_idx"
    ON "defi_positions"("chainId", "confidenceScore");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'defi_positions_watchlistId_fkey'
  ) THEN
    ALTER TABLE "defi_positions"
      ADD CONSTRAINT "defi_positions_watchlistId_fkey"
      FOREIGN KEY ("watchlistId") REFERENCES "wallet_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Ensure confidenceLevel and sourceProvider exist (idempotent)
ALTER TABLE "defi_positions"
  ADD COLUMN IF NOT EXISTS "confidenceLevel" TEXT NOT NULL DEFAULT 'verified',
  ADD COLUMN IF NOT EXISTS "sourceProvider"  TEXT NOT NULL DEFAULT 'internal';

-- CreateTable: protocol_contracts
CREATE TABLE IF NOT EXISTS "protocol_contracts" (
    "id"              TEXT NOT NULL,
    "providerId"      TEXT NOT NULL,
    "protocolSlug"    TEXT NOT NULL,
    "protocolName"    TEXT NOT NULL,
    "chainId"         INTEGER NOT NULL,
    "chainName"       TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "category"        TEXT NOT NULL,
    "auditCount"      INTEGER NOT NULL DEFAULT 0,
    "auditLinks"      JSONB,
    "sourceUrl"       TEXT,
    "trustLevel"      TEXT NOT NULL DEFAULT 'indexer_verified',
    "lastSyncedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "protocol_contracts_chainId_contractAddress_key"
    ON "protocol_contracts"("chainId", "contractAddress");
CREATE INDEX IF NOT EXISTS "protocol_contracts_chainId_idx"
    ON "protocol_contracts"("chainId");
CREATE INDEX IF NOT EXISTS "protocol_contracts_protocolSlug_idx"
    ON "protocol_contracts"("protocolSlug");
CREATE INDEX IF NOT EXISTS "protocol_contracts_contractAddress_idx"
    ON "protocol_contracts"("contractAddress");

-- CreateTable: defi_interactions
CREATE TABLE IF NOT EXISTS "defi_interactions" (
    "id"              TEXT NOT NULL,
    "watchlistId"     TEXT NOT NULL,
    "chainId"         INTEGER NOT NULL,
    "protocol"        TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "txHash"          TEXT NOT NULL,
    "interactionType" TEXT NOT NULL,
    "confidenceScore" INTEGER NOT NULL DEFAULT 50,
    "confidenceLevel" TEXT NOT NULL DEFAULT 'detected',
    "sourceProvider"  TEXT NOT NULL,
    "firstSeenAt"     TIMESTAMP(3) NOT NULL,
    "lastSeenAt"      TIMESTAMP(3) NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "defi_interactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "defi_interactions_watchlistId_txHash_contractAddress_key"
    ON "defi_interactions"("watchlistId", "txHash", "contractAddress");
CREATE INDEX IF NOT EXISTS "defi_interactions_watchlistId_chainId_idx"
    ON "defi_interactions"("watchlistId", "chainId");
CREATE INDEX IF NOT EXISTS "defi_interactions_watchlistId_protocol_idx"
    ON "defi_interactions"("watchlistId", "protocol");
CREATE INDEX IF NOT EXISTS "defi_interactions_chainId_protocol_idx"
    ON "defi_interactions"("chainId", "protocol");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'defi_interactions_watchlistId_fkey'
  ) THEN
    ALTER TABLE "defi_interactions"
      ADD CONSTRAINT "defi_interactions_watchlistId_fkey"
      FOREIGN KEY ("watchlistId") REFERENCES "wallet_watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

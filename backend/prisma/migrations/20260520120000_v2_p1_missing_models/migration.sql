-- Migration: v2_p1_missing_models
-- Adds tables present in schema.prisma that had no migration yet:
--   protocol_pools, intent_authorization_sessions, partner_intents,
--   regulated_partner_sessions, tax_events
-- Also adds cooldownSeconds, feeType, referralCode to protocol_pools (P1.2).
-- All statements use IF NOT EXISTS — safe to re-run.

-- ============================================================================
-- protocol_pools
-- Synced from DefiLlama. isAllowlisted drives Safe Markets UI.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "protocol_pools" (
    "id"               TEXT NOT NULL,
    "contractAddress"  TEXT,
    "chain"            TEXT NOT NULL,
    "chainId"          INTEGER NOT NULL,
    "protocol"         TEXT NOT NULL,
    "protocolName"     TEXT NOT NULL,
    "symbol"           TEXT NOT NULL,
    "tvlUsd"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    "apyBase"          DOUBLE PRECISION,
    "apyReward"        DOUBLE PRECISION,
    "apyTotal"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "underlyingTokens" JSONB NOT NULL DEFAULT '[]',
    "rewardTokens"     JSONB NOT NULL DEFAULT '[]',
    "category"         TEXT,
    "isLiquidStaking"  BOOLEAN NOT NULL DEFAULT false,
    "ltv"              DOUBLE PRECISION,
    "ilRisk"           TEXT,
    "url"              TEXT,
    "isAudited"        BOOLEAN NOT NULL DEFAULT false,
    "isAllowlisted"    BOOLEAN NOT NULL DEFAULT false,
    "cooldownSeconds"  INTEGER,
    "feeType"          TEXT,
    "referralCode"     INTEGER,
    "lastSyncedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_pools_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "protocol_pools_chainId_apyTotal_idx"
    ON "protocol_pools"("chainId", "apyTotal");

CREATE INDEX IF NOT EXISTS "protocol_pools_isAllowlisted_chainId_idx"
    ON "protocol_pools"("isAllowlisted", "chainId");

-- Add new V2 columns if table already exists from an earlier migration
ALTER TABLE "protocol_pools"
    ADD COLUMN IF NOT EXISTS "cooldownSeconds" INTEGER,
    ADD COLUMN IF NOT EXISTS "feeType"         TEXT,
    ADD COLUMN IF NOT EXISTS "referralCode"    INTEGER;

-- ============================================================================
-- intent_authorization_sessions
-- Created by RegulatedRelayBoundary. DeFiBro stores payloadHash but NEVER txHash.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "intent_authorization_sessions" (
    "id"                  TEXT NOT NULL,
    "userId"              TEXT NOT NULL,
    "intentPayloadId"     TEXT NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'pending_user_review',
    "payloadHash"         TEXT NOT NULL,
    "authorizationProof"  JSONB,
    "cancelReason"        TEXT,
    "expiresAt"           TIMESTAMP(3) NOT NULL,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intent_authorization_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "intent_authorization_sessions_userId_status_idx"
    ON "intent_authorization_sessions"("userId", "status");

CREATE INDEX IF NOT EXISTS "intent_authorization_sessions_status_expiresAt_idx"
    ON "intent_authorization_sessions"("status", "expiresAt");

-- ============================================================================
-- partner_intents
-- MoonPay buy/sell flow. defibroExecutes and defibroCustody are ALWAYS false.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "partner_intents" (
    "id"                         TEXT NOT NULL,
    "userId"                     TEXT NOT NULL,
    "transactionIntentId"        TEXT,
    "partnerId"                  TEXT NOT NULL,
    "asset"                      TEXT NOT NULL,
    "fiatAmount"                 DECIMAL(65,30),
    "fiatCurrency"               TEXT,
    "destinationAddress"         TEXT NOT NULL,
    "destinationChainId"         INTEGER NOT NULL,
    "partnerExecutes"            BOOLEAN NOT NULL DEFAULT true,
    "defibroExecutes"            BOOLEAN NOT NULL DEFAULT false,
    "defibroCustody"             BOOLEAN NOT NULL DEFAULT false,
    "defibroOrderTransmission"   BOOLEAN NOT NULL DEFAULT false,
    "userConfirmedInsidePartner" BOOLEAN NOT NULL DEFAULT false,
    "partnerTermsAccepted"       BOOLEAN NOT NULL DEFAULT false,
    "status"                     TEXT NOT NULL,
    "partnerOrderId"             TEXT,
    "txHash"                     TEXT,
    "createdAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "partner_intents_transactionIntentId_key"
    ON "partner_intents"("transactionIntentId")
    WHERE "transactionIntentId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "partner_intents_partnerOrderId_key"
    ON "partner_intents"("partnerOrderId")
    WHERE "partnerOrderId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "partner_intents_userId_status_idx"
    ON "partner_intents"("userId", "status");

CREATE INDEX IF NOT EXISTS "partner_intents_partnerId_createdAt_idx"
    ON "partner_intents"("partnerId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'partner_intents_userId_fkey'
  ) THEN
    ALTER TABLE "partner_intents"
      ADD CONSTRAINT "partner_intents_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'partner_intents_transactionIntentId_fkey'
  ) THEN
    ALTER TABLE "partner_intents"
      ADD CONSTRAINT "partner_intents_transactionIntentId_fkey"
      FOREIGN KEY ("transactionIntentId") REFERENCES "transaction_intents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- regulated_partner_sessions
-- One-to-one with partner_intents. Stores MoonPay session URL and status.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "regulated_partner_sessions" (
    "id"                TEXT NOT NULL,
    "partnerIntentId"   TEXT NOT NULL,
    "partnerId"         TEXT NOT NULL,
    "partnerSessionId"  TEXT NOT NULL,
    "partnerSessionUrl" TEXT NOT NULL,
    "status"            TEXT NOT NULL,
    "rawWebhookData"    JSONB,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"         TIMESTAMP(3) NOT NULL,
    "completedAt"       TIMESTAMP(3),

    CONSTRAINT "regulated_partner_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "regulated_partner_sessions_partnerIntentId_key"
    ON "regulated_partner_sessions"("partnerIntentId");

CREATE UNIQUE INDEX IF NOT EXISTS "regulated_partner_sessions_partnerSessionId_key"
    ON "regulated_partner_sessions"("partnerSessionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'regulated_partner_sessions_partnerIntentId_fkey'
  ) THEN
    ALTER TABLE "regulated_partner_sessions"
      ADD CONSTRAINT "regulated_partner_sessions_partnerIntentId_fkey"
      FOREIGN KEY ("partnerIntentId") REFERENCES "partner_intents"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- tax_events
-- Immutable factual log of every on-chain event with tax relevance.
-- No calculations — only raw facts.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "tax_events" (
    "id"                TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "walletId"          TEXT,
    "eventType"         TEXT NOT NULL,
    "assetIn"           TEXT NOT NULL,
    "amountIn"          DECIMAL(65,30) NOT NULL,
    "assetOut"          TEXT NOT NULL,
    "amountOut"         DECIMAL(65,30) NOT NULL,
    "fiatValueEstimate" DECIMAL(65,30) NOT NULL,
    "fiatCurrency"      TEXT NOT NULL,
    "fee"               DECIMAL(65,30),
    "feeAsset"          TEXT,
    "partnerOrderId"    TEXT,
    "transactionHash"   TEXT,
    "source"            TEXT NOT NULL,
    "userVerified"      BOOLEAN NOT NULL DEFAULT false,
    "userNotes"         TEXT,
    "timestamp"         TIMESTAMP(3) NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tax_events_userId_timestamp_idx"
    ON "tax_events"("userId", "timestamp");

CREATE INDEX IF NOT EXISTS "tax_events_assetIn_assetOut_timestamp_idx"
    ON "tax_events"("assetIn", "assetOut", "timestamp");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tax_events_userId_fkey'
  ) THEN
    ALTER TABLE "tax_events"
      ADD CONSTRAINT "tax_events_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'tax_events_walletId_fkey'
  ) THEN
    ALTER TABLE "tax_events"
      ADD CONSTRAINT "tax_events_walletId_fkey"
      FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

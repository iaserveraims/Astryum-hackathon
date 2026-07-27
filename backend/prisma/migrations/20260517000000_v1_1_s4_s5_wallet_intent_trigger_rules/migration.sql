-- Migration: v1_1_s4_s5_wallet_intent_trigger_rules
-- Adds WalletIntent (S4) and TriggerRule (S5) tables.
-- Both tables are purely additive — no existing table is modified.

-- ============================================================================
-- S4: wallet_intents
-- Unsigned transactions prepared by DeFiBro for user-controlled wallets.
-- DeFiBro NEVER signs. walletAddress MUST be user-controlled.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "wallet_intents" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "walletAddress"  TEXT NOT NULL,
    "chainId"        INTEGER NOT NULL,
    "to"             TEXT NOT NULL,
    "calldata"       TEXT NOT NULL,
    "value"          TEXT NOT NULL DEFAULT '0',
    "gasLimit"       TEXT NOT NULL,
    "nonce"          INTEGER,
    "status"         TEXT NOT NULL DEFAULT 'draft',
    "sourceIntentId" TEXT,
    "fee"            TEXT,
    "feeAsset"       TEXT,
    "note"           TEXT,
    "txHash"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"      TIMESTAMP(3) NOT NULL,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_intents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "wallet_intents_userId_status_idx"
    ON "wallet_intents"("userId", "status");

CREATE INDEX IF NOT EXISTS "wallet_intents_walletAddress_chainId_idx"
    ON "wallet_intents"("walletAddress", "chainId");

-- ============================================================================
-- S5: trigger_rules
-- User-defined trigger rules evaluated by IntentTriggerService.
-- Triggers send NOTIFICATIONS only — never auto-execute or auto-open MoonPay.
-- ============================================================================
CREATE TABLE IF NOT EXISTS "trigger_rules" (
    "id"                   TEXT NOT NULL,
    "userId"               TEXT NOT NULL,
    "name"                 TEXT NOT NULL,
    "description"          TEXT,
    "enabled"              BOOLEAN NOT NULL DEFAULT true,
    "conditionType"        TEXT NOT NULL,
    "conditionParams"      JSONB NOT NULL,
    "notificationTemplate" TEXT,
    "cooldownMinutes"      INTEGER NOT NULL DEFAULT 60,
    "lastFiredAt"          TIMESTAMP(3),
    "timesTriggered"       INTEGER NOT NULL DEFAULT 0,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trigger_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trigger_rules_userId_enabled_idx"
    ON "trigger_rules"("userId", "enabled");

-- FK from trigger_rules to users
ALTER TABLE "trigger_rules"
    ADD CONSTRAINT "trigger_rules_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

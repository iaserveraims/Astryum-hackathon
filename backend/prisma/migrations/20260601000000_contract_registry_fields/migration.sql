-- Block F (2026-06-01) — ContractRegistry fields on ProtocolPool.
--
-- Adds the columns that the new ContractRegistry / ABIResolver pipeline writes.
-- All columns are nullable or default-valued so the migration is non-breaking
-- for existing rows. The PoolIngestionService backfills them at the next cron
-- tick (every 6h) and at non-blocking server bootstrap.

ALTER TABLE "protocol_pools"
  ADD COLUMN "interactionContractAddress" TEXT,
  ADD COLUMN "receiptTokenAddress"        TEXT,
  ADD COLUMN "contractKind"               TEXT,
  ADD COLUMN "abi"                        JSONB,
  ADD COLUMN "abiSource"                  TEXT,
  ADD COLUMN "abiResolvedAt"              TIMESTAMP(3),
  ADD COLUMN "abiResolutionAttempts"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "abiResolutionLastError"     TEXT,
  ADD COLUMN "supportsSupply"             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsWithdraw"           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsBorrowCapability"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsRepay"              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsStake"              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsUnstake"            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsAddLiquidity"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsRemoveLiquidity"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsVaultDeposit"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "supportsVaultWithdraw"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isUpgradeable"              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isActive"                   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "inactiveReason"             TEXT,
  ADD COLUMN "lastVerifiedAt"             TIMESTAMP(3);

CREATE INDEX "protocol_pools_isActive_chainId_idx"
  ON "protocol_pools" ("isActive", "chainId");

CREATE INDEX "protocol_pools_contractKind_idx"
  ON "protocol_pools" ("contractKind");

CREATE INDEX "protocol_pools_interactionContractAddress_chainId_idx"
  ON "protocol_pools" ("interactionContractAddress", "chainId");

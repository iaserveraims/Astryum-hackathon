-- Migration: v2_p10_5_protocol_contract_records
-- Adds table for dynamically integrated protocol execution configs (P10.5).
-- Each row is one protocol+chain combo that the admin integrated via
-- POST /api/admin/protocols/integrate (ABI auto-fetched from DefiLlama / Etherscan).
-- CalldataBuilder uses these records as a fallback when the protocol is not in
-- the static protocolContracts.ts registry.

CREATE TABLE IF NOT EXISTS "protocol_contract_records" (
    "id"            TEXT NOT NULL,
    "slug"          TEXT NOT NULL,
    "chainId"       INTEGER NOT NULL,
    "address"       TEXT NOT NULL,
    "abi"           JSONB NOT NULL DEFAULT '[]',
    "actions"       JSONB NOT NULL DEFAULT '{}',
    "feeType"       TEXT NOT NULL DEFAULT 'none',
    "referralValue" TEXT,
    "cooldownDays"  INTEGER,
    "source"        TEXT NOT NULL DEFAULT 'manual',
    "addedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_contract_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "protocol_contract_records_slug_chainId_key"
    ON "protocol_contract_records"("slug", "chainId");

CREATE INDEX IF NOT EXISTS "protocol_contract_records_slug_idx"
    ON "protocol_contract_records"("slug");

CREATE INDEX IF NOT EXISTS "protocol_contract_records_address_idx"
    ON "protocol_contract_records"("address");

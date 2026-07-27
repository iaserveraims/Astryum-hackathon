-- Block G (2026-06-02) — Unified Wallet model + IntentBundle/BundleStep.
--
-- 1. Extends `wallets` with `ecosystem`, `isPrimary`, `purpose`.
-- 2. Backfills `ecosystem` from `caip2`/`network` for existing rows.
-- 3. Marks the most recent wallet per (userId, ecosystem) as isPrimary=true.
-- 4. Creates a PARTIAL unique index to enforce 1 primary wallet per ecosystem
--    per user (no global unique on isPrimary which would be too strict).
-- 5. Migrates `wallet_watchlist` rows to `wallets` with purpose='watch'.
--    Existing watchlist table is NOT dropped (deprecated, kept for rollback).
-- 6. Creates `intent_bundles` and `bundle_steps` tables.

-- ── 1+2. Wallet columns + ecosystem backfill ────────────────────────────────
ALTER TABLE "wallets"
  ADD COLUMN "ecosystem" TEXT NOT NULL DEFAULT 'evm',
  ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "purpose"   TEXT    NOT NULL DEFAULT 'sign';

-- Derive ecosystem from caip2 prefix first (canonical); fallback to network label.
UPDATE "wallets"
SET "ecosystem" = CASE
  WHEN "caip2" LIKE 'eip155:%'  THEN 'evm'
  WHEN "caip2" LIKE 'solana:%'  THEN 'solana'
  WHEN "caip2" LIKE 'xrpl:%'    THEN 'xrpl'
  WHEN "caip2" LIKE 'aptos:%'   THEN 'aptos'
  WHEN "caip2" LIKE 'cosmos:%'  THEN 'cosmos'
  WHEN LOWER("network") IN ('xrpl', 'xrp', 'ripple') THEN 'xrpl'
  WHEN LOWER("network") IN ('solana', 'sol')          THEN 'solana'
  WHEN LOWER("network") IN ('aptos')                  THEN 'aptos'
  WHEN LOWER("network") IN ('cosmos', 'osmosis')      THEN 'cosmos'
  ELSE 'evm'
END;

-- ── 3. isPrimary backfill: most recent wallet per (userId, ecosystem) ───────
-- We use lastActivity as the recency signal. Ties broken by createdAt.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "userId", "ecosystem"
           ORDER BY "lastActivity" DESC, "createdAt" DESC
         ) AS rn
  FROM "wallets"
)
UPDATE "wallets" w
SET "isPrimary" = true
FROM ranked
WHERE w.id = ranked.id AND ranked.rn = 1;

-- ── 4. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX "wallets_userId_ecosystem_isPrimary_idx"
  ON "wallets" ("userId", "ecosystem", "isPrimary");

CREATE INDEX "wallets_userId_purpose_idx"
  ON "wallets" ("userId", "purpose");

-- Partial unique: exactly one primary wallet per (userId, ecosystem).
CREATE UNIQUE INDEX "wallets_one_primary_per_user_ecosystem"
  ON "wallets" ("userId", "ecosystem")
  WHERE "isPrimary" = true;

-- ── 5. Migrate wallet_watchlist → wallets (purpose='watch') ─────────────────
-- For each watchlist row: if a wallet with the same (userId, address, network)
-- already exists, mark its purpose='both'. Otherwise insert a new wallet row.
-- We use network = chainId::text as a fallback "network" string for legacy
-- compatibility with the existing @@unique([userId, address, network]).
INSERT INTO "wallets" (
  "id", "userId", "walletType", "address", "network", "chainId",
  "isConnected", "permissions", "ecosystem", "isPrimary", "purpose",
  "lastActivity", "createdAt", "updatedAt"
)
SELECT
  'watch_' || w.id,
  w."userId",
  'manual',                                            -- watchlist had no walletType
  w."address",
  COALESCE('chain_' || w."chainId", 'unknown'),
  w."chainId",
  false,
  '{}'::jsonb,
  CASE
    WHEN w."chainId" > 0 THEN 'evm'
    ELSE 'evm'                                         -- default; non-EVM watchlist is rare
  END,
  false,                                               -- not primary; existing sign wallet wins
  'watch',
  COALESCE(w."lastSyncedAt", w."createdAt"),
  w."createdAt",
  w."updatedAt"
FROM "wallet_watchlist" w
WHERE NOT EXISTS (
  SELECT 1 FROM "wallets" e
  WHERE e."userId"  = w."userId"
    AND LOWER(e."address") = LOWER(w."address")
    AND (e."chainId" = w."chainId" OR e."chainId" IS NULL)
)
ON CONFLICT ("userId", "address", "network") DO NOTHING;

-- Existing wallets that ALSO appeared in watchlist get purpose='both'.
UPDATE "wallets" w
SET "purpose" = 'both'
WHERE w."purpose" = 'sign'
  AND EXISTS (
    SELECT 1 FROM "wallet_watchlist" wl
    WHERE wl."userId" = w."userId"
      AND LOWER(wl."address") = LOWER(w."address")
      AND wl."chainId" = w."chainId"
  );

-- ── 6. IntentBundle + BundleStep tables ─────────────────────────────────────
CREATE TABLE "intent_bundles" (
  "id"              TEXT      NOT NULL,
  "userId"          TEXT      NOT NULL,
  "kind"            TEXT      NOT NULL,
  "status"          TEXT      NOT NULL DEFAULT 'pending',
  "resolvedContext" JSONB     NOT NULL,
  "currentStepIdx"  INTEGER   NOT NULL DEFAULT 0,
  "totalSteps"      INTEGER   NOT NULL,
  "failureReason"   TEXT,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "intent_bundles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intent_bundles_userId_status_idx"
  ON "intent_bundles" ("userId", "status");
CREATE INDEX "intent_bundles_status_expiresAt_idx"
  ON "intent_bundles" ("status", "expiresAt");

ALTER TABLE "intent_bundles"
  ADD CONSTRAINT "intent_bundles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bundle_steps" (
  "id"                    TEXT      NOT NULL,
  "bundleId"              TEXT      NOT NULL,
  "stepIdx"               INTEGER   NOT NULL,
  "intentId"              TEXT,
  "signerWalletId"        TEXT      NOT NULL,
  "stepKind"              TEXT      NOT NULL,
  "partnerId"             TEXT      NOT NULL,
  "confirmationCriteria"  JSONB     NOT NULL,
  "txHash"                TEXT,
  "confirmedAt"           TIMESTAMP(3),
  "status"                TEXT      NOT NULL DEFAULT 'pending',
  "failureReason"         TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bundle_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bundle_steps_bundleId_stepIdx_key"
  ON "bundle_steps" ("bundleId", "stepIdx");
CREATE INDEX "bundle_steps_status_idx"
  ON "bundle_steps" ("status");
CREATE INDEX "bundle_steps_bundleId_status_idx"
  ON "bundle_steps" ("bundleId", "status");

ALTER TABLE "bundle_steps"
  ADD CONSTRAINT "bundle_steps_bundleId_fkey"
  FOREIGN KEY ("bundleId") REFERENCES "intent_bundles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bundle_steps"
  ADD CONSTRAINT "bundle_steps_signerWalletId_fkey"
  FOREIGN KEY ("signerWalletId") REFERENCES "wallets"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bundle_steps"
  ADD CONSTRAINT "bundle_steps_intentId_fkey"
  FOREIGN KEY ("intentId") REFERENCES "transaction_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

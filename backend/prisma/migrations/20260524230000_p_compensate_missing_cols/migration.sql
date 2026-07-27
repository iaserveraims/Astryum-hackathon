-- Compensating migration: add columns that exist in schema.prisma but have no migration.
-- All statements use ADD COLUMN IF NOT EXISTS or DO $$ BEGIN ... END $$ — safe to re-run.

-- ============================================================================
-- 1. users — KYC / Identity fields (Persona provider)
--    These were added to schema.prisma in FASE 7 but no migration was created.
-- ============================================================================
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "kycVerified"      BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "kycTier"          TEXT         NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "kycLevel"         TEXT,
  ADD COLUMN IF NOT EXISTS "kycVerifiedAt"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "kycProvider"      TEXT,
  ADD COLUMN IF NOT EXISTS "personaInquiryId" TEXT;

-- ============================================================================
-- 2. wallet_bindings — KYC linkage fields
--    p17_wallet_binding migration created the table without these two columns.
-- ============================================================================
ALTER TABLE "wallet_bindings"
  ADD COLUMN IF NOT EXISTS "kycLinked"   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "kycLinkedAt" TIMESTAMP(3);

-- ============================================================================
-- 3. users — unique index on xrplAddress
--    Schema has @unique but the baseline created it as NOT NULL without an index.
--    The 20260524000000_xrpl_address_optional migration made it nullable but
--    did not explicitly create the unique index.
--    Use a partial unique index (NULLs are excluded) to match Prisma's behaviour.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'users_xrplAddress_key'
  ) THEN
    CREATE UNIQUE INDEX "users_xrplAddress_key"
      ON "users"("xrplAddress")
      WHERE "xrplAddress" IS NOT NULL;
  END IF;
END $$;

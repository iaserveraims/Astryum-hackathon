-- OAuth identity (2026-07-23): Google/Apple sign-in lands on the same users
-- table. authProvider records HOW the account was created; oauthSub anchors
-- the provider subject ("google:<sub>" / "apple:<sub>"); emailVerified is the
-- provider's attestation.

ALTER TABLE "users" ADD COLUMN "authProvider" TEXT NOT NULL DEFAULT 'email';
ALTER TABLE "users" ADD COLUMN "oauthSub" TEXT;
ALTER TABLE "users" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "users_oauthSub_key" ON "users"("oauthSub");

-- Backfill provenance for pre-existing rows: accounts without a password were
-- created by a wallet flow (SIWE/Xaman); everything else came through the
-- email+password door.
UPDATE "users" SET "authProvider" = 'wallet' WHERE "passwordHash" IS NULL;

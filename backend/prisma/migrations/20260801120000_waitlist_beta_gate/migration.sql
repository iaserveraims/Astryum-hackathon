-- Beta gate (2026-08-01): approval state on the waitlist.
--
-- First real migration in the repo: the schema has historically been applied
-- with `prisma db push`, so this file must be safe to run against a database
-- that already matches schema.prisma in every OTHER respect — hence additive
-- only, and IF NOT EXISTS so an environment where someone already db-pushed
-- these columns still boots clean (start.sh aborts the deploy on failure).
ALTER TABLE "waitlist_signups" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "waitlist_signups" ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);

-- P0-5 — Enable Row Level Security on every app table in `public`.
--
-- WHY: Supabase exposes the `public` schema through its Data API (PostgREST) to
-- the `anon` / `authenticated` roles. A table WITHOUT RLS is world-readable (and
-- possibly writable) via that API. Enabling RLS with NO permissive policy makes
-- the default DENY for those roles.
--
-- SAFE FOR THE BACKEND: we use ENABLE (not FORCE) ROW LEVEL SECURITY. The table
-- OWNER bypasses RLS, and the backend connects as the owner (the `postgres` role
-- on Supabase poolers), so the app keeps full access. FORCE would also block the
-- owner — do NOT use it here.
--   ⚠ If after this migration the backend gets "permission denied", your
--   DATABASE_URL/DIRECT_URL role is NOT the table owner — fix the role (or grant
--   BYPASSRLS) rather than weakening this migration.
--
-- Idempotent: ENABLE RLS is a no-op if already enabled; role REVOKEs are guarded
-- by role existence so this also runs on a plain Postgres without Supabase roles.

-- 1) RLS on every public table (excluding Prisma's internal bookkeeping table).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '\_prisma%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;

-- 2) Belt-and-suspenders: revoke any direct grants from the Data API roles, and
--    stop future tables from being granted to them by default. Guarded so a
--    non-Supabase Postgres (no anon/authenticated roles) doesn't error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;

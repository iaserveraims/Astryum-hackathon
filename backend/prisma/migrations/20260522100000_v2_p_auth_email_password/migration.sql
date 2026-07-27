-- Migration: v2_p_auth_email_password
-- Adds email+password auth fields to User and refresh token to Session.
-- All new columns are nullable so SIWE-only users are unaffected.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "passwordHash"        TEXT,
  ADD COLUMN IF NOT EXISTS "resetToken"          TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "resetTokenExpiresAt" TIMESTAMP(3);

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "refreshToken" TEXT UNIQUE;

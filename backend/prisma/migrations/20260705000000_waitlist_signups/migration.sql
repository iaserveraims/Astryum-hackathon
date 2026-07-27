-- Early-access waitlist: public email capture from the landing's /early-access page.
-- Minimal data on purpose (email + door + language) — no tracking payloads.

CREATE TABLE "waitlist_signups" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'early-access',
    "lang" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_signups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "waitlist_signups_email_key" ON "waitlist_signups"("email");

CREATE INDEX "waitlist_signups_createdAt_idx" ON "waitlist_signups"("createdAt");

-- P0-5 policy: every new public-schema table ships with RLS enabled so the
-- Supabase Data API (anon/authenticated) gets default-DENY. The backend
-- connects as the table owner and is unaffected (ENABLE, not FORCE).
ALTER TABLE "waitlist_signups" ENABLE ROW LEVEL SECURITY;

-- The governed-account registry — the authority switcher's server-side list.
-- A row is a pointer the user placed (which council-governed accounts they
-- govern/observe); account state is always read fresh from the ledger.

-- CreateTable
CREATE TABLE "governed_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ecosystem" TEXT NOT NULL DEFAULT 'xrpl',
    "address" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "governed_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "governed_accounts_userId_idx" ON "governed_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "governed_accounts_userId_ecosystem_address_key" ON "governed_accounts"("userId", "ecosystem", "address");

-- AddForeignKey
ALTER TABLE "governed_accounts" ADD CONSTRAINT "governed_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- P0-5 pattern: new public tables enable RLS (default DENY for the Data API
-- roles; the backend connects as table owner and bypasses it).
ALTER TABLE "governed_accounts" ENABLE ROW LEVEL SECURITY;

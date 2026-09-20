-- AlterTable
ALTER TABLE "ManagerPublicProfile" ADD COLUMN "actorKind" TEXT NOT NULL DEFAULT 'human';

-- CreateTable
CREATE TABLE "ManagerEndorsement" (
    "userId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerEndorsement_pkey" PRIMARY KEY ("userId","account")
);

-- CreateIndex
CREATE INDEX "ManagerEndorsement_account_idx" ON "ManagerEndorsement"("account");

-- CreateTable
CREATE TABLE "VaultImage" (
    "pote" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "emblem" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultImage_pkey" PRIMARY KEY ("pote")
);

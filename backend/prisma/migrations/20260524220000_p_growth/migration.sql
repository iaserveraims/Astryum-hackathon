-- P-GROWTH: Manager Onboarding + Referral Flywheel
-- Adds application workflow to ManagerProfile + ManagerReferral + ReferralConversion tables

-- Extend manager_profiles with application workflow fields
ALTER TABLE "manager_profiles" ADD COLUMN "status"            TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "manager_profiles" ADD COLUMN "applicationNote"   TEXT;
ALTER TABLE "manager_profiles" ADD COLUMN "approvedAt"        TIMESTAMP(3);
ALTER TABLE "manager_profiles" ADD COLUMN "approvedBy"        TEXT;
ALTER TABLE "manager_profiles" ADD COLUMN "isFoundingManager" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "manager_profiles_status_idx" ON "manager_profiles"("status");

-- ManagerReferral: unique referral link per manager
CREATE TABLE "manager_referrals" (
    "id"         TEXT NOT NULL,
    "managerId"  TEXT NOT NULL,
    "code"       TEXT NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manager_referrals_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "manager_referrals_managerId_key" ON "manager_referrals"("managerId");
CREATE UNIQUE INDEX "manager_referrals_code_key" ON "manager_referrals"("code");
ALTER TABLE "manager_referrals" ADD CONSTRAINT "manager_referrals_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "manager_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReferralConversion: funnel tracking per referred user
CREATE TABLE "referral_conversions" (
    "id"             TEXT NOT NULL,
    "referralId"     TEXT NOT NULL,
    "referredUserId" TEXT,
    "goalRequestId"  TEXT,
    "mandateId"      TEXT,
    "stage"          TEXT NOT NULL,
    "payoutUSD"      DOUBLE PRECISION,
    "paidAt"         TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    CONSTRAINT "referral_conversions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "referral_conversions_referredUserId_key" ON "referral_conversions"("referredUserId");
CREATE INDEX "referral_conversions_referralId_idx" ON "referral_conversions"("referralId");
CREATE INDEX "referral_conversions_referredUserId_idx" ON "referral_conversions"("referredUserId");
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_referralId_fkey"
    FOREIGN KEY ("referralId") REFERENCES "manager_referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- P-DELEGATION: Manager Marketplace + Delegation Infrastructure
-- Adds 8 new tables + extends GoalRequest with fullProposals relation

-- ManagerProfile: a user registers as a portfolio manager
CREATE TABLE "manager_profiles" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "displayName"  TEXT NOT NULL,
    "bio"          TEXT,
    "licenseType"  TEXT NOT NULL DEFAULT 'individual',
    "kycAt"        TIMESTAMP(3),
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "manager_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "manager_profiles_userId_key" ON "manager_profiles"("userId");
CREATE INDEX "manager_profiles_isActive_idx" ON "manager_profiles"("isActive");

-- ManagerProposal: full proposal (replaces lightweight ManagerProposalV1)
CREATE TABLE "manager_proposals" (
    "id"              TEXT NOT NULL,
    "goalRequestId"   TEXT NOT NULL,
    "managerId"       TEXT NOT NULL,
    "strategy"        TEXT NOT NULL,
    "primaryIntents"  JSONB NOT NULL,
    "feeModel"        TEXT,
    "aiExplanation"   TEXT,
    "proposedMandate" JSONB NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "manager_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "manager_proposals_goalRequestId_status_idx" ON "manager_proposals"("goalRequestId", "status");
CREATE INDEX "manager_proposals_managerId_idx" ON "manager_proposals"("managerId");

-- BackupStrategy: defensive actions triggered automatically when conditions are met
CREATE TABLE "backup_strategies" (
    "id"                TEXT NOT NULL,
    "proposalId"        TEXT NOT NULL,
    "triggers"          JSONB NOT NULL,
    "defensiveIntents"  JSONB NOT NULL,
    "activationMode"    TEXT NOT NULL DEFAULT 'notify',
    "preAuthExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_strategies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "backup_strategies_proposalId_key" ON "backup_strategies"("proposalId");

-- ConditionalAuthorization: pre-signed consent for backup strategy execution
CREATE TABLE "conditional_authorizations" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "backupStrategyId" TEXT NOT NULL,
    "signedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'active',
    "revokedAt"        TIMESTAMP(3),
    "lastRenewedAt"    TIMESTAMP(3),
    CONSTRAINT "conditional_authorizations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "conditional_authorizations_userId_status_idx" ON "conditional_authorizations"("userId", "status");
CREATE INDEX "conditional_authorizations_backupStrategyId_idx" ON "conditional_authorizations"("backupStrategyId");

-- DelegationMandate: active authorization scope for a manager acting on user's behalf
CREATE TABLE "delegation_mandates" (
    "id"               TEXT NOT NULL,
    "userId"           TEXT NOT NULL,
    "managerId"        TEXT NOT NULL,
    "proposalId"       TEXT NOT NULL,
    "allowedProtocols" TEXT[],
    "maxCapitalUSD"    DOUBLE PRECISION NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'active',
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"        TIMESTAMP(3),
    "revokedAt"        TIMESTAMP(3),
    CONSTRAINT "delegation_mandates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "delegation_mandates_proposalId_key" ON "delegation_mandates"("proposalId");
CREATE INDEX "delegation_mandates_userId_status_idx" ON "delegation_mandates"("userId", "status");
CREATE INDEX "delegation_mandates_managerId_status_idx" ON "delegation_mandates"("managerId", "status");

-- TrackRecord: daily/monthly performance snapshot per manager
CREATE TABLE "track_records" (
    "id"                   TEXT NOT NULL,
    "managerId"            TEXT NOT NULL,
    "period"               TEXT NOT NULL,
    "apy"                  DOUBLE PRECISION NOT NULL DEFAULT 0,
    "backupActivations"    INTEGER NOT NULL DEFAULT 0,
    "capitalPreservedRate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "zeroLiquidations"     BOOLEAN NOT NULL DEFAULT true,
    "clientRetention"      DOUBLE PRECISION NOT NULL DEFAULT 1,
    "clientCount"          INTEGER NOT NULL DEFAULT 0,
    "computedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "track_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "track_records_managerId_period_key" ON "track_records"("managerId", "period");
CREATE INDEX "track_records_managerId_idx" ON "track_records"("managerId");

-- DelegationAuditEntry: immutable log of every manager action within a mandate
CREATE TABLE "delegation_audit_entries" (
    "id"              TEXT NOT NULL,
    "mandateId"       TEXT NOT NULL,
    "action"          TEXT NOT NULL,
    "by"              TEXT NOT NULL,
    "timestamp"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intentId"        TEXT,
    "onChainVerified" BOOLEAN NOT NULL DEFAULT false,
    "metadata"        JSONB,
    CONSTRAINT "delegation_audit_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "delegation_audit_entries_mandateId_idx" ON "delegation_audit_entries"("mandateId");
CREATE INDEX "delegation_audit_entries_by_idx" ON "delegation_audit_entries"("by");

-- BatchProposal: manager sends one strategy template to N clients at once
CREATE TABLE "batch_proposals" (
    "id"            TEXT NOT NULL,
    "managerId"     TEXT NOT NULL,
    "templateData"  JSONB NOT NULL,
    "targetGoalIds" TEXT[],
    "sentCount"     INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "status"        TEXT NOT NULL DEFAULT 'draft',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "batch_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "batch_proposals_managerId_idx" ON "batch_proposals"("managerId");

-- Foreign keys
ALTER TABLE "manager_profiles" ADD CONSTRAINT "manager_profiles_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "manager_proposals" ADD CONSTRAINT "manager_proposals_goalRequestId_fkey"
    FOREIGN KEY ("goalRequestId") REFERENCES "goal_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "backup_strategies" ADD CONSTRAINT "backup_strategies_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "manager_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conditional_authorizations" ADD CONSTRAINT "conditional_authorizations_backupStrategyId_fkey"
    FOREIGN KEY ("backupStrategyId") REFERENCES "backup_strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delegation_mandates" ADD CONSTRAINT "delegation_mandates_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delegation_mandates" ADD CONSTRAINT "delegation_mandates_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delegation_mandates" ADD CONSTRAINT "delegation_mandates_proposalId_fkey"
    FOREIGN KEY ("proposalId") REFERENCES "manager_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "track_records" ADD CONSTRAINT "track_records_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "manager_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "delegation_audit_entries" ADD CONSTRAINT "delegation_audit_entries_mandateId_fkey"
    FOREIGN KEY ("mandateId") REFERENCES "delegation_mandates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "batch_proposals" ADD CONSTRAINT "batch_proposals_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "manager_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

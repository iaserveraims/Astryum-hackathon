-- P-GOALS-LAYER migration
-- Creates: goal_requests, manager_filters, manager_proposals_v1

CREATE TABLE "goal_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "targetMonthlyUSD" DOUBLE PRECISION NOT NULL,
    "riskTolerance" TEXT NOT NULL,
    "timeHorizon" TEXT,
    "capitalSnapshot" JSONB NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'open',
    "targetManagerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "feasible" BOOLEAN,
    "requiredAPY" DOUBLE PRECISION,
    "realisticMonthlyUSD" DOUBLE PRECISION,
    "feasibilityNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    CONSTRAINT "goal_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manager_filters" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "minCapitalUSD" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxCapitalUSD" DOUBLE PRECISION,
    "acceptedRiskLevels" TEXT[] DEFAULT ARRAY['low','medium','high']::TEXT[],
    "preferredChains" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "maxActiveDelegations" INTEGER NOT NULL DEFAULT 10,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "manager_filters_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manager_proposals_v1" (
    "id" TEXT NOT NULL,
    "goalRequestId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "feeModel" TEXT,
    "aiExplanation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "manager_proposals_v1_pkey" PRIMARY KEY ("id")
);

-- Unique and index constraints
CREATE UNIQUE INDEX "manager_filters_userId_key" ON "manager_filters"("userId");
CREATE INDEX "goal_requests_userId_status_idx" ON "goal_requests"("userId", "status");
CREATE INDEX "manager_filters_isActive_idx" ON "manager_filters"("isActive");
CREATE INDEX "manager_proposals_v1_goalRequestId_status_idx" ON "manager_proposals_v1"("goalRequestId", "status");
CREATE INDEX "manager_proposals_v1_managerId_idx" ON "manager_proposals_v1"("managerId");

-- Foreign keys
ALTER TABLE "goal_requests" ADD CONSTRAINT "goal_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "manager_filters" ADD CONSTRAINT "manager_filters_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "manager_proposals_v1" ADD CONSTRAINT "manager_proposals_v1_goalRequestId_fkey"
    FOREIGN KEY ("goalRequestId") REFERENCES "goal_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

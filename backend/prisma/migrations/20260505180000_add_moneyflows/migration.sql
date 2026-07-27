-- CreateTable
CREATE TABLE "money_flows" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "triggers" JSONB,
    "userAddresses" JSONB,
    "walletBindings" JSONB,
    "metadata" JSONB,
    "clonedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "money_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "money_flows_ownerId_updatedAt_idx" ON "money_flows"("ownerId", "updatedAt");
CREATE INDEX "money_flows_ownerId_name_idx" ON "money_flows"("ownerId", "name");

-- CreateTable
CREATE TABLE "money_flow_runs" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "versionId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'dev',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "params" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "events" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "money_flow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "money_flow_runs_flowId_createdAt_idx" ON "money_flow_runs"("flowId", "createdAt");
CREATE INDEX "money_flow_runs_status_idx" ON "money_flow_runs"("status");

-- AddForeignKey
ALTER TABLE "money_flow_runs" ADD CONSTRAINT "money_flow_runs_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "money_flows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "money_flow_groups" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#22c55e',
    "icon" TEXT NOT NULL DEFAULT 'strategy',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "moneyFlowIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "walletIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalTVL" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPnL24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPnLPercentage24h" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weightedAPR" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "alertCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "money_flow_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "money_flow_groups_userId_updatedAt_idx" ON "money_flow_groups"("userId", "updatedAt");

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "instances" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "strategies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settings" JSONB,
    "stats" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspaces_userId_type_idx" ON "workspaces"("userId", "type");

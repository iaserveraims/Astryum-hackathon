-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "fellBack" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_traceId_idx" ON "audit_events"("traceId");

-- CreateIndex
CREATE INDEX "audit_events_providerId_timestamp_idx" ON "audit_events"("providerId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_events_capability_timestamp_idx" ON "audit_events"("capability", "timestamp");

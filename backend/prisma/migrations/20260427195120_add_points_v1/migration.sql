-- CreateTable
CREATE TABLE "points_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "power" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "points_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "points_ledgers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "pointsDelta" INTEGER NOT NULL,
    "powerDelta" INTEGER NOT NULL,
    "creditsDelta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "points_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gamification_badges" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "criteria" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gamification_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_badges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeCode" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "points_accounts_userId_key" ON "points_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "points_ledgers_idempotencyKey_key" ON "points_ledgers"("idempotencyKey");

-- CreateIndex
CREATE INDEX "points_ledgers_userId_createdAt_idx" ON "points_ledgers"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "points_ledgers_eventType_createdAt_idx" ON "points_ledgers"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gamification_badges_code_key" ON "gamification_badges"("code");

-- CreateIndex
CREATE INDEX "user_badges_userId_idx" ON "user_badges"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeCode_key" ON "user_badges"("userId", "badgeCode");

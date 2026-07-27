-- Step-Up Signature Locks (configurable, opt-in) + Passkey/WebAuthn credentials.
-- Both tables are additive and isolated behind their own feature flags
-- (STEP_UP_ENABLED, NEXT_PUBLIC_PASSKEY_ENABLED) — no existing behaviour changes.

-- CreateTable: per-user step-up lock configuration
CREATE TABLE "step_up_lock_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "grantTtlSeconds" INTEGER NOT NULL DEFAULT 300,
    "matrix" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "step_up_lock_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: passkey (WebAuthn) credentials, one per device
CREATE TABLE "passkey_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceLabel" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "passkey_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "step_up_lock_configs_userId_key" ON "step_up_lock_configs"("userId");
CREATE UNIQUE INDEX "passkey_credentials_credentialId_key" ON "passkey_credentials"("credentialId");
CREATE INDEX "passkey_credentials_userId_idx" ON "passkey_credentials"("userId");

-- AddForeignKey
ALTER TABLE "step_up_lock_configs" ADD CONSTRAINT "step_up_lock_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passkey_credentials" ADD CONSTRAINT "passkey_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

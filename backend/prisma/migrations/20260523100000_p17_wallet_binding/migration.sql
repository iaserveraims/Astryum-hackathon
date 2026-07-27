-- P17 — Wallet Binding: proven ownership via signature
-- mode 'read' = monitor only · 'read_and_receive' = eligible for DeFi/transfer actions

CREATE TABLE "wallet_bindings" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "address"        TEXT NOT NULL,
    "chainType"      TEXT NOT NULL,
    "label"          TEXT,
    "mode"           TEXT NOT NULL DEFAULT 'read',
    "signatureProof" TEXT NOT NULL,
    "isActive"       BOOLEAN NOT NULL DEFAULT true,
    "linkedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"     TIMESTAMP(3),

    CONSTRAINT "wallet_bindings_pkey" PRIMARY KEY ("id")
);

-- Unique: one binding per (user, address, chainType)
CREATE UNIQUE INDEX "wallet_bindings_userId_address_chainType_key"
    ON "wallet_bindings"("userId", "address", "chainType");

CREATE INDEX "wallet_bindings_userId_isActive_idx"
    ON "wallet_bindings"("userId", "isActive");

-- FK to users
ALTER TABLE "wallet_bindings"
    ADD CONSTRAINT "wallet_bindings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

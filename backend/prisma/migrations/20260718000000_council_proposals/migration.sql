-- The council domain: persisted proposals (the async unit of governed-mode
-- work), verified per-member signatures, and formal positions (the acta).
-- Blobs/positions are public tx material and signed statements — never keys.

-- CreateTable
CREATE TABLE "council_proposals" (
    "id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "title" TEXT,
    "txType" TEXT NOT NULL,
    "txjson" JSONB NOT NULL,
    "quorum" INTEGER NOT NULL,
    "signerList" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collecting',
    "txHash" TEXT,
    "positionsAnchor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "council_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "council_proposal_signatures" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "signerAccount" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "blobHex" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "council_proposal_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "council_formal_positions" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "memberAccount" TEXT NOT NULL,
    "stance" TEXT NOT NULL,
    "comment" TEXT,
    "contentHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signingPubKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "council_formal_positions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "council_proposals_account_status_idx" ON "council_proposals"("account", "status");

-- CreateIndex
CREATE UNIQUE INDEX "council_proposal_signatures_proposalId_signerAccount_key" ON "council_proposal_signatures"("proposalId", "signerAccount");

-- CreateIndex
CREATE UNIQUE INDEX "council_formal_positions_proposalId_memberAccount_key" ON "council_formal_positions"("proposalId", "memberAccount");

-- AddForeignKey
ALTER TABLE "council_proposal_signatures" ADD CONSTRAINT "council_proposal_signatures_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "council_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "council_formal_positions" ADD CONSTRAINT "council_formal_positions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "council_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- P0-5 pattern: new public tables enable RLS (default DENY for the Data API
-- roles; the backend connects as table owner and bypasses it).
ALTER TABLE "council_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "council_proposal_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "council_formal_positions" ENABLE ROW LEVEL SECURITY;

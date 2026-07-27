-- Borrow-side enrichment for ProtocolPool
-- Sources: DefiLlama /yields/poolsBorrow endpoint
-- Pools where borrowing is supported (Aave, Compound, Morpho, Spark, etc.) now
-- carry both supply and borrow APYs plus utilization metrics.

ALTER TABLE "protocol_pools"
  ADD COLUMN "apyBaseBorrow"   DOUBLE PRECISION,
  ADD COLUMN "apyRewardBorrow" DOUBLE PRECISION,
  ADD COLUMN "totalSupplyUsd"  DOUBLE PRECISION,
  ADD COLUMN "totalBorrowUsd"  DOUBLE PRECISION,
  ADD COLUMN "debtCeilingUsd"  DOUBLE PRECISION,
  ADD COLUMN "borrowable"      BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "protocol_pools_borrowable_chainId_idx"
  ON "protocol_pools" ("borrowable", "chainId");

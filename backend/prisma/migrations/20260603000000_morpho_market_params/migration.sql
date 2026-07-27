-- Morpho Blue MarketParams stored server-side on the pool.
-- Morpho's supply/borrow calldata needs the full MarketParams struct
-- (loanToken, collateralToken, oracle, irm, lltv) plus the bytes32 market id.
-- This is NOT derivable from the DefiLlama UUID, so it is resolved server-side
-- and persisted here; the frontend never sends marketParams.
ALTER TABLE "protocol_pools" ADD COLUMN "morphoMarketParams" JSONB;

-- ============================================================
-- Fix: portfolio_snapshots_chainId_fkey violated on every non-EVM snapshot
-- ============================================================
--
-- Two conventions for non-EVM synthetic chainIds had diverged:
--
--   migration 20260524000000 seeded NEGATIVE ids  → XRPL -1, Solana -2, Bitcoin -3
--   the runtime (ChainRegistry + the balance providers) uses POSITIVE pseudo ids:
--     XRPL 1440002 · Solana 900 · Bitcoin 1500000
--     Stellar 1500001 · Algorand 1500002 · Aptos 1500003
--
-- Nothing ever wrote a negative chainId, so `chains` had no row matching what
-- PortfolioEngine.persistSnapshot() writes → the FK failed on every XRPL/Solana/
-- Bitcoin/Stellar/Algorand/Aptos snapshot and non-EVM portfolio history was
-- silently never persisted.
--
-- ChainRegistry (src/integrations/registry/ChainRegistry.ts) is the source of
-- truth in code; the values below are copied from it. This migration makes the
-- DB agree with it.

-- 1. Release the unique caip2 values held by the stale negative rows so the
--    correct rows below can claim them ('xrpl:*', 'solana:mainnet', 'bip122:*').
UPDATE "chains" SET "caip2" = NULL, "isActive" = false WHERE "chainId" < 0;

-- 2. Drop the stale negative rows — but only if nothing references them.
--    Protocol/Position/TransactionIntent cascade on delete, so a blind DELETE
--    could take real rows with it. Nothing should reference them (no code path
--    ever wrote a negative chainId); the guard makes that safe rather than assumed.
--    Any row that survives stays isActive=false from step 1 — inert, not deleted.
DELETE FROM "chains" c
WHERE c."chainId" < 0
  AND NOT EXISTS (SELECT 1 FROM "wallets"             w WHERE w."chainId" = c."chainId")
  AND NOT EXISTS (SELECT 1 FROM "portfolio_snapshots" s WHERE s."chainId" = c."chainId")
  AND NOT EXISTS (SELECT 1 FROM "protocols"           p WHERE p."chainId" = c."chainId")
  AND NOT EXISTS (SELECT 1 FROM "positions"           o WHERE o."chainId" = c."chainId")
  AND NOT EXISTS (SELECT 1 FROM "transaction_intents" t WHERE t."chainId" = c."chainId");

-- 3. Seed the non-EVM chains under the pseudo ids the runtime actually writes.
--    ON CONFLICT DO NOTHING → idempotent; never overwrites an operator's edits.
INSERT INTO "chains" ("id", "chainId", "name", "chainType", "isEvm", "caip2",
                      "rpcHttp", "rpcWs", "explorer",
                      "blockTime", "nativeSymbol", "isActive",
                      "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 1440002, 'XRPL',     'xrpl',     false, 'xrpl:mainnet',
   'https://xrplcluster.com', 'wss://xrplcluster.com',
   'https://livenet.xrpl.org', 3500, 'XRP', true, now(), now()),

  (gen_random_uuid(), 900,     'Solana',   'solana',   false, 'solana:mainnet',
   'https://api.mainnet-beta.solana.com', NULL,
   'https://solscan.io', 400, 'SOL', true, now(), now()),

  (gen_random_uuid(), 1500000, 'Bitcoin',  'bitcoin',  false, 'bip122:000000000019d6689c085ae165831e93',
   'https://blockstream.info/api', NULL,
   'https://blockstream.info', 600000, 'BTC', true, now(), now()),

  (gen_random_uuid(), 1500001, 'Stellar',  'stellar',  false, 'stellar:pubnet',
   'https://horizon.stellar.org', NULL,
   'https://stellar.expert/explorer/public', 5000, 'XLM', true, now(), now()),

  (gen_random_uuid(), 1500002, 'Algorand', 'algorand', false, 'algorand:mainnet',
   'https://mainnet-api.algonode.cloud', NULL,
   'https://allo.info', 3300, 'ALGO', true, now(), now()),

  (gen_random_uuid(), 1500003, 'Aptos',    'aptos',    false, 'aptos:mainnet',
   'https://fullnode.mainnet.aptoslabs.com/v1', NULL,
   'https://explorer.aptoslabs.com', 250, 'APT', true, now(), now())

ON CONFLICT ("chainId") DO NOTHING;

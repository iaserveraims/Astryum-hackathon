-- ============================================================
-- Multichain pivot: xrplAddress optional + wallet fields +
-- chain type support + seed of common chains
-- ============================================================

-- 1. User: xrplAddress was NOT NULL, make it optional
--    (EVM-only users connect via MetaMask/WalletConnect without an XRPL address)
ALTER TABLE "users" ALTER COLUMN "xrplAddress" DROP NOT NULL;

-- 2. User: drop redundant single-address columns
--    (all chain addresses live in the wallets table)
ALTER TABLE "users" DROP COLUMN IF EXISTS "evmAddress";
ALTER TABLE "users" DROP COLUMN IF EXISTS "rootAddress";

-- 3. Wallet: CAIP-2 canonical chain identifier and WalletConnect session topic
--    caip2  → "eip155:14" (Flare), "eip155:1" (Ethereum), "xrpl:0", "solana:mainnet"
--    wcTopic → WalletConnect v2 session topic; groups all accounts from one session
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "caip2"   TEXT;
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "wcTopic" TEXT;

CREATE INDEX IF NOT EXISTS "wallets_wcTopic_idx" ON "wallets"("wcTopic");
CREATE INDEX IF NOT EXISTS "wallets_caip2_idx"   ON "wallets"("caip2");

-- 4. Chain: chainType and isEvm for non-EVM chain support
--    Non-EVM synthetic chainIds: XRPL=-1, Solana=-2, Bitcoin=-3
ALTER TABLE "chains" ADD COLUMN IF NOT EXISTS "chainType" TEXT    NOT NULL DEFAULT 'evm';
ALTER TABLE "chains" ADD COLUMN IF NOT EXISTS "isEvm"     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "chains" ADD COLUMN IF NOT EXISTS "caip2"     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "chains_caip2_key" ON "chains"("caip2");

-- 5. Seed common chains
--    ON CONFLICT DO NOTHING → safe to re-run; existing rows are not overwritten.
INSERT INTO "chains" ("id", "chainId", "name", "chainType", "isEvm", "caip2",
                      "rpcHttp", "rpcWs", "explorer",
                      "blockTime", "nativeSymbol", "isActive",
                      "createdAt", "updatedAt")
VALUES
  -- EVM — Flare ecosystem
  (gen_random_uuid(), 14,    'Flare',            'evm',     true,  'eip155:14',
   'https://flare-api.flare.network/ext/C/rpc',
   'wss://flare-api.flare.network/ext/bc/C/ws',
   'https://flarescan.com', 1800, 'FLR', true, now(), now()),

  (gen_random_uuid(), 19,    'Songbird',         'evm',     true,  'eip155:19',
   'https://songbird-api.flare.network/ext/C/rpc',
   'wss://songbird-api.flare.network/ext/bc/C/ws',
   'https://songbird-explorer.flare.network', 1800, 'SGB', true, now(), now()),

  -- EVM — Major L1/L2
  (gen_random_uuid(), 1,     'Ethereum',         'evm',     true,  'eip155:1',
   'https://cloudflare-eth.com', NULL,
   'https://etherscan.io', 12000, 'ETH', true, now(), now()),

  (gen_random_uuid(), 42161, 'Arbitrum One',     'evm',     true,  'eip155:42161',
   'https://arb1.arbitrum.io/rpc', NULL,
   'https://arbiscan.io', 250, 'ETH', true, now(), now()),

  (gen_random_uuid(), 8453,  'Base',             'evm',     true,  'eip155:8453',
   'https://mainnet.base.org', NULL,
   'https://basescan.org', 2000, 'ETH', true, now(), now()),

  (gen_random_uuid(), 137,   'Polygon',          'evm',     true,  'eip155:137',
   'https://polygon-rpc.com', NULL,
   'https://polygonscan.com', 2000, 'POL', true, now(), now()),

  (gen_random_uuid(), 10,    'Optimism',         'evm',     true,  'eip155:10',
   'https://mainnet.optimism.io', NULL,
   'https://optimistic.etherscan.io', 2000, 'ETH', true, now(), now()),

  (gen_random_uuid(), 56,    'BNB Smart Chain',  'evm',     true,  'eip155:56',
   'https://bsc-dataseed.binance.org', NULL,
   'https://bscscan.com', 3000, 'BNB', true, now(), now()),

  (gen_random_uuid(), 43114, 'Avalanche C-Chain','evm',     true,  'eip155:43114',
   'https://api.avax.network/ext/bc/C/rpc', NULL,
   'https://snowtrace.io', 2000, 'AVAX', true, now(), now()),

  -- Non-EVM — synthetic negative chainIds
  (gen_random_uuid(), -1,   'XRP Ledger',        'xrpl',   false, 'xrpl:0',
   'https://xrplcluster.com',
   'wss://xrplcluster.com',
   'https://livenet.xrpl.org', 3500, 'XRP', true, now(), now()),

  (gen_random_uuid(), -2,   'Solana',            'solana',  false, 'solana:mainnet',
   'https://api.mainnet-beta.solana.com', NULL,
   'https://solscan.io', 400, 'SOL', true, now(), now()),

  (gen_random_uuid(), -3,   'Bitcoin',           'bitcoin', false, 'bip122:000000000019d6689c085ae165831e93',
   'https://mempool.space/api', NULL,
   'https://mempool.space', 600000, 'BTC', true, now(), now())

ON CONFLICT ("chainId") DO NOTHING;

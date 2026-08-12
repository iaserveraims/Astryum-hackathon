import type { ProviderType, TrustLevel } from '../../canonical/types/Source';
import type { Capability } from '../interfaces/IProvider';

export interface ProviderConfigEntry {
  readonly id: string;
  readonly type: ProviderType;
  readonly trustLevel: TrustLevel;
  readonly priority: number;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly enabled: boolean;
  readonly description?: string;
}

/**
 * FLARE_DEFI_ENABLED controls Flare DeFi protocol adapters (kinetic, sparkdex, firelight, enosys).
 * Default: false — Flare DeFi is hidden in the public MVP until grants.
 * Set FLARE_DEFI_ENABLED=true to surface Flare-specific DeFi providers.
 * Flare infrastructure (RPC, FTSO, Flarescan) is always enabled regardless.
 */
const FLARE_DEFI_ENABLED = process.env.FLARE_DEFI_ENABLED === 'true';

export const PROVIDERS_CONFIG: ReadonlyArray<ProviderConfigEntry> = Object.freeze([
  {
    id: 'flare-rpc',
    type: 'chain',
    trustLevel: 'onchain_verified',
    priority: 100,
    capabilities: [
      'chain.getBalance',
      'chain.getBlockNumber',
      'chain.getCode',
      'chain.call',
      'chain.getLogs',
      'chain.getTransaction',
    ],
    enabled: true,
    description: 'Flare Mainnet RPC (HTTP+WS)',
  },
  {
    id: 'flare-ftso',
    type: 'oracle',
    trustLevel: 'oracle_verified',
    priority: 100,
    capabilities: ['oracle.getPrice', 'oracle.getPrices', 'oracle.getPriceWithProof'],
    enabled: true,
    description: 'Flare FTSO v2 oracle',
  },
  {
    id: 'flarescan',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 80,
    capabilities: [
      'explorer.getActivity',
      'explorer.getTokenTransfers',
      'explorer.verifyContract',
      'explorer.getInternalTxs',
    ],
    enabled: true,
    description: 'Flarescan + flare-explorer indexers',
  },
  // V1.1 S2 — universal read layer
  {
    id: 'defillama',
    type: 'data',
    trustLevel: 'aggregator',
    priority: 60,
    capabilities: ['data.getProtocolRegistry', 'data.getKnownContracts'],
    enabled: true,
    description: 'DefiLlama protocol registry (discovery + metadata, not on-chain truth).',
  },
  {
    id: 'evm-explorer',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 75,
    capabilities: ['explorer.getTransactions', 'explorer.discoverInteractions'],
    enabled: true,
    description:
      'Generic EVM explorer (Etherscan V2 unified): Ethereum/Polygon/Arbitrum/Base. Self-disables without ETHERSCAN_API_KEY.',
  },
  // Non-Etherscan / non-EVM explorers — registered disabled (auto StubProvider)
  // until a dedicated provider lands in a follow-up sprint.
  {
    id: 'sei-explorer',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 50,
    capabilities: ['explorer.getTransactions'],
    enabled: false,
    description: 'Sei EVM (Seitrace) — follow-up sprint.',
  },
  {
    id: 'xrpl-explorer',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 50,
    capabilities: ['explorer.getTransactions'],
    enabled: false,
    description: 'XRP Ledger (XRPScan) — non-EVM, follow-up sprint.',
  },
  {
    id: 'stellar-explorer',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 50,
    capabilities: ['explorer.getTransactions'],
    enabled: false,
    description: 'Stellar (Horizon) — non-EVM, follow-up sprint.',
  },
  {
    id: 'hedera-explorer',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 50,
    capabilities: ['explorer.getTransactions'],
    enabled: false,
    description: 'Hedera (Mirror Node) — non-EVM, follow-up sprint.',
  },
  {
    id: 'sui-explorer',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 50,
    capabilities: ['explorer.getTransactions'],
    enabled: false,
    description: 'Sui (Sui RPC) — non-EVM, follow-up sprint.',
  },
  {
    id: 'kinetic',
    type: 'protocol',
    trustLevel: 'protocol_native',
    priority: 100,
    capabilities: [
      'protocol.discoverPositions',
      'protocol.simulateAction',
      'protocol.prepareIntent',
      'protocol.getMetrics',
    ],
    enabled: FLARE_DEFI_ENABLED && !!process.env.KINETIC_COMPTROLLER,
    description: 'Kinetic Market lending (Compound V2 fork on Flare). Requires FLARE_DEFI_ENABLED=true + KINETIC_COMPTROLLER.',
  },
  {
    id: 'sparkdex',
    type: 'protocol',
    trustLevel: 'protocol_native',
    priority: 95,
    capabilities: [
      'protocol.discoverPositions',
      'protocol.simulateAction',
      'protocol.prepareIntent',
      'protocol.getMetrics',
    ],
    enabled: FLARE_DEFI_ENABLED && !!process.env.SPARKDEX_NFPM,
    description: 'SparkDEX V3 LP on Flare. Requires FLARE_DEFI_ENABLED=true + SPARKDEX_NFPM.',
  },
  {
    id: 'firelight',
    type: 'protocol',
    trustLevel: 'protocol_native',
    priority: 90,
    capabilities: [
      'protocol.discoverPositions',
      'protocol.simulateAction',
      'protocol.prepareIntent',
      'protocol.getMetrics',
    ],
    enabled: FLARE_DEFI_ENABLED && !!process.env.FIRELIGHT_STAKING,
    description: 'Firelight stXRP liquid staking on Flare. Requires FLARE_DEFI_ENABLED=true + FIRELIGHT_STAKING.',
  },
  {
    id: 'enosys',
    type: 'protocol',
    trustLevel: 'protocol_native',
    priority: 85,
    capabilities: [
      'protocol.discoverPositions',
      'protocol.simulateAction',
      'protocol.prepareIntent',
      'protocol.getMetrics',
    ],
    enabled: FLARE_DEFI_ENABLED,
    description: 'Enosys DEX/Farms/Loans on Flare. Requires FLARE_DEFI_ENABLED=true.',
  },
  {
    id: 'wflr',
    type: 'protocol',
    trustLevel: 'protocol_native',
    priority: 95,
    capabilities: [
      'protocol.discoverPositions',
      'protocol.simulateAction',
      'protocol.prepareIntent',
      'protocol.wrap_native',
    ],
    enabled: true,
    description: 'WFLR wrap/unwrap (V1.1). WNAT proxy 0x1D80…F783d.',
  },
  {
    id: 'ftso',
    type: 'protocol',
    trustLevel: 'protocol_native',
    priority: 90,
    capabilities: [
      'protocol.discoverPositions',
      'protocol.simulateAction',
      'protocol.prepareIntent',
      'protocol.ftso_delegate',
      'protocol.ftso_claim_rewards',
    ],
    enabled: true,
    description: 'FTSO delegate/undelegate/claimRewards (V1.1). Distinct from flare-ftso oracle.',
  },
  {
    id: 'sceptre',
    type: 'protocol',
    trustLevel: 'protocol_native',
    priority: 70,
    capabilities: [
      'protocol.discoverPositions',
      'protocol.simulateAction',
      'protocol.prepareIntent',
      'protocol.liquid_stake_flr',
    ],
    enabled: true,
    description: 'Sceptre sFLR liquid staking (V1.1, experimental). sFLR proxy 0x12e6…c2BB.',
  },
  {
    id: 'engine-portfolio',
    type: 'engine',
    trustLevel: 'aggregator',
    priority: 100,
    capabilities: [
      'engine.portfolio.getCanonicalPositions',
      'engine.portfolio.getSnapshot',
      'engine.portfolio.getCanonicalPositionsViaRouter',
    ],
    enabled: true,
    description: 'PortfolioEngine V1 wrapped as deterministic engine provider (CanonicalPosition[]).',
  },
  {
    id: 'engine-risk',
    type: 'engine',
    trustLevel: 'aggregator',
    priority: 100,
    capabilities: ['engine.risk.getCanonicalRisk', 'engine.risk.getPortfolioRisk'],
    enabled: true,
    description: 'RiskEngine V1 wrapped as deterministic engine provider (CanonicalRisk).',
  },
  {
    id: 'fxrp-monitor',
    type: 'fasset',
    trustLevel: 'onchain_verified',
    priority: 90,
    capabilities: [
      'fasset.getFxrpExposure',
      'fasset.getFxrpStats',
      'protocol.discoverPositions',
    ],
    enabled: true,
    description: 'FXRP exposure monitor (FAssets). Reads ERC20 balance + FTSO XRP price.',
  },
  {
    id: 'walletconnect',
    type: 'wallet',
    trustLevel: 'protocol_native',
    priority: 80,
    capabilities: ['wallet.getCapabilities'],
    enabled: false,
    description: 'WalletConnect v2 (Bifrost / mobile wallets).',
  },
  {
    id: 'metamask',
    type: 'wallet',
    trustLevel: 'protocol_native',
    priority: 70,
    capabilities: ['wallet.getCapabilities'],
    enabled: false,
    description: 'MetaMask injected wallet.',
  },
  {
    id: 'bifrost',
    type: 'wallet',
    trustLevel: 'protocol_native',
    priority: 75,
    capabilities: ['wallet.getCapabilities'],
    enabled: false,
    description: 'Bifrost Wallet (Flare ecosystem native).',
  },
  // S2: Multi-chain DeFi discovery
  {
    id: 'defillama',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 70,
    capabilities: [
      'data.getProtocols',
      'data.getProtocolsByChain',
      'data.getKnownContracts',
      'data.syncProtocolRegistry',
      'data.getPools',
      'data.syncPoolRegistry',
    ],
    enabled: true,
    description: 'DefiLlama protocol registry + yield pool data (6h sync). Feeds protocol_pools table.',
  },
  {
    id: 'chain-explorer',
    type: 'explorer',
    trustLevel: 'indexer_verified',
    priority: 75,
    capabilities: [
      'explorer.getTransactions',
      'explorer.getTokenTransfers',
      'explorer.discoverDeFiInteractions',
    ],
    enabled: true,
    description: 'Generic multi-chain Etherscan-compatible explorer (Ethereum, Polygon, Arbitrum, Base, Flare).',
  },
  // Redstone oracle — covers long-tail assets not in FTSO feed
  {
    id: 'redstone',
    type: 'oracle',
    trustLevel: 'oracle_verified',
    priority: 85,
    capabilities: ['oracle.getPrice', 'oracle.getPrices', 'oracle.getPriceWithProof'],
    enabled: true,
    description:
      'Redstone multi-chain oracle. HTTP pull for trigger evaluation (no key for basic use; ' +
      'set REDSTONE_API_KEY for higher rate limits). Covers long-tail assets outside the FTSO feed.',
  },
  // V2 S3: Multichain read-only RPC (all BROADCAST_FORBIDDEN at provider level)
  {
    id: 'alchemy-rpc',
    type: 'chain',
    trustLevel: 'onchain_verified',
    priority: 90,
    capabilities: [
      'chain.getBalance',
      'chain.getBlockNumber',
      'chain.getCode',
      'chain.call',
      'chain.getLogs',
      'chain.getTransaction',
      'chain.getTokenBalances',
    ],
    enabled: !!process.env.ALCHEMY_API_KEY,
    description: 'Alchemy read-only EVM RPC (ETH, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche). chainId=14 → FlareRpcProvider.',
  },
  {
    id: 'helius-rpc',
    type: 'chain',
    trustLevel: 'onchain_verified',
    priority: 88,
    capabilities: [
      'chain.getBalance',
      'chain.getBlockNumber',
      'chain.getTransaction',
      'chain.getTokenBalances',
      'chain.call',
    ],
    enabled: !!process.env.HELIUS_API_KEY,
    description: 'Helius read-only Solana RPC (solana:mainnet only). Read-only, BROADCAST_FORBIDDEN.',
  },
  {
    id: 'quicknode-rpc',
    type: 'chain',
    trustLevel: 'onchain_verified',
    priority: 75,
    capabilities: [
      'chain.getBalance',
      'chain.getBlockNumber',
      'chain.getCode',
      'chain.call',
      'chain.getLogs',
      'chain.getTransaction',
    ],
    enabled: !!process.env.QUICKNODE_ENDPOINT,
    description: 'QuickNode fallback EVM RPC. Lower priority than Alchemy (90). BROADCAST_FORBIDDEN.',
  },
  // V2 S2: Turnkey user-controlled signing infrastructure
  {
    id: 'turnkey',
    type: 'wallet',
    trustLevel: 'protocol_native',
    priority: 85,
    capabilities: [
      'wallet.getCapabilities',
      'wallet.validateAuthorizationSession',
      'wallet.getAuthorizationStatus',
    ],
    enabled: !!(process.env.TURNKEY_API_PUBLIC_KEY && process.env.TURNKEY_ORG_ID),
    description: 'Turnkey user-controlled signing. Keys never leave user device. canBroadcast:false, userControlledKeys:true.',
  },
  // V2 S4.5: RegulatedRelayBoundary — explicit Astryum/relay separation
  {
    id: 'regulated-relay-boundary',
    type: 'wallet',
    trustLevel: 'protocol_native',
    priority: 60,
    capabilities: ['relay.createSession', 'relay.markAuthorized', 'relay.exportPayload'],
    enabled: true,
    description: 'Explicit boundary between Astryum preparation and regulated relay transmission. Astryum never broadcasts.',
  },
  // V2 S8: Multichain portfolio intelligence providers
  {
    id: 'coinstats',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 76,
    capabilities: ['portfolio.getPositions', 'portfolio.getChains', 'portfolio.getTokenBalances'],
    enabled: !!process.env.COINSTATS_API_KEY,
    description: 'CoinStats Open API (120+ chains, EVM+Solana+BTC). Single broad portfolio source replacing Zerion (D2). COINSTATS_API_KEY required.',
  },
  {
    id: 'zerion',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 75,
    capabilities: ['portfolio.getPositions', 'portfolio.getChains', 'portfolio.getTokenBalances'],
    // DISCONNECTED from production (2026-06-15, D2): CoinStats + own readers replace it.
    // Kept inert (not deleted) — flip back to `!!process.env.ZERION_API_KEY` to re-enable.
    enabled: false,
    description: 'Zerion portfolio API (38+ chains). confidenceLevel=probable. [DISCONNECTED 2026-06-15]',
  },
  {
    id: 'debank',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 65,
    capabilities: ['portfolio.getPositions', 'portfolio.getChains', 'portfolio.getTokenBalances'],
    enabled: !!process.env.DEBANK_API_KEY,
    description: 'DeBank portfolio API. confidenceLevel=detected. DEBANK_API_KEY required.',
  },
  // P5: Swaps.xyz (MoonPay Trade) — cross-chain swap/bridge aggregator
  {
    id: 'swaps-xyz',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 85,
    capabilities: [
      'swap.getQuote',
      'swap.prepareSwap',
      'bridge.getRoute',
      'defi.getCalldataCall',
      'chain.getStatus',
    ],
    enabled: !!process.env.SWAPS_XYZ_API_KEY,
    description:
      'MoonPay Trade / Swaps.xyz cross-chain swap aggregator (200+ chains). ' +
      'Fee via SWAPS_XYZ_FEE_BPS (default 15 = 0.15%) configured in console.swaps.xyz. ' +
      'Astryum never holds funds — returns unsigned calldata only.',
  },
  // S9: 1inch swap aggregator — revenue via embedded integrator fee (platformFeeBps)
  {
    id: 'oneinch',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 80,
    capabilities: [
      'swap.getQuote',
      'swap.prepareTransaction',
    ],
    enabled: !!(process.env.ONEINCH_API_KEY && process.env.DEFIBRO_FEE_WALLET),
    description:
      '1inch Aggregation API v6. Astryum earns integrator fees (ONEINCH_FEE_BPS, default 0.25%) on every swap. ' +
      'Fee embedded in calldata by 1inch — goes directly to DEFIBRO_FEE_WALLET. Astryum never holds funds.',
  },
  // P15: Hedera (HBAR) — public HashIO JSON-RPC relay, no API key
  {
    id: 'hedera-rpc',
    type: 'chain',
    trustLevel: 'onchain_verified',
    priority: 70,
    capabilities: [
      'chain.getBalance',
      'chain.getBlockNumber',
      'chain.getCode',
      'chain.call',
      'chain.getLogs',
      'chain.getTransaction',
    ],
    enabled: true,
    description: 'Hedera (chainId 296) read-only RPC via HashIO (https://mainnet.hashio.io/api). No API key. BROADCAST_FORBIDDEN.',
  },
  // P15: XDC Network — public erpc.xinfin.network, no API key
  {
    id: 'xdc-rpc',
    type: 'chain',
    trustLevel: 'onchain_verified',
    priority: 70,
    capabilities: [
      'chain.getBalance',
      'chain.getBlockNumber',
      'chain.getCode',
      'chain.call',
      'chain.getLogs',
      'chain.getTransaction',
    ],
    // INERT by default (2026-08-01): XDC is not on the product's active rails
    // and the public RPC's downtime was paging the ops channel. Kept wired, not
    // deleted — set XDC_RPC_ENABLED=true to re-enable when XDC ships.
    enabled: process.env.XDC_RPC_ENABLED === 'true',
    description: 'XDC Network (chainId 50) read-only RPC via erpc.xinfin.network. No API key. BROADCAST_FORBIDDEN. [INERT — XDC_RPC_ENABLED=true to re-enable]',
  },
  // P14: Jupiter — Solana swap aggregator (permissionless, no API key required)
  {
    id: 'jupiter',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 85,
    capabilities: [
      'swap.getQuote',
      'swap.prepareSwap',
    ],
    // INERT by default (2026-08-02): Solana is not on the product's active
    // rails (Phantom is a later phase) and Jupiter's downtime was paging the
    // ops channel. Kept wired, not deleted — JUPITER_ENABLED=true when it ships.
    enabled: process.env.JUPITER_ENABLED === 'true',
    description:
      'Jupiter v6 Solana swap aggregator (permissionless). ' +
      'Fee: JUPITER_FEE_BPS (default 20 = 0.20%) via platformFeeBps. ' +
      'feeAccount: JUPITER_FEE_ACCOUNT (Solana token ATA). ' +
      'Astryum never signs. Solana-only, NOT EVM.',
  },
  // #3 ISO 20022: Soroswap — Stellar DEX aggregator (SDEX/Soroswap/Aqua/Phoenix)
  {
    id: 'soroswap',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 84,
    capabilities: [
      'swap.getQuote',
      'swap.prepareSwap',
    ],
    enabled: true,
    description:
      'Soroswap Stellar DEX aggregator. Returns UNSIGNED XDR; user signs in a ' +
      'Stellar wallet (Freighter/Lobstr). Fee: SOROSWAP_FEE_BPS (default 30) via ' +
      'referralId → SOROSWAP_FEE_WALLET/DEFIBRO_FEE_WALLET. Self-disables without ' +
      'SOROSWAP_API_KEY. Stellar-only, NOT EVM. Astryum never signs.',
  },
  // P14: Li.Fi — cross-chain swap + bridge aggregator (EVM, 60+ chains)
  {
    id: 'lifi',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 82,
    capabilities: [
      'swap.getQuote',
      'swap.prepareSwap',
      'bridge.getRoute',
    ],
    enabled: true,
    description:
      'Li.Fi cross-chain swap + bridge aggregator (60+ EVM chains). ' +
      'Fee: LIFI_FEE_BPS (default 15 = 0.15%) via integrator=defibro fee param. ' +
      'Optional LIFI_API_KEY for higher rate limits. ' +
      'NOT Flare (14) — use internal protocol adapters. Astryum never signs.',
  },
  // P16: XRPL — xrpl.js read-only provider (balance, trust lines, AMM LP, Soil vaults)
  {
    id: 'xrpl-rpc',
    type: 'chain',
    trustLevel: 'onchain_verified',
    priority: 65,
    capabilities: [
      'chain.getBalance',
      'chain.getTokenBalances',
      'chain.getDeFiPositions',
      'xrpl.getAccountLines',
      'xrpl.getAccountObjects',
    ],
    enabled: true,
    description:
      'XRPL read-only provider via xrpl.js (wss://xrplcluster.com, public, no API key). ' +
      'Covers XRP balance, trust lines (RLUSD, IOUs), DEX offers, AMM LP positions, Soil vaults. ' +
      'Signing is handled by Xaman (XUMM) — Astryum never signs XRPL transactions. BROADCAST_FORBIDDEN.',
  },
  // FASE 4: Across Protocol — ERC-7683 solver (GaslessCrossChainOrder), bridge
  // Co-author of ERC-7683. Relayers front destination liquidity in ~30s.
  // Chains: ETH (1), ARB (42161), OP (10), BASE (8453), POLY (137).
  // NOT Flare (14) — use internal protocol adapters. No API key required.
  {
    id: 'across',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 83,
    capabilities: [
      'bridge.getSuggestedFees',
      'bridge.getAvailableRoutes',
      'bridge.getDepositStatus',
      'swap.prepareSwap',
      'intent.prepareERC7683Intent',
    ],
    enabled: true,
    description:
      'Across Protocol V2 — ERC-7683 GaslessCrossChainOrder solver. ' +
      'Relayers provide destination liquidity in ~30s. $50M+ USD/day. ' +
      'Chains: ETH/ARB/OP/BASE/POLY. No API key required. Astryum never signs.',
  },
  // FASE 4: UniswapX — ERC-7683 solver (Dutch auction V2), same-chain EVM swaps
  // Use when Li.Fi or 1inch don't give best output for same-chain swaps.
  // Gasless for swapper (fillers pay gas). Chains: ETH/ARB/POLY/BASE/OP.
  // NOT cross-chain (use Across). NOT Flare. NOT Solana (use Jupiter). No API key.
  {
    id: 'uniswapx',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 81,
    capabilities: [
      'swap.getQuote',
      'swap.prepareSwap',
      'intent.prepareERC7683Intent',
    ],
    enabled: true,
    description:
      'UniswapX Dutch V2 — ERC-7683 GaslessCrossChainOrder solver for same-chain EVM swaps. ' +
      'Dutch auction: price improves over time until a filler takes the order (~10s). ' +
      'Gasless for swapper. Chains: ETH/ARB/POLY/BASE/OP. No API key. Astryum never signs. ' +
      'EIP-712 two-step flow: wallet_signTypedData → reactor.execute.',
  },
  // P13: Enso Finance — atomic multi-step DeFi bundles (supply+borrow+LP in one tx)
  {
    id: 'enso',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 80,
    capabilities: [
      'defi.getRoute',
      'defi.getBundleCalldata',
      'defi.canHandle',
    ],
    enabled: !!process.env.ENSO_API_KEY,
    description:
      'Enso Finance DeFi workflow composition. Supports atomic multi-step bundles across 200+ protocols. ' +
      'Fee: ENSO_FEE_BPS (default 15 = 0.15%) embedded in calldata → DEFIBRO_FEE_WALLET. ' +
      'Astryum never holds funds. Flare (chainId 14) excluded — use internal protocol adapters.',
  },
  // FASE 5: Market data enrichment — DexScreener (real-time DEX pair data)
  // Public API, no key required. DEXSCREENER_API_KEY unlocks higher rate limits.
  {
    id: 'dexscreener',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 60,
    capabilities: ['market.getPairs', 'market.getTrendingPairs', 'market.getPoolLiquidity'],
    enabled: true,
    description:
      'DexScreener real-time DEX pair data (50+ chains). No API key required. ' +
      'Optional DEXSCREENER_API_KEY for higher rate limits.',
  },
  // FASE 5: Market data enrichment — GeckoTerminal (OHLCV + trending pools)
  // Public API, no key required. GECKO_TERMINAL_API_KEY unlocks higher rate limits.
  {
    id: 'geckoterminal',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 58,
    capabilities: ['market.getOHLCV', 'market.getTrendingPools', 'market.getNetworks'],
    enabled: true,
    description:
      'GeckoTerminal OHLCV + trending pools (200+ networks). No API key required. ' +
      'Optional GECKO_TERMINAL_API_KEY.',
  },
  // FASE 5: Fiat on/off-ramp — Transak partner (MiCA-aware)
  // Transak executes — Astryum never custodies. TRANSAK_API_KEY required.
  {
    id: 'transak',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 70,
    capabilities: ['onramp.getQuote', 'onramp.getSupportedAssets'],
    enabled: !!process.env.TRANSAK_API_KEY,
    description:
      'Transak fiat on/off-ramp. MiCA-compliant — partner executes, Astryum never custodies. ' +
      'TRANSAK_API_KEY required. Optional TRANSAK_ENVIRONMENT=staging|production.',
  },
  // FASE 5: On-ramp aggregator — Meld (compares MoonPay, Transak, Banxa, Stripe…)
  // MELD_API_KEY required.
  {
    id: 'meld',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 68,
    capabilities: ['onramp.getQuotes', 'onramp.getProviders'],
    enabled: !!process.env.MELD_API_KEY,
    description:
      'Meld on-ramp aggregator — compares quotes across MoonPay, Transak, Banxa, Stripe, etc. ' +
      'MiCA-compliant — partner executes, Astryum never custodies. MELD_API_KEY required.',
  },
  // FASE 5: Enterprise portfolio aggregator — Kryptos.io (CEX + wallets + DeFi)
  // Alternative to Zerion for users with significant exchange holdings.
  {
    id: 'kryptos',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 62,
    capabilities: [
      'portfolio.getPositions',
      'portfolio.getExchangeBalances',
      'portfolio.getChains',
    ],
    enabled: !!process.env.KRYPTOS_API_KEY,
    description:
      'Kryptos.io enterprise portfolio aggregator (CEX exchanges + wallets + DeFi positions). ' +
      'Alternative/complement to Zerion for enterprise users. KRYPTOS_API_KEY required.',
  },
  // FASE 6: Security Partners — Hypernative threat detection
  // Covers: exploits, oracle manipulation, rug pulls, governance attacks, whale exits.
  // Pull (REST) + Push (webhook → Alert DB + push notification).
  // HYPERNATIVE_API_KEY required. Optional HYPERNATIVE_WEBHOOK_SECRET for webhook HMAC.
  {
    id: 'hypernative',
    type: 'security',
    trustLevel: 'indexer_verified',
    priority: 95,
    capabilities: [
      'security.getAlerts',
      'security.getActiveThreats',
      'security.processWebhookPayload',
      'security.verifyWebhookSignature',
    ],
    enabled: !!process.env.HYPERNATIVE_API_KEY,
    description:
      'Hypernative real-time threat detection (exploits, oracle manipulation, rug pulls, ' +
      'governance attacks, whale exits). Pull via REST + Push via HMAC-verified webhook. ' +
      'On threat: persists Alert in DB + fires push notification. HYPERNATIVE_API_KEY required.',
  },
  // FASE 6: Security Partners — Tenderly simulation cross-validation
  // Cross-validates calldata from CalldataBuilder/Enso before presenting to user.
  // Returns: success/revert, gas estimate, decoded events, call trace, DELEGATECALL detection.
  // TENDERLY_API_KEY required. TENDERLY_ACCOUNT_SLUG + TENDERLY_PROJECT_SLUG configure dashboard links.
  {
    id: 'tenderly',
    type: 'security',
    trustLevel: 'indexer_verified',
    priority: 90,
    capabilities: [
      'security.simulateTransaction',
      'security.crossValidateCalldata',
      'security.getTrace',
    ],
    enabled: !!process.env.TENDERLY_API_KEY,
    description:
      'Tenderly simulation cross-validation + trace analysis. ' +
      'Validates calldata from other providers (Enso, 1inch, CalldataBuilder) before user signs. ' +
      'Detects reverts, gas divergence >30%, and suspicious DELEGATECALL patterns. ' +
      'TENDERLY_API_KEY required. Optional TENDERLY_ACCOUNT_SLUG + TENDERLY_PROJECT_SLUG.',
  },
  // FASE 8: Squid Router — Axelar-based cross-chain swap + bridge (complementary to Li.Fi)
  // Use when Axelar routes give better rates or for Cosmos ↔ EVM flows.
  // 70+ chains. SQUID_INTEGRATOR_ID required (free registration at axelar.network/squid).
  // Fee: SQUID_FEE_BPS (default 15 = 0.15%) routed to DEFIBRO_FEE_WALLET via integratorAddress.
  {
    id: 'squid',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 79,
    capabilities: [
      'swap.getQuote',
      'swap.prepareSwap',
      'bridge.getRoute',
      'bridge.getDepositStatus',
    ],
    enabled: !!process.env.SQUID_INTEGRATOR_ID,
    description:
      'Squid Router v2 — Axelar-based cross-chain swap + bridge aggregator (70+ chains). ' +
      'Complementary to Li.Fi for Axelar-native routes. ' +
      'Fee: SQUID_FEE_BPS (default 15 = 0.15%) via integratorAddress → DEFIBRO_FEE_WALLET. ' +
      'SQUID_INTEGRATOR_ID required. NOT Flare (14). Astryum never signs.',
  },
  // FASE 8: CoW Protocol — MEV-protected batch auction swaps (EIP-712 signing, not eth_sendTransaction)
  // Solver network competes to fill orders; users get surplus instead of being MEV-extracted.
  // Supported: ETH (1), Gnosis (100), Arbitrum (42161), Base (8453). No API key required.
  // Revenue: appData referral → CoW surplus sharing (no explicit fee BPS deducted).
  {
    id: 'cowswap',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 77,
    capabilities: [
      'swap.getQuote',
      'swap.prepareSwap',
    ],
    enabled: true,
    description:
      'CoW Protocol (Coincidence of Wants) — MEV-protected batch auction swaps. ' +
      'Solver network fills orders off-chain; users receive price surplus. ' +
      'EIP-712 signing flow (wallet_signTypedData), NOT standard eth_sendTransaction. ' +
      'Chains: ETH/GNO/ARB/BASE. No API key required. Revenue via CoW surplus sharing.',
  },
  // FASE 8: MoonPay Trade — B2B DeFi execution engine (Aave, Morpho, vaults, stablecoin AMMs)
  // DISTINCT from the MoonPay on-ramp. Requires B2B agreement + MOONPAY_TRADE_API_KEY.
  // Both MOONPAY_TRADE_API_KEY and MOONPAY_TRADE_ENABLED=true must be set.
  // Fee: MOONPAY_TRADE_FEE_BPS (default 20 = 0.20%) via B2B partner agreement.
  {
    id: 'moonpay-trade',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 74,
    capabilities: [
      'defi.getQuote',
      'defi.prepareExecution',
    ],
    enabled: !!(process.env.MOONPAY_TRADE_API_KEY && process.env.MOONPAY_TRADE_ENABLED === 'true'),
    description:
      'MoonPay Trade B2B DeFi execution engine — programmatic access to Aave v3, Morpho, ' +
      'Uniswap v3, Curve, Balancer across 200+ chains. ' +
      'DISTINCT from MoonPay on-ramp. Requires B2B agreement + MOONPAY_TRADE_API_KEY + MOONPAY_TRADE_ENABLED=true. ' +
      'Fee: MOONPAY_TRADE_FEE_BPS (default 20 = 0.20%). V1.5+ feature.',
  },
  // FASE 8: Yellow Network state channels — high-frequency broker settlement (V2+ only)
  // Uses personal_sign (off-chain state updates) NOT eth_sendTransaction per payment.
  // YELLOW_PERUN_KEY + YELLOW_BROKER_MODE=true required. NOT for general DeFi swaps.
  // Chains: ETH (1), Optimism (10), Polygon (137), Arbitrum (42161), Base (8453).
  {
    id: 'yellow-state-channel',
    type: 'data',
    trustLevel: 'indexer_verified',
    priority: 30,
    capabilities: [
      'settlement.createChannel',
      'settlement.preparePayment',
      'settlement.getChannelState',
      'settlement.closeChannel',
    ],
    enabled: !!(process.env.YELLOW_PERUN_KEY && process.env.YELLOW_BROKER_MODE === 'true'),
    description:
      'Yellow Network Perun state channels — high-frequency broker settlement + streaming micropayments. ' +
      'Payments use personal_sign (off-chain), NOT eth_sendTransaction. ' +
      'NOT for general swaps — use Li.Fi, Squid, or 1inch instead. ' +
      'YELLOW_PERUN_KEY + YELLOW_BROKER_MODE=true required. V2+ only.',
  },
]);

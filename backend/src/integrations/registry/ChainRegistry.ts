/**
 * ChainRegistry — P15
 *
 * Canonical map of every chain Astryum supports or plans to support.
 * Single source of truth for: chainId, name, tier, RPC, explorer URL, CAIP-2,
 * DefiLlama slug, and feature flags.
 *
 * Tiers:
 *   1 — EVM fully supported (data + pool discovery + position detection)
 *   2 — Non-EVM with dedicated provider (Solana via Helius + Jupiter)
 *   3 — Non-EVM partial (XRPL via xrpl.js, P16)
 *
 * Rules (never remove):
 *   - Flare (14) always present; FLARE_DEFI_ENABLED gates protocol adapters only
 *   - Solana uses pseudo chainId 900 internally (not an EVM chainId)
 *   - XRPL uses pseudo chainId 1440002 internally
 *   - No chain is removed from this registry; disabled chains get enabled:false
 */

export type ChainTier = 1 | 2 | 3;

export interface ChainMeta {
  readonly chainId: number;
  readonly name: string;
  readonly tier: ChainTier;
  readonly caip2: string;           // CAIP-2 identifier
  readonly isEvm: boolean;
  readonly nativeCurrency: { symbol: string; decimals: number };
  readonly rpcUrl: string | null;   // public/default RPC (null → uses provider-specific env var)
  readonly explorerUrl: string;
  readonly explorerName: string;    // short name for UI badges
  readonly defiLlamaSlug: string;   // chain name as DefiLlama API returns it
  readonly enabled: boolean;        // false = chain registered but not yet active
  readonly featureFlag?: string;    // env var that gates the chain (e.g. FLARE_DEFI_ENABLED)
  readonly requiresCustomProvider?: string; // provider id needed (e.g. 'xrpl-rpc' for XRPL)
}

// The canonical registry. All chain reads MUST go through getChain() / CHAIN_REGISTRY.
export const CHAIN_REGISTRY: Readonly<Record<number, ChainMeta>> = Object.freeze({
  // ── Tier 1: EVM ──────────────────────────────────────────────────────────
  1: {
    chainId: 1,
    name: 'Ethereum',
    tier: 1,
    caip2: 'eip155:1',
    isEvm: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrl: null, // Alchemy / QuickNode
    explorerUrl: 'https://etherscan.io',
    explorerName: 'Etherscan',
    defiLlamaSlug: 'Ethereum',
    enabled: true,
  },
  56: {
    chainId: 56,
    name: 'BNB Chain',
    tier: 1,
    caip2: 'eip155:56',
    isEvm: true,
    nativeCurrency: { symbol: 'BNB', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://bscscan.com',
    explorerName: 'BscScan',
    defiLlamaSlug: 'BSC',
    enabled: true,
  },
  137: {
    chainId: 137,
    name: 'Polygon',
    tier: 1,
    caip2: 'eip155:137',
    isEvm: true,
    nativeCurrency: { symbol: 'MATIC', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://polygonscan.com',
    explorerName: 'PolygonScan',
    defiLlamaSlug: 'Polygon',
    enabled: true,
  },
  10: {
    chainId: 10,
    name: 'Optimism',
    tier: 1,
    caip2: 'eip155:10',
    isEvm: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://optimistic.etherscan.io',
    explorerName: 'Optimism Explorer',
    defiLlamaSlug: 'Optimism',
    enabled: true,
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum',
    tier: 1,
    caip2: 'eip155:42161',
    isEvm: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://arbiscan.io',
    explorerName: 'Arbiscan',
    defiLlamaSlug: 'Arbitrum',
    enabled: true,
  },
  8453: {
    chainId: 8453,
    name: 'Base',
    tier: 1,
    caip2: 'eip155:8453',
    isEvm: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://basescan.org',
    explorerName: 'BaseScan',
    defiLlamaSlug: 'Base',
    enabled: true,
  },
  43114: {
    chainId: 43114,
    name: 'Avalanche',
    tier: 1,
    caip2: 'eip155:43114',
    isEvm: true,
    nativeCurrency: { symbol: 'AVAX', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://snowtrace.io',
    explorerName: 'Snowtrace',
    defiLlamaSlug: 'Avalanche',
    enabled: true,
  },
  250: {
    chainId: 250,
    name: 'Fantom',
    tier: 1,
    caip2: 'eip155:250',
    isEvm: true,
    nativeCurrency: { symbol: 'FTM', decimals: 18 },
    rpcUrl: 'https://rpc.ftm.tools',
    explorerUrl: 'https://ftmscan.com',
    explorerName: 'FtmScan',
    defiLlamaSlug: 'Fantom',
    enabled: true,
  },
  100: {
    chainId: 100,
    name: 'Gnosis',
    tier: 1,
    caip2: 'eip155:100',
    isEvm: true,
    nativeCurrency: { symbol: 'xDAI', decimals: 18 },
    rpcUrl: 'https://rpc.gnosischain.com',
    explorerUrl: 'https://gnosisscan.io',
    explorerName: 'GnosisScan',
    defiLlamaSlug: 'Gnosis',
    enabled: true,
  },
  59144: {
    chainId: 59144,
    name: 'Linea',
    tier: 1,
    caip2: 'eip155:59144',
    isEvm: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://lineascan.build',
    explorerName: 'LineaScan',
    defiLlamaSlug: 'Linea',
    enabled: true,
  },
  534352: {
    chainId: 534352,
    name: 'Scroll',
    tier: 1,
    caip2: 'eip155:534352',
    isEvm: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrl: 'https://rpc.scroll.io',
    explorerUrl: 'https://scrollscan.com',
    explorerName: 'ScrollScan',
    defiLlamaSlug: 'Scroll',
    enabled: true,
  },
  81457: {
    chainId: 81457,
    name: 'Blast',
    tier: 1,
    caip2: 'eip155:81457',
    isEvm: true,
    nativeCurrency: { symbol: 'ETH', decimals: 18 },
    rpcUrl: null,
    explorerUrl: 'https://blastscan.io',
    explorerName: 'BlastScan',
    defiLlamaSlug: 'Blast',
    enabled: true,
  },
  // ── Flare (EVM, Tier 1, special feature flag) ───────────────────────────
  14: {
    chainId: 14,
    name: 'Flare',
    tier: 1,
    caip2: 'eip155:14',
    isEvm: true,
    nativeCurrency: { symbol: 'FLR', decimals: 18 },
    rpcUrl: 'https://flare-api.flare.network/ext/C/rpc',
    explorerUrl: 'https://flarescan.com',
    explorerName: 'Flarescan',
    defiLlamaSlug: 'Flare',
    enabled: true,
    featureFlag: 'FLARE_DEFI_ENABLED',
  },
  // ── Hedera (P15) ─────────────────────────────────────────────────────────
  296: {
    chainId: 296,
    name: 'Hedera',
    tier: 1,
    caip2: 'eip155:296',
    isEvm: true,  // Hedera EVM-compatible via HashIO JSON-RPC relay
    nativeCurrency: { symbol: 'HBAR', decimals: 8 },
    rpcUrl: 'https://mainnet.hashio.io/api',
    explorerUrl: 'https://hashscan.io',
    explorerName: 'HashScan',
    defiLlamaSlug: 'Hedera',
    enabled: true,
  },
  // ── XDC Network (P15) ────────────────────────────────────────────────────
  50: {
    chainId: 50,
    name: 'XDC',
    tier: 1,
    caip2: 'eip155:50',
    isEvm: true,
    nativeCurrency: { symbol: 'XDC', decimals: 18 },
    rpcUrl: 'https://erpc.xinfin.network',
    explorerUrl: 'https://xdcscan.io',
    explorerName: 'XdcScan',
    defiLlamaSlug: 'XDC',
    enabled: true,
  },
  // ── Tier 2: Solana (P14) ─────────────────────────────────────────────────
  // Pseudo chainId 900 — not an EVM chainId; used internally only.
  900: {
    chainId: 900,
    name: 'Solana',
    tier: 2,
    caip2: 'solana:mainnet',
    isEvm: false,
    nativeCurrency: { symbol: 'SOL', decimals: 9 },
    rpcUrl: null, // Helius (HELIUS_API_KEY) or public mainnet-beta.solana.com
    explorerUrl: 'https://solscan.io',
    explorerName: 'Solscan',
    defiLlamaSlug: 'Solana',
    enabled: true,
    requiresCustomProvider: 'helius-rpc',
  },
  // ── Tier 3: XRPL (P16) ───────────────────────────────────────────────────
  // Pseudo chainId 1440002 — used internally only (not an EVM chainId).
  // Signing is handled by Xaman (XUMM). Astryum never signs XRPL transactions.
  1440002: {
    chainId: 1440002,
    name: 'XRPL',
    tier: 3,
    caip2: 'xrpl:mainnet',
    isEvm: false,
    nativeCurrency: { symbol: 'XRP', decimals: 6 },
    rpcUrl: 'wss://xrplcluster.com',
    explorerUrl: 'https://livenet.xrpl.org',
    explorerName: 'XRPL Explorer',
    defiLlamaSlug: 'XRPL',
    enabled: true,  // activated P16
    requiresCustomProvider: 'xrpl-rpc',
  },
  // ── IOTA EVM (Tier 1, real EVM chainId 8822) — ISO 20022 basket (PROD-1c) ──
  // EVM-compatible → ejecuta por el pipeline existente (ContractRegistry/kinds).
  // Enso NO la cubre; ejecución vía kinds conocidos. Discovery vía DefiLlama.
  8822: {
    chainId: 8822,
    name: 'IOTA EVM',
    tier: 1,
    caip2: 'eip155:8822',
    isEvm: true,
    nativeCurrency: { symbol: 'IOTA', decimals: 18 },
    rpcUrl: 'https://json-rpc.evm.iotaledger.net',
    explorerUrl: 'https://explorer.evm.iota.org',
    explorerName: 'IOTA EVM Explorer',
    defiLlamaSlug: 'IOTA EVM', // ⚠️ confirmar slug exacto en DefiLlama
    enabled: true,
  },
  // ── Tier 3: Stellar (non-EVM) — ISO 20022 basket (PROD-1c) ─────────────────
  // Pseudo chainId 1500001 (interno). Ejecución vía Soroswap aggregator (XDR
  // sin firmar, patrón Jupiter), firma Freighter/Lobstr — Astryum nunca firma.
  // enabled:false hasta que exista el provider 'soroswap'; flip a true entonces.
  1500001: {
    chainId: 1500001,
    name: 'Stellar',
    tier: 3,
    caip2: 'stellar:pubnet',
    isEvm: false,
    nativeCurrency: { symbol: 'XLM', decimals: 7 },
    rpcUrl: 'https://horizon.stellar.org',
    explorerUrl: 'https://stellar.expert/explorer/public',
    explorerName: 'Stellar Expert',
    defiLlamaSlug: 'Stellar',
    enabled: true, // Soroswap provider + /api/swap/stellar route + Freighter wired (2026-06-07)
    requiresCustomProvider: 'soroswap',
  },
  // ── Tier 2: Algorand (non-EVM) — ISO 20022 basket (PROD-1c) ────────────────
  // Pseudo chainId 1500002 (interno). Ejecución vía Folks Finance / Tinyman
  // (txn sin firmar, patrón Jupiter), firma Pera/Defly.
  // enabled:false hasta que exista el provider 'algorand-defi'.
  1500002: {
    chainId: 1500002,
    name: 'Algorand',
    tier: 2,
    caip2: 'algorand:mainnet',
    isEvm: false,
    nativeCurrency: { symbol: 'ALGO', decimals: 6 },
    rpcUrl: 'https://mainnet-api.algonode.cloud',
    explorerUrl: 'https://allo.info',
    explorerName: 'Allo',
    defiLlamaSlug: 'Algorand',
    enabled: false, // pendiente provider Algorand (#3)
    requiresCustomProvider: 'algorand-defi',
  },
  // ── Plume (EVM, Tier 1, RWA L2) — added 2026-06-07 ─────────────────────────
  98866: {
    chainId: 98866,
    name: 'Plume',
    tier: 1,
    caip2: 'eip155:98866',
    isEvm: true,
    nativeCurrency: { symbol: 'PLUME', decimals: 18 },
    rpcUrl: 'https://rpc.plumenetwork.xyz', // ⚠️ confirmar RPC oficial
    explorerUrl: 'https://explorer.plume.org', // ⚠️ confirmar
    explorerName: 'Plume Explorer',
    defiLlamaSlug: 'Plume Mainnet', // ⚠️ confirmar slug exacto en DefiLlama
    enabled: true,
  },
  // ── Sei EVM (Tier 1) — added 2026-06-07 ────────────────────────────────────
  1329: {
    chainId: 1329,
    name: 'Sei',
    tier: 1,
    caip2: 'eip155:1329',
    isEvm: true,
    nativeCurrency: { symbol: 'SEI', decimals: 18 },
    rpcUrl: 'https://evm-rpc.sei-apis.com',
    explorerUrl: 'https://seitrace.com',
    explorerName: 'Seitrace',
    defiLlamaSlug: 'Sei', // ⚠️ confirmar slug exacto en DefiLlama
    enabled: true,
  },
  // ── HyperEVM (Hyperliquid, EVM Tier 1, chainId 999) — added 2026-06-07 ─────
  999: {
    chainId: 999,
    name: 'HyperEVM',
    tier: 1,
    caip2: 'eip155:999',
    isEvm: true,
    nativeCurrency: { symbol: 'HYPE', decimals: 18 },
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    explorerUrl: 'https://hyperevmscan.io',
    explorerName: 'HyperEVM Scan',
    defiLlamaSlug: 'Hyperliquid L1', // ⚠️ confirmar slug exacto (URL: hyperliquid-l1)
    enabled: true,
  },
  // ── Tier 2: Aptos (non-EVM, Move) — pseudo chainId 1500003 (interno) ───────
  // Wallet partner ya existe (useAptosWalletPartner/Petra). Discovery vía
  // DefiLlama. Ejecución DeFi nativa (Thala/PancakeSwap Aptos) = provider pendiente.
  1500003: {
    chainId: 1500003,
    name: 'Aptos',
    tier: 2,
    caip2: 'aptos:mainnet',
    isEvm: false,
    nativeCurrency: { symbol: 'APT', decimals: 8 },
    rpcUrl: 'https://fullnode.mainnet.aptoslabs.com/v1',
    explorerUrl: 'https://explorer.aptoslabs.com',
    explorerName: 'Aptos Explorer',
    defiLlamaSlug: 'Aptos',
    enabled: true,
    requiresCustomProvider: 'aptos-rpc',
  },
  // ── Tier 3: Bitcoin (non-EVM, UTXO) — pseudo chainId 1500000 (interno) ──────
  // Read-only balance via public REST (Blockstream/Mempool). Connect via AppKit
  // Bitcoin adapter (Xverse, Leather). Astryum never signs BTC transactions.
  1500000: {
    chainId: 1500000,
    name: 'Bitcoin',
    tier: 3,
    caip2: 'bip122:000000000019d6689c085ae165831e93',
    isEvm: false,
    nativeCurrency: { symbol: 'BTC', decimals: 8 },
    rpcUrl: 'https://blockstream.info/api',
    explorerUrl: 'https://blockstream.info',
    explorerName: 'Blockstream',
    defiLlamaSlug: 'Bitcoin',
    enabled: true,
    requiresCustomProvider: 'bitcoin-rest',
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────

/** Returns ChainMeta for the given chainId, or throws if unknown. */
export function getChain(chainId: number): ChainMeta {
  const chain = CHAIN_REGISTRY[chainId];
  if (!chain) throw new Error(`ChainRegistry: unknown chainId ${chainId}`);
  return chain;
}

/** Returns ChainMeta or null — never throws. */
export function getChainOrNull(chainId: number): ChainMeta | null {
  return CHAIN_REGISTRY[chainId] ?? null;
}

/** All enabled chainIds. */
export function enabledChainIds(): number[] {
  return Object.values(CHAIN_REGISTRY)
    .filter((c) => c.enabled)
    .map((c) => c.chainId);
}

/** All enabled EVM chainIds. */
export function enabledEvmChainIds(): number[] {
  return Object.values(CHAIN_REGISTRY)
    .filter((c) => c.enabled && c.isEvm)
    .map((c) => c.chainId);
}

/** Tier 1 enabled EVM chainIds — full discovery + pools. */
export function tier1ChainIds(): number[] {
  return Object.values(CHAIN_REGISTRY)
    .filter((c) => c.enabled && c.tier === 1)
    .map((c) => c.chainId);
}

/** Returns true if the chain is supported and enabled. */
export function isChainSupported(chainId: number): boolean {
  return CHAIN_REGISTRY[chainId]?.enabled === true;
}

/** Lookup chainId from a DefiLlama chain slug. */
export function chainIdFromDefiLlamaSlug(slug: string): number | undefined {
  return Object.values(CHAIN_REGISTRY).find((c) => c.defiLlamaSlug === slug)?.chainId;
}

/** Returns the CAIP-2 identifier for a chainId. */
export function toCaip2(chainId: number): string {
  return CHAIN_REGISTRY[chainId]?.caip2 ?? `eip155:${chainId}`;
}

/** All unique DefiLlama slugs for enabled chains (used to filter pool sync). */
export function enabledDefiLlamaSlugs(): string[] {
  return Object.values(CHAIN_REGISTRY)
    .filter((c) => c.enabled && c.defiLlamaSlug)
    .map((c) => c.defiLlamaSlug);
}

// ── Capability matrix (audit P2-3) ──────────────────────────────────────────
// `enabled` alone hides what a chain can actually DO. This matrix makes the
// frontier explicit and HONEST so the UI never claims "supported" when only,
// say, balance-reading works. Conservative by design: a capability is only true
// when there is real wiring behind it (no over-claiming).
export interface ChainCapabilities {
  discovery: boolean;  // protocol/pool discovery (DefiLlama)
  balances: boolean;   // read token balances
  positions: boolean;  // detect DeFi positions (lending / LP / staking)
  prepare: boolean;    // build an UNSIGNED action (calldata / XDR / XRPL payload)
  sign: boolean;       // a wallet integration exists for the user to sign
  reconcile: boolean;  // settlement can be tracked → ExecutionReceipt
}

// Per-chain overrides for NON-EVM chains (EVM is derived below). Anything not
// listed stays at the conservative non-EVM default (balances/discovery only).
const CHAIN_CAPABILITY_OVERRIDES: Readonly<Record<number, Partial<ChainCapabilities>>> = Object.freeze({
  900:     { prepare: true, sign: true, reconcile: true },                       // Solana: Jupiter swap + AppKit
  1440002: { prepare: true, sign: true, reconcile: true },                       // XRPL: Xaman / MCP payloads
  1500001: { positions: true, prepare: true, sign: true, reconcile: true },      // Stellar: Blend/Soroswap + Freighter
  1500003: { sign: true },                                                       // Aptos: Petra (read+sign); native DeFi exec pending
  1500000: { discovery: false, sign: false },                                    // Bitcoin: read-only; Astryum never signs BTC
});

/**
 * Resolved capabilities for a chain. EVM chains are derived (full pipeline);
 * Flare's execution-side capabilities are gated by FLARE_DEFI_ENABLED.
 * Non-EVM chains use the conservative default + explicit overrides above.
 */
export function getChainCapabilities(chainId: number): ChainCapabilities {
  const c = getChainOrNull(chainId);
  const none: ChainCapabilities = {
    discovery: false, balances: false, positions: false, prepare: false, sign: false, reconcile: false,
  };
  if (!c || !c.enabled) return none;

  const flareOff = c.featureFlag === 'FLARE_DEFI_ENABLED' && process.env.FLARE_DEFI_ENABLED !== 'true';

  if (c.isEvm) {
    return {
      discovery: !!c.defiLlamaSlug,
      balances: true,
      positions: !flareOff,
      prepare: !flareOff,
      sign: true,
      reconcile: !flareOff,
    };
  }

  // Non-EVM conservative default: read-only (discovery + balances) unless an
  // explicit override grants more.
  return {
    discovery: !!c.defiLlamaSlug,
    balances: true,
    positions: false,
    prepare: false,
    sign: false,
    reconcile: false,
    ...CHAIN_CAPABILITY_OVERRIDES[chainId],
  };
}

/** Capability matrix for every registered chain, keyed by chainId. */
export function allChainCapabilities(): Record<number, ChainCapabilities & { name: string; enabled: boolean; tier: ChainTier }> {
  const out: Record<number, ChainCapabilities & { name: string; enabled: boolean; tier: ChainTier }> = {};
  for (const c of Object.values(CHAIN_REGISTRY)) {
    out[c.chainId] = { ...getChainCapabilities(c.chainId), name: c.name, enabled: c.enabled, tier: c.tier };
  }
  return out;
}

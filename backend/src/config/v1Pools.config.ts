/**
 * v1Pools.config.ts — Curated, AUTHORIZED v1 pool set ("Producción de activos").
 *
 * SINGLE SOURCE OF TRUTH for WHICH pools the Asset Production screen shows and
 * HOW each one routes to execution. Mirrors the LOCKED set in
 * docs/context/Astryum_Plan_Implementacion_Completo_2026-06-12.md (D3, líneas 73-77).
 *
 * INVARIANTS respected here (see /CLAUDE.md):
 *   #3  receiptTokenAddress ≠ executionContractAddress — entries reference the
 *       INTERACTION contract only (resolver / env / in-provider), never a receipt token.
 *   #4  EU-facing executable EMTs only (USDC · EURC · RLUSD). USDT is read-only:
 *       it may appear for monitoring but is never in an executable `ops` list.
 *   #7  APY is protocol data with a source — never a promise. This file holds NO apy.
 *   #8  Nothing ships without its scanner + flag. Flare stays behind FLARE_DEFI_ENABLED.
 *   No address is fabricated: EVM singletons resolve via contractResolvers/verifiedAddresses;
 *   Flare addresses live in backend/.env (referenced by env key, not duplicated here);
 *   Stellar Soroban contract ids resolve inside Blend/Soroswap providers.
 *
 * ROUTER tells the intent layer WHO builds the unsigned calldata. The regulatory
 * envelope (authorization.astryumRelays:false, referralAttribution.disclosedToUser:true,
 * PolicyGuard P38, anomaly-block, simulation, audit/receipt) is ALWAYS applied by the
 * single intent chokepoint — the router only swaps the calldata SOURCE:
 *   'registry'  → ContractRegistry + CalldataBuilder ACTION_SHAPE_BY_KIND (EVM PATH A/B)
 *   'connector' → IProtocolAdapter (PATH C, Flare bespoke) — adapter encodes the tx
 *   'stellar'   → dedicated Soroban routes (/blend/prepare, /swap/stellar/liquidity/add)
 */

import { getProtocolConfig } from './protocolContracts';
import { sparkPoolFor, lidoStethFor, sceptreFor } from '../services/contractResolvers/verifiedAddresses';

/** Chain ids used by the curated set. Stellar is non-EVM → 0 (display-only chainId). */
export const V1_CHAIN = {
  ETHEREUM: 1,
  OPTIMISM: 10,
  POLYGON: 137,
  BASE: 8453,
  ARBITRUM: 42161,
  FLARE: 14,
  STELLAR: 0,
} as const;

export type V1Ecosystem = 'stables' | 'eth' | 'flare' | 'stellar';
export type V1Vm = 'evm' | 'stellar';
export type V1Router = 'registry' | 'connector' | 'stellar';

/** Canonical action vocabulary for the curated set (USDT never gets executable ops). */
export type V1Op =
  | 'supply' | 'borrow' | 'repay' | 'withdraw'
  | 'stake' | 'unstake'
  | 'add_liquidity' | 'remove_liquidity';

/**
 * Execution readiness — HONEST about what the button does today.
 *   'executable'    calldata path is wired now (registry kind / stellar route exists)
 *   'pending_exec'  interaction contract is known but the calldata encoder is not
 *                   wired yet (Flare Kinetic/SparkDEX connectors don't fill txData).
 *   'needs_address' interaction contract address not yet sourced (e.g. FXRP_TOKEN empty).
 */
export type V1ExecStatus = 'executable' | 'pending_exec' | 'needs_address';

/**
 * Where the interaction contract comes from. NO literal addresses live here —
 * we point at the existing resolution mechanism so there is one source of truth.
 */
export type V1ContractRef =
  | { kind: 'resolver' }                       // EVM singleton — contractResolvers derive it from (kind, chainId[, asset])
  | { kind: 'env'; envKeys: readonly string[] }// Flare — addresses are in backend/.env (referenced, not copied)
  | { kind: 'stellar' };                       // Stellar — Soroban contract ids resolve inside the provider

export interface V1PoolEntry {
  /** Stable internal id (kebab). Used as the synthetic display poolId when the pool is not in the live feed. */
  readonly key: string;
  readonly ecosystem: V1Ecosystem;
  readonly vm: V1Vm;
  readonly chainId: number;
  readonly displayName: string;
  /**
   * DefiLlama project slug(s) used to MATCH this entry against the live canonical
   * feed (CanonicalYieldSource.protocol). First slug is the canonical one passed to
   * execution as `protocolSlug`. Extra slugs cover DefiLlama naming variants.
   */
  readonly defiLlamaSlugs: readonly string[];
  /**
   * Asset symbols this entry covers. Used both for feed matching (symbol ⊇ asset)
   * and for synthetic display rows. EMTs only in executable entries (#4).
   */
  readonly assets: readonly string[];
  /** Executable operations. USDT-only markets carry [] (read-only). */
  readonly ops: readonly V1Op[];
  /**
   * How `assets` matches the live feed symbol:
   *   'asset_token' (default) — symbol contains one of `assets` as a token. Good for
   *                             single-asset lend/borrow/stake AND for LP "≥1 family
   *                             token" (set `assets` to the family list).
   *   'exact_symbol'          — symbol normalizes EXACTLY to one of `assets`. Used by
   *                             Morpho so curator vault tokens (KPK-USDC-PRIME) are
   *                             excluded and only clean regulated-stable markets match.
   */
  readonly matchMode?: 'asset_token' | 'exact_symbol';
  readonly router: V1Router;
  /** For router:'connector' — the IProtocolAdapter.protocolId that builds calldata. */
  readonly adapterId?: string;
  readonly contract: V1ContractRef;
  readonly exec: V1ExecStatus;
  /** True for pools NOT reliably present in the DefiLlama feed → injected as synthetic display rows. */
  readonly synthetic?: boolean;
  readonly note?: string;
}

/* ------------------------------------------------------------------ */
/* THE LOCKED SET                                                      */
/* ------------------------------------------------------------------ */

export const V1_POOLS: readonly V1PoolEntry[] = Object.freeze([
  // ── Stablecoins — EVM lend/borrow (Aave / Morpho / Spark). EMTs only. ──────
  // Addresses resolve via contractResolvers (aave_v3_pool / spark_pool singletons,
  // morpho_blue + per-market params). Live feed supplies APY/TVL + the asset address.
  {
    key: 'aave-v3-emt-evm',
    ecosystem: 'stables', vm: 'evm', chainId: V1_CHAIN.ETHEREUM,
    displayName: 'Aave V3 — EMT lend/borrow',
    defiLlamaSlugs: ['aave-v3'],
    assets: ['USDC', 'EURC', 'RLUSD'],
    ops: ['supply', 'borrow', 'repay', 'withdraw'],
    router: 'registry', contract: { kind: 'resolver' }, exec: 'executable',
    note: 'Also matched on Arbitrum/Base/Polygon/Optimism via chain-agnostic membership (see isV1Pool).',
  },
  {
    key: 'morpho-blue-emt-eth',
    ecosystem: 'stables', vm: 'evm', chainId: V1_CHAIN.ETHEREUM,
    displayName: 'Morpho Blue — EMT markets',
    defiLlamaSlugs: ['morpho-blue'],
    // Regulated stables ONLY (user directive). exact_symbol excludes MetaMorpho
    // curator vault tokens (KPK-USDC-PRIME, …) — only clean USDC/RLUSD/EURC markets.
    assets: ['USDC', 'EURC', 'RLUSD'],
    matchMode: 'exact_symbol',
    ops: ['supply', 'borrow', 'repay', 'withdraw'],
    router: 'registry', contract: { kind: 'resolver' }, exec: 'executable',
    note: 'REALITY: DefiLlama exposes ~no clean Morpho Blue EMT markets (805 pools are MetaMorpho vaults; only 3 ~$0 USDC rows match exact). Real USDC/RLUSD/EURC coverage needs the Morpho SDK (D3 pending: "SDK Morpho 1-tx") + resolved marketParams — not DefiLlama. Kept strict so nothing noisy/non-executable shows meanwhile.',
  },
  {
    key: 'spark-emt-eth',
    ecosystem: 'stables', vm: 'evm', chainId: V1_CHAIN.ETHEREUM,
    displayName: 'Spark — EMT lend/borrow',
    // Verified against live feed: Spark's LENDING market is 'sparklend' (Ethereum).
    // 'spark-savings' (sUSDS, ERC-4626) is a separate product — own entry later.
    defiLlamaSlugs: ['sparklend'],
    assets: ['USDC', 'RLUSD', 'EURC'],
    ops: ['supply', 'borrow', 'repay', 'withdraw'],
    // spark_pool kind + verifiedAddresses (Ethereum) — slug 'sparklend' now mapped in contractKinds.
    router: 'registry', contract: { kind: 'resolver' }, exec: 'executable',
  },

  // ── ETH — ETH · stETH (Lido) + EMT lend/borrow already covered above ───────
  {
    key: 'lido-steth-eth',
    ecosystem: 'eth', vm: 'evm', chainId: V1_CHAIN.ETHEREUM,
    displayName: 'Lido — stETH staking',
    defiLlamaSlugs: ['lido'],
    assets: ['ETH', 'STETH'],
    ops: ['stake', 'unstake'],
    router: 'registry', contract: { kind: 'resolver' }, exec: 'executable',
    note: 'lido_steth kind. unstake has a ~7d protocol cooldown (disclosed at review).',
  },

  // ── Flare (chainId 14) — PATH C bespoke connectors. Behind FLARE_DEFI_ENABLED. ──
  {
    key: 'sceptre-sflr-flare',
    ecosystem: 'flare', vm: 'evm', chainId: V1_CHAIN.FLARE,
    displayName: 'Sceptre — sFLR liquid staking',
    // Live feed slug is 'sceptre-liquid'; 'sceptre-staked-flr' kept for legacy/registry.
    defiLlamaSlugs: ['sceptre-liquid', 'sceptre-staked-flr'],
    assets: ['FLR', 'SFLR', 'WFLR'],
    ops: ['stake', 'unstake'],
    // sceptre_vault kind IS wired in CalldataBuilder + verifiedAddresses → executable via registry.
    router: 'registry', contract: { kind: 'env', envKeys: ['SCEPTRE_SFLR_ADDRESS'] }, exec: 'executable',
  },
  {
    key: 'kinetic-lend-flare',
    ecosystem: 'flare', vm: 'evm', chainId: V1_CHAIN.FLARE,
    displayName: 'Kinetic — lend/borrow',
    defiLlamaSlugs: ['kinetic'],
    // Verified against live feed (Flare): markets are WFLR, SFLR, FLRETH, WETH, USDC.E, FXRP.
    // USD₮0 (USDT family) deliberately excluded from executable assets (#4, read-only).
    assets: ['USDC.E', 'WFLR', 'SFLR', 'WETH', 'FLRETH', 'FXRP'],
    ops: ['supply', 'borrow', 'repay', 'withdraw'],
    router: 'connector', adapterId: 'kinetic',
    contract: { kind: 'env', envKeys: ['KINETIC_COMPTROLLER', 'KINETIC_LENS', 'KINETIC_KUSDCE', 'KINETIC_KFLR', 'KINETIC_KSFLR', 'KINETIC_KWETH', 'KINETIC_KFLRETH'] },
    exec: 'pending_exec',
    note: 'Comptroller + kTokens in .env. KineticAdapter scans/simulates but does not yet ENCODE calldata (mint/borrow/redeem/repayBorrow) — Phase: connector calldata.',
  },
  {
    key: 'sparkdex-lp-flare',
    ecosystem: 'flare', vm: 'evm', chainId: V1_CHAIN.FLARE,
    displayName: 'SparkDEX — concentrated LP',
    // Verified against live feed (Flare): 'sparkdex-v3.1' (V3 concentrated) + 'sparkdex-v4'.
    defiLlamaSlugs: ['sparkdex-v3.1', 'sparkdex-v4'],
    // User directive: native FLR + its derivatives, FXRP + its derivatives, ALL their
    // pairs. matchMode 'asset_token' over the family list = "≥1 family token in the pair".
    // The canonical feed's TVL floor drops dust pairs. The token a pair is paired WITH
    // (USDC.E, USD₮0, WETH…) is unrestricted — that's "todos sus pares".
    assets: ['FLR', 'WFLR', 'SFLR', 'FLRETH', 'STFLR', 'FXRP', 'STXRP'],
    ops: ['add_liquidity', 'remove_liquidity'],
    router: 'connector', adapterId: 'sparkdex',
    contract: { kind: 'env', envKeys: ['SPARKDEX_NFPM', 'SPARKDEX_FACTORY', 'SPARKDEX_ROUTER'] },
    exec: 'pending_exec',
    note: 'NFPM/factory/router in .env. SparkDEXAdapter does not yet ENCODE mint/increaseLiquidity calldata — Phase: connector calldata.',
  },
  {
    key: 'fxrp-flare',
    ecosystem: 'flare', vm: 'evm', chainId: V1_CHAIN.FLARE,
    displayName: 'FXRP (FAssets)',
    defiLlamaSlugs: [],
    assets: ['FXRP'],
    ops: [],
    router: 'connector', adapterId: 'fxrp',
    contract: { kind: 'env', envKeys: ['FXRP_TOKEN'] },
    exec: 'needs_address', synthetic: true,
    note: 'FXRP_TOKEN is EMPTY in .env — display-only until the FAssets FXRP ERC-20 address is sourced + verified.',
  },

  // ── Stellar (chainId 0, vm stellar) — dedicated Soroban routes ─────────────
  {
    key: 'blend-lend-stellar',
    ecosystem: 'stellar', vm: 'stellar', chainId: V1_CHAIN.STELLAR,
    displayName: 'Blend — XLM · sUSDC lend/borrow',
    // Verified against live feed: 'blend-pools-v2' (Stellar) — appears in the feed,
    // so it may match LIVE (chainId 0); synthetic row is the fallback if filtered out.
    defiLlamaSlugs: ['blend-pools-v2'],
    assets: ['XLM', 'SUSDC', 'USDC'],
    ops: ['supply', 'borrow', 'repay', 'withdraw'],
    router: 'stellar', contract: { kind: 'stellar' }, exec: 'executable', synthetic: true,
    note: 'Prepared XDR via /blend/prepare; signed in Freighter. Pool id + SEP-41 asset contract resolved in BlendProvider.',
  },
  {
    key: 'soroswap-lp-stellar',
    ecosystem: 'stellar', vm: 'stellar', chainId: V1_CHAIN.STELLAR,
    displayName: 'Soroswap — XLM LP',
    defiLlamaSlugs: ['soroswap'],
    assets: ['XLM', 'USDC'],
    ops: ['add_liquidity', 'remove_liquidity'],
    router: 'stellar', contract: { kind: 'stellar' }, exec: 'executable', synthetic: true,
    note: 'Prepared XDR via /swap/stellar/liquidity/add (two-asset). SOROSWAP_API_KEY configured.',
  },
]);

/* ------------------------------------------------------------------ */
/* MATCHING HELPERS                                                    */
/* ------------------------------------------------------------------ */

/** Normalize a token symbol for loose comparison: upper, strip separators/suffixes. */
function normSym(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Split a pool symbol ("USDC-XLM", "WETH/USDC", "stETH") into normalized tokens. */
function symbolTokens(symbol: string): string[] {
  return symbol.split(/[-/\s]+/).map(normSym).filter(Boolean);
}

/** Chains where a 'stables'/'eth' EVM entry is considered in-set, beyond its declared chainId. */
const EMT_EVM_CHAINS: ReadonlySet<number> = new Set([
  V1_CHAIN.ETHEREUM, V1_CHAIN.ARBITRUM, V1_CHAIN.BASE, V1_CHAIN.POLYGON, V1_CHAIN.OPTIMISM,
]);

/**
 * Does this curated entry MATCH a live feed pool?
 * Match = slug ∈ entry.defiLlamaSlugs AND chain allowed AND the pool symbol contains
 * one of the entry's assets. EMT EVM entries match across the major chains (the live
 * feed carries per-chain rows for the same slug); Flare/Stellar match their own chain.
 */
function entryMatchesPool(
  entry: V1PoolEntry,
  pool: { protocol: string; chainId: number; symbol: string },
): boolean {
  const slug = pool.protocol.toLowerCase();
  if (!entry.defiLlamaSlugs.some((s) => s.toLowerCase() === slug)) return false;

  const chainOk =
    (entry.ecosystem === 'stables' || entry.ecosystem === 'eth')
      ? EMT_EVM_CHAINS.has(pool.chainId)
      : pool.chainId === entry.chainId;
  if (!chainOk) return false;

  // Morpho: only a clean regulated-stable symbol counts (exclude MetaMorpho vault tokens).
  if (entry.matchMode === 'exact_symbol') {
    const sym = normSym(pool.symbol);
    return entry.assets.some((a) => normSym(a) === sym);
  }
  // Default: the symbol contains at least one of the entry's assets as a token.
  // For LP entries `assets` is the FLR/FXRP family list → "≥1 family token in the pair".
  const tokens = new Set(symbolTokens(pool.symbol));
  return entry.assets.some((a) => tokens.has(normSym(a)));
}

/** Find the curated entry a live feed pool belongs to, or null. */
export function findV1Entry(pool: {
  protocol: string;
  chainId: number;
  symbol: string;
}): V1PoolEntry | null {
  return V1_POOLS.find((e) => entryMatchesPool(e, pool)) ?? null;
}

/** Is this live feed pool part of the curated v1 set? (display filter membership) */
export function isV1Pool(pool: { protocol: string; chainId: number; symbol: string }): boolean {
  return findV1Entry(pool) !== null;
}

/** Entries that must be injected as synthetic display rows (not reliably in the DefiLlama feed). */
export function syntheticV1Entries(): V1PoolEntry[] {
  return V1_POOLS.filter((e) => e.synthetic === true);
}

/** Find the curated entry that owns a (slug, chainId) — for router/adapter dispatch at the intent neck. */
function entryForSlugChain(slug: string, chainId: number): V1PoolEntry | null {
  return (
    V1_POOLS.find(
      (x) =>
        x.defiLlamaSlugs.some((s) => s.toLowerCase() === slug.toLowerCase()) &&
        (((x.ecosystem === 'stables' || x.ecosystem === 'eth') && EMT_EVM_CHAINS.has(chainId)) ||
          x.chainId === chainId),
    ) ?? null
  );
}

/** Resolve the router for a given (slug, chainId) — used by the intent layer to pick the calldata source. */
export function v1RouterFor(slug: string, chainId: number): V1Router | null {
  return entryForSlugChain(slug, chainId)?.router ?? null;
}

/** Resolve the IProtocolAdapter.protocolId that encodes calldata for a connector-routed (slug, chainId). */
export function v1AdapterFor(slug: string, chainId: number): string | null {
  const e = entryForSlugChain(slug, chainId);
  return e?.router === 'connector' ? e.adapterId ?? null : null;
}

/**
 * Best-effort DISPLAY interaction contract for a curated entry — the address the
 * user sees on the Asset Production card. Sourced ONLY from verified tables /
 * env (never fabricated): EVM singletons resolve from protocolContracts +
 * verifiedAddresses; Flare from env; per-market / per-pool / Stellar return null
 * ("resuelto al preparar" — the exact contract is resolved at prepare time).
 */
export function v1DisplayContract(entry: V1PoolEntry, chainId: number): string | null {
  switch (entry.key) {
    case 'aave-v3-emt-evm':
      return getProtocolConfig('aave-v3')?.chains[chainId]?.poolAddress ?? null;
    case 'morpho-blue-emt-eth':
      return getProtocolConfig('morpho-blue')?.chains[chainId]?.poolAddress ?? null;
    case 'spark-emt-eth':
      return sparkPoolFor(chainId);
    case 'lido-steth-eth':
      return lidoStethFor(chainId);
    case 'sceptre-sflr-flare':
      return sceptreFor(chainId);
  }
  // Connector (Flare): the protocol's primary contract lives in env (Kinetic
  // comptroller / SparkDEX NFPM). The per-asset market (kToken) is resolved at prepare.
  if (entry.contract.kind === 'env') {
    const a = process.env[entry.contract.envKeys[0]];
    return a && /^0x[a-fA-F0-9]{40}$/.test(a) ? a : null;
  }
  return null; // stellar / per-pool → resolved at prepare
}

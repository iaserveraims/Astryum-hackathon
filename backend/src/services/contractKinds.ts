/**
 * Contract Kinds — protocol family taxonomy for the ContractRegistry.
 *
 * Block F (2026-06-01) — Every DefiLlama pool we ingest gets classified into
 * exactly one ContractKind. The kind drives:
 *   1. Which per-kind resolver runs (services/contractResolvers/*)
 *   2. Which ABI source is preferred (SDK vs Etherscan vs DefiLlama decoder)
 *   3. How CalldataBuilder encodes the operation (Aave's supply() args ≠
 *      Compound's supply() args ≠ ERC-4626 deposit() args)
 *
 * When the slug is unknown to us, the dispatcher falls back to
 * `unknownResolver` which probes on-chain. If that also fails the pool is
 * marked isActive: false (read-only display).
 */

/** Canonical kind names. Persisted as strings in ProtocolPool.contractKind. */
export type ContractKind =
  | 'aave_v3_pool'
  | 'aave_v2_pool'
  | 'comet_v3'
  | 'lido_steth'
  | 'rocket_pool_deposit'
  | 'sceptre_vault'
  | 'erc4626_vault'
  | 'morpho_blue'
  | 'spark_pool'
  | 'uniswap_v3_nfpm'
  | 'uniswap_v2_router'
  | 'curve_pool'
  | 'balancer_v2_vault'
  | 'unknown';

export type AbiSource =
  | 'defillama_decoder'
  | 'etherscan_v2'
  | 'sdk_official'
  | 'manual_fallback'
  | 'protocolcontracts_legacy'
  | 'unresolved';

/**
 * DefiLlama protocol slug → ContractKind.
 *
 * Slugs come from DefiLlama's /pools response `project` field. The mapping is
 * intentionally explicit — we do NOT pattern-match slugs, because slugs evolve
 * (e.g. 'aave-v3-arbitrum' vs 'aave-v3') and a typo could open an unverified
 * contract path. Every new protocol family is opt-in.
 */
export const PROTOCOL_KIND_MAP: Readonly<Record<string, ContractKind>> = Object.freeze({
  // Lending — Aave family
  'aave-v3':            'aave_v3_pool',
  'aave-v2':            'aave_v2_pool',
  'spark':              'spark_pool',         // Spark is an Aave V3 fork — same shape
  'sparklend':          'spark_pool',         // current DefiLlama slug for Spark's lending market

  // Lending — Compound family
  'compound-v3':        'comet_v3',

  // Lending — Morpho
  'morpho-blue':        'morpho_blue',

  // Liquid staking
  'lido':               'lido_steth',
  'rocket-pool':        'rocket_pool_deposit',
  'sceptre':            'sceptre_vault',
  'sceptre-staked-flr': 'sceptre_vault',
  'sceptre-liquid':     'sceptre_vault',      // current DefiLlama slug for Sceptre sFLR

  // Vaults (ERC-4626-compatible)
  'yearn-finance':      'erc4626_vault',
  'ether.fi':           'erc4626_vault',
  'frax-ether':         'erc4626_vault',
  // Sky / USDS Savings (sUSDS) — standard ERC-4626 savings vault. Distinct slug
  // from the 'spark' lending market above (no collision); executes via the
  // erc4626 deposit/withdraw path. (D3: "Spark sUSDS".)
  'sky-lending':        'erc4626_vault',
  'susds':              'erc4626_vault',

  // DEX / LP
  'uniswap-v3':         'uniswap_v3_nfpm',
  'sushiswap':          'uniswap_v2_router',
  'curve-finance':      'curve_pool',
  'curve-dex':          'curve_pool',
  'balancer-v2':        'balancer_v2_vault',
});

/**
 * Capability detection from DefiLlama data shape + the resolved ContractKind.
 *
 * NB: borrow capability is split into two booleans on ProtocolPool:
 *   - `borrowable` (pool offers borrowing per DefiLlama)
 *   - `supportsBorrowCapability` (the resolved interaction contract has
 *     a borrow() method we can encode)
 * Both must be true for CalldataBuilder to encode a borrow intent.
 */
export interface CapabilityInput {
  contractKind: ContractKind;
  /** Function names found in the resolved ABI. Lowercased Set for O(1) lookup. */
  abiFunctionNames: Set<string>;
  /** DefiLlama data shape signals. */
  pool: {
    apyBaseBorrow: number | null | undefined;
    underlyingTokens: ReadonlyArray<string>;
    rewardTokens: ReadonlyArray<string>;
    isLiquidStaking: boolean;
    symbol: string;
  };
}

export interface CapabilityFlags {
  supportsSupply: boolean;
  supportsWithdraw: boolean;
  supportsBorrowCapability: boolean;
  supportsRepay: boolean;
  supportsStake: boolean;
  supportsUnstake: boolean;
  supportsAddLiquidity: boolean;
  supportsRemoveLiquidity: boolean;
  supportsVaultDeposit: boolean;
  supportsVaultWithdraw: boolean;
}

export function detectCapabilities(input: CapabilityInput): CapabilityFlags {
  const { contractKind, abiFunctionNames, pool } = input;
  const has = (...names: string[]) => names.some((n) => abiFunctionNames.has(n.toLowerCase()));

  const flags: CapabilityFlags = {
    supportsSupply: false,
    supportsWithdraw: false,
    supportsBorrowCapability: false,
    supportsRepay: false,
    supportsStake: false,
    supportsUnstake: false,
    supportsAddLiquidity: false,
    supportsRemoveLiquidity: false,
    supportsVaultDeposit: false,
    supportsVaultWithdraw: false,
  };

  switch (contractKind) {
    case 'aave_v3_pool':
    case 'aave_v2_pool':
    case 'spark_pool':
      flags.supportsSupply = has('supply', 'deposit');
      flags.supportsWithdraw = has('withdraw');
      flags.supportsBorrowCapability = has('borrow') && pool.apyBaseBorrow != null;
      flags.supportsRepay = has('repay');
      break;

    case 'comet_v3':
      flags.supportsSupply = has('supply');
      flags.supportsWithdraw = has('withdraw');
      // Comet uses withdraw() for borrowing the base asset against collateral
      flags.supportsBorrowCapability = has('withdraw') && pool.apyBaseBorrow != null;
      break;

    case 'morpho_blue':
      flags.supportsSupply = has('supply');
      flags.supportsWithdraw = has('withdraw');
      flags.supportsBorrowCapability = has('borrow') && pool.apyBaseBorrow != null;
      flags.supportsRepay = has('repay');
      break;

    case 'lido_steth':
      flags.supportsStake = has('submit');
      flags.supportsUnstake = has('requestwithdrawals');
      break;

    case 'rocket_pool_deposit':
      flags.supportsStake = has('deposit');
      flags.supportsUnstake = has('burn'); // rETH burn lives on the rETH token
      break;

    case 'sceptre_vault':
    case 'erc4626_vault':
      flags.supportsVaultDeposit = has('deposit');
      flags.supportsVaultWithdraw = has('withdraw') || has('redeem');
      // Many liquid-staking vaults treat deposit/redeem as stake/unstake conceptually
      if (pool.isLiquidStaking) {
        flags.supportsStake = flags.supportsVaultDeposit;
        flags.supportsUnstake = flags.supportsVaultWithdraw;
      }
      break;

    case 'uniswap_v3_nfpm':
      // NonfungiblePositionManager: mint() to add, decreaseLiquidity()+collect() to remove
      flags.supportsAddLiquidity = has('mint');
      flags.supportsRemoveLiquidity = has('decreaseliquidity');
      break;

    case 'uniswap_v2_router':
      flags.supportsAddLiquidity = has('addliquidity', 'addliquidityeth');
      flags.supportsRemoveLiquidity = has('removeliquidity', 'removeliquidityeth');
      break;

    case 'curve_pool':
      flags.supportsAddLiquidity = has('add_liquidity', 'addliquidity');
      flags.supportsRemoveLiquidity = has(
        'remove_liquidity',
        'remove_liquidity_one_coin',
        'removeliquidity',
      );
      break;

    case 'balancer_v2_vault':
      flags.supportsAddLiquidity = has('joinpool');
      flags.supportsRemoveLiquidity = has('exitpool');
      break;

    case 'unknown':
      // We do NOT guess capabilities for unknown contracts. The pool is marked
      // inactive when contractKind ends up 'unknown' — execution is blocked.
      break;
  }

  return flags;
}

/**
 * Quick lookup: does a slug map to a known kind? If not, the dispatcher will
 * route the pool through `unknownResolver` which probes on-chain.
 */
export function kindForSlug(protocolSlug: string): ContractKind {
  return PROTOCOL_KIND_MAP[protocolSlug] ?? 'unknown';
}

/**
 * Inverse: from a kind, return the slug(s) it canonically represents. Useful
 * for telemetry and admin tooling.
 */
export function slugsForKind(kind: ContractKind): string[] {
  return Object.entries(PROTOCOL_KIND_MAP)
    .filter(([, k]) => k === kind)
    .map(([s]) => s);
}

/**
 * PositionScanService
 *
 * Reads a user's open lending positions DIRECTLY from on-chain via JSON-RPC.
 * No 3rd-party data providers — this is the "on-chain directo" path the user
 * picked over Zerion/DeBank/Kryptos.
 *
 * BROADCAST_FORBIDDEN: This service is read-only. It never sends txs.
 * REGULATORY: It does NOT modify positions. Importing here only links
 * existing positions to the user's Strategy / Money Flow context.
 *
 * Supported protocols (V1):
 *   - Aave V3              (Ethereum, Arbitrum, Base, Polygon, Optimism)
 *
 * Roadmap (V2):
 *   - Compound V3 (Comet)  (Ethereum, …)
 *   - Morpho Blue          (Ethereum)
 *   - Kinetic              (Flare 14)
 */

import { ethers, Interface } from 'ethers';
import { getRpcForChain } from '../utils/rpcForChain';
import { getProtocolConfig } from '../config/protocolContracts';

/** Aave V3 Pool read-only ABI fragment — kept local to avoid polluting the writer ABI. */
const AAVE_V3_READ_ABI = [
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

/**
 * Compound V3 (Comet) read-only ABI fragment.
 * Comet is single-borrow-asset (e.g. USDC) with per-asset collateral factors.
 * The full HF math is complex; for the banner we surface borrow balance and
 * liquidatable flag — enough for the user to see they have a live position.
 */
const COMPOUND_V3_READ_ABI = [
  'function borrowBalanceOf(address account) view returns (uint256)',
  'function isBorrowCollateralized(address account) view returns (bool)',
  'function isLiquidatable(address account) view returns (bool)',
  'function baseToken() view returns (address)',
  'function getReserves() view returns (int256)',
];

/**
 * Kinetic (Compound V2 fork on Flare) — Comptroller read interface.
 * getAccountLiquidity returns (errorCode, liquidity, shortfall) in 1e18 USD.
 * shortfall > 0 ⇒ position is underwater (liquidatable).
 */
const KINETIC_COMPTROLLER_READ_ABI = [
  'function getAccountLiquidity(address account) view returns (uint256 error, uint256 liquidity, uint256 shortfall)',
  'function getAssetsIn(address account) view returns (address[] memory)',
];

/**
 * Morpho Blue singleton read interface.
 *
 * Morpho Blue markets are ISOLATED — each (loanToken, collateralToken, oracle,
 * irm, lltv) tuple is its own market addressed by a bytes32 `id`. There is no
 * on-chain "list of markets a user is in", so we enumerate a configured set of
 * market ids (MORPHO_BLUE_MARKET_IDS) and read each via the public mappings.
 *
 *   position(id, user)        → (supplyShares, borrowShares, collateral)
 *   market(id)                → (totalSupplyAssets, totalSupplyShares,
 *                                totalBorrowAssets, totalBorrowShares,
 *                                lastUpdate, fee)
 *   idToMarketParams(id)      → (loanToken, collateralToken, oracle, irm, lltv)
 */
const MORPHO_BLUE_READ_ABI = [
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
];
const MORPHO_ORACLE_READ_ABI = ['function price() view returns (uint256)'];
const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)'];
const ERC20_SYMBOL_ABI = ['function symbol() view returns (string)'];

/**
 * SparkDEX V3.1 (Uniswap V3 fork on Flare) — LP positions are ERC-721 NFTs held
 * in the NonfungiblePositionManager. Addresses verified from the official docs
 * (docs.sparkdex.ai → smart-contract-overview/v2-v3.1-dex).
 */
const SPARKDEX_V3_NPM = '0xEE5FF5Bc5F852764b5584d92A4d592A53DC527da';
const SPARKDEX_V3_FACTORY = '0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const UNIV3_NPM_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
];
const UNIV3_FACTORY_ABI = ['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'];
const UNIV3_POOL_SLOT0_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
];

/**
 * Uniswap V3 in-range check: a concentrated-liquidity position only earns fees
 * while the pool's current tick is within [tickLower, tickUpper). Pure + testable.
 */
export function isLpInRange(poolTick: number, tickLower: number, tickUpper: number): boolean {
  return tickLower <= poolTick && poolTick < tickUpper;
}

/**
 * Uniswap V3 token amounts for a concentrated-liquidity position, computed in
 * PRICE space (sqrtP = sqrt(price), price = 1.0001^tick). Display-grade float
 * math — NOT for execution. Returns RAW token amounts (before decimals).
 *
 *   below range (current ≤ lower) → all token0
 *   above range (current ≥ upper) → all token1
 *   in range                      → both
 *
 * Pure + unit-tested (the on-chain reads that feed it are separate).
 */
export function computeLpAmounts(
  sqrtPCurrent: number,
  sqrtPLower: number,
  sqrtPUpper: number,
  liquidity: number,
): { amount0: number; amount1: number } {
  if (!(sqrtPUpper > sqrtPLower) || !(liquidity > 0)) return { amount0: 0, amount1: 0 };
  if (sqrtPCurrent <= sqrtPLower) {
    return { amount0: (liquidity * (sqrtPUpper - sqrtPLower)) / (sqrtPLower * sqrtPUpper), amount1: 0 };
  }
  if (sqrtPCurrent >= sqrtPUpper) {
    return { amount0: 0, amount1: liquidity * (sqrtPUpper - sqrtPLower) };
  }
  return {
    amount0: (liquidity * (sqrtPUpper - sqrtPCurrent)) / (sqrtPCurrent * sqrtPUpper),
    amount1: liquidity * (sqrtPCurrent - sqrtPLower),
  };
}

/** sqrt(price) at a tick: sqrt(1.0001^tick) = 1.0001^(tick/2). Finite across the
 *  full V3 tick range (|tick| ≤ 887272 ⇒ exponent ≈ ±44). */
function sqrtPriceAtTick(tick: number): number {
  return 1.0001 ** (tick / 2);
}

/** Batch spot prices (USD) for Flare token addresses via DeFiLlama coins API. */
async function fetchFlarePricesUSD(addresses: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (unique.length === 0) return {};
  const keys = unique.map((a) => `flare:${a}`).join(',');
  try {
    const res = await fetch(`https://coins.llama.fi/prices/current/${keys}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as { coins?: Record<string, { price?: number }> };
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.coins ?? {})) {
      const addr = k.split(':')[1]?.toLowerCase();
      if (addr && typeof v.price === 'number') out[addr] = v.price;
    }
    return out;
  } catch {
    return {};
  }
}

// Morpho SharesMathLib + MarketParamsLib constants (immutable on-chain).
const MORPHO_VIRTUAL_SHARES = 1_000_000n; // 1e6
const MORPHO_VIRTUAL_ASSETS = 1n;
const MORPHO_ORACLE_PRICE_SCALE = 10n ** 36n;
const WAD = 10n ** 18n;

/**
 * SharesMathLib.toAssetsUp — convert borrow shares to the underlying loan-token
 * amount owed, rounding UP (the direction Morpho uses for debt). Mirrors
 * `shares.mulDivUp(totalAssets + VIRTUAL_ASSETS, totalShares + VIRTUAL_SHARES)`.
 */
export function morphoSharesToAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const numerator = shares * (totalAssets + MORPHO_VIRTUAL_ASSETS);
  const denominator = totalShares + MORPHO_VIRTUAL_SHARES;
  if (denominator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator; // mulDivUp
}

/**
 * Morpho `_isHealthy` max-borrow ceiling, in loan-token units:
 *   maxBorrow = collateral.mulDivDown(price, ORACLE_PRICE_SCALE).wMulDown(lltv)
 * price is the collateral price denominated in loan token, scaled by 1e36.
 */
export function morphoMaxBorrow(collateral: bigint, price: bigint, lltv: bigint): bigint {
  const collateralValue = (collateral * price) / MORPHO_ORACLE_PRICE_SCALE; // mulDivDown
  return (collateralValue * lltv) / WAD; // wMulDown
}

/**
 * Health factor as a float. HF = maxBorrow / borrowAssets. Infinity when no
 * debt. Below 1 ⇒ liquidatable. Kept at 1e18 internal precision before the
 * float cast so small positions don't truncate to 0.
 */
export function morphoHealthFactor(borrowAssets: bigint, maxBorrow: bigint): number {
  if (borrowAssets === 0n) return Infinity;
  return Number((maxBorrow * WAD) / borrowAssets) / 1e18;
}

export interface ScannedLendingPosition {
  /** DefiLlama-style slug (e.g. 'aave-v3') so the UI can match registry entries */
  protocolSlug: string;
  /** Human-readable name */
  protocolName: string;
  chainId: number;
  /** Wallet address whose position was read */
  wallet: string;
  /** Collateral in USD (8-decimal Aave "base currency" normalised) */
  totalCollateralUSD: number;
  totalDebtUSD: number;
  /** Capacity available to draw additional borrow */
  availableBorrowUSD: number;
  /** Aave "liquidation threshold" — 0..1 */
  liquidationThreshold: number;
  /** Aave LTV ceiling — 0..1 */
  ltv: number;
  /**
   * Health factor as a regular number. Infinity when totalDebt = 0.
   * Below 1 ⇒ liquidatable.
   */
  healthFactor: number;
  /** Timestamp the position was read */
  readAt: string;
  /** Block number the read was performed at (for audit) */
  blockNumber: number;
}

/** A concentrated-liquidity (Uniswap V3-style) LP position. Detection-level:
 *  surfaces the pair / fee / liquidity / in-range so watch-only users see the
 *  position. USD valuation (amounts from ticks + prices) is a refinement. */
export interface ScannedLpPosition {
  protocolSlug: string;     // e.g. 'sparkdex-v3'
  protocolName: string;
  chainId: number;
  wallet: string;
  tokenId: string;          // the position NFT id
  pair: string;             // e.g. 'sFLR/WFLR'
  token0: string;
  token1: string;
  feeTier: number;          // fraction, e.g. 0.003 for 0.3%
  liquidity: string;        // raw liquidity (uint128 as string)
  inRange: boolean | null;  // null when the pool/tick couldn't be read
  /** Human token amounts in the position (≈, display-grade). null if unpriceable. */
  amount0: number | null;
  amount1: number | null;
  /** Approximate USD value (amount0·price0 + amount1·price1). null if no prices. */
  valueUSD: number | null;
  readAt: string;
}

export interface ScanResult {
  wallet: string;
  chainId: number;
  positions: ScannedLendingPosition[];
  lpPositions: ScannedLpPosition[];
  errors: Array<{ protocolSlug: string; message: string }>;
}

class PositionScanService {
  /**
   * Scan ALL supported protocols on the given chain in parallel.
   * Returns whatever positions came back; individual protocol failures land in
   * `errors` so a partial scan can still render in the UI.
   */
  async scanWalletOnChain(wallet: string, chainId: number): Promise<ScanResult> {
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      throw new Error('INVALID_WALLET');
    }

    const provider = getRpcForChain(chainId);
    const positions: ScannedLendingPosition[] = [];
    const errors: Array<{ protocolSlug: string; message: string }> = [];

    // Fan-out: each protocol scan is independent. Run them in parallel and
    // collect both wins and per-protocol failures so the UI gets partial results.
    const settled = await Promise.allSettled([
      this._scanAaveV3(provider, wallet, chainId),
      this._scanCompoundV3(provider, wallet, chainId),
      this._scanKinetic(provider, wallet, chainId),
      this._scanMorphoBlue(provider, wallet, chainId),
    ]);
    const slugs = ['aave-v3', 'compound-v3', 'kinetic', 'morpho-blue'];

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled' && result.value) {
        positions.push(result.value);
      } else if (result.status === 'rejected') {
        errors.push({
          protocolSlug: slugs[i],
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    // SparkDEX V3.1 LP positions (Flare only). Different shape from lending, so
    // read separately; a failure is recorded but never blocks the lending scan.
    const lpPositions =
      chainId === 14
        ? await this._scanSparkDexLp(provider, wallet).catch((e) => {
            errors.push({
              protocolSlug: 'sparkdex-v3',
              message: e instanceof Error ? e.message : String(e),
            });
            return [] as ScannedLpPosition[];
          })
        : [];

    return { wallet, chainId, positions, lpPositions, errors };
  }

  /**
   * Read Aave V3 user account data.
   * Returns null if Aave V3 is not deployed on this chain in our registry.
   */
  private async _scanAaveV3(
    provider: ethers.JsonRpcProvider,
    wallet: string,
    chainId: number,
  ): Promise<ScannedLendingPosition | null> {
    const config = getProtocolConfig('aave-v3');
    const chainConfig = config?.chains[chainId];
    if (!chainConfig) return null;

    const iface = new Interface(AAVE_V3_READ_ABI);
    const pool = new ethers.Contract(chainConfig.poolAddress, iface, provider);

    const [
      totalCollateralBase,
      totalDebtBase,
      availableBorrowsBase,
      currentLiquidationThreshold,
      ltv,
      healthFactorRaw,
    ] = (await pool.getUserAccountData(wallet)) as [bigint, bigint, bigint, bigint, bigint, bigint];

    // Aave V3 "base currency" is USD with 8 decimals
    const BASE_DECIMALS = 10n ** 8n;
    const toUSD = (v: bigint): number => Number(v) / Number(BASE_DECIMALS);

    // Aave returns thresholds in basis points (×10000), HF in 1e18.
    const liquidationThreshold = Number(currentLiquidationThreshold) / 10_000;
    const ltvNum = Number(ltv) / 10_000;
    const healthFactor =
      totalDebtBase === 0n
        ? Infinity
        : Number(healthFactorRaw) / 1e18;

    const blockNumber = await provider.getBlockNumber();

    return {
      protocolSlug: 'aave-v3',
      protocolName: 'Aave V3',
      chainId,
      wallet,
      totalCollateralUSD: toUSD(totalCollateralBase),
      totalDebtUSD: toUSD(totalDebtBase),
      availableBorrowUSD: toUSD(availableBorrowsBase),
      liquidationThreshold,
      ltv: ltvNum,
      healthFactor,
      readAt: new Date().toISOString(),
      blockNumber,
    };
  }

  /**
   * Read Compound V3 (Comet) borrow position on a single market.
   *
   * Comet markets are single-borrow-asset (USDC, USDbC, WETH…). We surface
   * the open borrow balance and on-chain liquidatable flag. Full HF requires
   * iterating all supported collateral assets — deferred to v2.
   *
   * Returns null when no debt is open (so the banner doesn't show empty rows).
   */
  private async _scanCompoundV3(
    provider: ethers.JsonRpcProvider,
    wallet: string,
    chainId: number,
  ): Promise<ScannedLendingPosition | null> {
    const config = getProtocolConfig('compound-v3');
    const chainConfig = config?.chains[chainId];
    if (!chainConfig) return null;

    const iface = new Interface(COMPOUND_V3_READ_ABI);
    const comet = new ethers.Contract(chainConfig.poolAddress, iface, provider);

    const [borrowBalance, isCollateralized, isLiquidatable] = await Promise.all([
      comet.borrowBalanceOf(wallet) as Promise<bigint>,
      comet.isBorrowCollateralized(wallet) as Promise<boolean>,
      comet.isLiquidatable(wallet) as Promise<boolean>,
    ]);

    // No debt and no liquidation risk ⇒ user has no Compound V3 position worth surfacing.
    if (borrowBalance === 0n && !isLiquidatable) return null;

    // Comet's base asset is USDC on the canonical markets — 6 decimals.
    // For non-USDC markets (WETH on Ethereum, etc.) this is wrong by a constant
    // factor; refine via baseToken().decimals() in v2.
    const BASE_DECIMALS = 10n ** 6n;
    const totalDebtUSD = Number(borrowBalance) / Number(BASE_DECIMALS);

    // Comet doesn't expose totalCollateralUSD directly without iterating assets.
    // We mark it as unknown via 0 and signal danger via the liquidatable flag.
    const blockNumber = await provider.getBlockNumber();
    return {
      protocolSlug: 'compound-v3',
      protocolName: 'Compound V3',
      chainId,
      wallet,
      totalCollateralUSD: 0, // not exposed — needs per-asset iteration
      totalDebtUSD,
      availableBorrowUSD: 0,
      liquidationThreshold: 0,
      ltv: 0,
      healthFactor: isLiquidatable ? 0.99 : isCollateralized ? Infinity : 1.5,
      readAt: new Date().toISOString(),
      blockNumber,
    };
  }

  /**
   * Read Kinetic (Compound V2 fork on Flare) account liquidity via Comptroller.
   *
   * Returns null when no debt and no shortfall — same convention as Compound V3.
   * KINETIC_COMPTROLLER must be set in env (allowlist is gated by it).
   */
  private async _scanKinetic(
    provider: ethers.JsonRpcProvider,
    wallet: string,
    chainId: number,
  ): Promise<ScannedLendingPosition | null> {
    if (chainId !== 14) return null; // Kinetic is Flare-only
    const comptrollerAddr = process.env.KINETIC_COMPTROLLER;
    if (!comptrollerAddr) return null;

    const iface = new Interface(KINETIC_COMPTROLLER_READ_ABI);
    const comptroller = new ethers.Contract(comptrollerAddr, iface, provider);

    const [errCode, liquidity, shortfall] = (await comptroller.getAccountLiquidity(wallet)) as [bigint, bigint, bigint];
    if (errCode !== 0n) {
      throw new Error(`Kinetic getAccountLiquidity errorCode=${errCode}`);
    }

    // No participation ⇒ both liquidity and shortfall are 0. Skip the banner row.
    if (liquidity === 0n && shortfall === 0n) return null;

    // Kinetic uses 1e18-scaled USD values. shortfall>0 ⇒ underwater (HF<1).
    const SCALE = 10n ** 18n;
    const liquidityUSD = Number(liquidity) / Number(SCALE);
    const shortfallUSD = Number(shortfall) / Number(SCALE);

    // We can't separate collateral vs debt without enumerating cTokens. Surface
    // liquidity (free borrow capacity) and a derived HF proxy:
    //   - shortfall > 0  → HF < 1
    //   - shortfall = 0  → HF >= 1 (use Infinity if no debt detected)
    const blockNumber = await provider.getBlockNumber();
    const isUnderwater = shortfallUSD > 0;
    return {
      protocolSlug: 'kinetic',
      protocolName: 'Kinetic',
      chainId,
      wallet,
      totalCollateralUSD: 0,
      totalDebtUSD: shortfallUSD,
      availableBorrowUSD: liquidityUSD,
      liquidationThreshold: 0,
      ltv: 0,
      healthFactor: isUnderwater ? 0.95 : Infinity,
      readAt: new Date().toISOString(),
      blockNumber,
    };
  }

  /**
   * Read Morpho Blue positions by enumerating a configured set of market ids.
   *
   * Morpho markets are isolated, so there is no aggregate account view and no
   * on-chain enumeration of the markets a user touched. We iterate the market
   * ids in MORPHO_BLUE_MARKET_IDS (comma-separated bytes32) and read each.
   *
   * Returns a single aggregated position row across the markets where the user
   * has debt or collateral:
   *   - totalDebtUSD / totalCollateralUSD are summed in loan-token units
   *     (≈ USD for the common stablecoin-loan markets; documented approximation).
   *   - healthFactor is the WORST (minimum) HF across markets with debt, since
   *     each market liquidates independently.
   * Returns null when no markets are configured or the user has no position.
   */
  private async _scanMorphoBlue(
    provider: ethers.JsonRpcProvider,
    wallet: string,
    chainId: number,
  ): Promise<ScannedLendingPosition | null> {
    const config = getProtocolConfig('morpho-blue');
    const chainConfig = config?.chains[chainId];
    if (!chainConfig) return null; // Morpho Blue only registered on Ethereum today

    const marketIds = (process.env.MORPHO_BLUE_MARKET_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^0x[a-fA-F0-9]{64}$/.test(s));
    if (marketIds.length === 0) return null; // per-market enumeration needs a market set

    const morpho = new ethers.Contract(chainConfig.poolAddress, new Interface(MORPHO_BLUE_READ_ABI), provider);
    const decimalsCache = new Map<string, number>();

    let totalDebt = 0;
    let totalCollateral = 0;
    let totalAvailable = 0;
    let worstHF = Infinity;
    let lowestLltv = 0;
    let anyPosition = false;

    for (const id of marketIds) {
      const [pos, mkt, params] = await Promise.all([
        morpho.position(id, wallet) as Promise<{ borrowShares: bigint; collateral: bigint }>,
        morpho.market(id) as Promise<{ totalBorrowAssets: bigint; totalBorrowShares: bigint }>,
        morpho.idToMarketParams(id) as Promise<{ loanToken: string; oracle: string; lltv: bigint }>,
      ]);

      const borrowShares = pos.borrowShares;
      const collateral = pos.collateral;
      if (borrowShares === 0n && collateral === 0n) continue; // not in this market
      anyPosition = true;

      const loanDecimals = await this._erc20Decimals(provider, params.loanToken, decimalsCache);
      const loanUnit = 10 ** loanDecimals;

      const borrowAssets = morphoSharesToAssetsUp(borrowShares, mkt.totalBorrowAssets, mkt.totalBorrowShares);

      // Oracle may be address(0) on idle/uninitialised markets — guard the read.
      let price = 0n;
      if (/^0x[a-fA-F0-9]{40}$/.test(params.oracle) && params.oracle !== '0x0000000000000000000000000000000000000000') {
        try {
          const oracle = new ethers.Contract(params.oracle, new Interface(MORPHO_ORACLE_READ_ABI), provider);
          price = (await oracle.price()) as bigint;
        } catch {
          price = 0n; // oracle unavailable — collateral value treated as 0 (conservative)
        }
      }

      const maxBorrow = morphoMaxBorrow(collateral, price, params.lltv);
      // collateral value in loan-token units = collateral * price / 1e36
      const collateralValue = (collateral * price) / MORPHO_ORACLE_PRICE_SCALE;

      totalDebt += Number(borrowAssets) / loanUnit;
      totalCollateral += Number(collateralValue) / loanUnit;
      totalAvailable += Number(maxBorrow > borrowAssets ? maxBorrow - borrowAssets : 0n) / loanUnit;

      const lltvNum = Number(params.lltv) / 1e18;
      if (lltvNum > lowestLltv) lowestLltv = lltvNum;

      if (borrowShares > 0n) {
        const hf = morphoHealthFactor(borrowAssets, maxBorrow);
        if (hf < worstHF) worstHF = hf;
      }
    }

    if (!anyPosition) return null;

    const blockNumber = await provider.getBlockNumber();
    return {
      protocolSlug: 'morpho-blue',
      protocolName: 'Morpho Blue',
      chainId,
      wallet,
      totalCollateralUSD: totalCollateral,
      totalDebtUSD: totalDebt,
      availableBorrowUSD: totalAvailable,
      // Morpho liquidates at lltv; there's no separate threshold/ltv pair.
      liquidationThreshold: lowestLltv,
      ltv: lowestLltv,
      healthFactor: worstHF,
      readAt: new Date().toISOString(),
      blockNumber,
    };
  }

  /**
   * Read SparkDEX V3.1 LP positions (Uniswap V3 fork) — Flare only.
   * Detection-level: pair, fee tier, raw liquidity and in-range flag, so a
   * watch-only user sees they hold an LP. USD valuation (amounts from ticks +
   * prices) is a refinement — TODO(value): LiquidityAmounts math.
   */
  private async _scanSparkDexLp(
    provider: ethers.JsonRpcProvider,
    wallet: string,
  ): Promise<ScannedLpPosition[]> {
    const npm = new ethers.Contract(SPARKDEX_V3_NPM, new Interface(UNIV3_NPM_ABI), provider);
    const count = Number((await npm.balanceOf(wallet)) as bigint);
    if (count === 0) return [];

    const factory = new ethers.Contract(SPARKDEX_V3_FACTORY, new Interface(UNIV3_FACTORY_ABI), provider);
    const symbolCache = new Map<string, string>();
    const decimalsCache = new Map<string, number>();

    interface LpRow {
      tokenId: string; token0: string; token1: string; sym0: string; sym1: string;
      fee: number; liquidity: string; inRange: boolean | null;
      amount0: number | null; amount1: number | null;
    }
    const rows: LpRow[] = [];

    // Cap iteration so a wallet holding thousands of NFTs can't stall the read.
    const max = Math.min(count, 50);
    for (let i = 0; i < max; i++) {
      const tokenId = (await npm.tokenOfOwnerByIndex(wallet, i)) as bigint;
      const p = (await npm.positions(tokenId)) as unknown as {
        token0: string; token1: string; fee: bigint; tickLower: bigint; tickUpper: bigint; liquidity: bigint;
      };
      if (p.liquidity === 0n) continue;

      const [sym0, sym1, dec0, dec1] = await Promise.all([
        this._erc20Symbol(provider, p.token0, symbolCache),
        this._erc20Symbol(provider, p.token1, symbolCache),
        this._erc20Decimals(provider, p.token0, decimalsCache),
        this._erc20Decimals(provider, p.token1, decimalsCache),
      ]);

      let inRange: boolean | null = null;
      let amount0: number | null = null;
      let amount1: number | null = null;
      try {
        const poolAddr = (await factory.getPool(p.token0, p.token1, p.fee)) as string;
        if (poolAddr && poolAddr.toLowerCase() !== ZERO_ADDRESS) {
          const pool = new ethers.Contract(poolAddr, new Interface(UNIV3_POOL_SLOT0_ABI), provider);
          const slot0 = (await pool.slot0()) as unknown as { sqrtPriceX96: bigint; tick: bigint };
          const tickLower = Number(p.tickLower);
          const tickUpper = Number(p.tickUpper);
          inRange = isLpInRange(Number(slot0.tick), tickLower, tickUpper);
          const sqrtPCurrent = Number(slot0.sqrtPriceX96) / 2 ** 96;
          const raw = computeLpAmounts(
            sqrtPCurrent,
            sqrtPriceAtTick(tickLower),
            sqrtPriceAtTick(tickUpper),
            Number(p.liquidity),
          );
          amount0 = raw.amount0 / 10 ** dec0;
          amount1 = raw.amount1 / 10 ** dec1;
        }
      } catch {
        inRange = null; // pool/tick unreadable — surface the position without range/amounts
      }

      rows.push({
        tokenId: tokenId.toString(),
        token0: p.token0,
        token1: p.token1,
        sym0,
        sym1,
        fee: Number(p.fee) / 1_000_000,
        liquidity: p.liquidity.toString(),
        inRange,
        amount0,
        amount1,
      });
    }

    if (rows.length === 0) return [];

    // One batched price lookup for every token across the user's LP positions.
    const prices = await fetchFlarePricesUSD(rows.flatMap((r) => [r.token0, r.token1]));
    const readAt = new Date().toISOString();

    return rows.map((r) => {
      const p0 = prices[r.token0.toLowerCase()];
      const p1 = prices[r.token1.toLowerCase()];
      const valueUSD =
        r.amount0 != null && r.amount1 != null && (p0 != null || p1 != null)
          ? r.amount0 * (p0 ?? 0) + r.amount1 * (p1 ?? 0)
          : null;
      return {
        protocolSlug: 'sparkdex-v3',
        protocolName: 'SparkDEX V3.1',
        chainId: 14,
        wallet,
        tokenId: r.tokenId,
        pair: `${r.sym0}/${r.sym1}`,
        token0: r.token0,
        token1: r.token1,
        feeTier: r.fee,
        liquidity: r.liquidity,
        inRange: r.inRange,
        amount0: r.amount0,
        amount1: r.amount1,
        valueUSD,
        readAt,
      };
    });
  }

  /** Read (and cache) an ERC-20's symbol. Falls back to a short address. */
  private async _erc20Symbol(
    provider: ethers.JsonRpcProvider,
    token: string,
    cache: Map<string, string>,
  ): Promise<string> {
    const key = token.toLowerCase();
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let symbol = `${token.slice(0, 6)}…`;
    try {
      const erc20 = new ethers.Contract(token, new Interface(ERC20_SYMBOL_ABI), provider);
      symbol = (await erc20.symbol()) as string;
    } catch {
      /* keep short-address fallback */
    }
    cache.set(key, symbol);
    return symbol;
  }

  /** Read (and cache) an ERC-20's decimals. Defaults to 18 on failure. */
  private async _erc20Decimals(
    provider: ethers.JsonRpcProvider,
    token: string,
    cache: Map<string, number>,
  ): Promise<number> {
    const key = token.toLowerCase();
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    let decimals = 18;
    try {
      const erc20 = new ethers.Contract(token, new Interface(ERC20_DECIMALS_ABI), provider);
      decimals = Number((await erc20.decimals()) as bigint);
    } catch {
      decimals = 18;
    }
    cache.set(key, decimals);
    return decimals;
  }
}

export const positionScanService = new PositionScanService();

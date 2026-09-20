/**
 * EthMorphoMarketService — B2 (plan §13 / BuildSpec «Orden de arranque Builder B»).
 *
 * The data layer of the FXRP/RLUSD flow on Ethereum: typed, provider-injectable
 * reads of the Morpho Blue market + the pure pre-flight checks the /prepare
 * route (B5) enforces BEFORE the user signs (ORDER_WOULD_REVERT pattern —
 * binding adjustment #4 of the infrastructure review: at ~90%
 * utilisation a borrow above available liquidity must be blocked pre-signature,
 * not fail on-chain).
 */
import { ethers, Interface } from 'ethers';
import {
  morphoSharesToAssetsUp,
  morphoMaxBorrow,
  morphoHealthFactor,
} from './PositionScanService';
import {
  MORPHO_BLUE_SINGLETON,
  FXRP_RLUSD_MARKET_ID,
  FXRP_RLUSD_MARKET_PARAMS,
  MorphoMarketParams,
} from '../connectors/protocols/adapters/MorphoBlueEthAdapter';

/** Morpho oracle price scale: 1e36, already adjusted by 10^(loanDec-collDec). */
export const ORACLE_PRICE_SCALE = 10n ** 36n;
const SECONDS_PER_YEAR = 31_536_000n;
const WAD = 10n ** 18n;

/* ── Injectable chain reader ──────────────────────────────────────────────── */

export interface MorphoMarketState {
  totalSupplyAssets: bigint;
  totalSupplyShares: bigint;
  totalBorrowAssets: bigint;
  totalBorrowShares: bigint;
  lastUpdate: bigint;
  fee: bigint;
}

export interface MorphoUserPositionRaw {
  supplyShares: bigint;
  borrowShares: bigint;
  collateral: bigint;
}

/**
 * Everything the service needs from the chain, as a narrow interface so tests
 * inject fixtures and the route injects the ethers implementation below.
 */
export interface MorphoChainReader {
  idToMarketParams(id: string): Promise<MorphoMarketParams>;
  market(id: string): Promise<MorphoMarketState>;
  position(id: string, user: string): Promise<MorphoUserPositionRaw>;
  oraclePrice(oracle: string): Promise<bigint>;
  /** Per-second borrow rate (WAD) from the market's IRM view. */
  borrowRatePerSecond(params: MorphoMarketParams, market: MorphoMarketState): Promise<bigint>;
  erc20Decimals(token: string): Promise<number>;
  /**
   * Signer's balance of a token (H7 — «la munición»). OPTIONAL so existing
   * fixtures keep working: when a reader cannot answer it, the balance
   * pre-flight is NOT pushed at all rather than pushed green — a check that
   * says ok without having checked is the «éxito no ganado» family.
   */
  erc20BalanceOf?(token: string, user: string): Promise<bigint>;
}

const MORPHO_READ_ABI = [
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
];
const ORACLE_ABI = ['function price() view returns (uint256)'];
const IRM_ABI = [
  'function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)',
];
const DECIMALS_ABI = ['function decimals() view returns (uint8)'];
const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

export function makeEthersMorphoReader(provider: ethers.JsonRpcProvider): MorphoChainReader {
  const morpho = new ethers.Contract(MORPHO_BLUE_SINGLETON, new Interface(MORPHO_READ_ABI), provider);
  const decimalsCache = new Map<string, number>();
  return {
    async idToMarketParams(id) {
      const p = await morpho.idToMarketParams(id);
      return {
        loanToken: p.loanToken, collateralToken: p.collateralToken,
        oracle: p.oracle, irm: p.irm, lltv: BigInt(p.lltv),
      };
    },
    async market(id) {
      const m = await morpho.market(id);
      return {
        totalSupplyAssets: BigInt(m.totalSupplyAssets),
        totalSupplyShares: BigInt(m.totalSupplyShares),
        totalBorrowAssets: BigInt(m.totalBorrowAssets),
        totalBorrowShares: BigInt(m.totalBorrowShares),
        lastUpdate: BigInt(m.lastUpdate),
        fee: BigInt(m.fee),
      };
    },
    async position(id, user) {
      const p = await morpho.position(id, user);
      return {
        supplyShares: BigInt(p.supplyShares),
        borrowShares: BigInt(p.borrowShares),
        collateral: BigInt(p.collateral),
      };
    },
    async oraclePrice(oracle) {
      const c = new ethers.Contract(oracle, new Interface(ORACLE_ABI), provider);
      return BigInt(await c.price());
    },
    async borrowRatePerSecond(params, market) {
      const irm = new ethers.Contract(params.irm, new Interface(IRM_ABI), provider);
      const tuple = [params.loanToken, params.collateralToken, params.oracle, params.irm, params.lltv];
      const m = [market.totalSupplyAssets, market.totalSupplyShares, market.totalBorrowAssets,
        market.totalBorrowShares, market.lastUpdate, market.fee];
      return BigInt(await irm.borrowRateView(tuple, m));
    },
    async erc20Decimals(token) {
      const hit = decimalsCache.get(token);
      if (hit !== undefined) return hit;
      const c = new ethers.Contract(token, new Interface(DECIMALS_ABI), provider);
      const d = Number(await c.decimals());
      decimalsCache.set(token, d);
      return d;
    },
    async erc20BalanceOf(token, user) {
      const c = new ethers.Contract(token, new Interface(BALANCE_ABI), provider);
      return BigInt(await c.balanceOf(user));
    },
  };
}

/* ── Params drift check (what the user signs must match the chain) ────────── */

/**
 * Re-verify the pinned params against the chain at prepare time. MarketParams
 * are encoded INTO the transaction the user signs — building against drifted
 * params would make the user sign something other than the market they see.
 */
export async function verifyMarketParams(
  reader: MorphoChainReader,
  id: string = FXRP_RLUSD_MARKET_ID,
  pinned: MorphoMarketParams = FXRP_RLUSD_MARKET_PARAMS,
): Promise<MorphoMarketParams> {
  const onchain = await reader.idToMarketParams(id);
  const same =
    onchain.loanToken.toLowerCase() === pinned.loanToken.toLowerCase() &&
    onchain.collateralToken.toLowerCase() === pinned.collateralToken.toLowerCase() &&
    onchain.oracle.toLowerCase() === pinned.oracle.toLowerCase() &&
    onchain.irm.toLowerCase() === pinned.irm.toLowerCase() &&
    onchain.lltv === pinned.lltv;
  if (!same) {
    throw Object.assign(
      new Error('MARKET_PARAMS_DRIFT: on-chain market params differ from the pinned set — refusing to build'),
      { code: 'MARKET_PARAMS_DRIFT', onchain, pinned },
    );
  }
  return onchain;
}

/* ── Snapshot + position reads ────────────────────────────────────────────── */

export interface MarketSnapshot {
  params: MorphoMarketParams;
  state: MorphoMarketState;
  /** RLUSD base units still available to borrow (supply − borrow, floor 0). */
  availableLiquidity: bigint;
  /** 0..1 (float, display only — decisions use the bigints). */
  utilization: number;
  oraclePrice: bigint;
  loanDecimals: number;
  collateralDecimals: number;
  /**
   * Borrow APR in percent, annualised from the IRM's per-second view rate.
   * Protocol data with source; undefined when the IRM view is unavailable —
   * the UI must then show "unavailable", never a made-up number.
   */
  borrowAprPct?: number;
  borrowAprSource: string;
}

export async function readMarketSnapshot(
  reader: MorphoChainReader,
  id: string = FXRP_RLUSD_MARKET_ID,
): Promise<MarketSnapshot> {
  const params = await verifyMarketParams(reader, id);
  const state = await reader.market(id);
  const [oraclePrice, loanDecimals, collateralDecimals] = await Promise.all([
    reader.oraclePrice(params.oracle),
    reader.erc20Decimals(params.loanToken),
    reader.erc20Decimals(params.collateralToken),
  ]);
  const availableLiquidity =
    state.totalSupplyAssets > state.totalBorrowAssets
      ? state.totalSupplyAssets - state.totalBorrowAssets
      : 0n;
  const utilization =
    state.totalSupplyAssets === 0n
      ? 0
      : Number((state.totalBorrowAssets * 10_000n) / state.totalSupplyAssets) / 10_000;

  let borrowAprPct: number | undefined;
  try {
    const perSecond = await reader.borrowRatePerSecond(params, state);
    borrowAprPct = ratePerSecondToAprPct(perSecond);
  } catch {
    borrowAprPct = undefined; // source unavailable → say so, never invent
  }
  return {
    params, state, availableLiquidity, utilization, oraclePrice,
    loanDecimals, collateralDecimals, borrowAprPct,
    borrowAprSource: 'AdaptiveCurveIRM borrowRateView (Ethereum, on-chain)',
  };
}

/** Simple annualisation of the WAD per-second rate (APR, not compounded). */
export function ratePerSecondToAprPct(perSecondWad: bigint): number {
  // ×1e6 keeps 4 decimal places of percent through the integer division.
  return Number((perSecondWad * SECONDS_PER_YEAR * 1_000_000n) / WAD) / 10_000;
}

export interface UserPositionView {
  collateral: bigint;        // FXRP base units (6 dec)
  borrowShares: bigint;
  borrowAssets: bigint;      // RLUSD base units (18 dec), rounded UP (debt)
  maxBorrow: bigint;         // RLUSD base units at current price × lltv
  collateralValue: bigint;   // RLUSD base units
  healthFactor: number;      // Infinity when no debt
}

export function computeUserPosition(
  raw: MorphoUserPositionRaw,
  snapshot: Pick<MarketSnapshot, 'state' | 'oraclePrice' | 'params'>,
): UserPositionView {
  const borrowAssets = morphoSharesToAssetsUp(
    raw.borrowShares, snapshot.state.totalBorrowAssets, snapshot.state.totalBorrowShares,
  );
  const maxBorrow = morphoMaxBorrow(raw.collateral, snapshot.oraclePrice, snapshot.params.lltv);
  const collateralValue = (raw.collateral * snapshot.oraclePrice) / ORACLE_PRICE_SCALE;
  return {
    collateral: raw.collateral,
    borrowShares: raw.borrowShares,
    borrowAssets,
    maxBorrow,
    collateralValue,
    healthFactor: morphoHealthFactor(borrowAssets, maxBorrow),
  };
}

/* ── W5/B7: what the automation tick checks at FIRE time ──────────────────── */

/**
 * The Ethereum repay rides the M1 pattern: the tick VALIDATES the live
 * position and nudges the owner; the repay legs are composed FRESH by
 * /eth-morpho/prepare when they open the signing door (debt grows with
 * interest; repay-full needs LIVE borrowShares — trigger-time calldata
 * arrives stale at the signature). This is the validation half.
 */
export interface EmRepayFireCheck {
  ok: boolean;
  /** Why not, when ok=false. */
  note?: string;
  debtBase?: string;
  healthFactor?: number;
}

export async function emRepayFireCheck(
  reader: MorphoChainReader,
  user: string,
): Promise<EmRepayFireCheck> {
  const snapshot = await readMarketSnapshot(reader);
  const raw = await reader.position(FXRP_RLUSD_MARKET_ID, user);
  const position = computeUserPosition(raw, snapshot);
  if (position.borrowAssets <= 0n) {
    return { ok: false, note: 'no live debt on the Ethereum market — nothing to repay' };
  }
  return {
    ok: true,
    debtBase: position.borrowAssets.toString(),
    healthFactor: position.healthFactor,
  };
}

/* ── Pre-flights (pure — the route blocks BEFORE the signature) ───────────── */

export type Preflight =
  | { ok: true }
  | { ok: false; code: string; message: string; data?: Record<string, unknown> };

/**
 * Binding adjustment #4: at ~90% utilisation the pool can run dry. A borrow
 * above what the pool can lend right now would revert on-chain AFTER the user
 * signed and paid gas — block it here instead.
 */
export function preflightBorrow(snapshot: MarketSnapshot, assets: bigint): Preflight {
  if (assets <= 0n) {
    return { ok: false, code: 'AMOUNT_NOT_POSITIVE', message: 'Borrow amount must be > 0' };
  }
  if (assets > snapshot.availableLiquidity) {
    return {
      ok: false,
      code: 'BORROW_EXCEEDS_LIQUIDITY',
      message: 'The market cannot lend that much right now — lower the amount',
      data: { requested: assets.toString(), availableLiquidity: snapshot.availableLiquidity.toString() },
    };
  }
  return { ok: true };
}

/** Borrowing must also leave the position healthy (HF ≥ 1 is liquidation line). */
export function preflightBorrowHealth(
  position: UserPositionView, assets: bigint,
): Preflight {
  const debtAfter = position.borrowAssets + assets;
  if (debtAfter > position.maxBorrow) {
    return {
      ok: false,
      code: 'BORROW_WOULD_LIQUIDATE',
      message: 'That borrow would put the position past its liquidation limit',
      data: { debtAfter: debtAfter.toString(), maxBorrow: position.maxBorrow.toString() },
    };
  }
  return { ok: true };
}

/**
 * H7 — «la munición»: ¿tiene el firmante el token que la acción GASTA?
 *
 * Toda la divulgación del carril habla de necesitar RLUSD alcanzable en
 * Ethereum para repagar, y nadie lo comprobaba: el approve + la acción se
 * firmaban, se pagaba el gas, y la transacción revertía. Un pre-flight que no
 * se hace es peor que no prometerlo.
 *
 * Devuelve null cuando el lector no sabe leer saldos: entonces el check NO se
 * añade, en vez de añadirse en verde. Un check que dice «ok» sin haber
 * comprobado es exactamente la familia «éxito no ganado».
 */
export async function preflightTokenBalance(
  reader: MorphoChainReader,
  token: string,
  user: string,
  needed: bigint,
  label: string,
): Promise<Preflight | null> {
  if (!reader.erc20BalanceOf) return null;
  let balance: bigint;
  try {
    balance = await reader.erc20BalanceOf(token, user);
  } catch {
    return null; // lectura caída — se calla, no se finge
  }
  if (balance < needed) {
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      message: `Your wallet does not hold enough ${label} on Ethereum for this action`,
      data: { needed: needed.toString(), balance: balance.toString(), token, asset: label },
    };
  }
  return { ok: true };
}

/** Withdrawing collateral must keep remaining debt under the (shrunk) limit. */
export function preflightWithdrawCollateral(
  position: UserPositionView,
  snapshot: Pick<MarketSnapshot, 'oraclePrice' | 'params'>,
  assets: bigint,
): Preflight {
  if (assets <= 0n) {
    return { ok: false, code: 'AMOUNT_NOT_POSITIVE', message: 'Withdraw amount must be > 0' };
  }
  if (assets > position.collateral) {
    return {
      ok: false, code: 'WITHDRAW_EXCEEDS_COLLATERAL',
      message: 'You cannot withdraw more collateral than the position holds',
      data: { requested: assets.toString(), collateral: position.collateral.toString() },
    };
  }
  const remaining = position.collateral - assets;
  const maxBorrowAfter = morphoMaxBorrow(remaining, snapshot.oraclePrice, snapshot.params.lltv);
  if (position.borrowAssets > maxBorrowAfter) {
    return {
      ok: false, code: 'WITHDRAW_WOULD_LIQUIDATE',
      message: 'Withdrawing that much collateral would leave the debt past its limit',
      data: { borrowAssets: position.borrowAssets.toString(), maxBorrowAfter: maxBorrowAfter.toString() },
    };
  }
  return { ok: true };
}

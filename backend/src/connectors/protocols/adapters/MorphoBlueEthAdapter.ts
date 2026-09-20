/**
 * MorphoBlueEthAdapter — pure calldata builder for the FXRP/RLUSD Morpho Blue
 * market on Ethereum mainnet (W3, plan §13 / BuildSpec B3).
 */
import { Interface } from 'ethers';

export const ETH_CHAIN_ID = 1;

export const MORPHO_BLUE_SINGLETON = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

/** FXRP/RLUSD market on Ethereum mainnet (created ~, curated by Sentora). */
export const FXRP_RLUSD_MARKET_ID =
  '0x4fa31e3f8ba345227d44e1cf48559eea53a90dd5311dc006984c060f2f311d96';

export const FXRP_ETH = '0xCE6170EA245dC8D1f275A710a062b70f125F0110';
export const RLUSD_ETH = '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD';

/* ── El venue del swap-fill en Ethereum ─────────────────────────
 *
 * El repago total nunca cuadra solo: la deuda devenga interés (7,53% APR) y lo
 * prestado en la bóveda rinde menos (6,21%), así que SIEMPRE falta un poco. El
 * carril de Flare ya resolvió esto con `SwapFillService` — un `exactOutput` que
 * compra el hueco EXACTO dentro del mismo lote. Aquí van las direcciones del gemelo de Ethereum.
 */
export const UNISWAP_V3_ROUTER_ETH = '0xE592427A0AEce92De3Edee1F18E0157C05861564';
export const UNISWAP_V3_QUOTER_ETH = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e';
export const WETH_ETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

/** MarketParams tuple as Morpho Blue expects it (order matters for encoding). */
export interface MorphoMarketParams {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: bigint;
}

/**
 * On-chain-verified params for the flagship market. The route MUST re-verify
 * against `idToMarketParams(marketId)` at prepare time (cheap eth_call) and
 * refuse to build if they drift — params are part of what the user signs.
 */
export const FXRP_RLUSD_MARKET_PARAMS: MorphoMarketParams = Object.freeze({
  loanToken: RLUSD_ETH,
  collateralToken: FXRP_ETH,
  oracle: '0x5AC03061500E0C97862a466a38a7e87FAC4Ac39D',
  irm: '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC',
  lltv: 770000000000000000n, // 0.77 in WAD
});

const MORPHO_ABI = [
  'function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)',
  'function withdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, address receiver)',
  'function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)',
  'function repay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data) returns (uint256, uint256)',
];

const ERC20_ABI = ['function approve(address spender, uint256 amount) returns (bool)'];

const morphoIface = new Interface(MORPHO_ABI);
const erc20Iface = new Interface(ERC20_ABI);

/** One unsigned transaction leg, in the shape the EVM-direct rail signs. */
export interface EvmLeg {
  to: string;
  data: string;
  value: string; // hex, '0x0' for all Morpho ops
  description: string;
}

function marketTuple(p: MorphoMarketParams): [string, string, string, string, bigint] {
  return [p.loanToken, p.collateralToken, p.oracle, p.irm, p.lltv];
}

function requirePositive(amount: bigint, label: string): void {
  if (amount <= 0n) throw new Error(`MorphoBlueEthAdapter: ${label} must be > 0`);
}

function requireAddress(addr: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error(`MorphoBlueEthAdapter: ${label} is not an address`);
  }
}

/**
 * Deposit FXRP as collateral: finite approve (exact amount) + supplyCollateral.
 * `assets` in FXRP base units (6 decimals — read on-chain by the caller).
 */
export function buildSupplyCollateralLegs(
  user: string,
  assets: bigint,
  params: MorphoMarketParams = FXRP_RLUSD_MARKET_PARAMS,
): EvmLeg[] {
  requireAddress(user, 'user');
  requirePositive(assets, 'assets');
  return [
    {
      to: params.collateralToken,
      data: erc20Iface.encodeFunctionData('approve', [MORPHO_BLUE_SINGLETON, assets]),
      value: '0x0',
      description: 'Approve FXRP to Morpho (exact amount)',
    },
    {
      to: MORPHO_BLUE_SINGLETON,
      data: morphoIface.encodeFunctionData('supplyCollateral', [
        marketTuple(params), assets, user, '0x',
      ]),
      value: '0x0',
      description: 'Deposit FXRP as collateral',
    },
  ];
}

/**
 * Borrow RLUSD against the collateral. `assets` in RLUSD base units (18
 * decimals). Assets-mode (shares = 0): the user thinks in amounts.
 */
export function buildBorrowLegs(
  user: string,
  assets: bigint,
  params: MorphoMarketParams = FXRP_RLUSD_MARKET_PARAMS,
): EvmLeg[] {
  requireAddress(user, 'user');
  requirePositive(assets, 'assets');
  return [
    {
      to: MORPHO_BLUE_SINGLETON,
      data: morphoIface.encodeFunctionData('borrow', [
        marketTuple(params), assets, 0n, user, user,
      ]),
      value: '0x0',
      description: 'Borrow RLUSD',
    },
  ];
}

/**
 * Repay RLUSD debt: finite approve + repay.
 *
 * Two modes, mirroring the live Kinetic repay pattern:
 *  - partial: assets-mode (assets > 0, shares = 0) with approve = assets.
 *  - full: shares-mode (`fullDebtShares` = the position's borrowShares read
 *    on-chain at prepare time) so LIVE debt is closed with zero dust; the
 *    approve stays FINITE at `approveCap` = debt + small buffer computed by
 *    the route (house rule: never MaxUint).
 */
export function buildRepayLegs(
  user: string,
  opts:
    | { mode: 'partial'; assets: bigint }
    | { mode: 'full'; fullDebtShares: bigint; approveCap: bigint },
  params: MorphoMarketParams = FXRP_RLUSD_MARKET_PARAMS,
): EvmLeg[] {
  requireAddress(user, 'user');
  const isFull = opts.mode === 'full';
  if (isFull) {
    requirePositive(opts.fullDebtShares, 'fullDebtShares');
    requirePositive(opts.approveCap, 'approveCap');
  } else {
    requirePositive(opts.assets, 'assets');
  }
  const approveAmount = isFull ? opts.approveCap : opts.assets;
  const repayArgs = isFull
    ? [marketTuple(params), 0n, opts.fullDebtShares, user, '0x']
    : [marketTuple(params), opts.assets, 0n, user, '0x'];
  return [
    {
      to: params.loanToken,
      data: erc20Iface.encodeFunctionData('approve', [MORPHO_BLUE_SINGLETON, approveAmount]),
      value: '0x0',
      description: 'Approve RLUSD to Morpho (finite)',
    },
    {
      to: MORPHO_BLUE_SINGLETON,
      data: morphoIface.encodeFunctionData('repay', repayArgs),
      value: '0x0',
      description: isFull ? 'Repay full RLUSD debt (live shares)' : 'Repay RLUSD debt',
    },
  ];
}

/** Withdraw FXRP collateral back to the user. `assets` in FXRP base units. */
export function buildWithdrawCollateralLegs(
  user: string,
  assets: bigint,
  params: MorphoMarketParams = FXRP_RLUSD_MARKET_PARAMS,
): EvmLeg[] {
  requireAddress(user, 'user');
  requirePositive(assets, 'assets');
  return [
    {
      to: MORPHO_BLUE_SINGLETON,
      data: morphoIface.encodeFunctionData('withdrawCollateral', [
        marketTuple(params), assets, user, user,
      ]),
      value: '0x0',
      description: 'Withdraw FXRP collateral',
    },
  ];
}

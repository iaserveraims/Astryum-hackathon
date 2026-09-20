/**
 * EthMorphoPrepareService — B5 (plan §13 / BuildSpec «Orden de arranque Builder B»).
 *
 * Composes the /prepare response for the FXRP/RLUSD flow on Ethereum: verified
 * market params → pre-flights (blocking BEFORE the signature — ORDER_WOULD_REVERT
 * pattern, binding adjustment #4) → unsigned legs from the pure adapter →
 * best-effort Tenderly simulation (invariant #11) → full disclosure (invariant
 * #6/#9: fees visible, every rate a protocol figure with a named source, and
 * when something could not be checked, the response SAYS so — never pretends).
 *
 * Pure and injectable: the route hands in a MorphoChainReader and (optionally)
 * a simulate function; tests hand in stubs. This service never signs, never
 * broadcasts, never holds keys (prepare-only, invariant #1).
 */
import {
  MorphoChainReader,
  MarketSnapshot,
  UserPositionView,
  readMarketSnapshot,
  computeUserPosition,
  preflightBorrow,
  preflightBorrowHealth,
  preflightWithdrawCollateral,
  preflightTokenBalance,
  Preflight,
} from './EthMorphoMarketService';
import { morphoMaxBorrow, morphoHealthFactor } from './PositionScanService';
import {
  EvmLeg,
  FXRP_RLUSD_MARKET_ID,
  RLUSD_ETH,
  MORPHO_BLUE_SINGLETON,
  UNISWAP_V3_ROUTER_ETH,
  UNISWAP_V3_QUOTER_ETH,
  WETH_ETH,
  buildSupplyCollateralLegs,
  buildBorrowLegs,
  buildRepayLegs,
  buildWithdrawCollateralLegs,
} from '../connectors/protocols/adapters/MorphoBlueEthAdapter';
// El swap-fill NO se copia: es el mismo servicio de Flare con otro venue. La
// lógica pura (exactOutput, tope con slippage, composición) ya está probada
// allí; duplicarla sería crear una copia que diverge de lo que se firma.
import {
  buildFillSwapCalls,
  computeMaxIn,
  fillSlippagePct,
  swapFillEnabled,
  type FillQuote,
  type SwapVenue,
} from './flare/SwapFillService';
import {
  SENTORA_RLUSD_VAULT,
  buildVaultDepositLegs,
  buildVaultWithdrawLegs,
} from '../connectors/protocols/adapters/SentoraRlusdVaultAdapter';
import {
  FLARE_CHAIN_ID,
  ETHEREUM_EID,
  FLARE_EID,
  FXRP_FLARE_ERC20,
  FXRP_ETH_OFT,
  FXRP_OFT_ADAPTER_FLARE,
  buildBridgeLegs,
  buildBridgeBackLegs,
  feeWithBuffer,
} from '../connectors/protocols/adapters/FxrpOftBridgeAdapter';

export type EthMorphoAction =
  | 'supply_collateral'
  | 'borrow'
  | 'repay'
  | 'withdraw_collateral'
  /**
   * The carry card's entry: supply FXRP AND borrow RLUSD in ONE signing
   * session ([approve, supplyCollateral, borrow]). Composed server-side so the
   * health pre-flight projects the NEW collateral — two separate /prepare
   * calls would flag the borrow against the pre-supply position and block a
   * perfectly healthy entry.
   */
  | 'open_carry';

export interface EthMorphoPrepareRequest {
  action: EthMorphoAction;
  /** EOA that will sign on Ethereum (rail A1 — the user's own wallet). */
  user: string;
  /**
   * Amount in BASE UNITS as a decimal string. Collateral actions: FXRP base
   * units (6 dec). Loan actions: RLUSD base units (18 dec). Decimals travel in
   * the response so the UI converts from what was READ, never assumed (F4).
   * Ignored for repay full. For open_carry: the FXRP collateral leg.
   */
  amountBase?: string;
  /** open_carry only: RLUSD to borrow, in base units (18 dec). */
  borrowBase?: string;
  /** Repay only: 'partial' (amountBase) or 'full' (live shares, zero dust). */
  repayMode?: 'partial' | 'full';
  /**
   * open_carry only: lend the RLUSD you borrow into the Sentora vault IN THE
   * SAME signing session ([…, borrow, approve RLUSD, deposit]). The founder's
   * scenario (2026-08-25) — «borrow against FXRP and put the RLUSD to work in
   * Sentora» — was two cards and two trips; the physics allow one signature
   * (same chain, no settlement wait between legs), so it is one.
   */
  lendBorrowed?: boolean;
  /**
   * repay only: when the wallet does not hold the RLUSD but the Sentora
   * lend position does, prepend `withdraw(shortfall)` from the vault so the
   * repay is ONE signature. Derived by real state: nothing is withdrawn when
   * the wallet already covers, and nothing beyond the exact shortfall.
   */
  fromVault?: boolean;
}

/** Minimal surface of TenderlyProvider.simulateTransaction the service needs. */
export type SimulateFn = (input: {
  chainId: number; from: string; to: string; input: string; value?: string;
}) => Promise<{ success: boolean; gasUsed: number; revertReason?: string }>;

export interface LegSimulation {
  legIndex: number;
  description: string;
  /** 'ok' | 'revert' | 'depends_on_prior' | 'unavailable' */
  status: 'ok' | 'revert' | 'depends_on_prior' | 'unavailable';
  gasUsed?: number;
  revertReason?: string;
  note?: string;
}

export interface EthMorphoPrepareResult {
  chainId: 1;
  marketId: string;
  legs: EvmLeg[];
  decimals: { collateral: number; loan: number };
  position: {
    collateral: string;
    borrowAssets: string;
    healthFactor: number | null; // null encodes "no debt" (Infinity) for JSON
  };
  positionAfter: { healthFactor: number | null };
  preflight: { ok: boolean; checks: Array<{ name: string } & Preflight> };
  simulation: { attempted: boolean; note?: string; legs: LegSimulation[] };
  disclosure: {
    disclosedToUser: true;
    astryumFeeBase: '0';               // no Astryum fee on this flow today (read live, not hardcoded promise)
    lltvPct: number;
    utilizationPct: number;
    availableLiquidityBase: string;
    borrowAprPct: number | null;       // null = source unavailable (say so, never invent)
    borrowAprSource: string;
    approvals: 'finite';               // house rule — surfaced so the UI can state it
    liquidationNote: string;
    signerNote: string;
  };
  /** open_carry + lendBorrowed: what the extra two legs do, said in full. */
  lend: {
    vault: string;
    assetsBase: string;
    curatorNote: string;
    note: string;
  } | null;
  /** repay + fromVault: the exact RLUSD pulled out of the vault, and why. */
  fromVault: {
    withdrawnBase: string;
    walletBalanceBase: string;
    vaultClaimBase: string;
    vaultAvailableNowBase: string;
    note: string;
  } | null;
}

function hfToJson(hf: number): number | null {
  return Number.isFinite(hf) ? hf : null;
}

function parseAmount(amountBase: string | undefined, label: string): bigint {
  if (!amountBase || !/^\d+$/.test(amountBase)) {
    throw Object.assign(new Error(`${label}: amountBase must be a base-unit decimal string`), {
      code: 'INVALID_AMOUNT',
    });
  }
  return BigInt(amountBase);
}

/** HF the position would have after the action — same math, projected inputs. */
export function projectHealthFactor(
  position: UserPositionView,
  snapshot: Pick<MarketSnapshot, 'oraclePrice' | 'params'>,
  delta: { collateral?: bigint; debt?: bigint },
): number {
  // Clamp at zero: a failing pre-flight still produces a response, and the
  // projection must not go negative on it.
  const rawCollateral = position.collateral + (delta.collateral ?? 0n);
  const rawDebt = position.borrowAssets + (delta.debt ?? 0n);
  const collateral = rawCollateral > 0n ? rawCollateral : 0n;
  const debt = rawDebt > 0n ? rawDebt : 0n;
  const maxBorrow = morphoMaxBorrow(collateral, snapshot.oraclePrice, snapshot.params.lltv);
  return morphoHealthFactor(debt, maxBorrow);
}

/** Repay-full approve cap: live debt + 0.1% buffer (min 1 unit) — FINITE always. */
export function repayFullApproveCap(borrowAssets: bigint): bigint {
  const buffer = borrowAssets / 1000n > 0n ? borrowAssets / 1000n : 1n;
  return borrowAssets + buffer;
}

/**
 * Shared simulation semantics (invariant #11) for every leg set this flow
 * builds: real when a simulator is wired; honest when not. A leg that needs the
 * prior approve's state cannot be single-simulated — marked depends_on_prior,
 * never faked green. Skipped entirely (and said so) when a pre-flight already
 * blocks the action.
 */
export async function simulateLegsBestEffort(
  legs: EvmLeg[],
  user: string,
  preflightOk: boolean,
  simulate?: SimulateFn,
  chainId: number = 1,
): Promise<{ attempted: boolean; note?: string; legs: LegSimulation[] }> {
  const simLegs: LegSimulation[] = [];
  if (!simulate || !preflightOk) {
    const note = !simulate
      ? 'Simulator not configured — pre-flight checks above are enforced regardless'
      : 'Simulation skipped: a pre-flight check already blocks this action';
    legs.forEach((leg, i) =>
      simLegs.push({ legIndex: i, description: leg.description, status: 'unavailable' }),
    );
    return { attempted: false, note, legs: simLegs };
  }
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (i > 0) { // approve → action pairs share state
      simLegs.push({
        legIndex: i, description: leg.description, status: 'depends_on_prior',
        note: 'Executes after the approve in the same signing session; not single-simulatable',
      });
      continue;
    }
    try {
      const r = await simulate({ chainId, from: user, to: leg.to, input: leg.data, value: leg.value });
      simLegs.push({
        legIndex: i, description: leg.description,
        status: r.success ? 'ok' : 'revert',
        gasUsed: r.gasUsed, revertReason: r.revertReason,
      });
    } catch {
      simLegs.push({
        legIndex: i, description: leg.description, status: 'unavailable',
        note: 'Simulator unreachable',
      });
    }
  }
  return { attempted: true, legs: simLegs };
}

/**
 * The ammo of a repay can be LENT in the Sentora vault — the carry itself
 * leaves it there when the user ticks «lend the borrowed RLUSD», and the
 * protection nudge has always said so («the Sentora lend-only position
 * redeems on the same chain»). Until 2026-08-25 nobody COMPOSED it: the repay
 * door looked at the wallet only, said INSUFFICIENT_BALANCE and sent the user
 * to another screen to withdraw and come back — with the liquidation clock
 * running. Here it is derived from real state: if the wallet does not cover
 * and the vault does, the withdrawal of the EXACT shortfall becomes the first
 * leg of the same signature. Nothing beyond the shortfall, nothing at all when
 * the wallet already covers.
 *
 * Returns `null` when the plan cannot be built honestly (a read failed, the
 * reader cannot answer balances) — the caller then falls back to the plain
 * wallet pre-flight, which says what it can and never pretends.
 */
async function planRepayFromVault(
  reader: MorphoChainReader,
  vault: SentoraVaultReader,
  user: string,
  loanToken: string,
  need: bigint,
): Promise<{
  checks: Array<{ name: string } & Preflight>;
  withdrawBase: bigint;
  info: EthMorphoPrepareResult['fromVault'];
} | null> {
  if (!reader.erc20BalanceOf || !vault.sharesOf || !vault.previewRedeem || !vault.idleAssets) {
    return null;
  }
  let walletBalance: bigint;
  let claim: bigint;
  let idle: bigint;
  try {
    walletBalance = await reader.erc20BalanceOf(loanToken, user);
    if (walletBalance >= need) {
      // The wallet covers: the vault is not touched, and the check says so.
      return { checks: [{ name: 'balance', ok: true }], withdrawBase: 0n, info: null };
    }
    const shares = await vault.sharesOf(user);
    claim = shares > 0n ? await vault.previewRedeem(shares) : 0n;
    idle = await vault.idleAssets();
  } catch {
    return null; // a read fell — no plan is better than a guessed one
  }
  const shortfall = need - walletBalance;
  if (claim <= 0n) {
    // Nothing lent either: the plain «not enough» is the truth, with the
    // vault figure attached so the door can say it looked there too.
    return {
      checks: [{
        name: 'balance', ok: false, code: 'INSUFFICIENT_BALANCE',
        message: 'Your wallet does not hold enough RLUSD on Ethereum for this action',
        data: {
          needed: need.toString(), balance: walletBalance.toString(),
          token: loanToken, asset: 'RLUSD', vaultClaim: '0',
        },
      }],
      withdrawBase: 0n,
      info: null,
    };
  }
  if (claim < shortfall) {
    return {
      checks: [{
        name: 'balance', ok: false, code: 'INSUFFICIENT_BALANCE_WITH_VAULT',
        message: 'Your wallet and your Sentora lend position together do not hold enough RLUSD on Ethereum for this repay',
        data: {
          needed: need.toString(), balance: walletBalance.toString(),
          vaultClaim: claim.toString(), shortfall: shortfall.toString(), asset: 'RLUSD',
        },
      }],
      withdrawBase: 0n,
      info: null,
    };
  }
  if (idle < shortfall) {
    // Vault V2 pays withdrawals from its idle balance only (no liquidity
    // adapter, read 2026-08-17): a HARD ceiling, not a conservative one.
    return {
      checks: [{
        name: 'vault-liquidity', ok: false, code: 'WITHDRAW_EXCEEDS_VAULT_LIQUIDITY',
        message: 'The vault cannot pay that out right now — its live liquidity decides, not your balance',
        data: { requested: shortfall.toString(), availableNow: idle.toString() },
      }],
      withdrawBase: 0n,
      info: null,
    };
  }
  return {
    checks: [{ name: 'balance', ok: true }, { name: 'vault-liquidity', ok: true }],
    withdrawBase: shortfall,
    info: {
      withdrawnBase: shortfall.toString(),
      walletBalanceBase: walletBalance.toString(),
      vaultClaimBase: claim.toString(),
      vaultAvailableNowBase: idle.toString(),
      note:
        'Your wallet does not hold enough RLUSD, so the exact shortfall is withdrawn from your Sentora lend position as the first leg of this same signature. The rest of your lent RLUSD stays lent.',
    },
  };
}

export async function prepareEthMorpho(
  reader: MorphoChainReader,
  req: EthMorphoPrepareRequest,
  simulate?: SimulateFn,
  /**
   * The Sentora vault, for the two flows that touch it (`open_carry` with
   * `lendBorrowed`, `repay` with `fromVault`). Optional so existing callers
   * and fixtures keep working; those flows refuse loudly without it.
   */
  vault?: SentoraVaultReader,
): Promise<EthMorphoPrepareResult> {
  // 1. Market truth (includes MARKET_PARAMS_DRIFT refusal — what the user signs
  //    must be the market they see).
  const snapshot = await readMarketSnapshot(reader, FXRP_RLUSD_MARKET_ID);
  const raw = await reader.position(FXRP_RLUSD_MARKET_ID, req.user);
  const position = computeUserPosition(raw, snapshot);

  // 2. Action-specific pre-flights + legs + projected HF.
  const checks: Array<{ name: string } & Preflight> = [];
  let legs: EvmLeg[];
  let hfAfter: number;
  let lend: EthMorphoPrepareResult['lend'] = null;
  let fromVault: EthMorphoPrepareResult['fromVault'] = null;

  /** Invariant #3, resolved on-chain: the vault's asset must BE the loan token. */
  const requireVaultIsRlusd = async (): Promise<SentoraVaultReader> => {
    if (!vault) {
      throw Object.assign(
        new Error('this action touches the Sentora vault and no vault reader was provided'),
        { code: 'VAULT_READER_MISSING' },
      );
    }
    const asset = await vault.asset();
    if (asset.toLowerCase() !== snapshot.params.loanToken.toLowerCase()) {
      throw Object.assign(
        new Error('VAULT_ASSET_MISMATCH: vault.asset() is not RLUSD — refusing to build'),
        { code: 'VAULT_ASSET_MISMATCH', data: { asset } },
      );
    }
    return vault;
  };

  switch (req.action) {
    case 'supply_collateral': {
      const assets = parseAmount(req.amountBase, 'supply_collateral');
      // H7 — el FXRP tiene que estar EN ETHEREUM: el puente lo comprueba en
      // Flare (origen), pero nadie comprobaba el destino. Sin esto, el
      // approve+supply se firma y revierte.
      const bal = await preflightTokenBalance(
        reader, snapshot.params.collateralToken, req.user, assets, 'FXRP',
      );
      if (bal) checks.push({ name: 'balance', ...bal });
      legs = buildSupplyCollateralLegs(req.user, assets, snapshot.params);
      hfAfter = projectHealthFactor(position, snapshot, { collateral: assets });
      break;
    }
    case 'borrow': {
      const assets = parseAmount(req.amountBase, 'borrow');
      const liq = preflightBorrow(snapshot, assets);
      checks.push({ name: 'liquidity', ...liq });
      const health = preflightBorrowHealth(position, assets);
      checks.push({ name: 'health', ...health });
      legs = buildBorrowLegs(req.user, assets, snapshot.params);
      hfAfter = projectHealthFactor(position, snapshot, { debt: assets });
      break;
    }
    case 'repay': {
      /**
       * Where the RLUSD comes from, for BOTH repay modes: the wallet, or the
       * wallet plus the exact shortfall redeemed from the Sentora vault when
       * `fromVault` is asked and the vault can honestly cover it. Pushes the
       * checks it derived; returns the withdraw legs to prepend (none when the
       * wallet covers or the plan could not be built).
       */
      const repayAmmo = async (need: bigint): Promise<{ withdrawLegs: EvmLeg[] }> => {
        if (req.fromVault && vault) {
          const v = await requireVaultIsRlusd();
          const plan = await planRepayFromVault(reader, v, req.user, snapshot.params.loanToken, need);
          if (plan) {
            checks.push(...plan.checks);
            fromVault = plan.info;
            return {
              withdrawLegs: plan.withdrawBase > 0n ? buildVaultWithdrawLegs(req.user, plan.withdrawBase) : [],
            };
          }
        }
        const bal = await preflightTokenBalance(
          reader, snapshot.params.loanToken, req.user, need, 'RLUSD',
        );
        if (bal) checks.push({ name: 'balance', ...bal });
        return { withdrawLegs: [] };
      };

      if (req.repayMode === 'full') {
        if (position.borrowShares <= 0n) {
          throw Object.assign(new Error('repay full: the position has no debt'), {
            code: 'NO_DEBT',
          });
        }
        // H7 — LA munición. Todo el carril (nudge, plantilla, disclosure)
        // repite que hace falta RLUSD alcanzable en Ethereum, y nadie lo
        // comprobaba. Se mide contra el cap del approve (deuda + buffer):
        // el repay-full paga la deuda VIVA, que crece con el interés.
        const need = repayFullApproveCap(position.borrowAssets);
        const ammo = await repayAmmo(need);
        legs = [
          ...ammo.withdrawLegs,
          ...buildRepayLegs(req.user, {
            mode: 'full',
            fullDebtShares: position.borrowShares,
            approveCap: repayFullApproveCap(position.borrowAssets),
          }, snapshot.params),
        ];
        hfAfter = Infinity;
      } else {
        const assets = parseAmount(req.amountBase, 'repay');
        // Sin deuda se dice SIN DEUDA. Mandar a «cerrar toda la deuda» a quien
        // no tiene ninguna es mandarle a un segundo error (NO_DEBT): dos
        // pantallas para enterarse de una cosa, y en mitad de una urgencia.
        if (position.borrowShares <= 0n) {
          throw Object.assign(new Error('repay: the position has no debt'), { code: 'NO_DEBT' });
        }
        if (assets > position.borrowAssets) {
          throw Object.assign(
            new Error('repay: amount exceeds live debt — use repayMode "full" to close'),
            { code: 'REPAY_EXCEEDS_DEBT', data: { debt: position.borrowAssets.toString() } },
          );
        }
        const ammo = await repayAmmo(assets);
        legs = [
          ...ammo.withdrawLegs,
          ...buildRepayLegs(req.user, { mode: 'partial', assets }, snapshot.params),
        ];
        hfAfter = projectHealthFactor(position, snapshot, { debt: -assets });
      }
      break;
    }
    case 'withdraw_collateral': {
      const assets = parseAmount(req.amountBase, 'withdraw_collateral');
      const wd = preflightWithdrawCollateral(position, snapshot, assets);
      checks.push({ name: 'collateral', ...wd });
      legs = buildWithdrawCollateralLegs(req.user, assets, snapshot.params);
      hfAfter = projectHealthFactor(position, snapshot, { collateral: -assets });
      break;
    }
    case 'open_carry': {
      const supply = parseAmount(req.amountBase, 'open_carry (collateral)');
      const borrow = parseAmount(req.borrowBase, 'open_carry (borrow)');
      const liq = preflightBorrow(snapshot, borrow);
      checks.push({ name: 'liquidity', ...liq });
      // H7 — el carry SUPPLYea FXRP: sin saldo en Ethereum revierte la
      // primera pata y el usuario ya pagó gas.
      const bal = await preflightTokenBalance(
        reader, snapshot.params.collateralToken, req.user, supply, 'FXRP',
      );
      if (bal) checks.push({ name: 'balance', ...bal });
      // Health is projected WITH the new collateral — the whole reason this
      // composed action exists (see the type's doc comment).
      const maxBorrowAfter = morphoMaxBorrow(
        position.collateral + supply, snapshot.oraclePrice, snapshot.params.lltv,
      );
      const debtAfter = position.borrowAssets + borrow;
      checks.push(
        debtAfter > maxBorrowAfter
          ? {
              name: 'health', ok: false, code: 'BORROW_WOULD_LIQUIDATE',
              message: 'That borrow would put the position past its liquidation limit',
              data: { debtAfter: debtAfter.toString(), maxBorrow: maxBorrowAfter.toString() },
            }
          : { name: 'health', ok: true },
      );
      legs = [
        ...buildSupplyCollateralLegs(req.user, supply, snapshot.params),
        ...buildBorrowLegs(req.user, borrow, snapshot.params),
      ];
      if (req.lendBorrowed) {
        // The borrowed RLUSD lands in the wallet at leg 2 and goes into the
        // vault at legs 3-4 of the SAME session — no balance pre-flight applies
        // (the funds do not exist before the borrow), the cap one does when the
        // vault publishes a usable number (Vault V2 stubs it to 0: ignored).
        const v = await requireVaultIsRlusd();
        if (v.maxDeposit) {
          try {
            const cap = await v.maxDeposit(req.user);
            if (cap > 0n) {
              checks.push(
                borrow > cap
                  ? {
                      name: 'cap', ok: false, code: 'DEPOSIT_EXCEEDS_CAP',
                      message: 'The vault cannot take that much right now — its deposit cap decides, not your balance',
                      data: { requested: borrow.toString(), maxDeposit: cap.toString() },
                    }
                  : { name: 'cap', ok: true },
              );
            }
          } catch {
            /* the vault may not expose it — silence beats an invented cap */
          }
        }
        legs.push(...buildVaultDepositLegs(req.user, borrow));
        lend = {
          vault: SENTORA_RLUSD_VAULT,
          assetsBase: borrow.toString(),
          curatorNote: SENTORA_CURATOR_NOTE,
          note:
            'The RLUSD you borrow is lent into the Sentora vault in this same signing session — it does not sit in your wallet. When you repay, the repay door redeems what it needs from the vault first, in one signature.',
        };
      }
      hfAfter = projectHealthFactor(position, snapshot, { collateral: supply, debt: borrow });
      break;
    }
    default:
      throw Object.assign(new Error(`unknown action ${String(req.action)}`), {
        code: 'INVALID_ACTION',
      });
  }

  const preflightOk = checks.every((c) => c.ok);

  // 3. Simulation (invariant #11) — shared best-effort semantics.
  const simulation = await simulateLegsBestEffort(legs, req.user, preflightOk, simulate);

  return {
    chainId: 1,
    marketId: FXRP_RLUSD_MARKET_ID,
    legs,
    decimals: { collateral: snapshot.collateralDecimals, loan: snapshot.loanDecimals },
    position: {
      collateral: position.collateral.toString(),
      borrowAssets: position.borrowAssets.toString(),
      healthFactor: hfToJson(position.healthFactor),
    },
    positionAfter: { healthFactor: hfToJson(hfAfter) },
    preflight: { ok: preflightOk, checks },
    simulation,
    disclosure: {
      disclosedToUser: true,
      astryumFeeBase: '0',
      lltvPct: Number(snapshot.params.lltv / 10n ** 14n) / 100,
      utilizationPct: Math.round(snapshot.utilization * 10_000) / 100,
      availableLiquidityBase: snapshot.availableLiquidity.toString(),
      borrowAprPct: snapshot.borrowAprPct ?? null,
      borrowAprSource: snapshot.borrowAprSource,
      approvals: 'finite',
      liquidationNote:
        'Liquidation threshold is the market LLTV; the health factor shown is maxBorrow/debt at the current oracle price',
      signerNote: 'Signed by your own wallet on Ethereum — Astryum never signs or broadcasts',
    },
    lend,
    fromVault,
  };
}

/* ── Lend-only: the Sentora RLUSD vault (la card «lend-only» de Earn) ──────── */

export interface SentoraVaultReader {
  asset(): Promise<string>;
  totalAssets(): Promise<bigint>;
  /** ⚠ En Morpho Vault V2 devuelve 0 SIEMPRE (stub). No usar como tope: ver
   *  el comentario de `vault_withdraw`. Se conserva para diagnóstico. */
  maxWithdraw(owner: string): Promise<bigint>;
  assetDecimals(): Promise<number>;
  /** Shares del usuario (ERC-20 de la propia bóveda). */
  sharesOf?(owner: string): Promise<bigint>;
  /** Valor en assets de esas shares — lo que el usuario puede reclamar. */
  previewRedeem?(shares: bigint): Promise<bigint>;
  /** Assets líquidos que la bóveda tiene AHORA para pagar retiradas. */
  idleAssets?(): Promise<bigint>;
  /** RLUSD del firmante (H7). OPCIONAL: si el lector no la sabe, el check NO
   *  se añade — jamás en verde sin haber comprobado. */
  assetBalanceOf?(owner: string): Promise<bigint>;
  /** Tope de depósito del 4626 (H7). Una bóveda con cap lleno acepta 0 y la
   *  transacción revierte tras firmar. Opcional por el mismo motivo. */
  maxDeposit?(owner: string): Promise<bigint>;
}

export interface SentoraPrepareRequest {
  action: 'vault_deposit' | 'vault_withdraw';
  user: string;
  /** RLUSD base units as a decimal string (decimals READ on-chain, returned). */
  amountBase?: string;
}

/**
 * The words the barrido §2.3.3 made binding for this surface. Not marketing
 * copy — the risk statement the reviewer will look for.
 */
export const SENTORA_CURATOR_NOTE =
  'Lending here is exposure to the aggregate of the Sentora vault’s curated allocations, ' +
  'not to the FXRP market specifically. The curator decides the allocation.';

export interface SentoraPrepareResult {
  chainId: 1;
  vault: string;
  legs: EvmLeg[];
  decimals: { asset: number };
  preflight: { ok: boolean; checks: Array<{ name: string } & Preflight> };
  simulation: { attempted: boolean; note?: string; legs: LegSimulation[] };
  disclosure: {
    disclosedToUser: true;
    astryumFeeBase: '0';
    totalAssetsBase: string;
    curatorNote: string;
    approvals: 'finite';
    yieldNote: string;
    signerNote: string;
  };
}

export async function prepareSentoraVault(
  vault: SentoraVaultReader,
  req: SentoraPrepareRequest,
  simulate?: SimulateFn,
): Promise<SentoraPrepareResult> {
  // Invariant #3, resolved on-chain: the vault's asset must BE RLUSD. If the
  // address ever resolves differently, refuse to build.
  const asset = await vault.asset();
  if (asset.toLowerCase() !== RLUSD_ETH.toLowerCase()) {
    throw Object.assign(
      new Error('VAULT_ASSET_MISMATCH: vault.asset() is not RLUSD — refusing to build'),
      { code: 'VAULT_ASSET_MISMATCH', data: { asset } },
    );
  }
  const [assetDecimals, totalAssets] = await Promise.all([
    vault.assetDecimals(),
    vault.totalAssets(),
  ]);

  const checks: Array<{ name: string } & Preflight> = [];
  let legs: EvmLeg[];

  if (req.action === 'vault_deposit') {
    const assets = parseAmount(req.amountBase, 'vault_deposit');
    // H7 — el depósito NO tenía ningún pre-flight: se firmaba a ciegas.
    // Dos formas de revertir tras pagar gas: no tener el RLUSD, o que la
    // bóveda tenga el cupo lleno (un 4626 con cap devuelve maxDeposit 0).
    if (vault.assetBalanceOf) {
      try {
        const balance = await vault.assetBalanceOf(req.user);
        checks.push(
          balance < assets
            ? {
                name: 'balance', ok: false, code: 'INSUFFICIENT_BALANCE',
                message: 'Your wallet does not hold enough RLUSD on Ethereum for this deposit',
                data: { needed: assets.toString(), balance: balance.toString(), asset: 'RLUSD' },
              }
            : { name: 'balance', ok: true },
        );
      } catch {
        /* lectura caída — no se finge el check */
      }
    }
    // ⚠ NO se usa `maxDeposit` como tope. Esta bóveda es Morpho **Vault V2**,
    // donde `maxDeposit`/`maxWithdraw`/`maxRedeem` son stubs que devuelven 0
    // SIEMPRE (verificado en mainnet 2026-08-17: maxDeposit(cualquiera)=0
    // mientras la bóveda tiene 319M de assets y acepta depósitos). Un 0 ahí
    // significa «esta bóveda no implementa la vista», no «está llena»; usarlo
    // como cap pintaba un rojo PERMANENTE y falso en cada depósito — y
    // acostumbraba al usuario a firmar por encima de un rojo, que es la peor
    // consecuencia posible. Solo se comprueba cuando el número es utilizable.
    if (vault.maxDeposit) {
      try {
        const cap = await vault.maxDeposit(req.user);
        if (cap > 0n) {
          checks.push(
            assets > cap
              ? {
                  name: 'cap', ok: false, code: 'DEPOSIT_EXCEEDS_CAP',
                  message: 'The vault cannot take that much right now — its deposit cap decides, not your balance',
                  data: { requested: assets.toString(), maxDeposit: cap.toString() },
                }
              : { name: 'cap', ok: true },
          );
        }
      } catch {
        /* la bóveda puede no exponerlo — se calla en vez de inventarlo */
      }
    }
    legs = buildVaultDepositLegs(req.user, assets);
  } else if (req.action === 'vault_withdraw') {
    const assets = parseAmount(req.amountBase, 'vault_withdraw');
    // Lo que el usuario PUEDE sacar, leído de vistas que sí responden en
    // Vault V2: sus shares valoradas (`previewRedeem`) contra lo pedido, y la
    // liquidez que la bóveda tiene ahora mismo para pagar. `maxWithdraw` NO
    // sirve aquí: devuelve 0 para todo el mundo y dejaba la ÚNICA puerta de
    // salida del lend-only permanentemente deshabilitada — el capital entraba
    // y no salía, con la card prometiendo «Withdraw: anytime».
    if (vault.sharesOf && vault.previewRedeem) {
      try {
        const shares = await vault.sharesOf(req.user);
        const claim = shares > 0n ? await vault.previewRedeem(shares) : 0n;
        checks.push(
          assets > claim
            ? {
                name: 'balance', ok: false, code: 'WITHDRAW_EXCEEDS_BALANCE',
                message: 'That is more than your lent position is worth right now',
                data: { requested: assets.toString(), yourAssets: claim.toString() },
              }
            : { name: 'balance', ok: true },
        );
      } catch {
        /* no se pudo valorar la posición — no se finge el check */
      }
    }
    // La liquidez viva es un techo DURO, no un exceso de celo: esta bóveda
    // tiene `liquidityAdapter() == address(0)` (leído de mainnet el 17-ago), o
    // sea que `withdraw` no desasigna de los mercados al vuelo — paga de su
    // saldo y nada más. No relajar este check por parecer conservador.
    if (vault.idleAssets) {
      try {
        const idle = await vault.idleAssets();
        checks.push(
          assets > idle
            ? {
                name: 'liquidity', ok: false, code: 'WITHDRAW_EXCEEDS_VAULT_LIQUIDITY',
                message: 'The vault cannot pay that out right now — its live liquidity decides, not your balance',
                data: { requested: assets.toString(), availableNow: idle.toString() },
              }
            : { name: 'liquidity', ok: true },
        );
      } catch {
        /* idem */
      }
    }
    legs = buildVaultWithdrawLegs(req.user, assets);
  } else {
    throw Object.assign(new Error(`unknown action ${String(req.action)}`), {
      code: 'INVALID_ACTION',
    });
  }

  const preflightOk = checks.every((c) => c.ok);
  const simulation = await simulateLegsBestEffort(legs, req.user, preflightOk, simulate);

  return {
    chainId: 1,
    vault: SENTORA_RLUSD_VAULT,
    legs,
    decimals: { asset: assetDecimals },
    preflight: { ok: preflightOk, checks },
    simulation,
    disclosure: {
      disclosedToUser: true,
      astryumFeeBase: '0',
      totalAssetsBase: totalAssets.toString(),
      curatorNote: SENTORA_CURATOR_NOTE,
      approvals: 'finite',
      yieldNote:
        'Yield figures for this vault are protocol data served with their source (GET /vault); never an Astryum promise',
      signerNote: 'Signed by your own wallet on Ethereum — Astryum never signs or broadcasts',
    },
  };
}

/* ── B6: the FXRP bridge, Flare → Ethereum (LayerZero OFT, direct calldata) ─ */

export interface FxrpBridgeReader {
  /** The ERC-20 the adapter locks — must BE canonical FXRP (drift refusal). */
  underlyingToken(): Promise<string>;
  /** peers(eid) as bytes32 — must contain the Ethereum OFT (route refusal). */
  peerOf(eid: number): Promise<string>;
  sharedDecimals(): Promise<number>;
  /** quoteSend(...).nativeFee in wei for this exact amount/destination. */
  quoteSendNative(user: string, amountBase: bigint): Promise<bigint>;
  fxrpBalanceOf(user: string): Promise<bigint>;
  flrBalanceOf(user: string): Promise<bigint>;
}

export interface FxrpBridgePrepareResult {
  chainId: typeof FLARE_CHAIN_ID;
  legs: EvmLeg[];
  decimals: { asset: number };
  preflight: { ok: boolean; checks: Array<{ name: string } & Preflight> };
  simulation: { attempted: boolean; note?: string; legs: LegSimulation[] };
  disclosure: {
    disclosedToUser: true;
    astryumFeeBase: '0';
    /** The LIVE LayerZero quote (wei of FLR) and the +5% ceiling actually sent. */
    lzFeeQuotedWei: string;
    lzFeeMaxWei: string;
    refundNote: string;
    destinationNote: string;
    timeNote: string;
    paNote: string;
    signerNote: string;
    approvals: 'finite';
  };
}

export async function prepareFxrpBridge(
  reader: FxrpBridgeReader,
  req: { user: string; amountBase?: string },
  simulate?: SimulateFn,
): Promise<FxrpBridgePrepareResult> {
  const amount = parseAmount(req.amountBase, 'bridge');

  // Route truth first — what the user signs must be the verified route.
  const [underlying, peer, sharedDecimals] = await Promise.all([
    reader.underlyingToken(),
    reader.peerOf(ETHEREUM_EID),
    reader.sharedDecimals(),
  ]);
  if (underlying.toLowerCase() !== FXRP_FLARE_ERC20.toLowerCase()) {
    throw Object.assign(
      new Error('BRIDGE_TOKEN_DRIFT: the adapter no longer wraps canonical FXRP — refusing to build'),
      { code: 'BRIDGE_TOKEN_DRIFT', data: { underlying } },
    );
  }
  if (!peer.toLowerCase().includes(FXRP_ETH_OFT.toLowerCase().slice(2))) {
    throw Object.assign(
      new Error('BRIDGE_PEER_DRIFT: the Ethereum peer is not the canonical FXRP OFT — refusing to build'),
      { code: 'BRIDGE_PEER_DRIFT', data: { peer } },
    );
  }

  const quoted = await reader.quoteSendNative(req.user, amount);
  const maxFee = feeWithBuffer(quoted);

  // Pre-flights (ORDER_WOULD_REVERT pattern): both legs of the cost, BEFORE
  // the wallet opens — the ~98 FLR LayerZero fee is real money.
  const checks: Array<{ name: string } & Preflight> = [];
  const fxrpBalance = await reader.fxrpBalanceOf(req.user);
  checks.push(
    amount > fxrpBalance
      ? {
          name: 'balance', ok: false, code: 'BRIDGE_EXCEEDS_BALANCE',
          message: 'Your Flare wallet does not hold that much FXRP',
          data: { requested: amount.toString(), balance: fxrpBalance.toString() },
        }
      : { name: 'balance', ok: true },
  );
  const flrBalance = await reader.flrBalanceOf(req.user);
  checks.push(
    maxFee > flrBalance
      ? {
          name: 'fee', ok: false, code: 'INSUFFICIENT_FLR_FOR_FEE',
          message: 'The LayerZero delivery fee is paid in FLR and your wallet does not hold enough',
          data: { maxFeeWei: maxFee.toString(), balanceWei: flrBalance.toString() },
        }
      : { name: 'fee', ok: true },
  );
  const preflightOk = checks.every((c) => c.ok);

  const legs = buildBridgeLegs(req.user, amount, quoted);
  const simulation = await simulateLegsBestEffort(legs, req.user, preflightOk, simulate, FLARE_CHAIN_ID);

  return {
    chainId: FLARE_CHAIN_ID,
    legs,
    decimals: { asset: sharedDecimals },
    preflight: { ok: preflightOk, checks },
    simulation,
    disclosure: {
      disclosedToUser: true,
      astryumFeeBase: '0',
      lzFeeQuotedWei: quoted.toString(),
      lzFeeMaxWei: maxFee.toString(),
      refundNote: 'The fee ceiling is quoted +5%; any excess auto-refunds to your wallet',
      destinationNote: 'Delivered to YOUR OWN address on Ethereum — same account, other chain',
      timeNote: 'LayerZero delivery typically takes minutes; the FXRP appears in your Ethereum wallet',
      paNote:
        'If your FXRP sits in the Personal Account, move it to your wallet first (PA → wallet transfer) — the bridge spends from the wallet that signs',
      signerNote: 'Signed by your own wallet on Flare — Astryum never signs or broadcasts',
      approvals: 'finite',
    },
  };
}

/* ── H3: la VUELTA del puente, Ethereum → Flare ───────────────────────────── */

export interface FxrpBridgeBackReader {
  /** peers(FLARE_EID) as bytes32 — debe contener el adapter de Flare. */
  peerOf(eid: number): Promise<string>;
  sharedDecimals(): Promise<number>;
  /** quoteSend(...).nativeFee en wei de ETH para este importe/destino. */
  quoteSendNative(user: string, amountBase: bigint): Promise<bigint>;
  /** FXRP del usuario EN ETHEREUM (el OFT es el propio token). */
  fxrpBalanceOf(user: string): Promise<bigint>;
  /** ETH nativo, que es con lo que se paga la entrega en esta dirección. */
  ethBalanceOf(user: string): Promise<bigint>;
}

/**
 * Trae el FXRP de vuelta a Flare. Espejo honesto de la ida, con las dos
 * diferencias que el usuario TIENE que ver antes de firmar: aquí no hay
 * approve (OFT nativo: quemas tus propios tokens) y la comisión se paga en
 * ETH, no en FLR.
 */
/** Misma forma que la ida, pero se firma en Ethereum (chainId 1). */
export type FxrpBridgeBackPrepareResult = Omit<FxrpBridgePrepareResult, 'chainId'> & {
  chainId: 1;
};

export async function prepareFxrpBridgeBack(
  reader: FxrpBridgeBackReader,
  req: { user: string; amountBase?: string },
  simulate?: SimulateFn,
): Promise<FxrpBridgeBackPrepareResult> {
  const amount = parseAmount(req.amountBase, 'bridge_back');

  const [peer, sharedDecimals] = await Promise.all([
    reader.peerOf(FLARE_EID),
    reader.sharedDecimals(),
  ]);
  // Un EID sin par emparejado se traga los tokens en el origen: se refuta
  // antes de construir, igual que la ida.
  if (!peer.toLowerCase().includes(FXRP_OFT_ADAPTER_FLARE.toLowerCase().slice(2))) {
    throw Object.assign(
      new Error('BRIDGE_PEER_DRIFT: the Flare peer is not the canonical FXRP adapter — refusing to build'),
      { code: 'BRIDGE_PEER_DRIFT', data: { peer, eid: FLARE_EID } },
    );
  }

  const quoted = await reader.quoteSendNative(req.user, amount);
  const maxFee = feeWithBuffer(quoted);

  const checks: Array<{ name: string } & Preflight> = [];
  const fxrpBalance = await reader.fxrpBalanceOf(req.user);
  checks.push(
    amount > fxrpBalance
      ? {
          name: 'balance', ok: false, code: 'BRIDGE_EXCEEDS_BALANCE',
          message: 'Your Ethereum wallet does not hold that much FXRP',
          data: { requested: amount.toString(), balance: fxrpBalance.toString() },
        }
      : { name: 'balance', ok: true },
  );
  const ethBalance = await reader.ethBalanceOf(req.user);
  checks.push(
    maxFee > ethBalance
      ? {
          name: 'fee', ok: false, code: 'INSUFFICIENT_ETH_FOR_FEE',
          message: 'The LayerZero delivery fee is paid in ETH on this leg and your wallet does not hold enough',
          data: { maxFeeWei: maxFee.toString(), balanceWei: ethBalance.toString() },
        }
      : { name: 'fee', ok: true },
  );
  const preflightOk = checks.every((c) => c.ok);

  const legs = buildBridgeBackLegs(req.user, amount, quoted);
  const simulation = await simulateLegsBestEffort(legs, req.user, preflightOk, simulate, 1);

  return {
    chainId: 1,
    legs,
    decimals: { asset: sharedDecimals },
    preflight: { ok: preflightOk, checks },
    simulation,
    disclosure: {
      disclosedToUser: true,
      astryumFeeBase: '0',
      lzFeeQuotedWei: quoted.toString(),
      lzFeeMaxWei: maxFee.toString(),
      refundNote: 'The fee ceiling is quoted +5%; any excess auto-refunds to your wallet',
      destinationNote: 'Delivered to YOUR OWN address on Flare — same account, other chain',
      timeNote: 'LayerZero delivery typically takes minutes; the FXRP appears in your Flare wallet',
      paNote:
        'This leg spends the FXRP held by the wallet that signs, on Ethereum — and its fee is paid in ETH, not FLR',
      signerNote: 'Signed by your own wallet on Ethereum — Astryum never signs or broadcasts',
      // OFT nativo: no hay approve que dar. Decirlo evita que la UI prometa
      // una pata que no existe.
      approvals: 'finite',
    },
  };
}

/* ── Cerrar la posición ENTERA en un lote (2026-08-29) ─────────────────────── */

/**
 * `close_carry` — cancelar del todo, sin traer nada de fuera.
 *
 * El problema que resuelve (fundador, 29-ago): para cancelar hay que devolver
 * MÁS de lo que se pidió, porque la deuda devenga interés (7,53% APR) y lo
 * prestado en la bóveda rinde menos (6,21%). Ese hueco —pequeño, pero real y
 * creciente— obligaba al usuario a traer RLUSD de otro sitio, probablemente
 * desde Flare. Fricción fea para una empresa que vende abstracción.
 *
 * La respuesta: la posición YA tiene con qué. Está sobrecolateralizada por
 * diseño, y ese exceso de colateral se puede retirar ANTES de repagar (Morpho
 * lo permite mientras la posición siga sana). Con él se compra el hueco EXACTO
 * y se cierra. Verificado por simulación sobre una posición real de mainnet el
 * 29-ago: hueco de 0,2516 RLUSD cubierto con 0,18 FXRP del propio colateral.
 *
 * El swap reusa `SwapFillService` —el mismo `exactOutput`, el mismo tope con
 * slippage, la misma divulgación— con el venue de Ethereum. No es una copia: es
 * el mismo código con otro venue (ver la nota de `SwapVenue`).
 *
 * DOCTRINA DE LA CASA, heredada del 31-jul: elegir es OBLIGATORIO. Si hay hueco
 * y el usuario no ha dicho cómo cubrirlo, esto NO decide por él: devuelve el
 * hueco y sus opciones, y el pre-flight bloquea. Un default silencioso que vende
 * colateral del usuario sería exactamente lo que no hacemos.
 */
export function ethereumSwapVenue(): SwapVenue {
  return {
    router: UNISWAP_V3_ROUTER_ETH,
    quoter: UNISWAP_V3_QUOTER_ETH,
    wrappedNative: WETH_ETH,
    label: 'Uniswap v3 (Ethereum)',
  };
}

/** Cotizador inyectable — la ruta pasa el real; los tests, un stub. */
export type FillQuoteFn = (p: {
  tokenIn: string;
  tokenOut: string;
  amountOutBase: bigint;
}) => Promise<{ feeTier: number; amountInQuoted: bigint } | null>;

export interface CloseCarryRequest {
  user: string;
  /**
   * Cómo cubrir el hueco del interés. `undefined` = el usuario todavía no ha
   * elegido: se devuelve el plan y el pre-flight bloquea (no hay default).
   *   'swap-collateral' → vender el mínimo colateral necesario, en el lote.
   *   'wallet'          → el usuario pone el hueco de su bolsillo.
   */
  coverGap?: 'swap-collateral' | 'wallet';
}

export interface CloseCarryResult {
  chainId: 1;
  marketId: string;
  legs: EvmLeg[];
  decimals: { collateral: number; loan: number };
  preflight: { ok: boolean; checks: Array<{ name: string } & Preflight> };
  simulation: { attempted: boolean; note?: string; legs: LegSimulation[] };
  /** El plan, en cifras — lo que la pantalla tiene que contar antes de firmar. */
  close: {
    /** Deuda viva + colchón del approve: lo que hay que devolver de verdad. */
    needBase: string;
    /** Lo que la bóveda de Sentora devuelve (limitado por su liquidez viva). */
    fromVaultBase: string;
    /** RLUSD que ya está en la wallet. */
    fromWalletBase: string;
    /** Lo que falta tras sumar los dos anteriores: EL HUECO DEL INTERÉS. */
    gapBase: string;
    /** Cómo se cubre, si el usuario ya eligió. */
    coverGap: 'swap-collateral' | 'wallet' | null;
    /** Solo con 'swap-collateral': el colateral que se vende y su tope. */
    swap: {
      venue: string;
      feeTier: number;
      collateralInQuotedBase: string;
      collateralInMaxBase: string;
      slippagePct: number;
      note: string;
    } | null;
    /** Colateral que vuelve al usuario al terminar. */
    collateralReturnedBase: string;
    note: string;
  };
  disclosure: {
    disclosedToUser: true;
    astryumFeeBase: '0';
    approvals: 'finite';
    signerNote: string;
    carryNote: string;
  };
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export async function prepareCloseCarry(
  reader: MorphoChainReader,
  vault: SentoraVaultReader,
  req: CloseCarryRequest,
  quoteFill?: FillQuoteFn,
  simulate?: SimulateFn,
): Promise<CloseCarryResult> {
  const snapshot = await readMarketSnapshot(reader, FXRP_RLUSD_MARKET_ID);
  const raw = await reader.position(FXRP_RLUSD_MARKET_ID, req.user);
  const position = computeUserPosition(raw, snapshot);

  if (position.borrowShares <= 0n && position.collateral <= 0n) {
    throw Object.assign(new Error('close_carry: there is no position to close'), {
      code: 'NO_POSITION',
    });
  }

  const checks: Array<{ name: string } & Preflight> = [];
  // Lo que hay que devolver: la deuda VIVA más el colchón del approve. La deuda
  // crece entre que esto se compone y se firma, y por eso el cap lleva margen.
  const need = position.borrowShares > 0n ? repayFullApproveCap(position.borrowAssets) : 0n;

  // 1. Lo que la propia posición aporta, en orden de coste: primero la wallet
  //    (gratis), luego la bóveda (una retirada), y solo entonces el colateral.
  let fromWallet = 0n;
  if (reader.erc20BalanceOf) {
    try {
      fromWallet = await reader.erc20BalanceOf(snapshot.params.loanToken, req.user);
    } catch {
      /* ilegible: se trata como 0 y el hueco sale mayor — el lado seguro */
    }
  }
  let vaultClaim = 0n;
  let vaultIdle = 0n;
  try {
    const shares = vault.sharesOf ? await vault.sharesOf(req.user) : 0n;
    vaultClaim = shares > 0n && vault.previewRedeem ? await vault.previewRedeem(shares) : 0n;
    vaultIdle = vault.idleAssets ? await vault.idleAssets() : 0n;
  } catch {
    /* la bóveda no se pudo leer: su pata no entra y el hueco sale mayor */
  }
  // La bóveda no puede pagar más de su liquidez viva (Vault V2 sin
  // liquidityAdapter: techo DURO, no cota conservadora).
  const vaultPayable = minBig(vaultClaim, vaultIdle);
  const fromVaultUsed = need > fromWallet ? minBig(vaultPayable, need - fromWallet) : 0n;

  const available = fromWallet + fromVaultUsed;
  const gap = need > available ? need - available : 0n;

  // 2. El hueco: cómo se cubre. Sin elección del usuario NO se decide (31-jul).
  let swapPlan: CloseCarryResult['close']['swap'] = null;
  let collateralSold = 0n;
  const fillLegs: EvmLeg[] = [];

  if (gap > 0n) {
    if (!req.coverGap) {
      checks.push({
        name: 'gap',
        ok: false,
        code: 'CLOSE_GAP_CHOICE_REQUIRED',
        message:
          'Closing costs more than you borrowed because the debt accrues interest. Choose how to cover the difference: sell the minimum collateral inside this same transaction, or bring the RLUSD yourself.',
        data: { gap: gap.toString(), asset: 'RLUSD' },
      });
    } else if (req.coverGap === 'wallet') {
      checks.push({
        name: 'gap',
        ok: false,
        code: 'CLOSE_GAP_NOT_FUNDED',
        message: 'Bring the missing RLUSD to your wallet on Ethereum and close again',
        data: { gap: gap.toString(), asset: 'RLUSD' },
      });
    } else if (!swapFillEnabled()) {
      checks.push({
        name: 'gap',
        ok: false,
        code: 'SWAP_FILL_DISABLED',
        message: 'The in-batch swap is switched off right now — bring the missing RLUSD yourself',
        data: { gap: gap.toString() },
      });
    } else if (!quoteFill) {
      checks.push({
        name: 'gap',
        ok: false,
        code: 'SWAP_FILL_NO_QUOTER',
        message: 'No quoter available to price the gap — nothing was prepared',
        data: { gap: gap.toString() },
      });
    } else {
      const quote = await quoteFill({
        tokenIn: snapshot.params.collateralToken,
        tokenOut: snapshot.params.loanToken,
        amountOutBase: gap,
      }).catch(() => null);
      if (!quote) {
        checks.push({
          name: 'gap',
          ok: false,
          code: 'SWAP_FILL_NO_ROUTE',
          message: 'No pool quotes that swap for the missing amount right now',
          data: { gap: gap.toString() },
        });
      } else {
        const slippage = fillSlippagePct();
        const maxIn = computeMaxIn(quote.amountInQuoted, slippage);
        collateralSold = maxIn;
        // El colateral que se vende sale del EXCESO: retirarlo no puede dejar la
        // posición por debajo de su límite mientras aún hay deuda.
        const wd = preflightWithdrawCollateral(position, snapshot, maxIn);
        checks.push({ name: 'collateral-for-gap', ...wd });
        if (wd.ok) {
          const fillQuote: FillQuote = {
            asset: 'FXRP',
            tokenIn: snapshot.params.collateralToken,
            tokenInDecimals: snapshot.collateralDecimals,
            feeTier: quote.feeTier,
            amountInQuoted: quote.amountInQuoted,
            amountInMax: maxIn,
          };
          const venue = ethereumSwapVenue();
          // Primero se retira el colateral que el swap va a gastar; luego el
          // swap compra EXACTAMENTE el hueco. Sin vuelta que devolver.
          fillLegs.push({
            to: MORPHO_BLUE_SINGLETON,
            data: buildWithdrawCollateralLegs(req.user, maxIn, snapshot.params)[0].data,
            value: '0x0',
            description: 'Withdraw the exact collateral the swap will spend',
          });
          for (const c of buildFillSwapCalls({
            quote: fillQuote,
            tokenOut: snapshot.params.loanToken,
            amountOutBase: gap,
            recipient: req.user,
            venue,
          })) {
            fillLegs.push({
              to: c.to,
              data: c.calldata,
              value: c.value === '0' ? '0x0' : '0x' + BigInt(c.value).toString(16),
              description:
                c.to.toLowerCase() === venue.router.toLowerCase()
                  ? 'Buy exactly the missing RLUSD with your own collateral'
                  : 'Approve the collateral to the swap router (capped)',
            });
          }
          swapPlan = {
            venue: venue.label,
            feeTier: quote.feeTier,
            collateralInQuotedBase: quote.amountInQuoted.toString(),
            collateralInMaxBase: maxIn.toString(),
            slippagePct: slippage,
            note: 'The swap buys the EXACT missing amount; it spends at most the capped collateral shown, and anything unspent stays yours.',
          };
        }
      }
    }
  }

  // 3. El lote, en el único orden que funciona.
  const legs: EvmLeg[] = [];
  if (fromVaultUsed > 0n) {
    legs.push(...buildVaultWithdrawLegs(req.user, fromVaultUsed));
  }
  legs.push(...fillLegs);
  if (position.borrowShares > 0n) {
    legs.push(
      ...buildRepayLegs(
        req.user,
        { mode: 'full', fullDebtShares: position.borrowShares, approveCap: need },
        snapshot.params,
      ),
    );
  }
  const collateralReturned = position.collateral - collateralSold;
  if (collateralReturned > 0n) {
    legs.push(...buildWithdrawCollateralLegs(req.user, collateralReturned, snapshot.params));
  }

  const preflightOk = checks.every((c) => c.ok);
  const simulation = await simulateLegsBestEffort(legs, req.user, preflightOk, simulate);

  return {
    chainId: 1,
    marketId: FXRP_RLUSD_MARKET_ID,
    legs,
    decimals: { collateral: snapshot.collateralDecimals, loan: snapshot.loanDecimals },
    preflight: { ok: preflightOk, checks },
    simulation,
    close: {
      needBase: need.toString(),
      fromVaultBase: fromVaultUsed.toString(),
      fromWalletBase: fromWallet.toString(),
      gapBase: gap.toString(),
      coverGap: req.coverGap ?? null,
      swap: swapPlan,
      collateralReturnedBase: collateralReturned.toString(),
      note: 'Closing returns more than you borrowed: the debt accrues interest and the vault yields less than the loan costs. The difference is covered from the position itself — nothing has to be brought from another chain.',
    },
    disclosure: {
      disclosedToUser: true,
      astryumFeeBase: '0',
      approvals: 'finite',
      signerNote: 'Signed by your own wallet on Ethereum — Astryum never signs or broadcasts',
      carryNote:
        'While the position was open the loan cost more than the vault paid; that gap is what makes the closing amount larger than the borrowed one.',
    },
  };
}

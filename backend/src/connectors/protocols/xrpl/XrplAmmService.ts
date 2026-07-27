/**
 * XrplAmmService — AMM liquidity builders (Fase 2.3, PRIORIDAD 3).
 *
 * AMMDeposit/AMMWithdraw against XLS-30 pools — providing liquidity is the
 * native XRPL yield primitive (LP fees accrue INSIDE the pool; there is no
 * "harvest" transaction and we never promise one). Pool data (trading fee,
 * reserves) comes read-only from `XRPLProvider.getAmmInfo` and is disclosed
 * as protocol data with source, never as an Astryum offer (invariant #9).
 *
 * Modes (verified against xrpl.js 4.5 AMMDepositFlags/AMMWithdrawFlags):
 *   deposit  'two-asset'     → Amount + Amount2, tfTwoAsset (proportional).
 *   deposit  'single-asset'  → Amount only, tfSingleAsset (pool rebalances).
 *   deposit  'lp-token-out'  → LPTokenOut, tfLPToken (exact LP tokens out).
 *   withdraw 'all'           → tfWithdrawAll (burn all LP tokens).
 *   withdraw 'lp-token-in'   → LPTokenIn, tfLPToken (burn exact LP tokens).
 *   withdraw 'single-asset'  → Amount, tfSingleAsset (take one side out).
 *
 * Unsigned txjson → Xaman. Astryum signs nothing. SourceTag always.
 */

import { isValidClassicAddress, validate, AMMDepositFlags, AMMWithdrawFlags } from 'xrpl';
import type { Amount, Currency, IssuedCurrencyAmount, AMMDeposit, AMMWithdraw } from 'xrpl';
import { withSourceTag } from '../../../config/xrplSourceTag';
import { assertPositiveDrops, type XrplTxHandoff } from './XrplTxHandoff';

/**
 * Pool asset descriptor: {currency:'XRP'} or {currency, issuer}. Narrower than
 * xrpl.js `Currency` on purpose — MPT pool sides (mpt_issuance_id) are out of
 * scope for these builders.
 */
export interface XrplPoolAsset {
  currency: string;
  issuer?: string;
}

function assertPoolAsset(asset: XrplPoolAsset, field: string): void {
  if (!asset || typeof asset !== 'object' || !asset.currency) {
    throw new Error(`${field} must be a Currency object ({currency} or {currency, issuer})`);
  }
  if (asset.currency !== 'XRP') {
    if (!asset.issuer || !isValidClassicAddress(asset.issuer)) {
      throw new Error(`${field}.issuer must be a valid XRPL address for non-XRP assets`);
    }
  }
}

function assertAmount(amount: Amount, field: string): void {
  if (typeof amount === 'string') {
    assertPositiveDrops(amount, field);
    return;
  }
  const { currency, issuer, value } = amount as IssuedCurrencyAmount;
  if (!currency) throw new Error(`${field}.currency is required`);
  if (!issuer || !isValidClassicAddress(issuer)) {
    throw new Error(`${field}.issuer must be a valid XRPL address`);
  }
  if (!value || !(Number(value) > 0)) {
    throw new Error(`${field}.value must be a positive decimal string`);
  }
}

function describeAsset(asset: XrplPoolAsset): string {
  return asset.currency === 'XRP' ? 'XRP' : asset.currency;
}

const POOL_FEE_NOTE =
  'LP fees accrue inside the pool (XLS-30) — there is no separate harvest transaction. ' +
  'TradingFee is protocol data read from amm_info, not an Astryum rate.';

export type AmmDepositMode =
  | { mode: 'two-asset'; amount: Amount; amount2: Amount }
  | { mode: 'single-asset'; amount: Amount }
  | { mode: 'lp-token-out'; lpTokenOut: IssuedCurrencyAmount };

export interface BuildAmmDepositInput {
  /** The XRPL account providing liquidity (the signer in Xaman). */
  account: string;
  /** Pool identity, e.g. {currency:'XRP'} + {currency:'RLUSD', issuer:'r...'}. */
  asset: XrplPoolAsset;
  asset2: XrplPoolAsset;
  deposit: AmmDepositMode;
  /** TradingFee read from amm_info (units of 1/100_000; 500 = 0.5%) — disclosed. */
  poolTradingFee?: number;
}

export function buildAmmDeposit(
  input: BuildAmmDepositInput,
): XrplTxHandoff<AMMDeposit & { SourceTag?: number }> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  assertPoolAsset(input.asset, 'asset');
  assertPoolAsset(input.asset2, 'asset2');

  const d = input.deposit;
  let fields: Partial<AMMDeposit>;
  let flags: number;
  let modeNote: string;

  switch (d.mode) {
    case 'two-asset':
      assertAmount(d.amount, 'deposit.amount');
      assertAmount(d.amount2, 'deposit.amount2');
      fields = { Amount: d.amount, Amount2: d.amount2 };
      flags = AMMDepositFlags.tfTwoAsset;
      modeNote = 'deposits both assets proportionally';
      break;
    case 'single-asset':
      assertAmount(d.amount, 'deposit.amount');
      fields = { Amount: d.amount };
      flags = AMMDepositFlags.tfSingleAsset;
      modeNote = 'deposits one asset (the pool rebalances — small implicit swap cost)';
      break;
    case 'lp-token-out':
      assertAmount(d.lpTokenOut, 'deposit.lpTokenOut');
      fields = { LPTokenOut: d.lpTokenOut };
      flags = AMMDepositFlags.tfLPToken;
      modeNote = 'requests an exact LP-token amount out';
      break;
  }

  const xrplTx = withSourceTag({
    TransactionType: 'AMMDeposit' as const,
    Account: input.account,
    Asset: input.asset as Currency,
    Asset2: input.asset2 as Currency,
    ...fields,
    Flags: flags,
  }) as AMMDeposit & { SourceTag?: number };

  validate(xrplTx as unknown as Record<string, unknown>);

  const pair = `${describeAsset(input.asset)}/${describeAsset(input.asset2)}`;
  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        `Astryum builds this unsigned AMMDeposit; you sign it in Xaman. It ${modeNote} into the ` +
        `${pair} XLS-30 pool and you receive LP tokens. ${POOL_FEE_NOTE}`,
      facts: {
        pool: pair,
        mode: d.mode,
        ...(input.poolTradingFee !== undefined
          ? {
              poolTradingFeePct: input.poolTradingFee / 1000,
              poolTradingFeeSource: 'amm_info (XRPL ledger)',
            }
          : {}),
        network: 'XRPL mainnet',
      },
    },
  };
}

export type AmmWithdrawMode =
  | { mode: 'all' }
  | { mode: 'lp-token-in'; lpTokenIn: IssuedCurrencyAmount }
  | { mode: 'single-asset'; amount: Amount };

export interface BuildAmmWithdrawInput {
  /** The XRPL account withdrawing liquidity (the signer in Xaman). */
  account: string;
  asset: XrplPoolAsset;
  asset2: XrplPoolAsset;
  withdraw: AmmWithdrawMode;
}

export function buildAmmWithdraw(
  input: BuildAmmWithdrawInput,
): XrplTxHandoff<AMMWithdraw & { SourceTag?: number }> {
  if (!isValidClassicAddress(input.account)) {
    throw new Error(`account is not a valid XRPL address: ${input.account}`);
  }
  assertPoolAsset(input.asset, 'asset');
  assertPoolAsset(input.asset2, 'asset2');

  const w = input.withdraw;
  let fields: Partial<AMMWithdraw>;
  let flags: number;
  let modeNote: string;

  switch (w.mode) {
    case 'all':
      fields = {};
      flags = AMMWithdrawFlags.tfWithdrawAll;
      modeNote = 'burns ALL your LP tokens and returns both assets';
      break;
    case 'lp-token-in':
      assertAmount(w.lpTokenIn, 'withdraw.lpTokenIn');
      fields = { LPTokenIn: w.lpTokenIn };
      flags = AMMWithdrawFlags.tfLPToken;
      modeNote = 'burns an exact LP-token amount and returns both assets proportionally';
      break;
    case 'single-asset':
      assertAmount(w.amount, 'withdraw.amount');
      fields = { Amount: w.amount };
      flags = AMMWithdrawFlags.tfSingleAsset;
      modeNote = 'withdraws one asset only (the pool rebalances — small implicit swap cost)';
      break;
  }

  const xrplTx = withSourceTag({
    TransactionType: 'AMMWithdraw' as const,
    Account: input.account,
    Asset: input.asset as Currency,
    Asset2: input.asset2 as Currency,
    ...fields,
    Flags: flags,
  }) as AMMWithdraw & { SourceTag?: number };

  validate(xrplTx as unknown as Record<string, unknown>);

  const pair = `${describeAsset(input.asset)}/${describeAsset(input.asset2)}`;
  return {
    xrplTx,
    disclosure: {
      disclosedToUser: true,
      defibroSigns: false,
      note:
        `Astryum builds this unsigned AMMWithdraw; you sign it in Xaman. It ${modeNote} from the ` +
        `${pair} XLS-30 pool.`,
      facts: { pool: pair, mode: w.mode, network: 'XRPL mainnet' },
    },
  };
}

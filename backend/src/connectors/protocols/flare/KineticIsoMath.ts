/**
 * Shared collateral math for the Kinetic ISO FXRP→USDT0 position.
 *
 * ONE source of truth for E1 (compute the USDT0 borrow amount) and A1 (compute
 * the FTSO XRP/USD trigger price). If these diverged, A1 would defend a position
 * sized differently from what E1 opened. `borrowRatio` is ALWAYS a user input —
 * never hardcoded — because A1's trigger depends on the exact ratio the user chose.
 *
 * Compound-style health factor with USDT0 debt (≈ $1, constant), so HF moves
 * only with FXRP/USD:
 *     HF = (C · P_fxrp · CF) / (D · P_usdt0)
 *   ⇒ P_trigger = HF_target · D · P_usdt0 / (C · CF)
 * where C = FXRP collateral (human), D = USDT0 debt (human), CF = collateral factor.
 */

const FXRP_DECIMALS = 6n; // FXRP UBA == XRP drops (assetDecimals = 6, verified mainnet)
const USDT0_DECIMALS = 6n; // verified mainnet (kUSDT0 ISO underlying)

function toHuman(base: bigint, decimals: bigint): number {
  return Number(base) / 10 ** Number(decimals);
}

export interface BorrowInputs {
  /** Net FXRP supplied as collateral, base units (6 dec) — use NetMintBreakdown.supplyUBA. */
  supplyUBA: bigint;
  /** FTSO XRP/USD price (FXRP tracks XRP). */
  fxrpPriceUSD: number;
  /** Live collateral factor of kFXRP ISO (e.g. 0.70). */
  collateralFactor: number;
  /** User-chosen borrow ratio as a fraction of max capacity (0..1). NOT hardcoded. */
  borrowRatio: number;
  /** USDT0 price; ~1. Default 1. */
  usdt0PriceUSD?: number;
}

export interface BorrowResult {
  collateralValueUSD: number;
  maxBorrowUSD: number;
  borrowValueUSD: number;
  borrowUsdt0Human: number;
  /** USDT0 to borrow, base units (6 dec), floored (under-borrow is safe). */
  borrowUsdt0Base: bigint;
}

/** Compute the USDT0 borrow amount for the chosen ratio (E1). */
export function computeBorrowUsdt0(i: BorrowInputs): BorrowResult {
  if (i.supplyUBA <= 0n) throw new Error('ISO_MATH_BAD_SUPPLY: supplyUBA must be > 0');
  if (!(i.fxrpPriceUSD > 0)) throw new Error('ISO_MATH_BAD_PRICE: fxrpPriceUSD must be > 0');
  if (!(i.collateralFactor > 0 && i.collateralFactor <= 1))
    throw new Error('ISO_MATH_BAD_CF: collateralFactor must be in (0, 1]');
  if (!(i.borrowRatio > 0 && i.borrowRatio <= 1))
    throw new Error('ISO_MATH_BAD_RATIO: borrowRatio must be in (0, 1]');

  const usdt0Price = i.usdt0PriceUSD ?? 1;
  const C = toHuman(i.supplyUBA, FXRP_DECIMALS);
  const collateralValueUSD = C * i.fxrpPriceUSD;
  const maxBorrowUSD = collateralValueUSD * i.collateralFactor;
  const borrowValueUSD = maxBorrowUSD * i.borrowRatio;
  const borrowUsdt0Human = borrowValueUSD / usdt0Price;
  // Floor to base units — under-borrowing keeps HF higher, never reverts.
  const borrowUsdt0Base = BigInt(Math.floor(borrowUsdt0Human * 10 ** Number(USDT0_DECIMALS)));
  if (borrowUsdt0Base <= 0n) throw new Error('ISO_MATH_BORROW_ZERO: computed borrow rounds to 0');

  return {
    collateralValueUSD,
    maxBorrowUSD,
    borrowValueUSD,
    borrowUsdt0Human,
    borrowUsdt0Base,
  };
}

export interface TriggerInputs {
  supplyUBA: bigint;
  /** USDT0 debt, base units (6 dec) — the borrowUsdt0Base used to open the position. */
  borrowUsdt0Base: bigint;
  collateralFactor: number;
  /** HF level at which A1 fires the repay (e.g. 1.1). */
  targetHF: number;
  usdt0PriceUSD?: number;
}

export interface TriggerResult {
  /** FXRP/USD price at which HF == targetHF → A1 prepares the repay below this. */
  triggerPriceUSD: number;
  /** Current HF at a given FXRP price (helper for display/sanity). */
  hfAt: (fxrpPriceUSD: number) => number;
}

/**
 * Precompute the FXRP/USD trigger price for A1 (decision: same inputs as E1's
 * borrow). The AutomationEngine fires when the live FTSO XRP/USD < triggerPriceUSD.
 */
export function computeTriggerPrice(i: TriggerInputs): TriggerResult {
  if (i.supplyUBA <= 0n) throw new Error('ISO_MATH_BAD_SUPPLY');
  if (i.borrowUsdt0Base <= 0n) throw new Error('ISO_MATH_BAD_DEBT');
  if (!(i.collateralFactor > 0 && i.collateralFactor <= 1)) throw new Error('ISO_MATH_BAD_CF');
  if (!(i.targetHF > 0)) throw new Error('ISO_MATH_BAD_HF');

  const usdt0Price = i.usdt0PriceUSD ?? 1;
  const C = toHuman(i.supplyUBA, FXRP_DECIMALS);
  const D = toHuman(i.borrowUsdt0Base, USDT0_DECIMALS);
  const triggerPriceUSD = (i.targetHF * D * usdt0Price) / (C * i.collateralFactor);
  return {
    triggerPriceUSD,
    hfAt: (fxrpPriceUSD: number) => (C * fxrpPriceUSD * i.collateralFactor) / (D * usdt0Price),
  };
}

export interface RepayToRestoreInputs {
  /** FXRP collateral supplied, base units (6 dec). */
  supplyUBA: bigint;
  /** Current USDT0 debt, base units (6 dec). */
  debtUsdt0Base: bigint;
  /** Live FTSO XRP/USD (FXRP tracks XRP) — the scenario/drop price at trigger time. */
  fxrpPriceUSD: number;
  /** Live collateral factor of kFXRP ISO. */
  collateralFactor: number;
  /** HF to restore to (HF_safe). */
  targetHF: number;
  usdt0PriceUSD?: number;
}

export interface RepayToRestoreResult {
  /** HF at the given price BEFORE any repay. */
  currentHF: number;
  /** false when currentHF ≥ targetHF (position already safe → nothing to repay). */
  needed: boolean;
  /** USDT0 to repay to bring HF up to targetHF (human). */
  repayUsdt0Human: number;
  /** USDT0 to repay, base units (6 dec) — CEILed (repay a touch more → HF a touch
   *  higher, never below target), then capped at the outstanding debt. */
  repayUsdt0Base: bigint;
  /** Debt that remains after the repay, base units. */
  remainingDebtBase: bigint;
}

/**
 * How much USDT0 to repay to restore HF back to `targetHF` (the A1 protection
 * amount). Same collateral model as computeTriggerPrice — USDT0 debt is ≈ $1, so:
 *     HF = (C · P_fxrp · CF) / (D · P_usdt0)
 *   target debt D' = (C · P_fxrp · CF) / (HF_safe · P_usdt0)
 *   ΔD = D − D'
 * ΔD is CEILed to base units and capped at the outstanding debt (can't repay more
 * than owed). When HF is already ≥ target, returns needed=false / repay 0. For a
 * demo "repay-in-full" the caller passes the full debt instead of this ΔD.
 */
export function computeRepayToRestoreHF(i: RepayToRestoreInputs): RepayToRestoreResult {
  if (i.supplyUBA <= 0n) throw new Error('ISO_MATH_BAD_SUPPLY');
  if (i.debtUsdt0Base <= 0n) throw new Error('ISO_MATH_BAD_DEBT');
  if (!(i.fxrpPriceUSD > 0)) throw new Error('ISO_MATH_BAD_PRICE');
  if (!(i.collateralFactor > 0 && i.collateralFactor <= 1)) throw new Error('ISO_MATH_BAD_CF');
  if (!(i.targetHF > 0)) throw new Error('ISO_MATH_BAD_HF');

  const usdt0Price = i.usdt0PriceUSD ?? 1;
  const C = toHuman(i.supplyUBA, FXRP_DECIMALS);
  const D = toHuman(i.debtUsdt0Base, USDT0_DECIMALS);
  const currentHF = (C * i.fxrpPriceUSD * i.collateralFactor) / (D * usdt0Price);

  if (currentHF >= i.targetHF) {
    return { currentHF, needed: false, repayUsdt0Human: 0, repayUsdt0Base: 0n, remainingDebtBase: i.debtUsdt0Base };
  }

  const targetDebtHuman = (C * i.fxrpPriceUSD * i.collateralFactor) / (i.targetHF * usdt0Price);
  const deltaDHuman = D - targetDebtHuman; // > 0 here (currentHF < targetHF)
  const scale = 10 ** Number(USDT0_DECIMALS);
  let repayUsdt0Base = BigInt(Math.ceil(deltaDHuman * scale));
  if (repayUsdt0Base > i.debtUsdt0Base) repayUsdt0Base = i.debtUsdt0Base; // never over-repay
  const remainingDebtBase = i.debtUsdt0Base - repayUsdt0Base;

  return {
    currentHF,
    needed: true,
    repayUsdt0Human: Number(repayUsdt0Base) / scale,
    repayUsdt0Base,
    remainingDebtBase,
  };
}

export interface DeriskShortfallInputs {
  /** USDT0 the repay needs in the signing wallet, base units (mode 'full' ⇒ the whole debt). */
  repayUsdt0Base: bigint;
  /** USDT0 the ISO supply withdrawal yields into the EVM wallet (DERISK step 1), base units. */
  withdrawableUsdt0Base: bigint;
}

export interface DeriskShortfallResult {
  /** max(0, repay − withdrawable): USDT0 the user must top up from their EVM wallet. */
  shortfallUsdt0Base: bigint;
  shortfallUsdt0Human: number;
  /** true when the withdrawn supply alone covers the repay (shortfall = 0). */
  coveredByWithdraw: boolean;
}

/**
 * DERISK shortfall of the carry spread (audit 2026-07, M7). Borrow APY > supply
 * APY, so the USDT0 debt compounds faster than the re-supplied USDT0: at unwind
 * time the supply withdrawal (DERISK step 1: withdraw USDT0 PA→EVM) may no
 * longer cover the full repay (step 2). The difference
 *     shortfall = max(0, repay − withdrawable)
 * must already sit in the user's EVM wallet before signing the repay, or the
 * repayBorrowBehalf pull reverts. Disclosed in /a1/prepare (#6) so the user
 * funds it first.
 */
export function computeDeriskShortfall(i: DeriskShortfallInputs): DeriskShortfallResult {
  if (i.repayUsdt0Base <= 0n) throw new Error('ISO_MATH_BAD_REPAY: repayUsdt0Base must be > 0');
  if (i.withdrawableUsdt0Base < 0n)
    throw new Error('ISO_MATH_BAD_WITHDRAWABLE: withdrawableUsdt0Base must be >= 0');

  const shortfallUsdt0Base =
    i.repayUsdt0Base > i.withdrawableUsdt0Base ? i.repayUsdt0Base - i.withdrawableUsdt0Base : 0n;
  return {
    shortfallUsdt0Base,
    shortfallUsdt0Human: toHuman(shortfallUsdt0Base, USDT0_DECIMALS),
    coveredByWithdraw: shortfallUsdt0Base === 0n,
  };
}

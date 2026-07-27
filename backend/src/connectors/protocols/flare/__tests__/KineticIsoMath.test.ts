import {
  computeBorrowUsdt0,
  computeTriggerPrice,
  computeRepayToRestoreHF,
  computeDeriskShortfall,
} from '../KineticIsoMath';

const SUPPLY = 19_680_300n; // 19.6803 FXRP (post-fee net, 6 dec)

describe('KineticIsoMath — computeBorrowUsdt0 (E1)', () => {
  test('borrow = collateral · CF · ratio, floored to 6dp', () => {
    const r = computeBorrowUsdt0({
      supplyUBA: SUPPLY,
      fxrpPriceUSD: 2.84,
      collateralFactor: 0.7,
      borrowRatio: 0.3,
    });
    expect(r.collateralValueUSD).toBeCloseTo(55.892052, 4);
    expect(r.maxBorrowUSD).toBeCloseTo(39.124436, 4);
    expect(r.borrowValueUSD).toBeCloseTo(11.737331, 4);
    // ~11.7373 USDT0 in 6dp, floored
    expect(r.borrowUsdt0Base).toBeGreaterThan(11_730_000n);
    expect(r.borrowUsdt0Base).toBeLessThan(11_745_000n);
  });

  test('borrowRatio is honoured (not hardcoded): 50% borrows ~1.67× the 30% amount', () => {
    const base = { supplyUBA: SUPPLY, fxrpPriceUSD: 2.84, collateralFactor: 0.7 };
    const r30 = computeBorrowUsdt0({ ...base, borrowRatio: 0.3 });
    const r50 = computeBorrowUsdt0({ ...base, borrowRatio: 0.5 });
    const ratio = Number(r50.borrowUsdt0Base) / Number(r30.borrowUsdt0Base);
    expect(ratio).toBeCloseTo(0.5 / 0.3, 3);
  });

  test('rejects bad inputs', () => {
    expect(() => computeBorrowUsdt0({ supplyUBA: 0n, fxrpPriceUSD: 2, collateralFactor: 0.7, borrowRatio: 0.3 })).toThrow(/SUPPLY/);
    expect(() => computeBorrowUsdt0({ supplyUBA: SUPPLY, fxrpPriceUSD: 0, collateralFactor: 0.7, borrowRatio: 0.3 })).toThrow(/PRICE/);
    expect(() => computeBorrowUsdt0({ supplyUBA: SUPPLY, fxrpPriceUSD: 2, collateralFactor: 1.5, borrowRatio: 0.3 })).toThrow(/CF/);
    expect(() => computeBorrowUsdt0({ supplyUBA: SUPPLY, fxrpPriceUSD: 2, collateralFactor: 0.7, borrowRatio: 0 })).toThrow(/RATIO/);
  });
});

describe('KineticIsoMath — computeTriggerPrice (A1, same inputs as E1)', () => {
  test('trigger price + round-trip HF', () => {
    const borrow = computeBorrowUsdt0({ supplyUBA: SUPPLY, fxrpPriceUSD: 2.84, collateralFactor: 0.7, borrowRatio: 0.3 });
    const t = computeTriggerPrice({
      supplyUBA: SUPPLY,
      borrowUsdt0Base: borrow.borrowUsdt0Base,
      collateralFactor: 0.7,
      targetHF: 1.1,
    });
    // At the entry price, HF ≈ 1/ratio = 3.33 (30% of capacity used).
    expect(t.hfAt(2.84)).toBeCloseTo(1 / 0.3, 1);
    // HF at the trigger price equals the target (round-trip consistency).
    expect(t.hfAt(t.triggerPriceUSD)).toBeCloseTo(1.1, 6);
    // Trigger is below the entry price (price must fall for HF to drop).
    expect(t.triggerPriceUSD).toBeLessThan(2.84);
  });

  test('lower targetHF → lower trigger price (fires later)', () => {
    const borrow = computeBorrowUsdt0({ supplyUBA: SUPPLY, fxrpPriceUSD: 2.84, collateralFactor: 0.7, borrowRatio: 0.3 });
    const common = { supplyUBA: SUPPLY, borrowUsdt0Base: borrow.borrowUsdt0Base, collateralFactor: 0.7 };
    const t11 = computeTriggerPrice({ ...common, targetHF: 1.1 });
    const t12 = computeTriggerPrice({ ...common, targetHF: 1.2 });
    expect(t11.triggerPriceUSD).toBeLessThan(t12.triggerPriceUSD);
  });
});

describe('KineticIsoMath — computeRepayToRestoreHF (A1 protection, Cable 2)', () => {
  // The E1 position: 19.6803 FXRP collateral, ~11.7373 USDT0 debt (30% of capacity
  // at $2.84, CF 0.7). Entry HF ≈ 3.33.
  const borrow = computeBorrowUsdt0({ supplyUBA: SUPPLY, fxrpPriceUSD: 2.84, collateralFactor: 0.7, borrowRatio: 0.3 });
  const DEBT = borrow.borrowUsdt0Base;

  test('at the trigger price the repay restores HF to exactly targetHF', () => {
    // trigger price where HF == 1.1 (from computeTriggerPrice)
    const t = computeTriggerPrice({ supplyUBA: SUPPLY, borrowUsdt0Base: DEBT, collateralFactor: 0.7, targetHF: 1.1 });
    const r = computeRepayToRestoreHF({
      supplyUBA: SUPPLY,
      debtUsdt0Base: DEBT,
      fxrpPriceUSD: t.triggerPriceUSD * 0.98, // dropped just below trigger → HF < 1.1
      collateralFactor: 0.7,
      targetHF: 1.1,
    });
    expect(r.needed).toBe(true);
    expect(r.repayUsdt0Base).toBeGreaterThan(0n);
    expect(r.repayUsdt0Base).toBeLessThanOrEqual(DEBT);
    // HF after the repay (debt reduced) is ≥ target (ceil never leaves it below).
    const remainingHuman = Number(r.remainingDebtBase) / 1e6;
    const C = Number(SUPPLY) / 1e6;
    const hfAfter = remainingHuman > 0
      ? (C * (t.triggerPriceUSD * 0.98) * 0.7) / remainingHuman
      : Infinity;
    expect(hfAfter).toBeGreaterThanOrEqual(1.1 - 1e-6);
  });

  test('when HF already ≥ target, nothing to repay', () => {
    const r = computeRepayToRestoreHF({
      supplyUBA: SUPPLY,
      debtUsdt0Base: DEBT,
      fxrpPriceUSD: 2.84, // entry price → HF ≈ 3.33 ≫ 1.1
      collateralFactor: 0.7,
      targetHF: 1.1,
    });
    expect(r.needed).toBe(false);
    expect(r.repayUsdt0Base).toBe(0n);
    expect(r.remainingDebtBase).toBe(DEBT);
    expect(r.currentHF).toBeGreaterThan(3);
  });

  test('deep crash repays most of the debt, never over-repays, remainder sits at target HF', () => {
    const r = computeRepayToRestoreHF({
      supplyUBA: SUPPLY,
      debtUsdt0Base: DEBT,
      fxrpPriceUSD: 0.5, // severe drop → most of the debt must be repaid
      collateralFactor: 0.7,
      targetHF: 1.1,
    });
    expect(r.needed).toBe(true);
    // A substantial partial repay, never over the outstanding debt.
    expect(r.repayUsdt0Base).toBeGreaterThan(DEBT / 3n);
    expect(r.repayUsdt0Base).toBeLessThan(DEBT);
    expect(r.remainingDebtBase).toBe(DEBT - r.repayUsdt0Base);
    // The debt left behind is exactly what the crashed collateral supports at target HF.
    const remainingHuman = Number(r.remainingDebtBase) / 1e6;
    const C = Number(SUPPLY) / 1e6;
    const hfAfter = (C * 0.5 * 0.7) / remainingHuman;
    expect(hfAfter).toBeCloseTo(1.1, 1);
  });

  test('rejects bad inputs', () => {
    const ok = { supplyUBA: SUPPLY, debtUsdt0Base: DEBT, fxrpPriceUSD: 1, collateralFactor: 0.7, targetHF: 1.1 };
    expect(() => computeRepayToRestoreHF({ ...ok, supplyUBA: 0n })).toThrow(/SUPPLY/);
    expect(() => computeRepayToRestoreHF({ ...ok, debtUsdt0Base: 0n })).toThrow(/DEBT/);
    expect(() => computeRepayToRestoreHF({ ...ok, fxrpPriceUSD: 0 })).toThrow(/PRICE/);
    expect(() => computeRepayToRestoreHF({ ...ok, collateralFactor: 1.5 })).toThrow(/CF/);
    expect(() => computeRepayToRestoreHF({ ...ok, targetHF: 0 })).toThrow(/HF/);
  });
});

describe('KineticIsoMath — computeDeriskShortfall (DERISK carry spread, M7)', () => {
  test('debt outgrew the supply (borrow>supply spread) → shortfall is the difference', () => {
    // Full repay of 11.79 USDT0 but the supply withdrawal only yielded 11.70.
    const r = computeDeriskShortfall({ repayUsdt0Base: 11_790_000n, withdrawableUsdt0Base: 11_700_000n });
    expect(r.shortfallUsdt0Base).toBe(90_000n);
    expect(r.shortfallUsdt0Human).toBeCloseTo(0.09, 6);
    expect(r.coveredByWithdraw).toBe(false);
  });

  test('withdrawal covers the repay exactly → shortfall 0', () => {
    const r = computeDeriskShortfall({ repayUsdt0Base: 11_700_000n, withdrawableUsdt0Base: 11_700_000n });
    expect(r.shortfallUsdt0Base).toBe(0n);
    expect(r.coveredByWithdraw).toBe(true);
  });

  test('withdrawal exceeds the repay → shortfall clamps to 0, never negative', () => {
    const r = computeDeriskShortfall({ repayUsdt0Base: 11_700_000n, withdrawableUsdt0Base: 12_000_000n });
    expect(r.shortfallUsdt0Base).toBe(0n);
    expect(r.coveredByWithdraw).toBe(true);
  });

  test('nothing withdrawn yet → the whole repay is the shortfall', () => {
    const r = computeDeriskShortfall({ repayUsdt0Base: 11_790_000n, withdrawableUsdt0Base: 0n });
    expect(r.shortfallUsdt0Base).toBe(11_790_000n);
    expect(r.coveredByWithdraw).toBe(false);
  });

  test('rejects bad inputs', () => {
    expect(() => computeDeriskShortfall({ repayUsdt0Base: 0n, withdrawableUsdt0Base: 1n })).toThrow(/REPAY/);
    expect(() => computeDeriskShortfall({ repayUsdt0Base: 1n, withdrawableUsdt0Base: -1n })).toThrow(/WITHDRAWABLE/);
  });
});

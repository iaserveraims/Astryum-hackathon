import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBaseUnits, tryParseBaseUnits } from '../baseUnits';

/**
 * F4 doctrine — what a quorum signs must say the truth, exactly.
 *
 * Two failures of the same family (2026-08-03): a governed payment built its
 * drops with `Math.round(x * 1_000_000)` on a float (0.0000001 XRP passed the
 * "> 0" check and became a payment of ZERO drops), and the review screen
 * promised a "1-drop Payment" while the order fee made it 200,001 drops.
 *
 * Both are pinned at the SOURCE, the way `consumers-wired` pins the settlement
 * cable: the maths is easy to reintroduce by hand, and by the time it shows up
 * the transaction is already signed.
 */

const SRC = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

const XRP_DECIMALS = 6;

describe('governed amounts are exact, never floats', () => {
  it('an over-precise amount is REFUSED, never silently rounded to zero', () => {
    // The old `Math.round(0.0000001 * 1e6)` produced 0 drops for an amount the
    // person had typed and the "> 0" guard had accepted.
    expect(Math.round(0.0000001 * 1_000_000)).toBe(0); // the bug, for the record
    expect(tryParseBaseUnits('0.0000001', XRP_DECIMALS)).toBeNull();
  });

  it('drops are computed exactly for the amounts a family actually types', () => {
    expect(parseBaseUnits('0.2', XRP_DECIMALS)).toBe(BigInt(200000));
    expect(parseBaseUnits('1', XRP_DECIMALS)).toBe(BigInt(1000000));
    expect(parseBaseUnits('12,5', XRP_DECIMALS)).toBe(BigInt(12500000)); // Spanish comma
  });

  it('GovernedMoneyFlows builds drops with the exact helper, not float maths', () => {
    const src = read('components/legacy/GovernedMoneyFlows.tsx');
    expect(src).toMatch(/parseBaseUnits\(amountXrp, XRP_DECIMALS\)/);
    expect(src).not.toMatch(/\*\s*1_000_000/);
  });

  it('the council review screen reads the amount from the composed tx', () => {
    const src = read('components/legacy/CouncilOrderCard.tsx');
    // No hardcoded promise about what the Payment costs…
    expect(src).not.toMatch(/1-drop Payment/);
    // …it is derived from the transaction the quorum is about to sign.
    expect(src).toMatch(/orderPaymentXrp\(handoff\)/);
    expect(src).toMatch(/handoff\.xrplTx as \{ Amount\?: unknown \}/);
  });

  it('the disclosure labels the council-order facts instead of showing camelCase', () => {
    const src = read('components/legacy/LegacyPanel.tsx');
    for (const key of ['serviceFee', 'orderNonce', 'orderHash', 'constitutionRef', 'settlementLatency']) {
      expect(src).toMatch(new RegExp(`\\b${key}: t\\(`));
    }
  });
});

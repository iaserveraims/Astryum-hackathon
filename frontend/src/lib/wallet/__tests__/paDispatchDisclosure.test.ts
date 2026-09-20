import { describe, expect, it } from 'vitest';
import {
  assetChoiceVerdict,
  astryumFeeRow,
  fillFeeText,
  paDispatchNetworkFee,
  parseNetworkBalance,
  parsePaFxrpRead,
  paUnmintNetworkFee,
  paUnmintReturn,
  paUnmintReturnRow,
  readPaDispatchFees,
  readRidesOwnMint,
  redemptionFeeRow,
} from '../paDispatchDisclosure';

/**
 * The Send/Unmint modal showed «Astryum fee 0» and «net cost ≈ 0.3 XRP» made up
 * on the client, and a failed Smart Account balance read became 0 and forced the
 * asset to XRP. These fail the day a figure is invented or «could not read»
 * becomes «nothing».
 */

// Shape of flareDemo.ts pa-unmint/prepare → disclosure (…mintFeeDisclosure(net)).
const backendUnmint = {
  action: 'pa-unmint',
  fxrpRedeemed: 12,
  mintCoupledXrp: 1.2,
  mintingFeeXrp: 0.0024,
  executorFeeXrp: 0.25,
  fxrpMintedSideEffect: 0.9476,
  redeemMinimumXrp: 5,
};

describe('readPaDispatchFees / paDispatchNetworkFee', () => {
  it('uses the server figures verbatim — never the old 0.3 XRP guess', () => {
    const fees = readPaDispatchFees(backendUnmint);
    expect(fees.known).toBe(true);
    const row = paDispatchNetworkFee(fees, 1);
    const text = fillFeeText(row.text, row.params);
    expect(text).toContain('1.2 XRP dispatch');
    expect(text).toContain('0.0024 XRP minting');
    expect(text).toContain('0.25 XRP executor');
    expect(text).toContain('= 0.2524 XRP');
    expect(text).toContain('0.9476 FXRP returns');
    expect(text).not.toContain('0.3');
  });

  it('missing figures say unavailable, not zero', () => {
    const fees = readPaDispatchFees({ mintCoupledXrp: 1 });
    expect(fees.known).toBe(false);
    const text = fillFeeText(paDispatchNetworkFee(fees, 2).text, paDispatchNetworkFee(fees, 2).params);
    expect(text).toMatch(/unavailable here, not zero/);
    expect(text).toContain('1 XRP dispatch');
    expect(readPaDispatchFees({ mintingFeeXrp: 'NaN', executorFeeXrp: Infinity }).known).toBe(false);
  });

  it('carrier falls back to the requested one only when the server did not echo it', () => {
    const row = paDispatchNetworkFee(readPaDispatchFees({}), 1.5);
    expect(row.params.carrier).toBe('1.5');
  });
});

describe('astryumFeeRow', () => {
  it('a stated figure wins; otherwise never 0', () => {
    expect(astryumFeeRow(readPaDispatchFees({ astryumFee: 0 }))).toEqual({ kind: 'stated', amount: 0 });
    expect(astryumFeeRow(readPaDispatchFees(backendUnmint))).toEqual({ kind: 'executor-listed' });
    expect(astryumFeeRow(readPaDispatchFees({}))).toEqual({ kind: 'unavailable' });
  });
});

describe('redemptionFeeRow', () => {
  it('a number only when the server sends one', () => {
    expect(redemptionFeeRow(readPaDispatchFees(backendUnmint)).text).toMatch(/could not be read/);
    expect(redemptionFeeRow(readPaDispatchFees(backendUnmint)).text).not.toMatch(/\b0\b/);
    const bips = redemptionFeeRow(readPaDispatchFees({ redemptionFeeBips: 20 }));
    expect(fillFeeText(bips.text, bips.params)).toMatch(/^0.2% of the amount/);
    const xrp = redemptionFeeRow(readPaDispatchFees({ redemptionFeeXrp: 0.024 }));
    expect(fillFeeText(xrp.text, xrp.params)).toMatch(/^0.024 XRP/);
  });

  it('redemptionFeeFxrp + bips render both numbers; FXRP alone renders the FXRP', () => {
    const both = redemptionFeeRow(readPaDispatchFees({ ...backendUnmint, redemptionFeeBips: 20, redemptionFeeFxrp: 0.024 }));
    expect(fillFeeText(both.text, both.params)).toMatch(/^0.024 FXRP \(0.2% of the amount\)/);
    const fx = redemptionFeeRow(readPaDispatchFees({ redemptionFeeFxrp: 0.5, redemptionFeeBips: null }));
    expect(fillFeeText(fx.text, fx.params)).toMatch(/^0.5 FXRP, deducted/);
  });

  it('explicit nulls are «could not be read», never 0', () => {
    const fees = readPaDispatchFees({ ...backendUnmint, redemptionFeeBips: null, redemptionFeeFxrp: null });
    expect(fees.redemptionFeeBips).toBeNull();
    expect(fees.redemptionFeeFxrp).toBeNull();
    expect(redemptionFeeRow(fees).text).toMatch(/could not be read/);
  });

  it('reads the figures from the top level of the response when the disclosure lacks them', () => {
    const fees = readPaDispatchFees(backendUnmint, { redemptionFeeBips: 25, redemptionFeeFxrp: 0.03 });
    expect(fees.redemptionFeeBips).toBe(25);
    expect(fees.redemptionFeeFxrp).toBe(0.03);
    // the disclosure wins when both carry one
    expect(readPaDispatchFees({ redemptionFeeBips: 10 }, { redemptionFeeBips: 99 }).redemptionFeeBips).toBe(10);
  });
});

describe('pa-unmint «Returns to your account»', () => {
  const unverified = { label: 'redeem 12 FXRP → native XRP', verdict: 'unverified', reason: 'depends on an earlier step of this same batch — cannot be dry-run in isolation' };

  it('readRidesOwnMint: explicit field first, then the redeem preflight step, else null', () => {
    expect(readRidesOwnMint({ ridesOwnMint: true })).toBe(true);
    expect(readRidesOwnMint({ disclosure: { ridesOwnMint: false }, preflight: { steps: [unverified] } })).toBe(false);
    expect(readRidesOwnMint({ preflight: { available: false, steps: [unverified] } })).toBe(true);
    expect(readRidesOwnMint({ preflight: { steps: [{ label: 'redeem 12 FXRP → native XRP', verdict: 'ok' }] } })).toBe(false);
    expect(readRidesOwnMint({ preflight: { steps: [{ label: 'redeem 12 FXRP → native XRP', verdict: 'fail', reason: 'x' }] } })).toBe(false);
    expect(readRidesOwnMint({ preflight: { available: false, reason: 'dry-run unavailable' } })).toBeNull();
    expect(readRidesOwnMint({})).toBeNull();
    expect(readRidesOwnMint(null)).toBeNull();
  });

  it('readRidesOwnMint (4.4): the backend disclosure.ridesOwnMint wins over the top level and over the preflight text', () => {
    const okStep = { label: 'redeem 12 FXRP → native XRP', verdict: 'ok' };
    // backend says it rides the mint although the preflight text would say «covered»
    expect(readRidesOwnMint({ disclosure: { ridesOwnMint: true }, preflight: { steps: [okStep] } })).toBe(true);
    // backend says covered although the preflight text would say «rides»
    expect(readRidesOwnMint({ disclosure: { ridesOwnMint: false }, preflight: { steps: [unverified] } })).toBe(false);
    // disclosure beats a contradicting top-level field
    expect(readRidesOwnMint({ ridesOwnMint: true, disclosure: { ridesOwnMint: false } })).toBe(false);
    // a non-boolean in the disclosure is not an answer: top level, then the preflight fallback
    expect(readRidesOwnMint({ ridesOwnMint: false, disclosure: { ridesOwnMint: 'yes' } })).toBe(false);
    expect(readRidesOwnMint({ disclosure: { ridesOwnMint: null }, preflight: { steps: [unverified] } })).toBe(true);
    expect(readRidesOwnMint({ disclosure: { ridesOwnMint: 1 } })).toBeNull();
  });

  it('free FXRP covers the redemption → the minted FXRP returns', () => {
    const r = paUnmintReturn({ mintedFxrp: 0.9476, redeemedFxrp: 5, ridesOwnMint: false, freeFxrp: null });
    expect(r).toEqual({ kind: 'returns', fxrp: 0.9476 });
    expect(fillFeeText(paUnmintReturnRow(r, 0.9476).text, paUnmintReturnRow(r, 0.9476).params)).toBe('≈ 0.9476 FXRP');
  });

  it('rides the mint with a known free balance → what is left, or nothing', () => {
    expect(paUnmintReturn({ mintedFxrp: 1, redeemedFxrp: 5.5, ridesOwnMint: true, freeFxrp: 5 })).toEqual({ kind: 'partial', fxrp: 0.5 });
    const none = paUnmintReturn({ mintedFxrp: 1, redeemedFxrp: 6, ridesOwnMint: true, freeFxrp: 5 });
    expect(none).toEqual({ kind: 'none' });
    const row = paUnmintReturnRow(none, 1);
    expect(fillFeeText(row.text, row.params)).toMatch(/^Nothing — the ≈ 1 FXRP this dispatch mints is burned/);
  });

  it('rides the mint with no free balance read → «not in full», never a return figure', () => {
    const r = paUnmintReturn({ mintedFxrp: 0.9476, redeemedFxrp: 12, ridesOwnMint: true, freeFxrp: null });
    expect(r).toEqual({ kind: 'consumed' });
    const text = fillFeeText(paUnmintReturnRow(r, 0.9476).text, paUnmintReturnRow(r, 0.9476).params);
    expect(text).toMatch(/^Not in full/);
    expect(text).not.toMatch(/^≈/);
  });

  it('nothing read → unknown (derived from free FXRP when that is all there is)', () => {
    expect(paUnmintReturn({ mintedFxrp: 1, redeemedFxrp: 5, ridesOwnMint: null, freeFxrp: null })).toEqual({ kind: 'unknown' });
    expect(paUnmintReturn({ mintedFxrp: null, redeemedFxrp: 5, ridesOwnMint: false, freeFxrp: 9 })).toEqual({ kind: 'unknown' });
    expect(paUnmintReturn({ mintedFxrp: 1, redeemedFxrp: 3, ridesOwnMint: null, freeFxrp: 9 })).toEqual({ kind: 'returns', fxrp: 1 });
    expect(paUnmintReturn({ mintedFxrp: 1, redeemedFxrp: 10, ridesOwnMint: null, freeFxrp: 9 })).toEqual({ kind: 'none' });
    expect(paUnmintReturnRow({ kind: 'unknown' }, 1).text).toMatch(/^Could not be determined/);
  });

  it('the network-fee sentence stops saying the minted FXRP returns when it does not', () => {
    const fees = readPaDispatchFees(backendUnmint);
    const burned = paUnmintNetworkFee(fees, 1, { kind: 'consumed' });
    const text = fillFeeText(burned.text, burned.params);
    expect(text).toContain('= 0.2524 XRP');
    expect(text).not.toMatch(/FXRP returns to your account/);
    expect(paUnmintNetworkFee(fees, 1, { kind: 'returns', fxrp: 0.9476 })).toEqual(paDispatchNetworkFee(fees, 1));
  });
});

describe('parseNetworkBalance', () => {
  it('ok body → value; anything else → failed (never 0)', () => {
    expect(parseNetworkBalance(true, { ok: true, balance: '3.5' })).toEqual({ status: 'ok', value: 3.5, raw: '3.5' });
    expect(parseNetworkBalance(true, { ok: true, balance: '0' })).toEqual({ status: 'ok', value: 0, raw: '0' });
    expect(parseNetworkBalance(false, { ok: true, balance: '3' })).toEqual({ status: 'failed' });
    expect(parseNetworkBalance(true, { ok: false })).toEqual({ status: 'failed' });
    expect(parseNetworkBalance(true, null)).toEqual({ status: 'failed' });
    expect(parseNetworkBalance(true, { ok: true, balance: 'abc' })).toEqual({ status: 'failed' });
  });
});

describe('assetChoiceVerdict', () => {
  const ok = (value: number) => ({ status: 'ok' as const, value, raw: String(value) });
  it('XRP is never blocked', () => {
    expect(assetChoiceVerdict('XRP', { status: 'failed' }, { status: 'failed' })).toEqual({ forceXrp: false, blocked: null });
  });
  it('a PROVEN zero returns to XRP; a failed or pending read blocks instead of sliding to XRP', () => {
    expect(assetChoiceVerdict('FXRP', ok(0), ok(1))).toEqual({ forceXrp: true, blocked: null });
    expect(assetChoiceVerdict('FXRP', ok(2), ok(0))).toEqual({ forceXrp: false, blocked: null });
    expect(assetChoiceVerdict('FXRP', { status: 'failed' }, ok(1))).toEqual({ forceXrp: false, blocked: 'failed' });
    expect(assetChoiceVerdict('FLR', ok(1), { status: 'loading' })).toEqual({ forceXrp: false, blocked: 'loading' });
    expect(assetChoiceVerdict('FLR', ok(1), ok(0))).toEqual({ forceXrp: true, blocked: null });
  });
});

describe('parsePaFxrpRead', () => {
  it('reads freeFxrp + minimum; a failed HTTP or a body without freeFxrp is null', () => {
    expect(parsePaFxrpRead(true, { freeFxrp: 4, redeemMinimumXrp: 5 })).toEqual({ freeFxrp: 4, redeemMinimumXrp: 5 });
    expect(parsePaFxrpRead(true, { freeFxrp: 0, redeemMinimumXrp: null })).toEqual({ freeFxrp: 0, redeemMinimumXrp: null });
    expect(parsePaFxrpRead(false, { error: 'PA_FXRP_READ_FAILED' })).toBeNull();
    expect(parsePaFxrpRead(true, {})).toBeNull();
    expect(parsePaFxrpRead(true, null)).toBeNull();
  });
});

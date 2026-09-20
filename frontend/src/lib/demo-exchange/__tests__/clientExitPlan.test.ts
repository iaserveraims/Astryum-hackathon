import { describe, expect, it } from 'vitest';
import {
  EXCHANGE_EXIT_PROMISE,
  NO_WALLET_REASON,
  WINDOW_REASON,
  buildClientExitReview,
  buildVaultActionReview,
  effectiveExitTo,
  exitDestinationOptions,
  exitFeeStatement,
  fillParams,
  pickExitTo,
  redemptionFeeSentence,
  redemptionFeeStatement,
  vaultFeeSentence,
} from '../clientExitPlan';

/**
 * The exchange client's exit signed with Face ID after seeing only an estimate,
 * and on a pote with an exit window it offered «to my own XRPL wallet» that the
 * composition never used. These fail the day either comes back.
 */

const redeemSync = {
  disclosure: { title: 'Salida de Pote', lines: ['Fee de servicio de Astryum: 25 participaciones base (0.25%), visible y deducida en esta misma firma.', 'Salida inmediata'] },
  fee: { feeShares: '25', bps: 25, collector: '0xabc' },
};
const exitXrp = { disclosure: { title: 'Sacar a tu dirección XRPL', lines: ['El FXRP … con el tag 7'] } };

describe('exitDestinationOptions / pickExitTo', () => {
  it('a pote with an exit window offers only the Face ID account, with the reason', () => {
    const opts = exitDestinationOptions({ cooldownSeconds: 3600, hasOwnWallet: true });
    expect(opts.find((o) => o.key === 'exchange')).toMatchObject({ enabled: false, reason: WINDOW_REASON });
    expect(opts.find((o) => o.key === 'wallet')).toMatchObject({ enabled: false, reason: WINDOW_REASON });
    expect(opts.find((o) => o.key === 'keep')?.enabled).toBe(true);
    expect(pickExitTo('wallet', opts)).toBe('keep');
    expect(pickExitTo('exchange', opts)).toBe('keep');
  });

  it('an immediate pote offers all three; own wallet needs a wallet on file', () => {
    const withWallet = exitDestinationOptions({ cooldownSeconds: 0, hasOwnWallet: true });
    expect(withWallet.every((o) => o.enabled)).toBe(true);
    const noWallet = exitDestinationOptions({ cooldownSeconds: 0, hasOwnWallet: false });
    expect(noWallet.find((o) => o.key === 'wallet')).toMatchObject({ enabled: false, reason: NO_WALLET_REASON });
    expect(pickExitTo('wallet', noWallet)).toBe('exchange');
  });

  it('an unread policy (null) keeps every destination offered — the review reconciles', () => {
    const opts = exitDestinationOptions({ cooldownSeconds: null, hasOwnWallet: true });
    expect(opts.every((o) => o.enabled)).toBe(true);
  });
});

describe('effectiveExitTo', () => {
  it("'request' always lands in the Face ID account", () => {
    for (const c of ['exchange', 'wallet', 'keep'] as const) expect(effectiveExitTo('request', c)).toBe('keep');
    expect(effectiveExitTo('sync', 'wallet')).toBe('wallet');
  });
});

describe('exitFeeStatement', () => {
  it('object = charged, null = none composed, missing key = unavailable (never "none")', () => {
    expect(exitFeeStatement({ fee: { feeShares: '10', bps: 50 } })).toEqual({ kind: 'charged', feeShares: '10', bps: 50 });
    expect(exitFeeStatement({ fee: null })).toEqual({ kind: 'none' });
    expect(exitFeeStatement({})).toEqual({ kind: 'unavailable' });
    expect(exitFeeStatement({ fee: { bps: 'x' } })).toEqual({ kind: 'unavailable' });
  });
});

describe('buildClientExitReview', () => {
  it('immediate exit to the exchange shows BOTH backend disclosures, redeem first, and the fee tranche', () => {
    const r = buildClientExitReview({
      mode: 'sync',
      chosen: 'exchange',
      redeem: redeemSync,
      exitXrp,
      amounts: { estimate: '100', unminted: '99.75', margin: '0.25', symbol: 'FXRP' },
    });
    expect(r.disclosures.map((d) => d.title)).toEqual(['Salida de Pote', 'Sacar a tu dirección XRPL']);
    expect(r.fee).toEqual({ kind: 'charged', feeShares: '25', bps: 25 });
    expect(r.mentionsRedemptionFee).toBe(true);
    expect(r.destinationIgnored).toBe(false);
    expect(fillParams(r.headline, r.headlineParams)).toContain('99.75 FXRP');
    expect(r.headline).toMatch(/slot at the exchange/);
  });

  it('request mode: honest ticket statement, destination flagged as ignored, no unmint disclosure', () => {
    const r = buildClientExitReview({
      mode: 'request',
      chosen: 'wallet',
      redeem: { ...redeemSync, fee: null, maturityISO: '2026-09-20T00:00:00.000Z' },
      exitXrp,
      amounts: { estimate: '50', symbol: 'FXRP' },
    });
    expect(r.effective).toBe('keep');
    expect(r.destinationIgnored).toBe(true);
    expect(r.disclosures).toHaveLength(1);
    expect(r.mentionsRedemptionFee).toBe(false);
    expect(r.fee).toEqual({ kind: 'none' });
    const text = fillParams(r.headline, r.headlineParams);
    expect(text).toMatch(/burn now/);
    expect(text).toMatch(/fixed at ≈ 50 FXRP/);
    expect(text).toMatch(/claimable at maturity \(≈ 2026-09-20T00:00:00.000Z\) into your Flare account/);
    expect(text).not.toMatch(/XRPL wallet|slot at the exchange/);
  });

  it('keep: no unmint, no redemption-fee mention, FXRP in the Face ID account', () => {
    const r = buildClientExitReview({ mode: 'sync', chosen: 'keep', redeem: redeemSync, exitXrp, amounts: { estimate: '10', symbol: 'FXRP' } });
    expect(r.disclosures).toHaveLength(1);
    expect(r.mentionsRedemptionFee).toBe(false);
    expect(r.headline).toMatch(/as FXRP in your Face ID account/);
  });
});

describe('EXCHANGE_EXIT_PROMISE', () => {
  it('is true for both policies and never promises an XRPL wallet unconditionally', () => {
    expect(EXCHANGE_EXIT_PROMISE).toMatch(/without an exit window/);
    expect(EXCHANGE_EXIT_PROMISE).toMatch(/fixed in FXRP/);
    expect(EXCHANGE_EXIT_PROMISE).not.toMatch(/Nobody can stop it\./);
  });

  it('never says the XRP comes back in the signature: the FAssets agent pays it, minutes to hours later', () => {
    expect(EXCHANGE_EXIT_PROMISE).toMatch(/nobody has to approve it/);
    expect(EXCHANGE_EXIT_PROMISE).not.toMatch(/comes back in that signature/);
    expect(EXCHANGE_EXIT_PROMISE).toMatch(/when the FAssets agent pays it — minutes to hours later/);
  });

  it('promises only the fees Astryum composes, and the redemption fee only when it can be read', () => {
    expect(EXCHANGE_EXIT_PROMISE).not.toMatch(/Every fee/);
    expect(EXCHANGE_EXIT_PROMISE).toMatch(/fees Astryum composes are shown before you sign/);
    expect(EXCHANGE_EXIT_PROMISE).toMatch(/redemption fee when it can be read/);
  });
});

describe('redemptionFeeStatement / redemptionFeeSentence', () => {
  it('a number when bips and/or FXRP were read (top level or disclosure)', () => {
    expect(redemptionFeeStatement({ redemptionFeeBips: 20, redemptionFeeFxrp: 0.024 })).toEqual({ kind: 'figure', fxrp: '0.024', pct: '0.2' });
    expect(redemptionFeeStatement({ disclosure: { title: 'x', lines: [], redemptionFeeBips: 25, redemptionFeeFxrp: null } })).toEqual({ kind: 'figure', fxrp: null, pct: '0.25' });
    expect(redemptionFeeStatement({ redemptionFeeFxrp: '0.5' })).toEqual({ kind: 'figure', fxrp: '0.5', pct: null });
    const s = redemptionFeeSentence(redemptionFeeStatement({ redemptionFeeBips: 20, redemptionFeeFxrp: 0.024 }));
    expect(fillParams(s.text, s.params)).toBe('FAssets redemption fee: 0.024 FXRP (0.2% of the amount), deducted from the XRP the agent pays.');
  });

  it('null / missing / garbage is «could not be read» — never 0', () => {
    for (const r of [{ redemptionFeeBips: null, redemptionFeeFxrp: null }, {}, null, { redemptionFeeBips: 'abc' }, { redemptionFeeFxrp: Number.NaN }]) {
      expect(redemptionFeeStatement(r)).toEqual({ kind: 'unreadable' });
    }
    const s = redemptionFeeSentence({ kind: 'unreadable' });
    expect(s.text).toMatch(/could not be read/);
    expect(s.text).not.toMatch(/\b0\b/);
  });

  it('the figure as pote-exit-xrp/prepare returns it (inside `disclosure`) reaches the review — never «not returned»', () => {
    const r = buildClientExitReview({
      mode: 'sync',
      chosen: 'exchange',
      redeem: redeemSync,
      exitXrp: { disclosure: { ...exitXrp.disclosure, redemptionFeeBips: 18, redemptionFeeFxrp: 0.018 } as unknown as typeof exitXrp.disclosure },
      amounts: { estimate: '10', unminted: '9.975', margin: '0.025', symbol: 'FXRP' },
    });
    expect(r.mentionsRedemptionFee).toBe(true);
    expect(r.redemptionFee).toEqual({ kind: 'figure', fxrp: '0.018', pct: '0.18' });
    const s = redemptionFeeSentence(r.redemptionFee!);
    expect(s.params).toEqual({ fxrp: '0.018', pct: '0.18' });
    expect(s.text).not.toMatch(/does not return/);
  });

  it('buildClientExitReview carries it for an unmint only', () => {
    const withFee = buildClientExitReview({
      mode: 'sync',
      chosen: 'exchange',
      redeem: redeemSync,
      exitXrp: { ...exitXrp, redemptionFeeBips: 20, redemptionFeeFxrp: 0.2 },
      amounts: { estimate: '100', unminted: '99.75', margin: '0.25', symbol: 'FXRP' },
    });
    expect(withFee.redemptionFee).toEqual({ kind: 'figure', fxrp: '0.2', pct: '0.2' });
    const noFigure = buildClientExitReview({ mode: 'sync', chosen: 'wallet', redeem: redeemSync, exitXrp, amounts: { estimate: '1', symbol: 'FXRP' } });
    expect(noFigure.redemptionFee).toEqual({ kind: 'unreadable' });
    const keep = buildClientExitReview({ mode: 'sync', chosen: 'keep', redeem: redeemSync, exitXrp, amounts: { estimate: '1', symbol: 'FXRP' } });
    expect(keep.redemptionFee).toBeNull();
  });
});

describe('buildVaultActionReview (UserVaultPanel)', () => {
  it('redeem sync: the backend disclosure and the Astryum fee tranche, before Face ID', () => {
    const r = buildVaultActionReview({ verb: 'redeem', response: { mode: 'sync', calls: [], ...redeemSync }, amount: '99.75', symbol: 'FXRP' });
    expect(r.disclosures.map((d) => d.title)).toEqual(['Salida de Pote']);
    expect(r.fee).toEqual({ kind: 'charged', feeShares: '25', bps: 25 });
    expect(r.redemptionFee).toBeNull();
    expect(fillParams(r.headline, r.headlineParams)).toMatch(/≈ 99.75 FXRP lands as FXRP in your Face ID account/);
    const s = vaultFeeSentence('redeem', r.fee);
    expect(fillParams(s.text, s.params)).toMatch(/0.25% of your shares \(25 base shares\)/);
  });

  it('redeem request: the ticket with its maturity; fee null = none composed; a missing fee key = unavailable', () => {
    const r = buildVaultActionReview({ verb: 'redeem', response: { mode: 'request', fee: null, maturityISO: '2026-09-20T00:00:00.000Z', disclosure: redeemSync.disclosure }, amount: '50', symbol: 'FXRP' });
    expect(fillParams(r.headline, r.headlineParams)).toMatch(/claimable at maturity \(≈ 2026-09-20T00:00:00.000Z\) into your Face ID account/);
    expect(r.fee).toEqual({ kind: 'none' });
    expect(vaultFeeSentence('redeem', r.fee).text).toBe('Astryum service fee: none composed in this exit.');
    expect(buildVaultActionReview({ verb: 'redeem', response: { mode: 'sync' }, amount: '1', symbol: 'FXRP' }).fee).toEqual({ kind: 'unavailable' });
  });

  it('unmint: says the XRP arrives when the agent pays, and reads the redemption fee (or says it could not)', () => {
    const r = buildVaultActionReview({ verb: 'unmint', response: { ...exitXrp, redemptionFeeBips: 20, redemptionFeeFxrp: 0.02 }, amount: '10', symbol: 'FXRP', destination: 'rOmnibus' });
    const text = fillParams(r.headline, r.headlineParams);
    expect(text).toMatch(/Burns 10 FXRP/);
    expect(text).toMatch(/minutes to hours later, not in this signature/);
    expect(text).toContain('rOmnibus');
    expect(r.disclosures).toHaveLength(1);
    expect(r.redemptionFee).toEqual({ kind: 'figure', fxrp: '0.02', pct: '0.2' });
    // pote-exit-xrp states no `fee` key: unavailable, never «none»
    expect(r.fee).toEqual({ kind: 'unavailable' });
    const unread = buildVaultActionReview({ verb: 'unmint', response: { ...exitXrp, redemptionFeeBips: null, redemptionFeeFxrp: null }, amount: '10', symbol: 'FXRP', destination: 'r' });
    expect(unread.redemptionFee).toEqual({ kind: 'unreadable' });
  });

  it('deposit / send: composed in the browser, no fee leg, no redemption fee', () => {
    const dep = buildVaultActionReview({ verb: 'deposit', amount: '5', symbol: 'FXRP' });
    expect(dep.fee).toEqual({ kind: 'none' });
    expect(dep.disclosures).toEqual([]);
    expect(dep.redemptionFee).toBeNull();
    expect(vaultFeeSentence('deposit', dep.fee).text).toMatch(/composed in this browser and carry no fee leg/);
    const send = buildVaultActionReview({ verb: 'send', amount: '5', symbol: 'FXRP', destination: '0xabc' });
    expect(fillParams(send.headline, send.headlineParams)).toBe('Sends 5 FXRP from your Face ID account to 0xabc on Flare.');
  });
});

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { fillFeeText } from '../../wallet/paDispatchDisclosure';
import {
  exitRedemption,
  exitXrpOut,
  readRedemptionFeeFigures,
  redemptionFeeRows,
  redemptionFeeView,
  redemptionOf,
  REDEMPTION_ARRIVAL_TEXT,
} from '../redemptionFeeRow';
import { RedemptionFeeNotice } from '../RedemptionFeeNotice';

/**
 * Finding 4.2: seven surfaces unminted without the FAssets
 * redemption fee, and some promised a GROSS «≈ X XRP». These fail the day a
 * surface shows a figure nobody read, calls «not read» zero, or promises the
 * gross as what arrives.
 */

const say = (f: { text: string; params: Record<string, string> }) => fillFeeText(f.text, f.params);
const t = (s: string) => s;

// Mainnet today: redemptionFeeBIPS = 18 (read live by the backend).
const MAINNET_BIPS = 18;

describe('readRedemptionFeeFigures', () => {
  it('reads disclosure first, then the top level, then disclosure.facts', () => {
    expect(readRedemptionFeeFigures({ disclosure: { redemptionFeeBips: 18, redemptionFeeFxrp: 0.018 } })).toEqual({ bips: 18, fxrp: 0.018 });
    expect(readRedemptionFeeFigures({ redemptionFeeBips: 18, redemptionFeeFxrp: 0.5, disclosure: {} })).toEqual({ bips: 18, fxrp: 0.5 });
    expect(readRedemptionFeeFigures({ disclosure: { redemptionFeeBips: 10 }, redemptionFeeBips: 99 }).bips).toBe(10);
    expect(readRedemptionFeeFigures({ disclosure: { facts: { redemptionFeeBips: 18, redemptionFeeFxrp: 0.1 } } })).toEqual({ bips: 18, fxrp: 0.1 });
  });

  it('null, absent, NaN, strings and negatives are not figures', () => {
    for (const r of [
      null,
      undefined,
      {},
      { disclosure: { redemptionFeeBips: null, redemptionFeeFxrp: null } },
      { redemptionFeeBips: Number.NaN },
      { redemptionFeeBips: '18' },
      { disclosure: { redemptionFeeBips: -1, redemptionFeeFxrp: -0.1 } },
    ]) {
      expect(readRedemptionFeeFigures(r)).toEqual({ bips: null, fxrp: null });
    }
  });
});

describe('redemptionFeeView / redemptionFeeRows', () => {
  it('figure: 0.18% ≈ X FXRP, and the amount is the NET of the fee', () => {
    const rows = redemptionFeeRows({ disclosure: { redemptionFeeBips: MAINNET_BIPS, redemptionFeeFxrp: 0.018 } }, 10);
    expect(rows.kind).toBe('figure');
    expect(say(rows.fee)).toBe('FAssets redemption fee: 0.18% ≈ 0.018 FXRP, paid out of the XRP the agent sends');
    expect(say(rows.amount!)).toBe('≈ 9.982 XRP after the redemption fee');
    expect(say(rows.arrival)).toMatch(/FAssets agent pays it — minutes to hours/);
  });

  it('bips only: the FXRP share is derived from the gross, never invented without one', () => {
    const v = redemptionFeeView({ redemptionFeeBips: MAINNET_BIPS }, 50);
    expect(v).toEqual({ kind: 'figure', bips: 18, feeFxrp: 0.09, netXrp: 49.91, grossFxrp: 50 });
    const noGross = redemptionFeeRows({ redemptionFeeBips: MAINNET_BIPS }, null);
    expect(say(noGross.fee)).toBe('FAssets redemption fee: 0.18% of the amount, paid out of the XRP the agent sends');
    expect(noGross.amount).toBeNull();
  });

  it('FXRP only: the figure without a percentage', () => {
    const rows = redemptionFeeRows({ disclosure: { redemptionFeeBips: null, redemptionFeeFxrp: 0.2 } }, 100);
    expect(say(rows.fee)).toBe('FAssets redemption fee: ≈ 0.2 FXRP, paid out of the XRP the agent sends');
    expect(say(rows.amount!)).toBe('≈ 99.8 XRP after the redemption fee');
  });

  it('unreadable: «could not be read — it is not zero», the gross keeps its caveat, never a 0', () => {
    const rows = redemptionFeeRows({ disclosure: { redemptionFeeBips: null, redemptionFeeFxrp: null } }, 12);
    expect(rows.kind).toBe('unreadable');
    expect(say(rows.fee)).toBe('FAssets redemption fee: could not be read — it is not zero');
    expect(say(rows.amount!)).toBe('≈ 12 XRP before the redemption fee, which could not be read');
    expect(say(rows.fee)).not.toMatch(/\b0(\.0+)?\s*(%|FXRP|XRP)/);
    expect(say(rows.amount!)).not.toMatch(/after the redemption fee/);
    expect(redemptionFeeRows({}, null).amount).toBeNull();
  });

  it('the net never goes below zero', () => {
    expect(redemptionFeeView({ redemptionFeeFxrp: 5 }, 1)).toMatchObject({ kind: 'figure', netXrp: 0 });
  });
});

/* ── the prepare shape of every surface that unmints ───────────────────────── */

// institutional.ts /pote-exit/prepare (unmint) — PoteExitCard, VaultEntryModal exit
const poteExit = {
  mode: 'sync',
  unminted: true,
  exit: { sharesHuman: '10', xrpOutHuman: '9.95', unmintUBA: '9950000', marginUBA: '50000', marginBps: 50, partial: false },
  disclosure: { title: 'x', lines: [], redemptionFeeBips: 18, redemptionFeeFxrp: 0.01791, facts: {} },
};
// institutional.ts /pote-claim-exit/prepare (unmint) — TicketsBoard, VaultEntryModal claim
const poteClaimExit = { ...poteExit, mode: 'claim', unminted: true };
const poteExitFxrp = { ...poteExit, mode: 'sync-fxrp', unminted: false };
// flareDemo.ts /pa-withdraw-transfer/prepare with unmintToXrpl — PaActionsModal unmint / DERISK to XRPL
const paWithdrawUnmint = {
  rail: 'xrpl',
  disclosure: { action: 'withdraw-fxrp-unmint', amount: 20, xrplDestination: 'rOwner', fxrpRedeemed: 20.9476, redemptionFeeBips: 18, redemptionFeeFxrp: 0.037706 },
};
// flareDemo.ts /vault-claim/prepare with unmintToXrpl — VaultClaimModal
const vaultClaimXrpl = { rail: 'xrpl', disclosure: { fxrpQueued: 30, fxrpRedeemed: 30.9476, xrplDestination: 'rOwner' } };
const vaultClaimPa = { rail: 'xrpl', disclosure: { fxrpQueued: 30, mintCoupledXrp: 1 } };
// walletTransfer.ts /bridge/flare-to-xrpl/prepare — WalletTransferModals redeem, PaActionsModal EVM unmint
const bridgeRedeem = { rail: 'evm', calls: [], disclosure: { action: 'bridge-redeem-fxrp', amount: 25, redemptionFeeBips: 18, redemptionFeeFxrp: 0.045 } };
const evmUnmintPosition = { rail: 'evm', calls: [], disclosure: { action: 'unmint-position', amount: 7, redemptionFeeBips: null, redemptionFeeFxrp: null } };
// xrplDefi.ts /vault-yield/claim/prepare — LegacyYieldPanel
const legacyYieldClaim = { claimable: '4000000', claimableHuman: '4', redeemUBA: '4947600', destination: 'rHeir', disclosure: { note: 'n', facts: {} } };
// flareDemo.ts /pa-repay/prepare — no redemption at all
const paRepay = { rail: 'xrpl', disclosure: { repayUsdt0: 3, mintCoupledXrp: 1 } };

describe('redemptionOf — per surface', () => {
  it('detects the redemption and its gross from what each route composed', () => {
    expect(redemptionOf(poteExit)).toEqual({ redeems: true, grossFxrp: 9.95 });
    expect(redemptionOf(poteClaimExit)).toEqual({ redeems: true, grossFxrp: 9.95 });
    expect(redemptionOf(poteExitFxrp)).toEqual({ redeems: false, grossFxrp: null });
    expect(redemptionOf(paWithdrawUnmint)).toEqual({ redeems: true, grossFxrp: 20.9476 });
    expect(redemptionOf(vaultClaimXrpl)).toEqual({ redeems: true, grossFxrp: 30.9476 });
    expect(redemptionOf(vaultClaimPa)).toEqual({ redeems: false, grossFxrp: null });
    expect(redemptionOf(bridgeRedeem)).toEqual({ redeems: true, grossFxrp: 25 });
    expect(redemptionOf(evmUnmintPosition)).toEqual({ redeems: true, grossFxrp: 7 });
    expect(redemptionOf(legacyYieldClaim)).toEqual({ redeems: true, grossFxrp: 4.9476 });
    expect(redemptionOf(paRepay)).toEqual({ redeems: false, grossFxrp: null });
    expect(redemptionOf(null)).toEqual({ redeems: false, grossFxrp: null });
  });

  it('a backend that has not shipped the figures yet → «could not be read», on every surface', () => {
    for (const r of [vaultClaimXrpl, evmUnmintPosition, legacyYieldClaim]) {
      expect(redemptionFeeRows(r, redemptionOf(r).grossFxrp).kind).toBe('unreadable');
    }
  });
});

describe('RedemptionFeeNotice — rendered before the signing button', () => {
  const render = (response: unknown, grossFxrp: number | null, showAmount = false) =>
    renderToStaticMarkup(createElement(RedemptionFeeNotice, { response, grossFxrp, t, showAmount }));

  it('pote exit (PoteExitCard / VaultEntryModal): figure + arrival, amber-free', () => {
    const html = render(poteExit, redemptionOf(poteExit).grossFxrp);
    expect(html).toContain('data-redemption-fee="figure"');
    expect(html).toContain('FAssets redemption fee: 0.18% ≈ 0.01791 FXRP, paid out of the XRP the agent sends');
    expect(html).toContain(REDEMPTION_ARRIVAL_TEXT);
    expect(html).not.toContain('border-amber-500');
  });

  it('wallet-transfer redeem (WalletTransferModals): the net amount line when asked', () => {
    const html = render(bridgeRedeem, redemptionOf(bridgeRedeem).grossFxrp, true);
    expect(html).toContain('≈ 24.955 XRP after the redemption fee');
  });

  it('vault claim to XRPL (VaultClaimModal) without figures: amber, «not zero», no net promise', () => {
    const html = render(vaultClaimXrpl, redemptionOf(vaultClaimXrpl).grossFxrp, true);
    expect(html).toContain('data-redemption-fee="unreadable"');
    expect(html).toContain('border-amber-500');
    expect(html).toContain('FAssets redemption fee: could not be read — it is not zero');
    expect(html).toContain('≈ 30.9476 XRP before the redemption fee, which could not be read');
    expect(html).not.toContain('after the redemption fee');
  });

  it('Legacy yield claim: the gross comes from redeemUBA', () => {
    const html = render({ ...legacyYieldClaim, disclosure: { ...legacyYieldClaim.disclosure, redemptionFeeBips: 18, redemptionFeeFxrp: 0.008906 } }, 4.9476, true);
    expect(html).toContain('0.18% ≈ 0.008906 FXRP');
    expect(html).toContain('≈ 4.938694 XRP after the redemption fee');
  });
});

/* ── THE FEE IS SUBTRACTED ONCE (finding R3 3.2) ───────────
 *
 * The exit routes began sending `exit.xrpOutHuman` ALREADY net of the redemption
 * fee (flag `xrpOutNetOfRedemptionFee`, which nothing read), and PoteExitCard,
 * TicketsBoard and VaultEntryModal took it as the gross and subtracted the fee
 * again: two different nets on one screen, and the smaller one was a figure
 * nobody had computed. These fail the day that comes back, in any of the three
 * shapes a backend can answer with.
 */

const FEE_FIGURES = { title: 'x', lines: [], redemptionFeeBips: 18, redemptionFeeFxrp: 0.018, facts: {} };
const exitOf = (exit: Record<string, unknown>, disclosure: Record<string, unknown> = FEE_FIGURES) => ({
  mode: 'sync',
  unminted: true,
  exit: { sharesHuman: '10', unmintUBA: '10000000', marginUBA: '0', marginBps: 0, partial: false, ...exit },
  disclosure,
});

// 1. CURRENT CONTRACT: the gross, plus the net in its own field.
const grossAndNet = exitOf({ xrpOutHuman: '10', xrpOutNetHuman: '9.982' });
// 2. TRANSITION (backend): xrpOutHuman is ALREADY the net and says so.
const netInPlace = exitOf({ xrpOutHuman: '9.982', xrpOutNetOfRedemptionFee: true });
// 3. OLDER: the gross alone.
const grossOnly = exitOf({ xrpOutHuman: '10', xrpOutNetOfRedemptionFee: false });

describe('exitXrpOut — the gross and the net of an exit, in every shape', () => {
  it('reads the same exit out of the three responses', () => {
    expect(exitXrpOut(grossAndNet)).toEqual({ grossFxrp: 10, netXrp: 9.982 });
    expect(exitXrpOut(netInPlace)).toEqual({ grossFxrp: 10, netXrp: 9.982 });
    expect(exitXrpOut(grossOnly)).toEqual({ grossFxrp: 10, netXrp: null });
  });

  it('a transition response without unmintUBA has no gross — and still has its net', () => {
    expect(exitXrpOut(exitOf({ xrpOutHuman: '9.982', xrpOutNetOfRedemptionFee: true, unmintUBA: '0' }))).toEqual({
      grossFxrp: null,
      netXrp: 9.982,
    });
  });

  it('a half-migrated response that repeats the net in both fields is not read as a gross', () => {
    expect(exitXrpOut(exitOf({ xrpOutHuman: '9.982', xrpOutNetHuman: '9.982', xrpOutNetOfRedemptionFee: true }))).toEqual({
      grossFxrp: 10,
      netXrp: 9.982,
    });
  });

  it('an empty or absent figure is not a zero', () => {
    expect(exitXrpOut({ exit: { xrpOutHuman: '' } })).toEqual({ grossFxrp: null, netXrp: null });
    expect(exitXrpOut({})).toEqual({ grossFxrp: null, netXrp: null });
    expect(exitXrpOut(null)).toEqual({ grossFxrp: null, netXrp: null });
  });
});

describe('one net on the screen, and it is the backend’s', () => {
  const amountOf = (r: unknown) => {
    const rows = exitRedemption(r, true).rows!;
    return say(rows.amount!);
  };

  it('the three shapes all say the SAME net', () => {
    expect(amountOf(grossAndNet)).toBe('≈ 9.982 XRP after the redemption fee');
    expect(amountOf(netInPlace)).toBe('≈ 9.982 XRP after the redemption fee');
    expect(amountOf(grossOnly)).toBe('≈ 9.982 XRP after the redemption fee');
  });

  it('THE REGRESSION: a net response never has the fee taken out a second time', () => {
    // 9.982 − 0.018 = 9.964 — the figure the screens used to print.
    expect(amountOf(netInPlace)).not.toContain('9.964');
    expect(redemptionFeeView(netInPlace, exitXrpOut(netInPlace).grossFxrp)).toMatchObject({
      kind: 'figure',
      netXrp: 9.982,
    });
  });

  it('the server’s net wins over one computed here, so the row matches its disclosure lines', () => {
    const rounder = exitOf({ xrpOutHuman: '10', xrpOutNetHuman: '9.982' }, { ...FEE_FIGURES, redemptionFeeFxrp: 0.02 });
    // gross − fee would be 9.98; the backend said 9.982 and that is what is shown.
    expect(amountOf(rounder)).toBe('≈ 9.982 XRP after the redemption fee');
  });

  it('the Legacy claim uses the net its own route stated (disclosure.facts.estXrpOutNet)', () => {
    const claim = {
      redeemUBA: '4947600',
      disclosure: { redemptionFeeBips: 18, redemptionFeeFxrp: 0.008906, facts: { estXrpOutNet: '4.938695' } },
    };
    const rows = redemptionFeeRows(claim, redemptionOf(claim).grossFxrp);
    expect(say(rows.amount!)).toBe('≈ 4.938695 XRP after the redemption fee');
  });

  it('an unmint with no figure keeps the gross and its caveat — a net is never invented', () => {
    const unreadable = exitOf({ xrpOutHuman: '10', xrpOutNetHuman: null }, { title: 'x', lines: [], facts: {} });
    const { grossFxrp, rows } = exitRedemption(unreadable, true);
    expect(grossFxrp).toBe(10);
    expect(rows!.kind).toBe('unreadable');
    expect(say(rows!.amount!)).toBe('≈ 10 XRP before the redemption fee, which could not be read');
  });

  it('exitRedemption says nothing about a fee when the exit does not unmint', () => {
    expect(exitRedemption(poteExitFxrp, false)).toEqual({ grossFxrp: 9.95, rows: null });
    expect(exitRedemption(null, true)).toEqual({ grossFxrp: null, rows: null });
  });
});

describe('the exit screens read the figure through this module, not by hand', () => {
  const files = [
    '../../../components/institutional/user/PoteExitCard.tsx',
    '../../../components/institutional/TicketsBoard.tsx',
    '../../../components/managed/VaultEntryModal.tsx',
  ];

  it('none of them parses exit.xrpOutHuman on its own again', () => {
    for (const f of files) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src, `${f} must go through exitRedemption`).toContain('exitRedemption(');
      // `Number(<something>.exit.xrpOutHuman)` is exactly how the double subtraction
      // got in: the screen decided on its own that the figure was a gross.
      expect(src, `${f} must not read exit.xrpOutHuman as a number by hand`).not.toMatch(
        /Number\([^)]*exit\.xrpOutHuman\)/,
      );
    }
  });
});

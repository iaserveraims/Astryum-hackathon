import { describe, expect, it } from 'vitest';
import { claimIntroFor, exitHintFor, exitSentLineFor } from '../exitHint';

/**
 * VaultEntryModal promised XRP in the exit hint while unmintOnExit defaults to
 * false, and «to your wallet» on a claim that lands as FXRP. These tests fail
 * the day the hint promises a unit the current choice does not deliver.
 */

const promisesXrp = (s: string) => /sends XRP back|converts it back to XRP|Your XRP will land/i.test(s);

describe('exitHintFor', () => {
  it('immediate XRPL exit, default (no unmint): FXRP stays in the Flare account — never XRP', () => {
    const h = exitHintFor({ rail: 'xrp', unmint: false, cooldownSeconds: 0 });
    expect(promisesXrp(h)).toBe(false);
    expect(h).toMatch(/FXRP stays in your Flare account/);
  });

  it('immediate XRPL exit with unmint selected: XRP back', () => {
    expect(promisesXrp(exitHintFor({ rail: 'xrp', unmint: true, cooldownSeconds: 0 }))).toBe(true);
    expect(promisesXrp(exitHintFor({ rail: 'xrp', unmint: true, cooldownSeconds: null }))).toBe(true);
  });

  it('a pot with an exit window fixes FXRP now — even with unmint toggled', () => {
    const h = exitHintFor({ rail: 'xrp', unmint: true, cooldownSeconds: 86_400 });
    expect(promisesXrp(h)).toBe(false);
    expect(h).toMatch(/exit window/);
  });

  it('the Flare wallet rail is a direct redeem', () => {
    expect(exitHintFor({ rail: 'flare', unmint: true, cooldownSeconds: 0 })).toMatch(/Flare wallet/);
  });
});

describe('claimIntroFor', () => {
  it('follows the unmint choice on the XRPL rail', () => {
    expect(promisesXrp(claimIntroFor({ unmint: true, viaXrpl: true }))).toBe(true);
    const fxrp = claimIntroFor({ unmint: false, viaXrpl: true });
    expect(promisesXrp(fxrp)).toBe(false);
    expect(fxrp).toMatch(/as FXRP/);
    expect(fxrp).not.toMatch(/to your wallet/);
  });

  it('the EVM claim sends FXRP to the ticket-holding Flare wallet', () => {
    const evm = claimIntroFor({ unmint: true, viaXrpl: false });
    expect(promisesXrp(evm)).toBe(false);
    expect(evm).toMatch(/FXRP/);
  });
});

describe('exitSentLineFor', () => {
  it('uses the backend handoff: unminted → XRP, otherwise FXRP', () => {
    expect(promisesXrp(exitSentLineFor({ mode: 'claim', handoff: { mode: 'claim', unminted: true } }))).toBe(true);
    expect(promisesXrp(exitSentLineFor({ mode: 'claim', handoff: { mode: 'claim', unminted: false } }))).toBe(false);
    expect(promisesXrp(exitSentLineFor({ mode: 'claim', handoff: { unminted: undefined } }))).toBe(false);
    expect(promisesXrp(exitSentLineFor({ mode: 'exit', handoff: { mode: 'sync-fxrp' } }))).toBe(false);
    expect(exitSentLineFor({ mode: 'exit', handoff: { mode: 'request' } })).toMatch(/ticket/);
  });

  it('without a handoff (EVM rail) never promises XRP or «your wallet» vaguely', () => {
    const claim = exitSentLineFor({ mode: 'claim', handoff: null });
    expect(promisesXrp(claim)).toBe(false);
    expect(claim).toMatch(/FXRP/);
    expect(exitSentLineFor({ mode: 'exit', handoff: null })).toMatch(/exit window/);
  });
});

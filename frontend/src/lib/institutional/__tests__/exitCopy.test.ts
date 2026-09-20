import { describe, expect, it } from 'vitest';
import { exitCopyFor, exitOffersFxrpAlternative } from '../exitCopy';

/**
 * PoteExitCard promised XRP while the backend composed `sync-fxrp` (the FXRP
 * stays in the Flare account). These tests fail the day a mode that does not
 * unmint is labelled XRP, or an unmint is labelled FXRP.
 */

const promisesXrp = (s: string) => /\byour XRP\b/i.test(s) || /converts back to XRP/i.test(s);

describe('exitCopyFor', () => {
  it("'sync-fxrp' is FXRP in the Flare account — never XRP", () => {
    for (const unminted of [undefined, false, true]) {
      const c = exitCopyFor('sync-fxrp', unminted);
      expect(c.unit).toBe('FXRP');
      expect(c.unminted).toBe(false);
      expect(c.destination).toBe('flare-account');
      expect(promisesXrp(c.arrival)).toBe(false);
      expect(promisesXrp(c.sent)).toBe(false);
    }
  });

  it("'sync' (unmint) is XRP to the signing account — never FXRP", () => {
    for (const unminted of [undefined, false, true]) {
      const c = exitCopyFor('sync', unminted);
      expect(c.unit).toBe('XRP');
      expect(c.unminted).toBe(true);
      expect(c.destination).toBe('xrpl-account');
      expect(c.arrival).not.toMatch(/FXRP/);
      expect(c.sent).not.toMatch(/FXRP/);
    }
  });

  it("'request' fixes the amount in FXRP (the unmint, if any, happens at claim)", () => {
    const c = exitCopyFor('request', true);
    expect(c.unit).toBe('FXRP');
    expect(c.unminted).toBe(false);
    expect(promisesXrp(c.arrival)).toBe(false);
  });

  it("'claim' follows the backend's unminted flag", () => {
    expect(exitCopyFor('claim', true).unit).toBe('XRP');
    expect(exitCopyFor('claim', false).unit).toBe('FXRP');
    expect(exitCopyFor('claim', undefined).unit).toBe('FXRP');
    expect(promisesXrp(exitCopyFor('claim', false).sent)).toBe(false);
  });

  it('an unknown or missing mode never promises XRP unless the backend said it unminted', () => {
    expect(exitCopyFor(undefined).unit).toBe('FXRP');
    expect(exitCopyFor('something-new').unit).toBe('FXRP');
    expect(exitCopyFor('something-new', true).unit).toBe('XRP');
  });
});

describe('exitOffersFxrpAlternative', () => {
  it('only below the FAssets minimum is "keep it as FXRP" the way out', () => {
    expect(exitOffersFxrpAlternative('BELOW_FASSETS_MINIMUM')).toBe(true);
    expect(exitOffersFxrpAlternative('NOT_REDEEMABLE_NOW')).toBe(false);
    expect(exitOffersFxrpAlternative('NO_SHARES')).toBe(false);
    expect(exitOffersFxrpAlternative(undefined)).toBe(false);
  });
});

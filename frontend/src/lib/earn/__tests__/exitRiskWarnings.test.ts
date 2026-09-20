import { describe, expect, it } from 'vitest';
import { formatRiskFlag, parseRiskWarnings, riskWarningViews } from '../exitRiskWarnings';

/**
 * The exit prepares carry GoPlus DANGER findings as `riskWarnings` instead of a
 * 409 (the exit is never gated). These tests fail the day a real warning is
 * dropped on the floor — or a malformed one is rendered as a half-empty box.
 */

const FXRP = '0xAd552A648C74D49E10027AB8a618A3ad4901c5bE';

const backendBody = {
  chainId: 1,
  legs: [],
  riskWarnings: [
    {
      code: 'KWYH_DANGER_FXRP',
      token: 'FXRP',
      address: FXRP,
      flags: ['is_honeypot', 'cannot_sell_all'],
      note: 'GoPlus flags FXRP as dangerous. This operation takes your own capital OUT, so it is not blocked — review the flags before you sign.',
    },
    { code: 'KWYH_DANGER_RLUSD', token: 'RLUSD', address: '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD', flags: [], note: '' },
  ],
};

describe('parseRiskWarnings', () => {
  it('reads the backend shape verbatim', () => {
    const ws = parseRiskWarnings(backendBody);
    expect(ws).toHaveLength(2);
    expect(ws[0]).toMatchObject({ code: 'KWYH_DANGER_FXRP', token: 'FXRP', address: FXRP });
    expect(ws[0].flags).toEqual(['is_honeypot', 'cannot_sell_all']);
  });

  it('no field, null, or a non-array is «nothing flagged» — never a throw', () => {
    expect(parseRiskWarnings({ chainId: 1 })).toEqual([]);
    expect(parseRiskWarnings(null)).toEqual([]);
    expect(parseRiskWarnings(undefined)).toEqual([]);
    expect(parseRiskWarnings({ riskWarnings: 'KWYH_DANGER_FXRP' })).toEqual([]);
  });

  it('drops entries with neither token nor code, keeps a token with no flags', () => {
    const ws = parseRiskWarnings({ riskWarnings: [null, 42, {}, { token: 'RLUSD', flags: 'x' }] });
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ code: 'KWYH_DANGER_RLUSD', token: 'RLUSD', flags: [] });
  });

  it('collapses duplicate codes and derives the token from a bare code', () => {
    const ws = parseRiskWarnings({
      riskWarnings: [{ code: 'KWYH_DANGER_FXRP' }, { code: 'KWYH_DANGER_FXRP', token: 'FXRP' }],
    });
    expect(ws).toHaveLength(1);
    expect(ws[0].token).toBe('FXRP');
  });
});

describe('formatRiskFlag', () => {
  it('turns GoPlus codes into words', () => {
    expect(formatRiskFlag('is_honeypot')).toBe('honeypot');
    expect(formatRiskFlag('cannot_sell_all')).toBe('cannot sell all');
    expect(formatRiskFlag(' owner-change-balance ')).toBe('owner change balance');
  });
});

describe('riskWarningViews', () => {
  it('renders flags, note and a short etherscan-linked address', () => {
    const [fxrp, rlusd] = riskWarningViews(parseRiskWarnings(backendBody));
    expect(fxrp.flagsText).toBe('honeypot · cannot sell all');
    expect(fxrp.note).toMatch(/not blocked/);
    expect(fxrp.addressShort).toBe('0xAd55…c5bE');
    expect(fxrp.explorerUrl).toBe(`https://etherscan.io/token/${FXRP}`);
    // A flagged token without listed flags is STILL a warning: null flagsText, not a hidden row.
    expect(rlusd.token).toBe('RLUSD');
    expect(rlusd.flagsText).toBeNull();
    expect(rlusd.note).toBeNull();
  });

  it('never links a malformed address', () => {
    const [v] = riskWarningViews([{ code: 'K', token: 'FXRP', address: 'nope', flags: ['is_honeypot', 'honeypot'], note: '' }]);
    expect(v.addressShort).toBeNull();
    expect(v.explorerUrl).toBeNull();
    expect(v.flagsText).toBe('honeypot');
  });
});

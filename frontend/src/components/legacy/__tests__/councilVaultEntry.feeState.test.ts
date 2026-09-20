import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * G13 (auditoría 2026-08-17) — «un quórum de 0 firma».
 *
 * The funding box printed `String(quote.signerCount)` straight into the
 * sentence "(a quorum of {n} signs…)". When the XRPL read of the signer list
 * failed, the backend answered 0 — because `getSignerCouncil(...).catch(() =>
 * null)` collapsed "not read" into "no council" — and the surface stated, in
 * words, that a quorum of ZERO signs, while MAX reserved the fee of a SINGLE
 * signature. The council then signed a payment its own account could not fund
 * and the only feedback was a cryptic tec after the ceremony.
 *
 * Why source-level and not a render test: the frontend vitest bootstrap is
 * `environment: 'node'` and tsconfig sets `jsx: "preserve"`, so importing a
 * .tsx here fails at transform time. `fundFeeState` is therefore pulled OUT of
 * the shipping source and evaluated — assertions run on the code that ships,
 * not on a copy that can drift. (Same technique as moneyflowsRunHealth.)
 */

const COMPONENT = join(__dirname, '..', 'CouncilVaultEntry.tsx');
const src = readFileSync(COMPONENT, 'utf8');

type FeeState =
  | { kind: 'quorum'; signerCount: number; txFeeXrp: string; maxGrossXrp: string }
  | { kind: 'single'; txFeeXrp: string; maxGrossXrp: string }
  | { kind: 'unread' };
type Quote = { signerCount: number | null; txFeeXrp: string | null; maxGrossXrp: string | null };

/**
 * Extract `fundFeeState` from the component and evaluate it. The body is plain
 * JS — only the signature carries TS, and it is replaced literally, so a
 * changed signature fails loudly here instead of silently skipping the test.
 */
function loadFundFeeState(): (q: Quote | null) => FeeState | null {
  const start = src.indexOf('function fundFeeState(');
  expect(start, 'fundFeeState must exist in CouncilVaultEntry.tsx').toBeGreaterThan(-1);
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  expect(end, 'fundFeeState body must be brace-balanced').toBeGreaterThan(start);
  const ts = src.slice(start, end);
  const SIGNATURE = 'function fundFeeState(quote: FundFeeQuote | null): FundFeeState | null {';
  expect(
    ts.startsWith(SIGNATURE),
    `fundFeeState signature changed — update this test. Got: ${ts.slice(0, 90)}`,
  ).toBe(true);
  const js = ts.replace(SIGNATURE, 'function fundFeeState(quote) {');
  // eslint-disable-next-line no-new-func
  return new Function(`${js}; return fundFeeState;`)() as (q: Quote | null) => FeeState | null;
}

const fundFeeState = loadFundFeeState();

describe('fundFeeState — una lectura que falló no es un número', () => {
  it('a failed council read is "unread": no fee, no ceiling, no MAX', () => {
    const state = fundFeeState({ signerCount: null, txFeeXrp: null, maxGrossXrp: null });
    expect(state).toEqual({ kind: 'unread' });
    // Nothing in an unread state carries a figure MAX could be built on.
    expect(state && 'maxGrossXrp' in state).toBe(false);
  });

  it('a real council keeps its real size and its multisig fee', () => {
    expect(fundFeeState({ signerCount: 3, txFeeXrp: '0.00004', maxGrossXrp: '98.99996' })).toEqual({
      kind: 'quorum',
      signerCount: 3,
      txFeeXrp: '0.00004',
      maxGrossXrp: '98.99996',
    });
  });

  it('a signer-less account is "single", never "a quorum of 0"', () => {
    const state = fundFeeState({ signerCount: 0, txFeeXrp: '0.00001', maxGrossXrp: '98.99999' });
    expect(state).toEqual({ kind: 'single', txFeeXrp: '0.00001', maxGrossXrp: '98.99999' });
    // The quorum sentence is reachable ONLY from the 'quorum' branch.
    expect(state?.kind).not.toBe('quorum');
  });

  it('a half-answered quote is unread too — one hole voids the whole chain', () => {
    expect(fundFeeState({ signerCount: 2, txFeeXrp: null, maxGrossXrp: null })).toEqual({ kind: 'unread' });
    expect(fundFeeState({ signerCount: 2, txFeeXrp: '0.00003', maxGrossXrp: null })).toEqual({ kind: 'unread' });
  });

  it('no quote yet is not "unread" — it is nothing to say at all', () => {
    expect(fundFeeState(null)).toBeNull();
  });
});

describe('la superficie no imprime como dato un consejo no leído', () => {
  it('the quorum sentence is no longer fed by a raw signerCount', () => {
    // The exact old expression: `.replace('{n}', String(quote.signerCount))`.
    expect(src).not.toMatch(/String\(quote\.signerCount\)/);
    expect(src).toMatch(/String\(feeState\.signerCount\)/);
  });

  it('MAX hangs off a ceiling that was read, not off the quote object', () => {
    expect(src).not.toMatch(/Number\(quote\.maxGrossXrp\)\s*>\s*0/);
    expect(src).toMatch(/maxGrossXrp !== null && Number\(maxGrossXrp\) > 0/);
  });

  it('a failed read gets its own sentence on screen', () => {
    expect(src).toMatch(/feeState\?\.kind === 'unread'/);
    expect(src).toMatch(/The council could not be read from XRPL just now/);
  });
});

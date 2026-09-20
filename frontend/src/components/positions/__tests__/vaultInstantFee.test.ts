import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { instantFeeQuote } from '../vaultModalTruth';
import { describeRetryableRefusal, refusalHeadline } from '../../../lib/xaman/seatRefusal';

/**
 * UNA COMISIÓN QUE NO SE PUDO LEER NO ES UN CERO.
 *
 * WHAT SHIPPED. `/vault-withdraw/prepare` read the vault's
 * `instantRedemptionFee()` with `.catch(() => null)` and then priced that null
 * as ZERO: `estimatedFxrpOut` became the GROSS, `instantFeeFxrp` became
 * `feeFxrp || null` — the same `null` a fee-free vault sends — and the whole
 * thing was stamped `disclosedToUser: true`. Invariant #6 says the fee is
 * visible BEFORE the signature; affirming the absence of a fee that nobody
 * managed to look at is the opposite of disclosing it.
 */

describe('instantFeeQuote — three states, never one silence', () => {
  it('a fee that was READ is charged, percentage and FXRP', () => {
    const q = instantFeeQuote({ instantRedemptionFeeBps: 10, instantFeeFxrp: 0.1009202, instantFeeKnown: true });
    expect(q).toEqual({ kind: 'charged', bps: 10, fxrp: 0.1009202 });
  });

  it('a GENUINE zero-bps fee is still «charged» — it was read, and it is worth nothing', () => {
    // `feeFxrp || null` used to send this as null, i.e. as «no fee here»,
    // which is also what an unread fee sent. Three states, one symbol.
    const q = instantFeeQuote({ instantRedemptionFeeBps: 0, instantFeeFxrp: 0, instantFeeKnown: true });
    expect(q).toEqual({ kind: 'charged', bps: 0, fxrp: 0 });
  });

  it('a vault with NO instant fee (Firelight) is «none», because the prepare says the fee is known', () => {
    const q = instantFeeQuote({ instantRedemptionFeeBps: null, instantFeeFxrp: null, instantFeeKnown: true });
    expect(q).toEqual({ kind: 'none' });
  });

  it('a payload that cannot account for its fee is «unreadable», never «none»', () => {
    // The server now refuses to compose this, so it should not arrive — and if
    // it ever does (an older producer, a new rail), it is SAID, not hidden.
    expect(instantFeeQuote({ instantRedemptionFeeBps: null, instantFeeFxrp: null })).toEqual({ kind: 'unreadable' });
    expect(instantFeeQuote({})).toEqual({ kind: 'unreadable' });
    expect(instantFeeQuote(undefined)).toEqual({ kind: 'unreadable' });
  });

  it('The shape /vault-withdraw now SENDS for an unread fee is «unreadable», and the row is live code again', () => {
    // Refused this exit; Composes it (the fee is disclosure
    // there, not payload — the contract charges it either way) and says the
    // unknown out loud: `instantFeeKnown: false`, no bps, no net.
    const q = instantFeeQuote({
      instantRedemptionFeeBps: null,
      instantFeeFxrp: null,
      instantFeeKnown: false,
      instantFeeSource: 'vault.instantRedemptionFee() — did NOT answer',
      estimatedFxrpOut: null,
    });
    expect(q).toEqual({ kind: 'unreadable' });
  });

  it('a non-numeric fee is not coerced into one', () => {
    expect(instantFeeQuote({ instantRedemptionFeeBps: Number.NaN, instantFeeKnown: true })).toEqual({ kind: 'none' });
    expect(instantFeeQuote({ instantRedemptionFeeBps: 10, instantFeeFxrp: 'lots', instantFeeKnown: true })).toEqual({
      kind: 'charged',
      bps: 10,
      fxrp: null,
    });
  });
});

describe('the refusal the person reads when the fee could not be read', () => {
  const t = (s: string) => s;

  it('VAULT_FEE_UNREADABLE says what failed, that it is not a zero, and that nothing was signed', () => {
    const view = describeRetryableRefusal({ error: 'VAULT_FEE_UNREADABLE', status: 502, retryable: true }, t);
    expect(view).not.toBeNull();
    expect(view!.mayRetry).toBe(true);
    expect(view!.text).toMatch(/could not read/i);
    expect(view!.text).toMatch(/never a zero/i);
    expect(view!.text).toMatch(/nothing was signed/i);
    expect(view!.text).toMatch(/try again/i);
  });

  it('VAULT_STATE_UNREADABLE refuses to read a dead node as an open vault', () => {
    const view = describeRetryableRefusal({ error: 'VAULT_STATE_UNREADABLE', status: 502, retryable: true }, t);
    expect(view).not.toBeNull();
    expect(view!.text).toMatch(/taking deposits/i);
    expect(view!.text).toMatch(/never «it is open»/);
    expect(view!.text).toMatch(/nothing moved/i);
  });

  it('neither falls through to the generic «the server refused this operation»', () => {
    // Nobody refused anything: a read of OURS failed. The generic is both
    // wrong and a dead end (no retry) — 's lesson, applied to.
    for (const error of ['VAULT_FEE_UNREADABLE', 'VAULT_STATE_UNREADABLE']) {
      const head = refusalHeadline({ error, status: 502, retryable: true }, t);
      expect(head).not.toBeNull();
      expect(head).not.toMatch(/The server refused this operation/);
      expect(head).not.toMatch(/VAULT_/); // never the raw slug
    }
  });
});

describe('the withdraw modal renders the fee row from the quote, not from a bare null check', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/positions/VaultWithdrawModal.tsx'),
    'utf8',
  );

  it('uses instantFeeQuote and has an explicit branch for the unreadable state', () => {
    expect(src).toContain('instantFeeQuote(disclosure)');
    expect(src).toContain("instantFee.kind === 'charged'");
    expect(src).toContain("instantFee.kind === 'unreadable'");
  });

  it('no longer gates the fee row on `disclosure?.instantRedemptionFeeBps != null`', () => {
    // That single guard was what collapsed «none», «zero» and «unknown» into
    // an empty row.
    expect(src).not.toContain('disclosure?.instantRedemptionFeeBps != null');
  });

  it('says so when no net could be estimated, instead of showing no row at all', () => {
    expect(src).toContain("{disclosure?.estimatedFxrpOut != null ? (");
  });
});

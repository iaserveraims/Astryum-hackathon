import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../councilSigning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../councilSigning')>();
  return { ...actual, awaitValidation: vi.fn() };
});

import { awaitValidation } from '../councilSigning';
import {
  applyXrplSignFailure,
  confirmOnLedger,
  isLedgerVerdictError,
  LEDGER_VALIDATION_TIMEOUT_MS,
  ledgerVerdictAction,
  ledgerVerdictError,
  xrplSignFailureAction,
} from '../ledgerSignOutcome';
import { decideAfterSigned, decideAfterValidation } from '../singleSignVerdict';
import { signFailureAction, type UnconfirmedSignature } from '../../wallet/signOutcome';

/**
 * The `sendIntent` surfaces (escrow, DEX order, recurring payment, Legacy
 * ceremony, acta anchor) either painted Xaman's «signed» as done or put a read
 * failure next to the sign button. These pin the ledger verdicts they now share
 * with XamanSingleSign.
 */

const en = (s: string) => s;
const HASH = 'C'.repeat(64);
const mocked = vi.mocked(awaitValidation);

const TEC = decideAfterValidation({ txid: HASH, validated: true, finalResult: 'tecUNFUNDED_PAYMENT' });
const TIMED_OUT = decideAfterValidation({ txid: HASH, validated: false, timedOut: true });
const NO_HASH = decideAfterSigned({ txid: '' });

beforeEach(() => {
  mocked.mockReset();
});

describe('ledgerVerdictAction', () => {
  it('only a validated tesSUCCESS is silence (null)', () => {
    expect(ledgerVerdictAction({ kind: 'settled', txid: HASH }, en)).toBeNull();
  });

  it('a validated failure sends the user to prepare again, naming the code', () => {
    const a = ledgerVerdictAction(TEC, en);
    expect(a?.view).toBe('form');
    expect(a && 'message' in a ? a.message : '').toMatch(/Prepare the operation again/);
    expect(a && 'message' in a ? a.message : '').toContain('tecUNFUNDED_PAYMENT');
  });

  it('a stale pinned tx (tefPAST_SEQ / tefMAX_LEDGER) sends the user to prepare again — never back to the same payload', () => {
    const stale = decideAfterSigned({ txid: HASH, dispatched: 'tefMAX_LEDGER' });
    const a = ledgerVerdictAction(stale, en);
    expect(a?.view).toBe('form');
    expect(a && 'message' in a ? a.message : '').toMatch(/can no longer be used .* prepare it again/);
    expect(a && 'message' in a ? a.message : '').toContain('tefMAX_LEDGER');
  });

  it('not validated in time is unconfirmed, with the hash to check and no trace', () => {
    expect(ledgerVerdictAction(TIMED_OUT, en)).toEqual({ view: 'unconfirmed', txHash: HASH, trace: null });
  });

  it('no hash is unconfirmed too — never the sign button', () => {
    const a = ledgerVerdictAction(NO_HASH, en);
    expect(a?.view).toBe('unconfirmed');
  });

  it('nothing that may have entered a ledger ever returns to review', () => {
    for (const v of [TEC, TIMED_OUT, NO_HASH]) {
      expect(ledgerVerdictAction(v, en)?.view).not.toBe('review');
    }
  });
});

describe('confirmOnLedger', () => {
  it('resolves with the hash only on a validated tesSUCCESS', async () => {
    mocked.mockResolvedValue({ validated: true, finalResult: 'tesSUCCESS' });
    await expect(confirmOnLedger(HASH)).resolves.toBe(HASH);
    expect(mocked).toHaveBeenCalledWith(HASH, { timeoutMs: LEDGER_VALIDATION_TIMEOUT_MS });
  });

  it('a validated tec throws a failed-onchain verdict', async () => {
    mocked.mockResolvedValue({ validated: true, finalResult: 'tecNO_DST' });
    const err = await confirmOnLedger(HASH).catch((e: unknown) => e);
    expect(isLedgerVerdictError(err)).toBe(true);
    expect((err as { verdict: unknown }).verdict).toEqual({ kind: 'failed-onchain', code: 'tecNO_DST', txid: HASH });
  });

  it('a timeout throws unconfirmed, carrying the hash', async () => {
    mocked.mockResolvedValue({ validated: false, timedOut: true });
    const err = await confirmOnLedger(HASH).catch((e: unknown) => e);
    expect((err as { verdict: unknown }).verdict).toEqual({ kind: 'unconfirmed', reason: 'not-validated', txid: HASH });
  });

  it('an empty hash never asks the ledger and is unconfirmed', async () => {
    for (const h of ['', undefined, null]) {
      const err = await confirmOnLedger(h).catch((e: unknown) => e);
      expect((err as { verdict: unknown }).verdict).toEqual({ kind: 'unconfirmed', reason: 'no-hash' });
    }
    expect(mocked).not.toHaveBeenCalled();
  });
});

describe('xrplSignFailureAction — ledger verdicts first, the wallet rules otherwise', () => {
  it('routes a ledger verdict by what the ledger said', () => {
    expect(xrplSignFailureAction(ledgerVerdictError(TEC), true, en).view).toBe('form');
    expect(xrplSignFailureAction(ledgerVerdictError(TIMED_OUT), true, en)).toEqual({
      view: 'unconfirmed',
      txHash: HASH,
      trace: null,
    });
  });

  it('Xaman losing the hash after the hand-off is unconfirmed', () => {
    const e = new Error('Transaction submission failed: Failed to retrieve transaction hash from payload');
    expect(xrplSignFailureAction(e, true, en).view).toBe('unconfirmed');
  });

  it('a cancelled request and a pre-flight throw keep the sign button', () => {
    expect(xrplSignFailureAction(new Error('User rejected the request.'), true, en).view).toBe('review');
    expect(xrplSignFailureAction(new Error('Connect your XRPL wallet'), false, en).view).toBe('review');
  });

  it('a ledger verdict misrouted to the plain classifier still lands on the safe side', () => {
    for (const v of [TEC, TIMED_OUT, NO_HASH]) {
      expect(signFailureAction(ledgerVerdictError(v), true, en).view).toBe('unconfirmed');
    }
  });
});

describe('applyXrplSignFailure — the setters it drives', () => {
  function run(e: unknown, handed: boolean) {
    const ui = { error: null as string | null, unconfirmed: undefined as UnconfirmedSignature | null | undefined, phase: '', cleared: 0 };
    applyXrplSignFailure(e, handed, en, {
      setError: (m) => { ui.error = m; },
      setUnconfirmed: (u) => { ui.unconfirmed = u; },
      setPhase: (p) => { ui.phase = p; },
      clearPrepared: () => { ui.cleared += 1; },
    });
    return ui;
  }

  it('failed on-chain: red line, payload dropped, no amber panel', () => {
    const ui = run(ledgerVerdictError(TEC), true);
    expect(ui.phase).toBe('form');
    expect(ui.cleared).toBe(1);
    expect(ui.unconfirmed).toBeNull();
    expect(ui.error).toContain('tecUNFUNDED_PAYMENT');
  });

  it('unconfirmed: amber with the hash, no red line, payload kept', () => {
    const ui = run(ledgerVerdictError(TIMED_OUT), true);
    expect(ui.phase).toBe('unconfirmed');
    expect(ui.error).toBe('');
    expect(ui.unconfirmed).toEqual({ txHash: HASH, trace: null });
    expect(ui.cleared).toBe(0);
  });
});

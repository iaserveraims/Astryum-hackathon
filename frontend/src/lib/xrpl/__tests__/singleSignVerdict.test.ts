import { describe, expect, it } from 'vitest';
import {
  STALE_TX_MESSAGE,
  blocksRetreat,
  cancelsOnLeave,
  decideAfterSigned,
  decideAfterValidation,
  nextActiveTxKey,
  offersRetry,
  retreatDecision,
  settles,
  type SingleSignPhase,
} from '../singleSignVerdict';
import { resolveCancelAction, type XamanCancelResult } from '../../xaman/payloadBus';

/**
 * XamanSingleSign used to call `onSettled` the moment Xaman read «signed».
 * These pin the two decisions that replaced it: only a validated tesSUCCESS
 * settles, and only a refusal that never entered a ledger is signed again.
 */

const HASH = 'A'.repeat(64);

describe('decideAfterSigned', () => {
  it('signed without a txid never settles and never offers a retry', () => {
    for (const txid of [undefined, null, '', '   ']) {
      const v = decideAfterSigned({ txid, dispatched: 'tesSUCCESS' });
      expect(v).toEqual({ kind: 'unconfirmed', reason: 'no-hash' });
      expect(settles(v)).toBe(false);
      expect(offersRetry(v)).toBe(false);
    }
  });

  it('no txid stays unconfirmed even when the dispatched code reads as a refusal', () => {
    const v = decideAfterSigned({ txid: '', dispatched: 'tefPAST_SEQ' });
    expect(v.kind).toBe('unconfirmed');
    expect(offersRetry(v)).toBe(false);
  });

  it('tem / tef / tel dispatched results offer a retry (nothing entered a ledger)', () => {
    for (const code of ['temBAD_AMOUNT', 'tefBAD_AUTH', 'telINSUF_FEE_P']) {
      const v = decideAfterSigned({ txid: HASH, dispatched: code });
      expect(v).toEqual({ kind: 'refused', code });
      expect(offersRetry(v)).toBe(true);
      expect(settles(v)).toBe(false);
    }
  });

  /**
   * CHANGED ON PURPOSE (it.11). The orders are pinned (Sequence +
   * LastLedgerSequence): tefPAST_SEQ / tefMAX_LEDGER say THIS tx can never
   * validate. As 'refused', «Try again» recreated the same payload with the same
   * tx — an endless loop, while the handed-off sibling may have validated.
   */
  it('tefPAST_SEQ / tefMAX_LEDGER are stale: never settle, never offer a retry, keep the hash', () => {
    for (const code of ['tefPAST_SEQ', 'tefMAX_LEDGER']) {
      const v = decideAfterSigned({ txid: HASH, dispatched: code });
      expect(v).toEqual({ kind: 'stale', code, txid: HASH });
      expect(offersRetry(v)).toBe(false);
      expect(settles(v)).toBe(false);
    }
  });

  it('tefALREADY (the identical tx was already applied) waits for the ledger — neither refused nor stale', () => {
    const v = decideAfterSigned({ txid: HASH, dispatched: 'tefALREADY' });
    expect(v).toEqual({ kind: 'await-validation', txid: HASH });
    expect(offersRetry(v)).toBe(false);
  });

  it('the stale sentence says the prepared tx is spent and the way forward is preparing again', () => {
    expect(STALE_TX_MESSAGE).toBe(
      'This prepared transaction can no longer be used (its ledger window or sequence passed) — prepare it again',
    );
  });

  it('a preliminary tesSUCCESS, tec, ter or missing code waits for the ledger — never settles yet', () => {
    for (const dispatched of ['tesSUCCESS', 'tecUNFUNDED_PAYMENT', 'terQUEUED', '', undefined]) {
      const v = decideAfterSigned({ txid: HASH, dispatched });
      expect(v).toEqual({ kind: 'await-validation', txid: HASH });
      expect(settles(v)).toBe(false);
      expect(offersRetry(v)).toBe(false);
    }
  });
});

describe('decideAfterValidation', () => {
  it('validated tesSUCCESS settles', () => {
    const v = decideAfterValidation({ txid: HASH, validated: true, finalResult: 'tesSUCCESS' });
    expect(v).toEqual({ kind: 'settled', txid: HASH });
    expect(settles(v)).toBe(true);
    expect(offersRetry(v)).toBe(false);
  });

  it('validated tec never settles and offers no retry (fee and sequence are spent)', () => {
    const v = decideAfterValidation({ txid: HASH, validated: true, finalResult: 'tecNEED_MASTER_KEY' });
    expect(v).toEqual({ kind: 'failed-onchain', code: 'tecNEED_MASTER_KEY', txid: HASH });
    expect(settles(v)).toBe(false);
    expect(offersRetry(v)).toBe(false);
  });

  it('a timeout never settles and offers no retry', () => {
    const v = decideAfterValidation({ txid: HASH, validated: false, timedOut: true });
    expect(v).toEqual({ kind: 'unconfirmed', reason: 'not-validated', txid: HASH });
    expect(settles(v)).toBe(false);
    expect(offersRetry(v)).toBe(false);
  });

  it('validated without a readable result is unknown, not success', () => {
    const v = decideAfterValidation({ txid: HASH, validated: true, finalResult: undefined });
    expect(v.kind).toBe('unconfirmed');
    expect(settles(v)).toBe(false);
    expect(offersRetry(v)).toBe(false);
  });
});

/**
 * The parents (CageConsole, CredentialTray) kept a «Cancel» that dropped the
 * prepared order while the signature was unconfirmed — and a dropped order is
 * prepared and signed again. `blocksRetreat` is what they are told.
 */
describe('blocksRetreat — may the parent still drop this signature?', () => {
  it('confirming and unconfirmed block, whatever retryable says', () => {
    for (const retryable of [true, false]) {
      expect(blocksRetreat('confirming', retryable)).toBe(true);
      expect(blocksRetreat('unconfirmed', retryable)).toBe(true);
    }
  });

  it('an error with no retry (validated tec*) blocks; a retryable error does not', () => {
    expect(blocksRetreat('error', false)).toBe(true);
    expect(blocksRetreat('error', true)).toBe(false);
  });

  it("'creating' is free: no payload exists yet, nothing can be signed", () => {
    expect(blocksRetreat('creating', false)).toBe(false);
    expect(blocksRetreat('creating', true)).toBe(false);
  });

  /**
   * CHANGED ON PURPOSE (13-sep). 'waiting' used to be free: the parent's Cancel
   * dropped the order while the QR/push was live, the payload was never
   * cancelled at Xaman (signable for its 5 minutes), and preparing again gave a
   * SECOND signable order — sign both, two council orders. A live request is
   * now left only through the component's own «Cancel this request».
   */
  it("'waiting' blocks: the request is live and signable on the phone", () => {
    expect(blocksRetreat('waiting', false)).toBe(true);
    expect(blocksRetreat('waiting', true)).toBe(true);
  });

  it("'cancelled' is free: Xaman confirmed the kill and nothing was signed", () => {
    expect(blocksRetreat('cancelled', false)).toBe(false);
    expect(blocksRetreat('cancelled', true)).toBe(false);
  });

  it("'stale' does not block: this tx can never validate, and preparing again is the only way forward", () => {
    expect(blocksRetreat('stale', false)).toBe(false);
    expect(blocksRetreat('stale', true)).toBe(false);
    // …so a freshly prepared transaction from the parent is adopted.
    const OLD = JSON.stringify({ Sequence: 1 });
    const NEW = JSON.stringify({ Sequence: 2 });
    expect(nextActiveTxKey({ activeKey: OLD, incomingKey: NEW, blocked: blocksRetreat('stale', false) })).toBe(NEW);
  });

  it('agrees with the verdicts: only a refusal (retry offered) leaves an error unblocked', () => {
    const refused = decideAfterSigned({ txid: HASH, dispatched: 'tefBAD_AUTH' });
    const failed = decideAfterValidation({ txid: HASH, validated: true, finalResult: 'tecNO_PERMISSION' });
    expect(blocksRetreat('error', offersRetry(refused))).toBe(false);
    expect(blocksRetreat('error', offersRetry(failed))).toBe(true);
  });

  it("'settled' does not block — after onSettled nothing is pending", () => {
    expect(blocksRetreat('settled', false)).toBe(false);
    expect(blocksRetreat('settled', true)).toBe(false);
  });
});

/**
 * ManagerConsole swapped `txjson` under a mounted XamanSingleSign: the QR stayed
 * the OLD payload's while `onSettled` spoke for the NEW order. The component now
 * decides which transaction it works on with `nextActiveTxKey`.
 */
describe('nextActiveTxKey — a different txjson while mounted', () => {
  const OLD = JSON.stringify({ TransactionType: 'Payment', Account: 'rA', Amount: '1000000' });
  const NEW = JSON.stringify({ TransactionType: 'Payment', Account: 'rA', Amount: '2000000' });

  it('adopts the new transaction when nothing blocks', () => {
    // 'waiting' is NOT here any more (13-sep): adopting a new tx while the old
    // QR is live left the old payload signable at Xaman beside the new one.
    for (const phase of ['creating', 'cancelled'] as SingleSignPhase[]) {
      expect(nextActiveTxKey({ activeKey: OLD, incomingKey: NEW, blocked: blocksRetreat(phase, false) })).toBe(NEW);
    }
    // A retryable error (expired / declined / tem-tef-tel) moved nothing.
    expect(nextActiveTxKey({ activeKey: OLD, incomingKey: NEW, blocked: blocksRetreat('error', true) })).toBe(NEW);
  });

  it('holds the active transaction while it is blocked', () => {
    const blockedStates: Array<[SingleSignPhase, boolean]> = [
      // A live QR: the old payload is still signable, so the new tx waits until
      // it is cancelled in Xaman (or resolved) — two signable orders never coexist.
      ['waiting', false],
      ['confirming', false],
      ['unconfirmed', false],
      ['error', false], // validated tec*: fee and sequence spent
    ];
    for (const [phase, retryable] of blockedStates) {
      expect(nextActiveTxKey({ activeKey: OLD, incomingKey: NEW, blocked: blocksRetreat(phase, retryable) })).toBe(OLD);
    }
  });

  it('an unchanged key is a no-op, blocked or not', () => {
    expect(nextActiveTxKey({ activeKey: OLD, incomingKey: OLD, blocked: true })).toBe(OLD);
    expect(nextActiveTxKey({ activeKey: OLD, incomingKey: OLD, blocked: false })).toBe(OLD);
  });

  it('an equal object rebuilt on every render is the same key — never a new payload', () => {
    const rebuilt = JSON.stringify({ TransactionType: 'Payment', Account: 'rA', Amount: '1000000' });
    expect(nextActiveTxKey({ activeKey: OLD, incomingKey: rebuilt, blocked: false })).toBe(OLD);
  });

  it("'settled' does not block, so a waiting transaction is adopted after success", () => {
    expect(nextActiveTxKey({ activeKey: OLD, incomingKey: NEW, blocked: blocksRetreat('settled', false) })).toBe(NEW);
  });
});

/**
 * «Cancel this request» inside XamanSingleSign: the only way out of a live
 * request. Xaman's answer goes through the SAME decision the other surfaces use
 * (`resolveCancelAction`), and `retreatDecision` maps it onto the component.
 */
describe('retreatDecision — what the component does with the cancel answer', () => {
  const UUID = 'b0c1d2e3-0000-4000-8000-000000000001';
  const decide = (result: XamanCancelResult) =>
    retreatDecision(resolveCancelAction({ onScreenUuid: UUID, answeredUuid: UUID, result }));

  it('a confirmed kill closes the request (the parent may drop its order)', () => {
    expect(decide({ outcome: 'cancelled' })).toEqual({ kind: 'closed' });
  });

  it('already expired / already cancelled close too: nothing was signed and nothing is left', () => {
    expect(decide({ outcome: 'already-gone', reason: 'ALREADY_EXPIRED' })).toEqual({ kind: 'closed' });
    expect(decide({ outcome: 'already-gone', reason: 'ALREADY_CANCELLED' })).toEqual({ kind: 'closed' });
  });

  it('ALREADY_RESOLVED follows the request into confirming — it may be signed, never a new payload', () => {
    const d = decide({ outcome: 'already-gone', reason: 'ALREADY_RESOLVED' });
    expect(d).toEqual({ kind: 'follow' });
    // Following keeps the request: the phase stays blocked until the poll decides.
    expect(blocksRetreat('waiting', false)).toBe(true);
  });

  it('a refused kill stays, still signable, and says so', () => {
    expect(decide({ outcome: 'still-live', reason: 'CANNOT_CANCEL' })).toEqual({ kind: 'stay', warn: 'alive' });
  });

  it('no usable answer stays too — «we could not read it» is not «it is dead»', () => {
    for (const reason of ['TIMEOUT', 'ABORTED', 'UNREACHABLE', 'HTTP_500']) {
      expect(decide({ outcome: 'unknown', reason })).toEqual({ kind: 'stay', warn: 'unknown' });
    }
  });

  it('an answer about a request no longer on screen is ignored', () => {
    const action = resolveCancelAction({ onScreenUuid: 'another-uuid', answeredUuid: UUID, result: { outcome: 'cancelled' } });
    expect(retreatDecision(action)).toEqual({ kind: 'ignore' });
  });

  it('only a closed decision frees the parent; every other one keeps the request blocked', () => {
    const outcomes: XamanCancelResult[] = [
      { outcome: 'cancelled' },
      { outcome: 'already-gone', reason: 'ALREADY_RESOLVED' },
      { outcome: 'still-live' },
      { outcome: 'unknown', reason: 'TIMEOUT' },
    ];
    for (const r of outcomes) {
      const d = decide(r);
      const phase: SingleSignPhase = d.kind === 'closed' ? 'cancelled' : 'waiting';
      expect(blocksRetreat(phase, false)).toBe(d.kind !== 'closed');
    }
  });
});

describe('cancelsOnLeave — best-effort kill when the component goes away', () => {
  it('a payload that exists and no poll decided is still signable: cancel it', () => {
    expect(cancelsOnLeave({ uuid: 'u-1', decided: false })).toBe(true);
  });

  it('a decided payload (signed, cancelled, expired) is never cancelled on the way out', () => {
    expect(cancelsOnLeave({ uuid: 'u-1', decided: true })).toBe(false);
  });

  it('no payload yet: nothing to cancel', () => {
    for (const uuid of [undefined, null, '']) {
      expect(cancelsOnLeave({ uuid, decided: false })).toBe(false);
    }
  });
});

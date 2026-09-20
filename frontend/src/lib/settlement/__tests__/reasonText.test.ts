/**
 * batch-evm (2026-08-20) — «the batch failed» is NOT «nothing was applied».
 *
 * `evaluate5792` names the FIRST call whose receipt is not a success, and the
 * machine's own §1.1 says in writing that a bundle can be CONFIRMED with an
 * individual call reverted. So with `BATCH_CALL_REVERTED:2` the approve ALREADY
 * RAN — and the sentence the product printed was «Batch step 2 of the batch was
 * rejected by the network — nothing was applied.», under the headline «The
 * signed operation failed on-chain» (SettlementIndicator), beside a sign button
 * that re-sends `prereqs + txData` (useIntentSigning → SidebarIntents →
 * intentPresentation). Two sentences that mean "go again", over money that
 * already moved.
 *
 * These tests run the real emitter (`evaluate5792`) into the real renderer
 * (`settlementReasonText`), so the two halves cannot drift apart.
 */
import { describe, expect, it } from 'vitest';
import { settlementReasonText } from '../reasonText';
import { batchRevertedStep, evaluate5792, isPartialBatchFailure } from '../settlement';

const en = (s: string) => s;

describe('evaluate5792 → settlementReasonText, end to end', () => {
  const reasonFor = (statuses: string[]) =>
    evaluate5792({ status: 'CONFIRMED', receipts: statuses.map((status) => ({ status })) }).reason;

  it('a revert on call 2 says the earlier calls WENT THROUGH and forbids a second signature', () => {
    const reason = reasonFor(['success', 'reverted']);
    expect(reason).toBe('BATCH_CALL_REVERTED:2');
    const text = settlementReasonText(reason, en) ?? '';
    expect(text).toContain('2');
    expect(text).toMatch(/steps before it already went through/i);
    expect(text).toMatch(/do NOT sign this again/);
    // The lie this frente exists to remove.
    expect(text).not.toMatch(/nothing was applied/i);
  });

  it('a revert on call 1 keeps the old sentence — nothing ran before it', () => {
    const reason = reasonFor(['reverted', 'success']);
    expect(reason).toBe('BATCH_CALL_REVERTED:1');
    const text = settlementReasonText(reason, en) ?? '';
    expect(text).toMatch(/nothing was applied/i);
    expect(text).not.toMatch(/do NOT sign/i);
  });

  it('a revert on call 5 of a long bundle names call 5 and still forbids it', () => {
    const reason = reasonFor(['success', 'success', 'success', 'success', 'reverted']);
    const text = settlementReasonText(reason, en) ?? '';
    expect(text).toContain('5');
    expect(text).toMatch(/do NOT sign this again/);
  });
});

describe('isPartialBatchFailure — the one line the sign button must gate on', () => {
  it('true only when calls before the reverted one already ran', () => {
    expect(isPartialBatchFailure('BATCH_CALL_REVERTED:2')).toBe(true);
    expect(isPartialBatchFailure('BATCH_CALL_REVERTED:9')).toBe(true);
    expect(isPartialBatchFailure('BATCH_CALL_REVERTED:1')).toBe(false);
    expect(isPartialBatchFailure('REVERTED')).toBe(false);
    expect(isPartialBatchFailure('BATCH_FAILED')).toBe(false);
    expect(isPartialBatchFailure(undefined)).toBe(false);
  });

  it('batchRevertedStep parses the code and refuses anything else', () => {
    expect(batchRevertedStep('BATCH_CALL_REVERTED:3')).toBe(3);
    expect(batchRevertedStep('BATCH_CALL_REVERTED:0')).toBeNull();
    expect(batchRevertedStep('BATCH_CALL_REVERTED:x')).toBeNull();
    expect(batchRevertedStep('BATCH_CALL_REVERTED:2 ')).toBeNull();
    expect(batchRevertedStep(undefined)).toBeNull();
  });
});

describe('the other reasons are untouched', () => {
  it('a plain revert still says the money did not move', () => {
    expect(settlementReasonText('REVERTED', en)).toMatch(/money did not move/i);
  });

  it('the stalled headline keeps its deliberate silence', () => {
    expect(settlementReasonText('STALLED_SLOW', en)).toBeUndefined();
    expect(settlementReasonText(undefined, en)).toBeUndefined();
  });

  it('a backend-worded reason passes through verbatim', () => {
    expect(settlementReasonText('something the server said', en)).toBe('something the server said');
  });
});

// ── it. 34 — the receipt SAYS «mined without effect», with the code ───────────
describe('it. 34 — MINED_NO_EFFECT reads as a sentence, never as a code', () => {
  it('single call: fee spent, nothing moved, the Kinetic code by name, re-read before signing again', () => {
    const said = settlementReasonText('MINED_NO_EFFECT:COMPOUND:9:45:0', en)!;
    expect(said).toMatch(/was mined and the network fee was spent/);
    expect(said).toMatch(/nothing moved/);
    expect(said).toMatch(/Kinetic code 9 · MATH_ERROR/);
    expect(said).toMatch(/Re-read your position before signing again/);
    expect(said).not.toContain('MINED_NO_EFFECT');
    expect(said).not.toMatch(/do NOT sign this again/); // nothing before it went through
  });

  it('batch step 2: the steps before it went through — do NOT sign again', () => {
    const said = settlementReasonText('MINED_NO_EFFECT:COMPOUND:3:7:4:STEP:2', en)!;
    expect(said).toMatch(/COMPTROLLER_REJECTION/);
    expect(said).toMatch(/do NOT sign this again, it would repeat them/);
  });

  it('an unknown Compound code still reads, numbered', () => {
    expect(settlementReasonText('MINED_NO_EFFECT:COMPOUND:42:0:0', en)).toMatch(/Kinetic code 42 · COMPOUND_ERROR_42/);
  });
});

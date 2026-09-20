/**
 * councilEmitReport — what the council inbox may do with an emit's verdict, and
 * what its «unreported» panel may still offer.
 */

import type { ConfirmedSubmit } from './councilSigning';

export type EmitReportDecision =
  /** No hash, or the node refused it before any ledger: nothing to report
   *  (the row already shows the engine result). */
  | { kind: 'none' }
  /** Validated with tesSUCCESS — the only verdict `/submitted` may carry. */
  | { kind: 'report'; hash: string }
  /** Validated with a failure result: it APPLIED and FAILED. Nothing moved, the
   *  fee was charged and the Sequence spent — these signatures can never be
   *  broadcast again. Never reported; withdraw and compose again. */
  | { kind: 'failed-on-ledger'; hash: string; result: string }
  /** Accepted by a node, but no validated verdict (timed out, or validated
   *  without a result code): hold the hash so it can be registered once the
   *  ledger answers. Never reported automatically. */
  | { kind: 'hold'; hash: string };

export function decideEmitReport(
  res: Pick<ConfirmedSubmit, 'engine' | 'hash' | 'validated' | 'finalResult'>,
): EmitReportDecision {
  if (!res.hash) return { kind: 'none' };
  if (res.validated && res.finalResult === 'tesSUCCESS') return { kind: 'report', hash: res.hash };
  if (res.validated && typeof res.finalResult === 'string' && res.finalResult !== '') {
    return { kind: 'failed-on-ledger', hash: res.hash, result: res.finalResult };
  }
  // A node that refused it preliminarily never gets here validated (see
  // submitAndConfirm): the row's engine notice speaks for it, as before.
  if (res.engine !== 'tesSUCCESS') return { kind: 'none' };
  return { kind: 'hold', hash: res.hash };
}

/** The backend refusals of `/:id/submitted` that no retry can ever turn into a
 *  registration. */
export const FINAL_REPORT_REFUSALS = ['TX_FAILED_ON_LEDGER', 'TX_NOT_THIS_PROPOSAL'] as const;

export type UnreportedVoice = 'broadcast' | 'failed-on-ledger' | 'not-this-proposal';

/**
 * What the «unreported» panel says and offers, given the code the last report
 * was refused with (none = never reported, or refused for a reason a retry can
 * fix, e.g. TX_NOT_VALIDATED or a network error).
 */
export function unreportedPanel(refusalCode: string | null | undefined): {
  voice: UnreportedVoice;
  canRegister: boolean;
} {
  if (refusalCode === 'TX_FAILED_ON_LEDGER') return { voice: 'failed-on-ledger', canRegister: false };
  if (refusalCode === 'TX_NOT_THIS_PROPOSAL') return { voice: 'not-this-proposal', canRegister: false };
  return { voice: 'broadcast', canRegister: true };
}

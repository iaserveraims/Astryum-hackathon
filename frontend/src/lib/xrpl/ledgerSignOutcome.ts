/**
 * ledgerSignOutcome — the XRPL `sendIntent` rail, read to its end.
 *
 * `useXrplWalletPartner.sendIntent` returns when Xaman says «signed and
 * submitted». That is the WALLET's word: the transaction can still validate as
 * tec*, or not validate at all. The surfaces that sign through it (escrows, DEX
 * orders, recurring payments, the Legacy ceremony, the acta anchor) either
 * painted that word as done or, when a read failed, printed the error next to
 * the sign button — a second escrow, a second order, a second payment.
 *
 * `XamanSingleSign` already answers this with `singleSignVerdict`. This module
 * gives the SAME verdicts to the `sendIntent` surfaces and turns them into the
 * `SignFailureAction` every sign catch already speaks:
 *
 *   · validated tesSUCCESS          → resolves. The only success.
 *   · validated with another result → 'form': it applied, its fee and sequence
 *                                     are spent — prepare again, never re-sign
 *                                     the same payload.
 *   · no hash / not validated in time → 'unconfirmed', with the hash to check.
 *
 * Anything that is not a ledger verdict goes to `signFailureAction` untouched,
 * so a cancelled Xaman request still keeps its sign button.
 */

import { awaitValidation } from './councilSigning';
import { STALE_TX_MESSAGE, decideAfterSigned, decideAfterValidation, type SingleSignVerdict } from './singleSignVerdict';
import {
  applySignAction,
  signFailureAction,
  type SignFailureAction,
  type SignFailureHandlers,
} from '../wallet/signOutcome';

/** The same patience as `XamanSingleSign` before saying «we could not confirm». */
export const LEDGER_VALIDATION_TIMEOUT_MS = 60_000;

export const LEDGER_VERDICT = 'LEDGER_VERDICT';

export type LedgerVerdictError = Error & { code: typeof LEDGER_VERDICT; verdict: SingleSignVerdict };

export function ledgerVerdictError(verdict: SingleSignVerdict): LedgerVerdictError {
  // The message is inert on purpose: if this error ever reaches the plain text
  // classifier by mistake, it matches no «nothing left» pattern and lands on
  // 'unconfirmed' — the safe side.
  return Object.assign(new Error(`XRPL ledger verdict: ${verdict.kind}`), {
    code: LEDGER_VERDICT as typeof LEDGER_VERDICT,
    verdict,
  });
}

export function isLedgerVerdictError(e: unknown): e is LedgerVerdictError {
  const x = e as { code?: unknown; verdict?: unknown } | null;
  return x?.code === LEDGER_VERDICT && typeof x.verdict === 'object' && x.verdict !== null;
}

/** What a sign catch must do with a verdict the LEDGER gave. `null` = settled. */
export function ledgerVerdictAction(
  v: SingleSignVerdict,
  t: (s: string) => string,
): SignFailureAction | null {
  switch (v.kind) {
    case 'settled':
      return null;
    case 'failed-onchain':
      return {
        view: 'form',
        message: `${t('The ledger validated this transaction with a failure result, so it did not take effect and its network fee was charged. Prepare the operation again before signing.')} (${v.code})`,
      };
    case 'stale':
      // A pinned tx that can never validate (tefPAST_SEQ / tefMAX_LEDGER): the
      // same payload can only answer the same — prepare it again (it.11).
      return {
        view: 'form',
        message: `${t(STALE_TX_MESSAGE)} (${v.code})`,
      };
    case 'refused':
      return {
        view: 'review',
        message: `${t('The network refused this transaction before it entered a ledger. Nothing moved.')} (${v.code})`,
      };
    case 'unconfirmed':
    case 'await-validation':
      return { view: 'unconfirmed', txHash: v.txid, trace: null };
  }
}

/**
 * Ask the ledger about a hash Xaman returned. Resolves with the hash only on a
 * validated tesSUCCESS; throws a `LedgerVerdictError` for everything else.
 */
export async function confirmOnLedger(
  txHash: string | null | undefined,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const first = decideAfterSigned({ txid: txHash });
  if (first.kind !== 'await-validation') throw ledgerVerdictError(first);
  const r = await awaitValidation(first.txid, {
    timeoutMs: opts?.timeoutMs ?? LEDGER_VALIDATION_TIMEOUT_MS,
  });
  const v = decideAfterValidation({
    txid: first.txid,
    validated: r.validated,
    finalResult: r.finalResult,
    timedOut: r.timedOut,
  });
  if (v.kind !== 'settled') throw ledgerVerdictError(v);
  return v.txid;
}

/** `signFailureAction`, plus the verdicts `confirmOnLedger` throws. */
export function xrplSignFailureAction(
  e: unknown,
  handedToPartner: boolean,
  t: (s: string) => string,
): SignFailureAction {
  if (isLedgerVerdictError(e)) {
    // Only thrown after the hand-off. A settled verdict is never thrown; if one
    // ever is, not knowing is the safe reading.
    return ledgerVerdictAction(e.verdict, t) ?? { view: 'unconfirmed', trace: null };
  }
  return signFailureAction(e, handedToPartner, t);
}

/** The whole catch of an XRPL `sendIntent` + `confirmOnLedger` sign, once. */
export function applyXrplSignFailure(
  e: unknown,
  handedToPartner: boolean,
  t: (s: string) => string,
  ui: SignFailureHandlers,
): SignFailureAction {
  return applySignAction(xrplSignFailureAction(e, handedToPartner, t), ui);
}

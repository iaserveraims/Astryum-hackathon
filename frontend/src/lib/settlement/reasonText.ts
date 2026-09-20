'use client';

/**
 * settlementReasonText — settlement failure/stall REASONS travel as CODES and
 * become sentences only here (Fase 2b). Before this the tracker emitted
 * hardcoded Spanish prose under English headlines: both languages saw a mix,
 * in the most anxious moment of the flow.
 */

import { batchRevertedStep, compoundErrorName, isPartialBatchFailure, parseNoEffect } from './settlement';
import { classifyXrplResult } from '../xrpl/txResult';

export function settlementReasonText(
  reason: string | undefined,
  t: (s: string) => string,
): string | undefined {
  if (!reason) return undefined;
  const MAP: Record<string, string> = {
    BATCH_FAILED: 'The batch failed on the network — your money did not move.',
    NO_AUTOCONFIRM:
      'Your wallet does not let us confirm automatically — open it and check with the receipt below.',
    REVERTED:
      'The network rejected the transaction. Your money did not move; only the network fee was spent.',
    // The stalled HEADLINE already says this — no second sentence needed.
    STALLED_SLOW: '',
  };
  // batch-evm (2026-08-20) — THE SAME LIE AS THE SEQUENTIAL RAIL, ONE FILE OVER.
  // `evaluate5792` names the FIRST call whose receipt is not a success, and the
  // machine's own §1.1 says a bundle can be CONFIRMED with an individual call
  // reverted. With N>1 the calls before it ARE on the chain — and this sentence
  // said «nothing was applied», under the headline «The signed operation failed
  // on-chain», next to a sign button that re-sends `prereqs + txData`. That is
  // the approve paid twice and the supply paid twice.
  const stepN = batchRevertedStep(reason);
  if (stepN !== null) {
    return isPartialBatchFailure(reason)
      ? `${t('Batch step')} ${stepN} ${t('of the batch was rejected by the network. The steps before it already went through — do NOT sign this again, it would repeat them. Check the explorer and reload your position.')}`
      : `${t('Batch step')} ${stepN} ${t('of the batch was rejected by the network — nothing was applied.')}`;
  }
  // it. 34 — MINED WITHOUT EFFECT (a Compound-v2 code, Kinetic). The transaction
  // is on the chain and the wallet showed it green; the receipt is where the
  // person learns that the fee was spent and nothing moved. With the code by
  // name (MATH_ERROR = more than the position holds) and, in a batch, the same
  // «do NOT sign again» the reverted case says once earlier steps went through.
  const noEffect = parseNoEffect(reason);
  if (noEffect) {
    const code = `${t('Kinetic code')} ${noEffect.failure.error} · ${compoundErrorName(noEffect.failure.error)}`;
    const head = `${t('The transaction was mined and the network fee was spent, but the protocol refused the operation and nothing moved')} (${code}). ${t('Re-read your position before signing again — the amount may be larger than what it holds.')}`;
    return isPartialBatchFailure(reason)
      ? `${head} ${t('The steps before it already went through — do NOT sign this again, it would repeat them.')}`
      : head;
  }
  if (reason in MAP) return MAP[reason] ? t(MAP[reason]) : undefined;
  // XRPL habla en códigos (`tecUNFUNDED_PAYMENT`, `tefPAST_SEQ`…) y son
  // demasiados para una tabla. Lo que la persona necesita saber son DOS cosas,
  // y las da la clase: si costó dinero, y si es seguro volver a intentarlo.
  // Un `tec` ocupa ledger y cobró fee; un `tef`/`tem`/`tel` no llegó a entrar y
  // no costó nada — decir «reintenta» sólo es honesto en el segundo caso.
  const xrplClass = classifyXrplResult(reason);
  if (xrplClass === 'failed-onchain') {
    return `${t('The ledger rejected it: it is on-chain and it charged the fee, but it did NOT go through.')} (${reason})`;
  }
  if (xrplClass === 'failed-never') {
    return `${t('The network never accepted it: it is not on the ledger and it cost nothing. You can compose it again.')} (${reason})`;
  }
  return reason; // pre-code or backend-worded reasons pass through
}

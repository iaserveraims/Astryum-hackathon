'use client';

/**
 * translateError — the ONE place a raw failure becomes a sentence (Fase 1).
 *
 * The audit found ~15 catch blocks doing `setError((e as Error).message)`:
 * MetaMask's "User rejected the request.", XRPL's tec-codes, revert strings
 * and literal "HTTP 500" all landed in the user's face, in English, in red.
 * Worst of all, a person's deliberate "no" rendered as a system failure.
 *
 * Contract:
 *  - `kind: 'user-rejection'` → the caller renders it CALM (no red, CTA kept).
 *  - `message` is already translated via the caller's `t`.
 *  - The raw error goes to console.error here, so no caller needs to keep it
 *    on screen to avoid losing the diagnostic.
 */

import { isUserRejection } from '../wallet/flareChain';

export interface TranslatedError {
  message: string;
  kind: 'user-rejection' | 'error';
}

/** The XRPL engine codes a user can actually hit, in plain language. */
const XRPL_CODES: Record<string, string> = {
  tecUNFUNDED_PAYMENT: 'Not enough XRP in the account for this payment.',
  tecUNFUNDED: 'Not enough XRP in the account for this payment.',
  tecINSUFFICIENT_RESERVE: 'The network keeps a minimum locked in every account and this would go below it.',
  tecNO_DST: 'The destination account does not exist on the network.',
  tecNO_DST_INSUF_XRP: 'The destination account does not exist yet — it needs a first deposit larger than this.',
  tecDST_TAG_NEEDED: 'The destination requires a tag and this payment carries none.',
  tecEXPIRED: 'This operation expired before reaching the network.',
  tecPATH_DRY: 'The network found no path to deliver this payment.',
  tefPAST_SEQ: 'This operation already ran or became stale.',
  tefMAX_LEDGER: 'This operation expired before the network confirmed it.',
  temREDUNDANT: 'This operation would change nothing, so the network refuses it.',
  tecNEED_MASTER_KEY: 'Only the account’s own master key can sign this operation.',
};

function rawText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  const e = err as { shortMessage?: string; message?: string; detail?: string; error?: string };
  return e.shortMessage ?? e.detail ?? e.message ?? e.error ?? String(err);
}

export function translateError(err: unknown, t: (s: string) => string): TranslatedError {
  console.error('[translateError]', err);
  const raw = rawText(err);

  // A "no" is a choice, not an error (EIP-1193 4001, Xaman decline, WebAuthn dismiss).
  if (
    isUserRejection(err) ||
    /user (rejected|cancelled|denied)|cancelled .*(signing|submission)|declined/i.test(raw) ||
    /not allowed by the user agent/i.test(raw)
  ) {
    return { kind: 'user-rejection', message: t('You cancelled the signature. Nothing moved — try again whenever you like.') };
  }

  // XRPL engine codes — say what happened, keep the code for support.
  const code = raw.match(/te[cmf][A-Z_]+/)?.[0];
  if (code && XRPL_CODES[code]) return { kind: 'error', message: `${t(XRPL_CODES[code])} (${code})` };

  // EVM revert: the chain refused; an atomic tx moved nothing but the fee.
  if (/execution reverted|revert/i.test(raw)) {
    return {
      kind: 'error',
      message: t('The network rejected the operation. Your money did not move; only the network fee was spent.'),
    };
  }

  // Connectivity / server: nothing was signed, nothing moved.
  if (/HTTP \d{3}|failed to fetch|networkerror|load failed|timeout|ECONN/i.test(raw)) {
    return {
      kind: 'error',
      message: t("We couldn't reach the server. Nothing was signed and nothing moved — try again in a minute."),
    };
  }

  // Backend detail strings that already speak plainly pass through when short
  // and jargon-free; everything else falls back to the honest generic.
  if (raw && raw.length <= 160 && !/[{}<>]|0x[0-9a-fA-F]{16,}|payload|calldata|nonce/i.test(raw)) {
    return { kind: 'error', message: raw };
  }
  return { kind: 'error', message: t('Something went wrong — try again in a minute.') };
}

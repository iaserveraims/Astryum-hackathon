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
import { describeRetryableRefusal } from '../xaman/seatRefusal';

export interface TranslatedError {
  message: string;
  kind: 'user-rejection' | 'error';
  /**
   * it. 23 (it. 22 §3.5) — THE FIELDS THIS TYPE USED TO THROW AWAY.
   *
   * The step-up's two 503s (`STEP_UP_UNAVAILABLE`, `ACCOUNT_BUSY`) are a failure
   * of OURS with a `Retry-After`, and they were flattened into «we couldn't
   * reach the server» by the `HTTP \d{3}` branch below: the sentence the route
   * wrote («that is us, not your signature»), the `retryable` and the seconds
   * all disappeared, so the screen showed a dead end over a wait of two seconds.
   * They travel now — the code for bookkeeping, never for rendering.
   */
  code?: string;
  /** Is asking again expected to work? Only ever true for a failure of ours. */
  retryable?: boolean;
  /** Seconds the server asked us to wait (`Retry-After`), when it said. */
  retryAfterSeconds?: number;
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

/**
 * The refusal envelope, from whichever shape the caller's client produced:
 * `ApiError` (services/api) names the code `code` and keeps no detail;
 * `jpost`/`jget` (services/v1Api) put the code in `message` and the prose in
 * `body.detail`. Both are read, so the same 503 says the same thing wherever it
 * was thrown. Nothing here renders a code — it only looks one up.
 */
function readRefusalShape(err: unknown): {
  status?: number;
  error?: string;
  code?: string;
  detail?: string;
  retryable?: boolean;
  retryAfterSeconds?: number;
  body?: Record<string, unknown>;
} {
  const e = (err ?? {}) as Record<string, unknown>;
  const body = (e.body ?? null) as Record<string, unknown> | null;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined;
  return {
    ...(num(e.status) !== undefined ? { status: num(e.status) } : {}),
    ...(str(e.code) ?? str(body?.code) ? { code: (str(e.code) ?? str(body?.code)) as string } : {}),
    // `message` counts as the code only when it IS one (jpost puts it there).
    ...(str(e.error) ?? str(body?.error) ? { error: (str(e.error) ?? str(body?.error)) as string } : {}),
    ...(str(e.detail) ?? str(body?.detail) ? { detail: (str(e.detail) ?? str(body?.detail)) as string } : {}),
    ...(typeof e.retryable === 'boolean' ? { retryable: e.retryable } : {}),
    ...(num(e.retryAfterSeconds) !== undefined ? { retryAfterSeconds: num(e.retryAfterSeconds) } : {}),
    ...(body ? { body } : {}),
  };
}

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

  /**
   * it. 23 (it. 22 §3.5) — OURS, NOT THE NETWORK'S, AND NOT YOUR SIGNATURE.
   *
   * BEFORE the connectivity branch, because `ApiError.message` is literally
   * «HTTP 503: Service Unavailable» and that regex swallowed every one of these:
   * a step-up our own database could not complete read on screen as «we couldn't
   * reach the server», which blames the network, drops the retry the route
   * promised in `Retry-After`, and — worst of the three — leaves the person
   * wondering whether their signature was the problem. One reader for the whole
   * family (`describeRetryableRefusal`), the same one every seat surface uses.
   */
  const refusal = describeRetryableRefusal(readRefusalShape(err), t);
  if (refusal) {
    return {
      kind: 'error',
      message: refusal.text,
      code: refusal.code,
      retryable: true,
      ...(refusal.retryAfterSeconds !== undefined ? { retryAfterSeconds: refusal.retryAfterSeconds } : {}),
    };
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

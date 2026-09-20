/**
 * passkeyRelayOutcome — how far a Face ID batch got, read from what the relay
 * answered.
 *
 * `usePasskeyActions.signAndRelay` is a sequence: read the account, sign the
 * challenge with the passkey, POST the signed batch to `/passkey/relay`. The
 * caller marks the hand-off right before that POST (`onHandOff`). After it, the
 * backend (route `POST /passkey/relay` + `PasskeyRelayService`) refuses BEFORE
 * the user's batch is broadcast with:
 *
 *   · 400 — input validation (BAD_*, EMPTY_BATCH, BATCH_TOO_LARGE,
 *           TARGET_NOT_ALLOWED);
 *   · 401 — no SIWE session (`missing_siwe_session`, or the auth middleware):
 *           answered before `relayPasskeyBatch` is ever called;
 *   · 409 — WOULD_REVERT, the staticCall preflight;
 *   · 429 — DEPLOY_LIMIT, the per-user cap on relayer-paid deploys, checked
 *           before anything is sent.
 *
 * Everything else once the signed batch left the browser — a 500 RELAY_FAILED
 * (it may have died waiting for the receipt), a 503 or a proxy 5xx, a dropped
 * connection — is unknown, and unknown is never offered a second Face ID.
 * (productizer-it6: 401/429 used to be painted amber and the button vanished
 * over a batch the relay had provably never sent.)
 */

import { signFailureAction, type SignFailureAction } from '../wallet/signOutcome';

export const PASSKEY_RELAY_REFUSED = 'PASSKEY_RELAY_REFUSED';

export type PasskeyRelayRefusalError = Error & { code: typeof PASSKEY_RELAY_REFUSED; status: number };

/** The error `signAndRelay` throws for a relay refusal — same message as always, plus the status. */
export function passkeyRelayRefusal(refusal: { status: number; error: string; detail?: string }): PasskeyRelayRefusalError {
  return Object.assign(new Error(`${refusal.error}${refusal.detail ? ` — ${refusal.detail}` : ''}`), {
    code: PASSKEY_RELAY_REFUSED as typeof PASSKEY_RELAY_REFUSED,
    status: refusal.status,
  });
}

/** The relay's statuses that are answered before anything is broadcast. 503 is
 *  NOT here: the route's gate answers it pre-broadcast, but so does the service
 *  for an unmapped code, so it proves nothing. */
const PRE_BROADCAST_STATUSES: readonly number[] = [400, 401, 409, 429];

/** True only when the relay's own answer proves the batch was never broadcast. */
export function relayNeverBroadcast(e: unknown): boolean {
  const x = e as { code?: unknown; status?: unknown } | null;
  return x?.code === PASSKEY_RELAY_REFUSED && PRE_BROADCAST_STATUSES.includes(x.status as number);
}

/** The sign-catch decision for a passkey batch. */
export function passkeyRelayFailureAction(
  e: unknown,
  handedOff: boolean,
  t: (s: string) => string,
): SignFailureAction {
  return signFailureAction(e, handedOff && !relayNeverBroadcast(e), t);
}

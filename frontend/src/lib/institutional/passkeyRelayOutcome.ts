/**
 * passkeyRelayOutcome — how far a Face ID batch got, read from what the relay
 * answered.
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

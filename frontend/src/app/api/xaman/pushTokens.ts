/**
 * The push-token bridge between Xaman and the backend.
 *
 * Xaman hands the app a `user_token` for a person the FIRST time that person
 * signs something the app created, and refreshes it on every later signature.
 * With it, the next sign request arrives as a PUSH on their phone; without it,
 * the only way in is a QR someone has to send them — which is what a family
 * quorum spread over days was doing until now.
 */

function apiBase(): string {
  return (
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001/api'
  ).replace(/\/$/, '');
}

/** Ask the backend to file the token Xaman issued for the signer of `payloadUuid`. */
export async function rememberPushToken(
  payloadUuid: string | undefined,
  authorization: string | null,
): Promise<void> {
  if (!payloadUuid || !authorization) return;
  try {
    await fetch(`${apiBase()}/xaman/push-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ payloadUuid }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* a lost token costs a QR, never a signature */
  }
}

export interface PushTokenLookup {
  /** Whose phone the request should ring. */
  address: string | undefined;
  /** The payload's `txjson.Account` — the account the request is about. */
  account: string | undefined;
  /** A multisign request (the council ceremony asking a co-signer). */
  multisign: boolean;
}

/** The token the backend allows for this request, or null (QR only). */
export async function lookupPushToken(
  lookup: PushTokenLookup,
  authorization: string | null,
): Promise<string | null> {
  const { address, account, multisign } = lookup;
  if (!address || !account || !authorization) return null;
  try {
    const qs = new URLSearchParams({ address, account, ...(multisign ? { multisign: '1' } : {}) });
    const res = await fetch(`${apiBase()}/xaman/push-tokens?${qs.toString()}`, {
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { userToken?: string | null };
    return typeof data.userToken === 'string' && data.userToken ? data.userToken : null;
  } catch {
    return null;
  }
}

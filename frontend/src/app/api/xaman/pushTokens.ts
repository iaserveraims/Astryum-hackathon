/**
 * The push-token bridge between Xaman and the backend.
 *
 * Xaman hands the app a `user_token` for a person the FIRST time that person
 * signs something the app created, and refreshes it on every later signature.
 * With it, the next sign request arrives as a PUSH on their phone; without it,
 * the only way in is a QR someone has to send them — which is what a family
 * quorum spread over days was doing until now.
 *
 * These helpers run server-side only (Next.js route handlers). The token never
 * reaches a browser: it is read here and put straight into the Xaman payload.
 * It is not a credential — only this app, holding its own API key and secret,
 * can use it, and it can neither sign nor move anything.
 *
 * Every failure is silent by design: no token, a dead backend or an expired row
 * just means the sign request falls back to its QR, which is always rendered.
 */

function apiBase(): string {
  return (
    process.env.BACKEND_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001/api'
  ).replace(/\/$/, '');
}

/** Store (or refresh) the token Xaman issued for `xrplAddress`. */
export async function rememberPushToken(
  xrplAddress: string | undefined,
  userToken: string | undefined,
  authorization: string | null,
): Promise<void> {
  if (!xrplAddress || !userToken || !authorization) return;
  try {
    await fetch(`${apiBase()}/xaman/push-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ xrplAddress, userToken }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    /* a lost token costs a QR, never a signature */
  }
}

/** The token for `xrplAddress`, or null when there is none (or it is stale). */
export async function lookupPushToken(
  xrplAddress: string | undefined,
  authorization: string | null,
): Promise<string | null> {
  if (!xrplAddress || !authorization) return null;
  try {
    const res = await fetch(
      `${apiBase()}/xaman/push-tokens?address=${encodeURIComponent(xrplAddress)}`,
      { headers: { Authorization: authorization }, signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { userToken?: string | null };
    return typeof data.userToken === 'string' && data.userToken ? data.userToken : null;
  } catch {
    return null;
  }
}

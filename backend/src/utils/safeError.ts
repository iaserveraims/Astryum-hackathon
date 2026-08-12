/**
 * safeErrorDetail — the only error text allowed into a response body.
 *
 * Raw `(e as Error).message` in a 500 body leaks infrastructure: ethers v6
 * embeds the whole request context in `message` (info={ requestUrl,
 * responseBody, … }), and rpcForChain builds RPC URLs with the Alchemy key in
 * the path (/v2/<key>) — so the key reaches the browser. This helper keeps the
 * DESCRIPTIVE part of the message and masks anything credential-shaped.
 *
 * Server-side logs are NOT the audience here: keep logging the full error;
 * sanitize only what goes into res.json.
 */

const ETHERS_MARKERS = ['requestUrl', 'responseBody', 'info='];

export function safeErrorDetail(err: unknown): string {
  let msg =
    err instanceof Error ? err.message : err === undefined || err === null ? 'unknown_error' : String(err);

  // ethers v6 appends the serialized request context after the human sentence —
  // cut at the first marker and keep only the descriptive part.
  let cutAt = -1;
  for (const marker of ETHERS_MARKERS) {
    const i = msg.indexOf(marker);
    if (i !== -1 && (cutAt === -1 || i < cutAt)) cutAt = i;
  }
  if (cutAt !== -1) msg = msg.slice(0, cutAt).replace(/[\s,([{"']+$/, '');

  msg = msg
    // Alchemy-style key-in-path (…/v2/<token>)
    .replace(/\/v2\/[A-Za-z0-9_-]{8,}/g, '/v2/***')
    // apikey= / api_key= / apiKey= query params
    .replace(/\b(api[_-]?key)=[^&\s"'\\]+/gi, '$1=***')
    // userinfo credentials in URLs (scheme://user:pass@host)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1***:***@');

  if (msg.length > 300) msg = `${msg.slice(0, 300)}…`;
  return msg;
}

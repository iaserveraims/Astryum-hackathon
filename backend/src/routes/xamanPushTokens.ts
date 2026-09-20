/**
 * Xaman push tokens — so a council member gets a NOTIFICATION, not a QR.
 *
 * Xaman only pushes a sign request to a phone when the payload carries that
 * person's `user_token`. The app receives one every time that person signs
 * something it created (`application.issued_user_token` in the payload result)
 * — and Astryum was throwing it away, so every signature in a family ceremony
 * meant scanning a QR, even for the member whose phone was already paired.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { kvGet, kvUpsert } from '../services/persistence/backgroundJobKv';
import { includesAddress, provenAddressesOf } from '../services/identity/provenAddresses';

const router = Router();

const JOB_TYPE = 'xaman-push-token';
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XAMAN_READ_TIMEOUT_MS = 5_000;

/** Xaman rotates the token as the user keeps signing; treat old ones as stale
 *  rather than wrong — a dead token just means the push silently doesn't land,
 *  and the QR is always rendered next to it. */
const TOKEN_TTL_DAYS = 30;
const TOKEN_TTL_MS = TOKEN_TTL_DAYS * 86_400_000;

const saveSchema = z.object({
  payloadUuid: z.string().trim().regex(UUID_RE, 'not a Xaman payload uuid'),
});

/** What the server reads back from Xaman — never what the client claims. */
export interface SignedPayloadRead {
  signed: boolean;
  account: string | null;
  userToken: string | null;
  resolvedAtMs: number | null;
}

/** GET the payload from Xaman with the server credentials; null = unreadable. */
async function readXamanPayload(uuid: string): Promise<SignedPayloadRead | null> {
  const apiKey = process.env.XAMAN_API_KEY;
  const apiSecret = process.env.XAMAN_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), XAMAN_READ_TIMEOUT_MS);
  try {
    const res = await fetch(`https://xumm.app/api/v1/platform/payload/${encodeURIComponent(uuid)}`, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      meta?: { signed?: unknown; resolved?: unknown };
      application?: { issued_user_token?: unknown };
      response?: { account?: unknown; resolved_at?: unknown };
    } | null;
    if (!data) return null;
    const account = typeof data.response?.account === 'string' ? data.response.account : null;
    const token = data.application?.issued_user_token;
    const resolvedAt = typeof data.response?.resolved_at === 'string' ? Date.parse(data.response.resolved_at) : NaN;
    return {
      signed: data.meta?.signed === true,
      account: account && XRPL_ADDRESS_RE.test(account) ? account : null,
      userToken: typeof token === 'string' && token.length >= 8 && token.length <= 200 ? token : null,
      resolvedAtMs: Number.isFinite(resolvedAt) ? resolvedAt : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// POST / { payloadUuid } — record the token Xaman issued to whoever signed it.
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  if (!req.siwe?.userId) return void res.status(401).json({ error: 'missing_session' });
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  if (!process.env.XAMAN_API_KEY || !process.env.XAMAN_API_SECRET) {
    return void res.status(503).json({ error: 'XAMAN_NOT_CONFIGURED' });
  }

  const read = await readXamanPayload(parsed.data.payloadUuid);
  if (!read) return void res.status(502).json({ error: 'XAMAN_READ_FAILED' });
  if (!read.signed) return void res.status(409).json({ error: 'PAYLOAD_NOT_SIGNED' });
  if (!read.account) return void res.status(422).json({ error: 'NO_SIGNING_ACCOUNT' });
  if (!read.userToken) return void res.json({ ok: true, stored: false, reason: 'NO_TOKEN_ISSUED' });

  const now = Date.now();
  const issuedAt = read.resolvedAtMs !== null && read.resolvedAtMs <= now ? read.resolvedAtMs : now;
  if (now - issuedAt > TOKEN_TTL_MS) return void res.json({ ok: true, stored: false, reason: 'STALE_PAYLOAD' });

  // Replaying an OLD signed payload must not overwrite the fresher token Xaman
  // rotated to since — that would only turn a working push back into a QR.
  const existing = await kvGet(JOB_TYPE, 'xrplAddress', read.account);
  const existingAt = typeof existing?.at === 'string' ? Date.parse(existing.at) : NaN;
  if (Number.isFinite(existingAt) && existingAt > issuedAt) {
    return void res.json({ ok: true, stored: false, reason: 'NEWER_TOKEN_ON_FILE' });
  }

  await kvUpsert(JOB_TYPE, 'xrplAddress', read.account, {
    xrplAddress: read.account,
    userToken: read.userToken,
    at: new Date(issuedAt).toISOString(),
  });
  return void res.json({ ok: true, stored: true });
}));

const lookupSchema = z.object({
  address: z.string().trim().regex(XRPL_ADDRESS_RE),
  account: z.string().trim().regex(XRPL_ADDRESS_RE),
  multisign: z.enum(['1', 'true', '0', 'false']).optional(),
});

/**
 * May this session push a sign request for `account` to `address`'s phone?
 *   - `address` is one of the session's own proven addresses → yes;
 *   - a MULTISIGN request, the session proves a seat in `account`'s SignerList
 *     and `address` holds another seat in it → yes (the council ceremony);
 *   - anything else, or a ledger we could not read → no.
 */
async function mayPushTo(
  req: Request,
  address: string,
  account: string,
  multisign: boolean,
): Promise<boolean> {
  const proven = await provenAddressesOf(req.siwe?.userId, req.siwe?.walletAddress);
  if (includesAddress(proven, address)) return true;
  if (!multisign) return false;
  try {
    const { xrplProvider } = await import('../integrations/providers/chain/XRPLProvider');
    const council = await xrplProvider.getSignerCouncil(account);
    const seats = (council?.signers ?? []).map((s) => s.account).filter(Boolean);
    if (seats.length === 0) return false;
    return seats.includes(address) && proven.some((p) => seats.includes(p));
  } catch {
    return false; // "could not read the SignerList" is never "you hold a seat"
  }
}

/**
 * GET /?address=r…&account=r…[&multisign=1] — the token for `address`, or null.
 *
 * Server-to-server: the Vercel payload route calls this with the caller's own
 * session, passing the payload's txjson.Account as `account`, and injects the
 * result into the Xaman payload.
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  if (!req.siwe?.userId) return void res.status(401).json({ error: 'missing_session' });
  const parsed = lookupSchema.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: 'INVALID_QUERY' });
  const { address, account } = parsed.data;
  const multisign = parsed.data.multisign === '1' || parsed.data.multisign === 'true';

  if (!(await mayPushTo(req, address, account, multisign))) {
    return void res.json({ userToken: null, stale: false });
  }
  const row = await kvGet(JOB_TYPE, 'xrplAddress', address);
  const token = typeof row?.userToken === 'string' ? row.userToken : null;
  const at = typeof row?.at === 'string' ? Date.parse(row.at) : NaN;
  const stale = Number.isFinite(at) && Date.now() - at > TOKEN_TTL_MS;
  return void res.json({ userToken: token && !stale ? token : null, stale: !!token && stale });
}));

export default router;

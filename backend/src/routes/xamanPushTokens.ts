/**
 * Xaman push tokens — so a council member gets a NOTIFICATION, not a QR.
 *
 * Xaman only pushes a sign request to a phone when the payload carries that
 * person's `user_token`. The app receives one every time that person signs
 * something it created (`application.issued_user_token` in the payload result)
 * — and Astryum was throwing it away, so every signature in a family ceremony
 * meant scanning a QR, even for the member whose phone was already paired.
 * Over a quorum spread across days that is the difference between "the app
 * asks you" and "someone has to send you a picture".
 *
 * What is stored: an opaque token that lets THIS app (holding its own API key
 * and secret) deliver a push to that user. It grants nothing to whoever holds
 * it — it is not a credential, it cannot sign, and it cannot move money. It
 * still never reaches a browser: the Vercel route reads it server-side and
 * puts it straight into the Xaman payload.
 *
 * Storage is the same background_jobs KV every other small persistent fact
 * uses: no migration, and losing the row only costs a QR.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { kvGet, kvUpsert } from '../services/persistence/backgroundJobKv';

const router = Router();

const JOB_TYPE = 'xaman-push-token';
const XRPL_ADDRESS_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

/** Xaman rotates the token as the user keeps signing; treat old ones as stale
 *  rather than wrong — a dead token just means the push silently doesn't land,
 *  and the QR is always rendered next to it. */
const TOKEN_TTL_DAYS = 30;

const saveSchema = z.object({
  xrplAddress: z.string().regex(XRPL_ADDRESS_RE, 'not an XRPL account (r…)'),
  userToken: z.string().trim().min(8).max(200),
});

// POST / — record (or refresh) the push token Xaman issued for this address.
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    return void res
      .status(400)
      .json({ error: 'INVALID_BODY', detail: parsed.error.issues.map((i) => i.message) });
  }
  const { xrplAddress, userToken } = parsed.data;
  await kvUpsert(JOB_TYPE, 'xrplAddress', xrplAddress, {
    xrplAddress,
    userToken,
    at: new Date().toISOString(),
  });
  return void res.json({ ok: true });
}));

/**
 * GET /?address=r… — the token for that address, or null.
 *
 * Server-to-server: the Vercel payload route calls this with the caller's own
 * session and injects the result into the Xaman payload. The value never
 * travels to a browser (see the route's comment).
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const address = String(req.query.address ?? '').trim();
  if (!XRPL_ADDRESS_RE.test(address)) {
    return void res.status(400).json({ error: 'INVALID_ADDRESS' });
  }
  const row = await kvGet(JOB_TYPE, 'xrplAddress', address);
  const token = typeof row?.userToken === 'string' ? row.userToken : null;
  const at = typeof row?.at === 'string' ? Date.parse(row.at) : NaN;
  const stale = Number.isFinite(at) && Date.now() - at > TOKEN_TTL_DAYS * 86_400_000;
  return void res.json({ userToken: token && !stale ? token : null, stale: !!token && stale });
}));

export default router;

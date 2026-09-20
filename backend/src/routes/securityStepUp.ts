import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireStepUp } from '../middleware/requireStepUp';
import {
  issueChallenge,
  verifyChallengeAndIssueGrant,
  STEP_UP_FEATURES,
  type StepUpFeature,
  type StepUpAction,
} from '../services/StepUpAuth';
import { getConfig, setConfig } from '../services/StepUpLockService';
import {
  isSessionRevoked,
  isTransactionBusy,
  respondBusyRetry,
  respondSessionRevoked,
} from '../services/identity/liveSession';

/**
 * /api/security/step-up — manage configurable step-up locks and run the
 * challenge → verify handshake that mints a grant.
 *
 * Mounted behind requireSiweAuth in index-simple.ts, so req.siwe is populated.
 */
const router = Router();

const featureEnum = z.enum(STEP_UP_FEATURES as [StepUpFeature, ...StepUpFeature[]]);
const actionEnum = z.enum(['read', 'write']);

// ── GET /config ──────────────────────────────────────────────────────────────
router.get('/config', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const config = await getConfig(userId);
  return res.json({ config, features: STEP_UP_FEATURES });
}));

// ── PUT /config ──────────────────────────────────────────────────────────────
// Tightening locks is itself protected once wallet_security:write is locked,
// so a stolen session can't silently re-arm/disarm the protections. The first
// write (before any lock exists) passes through — that's the bootstrap.
const lockCellSchema = z.object({ read: z.boolean(), write: z.boolean() });
const putConfigSchema = z.object({
  enabled: z.boolean().optional(),
  grantTtlSeconds: z.number().int().min(60).max(1800).optional(),
  matrix: z.record(featureEnum, lockCellSchema).optional(),
});

router.put(
  '/config',
  requireStepUp('wallet_security', 'write'),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = putConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
    }
    const userId = req.siwe!.userId;
    // Live-session check inside the write (4.1): see setConfig.
    try {
      const config = await setConfig(userId, parsed.data, req.siwe!);
      return res.json({ config });
    } catch (err) {
      // 401 WITH A BODY THE CLIENT CAN READ (3.7). The
      // client that calls this route logged the user out on ANY 401, so a
      // refusal meant to protect the matrix threw the person out of the app
      // instead of telling them what happened. The code is the one the rest of
      // the surface already knows (`session_revoked`) and the detail is the
      // English sentence to show in place — specific here, because the user is
      // looking at a security screen and deserves to know their locks are
      // untouched.
      if (isSessionRevoked(err)) {
        return respondSessionRevoked(
          res,
          'This session is no longer valid — it was signed out, or the account was taken over by its verified ' +
            'owner. Your step-up locks were NOT changed and still stand exactly as they were. Sign in again to ' +
            'edit them.',
        );
      }
      // Contention with the takeover's long transaction is a WAIT, not a fault:
      // 503 «try again» (3.6), never a 500 that reads as «we broke».
      if (isTransactionBusy(err)) return respondBusyRetry(res);
      throw err;
    }
  })
);

/**
 * «NO PUDE LEER» IS NOT
 * A VERDICT ABOUT YOUR SIGNATURE.
 *
 * Both handshake routes used to end in `err?.code ?? 'verification_failed'` with
 * a 4xx, so a database that could not answer (the config read, the binding read)
 * came back as 422 «your signature did not verify» — a refusal aimed at the
 * person, for something that was ours, on the door that guards their locks. The
 * codes these services throw are enumerated; ONLY those are a verdict about the
 * request. Contention answers 503 ACCOUNT_BUSY like everywhere else, and
 * anything else answers a retryable 503 that says so plainly.
 */
const CHALLENGE_REFUSAL_CODES = new Set(['invalid_address']);
const VERIFY_REFUSAL_CODES = new Set([
  'invalid_address',
  'nonce_unknown',
  'nonce_expired',
  'nonce_mismatch',
  'signature_invalid',
  'wallet_not_linked',
]);

const STEP_UP_UNAVAILABLE_DETAIL =
  'We could not complete the security check just now — that is us, not your signature, and nothing was changed ' +
  'or granted. Try again in a moment.';

/**
 * The challenge door now has a per-user cap (StepUpAuth). A
 * caller over it is not wrong and is not broken: it is early. 429 with a real
 * `Retry-After`, `retryable: true`, and a sentence that says nothing was changed
 * — never the 422 that would read as «your signature did not verify».
 */
const TOO_MANY_CHALLENGES_DETAIL =
  'Too many security checks were started from this account in a short time, so we paused new ones for a few ' +
  'minutes. Nothing was changed and nothing was granted, and any check you have already signed still works. ' +
  'Try again shortly.';

function respondTooManyChallenges(res: Response, err: unknown): Response {
  const raw = (err as { retryAfterSeconds?: unknown })?.retryAfterSeconds;
  const retryAfterSeconds = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 300;
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({
    error: 'TOO_MANY_STEP_UP_CHALLENGES',
    detail: TOO_MANY_CHALLENGES_DETAIL,
    retryable: true,
    retryAfterSeconds,
  });
}

function stepUpFailure(
  res: Response,
  err: unknown,
  verdictCodes: Set<string>,
  verdictStatus: 400 | 422,
  fallbackCode: string,
): Response {
  if (isSessionRevoked(err)) return respondSessionRevoked(res);
  if (isTransactionBusy(err)) return respondBusyRetry(res);
  const code = typeof (err as { code?: unknown })?.code === 'string' ? ((err as { code: string }).code) : '';
  if (verdictCodes.has(code)) return res.status(verdictStatus).json({ error: code, retryable: false });
  // Ours. Never dressed as the person's mistake, and never a raw chain on the wire.
  console.error(`[step-up] ${fallbackCode}:`, err);
  res.setHeader('Retry-After', '2');
  return res.status(503).json({ error: 'STEP_UP_UNAVAILABLE', detail: STEP_UP_UNAVAILABLE_DETAIL, retryable: true });
}

// ── POST /challenge ──────────────────────────────────────────────────────────
const challengeSchema = z.object({
  feature: featureEnum,
  action: actionEnum,
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'invalid EVM address'),
});

router.post('/challenge', async (req: Request, res: Response) => {
  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const userId = req.siwe!.userId;
  const { feature, action, address } = parsed.data;
  try {
    const challenge = issueChallenge(userId, feature, action as StepUpAction, address);
    return res.json(challenge);
  } catch (err: any) {
    // Over the per-user cap: 429 with its own sentence, before the generic
    // mapper turns it into a 503 that would promise a retry in two seconds.
    if (err?.code === 'too_many_challenges') return respondTooManyChallenges(res, err);
    return stepUpFailure(res, err, CHALLENGE_REFUSAL_CODES, 400, 'challenge_failed');
  }
});

// ── POST /verify ─────────────────────────────────────────────────────────────
const verifySchema = z.object({
  feature: featureEnum,
  action: actionEnum,
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/i, 'invalid EVM address'),
  nonce: z.string().min(1),
  message: z.string().min(1),
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/, 'signature must be 0x-hex'),
});

router.post('/verify', async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
  }
  const userId = req.siwe!.userId;
  const { feature, action, address, nonce, message, signature } = parsed.data;
  try {
    const { grantTtlSeconds } = await getConfig(userId);
    const grant = await verifyChallengeAndIssueGrant({
      userId,
      feature,
      action: action as StepUpAction,
      address,
      nonce,
      message,
      signature,
      ttlSeconds: grantTtlSeconds,
    });
    return res.json(grant);
  } catch (err: any) {
    return stepUpFailure(res, err, VERIFY_REFUSAL_CODES, 422, 'verification_failed');
  }
});

export default router;

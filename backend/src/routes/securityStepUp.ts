import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireStepUp } from '../middleware/requireStepUp';
import {
  issueChallenge,
  verifyChallengeAndIssueGrant,
  STEP_UP_FEATURES,
  type StepUpFeature,
  type StepUpAction,
} from '../services/StepUpAuth';
import { getConfig, setConfig } from '../services/StepUpLockService';

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
router.get('/config', async (req: Request, res: Response) => {
  const userId = req.siwe!.userId;
  const config = await getConfig(userId);
  return res.json({ config, features: STEP_UP_FEATURES });
});

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
  async (req: Request, res: Response) => {
    const parsed = putConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues });
    }
    const userId = req.siwe!.userId;
    const config = await setConfig(userId, parsed.data);
    return res.json({ config });
  }
);

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
    return res.status(400).json({ error: err?.code ?? 'challenge_failed' });
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
    return res.status(422).json({ error: err?.code ?? 'verification_failed' });
  }
});

export default router;

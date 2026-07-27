import { Router, Request, Response } from 'express';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { issueSessionForUser } from '../services/SiweAuth';
import { prisma } from '../database/prismaClient';
import {
  passkeyConfigured,
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
} from '../services/PasskeyService';

/**
 * /api/auth/passkey — WebAuthn login + device registration.
 *
 *   register/* : add a passkey to the CURRENT account (SIWE/JWT required)
 *   auth/*     : sign in with an existing passkey (public)
 *
 * A passkey is a login credential, never a DeFi signer.
 */
const router = Router();

function guard503(res: Response): boolean {
  if (!passkeyConfigured()) {
    res.status(503).json({ error: 'passkey_unavailable' });
    return true;
  }
  return false;
}

// ── Registration (logged-in) ────────────────────────────────────────────────
router.post('/register/options', requireSiweAuth, async (req: Request, res: Response) => {
  if (guard503(res)) return;
  const userId = req.siwe!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const userName = user?.email || `defibro-${userId.slice(0, 8)}`;
  try {
    const options = await getRegistrationOptions(userId, userName);
    return res.json(options);
  } catch (err: any) {
    return res.status(400).json({ error: err?.code ?? 'registration_options_failed' });
  }
});

router.post('/register/verify', requireSiweAuth, async (req: Request, res: Response) => {
  if (guard503(res)) return;
  const userId = req.siwe!.userId;
  const { response, deviceLabel } = req.body ?? {};
  if (!response) return res.status(400).json({ error: 'missing_response' });
  try {
    const result = await verifyRegistration(userId, response, deviceLabel);
    return res.json(result);
  } catch (err: any) {
    return res.status(422).json({ error: err?.code ?? 'registration_failed' });
  }
});

// ── Authentication (public login) ───────────────────────────────────────────
router.post('/auth/options', async (_req: Request, res: Response) => {
  if (guard503(res)) return;
  try {
    const { options, challengeId } = await getAuthenticationOptions();
    return res.json({ options, challengeId });
  } catch (err: any) {
    return res.status(400).json({ error: err?.code ?? 'auth_options_failed' });
  }
});

router.post('/auth/verify', async (req: Request, res: Response) => {
  if (guard503(res)) return;
  const { challengeId, response } = req.body ?? {};
  if (!challengeId || !response) return res.status(400).json({ error: 'missing_params' });
  try {
    const { userId } = await verifyAuthentication(challengeId, response);
    // Passkey accounts may have no wallet — issue a wallet-less session.
    const session = await issueSessionForUser(userId, null, {
      ipAddress: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    });
    await prisma.user.update({ where: { id: userId }, data: { lastLogin: new Date() } }).catch(() => undefined);
    return res.json({
      token: session.token,
      sessionId: session.sessionId,
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt,
      linkedWallets: session.linkedWallets,
    });
  } catch (err: any) {
    return res.status(422).json({ error: err?.code ?? 'authentication_failed' });
  }
});

export default router;

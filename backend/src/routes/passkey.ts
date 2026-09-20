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
  const userName = user?.email || `astryum-${userId.slice(0, 8)}`;
  try {
    const options = await getRegistrationOptions(userId, userName);
    return res.json(options);
  } catch (err: any) {
    return res.status(400).json({ error: err?.code ?? 'registration_options_failed' });
  }
});

router.post('/register/verify', requireSiweAuth, async (req: Request, res: Response) => {
  if (guard503(res)) return;
  const { userId, sessionId } = req.siwe!;
  const { response, deviceLabel } = req.body ?? {};
  if (!response) return res.status(400).json({ error: 'missing_response' });
  try {
    // sessionId: the credential is written only if THIS session is still alive
    // under the row lock — the auth check above ran before the WebAuthn window.
    const result = await verifyRegistration(userId, response, deviceLabel, sessionId);
    return res.json(result);
  } catch (err: any) {
    if (err?.code === 'session_revoked') return res.status(401).json({ error: 'session_revoked' });
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
    // The session is issued INSIDE the credential lock (PasskeyService): if an
    // account takeover deleted this passkey or moved the credential epoch while
    // the WebAuthn verification ran, nothing is issued.
    // Passkey accounts may have no wallet — issue a wallet-less session.
    const { issued: session } = await verifyAuthentication(challengeId, response, (tx, userId) =>
      issueSessionForUser(
        userId,
        null,
        { ipAddress: req.ip, userAgent: req.header('user-agent') ?? undefined },
        tx,
      ),
    );
    return res.json({
      token: session.token,
      sessionId: session.sessionId,
      walletAddress: session.walletAddress,
      expiresAt: session.expiresAt,
      linkedWallets: session.linkedWallets,
    });
  } catch (err: any) {
    const code = err?.code;
    if (code === 'credentials_changed' || code === 'credential_revoked' || code === 'account_disabled') {
      return res.status(401).json({ error: code });
    }
    return res.status(422).json({ error: code ?? 'authentication_failed' });
  }
});

export default router;

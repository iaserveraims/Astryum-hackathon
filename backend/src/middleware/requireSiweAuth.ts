import { Request, Response, NextFunction } from 'express';
import { verifyToken, type VerifiedToken } from '../services/SiweAuth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      siwe?: VerifiedToken;
    }
  }
}

/**
 * Middleware: validate Authorization: Bearer <jwt> + Session row in DB.
 * Populates req.siwe = { userId, sessionId, walletAddress }.
 *
 * Returns 401 with structured error code on failure.
 *
 * In dev, set ALLOW_NO_AUTH=1 to bypass (populates a dummy siwe context).
 */
export async function requireSiweAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (process.env.ALLOW_NO_AUTH === '1') {
    if (process.env.NODE_ENV === 'production') {
      // Hard fail in production — refuse to bypass auth (Sprint S1.3)
      res.status(500).json({ error: 'auth_bypass_blocked_in_production' });
      return;
    }
    // Even in dev-bypass mode, if a real account token is present, honor it so
    // each logged-in account stays isolated (otherwise every account would share
    // the synthetic 'dev-user' and inherit its wallets/data). Only token-less
    // (or the placeholder 'dev-bypass-no-jwt') requests fall back to dev-user.
    const devHeader = req.header('Authorization');
    const devToken =
      devHeader && devHeader.startsWith('Bearer ') ? devHeader.slice(7).trim() : '';
    if (devToken && devToken !== 'dev-bypass-no-jwt') {
      try {
        req.siwe = await verifyToken(devToken);
        return next();
      } catch {
        /* invalid/expired token in dev → fall back to dev-user below */
      }
    }
    req.siwe = {
      userId: 'dev-user',
      sessionId: 'dev-session',
      walletAddress: '0x0000000000000000000000000000000000000000',
    };
    return next();
  }

  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_bearer_token' });
    return;
  }
  const token = header.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'missing_bearer_token' });
    return;
  }
  try {
    const verified = await verifyToken(token);
    req.siwe = verified;
    next();
  } catch (err: any) {
    const code = err?.code ?? 'token_invalid';
    res.status(401).json({ error: code });
  }
}

/**
 * requireLegacyAccess — the server-side half of the Legacy gate (§1.3,
 * 2026-08-02).
 *
 * `hasLegacyToggleAccess` was a CLIENT hint only (its own header said "must
 * not guard any capital operation") and no council/cage route checked it:
 * with XRPL_DEFI_ENABLED=true, ANY authenticated session could compose
 * council orders by API. This middleware applies the SAME fail-closed
 * predicate the toggle uses (LEGACY_ENABLED global switch, else
 * LEGACY_ACCESS_EMAILS) to the COMPOSE surfaces server-side.
 *
 * Placement rules:
 *  · AFTER requireSiweAuth — it reads req.siwe.userId.
 *  · On prepare/relay/proposal surfaces, NEVER on read-only monitoring
 *    (invariant #5: /vault-state-style reads stay open).
 *
 * The userId→email read is cached 60s: the gate sits on human-paced compose
 * flows, but a ceremony's polling must not hammer the users table.
 */

import { Request, Response, NextFunction } from 'express';
import { hasLegacyToggleAccess, isLegacyEnabledForAll } from '../config/legacyAccess';

const CACHE_TTL_MS = 60_000;
const emailCache = new Map<string, { at: number; email: string | null }>();

export function __resetLegacyAccessGateForTests(): void {
  emailCache.clear();
}

export async function requireLegacyAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Dev bypass mirrors requireSiweAuth (and is equally refused in production
  // by requireSiweAuth itself, which runs first).
  if (process.env.ALLOW_NO_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    return next();
  }
  // Global switch: everyone with a session may operate Legacy — no DB read.
  if (isLegacyEnabledForAll()) return next();

  const userId = req.siwe?.userId;
  if (!userId) {
    res.status(401).json({ error: 'missing_siwe_session' });
    return;
  }
  try {
    let entry = emailCache.get(userId);
    if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
      const { prisma } = await import('../database/prismaClient');
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      entry = { at: Date.now(), email: user?.email?.toLowerCase() ?? null };
      emailCache.set(userId, entry);
    }
    if (!entry.email || !hasLegacyToggleAccess(entry.email)) {
      res.status(403).json({
        error: 'LEGACY_ACCESS_REQUIRED',
        detail: 'This account is not on the Legacy access list.',
      });
      return;
    }
    next();
  } catch {
    // FAIL-CLOSED: an account we cannot verify is not an authorized one.
    res.status(403).json({ error: 'LEGACY_ACCESS_REQUIRED', detail: 'access check failed' });
  }
}

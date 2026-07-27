import { Request, Response, NextFunction } from 'express';
import { verifyGrant, type StepUpFeature, type StepUpAction } from '../services/StepUpAuth';
import { isLocked } from '../services/StepUpLockService';

/**
 * requireStepUp(feature, action) — enforce a fresh wallet-signature grant when
 * the user has locked this (feature, action). Global kill-switch via
 * STEP_UP_ENABLED so the whole system is inert until explicitly turned on.
 *
 * Reads userId from BOTH auth contexts: requireSiweAuth populates req.siwe,
 * while legacy routers (moneyflows, strategies) populate req.user. The grant is
 * supplied by the client in the X-StepUp-Grant header.
 *
 * Must be mounted AFTER the auth middleware that populates the context.
 */
export function requireStepUp(feature: StepUpFeature, action: StepUpAction) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.STEP_UP_ENABLED !== '1') return next();

    const userId =
      req.siwe?.userId ?? (req as any).user?.id ?? 'dev-user';

    let locked: boolean;
    try {
      locked = await isLocked(userId, feature, action);
    } catch {
      // Fail-open on config read errors — never brick the app over a lock check.
      return next();
    }
    if (!locked) return next();

    const grant = req.header('X-StepUp-Grant');
    if (grant) {
      const verified = verifyGrant(grant, feature, action);
      if (verified.ok && verified.userId === userId) return next();
    }

    res.status(403).json({
      error: 'step_up_required',
      code: 'STEP_UP_REQUIRED',
      feature,
      action,
    });
  };
}

/**
 * stepUpGuard(feature) — one-liner that derives the action from the HTTP method
 * (GET/HEAD → read, everything else → write) so a whole router can be protected
 * with a single router.use(). Mount AFTER the auth middleware that populates the
 * request context.
 */
export function stepUpGuard(feature: StepUpFeature) {
  return (req: Request, res: Response, next: NextFunction) => {
    const action: StepUpAction =
      req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write';
    return requireStepUp(feature, action)(req, res, next);
  };
}

/**
 * stepUpWriteGuard(feature) — protects only mutating methods; reads pass through
 * untouched. Lets write-locks ship before the read-protection UX exists.
 */
export function stepUpWriteGuard(feature: StepUpFeature) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }
    return requireStepUp(feature, 'write')(req, res, next);
  };
}

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
      // A FAILED READ WAS GRANTING THE PERMISSION.
      // «Never brick the app» was the right instinct in the wrong place: an
      // unreadable lock table let someone edit the very protection they could
      // not be shown to have, so a failed read stopped granting and started
      // refusing.
      //
      // THE RADIUS IN THAT COMMENT WAS WRONG, AND THE CORRECTION
      // MATTERS. It claimed «the only door this guards is the one that CHANGES
      // the step-up matrix». It is not. With STEP_UP_ENABLED=1 this middleware
      // also sits in front of four whole routers, reads included, mounted with
      // `stepUpGuard` in index-simple.ts:
      //
      //   · /api/wallets/bindings   (stepUpGuard('wallet_security'))
      //   · /api/rules              (stepUpGuard('rules_alerts'))
      //   · /api/moneyflows         (stepUpGuard('rules_alerts'))
      //   · /api/alerts             (stepUpGuard('rules_alerts'))
      //
      // plus PUT /api/security/step-up/config, the matrix door proper
      // (requireStepUp('wallet_security', 'write')). So a lock table we cannot
      // read was answering 503 to GET /api/wallets/bindings — the list of the
      // addresses this account has proven — and to the rules, moneyflows and
      // alerts that watch someone's capital. «No pude leer» turned into «you
      // may not look at your own money».
      //
      // SO THE FAIL-CLOSED IS NARROWED TO WRITES, AND ONLY WRITES.
      //   · a WRITE still refuses: it changes something, and the protection we
      //     cannot read may be exactly the one that should have stopped it. A
      //     write that does not happen costs a retry, nothing more;
      //   · a READ passes through: a GET changes nothing, undoes nothing and
      //     signs nothing, so refusing it buys no safety — it only hides a
      //     person's own bindings, rules and alerts from them during an outage
      //     of OUR database. The protection it would have enforced is a
      //     confidentiality preference on a surface the session already
      //     authenticates; the cost of getting it wrong in the other direction
      //     is someone who cannot see their capital in the moment they most
      //     need to. Not a trade we make.
      //
      // This is the same rule the exit paths already follow: our failure to
      // read never becomes the user's cage. If a READ lock ever has to hold a
      // real secret, it needs its own middleware with its own argument — not a
      // silent flip back to closed here.
      if (action === 'read') return next();
      res.status(503).json({
        error: 'STEP_UP_LOCK_UNREADABLE',
        retryable: true,
        detail:
          'We could not read your step-up locks just now, so we cannot tell whether this change needs a fresh ' +
          'wallet signature — and we will not assume it does not. Nothing was changed, and nothing you can only ' +
          'read is affected. Try again in a moment.',
      });
      return;
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
 *
 * Mounted on /api/wallets/bindings, /api/rules, /api/moneyflows and
 * /api/alerts (index-simple.ts). That is the real radius of this file: four
 * capital-adjacent routers, reads included — which is why an unreadable lock
 * table fails closed only on the write half (see `requireStepUp`).
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

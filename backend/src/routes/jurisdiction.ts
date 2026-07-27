/**
 * Jurisdiction routes (CLAUDE.md invariant #5) — public.
 *   GET /api/jurisdiction/modules?region=XX → which app modules are available.
 * Monitoring/fiat/tax are always available; only DeFi execution is geofenceable.
 */
import { Router, Request, Response } from 'express';
import { jurisdictionService } from '../services/JurisdictionService';

const router = Router();

router.get('/modules', (req: Request, res: Response) => {
  const region = (req.query.region as string) || (req.header('x-region') ?? null);
  return res.json(jurisdictionService.availableModules(region));
});

export default router;

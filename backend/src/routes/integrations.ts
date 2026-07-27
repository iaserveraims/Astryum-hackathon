import { Router, Request, Response } from 'express';
import { controlPlane } from '../control-plane/ControlPlane';
import { providerRouter } from '../control-plane/ProviderRouter';
import { allChainCapabilities } from '../integrations/registry/ChainRegistry';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  return res.json({ providers: controlPlane.listIntegrations() });
});

// Capability matrix per chain (audit P2-3): discovery/balances/positions/prepare/
// sign/reconcile. The UI consumes this instead of a single `enabled` flag so the
// support frontier is honest (never claims "supported" for balance-only chains).
router.get('/chains/capabilities', (_req: Request, res: Response) => {
  return res.json({ chains: allChainCapabilities() });
});

router.get('/by-capability/:capability', (req: Request, res: Response) => {
  const cap = req.params.capability;
  if (!cap) return res.status(400).json({ error: 'missing_capability' });
  return res.json({ capability: cap, providers: controlPlane.byCapability(cap) });
});

router.get('/:id', (req: Request, res: Response) => {
  const summary = controlPlane.getIntegration(req.params.id);
  if (!summary) return res.status(404).json({ error: 'not_found' });
  return res.json(summary);
});

router.post('/:id/probe', async (req: Request, res: Response) => {
  const health = await controlPlane.probe(req.params.id);
  return res.json({ id: req.params.id, health });
});

router.get('/control-plane/stats', (_req: Request, res: Response) => {
  return res.json(providerRouter.getStats());
});

export default router;

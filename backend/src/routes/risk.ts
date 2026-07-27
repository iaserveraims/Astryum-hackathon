import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { RiskEngine } from '../engines/risk/RiskEngine';
import { registry } from '../integrations/registry/IntegrationRegistry';
import { bootstrapRegistry } from '../integrations/registry/bootstrap';
import type { CanonicalRisk } from '../canonical/types/Risk';
import { requireSiweAuth } from '../middleware/requireSiweAuth';
import { riskInboxService } from '../services/RiskInboxService';
import { resistanceLayerService } from '../services/ResistanceLayerService';
import { PositionPerformanceService } from '../services/PositionPerformanceService';

const router = Router();
const engine = RiskEngine.getInstance();

const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid_wallet');
const chainIdSchema = z.coerce.number().int().positive().default(14);

const portfolioQuery = z.object({
  address: evmAddress,
  chainId: chainIdSchema,
});

router.get('/portfolio', async (req: Request, res: Response) => {
  const parsed = portfolioQuery.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  try {
    const snapshot = await engine.getPortfolioRisk(
      parsed.data.address,
      parsed.data.chainId
    );
    return res.json(snapshot);
  } catch (err) {
    return res.status(500).json({
      error: 'risk_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

const positionQuery = z.object({
  address: evmAddress,
  chainId: chainIdSchema,
});

router.get('/positions/:positionId', async (req: Request, res: Response) => {
  const parsed = positionQuery.safeParse(req.query);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  try {
    const snapshot = await engine.getPositionRisk(
      parsed.data.address,
      parsed.data.chainId,
      req.params.positionId
    );
    if (!snapshot) {
      return res.status(404).json({ error: 'position_not_found' });
    }
    return res.json(snapshot);
  } catch (err) {
    return res.status(500).json({
      error: 'risk_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// C2 — net P&L + debt growth for a position, derived from its PositionSnapshot
// history (first = entry cost-basis, latest = now). Honest empty-state
// (available:false) until a live position has been snapshotted at least twice.
router.get('/positions/:positionId/performance', async (req: Request, res: Response) => {
  try {
    const perf = await PositionPerformanceService.compute(req.params.positionId);
    return res.json(perf);
  } catch (err) {
    return res.status(500).json({
      error: 'performance_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

const marketDropSchema = z.object({
  address: evmAddress,
  chainId: chainIdSchema,
  dropPct: z.number().positive().lt(100),
  asset: z.string().optional(),
});

router.post('/simulate-market-drop', async (req: Request, res: Response) => {
  const parsed = marketDropSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const result = await engine.simulateMarketDrop(
      parsed.data.address,
      parsed.data.chainId,
      parsed.data.dropPct,
      parsed.data.asset
    );
    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: 'simulate_drop_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get('/canonical', async (req: Request, res: Response) => {
  const parsed = portfolioQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  bootstrapRegistry();
  const provider = registry.get('engine-risk');
  if (!provider) {
    return res.status(503).json({ error: 'engine_risk_unavailable' });
  }
  try {
    const result = await provider.call<unknown, CanonicalRisk>(
      'engine.risk.getCanonicalRisk',
      { wallet: parsed.data.address, chainId: parsed.data.chainId },
      { traceId: randomUUID() },
    );
    return res.json({ risk: result.data, source: result.source });
  } catch (err) {
    return res.status(500).json({
      error: 'canonical_risk_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ─── D8 · Risk Inbox + Resistance Layer (SIWE-gated) ─────────────────────────

router.get('/inbox', requireSiweAuth, async (req: Request, res: Response) => {
  try {
    const items = await riskInboxService.list(req.siwe!.userId);
    return res.json({ success: true, data: { items, total: items.length } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'INBOX_FAILED', detail: (err as Error).message });
  }
});

router.post('/inbox/:id/ack', requireSiweAuth, async (req: Request, res: Response) => {
  const ok = await riskInboxService.acknowledge(req.params.id, req.siwe!.userId);
  if (!ok) return res.status(404).json({ success: false, error: 'ITEM_NOT_FOUND' });
  return res.json({ success: true });
});

router.post('/assess', requireSiweAuth, (req: Request, res: Response) => {
  const { fromChainId, toChainId, asset } = req.body ?? {};
  if (fromChainId == null || toChainId == null || !asset) {
    return res.status(400).json({ error: 'MISSING_FIELDS', required: ['fromChainId', 'toChainId', 'asset'] });
  }
  return res.json({ data: resistanceLayerService.assess(req.body) });
});

export default router;

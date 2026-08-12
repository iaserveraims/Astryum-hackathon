import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { safeErrorDetail } from '../utils/safeError';
import { PortfolioEngine } from '../engines/portfolio/PortfolioEngine';
import { registry } from '../integrations/registry/IntegrationRegistry';
import { bootstrapRegistry } from '../integrations/registry/bootstrap';
import type { CanonicalPosition } from '../canonical/types/Position';

const router = Router();
const engine = PortfolioEngine.getInstance();

// Accept addresses from every supported chain (EVM, Aptos, Bitcoin, XRPL,
// Stellar, Algorand, Solana). The engine routes by address shape, so a single
// endpoint serves every linked wallet's chain.
const ADDRESS_RES = [
  /^0x[a-fA-F0-9]{40}$/,                                   // EVM
  /^0x[a-fA-F0-9]{1,64}$/,                                 // Aptos (Move 32-byte)
  /^(bc1[a-z0-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/,// Bitcoin
  /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/,                        // XRPL
  /^G[A-Z2-7]{55}$/,                                       // Stellar
  /^[A-Z2-7]{58}$/,                                        // Algorand
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,                         // Solana (base58)
];
const evmAddress = z
  .string()
  .refine((a) => ADDRESS_RES.some((re) => re.test(a)), 'invalid_wallet');
const chainIdSchema = z.coerce.number().int().positive().default(14);

const querySchema = z.object({
  address: evmAddress,
  chainId: chainIdSchema,
  // Pass includeExternal=false to skip Zerion/DeBank. Default: true (when API key set).
  includeExternal: z.string().optional().transform((v) => v !== 'false' && v !== '0'),
});

const bodySnapshotSchema = z.object({
  address: evmAddress,
  chainId: chainIdSchema,
  includeExternal: z.boolean().optional().default(true),
});

function serialise(snapshot: unknown): unknown {
  return JSON.parse(
    JSON.stringify(snapshot, (_k, v) =>
      typeof v === 'bigint' ? v.toString() : v
    )
  );
}

router.get('/', async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_query',
      issues: parsed.error.issues,
    });
  }
  try {
    const snapshot = await engine.getPortfolio(
      parsed.data.address,
      parsed.data.chainId,
      { includeExternal: parsed.data.includeExternal },
    );
    return res.json(serialise(snapshot));
  } catch (err) {
    return res.status(500).json({
      error: 'portfolio_failed',
      message: safeErrorDetail(err),
    });
  }
});

router.get('/snapshot/latest', async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_query',
      issues: parsed.error.issues,
    });
  }
  try {
    const snapshot = await engine.getLatestSnapshot(
      parsed.data.address,
      parsed.data.chainId
    );
    return res.json(serialise(snapshot));
  } catch (err) {
    return res.status(500).json({
      error: 'latest_snapshot_failed',
      message: safeErrorDetail(err),
    });
  }
});

router.post('/snapshot', async (req: Request, res: Response) => {
  const parsed = bodySnapshotSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_body',
      issues: parsed.error.issues,
    });
  }
  try {
    const snapshot = await engine.getPortfolio(
      parsed.data.address,
      parsed.data.chainId,
      { forceRefresh: true, persist: true, includeExternal: parsed.data.includeExternal },
    );
    return res.status(201).json(serialise(snapshot));
  } catch (err) {
    return res.status(500).json({
      error: 'snapshot_create_failed',
      message: safeErrorDetail(err),
    });
  }
});

router.get('/breakdown', async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_query',
      issues: parsed.error.issues,
    });
  }
  try {
    const breakdown = await engine.getBreakdown(
      parsed.data.address,
      parsed.data.chainId
    );
    return res.json(serialise(breakdown));
  } catch (err) {
    return res.status(500).json({
      error: 'breakdown_failed',
      message: safeErrorDetail(err),
    });
  }
});

const historySchema = querySchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

router.get('/history', async (req: Request, res: Response) => {
  const parsed = historySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'invalid_query',
      issues: parsed.error.issues,
    });
  }
  try {
    const rows = await engine.getHistory(
      parsed.data.address,
      parsed.data.chainId,
      parsed.data.from,
      parsed.data.to
    );
    return res.json({
      address: parsed.data.address,
      chainId: parsed.data.chainId,
      from: parsed.data.from?.toISOString(),
      to: parsed.data.to?.toISOString(),
      count: rows.length,
      points: rows.map((r) => ({
        takenAt: r.takenAt.toISOString(),
        totalUSD: r.totalUSD,
      })),
    });
  } catch (err) {
    return res.status(500).json({
      error: 'history_failed',
      message: safeErrorDetail(err),
    });
  }
});

router.get('/canonical', async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  bootstrapRegistry();
  const provider = registry.get('engine-portfolio');
  if (!provider) {
    return res.status(503).json({ error: 'engine_portfolio_unavailable' });
  }
  try {
    const result = await provider.call<unknown, CanonicalPosition[]>(
      'engine.portfolio.getCanonicalPositions',
      { wallet: parsed.data.address, chainId: parsed.data.chainId },
      { traceId: randomUUID() },
    );
    return res.json({ positions: result.data, source: result.source });
  } catch (err) {
    return res.status(500).json({
      error: 'canonical_portfolio_failed',
      message: safeErrorDetail(err),
    });
  }
});

export default router;

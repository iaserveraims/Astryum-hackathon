import { Router, Request, Response } from 'express';
import { ProtocolRegistry } from '../connectors/protocols/ProtocolRegistry';
import { registerFlareAdapters } from '../connectors/protocols/adapters';
import { ProtocolInactiveError } from '../connectors/protocols/IProtocolAdapter';
import { controlPlane } from '../control-plane/ControlPlane';
import { randomUUID } from 'crypto';
import type { CanonicalPosition } from '../canonical/types/Position';
import { positionScanService } from '../services/PositionScanService';
import type { ScannedLendingPosition } from '../services/PositionScanService';
import {
  positionPersistenceEnabled,
  positionPersistenceService,
  type PersistScanOutcome,
} from '../services/PositionPersistenceService';

const router = Router();
const registry = ProtocolRegistry.getInstance();

let bootstrapped = false;
function ensureAdapters(): void {
  if (bootstrapped) return;
  registerFlareAdapters(registry);
  bootstrapped = true;
}

function isValidEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

const FLARE_CHAIN_ID = 14;

/**
 * GET /api/positions/scan?wallet=0x...&chainId=1
 * GET /api/positions/scan?wallet=0x...&chainIds=1,42161,8453,137,10,14
 *
 * Reads the wallet's open lending positions DIRECTLY on-chain. No 3rd-party
 * indexer. Accepts either a single chainId or a comma-separated list of
 * chainIds to fan-out across multiple chains in parallel.
 *
 * Returns: { wallet, chainIds[], positions[], errors[] } so partial results
 * render in the UI even if one chain's RPC is down. This route is read-only
 * and never broadcasts.
 *
 * Registered BEFORE `/canonical` and `/:wallet` to win the route match.
 */
router.get('/scan', async (req: Request, res: Response) => {
  const wallet = String(req.query.wallet ?? '');
  if (!isValidEvmAddress(wallet)) {
    return res.status(400).json({ error: 'invalid_wallet' });
  }

  // Accept either chainId= (single) or chainIds=1,42161,... (multi)
  let chainIds: number[];
  if (req.query.chainIds) {
    chainIds = String(req.query.chainIds)
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } else {
    const single = Number(req.query.chainId ?? NaN);
    chainIds = Number.isFinite(single) && single > 0 ? [single] : [];
  }

  if (chainIds.length === 0) {
    return res.status(400).json({ error: 'invalid_chainId' });
  }

  // Fan-out: scan each chain in parallel. Each chain's failure stays scoped to
  // that chain so a single-chain RPC outage doesn't drop the whole response.
  const results = await Promise.allSettled(
    chainIds.map((cid) => positionScanService.scanWalletOnChain(wallet, cid)),
  );

  const positions: unknown[] = [];
  const lpPositions: unknown[] = [];
  const rawScans: ScannedLendingPosition[] = [];
  const errors: Array<{ chainId: number; protocolSlug?: string; message: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const cid = chainIds[i];
    const r = results[i];
    if (r.status === 'fulfilled') {
      for (const p of r.value.positions) {
        positions.push({ ...p, healthFactor: Number.isFinite(p.healthFactor) ? p.healthFactor : null });
        rawScans.push(p);
      }
      for (const lp of r.value.lpPositions ?? []) {
        lpPositions.push(lp);
      }
      for (const e of r.value.errors) {
        errors.push({ chainId: cid, ...e });
      }
    } else {
      errors.push({ chainId: cid, message: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    }
  }

  // Pipeline 2.6 (Opción A) — snapshot the aggregated scan so the historical
  // P&L / debt-growth series builds up. Best-effort AND flag-gated
  // (POSITION_PERSISTENCE_ENABLED, off by default): the scan stays a pure
  // read when the flag is off, and a persistence failure never breaks it.
  let persistence: ({ enabled: true } & PersistScanOutcome) | undefined;
  if (positionPersistenceEnabled() && rawScans.length > 0) {
    try {
      const outcome = await positionPersistenceService.persistScan(req.siwe?.userId, rawScans);
      persistence = { enabled: true, ...outcome };
    } catch (err) {
      persistence = {
        enabled: true,
        persisted: 0,
        skipped: [{ protocolSlug: '*', reason: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  return res.json({ wallet, chainIds, positions, lpPositions, errors, ...(persistence ? { persistence } : {}) });
});

/**
 * GET /api/positions/canonical?wallet=0x...
 * Router-driven aggregation across every protocol provider with
 * `protocol.discoverPositions`, returning CanonicalPosition[] with
 * per-provider SourceRecord preserved. Registered BEFORE `/:wallet` so the
 * literal segment wins over the dynamic param.
 */
router.get('/canonical', async (req: Request, res: Response) => {
  const wallet = String(req.query.wallet ?? '');
  if (!isValidEvmAddress(wallet)) {
    return res.status(400).json({ error: 'invalid_wallet' });
  }
  try {
    const r = await controlPlane.call<{ wallet: string; chainId?: number }, CanonicalPosition[]>(
      'engine.portfolio.getCanonicalPositionsViaRouter',
      { wallet, chainId: FLARE_CHAIN_ID },
      { traceId: randomUUID(), wallet },
    );
    return res.json({ wallet, chainId: FLARE_CHAIN_ID, positions: r.data, source: r.source });
  } catch (err) {
    return res
      .status(500)
      .json({ error: 'aggregate_failed', message: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /api/positions/:wallet
 * Aggregated raw positions across all active Flare adapters.
 */
router.get('/:wallet', async (req: Request, res: Response) => {
  ensureAdapters();
  const { wallet } = req.params;
  if (!isValidEvmAddress(wallet)) {
    return res.status(400).json({ error: 'invalid_wallet' });
  }

  const adapters = registry.getActiveAdapters(FLARE_CHAIN_ID);
  const settled = await Promise.allSettled(
    adapters.map(async (a) => ({
      protocolId: a.protocolId,
      positions: await a.discoverPositions(wallet),
    }))
  );

  const results = settled.map((r, i) => {
    const a = adapters[i];
    if (r.status === 'fulfilled') {
      return {
        protocolId: a.protocolId,
        positions: r.value.positions.map((p) => ({
          ...p,
          amount: p.amount.toString(),
        })),
      };
    }
    return {
      protocolId: a.protocolId,
      error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      positions: [],
    };
  });

  return res.json({
    wallet,
    chainId: FLARE_CHAIN_ID,
    activeAdapters: adapters.map((a) => a.protocolId),
    results,
    takenAt: new Date().toISOString(),
  });
});

/**
 * GET /api/positions/:protocol/:wallet
 * Single-adapter discovery. 503 protocol_inactive if env addresses missing.
 */
router.get('/:protocol/:wallet', async (req: Request, res: Response) => {
  ensureAdapters();
  const { protocol, wallet } = req.params;
  if (!isValidEvmAddress(wallet)) {
    return res.status(400).json({ error: 'invalid_wallet' });
  }
  const adapter = registry.getAdapter(protocol, FLARE_CHAIN_ID);
  if (!adapter) {
    return res.status(404).json({ error: 'unknown_protocol', protocol });
  }
  if (!adapter.isActive) {
    return res.status(503).json({
      error: 'protocol_inactive',
      protocol,
      hint: 'set required address env vars to activate',
    });
  }

  try {
    const positions = await adapter.discoverPositions(wallet);
    return res.json({
      wallet,
      chainId: FLARE_CHAIN_ID,
      protocol,
      positions: positions.map((p) => ({
        ...p,
        amount: p.amount.toString(),
      })),
      takenAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof ProtocolInactiveError) {
      return res
        .status(503)
        .json({ error: 'protocol_inactive', protocol });
    }
    return res.status(500).json({
      error: 'discover_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;

/**
 * Platform status — the "Astryum Orbit System" light the dashboard's summary
 * card reads (founder 2026-07-25): online by default; the founders can flip it
 * to offline from the admin panel with a hand-written reason (maintenance,
 * backend incident…) so users KNOW when we are working on the ship instead of
 * guessing why something stalls.
 *
 *   GET /api/platform/status   public — { state, reason, updatedAt }
 *   PUT /api/platform/status   founders only (adminPanel's requireAdmin: the
 *                              same static-key/session/allowlist doors) —
 *                              body { state: 'online'|'offline', reason? }
 *
 * Persistence: ONE row in the existing `configurations` KV table (key
 * `platform.status`) — no new model, no migration. A missing row or an
 * unreachable DB reads as online: the switch exists to ANNOUNCE work, not to
 * gate the app, so its failure mode must never invent an outage banner.
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../database/prismaClient';
import { requireAdmin } from './adminPanel';

const router = Router();

const KEY = 'platform.status';
const MAX_REASON_LENGTH = 300;

type PlatformState = 'online' | 'offline';
interface StoredStatus {
  state: PlatformState;
  reason?: string;
}

const DEFAULT_STATUS = { state: 'online' as PlatformState, reason: null, updatedAt: null };

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const row = await prisma.configuration.findUnique({ where: { key: KEY } });
    if (!row) {
      res.json(DEFAULT_STATUS);
      return;
    }
    const value = (row.value ?? {}) as Partial<StoredStatus>;
    res.json({
      state: value.state === 'offline' ? 'offline' : 'online',
      reason: typeof value.reason === 'string' && value.reason.trim() ? value.reason : null,
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch {
    // DB unreachable — see the header: never invent an outage.
    res.json(DEFAULT_STATUS);
  }
});

router.put('/status', requireAdmin, async (req: Request, res: Response) => {
  const { state, reason } = (req.body ?? {}) as { state?: unknown; reason?: unknown };
  if (state !== 'online' && state !== 'offline') {
    res.status(400).json({ error: 'INVALID_STATE' });
    return;
  }
  if (reason != null && typeof reason !== 'string') {
    res.status(400).json({ error: 'INVALID_REASON' });
    return;
  }
  const trimmed = typeof reason === 'string' ? reason.trim().slice(0, MAX_REASON_LENGTH) : '';
  // The reason only means something while offline — going back online clears it.
  const value: StoredStatus = state === 'offline' && trimmed ? { state, reason: trimmed } : { state };
  const row = await prisma.configuration.upsert({
    where: { key: KEY },
    create: { key: KEY, value: value as object, description: 'Astryum Orbit System light (admin-set)', isSystem: true },
    update: { value: value as object },
  });
  res.json({ state: value.state, reason: value.reason ?? null, updatedAt: row.updatedAt.toISOString() });
});

// ── Live activity — the public proof-of-life feed (founder 2026-07-26) ───────
//
// GET /api/platform/activity  public — { total, recent[], updatedAt }
//
// The counterweight to the sign-up risk disclaimer: anyone (no account, no
// auth) can see that operations REALLY execute through Astryum, each one
// verifiable on the public explorers. Source of truth: the 0xFE handoff rows
// the executor marked 'completed' (DirectMintHandoffStore.markHandoffExecuted)
// — real settled operations, never a mock.
//
// PRIVACY (aviso §3.2/§7): the payload row carries the user's xrplAddress and
// personalAccount — they are deliberately NOT returned. The feed publishes only
// what the chain already shows to anyone: tx hashes, amount, timestamp.
//
// Cheap by construction: public endpoint → 30s in-process cache, capped list,
// and a DB failure reads as an empty feed, never a 500 (same posture as
// /status: this route announces, it must not invent outages).

const ACTIVITY_CACHE_MS = 30_000;
const ACTIVITY_LIMIT = 20;

interface ActivityItem {
  at: string | null;
  xrp: number | null;
  xrplTxHash: string | null;
  flareTxHash: string | null;
}
interface ActivityFeed {
  total: number;
  recent: ActivityItem[];
  updatedAt: string;
}

let activityCache: { at: number; data: ActivityFeed } | null = null;

router.get('/activity', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (activityCache && now - activityCache.at < ACTIVITY_CACHE_MS) {
    res.json(activityCache.data);
    return;
  }
  try {
    const [rows, total] = await Promise.all([
      prisma.backgroundJob.findMany({
        where: { jobType: '0xfe-handoff', status: 'completed' },
        orderBy: { completedAt: 'desc' },
        take: ACTIVITY_LIMIT,
        select: { completedAt: true, payload: true, result: true },
      }),
      prisma.backgroundJob.count({ where: { jobType: '0xfe-handoff', status: 'completed' } }),
    ]);
    const recent: ActivityItem[] = rows.map((r) => {
      const p = (r.payload ?? {}) as { grossXrpDrops?: string };
      const x = (r.result ?? {}) as { xrplTxHash?: string; flareTxHash?: string };
      const drops = Number(p.grossXrpDrops);
      return {
        at: r.completedAt ? r.completedAt.toISOString() : null,
        xrp: Number.isFinite(drops) && drops > 0 ? drops / 1_000_000 : null,
        xrplTxHash: typeof x.xrplTxHash === 'string' ? x.xrplTxHash : null,
        flareTxHash: typeof x.flareTxHash === 'string' ? x.flareTxHash : null,
      };
    });
    const data: ActivityFeed = { total, recent, updatedAt: new Date().toISOString() };
    activityCache = { at: now, data };
    res.json(data);
  } catch {
    // DB unreachable — an empty feed, never an invented error banner.
    res.json({ total: 0, recent: [], updatedAt: new Date().toISOString() });
  }
});

export default router;

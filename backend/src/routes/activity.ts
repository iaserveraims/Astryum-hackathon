import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler';
import { activityService } from '../services/ActivityService';
import { xrplActivityService } from '../services/XrplActivityService';
import type { ActivityType } from '../canonical/types/ActivityEvent';

const router = Router();

// Two rails: EVM wallets read the Flarescan-backed cache, XRPL wallets read
// the ledger live via account_tx (XrplActivityService).
const EVM_WALLET_RE = /^0x[a-fA-F0-9]{40}$/;
const XRPL_WALLET_RE = /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/;

const ACTIVITY_TYPES: ReadonlyArray<ActivityType> = [
  'swap',
  'supply',
  'borrow',
  'repay',
  'withdraw',
  'stake',
  'unstake',
  'claim',
  'transfer',
  'approve',
  'addLiquidity',
  'removeLiquidity',
  'other',
];

const QuerySchema = z.object({
  wallet: z.string().refine((w) => EVM_WALLET_RE.test(w) || XRPL_WALLET_RE.test(w), 'invalid_wallet'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  types: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  refresh: z.coerce.boolean().optional(),
});

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const types = q.types
    ? (q.types
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ActivityType => (ACTIVITY_TYPES as ReadonlyArray<string>).includes(s)) as ActivityType[])
    : undefined;

  if (XRPL_WALLET_RE.test(q.wallet)) {
    try {
      const events = await xrplActivityService.getTimeline(q.wallet, {
        types,
        limit: q.limit,
        offset: q.offset,
      });
      return res.json({ wallet: q.wallet, count: events.length, events });
    } catch (err) {
      return res.status(502).json({
        error: 'xrpl_timeline_failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // `explorer` viaja con los eventos: una lista vacía porque el indexador de
  // Flare no contesta NO es "no hay movimientos", y la pantalla tiene que poder
  // decir cuál de las dos cosas está pasando.
  const { events, explorer } = await activityService.getTimelineWithStatus(q.wallet, {
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    types,
    limit: q.limit,
    offset: q.offset,
    forceRefresh: q.refresh,
  });
  return res.json({ wallet: q.wallet, count: events.length, events, explorer });
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /export — the period's movements as a FILE for the user's tax advisor
// (CSV or JSON). Reads exactly what the ledger book already knows how to read
// (same two rails as GET /) — no valuation, no gain/loss, no advice: Astryum
// reports data; the filing is the advisor's job.
// ─────────────────────────────────────────────────────────────────────────────
const ExportSchema = QuerySchema.extend({
  format: z.enum(['csv', 'json']).default('csv'),
});

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/export', async (req: Request, res: Response) => {
  const parsed = ExportSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', details: parsed.error.flatten() });
  }
  const q = parsed.data;
  const types = q.types
    ? (q.types
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ActivityType => (ACTIVITY_TYPES as ReadonlyArray<string>).includes(s)) as ActivityType[])
    : undefined;

  let events;
  try {
    if (XRPL_WALLET_RE.test(q.wallet)) {
      events = await xrplActivityService.getTimeline(q.wallet, { types, limit: q.limit ?? 500, offset: q.offset });
    } else {
      // El fichero fiscal se descarga y se manda al asesor: si sale incompleto,
      // nadie vuelve a comprobarlo. Por eso este camino SÍ fuerza la lectura del
      // explorador y, si no contesta, no entrega nada — un CSV al que le faltan
      // movimientos en silencio es peor que no tener CSV.
      const r = await activityService.getTimelineWithStatus(q.wallet, {
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        types,
        limit: q.limit ?? 500,
        offset: q.offset,
        forceRefresh: true,
      });
      if (!r.explorer.ok) {
        return res.status(502).json({
          error: 'explorer_unavailable',
          message:
            'No podemos leer Flare ahora mismo, así que el fichero saldría incompleto sin avisar. ' +
            'Vuelve a intentarlo en unos minutos.',
          reason: r.explorer.reason,
          cachedThrough: r.explorer.cachedThrough,
        });
      }
      events = r.events;
    }
  } catch (err) {
    return res.status(502).json({
      error: 'timeline_failed',
      message: err instanceof Error ? err.message : String(err),
    });
  }
  // XRPL reads live and has no server-side date filter — apply the window here
  // so the export honours the asked period on both rails.
  const from = q.from ? new Date(q.from).getTime() : null;
  const to = q.to ? new Date(q.to).getTime() : null;
  const windowed = events.filter((e) => {
    const ts = new Date(e.timestamp).getTime();
    return (from === null || ts >= from) && (to === null || ts <= to);
  });

  const stamp = new Date().toISOString().slice(0, 10);
  if (q.format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="astryum-movements-${q.wallet.slice(0, 8)}-${stamp}.json"`);
    return res.send(JSON.stringify({ wallet: q.wallet, exportedAt: new Date().toISOString(), count: windowed.length, events: windowed }, null, 2));
  }
  const header = ['timestamp', 'type', 'txHash', 'wallet', 'protocol', 'assetIn', 'amountIn', 'assetOut', 'amountOut', 'source'];
  const rows = windowed.map((e) =>
    [
      e.timestamp,
      e.type,
      e.txHash,
      e.wallet,
      e.protocol ?? '',
      e.assetIn?.asset?.symbol ?? '',
      e.assetIn?.amount ?? '',
      e.assetOut?.asset?.symbol ?? '',
      e.assetOut?.amount ?? '',
      (e.source as { provider?: string } | undefined)?.provider ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="astryum-movements-${q.wallet.slice(0, 8)}-${stamp}.csv"`);
  return res.send([header.join(','), ...rows].join('\n'));
});

router.post('/refresh', asyncHandler(async (req: Request, res: Response) => {
  const wallet = z
    .string()
    .refine((w) => EVM_WALLET_RE.test(w) || XRPL_WALLET_RE.test(w), 'invalid_wallet')
    .safeParse(req.body?.wallet);
  if (!wallet.success) return res.status(400).json({ error: 'invalid_wallet' });
  // XRPL reads live from the ledger — there is no explorer cache to refresh.
  if (XRPL_WALLET_RE.test(wallet.data)) {
    return res.json({ wallet: wallet.data, written: 0 });
  }
  const { written, explorer } = await activityService.refreshFromExplorer(wallet.data);
  return res.json({ wallet: wallet.data, written, explorer });
}));

export default router;

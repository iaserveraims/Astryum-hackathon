/**
 * OpsAlertStore — persistencia de las alertas de operación para el panel admin.
 *
 * `opsAlert()` (OpsAlertService) es el embudo único por el que pasan TODAS las
 * alertas de los agentes (executor 0xFE, vigía XRPL, provider-health, relay
 * Legacy). Antes solo dejaban rastro en logs + un webhook OPCIONAL: si el
 * webhook no estaba puesto, la alerta se evaporaba y el operador se enteraba
 * tarde o nunca (justo lo que dejó correr el incidente 0xFE). Este store hace
 * que cada alerta quede SIEMPRE guardada y visible en /app/admin, sin depender
 * de ningún servicio externo.
 *
 * Se apoya en la tabla `background_jobs` con un `jobType` propio ('ops-alert',
 * status 'logged') — el MISMO patrón que las persistencias FDC (Legacy/0xFE):
 * evita una migración de esquema y es invisible a cualquier poller (que filtra
 * por 'queued'). Es un buffer circular: se conservan las MAX_ROWS más recientes.
 *
 * Best-effort como todo lo de esta línea: nunca lanza (una alerta caída no puede
 * tumbar el tick de un agente) y es no-op sin `DATABASE_URL`.
 */
import type { Prisma } from '@prisma/client';

const JOB_TYPE = 'ops-alert';
/** Buffer circular: cuántas alertas recientes se conservan en la tabla. */
const MAX_ROWS = 500;

export type OpsAlertLevel = 'info' | 'warn' | 'critical';

export interface OpsAlertRecord {
  id: string;
  source: string;
  level: OpsAlertLevel;
  message: string;
  /** ISO — el instante en que se emitió (payload), con fallback a `createdAt`. */
  at: string;
}

async function getPrisma() {
  const { prisma } = await import('../database/prismaClient');
  return prisma;
}

function normLevel(v: unknown): OpsAlertLevel {
  return v === 'warn' || v === 'critical' ? v : 'info';
}

/**
 * Guarda una alerta (append). Poda las más viejas para mantener el buffer.
 * Nunca lanza; no-op sin DATABASE_URL.
 */
export async function saveOpsAlert(a: {
  source: string;
  level: string;
  message: string;
  at: string;
}): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const prisma = await getPrisma();
    await prisma.backgroundJob.create({
      data: {
        jobType: JOB_TYPE,
        status: 'logged',
        payload: {
          source: a.source,
          level: normLevel(a.level),
          message: a.message,
          at: a.at,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await pruneOldest(prisma);
  } catch (e) {
    // Best-effort: la alerta ya quedó en logs vía OpsAlertService. Que la
    // persistencia falle no puede propagarse al agente.
    console.error(`[ops-alert-store] save failed: ${(e as Error).message}`);
  }
}

/** Conserva las MAX_ROWS filas más recientes; borra el resto. Nunca lanza. */
async function pruneOldest(prisma: Awaited<ReturnType<typeof getPrisma>>): Promise<void> {
  try {
    const total = await prisma.backgroundJob.count({ where: { jobType: JOB_TYPE } });
    if (total <= MAX_ROWS) return;
    // La frontera = el createdAt de la fila nº MAX_ROWS (0-indexado ⇒ skip).
    const boundary = await prisma.backgroundJob.findMany({
      where: { jobType: JOB_TYPE },
      orderBy: { createdAt: 'desc' },
      skip: MAX_ROWS,
      take: 1,
      select: { createdAt: true },
    });
    if (boundary.length === 0) return;
    await prisma.backgroundJob.deleteMany({
      where: { jobType: JOB_TYPE, createdAt: { lte: boundary[0].createdAt } },
    });
  } catch (e) {
    console.error(`[ops-alert-store] prune failed: ${(e as Error).message}`);
  }
}

/**
 * Las alertas más recientes primero. Devuelve [] sin DATABASE_URL o ante error
 * (best-effort). `limit` acotado a [1, MAX_ROWS].
 */
export async function listOpsAlerts(opts: { limit?: number } = {}): Promise<OpsAlertRecord[]> {
  if (!process.env.DATABASE_URL) return [];
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), MAX_ROWS);
  try {
    const prisma = await getPrisma();
    const rows = await prisma.backgroundJob.findMany({
      where: { jobType: JOB_TYPE },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        source: typeof p.source === 'string' ? p.source : '—',
        level: normLevel(p.level),
        message: typeof p.message === 'string' ? p.message : '',
        at: typeof p.at === 'string' ? p.at : r.createdAt.toISOString(),
      };
    });
  } catch (e) {
    console.error(`[ops-alert-store] list failed: ${(e as Error).message}`);
    return [];
  }
}

/**
 * backgroundJobKv — the ONE low-level KV over the `background_jobs` table.
 *
 * Five hand-rolled copies of "persist a counter/record keyed by a payload field, best-
 * effort" had already grown (legacy-council-order, 0xfe-handoff, legacy-attestation,
 * 0xfe-attestation, demo-cap-daily) and one of them DIVERGED — the `misses` vs
 * `passesWithoutProof` semantics drift, caught by luck. This owns the STORE MECHANICS so
 * the sixth copy (and the next divergence) can't happen:
 *   - `if (!DATABASE_URL)` ⇒ null / no-op (in-memory fallback lives in the caller);
 *   - DB error ⇒ logged, NEVER thrown (best-effort, exactly the prior posture);
 *   - upsert = find-by-key then update|create; delete = deleteMany-by-key.
 *
 * Each caller keeps its OWN private `jobType` (invisible to other pollers), its own key
 * field, payload shape, and SEMANTICS (daily reset / rolling window / delete-on-consume /
 * counter increment). Those deliberate differences stay explicit at the call site — this
 * helper never encodes them. The payload MUST contain `keyField` (the where-clause reads
 * it back).
 */

import type { Prisma } from '@prisma/client';

async function getPrisma() {
  const { prisma } = await import('../../database/prismaClient');
  return prisma;
}

/** The payload is a JSON column; narrow the generic record to Prisma's JSON input type. */
function asJson(payload: Record<string, unknown>): Prisma.InputJsonValue {
  return payload as unknown as Prisma.InputJsonValue;
}

/** Read the payload of the newest row for (jobType, keyField=key), or null. */
export async function kvGet(
  jobType: string,
  keyField: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const prisma = await getPrisma();
    const row = await prisma.backgroundJob.findFirst({
      where: { jobType, payload: { path: [keyField], equals: key } },
      orderBy: { createdAt: 'desc' },
    });
    return (row?.payload as Record<string, unknown> | undefined) ?? null;
  } catch (e) {
    console.error(`[bg-kv] get failed (${jobType}/${key}): ${(e as Error).message}`);
    return null;
  }
}

/** Upsert the row for (jobType, keyField=key) with `payload` (which must include keyField). */
export async function kvUpsert(
  jobType: string,
  keyField: string,
  key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const prisma = await getPrisma();
    const existing = await prisma.backgroundJob.findFirst({
      where: { jobType, payload: { path: [keyField], equals: key } },
      select: { id: true },
    });
    if (existing) {
      await prisma.backgroundJob.update({ where: { id: existing.id }, data: { payload: asJson(payload) } });
    } else {
      await prisma.backgroundJob.create({ data: { jobType, status: 'completed', payload: asJson(payload) } });
    }
  } catch (e) {
    console.error(`[bg-kv] upsert failed (${jobType}/${key}): ${(e as Error).message}`);
  }
}

/** Read the payloads of EVERY row of a jobType (newest first, capped). For
 *  small operational namespaces (parked dispatches), not for bulk tables. */
export async function kvList(jobType: string, limit = 200): Promise<Record<string, unknown>[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const prisma = await getPrisma();
    const rows = await prisma.backgroundJob.findMany({
      where: { jobType },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => r.payload as Record<string, unknown>);
  } catch (e) {
    console.error(`[bg-kv] list failed (${jobType}): ${(e as Error).message}`);
    return [];
  }
}

/** Delete every row for (jobType, keyField=key). */
export async function kvDelete(jobType: string, keyField: string, key: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    const prisma = await getPrisma();
    await prisma.backgroundJob.deleteMany({
      where: { jobType, payload: { path: [keyField], equals: key } },
    });
  } catch (e) {
    console.error(`[bg-kv] delete failed (${jobType}/${key}): ${(e as Error).message}`);
  }
}

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

/**
 * THE row of a key when duplicates exist (2.4): every read
 * AND every write picks the same one — the newest by `createdAt`, `id` as the
 * tie-break (the table has no `updatedAt`). Before, `kvUpsert` updated whichever
 * row `findFirst` happened to return while `kvGetStrict` read the newest: a save
 * could land on an old duplicate and the read-back see the other.
 */
const NEWEST_FIRST: Prisma.BackgroundJobOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }];

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
      orderBy: NEWEST_FIRST,
    });
    return (row?.payload as Record<string, unknown> | undefined) ?? null;
  } catch (e) {
    console.error(`[bg-kv] get failed (${jobType}/${key}): ${(e as Error).message}`);
    return null;
  }
}

/**
 * STRICT read of the payload of the newest row for (jobType, keyField=key).
 * Unlike `kvGet`, a database failure THROWS instead of reading as "no row":
 * `null` means only "the database answered and there is no such row". For
 * callers where "could not read" must never be mistaken for "absent" — e.g. the
 * demo exchange submission journal, where an absent entry authorises a
 * signature. Without DATABASE_URL there is no database to fail: null.
 */
export async function kvGetStrict(
  jobType: string,
  keyField: string,
  key: string,
): Promise<Record<string, unknown> | null> {
  if (!process.env.DATABASE_URL) return null;
  const prisma = await getPrisma();
  const row = await prisma.backgroundJob.findFirst({
    where: { jobType, payload: { path: [keyField], equals: key } },
    orderBy: NEWEST_FIRST,
  });
  return (row?.payload as Record<string, unknown> | undefined) ?? null;
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
    // The SAME row kvGet / kvGetStrict read (newest first), never an arbitrary duplicate.
    const existing = await prisma.backgroundJob.findFirst({
      where: { jobType, payload: { path: [keyField], equals: key } },
      orderBy: NEWEST_FIRST,
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
    return await kvListStrict(jobType, limit);
  } catch (e) {
    console.error(`[bg-kv] list failed (${jobType}): ${(e as Error).message}`);
    return [];
  }
}

/**
 * The same read, but a database that cannot answer THROWS instead of looking
 * empty.
 *
 * `kvList` turns any failure into `[]`, and a caller that cannot tell «there are
 * no rows» from «I could not read» decides with the wrong answer. That is how a
 * run's omnibus stopped being an account this deployment operates while Postgres
 * was down — and the nonce seat of an account holding client XRP became
 * something any session could take. Whoever decides authority, ownership or a
 * seat reads with THIS one and handles the error; the best-effort readers
 * (parked dispatches, catalogues) keep `kvList`.
 */
export async function kvListStrict(jobType: string, limit = 200): Promise<Record<string, unknown>[]> {
  if (!process.env.DATABASE_URL) return [];
  const prisma = await getPrisma();
  const rows = await prisma.backgroundJob.findMany({
    where: { jobType },
    orderBy: NEWEST_FIRST,
    take: limit,
  });
  return rows.map((r) => r.payload as Record<string, unknown>);
}

export type KvCasOutcome = 'written' | 'conflict';

/** Pure: the numeric version a stored payload carries in `field` (absent / malformed = 0). */
export function kvVersionOf(payload: unknown, field: string): number {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  const n = Number((payload as Record<string, unknown>)[field] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * STRICT, ATOMIC compare-and-set of the row for (jobType, keyField=key)
 * (2.4). Before, `saveRun` read the version, compared it and
 * then upserted — three statements: two backend instances (an overlapping deploy)
 * could both pass the compare and the second write erased the first (a
 * reservation that disappears).
 */
export async function kvCompareAndSet(
  jobType: string,
  keyField: string,
  key: string,
  payload: Record<string, unknown>,
  cas: { versionField: string; expectedVersion: number; createIfAbsent?: boolean },
): Promise<KvCasOutcome> {
  if (!process.env.DATABASE_URL) throw new Error('KV_CAS_NO_DATABASE: compare-and-set needs a database');
  const prisma = await getPrisma();
  const lockKey = `bg-kv:${jobType}:${keyField}:${key}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked`;
    const current = await tx.backgroundJob.findFirst({
      where: { jobType, payload: { path: [keyField], equals: key } },
      orderBy: NEWEST_FIRST,
      select: { id: true, payload: true },
    });
    if (!current) {
      if (cas.expectedVersion !== 0 && !cas.createIfAbsent) return 'conflict';
      await tx.backgroundJob.create({ data: { jobType, status: 'completed', payload: asJson(payload) } });
      return 'written';
    }
    const stored = current.payload as Record<string, unknown> | null;
    if (kvVersionOf(stored, cas.versionField) !== cas.expectedVersion) return 'conflict';
    const hasVersion = Boolean(stored && typeof stored === 'object' && cas.versionField in stored);
    const updated = await tx.backgroundJob.updateMany({
      where: {
        id: current.id,
        jobType,
        // A legacy row without the field is version 0: matched by id alone (still under the key lock).
        ...(hasVersion ? { payload: { path: [cas.versionField], equals: cas.expectedVersion } } : {}),
      },
      data: { payload: asJson(payload) },
    });
    return updated.count === 1 ? 'written' : 'conflict';
  });
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

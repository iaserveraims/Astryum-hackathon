import { prisma } from '../database/prismaClient';
import { STEP_UP_FEATURES, type StepUpFeature, type StepUpAction } from './StepUpAuth';
import { sessionRevoked, withLiveSession, type LiveSessionRef } from './identity/liveSession';

/**
 * StepUpLockService — per-user configuration of which features require a fresh
 * wallet signature, and for which action (read / write). Backed by the
 * StepUpLockConfig row; reads are served from a tiny in-memory cache so the
 * isLocked() check on hot GETs never hits Postgres.
 */

export interface FeatureLock {
  read: boolean;
  write: boolean;
}

export type LockMatrix = Partial<Record<StepUpFeature, FeatureLock>>;

export interface LockConfig {
  enabled: boolean;
  grantTtlSeconds: number;
  matrix: LockMatrix;
}

const CACHE_TTL_MS = 15 * 1000;
interface CacheEntry {
  config: LockConfig;
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();

const DEFAULT_CONFIG: LockConfig = { enabled: false, grantTtlSeconds: 300, matrix: {} };

/**
 * Drop this user's cached matrix. Called by the account takeover after it
 * commits: the row itself moved to the quarantine account, but this process
 * would keep serving the previous holder's matrix for the TTL — and a matrix
 * that locks `wallet_security:write` is exactly what would keep the real owner
 * from re-arming their own protections.
 */
export function forgetStepUpConfig(userId: string): void {
  cache.delete(userId);
}

export function __resetStepUpCacheForTests(): void {
  cache.clear();
}

function sanitizeMatrix(raw: unknown): LockMatrix {
  const out: LockMatrix = {};
  if (raw && typeof raw === 'object') {
    for (const feature of STEP_UP_FEATURES) {
      const v = (raw as any)[feature];
      if (v && typeof v === 'object') {
        out[feature] = { read: Boolean(v.read), write: Boolean(v.write) };
      }
    }
  }
  return out;
}

export async function getConfig(userId: string): Promise<LockConfig> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.config;

  const row = await prisma.stepUpLockConfig.findUnique({ where: { userId } });
  const config: LockConfig = row
    ? {
        enabled: row.enabled,
        grantTtlSeconds: row.grantTtlSeconds,
        matrix: sanitizeMatrix(row.matrix),
      }
    : { ...DEFAULT_CONFIG };
  cache.set(userId, { config, fetchedAt: Date.now() });
  return config;
}

/**
 * `session` is MANDATORY (productizer it. 18, 3.2). The matrix decides which of
 * the user's features demand a fresh wallet signature: a request already in
 * flight when the account is taken over would otherwise plant the PREVIOUS
 * holder's matrix on the owner — disarming the locks they had, or arming
 * `wallet_security:write` so they cannot put them back (it. 16, 4.1).
 *
 * It used to be optional with an unguarded `prisma.stepUpLockConfig.upsert`
 * fallback. Optional is not a guard — see AgentKeyService.saveUserAPIKey for the
 * same argument. Required positionally AND refused when falsy at runtime.
 */
export async function setConfig(
  userId: string,
  patch: {
    enabled?: boolean;
    grantTtlSeconds?: number;
    // cells may arrive partial from the wire; sanitizeMatrix coerces with Boolean()
    matrix?: Partial<Record<StepUpFeature, { read?: boolean; write?: boolean }>>;
  },
  session: LiveSessionRef | null | undefined
): Promise<LockConfig> {
  if (!session?.userId || !session?.sessionId) throw sessionRevoked();
  const ttl =
    patch.grantTtlSeconds != null
      ? Math.min(Math.max(Math.trunc(patch.grantTtlSeconds), 60), 1800)
      : undefined;
  const matrix = patch.matrix != null ? sanitizeMatrix(patch.matrix) : undefined;

  const upsert = {
    where: { userId },
    create: {
      userId,
      enabled: patch.enabled ?? false,
      grantTtlSeconds: ttl ?? 300,
      matrix: (matrix ?? {}) as object,
    },
    update: {
      ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
      ...(ttl != null ? { grantTtlSeconds: ttl } : {}),
      ...(matrix != null ? { matrix: matrix as object } : {}),
    },
  };
  const row = await withLiveSession(session, (tx) => tx.stepUpLockConfig.upsert(upsert));

  const config: LockConfig = {
    enabled: row.enabled,
    grantTtlSeconds: row.grantTtlSeconds,
    matrix: sanitizeMatrix(row.matrix),
  };
  cache.set(userId, { config, fetchedAt: Date.now() }); // invalidate-by-overwrite
  return config;
}

/**
 * Is (feature, action) currently locked for this user? Returns false fast when
 * the feature is globally disabled or the specific cell is off.
 */
export async function isLocked(
  userId: string,
  feature: StepUpFeature,
  action: StepUpAction
): Promise<boolean> {
  const config = await getConfig(userId);
  if (!config.enabled) return false;
  const cell = config.matrix[feature];
  if (!cell) return false;
  return action === 'write' ? cell.write : cell.read;
}

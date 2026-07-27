import { prisma } from '../database/prismaClient';
import { STEP_UP_FEATURES, type StepUpFeature, type StepUpAction } from './StepUpAuth';

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

export async function setConfig(
  userId: string,
  patch: {
    enabled?: boolean;
    grantTtlSeconds?: number;
    // cells may arrive partial from the wire; sanitizeMatrix coerces with Boolean()
    matrix?: Partial<Record<StepUpFeature, { read?: boolean; write?: boolean }>>;
  }
): Promise<LockConfig> {
  const ttl =
    patch.grantTtlSeconds != null
      ? Math.min(Math.max(Math.trunc(patch.grantTtlSeconds), 60), 1800)
      : undefined;
  const matrix = patch.matrix != null ? sanitizeMatrix(patch.matrix) : undefined;

  const row = await prisma.stepUpLockConfig.upsert({
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
  });

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

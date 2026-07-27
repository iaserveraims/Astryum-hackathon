import crypto from 'crypto';
import { getRedis } from '../database/redisClient';
import type { ProviderCallResult } from '../integrations/interfaces/IProvider';

/**
 * Capability-keyed cache backed by Redis with graceful bypass when REDIS_URL is unset.
 * Falls back to an in-process LRU-ish Map (capped at 500 entries) so unit tests work without Redis.
 */
export class RouterCache {
  private memory = new Map<string, { expiresAt: number; value: ProviderCallResult<unknown> }>();
  private readonly memoryCap = 500;

  key(capability: string, input: unknown): string {
    const hash = crypto.createHash('sha256').update(JSON.stringify(input ?? null)).digest('hex').slice(0, 16);
    return `cap:${capability}:${hash}`;
  }

  async get<T>(key: string): Promise<ProviderCallResult<T> | null> {
    const redis = getRedis();
    if (redis) {
      try {
        const raw = await redis.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as ProviderCallResult<T>;
      } catch {
        // graceful bypass to memory
      }
    }
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return hit.value as ProviderCallResult<T>;
  }

  async set<T>(key: string, value: ProviderCallResult<T>, ttlSeconds: number): Promise<void> {
    const redis = getRedis();
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
        return;
      } catch {
        // fall through
      }
    }
    if (this.memory.size >= this.memoryCap) {
      const firstKey = this.memory.keys().next().value;
      if (firstKey) this.memory.delete(firstKey);
    }
    this.memory.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
  }

  clear(): void {
    this.memory.clear();
  }
}

export const routerCache = new RouterCache();

import Redis from 'ioredis';

let client: Redis | null = null;
let warned = false;

export function getRedis(): Redis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (!warned) {
      console.warn('[redis] REDIS_URL not set — cache disabled (graceful bypass)');
      warned = true;
    }
    return null;
  }
  client = new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    // Queue commands issued before the connection is ready instead of failing
    // them — the first requests after boot raced the handshake and logged
    // "Stream isn't writeable", silently skipping the cache.
    enableOfflineQueue: true,
    // Railway's private hostname (redis.railway.internal) resolves to IPv6
    // only; ioredis defaults to an IPv4 lookup and gets ENOTFOUND without
    // dual-stack. family 0 = let DNS decide (harmless everywhere else).
    family: 0,
    // A connected-but-stalled Redis (saturated proxy) left `await redis.get()`
    // hanging with no bound, blocking every portfolio read — cold AND warm.
    // The cache must never be slower than recomputing: fail fast, fall through.
    connectTimeout: 3_000,
    commandTimeout: 1_500,
  });
  client.on('error', (err) => {
    console.warn('[redis] error:', err.message);
  });
  client.on('ready', () => {
    console.log('[redis] connected — portfolio cache enabled');
  });
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
}

/**
 * scanLimiter — how many wallet sweeps hit the Flare RPC at the same time.
 *
 * Founder 2026-09-18: «últimamente aparece este error [blazeswap timed out
 * after 15000ms] y le cuesta más al Home cargar las wallets». The staging
 * logs showed why: one account with 13 EVM wallets polling the Home every
 * 90 s, and every 5 min (the fresh-cache TTL) all its wallets recomputed AT
 * ONCE — 13 wallets × 12 adapters × BlazeSwap's 1917-pair sweep against the
 * public node. Everything slowed, BlazeSwap crossed its 15 s deadline, the
 * degraded snapshot was cached 30 s only, and the next poll started again.
 *
 * A sweep alone takes ~2-4 s. The cure is not a bigger deadline: it is not
 * running twenty sweeps at once. This is a FIFO semaphore; the engine holds
 * a slot for the adapters part of a wallet computation. Readers keep being
 * served from the stale copy meanwhile (SWR), so nobody waits for the queue
 * except a wallet that has never been read.
 */

export interface ScanLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  /** Sweeps holding a slot right now. */
  readonly active: number;
  /** Sweeps waiting for a slot. */
  readonly queued: number;
}

export function createScanLimiter(max: number): ScanLimiter {
  const slots = Math.max(1, Math.floor(max));
  let active = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    active -= 1;
    const next = queue.shift();
    if (next) next();
  };
  const acquire = (): Promise<void> => {
    if (active < slots) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        active += 1;
        resolve();
      });
    });
  };
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
  };
}

/**
 * slidingWindowRateLimit — a tiny in-process limiter (no external dependency).
 *
 * Per-key sliding window + a global daily cap. Used by the PUBLIC product-assistant
 * endpoint, which spends Astryum's own Anthropic key, so a single actor (or the
 * endpoint overall) can't run up the bill. In-process = per-instance; swap for
 * Redis when scaled horizontally. Extracted from the route so it is unit-testable.
 */

export interface RateLimitDecision {
  limited: boolean;
  /** Seconds to wait before retrying (0 when not limited). */
  retryAfter: number;
}

export interface SlidingWindowLimiter {
  check(key: string, now: number): RateLimitDecision;
  /** Test hook — clears all state. */
  _reset(): void;
}

export function createSlidingWindowLimiter(opts: {
  perKeyMax: number;
  windowMs: number;
  dailyMax: number;
}): SlidingWindowLimiter {
  const hits = new Map<string, number[]>();
  let dayStamp = '';
  let dayCount = 0;

  return {
    check(key: string, now: number): RateLimitDecision {
      // Global daily cap (UTC day).
      const today = new Date(now).toISOString().slice(0, 10);
      if (today !== dayStamp) {
        dayStamp = today;
        dayCount = 0;
      }
      if (dayCount >= opts.dailyMax) return { limited: true, retryAfter: 3600 };

      // Per-key sliding window.
      const arr = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (arr.length >= opts.perKeyMax) {
        hits.set(key, arr);
        const retryAfter = Math.max(1, Math.ceil((opts.windowMs - (now - arr[0])) / 1000));
        return { limited: true, retryAfter };
      }
      arr.push(now);
      hits.set(key, arr);
      dayCount += 1;

      // Bounded cleanup so the map can't grow without limit.
      if (hits.size > 5000) {
        for (const [k, v] of hits) {
          const fresh = v.filter((t) => now - t < opts.windowMs);
          if (fresh.length) hits.set(k, fresh);
          else hits.delete(k);
        }
      }
      return { limited: false, retryAfter: 0 };
    },
    _reset() {
      hits.clear();
      dayStamp = '';
      dayCount = 0;
    },
  };
}

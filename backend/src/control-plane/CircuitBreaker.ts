/**
 * Sliding window circuit breaker.
 *
 * - 3 consecutive failures inside `windowMs` (default 5 min) → opens for `cooldownMs` (default 60s).
 * - While open, `canCall()` returns false.
 * - First call after cooldown enters half-open; success closes the circuit, failure re-opens it.
 */
export interface CircuitState {
  failures: number[]; // timestamps of recent failures
  openedAt: number | null;
  consecutive: number;
}

export class CircuitBreaker {
  private states = new Map<string, CircuitState>();
  constructor(
    private readonly threshold = 3,
    private readonly windowMs = 5 * 60_000,
    private readonly cooldownMs = 60_000,
  ) {}

  canCall(key: string, now = Date.now()): boolean {
    const s = this.states.get(key);
    if (!s || s.openedAt == null) return true;
    if (now - s.openedAt >= this.cooldownMs) {
      s.openedAt = null;
      s.consecutive = 0;
      return true; // half-open
    }
    return false;
  }

  recordSuccess(key: string): void {
    const s = this.ensure(key);
    s.consecutive = 0;
    s.openedAt = null;
  }

  recordFailure(key: string, now = Date.now()): void {
    const s = this.ensure(key);
    s.failures = s.failures.filter((t) => now - t < this.windowMs);
    s.failures.push(now);
    s.consecutive += 1;
    if (s.consecutive >= this.threshold) {
      s.openedAt = now;
    }
  }

  isOpen(key: string, now = Date.now()): boolean {
    return !this.canCall(key, now);
  }

  reset(key?: string): void {
    if (key) this.states.delete(key);
    else this.states.clear();
  }

  private ensure(key: string): CircuitState {
    let s = this.states.get(key);
    if (!s) {
      s = { failures: [], openedAt: null, consecutive: 0 };
      this.states.set(key, s);
    }
    return s;
  }
}

export const circuitBreaker = new CircuitBreaker();

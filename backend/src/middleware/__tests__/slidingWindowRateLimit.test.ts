import { createSlidingWindowLimiter } from '../slidingWindowRateLimit';

describe('slidingWindowRateLimit (product-assistant abuse guard)', () => {
  test('allows up to perKeyMax within the window, then limits with a positive retryAfter', () => {
    const lim = createSlidingWindowLimiter({ perKeyMax: 3, windowMs: 60_000, dailyMax: 1000 });
    const t0 = 1_000_000;
    expect(lim.check('ip1', t0).limited).toBe(false);
    expect(lim.check('ip1', t0 + 1).limited).toBe(false);
    expect(lim.check('ip1', t0 + 2).limited).toBe(false);
    const d = lim.check('ip1', t0 + 3);
    expect(d.limited).toBe(true);
    expect(d.retryAfter).toBeGreaterThan(0);
  });

  test('window slides — after the window passes, requests are allowed again', () => {
    const lim = createSlidingWindowLimiter({ perKeyMax: 2, windowMs: 60_000, dailyMax: 1000 });
    const t0 = 2_000_000;
    lim.check('ip', t0);
    lim.check('ip', t0 + 1);
    expect(lim.check('ip', t0 + 2).limited).toBe(true);
    expect(lim.check('ip', t0 + 60_001).limited).toBe(false); // past the window
  });

  test('per-key isolation — one IP hitting the cap does not limit another', () => {
    const lim = createSlidingWindowLimiter({ perKeyMax: 1, windowMs: 60_000, dailyMax: 1000 });
    const t = 3_000_000;
    expect(lim.check('a', t).limited).toBe(false);
    expect(lim.check('a', t + 1).limited).toBe(true);
    expect(lim.check('b', t + 1).limited).toBe(false);
  });

  test('global daily cap limits across all keys', () => {
    const lim = createSlidingWindowLimiter({ perKeyMax: 100, windowMs: 60_000, dailyMax: 2 });
    const t = 4_000_000;
    expect(lim.check('x', t).limited).toBe(false);
    expect(lim.check('y', t + 1).limited).toBe(false);
    expect(lim.check('z', t + 2).limited).toBe(true); // 3rd across any key → daily cap
  });
});

import { createScanLimiter } from '../scanLimiter';

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('createScanLimiter', () => {
  it('never runs more than `max` sweeps at once and serves the queue in order', async () => {
    const lim = createScanLimiter(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const gates: Array<() => void> = [];
    const job = (i: number) =>
      lim.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        order.push(i);
        await new Promise<void>((r) => gates.push(r));
        running -= 1;
        return i;
      });
    const all = Promise.all([job(1), job(2), job(3), job(4)]);
    await tick();
    expect(lim.active).toBe(2);
    expect(lim.queued).toBe(2);
    expect(order).toEqual([1, 2]);
    gates.shift()!();
    await tick();
    expect(order).toEqual([1, 2, 3]);
    gates.shift()!();
    gates.shift()!();
    await tick();
    gates.shift()!();
    expect(await all).toEqual([1, 2, 3, 4]);
    expect(peak).toBe(2);
    expect(lim.active).toBe(0);
    expect(lim.queued).toBe(0);
  });

  it('a sweep that throws releases its slot', async () => {
    const lim = createScanLimiter(1);
    await expect(lim.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(lim.active).toBe(0);
    expect(await lim.run(async () => 'ok')).toBe('ok');
  });

  it('a nonsense max still allows one sweep', () => {
    expect(createScanLimiter(0).active).toBe(0);
    expect(createScanLimiter(-3).queued).toBe(0);
  });
});

/**
 * swrCache — fresco se sirve, pasado se sirve Y recalcula, concurrentes se
 * fusionan, y un fallo nunca se cachea.
 */
import { _resetSwrForTests, invalidateSwr, swr } from '../swrCache';

describe('swr — stale-while-revalidate con fusión', () => {
  beforeEach(() => _resetSwrForTests());

  it('fusiona lectores concurrentes en UNA lectura', async () => {
    let calls = 0;
    const compute = () => new Promise<number>((r) => setTimeout(() => r(++calls), 5));
    const opts = { freshMs: 1000, staleMs: 5000 };
    const [a, b, c] = await Promise.all([swr('k', opts, compute), swr('k', opts, compute), swr('k', opts, compute)]);
    expect([a, b, c]).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });

  it('fresco: no recalcula; pasado: sirve lo viejo y recalcula por detrás', async () => {
    let t = 0;
    let calls = 0;
    const now = () => t;
    const compute = async () => ++calls;
    const opts = { freshMs: 100, staleMs: 1000, now };
    expect(await swr('k', opts, compute)).toBe(1);
    t = 50;
    expect(await swr('k', opts, compute)).toBe(1);
    expect(calls).toBe(1);
    t = 500;
    expect(await swr('k', opts, compute)).toBe(1); // lo viejo, ya
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(2); // y recalculado por detrás
    expect(await swr('k', opts, compute)).toBe(2);
  });

  it('caducado del todo: recalcula y espera', async () => {
    let t = 0;
    let calls = 0;
    const opts = { freshMs: 100, staleMs: 1000, now: () => t };
    const compute = async () => ++calls;
    await swr('k', opts, compute);
    t = 5000;
    expect(await swr('k', opts, compute)).toBe(2);
  });

  it('un fallo sin nada servible se propaga y no se cachea', async () => {
    const opts = { freshMs: 100, staleMs: 1000 };
    await expect(swr('k', opts, async () => { throw new Error('rpc'); })).rejects.toThrow('rpc');
    expect(await swr('k', opts, async () => 7)).toBe(7);
  });

  it('un fallo de fondo deja lo viejo servible', async () => {
    let t = 0;
    const opts = { freshMs: 100, staleMs: 1000, now: () => t };
    await swr('k', opts, async () => 1);
    t = 500;
    expect(await swr('k', opts, async () => { throw new Error('rpc'); })).toBe(1);
    await new Promise((r) => setImmediate(r));
    expect(await swr('k', opts, async () => 9)).toBe(1); // sigue lo viejo, aún dentro de staleMs
  });

  it('invalidateSwr borra por prefijo', async () => {
    const opts = { freshMs: 1000, staleMs: 5000 };
    await swr('pote-state:0xa', opts, async () => 1);
    invalidateSwr('pote-state:');
    expect(await swr('pote-state:0xa', opts, async () => 2)).toBe(2);
  });
});

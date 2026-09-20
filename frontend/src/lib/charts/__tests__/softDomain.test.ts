import { describe, expect, it } from 'vitest';
import { softDomain } from '../softDomain';

/**
 * El eje de la curva del Portfolio: ni ceñido al dato (un 0,3 %
 * parece un desplome) ni desde cero (todo parece plano). Lo que se vigila es
 * la PROPORCIÓN: un movimiento pequeño ocupa poco alto, uno grande lo llena.
 */
describe('softDomain', () => {
  it('un vaivén pequeño NO llena el gráfico: el suelo es un porcentaje del valor', () => {
    // 10 000 ± 0,3 %
    const [lo, hi] = softDomain([10000, 10030, 9990, 10010]);
    const span = hi - lo;
    // suelo 5 % de 10 010 (el punto medio) con 12 % de aire
    expect(span).toBeCloseTo(10010 * 0.05 * 1.12, 3);
    // la variación real (40) ocupa ~7 % del alto — se ve, no asusta
    expect(40 / span).toBeGreaterThan(0.05);
    expect(40 / span).toBeLessThan(0.1);
  });

  it('un movimiento grande sí llena el gráfico: el eje crece con la variación', () => {
    const [lo, hi] = softDomain([10000, 9000]); // -10 %
    expect(hi - lo).toBeCloseTo(1000 * 1.12, 6);
    // la curva queda dentro, con aire arriba y abajo
    expect(lo).toBeLessThan(9000);
    expect(hi).toBeGreaterThan(10000);
  });

  it('está centrado en el punto medio de los datos, nunca arranca en cero', () => {
    const [lo, hi] = softDomain([10000, 10030, 9990, 10010]);
    expect((lo + hi) / 2).toBeCloseTo(10010, 6);
    expect(lo).toBeGreaterThan(9000);
  });

  it('sobrevive a los casos vacíos y degenerados', () => {
    expect(softDomain([])).toEqual([0, 1]);
    const [lo, hi] = softDomain([0, 0, 0]);
    expect(hi).toBeGreaterThan(lo);
    expect(softDomain([NaN, 100, Infinity])[0]).toBeLessThan(100);
  });

  it('el suelo y el aire son ajustables', () => {
    const [lo, hi] = softDomain([100, 101], { minSpanRatio: 0.1, pad: 0 });
    expect(hi - lo).toBeCloseTo(100.5 * 0.1, 6);
  });
});

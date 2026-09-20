import { describe, expect, it } from 'vitest';

/**
 * LA GEOMETRÍA DEL GUILLOCHÉ — la trampa silenciosa del tema Institucional.
 *
 * La roseta del sello se calcula con un hipotrocoide, y hay un par de valores
 * donde la fórmula COLAPSA sin avisar: cuando R = 2r sale (R−r)/r = 1 y la
 * curva degenera en una ELIPSE (el par de Tusi). No lanza, no rompe el build,
 * no lo ve tsc: simplemente pinta una raya plana donde debería haber una
 * filigrana.
 *
 * Y pasó. El commit 9712f43d publicó 46/23 y 38/19 —las dos son R = 2r—, así
 * que dos de las tres vueltas del sello del tema eran rayas de 80x12 y 60x16.
 * Lo cazó la sesión paralela astryum-27 EJECUTANDO la fórmula, no mirando el
 * dibujo, que es exactamente lo que hace este fichero de forma permanente.
 *
 * Por eso esto es una prueba y no un comentario: en este repo los comentarios
 * ya han fallado dos veces por depender de que alguien se acuerde. Cualquiera
 * que añada una vuelta nueva al sello se entera aquí, no en producción.
 */

import {
  FIELD_SPECS,
  MIN_CSS_PX,
  ROSETTE_SPECS,
  closingPeriod,
  hypotrochoid,
  inkOpacity,
  inkStroke,
  lobeCount,
  maxRadius,
  rosettePoint,
  type RosetteSpec,
} from '../skin/marks';

const ALL: [string, RosetteSpec[]][] = [
  ['el sello', ROSETTE_SPECS],
  ['la marca de agua', FIELD_SPECS],
];

/** La caja real que ocupa el trazo, midiendo la curva punto a punto. */
function bbox(spec: RosetteSpec, steps = 2000) {
  const period = closingPeriod(spec);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const [x, y] = rosettePoint(spec, (i / steps) * period);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

describe.each(ALL)('%s', (_name, specs) => {
  it('NINGUNA vuelta es un par de Tusi: R nunca es 2r', () => {
    for (const s of specs) {
      expect(s.R, `R=${s.R} r=${s.r} colapsa en una elipse`).not.toBe(2 * s.r);
      // La forma positiva de la misma regla, que es la que hay que cumplir al
      // elegir un triple nuevo.
      expect((s.R - s.r) / s.r).toBeGreaterThanOrEqual(2);
    }
  });

  it('y se COMPRUEBA en el trazo, no solo en los números: la curva es 2D', () => {
    for (const s of specs) {
      const b = bbox(s);
      // Una elipse degenerada sale achatadísima (las publicadas eran 80x12 y
      // 60x16). Una roseta de verdad es prácticamente cuadrada.
      expect(b.height / b.width).toBeGreaterThan(0.9);
      expect(b.height / b.width).toBeLessThan(1.12);
    }
  });

  it('cabe dentro de su viewBox, con sitio para el trazo', () => {
    const STROKE = 1.5; // el grosor máximo que se pinta, más un pelo de aire
    for (const s of specs) {
      expect(maxRadius(s) + STROKE).toBeLessThanOrEqual(s.box / 2);
      const b = bbox(s);
      expect(b.minX).toBeGreaterThan(0);
      expect(b.minY).toBeGreaterThan(0);
      expect(b.maxX).toBeLessThan(s.box);
      expect(b.maxY).toBeLessThan(s.box);
    }
  });

  it('la curva CIERRA de verdad: el punto del periodo es el del origen', () => {
    for (const s of specs) {
      const [x0, y0] = rosettePoint(s, 0);
      const [x1, y1] = rosettePoint(s, closingPeriod(s));
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeLessThan(1e-9);
    }
  });

  it('los lóbulos de las vueltas son PRIMOS ENTRE SÍ: se entrelazan, no se pisan', () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const lobes = specs.map(lobeCount);
    for (const n of lobes) expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < lobes.length; i++) {
      for (let j = i + 1; j < lobes.length; j++) {
        expect(gcd(lobes[i], lobes[j]), `${lobes[i]} y ${lobes[j]} comparten divisor`).toBe(1);
      }
    }
  });

  it('el trazo sale liso: ningún segmento se ve como faceta', () => {
    for (const s of specs) {
      const path = hypotrochoid(s);
      const pts = path
        .slice(1, -1)
        .split('L')
        .map((p) => p.split(' ').map(Number) as [number, number]);
      let longest = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        longest = Math.max(longest, Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
      }
      // Con el periodo mal calculado, 49/7 repintaba siete vueltas y dejaba
      // segmentos de 6,9 px — las facetas se veían en las cúspides.
      expect(longest).toBeLessThan(2);
    }
  });

  it('las vueltas ANIDAN: cada una cabe dentro de la anterior', () => {
    const radii = specs.map(maxRadius);
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeLessThan(radii[i - 1]);
    }
  });
});

describe('el sello, en concreto', () => {
  it('deja aire antes de su orla (r=56) para que ningún trazo se monte', () => {
    expect(maxRadius(ROSETTE_SPECS[0])).toBeLessThan(56 - 1);
  });

  it('son tres vueltas de 7, 5 y 4 lóbulos', () => {
    expect(ROSETTE_SPECS.map(lobeCount)).toEqual([7, 5, 4]);
  });
});

/**
 * EL SUELO DE PÍXEL — la otra forma de que un grabado se pierda.
 *
 * La roseta puede tener la geometría perfecta y aun así no verse: un trazo
 * monolínea por debajo de medio píxel de CSS lo reparte el antialias entre dos
 * columnas y llega al ojo como neblina. El sello se monta a 124px en la puerta
 * del Earn (0.62 px: correcto) y a 46px en la probeta con la que se ELIGE el
 * tema, donde caía a 0.23 px y se veía como una mancha. Lo midió la sesión
 * paralela astryum-27 rasterizando el SVG a sus dos tamaños reales.
 *
 * La prueba que de verdad importa aquí es la SEGUNDA: que la compensación no
 * toque los montajes grandes. Un ajuste de legibilidad que reengordase el
 * dibujo afinado para la puerta del Earn sería peor que el problema.
 */
describe('el suelo de píxel del trazo', () => {
  it('sube el trazo hasta medio píxel cuando el mark se monta pequeño', () => {
    for (const size of [46, 64, 80]) {
      expect((inkStroke(size, 0.6) * size) / 120).toBeCloseTo(MIN_CSS_PX, 5);
    }
  });

  it('NO toca los montajes grandes: la puerta del Earn queda exactamente igual', () => {
    // 124 es el tamaño real en FlareDemoEarn; 100 es donde deja de actuar.
    for (const size of [100, 120, 124, 172]) {
      expect(inkStroke(size, 0.6)).toBe(0.6);
      expect(inkStroke(size, 1)).toBe(1);
    }
  });

  it('nunca adelgaza un trazo, solo lo engorda', () => {
    for (const size of [20, 26, 46, 64, 100, 124, 200]) {
      for (const base of [0.5, 0.6, 0.8, 1, 1.3]) {
        expect(inkStroke(size, base)).toBeGreaterThanOrEqual(base);
      }
    }
  });

  it('engorda de forma monótona: cuanto más pequeño, más trazo', () => {
    const sizes = [200, 124, 100, 80, 64, 46, 30];
    for (let i = 1; i < sizes.length; i++) {
      expect(inkStroke(sizes[i], 0.6)).toBeGreaterThanOrEqual(inkStroke(sizes[i - 1], 0.6));
    }
  });

  it('y tiene tope: un mark diminuto no se dibuja con morcillas', () => {
    for (const size of [4, 10, 20, 26]) {
      expect(inkStroke(size, 0.6)).toBeLessThanOrEqual(0.6 * 2.2);
      expect(inkStroke(size, 1)).toBeLessThanOrEqual(1 * 2.2);
    }
  });

  it('la tinta sube con el trazo pero jamás pasa de opaca', () => {
    for (const size of [20, 46, 124]) {
      const w = inkStroke(size, 0.6);
      for (const base of [0.2, 0.34, 0.5, 0.9]) {
        const o = inkOpacity(size, base, w, 0.6);
        expect(o).toBeGreaterThanOrEqual(base);
        expect(o).toBeLessThanOrEqual(1);
      }
    }
    // En los montajes grandes la tinta tampoco se mueve.
    expect(inkOpacity(124, 0.34, inkStroke(124, 0.6), 0.6)).toBe(0.34);
  });
});

/* ── Los grabados de las páginas (2026-09-14): el globo y el sello ──────────
   Misma doctrina que el hipotrocoide: geometría calculada, y lo calculable se
   comprueba aquí — que quepa en la caja y que ningún parámetro colapse la
   figura en algo que no es. */
import {
  MERIDIAN_LATITUDES,
  MERIDIAN_LONGITUDES,
  MERIDIAN_R,
  SIGNET_ORBIT,
  SIGNET_RING,
  SIGNET_SEAL,
  SIGNET_SIGNERS,
  meridianRx,
  parallelGeom,
  signetPositions,
} from '../skin/marks';

describe('el globo de meridianos', () => {
  it('cabe en el viewBox con su orla y su peana', () => {
    // orla a R+5 desde el centro 60; peana a R+15 por debajo.
    expect(60 + MERIDIAN_R + 5).toBeLessThanOrEqual(120);
    expect(60 + MERIDIAN_R + 15).toBeLessThanOrEqual(120);
    expect(60 - MERIDIAN_R - 5).toBeGreaterThanOrEqual(0);
  });

  it('ningún meridiano es el contorno ni una raya: 0 < rx < R', () => {
    for (const lam of MERIDIAN_LONGITUDES) {
      const rx = meridianRx(lam);
      expect(rx).toBeGreaterThan(1);
      expect(rx).toBeLessThan(MERIDIAN_R);
    }
    // 90° sería el contorno pintado dos veces; 0° una raya. Ninguno está.
    expect(MERIDIAN_LONGITUDES).not.toContain(90);
    expect(MERIDIAN_LONGITUDES).not.toContain(0);
  });

  it('los paralelos se quedan dentro del disco, y el ecuador es el más ancho', () => {
    const eq = parallelGeom(0);
    expect(eq.rx).toBeCloseTo(MERIDIAN_R, 6);
    expect(eq.dy).toBeCloseTo(0, 6);
    for (const phi of MERIDIAN_LATITUDES) {
      const p = parallelGeom(phi);
      expect(p.rx).toBeLessThanOrEqual(MERIDIAN_R);
      expect(p.rx).toBeGreaterThan(0);
      // la elipse abierta no se sale del disco por arriba ni por abajo
      expect(Math.abs(p.dy) + p.ry).toBeLessThanOrEqual(MERIDIAN_R + 0.01);
    }
  });
});

describe('el sello con sus firmas', () => {
  it('los signatarios caben dentro de la orla y no pisan el sello', () => {
    expect(SIGNET_ORBIT + SIGNET_RING).toBeLessThan(53); // orla interior r=53
    expect(SIGNET_ORBIT - SIGNET_RING).toBeGreaterThan(SIGNET_SEAL + 5); // la rúbrica para antes del sello
  });

  it('se reparten en círculo, a la misma distancia y sin dos en el mismo sitio', () => {
    const pts = signetPositions();
    expect(pts).toHaveLength(SIGNET_SIGNERS);
    for (const p of pts) {
      expect(Math.hypot(p.x - 60, p.y - 60)).toBeCloseTo(SIGNET_ORBIT, 6);
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        // dos anillos vecinos no se tocan
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(SIGNET_RING * 2);
      }
    }
  });
});

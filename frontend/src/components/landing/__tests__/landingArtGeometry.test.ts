/**
 * LA GEOMETRÍA DE LAS DOS ESCENAS NUEVAS — lo que un comentario ya no basta
 * para garantizar.
 *
 * Las dos escenas de la portada (art/ValleyScene.tsx y art/ThresholdScene.tsx)
 * dejaron de tener coordenadas escritas a mano y pasaron a GENERAR su
 * geometría. Eso es lo que quita el aspecto de «palitos simples», y trae consigo
 * una obligación: una silueta generada puede colapsar en silencio, y colapsada
 * sigue siendo un SVG válido que se pinta sin quejarse.
 *
 * Este repo ya pagó esa lección dos veces con las rosetas de guilloché —una
 * pareja R = 2r degeneraba en una elipse plana y solo se vio ejecutando la
 * fórmula—. Así que lo que sostiene el dibujo se prueba, no se comenta.
 */

import { describe, it, expect } from 'vitest';
import { ridge, projectY, PHI_MAX, pitchCos, pitchSin, ricker, mulberry32, fbm1, type Pt } from '../art/craft';
import { letterSeams, FALLBACK_LETTERS } from '../art/Wordmark';
import {
  AC,
  ABUT_L,
  ABUT_R,
  CLIFF_L,
  CLIFF_R,
  COUNCIL_SEATS,
  CROSS_X0,
  CROSS_X1,
  DECK_L,
  DECK_R,
  DECK_Y,
  HANGERS,
  QUORUM,
  RE,
  RI,
  SPR_L,
  SPR_R,
  STONES,
  TOP_L,
  TOP_R,
  crossY,
  groundAt,
  lumAt,
} from '../art/ThresholdScene';

/* ── La cuenca del valle ────────────────────────────────────────────────── */
const RIM_L = 543;
const RIM_R = 658;
const CX = 600.7;
const FLOOR_Y = 65;
const halfAt = (y: number) => ((RIM_R - RIM_L) / 2) * (1 - y / FLOOR_Y);
const insideV = (p: Pt): Pt => {
  const y = Math.max(0, Math.min(FLOOR_Y, p[1]));
  const h = halfAt(y) + 1.2;
  const dx = Math.max(-h, Math.min(h, p[0] - CX));
  return [CX + dx, y];
};

describe('ridge() — la silueta generada de la cuenca', () => {
  const pts = ridge(0x5a17, [[RIM_L, 0], [CX, FLOOR_Y], [RIM_R, 0]], 6, 5.5, insideV);

  it('no mueve los anclajes: las paredes tienen que apoyarse en los brazos de la Y', () => {
    expect(pts[0]).toEqual([RIM_L, 0]);
    expect(pts[pts.length - 1]).toEqual([RIM_R, 0]);
    // el cruce de la Y sigue siendo el punto medio de la lista
    const apex = pts[(pts.length - 1) / 2];
    expect(apex[0]).toBeCloseTo(CX, 6);
    expect(apex[1]).toBeCloseTo(FLOOR_Y, 6);
  });

  it('no se sale de la horquilla de la letra', () => {
    for (const p of pts) {
      expect(Math.abs(p[0] - CX)).toBeLessThanOrEqual(halfAt(p[1]) + 1.21);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeLessThanOrEqual(FLOOR_Y);
    }
  });

  it('tiene relieve de verdad: no es la uve recta disfrazada', () => {
    // La uve recta tendría todos sus puntos exactamente sobre las dos rectas.
    const off = pts.filter((p) => Math.abs(Math.abs(p[0] - CX) - halfAt(p[1])) > 0.5);
    expect(off.length).toBeGreaterThan(pts.length * 0.3);
  });

  it('es determinista: misma semilla, misma cresta en servidor y en cliente', () => {
    const again = ridge(0x5a17, [[RIM_L, 0], [CX, FLOOR_Y], [RIM_R, 0]], 6, 5.5, insideV);
    expect(again).toEqual(pts);
  });
});

/* ── La proyección del umbral ───────────────────────────────────────────── */
describe('projectY() — la cámara ortográfica de inclinación de Legacy', () => {
  const DEPTH = [62, 6, 92, 0, 50];
  const SKY = [150, 206, 120, 212, 162];
  const G0_ORBIT = 212;
  const G0_GROUND = 316;
  const HZ_GROUND = 258;

  it('a inclinación cero reproduce EXACTAMENTE la tabla de cielo original', () => {
    DEPTH.forEach((z, i) => {
      expect(projectY(0, z, G0_ORBIT, G0_GROUND)).toBeCloseTo(SKY[i], 9);
    });
  });

  it('a inclinación máxima las cinco estaciones están en el suelo, por debajo del horizonte', () => {
    DEPTH.forEach((z) => {
      const y = projectY(1, z, G0_ORBIT, G0_GROUND);
      expect(y).toBeGreaterThan(HZ_GROUND);
      expect(y).toBeLessThan(320);
    });
  });

  it('el tiempo aparcado (42°) deja la figura CRUZANDO el horizonte: es el fotograma de la escena', () => {
    const ys = DEPTH.map((z) => projectY(0.531, z, G0_ORBIT, G0_GROUND));
    expect(ys.some((y) => y < HZ_GROUND)).toBe(true);
    expect(ys.some((y) => y > HZ_GROUND)).toBe(true);
  });

  it('el ángulo sale del ajuste de la tabla que se escribió a ojo, con residuo bajo', () => {
    const TOP = [224, 236, 216, 232, 228];
    DEPTH.forEach((z, i) => {
      // con la base ajustada (235,12) el modelo reproduce la tabla original
      const y = 235.12 - z * Math.cos(PHI_MAX);
      expect(Math.abs(y - TOP[i])).toBeLessThanOrEqual(3.2);
    });
  });

  it('un jalón mide cero visto desde el cenit y su altura entera a ras', () => {
    expect(pitchSin(0)).toBeCloseTo(0, 9);
    expect(pitchSin(1)).toBeGreaterThan(0.97);
    expect(pitchCos(0)).toBeCloseTo(1, 9);
    expect(pitchCos(1)).toBeLessThan(0.2);
  });
});

/* ── Las costuras del nombre ────────────────────────────────────────────── */
describe('letterSeams() — dónde se parte ASTRYUM', () => {
  const seams = letterSeams(FALLBACK_LETTERS);

  it('hay una costura por juntura y van en orden', () => {
    expect(seams).toHaveLength(FALLBACK_LETTERS.length - 1);
    for (let i = 1; i < seams.length; i++) expect(seams[i]).toBeGreaterThan(seams[i - 1]);
  });

  it('cada costura cae ENTRE dos letras, donde ninguna de las dos tiene tinta', () => {
    for (let i = 1; i < FALLBACK_LETTERS.length; i++) {
      const prevEnd = FALLBACK_LETTERS[i - 1].x + FALLBACK_LETTERS[i - 1].w;
      const curStart = FALLBACK_LETTERS[i].x;
      const lo = Math.min(prevEnd, curStart);
      const hi = Math.max(prevEnd, curStart);
      expect(seams[i - 1]).toBeGreaterThanOrEqual(lo);
      expect(seams[i - 1]).toBeLessThanOrEqual(hi);
    }
  });
});

/* ── La regla que no es de gusto ────────────────────────────────────────── */
describe('ricker() — por qué el nivel del lago no puede derivar', () => {
  it('integra CERO: una campana normal desplazaría el nivel medio del agua', () => {
    // Regla 1 de la escena, derivada del invariante #9: un nivel que sube se lee
    // como rendimiento insinuado. La ondícula se elige por su integral, no por
    // su forma.
    let sum = 0;
    const h = 0.001;
    for (let u = -12; u <= 12; u += h) sum += ricker(u) * h;
    expect(Math.abs(sum)).toBeLessThan(1e-6);
  });
});

/* ── Determinismo, que es lo que hace segura la hidratación ─────────────── */
describe('el ruido con semilla es reproducible', () => {
  it('mulberry32 da la misma secuencia siempre', () => {
    const a = Array.from({ length: 8 }, mulberry32(42));
    const b = Array.from({ length: 8 }, mulberry32(42));
    expect(a).toEqual(b);
  });

  it('fbm1 da el mismo perfil siempre, y tiene rasgos a varias escalas', () => {
    const a = Array.from(fbm1(0x4c21, 64));
    const b = Array.from(fbm1(0x4c21, 64));
    expect(a).toEqual(b);
    const span = Math.max(...a) - Math.min(...a);
    expect(span).toBeGreaterThan(2);
  });
});

/* ── El arco del umbral ─────────────────────────────────────────────────── */
describe('la fábrica del arco — lo que un comentario ya no garantiza', () => {
  it('lumAt() es UNA luz: el máximo cae en el riñón derecho y el arranque izquierdo no recibe nada', () => {
    // 35° desde la derecha ⇒ la normal que más se alinea con la luz es la de
    // 45°. Si esto se rompe, el arco se ilumina desde un sitio que no existe
    // en la escena, que es peor que no iluminarlo.
    const best = Array.from({ length: 181 }, (_, d) => d).reduce((a, d) => (lumAt(d) > lumAt(a) ? d : a), 0);
    expect(Math.abs(best - 55)).toBeLessThanOrEqual(12);
    expect(lumAt(180)).toBe(0);
    expect(lumAt(55)).toBeGreaterThan(lumAt(120));
    expect(lumAt(120)).toBeGreaterThan(lumAt(170));
  });

  it('cada dovela lleva su propio valor de luz, y no todas el mismo', () => {
    const lums = STONES.map((s) => s.lum);
    // Las piezas del lado en sombra comparten el cero —una superficie de
    // espaldas a la luz no recibe «menos que nada»—, así que la variedad se
    // cuenta entre las iluminadas.
    const lit = lums.filter((l) => l > 0);
    expect(new Set(lit.map((l) => l.toFixed(3))).size).toBe(lit.length);
    expect(lit.length).toBeGreaterThanOrEqual(4);
    // el lado en sombra existe de verdad: al menos dos piezas a cero
    expect(lums.filter((l) => l === 0).length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...lums)).toBeGreaterThan(0.9);
  });

  it('los labios de los dos bancos caen EXACTAMENTE en los arranques', () => {
    // Si el labio no cae en el arranque, el arco deja de apoyarse en la roca y
    // se ve. `ridge` respeta sus anclajes: esto lo comprueba.
    expect(TOP_L[TOP_L.length - 1]).toEqual([SPR_L, AC.y]);
    expect(TOP_R[0]).toEqual([SPR_R, AC.y]);
  });

  it('la garganta SE ABRE al bajar y ningún banco invade el otro', () => {
    const depthOf = (p: readonly number[]) => p[1];
    const sepTop = Math.abs(CLIFF_R[0][0] - CLIFF_L[0][0]);
    const sepBottom = Math.abs(CLIFF_R[CLIFF_R.length - 1][0] - CLIFF_L[CLIFF_L.length - 1][0]);
    expect(sepBottom).toBeGreaterThan(sepTop + 100);
    for (const p of CLIFF_L) expect(p[0]).toBeLessThan(AC.x);
    for (const p of CLIFF_R) expect(p[0]).toBeGreaterThan(AC.x);
    expect(depthOf(CLIFF_L[CLIFF_L.length - 1])).toBeGreaterThan(depthOf(CLIFF_L[0]));
  });

  it('los estribos se meten en SU banco y no cruzan el tajo', () => {
    // La regresión que esto cierra: con el signo invertido los dos estribos
    // cruzaban el vacío y se encontraban en el centro, y la garganta se leía
    // como la rendija entre dos pilares de ladrillo. Medido en captura.
    const xs = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
    for (const b of ABUT_L) for (const x of xs(b.d)) expect(x).toBeLessThanOrEqual(SPR_L + 0.01);
    for (const b of ABUT_R) for (const x of xs(b.d)) expect(x).toBeGreaterThanOrEqual(SPR_R - 0.01);
    // y hay traba: las juntas verticales de dos hiladas seguidas no coinciden
    const byCourse = new Map<number, number[]>();
    for (const b of ABUT_L) byCourse.set(b.c, [...(byCourse.get(b.c) ?? []), xs(b.d)[0]]);
    const c0 = byCourse.get(0)!;
    const c1 = byCourse.get(1)!;
    expect(c1.some((x) => c0.every((y) => Math.abs(x - y) > 4))).toBe(true);
  });

  it('groundAt() interpola: no deja el escalón del muestreo', () => {
    // Filtrar la lista con `<=` deja un hueco de medio paso y el tablero se
    // apoyaría en el aire. Sobre una muestra, el valor es el de la muestra;
    // entre dos, queda entre las dos.
    const s = TOP_R[4];
    expect(groundAt(TOP_R, s[0])).toBeCloseTo(s[1], 6);
    const a = TOP_R[4];
    const b = TOP_R[5];
    const mid = groundAt(TOP_R, (a[0] + b[0]) / 2);
    expect(mid).toBeGreaterThanOrEqual(Math.min(a[1], b[1]) - 1e-9);
    expect(mid).toBeLessThanOrEqual(Math.max(a[1], b[1]) + 1e-9);
  });

  it('las cinco péndolas cuelgan del INTRADÓS, dentro del vano, y son el consejo', () => {
    // El fundador, 2026-09-19: «que los puntos que representan el quórum sean lo
    // que sustenta el puente». Para que eso sea verdad y no un parecido, las
    // péndolas tienen que ser EXACTAMENTE la lista del consejo y tienen que
    // agarrar el intradós de verdad, no terminar cerca de él.
    expect(HANGERS).toHaveLength(COUNCIL_SEATS.length);
    expect(HANGERS.filter((h) => h.signs)).toHaveLength(QUORUM);
    for (const h of HANGERS) {
      expect(h.x).toBeGreaterThan(SPR_L);
      expect(h.x).toBeLessThan(SPR_R);
      // su extremo superior cae sobre la circunferencia del intradós
      expect(Math.hypot(h.x - AC.x, h.top - AC.y)).toBeCloseTo(RI, 6);
      // y cuelga hacia abajo: el tablero está por debajo del arco
      expect(h.top).toBeLessThan(DECK_Y);
    }
    // repartidas por el vano y sin dos en el mismo sitio
    const xs = HANGERS.map((h) => h.x);
    expect(new Set(xs).size).toBe(xs.length);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
  });

  it('el paso CRUZA RECTO por debajo del arco: ni sube ni baja', () => {
    // El fallo que esto cierra: la primera versión era un puente de lomo de asno
    // y la vasija trepaba por el trasdós. «El puente cruza recto por debajo, no
    // sube por encima.»
    const ys = Array.from({ length: 81 }, (_, i) => crossY());
    expect(new Set(ys.map((y) => y.toFixed(6))).size).toBe(1);
    // va por debajo de la clave, con holgura, y por encima del tablero
    expect(crossY()).toBeGreaterThan(AC.y - RI);
    expect(crossY()).toBeLessThan(DECK_Y);
    // y el tablero se mete en los dos estribos en vez de acabar en el labio
    expect(DECK_L).toBeLessThan(SPR_L);
    expect(DECK_R).toBeGreaterThan(SPR_R);
    // el recorrido entra y sale del cuadro: el camino no empieza en el puente
    expect(CROSS_X0).toBeLessThan(DECK_L);
    expect(CROSS_X1).toBeGreaterThan(DECK_R);
  });
});

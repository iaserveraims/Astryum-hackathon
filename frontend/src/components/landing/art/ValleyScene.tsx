'use client';

/**
 * EL VALLE — la escena del producto Institucional.
 *
 * Al inicio y
 * al fin se ve el nombre construido al completo pero no en el proceso. Primero
 * se ve el nombre, luego se hace zoom sobre la Y, luego se separan las letras,
 * se percibe la Y como un lago donde el líquido es una LP, se van mostrando los
 * principios en gotitas de agua que filtran, luego la Y se transforma en la
 * silueta de un par de montañas simulando que estamos en Andorra y luego
 * aparece el nombre de Astryum como lo conocemos abajo del todo.»
 */

import { memo, useEffect, useId, useMemo, useRef } from 'react';
import { motion, useInView, useMotionValue, useMotionValueEvent, useTransform, type MotionValue } from 'framer-motion';
import type { MotionLevel } from '../../../stores/motionStore';
import {
  FALLBACK_LETTERS,
  RegisterMarks,
  WORDMARK_BOX,
  WordmarkSplit,
  Y_INDEX,
  type LetterBox,
} from './Wordmark';
import { catmullToCubic, fbm1, INK, LIGHT, mulberry32, ricker, ridge, TONE, toPath, type Pt } from './craft';
import { useAspectViewBox, useSceneClock } from './craftHooks';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

/* ── El reparto del scroll ───────────────────────────────────────────────
   Un solo sitio donde vive el itinerario. `InstitutionalJourney` deriva de
   aquí sus tiempos de texto y sus paradas: NUNCA una segunda tabla. */
export const BEATS = {
  name: [0.0, 0.1],
  approach: [0.1, 0.26],
  basin: [0.26, 0.4],
  filter: [0.4, 0.64],
  valley: [0.64, 0.82],
  close: [0.82, 1.0],
} as const;

/* ── La cuenca ─────────────────────────────────────────────────────────── */
const Y = FALLBACK_LETTERS[Y_INDEX];
const CX = Y.cx; // 600.7
const RIM_L = 543;
const RIM_R = 658;
const RIM_Y = 0;
const FLOOR_Y = 65;
/** LA LÁMINA — clavada. No se mueve en toda la escena (regla 1). */
export const WATER_Y = 34;

/** La semianchura de la horquilla a cualquier profundidad. Una sola función
 *  para todo lo que tiene que tocar las paredes. */
const halfAt = (y: number) => ((RIM_R - RIM_L) / 2) * (1 - y / FLOOR_Y);
const WATER_HALF = halfAt(WATER_Y); // 27.4

/* ── EL TAMIZ ───────────────────────────────────────────────────────────
   La cuarta parada se llama «El tamiz» y hasta hoy NO había tamiz: se veían
   gotas cayendo y dos que se apartaban solas.
 *
   Aquí hay una malla de verdad, y separa por TAMAÑO, que es como separa un
   tamiz. La luz de la malla ES la política: lo que cumple pasa, y lo que no
   cumple es más grande que la luz y se queda encima. No hay que explicarlo —
   se ve que no cabe.
 *
   Va once unidades por encima de la lámina para que el paso y la caída al agua
   sean dos sucesos distintos y no uno solo. */
export const SIEVE_Y = WATER_Y - 11;
const SIEVE_HALF = halfAt(SIEVE_Y);
/** El paso de la malla. Las gotas que cumplen miden 2,2 de ancho y pasan; las
 *  que no, 3,6, y no caben por ninguna parte. El alto del hilo es 1,7 y no 3:
 *  a ×4,6, tres unidades cada tres son una valla de estacas, no una malla vista
 *  de canto. */
const SIEVE_PITCH = 2.9;
const SIEVE_BARS = (() => {
  const out: number[] = [];
  for (let x = -SIEVE_HALF + 1.2; x <= SIEVE_HALF - 1.2; x += SIEVE_PITCH) out.push(CX + x);
  return out;
})();

/** El recorte que impide que la cresta generada se salga de la horquilla de la
 *  letra. Sin esto el valle asoma por fuera del brazo de la Y y el relevo entre
 *  letra y paisaje se ve — un fallo que este repo ya cometió dos veces con
 *  líneas escritas a mano. Se permite 1,2 unidades de holgura: una cresta que
 *  solo puede meterse hacia dentro se lee más estrecha que la letra. */
const insideV = (p: Pt): Pt => {
  const y = Math.max(RIM_Y, Math.min(FLOOR_Y, p[1]));
  const h = halfAt(y) + 1.2;
  const dx = Math.max(-h, Math.min(h, p[0] - CX));
  return [CX + dx, y];
};

/** LA CUENCA GENERADA. Desplazamiento del punto medio con los dos bordes y el
 *  cruce de la Y como anclajes fijos. */
const BASIN_PTS = ridge(0x5a17, [[RIM_L, RIM_Y], [CX, FLOOR_Y], [RIM_R, RIM_Y]], 6, 5.5, insideV);
/** La cuenca cerrada por arriba: sirve de recorte del lago y de nada más. */
const BASIN_FILL_D = `${toPath(BASIN_PTS)}Z`;

/**
 * LAS DOS CUMBRES — y por qué NO hay ningún volteo.
 *
 * Fundador, sobre la versión anterior: «el final cuando se
 * transforma en una montaña no me gusta nada, porque lo pones en medio de la Y
 * se ve todo el rato, simplemente se gira para dejar de ser una V para ser una
 * A, no queda nada bien».
 */
const SUM_L: Pt = [448, -96];
const SUM_R: Pt = [762, -74];
const BANK_Y = 210; // muy por debajo del cuadro: las laderas salen por abajo
const FLANK_L = ridge(0x8c41, [[150, BANK_Y], SUM_L, [RIM_L, RIM_Y]], 5, 8);
const FLANK_R = ridge(0x1f93, [[RIM_R, RIM_Y], SUM_R, [1050, BANK_Y]], 5, 8);
/** El perfil entero, de banco a banco. Una sola lista de puntos. */
const PROFILE: Pt[] = [...FLANK_L, ...BASIN_PTS.slice(1), ...FLANK_R.slice(1)];
const I_SUM_L = FLANK_L.findIndex((p) => p[1] === SUM_L[1] && Math.abs(p[0] - SUM_L[0]) < 0.001);
const I_FLOOR = FLANK_L.length - 1 + (BASIN_PTS.length - 1) / 2;
const I_SUM_R = FLANK_L.length - 1 + BASIN_PTS.length - 1 + FLANK_R.findIndex((p) => p[1] === SUM_R[1] && Math.abs(p[0] - SUM_R[0]) < 0.001);
const PROFILE_D = toPath(PROFILE);

/**
 * LA SILUETA DEL MACIZO, EXPORTADA — porque algo más tiene que proyectar su
 * sombra.
 */
// Es UNA ladera y no el perfil entero, y es la IZQUIERDA. Dos intentos medidos
// en captura antes de acertar: el perfil completo lleva dos cumbres con el valle
// en medio, y una silueta en W desplazada en diagonal se lee como papiroflexia;
// la ladera derecha es casi toda una diagonal descendente y salía una cinta de
// raso. La izquierda sube desde el banco hasta la cumbre y cae al borde de la
// cuenca: es UN pico con sus dos laderas, que es lo que hace falta para que una
// sombra se lea como sombra de montaña.
export const CREST_PTS: readonly Pt[] = FLANK_L;
/** La caja que ocupan esos puntos, para que el consumidor no la adivine. */
export const CREST_BOX = { x0: 150, x1: RIM_L, yTop: SUM_L[1], yBase: BANK_Y } as const;

/**
 * LAS CUATRO CARAS, y una sola regla de luz.
 *
 * Recorriendo el perfil de izquierda a derecha: un tramo que BAJA está de cara
 * a la luz (arriba-derecha) y uno que SUBE está de espaldas. Los extremos del
 * perfil son las dos cumbres y el fondo del valle, así que salen cuatro caras
 * que alternan: ladera exterior izquierda en sombra, ladera interior izquierda
 * iluminada, ladera interior derecha en sombra, ladera exterior derecha
 * iluminada. Las dos paredes de la cuenca heredan la misma regla sin ninguna
 * excepción, que es lo que hace que el valle y las cumbres se lean como UN solo
 * macizo con una sola luz y no como dos dibujos pegados.
 */
const face = (from: number, to: number) => `${toPath(PROFILE.slice(from, to + 1))}L${PROFILE[to][0].toFixed(2)} 260L${PROFILE[from][0].toFixed(2)} 260Z`;
const FACES = [
  { d: face(0, I_SUM_L), lit: false },
  { d: face(I_SUM_L, I_FLOOR), lit: true },
  { d: face(I_FLOOR, I_SUM_R), lit: false },
  { d: face(I_SUM_R, PROFILE.length - 1), lit: true },
];
/** Solo las crestas iluminadas, abiertas: es el filo que recibe la luz de canto. */
const RIM_LIGHT_D = `${toPath(PROFILE.slice(I_SUM_L, I_FLOOR + 1))}${toPath(PROFILE.slice(I_SUM_R))}`;

/**
 * LA NIEVE. Se traza desde la cresta REAL: se toman los puntos por encima de una
 * cota y se cierra por ella. La cota es más baja en la cara de sombra que en la
 * iluminada, y esa asimetría es lo que hace que un pico se lea como una
 * fotografía y no como un logotipo.
 */
const SNOW_RUNS = (() => {
  const runs: string[] = [];
  let cur: Pt[] = [];
  for (let i = 1; i < PROFILE.length - 1; i++) {
    const lit = PROFILE[i + 1][1] - PROFILE[i - 1][1] > 0;
    const thr = lit ? -76 : -64;
    if (PROFILE[i][1] <= thr) {
      cur.push(PROFILE[i]);
    } else if (cur.length > 2) {
      runs.push(`${toPath(cur)}Z`);
      cur = [];
    } else {
      cur = [];
    }
  }
  if (cur.length > 2) runs.push(`${toPath(cur)}Z`);
  return runs;
})();

/**
 * LOS PLANOS DE ESTRATIFICACIÓN. Nueve curvas suaves con un eje de plegado
 * inclinado 8°, comprimidas hacia las cumbres, adelgazando con la altura, y TRES
 * partidas por una falla. La falla es lo que convierte «líneas dentro de un
 * triángulo» en roca.
 */
const BEDDING = (() => {
  const rnd = mulberry32(0x3f11);
  return Array.from({ length: 9 }, (_, k) => {
    const y = -96 + 160 * Math.pow((k + 1) / 9, 1.35);
    const tilt = Math.tan((8 * Math.PI) / 180);
    const x0 = 150;
    const x1 = 1050;
    const sag = 2 + rnd() * 3;
    const faulted = k === 2 || k === 5 || k === 7;
    const cut = faulted ? 380 + rnd() * 360 : null;
    const seg = (p: number, q: number) =>
      `M${p.toFixed(1)} ${(y + (p - CX) * tilt).toFixed(1)}Q${((p + q) / 2).toFixed(1)} ${(y + ((p + q) / 2 - CX) * tilt - sag).toFixed(1)} ${q.toFixed(1)} ${(y + (q - CX) * tilt).toFixed(1)}`;
    const d = cut ? `${seg(x0, cut - 6)}${seg(cut + 6, x1)}` : seg(x0, x1);
    return { d, w: 0.9 - (k / 8) * 0.55, o: 0.3 - (k / 8) * 0.23 };
  });
})();

/** LAS ISÓBATAS. Ya no son cuerdas rectas: se obtienen desplazando el perfil
 *  REAL del fondo hacia dentro, así que cada una abraza la forma que hay. */
/**
 * LAS CORDILLERAS DEL FONDO. No son polilíneas tecleadas dibujadas como
 * contornos abiertos flotando en el cielo: una cresta lejana es una SILUETA,
 * no un contorno. Tres perfiles generados con ruido fractal, cerrados muy por
 * debajo del cuadro y RELLENOS, cada uno en su paso de bruma. La distancia la
 * lleva un viraje de tono hacia el color del cielo además del alfa: eso es
 * perspectiva aérea, lo otro es difuminar.
 */
function farRidge(seed: number, baseY: number, amp: number): string {
  const n = 72;
  const noise = fbm1(seed, n, 3, [amp, amp * 0.42, amp * 0.16]);
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push([-200 + (1400 * i) / (n - 1), baseY + noise[i]]);
  return `${catmullToCubic(pts)}L1200 300L-200 300Z`;
}
/** Por debajo de las cumbres cercanas y justo encima de la lámina: es donde se
 *  posa el horizonte de un valle de verdad. */
const RIDGES = [
  { d: farRidge(0x7d31, 22, 7.5), depth: 2 as const },
  { d: farRidge(0x2a95, 27, 9.5), depth: 1 as const },
  { d: farRidge(0x64e7, 31, 5.0), depth: 0 as const },
];

function inwardContour(offset: number): string {
  const pts: Pt[] = [];
  for (const p of BASIN_PTS) {
    const y = p[1] + offset * 0.42;
    if (y >= FLOOR_Y - 1) continue;
    const h = halfAt(y);
    const dx = p[0] - CX;
    const k = Math.sign(dx) * Math.max(0, Math.abs(dx) - offset * 0.86);
    if (Math.abs(k) > h) continue;
    pts.push([CX + k, y]);
  }
  return pts.length > 3 ? catmullToCubic(pts) : '';
}
const SOUNDINGS = [
  { d: inwardContour(9), dash: '4 2', o: 0.34 },
  { d: inwardContour(17), dash: '2.6 1.8', o: 0.26 },
  { d: inwardContour(25), dash: '1.6 1.4', o: 0.18 },
];

/**
 * LOS SEIS PRINCIPIOS. Cuatro filtran y dos no.
 *
 * Son las MISMAS seis cosas que caen como gotas en la escena y que la lámina de
 * la política va marcando: una sola lista para el dibujo y para el panel. Antes
 * había un expediente en monoespaciada de doce píxeles al lado de una lámina
 * que decía casi lo mismo con otra tipografía — dos textos pequeños compitiendo
 * en vez de uno legible.
 *
 * `x` es dónde cae su gota, repartidas de izquierda a derecha para que el tamiz
 * se lea como un barrido y no como seis sucesos sueltos.
 */
export interface Clause {
  id: string;
  /** El nombre del principio. */
  es: string;
  en: string;
  /** Qué dice, en una línea. */
  esNote: string;
  enNote: string;
  pass: boolean;
  /** Por qué no pasa. Un motivo es lo que emite un motor de políticas. */
  esWhy?: string;
  enWhy?: string;
  x: number;
}
export const CLAUSES: Clause[] = [
  { id: 'custodia', es: 'Custodia', en: 'Custody', esNote: 'las llaves no salen de la entidad', enNote: 'the keys never leave the entity', pass: true, x: CX - 21 },
  { id: 'firma', es: 'Firma', en: 'Signature', esNote: 'nadie firma en su nombre', enNote: 'nobody signs on its behalf', pass: true, x: CX - 12.5 },
  { id: 'discrecion', es: 'Discreción del proveedor', en: 'Provider discretion', esNote: 'decide por la entidad', enNote: 'decides for the entity', pass: false, esWhy: 'no admitida', enWhy: 'not admitted', x: CX - 4 },
  { id: 'coste', es: 'Coste', en: 'Cost', esNote: 'a la vista antes de firmar', enNote: 'in plain sight before signing', pass: true, x: CX + 4.5 },
  { id: 'opacidad', es: 'Ejecución sin rastro', en: 'Execution without a trace', esNote: 'no deja asiento', enNote: 'leaves no entry', pass: false, esWhy: 'sin registro', enWhy: 'no record', x: CX + 13 },
  { id: 'rastro', es: 'Rastro', en: 'Trail', esNote: 'cada acción deja su prueba', enNote: 'every action leaves its proof', pass: true, x: CX + 21 },
];

/** El desajuste de cada gota, para que las seis no compartan ritmo. Semilla
 *  fija: un `Math.random()` aquí rompería la hidratación de la portada. */
const DROP_JITTER = (() => {
  const rnd = mulberry32(0x1d0c);
  return CLAUSES.map(() => (rnd() - 0.5) * 0.12);
})();

/**
 * EL CALENDARIO DE UNA CLÁUSULA — cuándo sale su gota, cuándo aterriza y cuándo
 * termina de resbalar.
 *
 * Lo exporta la escena porque lo usan LOS DOS: el dibujo, para soltar la gota,
 * y la lámina de la política, para resolver su fila. Que el tic de una regla
 * caiga en el mismo fotograma que su gota no es un detalle bonito: es lo único
 * que hace que el panel y la escena se lean como el mismo suceso y no como dos
 * cosas pasando a la vez por casualidad.
 */
export function clauseTiming(i: number) {
  const [fStart, fEnd] = BEATS.filter;
  // LAS SEIS GOTAS CABEN EN EL 72 %, no en el tramo entero. Antes la última
  // caía en 0,636 y el texto de la parada se iba en 0,635: las dos últimas
  // reglas se resolvían con el lector ya mirando otra cosa. Ahora terminan en
  // 0,573 y quedan seis centésimas de scroll —un cuarto de la parada— para ver
  // el tamiz lleno con su frase delante.
  const step = ((fEnd - fStart) * 0.72) / CLAUSES.length;
  const at = fStart + i * step + DROP_JITTER[i] * step;
  return { at, land: at + step * 0.52, done: at + step * 0.9, step };
}

export interface ValleySceneProps {
  progress: MotionValue<number>;
  lang: Lang;
  letters: readonly LetterBox[];
  measured: boolean;
  /** La medición ya terminó (con éxito o rindiéndose). Hasta entonces el nombre
   *  NO se pinta: ver `useLetterBoxes`. */
  settled?: boolean;
  level: MotionLevel;
  /** El fotograma de reposo: móvil y movimiento mínimo. */
  still?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════
   LA ESCENA
   ══════════════════════════════════════════════════════════════════════ */

function ValleySceneImpl({ progress, lang, letters, measured, settled = true, level, still = false }: ValleySceneProps) {
  const uid = useId().replace(/:/g, '');
  const [aStart, aEnd] = BEATS.approach;
  const [bStart, bEnd] = BEATS.basin;
  const [fStart, fEnd] = BEATS.filter;
  const [vStart, vEnd] = BEATS.valley;
  const [cStart, cEnd] = BEATS.close;
  const vSpan = vEnd - vStart;

  /* ── LA REGLA DE FASE ──────────────────────────────────────────────
   *
     Tenía razón y era aritmética, no gusto. Cada tiempo de la escena terminaba
     su trabajo EXACTAMENTE en el borde de su parada, y el `Dock` del texto se
     va en `b − 0,16·span`. Medido: la lámina se llenaba en 0,400 y el texto se
     iba en 0,397; la última gota caía en 0,636 y el texto se iba en 0,635; el
     filo iluminado del valle llegaba en 0,820 y el texto se iba en 0,816. Es
     decir: la escena se completaba siempre en el fotograma en que el lector ya
     estaba leyendo otra cosa, y nunca llegaba a ver la escena TERMINADA con su
     propia frase delante. */
  const RESOLVE = 0.72;
  /** Un punto dentro de la parada, ya comprimido por la regla de fase: `at(a,b,1)`
   *  no cae en `b`, cae en el 72 % — que es donde tiene que acabar el trabajo. */
  const at = (a0: number, b0: number, k: number) => a0 + (b0 - a0) * RESOLVE * k;

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const inView = useInView(wrapRef, { margin: '15% 0px' });

  // EL CIERRE VA EN DOS TIEMPOS. La cámara vuelve a casa primero y el nombre se
  // recompone después: hacerlo a la vez daba, medido en captura, una R y una U
  // de pantalla entera cruzándose — las letras ya en su sitio, pero su sitio
  // todavía ampliado ×4,6.
  const backHome = vEnd + (cEnd - vEnd) * 0.3;
  const lettersBack = cStart + (cEnd - cStart) * 0.25;

  // LA CÁMARA TREPA. Tres posiciones, no dos: baja a la lámina, se queda
  // mientras se lee el tamiz, y en el tiempo del valle SUBE por las paredes
  // abriendo el encuadre hasta que aparecen las dos cumbres. Eso es lo que
  // sustituye al volteo: ya no hay nada que gire, hay algo que se MIRA.
  // Interpola también el aspecto (ver craftHooks), o a ×4,6 la ventana mide
  // treinta y dos unidades de alto y media composición cae fuera del cuadro.
  const vMid = vStart + vSpan * 0.48;
  const zoomDone = aStart + (bStart - aStart) * 0.8;
  const scale = useTransform(progress, [aStart, zoomDone, vStart, vMid, vEnd, backHome], [1, 4.6, 4.6, 2.2, 2.2, 1], { clamp: true });
  // La cámara se corre a la IZQUIERDA del sujeto, o sea que el sujeto aparece a
  // la derecha: la columna de lectura ocupa el tercio izquierdo del escenario y
  // sin este desplazamiento la cuenca le caía encima.
  const camX = useTransform(progress, [aStart, zoomDone, vEnd, backHome], [500, CX - 30, CX - 30, 500], { clamp: true });
  const camY = useTransform(progress, [aStart, zoomDone, vStart, vMid, vEnd, backHome], [71, WATER_Y, WATER_Y, -6, -6, 71], { clamp: true });
  const zoomT = useTransform(progress, [aStart, zoomDone, vEnd, backHome], [0, 1, 1, 0], { clamp: true });
  // 1024 px es el ancho al que la landing ha dibujado el nombre desde 2026
  // (`max-w-5xl`): la escena sangra a toda la ventana y el nombre no se entera.
  const camBox = useMemo(() => ({ vbW: WORDMARK_BOX.w, targetPx: 1024 }), []);
  useAspectViewBox(svgRef, camX, camY, scale, camBox);

  // El nombre se va y vuelve. Un solo valor.
  const away = useTransform(progress, [aStart, aEnd, lettersBack, cEnd - 0.04], [0, 1, 1, 0], { clamp: true });
  /** 1 mientras el nombre está entero y quieto. Las capas caras del material
   *  (bisel, rasante, barrido) SOLO existen ahí: nadie lee un bisel a ×4,6, y
   *  una máscara bajo un `viewBox` vivo se re-rasteriza cada fotograma con la
   *  región creciendo con el acercamiento. */
  const rest = useTransform(away, [0, 0.05], [1, 0], { clamp: true });

  /* ── LA RETIRADA ──────────────────────────────────────────────────────
     Todo el macizo —perfil, caras, tramado, estratos, nieve, cordilleras,
     amanecer y niebla— se CIERRA cuando la cámara se retira, así que en reposo
     la Y queda limpia. Era la mitad de la queja del */
  const OUT_0 = vEnd + 0.002;
  const OUT_STEP = (lettersBack - OUT_0) / 6;
  const out = (k: number) => [OUT_0 + k * OUT_STEP, OUT_0 + (k + 1.7) * OUT_STEP] as [number, number];
  // El lago vive desde que se llena la cuenca hasta que la cámara se retira.
  const P2 = (a: number) => vStart + vSpan * a;
  const waterIn = useTransform(progress, [bStart, at(bStart, bEnd, 1), ...out(2.0)], [0, 1, 1, 0], { clamp: true });
  const lakeInk = useTransform(progress, [bStart, at(bStart, bEnd, 1), P2(0.45), P2(0.85)], [0, 1, 1, 0], { clamp: true });
  const bedIn = useTransform(progress, [at(bStart, bEnd, 0.42), at(bStart, bEnd, 0.95), P2(0.2), P2(0.5)], [0, 1, 1, 0], { clamp: true });
  /** El perfil entra con la cuenca —a ×4,6 solo se le ven las dos paredes— y es
   *  de lo último que se va: la silueta es lo que sobrevive a la distancia. */
  const lineIn = useTransform(progress, [bStart - 0.02, bStart + 0.04, ...out(3.3)], [0, 1, 1, 0], { clamp: true });
  /** LA MALLA. Se pone al empezar el tamiz —la regla se escribe antes que el
   *  caso— y se retira nada más entrar el valle, que es cuando deja de venir
   *  nada que tamizar. */
  const sieveIn = useTransform(progress, [fStart - 0.015, fStart + 0.02, vStart + 0.008, vStart + 0.045], [0, 1, 1, 0], { clamp: true });

  // ── COREOGRAFÍA POR PROFUNDIDAD ──────────────────────────────────────
  // Ocho sub-tramos derivados DENTRO de BEATS, ordenados de lejos a cerca como
  // resuelve un travelling de verdad, y TODOS multiplicados por la puerta del
  // paisaje. Antes tres cosas colgaban del mismo valor del volteo y el resto
  // eran desplazamientos de 0,05 del mismo tramo: el macizo aparecía de golpe,
  // con una sola curva, y usar la misma curva en todo es su propio delator.
  const P = (a: number) => vStart + vSpan * a * RESOLVE;
  const gate = (from: number, to: number) => [P(from), P(to)] as [number, number];
  const ridge3In = useTransform(progress, [...gate(0.0, 0.3), ...out(4.3)], [0, 1, 1, 0], { clamp: true });
  const ridge2In = useTransform(progress, [...gate(0.06, 0.38), ...out(3.7)], [0, 1, 1, 0], { clamp: true });
  const dawnIn = useTransform(progress, [...gate(0.04, 0.44), ...out(4.3)], [0, 1, 1, 0], { clamp: true });
  const rockIn = useTransform(progress, [...gate(0.14, 0.56), ...out(2.5)], [0, 1, 1, 0], { clamp: true });
  const hatchIn = useTransform(progress, [...gate(0.28, 0.68), ...out(1.3)], [0, 1, 1, 0], { clamp: true });
  const beddingIn = useTransform(progress, [...gate(0.4, 0.8), ...out(0.9)], [0, 1, 1, 0], { clamp: true });
  const snowIn = useTransform(progress, [...gate(0.5, 0.88), ...out(0.4)], [0, 1, 1, 0], { clamp: true });
  const rimIn = useTransform(progress, [...gate(0.6, 1.0), ...out(0.0)], [0, 1, 1, 0], { clamp: true });
  /** El segundo peldaño del detalle: aparece por encima de ×2,5, así que
   *  acercarse GANA algo. Es lo que hace que un zoom de ×4,6 merezca la pena. */
  const tier2 = useTransform(scale, [2.0, 3.2], [1, 0], { clamp: true });
  const hatchAlpha = useTransform([hatchIn, tier2] as MotionValue<number>[], ([h, t]: number[]) => h * (0.45 + 0.55 * t));
  const beddingAlpha = useTransform([beddingIn, tier2] as MotionValue<number>[], ([b, t]: number[]) => b * (0.3 + 0.7 * t));

  const mistX = useTransform(progress, [vStart, cEnd], [-6, 10], { clamp: true });
  const yHandover = bStart + (bEnd - bStart) * 0.35;
  const yInk = useTransform(progress, [aEnd, yHandover, lettersBack, cEnd - 0.04], [1, 0, 0, 1], { clamp: true });

  // ── EL RELOJ ÚNICO ────────────────────────────────────────────────────
  const beatAlive = useMotionValue(0);
  const aliveRef = useRef(false);
  const [wakeA, wakeB] = [bStart - 0.04, cEnd];
  useMotionValueEvent(progress, 'change', (v) => {
    const on = v >= wakeA && v <= wakeB;
    if (on !== aliveRef.current) {
      aliveRef.current = on;
      beatAlive.set(on ? 1 : 0);
    }
  });
  const awake = inView && !still && level !== 'minimal';
  const subscribe = useSceneClock({ awake, level });
  /** Anillo de impactos de ESTA instancia. La portada monta dos copias de la
   *  escena (la viva y la apilada, oculta solo por CSS); un estado de módulo o
   *  un evento de `window` las mojaría a las dos. */
  const impacts = useRef<Impact[]>([]);

  // ── LAS LETRAS ────────────────────────────────────────────────────────
  // Se escriben como ATRIBUTO `transform` desde el reloj: arco con alabeo, de
  // fuera hacia dentro, con un tope duro de ±260 unidades. La versión anterior
  // mandaba cada letra hasta ±740 sobre un lienzo de 1000 con `overflow-visible`
  // — unos tres mil cuatrocientos píxeles de pintado fuera de cuadro por letra a
  // ×4,6, por nada.
  const letterRefs = useRef<Array<SVGGElement | null>>([]);
  useMotionValueEvent(away, 'change', (a) => {
    for (let i = 0; i < letters.length; i++) {
      const g = letterRefs.current[i];
      if (!g || i === Y_INDEX) continue;
      const l = letters[i];
      const dist = Math.abs(l.cx - CX);
      const lead = 0.22 * (1 - dist / 527);
      const u = Math.max(0, Math.min(1, (a - lead) / (1 - 0.164)));
      if (u <= 0.0005) {
        g.removeAttribute('transform');
        g.style.opacity = '1';
        continue;
      }
      const dir = l.cx < CX ? -1 : 1;
      const rank = Math.abs(l.i - Y_INDEX);
      const ay = (l.i % 2 === 0 ? -1 : 1) * (6 + 4 * rank);
      const tx = dir * 260 * u;
      const ty = ay * Math.pow(u, 1.3);
      const bank = dir * 1.6 * rank * u;
      g.setAttribute('transform', `translate(${tx.toFixed(1)} ${ty.toFixed(2)}) rotate(${bank.toFixed(2)} ${l.cx.toFixed(1)} 71)`);
      // La tinta muere MUCHO antes de que pare el movimiento: si se apaga tarde,
      // la letra se lee como que se aleja; si se apaga pronto, se lee como que
      // se aparta. Lo segundo es lo que pidió el encargo.
      g.style.opacity = u < 0.55 ? '1' : String(Math.max(0, 1 - (u - 0.55) / 0.45));
    }
  });

  if (still) return <StillFrame uid={uid} />;

  const step = (fEnd - fStart) / CLAUSES.length;

  return (
    <div ref={wrapRef} className="relative w-full" style={{ height: 'min(52svh, 500px)' }}>
      <EngraveBackdrop level={level} />

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WORDMARK_BOX.w} ${WORDMARK_BOX.h}`}
        className="relative z-10 block w-full h-full"
        // El desvanecido VERTICAL de los cantos. El cielo y el suelo cruzan el
        // cuadro entero, así que sin esto terminan en dos líneas rectas a lo
        // ancho de la pantalla y la escena se lee como un panel pegado encima de
        // la página. Solo en vertical: en reposo el nombre toca los dos cantos
        // laterales y un desvanecido horizontal se comería la A y la M. La
        // máscara es estática —el elemento no cambia de tamaño— así que se
        // rasteriza una vez y no entra en el coste por fotograma de la cámara.
        style={{
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 8%, #000 92%, transparent 100%)',
        }}
        fill="none"
        aria-hidden
        focusable="false"
      >
        <title>Astryum</title>
        <defs>
          {/* EL AMANECER: una FUENTE, no un lavado. Antes era un degradado
              lineal de ancho completo a 0,16 uniforme — luz que viene de todas
              partes, o sea de ninguna. Ahora hay un sitio del que sale. */}
          <radialGradient id={`${uid}-dawn`} cx="0.63" cy="1" r="0.55">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt))', stopOpacity: 0.3 }} />
            <stop offset="55%" style={{ stopColor: 'hsl(var(--volt))', stopOpacity: 0.09 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt))', stopOpacity: 0 }} />
          </radialGradient>

          {/* LAS DOS CARAS DEL MACIZO. El grupo se espeja sobre la lámina, así
              que un degradado autorado en el espacio de la cuenca se espeja con
              él: en ese espacio la CUMBRE está en y=65 (abajo) y la base en y=0.
              Por eso el extremo claro va al 100 %, no al 0 %. */}
          {/* Las dos caras. El degradado iba de y=0 a y=65 —el rango de la
              cuenca sola—, así que con el macizo entero (de −96 a 210) casi todo
              el dibujo caía en la primera parada y las dos caras salían del
              MISMO valor. El corte entre cara iluminada y cara en sombra es lo
              que convierte un sólido en un volumen; el valor por sí solo, no. */}
          <linearGradient id={`${uid}-face-lit`} gradientUnits="userSpaceOnUse" x1="0" y1="-96" x2="0" y2="210">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt))', stopOpacity: 0.52 }} />
            <stop offset="55%" style={{ stopColor: 'hsl(var(--volt))', stopOpacity: 0.3 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.6 }} />
          </linearGradient>
          <linearGradient id={`${uid}-face-shadow`} gradientUnits="userSpaceOnUse" x1="0" y1="-96" x2="0" y2="210">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.72 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.96 }} />
          </linearGradient>

          {/* EL TRAMADO QUE SIGUE LA FORMA. La pared de la cuenca cae a 48,4°,
              así que la línea de máxima pendiente es 48° y el rayado va por ahí
              — un tramado que describe el volumen, no que lo cruza.
              OJO: la línea va en el CENTRO de la celda (x=1.6 de 3.2). En la
              versión anterior estaba en x=0 de una celda de 7, y el recorte del
              patrón se comía la mitad del trazo que caía en x<0: cada raya
              salía asimétrica y con la mitad del peso pedido. */}
          <pattern id={`${uid}-hatch-lit`} width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(48)">
            <line x1="1.6" y1="0" x2="1.6" y2="3.2" stroke="hsl(var(--volt-hi))" strokeWidth="0.28" strokeOpacity="0.1" />
          </pattern>
          <pattern id={`${uid}-hatch-shadow`} width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(48)">
            <line x1="1.6" y1="0" x2="1.6" y2="3.2" stroke="hsl(var(--volt-deep))" strokeWidth="0.34" strokeOpacity="0.5" />
            <line x1="0" y1="1.6" x2="3.2" y2="1.6" stroke="hsl(var(--volt-deep))" strokeWidth="0.28" strokeOpacity="0.32" />
          </pattern>

          {/* LA PAREJA DE LIQUIDEZ, por ÁNGULO DE TRAMA y no por color: dos
              rayados a ±38°. Una tinta, ningún color de otro producto. */}
          <pattern id={`${uid}-lp-a`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
            <line x1="3" y1="0" x2="3" y2="6" stroke="hsl(var(--volt))" strokeWidth="0.7" strokeOpacity="0.5" />
          </pattern>
          <pattern id={`${uid}-lp-b`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
            <line x1="3" y1="0" x2="3" y2="6" stroke="hsl(var(--volt-soft))" strokeWidth="0.7" strokeOpacity="0.32" />
          </pattern>

          {/* el cuerpo del agua: claro en la superficie, oscuro en el fondo */}
          <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-soft))', stopOpacity: 0.3 }} />
            <stop offset="42%" style={{ stopColor: 'hsl(var(--volt))', stopOpacity: 0.2 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.12 }} />
          </linearGradient>
          <linearGradient id={`${uid}-deep`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.62 }} />
          </linearGradient>

          {/* LA BANDA DEL AGUA. Brillante donde cae la luz y apagada en la
              orilla lejana: un trazo SVG no puede variar de grosor, y un
              destello de anchura constante es el delator. */}
          <linearGradient id={`${uid}-surf`} gradientUnits="userSpaceOnUse" x1={CX - WATER_HALF} y1="0" x2={CX + WATER_HALF} y2="0">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.1 }} />
            <stop offset="62%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.55 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.18 }} />
          </linearGradient>

          {/* La niebla se deshace en LOS DOS ejes: la versión anterior era un
              rectángulo con degradado solo horizontal, así que terminaba en dos
              cantos rectos perfectamente visibles. */}
          <radialGradient id={`${uid}-mist`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.11 }} />
            <stop offset="60%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.05 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0 }} />
          </radialGradient>

          {/* El lago y el macizo tenían UN clipPath compartido, así que cambiar
              la forma del lago cambiaba en silencio la de la montaña. */}
          <clipPath id={`${uid}-lake`}>
            <path d={BASIN_FILL_D} />
          </clipPath>
          <clipPath id={`${uid}-massif-lit`}>
            <path d={FACES[1].d} />
            <path d={FACES[3].d} />
          </clipPath>
        </defs>

        {/* EL AMANECER */}
        <motion.rect x="-260" y="-260" width={WORDMARK_BOX.w + 520} height={WATER_Y + 260} fill={`url(#${uid}-dawn)`} style={{ opacity: dawnIn }} />

        {/* LAS TRES CORDILLERAS, de lejos a cerca. La lejana no lleva contorno
            ninguno: a esa distancia una cresta es silueta. */}
        {RIDGES.map((r, i) => (
          <FarRidge key={r.depth} d={r.d} depth={r.depth} on={i === 0 ? ridge3In : i === 1 ? ridge2In : rockIn} />
        ))}

        {/* LA NIEBLA — dos bandas, las dos DETRÁS del macizo y con un techo de
            alfa de 0,10. El argumento de este tiempo lo llevan el limnímetro,
            las sondas y las isóbatas, y una bruma que se come los instrumentos
            para que la foto quede cinematográfica es justo el trato que esta
            escena tiene que rechazar. */}
        <motion.g style={{ opacity: dawnIn, x: mistX }}>
          <ellipse cx="600" cy={WATER_Y - 3} rx="420" ry="9" fill={`url(#${uid}-mist)`} />
        </motion.g>

        <motion.g style={{ opacity: dawnIn, x: mistX }}>
          <ellipse cx="560" cy={WATER_Y + 3} rx="340" ry="7" fill={`url(#${uid}-mist)`} opacity="0.55" />
        </motion.g>

        {/* ── EL MACIZO ─────────────────────────────────────────────────
            Cuatro caras con UNA sola luz: los tramos que BAJAN hacia la derecha
            están de cara a ella y los que suben están de espaldas. Las dos
            paredes de la cuenca heredan la misma regla sin excepción, y por eso
            el valle y las cumbres se leen como un macizo y no como dos dibujos
            pegados. */}
        <motion.g style={{ opacity: rockIn }}>
          {FACES.map((f, i) => (
            <path key={`f${i}`} d={f.d} fill={`url(#${uid}-face-${f.lit ? 'lit' : 'shadow'})`} />
          ))}
        </motion.g>
        <motion.g style={{ opacity: hatchAlpha }}>
          {FACES.map((f, i) => (
            <path key={`h${i}`} d={f.d} fill={`url(#${uid}-hatch-${f.lit ? 'lit' : 'shadow'})`} />
          ))}
        </motion.g>
        {/* los estratos, SOLO en las caras iluminadas: en las de sombra la masa
            tiene que quedarse maciza */}
        <motion.g clipPath={`url(#${uid}-massif-lit)`} style={{ opacity: beddingAlpha }}>
          {BEDDING.map((b) => (
            <path key={b.d} d={b.d} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity={b.o} strokeWidth={b.w} />
          ))}
        </motion.g>
        {/* LA NIEVE, trazada desde las crestas reales y más baja en la cara de
            sombra que en la iluminada */}
        <motion.g style={{ opacity: snowIn }}>
          {SNOW_RUNS.map((d) => (
            <path key={d} d={d} fill="hsl(var(--volt-hi) / 0.26)" />
          ))}
          {SNOW_RUNS.map((d) => (
            <path
              key={`c${d}`}
              d={d}
              fill="none"
              stroke="hsl(var(--volt-hi) / 0.8)"
              strokeWidth={INK.pelo}
              transform={`translate(${(LIGHT.x * 1).toFixed(2)} ${(LIGHT.y * -1).toFixed(2)})`}
            />
          ))}
        </motion.g>
        {/* el filo iluminado: SOLO las crestas que reciben la luz */}
        <motion.path d={RIM_LIGHT_D} fill="none" stroke="hsl(var(--volt-hi) / 0.45)" strokeWidth={INK.trazo} strokeLinejoin="round" style={{ opacity: rimIn }} />
        {/* EL PERFIL, de banco a banco. El filete grueso de la escala de tintas,
            SIN `non-scaling-stroke`: engorda de verdad al acercarse. */}
        <motion.path
          d={PROFILE_D}
          fill="none"
          stroke="hsl(var(--volt))"
          strokeOpacity="0.78"
          strokeWidth={INK.filete}
          strokeLinejoin="round"
          style={{ opacity: lineIn }}
        />

        {/* ── EL LAGO ──────────────────────────────────────────────────── */}
        <motion.g clipPath={`url(#${uid}-lake)`} style={{ opacity: lakeInk }}>
          <rect x={RIM_L - 4} y={WATER_Y} width={RIM_R - RIM_L + 8} height={FLOOR_Y - WATER_Y + 4} fill={`url(#${uid}-lp-a)`} />
          <rect x={RIM_L - 4} y={WATER_Y} width={RIM_R - RIM_L + 8} height={FLOOR_Y - WATER_Y + 4} fill={`url(#${uid}-lp-b)`} />
        </motion.g>
        <motion.g clipPath={`url(#${uid}-lake)`} style={{ opacity: waterIn }}>
          {/* EL CUERPO DEL AGUA. Antes de esto la cuenca «llena» era la trama
              de la LP sobre la roca desnuda y un degradado de fondo casi
              transparente: medido en captura, el interior de la cuenca tenía
              prácticamente el mismo valor que la roca de al lado, así que la
              parada que se llama «La lámina» no enseñaba lámina ninguna. Un
              lavado propio, más claro arriba y hundiéndose hacia el fondo, es
              lo que hace que el hueco se lea LLENO y no excavado. */}
          <rect
            x={RIM_L - 4}
            y={WATER_Y}
            width={RIM_R - RIM_L + 8}
            height={FLOOR_Y - WATER_Y + 4}
            fill={`url(#${uid}-body)`}
          />
          <rect x={RIM_L - 4} y={WATER_Y} width={RIM_R - RIM_L + 8} height={FLOOR_Y - WATER_Y + 4} fill={`url(#${uid}-deep)`} />
        </motion.g>

        {/* EL FONDO MEDIDO — isóbatas que abrazan la forma real, con jerarquía
            de peso y de paso de guion. Sin una sola cifra: una escala con
            números es un dato, y un dato sin fuente no se pinta. */}
        <motion.g style={{ opacity: bedIn }} clipPath={`url(#${uid}-lake)`}>
          {SOUNDINGS.map((s) => (
            <path
              key={s.dash}
              d={s.d}
              fill="none"
              stroke="hsl(var(--volt-soft))"
              strokeOpacity={s.o}
              strokeWidth={INK.pelo}
              strokeDasharray={s.dash}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </motion.g>

        {/* EL AGUA — un sistema, acoplado a las gotas */}
        <Water uid={uid} waterIn={waterIn} subscribe={subscribe} alive={beatAlive} level={level} impacts={impacts} />

        {/* EL TAMIZ, antes que las gotas: la malla está puesta desde el primer
            fotograma de la parada, y lo que llega después es lo que se tamiza.
            Si apareciera con la primera gota parecería una consecuencia de la
            gota, y es justo al revés — la regla se escribe ANTES. */}
        <Sieve on={sieveIn} />

        {/* LAS GOTAS */}
        {CLAUSES.map((c, i) => (
          <Droplet key={c.id} clause={c} progress={progress} at={clauseTiming(i).at} step={step} impacts={impacts} />
        ))}

        {/* EL NOMBRE, y no se pinta hasta que la medición ha terminado.
            Entre el montaje y `document.fonts.ready` el componente pintaba la
            palabra de una pieza y al medir la cambiaba por siete letras, que
            con la entrada puesta arrancan en cero: la palabra aparecía,
            desaparecía y volvía. Esperar un par de fotogramas es invisible;
            enseñar un fotograma que vas a retirar, no. */}
        <g style={{ visibility: settled ? undefined : 'hidden' }}>
        <WordmarkSplit
          letters={letters}
          measured={measured}
          uid={uid}
          rest={rest}
          sweepOn={level === 'full' || level === 'calm'}
          subscribe={subscribe}
          renderLetter={(i, node) => {
            // LA ENTRADA vive en un `<g>` ENVOLVENTE. La separación por scroll
            // escribe el atributo `transform` y el `style.opacity` del `<g>` de
            // dentro; una animación CSS sobre ese mismo elemento ganaría a las
            // dos escrituras y la letra dejaría de separarse. Dos capas: la de
            // fuera hace la entrada una vez, la de dentro obedece al scroll
            // para siempre.
            const enter = (
              <g
                key={`e${i}`}
                className={still ? undefined : 'iv-letter'}
                // EL ORDEN ES DESDE LA Y HACIA FUERA, no de izquierda a derecha.
                // La Y es la letra de la que sale todo el recorrido —se abre en
                // horquilla, se llena de agua y acaba siendo el valle—, así que
                // es la que tiene que aterrizar primero y las demás componerse a
                // su alrededor. Una cascada de izquierda a derecha es la que
                // hace cualquiera; esta cuenta de qué va la página.
                style={{ animationDelay: `${(0.34 + Math.abs(i - Y_INDEX) * 0.07).toFixed(3)}s` }}
              >
                {i === Y_INDEX ? (
                  <motion.g style={{ opacity: yInk }}>{node}</motion.g>
                ) : (
                  <g
                    ref={(el) => {
                      letterRefs.current[i] = el;
                    }}
                  >
                    {node}
                  </g>
                )}
              </g>
            );
            return enter;
          }}
        />

        </g>

        {/* LAS MARCAS DE REGISTRO — publicar el corte */}
        <RegisterMarks letters={letters} away={away} />
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PIEZAS
   ══════════════════════════════════════════════════════════════════════ */

/** EL PAPEL. Retícula de levantamiento y grano horneado, en HTML detrás del
 *  SVG: la cámara es el `viewBox`, así que una trama dibujada dentro se
 *  ampliaría ×4,6 y una retícula ampliada son cuatro rayas gordas.
 *
 *  La caja era `inset: -140% -25%` con una `mask-image` encima y `will-change`
 *  permanente: dos búferes de pantalla completa retenidos para dieciséis
 *  píxeles de recorrido. Ahora la viñeta va en el propio fondo (un fondo es
 *  gratis, una máscara es un segundo búfer) y la caja es del tamaño de lo que
 *  se mueve. */
function EngraveBackdrop({ level }: { level: MotionLevel }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (level === 'minimal' || typeof window === 'undefined') return;
    if (window.matchMedia('(hover: none)').matches) return;
    let frame = 0;
    let idle = 0;
    let nx = 0;
    let ny = 0;
    const lag = level === 'calm' ? 0.35 : 1;
    const apply = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      el.style.transform = `translate3d(${(nx * -14 * lag).toFixed(1)}px, ${(ny * -9 * lag).toFixed(1)}px, 0)`;
      el.style.willChange = 'transform';
      window.clearTimeout(idle);
      idle = window.setTimeout(() => {
        if (ref.current) ref.current.style.willChange = 'auto';
      }, 200);
    };
    const onMove = (e: PointerEvent) => {
      nx = e.clientX / Math.max(1, window.innerWidth) - 0.5;
      ny = e.clientY / Math.max(1, window.innerHeight) - 0.5;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
      window.clearTimeout(idle);
    };
  }, [level]);

  return (
    <div
      ref={ref}
      aria-hidden
      className="absolute pointer-events-none z-0"
      style={{
        inset: '-60px -40px',
        backgroundImage:
          'repeating-linear-gradient(0deg, hsl(var(--volt) / 0.045) 0 1px, transparent 1px 34px),' +
          'repeating-linear-gradient(90deg, hsl(var(--volt) / 0.045) 0 1px, transparent 1px 34px)',
        maskImage: 'radial-gradient(62% 52% at 50% 46%, #000 0%, transparent 78%)',
        WebkitMaskImage: 'radial-gradient(62% 52% at 50% 46%, #000 0%, transparent 78%)',
      }}
    />
  );
}

/** Una cordillera del fondo. La distancia va en el ALFA y en un viraje de tono
 *  hacia el color del cielo: lo primero solo es difuminar, los dos juntos son
 *  perspectiva aérea. */
function FarRidge({ d, depth, on }: { d: string; depth: 0 | 1 | 2; on: MotionValue<number> }) {
  const alpha = [0.72, 0.34, 0.18][depth];
  const tint = [0.08, 0.22, 0.38][depth];
  const stroke = [INK.filete, INK.trazo, 0][depth];
  return (
    <motion.g style={{ opacity: on }}>
      <path d={d} fill={`hsl(var(--volt-deep) / ${alpha})`} />
      <path d={d} fill={`hsl(var(--volt-hi) / ${tint * 0.42})`} />
      {stroke > 0 && <path d={d} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity={0.22} strokeWidth={stroke * 0.5} strokeLinejoin="round" />}
    </motion.g>
  );
}

/* ── EL AGUA ──────────────────────────────────────────────────────────── */

const SAMPLES = 26;
/** Cinco componentes con razones de frecuencia mutuamente irracionales y
 *  velocidades de fase independientes: el periodo del bucle se vuelve
 *  inabarcable y nadie puede pillarlo repitiéndose. Antes eran DOS senos. */
const WF = [6.1, 9.7, 15.3, 24.1, 38.9];
const WV = [1.25, -0.83, 0.61, -1.9, 2.7];
const WW = [0.42, 0.22, 0.12, 0.06, 0.03];

interface Impact {
  x: number;
  t0: number;
}

/**
 * LA SUPERFICIE. Es la única pieza con reloj propio, y lo tiene porque el agua
 * no se queda quieta cuando dejas de mover la rueda.
 *
 * Lo que la sube de nivel no son más senos: es que SABE de las gotas. Antes
 * `wavePath(t)` era una función pura del tiempo, así que una gota caía, se
 * apagaba exactamente sobre la superficie, y el lago no se enteraba. Esa
 * desconexión es el «escrito con un par de líneas de JS» más claro que había en
 * las dos escenas.
 */
function Water({
  uid,
  waterIn,
  subscribe,
  alive,
  level,
  impacts,
}: {
  uid: string;
  waterIn: MotionValue<number>;
  subscribe: (fn: (t: number, dt: number) => void) => () => void;
  alive: MotionValue<number>;
  level: MotionLevel;
  impacts: React.MutableRefObject<Impact[]>;
}) {
  const crest = useRef<SVGPathElement>(null);
  const band = useRef<SVGPathElement>(null);
  const gauge = useRef<SVGPathElement>(null);

  useEffect(() => {
    const amp = level === 'calm' ? 0.5 : 1;
    return subscribe((t) => {
      if (alive.get() < 0.5) return;
      const now = performance.now() / 1000;
      // caducar los impactos viejos
      while (impacts.current.length && now - impacts.current[0].t0 > 2) impacts.current.shift();

      const x0 = CX - WATER_HALF;
      const x1 = CX + WATER_HALF;
      const pts: Pt[] = [];
      for (let i = 0; i <= SAMPLES; i++) {
        const f = i / SAMPLES;
        const x = x0 + (x1 - x0) * f;
        let y = WATER_Y;
        for (let k = 0; k < WF.length; k++) y += Math.sin(f * WF[k] + t * WV[k]) * WW[k];
        // envolvente de orilla: la cresta llega a la roca con amplitud CERO en
        // vez de atravesarla
        y = WATER_Y + (y - WATER_Y) * Math.pow(Math.sin(Math.PI * f), 0.6) * amp;
        for (const imp of impacts.current) {
          const age = now - imp.t0;
          const u = (Math.abs(x - imp.x) - 11 * age) / 3;
          y += -1.6 * ricker(u) * Math.exp(-age / 0.9) * amp;
        }
        pts.push([x, y]);
      }
      const d = catmullToCubic(pts);
      crest.current?.setAttribute('d', d);
      band.current?.setAttribute('d', `${d}L${x1.toFixed(2)} ${(WATER_Y + 2.1).toFixed(2)}L${x0.toFixed(2)} ${(WATER_Y + 2.1).toFixed(2)}Z`);
      // EL LIMNÍMETRO MONTA SU PROPIA AGUA: el índice se coloca evaluando la
      // MISMA función de onda en la abscisa de la mira. Este acoplamiento es la
      // única cosa de la lista que no se puede fingir.
      const gy = pts[SAMPLES][1];
      gauge.current?.setAttribute('d', `M${RIM_R + 10.4} ${(gy - 1.7).toFixed(2)}L${RIM_R + 7.4} ${gy.toFixed(2)}L${RIM_R + 10.4} ${(gy + 1.7).toFixed(2)}Z`);
    });
  }, [subscribe, alive, level, impacts]);

  const bandAlpha = waterIn;

  return (
    <>
      <motion.path ref={band} d="" fill={`url(#${uid}-surf)`} style={{ opacity: bandAlpha }} />
      <motion.path
        ref={crest}
        d=""
        fill="none"
        stroke="hsl(var(--volt-hi))"
        strokeOpacity="0.62"
        strokeWidth={INK.pelo * 0.85}
        style={{ opacity: bandAlpha }}
      />
      <Limnimeter opacity={bandAlpha} gaugeRef={gauge} />
    </>
  );
}

/** EL LIMNÍMETRO. Una mira con cuerpo —no un palo— y sus marcas en E, el
 *  patrón clásico de una mira de nivelación. Sin una sola cifra. Vive en la
 *  pared DERECHA porque en la izquierda caía encima del expediente. */
function Limnimeter({ opacity, gaugeRef }: { opacity: MotionValue<number>; gaugeRef: React.RefObject<SVGPathElement | null> }) {
  const x = RIM_R + 7;
  const marks: Array<{ y: number; w: number }> = [];
  for (let y = 8; y <= WATER_Y + 5; y += 2) marks.push({ y, w: y % 10 === 8 ? 3.6 : y % 6 === 2 ? 2.4 : 1.4 });
  return (
    <motion.g style={{ opacity }}>
      {/* el cuerpo de la mira, con su canto iluminado y su canto en sombra */}
      <rect x={x - 1.4} y={5} width={2.8} height={WATER_Y + 3} fill="hsl(var(--volt-deep) / 0.8)" />
      <rect x={x - 1.4} y={5} width={0.7} height={WATER_Y + 3} fill="hsl(var(--volt-hi) / 0.25)" />
      {marks.map((m) => (
        <line
          key={m.y}
          x1={x - 1.4}
          y1={m.y}
          x2={x - 1.4 - m.w}
          y2={m.y}
          stroke="hsl(var(--volt-soft))"
          strokeOpacity={m.w > 3 ? 0.5 : 0.3}
          strokeWidth="0.6"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {/* el índice: lo coloca el reloj del agua, no una interpolación aparte */}
      <path ref={gaugeRef} d={`M${x + 3.4} ${WATER_Y - 1.7}L${x + 0.4} ${WATER_Y}L${x + 3.4} ${WATER_Y + 1.7}Z`} fill="hsl(var(--volt-hi) / 0.85)" />
    </motion.g>
  );
}

/* ── LAS GOTAS ────────────────────────────────────────────────────────── */

/**
 * UNA GOTA. Cae en CAÍDA LIBRE —cuadrática, no lineal— estirándose con volumen
 * constante, y al entrar perturba de verdad la superficie.
 *
 * Si pasa: atraviesa la lámina, se hunde un poco en vez de apagarse encima, y
 * deja TRES anillos que se abren desacelerando y adelgazando.
 * Si no pasa: se queda posada sobre el agua, le cae un ASPA sellada en dos
 * trazos con tiempos independientes y luego resbala hasta el borde con
 * rozamiento, dejando dos estelas cortas.
 */
/**
 * LA MALLA. Un travesaño por banda, seguido de sus barrotes, y los dos
 * empotrados en las paredes de la cuenca — una malla que flota en el aire no la
 * sostiene nada. Cada barrote va con su pareja de luz y sombra sobre el vector
 * de LIGHT: es lo que convierte una línea en un alambre.
 */
function Sieve({ on }: { on: MotionValue<number> }) {
  const y = SIEVE_Y;
  const x0 = CX - SIEVE_HALF;
  const x1 = CX + SIEVE_HALF;
  return (
    <motion.g style={{ opacity: on }}>
      {/* los barrotes */}
      {SIEVE_BARS.map((bx) => (
        <g key={bx}>
          <line
            x1={bx + LIGHT.x * 0.22}
            y1={y - 0.85 + LIGHT.y * 0.22}
            x2={bx + LIGHT.x * 0.22}
            y2={y + 0.85 + LIGHT.y * 0.22}
            stroke="hsl(var(--ink) / 0.5)"
            strokeWidth={INK.tramado * 1.6}
          />
          <line
            x1={bx - LIGHT.x * 0.22}
            y1={y - 0.85 - LIGHT.y * 0.22}
            x2={bx - LIGHT.x * 0.22}
            y2={y + 0.85 - LIGHT.y * 0.22}
            stroke="hsl(var(--volt-hi) / 0.34)"
            strokeWidth={INK.tramado * 1.6}
          />
        </g>
      ))}
      {/* los dos travesaños, y sus empotres en la roca */}
      <line x1={x0} y1={y - 0.85} x2={x1} y2={y - 0.85} stroke="hsl(var(--volt-hi) / 0.3)" strokeWidth={INK.tramado * 1.4} />
      <line x1={x0} y1={y + 0.85} x2={x1} y2={y + 0.85} stroke="hsl(var(--ink) / 0.5)" strokeWidth={INK.tramado * 1.4} />
      <path
        d={`M${x0 - 3.2} ${y - 2.4}L${x0} ${y - 0.85}L${x0} ${y + 0.85}L${x0 - 3.2} ${y + 2.4}Z`}
        fill="hsl(var(--volt) / 0.32)"
      />
      <path
        d={`M${x1 + 3.2} ${y - 2.4}L${x1} ${y - 0.85}L${x1} ${y + 0.85}L${x1 + 3.2} ${y + 2.4}Z`}
        fill="hsl(var(--volt) / 0.32)"
      />
    </motion.g>
  );
}

function Droplet({
  clause,
  progress,
  at,
  step,
  impacts,
}: {
  clause: (typeof CLAUSES)[number];
  progress: MotionValue<number>;
  at: number;
  step: number;
  impacts: React.MutableRefObject<Impact[]>;
}) {
  const pass = clause.pass;
  const x0 = clause.x;
  const outward = x0 < CX ? -1 : 1;
  // La que no cumple se queda ENCIMA de la malla, no flotando sobre el agua.
  const restY = SIEVE_Y - 2.4;
  const driftX = CX + outward * (SIEVE_HALF + 7);
  /** Lo que no cumple es MÁS GRANDE que la luz de la malla. No hace falta
   *  contarlo: se ve que no cabe. */
  const GIRTH = pass ? 1 : 1.62;

  const fall = at + step * 0.42;
  const land = at + step * 0.52;
  const done = at + step * 0.9;
  const vStart = BEATS.valley[0];

  const t = useTransform(progress, [at, fall], [0, 1], { clamp: true });
  // caída libre exacta: el tramo lineal era el delator más barato de la escena
  const y = useTransform(t, (v) =>
    pass ? -30 + (WATER_Y + 1.5 + 30) * v * v : -30 + (restY + 30) * v * v,
  );
  // La rechazada se ESCURRE por la malla en vez de derivar por el aire: sale
  // después del golpe, no durante, y se va por el canto.
  const x = useTransform(
    progress,
    pass ? [at, land, done] : [at, fall + step * 0.12, done],
    pass ? [x0, x0, x0] : [x0, x0, driftX],
    { clamp: true },
  );
  // EL APLASTAMIENTO. En vuelo, estiramiento de volumen constante. Y al chocar
  // contra la malla —solo la que no cabe— un achatamiento corto y su rebote:
  // una gota que se para en seco sin deformarse es un sprite, no un líquido.
  const hit = useTransform(progress, [fall - step * 0.02, fall + step * 0.06, fall + step * 0.16], [0, 1, 0], {
    clamp: true,
  });
  const sy = useTransform([t, hit] as MotionValue<number>[], ([v, h]: number[]) =>
    (1 + 0.6 * v) * (pass ? 1 : 1 - 0.52 * h),
  );
  const sx = useTransform([t, hit] as MotionValue<number>[], ([v, h]: number[]) =>
    (1 / Math.sqrt(1 + 0.6 * v)) * (pass ? 1 : 1 + 0.58 * h),
  );
  const opacity = useTransform(
    progress,
    pass ? [at, at + step * 0.08, fall, fall + step * 0.07] : [at, at + step * 0.08, land + step * 0.22, done],
    [0, 1, 1, 0],
    { clamp: true },
  );
  const crossO = useTransform(progress, [fall + step * 0.08, fall + step * 0.2, vStart, vStart + 0.04], [0, 0.85, 0.85, 0], { clamp: true });

  // El aviso al agua: se emite en el CRUCE del aterrizaje, dos veces por tiempo,
  // nunca por fotograma.
  const fired = useRef(false);
  useMotionValueEvent(progress, 'change', (v) => {
    if (!pass) return;
    const on = v >= land - step * 0.02 && v <= land + step * 0.06;
    if (on && !fired.current) {
      fired.current = true;
      impacts.current.push({ x: x0, t0: performance.now() / 1000 });
      if (impacts.current.length > 6) impacts.current.shift();
    } else if (!on) {
      fired.current = false;
    }
  });

  return (
    <>
      {pass && <Rings x={x0} progress={progress} land={land} done={done} />}
      <motion.g style={{ x, y, opacity }}>
        <motion.g style={{ scaleX: sx, scaleY: sy }}>
          {/* LA QUE NO CUMPLE TAMBIÉN SE VE. Iba en `--ink / 0.5` —tinta oscura
              sobre una escena oscura— así que en vuelo era invisible: solo se
              veían las que pasan, que es contar media historia. Ahora tiene
              cuerpo propio y su contorno es el tono de rechazo de la casa, así
              que se distingue de la que pasa sin dejar de ser una gota. */}
          <path
            transform={`scale(${GIRTH})`}
            d="M0 2.2 C-1.55 2.2 -1.95 0.6 0 -2.5 C1.95 0.6 1.55 2.2 0 2.2 Z"
            fill={pass ? 'hsl(var(--volt-hi) / 0.92)' : 'hsl(var(--volt-soft) / 0.34)'}
            stroke={pass ? undefined : TONE.danger}
            strokeWidth={pass ? undefined : 0.5}
            strokeOpacity={pass ? undefined : 0.75}
          />
          {/* el brillo interior, desplazado a lo largo de LA MISMA luz */}
          <ellipse cx={LIGHT.x * 0.45} cy={LIGHT.y * 0.45} rx="0.42" ry="0.5" fill="hsl(var(--volt-hi) / 0.6)" />
        </motion.g>
      </motion.g>
      {!pass && (
        <motion.g style={{ opacity: crossO }}>
          {/* el aspa: dos trazos con tiempos y ángulos distintos, para que sea
              un SELLO y no un icono centrado */}
          <path
            d={`M${x0 - 1.7} ${SIEVE_Y - 3.4}L${x0 + 1.7} ${SIEVE_Y - 0.2}`}
            stroke={TONE.danger}
            strokeOpacity="0.72"
            strokeWidth="0.9"
            strokeLinecap="round"
            transform={`rotate(-5 ${x0} ${SIEVE_Y - 1.8})`}
          />
          <path
            d={`M${x0 + 1.7} ${SIEVE_Y - 3.4}L${x0 - 1.7} ${SIEVE_Y - 0.2}`}
            stroke={TONE.danger}
            strokeOpacity="0.72"
            strokeWidth="0.9"
            strokeLinecap="round"
            transform={`rotate(4 ${x0} ${SIEVE_Y - 1.8})`}
          />
          <circle cx={x0} cy={SIEVE_Y - 1.8} r="2.7" fill="none" stroke={TONE.danger} strokeOpacity="0.4" strokeWidth="0.4" />
        </motion.g>
      )}
    </>
  );
}

/** Tres anillos escalonados que se abren DESACELERANDO y adelgazando. Un
 *  anillo de velocidad constante y grosor constante es lo que dibuja un
 *  programa; uno que frena y se afina es lo que hace el agua. */
function Rings({ x, progress, land, done }: { x: number; progress: MotionValue<number>; land: number; done: number }) {
  return (
    <>
      {[0, 0.06, 0.13].map((off, i) => (
        <Ring key={off} x={x} progress={progress} a={land + (done - land) * off} b={done} idx={i} />
      ))}
    </>
  );
}

function Ring({ x, progress, a, b, idx }: { x: number; progress: MotionValue<number>; a: number; b: number; idx: number }) {
  const R = 17 - idx * 3;
  const u = useTransform(progress, [a, b], [0, 1], { clamp: true });
  const rx = useTransform(u, (v) => 0.6 + R * (1 - Math.exp(-3 * v)));
  const ry = useTransform(rx, (v) => v * 0.26);
  const w = useTransform(u, (v) => 1.1 - 0.85 * v);
  const o = useTransform(u, (v) => (v <= 0.001 || v >= 0.999 ? 0 : (0.68 / (1 + 2 * v)) * (1 - v)));
  return <motion.ellipse cx={x} cy={WATER_Y} rx={rx} ry={ry} fill="none" stroke="hsl(var(--volt-hi))" strokeWidth={w} style={{ opacity: o }} />;
}

/* ── EL FOTOGRAMA DE REPOSO ───────────────────────────────────────────── */

/**
 * No es un modo degradado: es el CARTEL. Es lo que ve cada teléfono y cada
 * usuario de «Mínimo», o sea la mayoría de las visitas.
 *
 * Enseña el VALLE, no la letra: las dos cumbres, el lago entre ellas y las
 * cordilleras del fondo, encuadrados. El nombre no va aquí — el fundador fue
 * claro en que no quiere el macizo metido dentro de la Y, y en una tarjeta de
 * móvil el paisaje entero no cabe además de siete letras. La página ya lleva la
 * marca en su cabecera.
 */
function StillFrame({ uid }: { uid: string }) {
  return (
    <svg viewBox="180 -120 700 220" className="block w-full h-auto" fill="none" aria-hidden focusable="false">
      <title>Astryum</title>
      <defs>
        <linearGradient id={`${uid}-sflit`} gradientUnits="userSpaceOnUse" x1="0" y1="-96" x2="0" y2="120">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt))', stopOpacity: 0.5 }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.28 }} />
        </linearGradient>
        <linearGradient id={`${uid}-sfsh`} gradientUnits="userSpaceOnUse" x1="0" y1="-96" x2="0" y2="120">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.9 }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.38 }} />
        </linearGradient>
      </defs>
      {RIDGES.map((r) => (
        <path key={r.depth} d={r.d} fill={`hsl(var(--volt-deep) / ${[0.72, 0.34, 0.18][r.depth]})`} />
      ))}
      {FACES.map((f, i) => (
        <path key={i} d={f.d} fill={`url(#${uid}-sf${f.lit ? 'lit' : 'sh'})`} />
      ))}
      {SNOW_RUNS.map((d) => (
        <path key={d} d={d} fill="hsl(var(--volt-hi) / 0.26)" />
      ))}
      <path d={PROFILE_D} fill="none" stroke="hsl(var(--volt) / 0.78)" strokeWidth={INK.filete} strokeLinejoin="round" />
      <g clipPath={`url(#${uid}-slake)`}>
        <rect x={RIM_L - 4} y={WATER_Y} width={RIM_R - RIM_L + 8} height={FLOOR_Y - WATER_Y + 4} fill="hsl(var(--volt) / 0.18)" />
      </g>
      <clipPath id={`${uid}-slake`}>
        <path d={BASIN_FILL_D} />
      </clipPath>
      <line x1={CX - WATER_HALF} y1={WATER_Y} x2={CX + WATER_HALF} y2={WATER_Y} stroke="hsl(var(--volt-hi) / 0.7)" strokeWidth={INK.pelo} />
    </svg>
  );
}

export const ValleyScene = memo(ValleySceneImpl);
export default ValleyScene;

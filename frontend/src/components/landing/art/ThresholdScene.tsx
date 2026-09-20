'use client';

/**
 * EL ARCO — la escena del producto Legacy.
 *
 * La idea no se toca: un hueco, una cimbra, las dovelas, la clave, el
 * descimbrado y algo que cruza. Lo que se rehace es la EJECUCIÓN, porque medido
 * en captura a 1440×900 el dibujo contaba otra cosa:
 */

import { memo, useId, useMemo, useRef, type ReactNode } from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import type { MotionLevel } from '../../../stores/motionStore';
import { catmullToCubic, INK, LIGHT, mulberry32, ridge, toPath, type Pt } from './craft';
import { useAspectViewBox } from './craftHooks';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

/* ── El reparto del scroll ─────────────────────────────────────────────── */
export const LEGACY_BEATS = {
  /** Hay un hueco. Nada cruza. */
  gap: [0.0, 0.12],
  /** La cimbra: el armazón provisional. Mientras estás, lo sostienes tú. */
  centring: [0.12, 0.3],
  /** Las dovelas, una a una, desde los arranques hacia dentro. */
  stones: [0.3, 0.52],
  /** La clave. A partir de aquí las piezas se empujan entre sí. */
  key: [0.52, 0.68],
  /** EL DESCIMBRADO. Se retira el soporte y el arco se queda de pie. */
  strike: [0.68, 0.84],
  /** Algo cruza, y llega entero. */
  cross: [0.84, 1.0],
} as const;

/** Un tramo interpolado dentro de un tiempo del guion. Existe para que NINGÚN
 *  número del itinerario se escriba dos veces: la escena y las láminas leen la
 *  misma tabla, y el día que un tiempo se mueva se mueven las dos juntas. */
const within = (beat: readonly number[], a: number, b: number): [number, number] => [
  beat[0] + (beat[1] - beat[0]) * a,
  beat[0] + (beat[1] - beat[0]) * b,
];

/**
 * LOS TIEMPOS QUE LAS LÁMINAS COMPARTEN CON LA ESCENA.
 *
 * Una lámina que se monta con su cortinilla y se queda quieta es una captura
 * pegada encima del recorrido. Estas cuatro funciones son el contrato: la fila
 * i de cada lámina resuelve en el MISMO fotograma en que la escena hace lo que
 * esa fila dice. Si alguien cambia un tiempo arriba, la lámina le sigue.
 */
/** El asiento i del consejo, al ritmo al que se colocan las dovelas. */
export const councilTiming = (i: number, n = 5): [number, number] =>
  within(LEGACY_BEATS.stones, 0.1 + (0.72 * i) / n, 0.1 + (0.72 * (i + 1)) / n);
/** La cláusula i de la constitución, mientras entra la clave. */
export const constitutionTiming = (i: number, n = 4): [number, number] =>
  within(LEGACY_BEATS.key, 0.08 + (0.62 * i) / n, 0.08 + (0.62 * (i + 1)) / n + 0.06);
/**
 * LA PÉNDOLA i — y la celda i de la lámina del quórum, que son lo mismo.
 *
 * Para que eso sea verdad y no un parecido, la celda de la
 * lámina y la péndola de la escena tienen que encenderse en el MISMO fotograma,
 * y por eso las dos leen esta función. Llegan cuando el arco ya está de pie:
 * primero se sostiene solo, después se le cuelga el paso.
 */
export const hangerTiming = (i: number, n = 5): [number, number] =>
  within(LEGACY_BEATS.strike, 0.56 + (0.32 * i) / n, 0.56 + (0.32 * (i + 1)) / n + 0.05);
export const quorumTiming = hangerTiming;
/** EL UMBRAL, cuando ya cuelgan las cinco: es el instante en que se puede decir
 *  «tres de cinco bastan», porque están las cinco puestas. */
export const STRIKE_MOMENT = within(LEGACY_BEATS.strike, 0.9, 1.0);
/** La fila i del relevo, mientras la vasija cruza. */
export const handoverTiming = (i: number, n = 3): [number, number] =>
  within(LEGACY_BEATS.cross, 0.1 + (0.46 * i) / n, 0.1 + (0.46 * (i + 1)) / n + 0.05);

export const BOX = { w: 1000, h: 400 };

/* ═══════════════════════════════════════════════════════════════════════
   LA GEOMETRÍA DEL ARCO
   ══════════════════════════════════════════════════════════════════════ */

export const AC = { x: 500, y: 300 };
export const RI = 160; // intradós
export const RE = 210; // trasdós
export const SPR_L = AC.x - RI; // 340 — arranque izquierdo
export const SPR_R = AC.x + RI; // 660
/** El suelo del cuadro: hasta dónde baja la roca antes de perderse. */
const DEEP = AC.y + 340;

/** En coordenadas de pantalla la Y crece hacia abajo, así que un punto al
 *  ángulo θ es (cx + R·cos θ, cy − R·sin θ): θ = 180° es el arranque
 *  izquierdo, θ = 90° la clave y θ = 0 el derecho. */
const pt = (R: number, deg: number): Pt => [AC.x + R * Math.cos((deg * Math.PI) / 180), AC.y - R * Math.sin((deg * Math.PI) / 180)];
const f2 = (p: Pt) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** La misma curva SIN su `M` inicial, para encadenarla detrás de un tramo recto
 *  sin que el trazado salte. Cerrar una silueta con `Z` desde donde acaba la
 *  curva deja un corte diagonal por debajo del acantilado —medido— y ese corte
 *  se ve como un chaflán que nadie dibujó. */
const cont = (pts: readonly Pt[]): string => {
  const s = catmullToCubic(pts);
  const i = s.indexOf('C');
  return i < 0 ? '' : s.slice(i);
};

/**
 * LA REGLA DE LA CARA ILUMINADA.
 *
 * Cuánta luz recibe una superficie cuya normal apunta al ángulo `deg` del arco.
 * Es el producto escalar de esa normal por `LIGHT` —la única luz de la casa,
 * 35° sobre la horizontal y desde la derecha— y NO un degradado que barre el
 * cuadro. La diferencia se ve: el máximo cae en el riñón derecho (θ ≈ 45°,
 * normal (0,71; −0,71) → 0,99) y el mínimo en el arranque izquierdo, que es
 * exactamente donde los pone una luz alta por la derecha. Un arco con un solo
 * tono es un arco de cartón; un arco con el degradado equivocado es peor,
 * porque parece iluminado por algo que no está en la escena.
 */
export function lumAt(deg: number): number {
  const r = (deg * Math.PI) / 180;
  return Math.max(0, Math.cos(r) * LIGHT.x + -Math.sin(r) * LIGHT.y);
}

/**
 * NUEVE DOVELAS: cuatro, la clave y cuatro. Impar, porque la simetría de un
 * arco es lo primero que un ojo detecta y la clave tiene que caer en el
 * vértice. El consejo son cinco personas y vive en la lámina de al lado: la
 * escena nunca dice que las piedras sean el consejo, dice que cada pieza se
 * coloca antes de que haga falta cruzar.
 */
const N_STONES = 9;
const KEY_I = 4;
/** Lo que la clave sobresale del trasdós. En toda fábrica de sillería la clave
 *  resalta: es la pieza que se reconoce sin que nadie la señale. */
const KEY_OUT = 10;
/** EL FILO LABRADO. El retranqueo de la cara respecto al canto de la pieza —el
 *  «drafted margin» de un sillar—. Es, con diferencia, el detalle que separa
 *  «piedra cortada» de «polígono relleno», y cuesta un `<path>`. */
const DRAFT = 3.2;

export interface Stone {
  k: number;
  /** El bloque entero. */
  d: string;
  /** La cara retranqueada dentro del bloque. */
  draft: string;
  /** El trasdós solo, para el filete especular: se copia VERBATIM del tramo
   *  del bloque, que es la única manera de no equivocarse con el flag de
   *  barrido de la elipse. */
  back: string;
  /** Los dos lechos: por dónde una piedra empuja a la siguiente. */
  beds: [string, string];
  mid: number;
  lum: number;
  isKey: boolean;
  centre: Pt;
  mark: string;
}

/** Cuatro marcas de cantero. Cada taller tenía la suya y cada pieza la lleva
 *  incisa en la cara: repetir el mismo triangulito nueve veces es justo lo que
 *  delata que no hay cantero. */
const MASON = [
  (x: number, y: number) => `M${(x - 3).toFixed(1)} ${(y + 2.2).toFixed(1)}l3 -4.4l3 4.4`,
  (x: number, y: number) => `M${(x - 3).toFixed(1)} ${(y - 2.6).toFixed(1)}l6 0M${x.toFixed(1)} ${(y - 2.6).toFixed(1)}l0 5.2`,
  (x: number, y: number) => `M${(x - 2.8).toFixed(1)} ${(y - 2.8).toFixed(1)}l5.6 5.6M${(x + 2.8).toFixed(1)} ${(y - 2.8).toFixed(1)}l-5.6 5.6`,
  (x: number, y: number) => `M${(x - 3).toFixed(1)} ${(y + 2.6).toFixed(1)}l3 -5.2l3 5.2Z`,
];

export const STONES: Stone[] = (() => {
  const rnd = mulberry32(0x510ac3);
  return Array.from({ length: N_STONES }, (_, k): Stone => {
    // de izquierda (180°) a derecha (0°)
    const a1 = 180 - (180 * k) / N_STONES;
    const a2 = 180 - (180 * (k + 1)) / N_STONES;
    const mid = (a1 + a2) / 2;
    const isKey = k === KEY_I;
    const re = isKey ? RE + KEY_OUT : RE;
    // Intradós con barrido 1 y trasdós con barrido 0: así es como está bien y
    // así se queda. Cualquier copia de estos tramos se hace verbatim.
    const intra = `M${f2(pt(RI, a1))}A${RI} ${RI} 0 0 1 ${f2(pt(RI, a2))}`;
    const back = `M${f2(pt(re, a2))}A${re} ${re} 0 0 0 ${f2(pt(re, a1))}`;
    const d = `${intra}L${f2(pt(re, a2))}A${re} ${re} 0 0 0 ${f2(pt(re, a1))}Z`;
    // El retranqueo angular equivalente al lineal, para que el filo tenga el
    // mismo ancho por los cuatro cantos y no se cierre en el intradós.
    const da = (DRAFT / RI) * (180 / Math.PI);
    const b1 = a1 - da;
    const b2 = a2 + da;
    const draft =
      `M${f2(pt(RI + DRAFT, b1))}A${RI + DRAFT} ${RI + DRAFT} 0 0 1 ${f2(pt(RI + DRAFT, b2))}` +
      `L${f2(pt(re - DRAFT, b2))}A${re - DRAFT} ${re - DRAFT} 0 0 0 ${f2(pt(re - DRAFT, b1))}Z`;
    const centre = pt((RI + re) / 2, mid);
    return {
      k,
      d,
      draft,
      back,
      beds: [`M${f2(pt(RI, a1))}L${f2(pt(re, a1))}`, `M${f2(pt(RI, a2))}L${f2(pt(re, a2))}`],
      mid,
      lum: lumAt(mid),
      isKey,
      centre,
      mark: MASON[Math.floor(rnd() * MASON.length) % MASON.length](centre[0], centre[1]),
    };
  });
})();

/** El orden de colocación: los dos arranques primero y hacia dentro
 *  alternando, que es como se monta una bóveda de verdad. La clave, la última. */
const LAY_ORDER = [0, 8, 1, 7, 2, 6, 3, 5];

/** El anillo entero, para recortar la línea de empujes dentro de la fábrica. */
const RING_D =
  `M${f2(pt(RI, 180))}A${RI} ${RI} 0 0 1 ${f2(pt(RI, 0))}` +
  `L${f2(pt(RE, 0))}A${RE} ${RE} 0 0 0 ${f2(pt(RE, 180))}Z`;

/**
 * LA LÍNEA DE EMPUJES. Por dónde viaja la carga dentro de la fábrica: pegada al
 * trasdós en los riñones y al intradós en la clave. Si se sale del anillo, el
 * arco se abre; mientras esté dentro, aguanta. Es la explicación entera del
 * «ninguna piedra sola» dicha con una curva.
 *
 * Va en DOS mitades, de la clave a cada arranque, y no en una sola curva: el
 * pulso que recorre la línea cuando la clave asienta tiene que salir del centro
 * hacia los dos lados a la vez, y la fase del guion de un trazo es continua a lo
 * largo de TODO el `<path>` — una sola curva daría un pulso que empieza en un
 * arranque y termina en el otro, que es justo lo contrario de lo que pasa.
 */
const thrustR = (deg: number) => {
  const t = Math.abs(deg - 90) / 90; // 0 en la clave, 1 en los arranques
  return RI + (RE - RI) * Math.min(1, 0.18 + 0.62 * Math.sin(Math.PI * t) + 0.2 * t * t);
};
const thrustHalf = (to: number): string => {
  const pts: Pt[] = [];
  const step = to > 90 ? 6 : -6;
  for (let deg = 90; to > 90 ? deg <= to : deg >= to; deg += step) pts.push(pt(thrustR(deg), deg));
  return catmullToCubic(pts);
};
const THRUST_L = thrustHalf(180);
const THRUST_R = thrustHalf(0);

/* ── LOS ESTRIBOS: la fábrica de la que nace el arco ────────────────────── */

export interface Block {
  d: string;
  lum: number;
  /** La hilada, 0 la de arriba. */
  c: number;
}
const N_COURSES = 4;
const COURSE_H = 19;
/** Lo que el estribo se mete en el banco desde el labio. Es EXACTAMENTE donde
 *  la calzada toca el terreno (`ROAD_HALF - RI`): el puente aterriza sobre
 *  fábrica, no sobre tierra. */
const ABUT_W = 140;

/**
 * SILLERÍA A HILADAS. Cinco hiladas de tres sillares con las juntas verticales
 * TRABADAS entre hilada e hilada: si las juntas se alinean no es sillería, es
 * una cuadrícula, y una cuadrícula se lee como textura de relleno. El paramento
 * se retranquea hacia el tajo al bajar, que es lo que hace que la garganta se
 * lea abriéndose en vez de como dos lados paralelos.
 */
function abutment(side: -1 | 1): Block[] {
  const rnd = mulberry32(side < 0 ? 0x1a77b3 : 0x3c19e5);
  const lipX = side < 0 ? SPR_L : SPR_R;
  // HACIA DENTRO DEL BANCO, no hacia el vacío. Con el signo al revés los dos
  // estribos cruzaban el tajo y se encontraban en el centro: medido en captura,
  // el hueco quedaba en ochenta píxeles de los cuatrocientos setenta que mide, y
  // la garganta se leía como la rendija entre dos pilares de ladrillo.
  const outX = lipX + side * ABUT_W;
  const out: Block[] = [];
  for (let c = 0; c < N_COURSES; c++) {
    const yT = AC.y + c * COURSE_H;
    const yB = yT + COURSE_H;
    // el paramento del tajo se abre al bajar
    const inT = lipX + side * (c * 3.4);
    const inB = lipX + side * ((c + 1) * 3.4);
    const n = 3;
    // la traba: las hiladas pares parten por la mitad de las impares
    const phase = c % 2 === 0 ? 0 : 0.5 / n;
    const cuts = [0, ...Array.from({ length: n - 1 }, (_, j) => clamp01((j + 1) / n + phase + (rnd() * 0.08 - 0.04))), 1];
    for (let b = 0; b < cuts.length - 1; b++) {
      const u0 = cuts[b];
      const u1 = cuts[b + 1];
      if (u1 - u0 < 0.05) continue;
      const xT0 = inT + (outX - inT) * u0;
      const xT1 = inT + (outX - inT) * u1;
      const xB0 = inB + (outX - inB) * u0;
      const xB1 = inB + (outX - inB) * u1;
      out.push({
        d: `M${xT0.toFixed(1)} ${yT}L${xT1.toFixed(1)} ${yT}L${xB1.toFixed(1)} ${yB}L${xB0.toFixed(1)} ${yB}Z`,
        // La misma luz que el anillo, rasante desde la derecha: el sillar más
        // brillante es el más alto del estribo derecho.
        lum: clamp01(0.46 + 0.3 * side - 0.08 * c + 0.05 * (rnd() * 2 - 1)),
        c,
      });
    }
  }
  return out;
}
export const ABUT_L = abutment(-1);
export const ABUT_R = abutment(1);

/* ── LOS BANCOS Y LA GARGANTA ──────────────────────────────────────────── */

/**
 * EL PERFIL DE CADA BANCO. Los anclajes NO se mueven —`ridge` los respeta— y el
 * último de cada lado es EXACTAMENTE el arranque del arco: si el labio no cae
 * en el arranque, el arco deja de apoyarse en la roca y se ve. Los dos perfiles
 * llevan semilla y anclajes distintos a propósito: dos bancos iguales son una
 * puerta, no una garganta.
 */
export const TOP_L = ridge(0x7a11c3, [[-200, AC.y - 34], [40, AC.y - 17], [200, AC.y - 6], [SPR_L, AC.y]], 5, 9);
export const TOP_R = ridge(0x31d5a9, [[SPR_R, AC.y], [820, AC.y - 13], [1000, AC.y - 26], [1200, AC.y - 44]], 5, 9);

/**
 * LA PARED DEL TAJO. Sale del labio y se separa del vacío con el CUADRADO de la
 * profundidad: una garganta excavada por agua se abre al bajar. Ese término
 * cuadrático es lo único que hace falta para que deje de leerse como el marco
 * de una puerta —dos lados paralelos— y empiece a leerse como un corte.
 */
function cliff(side: -1 | 1): Pt[] {
  const rnd = mulberry32(side < 0 ? 0x5511af : 0x99e372);
  const lipX = side < 0 ? SPR_L : SPR_R;
  const out: Pt[] = [];
  for (let i = 1; i <= 18; i++) {
    const t = i / 18;
    const widen = 8 * t + 74 * t * t;
    const jag = (rnd() * 2 - 1) * 8 * (1 - t * 0.55);
    out.push([lipX + side * (widen + jag), AC.y + 6 + 252 * t]);
  }
  return out;
}
export const CLIFF_L = cliff(-1);
export const CLIFF_R = cliff(1);

const BANK_L_D =
  `M-200 ${DEEP}L${f2(TOP_L[0])}${cont([...TOP_L, ...CLIFF_L])}` +
  `L${CLIFF_L[CLIFF_L.length - 1][0].toFixed(2)} ${DEEP}Z`;
const BANK_R_D =
  `M1200 ${DEEP}L${f2(TOP_R[TOP_R.length - 1])}${cont([...TOP_R].reverse().concat(CLIFF_R))}` +
  `L${CLIFF_R[CLIFF_R.length - 1][0].toFixed(2)} ${DEEP}Z`;
/** El canto del labio, sin la masa: es el filete especular de la roca y lo que
 *  dice «aquí se acaba el suelo». */
const LIP_L_D = catmullToCubic([...TOP_L.slice(-16), ...CLIFF_L.slice(0, 5)]);
const LIP_R_D = catmullToCubic([...CLIFF_R.slice(0, 5)].reverse().concat(TOP_R.slice(0, 16)));

/**
 * LA CARA ESCORZADA DE CADA PARED. Una banda estrecha por dentro del labio, con
 * su estriado vertical: es el trozo de pared que se ve DENTRO del corte, y es
 * lo que impide que los dos bancos se lean como dos recortes planos pegados
 * sobre un fondo negro.
 */
function inner(side: -1 | 1): { d: string; grooves: string[] } {
  const lipX = side < 0 ? SPR_L : SPR_R;
  const face = 22;
  const pts: Pt[] = [];
  const back: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const widen = 8 * t + 74 * t * t;
    pts.push([lipX + side * widen, AC.y + 6 + 252 * t]);
    back.push([lipX + side * (widen - face * (1 - 0.35 * t)), AC.y + 22 + 252 * t]);
  }
  const d = `${catmullToCubic(pts)}L${f2(back[back.length - 1])}${cont([...back].reverse())}Z`;
  const grooves = [0.18, 0.38, 0.58, 0.78].map((u) => {
    const i0 = Math.round(u * 12);
    const a = pts[i0];
    const b = back[Math.min(12, i0 + 2)];
    return `M${f2(a)}L${f2(b)}`;
  });
  return { d, grooves };
}
const INNER_L = inner(-1);
const INNER_R = inner(1);

/**
 * LA PARED DEL FONDO, vista por el corte. Es un PERFIL DE TERRENO y no un
 * rectángulo: un rectángulo más claro metido dentro de una silueta oscura es
 * literalmente el dibujo de una puerta, y eso es lo que el lector veía. Va muy
 * desteñida hacia el color del cielo —perspectiva aérea— porque está lejos.
 */
const FAR_PTS = ridge(0x2b9174, [[-200, AC.y + 118], [180, AC.y + 82], [520, AC.y + 104], [860, AC.y + 76], [1200, AC.y + 110]], 6, 22);
const FAR_D = `${catmullToCubic(FAR_PTS)}L1200 ${DEEP}L-200 ${DEEP}Z`;
/** El segundo plano, a medio camino: más bajo, más oscuro y con su propio
 *  perfil. Un solo plano lejano es un telón; dos son distancia. */
const MID_PTS = ridge(0x6d21a8, [[-200, AC.y + 186], [260, AC.y + 152], [620, AC.y + 176], [1200, AC.y + 144]], 6, 19);
const MID_D = `${catmullToCubic(MID_PTS)}L1200 ${DEEP}L-200 ${DEEP}Z`;
/** Las vetas verticales de la pared del fondo. Nacen del propio perfil, así que
 *  arrancan siempre EN la cresta y no flotando por encima. */
const FAR_SEAMS = (() => {
  const rnd = mulberry32(0x40b7c1);
  return Array.from({ length: 9 }, (_, i) => {
    const p = FAR_PTS[Math.floor(((i + 0.5) / 9) * (FAR_PTS.length - 1))];
    const len = 34 + rnd() * 48;
    const lean = (rnd() * 2 - 1) * 9;
    return `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${(p[0] + lean).toFixed(1)} ${(p[1] + len).toFixed(1)}`;
  });
})();

/* ── LA CIMBRA: un armazón de madera, no un abanico de pelos ───────────── */

/** Siete montantes. Con trece eran rayas; con siete son piezas. */
const N_STRUTS = 7;
/** El ancho de un montante en unidades del lienzo. Un montante tiene DOS
 *  aristas: esa es la diferencia entre una pieza de madera y una línea. */
const STRUT_W = 5.2;
const LAG_R = RI - 3;
const N_LAGS = 13;

const CENTRING = (() => {
  // El durmiente: una pieza con canto, no una recta.
  const sillTop = AC.y + 2;
  const sillBot = AC.y + 11;
  const sill =
    `M${SPR_L - 14} ${sillTop}L${SPR_R + 14} ${sillTop}L${SPR_R + 14} ${sillBot}L${SPR_L - 14} ${sillBot}Z`;

  // Los montantes, con ancho: cada uno va del durmiente al tablero.
  const struts: string[] = [];
  const feet: number[] = [];
  for (let i = 0; i < N_STRUTS; i++) {
    const deg = 168 - (156 * i) / (N_STRUTS - 1);
    const top = pt(LAG_R, deg);
    const half = STRUT_W / 2;
    feet.push(top[0]);
    struts.push(
      `M${(top[0] - half).toFixed(1)} ${sillTop}L${(top[0] - half).toFixed(1)} ${top[1].toFixed(2)}` +
        `L${(top[0] + half).toFixed(1)} ${top[1].toFixed(2)}L${(top[0] + half).toFixed(1)} ${sillTop}Z`,
    );
  }

  // Los tirantes: triángulos entre montantes contiguos. Sin ellos la cercha se
  // descuadra, y un armazón sin triangular se lee como un peine.
  const braces: string[] = [];
  for (let i = 0; i < N_STRUTS - 1; i++) {
    const a = pt(LAG_R, 168 - (156 * i) / (N_STRUTS - 1));
    const b = pt(LAG_R, 168 - (156 * (i + 1)) / (N_STRUTS - 1));
    braces.push(`M${a[0].toFixed(1)} ${sillTop}L${f2(b)}`);
    braces.push(`M${b[0].toFixed(1)} ${sillTop}L${f2(a)}`);
  }

  // El tablero: TABLAS, una a una, cada una con su junta. Es lo que recibe las
  // dovelas, así que tiene que verse que son tablas y no un alambre curvo.
  const lags: string[] = [];
  for (let i = 0; i < N_LAGS; i++) {
    const d1 = 180 - (180 * i) / N_LAGS + 0.35;
    const d2 = 180 - (180 * (i + 1)) / N_LAGS - 0.35;
    lags.push(
      `M${f2(pt(LAG_R, d1))}A${LAG_R} ${LAG_R} 0 0 1 ${f2(pt(LAG_R, d2))}` +
        `L${f2(pt(LAG_R - 5, d2))}A${LAG_R - 5} ${LAG_R - 5} 0 0 0 ${f2(pt(LAG_R - 5, d1))}Z`,
    );
  }

  // LAS CUÑAS. Los dos pares de cuñas de descimbrar, al pie de los montantes de
  // fuera. Son la pieza que se golpea para retirar la cimbra: sin ellas el
  // descimbrado es «la cimbra se apaga», con ellas es un mecanismo.
  const wedges = [feet[0], feet[N_STRUTS - 1]].map((x) => {
    const w = 15;
    return `M${(x - w).toFixed(1)} ${sillBot}L${(x + w).toFixed(1)} ${sillBot}L${(x + w).toFixed(1)} ${(sillBot + 4).toFixed(1)}L${(x - w).toFixed(1)} ${(sillBot + 8).toFixed(1)}Z`;
  });

  // Los clavos del tablero: segundo nivel de detalle, solo al acercarse.
  const nails = lags.map((_, i) => {
    const c = pt(LAG_R - 2.5, 180 - (180 * (i + 0.5)) / N_LAGS);
    return `M${(c[0] - 0.9).toFixed(1)} ${c[1].toFixed(1)}l1.8 0`;
  });

  return { sill, struts, braces, lags, wedges, nails, sillTop, sillBot };
})();

/* ═══════════════════════════════════════════════════════════════════════
   EL PASO — un puente de TABLERO INFERIOR colgado del arco
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Fundador, sobre la primera versión del puente: «quiero que pase
 * normal por debajo, que los puntos que se ponen que representan el quórum sean
 * lo que sustenta el puente, el puente cruza recto por debajo, no sube por
 * encima».
 */

/** LA MESA DEL CONSEJO, y es la ÚNICA. La escena, las cuatro láminas y las
 *  péndolas leen esta lista: si el dibujo dice cinco y la lámina dice tres, el
 *  lector se queda con que uno de los dos miente. */
export const COUNCIL_SEATS = [true, false, true, true, false] as const;
export const QUORUM = 3;

/** La altura del terreno en un punto del perfil generado. Se INTERPOLA entre
 *  las dos muestras que lo rodean: filtrar la lista con `<=` deja el escalón del
 *  muestreo y cualquier cosa apoyada en el terreno lo estaría por medio paso. */
export function groundAt(profile: readonly Pt[], x: number): number {
  const first = profile[0];
  const last = profile[profile.length - 1];
  if (x <= Math.min(first[0], last[0])) return (first[0] < last[0] ? first : last)[1];
  if (x >= Math.max(first[0], last[0])) return (first[0] < last[0] ? last : first)[1];
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if ((x >= a[0] && x <= b[0]) || (x <= a[0] && x >= b[0])) {
      const u = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * u;
    }
  }
  return AC.y;
}

/** La rasante: al nivel de los dos labios, así que el camino de tierra y el
 *  tablero son la misma línea y no hay rampa que subir. */
export const DECK_Y = AC.y;
/** Canto de la viga, alto del bordillo y del pasamanos. */
const DECK_T = 13;
const KERB_H = 5;
const RAIL_H = 19;
/** El tablero se mete media docena de unidades en los dos estribos: un puente
 *  que termina exactamente en el labio está apoyado en el aire. */
export const DECK_L = SPR_L - 54;
export const DECK_R = SPR_R + 54;

/** LA VIGA. Un canto constante con las dos alas marcadas: lo que hace que se
 *  lea como una pieza estructural y no como una raya gruesa es que tenga ala
 *  superior, alma y ala inferior. */
const DECK_D = `M${DECK_L} ${DECK_Y}L${DECK_R} ${DECK_Y}L${DECK_R} ${DECK_Y + DECK_T}L${DECK_L} ${DECK_Y + DECK_T}Z`;
const DECK_SOFFIT_D = `M${DECK_L} ${DECK_Y + DECK_T - 2.2}L${DECK_R} ${DECK_Y + DECK_T - 2.2}`;
/** El bordillo, por delante del tablero: el canto que pisa el pretil. */
const KERB_D = `M${DECK_L - 4} ${DECK_Y - KERB_H}L${DECK_R + 4} ${DECK_Y - KERB_H}L${DECK_R + 4} ${DECK_Y}L${DECK_L - 4} ${DECK_Y}Z`;

/**
 * EL PASAMANOS. Cruza el cuadro ENTERO, también sobre los bancos, porque el
 * camino no empieza en el puente: el puente es el trozo del camino que salva el
 * hueco. Es una baranda abierta y no un pretil macizo a propósito — el fundador
 * quiere que lo que cruza se vea «normal», y un muro le taparía media figura.
 * Lo único que la cruza es el tubo superior, que es exactamente lo que se ve
 * desde fuera cuando algo pasa por un puente.
 */
const RAIL_Y = DECK_Y - RAIL_H;
const RAIL_D = `M-200 ${RAIL_Y}L1200 ${RAIL_Y}`;
const RAIL_POSTS: string[] = (() => {
  const out: string[] = [];
  for (let x = -188; x < 1200; x += 47) out.push(`M${x} ${RAIL_Y}L${x} ${DECK_Y - KERB_H}`);
  return out;
})();

/**
 * LAS CINCO PÉNDOLAS. Su abscisa sale del REPARTO DEL VANO —el centro de cada
 * quinto—, no de cinco números escritos a mano: el día que el consejo tenga seis
 * asientos, el puente tendrá seis péndolas sin que nadie toque una coordenada.
 * Y su extremo superior se calcula contra el intradós, así que cuelgan del arco
 * de verdad en vez de terminar cerca de él.
 */
export interface Hanger {
  i: number;
  x: number;
  /** Donde agarra el intradós. */
  top: number;
  signs: boolean;
}
export const HANGERS: Hanger[] = COUNCIL_SEATS.map((signs, i) => {
  const x = SPR_L + ((SPR_R - SPR_L) * (i + 0.5)) / COUNCIL_SEATS.length;
  return { i, x, top: AC.y - Math.sqrt(Math.max(0, RI * RI - (x - AC.x) * (x - AC.x))), signs };
});

/* ── EL TABLERO Y LO QUE CRUZA ─────────────────────────────────────────── */

/**
 * POR DÓNDE VA LA VASIJA: RECTA, por el tablero, por debajo del arco.
 *
 * Ya no hay perfil que calcular. Una altura constante ES el argumento: lo que
 * cruza entra por un lado y sale por el otro sin subir, sin bajar y sin cambiar
 * de tamaño ni de color. Antes iba montada sobre el trasdós y el lector veía la
 * carga trepando por la piedra.
 *
 * Se dibuja POR DELANTE del arco y POR DETRÁS del pasamanos. Lo primero, porque
 * en un puente de tablero inferior la calzada pasa entre los dos arcos y lo que
 * circula cruza su plano; lo segundo, porque el tubo del pasamanos cruzándole
 * los pies es lo que dice que va por el puente y no por delante de él.
 */
export const CROSS_X0 = 40;
export const CROSS_X1 = 958;
/** La altura del centro de la vasija sobre la rasante. */
export const CROSS_LIFT = 30;
export function crossY(): number {
  return DECK_Y - CROSS_LIFT;
}

/* ── EL CIELO ──────────────────────────────────────────────────────────── */
const STARS = (() => {
  const rnd = mulberry32(20260918);
  return Array.from({ length: 58 }, (_, i) => {
    const u = rnd();
    const m = 6.4 - 5.6 * u * u * u;
    const r = 0.3 + 1.5 * Math.pow(2.512, (2.2 - m) / 5);
    return {
      x: -200 + rnd() * 1400,
      y: 2 + rnd() * 262,
      r,
      band: (r > 1.35 ? 0 : r > 0.75 ? 1 : 2) as 0 | 1 | 2,
      hot: i % 3 === 0,
      o: 0.25 + rnd() * 0.7,
    };
  });
})();
/** Techo duro: TRES con cruz de difracción. Con más, el cielo pasa de sobrio a
 *  árbol de Navidad, y eso solo se comprueba mirándolo. */
const SPIKES = [...STARS].sort((a, b) => b.r - a.r).slice(0, 3);

/* ── LA COREOGRAFÍA POR PROFUNDIDAD ────────────────────────────────────── */

/**
 * EL MUNDO SE MONTA DE LEJOS A CERCA, en ocho capas, y cada una con su propia
 * curva: lo lejano llega despacio y casi sin moverse, lo cercano llega tarde,
 * deprisa y desde más abajo. Es la diferencia entre «aparece un decorado» y
 * «hay un sitio». Los ocho tramos se DERIVAN del tiempo del hueco: nadie los
 * escribe a mano y por tanto nadie los desincroniza.
 */
const N_LAYERS = 8;
const layerRange = (i: number): [number, number] => {
  const [a, b] = LEGACY_BEATS.gap;
  const step = (b - a) / (N_LAYERS + 3.2);
  return [a + step * i * 1.05, a + step * (i * 1.05 + 4.4)];
};

export interface ThresholdSceneProps {
  progress: MotionValue<number>;
  lang: Lang;
  level: MotionLevel;
  still?: boolean;
}

/* ═══════════════════════════════════════════════════════════════════════
   LA ESCENA
   ══════════════════════════════════════════════════════════════════════ */

function ThresholdSceneImpl({ progress, lang, level, still = false }: ThresholdSceneProps) {
  const uid = useId().replace(/:/g, '');
  const [, gEnd] = LEGACY_BEATS.gap;
  const [cStart, cEnd] = LEGACY_BEATS.centring;
  const [sStart, sEnd] = LEGACY_BEATS.stones;
  const [kStart, kEnd] = LEGACY_BEATS.key;
  const [stStart, stEnd] = LEGACY_BEATS.strike;
  const [xStart, xEnd] = LEGACY_BEATS.cross;

  const svgRef = useRef<SVGSVGElement>(null);

  // LA CÁMARA. Se acerca a la clave cuando entra la clave, y se RETIRA al
  // descimbrar: el descimbrado hay que verlo entero o no se entiende que lo que
  // se retira es lo que sostenía todo.
  const camScale = useTransform(
    progress,
    [0, gEnd, cEnd, sEnd, kStart + (kEnd - kStart) * 0.72, stStart + (stEnd - stStart) * 0.5, xStart, xStart + (xEnd - xStart) * 0.55],
    [0.86, 0.94, 1.0, 1.04, 1.24, 0.92, 0.98, 0.87],
    { clamp: true },
  );
  const camY = useTransform(
    progress,
    [0, gEnd, cEnd, sEnd, kStart + (kEnd - kStart) * 0.72, stStart + (stEnd - stStart) * 0.5, xStart, xStart + (xEnd - xStart) * 0.55],
    [272, 266, 260, 256, 212, 268, 252, 186],
    { clamp: true },
  );
  // La cámara se corre a la izquierda del arco, o sea que el arco aparece a la
  // derecha: la columna de lectura ocupa el tercio izquierdo del escenario y sin
  // este desplazamiento el arranque izquierdo le caía encima.
  const camX = useTransform(progress, [0, gEnd, cEnd], [AC.x, AC.x, AC.x - 46], { clamp: true });
  // EL ANCHO DE DISEÑO. Era 1024 y por eso el arco medía el 28 % del cuadro a
  // 1440: con `targetPx` por debajo del ancho de la ventana el lienzo se ensancha
  // y el dibujo se queda pequeño dentro. A 1680 el encuadre es constante hasta un
  // monitor de 1680 y el arco mide el 42 % del cuadro.
  const camBox = useMemo(() => ({ vbW: BOX.w, targetPx: 1680 }), []);
  useAspectViewBox(svgRef, camX, camY, camScale, camBox);

  /** EL SEGUNDO NIVEL DE DETALLE. Por encima de escala 1,08 —el acercamiento a
   *  la clave— se encienden los filos labrados, las marcas de cantero, los
   *  clavos del tablero y los pasadores de los lechos. Acercarse tiene que GANAR
   *  algo; si no, es ampliar píxeles. */
  const detail = useTransform(camScale, [1.06, 1.2], [0, 1], { clamp: true });

  const centringIn = useTransform(progress, [cStart, cStart + (cEnd - cStart) * 0.78], [0, 1], { clamp: true });
  /** La traza del cantero: entra con la cimbra ya montada y se borra cuando se
   *  descimbra, que es cuando ya no hace falta ninguna línea auxiliar. */
  const traza = useTransform(
    progress,
    [...within(LEGACY_BEATS.centring, 0.52, 0.88), ...within(LEGACY_BEATS.strike, 0.0, 0.26)],
    [0, 1, 1, 0],
    { clamp: true },
  );

  /**
   * EL DESCIMBRADO. Empezaba en el 10 % del tiempo y terminaba en el 65 %: la
   * columna de texto decía «se retira la cimbra» con la cimbra entera puesta
   * durante casi media parada. Ahora arranca en el 2 % —el mismo instante en
   * que el titular llega al full— y se resuelve en el 58 %.
   */
  const strike = useTransform(progress, [...within(LEGACY_BEATS.strike, 0.02, 0.58)], [0, 1], { clamp: true });
  /** EL ASIENTO. Un arco descimbrado BAJA. Poco más de una unidad, pero la baja:
   *  es el detalle que dice que las piezas acaban de empezar a trabajar. Y baja
   *  cuando saltan las CUÑAS, no cuando termina la animación. */
  const settle = useTransform(strike, [0, 0.14, 0.34, 1], [0, 0.2, 1.35, 1.15]);
  const thrustIn = useTransform(progress, [...within(LEGACY_BEATS.strike, 0.3, 0.72)], [0, 1], { clamp: true });
  /** EL PULSO DE LA CLAVE. Cuando la clave asienta, la carga sale de ella hacia
   *  los dos arranques: es «las piezas se empujan entre sí» dicho con luz. */
  const keyPulse = useTransform(progress, [...within(LEGACY_BEATS.key, 0.62, 0.98)], [0, 1], { clamp: true });
  /** El paso se cuelga DESPUÉS del descimbrado: el arco se queda de pie solo y
   *  entonces se le tiende el tablero. */
  const deckIn = useTransform(progress, [...within(LEGACY_BEATS.strike, 0.44, 0.98)], [0, 1], { clamp: true });
  const crossT = useTransform(progress, [...within(LEGACY_BEATS.cross, 0.06, 0.74)], [0, 1], { clamp: true });
  const skyDim = useTransform(progress, [0, gEnd], [0.75, 1], { clamp: true });

  if (still) return <StillFrame uid={uid} lang={lang} />;

  return (
    <div className="relative w-full" style={{ height: 'min(64svh, 620px)' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${BOX.w} ${BOX.h}`}
        className="relative z-10 block w-full h-full"
        style={{
          maskImage: 'linear-gradient(180deg, transparent 0%, #000 7%, #000 93%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 7%, #000 93%, transparent 100%)',
        }}
        fill="none"
        aria-hidden
        focusable="false"
      >
        <defs>
          {/* LA GARGANTA: el tajo se va a negro. Es lo que hace que el hueco sea
              un hueco y no un decorado. */}
          <linearGradient id={`${uid}-gorge`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y - 10} x2="0" y2={DEEP}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--surface-1))', stopOpacity: 0.2 }} />
            <stop offset="40%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 0.82 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 1 }} />
          </linearGradient>
          {/* LA ROCA de los bancos: canto iluminado arriba, masa abajo. */}
          <linearGradient id={`${uid}-rock`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y - 46} x2="0" y2={DEEP}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 1 }} />
            <stop offset="30%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 1 }} />
            <stop offset="58%" style={{ stopColor: 'hsl(var(--surface-2))', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 1 }} />
          </linearGradient>
          {/* EL RASANTE DEL CANTO. La luz que pasa rozando la meseta: una banda
              de doce unidades bajo el perfil. Es lo único que convierte una
              silueta negra en terreno, y cuesta un degradado. */}
          <linearGradient id={`${uid}-graze`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y - 46} x2="0" y2={AC.y + 26}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.38 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0 }} />
          </linearGradient>
          {/* LA PARED DEL FONDO, desteñida hacia el cielo: perspectiva aérea. */}
          {/* PERSPECTIVA AÉREA: lo lejano NO es lo mismo más flojo, es lo mismo
              desteñido hacia el cielo. Con el tono de la roca cercana los dos
              planos del fondo se leían como una lámina de agua. */}
          <linearGradient id={`${uid}-far`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y + 70} x2="0" y2={AC.y + 260}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--surface-3))', stopOpacity: 0.92 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 0.85 }} />
          </linearGradient>
          <linearGradient id={`${uid}-mid`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y + 140} x2="0" y2={DEEP}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--surface-1))', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 1 }} />
          </linearGradient>
          <pattern id={`${uid}-tool`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
            <line x1="2" y1="0" x2="2" y2="4" stroke="hsl(var(--volt-hi))" strokeWidth="0.3" strokeOpacity="0.14" />
          </pattern>
          <radialGradient id={`${uid}-halo`}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-hi))', stopOpacity: 0 }} />
          </radialGradient>
          <clipPath id={`${uid}-ring`}>
            <path d={RING_D} />
          </clipPath>
          <clipPath id={`${uid}-bankL`}>
            <path d={BANK_L_D} />
          </clipPath>
          <clipPath id={`${uid}-bankR`}>
            <path d={BANK_R_D} />
          </clipPath>
        </defs>

        {/* ── 0 · EL CIELO, y por el ojo del arco se ve ──────────────────── */}
        <Starfield ink={skyDim} uid={uid} level={level} />

        {/* ── 1 · EL FONDO DEL TAJO ──────────────────────────────────────
            Va DEBAJO de la pared del fondo, no encima: al revés se comía el
            perfil entero y el corte volvía a ser un agujero negro sin nada
            dentro, que es exactamente lo que había que quitar. */}
        <Layer progress={progress} i={1}>
          <path d={`M-200 ${AC.y - 10}L1200 ${AC.y - 10}L1200 ${DEEP}L-200 ${DEEP}Z`} fill={`url(#${uid}-gorge)`} />
        </Layer>

        {/* ── 2 · LA PARED DEL FONDO, por el corte ───────────────────────── */}
        <Layer progress={progress} i={2}>
          <path d={FAR_D} fill={`url(#${uid}-far)`} />
          <path d={catmullToCubic(FAR_PTS)} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.3" strokeWidth={INK.pelo} />
          {/* grano de PARED, no de superficie: sin verticales el plano del
              fondo sigue pareciendo tumbado */}
          {FAR_SEAMS.map((d) => (
            <path key={d} d={d} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.5" strokeWidth={INK.pelo} />
          ))}
          {/* una segunda cresta, más cerca y más oscura: dos planos hacen
              profundidad, uno solo hace un telón */}
          <path d={MID_D} fill={`url(#${uid}-mid)`} />
          <path d={catmullToCubic(MID_PTS)} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.3" strokeWidth={INK.pelo} />
        </Layer>

        {/* ── 3 · LA CARA ESCORZADA DE LAS DOS PAREDES ───────────────────── */}
        <Layer progress={progress} i={3}>
          {[INNER_L, INNER_R].map((w, s) => (
            <g key={s}>
              <path d={w.d} fill="hsl(var(--volt-deep))" fillOpacity={s === 1 ? 0.5 : 0.34} />
              {w.grooves.map((g) => (
                <path key={g} d={g} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.8" strokeWidth={INK.pelo} />
              ))}
            </g>
          ))}
        </Layer>

        {/* ── 4 · LOS DOS BANCOS ────────────────────────────────────────── */}
        <Layer progress={progress} i={4}>
          <path d={BANK_L_D} fill={`url(#${uid}-rock)`} />
          <path d={BANK_R_D} fill={`url(#${uid}-rock)`} />
          {/* el rasante: el banco de la derecha recibe más porque la luz viene
              de ahí — la misma regla que gobierna el anillo */}
          <g clipPath={`url(#${uid}-bankL)`}>
            <path d={BANK_L_D} fill={`url(#${uid}-graze)`} fillOpacity="0.72" />
          </g>
          <g clipPath={`url(#${uid}-bankR)`}>
            <path d={BANK_R_D} fill={`url(#${uid}-graze)`} />
          </g>
          <path d={BANK_L_D} fill={`url(#${uid}-tool)`} />
          <path d={BANK_R_D} fill={`url(#${uid}-tool)`} />
          {/* Los planos de estratificación, recortados a la roca: siguen el
              banco y NO cruzan el vacío. Las rayas horizontales que cruzaban el
              hueco de lado a lado eran la mitad del efecto «puerta». */}
          <g clipPath={`url(#${uid}-bankL)`}>
            {[26, 62, 104, 152].map((dy, i) => (
              <path
                key={dy}
                d={`M${SPR_L - 248} ${AC.y + dy - 12}L${SPR_L - 6} ${AC.y + dy + 4}`}
                fill="none"
                stroke="hsl(var(--volt-soft))"
                strokeOpacity={0.24 - i * 0.045}
                strokeWidth={INK.pelo}
              />
            ))}
          </g>
          <g clipPath={`url(#${uid}-bankR)`}>
            {[22, 58, 98, 146].map((dy, i) => (
              <path
                key={dy}
                d={`M${SPR_R + 6} ${AC.y + dy + 4}L${SPR_R + 248} ${AC.y + dy - 14}`}
                fill="none"
                stroke="hsl(var(--volt-soft))"
                strokeOpacity={0.3 - i * 0.055}
                strokeWidth={INK.pelo}
              />
            ))}
          </g>
        </Layer>

        {/* ── 5 · EL CANTO DEL LABIO ────────────────────────────────────── */}
        <Layer progress={progress} i={5}>
          <path d={LIP_L_D} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.45" strokeWidth={INK.trazo} />
          <path d={LIP_R_D} fill="none" stroke="hsl(var(--volt-hi))" strokeOpacity="0.62" strokeWidth={INK.trazo} />
        </Layer>

        {/* ── 6 · LOS ESTRIBOS: la fábrica de la que nace el arco ────────── */}
        <Layer progress={progress} i={6}>
          {[...ABUT_L, ...ABUT_R].map((b, i) => (
            <g key={`${b.c}-${i}`}>
              <path d={b.d} fill="hsl(var(--volt-deep))" />
              <path d={b.d} fill="hsl(var(--volt-hi))" fillOpacity={0.06 + 0.14 * b.lum} />
              <path d={b.d} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.8" strokeWidth="0.7" />
            </g>
          ))}
        </Layer>

        {/* ── 7 · LA CIMBRA ─────────────────────────────────────────────── */}
        <Layer progress={progress} i={7}>
          <Centring draw={centringIn} strike={strike} detail={detail} />
        </Layer>

        {/* ── LA TRAZA ─────────────────────────────────────────────────
            Antes de colocar la primera piedra, un cantero MARCA sobre el
            tablero de la cimbra el intradós, el trasdós y cada junta. La pieza
            no se inventa al llegar: cae dentro de una línea que ya estaba
            dibujada.

            Es lo que faltaba. Medido en captura a 0,42: con media docena de
            dovelas puestas y el resto por venir, las colocadas se leían como dos
            cuñas sueltas a los lados de una cúpula de madera, porque no había
            NADA en el cuadro que dijera de qué forma eran parte. Con la traza,
            el lector ve el arco entero desde el principio y cada pieza
            rellenando su hueco. */}
        <motion.g style={{ opacity: traza }}>
          <path d={RING_D} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.55" strokeWidth={INK.pelo} strokeDasharray="4 3.5" />
          {STONES.map((s) => (
            <path key={`t${s.k}`} d={s.beds[0]} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.3" strokeWidth={INK.pelo} strokeDasharray="3 3" />
          ))}
        </motion.g>

        {/* ── EL ARCO ──────────────────────────────────────────────────── */}
        <motion.g style={{ y: settle }}>
          {STONES.map((s) => (
            <Voussoir
              key={s.k}
              stone={s}
              progress={progress}
              uid={uid}
              detail={detail}
              at={
                s.isKey
                  ? kStart + (kEnd - kStart) * 0.1
                  : sStart + ((sEnd - sStart) * LAY_ORDER.indexOf(s.k)) / LAY_ORDER.length
              }
              span={s.isKey ? (kEnd - kStart) * 0.55 : ((sEnd - sStart) / LAY_ORDER.length) * 0.9}
            />
          ))}

          {/* LA LÍNEA DE EMPUJES, recortada al anillo: mientras esté dentro de
              la fábrica, el arco aguanta. */}
          <motion.g clipPath={`url(#${uid}-ring)`}>
            <Thrust on={thrustIn} pulse={keyPulse} />
          </motion.g>

        </motion.g>

        {/* ── EL PASO: TABLERO, PÉNDOLAS, LO QUE CRUZA Y EL PASAMANOS ───
            En ESE orden, y el orden es el argumento. El arco queda detrás; el
            tablero y sus cinco péndolas, delante de él; la vasija encima del
            tablero —cruzando el plano del arco, que es lo que hace un vehículo
            en un puente de tablero inferior—; y el pasamanos por delante de
            todo, cruzándole los pies. */}
        <motion.g style={{ y: settle }}>
          <Deck on={deckIn} />
          <Hangers progress={progress} detail={detail} />
        </motion.g>
        <Crossing t={crossT} settle={settle} uid={uid} />
        <motion.g style={{ y: settle }}>
          <Rail on={deckIn} />
        </motion.g>
      </svg>

      <ThresholdCaption progress={progress} lang={lang} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PIEZAS
   ══════════════════════════════════════════════════════════════════════ */

/**
 * UNA CAPA DE PROFUNDIDAD. Llega en su tramo, con su curva y con su recorrido:
 * la rodilla de la curva se desplaza con la profundidad, así que lo lejano se
 * resuelve pronto y despacio y lo cercano tarde y de golpe.
 */
function Layer({ progress, i, children }: { progress: MotionValue<number>; i: number; children: ReactNode }) {
  const [a, b] = layerRange(i);
  const knee = 0.3 + 0.055 * i;
  const opacity = useTransform(progress, [a, a + (b - a) * knee, b], [0, 0.62, 1], { clamp: true });
  const y = useTransform(progress, [a, b], [4 + i * 2.2, 0], { clamp: true });
  return (
    <motion.g style={{ opacity, y }}>
      {children}
    </motion.g>
  );
}

/** Tres grupos de brillo y TRES animaciones, no cincuenta y ocho: en SVG una
 *  animación de opacidad por elemento es un repintado por elemento y por
 *  fotograma. El centelleo real solo se ve en las brillantes. */
function Starfield({ ink, uid, level }: { ink: MotionValue<number>; uid: string; level: MotionLevel }) {
  const anim = level === 'full';
  return (
    <motion.g style={{ opacity: ink }}>
      {[0, 1, 2].map((band) => (
        <g
          key={band}
          className="th-star"
          style={{ animation: anim ? `thBand ${(4.5 + band * 1.8).toFixed(1)}s ease-in-out ${band * 0.9}s infinite` : undefined }}
        >
          {STARS.filter((s) => s.band === band).map((s) => (
            <circle key={`${s.x}-${s.y}`} cx={s.x} cy={s.y} r={s.r} fill={s.hot ? 'hsl(var(--volt-hi))' : 'hsl(var(--volt-soft))'} fillOpacity={s.o} />
          ))}
        </g>
      ))}
      {SPIKES.map((s) => (
        <g key={`sp-${s.x}`}>
          <circle cx={s.x} cy={s.y} r={5} fill={`url(#${uid}-halo)`} />
          <path
            d={`M${s.x - 6} ${s.y}L${s.x + 6} ${s.y}M${s.x} ${s.y - 6}L${s.x} ${s.y + 6}`}
            stroke="hsl(var(--volt-hi))"
            strokeOpacity="0.45"
            strokeWidth="0.45"
          />
        </g>
      ))}
    </motion.g>
  );
}

/**
 * LA CIMBRA. Se DIBUJA sola con el desfase del guion, nunca animando la
 * longitud del guion: `strokeDasharray: "0 x"` no es «línea continua», es
 * «ninguna raya», y esta portada ya pagó ese fallo una vez.
 *
 * Y SE RETIRA EN ORDEN INVERSO AL DE MONTAJE, que es como se descimbra de
 * verdad: saltan las cuñas, cae el tablero, se quitan los tirantes, se quitan
 * los montantes y al final se retira el durmiente. Apagar el grupo entero de
 * golpe es exactamente lo que hacía que el descimbrado —la escena entera— no se
 * leyese como un mecanismo.
 */
function Centring({ draw, strike, detail }: { draw: MotionValue<number>; strike: MotionValue<number>; detail: MotionValue<number> }) {
  const off = useTransform(draw, [0, 1], [1, 0]);
  const wood = {
    fill: 'none' as const,
    stroke: 'hsl(var(--volt-soft))',
    strokeOpacity: 0.5,
    strokeWidth: INK.trazo,
    pathLength: 1,
    strokeDasharray: '1 1',
  };
  // Las cuatro retiradas, en orden inverso al de montaje.
  const wedgesOut = useTransform(strike, [0, 0.16], [1, 0], { clamp: true });
  const wedgesDrop = useTransform(strike, [0, 0.16], [0, 13], { clamp: true });
  const lagsOut = useTransform(strike, [0.14, 0.44], [1, 0], { clamp: true });
  const bracesOut = useTransform(strike, [0.36, 0.68], [1, 0], { clamp: true });
  const strutsOut = useTransform(strike, [0.52, 0.86], [1, 0], { clamp: true });
  const sillOut = useTransform(strike, [0.7, 1], [1, 0], { clamp: true });
  const frameDrop = useTransform(strike, [0.14, 1], [0, 54], { clamp: true });

  return (
    <g>
      {/* LAS CUÑAS: la primera pieza que salta y la que hace que el arco se
          asiente. Van fuera del descenso del armazón porque caen ANTES. */}
      <motion.g style={{ opacity: wedgesOut, y: wedgesDrop }}>
        {CENTRING.wedges.map((d) => (
          <motion.path key={d} d={d} {...wood} strokeOpacity={0.62} style={{ strokeDashoffset: off }} />
        ))}
      </motion.g>

      <motion.g style={{ y: frameDrop }}>
        <motion.g style={{ opacity: lagsOut }}>
          {CENTRING.lags.map((d) => (
            <motion.path key={d} d={d} {...wood} strokeOpacity={0.4} strokeWidth={INK.pelo} style={{ strokeDashoffset: off }} />
          ))}
          <motion.g style={{ opacity: detail }}>
            {CENTRING.nails.map((d) => (
              <path key={d} d={d} fill="none" stroke="hsl(var(--volt-hi))" strokeOpacity="0.5" strokeWidth={INK.pelo} strokeLinecap="round" />
            ))}
          </motion.g>
        </motion.g>

        <motion.g style={{ opacity: bracesOut }}>
          {CENTRING.braces.map((d) => (
            <motion.path key={d} d={d} {...wood} strokeOpacity={0.24} strokeWidth={INK.pelo} style={{ strokeDashoffset: off }} />
          ))}
        </motion.g>

        <motion.g style={{ opacity: strutsOut }}>
          {CENTRING.struts.map((d) => (
            <motion.path key={d} d={d} {...wood} style={{ strokeDashoffset: off }} />
          ))}
        </motion.g>

        <motion.path d={CENTRING.sill} {...wood} strokeWidth={INK.trazo} style={{ strokeDashoffset: off, opacity: sillOut }} />
      </motion.g>
    </g>
  );
}

/**
 * UNA DOVELA. Baja a su sitio y se asienta: no aparece, se COLOCA. El último
 * medio segundo lleva un rebote muy corto, que es lo que hace una piedra cuando
 * termina de bajar sobre su lecho.
 *
 * Y se labra como se labra un sillar: masa, cara iluminada según SU normal,
 * filo retranqueado, lechos, filete especular en el trasdós y la marca del
 * cantero. Un polígono con un degradado encima es una cuña de papel, y eso es
 * exactamente lo que se veía flotando sobre la cimbra.
 */
function Voussoir({
  stone,
  progress,
  uid,
  detail,
  at,
  span,
}: {
  stone: Stone;
  progress: MotionValue<number>;
  uid: string;
  detail: MotionValue<number>;
  at: number;
  span: number;
}) {
  const t = useTransform(progress, [at, at + span], [0, 1], { clamp: true });
  const dy = useTransform(t, (v) => (v >= 1 ? 0 : -34 * Math.pow(1 - v, 1.7) + 1.8 * Math.sin(Math.PI * Math.min(1, v * 1.15)) * (v > 0.75 ? 1 : 0)));
  const o = useTransform(t, [0, 0.12, 1], [0, 1, 1]);
  const { lum } = stone;
  return (
    <motion.g style={{ y: dy, opacity: o }}>
      {/* la sombra arrojada sobre lo que hay debajo, en contra de la luz: sin
          ella la piedra no se apoya en nada y se lee como un recorte */}
      <path d={stone.d} fill="hsl(var(--surface-0))" fillOpacity="0.55" transform={`translate(${(-LIGHT.x * 3.4).toFixed(2)} ${(-LIGHT.y * 3.4).toFixed(2)})`} />
      <path d={stone.d} fill="hsl(var(--volt-deep))" />
      {/* LA CARA ILUMINADA, por la normal de ESTA pieza y no por un barrido. Y
          la cara que NO mira a la luz se oscurece: sin las dos mitades de la
          regla el arco tiene la misma tinta a los dos lados y la luz no existe. */}
      <path d={stone.d} fill="hsl(var(--surface-0))" fillOpacity={0.42 * (1 - lum)} />
      <path d={stone.d} fill="hsl(var(--volt-hi))" fillOpacity={0.02 + 0.5 * lum} />
      <path d={stone.d} fill={`url(#${uid}-tool)`} />
      {/* los lechos: por dónde una piedra empuja a la siguiente */}
      {stone.beds.map((b) => (
        <path key={b} d={b} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.9" strokeWidth="0.9" />
      ))}
      <path d={stone.d} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.8" strokeWidth="0.8" />
      {/* el filete especular, SOLO en el trasdós: es la cara que mira a la luz */}
      <path d={stone.back} fill="none" stroke="hsl(var(--volt-hi))" strokeOpacity={0.18 + 0.5 * lum} strokeWidth={stone.isKey ? 0.9 : 0.6} />
      {/* SEGUNDO NIVEL DE DETALLE: el filo labrado y la marca del cantero */}
      <motion.g style={{ opacity: detail }}>
        <path d={stone.draft} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.55" strokeWidth="0.45" />
        <path d={stone.mark} fill="none" stroke="hsl(var(--volt-hi))" strokeOpacity={stone.isKey ? 0.6 : 0.34} strokeWidth="0.55" strokeLinejoin="round" strokeLinecap="round" />
      </motion.g>
    </motion.g>
  );
}

/**
 * LA LÍNEA DE EMPUJES Y EL PULSO DE LA CLAVE.
 *
 * Dos mitades y dos `<path>`, cada uno con su `pathLength`: la fase del guion es
 * continua a lo largo de un trazado entero, así que un pulso que tiene que
 * salir del centro hacia los dos lados NO cabe en una sola curva.
 */
function Thrust({ on, pulse }: { on: MotionValue<number>; pulse: MotionValue<number> }) {
  const flash = useTransform(pulse, [0, 0.12, 0.85, 1], [0, 0.85, 0.85, 0], { clamp: true });
  const travel = useTransform(pulse, [0, 1], [1, 0], { clamp: true });
  return (
    <g>
      {[THRUST_L, THRUST_R].map((d) => (
        <motion.path
          key={d}
          d={d}
          fill="none"
          stroke="hsl(var(--volt-hi))"
          strokeOpacity="0.5"
          strokeWidth="1.1"
          strokeDasharray="5 3.5"
          style={{ opacity: on }}
        />
      ))}
      {[THRUST_L, THRUST_R].map((d) => (
        <motion.path
          key={`p${d}`}
          d={d}
          fill="none"
          stroke="hsl(var(--volt-hi))"
          strokeWidth="2.2"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="0.13 0.87"
          style={{ opacity: flash, strokeDashoffset: travel }}
        />
      ))}
    </g>
  );
}

/**
 * EL TABLERO, con su viga y su bordillo. Se pinta DESPUÉS del arco y ANTES de
 * la vasija: el arco queda detrás, la carga va encima.
 */
function Deck({ on }: { on: MotionValue<number> }) {
  const draw = useTransform(on, [0, 0.46], [0, 1], { clamp: true });
  const drop = useTransform(on, [0, 0.46], [14, 0], { clamp: true });
  return (
    <motion.g style={{ opacity: draw, y: drop }}>
      <path d={DECK_D} fill="hsl(var(--volt-deep))" />
      <path d={DECK_D} fill="hsl(var(--volt-hi))" fillOpacity="0.14" />
      <path d={DECK_D} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.8" strokeWidth="0.8" />
      {/* el ala inferior: sin ella la viga es una raya gruesa */}
      <path d={DECK_SOFFIT_D} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.7" strokeWidth={INK.pelo} />
      <path d={KERB_D} fill="hsl(var(--volt-deep))" />
      <path d={KERB_D} fill="hsl(var(--volt-hi))" fillOpacity="0.28" />
      <path d={KERB_D} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.75" strokeWidth="0.7" />
    </motion.g>
  );
}

/**
 * LAS CINCO PÉNDOLAS — el quórum sosteniendo el paso.
 *
 * Cada una entra en SU tramo del guion, el mismo que enciende su celda en la
 * lámina del quórum: la celda y la péndola son la misma afirmación dicha dos
 * veces en el mismo fotograma. Las tres que firman son miembros completos con
 * su collar arriba y su zapata abajo; las otras dos están PUESTAS pero flojas
 * —más finas y más apagadas—, que es exactamente lo que dice el mecanismo: las
 * cinco existen, tres bastan, ninguna sola.
 */
function Hangers({ progress, detail }: { progress: MotionValue<number>; detail: MotionValue<number> }) {
  return (
    <g>
      {HANGERS.map((h) => (
        <Hanger key={h.i} h={h} progress={progress} detail={detail} />
      ))}
    </g>
  );
}

function Hanger({ h, progress, detail }: { h: Hanger; progress: MotionValue<number>; detail: MotionValue<number> }) {
  const [a, b] = hangerTiming(h.i);
  const t = useTransform(progress, [a, b], [0, 1], { clamp: true });
  // Se TIENDE de arriba abajo, que es como se monta una péndola: primero agarra
  // el arco y después alcanza el tablero.
  const grow = useTransform(t, [0.08, 1], [0, 1], { clamp: true });
  const o = useTransform(t, [0, 0.14], [0, 1], { clamp: true });
  const shoe = useTransform(t, [0.88, 1], [0, 1], { clamp: true });
  const w = h.signs ? 2.6 : 1.5;
  const len = DECK_Y - h.top;
  return (
    <motion.g style={{ opacity: o }}>
      {/* el collar: donde agarra el intradós */}
      <path
        d={`M${(h.x - w - 2.4).toFixed(1)} ${(h.top + 1).toFixed(1)}L${(h.x + w + 2.4).toFixed(1)} ${(h.top + 1).toFixed(1)}L${(h.x + w + 1.2).toFixed(1)} ${(h.top + 7).toFixed(1)}L${(h.x - w - 1.2).toFixed(1)} ${(h.top + 7).toFixed(1)}Z`}
        fill="hsl(var(--volt-deep))"
        stroke="hsl(var(--volt-hi))"
        strokeOpacity={h.signs ? 0.5 : 0.24}
        strokeWidth="0.6"
      />
      {/* el tirante, tendido hacia abajo */}
      <motion.rect
        x={(h.x - w).toFixed(1)}
        y={(h.top + 5).toFixed(1)}
        width={w * 2}
        height={len - 5}
        fill="hsl(var(--volt-deep))"
        style={{ scaleY: grow, originY: 0, originX: 0.5 }}
      />
      <motion.rect
        x={(h.x - w).toFixed(1)}
        y={(h.top + 5).toFixed(1)}
        width={w * 2}
        height={len - 5}
        fill="hsl(var(--volt-hi))"
        fillOpacity={h.signs ? 0.34 : 0.12}
        style={{ scaleY: grow, originY: 0, originX: 0.5 }}
      />
      {/* el filo iluminado del canto derecho: la luz viene de ahí */}
      <motion.rect
        x={(h.x + w - 0.5).toFixed(1)}
        y={(h.top + 5).toFixed(1)}
        width={0.6}
        height={len - 5}
        fill="hsl(var(--volt-hi))"
        fillOpacity={h.signs ? 0.62 : 0.26}
        style={{ scaleY: grow, originY: 0, originX: 0.5 }}
      />
      {/* LA ZAPATA, con la marca del asiento: tic si firma, punto si no. Es el
          mismo semáforo que la lámina del consejo, en hierro.

          Aparece cuando el tirante YA ha llegado al tablero, no mientras baja:
          medido en captura a 0,78, la zapata se veía flotando bajo un tirante a
          medio tender y parecía una pieza suelta. */}
      <motion.g style={{ opacity: shoe }}>
        <path
          d={`M${(h.x - 6).toFixed(1)} ${DECK_Y - 9}L${(h.x + 6).toFixed(1)} ${DECK_Y - 9}L${(h.x + 6).toFixed(1)} ${DECK_Y - 1}L${(h.x - 6).toFixed(1)} ${DECK_Y - 1}Z`}
          fill="hsl(var(--volt-deep))"
          stroke="hsl(var(--volt-hi))"
          strokeOpacity={h.signs ? 0.55 : 0.22}
          strokeWidth="0.6"
        />
        <motion.g style={{ opacity: detail }}>
          {h.signs ? (
            <path
              d={`M${(h.x - 2.6).toFixed(1)} ${DECK_Y - 5}l1.8 1.8l3.4 -3.6`}
              fill="none"
              stroke="hsl(var(--volt-hi))"
              strokeOpacity="0.85"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <circle cx={h.x} cy={DECK_Y - 5} r="1.2" fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.5" strokeWidth="0.7" />
          )}
        </motion.g>
      </motion.g>
    </motion.g>
  );
}

/** EL PASAMANOS. Baranda abierta y no muro: lo que cruza tiene que verse. Se
 *  pinta DESPUÉS de la vasija, así que el tubo le cruza los pies — y eso es lo
 *  único que hace falta para que se lea que va POR el puente. */
function Rail({ on }: { on: MotionValue<number> }) {
  const off = useTransform(on, [0.34, 0.92], [1, 0], { clamp: true });
  const posts = useTransform(on, [0.5, 1], [0, 1], { clamp: true });
  return (
    <g>
      <motion.g style={{ opacity: posts }}>
        {RAIL_POSTS.map((d) => (
          <path key={d} d={d} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.4" strokeWidth={INK.pelo} />
        ))}
      </motion.g>
      <motion.path
        d={RAIL_D}
        fill="none"
        stroke="hsl(var(--volt-hi))"
        strokeOpacity="0.55"
        strokeWidth={INK.trazo}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        style={{ strokeDashoffset: off }}
      />
    </g>
  );
}

/**
 * LO QUE CRUZA. La vasija del vocabulario de la casa —rombo con cámara
 * interior, costura y anillo— pasa por encima del arco de un banco al otro y
 * llega IGUAL. No cambia de tamaño, ni de forma, ni de color en todo el
 * recorrido: eso es literalmente el argumento del producto, y por eso medía
 * quince píxeles y no se veía. Ahora mide el doble.
 */
function Crossing({ t, settle, uid }: { t: MotionValue<number>; settle: MotionValue<number>; uid: string }) {
  const x = useTransform(t, (v) => CROSS_X0 + (CROSS_X1 - CROSS_X0) * v);
  const o = useTransform(t, [0, 0.05], [0, 1], { clamp: true });
  return (
    <motion.g style={{ x, y: crossY(), opacity: o }}>
      <motion.g style={{ y: settle }}>
        <path d="M0 -24L13.6 0L0 24L-13.6 0Z" fill="hsl(var(--volt) / 0.2)" stroke="hsl(var(--volt-hi))" strokeOpacity="0.85" strokeWidth="1.6" />
        <path d="M0 -13.2L7.4 0L0 13.2L-7.4 0Z" fill="none" stroke="hsl(var(--volt-hi) / 0.5)" strokeWidth="0.8" />
        <path d="M-13.6 0L13.6 0" stroke="hsl(var(--volt-hi) / 0.6)" strokeWidth="0.9" />
        <circle cx="0" cy="0" r="3.4" fill="none" stroke="hsl(var(--volt-hi) / 0.75)" strokeWidth="0.7" />
      </motion.g>
    </motion.g>
  );
}

/**
 * EL PIE DE LA ESCENA. Va en HTML fuera del SVG: el texto de una página pública
 * tiene que poder seleccionarse, traducirse y leerse con un lector de pantalla,
 * y la cámara se mueve.
 *
 * ARRIBA y no abajo. Abajo caía sobre el tajo —la zona más oscura y la más
 * cargada del cuadro— y a diez píxeles de cuerpo se leía como un fantasma detrás
 * del dibujo. Arriba tiene el cielo detrás, que es la única banda vacía de la
 * escena. Y solo queda UNA frase: la del relevo la dice ahora el cierre del
 * recorrido, y decirla dos veces en el mismo fotograma no la dice más fuerte.
 */
function ThresholdCaption({ progress, lang }: { progress: MotionValue<number>; lang: Lang }) {
  const [a, b] = within(LEGACY_BEATS.strike, 0.42, 0.62);
  const [c, d] = within(LEGACY_BEATS.cross, 0.0, 0.16);
  const opacity = useTransform(progress, [a, b, c, d], [0, 1, 1, 0], { clamp: true });
  return (
    <motion.div
      style={{ opacity }}
      className="absolute left-1/2 -translate-x-1/2 top-[2%] text-[10px] font-mono uppercase tracking-[0.26em] whitespace-nowrap pointer-events-none"
    >
      <span style={{ color: 'hsl(var(--volt-soft) / 0.9)' }}>
        {T('Ninguna piedra sola sostiene el arco', 'No single stone holds the arch', lang)}
      </span>
    </motion.div>
  );
}

/**
 * EL FOTOGRAMA DE REPOSO. No es un modo degradado: es el mejor fotograma de la
 * escena y es lo que ve todo el que entra con un teléfono o con «Mínimo». El
 * arco terminado, de pie, sin cimbra, con sus estribos y con la vasija ya
 * cruzando la clave.
 */
function StillFrame({ uid, lang }: { uid: string; lang: Lang }) {
  return (
    <div className="relative w-full">
      {/* El encuadre llega hasta el PIE de los estribos: con 300 unidades de
          alto la sillería se cortaba a media hilada y los dos bancos terminaban
          en una recta horizontal, que es justo la lectura de «panel recortado»
          que este fotograma tiene que evitar. Es lo único que ve quien entra
          con un teléfono o con «Mínimo». */}
      <svg viewBox={`140 48 720 342`} className="block w-full h-auto" fill="none" aria-hidden focusable="false">
        <defs>
          <linearGradient id={`${uid}-srock`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y - 40} x2="0" y2={AC.y + 240}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.95 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 1 }} />
          </linearGradient>
          <linearGradient id={`${uid}-sgorge`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y - 10} x2="0" y2={DEEP}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--surface-1))', stopOpacity: 0.2 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 1 }} />
          </linearGradient>
          <linearGradient id={`${uid}-sfar`} gradientUnits="userSpaceOnUse" x1="0" y1={AC.y + 10} x2="0" y2={AC.y + 220}>
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-deep))', stopOpacity: 0.62 }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--surface-0))', stopOpacity: 0.72 }} />
          </linearGradient>
        </defs>
        {STARS.filter((s) => s.y < 262 && s.x > 130 && s.x < 870).map((s) => (
          <circle key={`${s.x}-${s.y}`} cx={s.x} cy={s.y} r={s.r} fill={s.hot ? 'hsl(var(--volt-hi))' : 'hsl(var(--volt-soft))'} fillOpacity={s.o * 0.75} />
        ))}
        <path d={FAR_D} fill={`url(#${uid}-sfar)`} />
        <path d={`M-200 ${AC.y - 10}L1200 ${AC.y - 10}L1200 ${DEEP}L-200 ${DEEP}Z`} fill={`url(#${uid}-sgorge)`} />
        <path d={INNER_L.d} fill="hsl(var(--volt-deep))" fillOpacity="0.34" />
        <path d={INNER_R.d} fill="hsl(var(--volt-deep))" fillOpacity="0.5" />
        <path d={BANK_L_D} fill={`url(#${uid}-srock)`} />
        <path d={BANK_R_D} fill={`url(#${uid}-srock)`} />
        {[...ABUT_L, ...ABUT_R].map((b, i) => (
          <g key={`${b.c}-${i}`}>
            <path d={b.d} fill="hsl(var(--volt-deep))" />
            <path d={b.d} fill="hsl(var(--volt-hi))" fillOpacity={0.05 + 0.16 * b.lum} />
            <path d={b.d} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.85" strokeWidth="0.7" />
          </g>
        ))}
        {STONES.map((s) => (
          <g key={s.k}>
            <path d={s.d} fill="hsl(var(--volt-deep))" />
            <path d={s.d} fill="hsl(var(--surface-0))" fillOpacity={0.42 * (1 - s.lum)} />
            <path d={s.d} fill="hsl(var(--volt-hi))" fillOpacity={0.02 + 0.5 * s.lum} />
            {s.beds.map((b) => (
              <path key={b} d={b} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.9" strokeWidth="0.9" />
            ))}
            <path d={s.d} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.8" strokeWidth="0.8" />
            <path d={s.back} fill="none" stroke="hsl(var(--volt-hi))" strokeOpacity={0.18 + 0.5 * s.lum} strokeWidth={s.isKey ? 0.9 : 0.6} />
          </g>
        ))}
        {/* EL PASO, terminado: tablero recto, las cinco péndolas colgando del
            intradós, la vasija encima y el pasamanos por delante. El fotograma
            quieto tiene que contar lo MISMO que el recorrido. */}
        <path d={DECK_D} fill="hsl(var(--volt-deep))" />
        <path d={DECK_D} fill="hsl(var(--volt-hi))" fillOpacity="0.14" />
        <path d={DECK_D} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.8" strokeWidth="0.8" />
        <path d={DECK_SOFFIT_D} fill="none" stroke="hsl(var(--surface-0))" strokeOpacity="0.7" strokeWidth={INK.pelo} />
        {HANGERS.map((h) => (
          <g key={h.i}>
            <rect
              x={h.x - (h.signs ? 2.6 : 1.5)}
              y={h.top + 5}
              width={(h.signs ? 2.6 : 1.5) * 2}
              height={DECK_Y - h.top - 5}
              fill="hsl(var(--volt-deep))"
            />
            <rect
              x={h.x - (h.signs ? 2.6 : 1.5)}
              y={h.top + 5}
              width={(h.signs ? 2.6 : 1.5) * 2}
              height={DECK_Y - h.top - 5}
              fill="hsl(var(--volt-hi))"
              fillOpacity={h.signs ? 0.34 : 0.12}
            />
            <path
              d={`M${h.x - 6} ${DECK_Y - 9}L${h.x + 6} ${DECK_Y - 9}L${h.x + 6} ${DECK_Y - 1}L${h.x - 6} ${DECK_Y - 1}Z`}
              fill="hsl(var(--volt-deep))"
              stroke="hsl(var(--volt-hi))"
              strokeOpacity={h.signs ? 0.55 : 0.22}
              strokeWidth="0.6"
            />
          </g>
        ))}
        <path d={KERB_D} fill="hsl(var(--volt-deep))" />
        <path d={KERB_D} fill="hsl(var(--volt-hi))" fillOpacity="0.28" />
        <g transform={`translate(${AC.x + 168} ${crossY()})`}>
          <path d="M0 -24L13.6 0L0 24L-13.6 0Z" fill="hsl(var(--volt) / 0.2)" stroke="hsl(var(--volt-hi))" strokeOpacity="0.85" strokeWidth="1.6" />
          <path d="M-13.6 0L13.6 0" stroke="hsl(var(--volt-hi) / 0.6)" strokeWidth="0.9" />
          <circle cx="0" cy="0" r="3.4" fill="none" stroke="hsl(var(--volt-hi) / 0.75)" strokeWidth="0.7" />
        </g>
        {RAIL_POSTS.map((d) => (
          <path key={d} d={d} fill="none" stroke="hsl(var(--volt-soft))" strokeOpacity="0.4" strokeWidth={INK.pelo} />
        ))}
        <path d={RAIL_D} fill="none" stroke="hsl(var(--volt-hi))" strokeOpacity="0.55" strokeWidth={INK.trazo} strokeLinecap="round" />
      </svg>
      <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.26em]" style={{ color: 'hsl(var(--volt-soft) / 0.85)' }}>
        {T('Ninguna piedra sola sostiene el arco', 'No single stone holds the arch', lang)}
      </div>
    </div>
  );
}

export const ThresholdScene = memo(ThresholdSceneImpl);
export default ThresholdScene;

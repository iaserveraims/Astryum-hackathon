/**
 * EL OFICIO COMPARTIDO — la capa que usan las dos escenas nuevas.
 *
 * Fichero PURO: sin JSX, sin React, sin DOM. Todo lo de aquí se puede evaluar
 * en el servidor, en una prueba y en el navegador, y da exactamente el mismo
 * resultado en los tres sitios. Eso no es una preferencia de estilo: las dos
 * escenas emiten geometría a nivel de módulo y una sola llamada a
 * `Math.random()` aquí rompería la hidratación de la portada entera.
 *
 * ── POR QUÉ EXISTE ───────────────────────────────────────────────────────
 * El fundador, viendo la primera versión de los dos mundos (2026-09-18):
 * «se siguen viendo las animaciones toscas y están hechas con palitos simples».
 * Tenía razón, y el diagnóstico de fondo es que la geometría estaba ESCRITA A
 * MANO: una uve de tres puntos reutilizada como cuenca, roca, cumbre cercana y
 * segunda cumbre; dos cordilleras de doce puntos tecleados; veintisiete
 * palitos del terreno clonados cada treinta y seis unidades exactas. Nada de
 * eso tiene variación natural porque nada de eso salió de un procedimiento.
 *
 * Aquí vive el procedimiento: un generador determinista, un ruido, un
 * desplazamiento del punto medio, una conversión a curvas, una perspectiva
 * ortográfica y una escala de tintas. La complejidad sale de MEDIR, no de
 * añadir más palitos.
 *
 * ── LO QUE NO ESTÁ AQUÍ, Y POR QUÉ ───────────────────────────────────────
 * Nada que use `SolarJourney`. Si el mundo Personal necesita algo parecido se
 * COPIA, nunca se refactoriza en su sitio: sus tablas de tiempo cuelgan del
 * array de paradas de Personal y es el fichero más delicado del repo.
 */

/* ═══════════════════════════════════════════════════════════════════════
   DETERMINISMO
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Mulberry32. Un generador de 32 bits con estado de 32 bits: rápido, sin
 * dependencias y —lo único que importa aquí— REPETIBLE. La misma semilla da la
 * misma cordillera en el servidor y en el cliente, que es la condición para
 * poder emitir la geometría a nivel de módulo y no pagarla en cada render.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * RUIDO DE VALOR EN UNA DIMENSIÓN, sumado en octavas (fBm).
 *
 * Devuelve `n` muestras en [0..1] mapeadas a un perfil. Cada octava dobla la
 * frecuencia y usa su propia amplitud, así que el relieve tiene rasgos grandes
 * y detalle pequeño a la vez — que es la diferencia entre un terreno y una
 * sierra de dientes iguales.
 *
 * Interpolación suave (smoothstep) y no lineal: con lineal se ven los vértices
 * de la retícula del ruido, y esos vértices alineados son exactamente el
 * aspecto «hecho con palitos» que hay que quitar.
 */
export function fbm1(seed: number, n: number, octaves = 3, amps: readonly number[] = [9, 4, 1.6]): Float64Array {
  const out = new Float64Array(n);
  for (let o = 0; o < octaves; o++) {
    const rnd = mulberry32(seed + o * 0x9e37);
    // Nodos de esta octava: 4 al principio y el doble en cada una.
    const nodes = 4 * Math.pow(2, o) + 1;
    const grid = new Float64Array(nodes);
    for (let i = 0; i < nodes; i++) grid[i] = rnd() * 2 - 1;
    const amp = amps[o] ?? amps[amps.length - 1] * Math.pow(0.5, o - amps.length + 1);
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * (nodes - 1);
      const k = Math.min(nodes - 2, Math.floor(t));
      const f = t - k;
      const s = f * f * (3 - 2 * f); // smoothstep
      out[i] += (grid[k] * (1 - s) + grid[k + 1] * s) * amp;
    }
  }
  return out;
}

export type Pt = [number, number];

/**
 * DESPLAZAMIENTO DEL PUNTO MEDIO — de tres puntos a una cresta.
 *
 * Parte de unos anclajes (para la cuenca: los dos bordes y el cruce de la Y) y
 * subdivide `subdiv` veces, desplazando cada punto nuevo PERPENDICULARMENTE a
 * su segmento con una amplitud que cae a la mitad larga en cada nivel. El
 * resultado tiene rasgos a todas las escalas, que es lo que distingue una
 * silueta de roca de una línea quebrada.
 *
 * ── LAS DOS GARANTÍAS ────────────────────────────────────────────────────
 * 1. LOS ANCLAJES NO SE MUEVEN. Los extremos son los brazos de la Y: si se
 *    mueven, el valle deja de apoyarse en la letra y el relevo se ve.
 * 2. NADA SE SALE DE LA HORQUILLA. `inside` recorta cada punto dentro del
 *    envolvente de la uve. Sin esto la cresta asoma por fuera del brazo de la
 *    letra, que es un fallo que este repo ya cometió dos veces con líneas
 *    escritas a mano.
 *
 * El peso `w` lleva el desplazamiento a cero junto a cada anclaje y lo reduce
 * junto a la cumbre, para que un pico siga siendo un pico.
 */
export function ridge(
  seed: number,
  anchors: readonly Pt[],
  subdiv = 6,
  R = 6,
  inside?: (p: Pt) => Pt,
): Pt[] {
  const rnd = mulberry32(seed);
  let pts: Pt[] = anchors.map((p) => [p[0], p[1]]);
  // Los índices de los anclajes se duplican en cada subdivisión: llevar la
  // cuenta es lo que permite que el peso sepa dónde NO puede tocar.
  let anchorIdx = anchors.map((_, i) => i * 1);
  for (let level = 0; level < subdiv; level++) {
    const amp = R * Math.pow(0.55, level);
    const next: Pt[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push(pts[i]);
      const a = pts[i];
      const b = pts[i + 1];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      // Normal unitaria del segmento.
      const nx = -dy / len;
      const ny = dx / len;
      // Posición normalizada del punto nuevo sobre el perfil entero.
      const t = (i + 0.5) / (pts.length - 1);
      const near = Math.min(...anchorIdx.map((ai) => Math.abs(t - ai / (anchors.length - 1))));
      const wEnds = Math.min(1, near / 0.055);
      const d = amp * (rnd() * 2 - 1) * wEnds;
      let p: Pt = [mx + nx * d, my + ny * d];
      if (inside) p = inside(p);
      next.push(p);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    anchorIdx = anchorIdx.map((ai) => ai * 2);
  }
  return pts;
}

/** Una polilínea como cadena `M…L…`. */
export function toPath(pts: readonly Pt[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('');
}

/**
 * CATMULL-ROM → CÚBICAS DE BÉZIER.
 *
 * Una polilínea de veintiséis puntos tiene veintiséis esquinas, y a la escala
 * de la cámara (×4,6) esas esquinas se ven. Convertir a cúbicas cuesta cuatro
 * multiplicaciones por punto y quita el facetado entero. Es la mejora de
 * calidad más barata que hay en las dos escenas.
 */
export function catmullToCubic(pts: readonly Pt[], tension = 1): string {
  if (pts.length < 2) return '';
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 >= n ? n - 1 : i + 2];
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    d += `C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

/**
 * LA ONDÍCULA DE RICKER (sombrero mexicano): `(1 − 2u²)·e^(−u²)`.
 *
 * Es la perturbación que deja una gota al entrar en el lago, y se elige ESTA y
 * no una campana de Gauss por una razón que no es estética: su integral vale
 * exactamente cero. Una campana es toda negativa y desplaza el nivel medio del
 * agua; la regla 1 de la escena —la lámina se queda clavada— viene del
 * invariante #9 (un nivel que sube se lee como rendimiento insinuado), así que
 * es una restricción regulatoria, no un gusto. Con Ricker el agua se agita y
 * el nivel medio no se mueve, y eso es comprobable en captura.
 */
export function ricker(u: number): number {
  const u2 = u * u;
  return (1 - 2 * u2) * Math.exp(-u2);
}

/* ═══════════════════════════════════════════════════════════════════════
   LUZ Y TINTA
   ══════════════════════════════════════════════════════════════════════ */

/**
 * UNA SOLA LUZ, declarada una vez, obedecida por las dos escenas.
 *
 * 35° sobre la horizontal, desde la derecha. Todo lo que arroja luz o sombra
 * —el bisel del nombre, la rampa rasante, la cara iluminada del macizo, la
 * cresta de la nieve, la banda especular del agua, el brillo interior de la
 * gota, el limbo del planeta— usa ESTE vector. Que una escena tenga una sola
 * dirección de luz es, con diferencia, lo que más separa un dibujo profesional
 * de un montón de formas correctas.
 */
export const LIGHT = { x: 0.574, y: -0.819, deg: 35 } as const;

/**
 * LA ESCALA DE TINTAS, en unidades del lienzo y no en píxeles de pantalla.
 *
 * Las dos escenas tenían trece grosores distintos entre 0,6 y 1,6 y CATORCE
 * elementos con `non-scaling-stroke`, así que al acercarse la cámara el dibujo
 * se quedaba igual de fino y por tanto más vacío. Aquí hay cuatro pesos y una
 * regla: los trazos DEL MUNDO se autoran en unidades y engordan con la cámara;
 * solo la capa de anotación (limnímetro, sondas, marcas de registro) conserva
 * `non-scaling-stroke`, porque una anotación es un dibujo sobre el dibujo y
 * debe medir siempre lo mismo en pantalla. Ese contraste entre trazo de mundo y
 * trazo de instrumento es en sí mismo la señal de calidad.
 */
export const INK = { filete: 2.2, trazo: 1.0, pelo: 0.6, tramado: 0.35 } as const;

/**
 * PERSPECTIVA AÉREA. Lo lejano no solo se aclara: se DESTIÑE hacia el color
 * del cielo. Llevar la distancia solo con alfa es difuminar; llevarla también
 * con un viraje de tono es lo que hace que un plano lejano se lea como lejano
 * y no como el mismo plano más flojo.
 */
export function haze(depth: 0 | 1 | 2): { fillAlpha: number; skyTint: number; stroke: number } {
  return {
    fillAlpha: [0.72, 0.34, 0.18][depth],
    skyTint: [0.08, 0.22, 0.38][depth],
    stroke: [INK.filete, INK.trazo, 0][depth],
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   LA PROYECCIÓN DEL UMBRAL (Legacy)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * LA CÁMARA DE INCLINACIÓN ORTOGRÁFICA.
 *
 * La escena Legacy afirma que los cinco puntos del consejo son la misma figura
 * vista desde arriba (constelación) y desde el suelo (triangulación). Esa
 * afirmación ES la abscisa: si al inclinarse las x se mueven, la demostración
 * deja de demostrar.
 *
 * Por eso NO hay división en perspectiva. Una perspectiva hace que la x de
 * pantalla dependa de la profundidad, y con la inclinación final eso son varios
 * puntos porcentuales de deriva horizontal — varios puntos porcentuales de la
 * afirmación. Una oblicua ortográfica conserva las abscisas POR CONSTRUCCIÓN,
 * es la proyección correcta de una plancha de levantamiento topográfico, y no
 * tiene modos de fallo (ni suelo de la división, ni cero en el denominador).
 *
 * La consecuencia honesta, dicha en voz alta: una proyección ortográfica NO
 * tiene punto de fuga, así que la retícula del suelo son rectas paralelas cuyo
 * espaciado se comprime por `cos φ`. Es exactamente como se lee una hoja de
 * plancheta o una carta náutica. No se promete una retícula que converge.
 *
 * ── DE DÓNDE SALE EL ÁNGULO ──────────────────────────────────────────────
 * No es a ojo. Es el ajuste por mínimos cuadrados de la tabla de posiciones de
 * suelo que el autor original ESCRIBIÓ A MANO, contra la profundidad de cada
 * asiento: pendiente −0,18857 → cos φ = 0,18857 → φ = 79,13°, con un residuo
 * máximo de 3,1 unidades. O sea: ya estaba dibujando una inclinación de 79° a
 * ojo, y esto sustituye diez números mágicos por dos.
 */
export const PHI_MAX = (79.13 * Math.PI) / 180;

/** La altura de pantalla de un punto del plano a profundidad `Z`, con la
 *  inclinación parametrizada por `t` ∈ [0,1] y la línea de base migrando de
 *  `G0a` (órbita) a `G0b` (suelo). La abscisa NO aparece: es intocable. */
export function projectY(t: number, Z: number, G0a: number, G0b: number): number {
  const phi = PHI_MAX * t;
  const G0 = G0a + (G0b - G0a) * t;
  return G0 - Z * Math.cos(phi);
}

/** El coseno de la inclinación: el aplastamiento de todo lo que está TUMBADO
 *  en el suelo (los anillos se vuelven elipses de `ry = r·cosφ`). */
export const pitchCos = (t: number) => Math.cos(PHI_MAX * t);
/** El seno: el alargamiento de todo lo que está DE PIE (los jalones, que miden
 *  cero vistos desde el cenit y su altura entera vistos a ras). */
export const pitchSin = (t: number) => Math.sin(PHI_MAX * t);

/* ═══════════════════════════════════════════════════════════════════════
   LA LÁMINA (los paneles)
   ══════════════════════════════════════════════════════════════════════ */

/**
 * LOS FILETES DE LA LÁMINA.
 *
 * El tema institucional de la app tiene `--plate-rule` y sus hermanos, pero
 * viven dentro de `[data-skin='institutional']` y la landing NO pone ese
 * atributo: allí esas variables no existen y `var(--plate-rule)` caería a nada.
 * Así que aquí van los MISMOS valores escritos contra `--ink`, que sí está en
 * todas partes y gira con el tema claro. Comprobado en globals.css antes de
 * escribirlo: el atajo habría dejado los paneles sin filete y sin avisar.
 */
export const PLATE = {
  rule: 'hsl(var(--ink) / 0.14)',
  ruleSoft: 'hsl(var(--ink) / 0.07)',
  ruleStrong: 'hsl(var(--ink) / 0.26)',
  topLight: 'hsl(var(--ink) / 0.07)',
} as const;

/**
 * EL SEMÁFORO, en un solo sitio.
 *
 * Había TRES respuestas distintas a «esto está bien» en tres ficheros, dos de
 * ellas con hex a hueso (`#8FBF9F` y `#34D399`), y un `rgba(255,255,255,0.28)`
 * para «esto no» que en tema claro se vuelve invisible. Los tokens `--tone-*`
 * ya tienen su versión de tema claro y su versión de piel institucional; usar
 * el token es lo que hace que el panel siga siendo legible cuando alguien
 * cambia de tema, que es una función que este producto YA tiene.
 */
export const TONE = {
  success: 'hsl(var(--tone-success))',
  warning: 'hsl(var(--tone-warning))',
  danger: 'hsl(var(--tone-danger))',
  off: 'hsl(var(--ink) / 0.28)',
} as const;

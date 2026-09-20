'use client';

/**
 * EL CIERRE DEL MUNDO INSTITUCIONAL — LA MESA DEL GRABADOR.
 *
 * ── POR QUÉ EXISTE ESTE FICHERO ──────────────────────────────────────────
 * Hasta hoy los TRES mundos cerraban con la misma sección: `SignatureBreak`
 * (id `light-beat`), donde UNA ESTRELLA se acerca en la noche, fulgura e inunda
 * la página de luz crema, y sobre el crema hay una firma cursiva que se escribe
 * sola y una TARJETA DE EMBARQUE con su glifo de asteroide y su órbita de
 * transferencia.
 */

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { usePointerParallax } from './interactions';
import { CREST_BOX, CREST_PTS } from './art/ValleyScene';
import { catmullToCubic, fbm1, INK, LIGHT, mulberry32, type Pt } from './art/craft';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

/* ═══════════════════════════════════════════════════════════════════════
   GEOMETRÍA — toda a nivel de módulo y toda con semilla.
   Ni un `Math.random` ni un `Date.now`: lo que el servidor pinta y lo que el
   cliente rehidrata tienen que ser el mismo dibujo, byte a byte.

   Todo esto se ajustó en un banco de pruebas aparte —un HTML estático que
   importa esta misma `craft.ts` y pinta cinco valores del dial de un tirón—
   porque el dev server tarda seis minutos en compilar en frío y el dibujo no se
   puede afinar a ciegas.
   ══════════════════════════════════════════════════════════════════════ */

/** El lienzo de la mesa, en píxeles de diseño. */
const W = 1440;
// 660 y no 860: la mesa va en el FLUJO, así que cada píxel suyo alarga la
// sección, y una sección de 1864 px no cabe en un visor de 900 — cuando la luz
// llegaba del todo, el botón ya había pasado. Recortar el lienzo es gratis
// porque los objetos sangran igual por los cantos; lo único que se ve es una
// franja más estrecha de la mesa, que además es MÁS de macro.
const H = 660;

/* ── LA MESA ─────────────────────────────────────────────────────────── */

/** LA VETA. Nueve curvas largas casi paralelas con ruido de valor de tres
 *  octavas: una veta recta es un rayado y una veta aleatoria es ruido — lo que
 *  la hace leerse como madera es que todas ondulan a la vez, porque todas
 *  siguen la misma fibra. */
const GRAIN: string[] = Array.from({ length: 9 }, (_, i) => {
  const n = fbm1(0x4d21 + i * 37, 44, 3, [9, 3.4, 1.2]);
  return catmullToCubic(Array.from({ length: 44 }, (_, k): Pt => [(k / 43) * (W + 300) - 150, 30 + i * 104 + n[k] * 1.8]));
});

/**
 * ESCALA, y es la corrección que más cambió el dibujo.
 *
 * La primera versión ponía una mesa entera con dos objetos pequeños en medio, y
 * dos rectángulos planos vistos desde arriba son clip art por mucho detalle que
 * lleven dentro. Aquí los dos objetos SANGRAN por los cantos: se ve un trozo
 * grande de cada uno, como en una foto de taller. Es la única forma de que el
 * bisel sea un bisel, el surco sea un surco y la verjura se vea — y es
 * literalmente lo que el fundador lleva pidiendo toda la semana: «las cosas no
 * me gusta que se vean pequeñas».
 */
/*
 * UN SOLO OBJETO. La primera versión ponía la plancha de cobre Y el pliego,
 * los dos sangrando por los cantos y solapados: el fundador, «no me
 * queda muy claro lo que es el artefacto del final con lo que parece ser una
 * mesa, tiene que ser algo más sencillo y bien ejecutado».
 */
const SHEET = { x: 250, y: 40, w: 940, h: 600 } as const;
/** El hueco grabado, por dentro del bisel. */
/** La caja impresa en el pliego. Debajo va el margen, que es donde vive el
 *  argumento, así que el margen se ancla A ESTA CAJA y no al canto del papel:
 *  el papel sangra fuera del cuadro y el margen se perdía. */
const PRINT = { x: SHEET.x + 70, y: SHEET.y + 58, w: SHEET.w - 140, h: 330 } as const;

const into = (b: { x: number; y: number; w: number; h: number }) => (p: Pt): Pt => [
  b.x + ((p[0] - CREST_BOX.x0) / (CREST_BOX.x1 - CREST_BOX.x0)) * b.w,
  b.y + ((p[1] - CREST_BOX.yTop) / (CREST_BOX.yBase - CREST_BOX.yTop)) * b.h,
];

/** El valle grabado en la plancha —EN ESPEJO, que es como está una plancha de
 *  verdad— y el mismo valle del derecho en el pliego. La prueba de que una cosa
 *  es el negativo de la otra está sobre la mesa, sin una palabra. */
const PRINTED_D = catmullToCubic(CREST_PTS.map(into(PRINT)));

/**
 * EL TRAMADO. Una línea sola no es un grabado: un grabado es una SUPERFICIE
 * construida con líneas, y esa es la diferencia entre esto y las mil
 * imitaciones de grabado que son un contorno sobre un fondo de color.
 *
 * Tres cosas que no son adorno:
 *  · Va A FAVOR DE LA LUZ, no en vertical. A buril la mano sigue una sola
 *    dirección en toda la plancha; en vertical salen palotes.
 *  · Aprieta en la cara que está de espaldas a la luz, que es la MISMA regla de
 *    sombreado que ya obedece el macizo del recorrido.
 *  · Adelgaza hacia los bordes y lleva variación sembrada: un tramado que
 *    termina todo a la misma altura deja un canto recto que no existe en ningún
 *    grabado.
 */
function hatch(box: { x: number; y: number; w: number; h: number }, step: number, seed: number): string[] {
  const pts = CREST_PTS.map(into(box));
  const rnd = mulberry32(seed);
  const yAt = (x: number): number | null => {
    for (let i = 0; i < pts.length - 1; i++) {
      if (x >= pts[i][0] && x <= pts[i + 1][0]) {
        const t = (x - pts[i][0]) / (pts[i + 1][0] - pts[i][0] || 1);
        return pts[i][1] + t * (pts[i + 1][1] - pts[i][1]);
      }
    }
    return null;
  };
  const peak = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
  const out: string[] = [];
  const ux = -LIGHT.x;
  const uy = -LIGHT.y;
  for (let x = box.x + 3; x < box.x + box.w - 3; x += step) {
    const y0 = yAt(x);
    if (y0 == null) continue;
    const shade = x > peak[0];
    const room = box.y + box.h - y0;
    const edge = Math.min(1, Math.min(x - box.x, box.x + box.w - x) / (box.w * 0.22));
    const len = room * (shade ? 0.86 : 0.3) * (0.72 + rnd() * 0.28) * edge;
    if (len < 5) continue;
    out.push(`M${x.toFixed(1)} ${(y0 + 1.4).toFixed(1)}l${(ux * len).toFixed(1)} ${(uy * len).toFixed(1)}`);
    // el segundo paso cruzado, SOLO en lo más oscuro: es como se oscurece de
    // verdad una plancha, con otra pasada en ángulo y no apretando la primera
    if (shade && rnd() > 0.45) {
      const l2 = len * 0.5;
      out.push(`M${(x + 3).toFixed(1)} ${(y0 + 3).toFixed(1)}l${(uy * l2).toFixed(1)} ${(-ux * l2).toFixed(1)}`);
    }
  }
  return out;
}
const HATCH_PRINT = hatch(PRINT, 8, 0x71a3);

/**
 * EL GUILLOCHÉ, y dos versiones descartadas antes de esta.
 * Nueve elipses grandes eran un espirógrafo de compás escolar. Sesenta con el
 * radio modulado salían lana de acero y competían con el grabado, que es el
 * sujeto. Un fondo de seguridad de verdad es una ORLA: va en un canto, es
 * regular y apretadísima, se lee como un TONO y solo de cerca descubres que son
 * líneas. Nada de hipotrocoides: su número de lóbulos es R/gcd(R,r) y es
 * facilísimo parametrizarlo mal y acabar con la curva mal muestreada, que es un
 * fallo que este repo ya ha pagado dos veces con otras curvas.
 */
const ROSETTE = Array.from({ length: 34 }, (_, k) => ({
  rot: k * 10.6,
  rx: 236 + Math.sin(k * 0.9) * 7,
  ry: 74 + Math.cos(k * 0.9) * 5,
}));


/** La tira de control de entintado: diez pasos de tinta llena a nada. Sustituye
 *  al código de barras del billete de avión — mismo ritmo de barritas, pero esto
 *  es un control real de un pliego impreso. Y sin un solo numeral: una cifra en
 *  un cierre es una cifra que alguien puede leer como promesa. */
const INKSTEPS = Array.from({ length: 10 }, (_, i) => 1 - i / 9);

/* ── LA SOMBRA ───────────────────────────────────────────────────────── */

/** El lienzo de la sombra es MÁS ALTO que el de la mesa: la capa cubre la
 *  sección entera, que mide bastante más que una pantalla. */
const SH = { w: W, h: 1700 } as const;

/** La cresta del recorrido, mapeada a este lienzo. `CREST_PTS` viene de la
 *  escena del valle: es la MISMA ladera, no otra con la misma semilla. */
const CREST: Pt[] = (() => {
  const sx = (W * 0.92) / (CREST_BOX.x1 - CREST_BOX.x0);
  const sy = 300 / (CREST_BOX.yBase - CREST_BOX.yTop);
  const m = CREST_PTS.map<Pt>((p) => [(p[0] - CREST_BOX.x0) * sx - W * 0.16, (p[1] - CREST_BOX.yTop) * sy + 560]);
  // Tramos planos a los lados: la silueta VIAJA, y una que se queda corta
  // enseña su canto.
  return [[-1600, m[0][1]], ...m, [W + 1600, m[m.length - 1][1]]];
})();

/**
 * LA PENUMBRA, EN NUEVE PASADAS Y SIN UN SOLO FILTRO.
 *
 * Una sombra de verdad no tiene un borde: tiene un gradiente de ocultación
 * parcial. Lo barato es un `feGaussianBlur`, y un desenfoque a pantalla completa
 * recalculado cada fotograma es el coste que este repo ya pagó una vez y retiró.
 * Aquí son copias de la MISMA silueta desplazadas sobre el vector de luz, con la
 * misma alfa baja: ocho escalones en cincuenta y seis unidades y luego la umbra.
 * Cuesta nueve paths ESTÁTICOS y cero por fotograma.
 */
const BANDS: Array<{ off: number; a: number }> = [
  ...[56, 45, 35, 26, 18, 11, 5, 0].map((off) => ({ off, a: 0.12 })),
  { off: -30, a: 0.88 },
];

const crestPath = (off: number) =>
  catmullToCubic(CREST.map<Pt>(([x, y]) => [x + LIGHT.x * off, y + LIGHT.y * off])) +
  `L${W + 1600} ${SH.h + 1600}L-1600 ${SH.h + 1600}Z`;

const SHADOW_D = BANDS.map((b) => ({ ...b, d: crestPath(b.off) }));
/** El filo de la cresta, sin cerrar: por ahí es por donde está a punto de asomar
 *  la luz, y es lo único cálido de toda la parte oscura. */
const CREST_EDGE_D = catmullToCubic(CREST);

/* ═══════════════════════════════════════════════════════════════════════
   EL COMPONENTE
   ══════════════════════════════════════════════════════════════════════ */

export default function InstitutionalBreak({ lang, cta }: { lang: Lang; cta: ReactNode }) {
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });

  // EL MUELLE SE QUEDA, con sus mismos números. El fundador ya pagó una vez «si
  // se hace scroll muy rápido parece un flashbang», y la cura no fue educar al
  // visitante: fue limitar la velocidad por física.
  const eased = useSpring(scrollYProgress, { stiffness: 42, damping: 26, mass: 0.8 });

  // LA MESA SE ENCIENDE DEPRISA Y SIN CEREMONIA.
  //
  // Antes esto era una sombra de terreno —la ladera del valle— cruzando la mesa
  // durante media sección. Tenía razón por una
  // razón que solo se ve a su resolución: en 2560×1080 la silueta ocupa media
  // pantalla y, sin habitación ni horizonte alrededor, no se lee como una
  // sombra — se lee como una mancha marrón diagonal sobre un fondo beige. Una
  // sombra necesita un sitio que la explique, y aquí no lo hay.
  const lit = useTransform(eased, [0.06, 0.2, 0.86, 0.99], [0, 1, 1, 0], { clamp: true });

  // EL GESTO ES LA ESTAMPA IMPRIMIÉNDOSE, que es exactamente lo que dice el
  // titular. Una barrida de izquierda a derecha: es como sale un pliego de la
  // prensa, pasando bajo el rodillo. No hay que explicarla y dura lo que dura
  // leer la frase.
  const printW = useTransform(eased, [0.22, 0.56], [0, 1], { clamp: true });
  // El pase especular de la huella, UNA vez, justo al terminar la impresión.
  const glint = useTransform(eased, [0.5, 0.6, 0.72], [0, 1, 0], { clamp: true });
  // El margen se escribe DESPUÉS: primero la estampa, después lo que le falta.
  const margin = useTransform(eased, [0.58, 0.72, 0.86, 0.97], [0, 1, 1, 0], { clamp: true });
  // La verjura solo se ve con la luz de canto, y el canto es el momento en que
  // la mañana entra: un detalle que existe por el ángulo y se va con él.
  const laid = useTransform(eased, [0.2, 0.34, 0.74, 0.9], [0, 0.85, 0.85, 0.2], { clamp: true });
  const castK = useTransform(eased, [0.2, 0.62], [1.7, 1], { clamp: true });
  /**
   * EL ANOCHECER, y hace falta ADEMÁS del apagado temporal.
   *
   * Con solo el apagado, medido a fondo de página: la sección termina ochenta
   * píxeles dentro del visor, así que el campo todavía está al nueve por ciento
   * y pasa a cero DE GOLPE en el borde. Un nueve por ciento de crema sobre
   * negro es una banda oliva, y una banda oliva que termina en canto es
   * exactamente el corte que el fundador ve.
   */
  const dusk = useTransform(eased, [0.76, 0.93], [0, 1], { clamp: true });

  // El texto entra CON la luz, no después: en una sección pegada no hay ningún
  // motivo para que el titular espere.
  const copyOpacity = useTransform(eased, [0.1, 0.24, 0.86, 0.97], [0, 1, 1, 0], { clamp: true });
  const copyY = useTransform(eased, [0.1, 0.24], [22, 0]);

  // LO ÚNICO QUE SIGUE AL PUNTERO es el especular: el difuso no depende de
  // dónde estés, el especular sí. Mover el resto con el ratón sería mover el sol.
  const { x: px } = usePointerParallax(70, 20);
  const specX = useTransform(px, [-0.5, 0.5], [-16, 16]);

  const still = reduce || level === 'minimal';

  return (
    /*
     * LA SECCIÓN ES PEGAJOSA, y ese es el arreglo de fondo de este cierre.
     *
     * Exacto, y era estructural: el titular y la mesa iban en el flujo
     * uno detrás del otro, así que sumaban más de mil quinientos píxeles y en
     * un visor de 1080 no cabían juntos NUNCA. Cuando la mesa se veía, la frase
     * ya había salido por arriba.
     *
     * Con una ventana pegada, la frase y el objeto comparten pantalla durante
     * todo el tiempo y lo que avanza con el scroll es la impresión, no el
     * encuadre. Es la misma carcasa que usa el recorrido de arriba, que es
     * justo donde esto no pasaba.
     */
    <section ref={ref} id="light-beat" className="relative h-[240svh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {/* ── EL TABLERO ──────────────────────────────────────────────
            La rampa crema es la de `SignatureBreak` carácter por carácter: los
            tres mundos comparten UN día. */}
        <motion.div
          className="absolute inset-0"
          style={{
            opacity: still ? 1 : lit,
            background:
              'radial-gradient(150vw 170svh at calc(100% + 8vw) -16%, #FDF4DA 0%, #F8E9C0 34%, #EFDCA6 66%, #DDC189 100%)',
          }}
          aria-hidden
        >
          {/* LA VETA, donde el mundo solar pinta estrellas en negativo. */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1200 760" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <g fill="none" stroke="rgba(62,44,20,0.055)" strokeWidth="1.1">
              {GRAIN.map((d) => (
                <path key={d} d={d} />
              ))}
            </g>
            <g fill="none" stroke="rgba(62,44,20,0.07)" strokeWidth="1">
              <ellipse cx="238" cy="196" rx="26" ry="9" />
              <ellipse cx="238" cy="196" rx="15" ry="5" />
              <ellipse cx="947" cy="612" rx="21" ry="7.5" />
            </g>
          </svg>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(rgba(40,30,12,0.10) 0.8px, transparent 1.4px)',
              backgroundSize: '46px 46px',
              WebkitMaskImage: 'radial-gradient(120% 90% at 62% 30%, #000 20%, transparent 88%)',
              maskImage: 'radial-gradient(120% 90% at 62% 30%, #000 20%, transparent 88%)',
            }}
            aria-hidden
          />
        </motion.div>

        {/* EL ANOCHECER: el borde de abajo llega oscuro al pie. Va por encima
            del tablero y por DEBAJO del contenido — lo que tiene que apagarse
            es el campo, no el texto, que se retira con su propia rampa. */}
        {!still && (
          <motion.div
            className="absolute inset-x-0 bottom-0 h-[58svh] pointer-events-none z-[1]"
            style={{
              opacity: dusk,
              background: 'linear-gradient(180deg, rgba(8,8,10,0) 0%, rgba(8,8,10,0.55) 46%, rgba(6,6,8,0.97) 100%)',
            }}
            aria-hidden
          />
        )}

        {/* ── EL CONTENIDO, TODO EN UNA PANTALLA ────────────────────────
            DOS COLUMNAS, y la razón es la pantalla del fundador. Apilado —la
            frase encima y la estampa debajo— el alto es el que manda: en
            2560×1080 al pliego le quedaban trescientos ochenta píxeles de alto
            y salía midiendo un cuarto del ancho, ahogado en crema. Con la
            frase a la izquierda y la estampa a la derecha, el ancho que sobra
            en una ultrapanorámica se convierte en tamaño del objeto, que es lo
            que el fundador lleva pidiendo toda la semana. Por debajo de `lg`
            vuelve a apilarse, que es donde apilar sí es lo correcto. */}
        <div className="relative z-[2] h-full px-6 md:px-10 lg:px-14 py-[4svh] grid items-center gap-8 lg:gap-12 grid-cols-1 lg:grid-cols-[minmax(0,0.78fr),minmax(0,1.22fr)] max-w-[2200px] mx-auto">
          <motion.div
            className="relative text-center lg:text-left min-w-0"
            style={still ? undefined : { opacity: copyOpacity, y: copyY }}
          >
            <div className="text-[11px] font-mono uppercase tracking-[0.2em] mb-3" style={{ color: 'hsl(var(--volt-deep))' }}>
              {T('No-custodia · prueba antes de la letra', 'Non-custodial · proof before letters', lang)}
            </div>
            <h2
              className="font-bold text-balance"
              style={{ color: '#141210', fontSize: 'clamp(2rem, 3.4vw, 3.4rem)', letterSpacing: '-0.035em', lineHeight: 1.03 }}
            >
              {T('Astryum graba. La entidad firma.', 'Astryum engraves. The entity signs.', lang)}
            </h2>
            {/* AQUÍ NO SE ESCRIBE NINGUNA FIRMA. En Personal, bajo este titular,
                una mano escribe «Astryum» en cuatro movimientos. Aquí el hueco
                es el argumento: la línea de firma está en el margen del pliego,
                y está vacía. */}
            <p className="mt-5 max-w-xl mx-auto lg:mx-0" style={{ color: 'rgba(20,18,14,0.62)', fontSize: 'clamp(14px, 1.05vw, 17px)' }}>
              {T(
                'La plancha, el registro y el margen quedan sobre la mesa, enteros y a la vista. El margen se queda vacío: esa línea no es de Astryum.',
                'The plate, the register and the margin are left on the table, whole and in plain sight. The margin stays empty: that line is not Astryum’s to sign.',
                lang,
              )}
            </p>

            <motion.div className="mt-8" style={still ? undefined : { opacity: margin }}>
              <ProofTerms lang={lang} />
              <div className="mt-7 flex justify-center lg:justify-start items-center gap-6 flex-wrap">
                {cta}
                <a
                  href="/proof"
                  className="inline-block py-2 -my-2 text-[13px] font-semibold underline underline-offset-4 decoration-1 hover:opacity-80"
                  style={{ color: 'hsl(var(--volt-deep))' }}
                >
                  {T('No nos creas: mira la prueba', 'Don’t take our word for it — see the proof', lang)}
                </a>
              </div>
            </motion.div>
          </motion.div>

          {/* LA ESTAMPA. `min-h-0` para que la rejilla la pueda encoger: sin él
              un SVG con alto intrínseco empuja al resto fuera de la ventana. */}
          <motion.div
            className="relative min-w-0 min-h-0 h-full flex items-center justify-center"
            style={still ? undefined : { opacity: copyOpacity }}
            aria-hidden
          >
            <PressTable printW={printW} castK={castK} specX={specX} laid={laid} glint={glint} margin={margin} still={still} lang={lang} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LA MESA — plancha, pliego, lápiz y regla, con una sola luz
   ══════════════════════════════════════════════════════════════════════ */

function PressTable({
  printW,
  castK,
  specX,
  laid,
  glint,
  margin,
  still,
  lang,
}: {
  printW: MotionValue<number>;
  margin: MotionValue<number>;
  castK: MotionValue<number>;
  specX: MotionValue<number>;
  laid: MotionValue<number>;
  glint: MotionValue<number>;
  still: boolean;
  lang: Lang;
}) {
  // La sombra proyectada de un objeto plano es su silueta desplazada sobre
  // −LIGHT. Lo que cambia con la mañana no es la dirección, es la LONGITUD: el
  // pliego es papel y casi no levanta, la plancha tiene canto, y el lápiz es
  // redondo y está apoyado — por eso es el que tiene la sombra más larga y el
  // que le da altura a la mesa. Escritas una a una y no con una fábrica: un
  // `useTransform` dentro de un helper es un hook dentro de una función.
  const sheetX = useTransform(castK, (k) => -LIGHT.x * 7 * k);
  const sheetY = useTransform(castK, (k) => -LIGHT.y * 7 * k);
  const plateX = useTransform(castK, (k) => -LIGHT.x * 19 * k);
  const plateY = useTransform(castK, (k) => -LIGHT.y * 19 * k);
  const pencilX = useTransform(castK, (k) => -LIGHT.x * 27 * k);
  const pencilY = useTransform(castK, (k) => -LIGHT.y * 27 * k);
  /** El ancho de la barrida, en unidades del lienzo. Se calcula AQUÍ y no
   *  dentro del JSX: un `useTransform` en una prop es un hook en una rama. */
  const printPx = useTransform(printW, (v) => (PRINT.w + 120) * v);

  const groove = (d: string, sw: number, key: string) => (
    <g key={key}>
      <path
        d={d}
        stroke="rgba(22,13,3,0.72)"
        strokeWidth={sw}
        fill="none"
        strokeLinejoin="round"
        transform={`translate(${(LIGHT.x * 0.6).toFixed(2)} ${(LIGHT.y * 0.6).toFixed(2)})`}
      />
      <path
        d={d}
        stroke="rgba(255,240,205,0.5)"
        strokeWidth={INK.pelo}
        fill="none"
        strokeLinejoin="round"
        transform={`translate(${(-LIGHT.x * 0.6).toFixed(2)} ${(-LIGHT.y * 0.6).toFixed(2)})`}
      />
    </g>
  );

  return (
    <svg className="w-full h-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" fill="none">
      <defs>
        <linearGradient id="ib-cu" x1="0" y1="1" x2={LIGHT.x.toFixed(3)} y2={(1 + LIGHT.y).toFixed(3)}>
          <stop offset="0%" stopColor="#8A5A2B" />
          <stop offset="46%" stopColor="#B8813F" />
          <stop offset="100%" stopColor="#D7A45E" />
        </linearGradient>
        {/* el cobre no es un color, es una superficie: un segundo lavado a
            contraluz y un velo de pulido en la esquina que recibe el rasante */}
        <linearGradient id="ib-cu2" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE0AE" stopOpacity="0.30" />
          <stop offset="38%" stopColor="#FFD79C" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#3A2208" stopOpacity="0.20" />
        </linearGradient>
        <linearGradient id="ib-paper" x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#F7EDD5" />
          <stop offset="100%" stopColor="#E7D9B6" />
        </linearGradient>
        {/* LA VERJURA Y LOS PUNTIZONES del molde. Donde estuvo el alambre el
            papel es más FINO, así que la línea sale más CLARA que el fondo, no
            más oscura. Es el detalle que separa una observación de una trama. */}
        <pattern id="ib-laid" width="22" height="1.7" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0.4" x2="22" y2="0.4" stroke="#FFFBEF" strokeWidth="0.6" />
          <line x1="0.5" y1="0" x2="0.5" y2="1.7" stroke="#FFFBEF" strokeWidth="1" />
        </pattern>
        {/* LA BARRIDA DE IMPRESIÓN. Un pliego sale de la prensa pasando bajo
            el rodillo, así que la tinta aparece de izquierda a derecha y no de
            golpe. Es UNA sola caja animada, no sesenta trazos con su dash: el
            coste es el mismo que no animar nada. */}
        <mask id="ib-print" maskUnits="userSpaceOnUse" x={PRINT.x - 60} y={PRINT.y - 60} width={PRINT.w + 120} height={PRINT.h + 120}>
          <motion.rect
            x={PRINT.x - 60}
            y={PRINT.y - 60}
            height={PRINT.h + 120}
            fill="#fff"
            style={still ? { width: PRINT.w + 120 } : { width: printPx }}
          />
        </mask>
        <clipPath id="ib-sc">
          <rect x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} rx="2" />
        </clipPath>
      </defs>

      {/* ── SOMBRAS PROYECTADAS, todas primero y todas de acuerdo ───────── */}
      <g fill="rgba(46,32,12,0.34)">
        <motion.rect
          x={SHEET.x}
          y={SHEET.y}
          width={SHEET.w}
          height={SHEET.h}
          rx="2"
          style={still ? undefined : { x: sheetX, y: sheetY }}
        />
        <motion.rect
          x="470"
          y="580"
          width="330"
          height="13"
          rx="6.5"
          transform="rotate(-5 470 580)"
          style={still ? undefined : { x: pencilX, y: pencilY }}
        />
      </g>

      {/* ── EL PLIEGO: LA PRUEBA DE ESTADO ───────────────────────────── */}
      <rect x={SHEET.x} y={SHEET.y} width={SHEET.w} height={SHEET.h} rx="2" fill="url(#ib-paper)" />
      <motion.rect
        x={SHEET.x}
        y={SHEET.y}
        width={SHEET.w}
        height={SHEET.h}
        fill="url(#ib-laid)"
        style={still ? { opacity: 0.16 } : { opacity: laid }}
      />
      <g clipPath="url(#ib-sc)">
        {/* LA HUELLA DE PLANCHA — el escalón que la prensa deja embutido en el
            papel. Es EL detalle que dice «esto se imprimió»: dos filetes de un
            píxel, claro por donde le da la luz y oscuro por donde no. */}
        <rect x={PRINT.x - 15} y={PRINT.y - 13} width={PRINT.w + 30} height={PRINT.h + 26} fill="rgba(0,0,0,0.03)" />
        <path
          d={`M${PRINT.x - 15} ${PRINT.y + PRINT.h + 13}L${PRINT.x - 15} ${PRINT.y - 13}L${PRINT.x + PRINT.w + 15} ${PRINT.y - 13}`}
          stroke="rgba(255,252,240,0.95)"
          strokeWidth="1.2"
        />
        <path
          d={`M${PRINT.x - 15} ${PRINT.y + PRINT.h + 13}L${PRINT.x + PRINT.w + 15} ${PRINT.y + PRINT.h + 13}L${PRINT.x + PRINT.w + 15} ${PRINT.y - 13}`}
          stroke="rgba(70,52,22,0.26)"
          strokeWidth="1.2"
        />
        {/* EL PASE ESPECULAR de la huella, UNA vez. Un relieve solo se lee por
            luz, y un canto embutido devuelve un destello cuando la luz le llega
            de refilón — una vez, no en bucle. Es lo único de la mesa que sigue
            al puntero, porque el difuso no depende de dónde estés y el
            especular sí. */}
        <motion.path
          d={`M${PRINT.x - 15} ${PRINT.y - 13}L${PRINT.x + PRINT.w + 15} ${PRINT.y - 13}`}
          stroke="#FFF6DD"
          strokeWidth="2.4"
          style={still ? { opacity: 0.4 } : { opacity: glint, x: specX }}
        />
        {/* la orla de seguridad, en el canto y muy floja */}
        <g
          fill="none"
          stroke="rgba(56,40,16,0.085)"
          strokeWidth="0.4"
          transform={`translate(${PRINT.x + PRINT.w - 6} ${PRINT.y + PRINT.h + 2}) scale(0.5)`}
        >
          {ROSETTE.map((e) => (
            <ellipse key={e.rot} rx={e.rx.toFixed(1)} ry={e.ry.toFixed(1)} transform={`rotate(${e.rot})`} />
          ))}
        </g>
        {/* EL VALLE IMPRESO, DEL DERECHO, y detrás de la barrida: la tinta
            aparece de izquierda a derecha, como sale un pliego de la prensa.
            Este es el gesto del cierre y es literalmente lo que dice el
            titular — Astryum graba. */}
        <g mask="url(#ib-print)">
          <g stroke="rgba(28,17,5,0.5)" strokeWidth={INK.tramado * 2.8} fill="none">
            {HATCH_PRINT.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
          <path d={PRINTED_D} stroke="rgba(28,17,5,0.82)" strokeWidth={INK.trazo * 1.7} fill="none" strokeLinejoin="round" />
          {/* la lámina de agua: ata el grabado con la tercera parada */}
          <path
            d={`M${PRINT.x + 6} ${(PRINT.y + PRINT.h * 0.74).toFixed(1)}H${PRINT.x + PRINT.w - 6}`}
            stroke="rgba(28,17,5,0.6)"
            strokeWidth={INK.trazo * 1.3}
            fill="none"
          />
        </g>
        {[
          [PRINT.x - 28, PRINT.y - 24],
          [PRINT.x + PRINT.w + 28, PRINT.y + PRINT.h + 24],
        ].map(([cx, cy]) => (
          <g key={cx} stroke="rgba(56,40,16,0.45)" strokeWidth="0.9" fill="none">
            <path d={`M${cx - 9} ${cy}h18M${cx} ${cy - 9}v18`} />
            <circle cx={cx} cy={cy} r="5" />
          </g>
        ))}
      </g>

      {/* ── EL MARGEN: aquí vive el argumento, y se escribe DESPUÉS ─────
          Primero la estampa, y solo entonces lo que le falta. Invertido —el
          margen antes que el grabado— la línea vacía no significaría nada
          todavía: no hay nada que firmar hasta que hay estampa. */}
      <motion.g style={still ? undefined : { opacity: margin }}>
      {/* A la izquierda, a lápiz, el término del oficio. «Prueba antes de la
          letra» (avant la lettre) es la estampa tirada ANTES de grabar los
          rótulos: dicho de otro modo, aquí todavía no hay ni una palabra que
          pueda ser una promesa. Quien lo conoce lo reconoce; quien no, lee una
          anotación de taller. */}
      <text
        x={PRINT.x}
        y={PRINT.y + PRINT.h + 66}
        fill="rgba(60,44,18,0.55)"
        fontSize="19"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        letterSpacing="1.6"
      >
        {T('Estado I · prueba antes de la letra', 'State I · proof before letters', lang)}
      </text>
      {/* A la derecha, LA LÍNEA DE FIRMA VACÍA, y no se dibuja nada encima ni
          ahora ni nunca. El artefacto está incompleto a propósito y lo único
          capaz de completarlo es la entidad. El lápiz está al lado y SIN TOCAR:
          en la primera versión caía justo encima de esta línea, que es tanto
          como tachar la tesis. */}
      <line
        x1={PRINT.x + PRINT.w - 300}
        y1={PRINT.y + PRINT.h + 52}
        x2={PRINT.x + PRINT.w + 10}
        y2={PRINT.y + PRINT.h + 52}
        stroke="rgba(60,44,18,0.42)"
        strokeWidth="1.6"
      />
      <text
        x={PRINT.x + PRINT.w - 300}
        y={PRINT.y + PRINT.h + 78}
        fill="rgba(60,44,18,0.45)"
        fontSize="16"
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        letterSpacing="1.4"
      >
        {T('Firma de la entidad', 'Signature of the entity', lang)}
      </text>
      {INKSTEPS.map((v, i) => (
        <rect
          key={v}
          x={PRINT.x + i * 23}
          y={PRINT.y + PRINT.h + 96}
          width="18"
          height="18"
          fill="rgba(34,22,6,1)"
          fillOpacity={0.08 + v * 0.62}
        />
      ))}

      </motion.g>

      {/* ── EL LÁPIZ, sin tocar, al lado de la línea vacía ────────────── */}
      <g transform="rotate(-5 470 566)">
        <rect x="470" y="560" width="330" height="13" rx="1" fill="#B9913F" />
        <rect x="470" y="560" width="330" height="4.4" fill="#D9B665" />
        <rect x="470" y="569" width="330" height="4" fill="#8E6B27" />
        <path d="M800 560l30 6.5-30 6.5z" fill="#E3D3B0" />
        <path d="M823 565l7 1.5-7 1.5z" fill="#2A241C" />
      </g>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LOS TÉRMINOS — lo que el billete de avión imprimía, sin el billete
   ══════════════════════════════════════════════════════════════════════ */

/**
 * La tarjeta de embarque prometía un VIAJE: origen tu wallet, destino Flare
 * mainnet, y una mota recorriendo una órbita de transferencia. Eso pertenece a
 * Personal por derecho —Personal literalmente ES un recorrido— y no tiene
 * traducción institucional honesta: una entidad no viaja a ningún sitio.
 *
 * Lo que SÍ había que conservar son los tres campos, porque son invariantes
 * escritos y no adorno. Van impresos en el margen del pliego, en tinta sobre
 * papel, sin marco y sin cristal ahumado: una lámina más habría sido la cuarta
 * viñeta del tour, y esto no es una viñeta, es el pie de una estampa.
 */
function ProofTerms({ lang }: { lang: Lang }) {
  const fields = [
    { k: T('Custodia', 'Custody', lang), v: T('de la entidad', 'the entity’s', lang) },
    { k: T('Comisiones', 'Fees', lang), v: T('visibles antes', 'shown first', lang) },
    { k: T('Simulación', 'Simulation', lang), v: T('siempre previa', 'always first', lang) },
  ];
  return (
    <div className="mx-auto max-w-[620px] grid grid-cols-3 gap-3 pt-5" style={{ borderTop: '1px solid rgba(70,52,22,0.28)' }}>
      {fields.map((f) => (
        <div key={f.k} className="min-w-0 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] truncate" style={{ color: 'rgba(60,44,18,0.6)' }}>
            {f.k}
          </div>
          <div className="mt-1 text-[13px] font-semibold" style={{ color: '#2A2118' }}>
            {f.v}
          </div>
        </div>
      ))}
    </div>
  );
}

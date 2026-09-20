'use client';

/**
 * EL CIERRE DEL MUNDO LEGACY — LA CARTELA DEL PUENTE.
 *
 * ── POR QUÉ EXISTE ESTE FICHERO ──────────────────────────────────────────
 * Hasta hoy Personal y Legacy cerraban con la misma sección, `SignatureBreak`:
 * una ESTRELLA DORADA se acerca en la noche, fulgura, inunda la página de luz
 * crema, y sobre el crema hay una firma cursiva y una tarjeta de embarque.
 */

import { useRef, type ReactNode } from 'react';
import { motion, useMotionTemplate, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { LIGHT, mulberry32 } from './art/craft';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

/* ═══════════════════════════════════════════════════════════════════════
   GEOMETRÍA — toda a nivel de módulo y toda con semilla. Ni un `Math.random`
   ni un `Date.now`: lo que pinta el servidor y lo que rehidrata el cliente
   tienen que ser el mismo dibujo, byte a byte.
   ══════════════════════════════════════════════════════════════════════ */

/** El lienzo del muro, en unidades de diseño. Va en el FLUJO de la página, así
 *  que cada unidad de alto alarga la sección: 560 y no 900, porque la losa y el
 *  botón tienen que caber en el mismo visor o la luz llega cuando el botón ya
 *  pasó (la lección que pagó el cierre del institucional). */
const W = 1440;
const H = 500;

/** La albardilla: la losa de coronación del pretil, arriba del todo. */
const COPE_Y = 54;
const COPE_H = 30;

/**
 * LAS HILADAS DEL PRETIL. Juntas verticales TRABADAS hilada a hilada: si se
 * alinean no es sillería, es una cuadrícula, y una cuadrícula se lee como
 * textura de relleno. Es la misma fábrica del puente, de cerca.
 */
const COURSE_H = 92;
const ASHLAR: { d: string; lit: number }[] = (() => {
  const rnd = mulberry32(0x9e21b4);
  const out: { d: string; lit: number }[] = [];
  let c = 0;
  for (let y = COPE_Y + COPE_H; y < H + COURSE_H; y += COURSE_H, c++) {
    let x = -140 + (c % 2 === 0 ? 0 : 118);
    while (x < W + 140) {
      const w = 186 + rnd() * 84;
      out.push({
        // El sillar es un trapecio de un pelo: dos verticales exactamente
        // paralelas son un ladrillo de dibujo animado.
        d: `M${x.toFixed(1)} ${y}L${(x + w).toFixed(1)} ${y}L${(x + w - 1.4).toFixed(1)} ${y + COURSE_H}L${(x + 1.1).toFixed(1)} ${y + COURSE_H}Z`,
        lit: 0.42 + 0.2 * rnd(),
      });
      x += w;
    }
  }
  return out;
})();

/** Las juntas de la albardilla: losas, no una cinta corrida. */
const COPE_JOINTS: number[] = (() => {
  const rnd = mulberry32(0x3417dd);
  const out: number[] = [];
  for (let x = -90; x < W + 120; x += 168 + rnd() * 62) out.push(Math.round(x));
  return out;
})();

/**
 * EL PUNTEADO DE CANTERO. Un sillar labrado a puntero no es una superficie
 * lisa: lleva miles de golpes de punta. Doscientos puntos sembrados, de radio
 * variable y sin ninguno junto a los cantos, es lo que separa «piedra» de
 * «rectángulo relleno», y cuesta un `<circle>` cada uno.
 */
const BUSH: { x: number; y: number; r: number }[] = (() => {
  const rnd = mulberry32(0x5f80c2);
  return Array.from({ length: 220 }, () => ({
    x: rnd() * (W + 160) - 80,
    y: COPE_Y + COPE_H + rnd() * (H - COPE_Y - COPE_H + 60),
    r: 0.9 + rnd() * 1.7,
  }));
})();

/**
 * EL BARRIDO DE LA MAÑANA.
 *
 * Un frente de sombra que cubre el cuadro entero y se retira sobre el eje de
 * `LIGHT`. No es un objeto con silueta: es un DEGRADADO cuya rampa mide más que
 * el muro, así que el lector nunca ve un borde de sombra — ve piedra que se va
 * encendiendo por arriba a la derecha, que es lo que hace una mañana contra un
 * paramento.
 *
 * El eje se ancla en el centro del muro y la rampa se mide desde ahí: media
 * rampa hacia el sol (transparente) y media hacia la sombra (tinta).
 */
const RAKE_C = { x: W / 2, y: H / 2 } as const;
/** La MITAD de la rampa, en unidades del lienzo. El muro proyectado sobre el
 *  eje de la luz mide ±664 (±800 en x y ±250 en y, por los cosenos de LIGHT),
 *  así que con 900 la rampa entera —1800— es más larga que el muro y no cabe un
 *  canto dentro del cuadro ni en el peor fotograma. */
const RAKE_R = 900;
/** El paño del frente. Tiene que seguir cubriendo el cuadro con el viaje
 *  aplicado en los dos sentidos: ±TRAVEL sobre LIGHT son ±(918, −1310). */
const RAKE_D = 'M-3000 -3000H4500V3500H-3000Z';

/** El viaje del frente, a lo largo del vector de luz.
 *
 *  1600 no está a ojo: es el mínimo que deja el muro ENTERO en sombra con el
 *  dial a cero y ENTERO al sol con el dial a uno. La cuenta, con `s` el
 *  parámetro del degradado y `u` la proyección del punto sobre el eje:
 *  `s = (T + RAKE_R − u) / (2·RAKE_R)` con `T = TRAVEL·(1 − 2·sol)`. Para que
 *  `s ≥ 1` en todo el muro hace falta `TRAVEL ≥ RAKE_R + u_max = 900 + 664`. */
const TRAVEL = 1600;

/** La misma sombra, quieta, para movimiento reducido. */
const STILL_PLAQUE_SHADOW = `inset 5px -7px 12px hsl(var(--volt-deep) / 0.34), inset -5px 7px 12px hsl(var(--volt-hi) / 0.8), ${(-LIGHT.x * 11).toFixed(1)}px ${(-LIGHT.y * 11).toFixed(1)}px 16px hsl(var(--volt-deep) / 0.3)`;

export default function LegacyBreak({ lang, cta }: { lang: Lang; cta: ReactNode }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });

  // EL MUELLE SE QUEDA, con sus mismos números. El fundador ya pagó una vez «si
  // se hace scroll muy rápido parece un flashbang», y la cura no fue educar al
  // visitante: fue limitar la velocidad por física. Un cambio de arte no puede
  // reabrir eso.
  const eased = useSpring(scrollYProgress, { stiffness: 42, damping: 26, mass: 0.8 });

  // UN SOLO DIAL, con su MESETA dentro.
  //   0.05→0.22  el frente se retira hasta dejar la esquina alta al sol, con la
  //              cartela todavía a oscuras
  //   0.22→0.34  la meseta: no avanza la luz, se enciende UNA cosa —el filo de
  //              la albardilla, la única arista pulida vuelta al cielo— y el
  //              muro se lee rasante, con la piedra ya modelada y el texto no
  //   0.34→0.50  el frente cruza la losa: la inscripción nace mientras la luz
  //              la alcanza, que es la razón de ser de la escena
  //   0.50→0.94  la noche vuelve por donde se fue, sobre el mismo dial
  // La meseta es ancha a propósito: la losa y el botón están a cuatrocientos
  // píxeles el uno del otro dentro de la sección y no pueden compartir un único
  // instante de luz.
  const sun = useTransform(eased, [0.05, 0.22, 0.34, 0.5, 0.82, 0.96], [0, 0.32, 0.32, 1, 1, 0], { clamp: true });

  const shX = useTransform(sun, [0, 1], [LIGHT.x * TRAVEL, -LIGHT.x * TRAVEL]);
  const shY = useTransform(sun, [0, 1], [LIGHT.y * TRAVEL, -LIGHT.y * TRAVEL]);

  // EL FILO DE LA ALBARDILLA. Es la única arista de todo el muro pulida y vuelta
  // al cielo, o sea lo primero que puede devolver una luz rasante. Un especular
  // no espera a que la superficie esté iluminada de forma difusa: por eso se lee
  // como un destello y no como una fuga de la máscara. Es el fotograma en que la
  // página dice «hay piedra ahí» antes de enseñar nada.
  const glint = useTransform(sun, [0.16, 0.3, 0.5, 0.72], [0, 1, 1, 0.4], { clamp: true });

  // LA INCISIÓN. Una letra incisa se lee por sus DOS caras: la pared del surco
  // que mira a la luz queda en sombra y la de enfrente, iluminada. Las dos nacen
  // con la luz y desaparecen con ella, porque sin luz rasante una inscripción
  // labrada es una piedra lisa. Eso no es un efecto: es la razón de ser de la
  // escena.
  const cut = useTransform(sun, [0.34, 0.62], [0, 1], { clamp: true });
  const cutDark = useTransform(cut, [0, 1], [0, 0.62]);
  const cutLight = useTransform(cut, [0, 1], [0, 0.85]);
  const carve = useMotionTemplate`${LIGHT.x * 1.9}px ${LIGHT.y * 1.9}px 0 hsl(var(--volt-deep) / ${cutDark}), ${-LIGHT.x * 1.9}px ${-LIGHT.y * 1.9}px 0 hsl(var(--volt-hi) / ${cutLight})`;

  // Las sombras arrojadas se acortan a la vez, sobre el eje que dicta LIGHT.
  // Cuatro sombras de acuerdo son lo que hace que una escena parezca cara; una
  // sola bastaría para que pareciera barata.
  const castK = useTransform(sun, [0.32, 1], [2.1, 1], { clamp: true });
  const castX = useTransform(castK, (k) => -LIGHT.x * 11 * k);
  const castY = useTransform(castK, (k) => -LIGHT.y * 11 * k);

  // El texto en tinta espera a que la luz lo alcance: tinta oscura NUNCA sobre
  // oscuro.
  // LA SOMBRA ARROJADA DE LA LOSA, sobre el eje de LIGHT y acortándose con la
  // mañana. Es una sola propiedad de un solo elemento: mover cuatro sombras a la
  // vez sería caro, y con una que esté de acuerdo con la luz basta para que la
  // losa se apoye en el muro en vez de estar pegada encima.
  const plaqueShadow = useMotionTemplate`inset 5px -7px 12px hsl(var(--volt-deep) / 0.34), inset -5px 7px 12px hsl(var(--volt-hi) / 0.8), ${castX}px ${castY}px 16px hsl(var(--volt-deep) / 0.3)`;
  /** El amanecer de la PÁGINA, un pelo por delante de la escena para que el
   *  muro no aparezca recortado sobre la noche. */
  const dayIn = useTransform(sun, [0, 0.26], [0, 1], { clamp: true });
  const copyOpacity = useTransform(sun, [0.52, 0.8], [0, 1], { clamp: true });
  const copyY = useTransform(sun, [0.52, 0.8], [26, 0]);

  const still = reduce || level === 'minimal';

  return (
    <section ref={ref} id="light-beat" className="relative">
      {/* ── EL DÍA, EN ÍNDIGO ───────────────────────────────────────────
      { *
          Tiene razón. La rampa crema de `SignatureBreak` es el día de Personal
          —un mundo dorado— y el institucional la heredó porque su bronce vive
          en la misma familia cálida. Índigo sobre crema no: el lector acaba de
          pasar seis paradas en azul y la página remataba en beige. */}
      {/* EL DÍA LLEGA CON LA LUZ, no antes. Pintado a plena opacidad el crema
          cubría los últimos treinta y cinco por ciento del recorrido y se comía
          la mitad de abajo del puente en el fotograma en que el lector todavía
          lo está mirando de noche —medido en captura a 0,97—. Aquí sube con el
          MISMO dial que retira la sombra, así que la página amanece cuando
          amanece la escena. */}
      <motion.div
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        style={{
          opacity: still ? 1 : dayIn,
          top: '-34svh',
          backgroundColor: 'hsl(var(--volt-hi))',
          backgroundImage:
            'radial-gradient(150vw 170svh at calc(100% + 6vw) -14%, hsl(var(--volt-hi)) 0%, hsl(var(--volt-soft) / 0.34) 36%, hsl(var(--volt) / 0.5) 68%, hsl(var(--volt-deep) / 0.42) 100%)',
          // El plumeado de los cantos de la caja es la red de seguridad: la
          // frontera de verdad es la sombra del arco, pero una caja que termina
          // en un corte sigue siendo una caja que termina en un corte. Es una
          // máscara ESTÁTICA: no se recompone por fotograma.
          WebkitMaskImage: 'linear-gradient(180deg, transparent 0px, #000 150px, #000 calc(100% - 150px), transparent 100%)',
          maskImage: 'linear-gradient(180deg, transparent 0px, #000 150px, #000 calc(100% - 150px), transparent 100%)',
        }}
        aria-hidden
      />

      {/* ── EL MURO ─────────────────────────────────────────────────────── */}
      <div className="relative" style={{ height: 'min(54svh, 500px)' }}>
        {/* El muro se DISUELVE por arriba y por abajo. Una fábrica que termina
            en una recta horizontal es una caja que termina en un corte, que es
            justo la lectura que este cierre tiene que evitar. La máscara es
            ESTÁTICA: no se recompone por fotograma. */}
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid slice"
          fill="none"
          style={{
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0px, #000 78px, #000 calc(100% - 96px), transparent 100%)',
            maskImage: 'linear-gradient(180deg, transparent 0px, #000 78px, #000 calc(100% - 96px), transparent 100%)',
          }}
        >
          <defs>
            {/* La cara del sillar: canto alto iluminado y masa abajo. Un plano
                de un solo valor no existe en ninguna piedra. */}
            {/* La piedra tiene que ser PIEDRA, no la misma crema de la página:
                medido en captura, con el paramento al tono del fondo el muro
                desaparecía y la cartela flotaba sola. Un doce por ciento más
                oscuro basta para que se lea como un objeto y no como el papel. */}
            {/* La piedra se construye con la familia índigo en ALFA sobre
                `--volt-hi`, no con tonos inventados: así el material sigue el
                tema y no hay ni un color fuera de los tokens de la casa. */}
            <linearGradient id="lb-face" gradientUnits="userSpaceOnUse" x1="0" y1={COPE_Y} x2="0" y2={H}>
              <stop offset="0%" stopColor="hsl(var(--volt) / 0.34)" />
              <stop offset="42%" stopColor="hsl(var(--volt) / 0.82)" />
              <stop offset="74%" stopColor="hsl(var(--volt-deep) / 0.26)" />
              <stop offset="100%" stopColor="hsl(var(--volt-deep) / 0.44)" />
            </linearGradient>
            <linearGradient id="lb-cope" gradientUnits="userSpaceOnUse" x1="0" y1={COPE_Y} x2="0" y2={COPE_Y + COPE_H}>
              <stop offset="0%" stopColor="hsl(var(--volt) / 0.04)" />
              <stop offset="100%" stopColor="hsl(var(--volt) / 0.5)" />
            </linearGradient>
          </defs>

          {/* el paramento */}
          <rect x="-80" y={COPE_Y + COPE_H} width={W + 160} height={H} fill="hsl(var(--volt-hi))" />
          <rect x="-80" y={COPE_Y + COPE_H} width={W + 160} height={H} fill="url(#lb-face)" />
          {/* el ALZADO empieza en la albardilla: por encima no hay muro, hay
              mañana, y de eso se encarga la máscara del contenedor */}
          {ASHLAR.map((b) => (
            <g key={b.d}>
              <path d={b.d} fill="hsl(var(--volt-hi))" fillOpacity={b.lit * 0.16} />
              <path d={b.d} fill="none" stroke="hsl(var(--volt-deep) / 0.45)" strokeWidth="1.1" />
              {/* el lecho superior recibe la luz rasante: es la arista que hace
                  que una hilada sea una hilada */}
              <path
                d={b.d.slice(0, b.d.indexOf('L', b.d.indexOf('L') + 1))}
                fill="none"
                stroke="hsl(var(--volt-hi) / 0.85)"
                strokeWidth="0.9"
              />
            </g>
          ))}
          {/* el punteado de cantero */}
          <g fill="hsl(var(--volt-deep) / 0.2)">
            {BUSH.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={p.r} />
            ))}
          </g>

          {/* la sombra arrojada de la albardilla sobre el paramento: se acorta
              cuando sube la mañana */}
          <motion.rect
            x="-80"
            y={COPE_Y + COPE_H}
            width={W + 160}
            height={18}
            fill="hsl(var(--volt-deep) / 0.26)"
            style={still ? undefined : { scaleY: castK, y: castY }}
          />

          {/* la albardilla */}
          <rect x="-80" y={COPE_Y} width={W + 160} height={COPE_H} fill="hsl(var(--volt-hi))" />
          <rect x="-80" y={COPE_Y} width={W + 160} height={COPE_H} fill="url(#lb-cope)" />
          <rect x="-80" y={COPE_Y} width={W + 160} height={COPE_H} fill="none" stroke="hsl(var(--volt-deep) / 0.48)" strokeWidth="1.1" />
          {COPE_JOINTS.map((x) => (
            <line key={x} x1={x} y1={COPE_Y} x2={x - 2} y2={COPE_Y + COPE_H} stroke="hsl(var(--volt-deep) / 0.42)" strokeWidth="1.1" />
          ))}
          {/* EL FILO: la arista pulida que mira al cielo */}
          <motion.line
            x1="-80"
            y1={COPE_Y + 1}
            x2={W + 80}
            y2={COPE_Y + 1}
            stroke="hsl(var(--volt-hi))"
            strokeWidth="2.2"
            style={still ? { opacity: 0.9 } : { opacity: glint }}
          />
        </svg>

        {/* ── LA CARTELA ────────────────────────────────────────────────
            En HTML y no en el SVG: el texto de una página pública tiene que
            poder seleccionarse, traducirse y leerse con un lector de pantalla.
            La losa está HUNDIDA en el paramento, y eso se dice con dos sombras
            interiores opuestas sobre el eje de la luz: la pared del rebaje que
            mira a la luz queda en sombra y la de enfrente, iluminada. Es la
            misma regla que labra las letras, una escala más arriba. */}
        <div className="absolute inset-0 grid place-items-center px-6">
          <motion.div
            className="relative w-full max-w-[660px]"
            style={{
              backgroundColor: 'hsl(var(--volt-hi))',
              backgroundImage: 'linear-gradient(168deg, hsl(var(--volt) / 0) 0%, hsl(var(--volt) / 0.15) 52%, hsl(var(--volt) / 0.3) 100%)',
              boxShadow: still ? STILL_PLAQUE_SHADOW : plaqueShadow,
              borderRadius: 3,
            }}
          >
            {/* EL FILO LABRADO: el retranqueo de la cara respecto al canto, el
                mismo detalle que llevan las dovelas del recorrido. Es, con
                diferencia, lo que separa «piedra cortada» de «rectángulo». */}
            <span
              className="absolute pointer-events-none"
              aria-hidden
              style={{
                inset: 13,
                borderRadius: 2,
                boxShadow: 'inset 2px -2px 3px hsl(var(--volt-deep) / 0.3), inset -2px 2px 3px hsl(var(--volt-hi) / 0.7)',
              }}
            />
            <div className="relative px-8 pt-7 pb-6 sm:px-12 sm:pt-9 sm:pb-7">
              <div>
                <Carved carve={carve} still={still} className="text-center text-[13px] sm:text-[15px] font-mono uppercase tracking-[0.3em]">
                  {T('Lo escrito sostiene', 'What is written holds', lang)}
                </Carved>
                <Rule />
                <dl className="m-0">
                  {TERMS.map((t) => (
                    <Term key={t.en[0]} k={T(t.es[0], t.en[0], lang)} v={T(t.es[1], t.en[1], lang)} carve={carve} still={still} />
                  ))}
                  {/* LA LÍNEA VACÍA. Va labrada, con su guía, y sin nada
                      después. La ausencia es el argumento. */}
                  <Term k="Astryum" v="" carve={carve} still={still} />
                </dl>
                <Rule />
              </div>
            </div>
          </motion.div>
        </div>

        {/* ── EL FRENTE DE SOMBRA, POR ENCIMA DE TODO ────────────────────
            Un paño que cubre el cuadro, pintado con una rampa larguísima sobre
            el eje de `LIGHT` y desplazado por el dial. Lo que cruza la losa es
            el LÍMITE DIFUSO entre lo que ya tiene sol y lo que todavía no, y es
            difuso a propósito: una mancha con canto se lee como un objeto, una
            con rampa se lee como luz. Ver el encabezado del fichero, «dos
            ejecuciones descartadas». */}
        {!still && (
          <svg
            aria-hidden
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="xMidYMid slice"
            fill="none"
            style={{
              mixBlendMode: 'multiply',
              WebkitMaskImage: 'linear-gradient(180deg, transparent 0px, #000 78px, #000 calc(100% - 96px), transparent 100%)',
              maskImage: 'linear-gradient(180deg, transparent 0px, #000 78px, #000 calc(100% - 96px), transparent 100%)',
            }}
          >
            <defs>
              {/* La rampa. Arranca en NADA y no en un tres por ciento: el primer
                  tramo tiene que ser aire para que la zona al sol sea piedra sin
                  velo encima. La tinta sube por una curva y no por una recta —
                  la sombra de un muro no se atenúa linealmente— y cambia de
                  token al final: `--volt` en la penumbra y `--volt-deep` en la
                  sombra cerrada. */}
              <linearGradient
                id="lb-rake"
                gradientUnits="userSpaceOnUse"
                x1={RAKE_C.x + LIGHT.x * RAKE_R}
                y1={RAKE_C.y + LIGHT.y * RAKE_R}
                x2={RAKE_C.x - LIGHT.x * RAKE_R}
                y2={RAKE_C.y - LIGHT.y * RAKE_R}
              >
                <stop offset="0%" stopColor="hsl(var(--volt))" stopOpacity="0" />
                <stop offset="26%" stopColor="hsl(var(--volt))" stopOpacity="0.05" />
                <stop offset="52%" stopColor="hsl(var(--volt))" stopOpacity="0.24" />
                <stop offset="76%" stopColor="hsl(var(--volt-deep))" stopOpacity="0.5" />
                <stop offset="100%" stopColor="hsl(var(--volt-deep))" stopOpacity="0.72" />
              </linearGradient>
            </defs>
            {/* Un `path` y no un `rect`: en un `rect`, `x`/`y` son atributos Y
                son el nombre que framer da a la traslación, y esa ambigüedad no
                se resuelve leyendo el código. */}
            <motion.path d={RAKE_D} fill="url(#lb-rake)" style={{ x: shX, y: shY }} />
          </svg>
        )}
      </div>

      {/* ── LA FRASE Y LA PUERTA ────────────────────────────────────────── */}
      <motion.div
        className="relative px-6 pt-10 sm:pt-14 text-center"
        style={still ? undefined : { opacity: copyOpacity, y: copyY }}
      >
        <p
          className="mx-auto max-w-2xl text-[15px] sm:text-[16px] leading-relaxed"
          style={{ color: 'hsl(var(--volt-deep) / 0.92)' }}
        >
          {T(
            'En la cartela de un puente va el nombre de quien responde por él. Esa línea está labrada y vacía a propósito: Astryum no firma, no custodia y no ejecuta. Lo que sostiene el paso es lo que está escrito encima.',
            'A bridge’s stone carries the name of whoever answers for it. That line is cut and left empty on purpose: Astryum does not sign, does not custody and does not execute. What holds the crossing up is what is written above it.',
            lang,
          )}
        </p>
        <div className="mt-8 flex justify-center">{cta}</div>
        <p className="mt-5 text-[11px] font-mono uppercase tracking-[0.22em]" style={{ color: 'hsl(var(--volt-deep) / 0.5)' }}>
          {es ? 'No custodial · Tú siempre firmas' : 'Non-custodial · You always sign'}
        </p>
      </motion.div>

      {/* La cola: la sección tiene que poder RECOGER la luz antes de que llegue
          el pie de página, igual que la recoge el mundo solar. */}
      {!still && <div className="h-[22svh]" aria-hidden />}
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LAS PIEZAS DE LA INSCRIPCIÓN
   ══════════════════════════════════════════════════════════════════════ */

/**
 * LOS TÉRMINOS. Son MECANISMO —quién firma, cuántos, con qué peso, qué no
 * existe y qué no se puede cerrar—, jamás resultado, y son exactamente los
 * mismos números que el recorrido ha enseñado en la escena y en las láminas. Un
 * número que no cuadra con el dibujo que el lector acaba de ver cuesta más que
 * una línea repetida.
 */
const TERMS = [
  { es: ['Firman', 'Tres de cinco'], en: ['Who signs', 'Three of five'] },
  { es: ['Pesos', 'Iguales'], en: ['Weights', 'Equal'] },
  { es: ['Clave maestra', 'Ninguna'], en: ['Master key', 'None'] },
  { es: ['La salida', 'No la cierra nadie'], en: ['The exit', 'Nobody can close it'] },
] as const;

/** Una letra INCISA: las dos paredes del surco, sobre el eje de la luz. Con el
 *  dial a cero no hay ninguna de las dos, porque una piedra labrada sin luz
 *  rasante es una piedra lisa. */
function Carved({
  carve,
  still,
  className = '',
  children,
}: {
  carve: MotionValue<string>;
  still: boolean;
  className?: string;
  children: ReactNode;
}) {
  const fixed = `${(LIGHT.x * 1.9).toFixed(2)}px ${(LIGHT.y * 1.9).toFixed(2)}px 0 hsl(var(--volt-deep) / 0.62), ${(-LIGHT.x * 1.9).toFixed(2)}px ${(-LIGHT.y * 1.9).toFixed(2)}px 0 hsl(var(--volt-hi) / 0.85)`;
  return (
    <motion.div
      className={className}
      style={{ color: 'hsl(var(--volt-deep) / 0.92)', textShadow: still ? fixed : carve }}
    >
      {children}
    </motion.div>
  );
}

/** El filete grabado que separa el encabezado de los términos: dos líneas, una
 *  en sombra y otra iluminada. Un surco en piedra nunca es una raya sola. */
function Rule() {
  return (
    <div className="my-5 mx-auto w-full max-w-[420px]" aria-hidden>
      <div style={{ height: 1, background: 'hsl(var(--volt-deep) / 0.38)' }} />
      <div style={{ height: 1, background: 'hsl(var(--volt-hi) / 0.85)' }} />
    </div>
  );
}

/** Un término, con su GUÍA DE PUNTOS. La guía no es adorno tipográfico: en una
 *  lápida es lo que ata el rótulo a su valor cuando los dos están en cantos
 *  opuestos, y aquí además es lo que hace que la línea vacía se lea como vacía
 *  y no como olvidada. */
function Term({ k, v, carve, still }: { k: string; v: string; carve: MotionValue<string>; still: boolean }) {
  return (
    <div className="flex items-baseline gap-2 py-[5px]">
      <Carved carve={carve} still={still} className="shrink-0 text-[11px] sm:text-[12px] font-mono uppercase tracking-[0.2em]">
        <dt className="inline">{k}</dt>
      </Carved>
      <span
        className="flex-1 translate-y-[-3px]"
        aria-hidden
        style={{
          height: 4,
          backgroundImage: 'radial-gradient(hsl(var(--volt-deep) / 0.45) 0.9px, transparent 1px)',
          backgroundSize: '7px 4px',
          backgroundPosition: '0 2px',
        }}
      />
      <Carved carve={carve} still={still} className="shrink-0 text-[11px] sm:text-[12px] font-mono uppercase tracking-[0.2em]">
        <dd className="inline m-0">{v || ' '}</dd>
      </Carved>
    </div>
  );
}

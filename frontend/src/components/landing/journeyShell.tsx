'use client';

/**
 * LA CARCASA COMPARTIDA DE LOS VIAJES NUEVOS.
 *
 * Institucional nació con su propia copia de estas piezas y Legacy iba a nacer
 * con otra. Ciento cincuenta líneas duplicadas de temporización de scroll son
 * exactamente el fallo que este repo ya conoce con otro nombre: SolarJourney
 * ata sus tablas de tiempo al array de paradas de Personal, y la narrativa
 * Legacy solo funciona allí porque copia sus tiempos verbatim — el día que
 * alguien toca una, la otra se rompe en silencio.
 */

import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { motion, useMotionValueEvent, useTransform, type MotionValue } from 'framer-motion';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

/** Un progreso que no avanza: la escena quieta no necesita scroll y no puede
 *  crear un motion value nuevo en cada render. */
export const STILL = { get: () => 0, on: () => () => {} } as unknown as MotionValue<number>;

/**
 * Saltar a un punto del recorrido. La cuenta se deriva del ALTO REAL de la
 * pista y del mismo `offset` que usa su `useScroll` (`start start` → `end
 * end`), no de una constante: el día que una pista cambie de alto, los saltos
 * seguirán cayendo donde deben en vez de fallar sin avisar.
 */
export function useJumpTo(trackRef: RefObject<HTMLElement | null>) {
  return useCallback(
    (p: number) => {
      const el = trackRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const span = Math.max(1, el.offsetHeight - window.innerHeight);
      window.scrollTo({ top: top + p * span, behavior: 'smooth' });
    },
    [trackRef],
  );
}

/** Un bloque de texto que entra y sale con su tramo del scroll. */
export function Beat({
  progress,
  range,
  className = '',
  hold = false,
  children,
}: {
  progress: MotionValue<number>;
  range: readonly [number, number] | number[];
  className?: string;
  /** El último bloque se queda: no hay «después» donde apagarlo. Sin esto, a
   *  fondo de recorrido el lector ve la escena terminada y ningún botón. */
  hold?: boolean;
  children: ReactNode;
}) {
  const [a, b] = range as [number, number];
  const span = b - a;
  const opacity = useTransform(
    progress,
    hold ? [a + span * 0.08, a + span * 0.3] : [a + span * 0.08, a + span * 0.26, b - span * 0.18, b - span * 0.02],
    hold ? [0, 1] : [0, 1, 1, 0],
    { clamp: true },
  );
  const y = useTransform(progress, [a, b], hold ? [14, 0] : [14, -14], { clamp: true });
  // DOS capas, por la misma razón que en `Dock`: framer escribe `transform`
  // para su `y` y pisa cualquier `translate` de utilidad. Los dos mundos usan
  // este bloque con `left-1/2 -translate-x-1/2` para su botón de cierre, y
  // medido en captura el botón quedaba descentrado a la derecha EXACTAMENTE
  // media anchura suya — el `-translate-x-1/2` nunca llegaba a aplicarse.
  return (
    <div className={`absolute z-30 max-w-sm pointer-events-none ${className}`}>
      <motion.div style={{ opacity, y }}>{children}</motion.div>
    </div>
  );
}

/**
 * EL CIERRE — la frase que firma el recorrido.
 *
 * El último tiempo de estos mundos era un rótulo en la barra de paradas («LA
 * CASA») y NADA debajo: el nombre recomponiéndose, un botón, y ni una palabra
 * que dijera qué se acaba de ver. Medido: de 0,82 a 1,0 de una pista de 760 svh
 * son ciento treinta y siete svh —casi pantalla y media— sin texto.
 *
 * Va CENTRADO y por encima del nombre a propósito. Las paradas viven en una
 * columna a la izquierda porque a su derecha pasa la escena; aquí la escena ES
 * el nombre, ocupa el centro de canto a canto, y una columna a un lado le
 * caería encima. Arriba y centrado, el cierre se lee como lo que es: la vuelta
 * al sitio donde empezó el recorrido, con la frase que lo resuelve.
 */
export function Finale({
  progress,
  range,
  lang,
  num,
  kicker,
  line,
  sub,
  className = 'inset-x-0 top-[19svh]',
  children,
}: {
  progress: MotionValue<number>;
  range: readonly [number, number] | number[];
  lang: Lang;
  num: string;
  kicker: { es: string; en: string };
  line: { es: string; en: string };
  sub: { es: string; en: string };
  className?: string;
  /**
   * EL PIE DEL CIERRE. El botón de «entrar» colgaba de su propio bloque anclado
   * al borde inferior y ahí abajo, en el centro, ya vive el indicador de scroll
   * de la portada: medido en captura a 0,95, el halo del indicador tocaba el
   * botón. Un cierre es UN bloque —frase, filete, pie y puerta—, no una frase
   * arriba y una puerta suelta en la esquina de otro.
   *
   * Opcional: el institucional no lo pasa y se pinta exactamente igual que antes.
   */
  children?: ReactNode;
}) {
  const [a, b] = range as [number, number];
  const span = b - a;
  // Entra MIENTRAS el nombre se teje, no antes ni después: se lee la frase y se
  // ve el nombre cerrarse, que es la misma frase dicha dos veces.
  const inA = a + span * 0.2;
  const inB = a + span * 0.46;
  const opacity = useTransform(progress, [inA, inB], [0, 1], { clamp: true });
  const y = useTransform(progress, [inA, inB], [24, 0], { clamp: true });
  return (
    <div className={`absolute z-30 px-6 pointer-events-none ${className}`}>
      <motion.div style={{ opacity, y }} className="max-w-5xl mx-auto text-center">
        <div className="text-[11px] font-mono uppercase tracking-[0.22em] mb-4" style={{ color: 'hsl(var(--volt-soft) / 0.9)' }}>
          <span style={{ color: 'hsl(var(--volt-soft) / 0.5)' }}>{num} · </span>
          {T(kicker.es, kicker.en, lang)}
        </div>
        <h2
          className="font-bold text-white text-balance"
          style={{ fontSize: 'clamp(1.55rem, 2.7vw, 2.4rem)', lineHeight: 1.1, letterSpacing: '-0.025em' }}
        >
          {T(line.es, line.en, lang)}
        </h2>
        {/* El filete: lo que separa una frase de su pie en una lámina impresa.
            Dieciséis píxeles, centrado, del tono de la casa. */}
        <div className="mx-auto mt-5 h-px w-16" style={{ background: 'hsl(var(--volt) / 0.45)' }} />
        <p className="mt-5 mx-auto max-w-2xl text-[15px] leading-snug text-white/55 text-balance">{T(sub.es, sub.en, lang)}</p>
        {children && <div className="mt-8 flex justify-center pointer-events-auto">{children}</div>}
      </motion.div>
    </div>
  );
}

/**
 * EL HUECO DE LA VIÑETA. Entra un poco después que el texto —primero se lee la
 * frase, después se mira el dibujo— y avisa a su hijo de si está en pantalla
 * para que apague sus bucles cuando no lo está.
 *
 * `active` es estado de React a propósito y con cuidado: cambia DOS veces por
 * parada, al entrar y al salir, nunca una vez por frame. La primera versión lo
 * leía con `progress.get()` durante el render y se quedaba congelado en el
 * valor del primer pintado, así que las viñetas no arrancaban nunca.
 */
export function ArtifactSlot({
  progress,
  range,
  className = 'right-[8%] bottom-[13svh]',
  hold = false,
  children,
}: {
  progress: MotionValue<number>;
  range: readonly [number, number] | number[];
  className?: string;
  /** La viñeta del último tramo se queda, por lo mismo que el bloque de texto:
   *  no hay «después» donde apagarla, y apagarla deja al lector con la escena
   *  terminada y la mitad derecha vacía. */
  hold?: boolean;
  children: (active: boolean) => ReactNode;
}) {
  const [a, b] = range as [number, number];
  const span = b - a;
  const opacity = useTransform(
    progress,
    hold ? [a + span * 0.18, a + span * 0.38] : [a + span * 0.18, a + span * 0.38, b - span * 0.14, b],
    hold ? [0, 1] : [0, 1, 1, 0],
    { clamp: true },
  );
  const x = useTransform(progress, [a + span * 0.18, a + span * 0.38], [26, 0], { clamp: true });
  const [active, setActive] = useState(false);
  const on = useRef(false);
  useMotionValueEvent(progress, 'change', (v) => {
    const next = v >= a - span * 0.25 && v <= b + span * 0.25;
    if (next !== on.current) {
      on.current = next;
      setActive(next);
    }
  });
  return (
    <motion.div style={{ opacity, x }} className={`absolute z-30 pointer-events-none hidden xl:block ${className}`}>
      {children(active)}
    </motion.div>
  );
}

/**
 * EL RÓTULO DE LA PARADA, con su número.
 *
 * El viaje solar numera sus paradas («01 · Home») y eso hace dos cosas a la
 * vez: dice dónde estás y dice cuántas quedan. Sin número, un rótulo suelto es
 * un pie de foto.
 */
export function Kicker({ lang, es, en, num }: { lang: Lang; es: string; en: string; num?: string }) {
  return (
    <div className="text-[11px] font-mono uppercase tracking-[0.22em] mb-3" style={{ color: 'hsl(var(--volt-soft) / 0.9)' }}>
      {num && <span style={{ color: 'hsl(var(--volt-soft) / 0.5)' }}>{num} · </span>}
      {T(es, en, lang)}
    </div>
  );
}

/**
 * LA FRASE DE LA PARADA.
 *
 *
 * Medido: el viaje solar titula sus paradas a `clamp(1.5rem, 2.6vw, 2.2rem)`
 * —de 24 a 35 px— y estos mundos lo hacían a `clamp(16px, 1.5vw, 20px)`. La
 * mitad. Con la escena a sangre detrás, un titular de 18 px no es un titular,
 * es una nota al pie. Aquí se titula al mismo peso que Personal, con el mismo
 * interletrado apretado y el mismo equilibrado de líneas.
 */
export function Line({ lang, es, en }: { lang: Lang; es: string; en: string }) {
  return (
    <h2
      className="font-bold text-white text-balance"
      style={{ fontSize: 'clamp(1.55rem, 2.7vw, 2.4rem)', lineHeight: 1.08, letterSpacing: '-0.025em' }}
    >
      {T(es, en, lang)}
    </h2>
  );
}

/** Los apuntes de la parada. Mecanismo, nunca resultado: dicen cómo funciona,
 *  jamás cuánto rinde. */
export function Notes({ lang, items }: { lang: Lang; items: Array<{ es: string; en: string }> }) {
  return (
    <ul className="mt-4 space-y-2 m-0 p-0 list-none">
      {items.map((it) => (
        <li key={it.en} className="flex items-start gap-3 text-[15px] text-white/55 leading-snug">
          <span className="mt-[9px] w-[7px] h-px shrink-0" style={{ background: 'hsl(var(--volt) / 0.8)' }} />
          {T(it.es, it.en, lang)}
        </li>
      ))}
    </ul>
  );
}

/**
 * EL VELO DE LECTURA.
 *
 * El viaje solar desenfoca y apaga todo lo que no es la parada en curso
 * mientras se lee, y por eso su texto se lee. Estos mundos tenían la escena a
 * sangre por detrás del texto sin nada que los separase.
 *
 * Aquí es un degradado plano y NO un `backdrop-filter`: el desenfoque de fondo
 * se recalcula cada vez que repinta lo que hay detrás, y detrás de esta página
 * hay un lienzo de estrellas animándose a tiempo completo. Un velo que cuesta
 * un repintado de viewport por fotograma para ahorrar un gradiente es el trato
 * equivocado.
 */
export function ReadingVeil({ progress, from, to }: { progress: MotionValue<number>; from: number; to: number }) {
  const o = useTransform(progress, [from - 0.03, from + 0.02, to - 0.02, to + 0.03], [0, 1, 1, 0], { clamp: true });
  return (
    <motion.div
      aria-hidden
      style={{
        opacity: o,
        background:
          'linear-gradient(90deg, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.72) 26%, rgba(0,0,0,0.42) 46%, transparent 64%)',
      }}
      className="absolute inset-y-0 left-0 w-[72%] z-20 pointer-events-none"
    />
  );
}

/**
 * LA COLUMNA DE LA PARADA — texto y artefacto JUNTOS.
 *
 * Antes el texto vivía abajo a la izquierda y la viñeta abajo a la derecha, con
 * media pantalla de escena entre los dos: dos cosas pequeñas en dos esquinas en
 * vez de una columna que se lee. El viaje solar acopla su planeta, su titular,
 * sus apuntes y su viñeta en el MISMO bloque, y esa es la mitad de por qué su
 * texto no pasa desapercibido.
 *
 * `active` baja al hijo para que la viñeta sepa si tiene que estar viva. Es
 * estado de React, sí, pero cambia DOS veces por parada —al entrar y al salir—,
 * nunca una vez por fotograma: el `ref` es lo que impide que el `setState` se
 * dispare con cada tick del scroll.
 */
export function Dock({
  progress,
  range,
  hold = false,
  className = 'left-[6%] top-1/2 -translate-y-1/2',
  children,
}: {
  progress: MotionValue<number>;
  range: readonly [number, number] | number[];
  hold?: boolean;
  className?: string;
  children: (active: boolean) => ReactNode;
}) {
  const [a, b] = range as [number, number];
  const span = b - a;
  // ENTRA RÁPIDO Y SE VA DESPACIO. La columna tarda una cuarta parte del tiempo
  // de la parada en llegar al full y su contenido empieza a resolverse casi al
  // principio: medido en captura, la primera regla del tamiz se marcaba con el
  // titular todavía al 25 %. La salida sí puede ser larga — irse despacio es
  // elegante, llegar despacio es llegar tarde.
  //
  // Y empieza a irse en `b − 0,10·span`, no en `b − 0,16`: la escena resuelve
  // en el 72 % del tramo (ver la REGLA DE FASE en art/ValleyScene.tsx) y el
  // resto es el hueco donde se lee. Seis centésimas más de texto a plena
  // opacidad es justo ese hueco. No pisa la parada siguiente, cuya columna no
  // entra hasta `a + 0,02·span` del tramo de al lado.
  const opacity = useTransform(
    progress,
    hold ? [a + span * 0.02, a + span * 0.14] : [a + span * 0.02, a + span * 0.12, b - span * 0.1, b - span * 0.02],
    hold ? [0, 1] : [0, 1, 1, 0],
    { clamp: true },
  );
  const y = useTransform(progress, [a, b], hold ? [22, 0] : [22, -22], { clamp: true });
  const [active, setActive] = useState(false);
  const on = useRef(false);
  useMotionValueEvent(progress, 'change', (v) => {
    const next = v >= a - span * 0.25 && v <= b + span * 0.25;
    if (next !== on.current) {
      on.current = next;
      setActive(next);
    }
  });
  // DOS capas a propósito. La de fuera COLOCA (`top-1/2 -translate-y-1/2`) y la
  // de dentro ANIMA. Con una sola, framer escribe `transform` para su `y` y pisa
  // el `-translate-y-1/2` de la utilidad: medido en captura, la columna se
  // quedaba anclada por su borde superior a media pantalla y la lámina salía
  // cortada por abajo.
  return (
    <div className={`absolute z-30 w-[min(30rem,42vw)] pointer-events-none ${className}`}>
      <motion.div style={{ opacity, y }}>{children(active)}</motion.div>
    </div>
  );
}

/**
 * LOS ANCLAJES DE LAS PARADAS.
 *
 * Exacto, y la causa está en `PersistentScrollCue`: el botón busca
 * `[id^="stop-"], [id^="m-stop-"], #light-beat`, y esos anclajes los planta
 * SOLO `SolarJourney`. En los otros dos mundos no encontraba ninguno y caía a
 * su suelo —saltar un 85 % de pantalla, que es un salto ciego y no un
 * itinerario: por eso cada clic parecía seguir el recorrido de Personal.
 */
export function StationAnchors({ stations }: { stations: readonly JourneyStation[] }) {
  return (
    <>
      {stations.map((st) => (
        <div
          key={st.id}
          id={`stop-${st.id}`}
          aria-hidden
          className="absolute left-0 w-px h-px pointer-events-none"
          style={{ top: `calc(${st.at} * (100% - 100svh))` }}
        />
      ))}
    </>
  );
}

export interface JourneyStation {
  id: string;
  es: string;
  en: string;
  /** Adónde salta el scroll: el centro legible del tramo, no su arranque —
   *  aterrizar en el borde deja al lector mirando la transición. */
  at: number;
  from: number;
  to: number;
}

/**
 * LA BARRA DE PARADAS.
 *
 * El viaje solar enseña sus CUATRO rótulos a la vez y solo ilumina el de la
 * parada en curso, y por eso se sabe cuántas paradas hay y en cuál se está.
 * Esta enseñaba únicamente el activo, así que no decía ni una de las dos cosas.
 * Ahora se ven todos, numerados, con el activo en su tono y el resto apagados.
 */
export function StationRail({
  progress,
  lang,
  stations,
  onJump,
  fade: fadeStops = [0, 0.04, 0.88, 0.93],
}: {
  progress: MotionValue<number>;
  lang: Lang;
  stations: readonly JourneyStation[];
  onJump: (p: number) => void;
  /** Cuándo entra y cuándo se retira. Por defecto, lo de siempre. */
  fade?: readonly number[];
}) {
  // Se retira ANTES del cierre, no al final: en el último tiempo el nombre
  // entero ocupa la pantalla de canto a canto y los rótulos le cruzaban por
  // encima de la U y la M (medido en captura a 0,92). Una barra de navegación
  // sobre el logotipo de la casa es exactamente la clase de detalle que delata
  // que nadie miró el último fotograma.
  const fade = useTransform(progress, fadeStops as number[], [0, 1, 1, 0], { clamp: true });
  return (
    <motion.nav
      style={{ opacity: fade }}
      aria-label={T('Paradas del recorrido', 'Journey stops', lang)}
      className="absolute right-6 top-1/2 -translate-y-1/2 z-40 hidden lg:flex flex-col items-end gap-[10px]"
    >
      {stations.map((st, i) => (
        <Station key={st.id} station={st} num={String(i + 1).padStart(2, '0')} progress={progress} lang={lang} onJump={onJump} />
      ))}
    </motion.nav>
  );
}

function Station({
  station,
  num,
  progress,
  lang,
  onJump,
}: {
  station: JourneyStation;
  num: string;
  progress: MotionValue<number>;
  lang: Lang;
  onJump: (p: number) => void;
}) {
  const { from, to } = station;
  const pad = (to - from) * 0.12;
  // El indicador se deriva del progreso, sin estado de React: cero renders por
  // fotograma.
  const on = useTransform(progress, [from - pad, from + pad, to - pad, to + pad], [0, 1, 1, 0], { clamp: true });
  const barW = useTransform(on, [0, 1], [12, 30]);
  const barO = useTransform(on, [0, 1], [0.25, 1]);
  const textO = useTransform(on, [0, 1], [0.34, 1]);
  const numO = useTransform(on, [0, 1], [0.2, 0.55]);
  return (
    <button
      type="button"
      onClick={() => onJump(station.at)}
      className="group flex items-center justify-end gap-3 py-[3px] pointer-events-auto outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--volt))] rounded-[2px]"
    >
      <motion.span style={{ opacity: numO }} className="text-[10px] font-mono tabular-nums" >
        <span style={{ color: 'hsl(var(--volt-soft))' }}>{num}</span>
      </motion.span>
      <motion.span
        style={{ opacity: textO }}
        className="text-[11px] font-mono uppercase tracking-[0.18em] whitespace-nowrap group-hover:!opacity-100 transition-opacity"
      >
        <span style={{ color: 'hsl(var(--volt-hi))' }}>{T(station.es, station.en, lang)}</span>
      </motion.span>
      <motion.span className="block h-px shrink-0" style={{ width: barW, background: 'hsl(var(--volt))', opacity: barO }} />
    </button>
  );
}

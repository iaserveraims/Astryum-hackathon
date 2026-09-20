'use client';

/**
 * LA LÁMINA — el material compartido de las viñetas de producto.
 *
 * Fundador, 2026-09-18: «no me gusta el nivel de calidad del artefacto
 * principal que muestra las distintas cosas, quiero algo con muchísimo nivel».
 *
 * ── QUÉ SEPARA UNA CAPTURA DE UN PRODUCTO REAL DE UN DIV CON BORDE ───────
 * Medido en las tres familias de viñetas antes de esto: no había NI UNA
 * `box-shadow`, ni un filete interior, ni un degradado de fondo. Cada tarjeta
 * era un relleno plano y un borde blanco al 8 %. Eso es exactamente lo que se
 * ve, y no hay tipografía que lo salve.
 *
 * Aquí está el material, y son cuatro capas, todas de PINTURA sobre un elemento
 * estático — ni un filtro, nada que Safari tenga que recomponer:
 *
 *   1. Un fondo con DEGRADADO, no un color. Una superficie plana no existe.
 *   2. Un filete claro de un píxel en el canto de ARRIBA: el especular del
 *      borde superior, que es lo que dice «esto tiene grosor».
 *   3. Una regla interior de un píxel al 4 %: el segundo filete de la plancha.
 *   4. DOS sombras, no una: una ambiental amplia y difusa y una de CONTACTO
 *      corta y cerrada. Con una sola, la lámina flota; con las dos, se apoya.
 *
 * Y encima, una luz que cae desde arriba —la de la escena que hay justo encima
 * en la página— como un radial muy corto. Esa es la capa que hace que la lámina
 * pertenezca a la escena en vez de estar pegada sobre ella.
 *
 * ── LOS TRES MATERIALES SE MANTIENEN DISTINTOS A PROPÓSITO ───────────────
 * Personal redondea a 14 px y flota; Legacy va a 8 y vive entre los dos mundos;
 * Institucional va a 3 y se IMPRIME. Aquí se añade profundidad DENTRO de cada
 * material, no se convergen: el presupuesto de sombra del institucional es el
 * más corto de los tres porque una plancha impresa no levita.
 */

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import { PLATE, TONE } from './craft';
import { EASE } from '../interactions';

export { TONE };

export type PlateTone = 'print' | 'between';

const RADIUS: Record<PlateTone, number> = { print: 3, between: 8 };

/** La sombra, por material. La impresa apenas levanta del papel. */
function shadow(tone: PlateTone, compact: boolean): string {
  const ambient = tone === 'print' ? '0 12px 28px -20px rgba(0,0,0,0.85)' : '0 18px 40px -24px rgba(0,0,0,0.85)';
  return [
    `inset 0 1px 0 ${PLATE.topLight}`,
    `inset 0 0 0 1px hsl(var(--ink) / 0.04)`,
    compact ? '' : ambient,
    '0 2px 6px -2px rgba(0,0,0,0.5)',
  ]
    .filter(Boolean)
    .join(', ');
}

export interface PlateProps {
  title: string;
  note?: ReactNode;
  tone: PlateTone;
  /**
   * LA ENTRADA. Se ENCLAVA: una vez que la lámina ha llegado, no se vuelve a
   * dibujar el marco cada vez que se pasa por delante.
   */
  enter: boolean;
  /**
   * SI ESTÁ VIVA. Gobierna los bucles, y NO se enclava.
   *
   * Antes las dos cosas eran el mismo valor (`active || seenOnce`, con el
   * `seenOnce` de `once: true`), así que en cuanto la lámina se veía una vez el
   * valor se quedaba en `true` para siempre: los bucles seguían corriendo al
   * salir de la parada y `active` no podía apagarlos. Un bucle que no se puede
   * apagar es un bucle que corre el resto de la sesión.
   */
  live: boolean;
  /** Móvil: se cae la sombra ambiental amplia, que es pintura de área grande y
   *  en la versión apilada hay tres o cuatro láminas a la vez. */
  compact?: boolean;
  children: ReactNode;
}

/**
 * LA CABECERA CON SU MARCA DE ACENTO.
 *
 * Un rótulo con una regla debajo es un pie de foto. Un rótulo con una regla
 * debajo y una MARCA de dos por diez en el extremo izquierdo es un membrete de
 * documento. Esa marca es literalmente la diferencia, y cuesta un `<span>`.
 */
export function Plate({ title, note, tone, enter, compact = false, children }: PlateProps) {
  const r = RADIUS[tone];
  const uid = useId().replace(/:/g, '');

  const card: CSSProperties = {
    border: `1px solid ${PLATE.rule}`,
    borderRadius: r,
    // Casi opaca: con el velo de lectura por detrás y una montaña iluminada al
    // fondo, un 82 % dejaba pasar la roca a través de las filas.
    background: 'linear-gradient(180deg, hsl(var(--surface-2) / 0.94), hsl(var(--surface-1) / 0.97))',
    boxShadow: shadow(tone, compact),
  };

  return (
    <motion.div
      aria-hidden
      className="relative w-full max-w-[430px] overflow-hidden"
      style={card}
      initial={false}
      animate={{ clipPath: enter ? `inset(0 0 0 0 round ${r}px)` : `inset(0 100% 0 0 round ${r}px)` }}
      transition={{ duration: 0.52, ease: EASE }}
    >
      {/* la luz que cae de la escena que hay encima en la página */}
      <span
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(120% 80% at 50% -20%, hsl(var(--volt) / 0.07), transparent 62%)' }}
      />
      {/* EL FONDO DE SEGURIDAD. Solo en el material impreso: una onda finísima
          que se apaga antes de llegar al contenido. Es lo que tiene el papel de
          un título al trasluz, y es la razón por la que un documento emitido
          parece emitido. */}
      {tone === 'print' && (
        <svg aria-hidden className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.22 }}>
          <defs>
            <pattern id={`${uid}-gui`} width="24" height="6" patternUnits="userSpaceOnUse">
              <path d="M0 3 Q6 0 12 3 T24 3" fill="none" stroke="hsl(var(--volt-soft))" strokeWidth="0.4" strokeOpacity="0.55" />
            </pattern>
            <radialGradient id={`${uid}-guim`}>
              <stop offset="0%" stopColor="#fff" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </radialGradient>
            <mask id={`${uid}-guimask`}>
              <rect width="100%" height="100%" fill={`url(#${uid}-guim)`} />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${uid}-gui)`} mask={`url(#${uid}-guimask)`} />
        </svg>
      )}
      {/* el segundo filete, que se PARA antes de la cabecera: así el membrete
          se apoya sobre el marco como en una plancha grabada */}
      <span className="absolute pointer-events-none" style={{ inset: 6, top: 38, border: `1px solid ${PLATE.ruleSoft}`, borderRadius: Math.max(0, r - 2) }} />

      <div className="relative px-5 py-4">
        <div className="flex items-baseline justify-between gap-3 pb-2 mb-3" style={{ borderBottom: `1px solid ${PLATE.rule}` }}>
          <span className="flex items-center gap-2 min-w-0">
            <span className="block w-[2px] h-[10px] shrink-0" style={{ background: 'hsl(var(--volt))' }} />
            <span className="text-[10.5px] font-mono uppercase tracking-[0.22em] truncate" style={{ color: 'hsl(var(--volt-soft) / 0.85)' }}>
              {title}
            </span>
          </span>
          {note && <span className="text-[10px] font-mono uppercase tracking-[0.16em] shrink-0" style={{ color: 'hsl(var(--ink) / 0.35)' }}>{note}</span>}
        </div>
        {children}
      </div>
    </motion.div>
  );
}

/**
 * UNA FILA QUE SUBE DESDE DEBAJO DE SU PROPIA VENTANA.
 *
 * No es un fundido: la fila viene de fuera del recorte, como una línea que se
 * imprime. Un fundido dice «esto estaba aquí y se ha encendido»; esto dice
 * «esto acaba de llegar», que es lo que hace un registro.
 */
export function Row({ i, on, children, className = '' }: { i: number; on: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`block overflow-hidden ${className}`}>
      <motion.span
        className="block"
        initial={false}
        animate={{ y: on ? '0%' : '115%', opacity: on ? 1 : 0 }}
        transition={{ duration: 0.46, ease: EASE, delay: on ? 0.1 + i * 0.055 : 0 }}
      >
        {children}
      </motion.span>
    </span>
  );
}

/** Un filete que se barre desde la izquierda. Solo `transform`: el compositor
 *  lo resuelve sin tocar el layout. */
export function Rule({ i, on, className = '' }: { i: number; on: boolean; className?: string }) {
  return (
    <motion.span
      className={`block h-px origin-left ${className}`}
      style={{ background: PLATE.ruleSoft }}
      initial={false}
      animate={{ scaleX: on ? 1 : 0 }}
      transition={{ duration: 0.4, ease: EASE, delay: on ? 0.08 + i * 0.04 : 0 }}
    />
  );
}

/**
 * LA CIFRA DE PANTALLA.
 *
 * Sale de la tipografía monoespaciada y entra en Inter, que ya está cargada,
 * con cifras tabulares — y el SÍMBOLO DE MONEDA como su propio `<span>` a
 * 0,62 em y al 55 % de opacidad. Ese detalle solo es la mayor parte de la
 * distancia entre «un número» y «una cifra».
 *
 * NO cuenta hacia arriba. Una cifra que sube al lado de «capital de la entidad»
 * es una animación de crecimiento sobre un saldo de ejemplo, que es la lectura
 * de rendimiento más clara que hay disponible. Está ahí para decir «varias
 * cuentas, una sola superficie», no para moverse.
 */
export function Figure({ currency, value }: { currency: string; value: string }) {
  return (
    <span
      className="inline-flex items-baseline gap-[0.12em] text-white"
      style={{ fontSize: 'clamp(26px, 2.3vw, 32px)', fontWeight: 600, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}
    >
      <span style={{ fontSize: '0.62em', opacity: 0.55 }}>{currency}</span>
      {value}
    </span>
  );
}

/** El semáforo, en SVG y no en glifos de nueve píxeles. Un `✓` de texto a ese
 *  tamaño es un borrón; dos trazos redondeados a peso 1,6 son una marca. */
/**
 * EL VEREDICTO. Se DIBUJA cuando le toca, no aparece: un veredicto que se
 * enciende de golpe no se ha tomado, estaba ahí. Con `t` sin dar, se pinta
 * terminado — que es lo que necesita un fotograma quieto.
 *
 * El aspa lleva sus dos trazos con tiempos distintos y un pelo de rotación
 * cada uno: es un SELLO, no un icono centrado.
 */
export function Mark({ ok, t }: { ok: boolean; t?: MotionValue<number> }) {
  const still = useMotionValue(1);
  const src = t ?? still;
  const box = useTransform(src, [0, 0.18], [0.25, 1], { clamp: true });
  const d1 = useTransform(src, [0.12, 0.5], [1, 0], { clamp: true });
  const d2 = useTransform(src, [0.3, 0.68], [1, 0], { clamp: true });
  const pop = useTransform(src, [0, 0.22, 0.4], [0.82, 1.08, 1], { clamp: true });
  return (
    <motion.span
      className="w-[14px] h-[14px] shrink-0 grid place-items-center"
      style={{ border: `1px solid ${ok ? TONE.success : TONE.off}`, borderRadius: 2, opacity: box, scale: pop }}
    >
      <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
        {ok ? (
          <motion.path
            d="M3 7.2l2.4 2.4L11 4.2"
            stroke={TONE.success}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray="1 1"
            style={{ strokeDashoffset: d1 }}
          />
        ) : (
          <>
            <motion.path d="M4 4l6 6" stroke={TONE.off} strokeWidth="1.7" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: d1 }} />
            <motion.path d="M10 4l-6 6" stroke={TONE.off} strokeWidth="1.7" strokeLinecap="round" pathLength={1} strokeDasharray="1 1" style={{ strokeDashoffset: d2 }} />
          </>
        )}
      </svg>
    </motion.span>
  );
}

/**
 * Una lámina solo hace cosas cuando se la mira. `active` viene de la parada en
 * el recorrido de escritorio; en la versión apilada no hay paradas, así que
 * cada lámina mira por sí misma — antes las dos versiones apiladas pasaban
 * `active` a `true` a hueso, o sea que TODOS los bucles corrían a toda
 * velocidad justo en el camino que no debe tener movimiento.
 */
export function useSelfActive(external?: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useInView(ref, { margin: '-20%' });
  const [live, setLive] = useState(false);
  const [entered, setEntered] = useState(false);
  const on = external ?? near;
  useEffect(() => {
    setLive(on);
    if (on) setEntered(true);
  }, [on]);
  // `enter` se enclava, `live` no. Son dos preguntas distintas y antes eran el
  // mismo valor.
  return { ref, live, enter: entered };
}

/**
 * EL CRONÓMETRO DE UNA FILA — el scroll cuando lo hay, un temporizador cuando no.
 *
 * ── POR QUÉ NO BASTA CON UNA ENTRADA ─────────────────────────────────────
 * Una lámina que se monta con una animación de entrada y se queda quieta es una
 * captura de pantalla con una cortinilla. Lo que la convierte en parte del
 * recorrido es que se LEA CON EL SCROLL: que cada fila resuelva en el mismo
 * instante en que la escena hace lo que esa fila dice, y que al subir con la
 * rueda se deshaga igual de bien. Eso exige que el estado salga del progreso,
 * no de un `setTimeout` disfrazado de `delay`.
 *
 * En la versión apilada no hay recorrido, así que el mismo valor lo mueve un
 * temporizador y las láminas se ven igual de bien sin depender de nada.
 *
 * `progress` es fijo por montaje —o lo hay o no lo hay—, así que la fuente del
 * `useTransform` no cambia de identidad en vida del componente.
 */
export function useCue(progress: MotionValue<number> | undefined, a: number, b: number, on: boolean, i: number): MotionValue<number> {
  const local = useMotionValue(0);
  const scrubbed = useTransform(progress ?? local, [a, b], [0, 1], { clamp: true });
  useEffect(() => {
    if (progress) return;
    const c = animate(local, on ? 1 : 0, { duration: 0.55, delay: on ? 0.12 + i * 0.085 : 0, ease: EASE });
    return () => c.stop();
  }, [progress, on, i, local]);
  return progress ? scrubbed : local;
}

/**
 * UNA FILA QUE SUBE DESDE DEBAJO DE SU PROPIA VENTANA, atada a un cronómetro.
 *
 * No es un fundido: la fila viene de fuera del recorte, como una línea que se
 * imprime. Un fundido dice «esto estaba aquí y se ha encendido»; esto dice
 * «esto acaba de llegar», que es lo que hace un registro.
 */
export function Cue({
  t,
  from = 0,
  to = 0.34,
  className = '',
  children,
}: {
  t: MotionValue<number>;
  from?: number;
  to?: number;
  className?: string;
  children: ReactNode;
}) {
  const opacity = useTransform(t, [from, to], [0, 1], { clamp: true });
  const y = useTransform(t, [from, to], ['118%', '0%'], { clamp: true });
  return (
    <span className={`block overflow-hidden ${className}`}>
      <motion.span className="block" style={{ opacity, y }}>
        {children}
      </motion.span>
    </span>
  );
}

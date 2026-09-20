'use client';

/**
 * Shared motion vocabulary for the dashboard. One organic language everywhere:
 * content settles into place (rise + fade), figures count up to their real
 * value, and status dots breathe. Everything collapses to an instant crossfade
 * under the user's MINIMAL motion level (stores/motionStore.ts — the user's
 * setting, not just the OS). The CALM level in between keeps every one-shot
 * gesture (reveals, arrivals, count-ups) and switches off whatever moves on
 * its own or chases the cursor: Spotlight, PulseDot's ring, the typewriter.
 *
 * Reveals ENHANCE already-visible content: if JS never runs the initial
 * state is still painted by framer-motion on mount, so nothing ships blank.
 */

import { ReactNode, RefObject, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { animate, motion, useMotionTemplate, useMotionValue, useSpring, type Variants } from 'framer-motion';
import { useMotionLevel, useReducedMotion, type MotionLevel } from '../../stores/motionStore';
import { useEngraved } from '../../stores/themeStore';
import { isVeilLifted, serverVeilLifted, subscribeVeil } from '../../lib/motion/veil';
import { getSkinEpoch, serverSkinEpoch, subscribeSkinEpoch } from '../../lib/theme/sweep';

/** La ÉPOCA del tema (lib/theme/sweep.ts): sube cada vez que el material
 *  cambia con el panel montado. Las entradas la escuchan para volver a
 *  jugarse en el lenguaje del tema nuevo. */
function useSkinEpoch(): number {
  return useSyncExternalStore(subscribeSkinEpoch, getSkinEpoch, serverSkinEpoch);
}

/**
 * Vuelve a jugar una entrada cuando cambia la época: un fotograma en
 * «oculto» (las variantes de oculto son instantáneas) y de vuelta a «visto»,
 * que es lo que dispara la cascada otra vez — SIN remontar nada, así lo que
 * el usuario tuviera escrito se queda y ninguna lectura se relanza. Dos
 * rAF: el primero deja que el estado oculto se pinte, el segundo suelta.
 */
function useReplayOnEpoch(): boolean {
  const epoch = useSkinEpoch();
  const seen = useRef(epoch);
  const [replaying, setReplaying] = useState(false);
  useEffect(() => {
    if (epoch === seen.current) return;
    seen.current = epoch;
    setReplaying(true);
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReplaying(false));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [epoch]);
  return replaying;
}

/**
 * ¿Ha caído ya el velo del arranque? (lib/motion/veil.ts). Las entradas de
 * página esperan a que sea true: en recarga dura el panel monta DEBAJO del
 * velo de AccessGate y, sin esto, la coreografía entera se consumía a
 * escondidas y la página aparecía ya colocada. Navegando entre
 * páginas ya está levantado y nada cambia.
 */
export function useVeilLifted(): boolean {
  return useSyncExternalStore(subscribeVeil, isVeilLifted, serverVeilLifted);
}

/** The house curve — exponential ease-out, no bounce. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * The house tempo — THREE durations and no more (de-AI pass; the
 * audit counted ~34 ad-hoc values). fast = micro feedback (crossfades,
 * popovers), base = modals/tabs, slow = page-level reveals. Anything longer
 * must be a NAMED cinematic (AuthorityCrossing, the login decode).
 */
export const DUR = { fast: 0.15, base: 0.25, slow: 0.55 } as const;

/**
 * One modal language: soft pop on the house curve, no bounce. Pair with
 * `backdropFade` on the scrim. Replaces the per-modal zoo (springs, 0.18/0.4s).
 */
export const modalPop: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.97 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.base, ease: EASE_OUT } },
  exit: { opacity: 0, y: 6, scale: 0.98, transition: { duration: DUR.fast } },
};
export const backdropFade: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: DUR.fast } },
  exit: { opacity: 0, transition: { duration: DUR.fast } },
};

// Rise + fade only — NO animated `filter: blur()`. framer-motion's filter
// interpolation gets orphaned when the animating subtree re-renders mid-reveal
// (e.g. a WalletCard's async fetchNativeBalance→setPortfolio lands while the
// card is still settling): opacity/y reach their end state but the blur never
// clears, leaving content permanently blurred (bug). y+opacity are
// re-render-safe and read the same; blur is not worth a stuck-blur regression.
/**
 * NINGUNA DE LAS DOS VARIANTES ARRANCA EN OPACIDAD 0, y ese es el arreglo.
 *
 * La causa era una RAMPA DOBLE. El shell ya funde la página entera al navegar
 * (`motion.main key={pathname}`, opacity 0→1) y encima cada tarjeta hacía su
 * propio 0→1: dos apariciones montadas una sobre otra, y en una interfaz
 * oscura eso no se lee como entrada sino como destello. Peor en la revisita,
 * donde el escalonado era de 0,02s y el retardo estaba capado a 0,1s — o sea,
 * todas a la vez, que es literalmente «de golpe».
 *
 * Ahora la opacidad de la página la lleva el shell, y las tarjetas aportan lo
 * que el shell no puede dar: ORDEN. Entran con un desplazamiento corto, una
 * detrás de otra, partiendo de una opacidad ya alta — se posan, no aparecen.
 */
/**
 * ── TODAS LAS VARIANTES DECLARAN LAS MISMAS TRES PROPIEDADES ─────────────
 * (opacity, y, clipPath), aunque una de ellas no cambie en ese estilo. NO es
 * redundancia: es el arreglo de «la página se queda en gris». Cuando un componente ya montado cambia de juego de variantes
 * —al cambiar de tema— framer devuelve a su valor INICIAL toda propiedad que
 * desaparece del objetivo nuevo. Astryum animaba opacidad y la lámina
 * recorte: al pasar a la lámina la opacidad volvía al 0.35 de «oculto» y se
 * quedaba ahí (medido en el DOM: `opacity: 0.35` en línea, 4,5 s después); al
 * volver a Astryum el recorte volvía a «cerrado» y la página se vaciaba. Con
 * las tres propiedades en todos los estados, nada desaparece y nada se
 * restaura: cambiar de tema es una animación de 1→1 y none→none.
 */
const HIDDEN_NOW = { duration: 0 } as const;

const riseVariants: Variants = {
  hidden: { opacity: 0.35, y: 12, clipPath: 'none', transition: HIDDEN_NOW },
  shown: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    clipPath: 'none',
    transition: { duration: DUR.slow, ease: EASE_OUT, delay },
  }),
};

/**
 * La revisita. Sigue siendo más corta y más plana que la primera vez —la regla
 * (no repetir la función entera en cada clic del menú) se
 * mantiene— pero ya no es simultánea: conserva el ORDEN, que es lo que hace
 * que una pantalla se lea como que llega en vez de que salta.
 */
const settleVariants: Variants = {
  hidden: { opacity: 0.7, y: 5, clipPath: 'none', transition: HIDDEN_NOW },
  shown: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    clipPath: 'none',
    transition: { duration: DUR.base, ease: EASE_OUT, delay: Math.min(delay, 0.12) },
  }),
};

/**
 * Reveal-once-per-route: the rise+blur settle is a FIRST-impression gesture.
 * Replaying the full cascade on every sidebar click made the product feel like
 * an animated template, not a tool (audit) — revisits get a fast
 * plain fade instead. In-memory per JS session: a reload earns the settle again.
 */
const seenPaths = new Set<string>();

/**
 * Los estilos de entrada. Los tres primeros son los de siempre; los dos
 * últimos son LA ENTRADA DEL TEMA INSTITUCIONAL (ver resolveRevealStyle).
 *   rise  · fade  · calm  — Astryum: la tarjeta se posa (o funde, en revisita)
 *   print · print-settle  — la lámina: el bloque SE IMPRIME
 */
export type RevealStyle = 'rise' | 'fade' | 'calm' | 'print' | 'print-settle';

/**
 * ── LA LÁMINA SE IMPRIME ──────────────────────────────────────────────────────────
 *
 * No era una regresión: la entrada de Astryum siempre fue sutil a propósito
 * (las tarjetas parten de opacidad 0.35 y suben 12px — «se posan, no
 * aparecen»), y lo que la hacía LEGIBLE eran las sombras, los
 * halos, la luz que sigue al cursor y las escenas que se dibujan solas. El
 * tema Institucional quita todo eso por diseño (§4 de globals.css: nada
 * flota), así que la misma entrada de siempre se lee como «aparece de golpe».
 * Un tema que quita los artefactos de la entrada tiene que traer los suyos.
 */
export function resolveRevealStyle(level: MotionLevel, engraved: boolean, first: boolean): RevealStyle {
  if (level === 'minimal') return 'fade';
  if (engraved) return first ? 'print' : 'print-settle';
  // Sereno: la página se POSA — desplazamiento corto (6px) y lento, en orden,
  // también en la revisita. Lento y pequeño, nunca quieto.
  if (level === 'calm') return 'calm';
  return first ? 'rise' : 'fade';
}

/**
 * ¿Es la PRIMERA visita a esta ruta en esta sesión de JS? Se decide UNA VEZ,
 * al montar, y se congela (useState con inicializador).
 */
function useFirstVisit(pathname: string): boolean {
  const epoch = useSkinEpoch();
  // Congelado al montar: la primera visita a la ruta Y la época del tema en
  // ese momento. Cambiar de material (época nueva) vuelve a contar como
  // primera visita — la entrada se juega entera, no como revisita.
  const [atMount] = useState(() => ({ first: !seenPaths.has(pathname), epoch: getSkinEpoch() }));
  useEffect(() => {
    seenPaths.add(pathname);
  }, [pathname]);
  return atMount.first || epoch !== atMount.epoch;
}

function useRevealStyle(): RevealStyle {
  const pathname = usePathname() ?? '';
  const level = useMotionLevel();
  const engraved = useEngraved();
  const first = useFirstVisit(pathname);
  return resolveRevealStyle(level, engraved, first);
}

/** El recorte cerrado (nada impreso) y abierto (todo impreso). La misma
 *  forma en los dos extremos para que framer pueda interpolarlos. */
const CLIP_CLOSED = 'inset(0 100% 0 0)';
const CLIP_OPEN = 'inset(0 0% 0 0)';

/** La impresión — primera visita a la ruta. */
const printVariants: Variants = {
  hidden: { opacity: 1, y: 4, clipPath: CLIP_CLOSED, transition: HIDDEN_NOW },
  shown: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    clipPath: CLIP_OPEN,
    transition: { duration: DUR.slow, ease: EASE_OUT, delay },
    // Impreso = sin recorte. Un `inset(0 0 0 0)` residual sigue siendo un
    // contexto de recorte y guillotinaría un HelpDot que se abra hacia fuera.
    transitionEnd: { clipPath: 'none' },
  }),
};

/** La revisita: se imprime más deprisa y con el escalón capado. */
const printSettleVariants: Variants = {
  hidden: { opacity: 1, y: 2, clipPath: CLIP_CLOSED, transition: HIDDEN_NOW },
  shown: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    clipPath: CLIP_OPEN,
    transition: { duration: DUR.base, ease: EASE_OUT, delay: Math.min(delay, 0.12) },
    transitionEnd: { clipPath: 'none' },
  }),
};

/** El posarse del nivel sereno: seis píxeles en el tempo lento. */
const calmVariants: Variants = {
  hidden: { opacity: 0.5, y: 6, clipPath: 'none', transition: HIDDEN_NOW },
  shown: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    clipPath: 'none',
    transition: { duration: DUR.slow, ease: EASE_OUT, delay },
  }),
};

/** Los cinco juegos, por nombre. Exportado para que la prueba fije la regla
 *  de arriba: mismas propiedades en todos los estados de todos los estilos. */
export const REVEAL_VARIANTS: Record<RevealStyle, Variants> = {
  rise: riseVariants,
  fade: settleVariants,
  calm: calmVariants,
  print: printVariants,
  'print-settle': printSettleVariants,
};
const variantsFor = (style: RevealStyle): Variants => REVEAL_VARIANTS[style];

/**
 * ── LA OTRA MITAD DEL POP ─────────────
 *
 * Los Reveal de arriba juegan al ENTRAR EN LA RUTA — y en ese momento las
 * tarjetas están vacías: el dato aún viaja. Cuando el fetch contesta, filas,
 * cifras y gráficos se enchufaban en una página YA VISIBLE sin transición
 * ninguna. Ese es el pop que se seguía viendo: no era la entrada de la página,
 * era la llegada de los datos, que es otra capa y necesita su propio gesto.
 */
export function Arrive({
  children,
  index = 0,
  className = '',
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  const level = useMotionLevel();
  const engraved = useEngraved();
  // El dato que llega detrás del velo espera a que caiga (useVeilLifted):
  // `animate` sin objetivo deja la pieza en su estado inicial hasta entonces.
  const lifted = useVeilLifted();
  // EN LA LÁMINA EL DATO SE ESCRIBE, no se funde: el mismo recorte de
  // izquierda a derecha que imprime los bloques, un poco más corto porque
  // llega a una página ya impresa. Es lo que hace que un gráfico que llega
  // con su dato se vea LLEGAR — la mitad del encargo.
  //
  // UN SOLO motion.div y LAS MISMAS TRES PROPIEDADES en las dos caras (ver la
  // nota de las variantes): si el material cambia con el dato ya en pantalla,
  // ninguna propiedad desaparece del objetivo y framer no restaura nada — el
  // dato se queda donde está, visible.
  const print = engraved && level !== 'minimal';
  const initial =
    level === 'minimal'
      ? false
      : print
        ? { opacity: 1, y: 0, clipPath: CLIP_CLOSED }
        : level === 'calm'
          ? { opacity: 0, y: 4, clipPath: 'none' }
          : { opacity: 0, y: 8, clipPath: 'none' };
  const target = print
    ? { opacity: 1, y: 0, clipPath: CLIP_OPEN, transitionEnd: { clipPath: 'none' } }
    : { opacity: 1, y: 0, clipPath: 'none' };
  return (
    <motion.div
      className={className}
      initial={initial}
      animate={lifted ? target : undefined}
      transition={{
        duration: print ? 0.45 : level === 'calm' ? 0.55 : 0.4,
        ease: EASE_OUT,
        delay: Math.min(index * (print ? 0.06 : 0.05), 0.4),
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * La misma receta como props sueltas, para los sitios donde un div no puede
 * existir (filas <tr> de una tabla): `<motion.tr {...arriveMotion(i, reduced)}>`.
 * `reduced` llega del useReducedMotion del componente — un hook no puede
 * llamarse dentro de un .map.
 */
export function arriveMotion(index: number, reduced: boolean | null) {
  return {
    initial: reduced ? false : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, ease: EASE_OUT, delay: Math.min(index * 0.04, 0.36) },
  } as const;
}

/**
 * ── EL GENIO ────────────────────────────────────────
 *
 * La aproximación de la casa al genie de macOS: la ventana no aparece — SALE de
 * su lanzador. Nace estrecha y achatada pegada a su ancla (transform-origin en
 * la esquina del botón que la invoca), y se despliega con un muelle corto que
 * estira primero lo vertical — la insinuación del "estirón" del genie sin
 * intentar el warp real, que CSS no sabe hacer y quedaría barato imitado.
 */
export function genieMotion(reduced: boolean | null, anchor: 'bottom-left' | 'bottom-right') {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.15 },
    } as const;
  }
  return {
    initial: { opacity: 0, scaleX: 0.45, scaleY: 0.12, y: 26 },
    animate: { opacity: 1, scaleX: 1, scaleY: 1, y: 0 },
    exit: { opacity: 0, scaleX: 0.5, scaleY: 0.16, y: 22, transition: { duration: 0.22, ease: EASE_OUT } },
    transition: { type: 'spring', stiffness: 380, damping: 30, mass: 0.85 },
    style: { transformOrigin: anchor === 'bottom-left' ? 'left bottom' : 'right bottom' },
  } as const;
}

/** One block settling into place. Use `delay` to hand-stagger siblings. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const style = useRevealStyle();
  const lifted = useVeilLifted();
  const replaying = useReplayOnEpoch();
  return (
    <motion.div
      className={className}
      custom={delay}
      initial="hidden"
      animate={lifted && !replaying ? 'shown' : 'hidden'}
      variants={variantsFor(style)}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered parent: each direct <RevealItem> child settles 45ms after the
 * previous one on the route's FIRST visit and 22ms on a revisit — ORDENADO en
 * los dos casos, nunca simultáneo. Ambos son cortos a propósito: con listas
 * largas (Ajustes monta 26 bloques) un escalonado generoso deja la última
 * tarjeta llegando segundo y medio tarde, y eso se lee como que la página está
 * costando. Ver useRevealStyle y las variantes de arriba.
 */
export function RevealGroup({
  children,
  className = '',
  stagger = 0.045,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const style = useRevealStyle();
  // La cascada arranca cuando el velo del arranque empieza a caer, no al
  // montar (ver useVeilLifted): los hijos heredan este `animate`. Y vuelve a
  // jugarse cuando cambia el material (useReplayOnEpoch): el barrido del tema.
  const lifted = useVeilLifted();
  const replaying = useReplayOnEpoch();
  // Orchestration lives in the parent VARIANT (not the transition prop) so
  // framer-motion staggers the children's variant animations.
  const groupVariants: Variants = {
    hidden: {},
    shown: {
      transition:
        style === 'fade'
          ? { staggerChildren: 0.022, delayChildren: 0 }
          : // La impresión escalona un pelo más que el posarse (60ms frente a
            // 45): una línea detrás de otra tiene que LEERSE como secuencia.
            // La revisita imprime al escalón corto de siempre.
            style === 'print'
              ? { staggerChildren: Math.max(stagger, 0.06), delayChildren: delay }
              : style === 'print-settle'
                ? { staggerChildren: 0.03, delayChildren: 0 }
                : { staggerChildren: stagger, delayChildren: delay },
    },
  };
  return (
    <motion.div className={className} initial="hidden" animate={lifted && !replaying ? 'shown' : 'hidden'} variants={groupVariants}>
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className = '',
  steady = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * NO vuelve a jugar la entrada cuando cambia el tema (sí entra la primera
   * vez, en su orden). Para el bloque que CONTIENE el selector de tema: el
   * recorte de la impresión recorta también el hit-testing (astryum-73,),
   * así que al pulsar «Institucional» el propio botón quedaba
   * medio segundo bajo un hueco muerto y quien comparaba pulsando seguido
   * lo sentía como «no me responde». Un bloque `steady` mantiene «visto»
   * mientras el grupo reproduce y vuelve a heredar del grupo al terminar.
   */
  steady?: boolean;
}) {
  const style = useRevealStyle();
  const replaying = useReplayOnEpoch();
  return (
    <motion.div
      className={className}
      variants={variantsFor(style)}
      animate={steady && replaying ? 'shown' : undefined}
    >
      {children}
    </motion.div>
  );
}

/**
 * A figure that counts up to its real value when it first appears (and eases
 * to the new value when the data refreshes). The value is always REAL — the
 * animation only interpolates toward it, never invents an end state.
 */
export function CountUp({
  value,
  format,
  duration = 0.9,
  className = '',
}: {
  value: number;
  /** Formats every animation frame — supply the same formatter used for the static value. */
  format: (v: number) => string;
  duration?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  // La cifra cuenta cuando cae el velo del arranque, no al montar: en recarga
  // dura contaba a escondidas y aparecía ya en su valor.
  const lifted = useVeilLifted();
  const [display, setDisplay] = useState(() => (reduced ? value : 0));
  const prev = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      prev.current = value;
      setDisplay(value);
      return;
    }
    if (!lifted) return;
    const controls = animate(prev.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration, reduced, lifted]);

  return <span className={className}>{format(display)}</span>;
}

/**
 * Cursor-following gold sheen — the dashboard cousin of the landing's
 * SpotlightCard. Our panels are opaque (the landing's are translucent), so the
 * glow renders as an overlay ABOVE the content, faint enough to read as light
 * on the surface rather than a layer over it. No tilt: this is a tool.
 */
/**
 * ── LO QUE SIGUE AL CURSOR, con el tempo del nivel ─────────────────────────.
 * La primera versión del Sereno apagaba todo lo que persigue al
 * cursor; el fundador lo echó de menos en las wallets. La regla del Sereno
 * pasa de «nada persigue al cursor» a «lo sigue CON RETARDO»: los dos hooks
 * de abajo leen el mismo ratón y solo cambia el muelle —
 *   · full    → muelle rígido (420/40): en tiempo real, como siempre;
 *   · calm    → muelle blando (55/18): la luz y la inclinación llegan un
 *               instante después, se posan sin rebote; y la inclinación se
 *               queda en la mitad de grados;
 *   · minimal → apagados (los handlers no hacen nada, nada se pinta).
 * Card (spotlight), Spotlight y las tarjetas de wallet usan ESTOS hooks:
 * una sola receta, tres tempos.
 */
export function cursorSpring(level: MotionLevel) {
  return level === 'calm' ? { stiffness: 55, damping: 18, mass: 1 } : { stiffness: 420, damping: 40, mass: 0.6 };
}

/** La luz que sigue al cursor. Devuelve el fondo (motion value) para pintar
 *  un overlay `absolute inset-0` y los handlers para el contenedor. `tint`
 *  sustituye al dorado de la casa (p.ej. la tinta del proveedor de una
 *  wallet). En mínimo, `active` es false: no montar el overlay. */
export function useCursorGlow(
  ref: RefObject<HTMLElement | null>,
  { radius = 320, strength = 0.06, tint }: { radius?: number; strength?: number; tint?: string } = {},
) {
  const level = useMotionLevel();
  const active = level !== 'minimal';
  const spring = cursorSpring(level);
  const mx = useMotionValue(-9999);
  const my = useMotionValue(-9999);
  const sx = useSpring(mx, spring);
  const sy = useSpring(my, spring);
  const color = tint ?? `hsl(var(--volt-soft) / ${strength})`;
  const background = useMotionTemplate`radial-gradient(${radius}px circle at ${sx}px ${sy}px, ${color}, transparent 65%)`;
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!active || !el) return;
    const r = el.getBoundingClientRect();
    mx.set(e.clientX - r.left);
    my.set(e.clientY - r.top);
  };
  return { active, onMove, background };
}

/** La inclinación 3D que sigue al cursor (la receta de la mano del Earn):
 *  motion values para `style={{ rotateX, rotateY, transformPerspective }}`. */
export function useCursorTilt(ref: RefObject<HTMLElement | null>, maxDeg = 4) {
  const level = useMotionLevel();
  const active = level !== 'minimal';
  const deg = level === 'calm' ? Math.min(maxDeg, 2) : maxDeg;
  const spring = level === 'calm' ? { stiffness: 70, damping: 20 } : { stiffness: 260, damping: 24 };
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, spring);
  const rotateY = useSpring(ry, spring);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!active || !el) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1;
    const py = ((e.clientY - r.top) / r.height) * 2 - 1;
    ry.set(px * deg);
    rx.set(-py * deg);
  };
  const onLeave = () => {
    rx.set(0);
    ry.set(0);
  };
  return { active, onMove, onLeave, rotateX, rotateY };
}

export function Spotlight({
  children,
  className = '',
  radius = 320,
  strength = 0.06,
}: {
  children: ReactNode;
  className?: string;
  radius?: number;
  strength?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  // Sigue al cursor con el tempo del nivel (ver useCursorGlow); en mínimo, nada.
  const glow = useCursorGlow(ref, { radius, strength });

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      onMouseMove={glow.onMove}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
    >
      {children}
      {glow.active && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{ background: glow.background }}
          animate={{ opacity: on ? 1 : 0 }}
          transition={{ duration: 0.5 }}
        />
      )}
    </div>
  );
}

/**
 * TypewriterText — assistant replies write themselves in, like someone typing
 * on the other side. Works over streaming text too: it chases the growing
 * target and speeds up when it falls far behind, so long streams never lag.
 * `done=false` keeps the caret blinking between chunks. Reduced motion (or an
 * already-finished message) renders instantly.
 */
export function TypewriterText({
  text,
  done = true,
  cps = 55,
  className = '',
}: {
  text: string;
  /** false while the source is still streaming — keeps the caret alive. */
  done?: boolean;
  /** Characters per second at cruise speed. */
  cps?: number;
  className?: string;
}) {
  // Escribirse solo es movimiento por cuenta propia: sereno lo pinta entero.
  const reduced = useMotionLevel() !== 'full';
  const [count, setCount] = useState(() => (reduced ? text.length : 0));
  const countRef = useRef(count);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (reduced) {
      countRef.current = textRef.current.length;
      setCount(countRef.current);
      return;
    }
    const id = setInterval(() => {
      const target = textRef.current.length;
      if (countRef.current >= target) return;
      const behind = target - countRef.current;
      // cruise step at ~30fps, with a catch-up boost when the stream runs ahead
      const step = Math.max(Math.max(1, Math.round(cps / 30)), Math.floor(behind / 40));
      countRef.current = Math.min(target, countRef.current + step);
      setCount(countRef.current);
    }, 33);
    return () => clearInterval(id);
  }, [reduced, cps]);

  // Reduced motion must also track streaming growth.
  useEffect(() => {
    if (reduced) {
      countRef.current = text.length;
      setCount(text.length);
    }
  }, [text, reduced]);

  const typing = !reduced && (count < text.length || !done);
  return (
    <span className={className}>
      {text.slice(0, count)}
      {typing && (
        <span
          aria-hidden
          className="inline-block w-[2px] h-[1em] ml-0.5 align-[-0.15em] bg-volt/80 animate-pulse"
        />
      )}
    </span>
  );
}

/** A softly breathing status dot — alive, not alarming. */
export function PulseDot({
  className = 'bg-tone-success',
  size = 8,
}: {
  className?: string;
  size?: number;
}) {
  // TRES CARAS por nivel (stores/motionStore.ts): el anillo que se EXPANDE
  // (full), un HALO que respira despacio sin crecer (calm) y el punto a secas
  // (minimal). El punto sólido —el dato— se queda en los tres.
  const level = useMotionLevel();
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {level === 'full' && (
        <motion.span
          className={`absolute inset-0 rounded-full ${className}`}
          animate={{ scale: [1, 2.1], opacity: [0.45, 0] }}
          transition={{ duration: 2.4, ease: 'easeOut', repeat: Infinity }}
        />
      )}
      {level === 'calm' && (
        <motion.span
          className={`absolute -inset-[3px] rounded-full ${className}`}
          animate={{ opacity: [0.12, 0.38, 0.12] }}
          transition={{ duration: 3.6, ease: 'easeInOut', repeat: Infinity }}
        />
      )}
      <span className={`relative inline-flex rounded-full w-full h-full ${className}`} />
    </span>
  );
}

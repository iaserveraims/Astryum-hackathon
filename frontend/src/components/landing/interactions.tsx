'use client';

/**
 * Astryum landing — interaction primitives.
 *
 * A small, dependency-light motion toolkit (framer-motion only, already in the
 * bundle) for the sui.io-grade landing: magnetic CTAs, cursor-spotlight + tilt
 * cards, kinetic mask-reveal headlines, scroll-scrubbed text, animated counters
 * and a shared pointer-parallax signal.
 *
 * Rules honored throughout:
 *  - Continuous pointer/scroll values live in motion values, never React state.
 *  - Everything degrades to a clean static end-state under prefers-reduced-motion.
 *  - No `window.addEventListener('scroll')`; scroll work uses useScroll/useTransform.
 */

import { useEffect, useRef } from 'react';
import {
  animate,
  motion,
  motionValue,
  useInView,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion';

// The accent now RIDES --volt (the dashboard's token family): flipping
// data-authority='governed' on the landing root re-tints every consumer —
// cards, CTAs, borders, sweeps — exactly like the app. The fallback keeps the
// standalone pages (login, early-access) on brand gold if the var is missing.
const GOLD = 'hsl(var(--volt, 45 68% 47%))';
export const EASE = [0.16, 1, 0.3, 1] as const;

// ─── Shared border tones ────────────────────────────────────────────────────
// Three steps of white-on-black border opacity, so the landing's inline styles
// pull from one scale instead of each call site inventing its own rgba value.
export const BORDER_FAINT = 'rgba(255,255,255,0.06)';
export const BORDER = 'rgba(255,255,255,0.08)';
export const BORDER_STRONG = 'rgba(255,255,255,0.14)';

// ─── Shared pointer signal ──────────────────────────────────────────────────
// One window-level pointer listener feeds normalized [-0.5, 0.5] motion values.
// Components subscribe via springs; no re-renders, no per-component listener.
// The motion values are stable module singletons, so creating them during the
// render phase (idempotent) is safe and keeps springs bound to the live source.
let pointerX: MotionValue<number> | null = null;
let pointerY: MotionValue<number> | null = null;
let listeners = 0;

function getPointer(): [MotionValue<number>, MotionValue<number>] {
  if (!pointerX) pointerX = motionValue(0);
  if (!pointerY) pointerY = motionValue(0);
  return [pointerX, pointerY];
}
function onPointer(e: PointerEvent) {
  getPointer()[0].set(e.clientX / window.innerWidth - 0.5);
  getPointer()[1].set(e.clientY / window.innerHeight - 0.5);
}

/** Subscribe to the global pointer signal. Returns smoothed [-0.5,0.5] values. */
export function usePointerParallax(stiffness = 60, damping = 18) {
  const reduce = useReducedMotion();
  const [px, py] = getPointer();
  const x = useSpring(px, { stiffness, damping, mass: 0.4 });
  const y = useSpring(py, { stiffness, damping, mass: 0.4 });
  useEffect(() => {
    if (reduce) return;
    if (listeners === 0) window.addEventListener('pointermove', onPointer, { passive: true });
    listeners += 1;
    return () => {
      listeners = Math.max(0, listeners - 1);
      if (listeners === 0) window.removeEventListener('pointermove', onPointer);
    };
  }, [reduce]);
  return { x, y, reduce: !!reduce };
}

// ─── Magnetic wrapper (CTAs, logo) ──────────────────────────────────────────
export function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: React.ReactNode;
  strength?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 16, mass: 0.3 });
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 16, mass: 0.3 });

  const onMove = (e: React.MouseEvent) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * strength);
    y.set((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const reset = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={reduce ? undefined : { x, y }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── Spotlight + optional 3D tilt card ──────────────────────────────────────
export function SpotlightCard({
  children,
  className = '',
  style,
  tilt = false,
  intensity = 12,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  tilt?: boolean;
  intensity?: number;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const rotX = useSpring(useMotionValue(0), { stiffness: 150, damping: 18 });
  const rotY = useSpring(useMotionValue(0), { stiffness: 150, damping: 18 });

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
    if (tilt && !reduce) {
      rotY.set((px - 0.5) * intensity);
      rotX.set((0.5 - py) * intensity);
    }
  };
  const onLeave = () => {
    rotX.set(0);
    rotY.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        ...style,
        ...(tilt && !reduce ? { rotateX: rotX, rotateY: rotY, transformStyle: 'preserve-3d' } : {}),
      }}
      className={`spotlight-card ${className}`}
    >
      {children}
    </motion.div>
  );
}

// ─── Kinetic mask-reveal headline ───────────────────────────────────────────
// Each line is wrapped in an overflow-clip box; the inner span slides up from
// below. `trigger` chooses mount (above the fold) vs in-view (below the fold).
export function MaskLines({
  lines,
  className = '',
  lineClassName = '',
  delay = 0,
  stagger = 0.09,
  trigger = 'mount',
}: {
  lines: React.ReactNode[];
  className?: string;
  lineClassName?: string;
  delay?: number;
  stagger?: number;
  trigger?: 'mount' | 'view';
}) {
  const reduce = useReducedMotion();
  const anim = { y: '0%' };
  const init = reduce ? false : { y: '115%' };
  return (
    <span className={className}>
      {lines.map((line, i) => (
        <span key={i} className="block overflow-hidden pb-[0.12em] -mb-[0.12em]">
          <motion.span
            className={`block will-change-transform ${lineClassName}`}
            initial={init}
            {...(trigger === 'mount'
              ? { animate: reduce ? {} : anim }
              : { whileInView: reduce ? {} : anim, viewport: { once: true, margin: '-12%' } })}
            transition={{ duration: 0.9, delay: delay + i * stagger, ease: EASE }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

// ─── Scroll-scrubbed word reveal (manifesto) ────────────────────────────────
function Word({ progress, range, children }: { progress: MotionValue<number>; range: [number, number]; children: string }) {
  const opacity = useTransform(progress, range, [0.16, 1]);
  return (
    <motion.span style={{ opacity }} className="inline-block">
      {children}
    </motion.span>
  );
}

export function ScrollRevealText({ text, className = '' }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.55'] });
  if (reduce) return <p className={className}>{text}</p>;
  const words = text.split(' ');
  return (
    <p ref={ref} className={className}>
      {words.map((w, i) => (
        <span key={i}>
          <Word progress={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
            {w}
          </Word>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}

// ─── Animated number counter ────────────────────────────────────────────────
export function CountUp({
  to,
  from = 0,
  duration = 1.8,
  decimals = 0,
  prefix = '',
  suffix = '',
  className,
}: {
  to: number;
  from?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const mv = useMotionValue(from);

  const fmt = (v: number) =>
    `${prefix}${v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${suffix}`;

  useEffect(() => {
    if (!inView || !ref.current) return;
    if (reduce) {
      ref.current.textContent = fmt(to);
      return;
    }
    const controls = animate(mv, to, { duration, ease: EASE });
    const unsub = mv.on('change', (v) => {
      if (ref.current) ref.current.textContent = fmt(v);
    });
    return () => {
      controls.stop();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  return (
    <span ref={ref} className={className}>
      {fmt(from)}
    </span>
  );
}

// ─── Generic scroll-reveal (kept local so the landing has one source) ───────
// Deliberately unhurried: a longer travel, a later trigger and a slower ease
// make the page read as alive rather than eager — elements take their moment.
export function Reveal({
  children,
  delay = 0,
  className,
  y = 32,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-110px' }}
      transition={{ duration: 0.9, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

export { GOLD };

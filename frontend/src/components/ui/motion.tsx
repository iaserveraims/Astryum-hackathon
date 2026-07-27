'use client';

/**
 * Shared motion vocabulary for the dashboard. One organic language everywhere:
 * content settles into place (rise + fade), figures count up to their real
 * value, and status dots breathe. Everything collapses to an instant crossfade
 * under prefers-reduced-motion.
 *
 * Reveals ENHANCE already-visible content: if JS never runs the initial
 * state is still painted by framer-motion on mount, so nothing ships blank.
 */

import { ReactNode, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  animate,
  motion,
  useReducedMotion,
  type Variants,
} from 'framer-motion';

/** The house curve — exponential ease-out, no bounce. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * The house tempo — THREE durations and no more (de-AI pass 2026-07-21; the
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
// clears, leaving content permanently blurred (bug 2026-07-21). y+opacity are
// re-render-safe and read the same; blur is not worth a stuck-blur regression.
const riseVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: DUR.slow, ease: EASE_OUT, delay },
  }),
};

const fadeVariants: Variants = {
  hidden: { opacity: 0 },
  shown: (delay: number = 0) => ({
    opacity: 1,
    transition: { duration: DUR.base, delay: Math.min(delay, 0.1) },
  }),
};

/**
 * Reveal-once-per-route: the rise+blur settle is a FIRST-impression gesture.
 * Replaying the full cascade on every sidebar click made the product feel like
 * an animated template, not a tool (audit 2026-07-21) — revisits get a fast
 * plain fade instead. In-memory per JS session: a reload earns the settle again.
 */
const seenPaths = new Set<string>();
function useRevealStyle(): 'rise' | 'fade' {
  const pathname = usePathname() ?? '';
  const reduced = useReducedMotion();
  // Read BEFORE marking: every group mounted in this same render pass agrees.
  const first = !seenPaths.has(pathname);
  useEffect(() => {
    seenPaths.add(pathname);
  }, [pathname]);
  return reduced || !first ? 'fade' : 'rise';
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
  return (
    <motion.div
      className={className}
      custom={delay}
      initial="hidden"
      animate="shown"
      variants={style === 'fade' ? fadeVariants : riseVariants}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered parent: each direct <RevealItem> child settles 70ms after the
 * previous one on the route's FIRST visit; revisits collapse to a near-instant
 * fade so navigation feels immediate (see useRevealStyle).
 */
export function RevealGroup({
  children,
  className = '',
  stagger = 0.07,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}) {
  const style = useRevealStyle();
  // Orchestration lives in the parent VARIANT (not the transition prop) so
  // framer-motion staggers the children's variant animations.
  const groupVariants: Variants = {
    hidden: {},
    shown: {
      transition:
        style === 'fade'
          ? { staggerChildren: 0.02, delayChildren: 0 }
          : { staggerChildren: stagger, delayChildren: delay },
    },
  };
  return (
    <motion.div className={className} initial="hidden" animate="shown" variants={groupVariants}>
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const style = useRevealStyle();
  return (
    <motion.div className={className} variants={style === 'fade' ? fadeVariants : riseVariants}>
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
  const [display, setDisplay] = useState(() => (reduced ? value : 0));
  const prev = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      prev.current = value;
      setDisplay(value);
      return;
    }
    const controls = animate(prev.current, value, {
      duration,
      ease: EASE_OUT,
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, duration, reduced]);

  return <span className={className}>{format(display)}</span>;
}

/**
 * Cursor-following gold sheen — the dashboard cousin of the landing's
 * SpotlightCard. Our panels are opaque (the landing's are translucent), so the
 * glow renders as an overlay ABOVE the content, faint enough to read as light
 * on the surface rather than a layer over it. No tilt: this is a tool.
 */
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
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || reduced) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  return (
    <div
      ref={ref}
      className={`relative ${className}`}
      onMouseMove={onMove}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
    >
      {children}
      {!reduced && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-500"
          style={{
            opacity: on ? 1 : 0,
            background: `radial-gradient(${radius}px circle at var(--mx, 50%) var(--my, 50%), hsl(var(--volt-soft) / ${strength}), transparent 65%)`,
          }}
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
  const reduced = useReducedMotion();
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
  const reduced = useReducedMotion();
  return (
    <span
      className="relative inline-flex shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {!reduced && (
        <motion.span
          className={`absolute inset-0 rounded-full ${className}`}
          animate={{ scale: [1, 2.1], opacity: [0.45, 0] }}
          transition={{ duration: 2.4, ease: 'easeOut', repeat: Infinity }}
        />
      )}
      <span className={`relative inline-flex rounded-full w-full h-full ${className}`} />
    </span>
  );
}

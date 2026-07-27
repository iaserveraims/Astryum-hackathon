'use client';

/**
 * AuthorityCrossing — the ~1.5s transition for the Personal↔Legacy toggle.
 *
 * Redesigned 2026-07-24 (founder: "que no se oscurezca el fondo — tal vez solo
 * un poco de blur — y rediseña la animación del centro para que tenga más
 * coherencia"). The previous version curtained the page with a near-opaque
 * dark wash — which HID the shell's own 700ms re-tint (transition-colors on
 * [data-authority], gold↔indigo), the most organic part of the crossing, and
 * flashed alien black over the light (paper) theme — and stamped a classical
 * council seal whose notches were hardcoded 3-of-5 regardless of the real
 * council. Both replaced:
 *
 *   backdrop     Frosted glass only — NO colour wash. A blur pane (CSS
 *                keyframes `.acx-glass` in globals.css: 0→6px→0, -webkit-
 *                prefixed for Safari, browser-composited instead of the old
 *                per-frame JS animation of backdropFilter) lets the
 *                dashboard's own re-tint play VISIBLY behind the glass. A
 *                soft radial halo in the authority hue lifts the centre
 *                without darkening anything.
 *
 *   to-legacy    "the council constellation": as many stars as the council
 *                has signers ignite one by one around a dashed orbit ring —
 *                quorum-met signers as bright four-point sparks, the rest as
 *                waiting dots — then the pact draws itself, hairlines linking
 *                star to star, and the Legacy's own star lights at the
 *                centre. The exact sky vocabulary the app already speaks:
 *                ConstellationScene/CometMark (components/earn/icons.tsx),
 *                the eicon-star twinkle (globals.css), dashed `0.1 6` orbits.
 *
 *   to-personal  "released home": the constellation's links retract, its
 *                stars dim, and the topmost star breaks away as a comet —
 *                gradient head, three tapered cauda strokes (CometMark's
 *                trail) — riding out toward a faint home orbit.
 *
 * Choreography stays ONE continuous keyframe timeline per element (each
 * motion value's own `times` array — never `transition.delay`, which would
 * push an element past the window); a single setTimeout schedules `onDone`
 * through a ref so a parent re-render (new inline callback identity) can
 * never restart it. Colour is always var(--authority-solid) + an explicit
 * opacity — but each scene PINS that var to its destination product's fixed
 * token (--product-legacy entering the vault, --product-personal coming
 * home; founder 2026-07-26): trusting the data-authority cascade let the
 * flip's timing decide the hue. The product vars never move with the
 * attribute and carry their own light-theme shades. NOT --authority-soft
 * for strokes: that var is an rgba(…,0.08) background tint — as a stroke it
 * was invisible (latent bug in the old rings). Text is ink-tinted, so it
 * reads on paper as well as on space.
 * prefers-reduced-motion swaps the sequence for a 300ms glass fade over the
 * static mark.
 */

import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useT } from '../../i18n/LanguageProvider';

export type AuthorityCrossingDirection = 'to-legacy' | 'to-personal';

interface AuthorityCrossingProps {
  direction: AuthorityCrossingDirection;
  /** Governed account name — to-legacy only. */
  label?: string;
  /** Pre-formatted "X/Y" quorum caption — to-legacy only. */
  quorum?: string;
  /** Real council shape for the constellation (signers that meet quorum /
   *  total signers). Omitted → decorative 3-of-5 sky (the landing's marketing
   *  crossing passes none). */
  quorumMet?: number;
  members?: number;
  onDone: () => void;
}

const DURATION_S = 1.5;
const DURATION_MS = 1500;
const REDUCED_MS = 300;

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Stagger classes for star twinkle — same rotation the Earn scenes use. */
const TWINKLE = ['', 'eicon-d1', 'eicon-d2', 'eicon-d3'];

// Scattered star coordinates in the shared 400×400 viewBox — twinkle via the
// existing .eicon-star/.eicon-d1-3 classes (globals.css), envelope-faded in
// and out by the wrapping <motion.g> so they only live inside the sequence.
const AMBIENT_STARS: Array<[number, number, string]> = [
  [66, 84, 'eicon-d1'],
  [332, 76, 'eicon-d2'],
  [58, 308, 'eicon-d3'],
  [338, 316, 'eicon-d1'],
  [200, 36, 'eicon-d2'],
  [200, 366, 'eicon-d3'],
];

/** Frosted pane — blur only, zero tint (founder: the background must not
 *  darken). The ramp lives in CSS (`.acx-glass`, globals.css) so the browser
 *  composites it; only the window length is set from here. */
function GlassPane({ ms }: { ms: number }) {
  return <div className="acx-glass absolute inset-0" style={{ '--acx-dur': `${ms}ms` } as CSSProperties} />;
}

/** Soft hue bloom behind the centre — atmosphere without darkness. */
function Halo() {
  return (
    <motion.div
      className="absolute inset-0 m-auto h-[340px] w-[340px] rounded-full"
      style={{ background: 'radial-gradient(circle, var(--authority-solid) 0%, transparent 62%)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.16, 0.16, 0] }}
      transition={{ duration: DURATION_S, times: [0, 0.3, 0.72, 1], ease: 'easeInOut' }}
    />
  );
}

/** Four-point spark — the exact silhouette of ConstellationScene's bright
 *  star (components/earn/icons.tsx), parameterised: outer points at ±s on the
 *  axes, inner joints at 0.286s on the diagonals. */
function starPath(cx: number, cy: number, s: number): string {
  const k = 0.286 * s;
  return (
    `M${cx} ${cy - s} L${cx + k} ${cy - k} L${cx + s} ${cy} L${cx + k} ${cy + k} ` +
    `L${cx} ${cy + s} L${cx - k} ${cy + k} L${cx - s} ${cy} L${cx - k} ${cy - k} Z`
  );
}

/** Star positions for an n-signer council on a ring, top-first, clockwise. */
function councilStars(n: number, met: number, c: number, r: number) {
  return Array.from({ length: n }, (_, i) => {
    const angle = ((-90 + (i * 360) / n) * Math.PI) / 180;
    return {
      x: +(c + r * Math.cos(angle)).toFixed(2),
      y: +(c + r * Math.sin(angle)).toFixed(2),
      lit: i < met,
    };
  });
}

/**
 * ConstellationMark — the council drawn as a constellation, data-driven
 * (replaces the old CrossingSeal, whose engraving always claimed 3-of-5 even
 * under a 2/3 council — the mark could contradict the caption right beneath
 * it). Every element carries its FINAL look as plain SVG attributes; `drawn`
 * only adds multiplicative motion wrappers (opacity/pathLength keyframes), so
 * `drawn={false}` renders the finished mark statically for reduced motion.
 * Exported for reuse as a static product mark, the same courtesy the old
 * seal extended.
 */
export function ConstellationMark({
  members = 5,
  quorumMet = 3,
  size = 120,
  drawn = true,
}: {
  members?: number;
  quorumMet?: number;
  size?: number;
  drawn?: boolean;
}) {
  const c = 60;
  // Display clamp: the mark stays legible for real XRPL signer lists (2–8
  // stars); the caption below carries the exact figures either way.
  const n = Math.min(8, Math.max(2, Math.round(members)));
  const met = Math.min(n, Math.max(0, Math.round(quorumMet)));
  const stars = councilStars(n, met, c, 42);
  const pact = `M${stars.map((s) => `${s.x} ${s.y}`).join(' L')} Z`;

  const fadeIn = (from: number, to: number) =>
    drawn
      ? {
          initial: { opacity: 0 },
          animate: { opacity: [0, 0, 1, 1] },
          transition: { duration: DURATION_S, times: [0, from, to, 1], ease: EASE_OUT_EXPO },
        }
      : {};

  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      {/* the table the council sits at — a dashed orbit ring */}
      <motion.g {...fadeIn(0.05, 0.2)}>
        <circle
          cx={c}
          cy={c}
          r={42}
          fill="none"
          stroke="var(--authority-solid)"
          strokeOpacity={0.3}
          strokeWidth={1.2}
          strokeDasharray="0.1 6"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </motion.g>

      {/* resting hint of the pact — ConstellationScene's faint pre-drawn path */}
      <motion.g {...fadeIn(0.1, 0.24)}>
        <path
          d={pact}
          fill="none"
          stroke="var(--authority-solid)"
          strokeOpacity={0.12}
          strokeWidth={1}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </motion.g>

      {/* the pact draws itself, star to star */}
      <motion.path
        d={pact}
        fill="none"
        stroke="var(--authority-solid)"
        strokeOpacity={0.55}
        strokeWidth={1.2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        {...(drawn
          ? {
              initial: { pathLength: 0, opacity: 0 },
              animate: { pathLength: [0, 0, 1, 1], opacity: [0, 0, 1, 1] },
              transition: { duration: DURATION_S, times: [0, 0.36, 0.62, 1], ease: EASE_OUT_EXPO },
            }
          : { style: { pathLength: 1 } })}
      />

      {/* the signers, igniting one by one — quorum-met as sparks, the rest waiting */}
      {stars.map((s, i) => (
        <motion.g key={i} {...fadeIn(0.1 + (i / n) * 0.26, 0.17 + (i / n) * 0.26)}>
          {s.lit ? (
            <path d={starPath(s.x, s.y, 4.6)} fill="var(--authority-solid)" className={`eicon-star ${TWINKLE[i % 4]}`} />
          ) : (
            <circle cx={s.x} cy={s.y} r={1.9} fill="var(--authority-solid)" fillOpacity={0.35} />
          )}
        </motion.g>
      ))}

      {/* the Legacy's own star, lit the moment the pact closes */}
      <motion.g {...fadeIn(0.5, 0.62)}>
        <circle cx={c} cy={c} r={13} fill="var(--authority-solid)" fillOpacity={0.12} />
        <path d={starPath(c, c, 7)} fill="var(--authority-solid)" className="eicon-star eicon-d1" />
      </motion.g>
    </svg>
  );
}

/** Static homeward mark — CometMark's silhouette in the authority hue, for
 *  the reduced-motion to-personal crossing. */
function CometGlyph({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden>
      <defs>
        <radialGradient id="acx-cg-head" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#FFFDF4" />
          <stop offset="55%" stopColor="var(--authority-solid)" />
          <stop offset="100%" stopColor="var(--authority-solid)" stopOpacity="0.15" />
        </radialGradient>
        <linearGradient id="acx-cg-trail" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--authority-solid)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--authority-solid)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse
        cx={60}
        cy={60}
        rx={50}
        ry={30}
        fill="none"
        stroke="var(--authority-solid)"
        strokeOpacity={0.35}
        strokeWidth={1.2}
        strokeDasharray="0.1 6"
        strokeLinecap="round"
      />
      <g strokeLinecap="round">
        <path d="M52 68 L92 28" stroke="url(#acx-cg-trail)" strokeWidth={2.4} />
        <path d="M58 76 L88 46" stroke="url(#acx-cg-trail)" strokeWidth={1.5} opacity={0.7} />
        <path d="M44 60 L70 34" stroke="url(#acx-cg-trail)" strokeWidth={1.5} opacity={0.7} />
      </g>
      <circle cx={48} cy={72} r={7} fill="url(#acx-cg-head)" />
    </svg>
  );
}

export default function AuthorityCrossing({
  direction,
  label,
  quorum,
  quorumMet,
  members,
  onDone,
}: AuthorityCrossingProps) {
  const reduced = useReducedMotion();

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  // Duration is locked in at mount so a parent re-render (a fresh inline
  // onDone identity every AppShell render) never re-triggers this branch.
  const durationRef = useRef<number | null>(null);
  if (durationRef.current === null) durationRef.current = reduced ? REDUCED_MS : DURATION_MS;

  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), durationRef.current ?? DURATION_MS);
    return () => clearTimeout(timer);
    // Intentionally empty deps — see the durationRef/onDoneRef comments above:
    // this must fire exactly once, ~1500ms (or 300ms) after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reduced) {
    // Plain glass + the finished mark, no choreography and no colour: the old
    // reduced branch painted a solid near-black which flashed alien over the
    // paper theme. The glass pane sits OUTSIDE the fading wrapper — an
    // ancestor with animated opacity would demote it to its own backdrop
    // root and the blur would stop sampling the page.
    return (
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
        // Same colour rule as the full scenes: pinned to the DESTINATION
        // product's fixed var — indigo entering Legacy, gold coming home.
        style={{
          ['--authority-solid' as never]:
            direction === 'to-legacy' ? 'hsl(var(--product-legacy))' : 'hsl(var(--product-personal))',
        }}
      >
        <GlassPane ms={REDUCED_MS} />
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ duration: REDUCED_MS / 1000, times: [0, 0.25, 0.7, 1], ease: 'easeInOut' }}
        >
          {direction === 'to-legacy' ? (
            <ConstellationMark members={members} quorumMet={quorumMet} size={64} drawn={false} />
          ) : (
            <CometGlyph size={64} />
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <motion.div
      aria-hidden
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      className="pointer-events-none fixed inset-0 z-[90] overflow-hidden"
    >
      <GlassPane ms={DURATION_MS} />
      {direction === 'to-legacy' ? (
        <ToLegacyScene label={label} quorum={quorum} members={members} quorumMet={quorumMet} />
      ) : (
        <ToPersonalScene />
      )}
    </motion.div>
  );
}

/** PERSONAL → LEGACY — the council constellation assembles over the glass.
 *
 *  COLOUR (founder 2026-07-26, second correction — "intercambia los colores"):
 *  each crossing is PINNED to its destination product's fixed var instead of
 *  trusting the data-authority cascade. In practice the cascade's timing let
 *  this scene read gold; --product-legacy cannot: it never flips with the
 *  authority attribute and carries its own light-theme shade. Entering the
 *  vault = indigo, always. */
function ToLegacyScene({
  label,
  quorum,
  members,
  quorumMet,
}: {
  label?: string;
  quorum?: string;
  members?: number;
  quorumMet?: number;
}) {
  const { t } = useT();
  return (
    <div
      className="absolute inset-0"
      style={{ ['--authority-solid' as never]: 'hsl(var(--product-legacy))' }}
    >
      <Halo />

      {/* ambient sky — the same six twinkling stars as ever */}
      <svg
        viewBox="0 0 400 400"
        className="absolute inset-0 m-auto h-[86vmin] w-[86vmin] max-h-[520px] max-w-[520px]"
        aria-hidden
      >
        <motion.g animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: DURATION_S, times: [0, 0.25, 0.8, 1] }}>
          {AMBIENT_STARS.map(([x, y, d], i) => (
            <circle key={i} cx={x} cy={y} r={1.4} fill="var(--authority-solid)" className={`eicon-star ${d}`} />
          ))}
        </motion.g>
      </svg>

      {/* centre stack — element entrances are staggered above; the EXIT is
          this one shared envelope, so nothing lingers past 0.85 */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3"
        animate={{ opacity: [1, 1, 0] }}
        transition={{ duration: DURATION_S, times: [0, 0.85, 1], ease: 'easeInOut' }}
      >
        <ConstellationMark members={members} quorumMet={quorumMet} size={116} />

        {label ? (
          <motion.span
            className="relative text-sm font-medium tracking-wide text-ink/90"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: [0, 0, 1, 1], y: [8, 8, 0, 0] }}
            transition={{ duration: DURATION_S, times: [0, 0.42, 0.56, 1], ease: 'easeOut' }}
          >
            {label}
          </motion.span>
        ) : null}

        {quorum ? (
          <motion.span
            className="relative text-[11px] text-ink/55"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: [0, 0, 1, 1], y: [8, 8, 0, 0] }}
            transition={{ duration: DURATION_S, times: [0, 0.5, 0.64, 1], ease: 'easeOut' }}
          >
            {t('quorum')} {quorum}
          </motion.span>
        ) : null}
      </motion.div>
    </div>
  );
}

// The departure constellation to-personal releases — decorative (the governed
// account is already gone by the time this fires), so the default 3-of-5 sky.
const RELEASE_STARS = councilStars(5, 3, 200, 52);

/** LEGACY → PERSONAL — the pact CIRCLE un-draws and the comet crosses the
 *  CENTRE (founder 2026-07-26): the old star-to-star polygon read as a
 *  hexagon, and the comet — born at the ring's top and exiting up-right —
 *  left the whole gesture shifted off-centre. Now the release ring is a
 *  circle over the dashed table, and the asteroid comes AND goes through the
 *  exact middle of the screen: in from the lower-left, a beat at centre,
 *  out to the upper-right.
 *
 *  COLOUR (founder 2026-07-26, second correction — "intercambia los
 *  colores"): pinned to the DESTINATION product's fixed var, like the scene
 *  above — coming home to Personal wears GOLD, always, regardless of what
 *  the data-authority cascade happens to resolve mid-flip. */
function ToPersonalScene() {
  const { t } = useT();
  return (
    <div
      className="absolute inset-0"
      style={{ ['--authority-solid' as never]: 'hsl(var(--product-personal))' }}
    >
      <Halo />

      <svg
        viewBox="0 0 400 400"
        className="absolute inset-0 m-auto h-[86vmin] w-[86vmin] max-h-[520px] max-w-[520px]"
        aria-hidden
      >
        <defs>
          <radialGradient id="acx-head" cx="0.35" cy="0.3" r="1">
            <stop offset="0%" stopColor="#FFFDF4" />
            <stop offset="55%" stopColor="var(--authority-solid)" />
            <stop offset="100%" stopColor="var(--authority-solid)" stopOpacity="0.15" />
          </radialGradient>
          <linearGradient id="acx-trail" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--authority-solid)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--authority-solid)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* everything shares ONE envelope: quick fade-in, held, gone by 1 */}
        <motion.g animate={{ opacity: [0, 1, 1, 0] }} transition={{ duration: DURATION_S, times: [0, 0.1, 0.84, 1] }}>
          {/* ambient sky */}
          {AMBIENT_STARS.map(([x, y, d], i) => (
            <circle key={i} cx={x} cy={y} r={1.5} fill="var(--authority-solid)" className={`eicon-star ${d}`} />
          ))}

          {/* the home orbit waiting ahead, barely turning */}
          <motion.circle
            cx={200}
            cy={200}
            r={128}
            fill="none"
            stroke="var(--authority-solid)"
            strokeWidth={1.1}
            strokeDasharray="0.1 7"
            strokeLinecap="round"
            style={{ transformOrigin: '200px 200px' }}
            initial={{ opacity: 0, rotate: 0 }}
            animate={{ opacity: [0, 0, 0.4, 0.4], rotate: [0, 0, 12, 18] }}
            transition={{ duration: DURATION_S, times: [0, 0.3, 0.6, 1], ease: 'easeInOut' }}
          />

          {/* the council's table dissolves early */}
          <motion.circle
            cx={200}
            cy={200}
            r={52}
            fill="none"
            stroke="var(--authority-solid)"
            strokeWidth={1.2}
            strokeDasharray="0.1 6"
            strokeLinecap="round"
            initial={{ opacity: 0.3 }}
            animate={{ opacity: [0.3, 0.3, 0, 0] }}
            transition={{ duration: DURATION_S, times: [0, 0.2, 0.45, 1], ease: 'easeInOut' }}
          />

          {/* the pact — a CIRCLE that un-draws over the dashed table (was the
              star-to-star polygon, which read as a hexagon — founder
              2026-07-26) */}
          <motion.circle
            cx={200}
            cy={200}
            r={52}
            fill="none"
            stroke="var(--authority-solid)"
            strokeWidth={1.2}
            strokeLinecap="round"
            initial={{ pathLength: 1, opacity: 0.5 }}
            animate={{ pathLength: [1, 1, 0, 0], opacity: [0.5, 0.5, 0.2, 0] }}
            transition={{ duration: DURATION_S, times: [0, 0.18, 0.5, 1], ease: EASE_OUT_EXPO }}
          />

          {/* the signers dim and let go while the asteroid crosses */}
          {RELEASE_STARS.map((s, i) => (
            <motion.g
              key={i}
              initial={{ opacity: 0.9 }}
              animate={{ opacity: [0.9, 0.9, 0, 0] }}
              transition={{
                duration: DURATION_S,
                times: [0, 0.25 + i * 0.02, 0.5 + i * 0.03, 1],
                ease: 'easeInOut',
              }}
            >
              {s.lit ? (
                <path d={starPath(s.x, s.y, 4)} fill="var(--authority-solid)" className={`eicon-star ${TWINKLE[i % 4]}`} />
              ) : (
                <circle cx={s.x} cy={s.y} r={1.8} fill="var(--authority-solid)" fillOpacity={0.35} />
              )}
            </motion.g>
          ))}

          {/* the homeward asteroid — head + CometMark's cauda travel as one
              group THROUGH the exact centre: in from the lower-left, a beat
              at (200,200), out to the upper-right. The head sits at local
              (200,200), so the pause IS the centre of the screen. */}
          <motion.g
            initial={{ x: -84, y: 62, opacity: 0 }}
            animate={{ x: [-84, -84, 0, 0, 84], y: [62, 62, 0, 0, -62], opacity: [0, 0, 1, 1, 0] }}
            transition={{
              duration: DURATION_S,
              default: { duration: DURATION_S, times: [0, 0.12, 0.42, 0.6, 0.95], ease: 'easeInOut' },
              opacity: { duration: DURATION_S, times: [0, 0.12, 0.3, 0.82, 1], ease: 'easeInOut' },
            }}
          >
            <path d="M196 203 L172 221" stroke="url(#acx-trail)" strokeWidth={2.2} strokeLinecap="round" />
            <path d="M199 206 L182 220" stroke="url(#acx-trail)" strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
            <path d="M193 199 L176 212" stroke="url(#acx-trail)" strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
            <circle cx={200} cy={200} r={6} fill="url(#acx-head)" />
          </motion.g>
        </motion.g>
      </svg>

      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        animate={{ opacity: [1, 1, 0] }}
        transition={{ duration: DURATION_S, times: [0, 0.85, 1], ease: 'easeInOut' }}
      >
        <motion.span
          className="mt-40 text-sm font-medium tracking-wide text-ink/85"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: [0, 0, 1, 1], y: [6, 6, 0, 0] }}
          transition={{ duration: DURATION_S, times: [0, 0.45, 0.6, 1], ease: 'easeOut' }}
        >
          {t('Personal')}
        </motion.span>
      </motion.div>
    </div>
  );
}

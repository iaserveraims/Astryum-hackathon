'use client';

/**
 * SignedMark — the signature ceremony, INLINE (founder 2026-08-08: the
 * full-screen SignedCelebration overlay "aparece de golpe y se pone todo el
 * fondo borroso" — the ceremony now lives inside each operation's own
 * progress view instead of taking over the shell).
 *
 * Same vocabulary as the retired overlay (and the login manifest before it):
 * the user's quick stroke drawing itself, the circular seal stamping down,
 * four-point star sparks, the house ease. It plays ONCE on mount and then
 * RESTS as the drawn autograph — no exit, no unmount: the mark stays put as
 * the operation's "signed" emblem while settlement continues around it.
 *
 * Colours ride currentColor from a `text-volt` wrapper, so it is gold under
 * Personal and indigo under Legacy, and readable over the light QR panel too.
 * Reduced motion renders the finished mark statically.
 *
 * Mounted from SettlementIndicator (every EVM/Flare operation's progress
 * block) and XamanQRModal's signed cover (every XRPL signature) — together,
 * every operation plays it exactly where its process is shown.
 */

import { motion, useReducedMotion } from 'framer-motion';

const EASE = [0.16, 1, 0.3, 1] as const;
const DURATION_S = 1.35;

// The user's quick stroke — the same autograph the login manifest countersigns.
const SIGN_STROKE =
  'M 6 27 C 13 10, 21 7, 23.5 13.5 C 25.5 19, 18.5 26, 25 26 C 33 26, 36.5 13.5, 44 14.5 C 50 15.3, 47.5 24, 55 22.5 C 64 20.7, 68 13, 77 12 C 85 11.2, 92 12.5, 98 10.5';

/** Four-point star (AuthorityCrossing vocabulary), centred on (0,0). */
const star = (r: number) =>
  `M 0 ${-r} L ${r * 0.22} ${-r * 0.22} L ${r} 0 L ${r * 0.22} ${r * 0.22} L 0 ${r} L ${-r * 0.22} ${r * 0.22} L ${-r} 0 L ${-r * 0.22} ${-r * 0.22} Z`;

// Tighter constellation than the overlay's — this mark lives inside a card.
const SPARKS: Array<{ x: number; y: number; r: number; at: number }> = [
  { x: -58, y: -22, r: 4, at: 0.38 },
  { x: 62, y: -30, r: 3.2, at: 0.5 },
  { x: 48, y: 24, r: 2.8, at: 0.6 },
  { x: -44, y: 28, r: 2.4, at: 0.54 },
];

function Seal({ animated, size }: { animated: boolean; size: number }) {
  const svg = (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2" strokeDasharray="0.1 5" strokeLinecap="round" />
      <circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      <path d="M38 51l8 8 16-17" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (!animated) return <div className="-rotate-[8deg]">{svg}</div>;
  return (
    <motion.div
      // Stamp: hovers in large, drops onto the stroke as it finishes drawing.
      animate={{ scale: [1.5, 1.5, 1, 1], rotate: [-16, -16, -8, -8], opacity: [0, 0, 1, 1] }}
      transition={{ duration: DURATION_S, times: [0, 0.4, 0.58, 1], ease: EASE }}
    >
      {svg}
    </motion.div>
  );
}

/**
 * The inline ceremony. `compact` fits the QR-sized cover (Xaman); default
 * fits the settlement indicator block. It never unmounts itself — keep it
 * mounted in a STABLE slot so status re-renders don't replay it.
 */
export function SignedMark({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const reduced = useReducedMotion() ?? false;
  const strokeW = compact ? 108 : 148;
  const strokeH = compact ? 36 : 50;
  const sealSize = compact ? 40 : 52;

  return (
    <div className={`relative inline-flex items-center justify-center text-volt ${className}`} aria-hidden>
      {/* star sparks — ignite around the stroke, each on its own window */}
      <svg
        className="pointer-events-none absolute -inset-8 h-[calc(100%+4rem)] w-[calc(100%+4rem)]"
        viewBox="-78 -46 156 92"
        aria-hidden
      >
        {SPARKS.map((s, i) =>
          reduced ? (
            <path key={i} d={star(s.r)} transform={`translate(${s.x} ${s.y})`} fill="currentColor" opacity={0.45} />
          ) : (
            <motion.path
              key={i}
              d={star(s.r)}
              transform={`translate(${s.x} ${s.y})`}
              fill="currentColor"
              animate={{ opacity: [0, 0, 0.8, 0.35], scale: [0.4, 0.4, 1, 1] }}
              transition={{ duration: DURATION_S, times: [0, s.at, s.at + 0.12, 1], ease: EASE }}
            />
          ),
        )}
      </svg>

      <div className="relative">
        <svg width={strokeW} height={strokeH} viewBox="0 0 104 34" fill="none" aria-hidden>
          {/* resting hint under the live stroke — SignatureScene grammar */}
          <path d={SIGN_STROKE} stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.7" strokeLinecap="round" />
          {reduced ? (
            <path d={SIGN_STROKE} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          ) : (
            <motion.path
              d={SIGN_STROKE}
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: [0, 0, 1, 1] }}
              transition={{ duration: DURATION_S, times: [0, 0.08, 0.52, 1], ease: 'easeInOut' }}
            />
          )}
        </svg>
        <div className={`absolute ${compact ? '-right-6 -top-5' : '-right-8 -top-6'}`}>
          <Seal animated={!reduced} size={sealSize} />
        </div>
      </div>
    </div>
  );
}

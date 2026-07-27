'use client';

/**
 * Astryum's own visual voice for the Earn surface — not icons in boxes but
 * SCENES that live inside their panels, drawn from the landing's world:
 *
 *   OrbitScene         — a miniature solar system (two live orbits, glowing
 *                        planets, a gold sun): the ready-made, audited
 *                        strategies — capital on proven trajectories.
 *   ConstellationScene — scattered stars over deep space; hovering the door
 *                        draws the line that joins them into one path: the
 *                        agent compiling your words into a strategy.
 *   CometMark          — a comet with a real tapered trail: the strategies
 *                        YOU created, your own trajectory through the app.
 *   MoonScene          — a waning moon behind its orbit ring: capital set
 *                        aside, resting in shadow until its unlock date
 *                        (the Savings door).
 *   FlowForgeScene     — a moneyflow diagram assembling itself node by node;
 *                        hovering the door draws the connecting rail: you
 *                        building a strategy with your own hands
 *                        (the Create Manually door).
 *
 * All animation is CSS (globals.css `.escene-*`), constant-speed (changing
 * durations mid-flight makes phases jump), disabled under
 * prefers-reduced-motion.
 */

export function OrbitScene({ size = 168 }: { size?: number }) {
  // Brand-accent scene: token-driven (product re-tint) — currentColor +
  // gradient stops via style, same pattern as ui/scenes.tsx.
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="os-sun" cx="0.38" cy="0.32" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="45%" style={{ stopColor: 'hsl(var(--volt-soft))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
        <radialGradient id="os-planet" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="50%" style={{ stopColor: 'hsl(var(--volt))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
      </defs>

      {/* the sun — Astryum, softly haloed */}
      <circle className="text-volt-soft" cx="84" cy="84" r="17" fill="currentColor" fillOpacity="0.14" />
      <circle cx="84" cy="84" r="9" fill="url(#os-sun)" />

      {/* outer orbit + planet, slow */}
      <g className="escene-spin-a" style={{ transformOrigin: '84px 84px' }}>
        <circle
          cx="84"
          cy="84"
          r="66"
          stroke="currentColor"
          strokeOpacity="0.28"
          strokeWidth="1.1"
          strokeDasharray="0.1 6"
          strokeLinecap="round"
        />
        <circle className="text-volt-soft" cx="84" cy="18" r="10" fill="currentColor" fillOpacity="0.16" />
        <circle cx="84" cy="18" r="5" fill="url(#os-planet)" />
      </g>

      {/* inner orbit + smaller planet, counter-rotation */}
      <g className="escene-spin-b" style={{ transformOrigin: '84px 84px' }}>
        <circle
          cx="84"
          cy="84"
          r="40"
          stroke="currentColor"
          strokeOpacity="0.34"
          strokeWidth="1.1"
          strokeDasharray="0.1 5"
          strokeLinecap="round"
        />
        <circle className="text-volt-soft" cx="124" cy="84" r="7" fill="currentColor" fillOpacity="0.16" />
        <circle cx="124" cy="84" r="3.6" fill="url(#os-planet)" />
      </g>
    </svg>
  );
}

export function ConstellationScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  // Star coordinates — the path visits them in order and resolves into the
  // bright four-point star (the compiled strategy).
  const pts = '14,118 52,84 88,102 118,58 152,66 168,26';
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden>
      {/* faint resting hint of the path */}
      <polyline points={pts} stroke="rgba(125,211,252,0.14)" strokeWidth="1" strokeLinejoin="round" />
      {/* the line that DRAWS itself when the door is hovered */}
      <polyline
        className="escene-draw"
        points={pts}
        stroke="rgba(125,211,252,0.75)"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* star nodes — twinkle staggered */}
      <circle className="eicon-star" cx="14" cy="118" r="2.2" fill="#BAE6FD" />
      <circle className="eicon-star eicon-d2" cx="52" cy="84" r="1.7" fill="#BAE6FD" />
      <circle className="eicon-star eicon-d3" cx="88" cy="102" r="2" fill="#BAE6FD" />
      <circle className="eicon-star eicon-d1" cx="118" cy="58" r="1.6" fill="#BAE6FD" />
      <circle className="eicon-star eicon-d2" cx="152" cy="66" r="1.8" fill="#BAE6FD" />
      {/* loose background stars for depth */}
      <circle className="eicon-star eicon-d3" cx="38" cy="30" r="1.1" fill="rgba(186,230,253,0.5)" />
      <circle className="eicon-star eicon-d1" cx="150" cy="120" r="1.2" fill="rgba(186,230,253,0.5)" />
      <circle className="eicon-star" cx="98" cy="18" r="1" fill="rgba(186,230,253,0.45)" />
      {/* the bright star the path resolves to */}
      <path
        className="eicon-star eicon-d1"
        d="M168 14l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4 2.4-6Z"
        fill="#7DD3FC"
      />
    </svg>
  );
}

export function MoonScene({ size = 160 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden>
      <defs>
        <radialGradient id="ms-moon" cx="0.32" cy="0.28" r="1">
          <stop offset="0%" stopColor="#F0FDF9" />
          <stop offset="48%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#053B2F" />
        </radialGradient>
      </defs>

      {/* the orbit the moon rests on — the lock period, slow */}
      <g className="escene-spin-a" style={{ transformOrigin: '80px 80px' }}>
        <circle
          cx="80"
          cy="80"
          r="62"
          stroke="rgba(52,211,153,0.26)"
          strokeWidth="1.1"
          strokeDasharray="0.1 6"
          strokeLinecap="round"
        />
        {/* the unlock marker waiting further along the orbit */}
        <circle cx="80" cy="18" r="3.4" stroke="rgba(110,231,183,0.7)" strokeWidth="1.1" />
      </g>

      {/* the moon — lit sphere with the waning shadow of the lock */}
      <circle cx="80" cy="80" r="30" fill="rgba(52,211,153,0.12)" />
      <circle cx="80" cy="80" r="21" fill="url(#ms-moon)" />
      <circle cx="88" cy="76" r="21" fill="rgba(6,20,16,0.55)" />

      {/* craters on the lit sliver */}
      <circle cx="68" cy="74" r="2.6" fill="rgba(5,59,47,0.55)" />
      <circle cx="72" cy="88" r="1.8" fill="rgba(5,59,47,0.5)" />

      {/* resting stars */}
      <circle className="eicon-star" cx="30" cy="38" r="1.2" fill="rgba(110,231,183,0.6)" />
      <circle className="eicon-star eicon-d2" cx="132" cy="52" r="1" fill="rgba(110,231,183,0.55)" />
      <circle className="eicon-star eicon-d1" cx="118" cy="126" r="1.3" fill="rgba(110,231,183,0.5)" />
      <circle className="eicon-star eicon-d3" cx="44" cy="122" r="0.9" fill="rgba(110,231,183,0.45)" />
    </svg>
  );
}

export function FlowForgeScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  // A moneyflow being assembled by hand: source → condition → action, the
  // rail drawing itself under attention (same gesture as the constellation).
  const rail = '20,120 66,120 66,74 118,74 118,34 168,34';
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden>
      {/* faint resting hint of the rail */}
      <polyline points={rail} stroke="rgba(251,191,36,0.16)" strokeWidth="1" strokeLinejoin="round" />
      {/* the rail that DRAWS itself when the door is hovered */}
      <polyline
        className="escene-draw"
        points={rail}
        stroke="rgba(251,191,36,0.75)"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* the three nodes of the flow — source, condition, action */}
      <rect x="12" y="112" width="16" height="16" rx="4" stroke="rgba(252,211,77,0.8)" strokeWidth="1.2" fill="rgba(251,191,36,0.10)" />
      <rect className="eicon-star eicon-d1" x="58" y="66" width="16" height="16" rx="8" stroke="rgba(252,211,77,0.7)" strokeWidth="1.2" fill="rgba(251,191,36,0.08)" />
      <rect className="eicon-star eicon-d2" x="110" y="26" width="16" height="16" rx="4" stroke="rgba(252,211,77,0.8)" strokeWidth="1.2" fill="rgba(251,191,36,0.10)" />
      {/* the spark where the flow completes */}
      <path
        className="eicon-star eicon-d3"
        d="M168 26l2.2 5.6 5.6 2.2-5.6 2.2-2.2 5.6-2.2-5.6-5.6-2.2 5.6-2.2 2.2-5.6Z"
        fill="#FCD34D"
      />
      {/* loose sparks for depth */}
      <circle className="eicon-star" cx="40" cy="42" r="1.1" fill="rgba(252,211,77,0.5)" />
      <circle className="eicon-star eicon-d2" cx="150" cy="118" r="1.2" fill="rgba(252,211,77,0.45)" />
    </svg>
  );
}

export function CometMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <radialGradient id="cm-head" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#ECFDF5" />
          <stop offset="50%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#064E3B" />
        </radialGradient>
        <linearGradient id="cm-trail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(52,211,153,0.85)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0)" />
        </linearGradient>
      </defs>
      {/* tapered trail — three strokes fading toward where it came from */}
      <g className="eicon-trail" strokeLinecap="round">
        <path d="M18 22 34 6" stroke="url(#cm-trail)" strokeWidth="2.4" />
        <path d="M21 26 33 14" stroke="url(#cm-trail)" strokeWidth="1.5" opacity="0.7" />
        <path d="M14 18 24 8" stroke="url(#cm-trail)" strokeWidth="1.5" opacity="0.7" />
      </g>
      {/* the head — lit sphere with halo */}
      <circle cx="13" cy="27" r="9" fill="rgba(52,211,153,0.14)" />
      <circle cx="13" cy="27" r="5.2" fill="url(#cm-head)" />
      {/* dust sparkles along the trail */}
      <circle className="eicon-star eicon-d2" cx="28" cy="16" r="1" fill="#6EE7B7" />
      <circle className="eicon-star" cx="22" cy="12" r="0.8" fill="#6EE7B7" />
    </svg>
  );
}

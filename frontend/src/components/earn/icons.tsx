'use client';

/**
 * Astryum's own visual voice for the Earn surface — not icons in boxes but
 * SCENES that live inside their panels, drawn from the landing's world:
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

/**
 * StewardScene — the third Earn door: capital run by someone else, inside a
 * boundary they cannot cross.
 */
export function StewardScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden>
      <defs>
        <radialGradient id="sw-node" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#EDE9FE" />
          <stop offset="55%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#4C1D95" />
        </radialGradient>
      </defs>

      {/* the boundary — solid, closed, faintly filled: a wall, not an orbit */}
      <circle cx="95" cy="75" r="58" fill="rgba(167,139,250,0.05)" />
      <circle cx="95" cy="75" r="58" stroke="rgba(167,139,250,0.45)" strokeWidth="1.3" />
      {/* a second, tighter line so the wall reads as thickness rather than path */}
      <circle cx="95" cy="75" r="53.5" stroke="rgba(167,139,250,0.16)" strokeWidth="1" />

      {/* the signals the steward sends — they reach the capital and stop
          short of the wall; none of them leaves the circle */}
      <g stroke="rgba(196,181,253,0.6)" strokeWidth="1.1" strokeLinecap="round">
        <line className="escene-signal" x1="95" y1="75" x2="62" y2="49" />
        <line className="escene-signal" x1="95" y1="75" x2="132" y2="62" />
        <line className="escene-signal" x1="95" y1="75" x2="86" y2="118" />
      </g>

      {/* the capital under management — drifting, each at its own pace */}
      <g className="escene-drift">
        <circle cx="62" cy="49" r="9" fill="rgba(167,139,250,0.14)" />
        <circle cx="62" cy="49" r="4.6" fill="#C4B5FD" />
      </g>
      <g className="escene-drift escene-drift-b">
        <circle cx="132" cy="62" r="7.5" fill="rgba(167,139,250,0.14)" />
        <circle cx="132" cy="62" r="3.8" fill="#C4B5FD" />
      </g>
      <g className="escene-drift escene-drift-c">
        <circle cx="86" cy="118" r="8" fill="rgba(167,139,250,0.14)" />
        <circle cx="86" cy="118" r="4.1" fill="#C4B5FD" />
      </g>

      {/* the steward — inside the wall, brighter, holding the lever */}
      <circle cx="95" cy="75" r="15" fill="rgba(167,139,250,0.12)" />
      <circle cx="95" cy="75" r="8" fill="url(#sw-node)" />
    </svg>
  );
}

/**
 * AccretionScene — the earning door. A planet sits INSIDE its accretion disk
 * and the disk turns, dust spiralling in: capital in orbit gathering more.
 * No tether, no stream leaving — nothing here can be pulled or liquidated,
 * which is exactly the typology's promise-free fact.
 */
export function AccretionScene({ size = 168 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="ac-core" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="50%" style={{ stopColor: 'hsl(var(--volt))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
      </defs>

      {/* the planet — the capital, softly haloed */}
      <circle className="text-volt-soft" cx="84" cy="84" r="20" fill="currentColor" fillOpacity="0.14" />
      <circle cx="84" cy="84" r="11" fill="url(#ac-core)" />

      {/* the accretion disk — tilted, turning; dust rendered as dashed rings
          of decreasing radius so the whole disk reads as matter spiralling in */}
      <g className="escene-spin-a" style={{ transformOrigin: '84px 84px' }}>
        <g transform="rotate(-18 84 84)">
          <ellipse cx="84" cy="84" rx="70" ry="26" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.1" strokeDasharray="0.1 7" strokeLinecap="round" />
          <ellipse cx="84" cy="84" rx="55" ry="20" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" strokeDasharray="0.1 9" strokeLinecap="round" />
          <ellipse cx="84" cy="84" rx="40" ry="14.5" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.3" strokeDasharray="0.1 12" strokeLinecap="round" />
        </g>
      </g>
      {/* grains being gathered — twinkling along the disk plane */}
      <circle className="eicon-star" cx="26" cy="66" r="1.8" fill="currentColor" fillOpacity="0.75" />
      <circle className="eicon-star eicon-d2" cx="140" cy="104" r="1.5" fill="currentColor" fillOpacity="0.65" />
      <circle className="eicon-star eicon-d1" cx="120" cy="52" r="1.3" fill="currentColor" fillOpacity="0.6" />
      <circle className="eicon-star eicon-d3" cx="48" cy="116" r="1.4" fill="currentColor" fillOpacity="0.6" />
    </svg>
  );
}

/**
 * TetherScene — the borrow door. The asset stays HELD inside a closed ring
 * (the collateral never leaves) while a stream of light flows out of it and
 * resolves into a bright star (the cash). The dashed tether under the stream
 * says the honest part: what left is still tied to what stayed — it can be
 * called back. Hovering draws the stream.
 */
export function TetherScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  const stream = 'M66 75 C 96 62, 118 56, 150 40';
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="tt-asset" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="50%" style={{ stopColor: 'hsl(var(--volt))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
      </defs>

      {/* the collateral — held: a CLOSED ring, no gap */}
      <circle cx="46" cy="86" r="34" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.3" />
      <circle className="text-volt-soft" cx="46" cy="86" r="17" fill="currentColor" fillOpacity="0.14" />
      <circle cx="46" cy="86" r="10" fill="url(#tt-asset)" />

      {/* the tether — what flowed out is still tied to what stayed */}
      <path d="M74 96 C 104 92, 126 80, 148 52" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2 5" strokeLinecap="round" />

      {/* the stream of liquidity — draws itself under attention */}
      <path className="escene-draw" d={stream} stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.3" strokeLinecap="round" />
      <circle className="eicon-star" cx="92" cy="65" r="1.7" fill="currentColor" fillOpacity="0.8" />
      <circle className="eicon-star eicon-d1" cx="114" cy="57" r="1.5" fill="currentColor" fillOpacity="0.7" />
      <circle className="eicon-star eicon-d2" cx="134" cy="48" r="1.3" fill="currentColor" fillOpacity="0.65" />

      {/* the cash — a bright four-point star, arrived */}
      <path className="eicon-star eicon-d1" d="M156 26l2.6 6.6 6.6 2.6-6.6 2.6-2.6 6.6-2.6-6.6-6.6-2.6 6.6-2.6 2.6-6.6Z" fill="currentColor" fillOpacity="0.9" />
      <circle className="eicon-star eicon-d3" cx="170" cy="60" r="1.2" fill="currentColor" fillOpacity="0.5" />
    </svg>
  );
}

/**
 * HelmScene — the managed door, redrawn to say its mechanism: a SOLID walled
 * ring with graduation ticks (the limits you signed, marked on the wall) and
 * inside it a steward star running a fixed inner track around the capital.
 * Someone else steers; no line crosses the wall — same claim StewardScene
 * made, now with the limits visible instead of implied.
 */
export function HelmScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  // Tick marks on the inside of the wall, every 30°.
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180;
    const x1 = 95 + Math.cos(a) * 62, y1 = 75 + Math.sin(a) * 62;
    const x2 = 95 + Math.cos(a) * 56, y2 = 75 + Math.sin(a) * 56;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="hm-cap" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="50%" style={{ stopColor: 'hsl(var(--volt))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
      </defs>

      {/* the wall — solid, unbroken, with its graduation */}
      <circle cx="95" cy="75" r="64" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.6" />
      <path d={ticks} stroke="currentColor" strokeOpacity="0.28" strokeWidth="1" strokeLinecap="round" />

      {/* the capital, resting at centre */}
      <circle className="text-volt-soft" cx="95" cy="75" r="14" fill="currentColor" fillOpacity="0.14" />
      <circle cx="95" cy="75" r="8" fill="url(#hm-cap)" />

      {/* the steward — runs a FIXED inner track; never touches the wall */}
      <g className="escene-spin-b" style={{ transformOrigin: '95px 75px' }}>
        <circle cx="95" cy="75" r="38" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="0.1 6" strokeLinecap="round" />
        <circle className="text-volt-soft" cx="95" cy="37" r="6.5" fill="currentColor" fillOpacity="0.16" />
        <circle cx="95" cy="37" r="3.4" fill="url(#hm-cap)" />
      </g>
    </svg>
  );
}

/**
 * HarvestSunScene v3 — la cosecha, con factura de landing. Un sol de tres
 * halos (el exterior con blur de verdad) que SE ENCIENDE y crece bajo
 * atención; corona de rayos que despierta; dos órbitas en contrarrotación
 * —una elíptica inclinada, una circular— cargando motas con estela; polvo
 * intermedio parpadeando; y la espiral de caída que se dibuja al hover:
 * todo cae HACIA dentro. Rendir = acumulación; nada sale, nada tira.
 */
export function HarvestSunScene({ size = 168 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="hv3-core" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="45%" style={{ stopColor: 'hsl(var(--volt-soft))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
        <filter id="hv3-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* deep-space dust — the landing's backdrop, in miniature */}
      <circle className="eicon-star" cx="18" cy="26" r="1" fill="currentColor" fillOpacity="0.4" />
      <circle className="eicon-star eicon-d2" cx="146" cy="18" r="1.2" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d1" cx="156" cy="132" r="0.9" fill="currentColor" fillOpacity="0.4" />
      <circle className="eicon-star eicon-d3" cx="24" cy="148" r="1.1" fill="currentColor" fillOpacity="0.3" />
      <circle className="eicon-star eicon-d2" cx="90" cy="10" r="0.8" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d1" cx="10" cy="88" r="0.9" fill="currentColor" fillOpacity="0.3" />

      {/* the sun — blurred outer halo FLARES under attention */}
      <circle
        className="text-volt-soft transition-all duration-700 opacity-30 group-hover:opacity-80"
        style={{ transformOrigin: '84px 84px' }}
        cx="84" cy="84" r="24" fill="currentColor" filter="url(#hv3-blur)"
      />
      {/* corona — eight rays that wake up AND reach out (pop wrapper OUTSIDE
          the spinner: the spin keyframes own that transform, so the scale
          lives on its own layer or it would be overridden) */}
      <g className="transition-transform duration-1000 group-hover:scale-110" style={{ transformOrigin: '84px 84px' }}>
        <g
          className="escene-spin-slower transition-opacity duration-700 opacity-40 group-hover:opacity-90"
          style={{ transformOrigin: '84px 84px' }}
          stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"
        >
          <path d="M84 64 L84 58" /><path d="M84 104 L84 110" />
          <path d="M64 84 L58 84" /><path d="M104 84 L110 84" />
          <path d="M70 70 L65.5 65.5" /><path d="M98 98 L102.5 102.5" />
          <path d="M98 70 L102.5 65.5" /><path d="M70 98 L65.5 102.5" />
        </g>
      </g>
      {/* the body itself SWELLS under attention — a sun fed, not a lamp lit */}
      <g className="escene-pop">
        <circle className="text-volt-soft" cx="84" cy="84" r="15" fill="currentColor" fillOpacity="0.22" />
        <circle cx="84" cy="84" r="10" fill="url(#hv3-core)" />
      </g>

      {/* outer orbit — tilted ellipse, slow; the boost wrapper ADDS rotation
          under the cursor (starts at 0°: no phase jump), so the whole system
          visibly hurries when watched and relaxes when left */}
      <g className="escene-boost-a" style={{ transformOrigin: '84px 84px' }}>
        <g className="escene-spin-a" style={{ transformOrigin: '84px 84px' }}>
          <g transform="rotate(-16 84 84)">
            <ellipse cx="84" cy="84" rx="68" ry="26" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.1" strokeDasharray="0.1 6" strokeLinecap="round" />
          </g>
          <path d="M152 84 Q150 74 144 68" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1" strokeLinecap="round" fill="none" />
          <circle className="text-volt-soft" cx="152" cy="84" r="4.5" fill="currentColor" fillOpacity="0.18" />
          <circle cx="152" cy="84" r="2.4" fill="url(#hv3-core)" />
          <circle cx="16" cy="84" r="1.8" fill="currentColor" fillOpacity="0.55" />
        </g>
      </g>

      {/* inner orbit — counter-rotating, faster; counter-boost to match */}
      <g className="escene-boost-b" style={{ transformOrigin: '84px 84px' }}>
        <g className="escene-spin-b" style={{ transformOrigin: '84px 84px' }}>
          <circle cx="84" cy="84" r="42" stroke="currentColor" strokeOpacity="0.34" strokeWidth="1.1" strokeDasharray="0.1 5" strokeLinecap="round" />
          <path d="M84 42 Q90 44 94 49" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.9" strokeLinecap="round" fill="none" />
          <circle cx="84" cy="42" r="2" fill="url(#hv3-core)" />
          <circle cx="84" cy="126" r="1.5" fill="currentColor" fillOpacity="0.5" />
        </g>
      </g>

      {/* dust being gathered, mid-fall between the rings */}
      <circle className="eicon-star" cx="52" cy="58" r="1.4" fill="currentColor" fillOpacity="0.6" />
      <circle className="eicon-star eicon-d3" cx="120" cy="112" r="1.3" fill="currentColor" fillOpacity="0.55" />
      <circle className="eicon-star eicon-d1" cx="116" cy="56" r="1.1" fill="currentColor" fillOpacity="0.5" />

      {/* the infall — the line still draws under attention, but the HARVEST
          is grains actually FALLING along it (native animateMotion — path
          inline, no ids to collide): dim in the idle scene, lit when watched */}
      <path
        className="escene-draw"
        d="M150 40 C 128 44, 112 58, 104 70 C 99 77 95 80 92 82"
        stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.1" strokeLinecap="round" fill="none"
      />
      <circle className="escene-mote opacity-40 group-hover:opacity-95" r="2" fill="url(#hv3-core)">
        <animateMotion dur="4.2s" repeatCount="indefinite" path="M150 40 C 128 44, 112 58, 104 70 C 99 77 95 80 92 82" />
      </circle>
      <circle className="escene-mote opacity-30 group-hover:opacity-70" r="1.2" fill="currentColor">
        <animateMotion dur="4.2s" begin="-2.1s" repeatCount="indefinite" path="M150 40 C 128 44, 112 58, 104 70 C 99 77 95 80 92 82" />
      </circle>
    </svg>
  );
}

/**
 * CollateralScene v3 — el préstamo, con factura de landing. El activo vive
 * dentro de DOS anillos (el interior gira despacio) sobre arcos de pozo
 * gravitatorio; su candado — forjado en el propio anillo — se enciende bajo
 * atención. El haz de liquidez es doble (un resplandor ancho con blur + el
 * trazo vivo que se dibuja al hover) y desemboca en una moneda-estrella con
 * su aro girando en contra, que CRECE al mirarla. La cadena de vuelta lleva
 * eslabones que parpadean en secuencia: lo que salió sigue atado.
 */
export function CollateralScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="cl3-core" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="50%" style={{ stopColor: 'hsl(var(--volt))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
        <filter id="cl3-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* backdrop dust */}
      <circle className="eicon-star" cx="14" cy="20" r="1" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d2" cx="96" cy="12" r="1.1" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d1" cx="180" cy="96" r="0.9" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d3" cx="120" cy="140" r="1" fill="currentColor" fillOpacity="0.3" />
      <circle className="eicon-star eicon-d1" cx="12" cy="132" r="0.9" fill="currentColor" fillOpacity="0.3" />

      {/* gravity well — two faint arcs the planet rests in */}
      <path d="M8 122 Q46 138 86 124" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" fill="none" />
      <path d="M16 132 Q46 144 78 133" stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" fill="none" />

      {/* the collateral — held in two rings; the whole assembly LEANS IN a
          touch under attention, and its live ring hurries (additive boost) */}
      <g className="transition-transform duration-1000 group-hover:scale-105" style={{ transformOrigin: '46px 88px' }}>
        <circle className="text-volt-soft opacity-25 transition-opacity duration-700 group-hover:opacity-50" cx="46" cy="88" r="18" fill="currentColor" filter="url(#cl3-blur)" />
        <circle cx="46" cy="88" r="34" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.3" />
        <g className="escene-boost-a" style={{ transformOrigin: '46px 88px' }}>
          <g className="escene-spin-c" style={{ transformOrigin: '46px 88px' }}>
            <circle cx="46" cy="88" r="26" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="0.1 5" strokeLinecap="round" />
            <circle cx="46" cy="62" r="1.6" fill="currentColor" fillOpacity="0.55" />
          </g>
        </g>
        <circle cx="46" cy="88" r="11" fill="url(#cl3-core)" />
        {/* anchor ticks — the ring is FASTENED, not decorative */}
        <g stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" strokeLinecap="round">
          <path d="M46 54 L46 50" /><path d="M12 88 L8 88" /><path d="M80 88 L84 88" />
        </g>
      </g>

      {/* the padlock — forged into the ring; under attention the whole lock
          PRESSES forward with a spring while its keyhole ignites */}
      <g className="escene-pop">
        <path d="M41 121 a5 5 0 0 1 10 0" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.6" fill="none" />
        <rect x="38.5" y="120.5" width="15" height="11.5" rx="2.5" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.3" />
        <circle className="transition-opacity duration-500 opacity-70 group-hover:opacity-100" cx="46" cy="125.5" r="1.5" fill="currentColor" />
        <path className="transition-opacity duration-500 opacity-50 group-hover:opacity-90" d="M46 127 L46 129.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </g>

      {/* the beam — blurred glow + live core, and the liquidity actually
          FLOWS: two motes ride the beam outward (animateMotion, no ids),
          faint at rest, lit under the cursor */}
      <path d="M76 74 C 104 58, 124 48, 148 36" stroke="currentColor" strokeOpacity="0.1" strokeWidth="5" strokeLinecap="round" filter="url(#cl3-blur)" fill="none" />
      <path className="escene-draw" d="M76 74 C 104 58, 124 48, 148 36" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <circle className="escene-mote opacity-45 group-hover:opacity-95" r="1.9" fill="url(#cl3-core)">
        <animateMotion dur="3.6s" repeatCount="indefinite" path="M76 74 C 104 58, 124 48, 148 36" />
      </circle>
      <circle className="escene-mote opacity-30 group-hover:opacity-70" r="1.1" fill="currentColor">
        <animateMotion dur="3.6s" begin="-1.8s" repeatCount="indefinite" path="M76 74 C 104 58, 124 48, 148 36" />
      </circle>

      {/* the chain back — the links blink AND light up one by one under the
          cursor (staggered delays), while one mote travels the chain HOME:
          what left is still tied, and the tie visibly pulls */}
      <path d="M80 98 C 112 96, 136 76, 156 52" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="3 5" strokeLinecap="round" fill="none" />
      <circle className="eicon-star eicon-d1 transition-opacity duration-500 group-hover:opacity-100" style={{ transitionDelay: '0ms' }} cx="106" cy="95" r="1.3" fill="currentColor" fillOpacity="0.45" />
      <circle className="eicon-star eicon-d2 transition-opacity duration-500 group-hover:opacity-100" style={{ transitionDelay: '220ms' }} cx="132" cy="81" r="1.3" fill="currentColor" fillOpacity="0.45" />
      <circle className="eicon-star eicon-d3 transition-opacity duration-500 group-hover:opacity-100" style={{ transitionDelay: '440ms' }} cx="150" cy="62" r="1.3" fill="currentColor" fillOpacity="0.45" />
      <circle className="escene-mote opacity-35 group-hover:opacity-80" r="1.4" fill="currentColor">
        <animateMotion dur="5.5s" repeatCount="indefinite" calcMode="linear" keyPoints="1;0" keyTimes="0;1" path="M80 98 C 112 96, 136 76, 156 52" />
      </circle>

      {/* the coin-star — counter-spinning rim; it GROWS when looked at and
          its rim spins up with it */}
      <g className="transition-transform duration-1000 group-hover:scale-110" style={{ transformOrigin: '158px 30px' }}>
        <circle className="text-volt-soft opacity-20 transition-opacity duration-700 group-hover:opacity-45" cx="158" cy="30" r="15" fill="currentColor" filter="url(#cl3-blur)" />
        <circle cx="158" cy="30" r="13" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" />
        <g className="escene-boost-b" style={{ transformOrigin: '158px 30px' }}>
          <g className="escene-spin-b" style={{ transformOrigin: '158px 30px' }}>
            <circle cx="158" cy="30" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="0.9" strokeDasharray="0.1 4" strokeLinecap="round" />
          </g>
        </g>
        <path className="eicon-star eicon-d1" d="M158 21l2.4 6.6 6.6 2.4-6.6 2.4-2.4 6.6-2.4-6.6-6.6-2.4 6.6-2.4 2.4-6.6Z" fill="currentColor" fillOpacity="0.9" />
      </g>
    </svg>
  );
}

/**
 * HelmWheelScene v3 — managed, con factura de landing. La muralla con su
 * graduación fina (24 marcas + 4 cardinales) que SE ENCIENDE bajo atención;
 * el arco de los límites firmados dibujándose por dentro al hover; el timón
 * de ocho radios girando muy despacio; y una pista interior en CONTRA con la
 * estrella del gestor y su estela. El capital, quieto en el eje, con su halo:
 * todo gira a su alrededor, nada cruza el muro.
 */
export function HelmWheelScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  // Cada marca por separado (v4): la graduación se enciende EN BARRIDO bajo
  // el cursor — un retardo escalonado por marca, la luz recorre el muro.
  const fine = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    const x1 = 95 + Math.cos(a) * 63, y1 = 75 + Math.sin(a) * 63;
    const x2 = 95 + Math.cos(a) * 59.5, y2 = 75 + Math.sin(a) * 59.5;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  });
  const cardinal = Array.from({ length: 4 }, (_, i) => {
    const a = (i * 90 * Math.PI) / 180;
    const x1 = 95 + Math.cos(a) * 64, y1 = 75 + Math.sin(a) * 64;
    const x2 = 95 + Math.cos(a) * 57, y2 = 75 + Math.sin(a) * 57;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join(' ');
  const spokes = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45 * Math.PI) / 180;
    const x1 = 95 + Math.cos(a) * 11, y1 = 75 + Math.sin(a) * 11;
    const x2 = 95 + Math.cos(a) * 44, y2 = 75 + Math.sin(a) * 44;
    const hx = 95 + Math.cos(a) * 52, hy = 75 + Math.sin(a) * 52;
    return { line: `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`, hx: +hx.toFixed(1), hy: +hy.toFixed(1) };
  });
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="hw3-core" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="50%" style={{ stopColor: 'hsl(var(--volt))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
        <filter id="hw3-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* backdrop dust — OUTSIDE the wall only: inside is governed space */}
      <circle className="eicon-star" cx="16" cy="18" r="1" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d2" cx="176" cy="26" r="1.1" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d1" cx="182" cy="120" r="0.9" fill="currentColor" fillOpacity="0.3" />
      <circle className="eicon-star eicon-d3" cx="10" cy="112" r="1" fill="currentColor" fillOpacity="0.3" />

      {/* the wall and its graduation — the marks light up ONE BY ONE under
          the cursor, a sweep of light running the wall (staggered delays) */}
      <circle cx="95" cy="75" r="64" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.6" />
      {fine.map((d, i) => (
        <path
          key={i}
          className="transition-opacity duration-200 opacity-40 group-hover:opacity-95"
          style={{ transitionDelay: `${i * 26}ms` }}
          d={d}
          stroke="currentColor" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round"
        />
      ))}
      <path d={cardinal} stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />
      {/* the signed limits — the arc still draws itself, and a SENTRY mote
          patrols just inside the wall (animateMotion), lit under attention */}
      <path
        className="escene-draw"
        d="M95 20 A 55 55 0 1 1 40 75"
        stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" strokeLinecap="round" fill="none"
      />
      <circle className="escene-mote opacity-30 group-hover:opacity-85" r="1.6" fill="url(#hw3-core)">
        <animateMotion dur="16s" repeatCount="indefinite" path="M95 20 A 55 55 0 1 1 94.9 20.001 Z" />
      </circle>

      {/* the helm — eight spokes turning like a ceremony; under the hand it
          picks up pace (additive boost layer, no phase jump) */}
      <g className="escene-boost-a" style={{ transformOrigin: '95px 75px' }}>
        <g className="escene-spin-slower" style={{ transformOrigin: '95px 75px' }}>
          <circle cx="95" cy="75" r="44" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" />
          {spokes.map((sp, i) => (
            <path key={i} d={sp.line} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.1" strokeLinecap="round" />
          ))}
          {spokes.map((sp, i) => (
            <circle key={`h${i}`} cx={sp.hx} cy={sp.hy} r="2.8" fill="currentColor" fillOpacity="0.45" />
          ))}
        </g>
      </g>

      {/* the steward — a star with a trail on its own counter-track, and it
          too hurries when watched */}
      <g className="escene-boost-b" style={{ transformOrigin: '95px 75px' }}>
        <g className="escene-spin-b" style={{ transformOrigin: '95px 75px' }}>
          <circle cx="95" cy="75" r="28" stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.9" strokeDasharray="0.1 5" strokeLinecap="round" />
          <path d="M95 47 Q101 48.5 105 53" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.9" strokeLinecap="round" fill="none" />
          <circle className="text-volt-soft" cx="95" cy="47" r="5" fill="currentColor" fillOpacity="0.18" />
          <circle cx="95" cy="47" r="2.6" fill="url(#hw3-core)" />
        </g>
      </g>

      {/* the capital — still at the axis; it SWELLS a touch under attention,
          the one body everything else answers to */}
      <g className="escene-pop">
        <circle className="text-volt-soft opacity-25 transition-opacity duration-700 group-hover:opacity-55" cx="95" cy="75" r="13" fill="currentColor" filter="url(#hw3-blur)" />
        <circle cx="95" cy="75" r="8" fill="url(#hw3-core)" />
      </g>
    </svg>
  );
}

/**
 * ArmillaryScene v5 — managed, sin volante.
 * La muralla graduada con sus límites firmados SIGUE siendo la frontera —
 * eso no era el problema — pero dentro el timón de radios se sustituye por
 * una ESFERA ARMILAR: dos anillos inclinados que precesan alrededor del
 * capital, el instrumento clásico de la navegación guiada. Dice «alguien
 * pilota con instrumentos, dentro de los límites», sin barco. La estrella
 * del gestor viaja EN uno de los anillos; nada cruza el muro. Reacciones
 * v4.1: boost congelable, barrido de graduación, capital con muelle.
 */
export function ArmillaryScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  const fine = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    const x1 = 95 + Math.cos(a) * 63, y1 = 75 + Math.sin(a) * 63;
    const x2 = 95 + Math.cos(a) * 59.5, y2 = 75 + Math.sin(a) * 59.5;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  });
  const cardinal = Array.from({ length: 4 }, (_, i) => {
    const a = (i * 90 * Math.PI) / 180;
    const x1 = 95 + Math.cos(a) * 64, y1 = 75 + Math.sin(a) * 64;
    const x2 = 95 + Math.cos(a) * 57, y2 = 75 + Math.sin(a) * 57;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join(' ');
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="am5-core" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
          <stop offset="50%" style={{ stopColor: 'hsl(var(--volt))' }} />
          <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
        </radialGradient>
        <filter id="am5-blur" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      {/* backdrop dust — OUTSIDE the wall only: inside is governed space */}
      <circle className="eicon-star" cx="16" cy="18" r="1" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d2" cx="176" cy="26" r="1.1" fill="currentColor" fillOpacity="0.35" />
      <circle className="eicon-star eicon-d1" cx="182" cy="120" r="0.9" fill="currentColor" fillOpacity="0.3" />
      <circle className="eicon-star eicon-d3" cx="10" cy="112" r="1" fill="currentColor" fillOpacity="0.3" />

      {/* the wall and its graduation — the marks light up one by one under
          the cursor, a slow sweep of light running the wall */}
      <circle cx="95" cy="75" r="64" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.6" />
      {fine.map((d, i) => (
        <path
          key={i}
          className="transition-opacity duration-500 opacity-40 group-hover:opacity-95"
          style={{ transitionDelay: `${i * 40}ms` }}
          d={d}
          stroke="currentColor" strokeOpacity="0.55" strokeWidth="0.8" strokeLinecap="round"
        />
      ))}
      <path d={cardinal} stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round" />
      {/* the signed limits — the arc draws itself, and a sentry mote patrols
          just inside the wall, lit under attention */}
      <path
        className="escene-draw"
        d="M95 20 A 55 55 0 1 1 40 75"
        stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" strokeLinecap="round" fill="none"
      />
      <circle className="escene-mote opacity-30 group-hover:opacity-85" r="1.6" fill="url(#am5-core)">
        <animateMotion dur="16s" repeatCount="indefinite" path="M95 20 A 55 55 0 1 1 94.9 20.001 Z" />
      </circle>

      {/* armillary ring 1 — wide, tilted, precessing slowly; a bead marks its
          motion. The boost layer freezes in place when the cursor leaves. */}
      <g className="escene-boost-a" style={{ transformOrigin: '95px 75px' }}>
        <g className="escene-spin-slower" style={{ transformOrigin: '95px 75px' }}>
          <g transform="rotate(-24 95 75)">
            <ellipse cx="95" cy="75" rx="47" ry="16" stroke="currentColor" strokeOpacity="0.42" strokeWidth="1.2" />
            <circle cx="142" cy="75" r="2" fill="currentColor" fillOpacity="0.55" />
          </g>
        </g>
      </g>

      {/* armillary ring 2 — steeper, counter-precessing, dashed; the steward
          star RIDES this frame with its halo: someone is at the instruments */}
      <g className="escene-boost-b" style={{ transformOrigin: '95px 75px' }}>
        <g className="escene-spin-b" style={{ transformOrigin: '95px 75px' }}>
          <g transform="rotate(56 95 75)">
            <ellipse cx="95" cy="75" rx="40" ry="13" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="0.1 5" strokeLinecap="round" />
            <circle className="text-volt-soft" cx="55" cy="75" r="5" fill="currentColor" fillOpacity="0.18" />
            <circle cx="55" cy="75" r="2.6" fill="url(#am5-core)" />
          </g>
        </g>
      </g>

      {/* the capital — still at the axis; it SWELLS a touch under attention,
          the one body the instruments answer to */}
      <g className="escene-pop">
        <circle className="text-volt-soft opacity-25 transition-opacity duration-700 group-hover:opacity-55" cx="95" cy="75" r="13" fill="currentColor" filter="url(#am5-blur)" />
        <circle cx="95" cy="75" r="8" fill="url(#am5-core)" />
      </g>
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   EMBLEMAS GRABADOS — el artefacto de las puertas del Earn en el nivel SERENO
   (stores/motionStore.ts). */

/** Sol sellado — «Make it earn, simply»: un aro fino, ocho rayos cortos y el
 *  núcleo. Nada tira de nada. */
export function SunSealEmblem({ size = 120 }: { size?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    return { x1: 60 + Math.cos(a) * 22, y1: 60 + Math.sin(a) * 22, x2: 60 + Math.cos(a) * 32, y2: 60 + Math.sin(a) * 32 };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <g className="emblem-turn" style={{ transformOrigin: '60px 60px' }}>
        <circle cx="60" cy="60" r="46" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.1" strokeDasharray="0.1 5" strokeLinecap="round" />
        <circle cx="106" cy="60" r="2.2" fill="currentColor" fillOpacity="0.6" />
      </g>
      <circle cx="60" cy="60" r="38" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" />
      <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" strokeLinecap="round">
        {rays.map((r, i) => <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />)}
      </g>
      <g className="emblem-breathe">
        <circle cx="60" cy="60" r="14" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1" />
        <circle cx="60" cy="60" r="6" fill="currentColor" fillOpacity="0.85" />
      </g>
    </svg>
  );
}

/** Atado — «Get cash without selling»: el activo dentro de su aro con el
 *  candado forjado encima, un haz recto hacia la moneda y la cadena de vuelta.
 *  Lo que salió sigue atado. */
export function TetherEmblem({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <circle cx="44" cy="66" r="26" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.1" />
      <g className="emblem-turn-rev" style={{ transformOrigin: '44px 66px' }}>
        <circle cx="44" cy="66" r="18" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="0.1 4" strokeLinecap="round" />
      </g>
      <circle className="emblem-breathe" cx="44" cy="66" r="7" fill="currentColor" fillOpacity="0.8" />
      {/* el candado, sobre el aro */}
      <rect x="37" y="34" width="14" height="10" rx="2" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" />
      <path d="M40 34 V30 a4 4 0 0 1 8 0 V34" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" strokeLinecap="round" />
      {/* el haz y la moneda */}
      <line x1="66" y1="54" x2="96" y2="34" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="100" cy="31" r="7" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.2" />
      <circle className="emblem-breathe" cx="100" cy="31" r="2.5" fill="currentColor" fillOpacity="0.8" />
      {/* la cadena de vuelta: eslabones fijos */}
      <circle cx="70" cy="80" r="2" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="80" cy="72" r="2" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="90" cy="62" r="2" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />
      <circle cx="98" cy="50" r="2" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1" />
    </svg>
  );
}

/** Timón — «Managed vaults»: el aro amurallado con sus doce marcas de
 *  graduación (los límites firmados), la pista interior y la estrella del
 *  timonel, parada en su puesto. */
export function HelmEmblem({ size = 120 }: { size?: number }) {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return { x1: 60 + Math.cos(a) * 42, y1: 60 + Math.sin(a) * 42, x2: 60 + Math.cos(a) * 47, y2: 60 + Math.sin(a) * 47 };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden className="text-volt">
      <circle cx="60" cy="60" r="47" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.3" />
      <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.1" strokeLinecap="round">
        {ticks.map((r, i) => <line key={i} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />)}
      </g>
      {/* la pista interior y la estrella del timonel recorren su ronda, despacio */}
      <g className="emblem-turn" style={{ transformOrigin: '60px 60px' }}>
        <circle cx="60" cy="60" r="30" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" strokeDasharray="0.1 4" strokeLinecap="round" />
        <path d="M60 24 l2.2 4.8 4.8 2.2 -4.8 2.2 -2.2 4.8 -2.2 -4.8 -4.8 -2.2 4.8 -2.2z" fill="currentColor" fillOpacity="0.7" />
      </g>
      <g className="emblem-breathe">
        <circle cx="60" cy="60" r="9" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1" />
        <circle cx="60" cy="60" r="3.5" fill="currentColor" fillOpacity="0.85" />
      </g>
    </svg>
  );
}

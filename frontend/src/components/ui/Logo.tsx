'use client';

/**
 * Astryum brand mark — the single source of truth for the logo.
 *
 * The mark is the Astryum asteroid: a rounded rock with a short comet trail,
 * drawn in warm gold. Same artwork everywhere (sidebar, onboarding, loader,
 * favicon, OG image) so the brand stays consistent.
 *
 * Geometry lives here. For the full lockup (asteroid + "Astryum" wordmark)
 * compose this next to the wordmark at the call site.
 */

export const GOLD = '#C9A227';
export const GOLD_SOFT = '#E8C25A';
/** Back-compat alias — legacy call sites still import `VOLT`. */
export const VOLT = GOLD;

export const LOGO_VIEWBOX = '0 0 48 48';

export interface LogoMarkProps {
  /** Rendered height in px; the mark is square. */
  height?: number;
  className?: string;
  /** Outline / trail / crater colour (default gold). */
  color?: string;
  /** Body fill — set to the surface behind the mark so it seats cleanly. */
  gap?: string;
  /** Soft gold glow (on by default for dark surfaces). */
  glow?: boolean;
  title?: string;
}

/**
 * The Astryum asteroid on its own. Static, crisp, theme-able.
 */
export function LogoMark({
  height = 24,
  className,
  color = GOLD,
  gap = '#0a0a0b',
  glow = true,
  title,
}: LogoMarkProps) {
  return (
    <svg
      width={height}
      height={height}
      viewBox={LOGO_VIEWBOX}
      fill="none"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* comet trail */}
      <g stroke={color} strokeWidth="2.4" strokeLinecap="round">
        <path d="M6 7 L13.5 13.5" opacity="0.9" />
        <path d="M4.5 13 L10.5 18.5" opacity="0.65" />
        <path d="M12 4.5 L17 9.5" opacity="0.5" />
      </g>

      {/* asteroid body */}
      <path
        d="M28 12.5c5.2-.7 9.4 2.4 10.4 7.3.9 4.3-1 8.4-4.2 10.7-3.1 2.2-7.4 3-11.3 1.1-4.1-2-7-6.3-5.9-11.2 1.1-5 6-8.4 11-8.0z"
        fill={gap}
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        style={glow ? { filter: 'drop-shadow(0 0 4px rgba(201,162,39,0.45))' } : undefined}
      />

      {/* craters */}
      <circle cx="24" cy="22" r="2.4" fill={color} opacity="0.6" />
      <circle cx="31.5" cy="27.5" r="1.6" fill={color} opacity="0.45" />
      <circle cx="23" cy="29.5" r="1.1" fill={color} opacity="0.45" />
    </svg>
  );
}

export default LogoMark;

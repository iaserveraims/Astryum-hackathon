'use client';

/**
 * Astryum brand mark — the single source of truth for the logo.
 *
 * V3: se acabó el calco a mano — esto es el
 * TRAZADO PIXEL-FIEL del arte original (public/astryum-mark-azul-transparente.
 * png, la misma obra que la variante dorada): marching squares por capa de
 * color + simplificación RDP (~1.3px), generado por script determinista y
 * verificado lado a lado contra el PNG. Cada pieza es un lazo del dibujo
 * real: 4 estelas, el anillo con su hueco, la base oscura (borde + sombra),
 * la cara blanca, los 7 cráteres (huecos de la cara) y los 2 brillos
 * crecientes. Cambiar la marca = re-trazar, no re-dibujar.
 */

export const GOLD = '#C9A227';
export const GOLD_SOFT = '#E8C25A';
/** El dorado del ARTE del logo (el del PNG original). */
export const LOGO_GOLD = '#F5A623';
/** Back-compat alias — legacy call sites still import `VOLT`. */
export const VOLT = GOLD;

export const LOGO_VIEWBOX = '0 0 119.3 132';

/** Las 4 estelas del original, de arriba a abajo (lazos rellenos). */
export const LOGO_TRAILS: readonly string[] = [
  'M10 1.1L9.2 2L9.8 3.3L45.6 46.4L47.7 47.8L50.3 47.4L51.6 46.2L51.9 45.3L51.6 43L15 5.2L11.7 1.9Z',
  'M44.5 14.8L44.1 15.5L44.3 16.4L64.3 39.8L66.3 41.3L68.3 40.9L69.4 39.7L69.2 37.4L45.5 14.8Z',
  'M2 28.1L1.3 28.8L1.3 29.5L14.6 44.3L28.3 60.7L29.3 61.7L30.5 62.1L32.2 61.5L33 60.7L33.4 59.3L33 57.7L2.9 28.3Z',
  'M2 54.9L1.1 55.6L1.1 56.3L1.7 57.1L21 79.6L22.2 80.4L23.7 80.4L24.7 79.9L25.5 78.5L25.1 77L5.7 58.1Z',
];

/** El anillo — banda RELLENA (lazo exterior + su hueco, fill-rule evenodd). */
export const LOGO_RING = 'M66.5 45L63.7 45.6L60.5 46.9L53.5 52.3L46.8 54.4L44.9 55.3L41.9 57.4L39.2 60.5L37.9 62.9L36 69.1L32.1 73.8L30.6 77.5L30.4 82.2L30.9 84.5L30.9 87.1L30.2 90.1L28.7 93.5L28.3 95.7L28.5 99.3L29.4 102.5L30.9 105.1L36.8 110.2L39.4 115.8L41.7 118.3L43.6 119.6L48.3 121.7L51.7 122.4L56.3 122.8L58.4 123.6L60.1 124.5L64 127.9L69.3 130.1L72.8 130.9L79.4 130.7L83.9 129.2L86.2 127.5L88.2 126.6L94.6 126.2L100.2 124.5L104.7 121.7L107.8 118.6L110.6 113.7L112.1 106.8L116.8 99.7L118.1 94.6L117.9 89L116.6 84.5L112.9 77.9L112.1 70.2L110.6 65.3L108.6 62.2L106 59.6L102.8 57.6L95.5 55.1L90.7 50.6L87.1 48.6L84.5 48L79.6 48L77.5 47.4L73.6 45.6L70 45ZM66.6 48.1L70 48L73 48.8L78.1 50.8L83.5 51.2L85.6 51.8L87.7 52.7L93.7 57.8L100.4 60.2L103.4 62.1L105.9 64.6L108.2 68.5L109.3 72.5L110.1 79L113.8 86.2L114.9 90.3L114.9 94.8L113.8 98.7L112.3 101.3L109.5 104.9L107.8 112.4L106.1 115.6L103.7 118.4L101.5 120.2L97.4 122.3L93.5 123.2L89.3 123.2L87.5 123.6L81.1 126.9L78.1 127.7L73.2 127.7L69.7 126.9L66.3 125.4L62.5 122.4L59.7 120.8L56.5 119.8L50.3 119.1L45.1 116.8L42.2 114.3L39.6 108.8L38.4 107.3L35.3 105L33.2 102.7L32.1 100.4L31.3 97.4L31.5 94.2L33 90.7L33.8 87.5L33.8 84.3L33.2 81.8L33.6 77.5L34.9 74.7L38.6 70.2L40.3 64.6L42 61.6L44.9 58.7L46.8 57.6L54.5 54.9L56.7 53.6L61.8 49.5Z';
/** Centro del cuerpo y radios del anillo (para la caída, la órbita del
 *  loader y la máscara de barrido que lo revela). */
export const LOGO_CENTER = { x: 73.2, y: 87.9 };
export const LOGO_RING_MID = 43.4;
export const LOGO_RING_W = 4;

/** La base oscura: borde rocoso + la sombra creciente, un solo lazo. */
export const LOGO_BODY_DARK = 'M66.7 48L61.8 49.5L56.7 53.6L54.5 54.9L46.8 57.6L44.9 58.7L42 61.6L40.3 64.6L38.6 70.2L34.9 74.7L33.6 77.5L33.2 81.8L33.8 84.3L33.8 87.5L33.4 89.5L31.5 94.2L31.3 97.4L32.1 100.4L33.2 102.7L35.3 105L38.4 107.3L39.6 108.8L42.2 114.3L45.1 116.8L50.3 119.1L56.5 119.8L59.7 120.8L62.5 122.4L66.3 125.4L69.7 126.9L73.2 127.7L78.1 127.7L81.1 126.9L87.5 123.6L89.3 123.2L93.5 123.2L97.4 122.3L101.5 120.2L103.7 118.4L106.1 115.6L107.8 112.4L109.5 104.9L112.3 101.3L113.8 98.7L114.9 94.8L114.9 90.3L113.8 86.2L110.1 79L109.3 72.5L108.2 68.5L105.9 64.6L103.4 62.1L100.4 60.2L93.7 57.8L87.7 52.7L85.6 51.8L83.5 51.2L78.1 50.8L73 48.8L70 48Z';
/** La cara iluminada — su borde inferior YA recorta la sombra del original. */
export const LOGO_BODY_LIT = 'M67.2 50.3L62.7 51.6L60.7 52.9L57.8 55.7L50.7 58.5L46.1 61.2L47.1 62.3L47.1 63.3L43.5 71.5L42.8 75.8L43.3 79L44.2 79.7L46.6 80.4L47.8 81.7L48.9 84.5L48.9 88.8L46.9 93.3L46.9 93.8L48.6 95L48.9 96.7L48.6 97.6L47.1 98.5L47.1 99.3L48.3 100.1L52.2 100.7L55.8 102.8L58.5 106L59.3 108.7L59.3 110.7L60.2 113L62.3 115.1L65 116.6L66.8 117.2L73.2 117L75.1 117.6L78.7 119.6L83.7 119.6L86.2 120.9L92.9 120.6L95.7 119.8L100.6 117L104.8 112.6L105.9 110.2L107.3 104.3L110.6 99.5L112.3 95.3L112.5 90.8L112.1 88.8L108 80L106.1 69.7L104.4 66.7L101.7 63.8L98.3 61.7L92.5 59.6L85.8 54.2L82.6 53.3L78.8 53.3L76.4 52.7L71 50.4Z';

/** Los 7 cráteres del original (lazos oscuros sobre la cara). */
export const LOGO_CRATERS: readonly string[] = [
  'M60.2 58.8L62.2 58.7L65.2 59.4L66.8 60.4L68.6 62.2L69.9 65.3L69.9 68.7L69.6 70.2L68.1 73L65.7 75.4L62.2 77.4L58.2 78.4L55.8 78.4L52.8 77.6L50.5 76.3L48.9 74.5L48.2 73L48 69.7L48.6 67.6L49.9 65L52.2 62.3L56.2 59.8Z',
  'M90.9 72.7L94 72.8L96.8 73.9L100.3 77L101.8 79.6L102.4 81.8L102.4 84.3L101.8 86.3L99.3 89.4L97.6 90.4L94.4 91.1L91.6 90.9L89.9 90.4L86.9 88.5L84.2 84.7L83.6 80.3L84.8 76.6L85.5 75.5L87.8 73.5Z',
  'M89.4 105.5L91.6 105.6L93.7 106.7L94.9 108.3L95.3 109.6L95.1 111.8L94.1 113.5L92.7 114.8L90.8 115.5L88.2 115.5L86.7 114.9L85.7 114.1L84.4 111.5L84.4 109.8L85.3 107.7L87.1 106.1Z',
  'M68.6 93.7L71.7 93.8L74.3 96.1L74.6 97.6L74.4 99.5L73.7 100.8L71.7 102.2L70 102.4L68.7 102L66.6 100L66 98.9L65.8 96.7L66.2 95.5L67 94.5Z',
  'M81.6 58.4L84.1 58.5L85.9 60.1L86.3 62.2L85.5 63.7L84.8 64.1L82 64.3L80.7 63.8L79.7 62.7L79.3 62L79.3 60.3L80.3 58.9Z',
  'M104.1 94.6L105.7 94.7L106.7 96.3L106.5 99.3L106.1 100L104.9 100.9L103.6 100.9L103 100.5L102 98.3L102.8 95.7Z',
  'M59.4 84.1L60.8 84L62.1 85L62.3 87.5L61 88.7L59.5 88.7L58.1 87.5L57.9 85.6L58.3 84.8Z',
];
/** Los 2 brillos crecientes (blancos): dentro del cráter grande derecho y
 *  de la sombra inferior-izquierda. */
export const LOGO_SPARKLES: readonly string[] = [
  'M46.4 105.8L45.5 106.1L44.6 107.2L44.6 108.8L45.6 111.1L47.5 113.1L49.4 114.2L51.8 114.8L52.8 114.6L52.2 114L49 112.9L47.8 111.8L47.4 109.8L48.4 108.1L48.4 107.2L47.5 105.9Z',
  'M85.6 79.7L85.3 82.4L85.7 83.9L87 86.3L88.4 87.8L92.3 89.6L95.4 89.3L95.3 89.1L91.6 88.5L88.8 86.8L86.6 83.7Z',
];

export interface LogoMarkProps {
  /** Rendered height in px; the mark is square-ish (119.3:132). */
  height?: number;
  className?: string;
  /** Anillo + estelas (por defecto, el dorado del arte). */
  color?: string;
  /** Tinta de la base oscura y los cráteres (era `gap` en la v1). */
  gap?: string;
  /** Soft glow (on by default for dark surfaces). */
  glow?: boolean;
  title?: string;
}

/**
 * The Astryum asteroid on its own. Static, crisp, theme-able.
 */
export function LogoMark({
  height = 24,
  className,
  color = LOGO_GOLD,
  gap = '#0d0d0d',
  glow = true,
  title,
}: LogoMarkProps) {
  return (
    <svg
      width={height * (119.3 / 132)}
      height={height}
      viewBox={LOGO_VIEWBOX}
      fill="none"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill={color} style={glow ? { filter: 'drop-shadow(0 0 4px rgba(245,166,35,0.35))' } : undefined}>
        {LOGO_TRAILS.map((d) => (
          <path key={d.slice(0, 16)} d={d} />
        ))}
        <path d={LOGO_RING} fillRule="evenodd" />
      </g>
      <path d={LOGO_BODY_DARK} fill={gap} />
      <path d={LOGO_BODY_LIT} fill="#ffffff" />
      <g fill={gap}>
        {LOGO_CRATERS.map((d) => (
          <path key={d.slice(0, 16)} d={d} />
        ))}
      </g>
      <g fill="#ffffff">
        {LOGO_SPARKLES.map((d) => (
          <path key={d.slice(0, 16)} d={d} />
        ))}
      </g>
    </svg>
  );
}

export default LogoMark;

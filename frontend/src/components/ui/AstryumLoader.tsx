'use client';

/**
 * AstryumLoader — LA animación de carga de la casa, sobre el logo REAL.
 *
 * v3 (2026-09-09): Logo.tsx es ahora el trazado PIXEL-FIEL del PNG original
 * (fundador: «sigue fallando algo de la forma… se nota») y este loader anima
 * exactamente esos lazos — las 4 estelas del arte, la base oscura con su
 * sombra, la cara blanca, los 7 cráteres y los 2 brillos, y el anillo
 * RELLENO del original, que al ser banda (no trazo) se revela con una
 * MÁSCARA de barrido: un arco que se dibuja destapa la banda auténtica.
 *
 * DOS ACTOS (CSS en globals.css `astry-load-*`, cero dependencias):
 *  1. La caída (una vez, ~1.4s): estelas en ráfaga por su diagonal, la ROCA
 *     CAE por la misma trayectoria y asienta con rebote, el anillo se barre
 *     alrededor y los cráteres aterrizan como esquirlas.
 *  2. La órbita (bucle calmo): halo que respira, estelas que relucen y una
 *     mota en órbita inclinada. Nada se reinicia — respira.
 *
 * Reduced motion: el logo terminado, quieto (la máscara del anillo queda
 * destapada por CSS).
 *
 * ── LA REGLA DE LAS ESPERAS (fundador 2026-09-11: «si está algo cargando
 * tiene que aparecer el logo… homogéneo en todas las páginas — ¿o se saturará
 * de asteroides?»). Tres esperas, tres caras, y no se mezclan:
 *
 *   1. SECCIÓN VACÍA QUE ESPERA DATO → el cometa (este componente), UNO por
 *      sección, tamaño 40–56 con su línea en mono; 72 solo a página completa
 *      (app/loading.tsx, AccessGate). Es el que va en EmptyState
 *      variant="loading", en las pestañas (PanelLoading) y en cualquier caja
 *      que aún no tiene nada que enseñar. Aquí antes convivían texto suelto
 *      («Loading positions…»), spinners centrados y el cometa: eso es lo que
 *      se ha unificado.
 *   2. FORMA CONOCIDA → esqueleto (barras animate-pulse). Cuando ya se sabe
 *      qué forma tendrá el dato (una cabecera, una fila), se dibuja la forma
 *      y se calla: un esqueleto no compite con el cometa de la sección de al
 *      lado, y por eso NO se saturan — el cometa solo sale donde no hay forma.
 *   3. ACCIÓN EN CURSO → spinner (Loader2). Preparar un payload, firmar,
 *      refrescar, un botón trabajando, una tasa que llega en una fila: eso no
 *      es «leer», es «hacer», y el spinner pequeño junto a su texto es su
 *      lenguaje. El cometa NUNCA sustituye a un spinner de acción.
 *
 * Con esto, en una pantalla hay como mucho un cometa por sección que espera,
 * y ninguno donde ya hay forma o donde el usuario acaba de pulsar algo.
 */

import { useId } from 'react';
import {
  GOLD_SOFT,
  LOGO_BODY_DARK,
  LOGO_BODY_LIT,
  LOGO_CENTER,
  LOGO_CRATERS,
  LOGO_GOLD,
  LOGO_RING,
  LOGO_RING_MID,
  LOGO_SPARKLES,
  LOGO_TRAILS,
  LOGO_VIEWBOX,
} from './Logo';

export function AstryumLoader({
  size = 72,
  label,
  className = '',
  tone = 'gold',
}: {
  /** Alto en px (el ancho sigue la proporción del arte). */
  size?: number;
  /** Línea opcional bajo la marca («Verifying access…»). */
  label?: string;
  className?: string;
  /** EL TONO (fundador 2026-09-12: «la misma animación que tiene la página
   *  pero cambiando al color índigo del Legacy»): `gold` es la marca de
   *  siempre; `legacy` viste halo, estelas, anillo y mota con el índigo del
   *  producto (--product-legacy), sin tocar la roca. Lo usa la travesía
   *  Personal→Legacy (AuthorityCrossing). */
  tone?: 'gold' | 'legacy' | 'auto';
}) {
  const maskId = useId();
  const origin = `${LOGO_CENTER.x}px ${LOGO_CENTER.y}px`;
  const legacy = tone === 'legacy';
  // 'auto' (fundador 2026-09-13: «cuando sea para entrar al Legacy que cambie
  // de color simplemente»): el cometa viste --volt, que la shell ya voltea a
  // índigo bajo data-authority='governed' — UN loader, dos colores, sin un
  // segundo logo encima.
  const auto = tone === 'auto';
  const ink = auto ? 'hsl(var(--volt))' : legacy ? 'hsl(var(--product-legacy))' : LOGO_GOLD;
  const soft = auto ? 'color-mix(in srgb, hsl(var(--volt)) 65%, white)' : legacy ? 'color-mix(in srgb, hsl(var(--product-legacy)) 65%, white)' : GOLD_SOFT;
  const ringShadow = auto
    ? 'drop-shadow(0 0 3px hsl(var(--volt) / 0.35))'
    : legacy
      ? 'drop-shadow(0 0 3px hsl(var(--product-legacy) / 0.35))'
      : 'drop-shadow(0 0 3px rgba(245,166,35,0.28))';
  return (
    <div className={`flex flex-col items-center gap-4 ${className}`} role="status" aria-live="polite">
      <svg width={size * (119.3 / 132)} height={size} viewBox={LOGO_VIEWBOX} fill="none" aria-hidden>
        <defs>
          {/* La máscara del barrido: un arco grueso que se dibuja y destapa
              la banda RELLENA del anillo original (una banda no se puede
              dash-dibujar; su máscara sí). Ancho de sobra para los bollos. */}
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <circle
              className="astry-load-ring"
              cx={LOGO_CENTER.x}
              cy={LOGO_CENTER.y}
              r={LOGO_RING_MID}
              pathLength={100}
              fill="none"
              stroke="#ffffff"
              strokeWidth={18}
              strokeLinecap="round"
            />
          </mask>
        </defs>

        {/* el halo — florece tras el aterrizaje y respira en el bucle */}
        <circle
          className="astry-load-halo"
          cx={LOGO_CENTER.x}
          cy={LOGO_CENTER.y}
          r={36}
          fill={ink}
          opacity="0"
          style={{ filter: 'blur(15px)' }}
        />

        {/* las estelas del original — ráfaga por su diagonal; en el bucle
            relucen, cada una con su retardo */}
        <g fill={ink}>
          {LOGO_TRAILS.map((d, i) => (
            <path
              key={d.slice(0, 16)}
              className="astry-load-trail"
              d={d}
              style={{ '--d': `${i * 0.09}s` } as React.CSSProperties}
            />
          ))}
        </g>

        {/* la ROCA — cae por la diagonal de las estelas y asienta con rebote;
            cráteres y brillos aterrizan después, como esquirlas */}
        <g className="astry-load-rock" style={{ transformOrigin: origin }}>
          <path d={LOGO_BODY_DARK} fill="#0d0d0d" />
          <path d={LOGO_BODY_LIT} fill="#ffffff" />
          {LOGO_CRATERS.map((d, i) => (
            <path
              key={d.slice(0, 16)}
              className="astry-load-crater"
              d={d}
              fill="#0d0d0d"
              style={{ '--d': `${0.95 + i * 0.06}s` } as React.CSSProperties}
            />
          ))}
          {LOGO_SPARKLES.map((d, i) => (
            <path
              key={d.slice(0, 16)}
              className="astry-load-crater"
              d={d}
              fill="#ffffff"
              style={{ '--d': `${1.4 + i * 0.08}s` } as React.CSSProperties}
            />
          ))}
        </g>

        {/* el anillo AUTÉNTICO (banda abollada del arte), revelado en barrido */}
        <path
          d={LOGO_RING}
          fill={ink}
          fillRule="evenodd"
          mask={`url(#${maskId})`}
          style={{ filter: ringShadow }}
        />

        {/* la mota en órbita inclinada — el bucle tiene vida sin reiniciar */}
        <circle className="astry-load-mote" r="1.8" fill={soft}>
          <animateMotion
            dur="3.4s"
            begin="1.7s"
            repeatCount="indefinite"
            path={`M${LOGO_CENTER.x + 41} ${LOGO_CENTER.y - 32} A 52 30 -38 1 1 ${LOGO_CENTER.x - 41} ${LOGO_CENTER.y + 32} A 52 30 -38 1 1 ${LOGO_CENTER.x + 41} ${LOGO_CENTER.y - 32} Z`}
          />
        </circle>
      </svg>
      {label && (
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-ink/40">{label}</p>
      )}
    </div>
  );
}

export default AstryumLoader;

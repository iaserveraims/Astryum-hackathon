'use client';

/**
 * StationProgress — el progreso de una ceremonia como BARRA, no como fila de
 * círculos numerados (fundador 2026-09-08: «no puede ser que una serie de
 * números sean el progreso… quiero una progress bar que se mantenga en
 * pantalla y que se pueda anclar para volver al punto en el que se estaba»).
 *
 * v3 — EL RAÍL LATERAL (fundador 2026-09-12: «no me gusta abajo… abajo tienes
 * que forzar la vista hacia abajo… cambia la ubicación y también la forma y
 * la interacción»). La barra vive AL LADO del contenido, pegada arriba
 * mientras se hace scroll, y cambia de forma: los segmentos van en vertical
 * y cada uno lleva SU NOMBRE al lado — se ve dónde estás y qué queda sin
 * pasar el ratón, y se salta a cualquier estación con un clic. Atrás y
 * Siguiente viven en el propio raíl (dicen a dónde van), y cuando la
 * estación actual ya está hecha, el «¿Por qué hecha?» está justo debajo.
 *
 * DOS FORMAS, una pieza:
 *   · layout='side'  — el raíl lateral en pantallas anchas; en estrechas, la
 *     tira horizontal (no hay lado). Para las ceremonias con página propia
 *     (el alta del gestor, nace tu exchange). Se monta con StationRailLayout.
 *   · layout='strip' — la tira horizontal pegada arriba, con Atrás/Siguiente
 *     a la derecha: para los sitios sin lado libre (el Legacy, el creador de
 *     bóvedas en su modal, el raíl de Operar del exchange junto al tour).
 *
 *   - Hecha (verde), actual (dorado, late), pendiente (tenue). «Hecha» la
 *     trae el anfitrión, que lo DETECTA del ledger — la barra jamás inventa.
 *   - Cada segmento es un botón: clic = ir a esa estación (adelante o atrás).
 *
 * Accesible: role=group con nombre, cada segmento con aria-label completo y
 * aria-current="step" en la actual; foco visible en teclado.
 */

import { useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { GhostButton, PrimaryButton } from './primitives';

export interface StationProgressItem {
  label: string;
  done: boolean;
}

export interface StationProgressProps {
  stations: StationProgressItem[];
  current: number;
  onSelect: (index: number) => void;
  /** Nombre del grupo para lectores de pantalla (p. ej. «Estaciones del alta»). */
  ariaLabel: string;
  /** La palabra «hechas» ya traducida por el anfitrión. */
  doneWord: string;
  /** side = raíl lateral (tira en móvil) · strip = tira horizontal arriba. */
  layout?: 'side' | 'strip';
  /** Pegada mientras se hace scroll (por defecto). */
  sticky?: boolean;
  className?: string;
  /** Atrás / Siguiente. Sin ellos, solo la pista. */
  onBack?: () => void;
  onNext?: () => void;
  /** Los nombres de las estaciones vecinas; por defecto, los de `stations`. */
  backLabel?: ReactNode;
  nextLabel?: ReactNode;
  nextDisabled?: boolean;
  /** Por qué Siguiente está apagado (sale al pasar el ratón). */
  nextReason?: string;
  /** Siguiente como botón principal (creadores que validan cada paso). */
  nextPrimary?: boolean;
}

/** El marco del raíl lateral: el raíl a la izquierda (pegado arriba), el
 *  contenido a la derecha — SOLO si la CAJA es ancha. Lo decide el propio
 *  contenedor (container query en globals.css, `.station-rail`), no la
 *  pantalla (fundador 2026-09-12: en la ventana anclable «queda pequeño el
 *  campo usable de la derecha»): en una ventana flotante o un anclaje
 *  estrecho la tira va ENCIMA del contenido; ensancha el anclaje y el raíl
 *  vuelve al lado. Umbral: 52rem de caja. */
export function StationRailLayout({ rail, children, className = '', railWidth }: { rail: ReactNode; children: ReactNode; className?: string; /** Ancho de la columna del raíl (13.5rem por defecto; más si lleva compañía, p. ej. el tour). */ railWidth?: string }) {
  // Sin raíl (una sala que no es ceremonia), solo el contenido: el anfitrión
  // puede montar el marco siempre y decidir el raíl por estado.
  if (!rail) return <>{children}</>;
  return (
    // DOS CAPAS a propósito: la de fuera es el CONTENEDOR que se mide y la de
    // dentro la rejilla que cambia. Una @container solo ve ancestros — un
    // elemento no puede consultarse a sí mismo — y con una sola capa la
    // rejilla nunca llegaba en la página entera (fundador 12-sep, captura:
    // el raíl vertical a todo lo ancho, encima del contenido).
    <div className={`station-rail ${className}`} style={railWidth ? ({ ['--srl-w' as never]: railWidth } as React.CSSProperties) : undefined}>
      <div className="station-rail-grid">
        <div className="srl-aside">{rail}</div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

function NavButtons({ p, compact }: { p: StationProgressProps; compact: boolean }) {
  const { stations, current, onBack, onNext, backLabel, nextLabel, nextDisabled = false, nextReason, nextPrimary = false } = p;
  if (!onBack && !onNext) return null;
  const prev = stations[current - 1];
  const next = stations[current + 1];
  const nextOff = nextDisabled || (current >= stations.length - 1 && !nextLabel);
  return (
    <div className={`flex items-center gap-2 ${compact ? 'shrink-0' : 'mt-3 justify-between border-t border-ink/[0.06] pt-3'}`}>
      {onBack ? (
        <GhostButton onClick={onBack} disabled={current === 0 && !backLabel} aria-label={String(backLabel ?? prev?.label ?? '')} className="min-w-0">
          <ArrowLeft className={`inline h-3.5 w-3.5 ${compact ? '' : 'mr-1'}`} />
          {compact ? null : <span className="truncate">{backLabel ?? prev?.label ?? ''}</span>}
        </GhostButton>
      ) : <span />}
      {onNext ? (
        nextPrimary ? (
          <PrimaryButton onClick={onNext} disabled={nextOff} disabledReason={nextReason} className="min-w-0">
            <span className="truncate">{nextLabel ?? next?.label ?? ''}</span> <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
          </PrimaryButton>
        ) : (
          <GhostButton onClick={onNext} disabled={nextOff} aria-label={String(nextLabel ?? next?.label ?? '')} className="min-w-0">
            {compact ? null : <span className="truncate">{nextLabel ?? next?.label ?? ''}</span>}
            <ArrowRight className={`inline h-3.5 w-3.5 ${compact ? '' : 'ml-1'}`} />
          </GhostButton>
        )
      ) : null}
    </div>
  );
}


/* ── La tira horizontal ──────────────────────────────────────────────────── */
function Strip(p: StationProgressProps) {
  const { stations, current, onSelect, ariaLabel, doneWord, sticky = true, className = '' } = p;
  const [hover, setHover] = useState<number | null>(null);
  const doneCount = stations.filter((s) => s.done).length;
  const shown = hover ?? current;
  const label = stations[shown]?.label ?? '';
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`${sticky ? 'sticky top-14 z-20 lg:top-0' : ''} -mx-1 rounded-xl border border-ink/[0.06] bg-[var(--shell-panel)]/90 px-3 py-2 backdrop-blur-md ${className}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <div className="flex min-w-[12rem] flex-1 items-center gap-1" onMouseLeave={() => setHover(null)}>
          {stations.map((s, i) => {
            const isCurrent = i === current;
            const tone = isCurrent ? 'bg-volt shadow-[0_0_0_3px_hsl(var(--volt)/0.14)]' : s.done ? 'bg-tone-success/70 hover:bg-tone-success' : 'bg-ink/10 hover:bg-ink/25';
            return (
              <button
                key={`${i}-${s.label}`}
                type="button"
                onClick={() => onSelect(i)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`${i + 1}/${stations.length} · ${s.label}${s.done ? ` · ${doneWord}` : ''}`}
                title={s.label}
                className="group flex h-6 flex-1 items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
              >
                <span className={`block h-1.5 w-full rounded-full transition-all duration-300 group-hover:h-2.5 ${tone}`} />
              </button>
            );
          })}
        </div>
        <p className="flex min-w-0 items-baseline gap-2 text-[12px]" aria-live="polite">
          <span className="font-mono text-[11px] text-volt/80">{shown + 1}/{stations.length}</span>
          <span className={`truncate font-medium ${hover != null && hover !== current ? 'text-ink/60' : 'text-ink'}`}>{label}</span>
          <span className="shrink-0 font-mono text-[10px] text-ink/40">· {doneCount} {doneWord}</span>
        </p>
        <NavButtons p={p} compact />
      </div>
    </div>
  );
}

/* ── El raíl lateral ─────────────────────────────────────────────────────── */
function Rail(p: StationProgressProps) {
  const { stations, current, onSelect, ariaLabel, doneWord, className = '' } = p;
  const doneCount = stations.filter((s) => s.done).length;
  return (
    <nav aria-label={ariaLabel} className={`rounded-xl border border-ink/[0.06] bg-[var(--shell-panel)]/90 p-3 backdrop-blur-md ${className}`}>
      <p className="flex items-baseline gap-2 px-1 text-[11px]">
        <span className="font-mono text-volt/80">{current + 1}/{stations.length}</span>
        <span className="font-mono text-ink/40">· {doneCount} {doneWord}</span>
      </p>
      <ol className="mt-2 space-y-0.5">
        {stations.map((s, i) => {
          const isCurrent = i === current;
          const tone = isCurrent ? 'bg-volt shadow-[0_0_0_3px_hsl(var(--volt)/0.14)]' : s.done ? 'bg-tone-success/70 group-hover:bg-tone-success' : 'bg-ink/10 group-hover:bg-ink/25';
          return (
            <li key={`${i}-${s.label}`}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`${i + 1}/${stations.length} · ${s.label}${s.done ? ` · ${doneWord}` : ''}`}
                className={`group flex w-full items-stretch gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-ink/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 ${isCurrent ? 'bg-ink/[0.03]' : ''}`}
              >
                {/* El segmento, en vertical: la misma pista, de pie. */}
                <span className={`my-0.5 w-1 shrink-0 self-stretch rounded-full transition-all duration-300 group-hover:w-1.5 ${tone}`} />
                <span className={`min-w-0 flex-1 py-0.5 text-[12.5px] leading-snug ${isCurrent ? 'font-semibold text-ink' : s.done ? 'text-ink/70' : 'text-ink/45'}`}>
                  {s.label}
                </span>
                {s.done ? <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-tone-success" strokeWidth={2.5} /> : null}
              </button>
            </li>
          );
        })}
      </ol>
      <NavButtons p={p} compact={false} />
    </nav>
  );
}

export function StationProgress(p: StationProgressProps) {
  const layout = p.layout ?? 'side';
  if (layout === 'strip') return <Strip {...p} />;
  // Las dos formas, y el CSS del contenedor enseña una: la tira si la caja es
  // estrecha, el raíl si es ancha (ver StationRailLayout / .station-rail).
  return (
    <>
      <div className="srl-strip"><Strip {...p} /></div>
      <div className="srl-rail"><Rail {...p} /></div>
    </>
  );
}

export default StationProgress;

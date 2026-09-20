'use client';

import { ReactNode, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useMotionLevel } from '../../stores/motionStore';
import { useEngraved } from '../../stores/themeStore';
import { AstryumLoader } from './AstryumLoader';
import { useCursorGlow } from './motion';
import { useT } from '../../i18n/LanguageProvider';

// Translate string children/props in shared primitives so every page's chrome (headers,
// empty states, stat labels) is localized centrally. JSX nodes pass through untouched.
function useTNode() {
  const { t } = useT();
  return (node: ReactNode): ReactNode => (typeof node === 'string' ? t(node) : node);
}

// Brand accent for headings. Solid VOLT — the single brand accent, used sparingly.
export function GradientText({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`text-volt ${className}`}>{children}</span>;
}

// The Astryum asteroid — same decorative glyph the landing flies. One per
// surface at most: it marks the page's ONE brand moment, not a bullet point.
export function AsteroidMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="text-volt">
      <path
        d="M12 3.5c2.2-.3 4.4.6 5.9 2.3 1.7 1.9 2.2 4.6 1.2 7-.8 1.9-2.5 3.4-4.5 3.9-2.5.7-5.2-.1-6.9-2-1.6-1.7-2.2-4.2-1.4-6.4.8-2.3 3-4.4 5.7-4.8z"
        fill="#0a0a0a"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle cx="10" cy="9.5" r="1.5" fill="currentColor" opacity="0.7" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" opacity="0.5" />
      <circle cx="9.5" cy="14" r="0.7" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

// Instrument label — the landing's mono tracked micro-register, used for DATA
// readings only (net worth, health…), never as a section eyebrow. It's what
// makes a panel read like an instrument in the same spacecraft as the landing.
/**
 * Instrument micro-label — DATA readings only, 10px floor (never smaller: the
 * !text-[9px] overrides the audit found are exactly what this floor forbids).
 * `tone='muted'` covers the neutral ink variant pages kept re-typing by hand.
 */
export function MicroLabel({
  children,
  className = '',
  tone = 'brand',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'brand' | 'muted';
}) {
  const tr = useTNode();
  const color = tone === 'muted' ? 'text-ink/40' : 'text-volt-soft/60';
  // `ui-microlabel` es el asidero del TEMA: en la lámina institucional esta
  // etiqueta deja de ser una micro-nota y pasa a ser el encabezado de una
  // columna de registro (globals.css). Se viste por CSS y no por hook a
  // propósito — este primitivo se pinta cientos de veces por pantalla y
  // suscribir cada instancia al store sería pagar el tema en cada celda.
  return (
    <span className={`ui-microlabel text-[10px] font-mono uppercase tracking-[0.18em] ${color} ${className}`}>
      {tr(children)}
    </span>
  );
}

// Calm status chip. Sentence-case, normal tracking — no "uppercase tracking-widest"
// micro-noise. Tones are quiet tints, not loud fills, so they inform without shouting.
export function Pill({
  children,
  tone = 'neutral',
  className = '',
  size = 'md',
  mono = false,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
  /** 'sm' for dense rows (counts, chain tags) — the ad-hoc 10px clones' home. */
  size?: 'md' | 'sm';
  /** Figures/addresses only — never words in mono. */
  mono?: boolean;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-ink/10 bg-ink/[0.04] text-ink/65',
    success: 'border-emerald-500/25 bg-emerald-500/[0.08] text-tone-success',
    warning: 'border-amber-500/25 bg-amber-500/[0.08] text-tone-warning',
    danger: 'border-red-500/25 bg-red-500/[0.08] text-tone-danger',
    info: 'border-volt/30 bg-volt/[0.08] text-volt',
  };
  const dims = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]';
  return (
    <span
      className={`ui-pill inline-flex items-center gap-1.5 rounded-full border font-medium leading-none ${dims} ${
        mono ? 'font-mono tabular-nums' : ''
      } ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * SegmentedControl — THE selected-state language (the audit found five
 * competing treatments). One signal for "active": a quiet volt tint, never a
 * solid fill (solid volt is reserved for CTAs). The tint glides between
 * segments via layoutId.
 */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  className = '',
  layoutId,
}: {
  options: { key: K; label: ReactNode }[];
  value: K;
  onChange: (k: K) => void;
  className?: string;
  /** Unique per instance — two controls on one page must not share it. */
  layoutId?: string;
}) {
  const tr = useTNode();
  // TRES ARTEFACTOS por nivel de movimiento (stores/motionStore.ts): el tinte
  // que se DESLIZA con muelle (full), el tinte que se desliza DESPACIO y sin
  // rebote (calm) y el SUBRAYADO sin píldora (minimal).
  const level = useMotionLevel();
  if (level === 'minimal') {
    return (
      <div role="tablist" className={`inline-flex items-center gap-4 border-b border-ink/10 ${className}`}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <button
              key={o.key}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(o.key)}
              className={`-mb-px border-b-2 px-1 py-1.5 text-xs font-medium ${
                on ? 'border-volt text-ink' : 'border-transparent text-ink/45 hover:text-ink/80'
              }`}
            >
              {tr(o.label)}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div
      role="tablist"
      className={`inline-flex items-center gap-0.5 rounded-xl border border-ink/10 bg-ink/[0.03] p-0.5 ${className}`}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`relative rounded-[10px] px-3 py-1.5 text-xs font-medium transition-colors ${
              on ? 'text-ink' : 'text-ink/45 hover:text-ink/80'
            }`}
          >
            {on && <MotionSegment layoutId={layoutId ?? 'seg'} calm={level === 'calm'} />}
            <span className="relative">{tr(o.label)}</span>
          </button>
        );
      })}
    </div>
  );
}

function MotionSegment({ layoutId, calm = false }: { layoutId: string; calm?: boolean }) {
  return (
    <motion.span
      layoutId={layoutId}
      className="absolute inset-0 rounded-[10px] bg-volt/15 border border-volt/20"
      // Sereno: tween lento en la casa curve, sin rebote.
      transition={calm ? { duration: 0.4, ease: [0.16, 1, 0.3, 1] } : { type: 'spring', stiffness: 420, damping: 34 }}
      aria-hidden
    />
  );
}

/**
 * IconTile — the ONE geometry for "icon in a tinted box" (the audit found four
 * hand-rolled variants). Empty states, CTAs, login cards: same tile.
 */
export function IconTile({
  children,
  size = 'md',
  className = '',
}: {
  children: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const dims = size === 'lg' ? 'w-12 h-12 rounded-2xl' : 'w-10 h-10 rounded-xl';
  return (
    <div className={`ui-icontile ${dims} grid place-items-center bg-volt/10 border border-volt/20 text-volt ${className}`}>
      {children}
    </div>
  );
}

// Calm panel. One warm surface lifted off deep space with a near-invisible hairline
// and a single soft shadow — no inset highlight, no stacked shadows, no hard white
// border. Generous 16px radius reads cozy rather than clinical.
// `spotlight` adds the cursor-following gold sheen (same light as the landing's
// spotlight cards, overlay variant for our opaque surfaces).
export function Card({
  children,
  className = '',
  padded = true,
  hover = false,
  glow = false,
  spotlight = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  hover?: boolean;
  glow?: boolean;
  /** Inline overrides merged over the card's own shadow — the wallet-identity
   *  wash (walletWash: background + borderColor) enters through here. */
  style?: React.CSSProperties;
  spotlight?: boolean;
}) {
  // TRES ARTEFACTOS por nivel (stores/motionStore.ts): en FULL el reflejo
  // sigue al cursor en tiempo real y la tarjeta se eleva al pasar; en CALM el
  // reflejo lo sigue CON RETARDO (useCursorGlow, fundador) y la
  // tarjeta sube UN píxel y aclara el borde, despacio (300ms); en MINIMAL no
  // hay reflejo, pierde la sombra, redondea menos y su borde se ve — una
  // hoja, no un panel flotante.
  const level = useMotionLevel();
  const minimal = level === 'minimal';
  // EL TEMA INSTITUCIONAL CONVIERTE LA TARJETA EN UNA LÁMINA: la
  // clase `plate` le pone el doble filete de un título valor (globals.css) y
  // le quita la sombra difusa, que ahí la apaga la regla del material. Y le
  // quita el REFLEJO que sigue al cursor: una luz especular viajando por el
  // panel es el gesto más «nave espacial» que tiene la casa, y es justo el
  // mundo del que este tema sale. Un documento no tiene brillos.
  const engraved = useEngraved();
  const ref = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(false);
  const light = useCursorGlow(ref);
  const track = spotlight && light.active && !engraved;

  return (
    <div
      ref={ref}
      onMouseMove={track ? light.onMove : undefined}
      onMouseEnter={track ? () => setLit(true) : undefined}
      onMouseLeave={track ? () => setLit(false) : undefined}
      className={`relative ${engraved ? 'plate rounded-lg' : minimal ? 'rounded-lg' : 'rounded-2xl'} border bg-surface-1 transition-all duration-200 ${
        glow ? 'border-volt/25' : minimal ? 'border-ink/10' : 'border-ink/[0.05]'
      } ${
        hover
          ? level === 'full'
            ? 'hover:border-ink/[0.09] hover:bg-surface-2 hover:-translate-y-0.5'
            : level === 'calm'
              ? 'duration-300 hover:border-ink/[0.12] hover:bg-surface-2 hover:-translate-y-px'
              : 'hover:border-ink/[0.16]'
          : ''
      } ${padded ? 'p-6' : ''} ${className}`}
      style={{
        boxShadow: minimal
          ? 'none'
          : glow
            ? '0 1px 2px rgba(0,0,0,0.32), 0 0 48px -8px hsl(var(--volt) / 0.14)'
            : '0 1px 2px rgba(0,0,0,0.32), 0 16px 36px -22px rgba(0,0,0,0.7)',
        ...style,
      }}
    >
      {children}
      {track && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] z-[1]"
          style={{ background: light.background }}
          animate={{ opacity: lit ? 1 : 0 }}
          transition={{ duration: 0.5 }}
        />
      )}
    </div>
  );
}

// A single reading. Airy, sentence-case label, calm figure. No decorative hairline,
// no hover gimmick — a stat should sit quietly and be read, not flicker for attention.
export function StatTile({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
}) {
  const tr = useTNode();
  const tones: Record<string, string> = {
    neutral: 'text-ink',
    success: 'text-tone-success',
    warning: 'text-tone-warning',
    danger: 'text-tone-danger',
  };
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-ink/45">{tr(label)}</div>
        {icon ? <span className="text-volt/70">{icon}</span> : null}
      </div>
      <div className={`text-[28px] leading-none font-semibold tracking-tight font-mono ${tones[tone]}`}>{value}</div>
      {hint ? <div className="text-xs text-ink/40 mt-3">{tr(hint)}</div> : null}
    </Card>
  );
}

// Page header. Compact and task-first: the title carries the page, the
// subtitle is one quiet line, and `meta`/`actions` sit on the same baseline so
// live readings live IN the header instead of floating in a separate card.
// The old dot-eyebrow ritual is gone — each page differentiates through its
// content, not through repeated scaffolding.
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  meta,
}: {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Small live reading rendered under the actions, right-aligned. */
  meta?: ReactNode;
}) {
  const tr = useTNode();
  // LA CABECERA CAMBIA DE FORMA, no solo de color. En la lámina, el encabezado
  // de página se convierte en el de un expediente: el epígrafe sube a
  // versalitas espaciadas, el título va en serif y todo el bloque se apoya en
  // una regla doble — gruesa y fina, como la cabecera de un impreso. Es el
  // cambio que se ve en TODAS las pantallas a la vez, porque todas montan
  // este primitivo.
  const engraved = useEngraved();
  return (
    <div className={engraved ? 'mb-8' : ''}>
      <div
        className={`flex flex-col md:flex-row md:items-end md:justify-between gap-4 ${
          engraved ? 'pb-3' : 'mb-8'
        }`}
        style={engraved ? { borderBottom: '1px solid var(--plate-rule)' } : undefined}
      >
        <div className="min-w-0">
          {eyebrow ? (
            engraved ? (
              <div className="plate-register mb-2 text-[10px] text-volt-soft/70">{tr(eyebrow)}</div>
            ) : (
              <div className="text-xs text-ink/40 font-medium mb-2">{tr(eyebrow)}</div>
            )
          ) : null}
          <h1 className="text-[24px] md:text-[28px] font-semibold tracking-tight leading-[1.15] text-ink text-balance">
            {tr(title)}
          </h1>
          {subtitle ? (
            <p className="text-sm text-ink/55 mt-2 max-w-2xl leading-relaxed">{tr(subtitle)}</p>
          ) : null}
        </div>
        {(actions || meta) ? (
          <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
            {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            {meta ? <div>{meta}</div> : null}
          </div>
        ) : null}
      </div>
      {/* El segundo filete de la regla doble. Un div y no un ::after porque
          la cabecera no tiene una caja propia donde anclarlo. */}
      {engraved ? (
        <div className="mt-[2px] h-px" style={{ background: 'var(--plate-rule-soft)' }} aria-hidden />
      ) : null}
    </div>
  );
}

// Hairline-divided group — the calm alternative to a grid of same-weight boxed
// cards. ONE rounded container; a 1px gap over a faint parent surface reads as
// hairline dividers between cells. Cells carry no border of their own.
export function HairlineGroup({
  children,
  className = '',
  columns = '',
}: {
  children: ReactNode;
  className?: string;
  /** Tailwind grid-cols classes, e.g. "grid-cols-2 lg:grid-cols-4". */
  columns?: string;
}) {
  return (
    <div
      className={`ui-hairline-group grid gap-px rounded-2xl overflow-hidden border border-ink/[0.05] bg-ink/[0.06] ${columns} ${className}`}
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.32), 0 16px 36px -22px rgba(0,0,0,0.7)' }}
    >
      {children}
    </div>
  );
}

// A cell inside a HairlineGroup. Lifts tonally on hover when interactive.
export function HairlineCell({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`bg-surface-1 ${interactive ? 'transition-colors duration-200 hover:bg-surface-2' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

// Section heading. Sentence-case, readable weight — the calm replacement for the
// old "uppercase tracking-widest" micro-label that made every section feel technical.
export function SectionTitle({
  children,
  hint,
  actions,
}: {
  children: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  const tr = useTNode();
  // En la lámina, el título de sección se apoya en su regla: es el
  // encabezado de un apartado de documento, no una etiqueta flotando sobre
  // el contenido (globals.css .plate-head).
  const engraved = useEngraved();
  return (
    <div
      className={`flex items-end justify-between gap-4 ${
        engraved ? 'plate-head mb-4 pb-2.5' : 'mb-4'
      }`}
    >
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{tr(children)}</h2>
        {hint ? <div className="text-sm text-ink/45 mt-1">{tr(hint)}</div> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon,
  variant = 'neutral',
  bare = false,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  variant?: 'neutral' | 'error' | 'loading';
  /** True when rendering INSIDE an existing Card/panel — no second box. */
  bare?: boolean;
  /** Optional call-to-action rendered under the hint — an empty first run
   *  should offer the next step, not just describe the absence. */
  action?: ReactNode;
}) {
  const tr = useTNode();
  const tones: Record<string, string> = {
    neutral: 'text-ink/80',
    error: 'text-tone-danger',
    loading: 'text-ink/55',
  };
  // LA ESPERA DE UNA SECCIÓN LLEVA EL COMETA. Una sección vacía que espera dato = AstryumLoader con su
  // línea; el título llega ya traducido y hace de etiqueta. La regla entera
  // (cometa / esqueleto / spinner) está en la cabecera de AstryumLoader.
  const body =
    variant === 'loading' ? (
      <>
        <AstryumLoader size={48} label={typeof title === 'string' ? tr(title) as string : undefined} />
        {hint ? <div className="text-sm text-ink/45 mt-2 max-w-md leading-relaxed">{tr(hint)}</div> : null}
      </>
    ) : (
    <>
      {icon ? <IconTile size="lg" className="mb-4">{icon}</IconTile> : null}
      <div className={`text-sm font-medium ${tones[variant]}`}>{tr(title)}</div>
      {hint ? <div className="text-sm text-ink/45 mt-2 max-w-md leading-relaxed">{tr(hint)}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </>
    );
  if (bare) {
    return <div className="flex flex-col items-center justify-center text-center py-12">{body}</div>;
  }
  return <Card className="flex flex-col items-center justify-center text-center py-16">{body}</Card>;
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  disabledReason,
  type = 'button',
  className = '',
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * POR QUÉ está gris. Un botón apagado sin
   * motivo obliga a repasar el formulario a ciegas; con el motivo encima, el
   * paso se explica solo. Llega YA TRADUCIDO desde el que llama (este
   * primitivo no tiene t()). Solo se enseña mientras `disabled` es true —
   * es la explicación del bloqueo, no un tooltip genérico.
   *
   * Un botón disabled no dispara eventos de ratón en JS, pero SÍ recibe
   * :hover en CSS — el tooltip va por group-hover puro, sin estado. El
   * `title` nativo acompaña como red (lectores, long-press en táctil).
   */
  disabledReason?: string;
  type?: 'button' | 'submit';
  className?: string;
  /** Accessible name for icon-only usages — the visual stays icon-clean. */
  'aria-label'?: string;
}) {
  const showReason = !!disabled && !!disabledReason;
  // TRES ARTEFACTOS por nivel (stores/motionStore.ts): con halo y brillo al
  // pasar (full); plano, sin halo, oscurece un punto al pasar (calm); un
  // CONTORNO volt de esquinas cortas que se rellena al pasar (minimal). En
  // los tres sigue siendo el único botón volt de la pantalla: la jerarquía
  // la lleva el color, no la sombra.
  const level = useMotionLevel();
  const face =
    level === 'minimal'
      ? 'rounded-md border border-volt bg-transparent text-volt hover:bg-volt hover:text-volt-ink'
      : level === 'calm'
        ? 'rounded-xl bg-volt text-volt-ink hover:bg-volt/90 transition-colors'
        : 'rounded-xl bg-volt text-volt-ink hover:brightness-105 transition-all shadow-[0_8px_24px_-10px_hsl(var(--volt)/0.45)]';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={showReason ? disabledReason : undefined}
      className={`ui-primary group/pbtn relative inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-volt/70 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 ${face} ${className}`}
    >
      {children}
      {showReason && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[280px] -translate-x-1/2 translate-y-1 rounded-lg border border-ink/15 bg-surface-3 px-3 py-2 text-left text-[11.5px] font-normal normal-case leading-snug text-ink/85 opacity-0 shadow-xl transition-all duration-200 group-hover/pbtn:translate-y-0 group-hover/pbtn:opacity-100"
        >
          {disabledReason}
          {/* la flechita, del mismo material que el borde */}
          <span
            aria-hidden
            className="absolute left-1/2 top-full -mt-px h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-ink/15 bg-surface-3"
          />
        </span>
      )}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  className = '',
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  /** Accessible name for icon-only usages — the visual stays icon-clean. */
  'aria-label'?: string;
}) {
  // Mínimo: esquinas cortas y sin relleno — la misma hoja que Card y el
  // contorno de PrimaryButton (stores/motionStore.ts).
  const minimal = useMotionLevel() === 'minimal';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`ui-ghost inline-flex items-center justify-center gap-2 px-4 py-2.5 border text-ink/80 text-sm hover:text-ink disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 ${
        minimal ? 'rounded-md border-ink/15 bg-transparent hover:bg-ink/[0.04]' : 'rounded-xl border-ink/10 bg-ink/[0.03] hover:bg-ink/[0.06]'
      } ${className}`}
    >
      {children}
    </button>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { useEngraved, useResolvedTheme } from '../../stores/themeStore';
import { useBalanceVisibility, MASK } from '../../stores/balanceVisibilityStore';
import { useT } from '../../i18n/LanguageProvider';
import { formatMoneyCompact } from '../../lib/formatMoney';
import { softDomain } from '../../lib/charts/softDomain';
import { CountUp, useVeilLifted } from './motion';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  ReferenceLine,
  ReferenceDot,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from 'recharts';

// Distinct hues per slice — the previous warm-gold ramp made adjacent
// allocations (e.g. ETH vs FLR) read as the same colour. Brand gold keeps the
// lead slice; the rest are clearly separable at a glance while staying muted
// enough not to fight the gold-on-space register.
const PALETTE = [
  'hsl(var(--volt))', // authority hue (gold / indigo in Legacy) — largest slice
  '#5B8DEF', // cobalt
  '#3ECFA3', // mint
  '#B45309', // ember
  '#8B5CF6', // violet
  'hsl(var(--volt) / 0.75)', // light authority hue
  '#EC4899', // rose
  '#94A3B8', // slate
];

// Entity-locked hues — colour follows the ENTITY, never its rank. The main
// assets keep their colour in every donut/legend no matter how big the slice
// is or which lens (asset/chain) produced the name:
//   XRP / XRPL → cobalt  ·  FXRP → light blue  ·  FLR family / Flare → pink
//
// FXRP left the cobalt it shared with XRP (founder 2026-08-04: "no puede ser
// que tengan el mismo color") — two slices of the same ring reading identical
// is the one thing a donut may never do. It takes a LIGHTER STEP OF THE SAME
// BLUE, not a new hue, for two reasons: it says what FXRP is (the same asset in
// wrapped form, not a different coin), and lightness is the only separation
// that survives colour blindness — cobalt vs cyan collapses to ΔE ~4 under
// deutan/protan, cobalt vs this ΔE 16.6 (validated, OKLab ×100; ≥8 is the
// target). Its one close neighbour is the slate idle state, which no longer
// shares a ring with assets.
const ENTITY_COLORS: Record<string, string> = {
  XRP: '#5B8DEF',
  FXRP: '#93C5FD',
  XRPL: '#5B8DEF',
  FLR: '#EC4899',
  WFLR: '#EC4899',
  SFLR: '#EC4899',
  FLARE: '#EC4899',
};

// State labels (not assets) that can share a ring with entity slices. Money
// LEAVING a venue (a queued vault exit, arriving on a known date) takes amber —
// moving, not parked. Slate stays RESERVED for idle capital: the "Assets
// Earning" ring no longer draws an idle slice (2026-08-04 — it only charts
// capital placed in a venue), but the hue must never be handed to an asset, so
// a grey wedge can only ever mean "not working".
const STATE_COLORS: Record<string, string> = {
  'NOT EARNING': '#94A3B8',
  'SIN GENERAR': '#94A3B8',
  'ON THE WAY': '#D97706',
  'EN CAMINO': '#D97706',
};

/**
 * Colour assignment for a sorted series list: entity-locked names take their
 * fixed colour; the rest walk the palette, skipping any hue an entity already
 * claimed so two slices can never share a colour. Donut + legends must call
 * this with the SAME sorted names to stay in sync.
 */
/** La luz objetivo de la tinta atenuada, por cara. Sobre grafito la tinta
 *  puede ser clara; sobre papel tiene que ser OSCURA para que cada porción
 *  del anillo pase el 3:1 de WCAG 1.4.11 (la sesión paralela astryum-73 midió
 *  2,5–3,3:1 con una sola luz para las dos caras). Mismo patrón que
 *  --tone-success/warning/danger, que también se oscurecen en claro. Los dos
 *  valores están fijados por prueba contra las superficies reales del tema. */
export const ENGRAVED_L_DARK = 0.6;
export const ENGRAVED_L_LIGHT = 0.42;

export function chartColorsFor(names: string[], opts: { engraved?: boolean; light?: boolean } = {}): string[] {
  const out = new Array<string>(names.length);
  const used = new Set<string>();
  names.forEach((n, i) => {
    const locked = ENTITY_COLORS[n.toUpperCase()] ?? STATE_COLORS[n.toUpperCase()];
    if (locked) {
      out[i] = locked;
      used.add(locked);
    }
  });
  let p = 0;
  names.forEach((_, i) => {
    if (out[i]) return;
    while (used.has(PALETTE[p % PALETTE.length]) && p < PALETTE.length * 2) p++;
    out[i] = PALETTE[p % PALETTE.length];
    used.add(out[i]);
    p++;
  });
  if (!opts.engraved) return out;
  const targetL = opts.light ? ENGRAVED_L_LIGHT : ENGRAVED_L_DARK;
  return out.map((c) => engravedTone(c, targetL));
}

/**
 * LA PALETA DE LA LÁMINA (tema Institucional, 2026-09-14). Los colores de los
 * gráficos son de ESPACIO: cobalto, menta, violeta y rosa a plena saturación,
 * afinados para leerse sobre negro con oro. Sobre grafito y bronce gritan.
 *
 * La regla: el TONO no se toca —el azul de XRP sigue siendo azul, el rosa de
 * Flare sigue siendo rosa, que es lo que hace reconocible a cada activo en
 * todos los anillos y leyendas del panel (y lo único que sobrevive al
 * daltonismo, ver ENTITY_COLORS)— pero la saturación baja a menos de la mitad
 * y la luz se acerca al medio. Tinta de imprenta, no luz de pantalla. Los
 * tokens (`hsl(var(--volt))`) se dejan tal cual: ya son bronce.
 *
 * Es una función pura sobre el hex, así que el anillo y su leyenda —que llaman
 * a chartColorsFor con los mismos nombres— salen iguales por construcción.
 *
 * `targetL` es la luz hacia la que se COMPRIME la paleta (no a la que se
 * iguala): cada color conserva la mitad de su distancia al gris medio, así el
 * azul claro de FXRP sigue siendo un paso más claro que el cobalto de XRP —
 * la separación que sobrevive al daltonismo — pero todos se acercan a la
 * tinta de la cara en que se pintan (ENGRAVED_L_DARK / ENGRAVED_L_LIGHT).
 */
export function engravedTone(color: string, targetL = ENGRAVED_L_DARK): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  const s2 = s * 0.45;
  const l2 = targetL + (l - 0.5) * 0.5;
  return `hsl(${h.toFixed(0)} ${(s2 * 100).toFixed(0)}% ${(l2 * 100).toFixed(0)}%)`;
}

/** Same palette, exported for legends rendered outside this module — prefer
 *  chartColorsFor(names) so entity-locked hues stay in sync with the donut. */
export const CHART_PALETTE = PALETTE;

function tooltipStyle() {
  return {
    contentStyle: {
      background: 'hsl(var(--surface-3) / 0.95)',
      border: '1px solid hsl(var(--ink) / 0.1)',
      borderRadius: 12,
      fontSize: 12,
      fontFamily: 'monospace',
      color: 'hsl(var(--ink))',
    },
    labelStyle: { color: 'hsl(var(--ink) / 0.5)', fontSize: 10, textTransform: 'uppercase' as const },
    itemStyle: { color: 'hsl(var(--ink))' },
  };
}

/**
 * Donut chart for allocation by protocol/asset/kind.
 */
export function AllocationDonut({
  data,
  height = 220,
  fill = false,
}: {
  data: Record<string, number>;
  height?: number;
  /** Fill the parent's height instead of a fixed px height (parent must size itself). */
  fill?: boolean;
}) {
  const { t } = useT();
  const entries = Object.entries(data)
    .filter(([, v]) => Math.abs(v) > 0.01)
    .map(([name, value]) => ({ name, value: Math.abs(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Global hide-balances: percentages keep describing the SHAPE of the
  // allocation, but dollar amounts (tooltip + centre total) mask together
  // with the rest of the app.
  const hidden = useBalanceVisibility((s) => s.hidden);
  // LA LÁMINA (2026-09-14): tinta atenuada, cada porción separada por un
  // filete del color del papel —un anillo grabado, no un anillo de luz— y el
  // barrido de entrada al tempo lento de la casa (900ms, como la curva) para
  // que el anillo se vea LLEGAR: era la queja del Portfolio. En Astryum nada
  // cambia: recharts conserva sus 400ms de siempre.
  const engraved = useEngraved();
  // La tinta se oscurece sobre papel (ENGRAVED_L_LIGHT): el 3:1 del anillo.
  const light = useResolvedTheme() === 'light';
  // EL BARRIDO DEL ANILLO ESPERA AL VELO (14-sep): recharts anima al montar,
  // y en recarga dura el panel monta detrás de la cortina — el anillo se
  // barría a escondidas y aparecía hecho. Cambiar la `key` al caer el velo
  // remonta el gráfico y el barrido se ve; navegando entre páginas el velo
  // ya está levantado y no hay remontaje.
  const lifted = useVeilLifted();

  if (entries.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-ink/30 text-sm">{t('No data')}</div>;
  }
  const total = entries.reduce((s, e) => s + e.value, 0);
  const colors = chartColorsFor(entries.map((e) => e.name), { engraved, light });

  return (
    <div style={{ height: fill ? '100%' : height }} className="relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart key={lifted ? 'live' : 'veiled'}>
          {/* Percentage radii scale with the container, so the ring never
              crops when the card gives it less than 160px of box. */}
          <Pie
            data={entries}
            cx="50%"
            cy="50%"
            innerRadius="62%"
            outerRadius="92%"
            paddingAngle={2}
            dataKey="value"
            stroke={engraved ? 'hsl(var(--surface-1))' : 'none'}
            strokeWidth={engraved ? 1 : 0}
            // EN ASTRYUM, LOS VALORES DE RECHARTS (begin 400 · 1500ms · ease):
            // la primera versión de esta rama (41589223) escribía 400ms para
            // Astryum creyendo que era el valor por defecto, y el anillo pasó a
            // barrer casi cuatro veces más deprisa que antes — «los gráficos se
            // generan súper rápido» (fundador 2026-09-14). Un tema que promete
            // no tocar Astryum no puede pasar ni un número que no sea el suyo:
            // `undefined` deja el valor de la librería, sea cual sea.
            animationDuration={engraved ? 900 : undefined}
            animationEasing={engraved ? 'ease-out' : undefined}
          >
            {entries.map((_, i) => (
              <Cell key={i} fill={colors[i]} />
            ))}
          </Pie>
          <Tooltip
            {...tooltipStyle()}
            formatter={(v: number) =>
              hidden
                ? [`${((v / total) * 100).toFixed(1)}%`, '']
                : [`$${v.toFixed(2)} (${((v / total) * 100).toFixed(1)}%)`, '']
            }
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-xs text-ink/40">{t('total')}</div>
        {/* La cifra del centro cuenta hasta su valor, como el resto de las
            cifras de la casa — y vuelve a contar cuando el anillo cambia de
            lectura, así que el cambio se ve, no solo se sustituye. */}
        <div className="text-base font-mono text-ink">
          {hidden ? MASK : <CountUp value={total} format={fmtCompactUSD} />}
        </div>
      </div>
    </div>
  );
}

// Delegates to the ONE money voice (locale-aware; the local version printed
// "$2500" — the last survivor without thousands separators).
function fmtCompactUSD(v: number): string {
  return formatMoneyCompact(v);
}

// Real token amounts read as "12.4" / "3.2K" — full precision lives in tooltips.
function fmtQty(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

/**
 * Legend for AllocationDonut — pair them in a flex row.
 * Optional: `showUSD` adds the dollar value per slice; `qty` adds the real
 * token quantity per slice (only rendered for names present in the map).
 */
export function AllocationLegend({
  data,
  qty,
  showUSD = false,
}: {
  data: Record<string, number>;
  qty?: Record<string, number>;
  showUSD?: boolean;
}) {
  const entries = Object.entries(data)
    .filter(([, v]) => Math.abs(v) > 0.01)
    .map(([name, value]) => ({ name, value: Math.abs(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const total = entries.reduce((s, e) => s + e.value, 0) || 1;
  // La leyenda pide sus colores con LOS MISMOS nombres y el mismo tema que el
  // anillo: así los dos salen iguales por construcción (chartColorsFor).
  const engraved = useEngraved();
  const light = useResolvedTheme() === 'light';
  const colors = chartColorsFor(entries.map((e) => e.name), { engraved, light });
  // Global hide-balances: amounts (USD + token qty) mask, percentages stay.
  const hidden = useBalanceVisibility((s) => s.hidden);
  return (
    <ul className="space-y-1.5 text-xs font-mono">
      {entries.map((e, i) => {
        const q = qty?.[e.name];
        return (
          <li key={e.name} className="flex items-baseline gap-2 min-w-0">
            <span
              className="w-2.5 h-2.5 rounded-sm flex-shrink-0 self-center"
              style={{ background: colors[i] }}
            />
            <span className="text-ink/70 truncate">{e.name}</span>
            {q != null && q > 0 && (
              <span className="text-ink/35 truncate">{hidden ? MASK : fmtQty(q)}</span>
            )}
            <span className="ml-auto flex items-baseline gap-2.5 shrink-0">
              {showUSD && <span className="text-ink/60">{hidden ? MASK : fmtCompactUSD(e.value)}</span>}
              <span className="text-ink/40 w-9 text-right">{((e.value / total) * 100).toFixed(0)}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Health Factor radial gauge.
 *  HF >= 2 → emerald, 1.5..2 → blue, 1.2..1.5 → amber, <1.2 → red
 */
export function HealthFactorGauge({ value, height = 180 }: { value?: number; height?: number }) {
  const { t } = useT();
  if (value === undefined || value === null) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-ink/30 text-sm">
        {t('No HF data')}
      </div>
    );
  }
  // Display range 0..3 mapped to 0..100
  const pct = Math.max(0, Math.min(100, (value / 3) * 100));
  const color =
    value >= 2
      ? '#34d399'
      : value >= 1.5
      ? '#86efac'
      : value >= 1.2
      ? '#fbbf24'
      : '#f87171';
  const data = [{ name: 'hf', value: pct, fill: color }];
  return (
    <div style={{ height }} className="relative">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={data}
          startAngle={210}
          endAngle={-30}
          innerRadius="70%"
          outerRadius="100%"
          barSize={14}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background={{ fill: 'hsl(var(--ink) / 0.05)' }} dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-xs text-ink/40">{t('Health Factor')}</div>
        <div className="text-3xl font-mono font-semibold" style={{ color }}>
          {value.toFixed(2)}
        </div>
        <div className="text-[10px] text-ink/40 mt-1">
          {value >= 2 ? 'Safe' : value >= 1.5 ? 'OK' : value >= 1.2 ? 'Watch' : 'Danger'}
        </div>
      </div>
    </div>
  );
}

/**
 * Drivers bar list (horizontal). For risk drivers and similar weighted lists.
 */
export function DriversBars({
  drivers,
}: {
  drivers: { name: string; contribution: number }[];
}) {
  const { t } = useT();
  if (drivers.length === 0) {
    return <div className="text-ink/40 text-sm py-2">{t('No drivers')}</div>;
  }
  return (
    <ul className="space-y-3 text-sm">
      {drivers.map((d, i) => (
        <li key={d.name}>
          <div className="flex justify-between font-mono text-xs mb-1.5">
            <span className="text-ink/70 truncate max-w-[70%]">{d.name}</span>
            <span className="text-ink/60">{(d.contribution * 100).toFixed(0)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink/5 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, d.contribution * 100)}%`,
                background: `linear-gradient(90deg, hsl(var(--volt) / ${Math.max(0.45, 0.9 - i * 0.12)}), hsl(var(--volt) / ${Math.max(0.3, 0.6 - i * 0.1)}))`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Time series (used for portfolio history, perf, gas trend).
 */
/**
 * AxisTick — una marca del eje del tiempo que ENTRA cuando su texto cambia.
 *
 * Recharts pinta los ticks como `<text>` planos: al cambiar de ventana las
 * fechas se sustituían en el sitio, sin que se viera que había pasado nada
 * (fundador 2026-08-25: «quiero que se muevan las fechas de debajo… y que se
 * muevan según cambia de filtro el usuario»). Aquí cada etiqueta es un
 * `motion.text` con `key` en su propio contenido: cuando el texto cambia,
 * framer la trata como un elemento nuevo y la hace entrar desplazándose. El
 * `animationKey` entra en la key para que un cambio de ventana mueva TODAS,
 * incluidas las que por casualidad repitan texto.
 *
 * Recharts inyecta `x`, `y` y `payload`; el resto de props que pasa se ignoran
 * sin ruido.
 */
function AxisTick({
  x,
  y,
  payload,
  animationKey,
  index = 0,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
  animationKey?: string | number;
  index?: number;
}) {
  const reduce = useReducedMotion();
  const label = String(payload?.value ?? '');
  if (x == null || y == null) return null;
  return (
    <motion.text
      key={`${animationKey ?? ''}:${label}`}
      x={x}
      y={y}
      dy={10}
      textAnchor="middle"
      fill="hsl(var(--ink) / 0.45)"
      fontSize={10}
      fontFamily="monospace"
      // EL BUG QUE BORRÓ LOS DÍAS (fundador 2026-08-27: «ya no aparecen los
      // días debajo del chart»): en un elemento SVG, framer trata `y` como
      // TRANSFORM, no como el atributo — animar hacia `y` (la coordenada
      // absoluta, ~200px) apilaba un translateY(200px) sobre el atributo ya
      // correcto y empujaba cada etiqueta fuera del lienzo. Aquí `y` es un
      // DELTA: nace 6px abajo y se desliza a su sitio.
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: reduce ? 0 : Math.min(index * 0.03, 0.24) }}
    >
      {label}
    </motion.text>
  );
}

/** El punto VIVO del final de la curva: el último valor, latiendo. SMIL
 *  nativo (<animate>) y no CSS: un transform escalado sobre un <circle> exige
 *  transform-box y se descentra; el atributo `r` animado no. Bajo
 *  reduced-motion, quieto. */
function EndPulse({ cx, cy, color, still }: { cx?: number; cy?: number; color: string; still: boolean }) {
  if (cx == null || cy == null) return null;
  return (
    <g>
      {!still && (
        <circle cx={cx} cy={cy} r={4} fill={color} opacity={0.45}>
          <animate attributeName="r" values="4;12" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.45;0" dur="1.8s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="hsl(var(--surface-1))" strokeWidth={2} />
    </g>
  );
}

/** El tooltip de la casa para la curva: fecha, valor y la diferencia contra
 *  el arranque de la ventana — lo que de verdad se pregunta al posar el
 *  cursor no es «cuánto» sino «cuánto más o menos que al principio». */
function PerfTooltip({
  active,
  payload,
  label,
  start,
  fmt,
  hidden,
  sinceLabel,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  start: number | null;
  fmt: (v: number) => string;
  hidden: boolean;
  sinceLabel: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = Number(payload[0]?.value ?? 0);
  const delta = start != null ? v - start : null;
  const pct = start != null && start !== 0 && delta != null ? (delta / start) * 100 : null;
  const up = (delta ?? 0) >= 0;
  return (
    <div className="rounded-xl border border-ink/10 bg-surface-2/95 px-3 py-2 shadow-xl backdrop-blur-sm">
      <div className="font-mono text-[10px] uppercase tracking-wide text-ink/45">{label}</div>
      <div className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-ink">{fmt(v)}</div>
      {delta != null && !hidden && (
        <div className={`mt-0.5 font-mono text-[11px] tabular-nums ${up ? 'text-tone-success' : 'text-tone-danger'}`}>
          {up ? '+' : '−'}{fmt(Math.abs(delta))}
          {pct != null && ` (${up ? '+' : ''}${pct.toFixed(2)}%)`}
          <span className="ml-1 text-ink/35">{sinceLabel}</span>
        </div>
      )}
    </div>
  );
}

export function PerfLine({
  points,
  dataKey = 'value',
  height = 220,
  color = 'hsl(var(--volt))',
  formatY = (v: number) => `$${v.toFixed(0)}`,
  animationKey,
  onHover,
  baseline = true,
}: {
  points: { t: string; value: number }[];
  dataKey?: string;
  height?: number;
  color?: string;
  formatY?: (v: number) => string;
  /**
   * Cambia cuando cambia LA VENTANA de tiempo (no cuando llegan datos nuevos).
   * Al cambiar, la curva se vuelve a dibujar y el eje de abajo entra con ella:
   * sin esto, elegir otro rango sustituía las etiquetas de golpe y no se veía
   * que hubiera pasado nada (fundador 2026-08-25). Sin la prop, el gráfico se
   * comporta como siempre — los demás consumidores no cambian.
   */
  animationKey?: string | number;
  /** SCRUB (2026-09-07): el punto bajo el cursor, o null al salir. Quien lo
   *  monta puede hacer que su cifra grande siga al cursor — el gesto de las
   *  apps de bolsa. Sin la prop, nada cambia. */
  onHover?: (p: { t: string; value: number } | null) => void;
  /** La línea punteada del valor de ARRANQUE de la ventana: la referencia
   *  que convierte la curva en «¿voy mejor o peor que al principio?». */
  baseline?: boolean;
}) {
  const { t } = useT();
  const reduce = useReducedMotion();
  // El pulso del último valor es un bucle: solo en el nivel COMPLETO.
  const level = useMotionLevel();
  // LA CURVA GRABADA (tema Institucional, 2026-09-14): sin resplandor bajo la
  // línea —un halo es luz, y en la lámina no hay luz—, el área rellena con
  // un TRAMADO de líneas finas en vez de un degradado, la rejilla en filetes
  // continuos y el punto del final quieto. La forma de la curva, su trazado
  // de una sola vez y el scrub no cambian: cambia el material.
  const engraved = useEngraved();
  // Global hide-balances: the curve's SHAPE stays, the y-axis figures and
  // tooltip amounts mask with the rest of the app.
  const hidden = useBalanceVisibility((s) => s.hidden);
  const fmt = hidden ? () => MASK : formatY;
  /** El primer trazado, y solo el primero — ver el comentario del <Area>. */
  const [drawOnce, setDrawOnce] = useState(() => !reduce);
  // LA CURVA SE TRAZA CUANDO CAE EL VELO (14-sep): en recarga dura el primer
  // trazado corría detrás de la cortina y `onAnimationEnd` lo daba por hecho.
  // Al caer el velo el gráfico se remonta (key) y el trazado vuelve a estar
  // permitido UNA vez; después rige la regla de siempre (nunca regenerar al
  // cambiar de ventana). Navegando, el velo ya está alto: nada cambia.
  const lifted = useVeilLifted();
  useEffect(() => {
    if (lifted) setDrawOnce(!reduce);
  }, [lifted, reduce]);
  // EL EJE VERTICAL ES DINÁMICO (fundador 2026-09-10: «parece que baja mucho
  // por poco cambio… más sutil, pero no plano»): abarca al menos un 5 % del
  // valor y crece con la variación real. Ver lib/charts/softDomain.ts.
  const yDomain = useMemo(
    () => softDomain(points.map((p) => Number((p as Record<string, unknown>)[dataKey]))),
    [points, dataKey],
  );
  if (points.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-ink/30 text-sm">{t('No history')}</div>;
  }
  const start = points.length > 1 ? points[0].value : null;
  const last = points[points.length - 1];
  const sinceLabel = t('vs start');
  return (
    // LA CURVA NO SE REGENERA (fundador 2026-08-25: «cada vez que clico se
    // genera de nuevo el gráfico, no quiero eso»). El intento anterior
    // re-montaba el gráfico con una `key` para que recharts lo redibujara —
    // demasiado: al cambiar de ventana lo único que debe moverse es el EJE DEL
    // TIEMPO, que es lo que de verdad cambia. La línea se limita a adoptar sus
    // nuevos valores, sin volver a dibujarse desde cero.
    //
    // v2 (fundador 2026-09-07: «se ve un poco cutre»): resplandor bajo la
    // línea, línea base punteada del arranque de la ventana, punto vivo al
    // final, tooltip propio con la diferencia, eje Y compacto y escaso, y
    // scrub hacia la cabecera. La forma de la curva y su regla de no
    // regenerarse no cambian.
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          key={lifted ? 'live' : 'veiled'}
          data={points}
          margin={{ top: 12, right: 12, left: 4, bottom: 0 }}
          onMouseMove={(st) => {
            if (!onHover) return;
            const i = typeof st?.activeTooltipIndex === 'number' ? st.activeTooltipIndex : Number(st?.activeTooltipIndex);
            onHover(Number.isFinite(i) && points[i] ? points[i] : null);
          }}
          onMouseLeave={() => onHover?.(null)}
        >
          <defs>
            <linearGradient id="perf-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.42} />
              <stop offset="45%" stopColor={color} stopOpacity={0.12} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
            {/* El resplandor: la misma curva, más gruesa y difuminada, debajo. */}
            <filter id="perf-glow" x="-10%" y="-40%" width="120%" height="180%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
            {/* El tramado de la lámina: líneas finas a 45°, del color de la
                curva. Es el sombreado de un grabado — tinta, no luz. */}
            <pattern id="perf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="0.8" strokeOpacity="0.32" />
            </pattern>
          </defs>
          <CartesianGrid
            stroke={`hsl(var(--ink) / ${engraved ? 0.09 : 0.06})`}
            strokeDasharray={engraved ? undefined : '2 6'}
            vertical={false}
          />
          {/* EL EJE DEL TIEMPO ES LO QUE SE MUEVE. Más marcas que antes
              (minTickGap 28 → 14: cabía el doble y se estaban tirando etiquetas
              que sí caben) y cada una con su tick, para que la barra de abajo
              se lea como una regla y no como cuatro palabras sueltas. Y cada
              etiqueta ENTRA cuando cambia: `AxisTick` se anima keyed por su
              propio texto, así que al cambiar de ventana las fechas se
              desplazan y se sustituyen a la vista — que es el único sitio donde
              el usuario pidió movimiento. */}
          <XAxis
            dataKey="t"
            tick={<AxisTick animationKey={animationKey} />}
            tickLine={{ stroke: 'hsl(var(--ink) / 0.12)' }}
            axisLine={false}
            minTickGap={14}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          {/* Pocas cifras y compactas: el eje acompaña, no compite. */}
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(var(--ink) / 0.4)', fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            tickCount={4}
            width={52}
            domain={yDomain}
            tickFormatter={fmt}
          />
          <Tooltip
            cursor={{ stroke: 'hsl(var(--volt) / 0.35)', strokeWidth: 1, strokeDasharray: engraved ? undefined : '3 4' }}
            content={<PerfTooltip start={start} fmt={fmt} hidden={hidden} sinceLabel={sinceLabel} />}
          />
          {baseline && start != null && (
            <ReferenceLine y={start} stroke="hsl(var(--ink) / 0.22)" strokeDasharray="2 6" ifOverflow="extendDomain" />
          )}
          {/* El resplandor — debajo de la línea de verdad, sin relleno. En la
              lámina no se monta: un halo es luz. */}
          {!engraved && (
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={7}
              strokeOpacity={0.22}
              fill="none"
              filter="url(#perf-glow)"
              isAnimationActive={drawOnce && !hidden}
              animationDuration={900}
              animationEasing="ease-out"
              activeDot={false}
              dot={false}
            />
          )}
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={engraved ? 1.75 : 2.25}
            fill={engraved ? 'url(#perf-hatch)' : 'url(#perf-grad)'}
            // LA CURVA SE DIBUJA UNA VEZ — la primera (fundador 2026-08-27:
            // «mejora la animación»), y NUNCA al cambiar de ventana (fundador
            // 2026-08-25: «cada vez que clico se genera de nuevo, no quiero
            // eso»). Las dos cosas a la vez: la animación está viva solo hasta
            // que termina su primer trazado; onAnimationEnd la apaga, así que
            // cualquier cambio de datos posterior — el filtro de fechas —
            // adopta sus valores en seco, como se pidió.
            isAnimationActive={drawOnce && !hidden}
            animationDuration={900}
            animationEasing="ease-out"
            onAnimationEnd={() => setDrawOnce(false)}
            activeDot={{ r: 4.5, fill: color, stroke: 'hsl(var(--surface-1))', strokeWidth: 2 }}
          />
          {points.length > 1 && (
            <ReferenceDot
              x={last.t}
              y={last.value}
              r={0}
              shape={<EndPulse color={color} still={level !== 'full' || hidden || engraved} />}
              ifOverflow="visible"
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Axis-free area sparkline — the compact performance chart on the dashboard.
 * No grid, no axes: just the shape of the value over time plus a tooltip.
 */
export function MiniArea({
  points,
  color = 'hsl(var(--volt))',
  height = 96,
  formatY = (v: number) => `$${v.toFixed(2)}`,
}: {
  points: { t: string; value: number }[];
  color?: string;
  height?: number;
  formatY?: (v: number) => string;
}) {
  const { t } = useT();
  // Global hide-balances: tooltip amounts mask, the sparkline shape stays.
  const hidden = useBalanceVisibility((s) => s.hidden);
  const fmt = hidden ? () => MASK : formatY;
  if (points.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-ink/30 text-xs">
        {t('No history yet')}
      </div>
    );
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="mini-area-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip {...tooltipStyle()} formatter={(v: number) => [fmt(v), '']} labelFormatter={(l) => String(l)} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#mini-area-grad)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}


/**
 * OrbitDial — the brand's replacement for the red/green gauge. One dotted
 * orbit; a glowing gold planet travels it as far as the reading says (0 =
 * parked at the start, 100 = a full working orbit), leaving a gold trail arc
 * behind it. The metaphor is literal: how far your capital has gotten into
 * orbit. The value is computed by the caller from REAL data — this only draws.
 * `value: null` renders the empty orbit with no planet.
 */
export function OrbitDial({
  value,
  words,
  size = 136,
}: {
  value: number | null;
  words?: string;
  size?: number;
}) {
  const reduced = useReducedMotion();
  // EL CALIBRE (tema Institucional, 2026-09-14): el planeta luminoso sobre su
  // órbita punteada es la escena solar de la landing en miniatura. En la
  // lámina el mismo instrumento es un calibre GRABADO: corona de graduación,
  // arco recorrido en tinta plana y una aguja con su punto, sin halo. El
  // valor, la animación del vuelo y la cifra del centro no cambian.
  const engraved = useEngraved();
  // El vuelo arranca cuando cae el velo del arranque, no al montar (14-sep).
  const lifted = useVeilLifted();
  const target = value == null ? null : Math.max(0, Math.min(100, value));
  // Animated fraction 0..1 — the planet flies to its reading on load/refresh.
  const [frac, setFrac] = useState(() => (reduced && target != null ? target / 100 : 0));
  const prev = useRef(frac);
  useEffect(() => {
    const to = (target ?? 0) / 100;
    if (reduced) {
      prev.current = to;
      setFrac(to);
      return;
    }
    if (!lifted) return;
    const controls = animate(prev.current, to, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setFrac(v),
    });
    prev.current = to;
    return () => controls.stop();
  }, [target, reduced, lifted]);

  const c = 68;
  const r = 54;
  const C = 2 * Math.PI * r;
  // Start at the top, travel clockwise.
  const a = -Math.PI / 2 + frac * 2 * Math.PI;
  const px = c + Math.cos(a) * r;
  const py = c + Math.sin(a) * r;

  return (
    <div style={{ width: size, maxWidth: '100%' }} className="relative">
      <svg viewBox="0 0 136 136" className="w-full" role="img" aria-label="Capital in orbit dial">
        <defs>
          <linearGradient id="od-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt))' }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-soft))' }} />
          </linearGradient>
          <radialGradient id="od-planet" cx="0.35" cy="0.3" r="1">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--volt-hi))' }} />
            <stop offset="45%" style={{ stopColor: 'hsl(var(--volt-soft))' }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--volt-deep))' }} />
          </radialGradient>
        </defs>

        {engraved ? (
          <>
            {/* la corona de graduación: 40 marcas, larga cada cinco */}
            <g stroke="hsl(var(--ink) / 0.32)" strokeLinecap="round" strokeWidth="1">
              {Array.from({ length: 40 }, (_, i) => {
                const ta = (i * Math.PI) / 20;
                const long = i % 5 === 0;
                const r1 = long ? r + 4 : r + 6.5;
                return (
                  <line
                    key={i}
                    x1={c + Math.cos(ta) * r1}
                    y1={c + Math.sin(ta) * r1}
                    x2={c + Math.cos(ta) * (r + 9)}
                    y2={c + Math.sin(ta) * (r + 9)}
                    strokeOpacity={long ? 1 : 0.55}
                  />
                );
              })}
            </g>
            {/* el filete de la esfera, continuo */}
            <circle cx={c} cy={c} r={r} fill="none" stroke="hsl(var(--ink) / 0.18)" strokeWidth="1" />
          </>
        ) : (
          /* the orbit — dotted, like the landing's rings */
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke="hsl(var(--ink) / 0.13)"
            strokeWidth="1.4"
            strokeDasharray="0.1 5.5"
            strokeLinecap="round"
          />
        )}

        {target != null && engraved && (
          <>
            {/* el arco recorrido, en tinta plana */}
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="hsl(var(--volt))"
              strokeWidth="2"
              strokeLinecap="butt"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              transform={`rotate(-90 ${c} ${c})`}
              opacity="0.9"
            />
            {/* la aguja: del centro hacia la lectura, con su punto en la esfera */}
            <line
              x1={c + Math.cos(a) * 30}
              y1={c + Math.sin(a) * 30}
              x2={c + Math.cos(a) * (r + 2)}
              y2={c + Math.sin(a) * (r + 2)}
              stroke="hsl(var(--volt))"
              strokeWidth="1.4"
              strokeLinecap="round"
              opacity="0.9"
            />
            <circle cx={px} cy={py} r="3" fill="hsl(var(--volt))" />
            <circle cx={px} cy={py} r="1.2" fill="hsl(var(--surface-1))" />
          </>
        )}

        {target != null && !engraved && (
          <>
            {/* the trail the planet has covered */}
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="url(#od-arc)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - frac)}
              transform={`rotate(-90 ${c} ${c})`}
              opacity="0.85"
            />
            {/* the planet — glow halo + lit body, riding the orbit */}
            <circle cx={px} cy={py} r="9" style={{ fill: 'hsl(var(--volt-soft) / 0.18)' }} />
            <circle cx={px} cy={py} r="4.4" fill="url(#od-planet)" />
          </>
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none pointer-events-none">
        <span className="font-mono text-2xl font-semibold text-ink">
          {target == null ? '—' : Math.round(frac * 100)}
        </span>
        {words && <div className="text-[10px] text-ink/45 mt-1.5 max-w-[86px] mx-auto leading-snug">{words}</div>}
      </div>
    </div>
  );
}

/**
 * Simple line (not area) — used for risk score over time, etc.
 */
export function MiniLine({
  points,
  color = 'hsl(var(--volt))',
  height = 60,
}: {
  points: number[];
  color?: string;
  height?: number;
}) {
  const data = points.map((v, i) => ({ i, v }));
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

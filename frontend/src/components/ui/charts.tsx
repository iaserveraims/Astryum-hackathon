'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { useBalanceVisibility, MASK } from '../../stores/balanceVisibilityStore';
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

// Entity-locked hues — colour follows the ENTITY, never its rank. The two
// main assets keep their colour in every donut/legend no matter how big the
// slice is or which lens (asset/chain) produced the name:
//   XRP family / XRPL  → blue   ·  FLR family / Flare → pink
const ENTITY_COLORS: Record<string, string> = {
  XRP: '#5B8DEF',
  FXRP: '#5B8DEF',
  XRPL: '#5B8DEF',
  FLR: '#EC4899',
  WFLR: '#EC4899',
  SFLR: '#EC4899',
  FLARE: '#EC4899',
};

/**
 * Colour assignment for a sorted series list: entity-locked names take their
 * fixed colour; the rest walk the palette, skipping any hue an entity already
 * claimed so two slices can never share a colour. Donut + legends must call
 * this with the SAME sorted names to stay in sync.
 */
export function chartColorsFor(names: string[]): string[] {
  const out = new Array<string>(names.length);
  const used = new Set<string>();
  names.forEach((n, i) => {
    const locked = ENTITY_COLORS[n.toUpperCase()];
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
  return out;
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
  const entries = Object.entries(data)
    .filter(([, v]) => Math.abs(v) > 0.01)
    .map(([name, value]) => ({ name, value: Math.abs(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  // Global hide-balances: percentages keep describing the SHAPE of the
  // allocation, but dollar amounts (tooltip + centre total) mask together
  // with the rest of the app.
  const hidden = useBalanceVisibility((s) => s.hidden);

  if (entries.length === 0) {
    return <div className="h-[220px] flex items-center justify-center text-ink/30 text-sm">No data</div>;
  }
  const total = entries.reduce((s, e) => s + e.value, 0);
  const colors = chartColorsFor(entries.map((e) => e.name));

  return (
    <div style={{ height: fill ? '100%' : height }} className="relative">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
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
            stroke="none"
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
        <div className="text-xs text-ink/40">total</div>
        <div className="text-base font-mono text-ink">{hidden ? MASK : fmtCompactUSD(total)}</div>
      </div>
    </div>
  );
}

function fmtCompactUSD(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (Math.abs(v) >= 1_000) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
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
  const colors = chartColorsFor(entries.map((e) => e.name));
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
  if (value === undefined || value === null) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-ink/30 text-sm">
        No HF data
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
        <div className="text-xs text-ink/40">Health Factor</div>
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
  if (drivers.length === 0) {
    return <div className="text-ink/40 text-sm py-2">No drivers</div>;
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
export function PerfLine({
  points,
  dataKey = 'value',
  height = 220,
  color = 'hsl(var(--volt))',
  formatY = (v: number) => `$${v.toFixed(0)}`,
}: {
  points: { t: string; value: number }[];
  dataKey?: string;
  height?: number;
  color?: string;
  formatY?: (v: number) => string;
}) {
  // Global hide-balances: the curve's SHAPE stays, the y-axis figures and
  // tooltip amounts mask with the rest of the app.
  const hidden = useBalanceVisibility((s) => s.hidden);
  const fmt = hidden ? () => MASK : formatY;
  if (points.length === 0) {
    return <div style={{ height }} className="flex items-center justify-center text-ink/30 text-sm">No history</div>;
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="perf-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(var(--ink) / 0.05)" vertical={false} />
          {/* minTickGap keeps date labels from piling on top of each other when
              the series carries many days. */}
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10, fill: 'hsl(var(--ink) / 0.4)', fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(var(--ink) / 0.4)', fontFamily: 'monospace' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmt}
          />
          <Tooltip {...tooltipStyle()} formatter={(v: number) => [fmt(v), '']} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill="url(#perf-grad)"
          />
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
  // Global hide-balances: tooltip amounts mask, the sparkline shape stays.
  const hidden = useBalanceVisibility((s) => s.hidden);
  const fmt = hidden ? () => MASK : formatY;
  if (points.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-ink/30 text-xs">
        No history yet
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
    const controls = animate(prev.current, to, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setFrac(v),
    });
    prev.current = to;
    return () => controls.stop();
  }, [target, reduced]);

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

        {/* the orbit — dotted, like the landing's rings */}
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

        {target != null && (
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

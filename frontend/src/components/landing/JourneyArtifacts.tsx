'use client';

/**
 * Astryum landing — journey artifacts.
 *
 * Miniature product vignettes, one per Solar Journey stop: tiny, self-drawn
 * echoes of the real dashboard widgets (net worth + orbit dial, strategy card,
 * position health, wallet cards, the Legacy council). Deliberately
 * re-implemented as light SVG/div illustrations — importing the real chart
 * components would drag recharts into the landing bundle. Decorative
 * (aria-hidden); the stop's copy carries the meaning. Loops run only while the
 * stop is active and die under prefers-reduced-motion.
 *
 * Every artifact accepts the journey's palette (`accent`/`soft`, gold by
 * default) so the Legacy product re-tints them indigo; the entity colors
 * (XRP cobalt, FLR pink) and the state greens are locked and never re-tint.
 *
 * Copy rules honored: no yield numbers, no promises. Rates are referenced only
 * as protocol data with a source; the user (or the council) always signs.
 */

import type { CSSProperties, ReactNode } from 'react';
import { BORDER, GOLD } from './interactions';

type Lang = 'es' | 'en';
const T = (es: string, en: string, l: Lang) => (l === 'es' ? es : en);

const GOLD_SOFT = '#E8C25A';
// Entity colors locked by the dashboard palette (XRP/XRPL cobalt, FLR/Flare pink).
const XRP_BLUE = '#5B8DEF';
const FLR_PINK = '#EC4899';
const OK_GREEN = '#34D399';

// `accent`/`soft` are solid colors (may be CSS-var strings — never concat hex
// alpha onto them); `rgb` is the accent as an 'r,g,b' triplet for rgba() mixes.
type ArtifactProps = { lang: Lang; active: boolean; accent?: string; soft?: string; rgb?: string };

const CARD: CSSProperties = {
  border: `1px solid ${BORDER}`,
  background: 'rgba(12,11,9,0.62)',
  borderRadius: 14,
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <div aria-hidden className="px-4 py-3.5 w-full max-w-[380px]" style={CARD}>
      {children}
    </div>
  );
}

function Micro({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">{children}</div>;
}

// Shared keyframes for the vignette loops. Rendered once per artifact — the
// names are namespaced (ja-*) so they can't collide with the landing's own.
const JA_CSS = `
  @keyframes jaOrbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes jaMote { 0% { left: 4%; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { left: 92%; opacity: 0; } }
  @keyframes jaPulse { 0%, 100% { opacity: 0.45; transform: scale(1); } 50% { opacity: 1; transform: scale(1.3); } }
  @media (prefers-reduced-motion: reduce) { .ja-anim { animation: none !important; } }
`;

// The vignette planet dots share a neutral dark rim so one gradient serves
// both palettes.
const dotGradient = (color: string) => `radial-gradient(circle at 35% 30%, #fff, ${color} 46%, #14121F 100%)`;

// ─── Summary — net worth + the "capital in orbit" dial ──────────────────────
export function SummaryArtifact({ lang, active, accent = GOLD, rgb = '201,162,39' }: ArtifactProps) {
  // Chain-level split (not wallet names) so the vignette is true for both
  // products: personal wallets or the governed Legacy account.
  const wallets = [
    { color: XRP_BLUE, name: 'XRPL', w: '62%' },
    { color: FLR_PINK, name: 'Flare', w: '38%' },
  ];
  return (
    <Frame>
      <style>{JA_CSS}</style>
      <div className="flex items-center justify-between gap-5">
        <div className="min-w-0">
          <Micro>{T('Patrimonio neto', 'Net worth', lang)}</Micro>
          <div className="mt-1 font-mono text-[22px] leading-none text-white tracking-tight">$24,918</div>
          <div className="mt-3 space-y-1.5">
            {wallets.map((w) => (
              <div key={w.name} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: w.color }} />
                <span className="text-[11px] text-white/55 whitespace-nowrap">{w.name}</span>
                <span className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <span className="block h-full rounded-full" style={{ width: w.w, background: w.color, opacity: 0.75 }} />
                </span>
              </div>
            ))}
          </div>
        </div>
        {/* orbit dial — the Summary page's "capital in orbit" gauge, miniaturized */}
        <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
          <div className="absolute inset-0 rounded-full" style={{ border: `1px dashed rgba(${rgb},0.35)` }} />
          <div className="absolute inset-0 ja-anim" style={{ animation: active ? 'jaOrbit 14s linear infinite' : 'none' }}>
            <span
              className="absolute rounded-full"
              style={{ width: 9, height: 9, top: -4.5, left: '50%', marginLeft: -4.5, background: dotGradient(accent) }}
            />
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/35 text-center leading-tight">
              {T('En órbita', 'In orbit', lang)}
            </span>
          </div>
        </div>
      </div>
      {/* performance sparkline — the Capital Performance band, in one stroke */}
      <div className="mt-3 pt-3 flex items-center gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <span className="text-[9px] font-mono uppercase tracking-wider text-white/35 whitespace-nowrap">
          {T('Rendimiento · 7d', 'Performance · 7d', lang)}
        </span>
        <svg viewBox="0 0 120 22" preserveAspectRatio="none" className="flex-1 h-[22px]" fill="none">
          <polyline
            points="0,17 14,15 28,16 42,11 56,13 70,8 84,10 98,6 112,7 120,4"
            stroke={accent}
            strokeOpacity="0.8"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx="120" cy="4" r="2" fill={accent} />
        </svg>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: OK_GREEN }} />
          <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: OK_GREEN }}>
            {T('Salud 1.86', 'Health 1.86', lang)}
          </span>
        </span>
      </div>
    </Frame>
  );
}

// ─── Earn — a strategy card in miniature: live-rate chip + token flow strip ──
export function EarnArtifact({ lang, active, accent = GOLD, soft = GOLD_SOFT, rgb = '201,162,39' }: ArtifactProps) {
  const nodes = [
    { at: '4%', label: 'Wallet' },
    { at: '48%', label: 'FXRP' },
    { at: '92%', label: 'Kinetic' },
  ];
  return (
    <Frame>
      <style>{JA_CSS}</style>
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md tracking-wider whitespace-nowrap"
          style={{ background: `rgba(${rgb},0.1)`, color: accent, border: `1px solid rgba(${rgb},0.3)` }}
        >
          FXRP → Kinetic
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 ja-anim"
            style={{ background: OK_GREEN, animation: active ? 'jaPulse 2.2s ease-in-out infinite' : 'none' }}
          />
          <span className="text-[9px] font-mono uppercase tracking-wider truncate" style={{ color: OK_GREEN }}>
            {T('Tipo en vivo · con fuente', 'Live rate · with source', lang)}
          </span>
        </span>
      </div>
      {/* flow strip — the token's journey, wallet → conversion → venue */}
      <div className="relative mt-4 h-10">
        <div
          className="absolute left-1 right-1 top-[9px] h-px"
          style={{ background: `linear-gradient(90deg, transparent, rgba(${rgb},0.4), transparent)` }}
        />
        {/* no glow on the mote — during the Earn stop the docked planet is the
            scene's single light source (glow singularity) */}
        <span
          className="absolute w-[5px] h-[5px] rounded-full ja-anim"
          style={{
            top: 7,
            background: soft,
            animation: active ? 'jaMote 2.8s ease-in-out infinite' : 'none',
            // Parked at 48% the idle mote sat exactly on the FXRP node — the
            // static twin (mobile) renders with active=false, so it read as a
            // permanent smudge on the dot. Idle = invisible.
            left: active ? undefined : '48%',
            opacity: active ? undefined : 0,
          }}
        />
        {nodes.map((n) => (
          <div key={n.label} className="absolute -translate-x-1/2 flex flex-col items-center gap-1.5" style={{ left: n.at, top: 6 }}>
            <span className="w-[7px] h-[7px] rounded-full" style={{ border: `1px solid ${accent}`, background: `rgba(${rgb},0.25)` }} />
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/40">{n.label}</span>
          </div>
        ))}
      </div>
      {/* the strategy card's four facts, miniaturized — real product surface */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        {/* "Explicado" (not another "a la vista") and "salud" (never raw "HF"
            — GLOSSARY §4) */}
        {[
          { k: T('Convierte', 'Converts', lang), v: 'XRP → FXRP' },
          { k: T('Trabaja en', 'Works in', lang), v: 'Kinetic · Flare' },
          { k: T('Riesgo', 'Risk', lang), v: T('Explicado', 'Explained', lang) },
          { k: T('Protección', 'Protection', lang), v: T('Tu umbral de salud', 'Your health threshold', lang) },
        ].map((f) => (
          <div key={f.k} className="flex items-baseline justify-between gap-2 min-w-0">
            <span className="text-[9px] font-mono uppercase tracking-wider text-white/35 whitespace-nowrap">{f.k}</span>
            <span className="text-[10px] font-mono text-white/65 truncate">{f.v}</span>
          </div>
        ))}
      </div>
      {/* rates-as-data is Earn's own claim — the signing beat lives elsewhere */}
      <div className="mt-2.5 text-[10px] font-mono text-white/35">
        {T('Cada dato con su fuente', 'Every figure with its source', lang)}
      </div>
    </Frame>
  );
}

// ─── Portfolio — position health bar + allocation donut with orbit ring ──────
export function PortfolioArtifact({ lang, active, accent = GOLD, soft = GOLD_SOFT, rgb = '201,162,39' }: ArtifactProps) {
  // r=22 → circumference ≈ 138.2; three arcs: XRP 55%, FLR 30%, other 15%.
  const C = 2 * Math.PI * 22;
  const arcs = [
    { color: XRP_BLUE, frac: 0.55, off: 0 },
    { color: FLR_PINK, frac: 0.3, off: 0.55 },
    { color: accent, frac: 0.15, off: 0.85 },
  ];
  return (
    <Frame>
      <style>{JA_CSS}</style>
      <div className="flex items-center justify-between gap-5">
        <div className="flex-1 min-w-0">
          <Micro>{T('Salud de posiciones', 'Position health', lang)}</Micro>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="font-mono text-[18px] leading-none text-white">1.86</span>
            <span
              className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ border: `1px solid ${OK_GREEN}66`, color: OK_GREEN }}
            >
              {T('Sana', 'Healthy', lang)}
            </span>
          </div>
          <div className="relative mt-2.5 h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: '68%', background: OK_GREEN, opacity: 0.8 }} />
            <span className="absolute inset-y-0 w-px bg-white/80" style={{ left: '68%' }} />
          </div>
          {/* per-position mini rows — the Positions board, two lines */}
          <div className="mt-2.5 space-y-1.5">
            {/* labels truncate (not nowrap): under ~332px the nowrap pair
                overran the card border — the bar is the flexible piece */}
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: XRP_BLUE }} />
              <span className="text-[10px] font-mono text-white/60 truncate min-w-0">FXRP · Kinetic</span>
              <span className="flex-1 min-w-[16px] h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <span className="block h-full rounded-full" style={{ width: '68%', background: OK_GREEN, opacity: 0.7 }} />
              </span>
              <span className="text-[9px] font-mono text-white/40 shrink-0">{T('Trabajando', 'Working', lang)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: FLR_PINK }} />
              <span className="text-[10px] font-mono text-white/60 truncate min-w-0">WFLR · FTSO</span>
              <span className="flex-1 min-w-[16px] h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <span className="block h-full rounded-full" style={{ width: '100%', background: OK_GREEN, opacity: 0.45 }} />
              </span>
              <span className="text-[9px] font-mono text-white/40 shrink-0">{T('Sin deuda', 'No debt', lang)}</span>
            </div>
          </div>
          {/* the stop's point 2 already owns the liquidation-price fact — the
              caption describes what the donut beside it actually shows */}
          <div className="mt-2 text-[10px] font-mono text-white/35">
            {T('Reparto por red y por activo', 'Split by network and by asset', lang)}
          </div>
        </div>
        {/* allocation donut — entity-locked colors, dotted orbit ring + moonlet */}
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none" className="shrink-0">
          <circle cx="32" cy="32" r="29" stroke={`rgba(${rgb},0.3)`} strokeWidth="1" strokeDasharray="2 4" />
          {arcs.map((a) => (
            <circle
              key={a.color}
              cx="32"
              cy="32"
              r="22"
              stroke={a.color}
              strokeOpacity="0.85"
              strokeWidth="5"
              strokeDasharray={`${a.frac * C} ${C}`}
              strokeDashoffset={-a.off * C}
              transform="rotate(-90 32 32)"
            />
          ))}
          <g className="ja-anim" style={{ transformOrigin: '32px 32px', animation: active ? 'jaOrbit 20s linear infinite' : 'none' }}>
            <circle cx="32" cy="3" r="2" fill={soft} fillOpacity="0.8" />
          </g>
        </svg>
      </div>
    </Frame>
  );
}

// ─── Wallets — two wallet cards: authorized-to-sign vs read-only ─────────────
export function WalletsArtifact({ lang }: ArtifactProps) {
  const rows = [
    {
      color: XRP_BLUE,
      name: 'Xaman · XRPL',
      addr: 'r3qF…9fKk',
      badge: T('Autorizada para firmar', 'Authorized to sign', lang),
      ok: true,
    },
    {
      color: FLR_PINK,
      name: 'MetaMask · Flare',
      addr: '0x84…a1c2',
      badge: T('Solo lectura', 'Read-only', lang),
      ok: false,
    },
    {
      color: '#8A8FA3',
      name: T('Vigilada · XRPL', 'Watched · XRPL', lang),
      addr: 'r9xT…2Qpa',
      badge: T('Solo mirar', 'Watch-only', lang),
      ok: false,
    },
  ];
  return (
    <Frame>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div
            key={r.name}
            // flex-wrap + a name floor: at 320px the nowrap badge crushed the
            // name to "Xam…" — now the badge wraps to its own line instead
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl px-2.5 py-2"
            style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}
          >
            <span
              className="w-[22px] h-[22px] rounded-full shrink-0 flex items-center justify-center"
              style={{ border: `1px solid ${r.color}66`, background: `${r.color}26` }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
            </span>
            <span className="min-w-[130px] flex-1">
              <span className="block text-[12px] text-white/75 leading-tight truncate">{r.name}</span>
              <span className="block text-[10px] font-mono text-white/30 leading-tight">{r.addr}</span>
            </span>
            <span
              className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap"
              style={
                r.ok
                  ? { border: `1px solid ${OK_GREEN}66`, color: OK_GREEN }
                  : { border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.45)' }
              }
            >
              {r.badge}
            </span>
          </div>
        ))}
      </div>
      {/* the stop's headline owns the keys claim — the caption names what the
          three wallet rows above actually show */}
      <div className="mt-3 text-[10px] font-mono text-white/35">
        {T('Cada wallet, con su permiso exacto', 'Each wallet, its exact permission', lang)}
      </div>
    </Frame>
  );
}

// ─── Legacy — the council: signers, quorum, constitution ─────────────────────
// Mirrors the dashboard's Legacy vocabulary: a council of signers with a
// quorum (e.g. 2 of 3), a constitution, programmed transfers. You propose;
// the council signs.
export function LegacyArtifact({ lang, active, accent = GOLD, soft = GOLD_SOFT, rgb = '201,162,39' }: ArtifactProps) {
  const members = [{ ok: true }, { ok: true }, { ok: false }];
  return (
    <Frame>
      <style>{JA_CSS}</style>
      <div className="flex items-center justify-between gap-3">
        <Micro>{T('El consejo', 'The council', lang)}</Micro>
        <span
          className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full whitespace-nowrap"
          style={{ border: `1px solid rgba(${rgb},0.4)`, color: soft }}
        >
          2 / 3 · {T('quórum', 'quorum', lang)}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2.5">
        {members.map((m, i) => (
          <span
            key={i}
            className={`w-[26px] h-[26px] rounded-full shrink-0 flex items-center justify-center ${!m.ok ? 'ja-anim' : ''}`}
            style={{
              border: `1px solid ${m.ok ? accent : 'rgba(255,255,255,0.18)'}`,
              background: m.ok ? `rgba(${rgb},0.15)` : 'rgba(255,255,255,0.03)',
              animation: !m.ok && active ? 'jaPulse 2.4s ease-in-out infinite' : 'none',
            }}
          >
            {m.ok ? (
              <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
                <path d="M3 6.7l2 2L10 4.4" stroke={soft} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.3)' }} />
            )}
          </span>
        ))}
        <span className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <span className="text-[10px] font-mono text-white/45 whitespace-nowrap">
          {T('1 firma pendiente', '1 signature pending', lang)}
        </span>
      </div>
      {/* the governance facts — weights, quorum, and the closed master key
          (real Legacy concepts: multisig weights + master key disabled means
          quorum-only governance) */}
      {/* single column below sm: "Master key" + "Deshabilitada" need ~126px
          and a 320px phone gives each of the two columns ~114px */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-white/35">{T('Pesos', 'Weights', lang)}</span>
          <span className="text-[10px] font-mono text-white/65">1 · 1 · 1</span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-white/35">{T('Clave maestra', 'Master key', lang)}</span>
          <span className="text-[10px] font-mono" style={{ color: OK_GREEN }}>
            {T('Deshabilitada', 'Disabled', lang)}
          </span>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {[T('Constitución', 'Constitution', lang), T('Transferencias programadas', 'Programmed transfers', lang)].map((c) => (
          <span
            key={c}
            className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.5)' }}
          >
            {c}
          </span>
        ))}
      </div>
      <div className="mt-3 text-[10px] font-mono text-white/35">
        {T('Tú propones · El consejo firma', 'You propose · The council signs', lang)}
      </div>
    </Frame>
  );
}

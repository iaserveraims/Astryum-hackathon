'use client';

/**
 * Chapter artifacts — one precise, instrument-grade visualization per concept in the
 * landing "recorrido". The register is a calm financial cockpit: dense but ordered,
 * mono numerals, a single volt accent on the key datum, no casino glow or blinking.
 * Entrance motion is staggered and fires on scroll-into-view; ambient motion is rare,
 * slow and purposeful. All motion has a prefers-reduced-motion fallback (static end-state).
 *
 * Own module so the landing mega-file stays readable. VOLT/EASE duplicated locally
 * (one constant each) to avoid a circular import with LandingPage.
 */

import { motion, useReducedMotion } from 'framer-motion';

const VOLT = '#C9A227';
const EASE = [0.16, 1, 0.3, 1] as const;
const INK = 'rgba(255,255,255,0.92)';
const DIM = 'rgba(255,255,255,0.5)';
const FAINT = 'rgba(255,255,255,0.28)';

export type ArtifactKind =
  | 'flow' | 'map' | 'risk' | 'goals' | 'exec' | 'guard' | 'resist' | 'markets' | 'delegate' | 'audit';

/** Map a slide id (e.g. "p-risk", "m-delegate", "g-intro1") to its artifact. */
export function artifactFor(id: string): ArtifactKind {
  const k = (id.split('-')[1] ?? '').toLowerCase();
  if (k.startsWith('map')) return 'map';
  if (k.startsWith('risk')) return 'risk';
  if (k.startsWith('goals')) return 'goals';
  if (k.startsWith('exec')) return 'exec';
  if (k.startsWith('guard')) return 'guard';
  if (k.startsWith('resist')) return 'resist';
  if (k.startsWith('active') || k.startsWith('markets')) return 'markets';
  if (k.startsWith('delegate')) return 'delegate';
  if (k.startsWith('audit')) return 'audit';
  return 'flow';
}

const VB = '0 0 340 220';
const inView = { once: true, margin: '-10% 0px -10% 0px' } as const;
// Same viewport margin as `inView`, but replayable (no `once`) — used to gate
// the handful of `repeat: Infinity` loops so they pause once scrolled away
// instead of animating forever off-screen.
const loopView = { margin: '-10% 0px -10% 0px' } as const;
const mono = { fontFamily: 'var(--font-jetbrains-mono, ui-monospace, monospace)' } as const;

type R = boolean; // reduced motion

// motion presets ------------------------------------------------------------
const rise = (r: R, delay = 0) => (r ? {} : {
  initial: { opacity: 0, y: 8 }, whileInView: { opacity: 1, y: 0 }, viewport: inView,
  transition: { duration: 0.55, ease: EASE, delay },
});
const fade = (r: R, delay = 0) => (r ? {} : {
  initial: { opacity: 0 }, whileInView: { opacity: 1 }, viewport: inView,
  transition: { duration: 0.5, ease: EASE, delay },
});
const drawP = (r: R, delay = 0, dur = 1) => (r ? {} : {
  initial: { pathLength: 0, opacity: 0 }, whileInView: { pathLength: 1, opacity: 1 }, viewport: inView,
  transition: { duration: dur, ease: EASE, delay },
});
const growW = (r: R, w: number, delay = 0, dur = 0.9) => (r ? { width: w } : {
  initial: { width: 0 }, whileInView: { width: w }, viewport: inView,
  transition: { duration: dur, ease: EASE, delay },
});

// faint instrument grid behind each viz ------------------------------------
function Grid() {
  const xs = [40, 96, 152, 208, 264, 320];
  const ys = [40, 80, 120, 160];
  return (
    <g stroke="rgba(255,255,255,0.045)" strokeWidth="1">
      {xs.map((x) => <line key={`x${x}`} x1={x} y1="8" x2={x} y2="212" />)}
      {ys.map((y) => <line key={`y${y}`} x1="12" y1={y} x2="328" y2={y} />)}
    </g>
  );
}
// HUD corner ticks
function Corners() {
  const c = 'rgba(255,255,255,0.18)';
  return (
    <g stroke={c} strokeWidth="1.4" fill="none">
      <path d="M12 22 V12 H22" /><path d="M318 12 H328 V22" />
      <path d="M328 198 V208 H318" /><path d="M22 208 H12 V198" />
    </g>
  );
}

function Frame({ label, value, meta, children, r, simple = false, caption }: { label: string; value?: string; meta?: string; children: React.ReactNode; r: R; simple?: boolean; caption?: string }) {
  return (
    <motion.div className="relative w-full max-w-[400px] mx-auto"
      initial={r ? undefined : { opacity: 0, y: 14 }} whileInView={r ? undefined : { opacity: 1, y: 0 }}
      viewport={inView} transition={{ duration: 0.65, ease: EASE }}>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.015)' }}>
        {/* bezel header — instrument designation + live signal */}
        <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase" style={{ color: FAINT }}>
            <span className="h-[5px] w-[5px] rotate-45" style={{ background: VOLT }} />{label}
          </span>
          <span className="flex items-center gap-2.5">
            {value && <span className="font-mono text-[10px]" style={{ color: DIM }}>{value}</span>}
            <span className="relative flex h-[6px] w-[6px]" aria-hidden>
              <motion.span
                className="relative inline-flex h-[6px] w-[6px] rounded-full"
                style={{ background: VOLT }}
                initial={r ? undefined : { opacity: 0.5 }}
                whileInView={r ? undefined : { opacity: [0.5, 1, 0.5] }}
                viewport={loopView}
                transition={r ? undefined : { duration: 2.4, ease: 'easeInOut', repeat: Infinity }}
              />
            </span>
          </span>
        </div>
        {/* instrument window */}
        <div className="relative w-full overflow-hidden" style={{ aspectRatio: '17 / 11' }}>
          <svg viewBox={VB} className="absolute inset-0 w-full h-full" fill="none">
            <Grid /><Corners />{children}
          </svg>
          {/* slow scan sweep — a faint gold pass every few seconds; whileInView
              (not once) so it pauses rather than running while off-screen */}
          {!r && (
            <motion.div
              className="absolute inset-x-0 h-12 pointer-events-none"
              style={{ background: 'linear-gradient(180deg, transparent, rgba(201,162,39,0.055), transparent)' }}
              initial={{ top: '-18%' }}
              whileInView={{ top: ['-18%', '108%'] }}
              viewport={loopView}
              transition={{ duration: 6.5, repeat: Infinity, ease: 'linear', repeatDelay: 3 }}
              aria-hidden
            />
          )}
        </div>
        {/* plain-language caption — reads out the instrument in everyday words; simple mode only */}
        {simple && caption && (
          <motion.div
            key={caption}
            className="flex items-start gap-2 px-3.5 py-2.5"
            style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: 'rgba(201,162,39,0.035)' }}
            initial={r ? undefined : { opacity: 0 }}
            animate={r ? undefined : { opacity: 1 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <span className="mt-[3px] h-[5px] w-[5px] rotate-45 shrink-0" style={{ background: VOLT }} aria-hidden />
            <span className="text-[11px] leading-snug" style={{ color: 'rgba(255,255,255,0.64)' }}>{caption}</span>
          </motion.div>
        )}
        {/* bezel footer — system designation */}
        <div className="flex items-center justify-between px-3.5 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <span className="font-mono text-[9px] tracking-[0.16em] uppercase" style={{ color: 'rgba(255,255,255,0.22)' }}>Astryum OS</span>
          <span className="font-mono text-[9px] tracking-[0.12em] uppercase" style={{ color: 'rgba(255,255,255,0.22)' }}>{meta ?? 'online'}</span>
        </div>
      </div>
    </motion.div>
  );
}

const T = (es: string, en: string, lang: 'es' | 'en') => (lang === 'es' ? es : en);

// ── flow (brand / intro / principle / close) ────────────────────────────────
function Flow({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  // The real flow-bridge mark: two crescent strokes crossing in an X with the volt
  // diamond at the crossing (same geometry as the wordmark symbol, scaled to 340×220).
  const A = 'M60 50 C 141 50, 153 74, 170 110 C 187 146, 199 170, 280 170';
  const B = 'M280 50 C 199 50, 187 74, 170 110 C 153 146, 141 170, 60 170';
  return (
    <>
      <text x="40" y="30" fontSize="9.5" fill={FAINT} style={mono}>TradFi · Web2</text>
      <text x="300" y="30" textAnchor="end" fontSize="9.5" fill={FAINT} style={mono}>DeFi · Web3</text>
      <motion.path d={A} stroke="rgba(255,255,255,0.92)" strokeWidth="14" strokeLinecap="butt" fill="none" {...drawP(r, 0, 0.9)} />
      <motion.path d={B} stroke="rgba(255,255,255,0.92)" strokeWidth="14" strokeLinecap="butt" fill="none" {...drawP(r, 0.06, 0.9)} />
      {/* the two pulses run on whileInView (not once) so they pause when scrolled away */}
      {!r && <>
        <motion.path d={A} stroke={VOLT} strokeWidth="14" strokeLinecap="round" fill="none" pathLength={0.12}
          initial={{ pathOffset: 0 }} whileInView={{ pathOffset: [0, 0.88] }} viewport={loopView}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />
        <motion.path d={B} stroke={VOLT} strokeWidth="14" strokeLinecap="round" fill="none" pathLength={0.12}
          initial={{ pathOffset: 0 }} whileInView={{ pathOffset: [0, 0.88] }} viewport={loopView}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay: 1 }} />
      </>}
      <motion.path d="M170 97 L183 110 L170 123 L157 110 Z" fill={VOLT} stroke="#0a0a0b" strokeWidth="2.4" strokeLinejoin="miter"
        initial={r ? undefined : { scale: 0, opacity: 0 }} whileInView={r ? undefined : { scale: 1, opacity: 1 }}
        viewport={inView} transition={{ duration: 0.5, ease: EASE, delay: 0.55 }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center', filter: 'drop-shadow(0 0 6px rgba(201,162,39,0.4))' }} />
      <text x="170" y="200" textAnchor="middle" fontSize="9" fill={DIM} style={mono}>{T('1 PUENTE', '1 BRIDGE', lang)}</text>
    </>
  );
}

// ── map (Capital Map): scattered assets unify into one source of truth ──────
function Map_({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  // Only assets the demo actually handles: XRP, FXRP, FLR, ETH, USDT0, USDC.
  const nodes: [number, number, number, string][] = [
    [56, 46, 9, 'ETH'], [288, 54, 7, 'XRP'], [44, 120, 8, 'FLR'], [300, 132, 6, 'USDC'],
    [86, 182, 6, 'USDT0'], [256, 188, 7, 'FXRP'],
  ];
  return (
    <>
      {nodes.map(([x, y], i) => (
        <motion.line key={`l${i}`} x1={x} y1={y} x2="170" y2="112" stroke="rgba(201,162,39,0.2)" strokeWidth="1" {...drawP(r, 0.1 + i * 0.07, 0.6)} />
      ))}
      {nodes.map(([x, y, s, lab], i) => (
        <motion.g key={`n${i}`} {...rise(r, 0.12 + i * 0.07)}>
          <circle cx={x} cy={y} r={s} fill="rgba(201,162,39,0.08)" />
          <circle cx={x} cy={y} r="2.4" fill={VOLT} />
          <text x={x} y={y - s - 4} textAnchor="middle" fontSize="7.5" fill={FAINT} style={mono}>{lab}</text>
        </motion.g>
      ))}
      <motion.circle cx="170" cy="112" r="34" fill="#0b0b09" stroke={VOLT} strokeWidth="1.3" strokeOpacity="0.8" {...fade(r, 0.5)} />
      <motion.g {...fade(r, 0.7)}>
        <text x="170" y="106" textAnchor="middle" fontSize="8" fill={FAINT} style={mono}>{T('TOTAL', 'TOTAL', lang)}</text>
        <text x="170" y="120" textAnchor="middle" fontSize="13" fontWeight="700" fill={INK} style={mono}>€48,210</text>
      </motion.g>
    </>
  );
}

// ── risk (Risk Engine): graduated safety gauge with watch threshold ─────────
function Risk({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  const CX = 170, CY = 162, RAD = 92;
  const ticks = Array.from({ length: 11 }, (_, i) => i);
  return (
    <>
      {/* dial track + volt fill to 0.76 (180° gauge, left=0 → right=1) */}
      <path d={`M ${CX - RAD} ${CY} A ${RAD} ${RAD} 0 0 1 ${CX + RAD} ${CY}`} stroke="rgba(255,255,255,0.1)" strokeWidth="8" strokeLinecap="round" fill="none" />
      <motion.path d={`M ${CX - RAD} ${CY} A ${RAD} ${RAD} 0 0 1 237.1 99`} stroke={VOLT} strokeWidth="8" strokeLinecap="round" fill="none" {...drawP(r, 0.2, 1.2)} />
      {/* graduations aligned to the dial */}
      {ticks.map((i) => {
        const a = Math.PI - (i / 10) * Math.PI;
        const inner = i >= 9 ? 76 : 78, outer = 88;
        return (
          <line key={i} x1={CX + Math.cos(a) * inner} y1={CY - Math.sin(a) * inner}
            x2={CX + Math.cos(a) * outer} y2={CY - Math.sin(a) * outer}
            stroke={i >= 9 ? VOLT : FAINT} strokeWidth="1.6" />
        );
      })}
      {/* needle — drawn straight from the pivot to the 0.76 mark (no CSS rotation:
          transform-origin on SVG groups is unreliable across browsers and left the
          needle pointing off-dial) */}
      <motion.line x1={CX} y1={CY} x2="221" y2="114.1" stroke={INK} strokeWidth="2.6" strokeLinecap="round" {...drawP(r, 0.35, 0.9)} />
      <circle cx={CX} cy={CY} r="6" fill="#0b0b09" stroke={VOLT} strokeWidth="1.5" />
      {/* scale ends */}
      <text x={CX - RAD} y={CY + 16} textAnchor="middle" fontSize="8" fill={FAINT} style={mono}>0.0</text>
      <text x={CX + RAD} y={CY + 16} textAnchor="middle" fontSize="8" fill={FAINT} style={mono}>1.0</text>
      {/* readout below the pivot, clear of the needle */}
      <text x={CX} y="200" textAnchor="middle" fontSize="32" fontWeight="800" fill={INK} style={mono}>0.76</text>
      <text x={CX} y="215" textAnchor="middle" fontSize="8.5" fill={DIM} style={mono}>{T('NIVEL DE SEGURIDAD', 'SAFETY LEVEL', lang)}</text>
    </>
  );
}

// ── goals (Goals Engine): trajectory toward a target ────────────────────────
function Goals({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  return (
    <>
      {[46, 31, 17].map((rad, i) => <circle key={i} cx="262" cy="62" r={rad} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1.1" />)}
      <circle cx="262" cy="62" r="4.5" fill={VOLT} />
      <motion.circle cx="262" cy="62" r="46" fill="none" stroke={VOLT} strokeWidth="2.4" strokeLinecap="round" transform="rotate(-90 262 62)"
        {...(r ? { pathLength: 0.64 } : { initial: { pathLength: 0 }, whileInView: { pathLength: 0.64 }, viewport: inView, transition: { duration: 1.3, ease: EASE, delay: 0.2 } })} />
      <motion.path d="M40 188 C 110 188, 150 150, 210 104" stroke="rgba(201,162,39,0.55)" strokeWidth="2" strokeDasharray="3 5" fill="none" {...drawP(r, 0.3, 1.1)} />
      {/* milestones along the path */}
      {[[40, 188], [108, 170], [168, 138]].map(([x, y], i) => (
        <motion.circle key={i} cx={x} cy={y} r="3" fill={i === 0 ? INK : '#0b0b09'} stroke={VOLT} strokeWidth="1.2" {...fade(r, 0.6 + i * 0.12)} />
      ))}
      <text x="40" y="206" fontSize="8.5" fill={FAINT} style={mono}>{T('HOY', 'NOW', lang)}</text>
      <motion.g {...fade(r, 0.9)}>
        <text x="262" y="128" textAnchor="middle" fontSize="13" fontWeight="700" fill={VOLT} style={mono}>64%</text>
        <text x="262" y="142" textAnchor="middle" fontSize="8" fill={DIM} style={mono}>{T('al objetivo', 'to goal', lang)}</text>
      </motion.g>
    </>
  );
}

// ── exec (Flight Plan): the plotted course — simulate, verify, then sign ─────
function Exec({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  // Waypoints sit exactly on the two cubic segments' endpoints.
  const course = 'M40 172 C 90 166, 130 132, 168 104 C 206 76, 250 64, 296 60';
  return (
    <>
      <text x="28" y="30" fontSize="9" fill={FAINT} style={mono}>{T('RUTA SIMULADA', 'SIMULATED ROUTE', lang)}</text>
      <text x="312" y="30" textAnchor="end" fontSize="9" fill={DIM} style={mono}>{T('coste 0.15% · €4.20', 'cost 0.15% · €4.20', lang)}</text>

      {/* the plotted course */}
      <motion.path d={course} stroke="rgba(201,162,39,0.5)" strokeWidth="1.8" strokeDasharray="4 6" fill="none" {...drawP(r, 0.15, 1.2)} />
      {/* a volt pulse flying the route — whileInView so it pauses off-screen */}
      {!r && (
        <motion.path d={course} stroke={VOLT} strokeWidth="2.2" strokeLinecap="round" fill="none" pathLength={0.08}
          initial={{ pathOffset: 0 }} whileInView={{ pathOffset: [0, 0.92] }} viewport={loopView}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 1.4 }} />
      )}

      {/* waypoint 1 — departure: the simulation passed */}
      <motion.g {...rise(r, 0.3)}>
        <circle cx="40" cy="172" r="6.5" fill="rgba(201,162,39,0.1)" />
        <circle cx="40" cy="172" r="6.5" fill="none" stroke={VOLT} strokeWidth="1.2" strokeOpacity="0.6" />
        <path d="M36.5 172 l2.6 2.6 l4.6 -5.4" stroke={VOLT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <text x="28" y="154" fontSize="9" fill={DIM} style={mono}>{T('Simulado', 'Simulated', lang)}</text>
      </motion.g>

      {/* waypoint 2 — en route: the contract is verified */}
      <motion.g {...rise(r, 0.45)}>
        <circle cx="168" cy="104" r="6.5" fill="rgba(201,162,39,0.1)" />
        <circle cx="168" cy="104" r="6.5" fill="none" stroke={VOLT} strokeWidth="1.2" strokeOpacity="0.6" />
        <path d="M164.5 104 l2.6 2.6 l4.6 -5.4" stroke={VOLT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <text x="180" y="120" fontSize="9" fill={DIM} style={mono}>{T('Contrato 0x8041… ✓', 'Contract 0x8041… ✓', lang)}</text>
      </motion.g>

      {/* destination — the signature target */}
      <motion.g {...fade(r, 0.7)}>
        <circle cx="296" cy="60" r="13" fill="none" stroke={VOLT} strokeWidth="1.2" strokeOpacity="0.45" />
        <circle cx="296" cy="60" r="6" fill="none" stroke={VOLT} strokeWidth="1.2" strokeOpacity="0.8" />
        <circle cx="296" cy="60" r="2.4" fill={VOLT} />
      </motion.g>
      <motion.g {...(r ? {} : { initial: { opacity: 0, y: 6 }, whileInView: { opacity: 1, y: 0 }, viewport: inView, transition: { duration: 0.5, ease: EASE, delay: 0.85 } })}>
        <rect x="240" y="84" width="72" height="22" rx="7" fill={VOLT} />
        <text x="276" y="99" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#000" style={mono}>{T('Firmar ↳', 'Sign ↳', lang)}</text>
      </motion.g>

      {/* impact delta — where the safety level lands after the move */}
      <motion.g {...rise(r, 0.6)}>
        <text x="28" y="193" fontSize="9" fill={FAINT} style={mono}>{T('IMPACTO', 'IMPACT', lang)}</text>
        <text x="28" y="211" fontSize="13" fontWeight="700" fill={DIM} style={mono}>0.76</text>
        <path d="M70 206 h26 m0 0 l-5 -4 m5 4 l-5 4" stroke={FAINT} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        <text x="106" y="211" fontSize="13" fontWeight="700" fill={VOLT} style={mono}>0.91</text>
      </motion.g>
    </>
  );
}

// ── guard (PolicyGuard): full cost disclosed + policy checks ────────────────
function Guard({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  const checks = [T('Contrato en allowlist', 'Contract allowlisted', lang), T('Límite de importe', 'Amount within limit', lang), T('Coste divulgado', 'Cost disclosed', lang)];
  return (
    <>
      <text x="28" y="34" fontSize="9" fill={FAINT} style={mono}>{T('COSTE REAL', 'REAL COST', lang)}</text>
      <text x="312" y="34" textAnchor="end" fontSize="10.5" fill={INK} style={mono}>€280.00</text>
      <rect x="28" y="44" width="284" height="18" rx="5" fill="rgba(255,255,255,0.05)" />
      <motion.rect x="28" y="44" height="18" rx="5" fill={VOLT} {...growW(r, 242, 0.2, 1)} />
      <rect x="274" y="44" width="38" height="18" rx="5" fill="rgba(255,255,255,0.3)" />
      <g style={mono} fontSize="9.5">
        <rect x="28" y="76" width="8" height="8" rx="2" fill={VOLT} /><text x="42" y="84" fill={DIM}>{T('Neto · 98.5%', 'Net · 98.5%', lang)}</text>
        <rect x="180" y="76" width="8" height="8" rx="2" fill="rgba(255,255,255,0.3)" /><text x="194" y="84" fill={DIM}>{T('Comisión · 1.5%', 'Fee · 1.5%', lang)}</text>
      </g>
      <line x1="28" y1="100" x2="312" y2="100" stroke="rgba(255,255,255,0.08)" />
      {checks.map((c, i) => (
        <motion.g key={i} {...rise(r, 0.4 + i * 0.13)}>
          <circle cx="34" cy={120 + i * 26} r="6.5" fill="rgba(201,162,39,0.1)" />
          <path d={`M30.5 ${120 + i * 26} l2.6 2.6 l4.6 -5.4`} stroke={VOLT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <text x="48" y={124 + i * 26} fontSize="10" fill={DIM} style={mono}>{c}</text>
          <text x="312" y={124 + i * 26} textAnchor="end" fontSize="9" fill={FAINT} style={mono}>P{i + 1}</text>
        </motion.g>
      ))}
    </>
  );
}

// ── resist (Resistance Layer): who really controls transfer ─────────────────
function Resist({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  const rows = [T('Transferible', 'Transferable', lang), T('Sin bloqueo', 'No freeze', lang), T('Sin custodia', 'No custody', lang)];
  return (
    <>
      <motion.path d="M86 30 L132 48 V108 C132 140 110 162 86 174 C62 162 40 140 40 108 V48 Z"
        fill="rgba(201,162,39,0.04)" stroke={VOLT} strokeWidth="1.5" strokeOpacity="0.75" {...drawP(r, 0, 0.9)} />
      <motion.path d="M70 102 l11 11 l22 -26" stroke={VOLT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" {...drawP(r, 0.6, 0.5)} />
      {rows.map((t, i) => (
        <motion.g key={i} {...rise(r, 0.4 + i * 0.14)}>
          <circle cx="178" cy={62 + i * 36} r="6.5" fill="rgba(201,162,39,0.1)" />
          <path d={`M174.5 ${62 + i * 36} l2.6 2.6 l4.6 -5.4`} stroke={VOLT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <text x="194" y={66 + i * 36} fontSize="11" fill={DIM} style={mono}>{t}</text>
        </motion.g>
      ))}
      <motion.g {...fade(r, 0.9)}>
        <line x1="178" y1="172" x2="312" y2="172" stroke="rgba(255,255,255,0.08)" />
        <text x="178" y="194" fontSize="9" fill={FAINT} style={mono}>{T('CONTROL', 'CONTROL', lang)}</text>
        <text x="312" y="194" textAnchor="end" fontSize="12" fontWeight="700" fill={VOLT} style={mono}>{T('TÚ', 'YOU', lang)}</text>
      </motion.g>
    </>
  );
}

// ── markets (Earn routes): capture the spread — yield as sourced protocol data ──
function Markets({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  const bars: [string, string, number, string][] = [
    [T('Mercado A', 'Market A', lang), '4.6%', 131, 'rgba(201,162,39,0.4)'],
    [T('Mercado B', 'Market B', lang), '7.2%', 206, 'rgba(201,162,39,0.65)'],
    [T('Mercado C', 'Market C', lang), '8.4%', 240, VOLT],
  ];
  return (
    <>
      <text x="28" y="30" fontSize="9" fill={FAINT} style={mono}>{T('EJEMPLO · APY', 'EXAMPLE · APY', lang)}</text>
      {bars.map(([lab, val, w, c], i) => (
        <g key={i}>
          <text x="28" y={62 + i * 46} fontSize="9.5" fill={DIM} style={mono}>{lab}</text>
          <rect x="28" y={68 + i * 46} width="284" height="15" rx="4.5" fill="rgba(255,255,255,0.05)" />
          <motion.rect x="28" y={68 + i * 46} height="15" rx="4.5" fill={c} {...growW(r, w, 0.2 + i * 0.14, 0.95)} />
          <motion.text x={36 + w} y={79 + i * 46} fontSize="10" fontWeight="700" fill={i === 2 ? VOLT : DIM} style={mono} {...fade(r, 0.6 + i * 0.14)}>{val}</motion.text>
        </g>
      ))}
      <motion.g {...fade(r, 1)}>
        <text x="170" y="212" textAnchor="middle" fontSize="9" fill={DIM} style={mono}>{T('siempre dato del protocolo, con fuente', 'always protocol data, with a source', lang)}</text>
      </motion.g>
    </>
  );
}

// ── delegate (Delegation Layer): mandate with enforced limits, your keys ────
function Delegate({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  const rows: [string, string, number][] = [
    [T('Importe máximo', 'Max amount', lang), '€5,000', 0.46],
    [T('Plataformas', 'Platforms', lang), '2 / 8', 0.25],
    [T('Acciones', 'Actions', lang), T('Defensivas', 'Defensive', lang), 0.6],
  ];
  return (
    <>
      <text x="28" y="32" fontSize="9" fill={VOLT} style={mono}>{T('MANDATO', 'MANDATE', lang)}</text>
      <text x="312" y="32" textAnchor="end" fontSize="9" fill={FAINT} style={mono}>{T('forzado on-chain', 'enforced on-chain', lang)}</text>
      {rows.map(([k, v, frac], i) => (
        <motion.g key={i} {...rise(r, 0.18 + i * 0.14)}>
          <text x="28" y={64 + i * 34} fontSize="10" fill={DIM} style={mono}>{k}</text>
          <text x="312" y={64 + i * 34} textAnchor="end" fontSize="10" fill={INK} style={mono}>{v}</text>
          <rect x="28" y={70 + i * 34} width="284" height="3.5" rx="2" fill="rgba(255,255,255,0.07)" />
          <motion.rect x="28" y={70 + i * 34} height="3.5" rx="2" fill={VOLT} {...growW(r, Math.round(284 * frac), 0.3 + i * 0.14, 0.8)} />
        </motion.g>
      ))}
      <motion.g {...fade(r, 0.85)}>
        <line x1="28" y1="176" x2="312" y2="176" stroke="rgba(255,255,255,0.08)" />
        <circle cx="34" cy="196" r="6" fill="none" stroke={VOLT} strokeWidth="1.4" /><path d="M34 193 v6 M31.5 196 h5" stroke={VOLT} strokeWidth="1.2" />
        <text x="48" y="200" fontSize="10" fill={VOLT} style={mono}>{T('Claves: siempre tuyas', 'Keys: always yours', lang)}</text>
      </motion.g>
    </>
  );
}

// ── audit (Flight Log): a chained, immutable log — every entry links to its tx ──
function Audit({ r, lang }: { r: R; lang: 'es' | 'en' }) {
  // Only actions the demo actually executes (no LP in the demo; debt asset is USDT0).
  // Four linked blocks read as a serpentine chain: 1→2 across, 2→3 down, 3→4 across.
  const entries: [number, number, string, string, string][] = [
    [28, 52, '09:42', T('Repagar 200 USDT0', 'Repay 200 USDT0', lang), '0x8a…f1'],
    [184, 52, '11:08', T('Añadir colateral', 'Add collateral', lang), '0xb7…3c'],
    [28, 128, '14:25', T('Retirar FXRP', 'Withdraw FXRP', lang), '0xc3…9d'],
    [184, 128, '16:01', T('Reclamar 12,4 FLR', 'Claim 12.4 FLR', lang), '0xd9…2a'],
  ];
  const links = ['M164 82 h20', 'M252 112 v8 h-156 v8', 'M164 158 h20'];
  return (
    <>
      <text x="28" y="30" fontSize="9" fill={FAINT} style={mono}>{T('HISTORIAL DE ACTIVIDAD', 'ACTIVITY LOG', lang)}</text>
      <text x="312" y="30" textAnchor="end" fontSize="9" fill={FAINT} style={mono}>{T('INMUTABLE', 'IMMUTABLE', lang)}</text>
      {/* chain links between blocks */}
      {links.map((d, i) => (
        <motion.path key={d} d={d} stroke="rgba(201,162,39,0.45)" strokeWidth="1.4" strokeDasharray="3 4" fill="none" {...drawP(r, 0.35 + i * 0.16, 0.5)} />
      ))}
      {entries.map(([x0, y0, ts, act, hash], i) => {
        const latest = i === entries.length - 1;
        return (
          <motion.g key={i} {...rise(r, 0.2 + i * 0.16)}>
            <rect x={x0} y={y0} width="136" height="60" rx="9"
              fill={latest ? 'rgba(201,162,39,0.05)' : 'rgba(255,255,255,0.03)'}
              stroke={latest ? 'rgba(201,162,39,0.55)' : 'rgba(255,255,255,0.1)'} strokeWidth="1.2" />
            <circle cx={x0 + 14} cy={y0 + 17} r="2.2" fill={VOLT} />
            <text x={x0 + 22} y={y0 + 20.5} fontSize="8" fill={FAINT} style={mono}>{ts}</text>
            <text x={x0 + 124} y={y0 + 20.5} textAnchor="end" fontSize="8" fill={latest ? VOLT : FAINT} style={mono}>{hash}</text>
            <text x={x0 + 14} y={y0 + 43} fontSize="10.5" fill={INK} style={mono}>{act}</text>
          </motion.g>
        );
      })}
      <motion.g {...fade(r, 0.9)}>
        <text x="170" y="205" textAnchor="middle" fontSize="9" fill={DIM} style={mono}>
          {T('cada acción, con su transacción on-chain', 'every action, with its on-chain transaction', lang)}
        </text>
      </motion.g>
    </>
  );
}

export function ChapterArtifact({ kind, lang, meta, simple = false, caption }: { kind: ArtifactKind; lang: 'es' | 'en'; meta?: string; simple?: boolean; caption?: string }) {
  const r = !!useReducedMotion();
  const p = { r, lang } as const;
  let label: string;
  let value: string;
  let node: React.ReactNode;
  switch (kind) {
    case 'map': label = 'Capital Map'; value = T('tiempo real', 'real time', lang); node = <Map_ {...p} />; break;
    case 'risk': label = 'Risk Radar'; value = T('en vivo', 'live', lang); node = <Risk {...p} />; break;
    case 'goals': label = 'Goals Engine'; value = T('proyección', 'projection', lang); node = <Goals {...p} />; break;
    case 'exec': label = T('Plan de Vuelo', 'Flight Plan', lang); value = T('listo para firmar', 'ready to sign', lang); node = <Exec {...p} />; break;
    case 'guard': label = T('Reglas de Vuelo', 'Flight Rules', lang); value = T('chequeos de política', 'policy checks', lang); node = <Guard {...p} />; break;
    case 'resist': label = 'Resistance Layer'; value = T('propiedad real', 'real ownership', lang); node = <Resist {...p} />; break;
    case 'markets': label = T('Rutas de Earn', 'Earn Routes', lang); value = T('dato con fuente', 'sourced data', lang); node = <Markets {...p} />; break;
    case 'delegate': label = 'Delegation Layer'; value = T('límites forzados', 'enforced limits', lang); node = <Delegate {...p} />; break;
    case 'audit': label = T('Bitácora', 'Flight Log', lang); value = 'on-chain'; node = <Audit {...p} />; break;
    default: label = 'Flow Bridge'; value = T('coordinación', 'coordination', lang); node = <Flow {...p} />; break;
  }
  return <Frame r={r} meta={meta ?? T('en línea', 'online', lang)} label={label} value={value} simple={simple} caption={caption}>{node}</Frame>;
}

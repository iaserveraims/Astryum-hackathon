'use client';

/**
 * scenes.tsx — Astryum's visual voice beyond the Earn surface. Same doctrine as
 * components/earn/icons.tsx: not icons in boxes but SCENES that live inside their
 * panels, drawn from the landing's world (deep space, accent sun, orbits, stars).
 * Each one is a little world tuned to what its page is FOR:
 *
 *   RadarSweep     — a sweeping radar finding blips: your live on-chain
 *                    positions, watched in real time (Estrategias · footprint).
 *   MonumentScene  — a gilded asteroid enthroned in a very slow ceremonial ring
 *                    under a fixed north star: permanence, the constitution (Legacy).
 *   CapitalField   — asset-planets sized by weight drifting over deep space: the
 *                    Capital Map as a small galaxy (Portfolio).
 *   SignalBeacon   — satellites (your wallets) linked to a central node, a pulse
 *                    travelling the signal lines (Wallets).
 *   ConsoleDials   — concentric calibration arcs with a tuning notch that sweeps:
 *                    control and configuration, the quietest scene (Settings).
 *
 * The Legacy family — each card of the Legacy surface gets its OWN world
 * (no recycled orbits; permanence deserves its own iconography):
 *
 *   CouncilScene     — signer-stars standing guard in an arc over the account-sun;
 *                      hovering draws the quorum arc through the required members.
 *   TimeVaultScene   — a sealed vault on a timeline rail: a pulse travels toward
 *                      the delivery star; a dotted recovery arc curves home.
 *   LedgerScrollScene— the constitution as a ruled document with its seal, and the
 *                      amendment anchors as a chain of stars that draws itself.
 *   MirrorOrbitsScene— two orbits face to face (XRPL accent · Flare rose) with a
 *                      sync beam between them: the two councils, mirrored.
 *   SignatureScene   — a signature stroke that writes itself over the baseline:
 *                      "you always sign" made visible (Settings · the promise).
 *
 * COLOUR: every brand-accent mark is token-driven (product re-tint, founder
 * 2026-07-17). The svg root carries `text-volt`; accent marks use currentColor
 * (+ opacity), soft marks switch the element to `text-volt-soft`, and gradient
 * stops read --volt-hi / --volt / --volt-deep via style (presentation
 * attributes cannot hold var()). Non-brand colours (emerald deliveries, silver
 * signers, Flare rose, XRP blue, white dust) stay literal on purpose.
 *
 * All animation is CSS (globals.css `.escene-*`), constant-speed, disabled under
 * prefers-reduced-motion. Self-drawing paths use pathLength=100 + `.escene-sign`.
 */

const HI = { stopColor: 'hsl(var(--volt-hi))' } as const;
const MID = { stopColor: 'hsl(var(--volt))' } as const;
const SOFT = { stopColor: 'hsl(var(--volt-soft))' } as const;
const DEEP = { stopColor: 'hsl(var(--volt-deep))' } as const;

/* ── Estrategias · the live on-chain footprint ─────────────────────────────── */
export function RadarSweep({ size = 168 }: { size?: number }) {
  const c = 84;
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden className="text-volt">
      <defs>
        <linearGradient id="rs-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" style={MID} stopOpacity="0" />
          <stop offset="100%" style={MID} stopOpacity="0.30" />
        </linearGradient>
        <radialGradient id="rs-blip" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFFDF4" />
          <stop offset="55%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#064E3B" />
        </radialGradient>
      </defs>

      {/* concentric range rings */}
      {[26, 46, 66].map((r) => (
        <circle key={r} cx={c} cy={c} r={r} stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" strokeDasharray="0.1 5" strokeLinecap="round" />
      ))}
      <line x1={c} y1={c - 66} x2={c} y2={c + 66} stroke="currentColor" strokeOpacity="0.10" strokeWidth="1" />
      <line x1={c - 66} y1={c} x2={c + 66} y2={c} stroke="currentColor" strokeOpacity="0.10" strokeWidth="1" />

      {/* the sweep — a soft sector that turns continuously */}
      <g className="escene-radar" style={{ transformOrigin: '84px 84px' }}>
        <path d={`M${c} ${c} L${c} ${c - 66} A66 66 0 0 1 ${c + 47} ${c - 47} Z`} fill="url(#rs-sweep)" />
        <line className="text-volt-soft" x1={c} y1={c} x2={c} y2={c - 66} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round" />
      </g>

      {/* the blips it finds — your positions, twinkling */}
      <g>
        <circle className="eicon-star" cx="112" cy="60" r="3.2" fill="url(#rs-blip)" />
        <circle className="eicon-star eicon-d2" cx="60" cy="104" r="2.6" fill="url(#rs-blip)" />
        <circle className="eicon-star eicon-d3" cx="104" cy="112" r="2.2" fill="url(#rs-blip)" />
        <circle className="eicon-star eicon-d1" cx="66" cy="62" r="1.8" fill="rgba(52,211,153,0.7)" />
      </g>
      <circle className="text-volt-soft" cx={c} cy={c} r="2.4" fill="currentColor" />
    </svg>
  );
}

/* ── Legacy · permanence, the constitution ─────────────────────────────────── */
export function MonumentScene({ size = 168 }: { size?: number }) {
  const c = 84;
  return (
    <svg width={size} height={size} viewBox="0 0 168 168" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="mn-body" cx="0.36" cy="0.28" r="1">
          <stop offset="0%" style={HI} />
          <stop offset="48%" style={MID} />
          <stop offset="100%" style={DEEP} />
        </radialGradient>
        <radialGradient id="mn-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" style={SOFT} stopOpacity="0.22" />
          <stop offset="100%" style={SOFT} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the ceremonial ring — turns imperceptibly slowly */}
      <g className="escene-spin-slower" style={{ transformOrigin: '84px 84px' }}>
        <circle cx={c} cy={c} r="62" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.1" strokeDasharray="0.1 7" strokeLinecap="round" />
        <circle className="text-volt-soft" cx={c} cy={c - 62} r="2" fill="currentColor" fillOpacity="0.8" />
      </g>

      {/* the fixed north star — steady, never moving */}
      <path className="text-volt-soft" d="M84 20l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8 1.8-5Z" fill="currentColor" />

      {/* the monument — a gilded asteroid, enthroned and lit */}
      <circle cx={c} cy={c + 4} r="34" fill="url(#mn-halo)" />
      <path
        d="M84 56c9-1 17 3 22 10 6 8 7 18 3 27-4 8-12 14-21 15-11 2-22-3-28-12-5-8-5-19 0-27 5-9 14-15 24-16z"
        fill="url(#mn-body)"
        style={{ stroke: 'hsl(var(--volt-hi) / 0.35)' }}
        strokeWidth="1"
      />
      {/* the engraved marks — the terms that never change */}
      <circle cx="76" cy="80" r="2" style={{ fill: 'hsl(var(--volt-deep) / 0.7)' }} />
      <circle cx="92" cy="90" r="1.5" style={{ fill: 'hsl(var(--volt-deep) / 0.6)' }} />
      <circle cx="80" cy="98" r="1.2" style={{ fill: 'hsl(var(--volt-deep) / 0.6)' }} />

      {/* resting stars */}
      <circle className="eicon-star eicon-d2 text-volt-soft" cx="34" cy="44" r="1.1" fill="currentColor" fillOpacity="0.55" />
      <circle className="eicon-star eicon-d3 text-volt-soft" cx="136" cy="120" r="1.2" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}

/* ── Portfolio · the Capital Map as a small galaxy ─────────────────────────── */
export function CapitalField({ width = 190, height = 160 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 190 160" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="cf-xrp" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#DCE9FF" />
          <stop offset="55%" stopColor="#5B8DEF" />
          <stop offset="100%" stopColor="#10224a" />
        </radialGradient>
        <radialGradient id="cf-flr" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#FFE1F0" />
          <stop offset="55%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#4a0f2e" />
        </radialGradient>
        <radialGradient id="cf-gold" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={HI} />
          <stop offset="50%" style={MID} />
          <stop offset="100%" style={DEEP} />
        </radialGradient>
      </defs>

      {/* faint orbit arcs threading the field together */}
      <ellipse cx="95" cy="80" rx="78" ry="40" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
      <ellipse cx="95" cy="80" rx="48" ry="66" stroke="rgba(255,255,255,0.05)" strokeWidth="1" transform="rotate(24 95 80)" />

      {/* the planets — asset weights, drifting */}
      <g className="escene-drift">
        <circle cx="52" cy="58" r="15" fill="rgba(91,141,239,0.14)" />
        <circle cx="52" cy="58" r="10" fill="url(#cf-xrp)" />
      </g>
      <g className="escene-drift escene-drift-b">
        <circle cx="132" cy="66" r="12" fill="rgba(236,72,153,0.14)" />
        <circle cx="132" cy="66" r="8" fill="url(#cf-flr)" />
      </g>
      <g className="escene-drift escene-drift-c">
        <circle cx="108" cy="112" r="9" fill="currentColor" fillOpacity="0.14" />
        <circle cx="108" cy="112" r="6" fill="url(#cf-gold)" />
      </g>
      <g className="escene-drift escene-drift-b">
        <circle cx="70" cy="108" r="5.5" fill="#3ECFA3" opacity="0.85" />
      </g>

      {/* dust */}
      <circle className="eicon-star" cx="160" cy="30" r="1.2" fill="rgba(255,255,255,0.5)" />
      <circle className="eicon-star eicon-d2" cx="28" cy="110" r="1" fill="rgba(255,255,255,0.4)" />
      <circle className="eicon-star eicon-d3" cx="150" cy="120" r="1.1" fill="rgba(255,255,255,0.4)" />
    </svg>
  );
}

/* ── Wallets · satellites linked to the control plane ──────────────────────── */
export function SignalBeacon({ width = 190, height = 160 }: { width?: number; height?: number }) {
  const cx = 96;
  const cy = 80;
  const sats: [number, number][] = [
    [30, 40],
    [162, 52],
    [42, 122],
    [156, 118],
  ];
  return (
    <svg width={width} height={height} viewBox="0 0 190 160" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="sb-core" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={HI} />
          <stop offset="45%" style={SOFT} />
          <stop offset="100%" style={DEEP} />
        </radialGradient>
      </defs>

      {/* signal lines — a bright pulse travels each toward the core */}
      {sats.map(([x, y], i) => (
        <g key={i}>
          <line x1={x} y1={y} x2={cx} y2={cy} stroke="currentColor" strokeOpacity="0.16" strokeWidth="1" />
          <line
            x1={x}
            y1={y}
            x2={cx}
            y2={cy}
            stroke="currentColor"
            strokeOpacity="0.85"
            strokeWidth="1.4"
            strokeLinecap="round"
            className={`escene-signal escene-signal-d${i} text-volt-soft`}
          />
        </g>
      ))}

      {/* the satellites — your wallets */}
      {sats.map(([x, y], i) => (
        <g key={`s${i}`} className="text-volt-soft">
          <circle className={`eicon-star eicon-d${(i % 3) + 1}`} cx={x} cy={y} r="6" fill="currentColor" fillOpacity="0.14" />
          <circle cx={x} cy={y} r="3.4" fill="currentColor" />
        </g>
      ))}

      {/* the core — the control plane, softly haloed */}
      <circle className="text-volt-soft" cx={cx} cy={cy} r="16" fill="currentColor" fillOpacity="0.12" />
      <circle cx={cx} cy={cy} r="9" fill="url(#sb-core)" />
    </svg>
  );
}

/* ── Settings · calibration console ────────────────────────────────────────── */
export function ConsoleDials({ size = 160 }: { size?: number }) {
  const c = 80;
  // Tick marks around the outer arc.
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (-120 + (i / 23) * 240) * (Math.PI / 180);
    const r1 = 58;
    const r2 = i % 6 === 0 ? 48 : 53;
    return (
      <line
        key={i}
        x1={c + Math.cos(a) * r1}
        y1={c + Math.sin(a) * r1}
        x2={c + Math.cos(a) * r2}
        y2={c + Math.sin(a) * r2}
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth={i % 6 === 0 ? 1.4 : 0.9}
        strokeLinecap="round"
      />
    );
  });
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="cd-knob" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={HI} />
          <stop offset="50%" style={MID} />
          <stop offset="100%" style={DEEP} />
        </radialGradient>
      </defs>

      {ticks}

      {/* concentric calibration arcs */}
      <circle cx={c} cy={c} r="40" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <circle cx={c} cy={c} r="30" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="0.1 5" strokeLinecap="round" />

      {/* the tuning notch — sweeps back and forth like a dial being set */}
      <g className="escene-tune text-volt-soft" style={{ transformOrigin: '80px 80px' }}>
        <line x1={c} y1={c} x2={c} y2={c - 40} stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx={c} cy={c - 40} r="3.2" fill="currentColor" />
      </g>

      {/* the knob at the centre */}
      <circle cx={c} cy={c} r="12" fill="currentColor" fillOpacity="0.10" />
      <circle cx={c} cy={c} r="7" fill="url(#cd-knob)" />

      {/* a couple of quiet stars */}
      <circle className="eicon-star eicon-d2 text-volt-soft" cx="26" cy="30" r="1" fill="currentColor" fillOpacity="0.5" />
      <circle className="eicon-star eicon-d1 text-volt-soft" cx="134" cy="128" r="1.1" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}

/* ═══ The Legacy family ═════════════════════════════════════════════════════ */

/* ── Legacy · the council: signers standing guard over the account ─────────── */
export function CouncilScene({ width = 200, height = 160 }: { width?: number; height?: number }) {
  // Five signer-stars in an arc over the account-sun; the quorum arc joins the
  // three the ledger requires. Signers are silver — only the account carries
  // the accent.
  const signers: [number, number][] = [
    [30, 62],
    [64, 34],
    [102, 26],
    [140, 36],
    [172, 66],
  ];
  const quorum = 'M30 62 Q46 44 64 34 Q83 26 102 26';
  return (
    <svg width={width} height={height} viewBox="0 0 200 160" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="cn-sun" cx="0.38" cy="0.32" r="1">
          <stop offset="0%" style={HI} />
          <stop offset="45%" style={SOFT} />
          <stop offset="100%" style={DEEP} />
        </radialGradient>
        <radialGradient id="cn-signer" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#C7CBD4" />
          <stop offset="100%" stopColor="#3a3f4a" />
        </radialGradient>
      </defs>

      {/* faint spokes — every signer holds a line to the account */}
      {signers.map(([x, y], i) => (
        <line key={i} x1={x} y1={y} x2="100" y2="112" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
      ))}

      {/* the quorum arc — resting hint + the line that DRAWS on hover */}
      <path className="text-volt-soft" d={quorum} stroke="currentColor" strokeOpacity="0.14" strokeWidth="1.1" strokeLinecap="round" />
      <path className="escene-sign text-volt-soft" d={quorum} pathLength={100} stroke="currentColor" strokeOpacity="0.8" strokeWidth="1.3" strokeLinecap="round" />

      {/* the signers — silver guardians, twinkling out of phase */}
      {signers.map(([x, y], i) => (
        <g key={`s${i}`}>
          <circle className={`eicon-star eicon-d${(i % 3) + 1}`} cx={x} cy={y} r="7" fill="rgba(199,203,212,0.12)" />
          <circle cx={x} cy={y} r="3.4" fill="url(#cn-signer)" />
        </g>
      ))}

      {/* the account — the one accent body, softly haloed */}
      <circle className="text-volt-soft" cx="100" cy="112" r="17" fill="currentColor" fillOpacity="0.13" />
      <circle cx="100" cy="112" r="9.5" fill="url(#cn-sun)" />

      <circle className="eicon-star eicon-d2 text-volt-soft" cx="184" cy="120" r="1.1" fill="currentColor" fillOpacity="0.5" />
      <circle className="eicon-star" cx="16" cy="112" r="1" fill="rgba(255,255,255,0.4)" />
    </svg>
  );
}

/* ── Legacy · the programmed transfer: a vault on a timeline ───────────────── */
export function TimeVaultScene({ width = 200, height = 150 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 200 150" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="tv-vault" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={HI} />
          <stop offset="50%" style={MID} />
          <stop offset="100%" style={DEEP} />
        </radialGradient>
      </defs>

      {/* the recovery arc — if never claimed, the capital curves home (dotted) */}
      <path
        className="text-volt-soft"
        d="M168 104 C150 38, 62 34, 26 92"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth="1"
        strokeDasharray="0.1 6"
        strokeLinecap="round"
      />
      <path className="eicon-star eicon-d2 text-volt-soft" d="M40 66 l-8 2 4 7" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      {/* the timeline rail — a pulse of capital travels toward delivery */}
      <line x1="18" y1="112" x2="182" y2="112" stroke="rgba(255,255,255,0.09)" strokeWidth="1.2" />
      <line className="escene-rail text-volt-soft" x1="18" y1="112" x2="182" y2="112" stroke="currentColor" strokeOpacity="0.8" strokeWidth="1.5" strokeLinecap="round" />
      {/* date ticks */}
      <line x1="112" y1="107" x2="112" y2="117" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" />
      <line x1="168" y1="107" x2="168" y2="117" stroke="rgba(255,255,255,0.14)" strokeWidth="1.2" />

      {/* the vault at origin — sealed: a ring with its bar */}
      <circle className="text-volt-soft" cx="28" cy="112" r="13" fill="currentColor" fillOpacity="0.10" />
      <circle cx="28" cy="112" r="8.5" fill="url(#tv-vault)" />
      <rect x="24" y="110.4" width="8" height="3.2" rx="1.6" fill="rgba(10,10,9,0.75)" />

      {/* the delivery — an emerald star waiting on its date */}
      <path
        className="eicon-star eicon-d1"
        d="M112 84l2.6 6.6 6.6 2.6-6.6 2.6-2.6 6.6-2.6-6.6-6.6-2.6 6.6-2.6 2.6-6.6Z"
        fill="#34D399"
      />
      <circle className="eicon-star eicon-d3" cx="146" cy="60" r="1.2" fill="rgba(110,231,183,0.5)" />
      <circle className="eicon-star text-volt-soft" cx="76" cy="86" r="1" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}

/* ── Legacy · the constitution: a ruled document, its seal, its amendments ─── */
export function LedgerScrollScene({ width = 190, height = 150 }: { width?: number; height?: number }) {
  const chain = 'M148 40 L162 74 L152 106';
  return (
    <svg width={width} height={height} viewBox="0 0 190 150" fill="none" aria-hidden className="text-volt">
      {/* the document — ruled lines behind everything */}
      <rect x="26" y="34" width="98" height="92" rx="7" stroke="rgba(255,255,255,0.14)" strokeWidth="1.1" fill="rgba(255,255,255,0.02)" />
      <line x1="40" y1="56" x2="110" y2="56" stroke="rgba(255,255,255,0.13)" strokeWidth="1" strokeLinecap="round" />
      <line x1="40" y1="70" x2="110" y2="70" stroke="rgba(255,255,255,0.11)" strokeWidth="1" strokeLinecap="round" />
      <line x1="40" y1="84" x2="110" y2="84" stroke="rgba(255,255,255,0.11)" strokeWidth="1" strokeLinecap="round" />
      <line x1="40" y1="98" x2="82" y2="98" stroke="rgba(255,255,255,0.09)" strokeWidth="1" strokeLinecap="round" />

      {/* the seal — the SHA-256 fingerprint pressed into the page */}
      <g className="text-volt-soft">
        <circle cx="104" cy="110" r="9.5" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.1" />
        <circle cx="104" cy="110" r="4" fill="currentColor" fillOpacity="0.28" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
          const r = (a * Math.PI) / 180;
          return (
            <line
              key={a}
              x1={104 + Math.cos(r) * 11}
              y1={110 + Math.sin(r) * 11}
              x2={104 + Math.cos(r) * 13.5}
              y2={110 + Math.sin(r) * 13.5}
              stroke="currentColor"
              strokeOpacity="0.4"
              strokeWidth="1"
              strokeLinecap="round"
            />
          );
        })}
      </g>

      {/* the amendment chain — each anchor a star; hovering draws the lineage */}
      <g className="text-volt-soft">
        <path d={chain} stroke="currentColor" strokeOpacity="0.14" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
        <path className="escene-sign" d={chain} pathLength={100} stroke="currentColor" strokeOpacity="0.75" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path className="eicon-star" d="M148 33l2 5.2 5.2 2-5.2 2-2 5.2-2-5.2-5.2-2 5.2-2 2-5.2Z" fill="currentColor" />
        <circle className="eicon-star eicon-d1" cx="162" cy="74" r="2.6" fill="currentColor" />
        <circle className="eicon-star eicon-d2" cx="152" cy="106" r="2.2" fill="currentColor" fillOpacity="0.8" />
        <circle className="eicon-star eicon-d3" cx="176" cy="46" r="1" fill="currentColor" fillOpacity="0.45" />
      </g>
    </svg>
  );
}

/* ── Legacy · the vault mirror: two councils face to face ──────────────────── */
export function MirrorOrbitsScene({ width = 210, height = 140 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 210 140" fill="none" aria-hidden className="text-volt">
      <defs>
        <radialGradient id="mo-xrpl" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" style={HI} />
          <stop offset="50%" style={MID} />
          <stop offset="100%" style={DEEP} />
        </radialGradient>
        <radialGradient id="mo-flare" cx="0.35" cy="0.3" r="1">
          <stop offset="0%" stopColor="#FFE1F0" />
          <stop offset="55%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#4a0f2e" />
        </radialGradient>
      </defs>

      {/* XRPL — the accent orbit, turning */}
      <g className="escene-spin-a" style={{ transformOrigin: '58px 70px' }}>
        <circle cx="58" cy="70" r="34" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.1" strokeDasharray="0.1 5.5" strokeLinecap="round" />
        <circle className="text-volt-soft" cx="58" cy="36" r="6.5" fill="currentColor" fillOpacity="0.16" />
        <circle cx="58" cy="36" r="3.6" fill="url(#mo-xrpl)" />
      </g>

      {/* Flare — the rose orbit, counter-turning: the mirror */}
      <g className="escene-spin-b" style={{ transformOrigin: '152px 70px' }}>
        <circle cx="152" cy="70" r="34" stroke="rgba(236,72,153,0.28)" strokeWidth="1.1" strokeDasharray="0.1 5.5" strokeLinecap="round" />
        <circle cx="152" cy="104" r="6.5" fill="rgba(236,72,153,0.16)" />
        <circle cx="152" cy="104" r="3.6" fill="url(#mo-flare)" />
      </g>

      {/* the sync beam — one truth crossing between the two */}
      <line x1="94" y1="70" x2="116" y2="70" stroke="rgba(255,255,255,0.10)" strokeWidth="1.2" />
      <line className="escene-rail text-volt-soft" x1="94" y1="70" x2="116" y2="70" stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.5" strokeLinecap="round" />
      <circle className="eicon-star eicon-d1" cx="105" cy="70" r="1.6" style={{ fill: 'hsl(var(--volt-hi))' }} />

      <circle className="eicon-star eicon-d2 text-volt-soft" cx="24" cy="24" r="1" fill="currentColor" fillOpacity="0.5" />
      <circle className="eicon-star eicon-d3" cx="188" cy="30" r="1.1" fill="rgba(236,72,153,0.5)" />
    </svg>
  );
}

/* ── Settings · the promise: you always sign ───────────────────────────────── */
export function SignatureScene({ width = 200, height = 140 }: { width?: number; height?: number }) {
  // A flowing signature stroke over its baseline — written by hand, not by an
  // agent. The resting hint is always there; attention makes it sign again.
  const stroke =
    'M28 92 C40 56 52 56 58 84 C63 104 70 102 78 78 C86 55 92 60 96 78 C100 96 108 98 120 84 C132 70 138 88 152 78';
  return (
    <svg width={width} height={height} viewBox="0 0 200 140" fill="none" aria-hidden className="text-volt">
      {/* the baseline — the dotted line every signature rests on */}
      <line x1="22" y1="104" x2="178" y2="104" stroke="rgba(255,255,255,0.10)" strokeWidth="1" strokeDasharray="1 4" strokeLinecap="round" />

      {/* the signature — resting hint + the stroke that WRITES itself on hover */}
      <path className="text-volt-soft" d={stroke} stroke="currentColor" strokeOpacity="0.16" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path className="escene-sign text-volt-soft" d={stroke} pathLength={100} stroke="currentColor" strokeOpacity="0.85" strokeWidth="1.7" strokeLinecap="round" fill="none" />

      {/* the flourish — the pen lifts into a star */}
      <path className="eicon-star eicon-d1 text-volt-soft" d="M162 66l2.4 6 6 2.4-6 2.4-2.4 6-2.4-6-6-2.4 6-2.4 2.4-6Z" fill="currentColor" />
      {/* ink dots where the pen rested */}
      <circle className="text-volt-soft" cx="58" cy="96" r="1.3" fill="currentColor" fillOpacity="0.55" />
      <circle className="eicon-star eicon-d3 text-volt-soft" cx="140" cy="98" r="1.1" fill="currentColor" fillOpacity="0.45" />
      <circle className="eicon-star eicon-d2" cx="34" cy="40" r="1" fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}

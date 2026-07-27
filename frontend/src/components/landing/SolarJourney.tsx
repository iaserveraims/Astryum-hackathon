'use client';

/**
 * Astryum landing — the Solar Journey.
 *
 * The hero's solar system is the ship: as the visitor scrolls, the artifact
 * leaves its hero slot, grows to fill the viewport and the scroll becomes a
 * guided tour through four planets = the four dashboard sections, landing on a
 * single early-access call. A product switch above the stage retells the same
 * journey for BOTH products: Astryum Personal (gold — Summary · Earn ·
 * Portfolio · Wallets) and Astryum Legacy (indigo — the council-governed
 * account: you propose, the council signs by quorum). The palettes mirror the
 * dashboard's authority theming (--volt gold ⇄ governed indigo).
 *
 * Mechanics: a tall track (760svh) with a sticky 100svh stage, lg-and-up only —
 * below lg the pinned stage cannot fit the stacked hero, so a static stacked
 * variant renders instead (also the prefers-reduced-motion fallback). Native
 * scroll is never hijacked; one scrollYProgress drives a single continuous
 * timeline. The scene is the SAME node that renders in-flow inside the hero
 * grid — at progress 0 the camera transform is identity, so the hero is
 * pixel-identical to the pre-journey landing (no swap, no re-mount, no FLIP
 * flash). The original SolarSystem's CSS-keyframe spin is replaced by a rAF
 * engine writing motion values, so each planet's angle can blend toward a
 * canonical docking angle as the camera arrives at its stop.
 *
 * Focus veil: while a stop is held, a backdrop-blur veil softens the star
 * field and the non-docked scene elements blur+dim — everything defocuses
 * except the docked planet, its name and the copy. The veil dies whenever the
 * camera pulls back (between stops, takeoff, finale).
 *
 * Calm-system notes: cruise speed drops to ~12% during the tour, only the
 * docked planet keeps a glow (glow singularity), and the NEW section pills skip
 * the backdrop blur (blur under a scaled transform is Safari's jank source #1)
 * while the hero's original pills keep their glass look for rest parity.
 *
 * Copy rules honored: no yield numbers, no promises; rates only as protocol
 * data with a source; the public door is early access; the user (or the
 * council, in Legacy) always signs — Astryum never does.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  motion,
  motionValue,
  useAnimationFrame,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from 'framer-motion';
import { BORDER, EASE, GOLD, usePointerParallax } from './interactions';
import { EarnArtifact, LegacyArtifact, PortfolioArtifact, SummaryArtifact, WalletsArtifact } from './JourneyArtifacts';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

const GOLD_SOFT = '#E8C25A';
const LOGO_HERO = '/astryum_logo-nobackground.png'; // same asset the hero sun uses

// ─── Products & palettes ─────────────────────────────────────────────────────
// Legacy's indigo family converts the dashboard's governed tokens
// (globals.css [data-authority='governed']: --volt 234 89% 74% etc.) to hex.
// The asteroid sun stays gold in both — the brand mark never re-tints.
export type JourneyProduct = 'personal' | 'legacy';
type Product = JourneyProduct;

type Palette = {
  accent: string;
  soft: string;
  rgb: string; // accent as 'r,g,b' for rgba() composition
  planetRim: string; // dark rim of the planet gradient
  glowSecondary: string; // outer halo of the planet glow
  planets: [string, string, string, string]; // outer → inner ring
};

const PALETTES: Record<Product, Palette> = {
  personal: {
    accent: GOLD,
    soft: GOLD_SOFT,
    rgb: '201,162,39',
    planetRim: '#4a3608',
    glowSecondary: 'rgba(201,162,39,0.45)',
    planets: ['#B89B3B', '#E8C25A', GOLD, '#F2D27A'],
  },
  legacy: {
    accent: '#828DF8',
    soft: '#A5B1FD',
    rgb: '130,141,248',
    planetRim: '#1E2247',
    glowSecondary: 'rgba(130,141,248,0.45)',
    planets: ['#6B78E8', '#A5B1FD', '#828DF8', '#C7D2FE'],
  },
};

// ─── The system ──────────────────────────────────────────────────────────────
// Outer → inner. Founder 2026-07-25: the outer ring is no longer hidden at
// rest — all FOUR planets live in the resting hero, each with its principle
// pill (the outer one carries "Coordina": multi-wallet coordination, the
// product's thesis, which reads true for the Wallets stop AND the Legacy
// council). Sizes came up ~20% the same day so the bodies read as spheres
// (3D) at rest, not just when the dock camera magnifies them.
const PLANETS = [
  { ring: 124, dur: 44, rev: false, sz: 18, phase: 150, prEs: 'Coordina', prEn: 'Coordinate' },
  { ring: 100, dur: 34, rev: false, sz: 20, phase: 205, prEs: 'Protege', prEn: 'Protect' },
  { ring: 70, dur: 22, rev: true, sz: 15, phase: 95, prEs: 'Genera', prEn: 'Earn' },
  { ring: 44, dur: 14, rev: false, sz: 12, phase: 325, prEs: 'Posee', prEn: 'Own' },
];

// ─── The itinerary ───────────────────────────────────────────────────────────
// Timeline in track progress [0..1]: hero 0–.10, takeoff .10–.22, four stops,
// landing .85–1. Each stop: ~30% approach, ~55% hold, ~15% exit. `dock` is the
// side of the viewport the planet parks on (copy takes the opposite side).
// Both products share the exact same timing — only copy/labels/colors change.
type Stop = {
  id: string;
  label: string;
  num: string;
  planet: number;
  dock: 'left' | 'right';
  start: number;
  end: number;
  esH: string;
  enH: string;
  esB: string;
  enB: string;
  // Three concrete capabilities, shown as check rows — the founder wants the
  // journey to carry MORE clear product information, not less.
  esPoints: string[];
  enPoints: string[];
  Artifact: (props: { lang: Lang; active: boolean; accent?: string; soft?: string; rgb?: string }) => ReactNode;
};

const STOPS_PERSONAL: Stop[] = [
  {
    id: 'summary',
    label: 'Summary',
    num: '01',
    planet: 3,
    dock: 'right',
    start: 0.22,
    end: 0.38,
    esH: 'Todo tu capital, de un vistazo.',
    enH: 'All your capital, at a glance.',
    esB: 'Cuánto tienes, en qué wallets vive y si algo necesita tu atención hoy. Y cuando hay miradas cerca, los saldos se ocultan con un toque.',
    enB: "How much you hold, which wallets it lives in and whether anything needs your attention today. When someone's looking over your shoulder, balances hide with one tap.",
    esPoints: [
      'Patrimonio neto y salud de posiciones, en una sola lectura',
      'Rendimiento por wallet y por horizonte (hoy · semana · mes · año)',
      'Saldos ocultables con un toque, para mirar sin enseñar',
    ],
    enPoints: [
      'Net worth and position health, in one reading',
      'Performance per wallet and per horizon (today · week · month · year)',
      'Balances hide with one tap, for looking without showing',
    ],
    Artifact: SummaryArtifact,
  },
  {
    id: 'earn',
    label: 'Earn',
    num: '02',
    planet: 2,
    dock: 'left',
    start: 0.38,
    end: 0.54,
    esH: 'Pon tus activos a trabajar. Entendiendo qué hacen.',
    enH: 'Put your assets to work. Understanding what they do.',
    esB: 'Estrategias reales en Flare, explicadas en lenguaje claro antes de firmar. Los tipos se muestran siempre como dato del protocolo, con su fuente — nunca como una promesa nuestra.',
    enB: 'Real strategies on Flare, explained in plain language before you sign. Rates always appear as protocol data, with their source — never as a promise from us.',
    esPoints: [
      'Estrategias reales en Flare mainnet, explicadas en claro',
      'Cada coste, conversión y riesgo a la vista antes de firmar',
      'Descríbela con tus palabras: el agente la compila, tú decides',
    ],
    enPoints: [
      'Real strategies on Flare mainnet, explained plainly',
      'Every cost, conversion and risk visible before you sign',
      'Describe it in your words: the agent compiles, you decide',
    ],
    Artifact: EarnArtifact,
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    num: '03',
    planet: 1,
    dock: 'right',
    start: 0.54,
    end: 0.7,
    esH: 'Cada posición, con su salud a la vista.',
    enH: 'Every position, health in plain sight.',
    esB: 'Todas tus redes y wallets en una sola vista viva: qué tienes, dónde está trabajando y a qué distancia queda cada posición de un problema.',
    enB: "All your networks and wallets in one living view: what you hold, where it's working and how far each position sits from trouble.",
    esPoints: [
      'Todas tus redes y wallets en una sola vista viva',
      'Salud y precio de liquidación, posición a posición',
      'Filtra por wallet, red, activo o periodo',
    ],
    enPoints: [
      'Every network and wallet in one living view',
      'Health and liquidation price, position by position',
      'Filter by wallet, network, asset or period',
    ],
    Artifact: PortfolioArtifact,
  },
  {
    id: 'wallets',
    label: 'Wallets',
    num: '04',
    planet: 0,
    dock: 'left',
    start: 0.7,
    end: 0.85,
    esH: 'Tus llaves nunca salen de tu wallet.',
    enH: 'Your keys never leave your wallet.',
    esB: 'Conecta MetaMask o Xaman, o vigila una dirección en solo lectura. Astryum prepara cada operación; la firma es siempre tuya, en tu wallet.',
    enB: 'Connect MetaMask or Xaman, or watch an address in read-only. Astryum prepares every action; the signature is always yours, in your wallet.',
    esPoints: [
      'MetaMask, Xaman o cualquier dirección en solo lectura',
      'Firmar se autoriza wallet a wallet — mirar no exige nada',
      'Apodos, colores y qué wallet cuenta en tus totales',
    ],
    enPoints: [
      'MetaMask, Xaman or any address in watch-only',
      'Signing is authorized wallet by wallet — watching needs nothing',
      'Nicknames, colors and which wallet counts in your totals',
    ],
    Artifact: WalletsArtifact,
  },
];

// Legacy retells the same four instruments for the council-governed account.
// Vocabulary mirrors the dashboard's Legacy panel: council, quorum,
// constitution, programmed transfers; you propose — the council signs.
const STOPS_LEGACY: Stop[] = [
  {
    id: 'summary',
    label: 'Summary',
    num: '01',
    planet: 3,
    dock: 'right',
    start: 0.22,
    end: 0.38,
    esH: 'El patrimonio del Legacy, a la vista de todos.',
    enH: "The Legacy's wealth, in everyone's sight.",
    esB: 'Cuánto hay, dónde vive y qué espera una decisión del consejo. La misma lectura clara, ahora para un capital que se gobierna entre varios.',
    enB: 'How much there is, where it lives and what awaits a council decision. The same clear reading, now for capital governed together.',
    esPoints: [
      'La lectura del consejo: cuánto hay y qué espera decisión',
      'El mismo panel claro, sobre capital gobernado entre varios',
      'Todos los miembros ven lo mismo; nadie mueve nada solo',
    ],
    enPoints: [
      "The council's reading: how much there is and what awaits a decision",
      'The same clear panel, over capital governed together',
      'Every member sees the same; no one moves anything alone',
    ],
    Artifact: SummaryArtifact,
  },
  {
    id: 'earn',
    label: 'Earn',
    num: '02',
    planet: 2,
    dock: 'left',
    start: 0.38,
    end: 0.54,
    esH: 'El capital del Legacy también trabaja. Con reglas.',
    enH: 'Legacy capital works too. Under rules.',
    esB: 'Las mismas estrategias reales en Flare, pero aquí nadie mueve nada solo: Astryum prepara la operación y es el consejo quien la firma por quórum.',
    enB: "The same real strategies on Flare — but here no one moves anything alone: Astryum prepares the action and it's the council that signs it, by quorum.",
    esPoints: [
      'Las mismas estrategias reales de Flare mainnet',
      'Astryum prepara la operación; el consejo la firma por quórum',
      'Condiciones a la vista antes de cada firma',
    ],
    enPoints: [
      'The same real strategies on Flare mainnet',
      'Astryum prepares the action; the council signs it by quorum',
      'Terms in plain sight before every signature',
    ],
    Artifact: EarnArtifact,
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    num: '03',
    planet: 1,
    dock: 'right',
    start: 0.54,
    end: 0.7,
    esH: 'Cada posición del capital común, con su salud a la vista.',
    enH: 'Every position of the shared capital, health in plain sight.',
    esB: 'Todas las posiciones del Legacy en una sola vista viva. Cualquier miembro puede mirarlo todo; nadie puede tocar nada sin el quórum.',
    enB: 'Every Legacy position in one living view. Any member can see everything; no one can touch anything without the quorum.',
    esPoints: [
      'Todas las posiciones del Legacy en una sola vista',
      'Salud y riesgo visibles para todo el consejo',
      'Transparencia total; el poder de firma, repartido',
    ],
    enPoints: [
      'Every Legacy position in a single view',
      'Health and risk visible to the whole council',
      'Full transparency; signing power, shared',
    ],
    Artifact: PortfolioArtifact,
  },
  {
    id: 'legacy',
    label: 'Legacy',
    num: '04',
    planet: 0,
    dock: 'left',
    start: 0.7,
    end: 0.85,
    esH: 'Capital que solo se mueve por quórum.',
    enH: 'Capital that only moves by quorum.',
    esB: 'Constituye un Legacy en XRPL: un consejo de firmantes, una constitución y transferencias programadas. Tú propones; el consejo firma; Astryum nunca firma ni custodia.',
    enB: 'Constitute a Legacy on XRPL: a council of signers, a constitution and programmed transfers. You propose; the council signs; Astryum never signs, never custodies.',
    esPoints: [
      'Un consejo de firmantes con pesos y quórum (p. ej. 3 de 5)',
      'Constitución y transferencias programadas, ancladas en XRPL',
      'Tú propones; el consejo firma; Astryum nunca',
    ],
    enPoints: [
      'A council of signers with weights and a quorum (e.g. 3 of 5)',
      'Constitution and programmed transfers, anchored on XRPL',
      'You propose; the council signs; Astryum never does',
    ],
    Artifact: LegacyArtifact,
  },
];

const STOPS_BY_PRODUCT: Record<Product, Stop[]> = { personal: STOPS_PERSONAL, legacy: STOPS_LEGACY };

// Timing/geometry tables derive from ONE timeline (both products share it).
const TIMELINE = STOPS_PERSONAL;
const STOP_BY_PLANET = PLANETS.map((_, i) => TIMELINE.findIndex((s) => s.planet === i));
const DOCK_ANGLE = { right: 90, left: 270 } as const;
const TILT_HERO = 60; // the hero's orbital-plane tilt (rotateX)
const TILT_STOP = 35; // flatter during the tour so orbits read face-on

// ─── Piecewise timeline helpers (pure, run per frame) ────────────────────────
function piece(p: number, pts: number[], vals: number[]): number {
  if (p <= pts[0]) return vals[0];
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i]) {
      const t = (p - pts[i - 1]) / (pts[i] - pts[i - 1]);
      return vals[i - 1] + (vals[i] - vals[i - 1]) * t;
    }
  }
  return vals[vals.length - 1];
}

// Camera segments get a smoothstep so arrivals ease instead of hitting a corner.
function pieceSmooth(p: number, pts: number[], vals: number[]): number {
  if (p <= pts[0]) return vals[0];
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i]) {
      let t = (p - pts[i - 1]) / (pts[i] - pts[i - 1]);
      t = t * t * (3 - 2 * t);
      return vals[i - 1] + (vals[i] - vals[i - 1]) * t;
    }
  }
  return vals[vals.length - 1];
}

const shortestDelta = (d: number) => ((d % 360) + 540) % 360 - 180;

// Dock blend: 0 in cruise, ramps to 1 as the camera approaches the planet's
// stop, holds through it, releases after. While blended, the free spin is
// attenuated by (1 − blend) so the planet truly parks.
function stopBlend(p: number, s: Stop): number {
  const a0 = s.start - 0.02;
  const a1 = s.start + 0.05;
  const b0 = s.end - 0.01;
  const b1 = s.end + 0.05;
  if (p <= a0 || p >= b1) return 0;
  if (p < a1) {
    const t = (p - a0) / (a1 - a0);
    return t * t * (3 - 2 * t);
  }
  if (p <= b0) return 1;
  return 1 - (p - b0) / (b1 - b0);
}

const TILT_PTS = [0, 0.12, 0.22, 0.86, 0.94];
const TILT_VALS = [TILT_HERO, TILT_HERO, TILT_STOP, TILT_STOP, TILT_HERO];
// The sun dims to a backdrop during the tour (a scaled 54% logo would swallow
// the copy) with one brief brand beat while crossing to Earn, and returns full
// for the landing emblem.
const SUN_PTS = [0.18, 0.26, 0.4, 0.435, 0.47, 0.88, 0.95];
const SUN_VALS = [1, 0.25, 0.25, 0.4, 0.25, 0.25, 1];
const CRUISE_PTS = [0.06, 0.2, 0.86, 0.96];
const CRUISE_VALS = [1, 0.12, 0.12, 1];

// Ring dimming: full until takeoff completes, then only the docked planet's
// ring holds full presence; everything returns for the landing emblem.
const DIM = PLANETS.map((_, i) => {
  const pts = [0.24];
  const vals = [1];
  TIMELINE.forEach((s) => {
    const own = s.planet === i;
    pts.push(s.start + 0.04, s.end - 0.01);
    vals.push(own ? 1 : 0.3, own ? 1 : 0.3);
  });
  pts.push(0.92);
  vals.push(1);
  return { pts, vals };
});

// Glow singularity: every planet glows at rest (the hero as-is), all glow dies
// on takeoff, only the docked planet re-lights during its stop, and the full
// set returns with the landing emblem.
const GLOW = PLANETS.map((_, i) => {
  const s = TIMELINE[STOP_BY_PLANET[i]];
  return {
    pts: [0.12, 0.2, s.start + 0.03, s.start + 0.07, s.end - 0.03, s.end - 0.005, 0.93, 0.97],
    vals: [1, 0, 0, 1, 1, 0, 0, 1],
  };
});

// Focus curve for the reading veil: 1 while a stop is held, 0 whenever the
// camera travels (takeoff, between stops, finale) — softening the backdrop
// only while there is text to read, exactly as asked.
const VEIL = (() => {
  const pts: number[] = [];
  const vals: number[] = [];
  TIMELINE.forEach((s) => {
    pts.push(s.start + 0.02, s.start + 0.06, s.end - 0.04, s.end - 0.005);
    vals.push(0, 1, 1, 0);
  });
  return { pts, vals };
})();

// ─── Camera keyframes (recomputed on resize, read from a ref per frame) ──────
type CameraKeys = { pts: number[]; xs: number[]; ys: number[]; ss: number[] };

function buildCamera(m: { vw: number; vh: number; cx: number; cy: number; W: number; desktop: boolean }): CameraKeys {
  const { vw, vh, cx, cy, W, desktop } = m;
  const minD = Math.min(vw, vh);
  const K = desktop ? 0.95 : 1.05; // focused ring diameter as a share of the short side
  const tiltCos = Math.cos((TILT_STOP * Math.PI) / 180);

  const rest = { x: 0, y: 0, s: 1 };
  const ov = {
    x: vw / 2 - cx,
    y: vh / 2 - cy,
    s: Math.max((0.88 * minD) / (1.24 * W), 1.05),
  };
  const stops = TIMELINE.map((st) => {
    const pl = PLANETS[st.planet];
    const rf = pl.ring / 200; // orbit radius as a fraction of scene width
    const s = (K * minD) / ((pl.ring / 100) * W);
    const a = (DOCK_ANGLE[st.dock] * Math.PI) / 180;
    const fx = Math.sin(a) * rf;
    const fy = -Math.cos(a) * rf * tiltCos;
    const tx = desktop ? (st.dock === 'right' ? 0.64 : 0.36) * vw : 0.5 * vw;
    const ty = desktop ? 0.5 * vh : 0.34 * vh;
    return { x: tx - fx * W * s - cx, y: ty - fy * W * s - cy, s };
  });
  // The landing emblem: big enough to preside over the close (~42% of the
  // short side for the outer ring), settled in the upper half.
  const fin = {
    x: vw / 2 - cx,
    y: (desktop ? 0.3 : 0.28) * vh - cy,
    s: (0.42 * minD) / (1.24 * W),
  };

  const pts = [0, 0.1, 0.21];
  const cams = [rest, rest, ov];
  TIMELINE.forEach((st, i) => {
    pts.push(st.start + 0.05, st.end - 0.01);
    cams.push(stops[i], stops[i]);
  });
  pts.push(0.93, 1);
  cams.push(fin, fin);
  return { pts, xs: cams.map((c) => c.x), ys: cams.map((c) => c.y), ss: cams.map((c) => c.s) };
}

// ─── Scene CSS (shared by journey + static fallback) ─────────────────────────
// Same geometry as the hero's SolarSystem; the spin keyframes are gone (the
// rAF engine owns the angles). The accent lives in the --ja triplet so the
// Legacy palette re-tints rings/insets with one style override.
const SCENE_CSS = `
  .solar-scene-j { --ja: 201,162,39; position: relative; width: clamp(300px, 38vw, 480px); max-width: 100%; aspect-ratio: 1/1; transform-style: preserve-3d; }
  /* Pinned stage only (lg): the sticky frame can't grow like the original hero
     section did, so on short desktop viewports the scene yields height to keep
     the whole first frame inside 100svh. At >=770px tall this resolves to the
     original 480px cap — full-size parity is untouched. */
  @media (min-width: 1024px) { .solar-scene-j { width: clamp(280px, min(38vw, 62svh), 480px); } }
  .solar-stage-j { position: absolute; inset: 0; transform-style: preserve-3d; }
  /* The ring element is a PURE 3D carrier: transform only. Its visible line
     lives in .solar-ringline-j, and dimming/blur live on leaf wrappers —
     opacity<1 or filter on this element would force transform-style:flat
     mid-chain and squash every billboarded planet into an egg (founder
     2026-07-25: "aplastados"). */
  .solar-ring-j { position: absolute; top: 50%; left: 50%; border-radius: 50%; transform-style: preserve-3d; will-change: transform; }
  .solar-ringline-j { position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgba(var(--ja),0.22); box-shadow: 0 0 24px rgba(var(--ja),0.07) inset; }
  .solar-anchor-j { position: absolute; top: 0; left: 50%; transform: translate(-50%,-50%); transform-style: preserve-3d; }
  .solar-counter-j { transform-style: preserve-3d; }
  .solar-flat-j { position: relative; width: 0; height: 0; transform-style: preserve-3d; }
  .solar-moon-j { animation: sj-moon-spin 10s linear infinite; }
  @keyframes sj-moon-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .solar-moon-j { animation: none; } }
`;

// ─── Planet bodies — oversampled spheres with real character ─────────────────
// The old planets were sz-px radial-gradient dots; the dock camera scales the
// scene up to ~4×, and a 13px gradient blown to 50px read as a blurry pea
// ("son muy cutres", founder 2026-07-25). Each body is now PAINTED at 4× and
// parked at scale 1/4, so the camera's zoom lands near native resolution and
// the surface stays crisp through the whole flight — plus a gentle 16% swell
// while docked (written by the rAF engine into `bodyT`). Four characters, one
// per ring (outer → inner): a ringed giant, a banded giant, a cratered rocky
// world, a polished inner world — all composed from the product palette, so
// Legacy re-tints them exactly like the old flat dots did.
const PLANET_OVERSAMPLE = 4;

function planetTexture(index: number): string {
  switch (index) {
    case 1: // banded giant — soft latitudinal bands
      return 'linear-gradient(12deg, rgba(255,255,255,0) 28%, rgba(255,255,255,0.16) 34%, rgba(255,255,255,0) 41%, rgba(0,0,0,0.15) 49%, rgba(255,255,255,0) 56%, rgba(255,255,255,0.12) 63%, rgba(255,255,255,0) 71%, rgba(0,0,0,0.17) 81%, rgba(0,0,0,0) 91%)';
    case 2: // cratered rock — shadowed impact pits with lit rims
      return [
        'radial-gradient(circle at 62% 40%, rgba(0,0,0,0.3) 0 7%, rgba(255,255,255,0.09) 8% 10%, transparent 11%)',
        'radial-gradient(circle at 38% 64%, rgba(0,0,0,0.26) 0 9%, rgba(255,255,255,0.08) 10% 12%, transparent 13%)',
        'radial-gradient(circle at 56% 74%, rgba(0,0,0,0.22) 0 5%, transparent 7%)',
      ].join(',');
    case 3: // polished inner world — a bright equatorial sheen
      return 'linear-gradient(160deg, rgba(255,255,255,0) 44%, rgba(255,255,255,0.2) 55%, rgba(255,255,255,0) 67%)';
    default: // ringed giant — the ring carries its character; the surface stays calm
      return 'linear-gradient(20deg, rgba(0,0,0,0.14) 18%, rgba(0,0,0,0) 46%, rgba(255,255,255,0.1) 62%, rgba(255,255,255,0) 76%)';
  }
}

function PlanetBody({
  index,
  sz,
  color,
  palette,
  bodyT,
}: {
  index: number;
  sz: number;
  color: string;
  palette: Palette;
  /** Journey mode: the rAF engine writes `scale((1+0.16·dock)/4)` here.
   *  Absent (static variants) the body parks at the plain 1/4. */
  bodyT?: MotionValue<string>;
}) {
  const d = sz * PLANET_OVERSAMPLE;
  return (
    <motion.div
      aria-hidden
      className="absolute"
      style={{ width: d, height: d, top: -d / 2, left: -d / 2, transform: bodyT ?? `scale(${1 / PLANET_OVERSAMPLE})` }}
    >
      {/* local dark halo — space itself darkens around the body, so its own
          orbit line fades out before touching it instead of slicing straight
          through the sphere (founder 2026-07-25: "esas líneas no acaban de
          quedar bien"), and the extra contrast is what makes the small
          resting planet read as a 3D body, not a flat dot */}
      <span
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '215%',
          height: '215%',
          transform: 'translate(-50%,-50%)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(4,5,12,0.85) 0%, rgba(4,5,12,0.4) 42%, rgba(4,5,12,0) 68%)',
        }}
      />
      {/* the ring (outer world only) — painted before the sphere so it reads behind it */}
      {index === 0 && (
        <span
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: d * 1.85,
            height: d * 0.66,
            transform: 'translate(-50%,-50%) rotate(-16deg)',
            borderRadius: '50%',
            border: `${Math.max(1.5, d * 0.05)}px solid ${color}`,
            opacity: 0.32,
          }}
        />
      )}
      {/* ONE paint for the whole sphere (perf 2026-07-26 — was three stacked
          spans per planet): specular limb, night-side crescent, character
          texture and base shading composed as background layers, clipped by
          the border-radius itself. Top → bottom order. */}
      <span
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          background: [
            `radial-gradient(circle at 35% 29%, rgba(255,255,255,${index === 3 ? 0.8 : 0.5}) 0%, rgba(255,255,255,0) 10%)`,
            'linear-gradient(215deg, rgba(0,0,0,0) 46%, rgba(3,4,10,0.68) 88%)',
            planetTexture(index),
            `radial-gradient(circle at 35% 30%, #fff 0%, ${color} 46%, ${palette.planetRim} 100%)`,
          ].join(','),
        }}
      />
    </motion.div>
  );
}

// Transit comets (scroll-bound streaks) were REMOVED 2026-07-25, same day they
// shipped: bound to progress they froze mid-sky whenever the reader stopped
// scrolling ("se quedan parados y queda raro" — founder). The ambient falling
// stars live in StarfieldCanvas (time-driven, never freeze) — their cadence
// went up instead.

// Two pill finishes. The hero's principle pills keep the ORIGINAL glass look
// (0.78 + blur) for pixel parity at rest — they die at p≈0.16, before the
// camera scales enough for Safari's blur-under-transform jank to matter. The
// section pills, which live under the scaled camera for the whole tour, trade
// the blur for a denser fill.
const PILL_BASE: React.CSSProperties = {
  position: 'absolute',
  top: 25,
  left: 27,
  transform: 'translateY(-50%)',
  border: '1px solid rgba(255,255,255,0.12)',
};
const PILL_HERO: React.CSSProperties = {
  ...PILL_BASE,
  background: 'rgba(10,10,10,0.78)',
  backdropFilter: 'blur(4px)',
};
const PILL_TOUR: React.CSSProperties = {
  ...PILL_BASE,
  background: 'rgba(10,10,10,0.85)',
};

function LeaderLine({ rgb }: { rgb: string }) {
  return (
    <svg width="30" height="28" viewBox="0 0 30 28" fill="none" style={{ position: 'absolute', top: 3, left: 3, overflow: 'visible' }}>
      <line x1="1" y1="1" x2="24" y2="22" stroke={`rgba(${rgb},0.55)`} strokeWidth="1" />
      <circle cx="1" cy="1" r="1.4" fill={`rgba(${rgb},0.85)`} />
    </svg>
  );
}

// ─── Product switch — Personal (gold) ⇄ Legacy (indigo) ──────────────────────
// Mirrors the dashboard's ProductToggle: each segment paints in ITS product's
// color, fixed, so the active pill never flashes between palettes.
// Each segment paints in ITS product's fixed color (like the dashboard's
// toggle). Generous hit areas — the whole pill is the button.
function ProductSwitch({
  product,
  setProduct,
  lang,
}: {
  product: Product;
  setProduct: (p: Product) => void;
  lang: Lang;
}) {
  const opts: Array<{ key: Product; label: string; bg: string; ink: string }> = [
    { key: 'personal', label: 'Personal', bg: '#C9A227', ink: '#000' },
    { key: 'legacy', label: 'Legacy', bg: PALETTES.legacy.accent, ink: '#0B0D26' },
  ];
  return (
    <div
      role="group"
      aria-label={T('Producto', 'Product', lang)}
      className="inline-flex items-center gap-0.5 p-1 rounded-full"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(10,10,10,0.55)', backdropFilter: 'blur(8px)' }}
    >
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => setProduct(o.key)}
          aria-pressed={product === o.key}
          className="px-4 py-2 rounded-full text-xs font-semibold transition-colors"
          style={product === o.key ? { background: o.bg, color: o.ink } : { color: 'rgba(255,255,255,0.45)' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── The living scene: rAF engine + camera + rings ───────────────────────────
function JourneyScene({
  progress,
  lang,
  stickyRef,
  stops,
  palette,
}: {
  progress: MotionValue<number>;
  lang: Lang;
  stickyRef: React.RefObject<HTMLDivElement | null>;
  stops: Stop[];
  palette: Palette;
}) {
  const es = lang === 'es';
  const { x: px, y: py } = usePointerParallax(50, 16);
  const camRef = useRef<HTMLDivElement>(null);
  const camera = useRef<CameraKeys | null>(null);
  const free = useRef(PLANETS.map((p) => p.phase));
  const floatT = useRef(0);
  // Displayed camera state, exponentially smoothed toward the scroll-derived
  // target — soaks up trackpad inertia spikes so the flight reads calm even
  // when the wheel doesn't.
  const smoothCam = useRef<{ x: number; y: number; s: number; tilt: number } | null>(null);
  const inView = useInView(stickyRef, { margin: '20% 0px 20% 0px' });

  // One motion value per animated surface; the rAF engine writes them all.
  // motionValue() (non-hook) inside useMemo keeps them stable without a hook
  // per ring — the same pattern interactions.tsx uses at module level.
  const mv = useMemo(
    () => ({
      camX: motionValue(0),
      camY: motionValue(0),
      camS: motionValue(1),
      stageT: motionValue(`rotateX(${TILT_HERO}deg)`),
      flatT: motionValue(`rotateX(${-TILT_HERO}deg)`),
      rotX: motionValue(0),
      rotY: motionValue(0),
      floatY: motionValue(0),
      sun: motionValue(1),
      sunF: motionValue('none'),
      sunRX: motionValue(0),
      sunRY: motionValue(0),
      sunSpec: motionValue('radial-gradient(circle at 50% 45%, rgba(255,246,214,0), rgba(255,246,214,0) 60%)'),
      oldLabel: motionValue(1),
      newLabel: motionValue(0),
      // Leader-line life = whichever label generation is alive. Unbound, the
      // lines outlived their pills and stuck out of every planet at the
      // finale ("las flechas que salen de los planetas" — founder 2026-07-25).
      leader: motionValue(1),
      rings: PLANETS.map((p) => ({
        op: motionValue(1),
        ringT: motionValue(`translate(-50%,-50%) rotate(${p.phase}deg)`),
        counterT: motionValue(`rotate(${-p.phase}deg)`),
        glow: motionValue(1),
        blurF: motionValue('none'),
        // Oversampled body: parked at 1/4, swelling ~16% while docked.
        bodyT: motionValue(`scale(${1 / PLANET_OVERSAMPLE})`),
        // The docked planet's moonlet — opacity IS the dock blend; visibility
        // gates its infinite CSS spin so four invisible moons don't keep the
        // compositor busy through the whole page (perf, 2026-07-26).
        moon: motionValue(0),
        moonVis: motionValue<'hidden' | 'visible'>('hidden'),
      })),
    }),
    []
  );

  // Measure the scene's untransformed layout (offset chain ignores CSS
  // transforms) so the camera can express every keyframe as a delta from the
  // hero's rest position — this is what makes progress 0 pixel-identical.
  const measure = useCallback(() => {
    const sticky = stickyRef.current;
    const cam = camRef.current;
    if (!sticky || !cam) return;
    let ox = 0;
    let oy = 0;
    let el: HTMLElement | null = cam;
    while (el && el !== sticky) {
      ox += el.offsetLeft;
      oy += el.offsetTop;
      el = el.offsetParent as HTMLElement | null;
    }
    const W = cam.offsetWidth;
    camera.current = buildCamera({
      vw: sticky.clientWidth,
      vh: sticky.clientHeight,
      cx: ox + W / 2,
      cy: oy + cam.offsetHeight / 2,
      W,
      desktop: sticky.clientWidth >= 1024,
    });
  }, [stickyRef]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (stickyRef.current) ro.observe(stickyRef.current);
    if (camRef.current) ro.observe(camRef.current);
    // The sticky and the scene keep their size when the copy reflows (lang
    // toggle, late webfont) but the scene MOVES — observe the grid row too,
    // and re-measure once fonts settle. `lang` in the deps re-measures on
    // toggle even when no observed box changes size.
    const grid = camRef.current?.closest('[data-journey-grid]');
    if (grid) ro.observe(grid);
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => measure()).catch(() => {});
    }
    return () => ro.disconnect();
  }, [measure, stickyRef, lang]);

  useAnimationFrame((_, delta) => {
    if (!inView) return;
    const dt = Math.min(delta, 64) / 1000;
    const p = progress.get();

    const cam = camera.current;
    const tiltTarget = piece(p, TILT_PTS, TILT_VALS);
    if (cam) {
      const tx = pieceSmooth(p, cam.pts, cam.xs);
      const ty = pieceSmooth(p, cam.pts, cam.ys);
      const ts = pieceSmooth(p, cam.pts, cam.ss);
      if (!smoothCam.current) smoothCam.current = { x: tx, y: ty, s: ts, tilt: tiltTarget };
      const c = smoothCam.current;
      const k = 1 - Math.exp(-dt * 7.5); // ~130ms time constant
      c.x += (tx - c.x) * k;
      c.y += (ty - c.y) * k;
      c.s += (ts - c.s) * k;
      c.tilt += (tiltTarget - c.tilt) * k;
      // SETTLE (perf + sharpness, founder 2026-07-26 "pega tirones… se ven
      // borrosos"): the exponential ease asymptotes but never lands, so the
      // transform kept changing by float dust every frame — the browser never
      // got an idle beat to re-rasterize, planets stayed soft at dock zoom
      // and the main thread paid style writes forever. Snap when within a
      // device-invisible epsilon, and QUANTIZE every written value (0.1px /
      // 0.0005 scale / 0.01deg) so the strings stabilize and framer's set()
      // dedupe turns held frames into zero writes.
      if (Math.abs(tx - c.x) < 0.05) c.x = tx;
      if (Math.abs(ty - c.y) < 0.05) c.y = ty;
      if (Math.abs(ts - c.s) < 0.0003) c.s = ts;
      if (Math.abs(tiltTarget - c.tilt) < 0.01) c.tilt = tiltTarget;
      mv.camX.set(Math.round(c.x * 10) / 10);
      mv.camY.set(Math.round(c.y * 10) / 10);
      mv.camS.set(Math.round(c.s * 2000) / 2000);
      const tiltQ = Math.round(c.tilt * 100) / 100;
      mv.stageT.set(`rotateX(${tiltQ}deg)`);
      mv.flatT.set(`rotateX(${-tiltQ}deg)`);
    }

    // Pointer parallax belongs to the hero; the camera takes over on takeoff.
    const par = piece(p, [0.02, 0.14], [1, 0]);
    const sx = px.get();
    const sy = py.get();
    mv.rotY.set(sx * -32 * par);
    mv.rotX.set(sy * 24 * par);
    // The sun gets its OWN deeper tilt plus a pointer-lit facet sweep (masked
    // to the asteroid's silhouette) — depth separation from the rings is what
    // makes the flat PNG read as a volume.
    mv.sunRX.set(sy * 16 * par);
    mv.sunRY.set(sx * -22 * par);
    mv.sunSpec.set(
      `radial-gradient(circle at ${(50 + sx * 42).toFixed(1)}% ${(44 + sy * 34).toFixed(1)}%, rgba(255,246,214,${(0.34 * par).toFixed(3)}), rgba(255,246,214,0) 60%)`
    );

    // solarFloat, re-expressed: same 7s bob, mixable to zero.
    const fl = piece(p, [0.06, 0.18], [1, 0]);
    if (fl > 0) floatT.current += dt;
    mv.floatY.set(fl * (-5 + 5 * Math.cos((2 * Math.PI * floatT.current) / 7)));

    // Reading focus: while a stop holds, the sun and the non-docked rings
    // defocus (blur + the existing dim) so only the docked planet, its name
    // and the copy stay sharp. Releases whenever the camera travels.
    const focus = piece(p, VEIL.pts, VEIL.vals);
    let activeStop = -1;
    for (let i = 0; i < TIMELINE.length; i++) {
      if (p >= TIMELINE[i].start && p < TIMELINE[i].end) {
        activeStop = i;
        break;
      }
    }

    // While a stop is held the sun dies almost completely: at 0.25 its baked
    // golden comet trails still crossed the docked planet's frame reading as
    // stray rotating lines (founder 2026-07-25: "unas líneas alrededor del
    // planeta… no me gustan nada"). Crossings/hero/finale keep the table values.
    mv.sun.set(piece(p, SUN_PTS, SUN_VALS) * (1 - 0.75 * focus));
    mv.sunF.set(focus > 0.01 ? `blur(${(5 * focus).toFixed(1)}px)` : 'none');
    const oldL = piece(p, [0.1, 0.16], [1, 0]);
    mv.oldLabel.set(oldL);
    // Section labels live for the tour and bow out for the landing emblem —
    // sub-10px scaled text would read as mush on the small resting system.
    const newL = piece(p, [0.16, 0.22, 0.86, 0.92], [0, 1, 1, 0]);
    mv.newLabel.set(newL);
    // The leader line follows whichever pill generation is alive; when both
    // are gone (the emblem) it goes with them.
    mv.leader.set(Math.max(oldL, newL));

    const cruise = piece(p, CRUISE_PTS, CRUISE_VALS);
    for (let i = 0; i < PLANETS.length; i++) {
      const pl = PLANETS[i];
      const st = TIMELINE[STOP_BY_PLANET[i]];
      const blend = stopBlend(p, st);
      const dir = pl.rev ? -1 : 1;
      // One integrated angle: the free spin attenuates as the dock blend takes
      // hold, while the blend term pulls the SAME state toward the docking
      // angle. Position stays continuous by construction — no branch flip at
      // the dock's antipode, and the release resumes from the docked angle
      // instead of rewinding to a stale pre-dock heading.
      free.current[i] +=
        dir * (360 / pl.dur) * dt * (1 - blend) * cruise +
        shortestDelta(DOCK_ANGLE[st.dock] - free.current[i]) * blend * Math.min(1, dt * 6);
      free.current[i] = ((free.current[i] % 360) + 360) % 360;
      // Fully docked: land EXACTLY on the dock angle so the ring's transform
      // stops changing and the docked planet's layer re-rasterizes crisp
      // (same settle logic as the camera above).
      if (blend > 0.999 && Math.abs(shortestDelta(DOCK_ANGLE[st.dock] - free.current[i])) < 0.01) {
        free.current[i] = DOCK_ANGLE[st.dock];
      }
      const a = Math.round(free.current[i] * 100) / 100; // 0.01° ≈ 0.04px at the rim
      const r = mv.rings[i];
      r.ringT.set(`translate(-50%,-50%) rotate(${a}deg)`);
      r.counterT.set(`rotate(${-a}deg)`);
      // All four rings live at rest now (founder 2026-07-25) — the outer
      // ring's old takeoff reveal is gone with its hidden state.
      r.op.set(piece(p, DIM[i].pts, DIM[i].vals));
      r.glow.set(piece(p, GLOW[i].pts, GLOW[i].vals));
      // Docked presence: the body swells gently and its moonlet fades in with
      // the SAME blend that parks the planet — one signal, three readings.
      r.bodyT.set(`scale(${((1 + 0.16 * blend) / PLANET_OVERSAMPLE).toFixed(4)})`);
      r.moon.set(Math.round(blend * 500) / 500);
      r.moonVis.set(blend > 0.02 ? 'visible' : 'hidden');
      const own = activeStop >= 0 && TIMELINE[activeStop].planet === i;
      r.blurF.set(!own && focus > 0.01 ? `blur(${(2.5 * focus).toFixed(2)}px)` : 'none');
    }
  });

  return (
    <motion.div ref={camRef} className="relative will-change-transform" style={{ x: mv.camX, y: mv.camY, scale: mv.camS, zIndex: 20 }}>
      <motion.div style={{ perspective: 1000, rotateX: mv.rotX, rotateY: mv.rotY, transformStyle: 'preserve-3d' }}>
        <motion.div
          className="solar-scene-j"
          style={{ y: mv.floatY, ['--ja' as never]: palette.rgb }}
          aria-hidden
        >
          <style>{SCENE_CSS}</style>
          <motion.div className="solar-stage-j" style={{ transform: mv.stageT }}>
            {PLANETS.map((p, i) => {
              const color = palette.planets[i];
              const section = stops[STOP_BY_PLANET[i]].label;
              return (
                <motion.div
                  key={i}
                  className="solar-ring-j"
                  style={{
                    width: `${p.ring}%`,
                    height: `${p.ring}%`,
                    transform: mv.rings[i].ringT,
                  }}
                >
                  {/* the visible orbit line — dim/blur land HERE (a leaf), never
                      on the 3D carrier above (see .solar-ring-j comment) */}
                  <motion.div
                    className="solar-ringline-j"
                    style={{ opacity: mv.rings[i].op, filter: mv.rings[i].blurF }}
                  />
                  <div className="solar-anchor-j">
                    <motion.div className="solar-counter-j" style={{ transform: mv.rings[i].counterT }}>
                      <motion.div className="solar-flat-j" style={{ transform: mv.flatT }}>
                        {/* content dimmer — same OPACITY as the ring line, applied on the
                            billboarded leaf so flattening can't distort geometry. No blur
                            here (perf 2026-07-26): the 0.3 dim already de-emphasizes the
                            undocked planets, and dropping four animated filter surfaces
                            was one of the stutter fixes — defocus blur lives only on the
                            ring lines + the sun. */}
                        <motion.div style={{ opacity: mv.rings[i].op }}>
                        {/* the docked planet's moonlet — the dashboard DonutCard's
                            dashed-orbit motif returned to the sky it came from;
                            only lives while the planet is parked (opacity = the
                            dock blend), painted before the body so its ring
                            passes behind the sphere */}
                        <motion.div
                          aria-hidden
                          className="absolute"
                          style={{
                            width: p.sz * 2.5,
                            height: p.sz * 2.5,
                            top: (-p.sz * 2.5) / 2,
                            left: (-p.sz * 2.5) / 2,
                            opacity: mv.rings[i].moon,
                            visibility: mv.rings[i].moonVis,
                          }}
                        >
                          <span
                            className="solar-moon-j absolute inset-0 rounded-full"
                            style={{ border: `1px dashed rgba(${palette.rgb},0.4)` }}
                          >
                            <span
                              className="absolute rounded-full"
                              style={{
                                width: 5,
                                height: 5,
                                top: -2.5,
                                left: '50%',
                                marginLeft: -2.5,
                                background: palette.soft,
                                boxShadow: `0 0 8px ${palette.soft}`,
                              }}
                            />
                          </span>
                        </motion.div>
                        {/* the planet — body, glow and moonlet live on separate
                            layers so each animates only its own property */}
                        <PlanetBody index={i} sz={p.sz} color={color} palette={palette} bodyT={mv.rings[i].bodyT} />
                        {/* leader line lives and dies WITH its pill */}
                        <motion.span style={{ opacity: mv.leader }}>
                          <LeaderLine rgb={palette.rgb} />
                        </motion.span>
                        <motion.span
                          className="absolute rounded-full"
                          style={{
                            width: p.sz,
                            height: p.sz,
                            top: -p.sz / 2,
                            left: -p.sz / 2,
                            boxShadow: `0 0 12px ${color}, 0 0 28px ${palette.glowSecondary}`,
                            opacity: mv.rings[i].glow,
                          }}
                        />
                        {/* principle label (the hero's original) crossfades to the section label on takeoff */}
                        {p.prEs && (
                          <motion.div
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap"
                            style={{ ...PILL_HERO, opacity: mv.oldLabel }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                            <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/85">{es ? p.prEs : p.prEn}</span>
                          </motion.div>
                        )}
                        <motion.div
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap"
                          style={{ ...PILL_TOUR, opacity: mv.newLabel }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                          <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/85">{section}</span>
                        </motion.div>
                        </motion.div>
                      </motion.div>
                    </motion.div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
          {/* Astryum — the star this system orbits (glow baked into the asset;
              the brand mark stays gold in both products). 50% (was 54%) and
              carries its own tilt + a masked specular sweep for volume. */}
          <motion.div
            className="absolute"
            style={{ top: '50%', left: '50%', x: '-50%', y: '-50%', zIndex: 2, width: '50%', opacity: mv.sun, filter: mv.sunF }}
          >
            <motion.div
              className="relative"
              style={{ rotateX: mv.sunRX, rotateY: mv.sunRY, transformPerspective: 600, transformStyle: 'preserve-3d' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={LOGO_HERO} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
              {/* pointer-lit facet sweep — clipped to the asteroid itself */}
              <motion.div
                className="absolute inset-0"
                style={{
                  background: mv.sunSpec,
                  WebkitMaskImage: `url(${LOGO_HERO})`,
                  maskImage: `url(${LOGO_HERO})`,
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%',
                  mixBlendMode: 'screen',
                }}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ─── Takeoff kicker — the tour announces itself ──────────────────────────────
function TakeoffKicker({ progress, lang, product, palette }: { progress: MotionValue<number>; lang: Lang; product: Product; palette: Palette }) {
  const opacity = useTransform(progress, [0.115, 0.15, 0.19, 0.225], [0, 1, 1, 0]);
  const y = useTransform(progress, [0.115, 0.15], [18, 0]);
  return (
    <motion.div aria-hidden className="absolute inset-x-0 top-[15svh] z-30 text-center px-6 pointer-events-none" style={{ opacity, y }}>
      <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: palette.soft }}>
        {product === 'legacy'
          ? T('El recorrido · Astryum Legacy', 'The tour · Astryum Legacy', lang)
          : T('El recorrido · Cuatro instrumentos', 'The tour · Four instruments', lang)}
      </div>
      <p className="mt-3 text-white/55 text-sm md:text-base max-w-md mx-auto">
        {product === 'legacy'
          ? T('El mismo puesto de mando, para capital gobernado por un consejo.', 'The same mission control, for council-governed capital.', lang)
          : T('Esto es lo que ves al entrar. Sin promesas: el producto.', 'This is what you see when you step in. No promises: the product.', lang)}
      </p>
    </motion.div>
  );
}

// ─── Stop panel — the copy + mini-widget for one planet ──────────────────────
// memo (perf 2026-07-26): every phase flip re-rendered ALL FOUR panels (each
// carrying a full artifact SVG) right at a stop's entrance — the hitch read
// as "no termina de cargar". Props are referentially stable (stops/palette
// are module constants, progress is one motionValue), so only the panel
// whose `active` actually flipped re-renders now.
const JourneyStopPanel = memo(function JourneyStopPanel({
  stop,
  progress,
  lang,
  active,
  palette,
}: {
  stop: Stop;
  progress: MotionValue<number>;
  lang: Lang;
  active: boolean;
  palette: Palette;
}) {
  const opacity = useTransform(progress, [stop.start + 0.03, stop.start + 0.075, stop.end - 0.05, stop.end - 0.015], [0, 1, 1, 0]);
  const y = useTransform(progress, [stop.start + 0.03, stop.start + 0.075], [26, 0]);
  const side =
    stop.dock === 'right'
      ? 'lg:left-[6vw] lg:right-auto'
      : 'lg:right-[6vw] lg:left-auto';
  // Positioning lives on a static outer div: framer's `y` owns the inner node's
  // inline transform, and would silently kill a class-based -translate-y-1/2.
  // No inert/aria-hidden here — the panel is text-only (the artifact is
  // decorative, pointer-events are off), and gating it would hide the whole
  // product pitch from screen readers that never scrub the track.
  return (
    <div
      className={`absolute inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 pointer-events-none lg:inset-x-auto lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:w-[min(560px,40vw)] ${side}`}
    >
      <motion.div className="rounded-2xl p-4 bg-[rgba(8,8,8,0.55)] lg:p-0 lg:bg-transparent lg:rounded-none" style={{ opacity, y }}>
        <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: palette.soft }}>
          {stop.num} · {stop.label}
        </div>
        <h2 className="mt-3 font-bold text-white text-balance" style={{ fontSize: 'clamp(1.6rem, 2.8vw, 2.6rem)', lineHeight: 1.08, letterSpacing: '-0.025em' }}>
          {T(stop.esH, stop.enH, lang)}
        </h2>
        <p className="mt-3 text-white/60 leading-relaxed text-sm md:text-[15.5px] max-w-lg">{T(stop.esB, stop.enB, lang)}</p>
        <StopPoints stop={stop} lang={lang} accent={palette.accent} />
        <div className="mt-5">
          <stop.Artifact lang={lang} active={active} accent={palette.accent} soft={palette.soft} rgb={palette.rgb} />
        </div>
      </motion.div>
    </div>
  );
});

// The three concrete capabilities of a stop, as check rows — this is where the
// journey carries real product information, not just headlines.
function StopPoints({ stop, lang, accent }: { stop: Stop; lang: Lang; accent: string }) {
  return (
    <ul className="mt-4 space-y-2">
      {(lang === 'es' ? stop.esPoints : stop.enPoints).map((pt) => (
        <li key={pt} className="flex items-start gap-2.5 text-[13px] md:text-sm text-white/70 leading-snug">
          <svg className="mt-[3px] shrink-0" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
            <circle cx="6.5" cy="6.5" r="6" stroke={accent} strokeOpacity="0.5" />
            <path d="M4 6.7l1.8 1.8L9.2 4.9" stroke={accent} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {pt}
        </li>
      ))}
    </ul>
  );
}

// ─── Landing block — the emblem settles over one door ────────────────────────
function FinaleBlock({
  progress,
  lang,
  cta,
  active,
  product,
  palette,
}: {
  progress: MotionValue<number>;
  lang: Lang;
  cta: ReactNode;
  active: boolean;
  product: Product;
  palette: Palette;
}) {
  // Fade-in starts exactly where `active` flips (0.85) so the CTA is never
  // clickable or focusable while still invisible.
  const opacity = useTransform(progress, [0.85, 0.91], [0, 1]);
  const y = useTransform(progress, [0.85, 0.91], [26, 0]);
  return (
    <motion.div
      inert={!active}
      aria-hidden={!active}
      className="absolute inset-x-0 bottom-[8svh] z-30 flex flex-col items-center text-center px-6"
      style={{ opacity, y, pointerEvents: active ? 'auto' : 'none' }}
    >
      {/* The Astryum principle closes the tour (founder 2026-07-25) — the old
          "Tu capital. Tu control. Tu firma." repeated the hero word for word.
          The PrincipleBreak section it came from is unmounted (preserved in
          LandingPage.tsx). */}
      <h2
        className="font-light text-white text-balance max-w-3xl"
        style={{ fontSize: 'clamp(1.5rem, 3.2vw, 2.5rem)', lineHeight: 1.2, letterSpacing: '-0.02em' }}
      >
        {T(
          '“El dinero siempre debe fluir. Cuando el dinero está en movimiento, el dinero trabaja para ti.”',
          '“Money must always flow. When money is in motion, money works for you.”',
          lang
        )}
      </h2>
      <div className="mt-4 text-sm font-mono" style={{ color: palette.soft }}>
        {T('— un principio de Astryum', '— an Astryum principle', lang)}
      </div>
      <div className="mt-8">{cta}</div>
    </motion.div>
  );
}

// ─── Scroll cue — the hero's cue, retargeted at the first stop ───────────────
function JourneyCue({ progress, lang, active, palette }: { progress: MotionValue<number>; lang: Lang; active: boolean; palette: Palette }) {
  const opacity = useTransform(progress, [0, 0.05], [1, 0]);
  // visibility (not just pointer-events) — an opacity-0 button would otherwise
  // still take keyboard focus and get announced by screen readers.
  const visibility = useTransform(opacity, (v) => (v < 0.02 ? 'hidden' : 'visible'));
  return (
    <motion.button
      onClick={() => document.getElementById('stop-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      aria-label={T('Desplázate para descubrir', 'Scroll to explore', lang)}
      className="absolute left-1/2 -translate-x-1/2 bottom-7 z-30 hidden md:flex flex-col items-center gap-2 group"
      style={{ opacity, visibility, pointerEvents: active ? 'auto' : 'none' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: 1.1 }}
    >
      <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/35 group-hover:text-white/60 transition-colors">
        {T('Explora', 'Scroll', lang)}
      </span>
      <motion.span
        className="block w-px"
        style={{ height: 24, background: `linear-gradient(180deg, rgba(${palette.rgb},0.7), transparent)`, transformOrigin: 'top' }}
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: [0, 1, 1, 0], opacity: [0, 0.9, 0.9, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.35, 0.75, 1] }}
      />
    </motion.button>
  );
}

// ─── Static fallback (<lg twin + prefers-reduced-motion) ─────────────────────
// No track, no sticky, no scrub: the hero at its resting pose followed by the
// four stops stacked as plain sections — the repo's "every effect degrades to
// a static end-state" rule.
function StaticScene({ lang, palette }: { lang: Lang; palette: Palette }) {
  const es = lang === 'es';
  return (
    <div className="solar-scene-j" style={{ ['--ja' as never]: palette.rgb }} aria-hidden>
      <style>{SCENE_CSS}</style>
      <div className="solar-stage-j" style={{ transform: `rotateX(${TILT_HERO}deg)` }}>
        {PLANETS.map((p, i) => {
          if (!p.prEs) return null;
          const color = palette.planets[i];
          return (
            <div
              key={i}
              className="solar-ring-j"
              style={{ width: `${p.ring}%`, height: `${p.ring}%`, transform: `translate(-50%,-50%) rotate(${p.phase}deg)` }}
            >
              <div className="solar-ringline-j" />
              <div className="solar-anchor-j">
                <div className="solar-counter-j" style={{ transform: `rotate(${-p.phase}deg)` }}>
                  <div className="solar-flat-j" style={{ transform: `rotateX(${-TILT_HERO}deg)` }}>
                    {/* same oversampled body as the journey; the glow keeps its
                        own sz-sized layer so it stays soft, not scaled */}
                    <PlanetBody index={i} sz={p.sz} color={color} palette={palette} />
                    <span
                      className="absolute rounded-full"
                      style={{
                        width: p.sz,
                        height: p.sz,
                        top: -p.sz / 2,
                        left: -p.sz / 2,
                        boxShadow: `0 0 12px ${color}, 0 0 28px ${palette.glowSecondary}`,
                      }}
                    />
                    <LeaderLine rgb={palette.rgb} />
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap" style={PILL_HERO}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                      <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/85">{es ? p.prEs : p.prEn}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="absolute" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2, width: '50%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_HERO} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
      </div>
    </div>
  );
}

function StaticPlanetBadge({ planet, palette }: { planet: number; palette: Palette }) {
  const p = PLANETS[planet];
  const dock = DOCK_ANGLE[TIMELINE[STOP_BY_PLANET[planet]].dock];
  const a = (dock * Math.PI) / 180;
  const r = 30;
  const color = palette.planets[planet];
  return (
    <div aria-hidden className="relative shrink-0" style={{ width: 76, height: 76 }}>
      <div className="absolute inset-2 rounded-full" style={{ border: `1px dashed rgba(${palette.rgb},0.35)` }} />
      {/* anchor point on the dashed orbit; the oversampled body centers itself */}
      <div className="absolute" style={{ left: 38 + Math.sin(a) * r, top: 38 - Math.cos(a) * r }}>
        <PlanetBody index={planet} sz={p.sz} color={color} palette={palette} />
        <span
          className="absolute rounded-full"
          style={{ width: p.sz, height: p.sz, top: -p.sz / 2, left: -p.sz / 2, boxShadow: `0 0 12px ${color}` }}
        />
      </div>
    </div>
  );
}

// `idPrefix` keeps anchor ids unique when this variant coexists in the DOM with
// the pinned track (the <lg twin uses "m-"); the reduced-motion exclusive
// render keeps the canonical ids.
function StaticJourney({
  lang,
  hero,
  finaleCta,
  idPrefix = '',
  product,
  setProduct,
  palette,
  stops,
}: {
  lang: Lang;
  hero: ReactNode;
  finaleCta: ReactNode;
  idPrefix?: string;
  product: Product;
  setProduct: (p: Product) => void;
  palette: Palette;
  stops: Stop[];
}) {
  return (
    <>
      <section id={`${idPrefix}journey`} className="relative min-h-[94svh] flex items-center px-6 md:px-10 lg:px-16 pt-36 md:pt-32 pb-20 overflow-hidden">
        <div className="absolute top-[140px] left-1/2 -translate-x-1/2 z-30">
          <ProductSwitch product={product} setProduct={setProduct} lang={lang} />
        </div>
        <div className="max-w-6xl mx-auto w-full grid lg:grid-cols-[1.15fr,0.85fr] gap-12 lg:gap-16 items-center relative z-10">
          <div>{hero}</div>
          <div className="flex justify-center">
            <StaticScene lang={lang} palette={palette} />
          </div>
        </div>
      </section>
      <div key={product}>
        {stops.map((s) => (
          <section key={s.id} id={`${idPrefix}stop-${s.id}`} className="relative py-14 md:py-20 px-6 md:px-10 lg:px-16 scroll-mt-24">
            <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-7 items-start">
              <StaticPlanetBadge planet={s.planet} palette={palette} />
              <div>
                <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: palette.soft }}>
                  {s.num} · {s.label}
                </div>
                <h2 className="mt-3 font-bold text-white" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.2rem)', lineHeight: 1.1, letterSpacing: '-0.025em' }}>
                  {T(s.esH, s.enH, lang)}
                </h2>
                <p className="mt-3 text-white/60 leading-relaxed text-[15px] max-w-md">{T(s.esB, s.enB, lang)}</p>
                <StopPoints stop={s} lang={lang} accent={palette.accent} />
                <div className="mt-5">
                  <s.Artifact lang={lang} active={false} accent={palette.accent} soft={palette.soft} rgb={palette.rgb} />
                </div>
              </div>
            </div>
          </section>
        ))}
        <section className="relative py-16 md:py-24 px-6 text-center">
          {/* Same close as the pinned finale: the Astryum principle, not a
              repeat of the hero headline (founder 2026-07-25). */}
          <h2
            className="font-light text-white text-balance max-w-3xl mx-auto"
            style={{ fontSize: 'clamp(1.5rem, 3.2vw, 2.5rem)', lineHeight: 1.2, letterSpacing: '-0.02em' }}
          >
            {T(
              '“El dinero siempre debe fluir. Cuando el dinero está en movimiento, el dinero trabaja para ti.”',
              '“Money must always flow. When money is in motion, money works for you.”',
              lang
            )}
          </h2>
          <div className="mt-4 text-sm font-mono" style={{ color: palette.soft }}>
            {T('— un principio de Astryum', '— an Astryum principle', lang)}
          </div>
          <div className="mt-8 flex justify-center">{finaleCta}</div>
        </section>
      </div>
    </>
  );
}

// ─── The journey ─────────────────────────────────────────────────────────────
type Phase = 'hero' | 'takeoff' | number | 'finale';

export default function SolarJourney({
  lang,
  hero,
  finaleCta,
  product,
  onProductChange,
}: {
  lang: Lang;
  hero: ReactNode;
  finaleCta: ReactNode;
  // Controlled from LandingPage: the product also re-themes the whole page
  // (data-authority='governed' on the landing root), not just the journey.
  product: Product;
  onProductChange: (p: Product) => void;
}) {
  const reduce = useReducedMotion();
  // The reduced-motion branch swaps the whole tree, so it must wait for mount:
  // SSR always emits the animated variant, and switching structure during
  // hydration would make React 19 discard the server DOM for PRM users.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const palette = PALETTES[product];
  const stops = STOPS_BY_PRODUCT[product];
  const trackRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });

  const copyY = useTransform(scrollYProgress, [0, 0.14], [0, -70]);
  const copyOpacity = useTransform(scrollYProgress, [0.02, 0.12], [1, 0]);
  // The reading veil: softens the star field behind the stage while a stop's
  // copy is on screen; lifts whenever the camera pulls back.
  // DIRECT curve, no spring (perf 2026-07-26): the spring's asymptotic settle
  // kept writing micro-deltas onto the single most expensive element on
  // screen — a full-viewport backdrop-filter — long after scrolling stopped.
  // The piecewise ramps (0.04 of track) are already soft.
  const veilOpacity = useTransform(scrollYProgress, VEIL.pts, VEIL.vals);
  // backdrop-filter is NOT gated by opacity: at opacity 0 the browser still
  // re-blurred the whole viewport every frame (the starfield repaints at
  // 60fps beneath) for the entire journey. Carry the filter ONLY while the
  // veil is actually visible.
  const veilFilter = useTransform(veilOpacity, (v) => (v > 0.02 ? 'blur(6px)' : 'none'));
  // While the veil is up, everything behind it sits under 6px of blur + a 35%
  // dim — flag it on <html> so StarfieldCanvas can drop to ~20fps there
  // (invisible to the eye, and the backdrop blur re-samples a fresh canvas
  // frame 3× less often).
  useMotionValueEvent(veilOpacity, 'change', (v) => {
    const root = document.documentElement;
    const on = v > 0.5;
    if ((root.dataset.journeyVeil === '1') !== on) {
      if (on) root.dataset.journeyVeil = '1';
      else delete root.dataset.journeyVeil;
    }
  });
  useEffect(
    () => () => {
      delete document.documentElement.dataset.journeyVeil;
    },
    [],
  );
  // The product switch belongs to the hero frame only — it bows out with the
  // takeoff and comes back when the visitor returns to the top.
  const switchOpacity = useTransform(scrollYProgress, [0.02, 0.07], [1, 0]);
  const switchVisibility = useTransform(switchOpacity, (v) => (v < 0.02 ? 'hidden' : 'visible'));

  // Scroll NATURAL (fundador 2026-07-24): el imán anti-flick que redirigía los
  // lanzamientos violentos de trackpad al siguiente stop (vía Lenis) se retira
  // junto con Lenis mismo — el navegador es el único dueño de la rueda. El
  // suavizado de cámara (smoothCam) ya absorbe los picos de inercia por sí solo.

  const [phase, setPhase] = useState<Phase>('hero');
  const phaseRef = useRef<Phase>('hero');
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    let next: Phase;
    if (p < 0.1) next = 'hero';
    else if (p < 0.22) next = 'takeoff';
    else if (p >= 0.85) next = 'finale';
    else {
      const idx = TIMELINE.findIndex((s) => p >= s.start && p < s.end);
      next = idx >= 0 ? idx : 'takeoff';
    }
    if (next !== phaseRef.current) {
      phaseRef.current = next;
      setPhase(next);
    }
  });

  if (mounted && reduce)
    return (
      <StaticJourney
        lang={lang}
        hero={hero}
        finaleCta={finaleCta}
        product={product}
        setProduct={onProductChange}
        palette={palette}
        stops={stops}
      />
    );

  return (
    <>
      {/* Below lg the pinned 100svh stage cannot fit the stacked hero (copy +
          scene ≈ 1000px+) and overflow-hidden would clip the solar system out
          of reach — the stacked static variant is the honest layout on touch.
          Both variants render (CSS decides), so SSR HTML matches every client;
          the twin's anchors are m- prefixed to keep ids unique, and the header
          nav falls back to them when the canonical anchor is display:none. */}
      <div className="lg:hidden">
        <StaticJourney
          lang={lang}
          hero={hero}
          finaleCta={finaleCta}
          idPrefix="m-"
          product={product}
          setProduct={onProductChange}
          palette={palette}
          stops={stops}
        />
      </div>
      {/* 920svh: enough runway that a trackpad flick covers one beat, not three */}
      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[920svh]">
        {/* invisible per-stop anchors so header nav / the cue can jump the
            track — placed past the panel's fade-in (start+0.075) so a jump
            lands on a fully-settled stop */}
        {stops.map((s) => (
          <div
            key={s.id}
            id={`stop-${s.id}`}
            aria-hidden
            className="absolute left-0 w-px h-px"
            style={{ top: `calc((100% - 100svh) * ${(s.start + 0.08).toFixed(3)})` }}
          />
        ))}

        {/* Switching product remounts the stage: the scene re-enters with its
            fade, angles re-seed, the copy re-reveals — the landing's small
            cousin of the dashboard's AuthorityCrossing. */}
        <div ref={stickyRef} key={product} className="sticky top-0 h-[100svh] overflow-hidden">
          {/* the hero, absorbed as the journey's first frame — min-h matches the
              original section (94svh) so the resting frame centers identically */}
          <div className="min-h-[94svh] flex items-center px-6 md:px-10 lg:px-16 pt-36 md:pt-32 pb-20">
            <div data-journey-grid className="max-w-6xl mx-auto w-full grid lg:grid-cols-[1.15fr,0.85fr] gap-12 lg:gap-16 items-center relative z-10">
              <motion.div
                inert={phase !== 'hero'}
                style={{ y: copyY, opacity: copyOpacity, pointerEvents: phase === 'hero' ? 'auto' : 'none' }}
              >
                {hero}
              </motion.div>
              {/* same entrance as the original hero's solar column */}
              <motion.div
                className="flex justify-center"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1, delay: 0.2, ease: EASE }}
              >
                <JourneyScene progress={scrollYProgress} lang={lang} stickyRef={stickyRef} stops={stops} palette={palette} />
              </motion.div>
            </div>
          </div>

          {/* the reading veil — softens ONLY the star field behind everything.
              It must sit BELOW the grid (z-10): the scene's z-20 lives inside
              the grid's stacking context, so anything above z-10 here would
              blur the whole scene, docked planet included. The scene's own
              defocus is per-element (sunF + per-ring blurF). */}
          <motion.div
            aria-hidden
            className="absolute inset-0 z-[5] pointer-events-none"
            style={{
              opacity: veilOpacity,
              background: 'rgba(8,8,8,0.35)',
              backdropFilter: veilFilter,
              WebkitBackdropFilter: veilFilter,
            }}
          />

          <TakeoffKicker progress={scrollYProgress} lang={lang} product={product} palette={palette} />
          {stops.map((s, i) => (
            <JourneyStopPanel key={s.id} stop={s} progress={scrollYProgress} lang={lang} active={phase === i} palette={palette} />
          ))}
          <FinaleBlock progress={scrollYProgress} lang={lang} cta={finaleCta} active={phase === 'finale'} product={product} palette={palette} />
          <JourneyCue progress={scrollYProgress} lang={lang} active={phase === 'hero'} palette={palette} />

          {/* hero-frame only (founder 2026-07-22): fades on takeoff, returns at
              the top. Sits at 104px — clear of the fixed header's hit area,
              which was swallowing clicks on the pill's upper half. */}
          <motion.div
            className="absolute top-[140px] left-1/2 -translate-x-1/2 z-40"
            style={{ opacity: switchOpacity, visibility: switchVisibility, pointerEvents: phase === 'hero' ? 'auto' : 'none' }}
          >
            <ProductSwitch product={product} setProduct={onProductChange} lang={lang} />
          </motion.div>
        </div>
      </section>
    </>
  );
}

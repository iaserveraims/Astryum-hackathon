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
import { motion, motionValue, useAnimationFrame, useInView, useMotionValueEvent, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { BORDER, EASE, GOLD, Reveal, usePointerParallax } from './interactions';
import { CoreArtifact, EarnArtifact, LegacyArtifact, OperateArtifact, PortfolioArtifact, SummaryArtifact, WalletsArtifact } from './JourneyArtifacts';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

const GOLD_SOFT = '#E8C25A';
const LOGO_HERO = '/astryum_logo-nobackground.png'; // same asset the hero sun uses

// ─── Products & palettes ─────────────────────────────────────────────────────
// Legacy's indigo family converts the dashboard's governed tokens
// (globals.css [data-authority='governed']: --volt 234 89% 74% etc.) to hex.
// Each product's sun is its OWN asteroid; the two hero PNGs share the exact
// same geometry (1536×1024 canvas, asteroid 445px wide centred at 746,446) so
// the sun renders at the SAME size in both products — astryum-hero-azul.png
// is composed from asteroide_corregido_transparente to match the gold hero
// (founder 2026-08-08: "rebaja el tamaño del asteroide en el sistema solar").
// `self` (2026-09-20) es el mismo viaje en voz de aplicación —«lo que has
// visto, aplicado a ti»— para la página /self-custody: misma paleta, mismos
// tiempos, otro copy en dos paradas.
export type JourneyProduct = 'personal' | 'legacy' | 'self';
type Product = JourneyProduct;

type Palette = {
  accent: string;
  soft: string;
  rgb: string; // accent as 'r,g,b' for rgba() composition
  planetRim: string; // dark rim of the planet gradient
  glowSecondary: string; // outer halo of the planet glow
  planets: string[]; // one per ring, in PLANETS order
  /** The star this system orbits — each product brings its OWN asteroid
   *  (founder 2026-08-08, superseding "the mark stays gold in both"). */
  hero: string;
};

const PALETTES: Record<Product, Palette> = {
  personal: {
    accent: GOLD,
    soft: GOLD_SOFT,
    rgb: '201,162,39',
    planetRim: '#4a3608',
    glowSecondary: 'rgba(201,162,39,0.45)',
    planets: ['#B89B3B', '#E8C25A', GOLD, '#F2D27A', '#D9B65C'],
    hero: LOGO_HERO,
  },
  legacy: {
    accent: '#828DF8',
    soft: '#A5B1FD',
    rgb: '130,141,248',
    planetRim: '#1E2247',
    glowSecondary: 'rgba(130,141,248,0.45)',
    planets: ['#6B78E8', '#A5B1FD', '#828DF8', '#C7D2FE', '#9AA6FA'],
    hero: '/astryum-hero-azul.png',
  },
  // La misma paleta que Personal: el viaje aplicado a ti no cambia de color.
  self: {
    accent: GOLD,
    soft: GOLD_SOFT,
    rgb: '201,162,39',
    planetRim: '#4a3608',
    glowSecondary: 'rgba(201,162,39,0.45)',
    planets: ['#B89B3B', '#E8C25A', GOLD, '#F2D27A', '#D9B65C'],
    hero: LOGO_HERO,
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
  // LA QUINTA ÓRBITA (fundador 2026-09-20): «añadir una órbita y planeta más
  // explicando la facilidad de ejecución gracias a la abstracción». Vive
  // FUERA del héroe —sin pastilla de principio y oculta en reposo (ver DIM)—
  // para que el primer fotograma siga siendo el de siempre, píxel a píxel; se
  // enciende en el despegue, como hacía la órbita exterior en julio.
  { ring: 148, dur: 56, rev: true, sz: 16, phase: 40, prEs: '', prEn: '' },
];
/** Las órbitas que no existen en reposo: se revelan en el despegue. */
const HIDDEN_AT_REST = PLANETS.map((p) => !p.prEs);

// ─── The itinerary ───────────────────────────────────────────────────────────
// Timeline in track progress [0..1]: hero 0–.10, takeoff .10–.20, SIX stops
// (the core, the four instruments, Operar), landing .89–1. Each stop: ~30%
// approach, ~55% hold, ~15% exit. `dock` is the side of the viewport the
// planet parks on (copy takes the opposite side). Every product shares the
// exact same timing — only copy/labels/colors change.
type Stop = {
  id: string;
  /** El rótulo de la parada. `Home`, `Earn`… son nombres de sección del
   *  producto y no se traducen; «Núcleo» y «Operar» sí (`labelEn`). */
  label: string;
  labelEn?: string;
  num: string;
  /** Index into PLANETS — or −1 for THE CORE: the star itself docks. */
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

// EL NÚCLEO — la parada nueva del 2026-09-20. El astro es tu cuenta, y dentro
// están las cuentas que abres: la cámara entra en el asteroide y sus capas son
// las cuentas (ver CoreOverlay). Voz de Personal; `self` la reescribe.
const CORE_STOP: Stop = {
  id: 'core',
  label: 'Núcleo',
  labelEn: 'Core',
  num: '01',
  planet: -1,
  // A LA DERECHA (2026-09-20, segunda vuelta). El símbolo lleva sus estelas
  // arriba a la izquierda; con el núcleo aparcado a la izquierda los brotes
  // tenían que abrirse justo por ahí y se enredaban con ellas. A la derecha el
  // abanico sale por el hemisferio limpio del símbolo, y además el astro ya
  // viene de ese lado desde el hero: la cámara casi no viaja.
  dock: 'right',
  start: 0.2,
  end: 0.33,
  // Fundador 2026-09-20: «your account holds every type of account that you
  // need, different use cases same signer». La wallet y la cuenta principal
  // son el núcleo; el resto son cuentas que nacen de él.
  esH: 'Tu cuenta contiene todas las cuentas que necesites.',
  enH: 'Your account holds every account you need.',
  esB: 'Distintos usos, la misma firma: la tuya. Tu wallet y tu cuenta principal son el núcleo; el matrimonio, los hijos, la fundación, la empresa o el legado nacen de él, cada uno con su regla escrita en el ledger.',
  enB: 'Different uses, same signer: you. Your wallet and your main account are the core; the marriage, the children, the foundation, the business or the legacy are born from it, each with its rule written on the ledger.',
  esPoints: [
    'Una firma, la tuya, en todas',
    'Compartes por quórum: pareja, socios, familia',
    'Los límites los impone un contrato, no una promesa',
  ],
  enPoints: [
    'One signer, you, in all of them',
    'You share by quorum: partner, associates, family',
    'A contract enforces the limits, not a promise',
  ],
  Artifact: CoreArtifact,
};

// OPERAR — la quinta órbita: la dificultad la absorbe Astryum. «prepara»,
// nunca «compila» (GLOSSARY §2); la firma es siempre del usuario.
const OPERATE_STOP: Stop = {
  id: 'operate',
  label: 'Operar',
  labelEn: 'Operate',
  num: '06',
  planet: 4,
  dock: 'right',
  start: 0.79,
  end: 0.89,
  esH: 'La dificultad la absorbe Astryum. Tú firmas.',
  enH: 'Astryum absorbs the difficulty. You sign.',
  esB: 'Describes lo que quieres. Astryum lo convierte en una orden, la simula y te la enseña entera —costes y camino de salida— antes de que firmes una vez en tu wallet.',
  enB: 'Describe what you want. Astryum turns it into an order, simulates it and shows it to you whole — costs and exit path — before you sign once in your wallet.',
  esPoints: ['Del lenguaje a la orden: sin aprender DeFi', 'Simulación y costes a la vista antes de firmar', 'Una firma en tu wallet; Astryum nunca ejecuta'],
  enPoints: ['From language to the order: no DeFi to learn', 'Simulation and costs in plain sight before signing', 'One signature in your wallet; Astryum never executes'],
  Artifact: OperateArtifact,
};

const STOPS_PERSONAL: Stop[] = [
  CORE_STOP,
  {
    id: 'summary',
    label: 'Home',
    num: '02',
    planet: 3,
    dock: 'right',
    start: 0.33,
    end: 0.45,
    esH: 'Todo tu capital, de un vistazo.',
    enH: 'All your capital, at a glance.',
    esB: 'Cuánto tienes, en qué wallets vive y si algo necesita tu atención hoy. Y cuando hay miradas cerca, los saldos se ocultan con un toque.',
    enB: "How much you hold, which wallets it lives in and whether anything needs your attention today. When someone's looking over your shoulder, balances hide with one tap.",
    // "en órbita" — the coined state the artifact's dial teaches visually
    // right beside this copy (GLOSSARY §8); also kills the health overlap
    // with the Portfolio stop, which owns that story.
    esPoints: [
      'Patrimonio neto y cuánto está en órbita, trabajando — en una sola lectura',
      'Rendimiento por wallet y por horizonte (hoy · semana · mes · año)',
      'Saldos ocultables con un toque, para mirar sin enseñar',
    ],
    enPoints: [
      'Net worth and how much is in orbit, working — in one reading',
      'Performance per wallet and per horizon (today · week · month · year)',
      'Balances hide with one tap, for looking without showing',
    ],
    Artifact: SummaryArtifact,
  },
  {
    id: 'earn',
    label: 'Earn',
    num: '03',
    planet: 2,
    dock: 'left',
    start: 0.45,
    end: 0.57,
    esH: 'Pon tus activos a trabajar. Entendiendo qué hacen.',
    enH: 'Put your assets to work. Understanding what they do.',
    esB: 'Estrategias reales en Flare, explicadas en lenguaje claro antes de firmar. Los tipos se muestran siempre como dato del protocolo, con su fuente — nunca como una promesa nuestra.',
    enB: 'Real strategies on Flare, explained in plain language before you sign. Rates always appear as protocol data, with their source — never as a promise from us.',
    // Point 1 no longer parrots the body (the exit path is the fear the Home
    // never answered); point 2 drops the third "antes de firmar" of the stop;
    // point 3: "prepara", never "compila" (GLOSSARY §2).
    esPoints: [
      'Cada estrategia declara sus pasos y su camino de salida',
      'Costes, conversiones y riesgos desglosados, sin letra pequeña',
      'Descríbela con tus palabras: el agente la prepara, tú decides',
    ],
    enPoints: [
      'Every strategy declares its steps and its exit path',
      'Costs, conversions and risks broken down — no fine print',
      'Describe it in your words: the agent prepares it, you decide',
    ],
    Artifact: EarnArtifact,
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    num: '04',
    planet: 1,
    dock: 'right',
    start: 0.57,
    end: 0.68,
    esH: 'Cada posición, con su salud a la vista.',
    enH: 'Every position, health in plain sight.',
    esB: 'Todas tus redes y wallets en una sola vista viva: qué tienes, dónde está trabajando y a qué distancia queda cada posición de un problema.',
    enB: "All your networks and wallets in one living view: what you hold, where it's working and how far each position sits from trouble.",
    // Point 1 no longer parrots the body — the history (with its receipts) is
    // real product surface the Home never mentioned.
    esPoints: [
      'El histórico de cada wallet, operación a operación',
      'Salud y precio de liquidación, posición a posición',
      'Filtra por wallet, red, activo o periodo',
    ],
    enPoints: [
      "Every wallet's history, operation by operation",
      'Health and liquidation price, position by position',
      'Filter by wallet, network, asset or period',
    ],
    Artifact: PortfolioArtifact,
  },
  {
    id: 'wallets',
    label: 'Wallets',
    num: '05',
    planet: 0,
    dock: 'left',
    start: 0.68,
    end: 0.79,
    esH: 'Tus llaves nunca salen de tu wallet.',
    enH: 'Your keys never leave your wallet.',
    // The headline above owns the page's ONE keys claim — the body adds the
    // prepare-and-hand-over fact instead of restating it (GLOSSARY §6.6).
    esB: 'Conecta MetaMask o Xaman, o vigila una dirección en solo lectura. Astryum prepara cada operación y te la entrega lista para revisar.',
    enB: 'Connect MetaMask or Xaman, or watch an address in read-only. Astryum prepares every action and hands it over, ready for your review.',
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
  OPERATE_STOP,
];

// Legacy retells the same four instruments for the council-governed account.
// Vocabulary mirrors the dashboard's Legacy panel: council, quorum,
// constitution, programmed transfers; you propose — the council signs.
const STOPS_LEGACY: Stop[] = [
  CORE_STOP,
  {
    id: 'summary',
    label: 'Home',
    num: '02',
    planet: 3,
    dock: 'right',
    start: 0.33,
    end: 0.45,
    esH: 'El patrimonio del Legacy, a la vista de todos.',
    enH: "The Legacy's wealth, in plain sight for everyone.",
    esB: 'Cuánto hay, dónde vive y qué espera una decisión del consejo. La misma lectura clara, ahora para un capital que se gobierna entre varios.',
    enB: 'How much there is, where it lives and what awaits a council decision. The same clear reading, now for capital governed together.',
    esPoints: [
      'La lectura del consejo: cuánto hay y qué espera una decisión',
      'El mismo panel claro, sobre capital gobernado entre varios',
      'Todos los miembros ven lo mismo; nadie mueve nada solo',
    ],
    enPoints: [
      "The council's reading: how much there is and what awaits a decision",
      'The same clear panel, over capital governed together',
      'Every member sees the same thing; no one moves anything alone',
    ],
    Artifact: SummaryArtifact,
  },
  {
    id: 'earn',
    label: 'Earn',
    num: '03',
    planet: 2,
    dock: 'left',
    start: 0.45,
    end: 0.57,
    esH: 'El capital del Legacy también trabaja. Con reglas.',
    enH: 'Legacy capital works too. Under rules.',
    esB: 'Las mismas estrategias reales en Flare, pero aquí nadie mueve nada solo: Astryum prepara la operación y es el consejo quien la firma por quórum.',
    enB: "The same real strategies on Flare — but here no one moves anything alone: Astryum prepares the action and it's the council that signs it, by quorum.",
    esPoints: [
      'Las mismas estrategias reales en Flare mainnet',
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
    num: '04',
    planet: 1,
    dock: 'right',
    start: 0.57,
    end: 0.68,
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
    num: '05',
    planet: 0,
    dock: 'left',
    start: 0.68,
    end: 0.79,
    esH: 'Capital que solo se mueve por quórum.',
    enH: 'Capital that only moves by quorum.',
    esB: 'Constituye un Legacy en XRPL: un consejo de firmantes, una constitución y transferencias programadas. Tú propones; el consejo firma; Astryum nunca firma ni custodia.',
    enB: 'Constitute a Legacy on XRPL: a council of signers, a constitution and programmed transfers. You propose; the council signs; Astryum never signs, never takes custody.',
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
  OPERATE_STOP,
];

// `self` — «lo que has visto, aplicado a ti» (/self-custody): las mismas seis
// paradas de Personal con la voz de aplicación en el núcleo y en las wallets.
/** Las paradas del viaje, para quien las tenga que MARCAR (el HUD del plan de
 *  vuelo): una sola tabla de tiempos, la del propio viaje. */
export const SOLAR_LEGS = STOPS_PERSONAL.map((st) => ({ id: st.id, es: st.label, en: st.labelEn ?? st.label, start: st.start, end: st.end }));

const STOPS_SELF: Stop[] = STOPS_PERSONAL.map((st) => {
  if (st.id === 'core') {
    return {
      ...st,
      esH: 'Tu cuenta, y las de los tuyos.',
      enH: 'Your account, and your people’s.',
      esB: 'Aplicado a ti: la cuenta principal es tuya y solo tuya, y dentro abres las que compartes —con tu pareja, con tus hijos, con tus socios— cada una con su regla en el ledger.',
      enB: 'Applied to you: the main account is yours and yours alone, and inside it you open the ones you share — with your partner, your children, your associates — each with its rule on the ledger.',
    };
  }
  if (st.id === 'wallets') {
    return {
      ...st,
      esH: 'Firmas en tu wallet. Siempre.',
      enH: 'You sign in your wallet. Always.',
      esB: 'Xaman para XRPL, MetaMask para Flare, o una dirección en solo lectura para mirar. Astryum prepara cada operación y te la entrega; la llave nunca sale de donde está.',
      enB: 'Xaman for XRPL, MetaMask for Flare, or a read-only address to watch. Astryum prepares every action and hands it over; the key never leaves where it is.',
    };
  }
  return st;
});

const STOPS_BY_PRODUCT: Record<Product, Stop[]> = { personal: STOPS_PERSONAL, legacy: STOPS_LEGACY, self: STOPS_SELF };

// Timing/geometry tables derive from ONE timeline (both products share it).
const TIMELINE = STOPS_PERSONAL;
const STOP_BY_PLANET = PLANETS.map((_, i) => TIMELINE.findIndex((s) => s.planet === i));
/** The stop that docks the star itself (−1 planet), if the itinerary has one. */
const CORE_INDEX = TIMELINE.findIndex((s) => s.planet < 0);
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

const TILT_PTS = [0, 0.12, 0.2, 0.9, 0.96];
const TILT_VALS = [TILT_HERO, TILT_HERO, TILT_STOP, TILT_STOP, TILT_HERO];
// The sun dims to a backdrop during the tour (a scaled 54% logo would swallow
// the copy) with one brief brand beat while crossing to Earn, and returns full
// for the landing emblem.
// The sun stays FULL through the core stop (it IS the core), dims once the
// tour leaves it, and returns for the landing emblem.
const SUN_PTS = [0.33, 0.39, 0.44, 0.46, 0.49, 0.92, 0.97];
const SUN_VALS = [1, 0.25, 0.25, 0.4, 0.25, 0.25, 1];
const CRUISE_PTS = [0.06, 0.18, 0.9, 0.98];
const CRUISE_VALS = [1, 0.12, 0.12, 1];

// Ring dimming: full until takeoff completes, then only the docked planet's
// ring holds full presence; everything returns for the landing emblem.
const DIM = PLANETS.map((_, i) => {
  // An orbit hidden at rest reveals itself on takeoff (the fifth ring).
  const pts = HIDDEN_AT_REST[i] ? [0.12, 0.19] : [0.19];
  const vals = HIDDEN_AT_REST[i] ? [0, 1] : [1];
  TIMELINE.forEach((s) => {
    const own = s.planet === i;
    pts.push(s.start + 0.04, s.end - 0.01);
    vals.push(own ? 1 : 0.3, own ? 1 : 0.3);
  });
  pts.push(0.95);
  vals.push(HIDDEN_AT_REST[i] ? 0.6 : 1);
  return { pts, vals };
});

// Glow singularity: every planet glows at rest (the hero as-is), all glow dies
// on takeoff, only the docked planet re-lights during its stop, and the full
// set returns with the landing emblem.
const GLOW = PLANETS.map((_, i) => {
  const s = TIMELINE[STOP_BY_PLANET[i]];
  return {
    pts: [0.12, 0.18, s.start + 0.03, s.start + 0.07, s.end - 0.03, s.end - 0.005, 0.95, 0.985],
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
    if (st.planet < 0) {
      // THE CORE: the camera parks on the star. The asteroid paints ~29% of
      // its image, and the image is 50% of the scene, so the body is ~0.145·W
      // wide; ~26% of the short side leaves room for the five account rings
      // CoreOverlay draws around it (out to ~3.2 radii).
      // 22 % of the short side and a touch further out than a planet (0.34 vw):
      // measured on 1440×860, the outermost ring then ends ~6px short of the
      // copy panel instead of running under its first line.
      const s = (0.22 * minD) / (0.145 * W);
      const tx = desktop ? (st.dock === 'right' ? 0.66 : 0.34) * vw : 0.5 * vw;
      const ty = desktop ? 0.5 * vh : 0.34 * vh;
      return { x: tx - cx, y: ty - cy, s };
    }
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

  const pts = [0, 0.1, 0.19];
  const cams = [rest, rest, ov];
  TIMELINE.forEach((st, i) => {
    pts.push(st.start + 0.05, st.end - 0.01);
    cams.push(stops[i], stops[i]);
  });
  pts.push(0.95, 1);
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
  /* Phones (static twin only — the pinned stage never renders below lg): the
     orbit pills carry fixed 27px offsets + nowrap labels tuned for the 480px
     desktop scene; at 320-375px the outer ring's "Coordina" pill overran the
     viewport and the hero's overflow-hidden cut it in half. Shrink the scene
     so ring + pill fit, and tighten the pills to match. */
  @media (max-width: 640px) {
    .solar-scene-j { width: min(66vw, 300px); }
    .sj-pill { top: 18px !important; left: 14px !important; padding: 2px 8px !important; }
    .sj-pill > span:last-child { font-size: 9px !important; letter-spacing: 0.12em !important; }
  }
  /* ─── The scene's own oversample ────────────────────────────────────────
     The camera pushes in to ~2.4x at a stop, and the whole stage lives in a
     3D rendering context, which the browser rasterizes once and then texture-
     maps. Anything painted at 1x and shown at 2.4x is therefore stretched —
     that is the blur on the planets and the orbit lines (the labels escaped by
     moving out of the camera entirely; the system itself cannot, it needs the
     3D).
     So the system is BUILT three times too big and shown at a third: the net
     scale to screen becomes 2.4/3 ≈ 0.8, and a texture that is only ever
     DOWNSAMPLED is crisp no matter which rasterization the browser picks. The
     inner box is what does it — 300% of the scene, scaled back by 1/3 from its
     top-left corner, so its visual box lands exactly on the scene's.
     The tilt inside is unaffected: a uniform scale after a rotation scales the
     z axis too, so the perspective sees precisely the depth it saw before.
     Every fixed pixel length under here is multiplied by SCENE_OVERSAMPLE in
     the stage's JSX; percentages take care of themselves. --sjo is 1 by
     default, so the static twin below lg keeps its original geometry. */
  .solar-scene-inner {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(100% * var(--sjo, 1));
    height: calc(100% * var(--sjo, 1));
    transform-origin: 0 0;
    /* scale3d, NOT scale. A plain scale() is a 2D transform — it shrinks x and y and
       leaves z ALONE. Building the system three times bigger triples the z its
       tilt produces, so a 2D scale-back left the depths three times too deep
       and the orbits ballooned into a dome (founder 2026-08-22: "el tema del
       3d se ha roto un poco"). Scaling all three axes is what makes the
       cancellation exact, and the perspective then sees precisely the geometry
       it saw before. The inverse is passed in rather than computed with calc()
       inside scale3d, which is the kind of thing engines disagree about. */
    transform: scale3d(var(--sjoinv, 1), var(--sjoinv, 1), var(--sjoinv, 1));
    transform-style: preserve-3d;
  }
  .solar-stage-j { position: absolute; inset: 0; transform-style: preserve-3d; }
  /* The ring element is a PURE 3D carrier: transform only. Its visible line
     lives in .solar-ringline-j, and dimming/blur live on leaf wrappers —
     opacity<1 or filter on this element would force transform-style:flat
     mid-chain and squash every billboarded planet into an egg (founder
     2026-07-25: "aplastados"). */
  /* NO will-change here. It used to be permanent, and that is what kept the
     docked planet's label soft no matter what the camera did: the pill is a
     DESCENDANT of this ring, so this element's pinned raster scale pinned the
     pill's too — measured live, with the camera parked and its own will-change
     already back to auto. The hint is now written per ring by the loop, and
     only while that ring is actually turning (see ringWC). */
  .solar-ring-j { position: absolute; top: 50%; left: 50%; border-radius: 50%; transform-style: preserve-3d; }
  .solar-ringline-j { position: absolute; inset: 0; border-radius: 50%; border: calc(1px * var(--sjo, 1)) solid rgba(var(--ja),0.22); box-shadow: 0 0 calc(24px * var(--sjo, 1)) rgba(var(--ja),0.07) inset; }
  .solar-anchor-j { position: absolute; top: 0; left: 50%; transform: translate(-50%,-50%); transform-style: preserve-3d; }
  .solar-counter-j { transform-style: preserve-3d; }
  .solar-flat-j { position: relative; width: 0; height: 0; transform-style: preserve-3d; }
  /* Its own layer, now that the ring above no longer keeps one permanently:
     this element spins forever, and without the hint its repaints would dirty
     the whole ring subtree — including the label we just went to the trouble
     of letting repaint at rest. */
  .solar-moon-j { animation: sj-moon-spin 10s linear infinite; will-change: transform; }
  .solar-moon-j > span:first-child, .solar-moon-ring { border-width: calc(1px * var(--sjo, 1)) !important; }
  @keyframes sj-moon-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .solar-moon-j { animation: none; } }
`;

// ─── Tour labels, in camera space ────────────────────────────────────────────
// Founder 2026-08-22, third pass: "sigue pixelado… pierde profesionalidad".
//
// The previous two passes attacked the symptom from inside the scene — release
// the compositor hints, oversample the glyphs — and neither moved the measured
// sharpness, because both still depended on the browser choosing to re-rasterize
// a `perspective` + `preserve-3d` subtree at the scale it is being shown at.
// It does not have to, and it does not.
//
// So the label stops living in there. It is rendered OUTSIDE the camera, as a
// sibling, and every length it uses is derived with calc() from --sjs, the
// camera's live scale. Nothing about it is ever magnified: at a 2.4x camera the
// text is a real 26.7px font laid out and rasterized at 26.7px, instead of an
// 11px texture stretched to 26.7. It looks identical — same position, same
// size, same growth as the camera pushes in — and it cannot be soft, because
// there is no scale transform anywhere in its chain to be soft about.
//
// The one thing it must not do is carry a scale() of its own; that would put it
// straight back at the mercy of raster-scale heuristics. Position comes from a
// translate (which never affects rasterization) and size comes from calc().
const SJ_LABEL_CSS = `
  .sj-labels { position: absolute; inset: 0; pointer-events: none; z-index: 21; }
  .sj-label { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
  .sj-label-pill {
    position: absolute;
    left: calc(27px * var(--sjs, 1));
    top: calc(25px * var(--sjs, 1));
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    white-space: nowrap;
    border-radius: 9999px;
    background: rgba(10,10,10,0.85);
    gap: calc(6px * var(--sjs, 1));
    padding: calc(4px * var(--sjs, 1)) calc(10px * var(--sjs, 1));
    border: calc(1px * var(--sjs, 1)) solid rgba(255,255,255,0.12);
  }
  .sj-label-dot { width: calc(6px * var(--sjs, 1)); height: calc(6px * var(--sjs, 1)); border-radius: 9999px; flex-shrink: 0; }
  .sj-label-text {
    font-size: calc(11px * var(--sjs, 1));
    line-height: 1.5;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(255,255,255,0.85);
  }
  .sj-label-leader { position: absolute; left: calc(3px * var(--sjs, 1)); top: calc(3px * var(--sjs, 1)); width: calc(30px * var(--sjs, 1)); height: calc(28px * var(--sjs, 1)); overflow: visible; }
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
// ─── Pill oversampling (founder 2026-08-22: "se ve cada vez más pixelado en
// función de lo cerca que esté") ─────────────────────────────────────────────
// The dock camera scales the scene up to ~3.3× (2.4× at the Earn stop on a
// 1440×860 window, measured live), and the whole stage lives inside a
// `perspective` + `preserve-3d` subtree — which Chrome rasterizes ONCE and then
// texture-maps. That is the part that makes this different from an ordinary 2D
// zoom: dropping `will-change:transform` when the camera parks is necessary
// (it is done, in the loop below) but it is NOT sufficient, because a 3D
// subtree does not get re-rastered at its screen scale. Verified by measuring:
// with the camera parked and will-change reading `auto`, an 11px label was
// still soft.
//
// So the pills take the exact medicine the planets took in July: painted at
// PILL_OVERSAMPLE× and parked at 1/PILL_OVERSAMPLE. Visually identical — 11px
// text under a 2.4× camera is the same 26px on screen either way — but the
// glyph is rasterized from 33px instead of from 11px, so the camera's zoom
// lands near native resolution instead of stretching a small texture.
//
// The transform order matters: `scale(1/N) translateY(-50%)` — the translate
// must sit INSIDE the scale so its percentage (which resolves against the now
// N× taller border box) comes back down with everything else. Written the
// other way round the pill flies up by N/2 of its own height.
//
// HONEST STATUS (2026-08-22). Geometry is verified: measured live against the
// previous build, the pill lands at the same x/y and the same width/height to
// within 0.1px, so this is visually neutral by construction. The SHARPNESS gain
// is NOT verified — in a headless, software-rendered harness the edge energy of
// the label region did not move (12.61 -> 12.66, inside the noise), and that
// harness did not move for the will-change work either. It may simply not do
// scale-adaptive rasterization at all: a control pill rendered FLAT at the
// identical on-screen size scored 18.37 against the camera pill's 12.62, which
// proves the blur is real and measurable, but not that any hint can cure it
// there.
//
// What that leaves: this and the will-change work are the correct, cheap moves,
// and they are the same medicine that visibly worked for the planets on real
// hardware. The one fix that CANNOT fail — because it stops depending on
// compositor heuristics — is to take the label out of the camera's 3D subtree
// and position it in screen space, so it is never magnified at all. That is a
// larger change to how the label tracks its planet, and it is the founder's call.
// How much bigger than life the pinned scene is built. See .solar-scene-inner.
const SCENE_OVERSAMPLE = 3;

const PILL_OVERSAMPLE = 3;
// NOT named `px`: the animation loop already binds `px`/`py` to the pointer
// parallax motion values, and a module-level `px` shadowed by a local one is
// exactly the kind of near-miss that survives review.
const ovs = (n: number) => n * PILL_OVERSAMPLE;

const PILL_BASE: React.CSSProperties = {
  position: 'absolute',
  top: 25,
  left: 27,
  transformOrigin: '0 0',
  transform: `scale(${1 / PILL_OVERSAMPLE}) translateY(-50%)`,
  border: `${ovs(1)}px solid rgba(255,255,255,0.12)`,
  borderRadius: 9999,
  display: 'flex',
  alignItems: 'center',
  gap: ovs(6),
  padding: `${ovs(4)}px ${ovs(10)}px`,
  whiteSpace: 'nowrap',
};
/** The pill's contents, at oversampled sizes. */
const PILL_DOT: React.CSSProperties = { width: ovs(6), height: ovs(6), borderRadius: 9999, flexShrink: 0 };
const PILL_TEXT: React.CSSProperties = {
  fontSize: ovs(11),
  // 1.5, not a guess: the classes this replaced inherited the document's
  // normal line-height, and measuring the live pill gave a 16.5px text box for
  // an 11px font. Any other value changes the pill's height, and the pill is
  // vertically centred on its anchor, so a wrong height also moves it.
  lineHeight: 1.5,
  letterSpacing: '0.16em', // em-relative: scales with the font, nothing to multiply
  textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.85)',
};
const PILL_HERO: React.CSSProperties = {
  ...PILL_BASE,
  // No backdrop-filter (perf 2026-08-20): a persistent backdrop blur over the
  // 60fps star canvas re-samples it EVERY frame — a slightly denser plate
  // reads the same and composites once.
  background: 'rgba(10,10,10,0.88)',
};
// The hero pill, for the PINNED stage only: it now sits inside the oversampled
// box, so it wants to be SCENE_OVERSAMPLE times life size — which is exactly
// the size PILL_BASE already builds. All it has to do is stop scaling itself
// back down, and move its offsets out by the same factor.
const PILL_HERO_SCENE: React.CSSProperties = {
  top: 25 * SCENE_OVERSAMPLE,
  left: 27 * SCENE_OVERSAMPLE,
  transform: 'translateY(-50%)',
};
const PILL_TOUR: React.CSSProperties = {
  ...PILL_BASE,
  background: 'rgba(10,10,10,0.85)',
};

// Same oversample as the pill it points at: the SVG is laid out N× and parked
// at 1/N, so its hairline is rasterized N× denser and survives the camera.
function LeaderLine({ rgb, scale = 1 }: { rgb: string; scale?: number }) {
  // Drawn `scale` times life size with the viewBox unchanged, so the SVG's own
  // vector rasterizer does the resampling — no bitmap transform to go soft.
  // The pinned stage passes SCENE_OVERSAMPLE (it lives inside the oversampled
  // box and is scaled back down with everything else); the static twin below
  // lg is never zoomed and takes the default 1.
  return (
    <svg
      width={30 * scale}
      height={28 * scale}
      viewBox="0 0 30 28"
      fill="none"
      style={{ position: 'absolute', top: 3 * scale, left: 3 * scale, overflow: 'visible' }}
    >
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
    <div className="flex flex-col items-center gap-2">
      <div
        role="group"
        aria-label={T('Producto', 'Product', lang)}
        className="inline-flex items-center gap-0.5 p-1 rounded-full"
        style={{ border: `1px solid ${BORDER}`, background: 'rgba(10,10,10,0.82)' }}
      >
        {opts.map((o) => (
          <button
            key={o.key}
            onClick={() => setProduct(o.key)}
            aria-pressed={product === o.key}
            // py-2.5 (was py-2): this is the mobile journey's only control
            // besides the CTAs and 32px sat under the touch minimum
            className="px-4 py-2.5 rounded-full text-xs font-semibold transition-colors"
            style={product === o.key ? { background: o.bg, color: o.ink } : { color: 'rgba(255,255,255,0.45)' }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {/* Legacy is validating on mainnet and not open yet — the toggle says so
          the moment it is selected, in BOTH journey variants (founder
          2026-07-29: honest label, not a hidden product). */}
      {product === 'legacy' && (
        <span
          className="text-[10px] font-mono uppercase tracking-[0.18em] px-2.5 py-1 rounded-full text-center max-w-[90vw]"
          style={{ color: PALETTES.legacy.soft, background: 'rgba(10,10,10,0.55)', border: `1px solid ${BORDER}` }}
        >
          {T('En validación en mainnet · abre pronto', 'Validating on mainnet · opening soon', lang)}
        </span>
      )}
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
  /** Scene width in CSS px — the unit every label offset is expressed in. */
  const sceneW = useRef(0);
  const camera = useRef<CameraKeys | null>(null);
  const free = useRef(PLANETS.map((p) => p.phase));
  const floatT = useRef(0);
  // Displayed camera state, exponentially smoothed toward the scroll-derived
  // target — soaks up trackpad inertia spikes so the flight reads calm even
  // when the wheel doesn't.
  const smoothCam = useRef<{ x: number; y: number; s: number; tilt: number } | null>(null);
  /** The camera's scale, republished for the labels to size themselves with. */
  const labelScale = useRef(motionValue(1)).current;
  // Whether the camera has ARRIVED — see the will-change note in the loop.
  const camParked = useRef<boolean | null>(null);
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
      /** THE CORE OVERLAY (2026-09-20): the star's screen position, its radius
       *  in px and the core stop's blend — placed outside the camera, like the
       *  labels, so the account rings are never a stretched texture. */
      coreT: motionValue('translate(0px, 0px)'),
      coreR: motionValue(0),
      coreOp: motionValue(0),
      // Leader-line life = whichever label generation is alive. Unbound, the
      // lines outlived their pills and stuck out of every planet at the
      // finale ("las flechas que salen de los planetas" — founder 2026-07-25).
      rings: PLANETS.map((p) => ({
        op: motionValue(1),
        ringT: motionValue(`translate(-50%,-50%) rotate(${p.phase}deg)`),
        counterT: motionValue(`rotate(${-p.phase}deg)`),
        /** 'transform' while this ring turns, 'auto' once it parks on its dock
         *  angle — the difference between a texture that gets stretched and one
         *  that gets repainted at the size it is shown at. */
        ringWC: motionValue('transform'),
        /** Screen-space placement of this planet's tour label, relative to the
         *  camera's UNTRANSFORMED centre. Translate only — see SJ_LABEL_CSS. */
        labelT: motionValue('translate(0px, 0px)'),
        /** newLabel × this ring's own dim, so the undocked labels stay quiet. */
        labelOp: motionValue(0),
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
    // Unmeasurable stage (display:none below lg — e.g. an iPad rotating
    // portrait→landscape mid-scroll): W/clientWidth are 0 and buildCamera
    // would divide 0/0 into NaN keyframes; the exponential smoother then
    // latches NaN forever (NaN + x = NaN, the settle epsilon never fires) and
    // the scene's transform is dropped for the rest of the session. Park the
    // camera and let the next real measure reseed the smoother.
    if (!sticky.clientWidth || !sticky.clientHeight || !W) {
      camera.current = null;
      smoothCam.current = null;
      return;
    }
    sceneW.current = W;
    camera.current = buildCamera({
      vw: sticky.clientWidth,
      vh: sticky.clientHeight,
      cx: ox + W / 2,
      cy: oy + cam.offsetHeight / 2,
      W,
      desktop: sticky.clientWidth >= 1024,
    });
    // Reseed on every re-measure: a geometry jump (rotation, URL bar) should
    // snap to the fresh keyframes, not ease from a stale — possibly broken —
    // smoothed state.
    smoothCam.current = null;
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
    // Hoisted out of the block below: the planet loop needs the smoothed
    // camera to place the labels, and `c` is block-scoped in there.
    let camNow: { x: number; y: number; s: number; tilt: number } | null = null;
    if (cam) {
      const tx = pieceSmooth(p, cam.pts, cam.xs);
      const ty = pieceSmooth(p, cam.pts, cam.ys);
      const ts = pieceSmooth(p, cam.pts, cam.ss);
      // Never let a non-finite target into the smoother — one NaN write would
      // stick to every later frame and drop the stage transform entirely.
      if (!Number.isFinite(tx + ty + ts)) return;
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
      // ARRIVAL RE-RASTER (founder 2026-08-22: "el zoom que hace al sistema
      // solar se ve cada vez más pixelado en función de lo cerca que esté").
      // This is the other half of the 2026-07-26 settle fix. Quantizing the
      // transform gave the browser an idle beat — but `will-change:transform`
      // is precisely the instruction NOT to use it: it pins the layer's raster
      // scale so the compositor can zoom the existing texture instead of
      // repainting. At the innermost stop the camera lands around 3× (the
      // scale is (0.95·minD)/((ring/100)·W), which for ring 44 on a 480px
      // scene is ~3.3 on a laptop), so a texture rasterized at 1× is stretched
      // 3× — exactly the mush in the screenshot, and worse the closer the
      // camera gets, which is what the founder noticed.
      //
      // So the hint is TEMPORARY: on while the camera travels (smooth zoom, no
      // repaint per frame), off the moment it parks, which drops the pin and
      // lets Chrome repaint the scene at the scale it is actually being shown
      // at. Reading always happens parked, so reading always happens sharp.
      // The planets keep their own 4× oversample — that is what carries them
      // DURING the flight, when nothing can re-rasterize in time.
      const parked = c.x === tx && c.y === ty && c.s === ts && c.tilt === tiltTarget;
      if (parked !== camParked.current) {
        camParked.current = parked;
        if (camRef.current) camRef.current.style.willChange = parked ? 'auto' : 'transform';
      }
      mv.camX.set(Math.round(c.x * 10) / 10);
      mv.camY.set(Math.round(c.y * 10) / 10);
      mv.camS.set(Math.round(c.s * 2000) / 2000);
      // The labels size themselves off this. Quantised to 0.002 for the same
      // reason the transform is: while the camera is parked the value stops
      // changing, so the label subtree stops re-laying-out entirely.
      labelScale.set(Math.round(c.s * 500) / 500);
      camNow = c;
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
    const floatYVal = fl * (-5 + 5 * Math.cos((2 * Math.PI * floatT.current) / 7));
    mv.floatY.set(floatYVal);

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
    // THE CORE: while the star itself is the docked object it stays whole and
    // sharp — the focus dims everything BUT the docked body, and here the
    // docked body is the sun.
    const coreStop = CORE_INDEX >= 0 ? TIMELINE[CORE_INDEX] : null;
    const coreBlend = coreStop ? stopBlend(p, coreStop) : 0;
    const sunFocus = focus * (1 - coreBlend);
    mv.sun.set(piece(p, SUN_PTS, SUN_VALS) * (1 - 0.75 * sunFocus));
    mv.sunF.set(sunFocus > 0.01 ? `blur(${(5 * sunFocus).toFixed(1)}px)` : 'none');
    mv.coreOp.set(Math.round(coreBlend * 500) / 500);
    if (camNow && sceneW.current) {
      mv.coreT.set(`translate(${camNow.x.toFixed(1)}px, ${(camNow.y + camNow.s * floatYVal).toFixed(1)}px)`);
      mv.coreR.set(Math.round(camNow.s * sceneW.current * 0.0725 * 10) / 10);
    }
    const oldL = piece(p, [0.1, 0.16], [1, 0]);
    mv.oldLabel.set(oldL);
    // Section labels live for the tour and bow out for the landing emblem —
    // sub-10px scaled text would read as mush on the small resting system.
    const newL = piece(p, [0.16, 0.2, 0.9, 0.95], [0, 1, 1, 0]);
    mv.newLabel.set(newL);

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
      // Parked = the snap above landed this ring exactly on its dock angle, so
      // its transform has stopped changing. Only then is it safe (and useful)
      // to drop the compositing hint and let the subtree — label included —
      // repaint at the camera's real scale. The other rings keep turning at
      // 12% cruise and keep their hint: dropping it there would repaint them
      // every frame for nothing.
      r.ringWC.set(free.current[i] === DOCK_ANGLE[st.dock] ? 'auto' : 'transform');

      // ── The tour label, placed in camera space ────────────────────────────
      // This is the geometry that lets the label live OUTSIDE the camera (see
      // SJ_LABEL_CSS). It is the same arithmetic buildCamera uses to decide
      // where to park the camera, run in the opposite direction: the planet
      // sits `rf` of the scene width from the centre, at angle `a`, on a plane
      // tilted by `c.tilt` — so its offset from the scene centre is
      // (sin a · rf · W, −cos a · rf · W · cos tilt), plus the scene's bob.
      // The camera then translates by (c.x, c.y) and scales by c.s about that
      // same centre, which turns the offset into the two lines below.
      //
      // The pointer parallax would break this — it rotates the scene in 3D and
      // the labels would not follow — but it is already faded to zero by p=0.14
      // and the labels only live from p=0.16, so the two never overlap.
      if (camNow && sceneW.current) {
        const rad = (a * Math.PI) / 180;
        const rf = pl.ring / 200;
        const wS = sceneW.current;
        const lx = Math.sin(rad) * rf * wS;
        const ly = -Math.cos(rad) * rf * wS * Math.cos((camNow.tilt * Math.PI) / 180) + floatYVal;
        r.labelT.set(
          `translate(${(camNow.x + camNow.s * lx).toFixed(1)}px, ${(camNow.y + camNow.s * ly).toFixed(1)}px)`,
        );
      }
      // × (1 − coreBlend): mientras manda el núcleo, los planetas siguen ahí
      // pero callan su nombre — un «HOME» desenfocado detrás de los brotes era
      // el último ruido de la parada.
      r.labelOp.set(Math.round(newL * piece(p, DIM[i].pts, DIM[i].vals) * (1 - coreBlend) * 500) / 500);
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

  // No will-change class on the camera: the hint is written by the loop above,
  // and only while the camera is actually moving.
  //
  // The wrapper is deliberately plain — no transform of its own — so it keeps
  // the camera's UNTRANSFORMED box, which is the coordinate frame the labels
  // are placed in: the camera scales about its own centre, so a planet's screen
  // offset from that centre is camX/camY + camS x its scene offset.
  return (
    <div className="relative">
    <motion.div ref={camRef} className="relative" style={{ x: mv.camX, y: mv.camY, scale: mv.camS, zIndex: 20 }}>
      <motion.div style={{ perspective: 1000, rotateX: mv.rotX, rotateY: mv.rotY, transformStyle: 'preserve-3d' }}>
        <motion.div
          className="solar-scene-j"
          style={{
            y: mv.floatY,
            ['--ja' as never]: palette.rgb,
            ['--sjo' as never]: SCENE_OVERSAMPLE,
            ['--sjoinv' as never]: 1 / SCENE_OVERSAMPLE,
          }}
          aria-hidden
        >
          <style>{SCENE_CSS}</style>
          {/* built SCENE_OVERSAMPLE times too big, shown at 1/that — see the
              .solar-scene-inner note in SCENE_CSS */}
          <div className="solar-scene-inner">
          <motion.div className="solar-stage-j" style={{ transform: mv.stageT }}>
            {PLANETS.map((p, i) => {
              const color = palette.planets[i];
              return (
                <motion.div
                  key={i}
                  className="solar-ring-j"
                  style={{
                    width: `${p.ring}%`,
                    height: `${p.ring}%`,
                    transform: mv.rings[i].ringT,
                    willChange: mv.rings[i].ringWC,
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
                            width: p.sz * 2.5 * SCENE_OVERSAMPLE,
                            height: p.sz * 2.5 * SCENE_OVERSAMPLE,
                            top: (-p.sz * 2.5 * SCENE_OVERSAMPLE) / 2,
                            left: (-p.sz * 2.5 * SCENE_OVERSAMPLE) / 2,
                            opacity: mv.rings[i].moon,
                            visibility: mv.rings[i].moonVis,
                          }}
                        >
                          <span
                            className="solar-moon-j absolute inset-0 rounded-full"
                            style={{ border: `${SCENE_OVERSAMPLE}px dashed rgba(${palette.rgb},0.4)` }}
                          >
                            <span
                              className="absolute rounded-full"
                              style={{
                                width: 5 * SCENE_OVERSAMPLE,
                                height: 5 * SCENE_OVERSAMPLE,
                                top: -2.5 * SCENE_OVERSAMPLE,
                                left: '50%',
                                marginLeft: -2.5 * SCENE_OVERSAMPLE,
                                background: palette.soft,
                                boxShadow: `0 0 ${8 * SCENE_OVERSAMPLE}px ${palette.soft}`,
                              }}
                            />
                          </span>
                        </motion.div>
                        {/* the planet — body, glow and moonlet live on separate
                            layers so each animates only its own property */}
                        <PlanetBody index={i} sz={p.sz * SCENE_OVERSAMPLE} color={color} palette={palette} bodyT={mv.rings[i].bodyT} />
                        {/* Leader line for the HERO pill only. The tour's own
                            line moved out with its label (SJ_LABEL_CSS) — a
                            sharp pill hanging off a stretched line would just
                            move the problem. */}
                        <motion.span style={{ opacity: mv.oldLabel }}>
                          <LeaderLine rgb={palette.rgb} scale={SCENE_OVERSAMPLE} />
                        </motion.span>
                        <motion.span
                          className="absolute rounded-full"
                          style={{
                            width: p.sz * SCENE_OVERSAMPLE,
                            height: p.sz * SCENE_OVERSAMPLE,
                            top: (-p.sz * SCENE_OVERSAMPLE) / 2,
                            left: (-p.sz * SCENE_OVERSAMPLE) / 2,
                            boxShadow: `0 0 ${12 * SCENE_OVERSAMPLE}px ${color}, 0 0 ${28 * SCENE_OVERSAMPLE}px ${palette.glowSecondary}`,
                            opacity: mv.rings[i].glow,
                          }}
                        />
                        {/* principle label (the hero's original) crossfades to the section label on takeoff */}
                        {p.prEs && (
                          <motion.div style={{ ...PILL_HERO, ...PILL_HERO_SCENE, opacity: mv.oldLabel }}>
                            <span style={{ ...PILL_DOT, background: color }} />
                            <span className="font-mono" style={PILL_TEXT}>{es ? p.prEs : p.prEn}</span>
                          </motion.div>
                        )}
                        {/* The tour pill used to sit here. It is drawn in
                            camera space now — see SJ_LABEL_CSS. */}
                        </motion.div>
                      </motion.div>
                    </motion.div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
          {/* Astryum — the star this system orbits. Each product brings its
              own asteroid (founder 2026-08-08): gold hero for Personal, the
              blue mark for Legacy — palette.hero, like every other color
              here. 50% (was 54%), own tilt + masked specular sweep. */}
          <motion.div
            className="absolute"
            style={{ top: '50%', left: '50%', x: '-50%', y: '-50%', zIndex: 2, width: '50%', opacity: mv.sun, filter: mv.sunF }}
          >
            <motion.div
              className="relative"
              style={{ rotateX: mv.sunRX, rotateY: mv.sunRY, transformPerspective: 600, transformStyle: 'preserve-3d' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={palette.hero} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
              {/* pointer-lit facet sweep — clipped to the asteroid itself */}
              <motion.div
                className="absolute inset-0"
                style={{
                  background: mv.sunSpec,
                  WebkitMaskImage: `url(${palette.hero})`,
                  maskImage: `url(${palette.hero})`,
                  WebkitMaskSize: '100% 100%',
                  maskSize: '100% 100%',
                  mixBlendMode: 'screen',
                }}
              />
            </motion.div>
          </motion.div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>

    {/* The tour labels — outside the camera on purpose (see SJ_LABEL_CSS).
        Everything here is placed with a translate and sized with calc() off
        --sjs, so no glyph is ever a stretched texture. */}
    <motion.div className="sj-labels" style={{ ['--sjs' as never]: labelScale }} aria-hidden>
      <style>{SJ_LABEL_CSS}</style>
      <CoreOverlay lang={lang} palette={palette} coreT={mv.coreT} coreR={mv.coreR} coreOp={mv.coreOp} />
      {PLANETS.map((p, i) => {
        const stop = stops[STOP_BY_PLANET[i]];
        const color = palette.planets[i] ?? palette.accent;
        return (
          <motion.div
            key={p.ring}
            className="sj-label"
            // The defocus the ring lines already get, now that these labels are
            // sharp enough to compete with the copy: while a stop holds, only
            // the docked planet's name stays in focus — which is what the
            // reading-focus block in the loop was always meant to mean.
            style={{ transform: mv.rings[i].labelT, opacity: mv.rings[i].labelOp, filter: mv.rings[i].blurF }}
          >
            <svg className="sj-label-leader" viewBox="0 0 30 28" fill="none">
              <line x1="1" y1="1" x2="24" y2="22" stroke={`rgba(${palette.rgb},0.55)`} strokeWidth="1" />
              <circle cx="1" cy="1" r="1.4" fill={`rgba(${palette.rgb},0.85)`} />
            </svg>
            <div className="sj-label-pill">
              <span className="sj-label-dot" style={{ background: color }} />
              <span className="sj-label-text font-mono">{stop ? T(stop.label, stop.labelEn ?? stop.label, lang) : ''}</span>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
    </div>
  );
}

// ─── The core overlay — the accounts are BORN from the symbol ────────────────
// Fundador 2026-09-20, segunda vuelta: «sacamos las órbitas y cada enumerador
// aparece desde el símbolo de Astryum; va a quedar más limpio y se va a
// entender que es el core». La primera versión dibujaba cinco anillos de
// trazos alrededor del astro: en un sistema SOLAR un anillo se lee como otra
// órbita más, y la tesis —esto es el centro y lo demás cuelga de él— se perdía
// entre círculos.
//
// Ahora no hay anillos. Del símbolo salen cinco BROTES: un rayo que nace en su
// superficie y crece hacia fuera, un nodo en la punta y, colgando de él, el
// nombre de la cuenta en grande con su regla debajo. Se abren en abanico por
// el lado contrario al panel de texto y aparecen uno tras otro, de arriba
// abajo, todos desde el mismo sitio: el centro.
//
// Viven en el espacio de PANTALLA —fuera de la cámara 3D, como los rótulos del
// recorrido— así que nada aquí es una textura estirada. Siguen al astro
// (coreT), escalan con él (coreR) y su vida es la mezcla de la parada
// (coreOp). Nombres y reglas son la misma MAQUETA que lista CoreArtifact.
const CORE_SHOOTS = [
  // ang = hacia dónde brota (grados de pantalla, y hacia abajo) · k = hasta
  // dónde llega, en radios del astro. El abanico es simétrico y se abre por la
  // DERECHA: el hemisferio izquierdo es de las estelas del símbolo y, más
  // allá, del panel de texto. 25° entre brotes dan ~0,93 radios de aire entre
  // rótulos: caben dos líneas de regla sin tocarse.
  { ang: -50, k: 2.45, es: 'Matrimonio', en: 'Marriage', esR: 'Dos firmas, una cuenta', enR: 'Two signatures, one account', esN: '2 de 2', enN: '2 of 2' },
  { ang: -25, k: 2.2, es: 'Hijos', en: 'Children', esR: 'Firman los padres', enR: 'The parents sign', esN: '2 de 3', enN: '2 of 3' },
  { ang: 0, k: 2.05, es: 'Fundación', en: 'Foundation', esR: 'Decide un consejo', enR: 'A council decides', esN: '3 de 5', enN: '3 of 5' },
  { ang: 25, k: 2.2, es: 'Empresa', en: 'Business', esR: 'Firma el órgano', enR: 'The body signs', esN: '2 de 4', enN: '2 of 4' },
  { ang: 50, k: 2.45, es: 'Legado', en: 'Legacy', esR: 'El relevo, ya escrito', enR: 'The handover, already written', esN: '3 de 5', enN: '3 of 5' },
] as const;

/** El rayo nace EN el borde del símbolo (la roca dibujada mide ~0,78 radios
 *  de `coreR`): a 1,1 quedaba un hueco de 30px y los brotes parecían señalar
 *  al símbolo en vez de salir de él. */
const SHOOT_FROM = 0.86;
/** A qué fracción del ancho de la ventana aparca la cámara el núcleo en
 *  escritorio (buildCamera, parada con `dock: 'right'`). El rótulo la necesita
 *  para saber cuánto sitio le queda hasta el borde derecho. */
const CORE_DOCK_X = 0.66;

function CoreOverlay({
  lang,
  palette,
  coreT,
  coreR,
  coreOp,
}: {
  lang: Lang;
  palette: Palette;
  coreT: MotionValue<string>;
  coreR: MotionValue<number>;
  coreOp: MotionValue<number>;
}) {
  // El rótulo del propio núcleo: debajo del símbolo, lo primero que aparece.
  const capY = useTransform(coreR, (r) => r * 1.32);
  const capOp = useTransform(coreOp, [0.05, 0.3], [0, 1], { clamp: true });
  return (
    <motion.div className="sj-label" style={{ transform: coreT, opacity: coreOp }}>
      {CORE_SHOOTS.map((shoot, i) => (
        <CoreShoot key={shoot.en} shoot={shoot} i={i} lang={lang} palette={palette} coreR={coreR} coreOp={coreOp} />
      ))}
      <motion.span className="absolute" style={{ x: 0, y: capY, opacity: capOp }}>
        <span
          className="absolute whitespace-nowrap text-center"
          style={{ left: 0, top: 0, width: 'max-content', transform: 'translate(-50%, 0)', textShadow: '0 1px 14px rgba(0,0,0,0.95)' }}
        >
          <span className="block font-mono" style={{ fontSize: 10, letterSpacing: '0.22em', textTransform: 'uppercase', color: palette.soft }}>
            {T('El núcleo', 'The core', lang)}
          </span>
          <span className="block" style={{ marginTop: 3, fontSize: 12.5, color: 'rgba(255,255,255,0.78)' }}>
            {T('tu wallet · tu cuenta', 'your wallet · your account', lang)}
          </span>
        </span>
      </motion.span>
    </motion.div>
  );
}

function CoreShoot({
  shoot,
  i,
  lang,
  palette,
  coreR,
  coreOp,
}: {
  shoot: (typeof CORE_SHOOTS)[number];
  i: number;
  lang: Lang;
  palette: Palette;
  coreR: MotionValue<number>;
  coreOp: MotionValue<number>;
}) {
  const rad = (shoot.ang * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Cada brote sale un tiempo después del anterior. `grow` es la misma cuenta
  // pasada por un ease-out: arranca con fuerza desde el símbolo y se posa.
  const own = useTransform(coreOp, [0.12 + i * 0.13, 0.5 + i * 0.13], [0, 1], { clamp: true });
  const grow = useTransform(own, (o) => 1 - Math.pow(1 - o, 3));
  // Hasta dónde ha llegado la punta, en radios: de la superficie a `k`.
  const reach = useTransform(grow, (g) => SHOOT_FROM + (shoot.k - SHOOT_FROM) * g);
  const rayLen = useTransform([coreR, reach], ([r, k]: number[]) => Math.max(0, (k - SHOOT_FROM) * r));
  const rayX = useTransform(coreR, (r) => SHOOT_FROM * r * cos);
  const rayY = useTransform(coreR, (r) => SHOOT_FROM * r * sin);
  const tipX = useTransform([coreR, reach], ([r, k]: number[]) => k * r * cos);
  const tipY = useTransform([coreR, reach], ([r, k]: number[]) => k * r * sin);
  // El texto entra cuando el rayo ya casi ha llegado: primero el gesto, luego
  // la palabra.
  const textOp = useTransform(own, [0.5, 1], [0, 1], { clamp: true });
  // Cuánto ancho le queda al rótulo hasta el borde derecho de la ventana. El
  // nombre nunca parte; la regla, si hace falta, baja a una segunda línea (a
  // 1024px el brote horizontal solo tiene ~145px).
  const room = useTransform(coreR, (r) => {
    const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
    return Math.max(132, Math.min(300, (1 - CORE_DOCK_X) * vw - shoot.k * r * Math.abs(cos) - 40));
  });
  // Empresa viste su bronce, como en el resto de la landing; las demás, el
  // acento del mundo.
  const tone = i === 3 ? 'hsl(var(--product-institutional))' : palette.soft;
  return (
    <>
      {/* EL RAYO: transparente donde nace, encendido en la punta — luz que
          sale del símbolo, no una línea que llega a él. */}
      <motion.span
        className="absolute"
        style={{
          left: rayX,
          top: rayY,
          width: rayLen,
          height: 1,
          rotate: shoot.ang,
          originX: 0,
          originY: 0.5,
          opacity: own,
          background: `linear-gradient(90deg, rgba(${palette.rgb},0.22), rgba(${palette.rgb},0.85))`,
        }}
      />
      <motion.span className="absolute" style={{ x: tipX, y: tipY, opacity: own }}>
        {/* EL NODO: un rombo, no un punto — los puntos ya son los planetas. */}
        <span
          className="absolute"
          style={{ width: 7, height: 7, left: -3.5, top: -3.5, transform: 'rotate(45deg)', background: tone, boxShadow: `0 0 10px rgba(${palette.rgb},0.9)` }}
        />
        {/* width: max-content — el padre mide CERO de ancho (es un punto en la
            pantalla), y un bloque absoluto dentro de un ancho cero se encoge a
            su palabra más larga: la regla salía partida palabra a palabra. */}
        <motion.span
          className="absolute text-left"
          style={{ left: 0, top: 0, width: 'max-content', transform: 'translate(16px, -50%)', opacity: textOp, textShadow: '0 1px 14px rgba(0,0,0,0.95)' }}
        >
          <span className="block whitespace-nowrap text-white" style={{ fontSize: 20, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {T(shoot.es, shoot.en, lang)}
          </span>
          <motion.span
            className="block font-mono"
            style={{ marginTop: 5, maxWidth: room, fontSize: 10, lineHeight: 1.45, letterSpacing: '0.13em', textTransform: 'uppercase', color: tone }}
          >
            <span className="whitespace-nowrap">{T(shoot.esR, shoot.enR, lang)}</span>{' '}
            <span className="whitespace-nowrap" style={{ color: 'rgba(255,255,255,0.9)' }}>
              {T(shoot.esN, shoot.enN, lang)}
            </span>
          </motion.span>
        </motion.span>
      </motion.span>
    </>
  );
}

// ─── Takeoff kicker — the tour announces itself ──────────────────────────────
function TakeoffKicker({ progress, lang, product, palette }: { progress: MotionValue<number>; lang: Lang; product: Product; palette: Palette }) {
  const opacity = useTransform(progress, [0.105, 0.13, 0.17, 0.2], [0, 1, 1, 0]);
  const y = useTransform(progress, [0.105, 0.13], [18, 0]);
  return (
    <motion.div aria-hidden className="absolute inset-x-0 top-[15svh] z-30 text-center px-6 pointer-events-none" style={{ opacity, y }}>
      <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: palette.soft }}>
        {/* "piezas", never "instrumentos" — GLOSSARY §2 */}
        {product === 'legacy'
          ? T('El recorrido · Astryum Legacy', 'The tour · Astryum Legacy', lang)
          : product === 'self'
            ? T('El recorrido · Aplicado a ti', 'The tour · Applied to you', lang)
            : T('El recorrido · Seis piezas', 'The tour · Six pieces', lang)}
      </div>
      <p className="mt-3 text-white/55 text-sm md:text-base max-w-md mx-auto">
        {product === 'legacy'
          ? T(
              'El mismo puesto de mando, para capital gobernado por un consejo. En validación en mainnet — abre pronto.',
              'The same mission control, for council-governed capital. Validating on mainnet — opening soon.',
              lang,
            )
          : product === 'self'
            ? T('Lo que has visto en la portada, en tu propia wallet. Tú firmas, siempre.', 'What you saw on the front page, in your own wallet. You sign, always.', lang)
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
          {stop.num} · {T(stop.label, stop.labelEn ?? stop.label, lang)}
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
  const opacity = useTransform(progress, [0.89, 0.94], [0, 1]);
  const y = useTransform(progress, [0.89, 0.94], [26, 0]);
  return (
    <motion.div
      inert={!active}
      aria-hidden={!active}
      // max(8svh, 118px): the scroll cue is a 74px circle parked 28px off the
      // bottom edge, fixed and z-60. At 8svh alone the CTA sat INSIDE that band
      // on any screen shorter than ~1275px and the cue covered its lower half
      // (measured 2026-09-20: the button's centre was not clickable).
      className="absolute inset-x-0 bottom-[max(8svh,118px)] z-30 flex flex-col items-center text-center px-6"
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

// JourneyCue RETIRED (user test 2026-08-03): the in-stage cue died at 5% of the
// track, only existed ≥md, and first-time visitors never noticed it. Its job
// moved to the page-level PersistentScrollCue in LandingPage.tsx — bigger,
// capsule-backed, alive through the whole scroll. Recover from git history if
// an in-stage cue is ever wanted again.

// ─── Static fallback (<lg twin + prefers-reduced-motion) ─────────────────────
// No track, no sticky, no scrub: the hero at its resting pose followed by the
// four stops stacked as plain sections — the repo's "every effect degrades to
// a static end-state" rule.
function StaticScene({ lang, palette }: { lang: Lang; palette: Palette }) {
  const es = lang === 'es';
  return (
    <div className="solar-scene-j" style={{ ['--ja' as never]: palette.rgb }} aria-hidden>
      <style>{SCENE_CSS}</style>
      {/* El latido del móvil (2026-08-26): en el viaje anclado los planetas se
          mueven con el scroll; aquí están aparcados y la escena quedaba
          congelada. Se anima SOLO la opacidad de la capa de brillo — cero
          transforms nuevas: la cadena rotateX/counter-rotate de esta escena es
          la fuente nº1 de jank en Safari y no se toca. Apagado bajo PRM. */}
      <style>{`
        @keyframes sjsBreathe { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        .sjs-glow { animation: sjsBreathe 5.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .sjs-glow { animation: none; } }
      `}</style>
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
                      className="sjs-glow absolute rounded-full"
                      style={{
                        width: p.sz,
                        height: p.sz,
                        top: -p.sz / 2,
                        left: -p.sz / 2,
                        boxShadow: `0 0 12px ${color}, 0 0 28px ${palette.glowSecondary}`,
                        // Desfase y tempo por planeta (por índice — nth-child
                        // no sirve aquí: cada brillo vive en su propio
                        // subárbol): que no respiren a coro.
                        animationDelay: `${(i % 3) * 1.1}s`,
                        animationDuration: `${5.2 + (i % 2) * 1.2}s`,
                      }}
                    />
                    <LeaderLine rgb={palette.rgb} />
                    {/* PILL_TOUR, not PILL_HERO: this variant IS the phone
                        render, and blur under the rotateX chain is Safari's
                        jank source #1 (see the pill-finish note above) */}
                    <div className="sj-pill flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap" style={PILL_TOUR}>
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
        <img src={palette.hero} alt="" style={{ width: '100%', height: 'auto', display: 'block' }} />
      </div>
    </div>
  );
}

function StaticPlanetBadge({ planet, palette }: { planet: number; palette: Palette }) {
  if (planet < 0) {
    // the core: the star itself, small
    return (
      <div aria-hidden className="relative shrink-0" style={{ width: 76, height: 76 }}>
        <div className="absolute inset-2 rounded-full" style={{ border: `1px dashed rgba(${palette.rgb},0.35)` }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={palette.hero} alt="" style={{ position: 'absolute', width: 92, height: 'auto', left: -8, top: 8, display: 'block' }} />
      </div>
    );
  }
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
/**
 * StaticStop — una parada del viaje en su variante apilada (móvil y PRM del
 * escritorio), CON VIDA (fundador 2026-08-26: «la landing se ve sin ningún
 * tipo de animación en el móvil»). La variante apilada nació honesta pero
 * MUERTA: divs planos y todos los artefactos con active=false — cero
 * animación en todos los teléfonos.
 *
 * Dos gestos, los dos ya del idioma de la casa:
 *  · La parada ENTRA al hacer scroll — el mismo Reveal que usa el resto de la
 *    landing (whileInView, una vez, respeta prefers-reduced-motion).
 *  · El artefacto VIVE MIENTRAS ESTÁ A LA VISTA: `useInView` enciende su
 *    `active` — las mismas órbitas y pulsos que juegan en el viaje anclado — y
 *    lo apaga al salir de pantalla, que en un móvil es también batería. Bajo
 *    PRM los propios artefactos ya se congelan (.ja-anim → animation:none).
 */
function StaticStop({ stop: s, lang, palette, idPrefix }: { stop: Stop; lang: Lang; palette: Palette; idPrefix: string }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { margin: '-15% 0px -15% 0px' });
  return (
    <section ref={ref} id={`${idPrefix}stop-${s.id}`} className="relative py-14 md:py-20 px-6 md:px-10 lg:px-16 scroll-mt-32 overflow-hidden">
      <div className="max-w-3xl mx-auto flex flex-col sm:flex-row gap-7 items-start">
        <Reveal y={18}>
          <StaticPlanetBadge planet={s.planet} palette={palette} />
        </Reveal>
        <div>
          <Reveal y={22}>
            <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: palette.soft }}>
              {s.num} · {T(s.label, s.labelEn ?? s.label, lang)}
            </div>
            <h2 className="mt-3 font-bold text-white" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.2rem)', lineHeight: 1.1, letterSpacing: '-0.025em' }}>
              {T(s.esH, s.enH, lang)}
            </h2>
            <p className="mt-3 text-white/60 leading-relaxed text-[15px] max-w-md">{T(s.esB, s.enB, lang)}</p>
          </Reveal>
          <Reveal y={22} delay={0.12}>
            <StopPoints stop={s} lang={lang} accent={palette.accent} />
            <div className="mt-5">
              <s.Artifact lang={lang} active={inView} accent={palette.accent} soft={palette.soft} rgb={palette.rgb} />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function StaticJourney({
  lang,
  hero,
  finaleCta,
  idPrefix = '',
  product,
  setProduct,
  palette,
  stops,
  switcher,
}: {
  lang: Lang;
  hero: ReactNode;
  finaleCta: ReactNode;
  idPrefix?: string;
  product: Product;
  setProduct: (p: Product) => void;
  palette: Palette;
  stops: Stop[];
  /** El conmutador de la página; sin él, el de dos opciones de siempre. */
  switcher?: ReactNode;
}) {
  return (
    <>
      <section id={`${idPrefix}journey`} className="relative min-h-[94svh] flex items-center px-6 md:px-10 lg:px-16 pt-36 md:pt-32 pb-20 overflow-hidden scroll-mt-32">
        <div className="w-full">
          {/* In flow, NOT absolute at top-[140px] (that offset was tuned for
              the pinned lg stage, where the switch floats over empty space):
              here the stacked hero top-aligns at the padding line and the
              pinned pill painted straight over the status badge — with the
              Legacy notice wrapping to three lines on top of the H1. */}
          <div className="mb-10 flex justify-center relative z-30">
            {switcher ?? <ProductSwitch product={product} setProduct={setProduct} lang={lang} />}
          </div>
          {/* La entrada del héroe (2026-08-26): el mismo Reveal del resto de la
              landing — el escritorio la tenía por las transforms del escenario
              anclado, y esta variante llegaba clavada de golpe. */}
          <div className="max-w-6xl mx-auto w-full grid lg:grid-cols-[1.15fr,0.85fr] gap-12 lg:gap-16 items-center relative z-10">
            <Reveal y={26}>{hero}</Reveal>
            <Reveal y={18} delay={0.15} className="flex justify-center">
              <StaticScene lang={lang} palette={palette} />
            </Reveal>
          </div>
        </div>
      </section>
      <div key={product}>
        {/* Stop sections: overflow-hidden because the planet badge's decorative
            dark halo paints ~78px past its own box — off the left viewport edge
            on phones — and iOS 15 doesn't support the root's overflow-x:clip
            backstop. scroll-mt-32: the fixed banner+header stack is ~124px. */}
        {stops.map((s) => (
          <StaticStop key={s.id} stop={s} lang={lang} palette={palette} idPrefix={idPrefix} />
        ))}
        <section className="relative py-16 md:py-24 px-6 text-center">
          {/* Same close as the pinned finale: the Astryum principle, not a
              repeat of the hero headline (founder 2026-07-25). */}
          <Reveal y={24}>
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
          </Reveal>
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
  switcher,
}: {
  lang: Lang;
  hero: ReactNode;
  finaleCta: ReactNode;
  // Controlled from LandingPage: the product also re-themes the whole page
  // (data-authority='governed' on the landing root), not just the journey.
  product: Product;
  onProductChange: (p: Product) => void;
  /** EL CONMUTADOR LO MONTA LA PÁGINA (2026-09-18). Vivía aquí dentro con dos
   *  opciones y el oro clavado a hueso; con tres mundos, cada uno con su
   *  escena, el botón no puede ser de uno de ellos. Se recibe ya pintado para
   *  que este viaje no tenga que saber cuántos productos existen. */
  switcher?: ReactNode;
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
    else if (p < 0.2) next = 'takeoff';
    else if (p >= 0.89) next = 'finale';
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
          switcher={switcher}
        />
      </div>
      {/* 1180svh (was 920 for four stops): six stops keep the same ~140svh of
          runway each, so a trackpad flick still covers one beat, not three */}
      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[1180svh]">
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

          {/* hero-frame only (founder 2026-07-22): fades on takeoff, returns at
              the top. Sits at 104px — clear of the fixed header's hit area,
              which was swallowing clicks on the pill's upper half. */}
          <motion.div
            className="absolute top-[140px] left-1/2 -translate-x-1/2 z-40"
            style={{ opacity: switchOpacity, visibility: switchVisibility, pointerEvents: phase === 'hero' ? 'auto' : 'none' }}
          >
            {switcher ?? <ProductSwitch product={product} setProduct={onProductChange} lang={lang} />}
          </motion.div>
        </div>
      </section>
    </>
  );
}

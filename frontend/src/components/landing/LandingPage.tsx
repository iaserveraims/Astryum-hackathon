'use client';

/**
 * Astryum — Landing V2 (two-layer thesis: XRPL governs / Flare produces; bilingual ES/EN).
 *
 * Brand: warm gold (#C9A227) on deep space. Asteroid logo, navigation metaphor.
 * Tagline: "Tu capital. Tu control. Tu firma." / "Your capital. Your control. Your signature."
 *
 * V2 raises the motion floor to a sui.io register: a mouse-reactive 3D hero over a
 * living star field, a kinetic mask-reveal headline, scroll-parallaxed sections, an
 * animated stats band, a scrollytelling narrative with a morphing instrument panel,
 * an interactive Flare console rack, and a scroll-linked light "signature break".
 * Every effect degrades cleanly under prefers-reduced-motion and uses motion values
 * (never React state) for continuous pointer/scroll input.
 *
 * V2.1 is the clarity pass: the scroll-scrubbed manifesto became a plain-words
 * "how it works" trio (connect → observe → sign), the visible act breaks went from
 * three to one, and the walkthrough tightened from six chapters to five (Flight
 * Rules folded into Flight Plan). Every section states in concrete terms what
 * Astryum does; the register stays.
 *
 * V3 is the Solar Journey (SHOW_JOURNEY, ./SolarJourney.tsx): the hero's solar
 * system becomes a scroll-driven tour through the four dashboard sections
 * (Summary · Earn · Portfolio · Wallets), replacing HowItWorks/Pillars/Narrative
 * and trimming the intermediate CTAs down to hero + header + one closing door.
 *
 * Non-custodial invariant lives in the copy: Astryum never signs, never custodies,
 * never executes with discretion. The user always signs.
 *
 * The six gold CTAs open the beta itself (/login) since 2026-08-05. That door is
 * ALSO the one the server-side access gate guards (middleware.ts): with
 * ACCESS_GATE_OPEN unset the gate is 'enforced' and every visitor without the
 * signed cookie is turned away — GateNotice below is what tells them so. The
 * hidden admin door (5 clicks on the logo within 1.5s, or Ctrl+Shift+L) opens
 * the access-code modal that mints that cookie.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useMotionValueEvent, useScroll, useSpring, useTransform, useVelocity, type MotionValue } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import dynamic from 'next/dynamic';
import { ChapterArtifact, type ArtifactKind } from './ChapterArtifacts';
import {
  BORDER,
  BORDER_FAINT,
  BORDER_STRONG,
  CountUp,
  EASE,
  GOLD,
  Magnetic,
  MaskLines,
  Reveal,
  ScrollRevealText,
  SpotlightCard,
  usePointerParallax,
} from './interactions';
import SolarJourney, { SOLAR_LEGS, type JourneyProduct } from './SolarJourney';
import LegacyJourney from './LegacyJourney';
import InstitutionalJourney from './InstitutionalJourney';
import InstitutionalBreak from './InstitutionalBreak';
import LegacyBreak from './LegacyBreak';
import { ProductSwitch } from './ProductSwitch';
import { isLandingProduct, visibleProducts, type LandingProduct } from './products';
// LOS CUATRO A LOS MANDOS (fundador 2026-09-19): una portada con el selector
// de quién gobierna y un mundo por gobernador, cada uno con los mismos efectos
// que esta landing — el campo de estrellas, el viaje por scroll, el cierre
// con luz y el pase. Cerrado en producción hasta que un commit lo publique
// (lib/nav/mandosLanding.ts).
import EmpresaJourney from './EmpresaJourney';
import ExchangeJourney from './ExchangeJourney';
import AgenteJourney from './AgenteJourney';
import VenueJourney from './VenueJourney';
import { MandosSection } from './MandosSection';
import { InstrumentsSection } from './InstrumentsSection';
import { GOVERNORS, GOVERNOR_BY_ID, VENUE_PASS, type GovernorId, type GovernorPass } from './governors';
import { WORLD_ROUTES, type LandingWorld } from '../../lib/nav/mandosLanding';
import AuthorityCrossing from '../authority/AuthorityCrossing';
import { BANNER_H, HackathonBanner, HackathonFooterList } from './HackathonNotice';

// Canvas star field is client-only (uses canvas + rAF).
const StarfieldCanvas = dynamic(() => import('./StarfieldCanvas'), { ssr: false });
// The hidden-door password modal only renders behind the 5-click / Ctrl+Shift+L
// gate — keep it (and its router hook) out of the landing's main bundle.
const LoginModal = dynamic(() => import('../access/LoginModal'), { ssr: false });

// ─── Brand constants ──────────────────────────────────────────────────────────────
// The landing's accent rides the SAME tokens as the dashboard (--volt family):
// flipping data-authority='governed' on the landing root re-tints the whole
// page to Legacy indigo, exactly like the app does.
const GOLD_SOFT = 'hsl(var(--volt-soft, 45 75% 62%))';
// The boarding desk: email capture (POST /api/waitlist) + mission socials.
// Replaces the provisional mailto — the mailto survives inside /early-access
// as the fallback when the relay (backend) is down.
// INERT since 2026-08-07 (founder: "NO URL ASTRYUM EARLY ACCESS"): nothing on
// the beta path may divert to the seat list. Kept — the page still reaches
// /early-access through DEMO_URL below, which is the demo waitlist, not the
// beta door.
export const EARLY_ACCESS_URL = '/early-access';
// The gold CTAs open the BETA itself (founder 2026-08-04: registration is
// open — BETA_REGISTRATION_OPEN=true — so the door is /login, not the
// waitlist).
const BETA_URL = '/login';
// The demo door also boards through the manifest (?intent=demo adapts the copy).
// Judges enter the real app through the hidden admin door (logo ×5 / Ctrl+Shift+L).
const DEMO_URL = '/early-access?intent=demo';
// Permanent Discord invite (no expiry, no use limit) — the ONLY official invite;
// X and the server itself point back here, so a changed link must change everywhere.
const DISCORD_URL = 'https://discord.gg/veXZr7a3hJ';
// Feature flag — the XRPL governance act (rack + FAssets bridge + two-layer frame
// copy in nav/hero/stats/boarding-pass). Founder call 2026-07-14: keep it HIDDEN
// until the Legacy flows are further developed. Flip to true to bring the whole
// act back in one move; false renders the exact pre-act landing.
const SHOW_XRPL_ACT: boolean = false;
// Feature flag — the Solar Journey (./SolarJourney.tsx): the hero's solar system
// grows on scroll into a guided tour of the four dashboard sections, replacing
// HowItWorks/Pillars/Narrative and the intermediate CTAs. Flip to false to render
// the exact pre-journey landing in one move.
const SHOW_JOURNEY: boolean = true;
// The proof band (StatsBand + ActBreak + FlareFeatures) between the journey
// and the light close. Cut 2026-07-22 (founder: the page still read long, and
// the journey already tells the product story) — flip to true to bring the
// three sections back in one move. Ignored when SHOW_JOURNEY is off.
const SHOW_PROOF_SECTIONS: boolean = false;
const DOCS_BASE = 'https://astryum.gitbook.io/astryum'; // DocsSection links here — 404s until the GitBook space is published
const LOGO_MARK = '/astryum-asteroid.png'; // asteroid + wordmark (no tagline) → header
const LOGO_ICON = '/astryum-logo-mark.png'; // mark only → small accents (signature break)
const LOGO_HERO = '/astryum_logo-nobackground.png'; // big glowing asteroid → solar-system sun

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

// ─── Persistent language ────────────────────────────────────────────────────────────
function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => {
    try {
      const s = localStorage.getItem('astryum:lang');
      if (s === 'en' || s === 'es') {
        setLang(s);
        return;
      }
      // No saved choice → follow the browser's configured language.
      const nav = (navigator.language || navigator.languages?.[0] || '').toLowerCase();
      if (nav.startsWith('es')) setLang('es');
    } catch {
      /* ignore */
    }
  }, []);
  const set = useCallback((l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem('astryum:lang', l);
    } catch {
      /* ignore */
    }
  }, []);
  return [lang, set];
}

// ─── Space backdrop (gradients + pointer-parallaxed auras + canvas) ──────────────────
// The perspective grid was removed: the star field now carries the depth, and dropping
// a full-viewport pointer-parallaxed dual-gradient layer is a free performance win.
function SpaceBackdrop({ legacy, institutional = false, accent }: { legacy: boolean; institutional?: boolean; accent?: string }) {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      {/* deep-space base — warmer than pure black so the accent reads. The
          governed variant sits stacked on top and crossfades (gradients can't
          transition), so the product switch re-colors the sky progressively. */}
      <div className="absolute inset-0 lp-base" />
      <div className="absolute inset-0 lp-base-governed lp-fade-layer" style={{ opacity: legacy ? 1 : 0 }} />
      {/* high-contrast horizon glow under the header — same crossfade pair */}
      <div className="absolute inset-x-0 top-0 h-[60vh] lp-horizon lp-fade-layer" style={{ opacity: legacy ? 0 : 1 }} />
      <div className="absolute inset-x-0 top-0 h-[60vh] lp-horizon-governed lp-fade-layer" style={{ opacity: legacy ? 1 : 0 }} />
      {/* NO NEBULA. The morpho.org shader cloud lived here for two days
          (NebulaCanvas, 36fe3d3 → 4b6b254) and came out on the founder's
          verdict, 2026-08-22: "molesta más que suma". Cleaning it up did not
          save it — a slow-breathing haze over a page you scroll for a full
          tour is movement competing with the content, and the sky already has
          movement that earns its keep (the stars below). The gradients above
          carry the atmosphere. It is in git if it is ever wanted back. */}
      {/* El mundo institucional NO tiene cielo. Su capa es el papel: un
          lavado plano de su bronce y una viñeta, y CERO estrellas — no por
          ahorro, sino porque un campo de estrellas es la firma del mundo del
          que este producto sale a propósito. */}
      <div className="absolute inset-0 lp-base-institutional lp-fade-layer" style={{ opacity: institutional ? 1 : 0 }} />
      <div className="absolute inset-x-0 top-0 h-[60vh] lp-horizon-institutional lp-fade-layer" style={{ opacity: institutional ? 1 : 0 }} />
      {/* living star / asteroid field — constellation lines follow the theme */}
      {!institutional && <StarfieldCanvas accent={accent ?? (legacy ? '130,141,248' : '201,162,39')} />}
      {/* fine grain for premium texture — plain overlay (no blend mode) so the GPU
          composites it once instead of re-blending the whole viewport every frame
          over the animating star canvas underneath */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0.045,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: '160px 160px',
        }}
      />
    </div>
  );
}

// ─── Asteroid glyph (inline, decorative) ────────────────────────────────────────────
function AsteroidGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.5c2.2-.3 4.4.6 5.9 2.3 1.7 1.9 2.2 4.6 1.2 7-.8 1.9-2.5 3.4-4.5 3.9-2.5.7-5.2-.1-6.9-2-1.6-1.7-2.2-4.2-1.4-6.4.8-2.3 3-4.4 5.7-4.8z"
        fill="#0a0a0a"
        stroke={GOLD}
        strokeWidth="1.4"
      />
      <circle cx="10" cy="9.5" r="1.5" fill={GOLD} opacity="0.7" />
      <circle cx="14.5" cy="13" r="1" fill={GOLD} opacity="0.5" />
      <circle cx="9.5" cy="14" r="0.7" fill={GOLD} opacity="0.5" />
    </svg>
  );
}

// ─── Solar system (hero centerpiece) — pointer-tilted 3D orbits; planets = principles ─
// Each name is WELDED to its planet: the anchor rides the spinning ring, a
// counter-spin (same period, same negative delay) cancels the rotation so the
// content keeps a fixed orientation, and a final rotateX(-60deg) undoes the
// orbital-plane tilt so the label + leader line face the camera. The whole
// chain lives under the pointer-parallax wrapper, so mouse tilt moves planets
// and labels together — nothing drifts loose.
function SolarSystem({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const { x, y, reduce } = usePointerParallax(50, 16);
  const rotY = useTransform(x, [-0.5, 0.5], [16, -16]);
  const rotX = useTransform(y, [-0.5, 0.5], [-12, 12]);

  // Outer → inner. Each orbit carries a glowing planet = one basic principle.
  // `phase` spreads the starting angles; it feeds both the resting transform
  // (reduced-motion pose) and the negative animation-delay (animated pose).
  const planets = [
    { ring: 100, dur: 34, rev: false, sz: 17, color: '#E8C25A', es: 'Protege', en: 'Protect', phase: 205 },
    { ring: 70, dur: 22, rev: true, sz: 13, color: GOLD, es: 'Genera', en: 'Earn', phase: 95 },
    { ring: 44, dur: 14, rev: false, sz: 10, color: '#F2D27A', es: 'Posee', en: 'Own', phase: 325 },
  ];

  return (
    <motion.div
      style={{
        perspective: 1000,
        rotateX: reduce ? 0 : rotX,
        rotateY: reduce ? 0 : rotY,
        transformStyle: 'preserve-3d',
      }}
    >
      <div className="solar-scene" aria-hidden>
        <style>{`
          @keyframes solarSpin { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(360deg); } }
          @keyframes solarSpinRev { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(-360deg); } }
          @keyframes solarCounter { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
          @keyframes solarCounterRev { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes solarFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
          .solar-scene { position: relative; width: clamp(300px, 38vw, 480px); max-width: 100%; aspect-ratio: 1/1; animation: solarFloat 7s ease-in-out infinite; transform-style: preserve-3d; }
          .solar-stage { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(60deg); }
          .solar-ring { position: absolute; top: 50%; left: 50%; border-radius: 50%; border: 1px solid hsl(var(--volt) / 0.22); box-shadow: 0 0 24px hsl(var(--volt) / 0.07) inset; transform-style: preserve-3d; }
          .solar-anchor { position: absolute; top: 0; left: 50%; transform: translate(-50%,-50%); transform-style: preserve-3d; }
          .solar-counter { transform-style: preserve-3d; }
          .solar-flat { position: relative; width: 0; height: 0; transform: rotateX(-60deg); transform-style: preserve-3d; }
          @media (prefers-reduced-motion: reduce) { .solar-scene, .solar-ring, .solar-counter { animation: none !important; } }
        `}</style>

        {/* tilted orbital plane — rings, planets and their welded labels */}
        <div className="solar-stage">
          {planets.map((p) => {
            const delay = `-${((p.phase / 360) * p.dur).toFixed(2)}s`;
            return (
              <div
                key={p.en}
                className="solar-ring"
                style={{
                  width: `${p.ring}%`,
                  height: `${p.ring}%`,
                  transform: `translate(-50%,-50%) rotate(${p.phase}deg)`,
                  animation: `${p.rev ? 'solarSpinRev' : 'solarSpin'} ${p.dur}s linear infinite`,
                  animationDelay: delay,
                }}
              >
                <div className="solar-anchor">
                  <div
                    className="solar-counter"
                    style={{
                      transform: `rotate(${-p.phase}deg)`,
                      animation: `${p.rev ? 'solarCounterRev' : 'solarCounter'} ${p.dur}s linear infinite`,
                      animationDelay: delay,
                    }}
                  >
                    <div className="solar-flat">
                      {/* the planet, centred on the anchor */}
                      <span
                        className="absolute rounded-full"
                        style={{
                          width: p.sz,
                          height: p.sz,
                          top: -p.sz / 2,
                          left: -p.sz / 2,
                          background: `radial-gradient(circle at 35% 30%, #fff, ${p.color} 46%, #4a3608 100%)`,
                          boxShadow: `0 0 12px ${p.color}, 0 0 28px hsl(var(--volt) / 0.45)`,
                        }}
                      />
                      {/* leader line — a plain hairline (no arrowhead) from planet to name */}
                      <svg
                        width="30"
                        height="28"
                        viewBox="0 0 30 28"
                        fill="none"
                        style={{ position: 'absolute', top: 3, left: 3, overflow: 'visible' }}
                      >
                        <line x1="1" y1="1" x2="24" y2="22" stroke="hsl(var(--volt) / 0.55)" strokeWidth="1" />
                        <circle cx="1" cy="1" r="1.4" fill="hsl(var(--volt) / 0.85)" />
                      </svg>
                      {/* the name, anchored at the end of the line */}
                      <div
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap"
                        style={{
                          position: 'absolute',
                          top: 25,
                          left: 27,
                          transform: 'translateY(-50%)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(10,10,10,0.78)',
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.color }} />
                        <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/85">{es ? p.es : p.en}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Astryum — the star this system orbits. The glow is baked into the
            asset; planets pass in front on the near side of the orbit and
            behind on the far side, which is exactly the depth we want. */}
        <div className="absolute" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 2, width: '54%' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_HERO} alt="Astryum" style={{ width: '100%', height: 'auto', display: 'block' }} />
        </div>
      </div>
    </motion.div>
  );
}

// ─── Language toggle ────────────────────────────────────────────────────────────────
function LangToggle({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-full"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.03)' }}
    >
      {(['es', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          // taller below sm — on a phone this is one of only three header
          // controls and 28px was under the touch minimum
          className="px-3 py-2.5 sm:py-1.5 rounded-full text-xs font-medium transition-all uppercase"
          style={{ background: lang === l ? GOLD : 'transparent', color: lang === l ? '#000' : 'rgba(255,255,255,0.4)' }}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ─── Explanation-depth toggle (Expert ⇄ Simple) ──────────────────────────────────────
// Mirrors LangToggle. Swaps the walkthrough copy + artifact captions for plain-language
// versions so newcomers can follow along. Section-level UI state (not persisted). `size`
// shrinks it for the sticky console header; the full size sits in the section header.
function ModeToggle({
  simple,
  setSimple,
  lang,
  size = 'md',
}: {
  simple: boolean;
  setSimple: (s: boolean) => void;
  lang: Lang;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[10px]' : 'px-3.5 py-1.5 text-xs';
  const opts: [boolean, string][] = [
    [false, T('Experto', 'Expert', lang)],
    [true, T('Simple', 'Simple', lang)],
  ];
  return (
    <div
      role="group"
      aria-label={T('Nivel de explicación', 'Explanation level', lang)}
      className="inline-flex items-center gap-0.5 p-0.5 rounded-full"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.03)' }}
    >
      {opts.map(([val, txt]) => (
        <button
          key={String(val)}
          onClick={() => setSimple(val)}
          aria-pressed={simple === val}
          className={`rounded-full font-medium transition-all ${pad}`}
          style={{ background: simple === val ? GOLD : 'transparent', color: simple === val ? '#000' : 'rgba(255,255,255,0.45)' }}
        >
          {txt}
        </button>
      ))}
    </div>
  );
}

// ─── CTA button (magnetic) ──────────────────────────────────────────────────────────
// `strong` bumps the static shadow one notch — used where the Final CTA lost its
// pulsing halo, so the button itself carries a touch more weight at the close.
// `onLight` invierte la pastilla para un fondo del MISMO tono que ella. El
// cierre del Legacy amanece en índigo claro (LegacyBreak), y ahí el botón —que
// es `--volt` con texto negro— quedaba índigo sobre índigo: medido en captura,
// la etiqueta era casi ilegible. Es un añadido opcional con el valor de
// siempre por defecto: los demás botones de la portada no cambian una coma.
function AccessCTA({
  label,
  size = 'md',
  strong = false,
  href = BETA_URL,
  onLight = false,
}: {
  label: string;
  size?: 'sm' | 'md' | 'lg';
  strong?: boolean;
  /** La puerta. La beta por defecto; los mundos de entidad pasan su contacto. */
  href?: string;
  onLight?: boolean;
}) {
  // lg tightens below sm: at px-9/text-base the Spanish label overran the
  // 272px content column of a 320px phone and wrapped mid-pill.
  const pad = size === 'lg' ? 'px-5 py-3.5 text-sm sm:px-9 sm:py-4 sm:text-base' : size === 'sm' ? 'px-4 py-2 text-sm' : 'px-6 py-3 text-sm';
  const shadow = onLight
    ? '0 10px 30px hsl(var(--volt-deep) / 0.34)'
    : strong
      ? '0 10px 34px hsl(var(--volt) / 0.36)'
      : '0 8px 30px hsl(var(--volt) / 0.28)';
  return (
    // No trailing arrow (founder 2026-08-03: arrows left every landing
    // button — the ONLY arrow on the page is the scroll cue's).
    <Magnetic strength={0.4} className="inline-block">
      <a
        href={href}
        className={`inline-flex items-center justify-center max-w-full rounded-xl font-semibold whitespace-nowrap transition-all hover:brightness-105 ${onLight ? 'text-white' : 'text-black'} ${pad}`}
        style={{ background: onLight ? 'hsl(var(--volt-deep))' : GOLD, boxShadow: shadow }}
      >
        {label}
      </a>
    </Magnetic>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────────────
// The nav stays minimal (three anchors). DocsSection renders on the page but isn't
// linked here; the partner-logo marquee was removed from the page.
// Entries with `id` scroll to an in-page anchor; entries with `href` are real
// routes (the standalone pages, founder 2026-07-25).
const NAV: Array<{ id?: string; href?: string; es: string; en: string }> = [
  // With the journey on, the walkthrough anchors collapse into one: the tour
  // itself (its first stop). Off, the classic how/pillars pair returns.
  ...(SHOW_JOURNEY
    ? [{ id: 'stop-summary', es: 'El recorrido', en: 'The tour' }]
    : [
        { id: 'how', es: 'Cómo funciona', en: 'How it works' },
        { id: 'pillars', es: 'Qué consigues', en: 'What you get' },
      ]),
  // The #flare anchor only exists while the proof band renders.
  ...(!SHOW_JOURNEY || SHOW_PROOF_SECTIONS
    ? [
        SHOW_XRPL_ACT
          ? { id: 'flare', es: 'Rendimiento · Flare', en: 'Yield · Flare' }
          : { id: 'flare', es: 'Flare V1', en: 'Flare V1' },
      ]
    : []),
  ...(SHOW_XRPL_ACT ? [{ id: 'xrpl', es: 'Gobernanza · XRPL', en: 'Governance · XRPL' }] : []),
  // The standalone pages: the platform in depth, the proof, the people behind it.
  { href: '/what-we-offer', es: 'Qué ofrecemos', en: 'What we offer' },
  { href: '/proof', es: 'La prueba', en: 'Proof' },
  { href: '/about', es: 'Quiénes somos', en: 'About us' },
];
// La navegación de la landing «a los mandos»: los cuatro gobernadores, la
// prueba y la documentación. Sin anclas de recorrido: cada mundo es su ruta.
// UNA SOLA ENTRADA, «Productos» (fundador 2026-09-20): baja al puente de la
// portada —«el mismo sistema, a los mandos de quien tú decidas»— y desde ahí
// las cuatro tarjetas llevan a cada página. Desde una página de producto, la
// misma entrada vuelve a la portada, a ese mismo punto. El menú se queda en
// tres cosas, que es lo que este header siempre ha querido.
function navMandos(atHome: boolean): typeof NAV {
  return [
    atHome ? { id: 'mandos', es: 'Productos', en: 'Products' } : { href: '/#mandos', es: 'Productos', en: 'Products' },
    { href: WORLD_ROUTES.venue, es: 'Venues', en: 'Venues' },
    { href: '/proof', es: 'La prueba', en: 'Proof' },
    { href: '/docs', es: 'Docs', en: 'Docs' },
  ];
}
// La puerta de contacto de los mundos de entidad: el CTA no puede decir «entra
// en la beta» a un exchange que todavía está en piloto.
const CONTACT_MAILTO = 'mailto:astryum@astryum.xyz?subject=Astryum';
/** La puerta de un venue: pedir la verificación. El relé de la lista de espera
 *  solo admite tres orígenes en producción (`waitlist.ts`), así que hoy es correo. */
const VENUE_MAILTO = 'mailto:astryum@astryum.xyz?subject=Astryum%20%C2%B7%20Verificaci%C3%B3n%20de%20venue';

function Header({
  lang,
  setLang,
  onSecretLogin,
  product = 'personal',
  navItems,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  onSecretLogin: () => void;
  /** The landing's product toggle re-tints the page — the brand follows
   *  (founder 2026-08-08): blue lockup while Legacy is on stage. */
  product?: 'personal' | 'legacy';
  /** La landing «a los mandos» trae su propia navegación (NAV_MANDOS). */
  navItems?: typeof NAV;
}) {
  const es = lang === 'es';
  const items = navItems ?? NAV;
  const logoSrc = product === 'legacy' ? '/astryum-logo-azul-transparente.png' : LOGO_MARK;
  const [clicks, setClicks] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onLogo = (e: React.MouseEvent) => {
    e.preventDefault();
    // `#top` has no target in journey mode — take the visitor home explicitly
    // so the logo isn't a dead tap on phones (the 5-click admin door remains).
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setClicks((p) => {
      const n = p + 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setClicks(0), 1500);
      if (n >= 5) {
        onSecretLogin();
        return 0;
      }
      return n;
    });
  };

  const scrollTo = (id: string) => {
    // The journey renders a static <lg twin whose anchors are m- prefixed; when
    // the canonical anchor sits inside a display:none tree (offsetParent null),
    // jump to the visible twin instead.
    let el = document.getElementById(id);
    if (el && el.offsetParent === null) el = document.getElementById(`m-${id}`) ?? el;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Floating header: translucent + compact once scrolled; hides on scroll-down,
  // reappears on scroll-up (never while the mobile menu is open).
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    return scrollY.on('change', (v) => {
      setScrolled(v > 24);
      const prev = lastY.current;
      if (v > prev && v > 160) setHidden(true);
      else if (v < prev - 4) setHidden(false);
      lastY.current = v;
    });
  }, [scrollY]);

  const goTo = (n: (typeof NAV)[number]) => {
    setMenuOpen(false);
    if (n.href) window.location.assign(n.href);
    else scrollTo(n.id!);
  };

  return (
    <motion.header
      className="fixed inset-x-0 z-40"
      // Sits below the hackathon-disclosure strip; the hide slide is deeper so
      // the bar clears the viewport even with the extra top offset.
      style={{ top: BANNER_H }}
      animate={{ y: hidden && !menuOpen ? '-180%' : '0%' }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <div
        className="mx-auto transition-all duration-300"
        style={{
          maxWidth: scrolled ? 1120 : 1280,
          margin: scrolled ? '10px auto' : '16px auto',
          padding: scrolled ? '8px 14px 8px 18px' : '10px 16px 10px 20px',
          borderRadius: 16,
          background: scrolled || menuOpen ? 'rgba(12,11,9,0.72)' : 'transparent',
          border: `1px solid ${scrolled || menuOpen ? 'rgba(255,255,255,0.09)' : 'transparent'}`,
          backdropFilter: scrolled || menuOpen ? 'blur(16px)' : 'none',
          WebkitBackdropFilter: scrolled || menuOpen ? 'blur(16px)' : 'none',
          width: 'calc(100% - 32px)',
        }}
      >
        <div className="flex items-center justify-between gap-3 md:gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <a href="#top" onClick={onLogo} className="shrink-0 flex items-center" style={{ opacity: clicks > 0 ? 0.55 + clicks * 0.09 : 1 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logoSrc} alt="Astryum" className="h-10 md:h-[52px] w-auto block" />
            </a>
            <span className="hidden xl:block text-[10px] text-white/25 tracking-[0.16em] uppercase font-mono truncate">
              Financial Control. Total Clarity.
            </span>
          </div>

          {/* lg, not md: at 768–1023px the four labels + logo + CTA overrun the
              row by ~100px (iPad portrait, phone landscape) — tablets use the
              same menu button as phones. */}
          <nav className="hidden lg:flex items-center gap-0.5">
            {items.map((n) =>
              n.href ? (
                <a
                  key={n.href}
                  href={n.href}
                  className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:text-white"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  {es ? n.es : n.en}
                </a>
              ) : (
                <button
                  key={n.id}
                  onClick={() => scrollTo(n.id!)}
                  className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:text-white"
                  style={{ color: 'rgba(255,255,255,0.55)' }}
                >
                  {es ? n.es : n.en}
                </button>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2 md:gap-2.5 shrink-0">
            <LangToggle lang={lang} setLang={setLang} />
            {/* Launch App (founder 2026-08-16): the dashboard door earns its
                own name and a soft beacon breath — more present, same gold,
                never past the loudness line (reduced-motion turns it off). */}
            <Magnetic strength={0.35} className="hidden sm:inline-block">
              <a
                href={BETA_URL}
                className="cta-beacon inline-flex items-center px-4 py-2 rounded-xl text-[13px] font-semibold text-black transition-transform"
                style={{ background: GOLD }}
              >
                Launch App
              </a>
            </Magnetic>
            {/* the mobile/tablet menu door — below lg the nav above is
                display:none, and without this button a phone visitor could
                reach nothing but the language toggle */}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? (es ? 'Cerrar menú' : 'Close menu') : es ? 'Abrir menú' : 'Open menu'}
              className="lg:hidden inline-flex items-center justify-center w-11 h-11 -my-1 rounded-xl transition-colors hover:bg-white/[0.06]"
              style={{ border: `1px solid ${BORDER}`, color: 'rgba(255,255,255,0.75)' }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
                {menuOpen ? (
                  <path d="M4 4L14 14M14 4L4 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                ) : (
                  <path d="M2.5 5H15.5M2.5 9H15.5M2.5 13H15.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* the menu sheet — plain list inside the header pill, tap targets ≥44px */}
        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              className="lg:hidden overflow-hidden"
              aria-label={es ? 'Menú' : 'Menu'}
            >
              <div className="pt-3 mt-3 flex flex-col" style={{ borderTop: `1px solid ${BORDER}` }}>
                {items.map((n) => (
                  <button
                    key={n.href ?? n.id}
                    onClick={() => goTo(n)}
                    className="w-full text-left px-2 py-3 rounded-lg text-[15px] font-medium transition-colors hover:bg-white/[0.05]"
                    style={{ color: 'rgba(255,255,255,0.75)' }}
                  >
                    {es ? n.es : n.en}
                  </button>
                ))}
                <a
                  href={BETA_URL}
                  className="cta-beacon sm:hidden mt-2 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-black"
                  style={{ background: GOLD }}
                >
                  Launch App
                </a>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}

// ─── Hero copy (badge → headline → subcopy → doors) ─────────────────────────────────
// Extracted so the classic Hero (flag off) and the Solar Journey's first frame
// (flag on) render the exact same copy without duplicating it.
function HeroContent({ lang, variant = 'brand' }: { lang: Lang; variant?: 'brand' | 'mandos' }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  // LA PORTADA «A LOS MANDOS» abre con los tres ejes —lo que se ve, lo que
  // está escrito, quién firma— porque ya no habla solo en segunda persona: la
  // tríada de la marca («Tu capital. Tu control. Tu firma.») se muda al mundo
  // Autocustodia, que es donde vuelve a ser verdad palabra por palabra.
  const mandos = variant === 'mandos';
  return (
    <>
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-7"
        style={{ border: '1px solid hsl(var(--volt) / 0.3)', background: 'hsl(var(--volt) / 0.06)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
        <span className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
          {/* Doctrine pruning (founder 2026-07-29): the badge carries the status
              fact only — the H1 right below already closes on "Tu firma." */}
          {SHOW_XRPL_ACT
            ? es
              ? 'En vivo · XRPL + Flare mainnet'
              : 'Live · XRPL + Flare mainnet'
            : es
              ? 'En vivo · Flare mainnet'
              : 'Live · Flare mainnet'}
        </span>
      </motion.div>

      {/* clamp floor lowered from 2.6rem: at 320px the old 41.6px floor pushed
          the nowrap "Tu capital." past the column and overflow-hidden ate the
          period. Everything ≥525px wide renders exactly as before. */}
      <h1 className="font-bold text-white" style={{ fontSize: 'clamp(2.1rem, 6.4vw, 5rem)', lineHeight: 1.04, letterSpacing: '-0.035em' }}>
        {/* Each sentence is an unbreakable unit: on narrow columns the line
            wraps BETWEEN "Tu capital." and "Tu control.", never mid-sentence
            ("Tu capital. Tu / control." — founder 2026-07-25: "pierde
            completamente el flow"). Wide screens keep the single line. */}
        <MaskLines
          lines={
            mandos
              ? [
                  <span key="m1" className="whitespace-nowrap">{es ? 'El capital, a la vista.' : 'Capital in plain sight.'}</span>,
                  <span key="m2" className="whitespace-nowrap">{es ? 'Las reglas, por escrito.' : 'The rules, in writing.'}</span>,
                ]
              : [
                  <span key="l1">
                    <span className="whitespace-nowrap">{es ? 'Tu capital.' : 'Your capital.'}</span>{' '}
                    <span className="whitespace-nowrap">{es ? 'Tu control.' : 'Your control.'}</span>
                  </span>,
                ]
          }
          delay={0.15}
        />
        {/* Gold accent line rendered outside MaskLines: MaskLines' overflow-hidden
            clipped the "g" descender. A plain motion.span (no clip) keeps the gold
            sweep and fixes the cut. */}
        <motion.span
          className="block text-gold-sweep"
          initial={reduce ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.34, ease: EASE }}
        >
          {mandos ? (es ? 'A los mandos, quien tú decidas.' : 'At the controls, whoever you decide.') : es ? 'Tu firma.' : 'Your signature.'}
        </motion.span>
      </h1>

      <motion.p
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.55 }}
        className="mt-6 text-white/55 leading-relaxed max-w-xl"
        style={{ fontSize: 'clamp(15px, 1.4vw, 18px)' }}
      >
        {/* Rewritten 2026-07-29 (founder pick, option 1): plants the money-in-
            motion principle the journey's finale closes on — the page ends
            where it began. Also retires the GLOSSARY-banned "tu XRP finance". */}
        {mandos
          ? es
            ? 'Un mismo plano de control para XRPL y Flare. Solo cambia quién firma. Astryum, nunca.'
            : 'One control plane for XRPL and Flare. Only who signs changes. Astryum, never.'
          : SHOW_XRPL_ACT
          ? es
            ? 'El dinero quieto no trabaja. Astryum reúne tu XRP en un solo puesto de mando, sobre dos capas: XRPL gobierna cómo se comporta tu capital; Flare lo pone en movimiento.'
            : 'Money that sits still does no work. Astryum brings your XRP into a single mission control, on two layers: XRPL governs how your capital behaves; Flare sets it in motion.'
          : es
            ? 'El dinero quieto no trabaja. Astryum reúne tu XRP en un solo puesto de mando: lo ves claro, lo pones en movimiento cuando tú decides, y sabes en todo momento qué está haciendo.'
            : 'Money that sits still does no work. Astryum brings your XRP into a single mission control: you see it clearly, you set it in motion when you decide, and you always know what it is doing.'}
      </motion.p>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.7 }}
        className="mt-9 flex flex-wrap items-center gap-4"
      >
        <AccessCTA label={es ? 'Entra en la beta' : 'Enter the beta'} size="lg" />
        <Magnetic strength={0.3} className="inline-block">
          <a
            href={mandos ? WORLD_ROUTES.business : DEMO_URL}
            className="inline-flex items-center gap-2 px-6 py-4 rounded-xl text-sm font-semibold transition-colors hover:bg-white/[0.04]"
            style={{ border: `1px solid ${BORDER_STRONG}`, color: 'rgba(255,255,255,0.8)' }}
          >
            {mandos ? (es ? 'Soy una empresa' : 'I am a business') : es ? 'Únete a la lista de la demo' : 'Join the demo waitlist'}
          </a>
        </Magnetic>
      </motion.div>
    </>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────────────────
function Hero({ lang, variant = 'brand' }: { lang: Lang; variant?: 'brand' | 'mandos' }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const copyY = useTransform(scrollYProgress, [0, 1], [0, -70]);
  const copyOpacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const solarScale = useTransform(scrollYProgress, [0, 1], [1, 1.18]);
  const solarOpacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
  const cueOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0]);

  return (
    <section ref={ref} id="top" className="relative min-h-[94svh] flex items-center px-6 md:px-10 lg:px-16 pt-36 md:pt-32 pb-20 overflow-hidden">
      <div className="max-w-6xl mx-auto w-full grid lg:grid-cols-[1.15fr,0.85fr] gap-12 lg:gap-16 items-center relative z-10">
        <motion.div style={reduce ? undefined : { y: copyY, opacity: copyOpacity }}>
          <HeroContent lang={lang} variant={variant} />
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2, ease: EASE }}
          className="flex justify-center"
          style={reduce ? undefined : { scale: solarScale, opacity: solarOpacity }}
        >
          <SolarSystem lang={lang} />
        </motion.div>
      </div>

      {/* sui.io-style scroll cue — invites the journey, fades on first scroll */}
      <motion.button
        onClick={() => document.getElementById(variant === 'mandos' ? 'mandos' : 'how')?.scrollIntoView({ behavior: 'smooth' })}
        aria-label={es ? 'Desplázate para descubrir' : 'Scroll to explore'}
        className="absolute left-1/2 -translate-x-1/2 bottom-7 hidden md:flex flex-col items-center gap-2 group"
        style={reduce ? { opacity: 0.6 } : { opacity: cueOpacity }}
        initial={reduce ? false : { opacity: 0 }}
        animate={reduce ? undefined : { opacity: 1 }}
        transition={{ duration: 0.8, delay: 1.1 }}
      >
        <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/35 group-hover:text-white/60 transition-colors">
          {es ? 'Explora' : 'Scroll'}
        </span>
        {/* a hairline draws in and fades — the cue's own language, not a mouse shell */}
        <motion.span
          className="block w-px"
          style={{ height: 24, background: 'linear-gradient(180deg, hsl(var(--volt) / 0.7), transparent)', transformOrigin: 'top' }}
          initial={reduce ? false : { scaleY: 0, opacity: 0 }}
          animate={
            reduce
              ? { scaleY: 1, opacity: 0.5 }
              : { scaleY: [0, 1, 1, 0], opacity: [0, 0.9, 0.9, 0] }
          }
          transition={reduce ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut', times: [0, 0.35, 0.75, 1] }}
        />
      </motion.button>
    </section>
  );
}

// ─── Stats band (animated counters) ─────────────────────────────────────────────────
function StatsBand({ lang }: { lang: Lang }) {
  // Every figure here must be verifiable by a judge inside the demo — no
  // aspirational counts.
  // `claim: true` marks figures that are assertions, not tallies (0 keys,
  // 100% non-custodial) — they render as static text. The genuine counts
  // (live strategies, wallet ecosystems, governance instruments) keep CountUp.
  const stats = SHOW_XRPL_ACT
    ? [
        { to: 0, suffix: '', claim: true, es: 'Claves de usuario en nuestros servidores', en: 'User keys on our servers' },
        { to: 2, suffix: '', claim: false, es: 'Estrategias en vivo en Flare · FXRP · FLR', en: 'Live strategies on Flare · FXRP · FLR' },
        { to: 3, suffix: '', claim: false, es: 'Instrumentos de gobernanza · XRPL', en: 'Governance instruments · XRPL' },
        { to: 100, suffix: '%', claim: true, es: 'No-custodia', en: 'Non-custodial' },
      ]
    : [
        { to: 0, suffix: '', claim: true, es: 'Claves de usuario en nuestros servidores', en: 'User keys on our servers' },
        { to: 2, suffix: '', claim: false, es: 'Estrategias en vivo · FXRP · FLR', en: 'Live strategies · FXRP · FLR' },
        { to: 100, suffix: '%', claim: true, es: 'No-custodia', en: 'Non-custodial' },
        { to: 2, suffix: '', claim: false, es: 'Ecosistemas de wallet · XRPL + EVM', en: 'Wallet ecosystems · XRPL + EVM' },
      ];
  return (
    <section className="relative px-6 md:px-10 lg:px-16 -mt-6 md:-mt-2">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <div
            className="grid grid-cols-2 lg:grid-cols-4 rounded-2xl overflow-hidden"
            style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.015)', backdropFilter: 'blur(6px)' }}
          >
            {stats.map((s, i) => (
              <div
                key={s.en}
                // divisor: below lg (2 cols) the left column of each row gets the
                // rule (i%2); at lg (single row of 4) every cell but the last does
                className={[
                  'px-6 py-7 md:py-8 border-white/[0.06]',
                  i % 2 === 0 ? 'border-r' : '',
                  i < stats.length - 1 ? 'lg:border-r' : 'lg:border-r-0',
                ].filter(Boolean).join(' ')}
                style={{ borderTop: i >= 2 ? `1px solid ${BORDER_FAINT}` : 'none' }}
              >
                <div className="font-mono font-bold leading-none" style={{ fontSize: 'clamp(2rem, 4vw, 3.1rem)', color: GOLD }}>
                  {s.claim ? <span>{s.to}{s.suffix}</span> : <CountUp to={s.to} suffix={s.suffix} />}
                </div>
                <div className="mt-2.5 text-[13px] text-white/45 leading-snug">{lang === 'es' ? s.es : s.en}</div>
              </div>
            ))}
          </div>
        </Reveal>
        <p className="mt-3 text-center text-[11px] font-mono text-white/25">
          {lang === 'es'
            ? 'Cero claves de usuario en nuestros servidores. Tú siempre firmas.'
            : 'Zero user keys on our servers. You always sign.'}
        </p>
      </div>
    </section>
  );
}

// ─── How it works (the plain-words definition: connect → observe → sign) ────────────
// V2.1: this replaced the scroll-scrubbed manifesto. Same slot, but instead of an
// era narrative it states what Astryum literally does, in three moves a first-time
// visitor can repeat back. Keep this section jargon-free and concrete.
function HowItWorks({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const steps = [
    {
      key: 'connect',
      es: ['Conecta', 'Enlaza tu wallet XRPL (Xaman) o EVM (MetaMask). Astryum solo lee: tus claves y tus fondos no se mueven de donde están.'],
      en: ['Connect', 'Link your XRPL (Xaman) or EVM (MetaMask) wallet. Astryum only reads: your keys and your funds never leave where they are.'],
    },
    {
      key: 'observe',
      es: ['Observa', 'Todo tu capital en un mapa en tiempo real: balances, posiciones y la salud de cada una — y el rendimiento de cada estrategia como dato del protocolo, con fuente.'],
      en: ['Observe', 'All your capital on one real-time map: balances, positions and each one’s health — and each strategy’s yield as protocol data, with its source.'],
    },
    {
      key: 'sign',
      es: ['Firma', 'Eliges un movimiento y Astryum construye la transacción, la simula y te muestra coste y condiciones. La firmas en tu wallet — o no ocurre nada.'],
      en: ['Sign', 'You pick a move and Astryum builds the transaction, simulates it and shows you cost and conditions. You sign it in your wallet — or nothing happens.'],
    },
  ];
  return (
    <section id="how" className="relative py-24 md:py-36 px-6 md:px-10 lg:px-16 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <div className="flex items-center gap-2 mb-4">
            <AsteroidGlyph size={18} />
            <span className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
              {es ? 'Cómo funciona' : 'How it works'}
            </span>
          </div>
          <h2 className="font-bold text-white text-balance" style={{ fontSize: 'clamp(1.9rem, 4vw, 3.2rem)', letterSpacing: '-0.03em', lineHeight: 1.08 }}>
            {es ? 'Un puesto de mando. No otra wallet.' : 'Mission control. Not another wallet.'}
          </h2>
          <p className="mt-4 text-white/45 max-w-2xl" style={{ fontSize: 'clamp(14px, 1.3vw, 17px)' }}>
            {es
              ? 'Astryum se conecta a las wallets que ya tienes y nunca toca tus claves. Todo pasa en tres movimientos.'
              : 'Astryum connects to the wallets you already have and never touches your keys. Everything happens in three moves.'}
          </p>
        </Reveal>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {steps.map((s, i) => {
            const [title, desc] = es ? s.es : s.en;
            return (
              <Reveal key={s.key} delay={i * 0.12}>
                <SpotlightCard
                  className="h-full rounded-2xl p-6"
                  style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}
                >
                  <span
                    className="inline-flex w-9 h-9 items-center justify-center rounded-xl mb-5 font-mono text-sm"
                    style={{ background: 'hsl(var(--volt) / 0.1)', border: `1px solid ${GOLD}`, color: GOLD }}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
                  <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Act break — one editorial pause before the proof ───────────────────────────────
// V2.1 keeps a single visible break (down from three): a lot of vertical air, a
// small kicker between fading hairlines, and one line that scrubs in with the
// scroll. It marks the turn from "what Astryum is" to "what is live on mainnet
// today". (The XRPL governance act keeps its own break behind SHOW_XRPL_ACT.)
function ActBreak({
  lang,
  kickerEs,
  kickerEn,
  lineEs,
  lineEn,
}: {
  lang: Lang;
  kickerEs: string;
  kickerEn: string;
  lineEs: string;
  lineEn: string;
}) {
  const es = lang === 'es';
  return (
    <section className="relative py-32 md:py-48 px-6">
      <div className="max-w-3xl mx-auto text-center">
        <Reveal>
          <div className="flex items-center justify-center gap-4 mb-9">
            <span className="h-px w-14" style={{ background: 'linear-gradient(90deg, transparent, hsl(var(--volt) / 0.5))' }} />
            <span className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
              {es ? kickerEs : kickerEn}
            </span>
            <span className="h-px w-14" style={{ background: 'linear-gradient(90deg, hsl(var(--volt) / 0.5), transparent)' }} />
          </div>
        </Reveal>
        <ScrollRevealText
          className="text-white font-light leading-snug tracking-tight text-balance text-[26px] md:text-[38px] lg:text-[44px]"
          text={es ? lineEs : lineEn}
        />
      </div>
    </section>
  );
}

// ─── 4 Pillars (spotlight + tilt cards) ─────────────────────────────────────────────
function Pillars({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const pillars = [
    {
      key: 'protect',
      es: ['Protege', 'Ve dónde está cada activo y qué lo amenaza. Radar de riesgo que te avisa antes del problema, no después.'],
      en: ['Protect', 'See where every asset is and what threatens it. A risk radar that warns you before the problem, not after.'],
    },
    {
      key: 'control',
      es: ['Controla', 'Un centro de mando para tu capital. Tú defines las reglas. Tú autorizas cada acción.'],
      en: ['Control', 'One command center for your capital. You define the rules. You authorize every action.'],
    },
    {
      key: 'generate',
      es: ['Genera', 'Pon tu XRP a trabajar como colateral en Flare mainnet — con un umbral de seguridad que fijas tú y condiciones reales, visibles antes de firmar.'],
      en: ['Generate', 'Put your XRP to work as collateral on Flare mainnet — with a safety threshold you set and real conditions, shown before you sign.'],
    },
    {
      key: 'manage',
      es: ['Gestiona', 'Deposita, retira, repaga y sal — flujos guiados desde un solo lugar. Deshaz una posición entera paso a paso. Tú siempre firmas.'],
      en: ['Manage', 'Deposit, withdraw, repay and exit — guided flows from one place. Unwind an entire position step by step. You always sign.'],
    },
  ];
  return (
    <section id="pillars" className="relative py-24 md:py-36 px-6 md:px-10 lg:px-16 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="font-bold text-white text-balance" style={{ fontSize: 'clamp(1.9rem, 4vw, 3.2rem)', letterSpacing: '-0.03em', lineHeight: 1.08 }}>
            {es ? 'Con Astryum consigues 4 cosas.' : 'With Astryum you achieve 4 things.'}
          </h2>
          <p className="mt-4 text-white/45 max-w-2xl" style={{ fontSize: 'clamp(14px, 1.3vw, 17px)' }}>
            {es
              ? 'Proteger, controlar, generar y gestionar — sobre el capital que ya tienes, donde ya está.'
              : 'Protect, control, generate and manage — over the capital you already hold, where it already sits.'}
          </p>
        </Reveal>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5" style={{ perspective: 1200 }}>
          {pillars.map((p, i) => {
            const [title, desc] = es ? p.es : p.en;
            return (
              <Reveal key={p.key} delay={i * 0.12}>
                <SpotlightCard
                  tilt
                  className="h-full rounded-2xl p-6 transition-colors"
                  style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}
                >
                  {/* no numbered chip here — the 4 pillars aren't a sequence (that
                      number stays reserved for HowItWorks and rack pagination);
                      the title alone anchors the card */}
                  <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
                  <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Flare V1 features (horizontal-pan on scroll; vertical on mobile/reduced) ────────
const FLARE_FEATURES = [
  {
    tag: 'FXRP',
    es: ['Carry de FXRP protegida', 'Aporta FXRP como colateral en Kinetic y pide prestado contra él — una posición carry con protección incluida: fijas un umbral de Health Factor, Astryum lo vigila contra el precio de FTSO y prepara el repay exacto si se rompe. Firmas tú.'],
    en: ['Protected FXRP carry', 'Supply FXRP as collateral in Kinetic and borrow against it — a carry position with built-in protection: you set a Health Factor threshold, Astryum watches it against FTSO price and prepares the exact repay if it’s breached. You sign.'],
  },
  {
    tag: 'FLR',
    es: ['FLR → delegación FTSO', 'Envuelve FLR en WFLR y delega su poder de voto a un proveedor de datos FTSO — recompensas por época (~3,5 días), sin deuda, reversible cuando quieras. Firmas el wrap y la delegación.'],
    en: ['FLR → FTSO delegation', 'Wrap FLR into WFLR and delegate its vote power to an FTSO data provider — earn epoch rewards (~3.5 days), no debt, reversible whenever you want. You sign the wrap and the delegation.'],
  },
  {
    tag: 'WALLETS',
    es: ['Dos wallets, una experiencia', 'Conecta EVM (Flare) o Xaman (XRPL). Ver y actuar funciona con cualquiera de las dos.'],
    en: ['Two wallets, one experience', 'Connect EVM (Flare) or Xaman (XRPL). See-and-act works with either one.'],
  },
  {
    tag: 'AUDIT',
    es: ['Capa de auditoría', 'Cada acción se simula antes de que firmes y queda en tu historial de actividad. Nada ocurre fuera de registro.'],
    en: ['Audit layer', 'Every action is simulated before you sign and recorded in your activity log. Nothing happens off the record.'],
  },
];

function FlareCard({ f, i, lang }: { f: (typeof FLARE_FEATURES)[number]; i: number; lang: Lang }) {
  const [title, desc] = lang === 'es' ? f.es : f.en;
  return (
    <SpotlightCard
      className="h-full rounded-2xl p-7 flex flex-col"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.025)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <span
          className="inline-block text-[10px] font-mono font-semibold px-2.5 py-1 rounded-md tracking-wider"
          style={{ background: 'hsl(var(--volt) / 0.1)', color: GOLD, border: '1px solid hsl(var(--volt) / 0.3)' }}
        >
          {f.tag}
        </span>
        <span className="font-mono text-[12px] text-white/20">{String(i + 1).padStart(2, '0')}</span>
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
    </SpotlightCard>
  );
}

function FlareHeader({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  return (
    <div className="max-w-6xl mx-auto w-full px-6 md:px-10 lg:px-16">
      <div className="flex items-center gap-2 mb-4">
        <AsteroidGlyph size={18} />
        <span className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
          {SHOW_XRPL_ACT
            ? es
              ? 'Astryum V1 · capa de rendimiento · Flare'
              : 'Astryum V1 · yield layer · on Flare'
            : es
              ? 'Astryum V1 · control plane · sobre Flare'
              : 'Astryum V1 · control plane · on Flare'}
        </span>
      </div>
      <h2 className="font-bold text-white text-balance" style={{ fontSize: 'clamp(1.9rem, 4vw, 3.2rem)', letterSpacing: '-0.03em', lineHeight: 1.08 }}>
        {es ? 'Haz que tus activos parados trabajen.' : 'Make your idle assets productive.'}
      </h2>
      <p className="mt-4 text-white/45 max-w-2xl" style={{ fontSize: 'clamp(14px, 1.3vw, 17px)' }}>
        {es
          ? 'Tres estrategias reales, en vivo en Flare hoy — una carry de FXRP protegida, supply simple de FXRP y delegación de FLR. Con más en camino.'
          : 'Three real strategies, live on Flare today — a protected FXRP carry, simple FXRP lending, and FLR delegation. More coming.'}
      </p>
    </div>
  );
}

// ─── Flare console rack — interactive expanding panels ───────────────────────────────
// Replaces the pinned horizontal pan: no scroll hijacking, no dead scroll length.
// A row of instrument panels; the active one opens wide while the rest compress into
// labelled slats. Click / focus selects; the rack auto-advances on a slow cadence
// (paused while the pointer is inside) so it reads alive at rest. Vertical stack on
// mobile; no auto-advance and no easing under prefers-reduced-motion.

const CSS_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const RACK_CADENCE = 6.5; // seconds per panel at rest

function FlareGlyph({ tag, size = 26 }: { tag: string; size?: number }) {
  const s = { stroke: GOLD, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (tag) {
    case 'FXRP': // orbit dropping into a vault floor
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="7" r="4.2" {...s} />
          <path d="M12 11.5V17m0 0l-2.6-2.6M12 17l2.6-2.6" {...s} />
          <path d="M5 20.5h14" {...s} opacity={0.5} />
        </svg>
      );
    case 'FLR': // flare rays
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="3.4" {...s} />
          <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M6 6l2.1 2.1M15.9 15.9L18 18M18 6l-2.1 2.1M8.1 15.9L6 18" {...s} opacity={0.75} />
        </svg>
      );
    case 'WALLETS': // two wallets, one plane
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <rect x="3.5" y="7.5" width="13" height="10" rx="2.5" {...s} />
          <path d="M7 7.5V6a2.5 2.5 0 012.5-2.5h8A2.5 2.5 0 0120 6v7a2.5 2.5 0 01-1.6 2.33" {...s} opacity={0.6} />
          <circle cx="13" cy="12.5" r="1.2" fill={GOLD} stroke="none" />
        </svg>
      );
    case 'AUDIT': // shield + check
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M12 3.5l7 2.8v5.2c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6.3z" {...s} />
          <path d="M9 12l2.2 2.2L15.5 9.7" {...s} />
        </svg>
      );
    case 'RISK': // radar needle
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M4 19a8.5 8.5 0 0117 0" {...s} />
          <path d="M12 19l4.6-6.4" {...s} />
          <circle cx="12" cy="19" r="1.3" fill={GOLD} stroke="none" />
        </svg>
      );
    default: // fallback — twin coins
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <circle cx="9" cy="12" r="5.2" {...s} />
          <circle cx="15" cy="12" r="5.2" {...s} opacity={0.5} />
        </svg>
      );
  }
}

function FlareRack({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  // Slow auto-advance keeps the rack alive at rest; any pointer presence pauses it
  // so a reading user is never yanked to the next panel.
  useEffect(() => {
    if (reduce || paused) return undefined;
    const id = setInterval(() => setActive((a) => (a + 1) % FLARE_FEATURES.length), RACK_CADENCE * 1000);
    return () => clearInterval(id);
  }, [reduce, paused]);

  return (
    <div
      className="flex gap-3 h-[520px] lg:h-[440px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="tablist"
      aria-label={es ? 'Instrumentos de Astryum V1' : 'Astryum V1 instruments'}
    >
      {FLARE_FEATURES.map((f, i) => {
        const [title, desc] = es ? f.es : f.en;
        const on = i === active;
        return (
          <button
            key={f.tag}
            role="tab"
            aria-selected={on}
            onClick={() => setActive(i)}
            onFocus={() => setActive(i)}
            className="relative overflow-hidden rounded-2xl text-left outline-none focus-visible:ring-1 focus-visible:ring-[#C9A227]/60"
            style={{
              flexGrow: on ? 4.6 : 1,
              flexBasis: 0,
              minWidth: 0,
              border: `1px solid ${on ? 'hsl(var(--volt) / 0.32)' : BORDER}`,
              background: on
                ? 'linear-gradient(180deg, hsl(var(--volt) / 0.07), hsl(var(--volt) / 0.02) 55%, rgba(255,255,255,0.015))'
                : 'rgba(255,255,255,0.02)',
              transition: reduce
                ? 'none'
                : `flex-grow 0.75s ${CSS_EASE}, border-color 0.4s ease, background 0.5s ease`,
            }}
          >
            {/* collapsed slat — number, glyph, vertical title */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-between py-6 transition-opacity duration-300"
              style={{ opacity: on ? 0 : 1, pointerEvents: 'none', transitionDelay: on ? '0s' : '0.3s' }}
            >
              <span className="font-mono text-[11px] text-white/30">{String(i + 1).padStart(2, '0')}</span>
              <FlareGlyph tag={f.tag} size={22} />
              <span
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45 whitespace-nowrap"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {title}
              </span>
            </div>

            {/* expanded panel — fixed inner width so copy doesn't reflow mid-animation */}
            <div
              className="absolute inset-0 p-7 lg:p-8 pb-10 flex flex-col transition-opacity duration-500"
              style={{ opacity: on ? 1 : 0, transitionDelay: on ? '0.28s' : '0s', pointerEvents: on ? 'auto' : 'none' }}
            >
              <div className="w-[400px] max-w-full flex flex-col h-full">
                <div className="flex items-center justify-between">
                  <span
                    className="inline-block text-[10px] font-mono font-semibold px-2.5 py-1 rounded-md tracking-wider"
                    style={{ background: 'hsl(var(--volt) / 0.1)', color: GOLD, border: '1px solid hsl(var(--volt) / 0.3)' }}
                  >
                    {f.tag}
                  </span>
                  <span className="font-mono text-[12px] text-white/25">
                    {String(i + 1).padStart(2, '0')} / {String(FLARE_FEATURES.length).padStart(2, '0')}
                  </span>
                </div>
                <div className="mt-auto">
                  <FlareGlyph tag={f.tag} size={34} />
                  <h3 className="mt-5 text-2xl font-semibold text-white tracking-tight text-balance">{title}</h3>
                  <p className="mt-3 text-[15px] text-white/50 leading-relaxed">{desc}</p>
                </div>
              </div>
              {/* cadence rail — time until the rack advances */}
              {!reduce && (
                <div className="absolute left-7 right-7 bottom-5 h-px overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  {on && !paused && (
                    <motion.div
                      key={active}
                      className="h-full origin-left"
                      style={{ background: `linear-gradient(90deg, ${GOLD}, ${GOLD_SOFT})` }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: RACK_CADENCE, ease: 'linear' }}
                    />
                  )}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FlareFeatures({ lang }: { lang: Lang }) {
  const es = lang === 'es';

  const footer = (
    <div
      className="rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center gap-4 md:justify-between"
      style={{ border: '1px solid hsl(var(--volt) / 0.22)', background: 'hsl(var(--volt) / 0.05)' }}
    >
      <div className="font-mono text-sm text-white/60">
        <span style={{ color: GOLD }}>FXRP</span> = Xaman (XRPL) → FAssets → Kinetic (carry) &nbsp;·&nbsp;{' '}
        <span style={{ color: GOLD }}>FLR</span> = WFLR → FTSO
      </div>
      {/* Journey on: the intermediate doors are gone — hero + header + one close. */}
      {!SHOW_JOURNEY && (
        <Magnetic strength={0.3} className="inline-block">
          <a
            href={DEMO_URL}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all hover:brightness-105"
            style={{ background: GOLD, boxShadow: '0 8px 30px hsl(var(--volt) / 0.28)' }}
          >
            {es ? 'Únete a la lista de la demo' : 'Join the demo waitlist'}
          </a>
        </Magnetic>
      )}
    </div>
  );

  return (
    <section id="flare" className="relative py-24 md:py-36 scroll-mt-20">
      <FlareHeader lang={lang} />

      {/* Desktop: interactive console rack */}
      <div className="hidden md:block max-w-6xl mx-auto px-6 md:px-10 lg:px-16 mt-12">
        <Reveal>
          <FlareRack lang={lang} />
        </Reveal>
        <div className="mt-8">{footer}</div>
      </div>

      {/* Mobile: vertical stack */}
      <div className="md:hidden px-6 mt-10 grid gap-5">
        {FLARE_FEATURES.map((f, i) => (
          <FlareCard key={f.tag} f={f} i={i} lang={lang} />
        ))}
        <div className="mt-3">{footer}</div>
      </div>
    </section>
  );
}

// ─── The bridge — from XRPL to Flare, told as Flare's own public technology ──────────
// (FAssets mint → FXRP, verified by the Flare Data Connector), in plain words, as an
// animated route: three stations with a gold mote that glides between them; the
// active station's sentence crossfades in below. Click a station to jump; hovering
// pauses the auto-advance; static under reduced motion.
// DELIBERATE: no Astryum rail internals here (no SourceTag, no memo/hash scheme, no
// executor talk) — the founder ruled those backend details out of public copy. The
// block credits Flare's public infrastructure and stays truthful: the rail is live
// on mainnet.
const BRIDGE_CADENCE = 3.6; // seconds per station at rest

function BridgeProof({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const steps = [
    {
      label: es ? 'Firmas en XRPL' : 'You sign on XRPL',
      es: 'Una sola firma en Xaman, desde tu móvil. Tu XRP no cambia de dueño: va a cambiar de forma.',
      en: 'One signature in Xaman, from your phone. Your XRP doesn’t change hands: it’s about to change form.',
    },
    {
      label: es ? 'Flare lo comprueba' : 'Flare verifies it',
      es: 'El Flare Data Connector — tecnología pública de Flare — comprueba por sí mismo que tu pago en XRPL existe. Sin confiar en nadie, tampoco en nosotros.',
      en: 'The Flare Data Connector — Flare’s public technology — checks for itself that your XRPL payment exists. Trusting no one, not even us.',
    },
    {
      label: es ? 'Nace FXRP' : 'FXRP is born',
      es: 'El mint de FAssets convierte tu XRP en FXRP: su representación en Flare, respaldada por colateral y canjeable de vuelta — lista para trabajar.',
      en: 'The FAssets mint turns your XRP into FXRP: its representation on Flare, backed by collateral and redeemable back — ready to work.',
    },
  ];

  useEffect(() => {
    if (reduce || paused) return undefined;
    const id = setInterval(() => setActive((a) => (a + 1) % 3), BRIDGE_CADENCE * 1000);
    return () => clearInterval(id);
  }, [reduce, paused]);

  return (
    <section className="relative py-24 md:py-32 px-6 md:px-10 lg:px-16">
      <div className="max-w-4xl mx-auto">
        <Reveal>
          <div
            className="rounded-2xl p-7 md:p-10"
            style={{
              border: '1px solid hsl(var(--volt) / 0.25)',
              background: 'linear-gradient(180deg, hsl(var(--volt) / 0.06), rgba(255,255,255,0.015))',
            }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                {es ? 'El puente · de XRPL a Flare' : 'The bridge · from XRPL to Flare'}
              </span>
              <span
                className="inline-flex items-center gap-2 px-3 py-1 rounded-full font-mono text-[10px] uppercase tracking-[0.16em]"
                style={{ border: '1px solid hsl(var(--volt) / 0.3)', background: 'hsl(var(--volt) / 0.07)', color: GOLD_SOFT }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: GOLD }} />
                {es ? 'FAssets · en vivo en mainnet' : 'FAssets · live on mainnet'}
              </span>
            </div>

            {/* the route — three stations on a dashed flight path, a mote glides between them */}
            <div className="mt-10 mx-2 sm:mx-6 relative" style={{ height: 74 }}>
              {/* the path */}
              <svg className="absolute inset-x-0" style={{ top: 9 }} width="100%" height="4" preserveAspectRatio="none" viewBox="0 0 100 4" fill="none" aria-hidden>
                <line x1="0" y1="2" x2="100" y2="2" stroke="hsl(var(--volt) / 0.35)" strokeWidth="1.4" strokeDasharray="1.4 2.4" vectorEffect="non-scaling-stroke" />
              </svg>
              {/* the mote — glides to the active station */}
              <motion.span
                className="absolute w-[9px] h-[9px] rounded-full pointer-events-none"
                style={{ top: 6.5, background: GOLD, boxShadow: `0 0 10px ${GOLD}, 0 0 24px hsl(var(--volt) / 0.55)` }}
                initial={false}
                animate={{ left: `calc(${active * 50}% - 4.5px)` }}
                transition={reduce ? { duration: 0 } : { duration: 0.8, ease: EASE }}
                aria-hidden
              />
              {/* the stations */}
              {steps.map((s, i) => {
                const on = i === active;
                return (
                  <button
                    key={s.label}
                    onClick={() => setActive(i)}
                    aria-label={s.label}
                    aria-pressed={on}
                    className="absolute top-0 flex flex-col items-center gap-2.5 group"
                    style={{ left: `${i * 50}%`, transform: 'translateX(-50%)' }}
                  >
                    <span
                      className="w-[22px] h-[22px] rounded-full flex items-center justify-center transition-all duration-300"
                      style={{
                        border: `1px solid ${on ? GOLD : 'rgba(255,255,255,0.2)'}`,
                        background: on ? 'hsl(var(--volt) / 0.14)' : 'rgba(10,10,9,0.9)',
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full transition-colors" style={{ background: on ? GOLD : 'rgba(255,255,255,0.3)' }} />
                    </span>
                    <span
                      className="text-[11px] sm:text-[12px] font-medium whitespace-nowrap transition-colors"
                      style={{ color: on ? '#fff' : 'rgba(255,255,255,0.4)' }}
                    >
                      {s.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* the active station's sentence */}
            <div className="mt-2 min-h-[72px] sm:min-h-[56px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={active}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="text-white/60 leading-relaxed max-w-xl mx-auto text-center"
                  style={{ fontSize: 'clamp(14.5px, 1.4vw, 16.5px)' }}
                >
                  {es ? steps[active].es : steps[active].en}
                </motion.p>
              </AnimatePresence>
            </div>

            <p className="mt-8 text-white font-medium leading-relaxed text-center" style={{ fontSize: 'clamp(16px, 1.7vw, 20px)' }}>
              {es
                ? 'En ningún punto del camino Astryum toca tu capital: firmas tú, y es la red de Flare quien comprueba y cumple.'
                : 'At no point along the way does Astryum touch your capital: you sign, and it is Flare’s network that verifies and delivers.'}
            </p>
            <p className="mt-3 text-sm text-white/45 leading-relaxed text-center">
              {es
                ? 'Infraestructura pública de Flare, no una promesa nuestra.'
                : 'Flare’s public infrastructure, not a promise of ours.'}
            </p>
            <p className="mt-6 font-mono text-[11px] text-white/30 text-center">
              {es ? 'Tecnología:' : 'Technology:'} Flare FAssets ({es ? 'mint de FXRP' : 'FXRP mint'}) · Flare Data Connector ·{' '}
              {es ? 'en mainnet' : 'on mainnet'}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── XRPL governance act — the other half of the thesis. Mirrors the Flare act's ──────
// honesty: the three primitives (councils, constitutions, programmed transfers) are
// BUILT on XRPL-native features and read/anchor/compose against the real ledger, but
// the flows are not yet open to users — so this act sells a waitlist, never a "live".
// Copy discipline (audit P7 + MICA_BOUNDARIES): protection is BY THE COUNCIL'S QUORUM
// (never "the code prevents it" — the Flare-side vault is not deployed and must not
// be claimed); conditions are evaluated by the quorum under written rules (never
// "the system applies them"); and no will/inheritance/trust/estate vocabulary.
// Plain-language register: the chip is a friendly name (CONSEJO / CONSTITUCIÓN /
// ENTREGAS); the XRPL-native primitive (SignerListSet / DIDSet / Escrow) survives
// as a small footnote inside each panel — proof for judges, not headline jargon.
// No "no gas / free" claims anywhere: network and protocol costs exist, and the
// product's own invariant is costs-visible-before-signing, never costs-don't-exist.
const XRPL_PRIMITIVES = [
  {
    native: 'SignerListSet',
    chipEs: 'CONSEJO',
    chipEn: 'COUNCIL',
    es: [
      'Consejos',
      'Nadie mueve el capital solo. Ni siquiera tú. Cada decisión se firma entre varios, cada uno desde su propio móvil — y hasta que no hay firmas suficientes, no ocurre nada. No es una app prometiéndolo: es la propia red de XRPL la que lo exige.',
    ],
    en: [
      'Councils',
      'No one moves the capital alone. Not even you. Every decision is signed by several people, each from their own phone — and until there are enough signatures, nothing happens. It isn’t an app promising it: XRPL itself demands it.',
    ],
  },
  {
    native: 'DIDSet',
    chipEs: 'CONSTITUCIÓN',
    chipEn: 'CONSTITUTION',
    es: [
      'Constituciones',
      'Vuestras reglas, escritas y selladas. El documento nunca sale de tu navegador — solo se graba su sello, firmado por el consejo. Cada cambio deja una versión nueva: la historia de vuestros acuerdos, guardada para siempre. Las reglas las hace cumplir el consejo; el sello las prueba.',
    ],
    en: [
      'Constitutions',
      'Your rules, written down and sealed. The document never leaves your browser — only its seal is recorded, signed by the council. Every change leaves a new version: the story of your agreements, kept forever. The council upholds the rules; the seal proves them.',
    ],
  },
  {
    native: 'Escrow',
    chipEs: 'ENTREGAS',
    chipEn: 'DELIVERIES',
    es: [
      'Transferencias programadas',
      'Una entrega con fecha que llega sola. Tú decides cuánto, a quién y cuándo — y una fecha de recuperación por si algo sale mal. Una vez firmada, la red la cumple por su cuenta: ni siquiera hace falta que Astryum exista.',
    ],
    en: [
      'Programmed transfers',
      'A delivery with a date that arrives on its own. You decide how much, to whom and when — plus a recovery date in case something goes wrong. Once signed, the network fulfils it on its own: it doesn’t even need Astryum to exist.',
    ],
  },
];

function XrplGlyph({ tag, size = 26 }: { tag: string; size?: number }) {
  const s = { stroke: GOLD, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (tag) {
    case 'SignerListSet': // three signers converging on a quorum
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <circle cx="6" cy="6" r="2.4" {...s} />
          <circle cx="18" cy="6" r="2.4" {...s} />
          <circle cx="12" cy="4.5" r="2.4" {...s} />
          <path d="M6 8.5L10.5 15M18 8.5L13.5 15M12 7v7" {...s} opacity={0.6} />
          <rect x="8.5" y="15" width="7" height="5.5" rx="1.5" {...s} />
        </svg>
      );
    case 'DIDSet': // document + fingerprint anchor
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path d="M7 3.5h7l3.5 3.5v13a1 1 0 01-1 1H7a1 1 0 01-1-1v-15.5a1 1 0 011-1z" {...s} />
          <path d="M14 3.5V7h3.5" {...s} opacity={0.6} />
          <path d="M12 11a3 3 0 013 3c0 1.8-1 3-1.6 3.8M12 13a1 1 0 011 1c0 1.4-.5 2.4-1 3.1M9.4 12.2A3 3 0 019 14c0 1.2.3 2 .7 2.7" {...s} />
        </svg>
      );
    case 'Escrow': // clock + release arrow
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <circle cx="10.5" cy="12" r="6.5" {...s} />
          <path d="M10.5 8.5V12l2.5 1.8" {...s} />
          <path d="M17 12h4.5m0 0l-2.2-2.2M21.5 12l-2.2 2.2" {...s} opacity={0.75} />
        </svg>
      );
    default:
      return <AsteroidGlyph size={size} />;
  }
}

// ─── XRPL console rack — same interactive pattern as the Flare rack: the active ──────
// panel opens wide, the rest compress into labelled slats, a slow cadence advances
// at rest (paused under the pointer), click/focus selects. Vertical cards on mobile;
// no auto-advance and no easing under prefers-reduced-motion.
function XrplCard({ p, i, lang }: { p: (typeof XRPL_PRIMITIVES)[number]; i: number; lang: Lang }) {
  const es = lang === 'es';
  const [title, desc] = es ? p.es : p.en;
  return (
    <SpotlightCard
      className="h-full rounded-2xl p-7 flex flex-col"
      style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.025)' }}
    >
      <div className="flex items-center justify-between mb-5">
        <span
          className="inline-block text-[10px] font-mono font-semibold px-2.5 py-1 rounded-md tracking-wider"
          style={{ background: 'hsl(var(--volt) / 0.1)', color: GOLD, border: '1px solid hsl(var(--volt) / 0.3)' }}
        >
          {es ? p.chipEs : p.chipEn}
        </span>
        <span className="font-mono text-[12px] text-white/20">{String(i + 1).padStart(2, '0')}</span>
      </div>
      <XrplGlyph tag={p.native} size={30} />
      <h3 className="mt-5 text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
      <p className="mt-4 pt-3 font-mono text-[10px] text-white/25" style={{ borderTop: `1px solid ${BORDER_FAINT}` }}>
        {es ? 'Nativo de XRPL' : 'XRPL-native'} · {p.native}
      </p>
    </SpotlightCard>
  );
}

function XrplRack({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (reduce || paused) return undefined;
    const id = setInterval(() => setActive((a) => (a + 1) % XRPL_PRIMITIVES.length), RACK_CADENCE * 1000);
    return () => clearInterval(id);
  }, [reduce, paused]);

  return (
    <div
      className="flex gap-3 h-[520px] lg:h-[440px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="tablist"
      aria-label={es ? 'Instrumentos de gobernanza en XRPL' : 'Governance instruments on XRPL'}
    >
      {XRPL_PRIMITIVES.map((p, i) => {
        const [title, desc] = es ? p.es : p.en;
        const on = i === active;
        return (
          <button
            key={p.native}
            role="tab"
            aria-selected={on}
            onClick={() => setActive(i)}
            onFocus={() => setActive(i)}
            className="relative overflow-hidden rounded-2xl text-left outline-none focus-visible:ring-1 focus-visible:ring-[#C9A227]/60"
            style={{
              flexGrow: on ? 4.6 : 1,
              flexBasis: 0,
              minWidth: 0,
              border: `1px solid ${on ? 'hsl(var(--volt) / 0.32)' : BORDER}`,
              background: on
                ? 'linear-gradient(180deg, hsl(var(--volt) / 0.07), hsl(var(--volt) / 0.02) 55%, rgba(255,255,255,0.015))'
                : 'rgba(255,255,255,0.02)',
              transition: reduce
                ? 'none'
                : `flex-grow 0.75s ${CSS_EASE}, border-color 0.4s ease, background 0.5s ease`,
            }}
          >
            {/* collapsed slat — number, glyph, vertical title */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-between py-6 transition-opacity duration-300"
              style={{ opacity: on ? 0 : 1, pointerEvents: 'none', transitionDelay: on ? '0s' : '0.3s' }}
            >
              <span className="font-mono text-[11px] text-white/30">{String(i + 1).padStart(2, '0')}</span>
              <XrplGlyph tag={p.native} size={22} />
              <span
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/45 whitespace-nowrap"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                {title}
              </span>
            </div>

            {/* expanded panel — fixed inner width so copy doesn't reflow mid-animation */}
            <div
              className="absolute inset-0 p-7 lg:p-8 pb-10 flex flex-col transition-opacity duration-500"
              style={{ opacity: on ? 1 : 0, transitionDelay: on ? '0.28s' : '0s', pointerEvents: on ? 'auto' : 'none' }}
            >
              <div className="w-[400px] max-w-full flex flex-col h-full">
                <div className="flex items-center justify-between">
                  <span
                    className="inline-block text-[10px] font-mono font-semibold px-2.5 py-1 rounded-md tracking-wider"
                    style={{ background: 'hsl(var(--volt) / 0.1)', color: GOLD, border: '1px solid hsl(var(--volt) / 0.3)' }}
                  >
                    {es ? p.chipEs : p.chipEn}
                  </span>
                  <span className="font-mono text-[12px] text-white/25">
                    {String(i + 1).padStart(2, '0')} / {String(XRPL_PRIMITIVES.length).padStart(2, '0')}
                  </span>
                </div>
                <div className="mt-auto">
                  <XrplGlyph tag={p.native} size={34} />
                  <h3 className="mt-5 text-2xl font-semibold text-white tracking-tight text-balance">{title}</h3>
                  <p className="mt-3 text-[15px] text-white/50 leading-relaxed">{desc}</p>
                  <p className="mt-4 font-mono text-[10px] text-white/25">
                    {es ? 'Nativo de XRPL' : 'XRPL-native'} · {p.native}
                  </p>
                </div>
              </div>
              {/* cadence rail — time until the rack advances */}
              {!reduce && (
                <div className="absolute left-7 right-7 bottom-5 h-px overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  {on && !paused && (
                    <motion.div
                      key={active}
                      className="h-full origin-left"
                      style={{ background: `linear-gradient(90deg, ${GOLD}, ${GOLD_SOFT})` }}
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: RACK_CADENCE, ease: 'linear' }}
                    />
                  )}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function XrplGovernance({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  return (
    <section id="xrpl" className="relative py-24 md:py-36 px-6 md:px-10 lg:px-16 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <div className="flex items-center gap-2 mb-4">
            <AsteroidGlyph size={18} />
            <span className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
              {es ? 'Astryum Legacy · capa de gobernanza · XRPL' : 'Astryum Legacy · governance layer · on XRPL'}
            </span>
          </div>
          <h2 className="font-bold text-white text-balance" style={{ fontSize: 'clamp(1.9rem, 4vw, 3.2rem)', letterSpacing: '-0.03em', lineHeight: 1.08 }}>
            {es
              ? 'XRPL decide cómo se comporta tu capital. Flare hace que produzca.'
              : 'XRPL decides how your capital behaves. Flare makes that capital produce.'}
          </h2>
          <p className="mt-4 text-white/45 max-w-2xl" style={{ fontSize: 'clamp(14px, 1.3vw, 17px)' }}>
            {es
              ? 'Tres instrumentos para decidir en grupo qué pasa con vuestro capital — construidos sobre lo que XRPL sabe hacer de nacimiento; abren pronto. Sin promesas: solo lo que existe.'
              : 'Three instruments for deciding together what happens to your capital — built on what XRPL can do natively, opening soon. No promises: just what exists.'}
          </p>
        </Reveal>

        {/* Desktop: interactive console rack (mirrors the Flare act) */}
        <div className="hidden md:block mt-12">
          <Reveal>
            <XrplRack lang={lang} />
          </Reveal>
        </div>

        {/* Mobile: vertical stack */}
        <div className="md:hidden mt-10 grid gap-5">
          {XRPL_PRIMITIVES.map((p, i) => (
            <XrplCard key={p.native} p={p} i={i} lang={lang} />
          ))}
        </div>

        {/* the closer — why XRPL carries the governance layer */}
        <Reveal delay={0.1}>
          <blockquote className="mt-14 max-w-3xl">
            <p className="text-white font-medium leading-relaxed" style={{ fontSize: 'clamp(17px, 2vw, 23px)' }}>
              {es
                ? 'XRPL es la mejor cadena del mundo para gobernar: decidir en grupo es parte de la red misma, sin código extra que pueda fallar. Nunca se construyó para hacer que el capital produzca. Así que dimos a cada cadena el trabajo que hace bien.'
                : 'XRPL is the best chain in the world for governance: deciding as a group is part of the network itself, with no extra code to fail. It was never built to make capital produce. So we gave each chain the job it does well.'}
            </p>
          </blockquote>
        </Reveal>

        {/* status + the Legacy door — a waitlist, honestly labelled, never a false "live" */}
        <Reveal delay={0.15}>
          <div
            className="mt-10 rounded-2xl p-6 flex flex-col md:flex-row items-start md:items-center gap-4 md:justify-between"
            style={{ border: '1px solid hsl(var(--volt) / 0.22)', background: 'hsl(var(--volt) / 0.05)' }}
          >
            <div className="text-sm text-white/60 leading-relaxed max-w-xl">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] block mb-1.5" style={{ color: GOLD_SOFT }}>
                {es ? 'Construido · abre pronto' : 'Built · opening soon'}
              </span>
              {es
                ? 'Los consejos se leen directamente del ledger, las constituciones se sellan desde tu navegador y las transferencias salen sin firmar — las firma tu consejo. Siempre con los costes a la vista antes de firmar. Estamos constituyendo los primeros consejos.'
                : 'Councils are read straight from the ledger, constitutions seal from your browser, and transfers ship unsigned — your council signs them. Always with the costs in plain sight before you sign. We are constituting the first councils.'}
            </div>
            <Magnetic strength={0.3} className="inline-block shrink-0">
              <a
                href="/early-access?intent=legacy"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-black transition-all hover:brightness-105"
                style={{ background: GOLD, boxShadow: '0 8px 30px hsl(var(--volt) / 0.28)' }}
              >
                {es ? 'Constituye tu Legacy' : 'Constitute your Legacy'}
              </a>
            </Magnetic>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── The walkthrough — pinned scrollytelling with a morphing instrument panel ─────────
type Chapter = {
  kind: ArtifactKind;
  es: [string, string, string]; // [label, title, desc] — expert register (default)
  en: [string, string, string];
  esSimple: [string, string]; // [title, desc] — plain-language register (simple mode)
  enSimple: [string, string];
  esCap: string; // one-line "in plain words" caption shown under the artifact in simple mode
  enCap: string;
};

// Five steps — everything here is verifiable inside the hackathon demo. The
// Goals, Delegation and Sovereignty chapters were removed (out of scope today);
// the V2.1 clarity pass then folded Flight Rules into Flight Plan (same
// review-before-signing message told twice). Restore a chapter only when it
// adds a step a judge can actually click through.
const CHAPTERS: Chapter[] = [
  {
    kind: 'map',
    es: ['Mapa Financiero', 'Ve dónde está cada activo', 'Todos tus activos, incluidos FXRP y FLR, en una sola vista en tiempo real. Balances, posiciones, lo que trabaja y lo que está parado.'],
    en: ['Capital Map', 'See where every asset is', 'All your assets, including FXRP and FLR, in one real-time view. Balances, positions, what is working and what is idle.'],
    esSimple: ['Todo tu dinero, en un sitio', 'Tengas lo que tengas y esté donde esté —cada moneda, cada app, cada red—, aquí lo ves junto y al momento. Nada que perseguir en diez pantallas.'],
    enSimple: ['All your money, in one place', 'Whatever you hold and wherever it sits — every coin, every app, every chain — you see it together, right now. Nothing to chase across ten screens.'],
    esCap: 'Cada punto es dinero tuyo en un sitio distinto; las líneas lo reúnen en una sola vista.',
    enCap: 'Each dot is your money in a different place; the lines gather it into one view.',
  },
  {
    kind: 'risk',
    es: ['Radar de Riesgo', 'Tu Health Factor, vigilado', 'Tu Health Factor, vigilado contra el precio de FTSO. Si baja del umbral que tú fijas, Astryum prepara el repay exacto para restaurarlo — firmas tú.'],
    en: ['Risk Radar', 'Your Health Factor, watched', 'Your Health Factor, watched against FTSO price. If it breaches the threshold you set, Astryum prepares the exact repay to restore it — you sign.'],
    esSimple: ['Un aviso antes de que haya problema', 'Te muestra, de 0 a 1, cómo de segura está cada posición. Si algo empieza a ponerse feo, lo ves a tiempo para decidir tú.'],
    enSimple: ['A heads-up before there is trouble', 'It shows you, from 0 to 1, how safe each position is. If something starts turning risky, you see it in time to decide for yourself.'],
    esCap: 'La aguja marca cómo de segura está tu posición: cuanto más a la derecha, más margen.',
    enCap: 'The needle shows how safe your position is: further right means more room to breathe.',
  },
  {
    kind: 'markets',
    es: ['Rutas de Earn', 'El rendimiento, con su fuente', 'Estrategias en Flare para FXRP y FLR. Cada cifra de rendimiento es dato del protocolo, con su fuente — nunca una promesa nuestra.'],
    en: ['Earn Routes', 'Yield, with its source', 'Flare strategies for FXRP and FLR. Every yield figure is protocol data, with its source — never a promise from us.'],
    esSimple: ['Cuánto rinde de verdad', 'Comparas de un vistazo lo que da el banco y lo que dan las opciones on-chain. El número siempre viene del protocolo, con su fuente — nunca es una promesa nuestra.'],
    enSimple: ['What it really earns', 'Compare at a glance what a bank gives you and what on-chain options give you. The figure always comes from the protocol, with its source — never a promise from us.'],
    esCap: 'Cada barra es un sitio donde puede estar tu dinero y lo que rinde. El dato es del protocolo, no nuestro.',
    enCap: 'Each bar is a place your money could sit and what it yields. The figure is the protocol’s, not ours.',
  },
  {
    kind: 'exec',
    es: ['Plan de Vuelo', 'Revisa y firma', 'Cada operación llega construida y simulada: qué hace, qué contrato toca, qué cuesta y qué chequeos pasa. Todo visible antes de firmar. Firmas tú — o no se ejecuta.'],
    en: ['Flight Plan', 'Review and sign', 'Every operation arrives built and simulated: what it does, which contract it touches, what it costs, which checks it passes. All visible before signing. You sign — or it doesn’t run.'],
    esSimple: ['Míralo antes; luego firmas tú', 'Antes de nada te enseñamos qué va a pasar, con qué contrato, cuánto cuesta y qué se comprueba — sin sorpresas ni letra pequeña. Nada se mueve hasta que lo firmas tú.'],
    enSimple: ['See it first; then you sign', 'First we show you what will happen, with which contract, what it costs and what gets checked — no surprises, no small print. Nothing moves until you sign it.'],
    esCap: 'Ves la simulación y el coste completos antes de firmar. El botón es tuyo: nada ocurre sin tu firma.',
    enCap: 'You see the full simulation and cost before signing. The button is yours: nothing happens without your signature.',
  },
  {
    kind: 'audit',
    es: ['Bitácora', 'Cada acción, trazable', 'Simulado antes de firmar. Registrado después de la liquidación — cada acción en tu historial de actividad, cada una con su transacción on-chain.'],
    en: ['Flight Log', 'Every action, traceable', 'Simulated before you sign. Recorded after settlement — every action in your activity log, each with its transaction on-chain.'],
    esSimple: ['Un registro de todo lo que pasa', 'Cada movimiento queda apuntado con su hora y su comprobante on-chain. Puedes volver atrás y revisar lo que quieras, cuando quieras.'],
    enSimple: ['A record of everything that happens', 'Every move is logged with its time and its on-chain receipt. You can go back and check anything, whenever you want.'],
    esCap: 'Cada línea es una acción, con su hora y su comprobante. Nada se pierde.',
    enCap: 'Each line is one action, with its time and its receipt. Nothing gets lost.',
  },
];

// ─── Velocity-reactive spine (sui.io-style) ───────────────────────────────────────────
// A dotted vertical axis in the gutter between the copy and the instrument panel, with a
// crisp white "playhead" square that stays at viewport centre while the dots flow past.
// The square stretches into a comet-streak proportional to scroll speed (either direction)
// and relaxes back to a square at rest — the dots give the sense of motion, the stretch
// gives it velocity. Pure motion values (no re-renders); collapses to a static axis under
// prefers-reduced-motion. lg+ only, where the three-column layout opens a real gutter.
function WalkthroughSpine() {
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const vel = useVelocity(scrollY);
  // Smooth the raw px/s velocity so the streak eases rather than snaps.
  const smooth = useSpring(vel, { stiffness: 350, damping: 45, mass: 0.6 });
  // Map |velocity| → vertical stretch + glow. ±2400 px/s ≈ a brisk flick.
  const scaleY = useTransform(smooth, [-2400, 0, 2400], [5, 1, 5], { clamp: true });
  const glow = useTransform(smooth, [-2400, 0, 2400], [1, 0.4, 1], { clamp: true });

  return (
    <div className="hidden lg:block absolute top-0 bottom-0 pointer-events-none" style={{ right: -28, width: 3 }} aria-hidden>
      {/* dotted axis — square dots, scrolls with the content, faded at both ends */}
      <div
        className="absolute inset-y-0 left-1/2 -translate-x-1/2"
        style={{
          width: 2,
          backgroundImage: 'repeating-linear-gradient(to bottom, rgba(255,255,255,0.22) 0 2px, transparent 2px 11px)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 6%, black 94%, transparent)',
          maskImage: 'linear-gradient(to bottom, transparent, black 6%, black 94%, transparent)',
        }}
      />
      {/* sticky playhead — pinned at viewport centre as the walkthrough scrolls through it */}
      <div className="sticky" style={{ top: '50vh' }}>
        <motion.div
          className="absolute left-1/2 top-0"
          style={{ width: 11, height: 11, x: '-50%', y: '-50%', scaleY: reduce ? 1 : scaleY, background: '#fff', borderRadius: 1.5 }}
        >
          <motion.span
            className="absolute inset-0"
            style={{
              borderRadius: 'inherit',
              opacity: reduce ? 0.7 : glow,
              boxShadow: '0 0 12px 1px hsl(var(--volt) / 0.95), 0 0 26px hsl(var(--volt) / 0.5)',
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}

// ─── The walkthrough — the original scroll flow, with the title bar pinned ───────────
// The copy blocks scroll past the sticky rail + instrument panel exactly as before
// (spine, playhead and all). What pins is the HEADER: on md+ a compact island bar
// (kicker + title + the single Expert/Simple switch) sticks just under the floating
// site header for the whole section, so the depth switch never scrolls out of reach.
// The console's inner toggle stays removed — one switch, always visible.
const BAR_TOP = 84; // px — clears the compact floating site header
const UNDER_BAR = 176; // px — sticky offset for rail + console, below the pinned bar

function Narrative({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [simple, setSimple] = useState(true);
  const blocks = useRef<(HTMLDivElement | null)[]>([]);
  const colRef = useRef<HTMLDivElement>(null);

  // Scroll-spy: highlight the chapter whose block crosses the viewport centre.
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.idx);
            if (!Number.isNaN(idx)) setActive(idx);
          }
        });
      },
      { rootMargin: '-48% 0px -48% 0px', threshold: 0 },
    );
    blocks.current.forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, []);

  // Continuous gold progress line in the rail, scrubbed by scroll through the column.
  const { scrollYProgress } = useScroll({ target: colRef, offset: ['start 0.4', 'end 0.6'] });
  const railH = useSpring(useTransform(scrollYProgress, [0, 1], ['0%', '100%']), { stiffness: 120, damping: 30 });

  const subtitle = es
    ? 'Observa, mide, decide y firma — cada paso con su instrumento. El sistema entero prepara y registra; la firma sigue siendo solo tuya.'
    : 'Observe, measure, decide and sign — each step with its instrument. The whole system prepares and records; the signature stays yours alone.';

  return (
    <section className="relative py-24 md:py-36 px-6 md:px-10 lg:px-16">
      <div className="max-w-6xl mx-auto">
        {/* md+: the pinned title bar. NOTE: no transform-animating wrapper here —
            an animated ancestor transform would break position:sticky. */}
        <div className="hidden md:block sticky z-30" style={{ top: BAR_TOP }}>
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-8%' }}
            transition={{ duration: 0.6 }}
            className="flex items-center justify-between gap-4 rounded-2xl px-5 py-3"
            style={{
              border: '1px solid rgba(255,255,255,0.09)',
              background: 'rgba(12,11,9,0.72)',
              backdropFilter: 'blur(16px)',
            }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <AsteroidGlyph size={20} />
              <div className="min-w-0">
                <div className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {es ? 'El recorrido' : 'The walkthrough'}
                </div>
                <h2 className="font-bold text-white truncate" style={{ fontSize: 'clamp(1.1rem, 1.7vw, 1.5rem)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                  {es ? 'Un sistema, de principio a fin' : 'One system, end to end'}
                </h2>
              </div>
            </div>
            {/* the ONE explanation-depth switch — pinned with the title */}
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-[11px] text-white/35 leading-tight">{es ? '¿Nuevo en esto?' : 'New to this?'}</span>
              <ModeToggle simple={simple} setSimple={setSimple} lang={lang} />
            </div>
          </motion.div>
        </div>
        <Reveal>
          <p className="hidden md:block mt-6 text-white/45 max-w-2xl" style={{ fontSize: 'clamp(14px, 1.3vw, 17px)' }}>
            {subtitle}
          </p>
        </Reveal>

        {/* <md: the original static header (small screens don't pay for a pinned bar) */}
        <Reveal>
          <div className="md:hidden flex flex-col gap-6">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <AsteroidGlyph size={18} />
                <span className="text-[11px] font-mono uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                  {es ? 'El recorrido' : 'The walkthrough'}
                </span>
              </div>
              <h2 className="font-bold text-white text-balance" style={{ fontSize: 'clamp(1.9rem, 4vw, 3.2rem)', letterSpacing: '-0.03em', lineHeight: 1.08 }}>
                {es ? 'Un sistema, de principio a fin' : 'One system, end to end'}
              </h2>
              <p className="mt-4 text-white/45 max-w-2xl" style={{ fontSize: 'clamp(14px, 1.3vw, 17px)' }}>{subtitle}</p>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="text-[11px] text-white/35 leading-tight">{es ? '¿Nuevo en esto?' : 'New to this?'}</span>
              <ModeToggle simple={simple} setSimple={setSimple} lang={lang} />
            </div>
          </div>
        </Reveal>

        <div className="mt-12 grid md:grid-cols-[210px,1fr] lg:grid-cols-[240px,1fr,minmax(0,440px)] gap-10 lg:gap-14">
          {/* sticky rail — offset below the pinned title bar */}
          <div className="hidden md:block">
            <nav className="sticky" style={{ top: UNDER_BAR }}>
              <p className="text-[13px] text-white/35 mb-6 leading-snug max-w-[200px]">
                {es ? 'Cinco pasos, un mismo sistema.' : 'Five steps, one system.'}
              </p>
              <ol className="relative pl-0.5">
                <span className="absolute left-[10px] top-3 bottom-3 w-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
                <motion.span
                  className="absolute left-[10px] top-3 w-px origin-top"
                  style={{ height: railH, background: `linear-gradient(${GOLD}, ${GOLD_SOFT})` }}
                />
                {CHAPTERS.map((c, i) => {
                  const [label] = es ? c.es : c.en;
                  const on = i === active;
                  const done = i < active;
                  return (
                    <li key={c.kind}>
                      <button
                        onClick={() => blocks.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                        className="group relative flex items-center gap-3 w-full text-left py-2"
                      >
                        <span
                          className="relative z-10 w-[21px] h-[21px] rounded-full flex items-center justify-center shrink-0 transition-all duration-300"
                          style={{
                            border: `1px solid ${on ? GOLD : done ? 'hsl(var(--volt) / 0.4)' : BORDER_STRONG}`,
                            background: on ? GOLD : '#0c0c0a',
                          }}
                        >
                          {done ? (
                            <svg width="10" height="10" viewBox="0 0 11 11" fill="none">
                              <path d="M2 5.5L4.5 8L9 3" stroke={GOLD} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full transition-colors" style={{ background: on ? '#000' : 'rgba(255,255,255,0.3)' }} />
                          )}
                        </span>
                        <span className="font-mono text-[11px] w-5 shrink-0 transition-colors" style={{ color: on ? GOLD : done ? 'hsl(var(--volt) / 0.45)' : 'rgba(255,255,255,0.25)' }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="text-sm transition-colors truncate" style={{ color: on ? '#fff' : done ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.4)' }}>{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>

          {/* scrolling copy column */}
          <div ref={colRef} className="relative">
            <WalkthroughSpine />
            {CHAPTERS.map((c, i) => {
              const [label, title, desc] = es ? c.es : c.en;
              const [sTitle, sDesc] = es ? c.esSimple : c.enSimple;
              const cap = es ? c.esCap : c.enCap;
              return (
                <div
                  key={c.kind}
                  data-idx={i}
                  ref={(el) => {
                    blocks.current[i] = el;
                  }}
                  className="min-h-[72vh] flex items-center py-12"
                >
                  <div className="w-full">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="font-mono text-[12px]" style={{ color: GOLD }}>{String(i + 1).padStart(2, '0')}</span>
                      <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/35">{label}</span>
                    </div>
                    {/* title + description crossfade between the expert and simple registers */}
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={simple ? 'simple' : 'expert'}
                        initial={reduce ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.32, ease: EASE }}
                      >
                        <h3 className="font-bold text-white text-balance" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                          {simple ? sTitle : title}
                        </h3>
                        <p className="mt-4 text-white/50 leading-relaxed max-w-md" style={{ fontSize: 'clamp(14px, 1.3vw, 16px)' }}>
                          {simple ? sDesc : desc}
                        </p>
                      </motion.div>
                    </AnimatePresence>
                    {/* inline artifact for md and below (the sticky panel takes over on lg) */}
                    <motion.div
                      className="lg:hidden mt-8"
                      initial={{ opacity: 0, y: 24 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-15%' }}
                      transition={{ duration: 0.7, ease: EASE }}
                    >
                      <ChapterArtifact
                        kind={c.kind}
                        lang={lang}
                        simple={simple}
                        caption={cap}
                        meta={`instr ${String(i + 1).padStart(2, '0')} / ${String(CHAPTERS.length).padStart(2, '0')}`}
                      />
                    </motion.div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* sticky morphing instrument panel (lg+) — a console housing tied to the rail */}
          <div className="hidden lg:block">
            <div className="sticky" style={{ top: UNDER_BAR }}>
              <div
                className="rounded-2xl p-4"
                style={{ border: `1px solid ${BORDER}`, background: 'rgba(10,10,9,0.5)', backdropFilter: 'blur(8px)' }}
              >
                {/* console header — mirrors the rail: chapter index, label, jump ticks.
                    (The depth switch lives ONLY in the pinned title bar now.) */}
                <div className="flex items-center justify-between px-1.5 pb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] shrink-0" style={{ color: GOLD }}>
                      {String(active + 1).padStart(2, '0')}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35 truncate">
                      {(es ? CHAPTERS[active].es : CHAPTERS[active].en)[0]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {CHAPTERS.map((c, i) => (
                      <button
                        key={c.kind}
                        onClick={() => blocks.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                        aria-label={(es ? c.es : c.en)[0]}
                        className="h-[3px] rounded-full transition-all duration-300"
                        style={{
                          width: i === active ? 18 : 7,
                          background: i === active ? GOLD : i < active ? 'hsl(var(--volt) / 0.4)' : 'rgba(255,255,255,0.14)',
                        }}
                      />
                    ))}
                  </div>
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={active}
                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -18, scale: 0.98 }}
                    transition={{ duration: 0.45, ease: EASE }}
                  >
                    <ChapterArtifact
                      kind={CHAPTERS[active].kind}
                      lang={lang}
                      simple={simple}
                      caption={es ? CHAPTERS[active].esCap : CHAPTERS[active].enCap}
                      meta={`instr ${String(active + 1).padStart(2, '0')} / ${String(CHAPTERS.length).padStart(2, '0')}`}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Referred docs (GitBook) ────────────────────────────────────────────────────────
// Restored at the user's request. NOTE: the links point at astryum.gitbook.io —
// they will 404 until that GitBook space is published, so publish it (or repoint
// DOCS_BASE) before a judges' pass.
function DocsSection({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const docs = [
    {
      href: `${DOCS_BASE}/overview`,
      es: ['Qué es Astryum', 'Visión, misión y cómo funciona el control plane no-custodial.'],
      en: ['What is Astryum', 'Vision, mission, and how the non-custodial control plane works.'],
    },
    {
      href: `${DOCS_BASE}/flare`,
      es: ['Integración con Flare', 'FXRP, FLR, FAssets y por qué Flare es la base de Astryum V1.'],
      en: ['Flare integration', 'FXRP, FLR, FAssets, and why Flare is the foundation of Astryum V1.'],
    },
    {
      href: `${DOCS_BASE}/roadmap`,
      es: ['Roadmap e hitos', 'Qué construimos ahora y qué viene después.'],
      en: ['Roadmap & milestones', 'What we build now and what comes next.'],
    },
    {
      href: `${DOCS_BASE}/security`,
      es: ['Seguridad & invariantes', 'Nunca firmamos, nunca custodiamos. Las reglas que el código nunca viola.'],
      en: ['Security & invariants', 'We never sign, we never custody. The rules the code never breaks.'],
    },
  ];
  return (
    <section id="docs" className="relative py-24 md:py-36 px-6 md:px-10 lg:px-16 scroll-mt-20">
      <div className="max-w-6xl mx-auto">
        <Reveal>
          <h2 className="font-bold text-white text-balance" style={{ fontSize: 'clamp(1.8rem, 3.6vw, 3rem)', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            {es ? 'El manual de vuelo' : 'The flight manual'}
          </h2>
          <p className="mt-4 text-white/45 max-w-2xl" style={{ fontSize: 'clamp(14px, 1.3vw, 17px)' }}>
            {es
              ? 'Donde la metáfora da paso a la ingeniería: cómo funciona por dentro, qué construimos hoy y qué viene después.'
              : 'Where the metaphor gives way to the engineering: how it works under the hood, what we build today and what comes next.'}
          </p>
        </Reveal>
        <div className="mt-10 grid sm:grid-cols-2 gap-5">
          {docs.map((d, i) => {
            const [title, desc] = es ? d.es : d.en;
            return (
              <Reveal key={d.href} delay={i * 0.1}>
                <SpotlightCard className="rounded-2xl">
                  <a
                    href={d.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start justify-between gap-4 rounded-2xl p-6 transition-transform hover:-translate-y-1"
                    style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}
                  >
                    <div>
                      <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">{title}</h3>
                      <p className="text-sm text-white/45 leading-relaxed">{desc}</p>
                    </div>
                    <span className="shrink-0 mt-1 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" style={{ color: GOLD }}>
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                        <path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </a>
                </SpotlightCard>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Signature break — the one light beat. The cream field breathes in as the ────────
// section crosses the viewport and breathes back out as it leaves: a scroll-linked
// fade that replays on every pass, in both directions — no burst, no one-shot. A
// hand-drawn signature draws itself under the promise. Static under reduced motion.
// The section itself is TRANSPARENT: before the light arrives you keep seeing the
// page's own star field, never a dead black slab.
// ─── The Astryum principle — the V2 manifesto's closing thought, restored ────────────
// (founder 2026-07-22: "el toque profundo"). One compact beat between the journey
// and the light close: the quote reveals word by word as you scroll through it.
// Exported for preservation (unmounted 2026-07-25 — the quote lives in the
// journey finale now; see the mount comment near SignatureBreak).
export function PrincipleBreak({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  return (
    <section className="relative py-28 md:py-40 px-6">
      <div className="max-w-3xl mx-auto text-center">
        <ScrollRevealText
          className="text-white font-light leading-snug tracking-tight text-balance text-[24px] md:text-[34px] lg:text-[40px]"
          text={
            es
              ? '“El dinero siempre debe fluir. Cuando el dinero está en movimiento, el dinero trabaja para ti.”'
              : '“Money must always flow. When money is in motion, money works for you.”'
          }
        />
        <Reveal delay={0.1}>
          <div className="mt-6 text-sm font-mono" style={{ color: GOLD }}>
            {es ? '— un principio de Astryum' : '— an Astryum principle'}
          </div>
          <p className="mt-2 text-xs font-mono text-white/30">
            {es
              ? 'Nada permanece quieto en el universo. Tu capital tampoco debería.'
              : 'Nothing stays still in the universe. Neither should your capital.'}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// How far the lit field's own edges are feathered, in px — the guarantee that
// the beat never ends on a line, whatever the bloom above is doing. Measured:
// resting the gradient exactly ON the edge (rather than a couple of percent
// outside it) took the worst row-to-row luminance step at the seam from 33.75
// down to 3.73.
const LIGHT_FEATHER = 150;
// Where the star hangs, horizontally. Off-centre on two counts: dead centre put
// it directly behind the scroll cue (which is also centred and also fixed), and
// a light source on the axis of symmetry reads as a lamp rather than as a body
// that happens to be passing.
const STAR_X = 63;
// How far the star lets the cursor pull it, in px. Small: this is a body a long
// way off that happens to be bright, not a cursor follower.
const STAR_LEAN = 26;
// How far above the section the lit field reaches, in svh. This is the room the
// bloom needs in order to fade out on its own terms instead of against an edge.
const FIELD_ROOF = 60;
// The star's rest position, in percent of that taller box — used by the field's
// own warm centre so the ground is brightest under the source.
const STAR_Y_REST = 41;

function SignatureBreak({ lang, governor, venue = false }: { lang: Lang; governor?: GovernorId; venue?: boolean }) {
  const es = lang === 'es';
  // Los mundos de entidad no cierran con «entra en la beta»: un exchange en
  // piloto o una entidad en preparación tienen una puerta de contacto, y el
  // agente, que está en diseño, la lista de espera. El venue pide la
  // verificación: es el único que llega a esta luz desde el otro lado.
  const closeDoor = venue
    ? { label: es ? 'Solicitar la verificación' : 'Request verification', href: VENUE_MAILTO }
    : governor === 'business' || governor === 'exchange'
      ? { label: es ? 'Hablemos' : 'Talk to us', href: CONTACT_MAILTO }
      : governor === 'agent'
        ? { label: es ? 'Avísame cuando abra' : 'Tell me when it opens', href: EARLY_ACCESS_URL }
        : { label: es ? 'Entra en la beta' : 'Enter the beta', href: BETA_URL };
  const passSheet = venue ? VENUE_PASS : governor ? GOVERNOR_BY_ID[governor].pass : undefined;
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });

  // ONE DIAL for the whole beat: 0 is night, 1 is full daylight, and it runs up
  // on the way in and back down on the way out. That is the founder's ask of
  // 2026-08-22 — "que el fondo blanco desaparezca según bajas… exactamente la
  // misma animación que cuando entra, pero de salida" — and driving everything
  // from a single symmetric curve is what makes the mirror exact instead of
  // hand-matched. It also retires the opaque dawn ramp: the light no longer
  // needs an edge to hide behind, because it is gone by the time the footer
  // arrives.
  // A STAR PASSES CLOSE (founder 2026-08-22 — "en vez del recuadro blanco, que
  // se ilumine la pagina de forma natural y organica gracias a una estrella que
  // queda cerca").
  //
  // Every earlier version of this beat lit the page with a RECTANGLE, and a
  // rectangle has edges — which is why three passes were spent fighting the
  // seam where cream met night. The edges came from the shape, not the tuning.
  // Light from a point source has no edges: it falls off, and falloff is the
  // one boundary an eye never reads as a cut.
  //
  // THE ORDER IS THE WHOLE TRICK. A first attempt raised the star and its glow
  // on the same dial, and the star was invisible: it only ever existed on top
  // of the cream it had just created, where a pure-white core is barely 6%
  // brighter than the ground — a source cannot out-shine what it lights when
  // its ceiling is that close. So the star ARRIVES FIRST. It climbs into a
  // still-dark page, where it reads as unmistakably a star, and only then does
  // it flare and flood the page. By the time it is sitting on cream the eye
  // already knows what it is looking at, and needs no contrast to keep it.
  //
  //   0.02-0.12  the star rises into the night, growing
  //   0.12-0.30  it flares, and the bloom opens fast underneath it
  //   0.30-0.50  full light, the star blown out at the top of the frame
  //   0.50-0.80  the bloom closes and the star goes with it
  // ONE DAMPED CLOCK FOR THE WHOLE BEAT (founder 2026-08-24: "si se hace scroll
  // muy rapido parece una flashbang").
  //
  // The founder asked whether to bring back page-wide smooth scrolling. No —
  // that was removed on purpose in July ("el navegador es el unico dueno de la
  // rueda"), every part of the scrollytelling reads native scrollY, and putting
  // it back is an enormous regression surface for a problem that lives in one
  // section. And it would not even fix this: a fast flick still crosses the
  // same range of progress, just eased.
  //
  // The fix is the same idea, scoped. Everything in this beat reads `eased`
  // instead of raw progress, so the light is driven by a spring and CANNOT rise
  // faster than the spring allows. Slam the wheel and the page still takes its
  // ~700ms to come up — the flash is rate-limited by physics, not by hoping the
  // visitor scrolls politely. It costs one motion value and touches nothing
  // outside this component.
  const eased = useSpring(scrollYProgress, { stiffness: 42, damping: 26, mass: 0.8 });

  // …and a PAUSE before the flood. The star finishes arriving at 0.11 and
  // nothing happens until 0.24: a held beat where there is plainly a star up
  // there and the page is still dark. That gap is what turns a flashbang into
  // an event — you get told it is coming before it comes.
  // The hold runs to 0.62, not 0.56: the signature draws from 0.42 to 0.58 and
  // at the shorter hold its paraph was still being written while the copy had
  // already started fading out from under it.
  const beat = useTransform(eased, [0.24, 0.42, 0.62, 0.88], [0, 1, 1, 0]);
  const starLife = useTransform(eased, [0.02, 0.11, 0.72, 0.9], [0, 1, 1, 0]);
  // High in the section on purpose: this is the band that is on screen while
  // the section is still entering, so the star is visible before its light is.
  // In percent of the FIELD's box, not the section's — the star and the bloom
  // have to be quoted in the same frame or the light detaches from the body.
  // These are the old 17%→7% of the section, re-expressed: with a 60svh roof
  // over a 120svh section, (60 + 0.17x120)/180 = 44.7 and (60 + 0.07x120)/180 = 38.
  const starY = useTransform(eased, [0.02, 0.9], [44.7, 38]);
  const starYCss = useTransform(starY, (v: number) => `${v.toFixed(2)}%`);
  // The pointer, on the SAME smoothed signal the hero's solar system rides, so
  // the whole page leans as one thing. The star follows the cursor rather than
  // fleeing it — a near body pulled a little off its line reads as physical;
  // pushed away it reads as a repelling magnet.
  const { x: pointerX, y: pointerY } = usePointerParallax(70, 20);
  const leanX = useTransform(pointerX, [-0.5, 0.5], [-STAR_LEAN, STAR_LEAN]);
  const leanY = useTransform(pointerY, [-0.5, 0.5], [-STAR_LEAN * 0.6, STAR_LEAN * 0.6]);
  // It flares late and hard — most of the size arrives with the flood, which is
  // what makes a flyby read as a flyby and not as a dimmer being turned up.
  // Through the pause it only swells a little (0.46 → 0.54): enough to read as
  // approaching, not enough to be the event. The flare belongs to the flood.
  const starScale = useTransform(eased, [0.02, 0.11, 0.24, 0.42, 0.9], [0.28, 0.46, 0.54, 1, 1.18]);
  // The bloom: a soft-edged disc centred on the star, opening as it flares.
  const fieldMask = useTransform([beat, starY, leanX, leanY], ([b, y, lx, ly]: number[]) => {
    // A TIGHT falloff, and that is the lesson of this whole section: cream at
    // half strength over a dark sky averages to grey, so the wider the
    // transition band the more of the screen is mud. ~13% of the gradient box
    // is about the 200px the linear feather used, which was measured to work.
    const core = -14 + b * 62;
    return [
      // …centred on where the star ACTUALLY is, pointer lean included. Leaving
      // the bloom behind while the body drifted was the one thing guaranteed to
      // break the illusion: light that does not travel with its source stops
      // being light and becomes a stain.
      `radial-gradient(130vw 156svh at calc(${STAR_X}% + ${lx.toFixed(0)}px) calc(${y.toFixed(1)}% + ${ly.toFixed(0)}px), #000 ${core.toFixed(1)}%, rgba(0,0,0,0.55) ${(core + 5).toFixed(1)}%, transparent ${(core + 13).toFixed(1)}%)`,
      // …still intersected with the box's feathered edges, but they sit a long
      // way off now (FIELD_ROOF above, the runway below), so they only ever
      // catch light that has already faded to nothing. Kept as the backstop:
      // whatever the bloom does, the field can never end on a cut.
      `linear-gradient(180deg, transparent 0px, #000 ${LIGHT_FEATHER}px, #000 calc(100% - ${LIGHT_FEATHER}px), transparent 100%)`,
    ].join(', ');
  });
  const fieldOpacity = useTransform(beat, [0, 0.06, 1], [0, 1, 1]);
  // The copy waits for the light to reach it — dark ink must never sit on a
  // dark sky, in either direction.
  const copyOpacity = useTransform(beat, [0.55, 0.82], [0, 1]);
  const copyY = useTransform(beat, [0.55, 0.82], [26, 0]);
  // The signature is sequenced like a real hand: the name writes itself, the
  // paraph loops over and sweeps back underneath, then the pen lifts to cross
  // the t and finally dots off.
  // THE SIGNATURE RUNS ON ITS OWN CLOCK (founder 2026-08-24: "la firma se tiene
  // que animar independiente al scroll… a la que salte el flashbang inicia la
  // animacion").
  //
  // It used to be scrubbed by scroll, which worked only while the light arrived
  // at the same speed you did. Now that the flood is damped and lands lower, a
  // quick scroll blew straight past the range the strokes lived in and the hand
  // never got to write. A signature is a GESTURE, not a scrub: it needs its own
  // seconds.
  //
  // So the flash arms it and it plays out in real time. The hysteresis is
  // deliberate — armed at 0.55 of the beat, disarmed below 0.2 — so coming back
  // up the page and down again writes it again instead of finding it already
  // done. Wide enough apart that no jitter can flicker it.
  const [signing, setSigning] = useState(false);
  useMotionValueEvent(beat, 'change', (v) => {
    if (v > 0.55) setSigning(true);
    else if (v < 0.2) setSigning(false);
  });
  // One hand, four movements: the name, the paraph that sweeps back under it,
  // the pen lifting to cross the t, and the dot.
  const ink = (delay: number, duration: number) => ({
    initial: false as const,
    animate: { pathLength: reduce || signing ? 1 : 0 },
    transition: reduce ? { duration: 0 } : { duration, delay, ease: 'easeInOut' as const },
  });

  // With the journey on, the boarding desk lives INSIDE this light beat: one
  // cream fold, one signature, one door — the standalone FinalCta is gone and
  // "you always sign" is said exactly once (founder 2026-07-22). The id is the
  // JourneyTimeline's parking sensor: the flight-plan HUD hides before this
  // light field enters the viewport (founder 2026-07-25).
  return (
    // NO overflow-hidden. It used to clip the star's corona dead flat against
    // the section's top edge (founder 2026-08-22: "queda cortada la estrella").
    // Nothing in here overflows sideways — the lit field is inset-0 — and the
    // glow reaching UP into the night above is not a leak, it is the point:
    // light from a body this close does not stop at a section boundary.
    <section ref={ref} id="light-beat" className="relative">
      {/* THE LIT FIELD REACHES ABOVE THE SECTION. Its box used to be exactly the
          section's, and that is what drew the line the founder spotted: the
          bloom is round, its container is not, so the feather on the box's top
          edge sliced the dome off flat. Nothing was wrong with the glow — it
          was hitting a ceiling.
          Extending the box upward moves that ceiling out of frame entirely and
          the falloff gets to finish in open air. It can overflow now that the
          section no longer clips, and light spilling into the night above is not
          a leak: it is what a source this close to a page actually does. */}
      {/* pointer-events-none: the box reaches FIELD_ROOF svh ABOVE the section,
          and at opacity 0 it still caught the pointer — every card of the doors
          section above was unclickable (founder 2026-09-20: «no funcionan los
          botones»). Light is looked at, never clicked. */}
      <motion.div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        aria-hidden
        style={{
          top: `-${FIELD_ROOF}svh`,
          opacity: reduce ? 1 : fieldOpacity,
          // Lit ground, not a painted panel: brightest under the star and
          // cooling with distance, so the illumination has a source.
          background:
              // Warmed toward a low sun, then warmed again and taken down a
            // couple of points of white (founder 2026-08-25: "algo mas
            // amarillento, que no pegue tanto efecto de flashbang").
            //
            // The glare was never the size of the bloom, it was its HUE: the
            // hot end of every layer sat on pure #FFFFFF, and white at full
            // strength is what an eye reads as a flash. Nothing here is white
            // any more — the core tops out at #FFF7D6 and the corona at
            // #FFF6CE, so the same amount of light arrives as yellow instead of
            // as a camera flash. The ground comes down with them, which is what
            // keeps the star's small edge over what it lights (measured before:
            // the gap is only a few points, and the star reads by ARRIVING
            // FIRST, not by out-shining anything).
            // Sized in viewport units, not in percentages of the box: the box
            // is half again as tall now, and percentages would have stretched
            // the whole falloff along with it.
            `radial-gradient(130vw 156svh at ${STAR_X}% ${STAR_Y_REST}%, #FDF4DA 0%, #F8E9C0 34%, #EFDCA6 66%, #DDC189 100%)`,
          ...(reduce
            ? {}
            : {
                WebkitMaskImage: fieldMask as unknown as string,
                maskImage: fieldMask as unknown as string,
                // intersect: lit only where BOTH the bloom and the edge feather
                // say it is
                WebkitMaskComposite: 'source-in',
                maskComposite: 'intersect',
              }),
        }}
      >
        {/* stars in negative — faint dark specks on the light field */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(20,18,14,0.17) 1px, transparent 1.5px)',
            backgroundSize: '40px 40px',
            WebkitMaskImage: 'radial-gradient(120% 90% at 50% 42%, #000 25%, transparent 85%)',
            maskImage: 'radial-gradient(120% 90% at 50% 42%, #000 25%, transparent 85%)',
          }}
          aria-hidden
        />
        {/* The opaque dawn ramp that used to close this field is gone (founder
            2026-08-22: it did not convince). The light does not need an edge to
            hide behind now — it recedes the same way it arrived, so by the time
            the footer is on screen there is no cream left to hand over. */}
      </motion.div>
      {/* THE STAR — corona, diffraction cross and core: the three things an eye
          uses to read "very bright, very close". Not rendered at all under
          reduced motion: with nothing to animate it would just be a large white
          blob parked on a static cream field, and the field alone is what that
          preference has always been given here.
          It is painted OUTSIDE the lit field, on top of it. Inside, it was
          masked by the very bloom it casts and washed out to nothing. Out here
          it also gets to arrive BEFORE its light does — you watch it come up
          through the dark, and then the page floods. */}
      {!reduce && (
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{ top: `-${FIELD_ROOF}svh`, zIndex: 1 }}
        aria-hidden
      >
      <motion.div
        className="absolute"
        style={{
          left: `${STAR_X}%`,
          top: starYCss,
          scale: starScale,
          opacity: starLife,
          width: 0,
          height: 0,
        }}
      >
      {/* Three nested movements, each on its own layer so none of them fights
          the others: the shell above is the scroll (where the star is in its
          pass), this one is the cursor, and the one inside is the idle drift
          that keeps it from ever being perfectly still. */}
      <motion.div style={{ x: leanX, y: leanY }}>
      <motion.div
        animate={{ x: [0, 9, -6, 0], y: [0, -7, 5, 0] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* corona — the wide soft one that does the illuminating */}
        <span
          className="absolute rounded-full"
          style={{
            width: 820,
            height: 820,
            left: -410,
            top: -410,
            background:
              'radial-gradient(circle, #FFF6CE 0%, rgba(255,243,193,0.88) 5%, rgba(255,229,150,0.55) 14%, rgba(255,208,110,0.26) 32%, rgba(255,186,80,0) 62%)',
          }}
        />
        {/* the diffraction cross — long and thin, so it reads as a flare and
            not as a plus sign. It is the part that stays legible once the core
            is sitting on cream: spikes reach out past the bright zone. */}
        <motion.svg
          className="absolute"
          width="1000"
          height="1000"
          viewBox="-500 -500 1000 1000"
          style={{ left: -500, top: -500, overflow: 'visible' }}
          fill="none"
          // the flare shimmers rather than sits: a few degrees, very slowly
          animate={{ rotate: [0, 3.5, -2.5, 0], scale: [1, 1.05, 0.97, 1] }}
          transition={{ duration: 13, repeat: Infinity, ease: 'easeInOut' }}
        >
          <defs>
            <linearGradient id="lp-star-h" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#FFCB6A" stopOpacity="0" />
              <stop offset="50%" stopColor="#FFF0BE" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#FFCB6A" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lp-star-v" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FFCB6A" stopOpacity="0" />
              <stop offset="50%" stopColor="#FFF0BE" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#FFCB6A" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M-470 0 L0 -6 L470 0 L0 6 Z" fill="url(#lp-star-h)" />
          {/* asymmetric on purpose: long upward, short down. The downward
              half used to rake straight through the headline like a scratch. */}
          <path d="M0 -330 L5 0 L0 130 L-5 0 Z" fill="url(#lp-star-v)" />
        </motion.svg>
        {/* the core — small, white-hot, the only hard-edged thing here, and it
            twinkles: a star that holds a perfectly constant brightness is the
            one thing real stars never do */}
        <motion.span
          className="absolute rounded-full"
          animate={{ scale: [1, 1.11, 0.96, 1], opacity: [1, 0.82, 1, 1] }}
          transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            width: 40,
            height: 40,
            left: -20,
            top: -20,
            background: 'radial-gradient(circle, #FFF7D6 0%, #FFEDB0 40%, rgba(255,214,120,0) 74%)',
          }}
        />
      </motion.div>
      </motion.div>
      </motion.div>
      </div>
      )}
      {/* svh, not vh — on iOS 100vh is the URL-bar-hidden height and left dead
          scroll at the page close */}
      {/* The beat ends where its last element ends. There is nothing to clear
          any more — the light leaves by receding, not by hiding behind a band. */}
      <div className="relative flex flex-col items-center justify-center px-6 pt-28 md:pt-32 pb-24 md:pb-28" style={{ minHeight: '100svh' }}>
        <motion.div
          className="relative text-center max-w-3xl"
          style={reduce ? undefined : { opacity: copyOpacity, y: copyY }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_ICON} alt="" aria-hidden style={{ width: 44, height: 'auto' }} className="mx-auto mb-6 opacity-80" />
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] mb-5" style={{ color: 'hsl(var(--volt-deep))' }}>
            {es ? 'No-custodia' : 'Non-custodial'}
          </div>
          <h2 className="font-bold text-balance" style={{ color: '#141210', fontSize: 'clamp(2.4rem, 6vw, 5rem)', letterSpacing: '-0.035em', lineHeight: 1.02 }}>
            {es ? 'Tú siempre firmas.' : 'You always sign.'}
          </h2>
          {/* the signature — cursive "Astryum": a peaked capital A with a loop
              crossbar, the tall t (crossed on the pen-lift), the y's descender
              loop, and a paraph that turns over the exit stroke and sweeps
              back clean UNDER the name — it never strikes the letters */}
          <svg viewBox="0 0 285 96" width="270" className="mx-auto mt-3 max-w-full h-auto" fill="none" aria-hidden>
            <motion.path
              d="M 14 66 C 20 52, 30 22, 40 13 C 44 9.5, 48 16, 51 30 C 54 43, 57 57, 60 63.5 C 55 67, 47 60, 47 52 C 47 45, 54 42, 59 45 C 62 47, 62 50, 61.5 52.5 C 62.5 55, 65 56, 68 54 C 72 51, 76 46, 79 46.5 C 82 47, 82 51, 79.5 53.5 C 77 56, 74.5 58.5, 76.5 61.5 C 78.5 64.5, 84 63, 87 58.5 C 90 54, 93.5 40, 95.5 30 C 96.5 25, 99.5 24.5, 100 29 C 101 36.5, 98.5 55, 103 61.5 C 106 65.5, 111 62, 113.5 57 C 116.5 52, 120 47.5, 123 47 C 126 46.5, 126.5 49.5, 125.5 52.5 C 124.5 55.5, 123.5 58.5, 125.5 61 C 128 63.5, 132 61.5, 134.5 57.5 C 137.5 53, 141 47, 144.5 46 C 148 45.2, 149 49, 148 53 C 147 57, 145.5 61, 146.5 65 C 148 70, 146 76, 140.5 78 C 135.5 79.5, 132.5 75.5, 135 70.5 C 137.5 65.5, 144 61, 151 57.5 C 155 54.5, 159 48, 162.5 46.5 C 165 45.5, 166 48, 165 51.5 C 164 55.5, 162.5 60, 165 62.5 C 167.5 65, 172 61, 175 56 C 178 51, 182 46.5, 185 46.5 C 188 46.5, 188 50, 187 53 C 186 56, 185 59, 187 61.5 C 189 64, 193 60, 196 55.5 C 199 51, 203 46.5, 206 47 C 209 47.5, 209 51, 208 54 C 207 57.5, 206.5 60.5, 209 62 C 214 64, 222 57, 230 48 C 237 40, 244 32, 251 26"
              stroke="hsl(var(--volt-deep))"
              strokeWidth="2.2"
              strokeLinecap="round"
              {...ink(0.15, 1.5)}
            />
            <motion.path
              d="M 251 26 C 261 20, 268 28, 262 39 C 251 56, 214 72, 170 80 C 130 87, 88 84, 66 76 C 60 73.5, 58 71, 59.5 68.5"
              stroke="hsl(var(--volt-deep))"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.8"
              {...ink(1.5, 0.8)}
            />
            <motion.path
              d="M 88 33 C 93 30.5, 99 29.5, 105 30.5"
              stroke="hsl(var(--volt-deep))"
              strokeWidth="1.8"
              strokeLinecap="round"
              {...ink(2.2, 0.3)}
            />
            <motion.circle
              cx="268"
              cy="18"
              r="2.3"
              fill="hsl(var(--volt-deep))"
              initial={false}
              animate={{ opacity: reduce || signing ? 1 : 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.25, delay: 2.5 }}
            />
          </svg>
          <p className="mt-5 mx-auto max-w-xl" style={{ color: 'rgba(20,18,14,0.62)', fontSize: 'clamp(15px, 1.5vw, 19px)' }}>
            {es
              ? 'Nunca custodiamos. Nunca ejecutamos por ti. Astryum prepara la acción — y la entrega a tu wallet.'
              : 'We never custody. We never execute for you. Astryum prepares the action — and hands it to your wallet.'}
          </p>
          {/* the door to /proof — the claim above is verifiable, and this is
              where the page says so (founder 2026-07-29) */}
          <a
            href="/proof"
            // py-2 -my-2: touch-sized hit area (this is the only route link on
            // the whole mobile page body) without moving the layout
            className="mt-4 inline-block py-2 -my-2 text-[13px] font-semibold underline underline-offset-4 decoration-1 hover:opacity-80"
            style={{ color: 'hsl(var(--volt-deep))' }}
          >
            {es ? 'No nos creas: mira la prueba' : 'Don’t take our word for it — see the proof'}
          </a>
        </motion.div>

        {/* the boarding desk, folded into the light beat (journey mode) — the
            dark ticket reads like paper on the cream field, and the single
            early-access door closes the page without repeating the claim */}
        {SHOW_JOURNEY && (
          <motion.div className="relative w-full mt-14 md:mt-16" style={reduce ? undefined : { opacity: copyOpacity }}>
            <BoardingPass lang={lang} signing={signing} pass={passSheet} />
            <div className="mt-9 flex justify-center">
              <AccessCTA label={closeDoor.label} href={closeDoor.href} size="lg" strong />
            </div>
          </motion.div>
        )}

        {/* NOTHING ELSE LIVES HERE. The cream field is one beat with one job —
            the promise, the signature, the door — and everything that used to
            be folded under it (the two exploring doors, the hackathon
            disclosure, the brand line, the legal links) moved down into
            SiteFooter, on the dark (founder 2026-08-22). The user-test need
            from 2026-08-03 — a first-timer with no way into
            what-we-offer/about at the close — is still met: those doors are
            now the footer's first column, one screen further down. */}
      </div>
      {/* A SHORT runway, not the old 80svh one (founder: "es demasiado largo").
          It only has to cover the moment the section's bottom edge crosses into
          view — and since the dark now climbs from below, that edge is already
          dark by then, so a fifth of a screen is plenty. Under reduced motion
          the field never recedes, so it would just be empty cream: skip it. */}
      {!reduce && <div className="h-[20svh]" aria-hidden />}
    </section>
  );
}

// ─── Boarding pass — the final-CTA artifact. A ticket for the trip the product ───────
// actually sells: your wallet → the two layers (XRPL governs, Flare produces),
// custody stays yours, and the stub waits for exactly one thing — your signature
// (it draws itself in, on loop).
// PAPER, NOT SLATE (founder 2026-08-24: "creo que quedaria mejor con un tono
// claro, me choca un poco con el fondo claro"). Agreed, and the reason is in
// the object itself: a boarding pass IS paper. A near-black card made sense
// while it sat on a dark page; once the star lights the field, a slab of night
// in the middle of a lit scene reads as a hole in it. Same ticket, printed
// instead of screened — ink on warm stock, with the gold dropped to its deep
// token so it still reads against paper.
function BoardingPass({ lang, signing = false, pass }: { lang: Lang; signing?: boolean; pass?: GovernorPass }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const routeRef = useRef<HTMLDivElement>(null);
  // Continuous (no `once`) — the sole surviving loop in the Final CTA pauses
  // itself once scrolled out of view instead of running off-screen forever.
  const routeInView = useInView(routeRef, { margin: '-10% 0px -10% 0px' });
  // EL MISMO OBJETO, RENOMBRADO POR RÉGIMEN (2026-09-19): tarjeta de embarque
  // para quien se autocustodia, hoja de ruta para la entidad, manifiesto de
  // atraque para el exchange, plan de vuelo para el agente. Los campos salen
  // de governors.ts (y el certificado de destino para el venue); sin pase se
  // imprime el billete de siempre.
  const fields = pass
    ? pass.fields.map((f) => ({ k: T(f.k.es, f.k.en, lang), v: T(f.v.es, f.v.en, lang) }))
    : [
        { k: es ? 'Custodia' : 'Custody', v: es ? 'Tuya' : 'Yours' },
        { k: es ? 'Comisiones' : 'Fees', v: es ? 'Visibles antes' : 'Shown first' },
        // "Claves · Nunca salen" retired (2026-07-29): the light beat two screens
        // up just said it — simulation is the fact the Home never states.
        { k: es ? 'Simulación' : 'Simulation', v: es ? 'Siempre previa' : 'Always first' },
      ];
  const barcode = [2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 2, 1];
  return (
    <div
      className="relative mx-auto max-w-[620px] rounded-2xl overflow-hidden text-left"
      style={{
        // SMOKED GLASS, not a slab (founder 2026-08-25: oscuro otra vez, "pero
        // mas translucido"). The first dark version was ~62% flat black and
        // that is what clashed: on a lit field it read as a hole punched in the
        // scene.
        // 34% was the other ditch — on the render the light type lost its
        // contrast entirely over the bright side of the field, and 54% was
        // still short of it. 64% is where both hold.
        //
        // Which lands within a whisker of the old slab's 62%, and that is the
        // point worth writing down: the number was never what made it a slab.
        // What makes this glass is everything AROUND the number — a real
        // backdrop blur, so the star's gradient still arrives visibly brighter
        // on its side of the pane; a field of specks behind it; a warm limb
        // where the light strikes; and an inner top highlight. The old one had
        // none of that, which is why the same opacity read as a hole cut in the
        // scene instead of a window held against it.
        border: '1px solid hsl(var(--volt) / 0.32)',
        background: 'rgba(12,9,6,0.64)',
        backdropFilter: 'blur(14px) saturate(1.15)',
        WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
        boxShadow:
          '0 24px 60px rgba(60,42,10,0.28), inset 0 1px 0 rgba(255,244,214,0.16), inset 0 0 70px rgba(255,214,140,0.10)',
      }}
    >
      {/* Space behind the glass — a few faint specks and a warm limb where the
          star's light strikes the pane. Two static layers, no animation: the
          ticket is a window, and a window does not need to move to be one. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(rgba(255,244,214,0.20) 0.9px, transparent 1.4px), radial-gradient(120% 90% at 12% 0%, rgba(255,218,150,0.16), transparent 62%)',
          backgroundSize: '34px 30px, 100% 100%',
        }}
        aria-hidden
      />
      <div className="relative flex flex-col sm:flex-row sm:items-stretch">
        {/* main leaf — the route and the terms */}
        <div className="flex-1 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: GOLD_SOFT }}>
              <AsteroidGlyph size={14} />
              {pass ? `Astryum · ${T(pass.name.es, pass.name.en, lang)}` : es ? 'Astryum · Tarjeta de embarque' : 'Astryum · Boarding pass'}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
              {SHOW_XRPL_ACT ? 'V1 · XRPL + Flare' : 'V1 · Flare'}
            </span>
          </div>

          {/* the route — a glowing asteroid flies your capital to mainnet.
              This mote is the one surviving loop of the Final CTA: everything
              else nearby (comet, pulsing halo) is gone, so its light stays
              earned. View-gated (useInView) so it doesn't run off-screen. */}
          {/* min-w-0/truncate on the endpoints + a narrower rail floor: at
              320px the two nowrap labels overran the card and overflow-hidden
              cut the destination clean off */}
          <div className="mt-6 flex items-center gap-3">
            <div className="shrink min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">{es ? 'Origen' : 'From'}</div>
              <div className="mt-1 text-sm font-semibold text-white whitespace-nowrap truncate">{pass ? T(pass.origin.es, pass.origin.en, lang) : es ? 'Tu wallet' : 'Your wallet'}</div>
            </div>
            {/* A TRANSFER ORBIT, not a dashed line (founder 2026-08-25: "algo
                mas de narrativa espacial"). The page's whole metaphor is a
                journey between two bodies, and a straight line between them is
                the one shape that trip never takes: you leave one orbit, coast,
                and arrive at another. The departure is a filled body, the
                arrival an open ring waiting to be entered, and the mote coasts
                the arc between them.
                Its position is SAMPLED off the same quadratic the path draws —
                six points of B(t) for P0(4,20) P1(60,2) P2(116,14) — rather than
                offset-path, which engines still disagree about. Same curve, two
                readers, no chance of the light drifting off its own trajectory. */}
            <div ref={routeRef} className="relative flex-1 h-8 min-w-[40px]" aria-hidden>
              <svg viewBox="0 0 120 24" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" fill="none">
                <path
                  d="M4 20 Q 60 2 116 14"
                  stroke="hsl(var(--volt) / 0.42)"
                  strokeWidth="1.2"
                  strokeDasharray="2.5 4"
                  strokeLinecap="round"
                />
                {/* departure: the body you are leaving */}
                <circle cx="4" cy="20" r="2.4" fill="hsl(var(--volt) / 0.85)" />
                {/* arrival: an orbit to enter, drawn open */}
                <circle cx="116" cy="14" r="3.4" stroke="hsl(var(--volt) / 0.8)" strokeWidth="1.2" />
              </svg>
              {!reduce && (
                <motion.span
                  className="absolute w-[6px] h-[6px] rounded-full"
                  style={{ background: '#FFF3CE', boxShadow: '0 0 8px hsl(var(--volt) / 0.9)', marginLeft: -3, marginTop: -3 }}
                  animate={
                    routeInView
                      ? {
                          left: ['3.3%', '22%', '40.7%', '59.3%', '78%', '96.7%'],
                          top: ['83%', '58%', '43%', '38%', '43%', '58%'],
                          opacity: [0, 1, 1, 1, 1, 0],
                        }
                      : undefined
                  }
                  transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.8 }}
                />
              )}
            </div>
            <div className="shrink min-w-0 text-right">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">{es ? 'Destino' : 'To'}</div>
              <div className="mt-1 text-sm font-semibold whitespace-nowrap truncate" style={{ color: GOLD_SOFT }}>
                {pass ? T(pass.dest.es, pass.dest.en, lang) : SHOW_XRPL_ACT ? 'XRPL + Flare' : 'Flare mainnet'}
              </div>
            </div>
          </div>

          {/* The one line of narration on the ticket, and it is not decoration:
              a trajectory can be computed by anyone, but only its owner can
              commit it. Says the prepare-only invariant in the voice of the
              artefact instead of in the voice of a disclaimer. */}
          <div className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.15em] text-white/45">
            {pass ? T(pass.foot.es, pass.foot.en, lang) : es ? 'Trayectoria preparada · la firmas tú' : 'Trajectory prepared · you sign it'}
          </div>

          {/* the terms — the invariants, printed on the ticket. 2 cols below
              sm: three ~76px mono labels don't fit 232px of card, and the
              third field was clipped off entirely at 320px */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,244,214,0.18)' }}>
            {fields.map((f) => (
              <div key={f.k} className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] sm:tracking-[0.16em] text-white/55 truncate">{f.k}</div>
                <div className="mt-1 text-[13px] font-semibold text-white/90">{f.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* perforation */}
        <div className="hidden sm:block my-4" style={{ borderLeft: '1px dashed rgba(255,240,205,0.28)' }} aria-hidden />
        <div className="sm:hidden mx-5" style={{ borderTop: '1px dashed rgba(255,240,205,0.28)' }} aria-hidden />

        {/* stub — waiting for the only thing Astryum can't do: your signature.
            Draws in ONCE (whileInView, viewport once) and stays — this is the
            second hand-drawn signature on the page, so it must not loop and
            dilute the SignatureBreak beat further up. */}
        <div className="sm:w-[188px] p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: GOLD_SOFT }}>
              {pass ? T(pass.sign.es, pass.sign.en, lang) : es ? 'Firma aquí' : 'Sign here'}
            </div>
            <svg viewBox="0 0 150 46" className="mt-1 w-full" fill="none" aria-hidden>
              <motion.path
                d="M10 32 C 12 16, 22 8, 25 15 C 27 21, 18 33, 27 32 C 38 30.5, 40 17, 49 19 C 56 20.5, 53 32, 63 30.5 C 74 29, 76 16, 85 18 C 92 19.5, 89 31, 99 29.5 C 111 27.5, 119 23, 132 20"
                stroke={GOLD_SOFT}
                strokeWidth="1.7"
                strokeLinecap="round"
                // Armed by the same flash as the big signature above, not by
                // its own sighting: the two are one gesture and they used to
                // fire on different triggers.
                initial={false}
                animate={{ pathLength: reduce || signing ? 1 : 0 }}
                transition={reduce ? { duration: 0 } : { duration: 1.6, delay: 0.5, ease: 'easeInOut' }}
              />
              <line x1="8" y1="40" x2="142" y2="40" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
            </svg>
          </div>
          {/* barcode — decorative proof-of-ticket */}
          <div className="flex items-stretch gap-[3px] h-7" aria-hidden>
            {barcode.map((w, i) => (
              <span key={i} className="h-full" style={{ width: w, background: i % 5 === 0 ? 'hsl(var(--volt) / 0.6)' : 'rgba(255,246,224,0.32)' }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Final CTA — the boarding call. A framed gold panel (aura + orbit echo from ──────
// the hero): headline, then the boarding-pass artifact, then the two doors in, then
// the claims as check-chips. Same truthful copy, much more gravity.
function FinalCta({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const claims = es
    ? ['Costes visibles antes de firmar', 'Sin intermediarios', 'Tú siempre firmas']
    : ['Costs visible before you sign', 'No intermediaries', 'You always sign'];
  return (
    <section className="relative py-36 md:py-52 px-6 md:px-10 lg:px-16">
      <div className="max-w-5xl mx-auto">
        <Reveal>
          <div
            className="relative overflow-hidden rounded-[28px] px-6 py-16 md:px-16 md:py-24 text-center"
            style={{
              border: '1px solid hsl(var(--volt) / 0.28)',
              background: 'linear-gradient(180deg, hsl(var(--volt) / 0.09), hsl(var(--volt) / 0.02) 45%, rgba(255,255,255,0.015))',
            }}
          >
            {/* gold aura pouring from the top edge */}
            <div
              className="absolute inset-x-0 -top-24 h-64 pointer-events-none"
              style={{ background: 'radial-gradient(60% 100% at 50% 0%, hsl(var(--volt) / 0.22), transparent 70%)', filter: 'blur(10px)' }}
              aria-hidden
            />
            {/* faint orbit echo behind the copy — ties the close back to the hero */}
            <svg
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              width="760"
              height="760"
              viewBox="0 0 760 760"
              fill="none"
              aria-hidden
            >
              {[370, 296, 224].map((rad) => (
                <circle key={rad} cx="380" cy="380" r={rad} stroke="hsl(var(--volt) / 0.1)" strokeWidth="1" />
              ))}
              <circle cx="380" cy="84" r="4" fill="hsl(var(--volt-soft) / 0.5)" />
              <circle cx="118" cy="270" r="3" fill="hsl(var(--volt) / 0.45)" />
            </svg>

            <div className="relative">
              <h2 className="font-bold text-white" style={{ fontSize: 'clamp(2.2rem, 5.4vw, 4.4rem)', lineHeight: 1.06, letterSpacing: '-0.035em' }}>
                <MaskLines trigger="view" lines={[es ? 'Tu capital. Tu control.' : 'Your capital. Your control.']} />
                <motion.span
                  className="block text-gold-sweep"
                  initial={reduce ? false : { opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-12%' }}
                  transition={{ duration: 0.7, delay: 0.12, ease: EASE }}
                >
                  {es ? 'Tu firma.' : 'Your signature.'}
                </motion.span>
              </h2>
              <Reveal delay={0.1}>
                <p className="mt-6 text-white/50 max-w-xl mx-auto" style={{ fontSize: 'clamp(15px, 1.4vw, 18px)' }}>
                  {es ? 'Toma el control de tu capital hoy.' : 'Take control of your capital today.'}
                </p>
              </Reveal>
              <Reveal delay={0.18}>
                <div className="mt-11">
                  <BoardingPass lang={lang} />
                </div>
              </Reveal>
              <Reveal delay={0.28}>
                <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                  {/* the halo's gone; the button carries a touch more static shadow instead */}
                  <AccessCTA label={es ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong />
                  {/* Journey on: one door at the close (founder call 2026-07-21). */}
                  {!SHOW_JOURNEY && (
                    <Magnetic strength={0.3} className="inline-block">
                      <a
                        href={DEMO_URL}
                        className="inline-flex items-center gap-2 px-6 py-4 rounded-xl text-sm font-semibold transition-colors hover:bg-white/[0.04]"
                        style={{ border: `1px solid ${BORDER_STRONG}`, color: 'rgba(255,255,255,0.8)' }}
                      >
                        {es ? 'Únete a la lista de la demo' : 'Join the demo waitlist'}
                      </a>
                    </Magnetic>
                  )}
                </div>
              </Reveal>
              <Reveal delay={0.3}>
                <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
                  {claims.map((c) => (
                    <span key={c} className="flex items-center gap-2 text-[12px] font-mono uppercase tracking-[0.16em] text-white/50">
                      <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
                        <circle cx="6.5" cy="6.5" r="6" stroke={GOLD} strokeOpacity="0.5" />
                        <path d="M4 6.7l1.8 1.8L9.2 4.9" stroke={GOLD} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {c}
                    </span>
                  ))}
                </div>
              </Reveal>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ─── The wordmark — the page's last word, at page scale ──────────────────────────────
// (founder 2026-08-22, pointing at morpho.org's close: "el nombre de Astryum en
// grande".) Drawn as SVG text with textLength=viewBox width and
// lengthAdjust='spacing', which is the whole trick: the word measures EXACTLY
// the container on every screen, and it does so by opening the letter gaps —
// the glyphs themselves are never stretched. A vw font-size would have to guess
// the font's metrics and would jump the moment Inter swapped in.
//
// It sits at ~4% white and fades downward, so it reads as an embossed name in
// the dark rather than a headline. Sweep the cursor across it and a beam in the
// product accent lights the letters it passes — the one interactive thing at
// the very bottom of the page, and it repaints only while the pointer is
// actually moving over it.
function AstryumWordmark() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  // The bottom cut is BACK (founder 2026-08-22, second look: "me gustaba más
  // cuando quedaba cortado al final de la página"). Read that against the
  // earlier note in this file and it looks like a reversal; it is not. What was
  // wrong before was the SIZE — the name was penned inside the 72rem column, so
  // a cut name also looked like a small one. Full-bleed, the cut is the effect
  // it was always meant to be: a word too big for the page to hold. Size and
  // entrance stay; only the mask comes back.
  const glyphs = (fill: string, gradient?: boolean) => (
    <svg viewBox="0 0 1000 150" className="block w-full h-auto" fill="none" aria-hidden focusable="false">
      {gradient && (
        <defs>
          <linearGradient id="lp-wordmark-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.09" />
            <stop offset="58%" stopColor="#ffffff" stopOpacity="0.045" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.012" />
          </linearGradient>
        </defs>
      )}
      <text
        x="0"
        y="142"
        textLength="1000"
        lengthAdjust="spacing"
        fontSize="196"
        fontWeight={800}
        fill={fill}
        style={{ fontFamily: 'var(--font-inter), Inter, system-ui, sans-serif' }}
      >
        ASTRYUM
      </text>
    </svg>
  );
  return (
    <motion.div
      ref={ref}
      onMouseMove={reduce ? undefined : onMove}
      className="lp-wordmark relative mt-14 md:mt-20 select-none"
      aria-hidden
      // The entrance had to grow teeth. At 9% ink an opacity fade is literally
      // invisible — the founder's "no lo has hecho" was fair — so the motion
      // does the talking: the word rises 70px and settles out of a slight
      // overscale. once:false, so it plays again every time you come back up
      // instead of being spent on the first pass.
      initial={reduce ? false : { opacity: 0, y: 70, scale: 1.03 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: false, margin: '-8%' }}
      transition={{ duration: 1.3, ease: EASE }}
    >
      {/* the dissolve lives on its own element: one element cannot carry both
          this mask and the beam's */}
      <div className="lp-wordmark-ink relative">
        {glyphs('url(#lp-wordmark-body)', true)}
        {!reduce && <div className="lp-wordmark-beam absolute inset-0">{glyphs('hsl(var(--volt) / 0.45)')}</div>}
      </div>
    </motion.div>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────────────
// The dark band that closes the page (founder 2026-08-22). The cream signature
// beat above keeps ONE job — the promise and its door — and everything else
// the page owes the visitor lives down here on the night side: the doors, the
// community, the hackathon disclosure, the legal pages, and the name.
function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3.5">
      <h3 className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/40">{title}</h3>
      <div className="flex flex-col items-start gap-2.5">{children}</div>
    </div>
  );
}

function FooterLink({ href, children, external = false }: { href: string; children: React.ReactNode; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      // py-1 -my-1: a touch-sized hit area without opening the column up
      className="py-1 -my-1 text-[13px] text-white/55 transition-colors hover:text-white"
    >
      {children}
    </a>
  );
}

function SiteFooter({
  lang,
  product,
  onProduct,
  mandos = false,
}: {
  lang: Lang;
  /** En qué mundo está el visitante: el pie ofrece los OTROS, nunca este. */
  product: LandingProduct;
  onProduct: (p: LandingProduct) => void;
  /** La landing «a los mandos»: cuatro rutas en vez de tres mundos; el pie no ofrece «otros mundos». */
  mandos?: boolean;
}) {
  const es = lang === 'es';
  const reduceMotion = useReducedMotion();
  return (
    <footer
      className="relative z-10 overflow-hidden"
      style={{
        // Not a slab: the star field still shows through the top of the band
        // and is swallowed as the page lands, so the close reads as nightfall
        // rather than as a black box taped under the design.
        background:
          'linear-gradient(180deg, rgba(4,4,6,0) 0%, rgba(4,4,6,0.5) 26%, rgba(3,3,4,0.88) 68%, rgba(3,3,4,0.97) 100%)',
      }}
    >
      {/* No hairline at the top edge: the light beat above dissolves INTO this
          band, so a rule drawn across the middle of that dawn read as a seam
          where there is none. The gradient is the whole transition. */}
      <div className="relative mx-auto max-w-6xl px-6 md:px-10 pt-20 md:pt-24">
        <div className="grid gap-12 md:gap-10 lg:gap-14 md:grid-cols-[1.5fr_1fr_1fr_1fr] lg:grid-cols-[1.7fr_1fr_1fr_1fr]">
          {/* the brand column */}
          <div className="flex flex-col gap-4 items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_MARK} alt="Astryum" style={{ height: 44, width: 'auto', display: 'block' }} />
            <p className="text-[13px] text-white/45 max-w-[30ch]">Financial Control. Total Clarity.</p>
            <p className="text-[12px] font-mono uppercase tracking-[0.14em]" style={{ color: 'hsl(var(--volt) / 0.75)' }}>
              {es ? 'No-custodia · Tú siempre firmas' : 'Non-custodial · You always sign'}
            </p>
          </div>

          <FooterColumn title={mandos ? (es ? 'A los mandos' : 'At the controls') : es ? 'Producto' : 'Product'}>
            {mandos ? (
              GOVERNORS.map((g) => (
                <FooterLink key={g.id} href={g.route}>
                  {T(g.label.es, g.label.en, lang)}
                </FooterLink>
              ))
            ) : (
              <FooterLink href="/what-we-offer">{es ? 'Qué ofrecemos' : 'What we offer'}</FooterLink>
            )}
            <FooterLink href="/proof">{es ? 'La prueba' : 'Proof'}</FooterLink>
            <FooterLink href="/about">{es ? 'Quiénes somos' : 'About us'}</FooterLink>
            <FooterLink href={BETA_URL}>{es ? 'Entra en la beta' : 'Enter the beta'}</FooterLink>
          </FooterColumn>

          <FooterColumn title={es ? 'Comunidad' : 'Community'}>
            <FooterLink href={DISCORD_URL} external>
              Discord
            </FooterLink>
            <FooterLink href="https://x.com/Astryum_" external>
              X · @Astryum_
            </FooterLink>
            <FooterLink href={DEMO_URL}>{es ? 'Lista de la demo' : 'Demo waitlist'}</FooterLink>
          </FooterColumn>

          <div className="flex flex-col gap-8">
            <FooterColumn title="Hackathons">
              <HackathonFooterList lang={lang} tone="dark" />
            </FooterColumn>
            {/* Legal pages — reachable from the landing itself (Llei 20/2014:
                visible, permanent) */}
            <FooterColumn title="Legal">
              <FooterLink href="/demo-terms">{es ? 'Condiciones' : 'Terms'}</FooterLink>
              <FooterLink href="/privacy">{es ? 'Privacidad y aviso legal' : 'Privacy & legal'}</FooterLink>
            </FooterColumn>
          </div>
        </div>

        {/* ── EL FONDO DE LA PÁGINA: volver arriba y los otros mundos ─────
            Fundador, 2026-09-19: «poner abajo del todo un sitio para volver
            arriba del todo y unos atajos para ver los demás modos».

            Quien llega aquí ha bajado siete pantallas de recorrido y no tiene
            ninguna manera de volver: el conmutador de mundos vive en el
            fotograma de entrada y se apaga con él, así que a fondo de página no
            hay ni forma de subir ni forma de ver los otros dos. Los atajos
            listan SOLO los mundos que no estás mirando — ofrecer el que ya
            tienes delante es ruido. */}
        <div
          className="mt-14 pt-8 flex flex-col lg:flex-row items-center justify-between gap-6"
          style={{ borderTop: `1px solid ${BORDER_FAINT}` }}
        >
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })}
            className="group inline-flex items-center gap-2.5 text-[12px] font-mono uppercase tracking-[0.16em] rounded-full px-4 py-2.5 transition-colors"
            style={{ border: `1px solid ${BORDER}`, color: 'hsl(var(--volt-soft) / 0.9)' }}
          >
            {/* La única flecha de la página es la del indicador de scroll
                (regla del 2026-08-03), así que esto es un galón y no una
                flecha: dos trazos, el mismo glifo del indicador del revés. */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="transition-transform group-hover:-translate-y-0.5">
              <path d="M5 17L12 10.6L19 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.4} />
              <path d="M5 11.4L12 5L19 11.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {es ? 'Volver arriba' : 'Back to top'}
          </button>

          {/* En la landing «a los mandos» no hay conmutador de mundos: los
              cuatro gobernadores son rutas y ya están en la columna de arriba. */}
          {!mandos && (
          <div className="flex items-center gap-3 flex-wrap justify-center">
            <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/25">
              {es ? 'Otros mundos' : 'Other worlds'}
            </span>
            {visibleProducts()
              .filter((o) => o.id !== product)
              .map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    // INSTANTÁNEO, y es lo contrario que «volver arriba».
                    //
                    // Fundador, 2026-09-19: «cuando le das a un link de otro
                    // producto te cambia de página y te deshace al revés todo el
                    // tour; lo de back to top y que se muestre la animación al
                    // revés me gusta así, porque solo te muestra el revés del
                    // flow que acabas de ver».
                    //
                    // Los dos botones bajan al mismo sitio y por eso parecían el
                    // mismo gesto, pero no lo son. «Volver arriba» rebobina TU
                    // recorrido: siete pantallas del mundo que acabas de mirar,
                    // al revés, y eso es un remate. Cambiar de mundo rebobina el
                    // recorrido de un mundo que estás ABANDONANDO para llevarte
                    // a otro que no has visto — es una despedida larga de algo
                    // que ya no viene al caso.
                    //
                    // Se coloca arriba ANTES de cambiar, no después: así el
                    // mundo nuevo monta ya en su fotograma de entrada y le toca
                    // jugar su aparición entera, que es lo primero que tiene que
                    // enseñar.
                    window.scrollTo({ top: 0, behavior: 'auto' });
                    onProduct(o.id);
                  }}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-[12px] font-semibold transition-colors hover:brightness-110"
                  style={{ border: `1px solid ${o.accent}`, color: o.accent, background: 'transparent' }}
                >
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: o.accent }} />
                  {o.label}
                </button>
              ))}
          </div>
          )}
        </div>

        <div
          className="mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-white/30"
          style={{ borderTop: `1px solid ${BORDER_FAINT}` }}
        >
          <span>Astryum © 2026</span>
          <span>{es ? 'Construido a la vista, en Andorra' : 'Built in the open, from Andorra'}</span>
        </div>
      </div>
      {/* The name lives OUTSIDE the 72rem reading column: penned into it, at
          1152px on a 1440 screen, it read as a caption of the footer instead
          of as the page's last word (founder 2026-08-22: "queda pequeño").
          Full-bleed with only the page gutter, it spans ~95% of the viewport
          — Morpho's proportion. textLength does the rest: whatever the width
          ends up being, the word measures it exactly. */}
      {/* No bottom padding: the name is meant to sit ON the page's edge
          (founder: "pégalo más al fondo"), the way Morpho's does. */}
      <div className="px-5 md:px-8">
        <AstryumWordmark />
      </div>
    </footer>
  );
}

// ─── Landing crossing — the dashboard's AuthorityCrossing, verbatim ─────────────────
// (founder 2026-07-23: the custom landing scenes read as broken — use the SAME
// animation as the app.) The component reads its colors from the authority
// vars, which the landing root's data-authority already flipped by the time it
// mounts — the exact cascade AppShell gives it — and it manages its own ~1.5s
// window (300ms under reduced motion); we just relay onDone. Since the 2026-07-24
// redesign the crossing no longer curtains the page — frosted glass only — so
// the progressive re-color underneath (lp-theming + backdrop crossfade) is
// VISIBLE through it, which is the point. No quorum numbers here: the landing's
// crossing is marketing, the constellation falls back to its decorative sky.
function LandingCrossing({ to, onDone }: { to: LandingProduct; onDone: () => void }) {
  // AuthorityCrossing solo conoce dos direcciones, y sus colores cuelgan de
  // --product-personal/--product-legacy: un tercer mundo sin su rama cruzaría
  // pintado de ORO. Institucional entra por la puerta neutra ('to-personal',
  // que es la que NO clava el índigo) y la página ya ha estampado su bronce
  // en --volt cuando la travesía se monta, así que el lavado sale del color
  // que toca.
  return (
    <AuthorityCrossing
      direction={to === 'legacy' ? 'to-legacy' : 'to-personal'}
      label={to === 'legacy' ? 'Astryum Legacy' : to === 'institutional' ? 'Astryum · Institutional' : undefined}
      onDone={onDone}
    />
  );
}

// ─── Journey timeline — the flight plan, a vertical rail on the right edge ───────────
// Rebuilt 2026-07-24 (founder: "no los puntitos"); moved to the right edge the
// same day — the top strip collided with the header on scroll-up (founder
// picked the vertical rail over a bottom dock). Each leg carries its stop's
// name plus its OWN spine segment that fills top→bottom as you traverse that
// stop (passed legs stay lit, upcoming ones sit dim), and any leg is clickable
// to jump. Vertically centered: it can never meet the header. The whole HUD is
// instrumentation, not chrome: it fades in only while the page is actually
// moving (or while hovered) and slides out through the edge the moment the
// screen settles. The 3px global hairline stays glued to the very top edge —
// that one never fought the header. Desktop-only: below lg the journey is the
// stacked static variant.
const TIMELINE_CENTERS = [0.3125, 0.4725, 0.6325, 0.7875];
const TIMELINE_HALF = 0.08; // track-units — one stop spans ~0.16 of the journey

interface TimelineMark {
  id: string;
  label: string;
  start: number; // document-scroll fraction where the leg begins
  end: number;   // …and where it ends
}

function TimelineLeg({
  mark,
  index,
  state,
  raw,
}: {
  mark: TimelineMark;
  index: number;
  state: 'done' | 'active' | 'upcoming';
  raw: MotionValue<number>;
}) {
  // The leg's own progress: 0 before its span, 1 after (clamped) — passed
  // legs read full, the active one scrubs live, upcoming ones stay empty.
  const fill = useTransform(raw, [mark.start, mark.end], [0, 1]);
  const scaleY = useSpring(fill, { stiffness: 170, damping: 30 });
  return (
    <button
      onClick={() => document.getElementById(`stop-${mark.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      aria-label={mark.label}
      aria-current={state === 'active' ? 'step' : undefined}
      className="group flex items-center justify-end gap-2.5 rounded-full py-1 pl-2.5 pr-1 transition-colors hover:bg-white/[0.07]"
    >
      <span
        className="flex items-baseline gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] whitespace-nowrap"
        style={{
          color: state === 'active' ? GOLD_SOFT : state === 'done' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.38)',
          transition: 'color 0.3s ease',
          textShadow: '0 1px 8px rgba(0,0,0,0.85)',
        }}
      >
        <span style={{ color: state === 'active' ? GOLD : 'rgba(255,255,255,0.28)', transition: 'color 0.3s ease' }}>
          {`0${index + 1}`}
        </span>
        {mark.label}
      </span>
      {/* the leg's own segment of the spine — fills top→bottom while inside the stop */}
      <span
        className="relative h-7 w-[2px] overflow-hidden rounded-full shrink-0"
        style={{ background: 'rgba(255,255,255,0.14)' }}
      >
        <motion.span
          className="absolute inset-0 origin-top"
          style={{ scaleY, background: `linear-gradient(180deg, ${GOLD}, ${GOLD_SOFT})` }}
        />
      </span>
    </button>
  );
}

function JourneyTimeline({
  progress,
  raw,
  product,
  lang,
  legs,
}: {
  progress: MotionValue<number>;
  raw: MotionValue<number>;
  product: JourneyProduct;
  lang: 'es' | 'en';
  /** Las paradas REALES del viaje que hay debajo. Sin ellas, los cuatro
   *  tiempos de siempre (la portada de tres mundos). El viaje «a los mandos»
   *  tiene seis y otros tiempos: marcarlo con los cuatro viejos dejaba el HUD
   *  señalando «Earn» mientras la pantalla enseñaba «Home». */
  legs?: ReadonlyArray<{ id: string; es: string; en: string; start: number; end: number }>;
}) {
  const [marks, setMarks] = useState<TimelineMark[]>([]);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const [active, setActive] = useState(-1);

  // Visible ONLY while the screen is moving (founder 2026-07-24) — every
  // scroll tick re-arms a short fuse; hovering the HUD holds it open so the
  // legs stay clickable mid-read.
  const [visible, setVisible] = useState(false);
  const hovering = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Parking threshold (doc-scroll fraction): the moment the light CTA field
  // (#light-beat) is about to enter the viewport, the HUD hides for good —
  // gold instrumentation over the cream field read as debris (founder
  // 2026-07-25: "antes de entrar allí, se esconda") — and re-arms only when
  // the visitor sails back up into the dark.
  const hideBeyond = useRef(Infinity);
  const poke = useCallback(() => {
    setVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!hovering.current) setVisible(false);
    }, 1400);
  }, []);
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  useEffect(() => {
    const ids = product === 'legacy' ? ['summary', 'earn', 'portfolio', 'legacy'] : ['summary', 'earn', 'portfolio', 'wallets'];
    const labels = product === 'legacy' ? ['Home', 'Earn', 'Portfolio', 'Legacy'] : ['Home', 'Earn', 'Portfolio', 'Wallets'];
    const measure = () => {
      const j = document.getElementById('journey');
      const denom = document.documentElement.scrollHeight - window.innerHeight;
      const span = j ? j.offsetHeight - window.innerHeight : 0;
      // Park the HUD the instant the cream field's first pixel would show.
      // Computed BEFORE the early return: below lg the pinned track is
      // display:none (span <= 0) but the 3px hairline still renders — without
      // this, hideBeyond stayed Infinity on phones and the gold hairline kept
      // glowing over the cream close.
      const lb = document.getElementById('light-beat');
      hideBeyond.current =
        lb && denom > 0
          ? Math.max(0, (lb.getBoundingClientRect().top + window.scrollY - window.innerHeight) / denom)
          : Infinity;
      // span <= 0 → the static variant is on screen (PRM); no pinned track to mark.
      if (!j || denom <= 0 || span <= 0) {
        setMarks([]);
        return;
      }
      const toDoc = (c: number) => (c * span) / denom;
      setMarks(
        legs
          ? legs.map((l) => ({ id: l.id, label: lang === 'es' ? l.es : l.en, start: toDoc(l.start), end: toDoc(l.end) }))
          : TIMELINE_CENTERS.map((c, i) => ({
              id: ids[i],
              label: labels[i],
              start: toDoc(c - TIMELINE_HALF),
              end: toDoc(c + TIMELINE_HALF),
            })),
      );
    };
    measure();
    // layout settles late on first paint (fonts, dynamic imports)
    const t = setTimeout(measure, 1200);
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
    };
  }, [product, legs, lang]);

  useMotionValueEvent(raw, 'change', (p) => {
    // Inside the light beat's approach: park (no poke — scrolling there must
    // not re-arm the HUD, in either direction until back above the line).
    if (p >= hideBeyond.current) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setVisible(false);
      return;
    }
    poke();
    const ms = marksRef.current;
    let idx = -1;
    ms.forEach((m, i) => {
      if (p >= m.start && p <= m.end) idx = i;
    });
    setActive((prev) => (prev === idx ? prev : idx));
  });

  const legState = (i: number): 'done' | 'active' | 'upcoming' => {
    if (i === active) return 'active';
    const m = marks[i];
    // No live leg — judge by whether the viewport already sailed past it.
    return m && raw.get() > m.end ? 'done' : i < active ? 'done' : 'upcoming';
  };

  return (
    <>
      {/* global progress hairline — stays glued to the very top edge (3px never
          fought the header; it was the chip strip that did) */}
      <div
        className="fixed top-0 left-0 right-0 h-[3px] z-[60] pointer-events-none"
        style={{
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.35s ease',
        }}
        aria-hidden
      >
        <motion.div
          className="h-full origin-left"
          style={{ scaleX: progress, background: `linear-gradient(90deg, ${GOLD}, ${GOLD_SOFT})` }}
        />
      </div>
      {/* the flight plan — a vertical rail on the right edge, centered so it
          can never meet the header; slides out through the edge when idle */}
      {marks.length > 0 && (
        <nav
          aria-label={lang === 'es' ? 'Itinerario del viaje' : 'Journey itinerary'}
          className="hidden lg:flex fixed right-4 z-[60] flex-col items-end gap-1"
          onPointerEnter={() => {
            hovering.current = true;
            setVisible(true);
          }}
          onPointerLeave={() => {
            hovering.current = false;
            poke();
          }}
          style={{
            top: '50%',
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(-50%)' : 'translateY(-50%) translateX(14px)',
            transition: 'opacity 0.35s ease, transform 0.35s ease',
            pointerEvents: visible ? 'auto' : 'none',
          }}
          aria-hidden={!visible}
        >
          {marks.map((m, i) => (
            <TimelineLeg key={m.id} mark={m} index={i} state={legState(i)} raw={raw} />
          ))}
        </nav>
      )}
    </>
  );
}

// ─── Gate bounce notice ─────────────────────────────────────────────────────────────
// The answer the gold CTA owed the visitor. When the access gate refuses a
// request for /login, middleware.ts sends them home with ?gate=closed instead
// of bouncing in silence — this reads the marker, says what happened and points
// at the only door that IS open (the seat list). Without it the tap simply
// reloaded the landing: on the founder's desktop the gate cookie made the CTA
// work, on every phone and iPad it read as a broken button (2026-08-07).
// The param is stripped on mount so a refresh doesn't replay the notice.
function GateNotice({ lang }: { lang: Lang }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('gate') !== 'closed') return;
      setOpen(true);
      url.searchParams.delete('gate');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }, []);

  const es = lang === 'es';
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="status"
          aria-live="polite"
          // Bottom, not top: at the top it painted straight over the H1 and the
          // product switch — the visitor lost the page to read the notice.
          // 100px clears PersistentScrollCue (64px capsule at bottom-6).
          className="fixed left-1/2 bottom-[100px] z-[55] w-[calc(100%-32px)] max-w-[440px] rounded-2xl px-5 py-4"
          style={{
            x: '-50%',
            border: '1px solid hsl(var(--volt) / 0.32)',
            background: 'rgba(12,11,9,0.92)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            boxShadow: '0 22px 60px rgba(0,0,0,0.5)',
          }}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em]" style={{ color: GOLD_SOFT }}>
                {es ? 'El acceso está cerrado ahora mismo' : 'Access is closed right now'}
              </div>
              {/* No waitlist door here (founder 2026-08-07: "NO URL ASTRYUM
                  EARLY ACCESS"). The gold CTA promises the beta, so diverting a
                  refused visitor to the seat list would answer a question they
                  did not ask. This states the fact and stops. */}
              <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                {es
                  ? 'Tu pulsación ha llegado: es la puerta la que no está abierta, no el botón. Estamos en ello.'
                  : 'Your tap did register — it is the door that is not open, not the button. We are on it.'}
              </p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label={es ? 'Cerrar aviso' : 'Dismiss notice'}
              className="shrink-0 -mr-1 -mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Persistent scroll cue ──────────────────────────────────────────────────────────
// User test 2026-08-03: a first-time visitor's eye went straight to the gold
// CTAs and never found the old hero cue (a 10px label + 1px hairline that died
// at 5% of the track and only existed ≥md) — they didn't know the tour was
// BELOW. This cue replaces it at PAGE level: bigger, capsule-backed for
// contrast, on every viewport size, and alive through the WHOLE scroll so the
// visitor always knows there is more. It dresses in ink once the cream close
// (#light-beat) reaches the screen — gold on cream reads as noise, same call
// as the timeline's parking brake — and only leaves when less than ~half a
// viewport of page remains, because then the cue would lie.
function PersistentScrollCue({ lang }: { lang: Lang }) {
  const reduced = useReducedMotion();
  // 'top' is new (founder 2026-08-22): at the very top of the page the cue is a
  // labelled pill, because that is the one moment a visitor has no idea there
  // IS a tour below. Once they are moving it collapses to the symbol — bigger
  // than before, but still just a symbol.
  const [mode, setMode] = useState<'top' | 'dark' | 'light' | 'hidden'>('top');

  useEffect(() => {
    let raf = 0;
    const compute = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      if (max - y < window.innerHeight * 0.55) {
        setMode('hidden');
        return;
      }
      const beat = document.getElementById('light-beat');
      if (beat && beat.getBoundingClientRect().top < window.innerHeight * 0.55) {
        setMode('light');
        return;
      }
      setMode(y < window.innerHeight * 0.45 ? 'top' : 'dark');
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    compute();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  // The cue lands on the tour's next STOP, not on an arbitrary 85% of the
  // viewport (founder 2026-08-22: "que vaya bajando a cada punto del tour").
  // SolarJourney already plants an invisible anchor per stop — `stop-<id>` on
  // the pinned desktop track, `m-stop-<id>` on the static twin below lg — and
  // the JourneyTimeline's legs jump the exact same way, so this is one
  // behaviour with two triggers rather than a second scrolling model.
  //
  // Which anchors are LIVE matters: both variants are always in the DOM and
  // one of them is display:none, so an anchor is only a candidate if it
  // actually boxes (getClientRects). The light beat closes the list — after
  // the last stop the next thing worth landing on is the page's close — and
  // if nothing qualifies (no journey, or already past everything) the old
  // viewport-hop is still the floor.
  const jumpToNextStop = useCallback(() => {
    const y = window.scrollY;
    const tops = Array.from(
      document.querySelectorAll<HTMLElement>('[id^="stop-"], [id^="m-stop-"], #light-beat'),
    )
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => Math.round(el.getBoundingClientRect().top + y))
      .sort((a, b) => a - b);
    // 24px of slack: standing exactly ON an anchor must advance, not re-land
    const next = tops.find((t) => t > y + 24);
    if (next !== undefined) window.scrollTo({ top: next, behavior: 'smooth' });
    else window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: 'smooth' });
  }, []);

  const hidden = mode === 'hidden';
  const light = mode === 'light';
  const atTop = mode === 'top';
  // ONE chevron, drawn once at 30px, and the pill just shows it smaller. The
  // 2026-08-03 rule holds: this is the only arrow on the page.
  const chevrons = (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 7L12 13.4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.4} />
      <path d="M5 12.6L12 19L19 12.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <motion.button
      onClick={jumpToNextStop}
      aria-label={T('Ir a la siguiente parada del tour', 'Go to the next stop of the tour', lang)}
      tabIndex={hidden ? -1 : 0}
      // The gap goes in the CLASS, not in the animate object: framer hands
      // unitless numbers straight to the style and the browser drops `gap: 10`
      // on the floor — measured as `normal`, i.e. none at all.
      className={`fixed left-1/2 bottom-7 z-[60] flex items-center justify-center rounded-full border backdrop-blur-md transition-[gap,background-color,border-color] duration-500 ${
        atTop ? 'gap-2.5' : 'gap-0'
      } ${
        light
          ? 'border-black/15 bg-white/45 hover:bg-white/60'
          : 'border-white/10 bg-black/40 hover:bg-black/55'
      }`}
      // currentColor drives the chevron. Losing this line in a rewrite turned it
      // white — invisible the moment the cue crosses onto the cream field.
      style={{ x: '-50%', color: light ? 'hsl(var(--volt-deep))' : 'hsl(var(--volt))' }}
      initial={{ opacity: 0, y: 10 }}
      animate={
        hidden
          ? { opacity: 0, y: 8, transitionEnd: { visibility: 'hidden' } }
          : {
              opacity: 1,
              y: 0,
              visibility: 'visible',
              // NO fixed width. The old pill was pinned at 250px with 26/18 of
              // asymmetric padding, so the box dictated the layout and the
              // contents floated inside it wherever they landed — which is
              // exactly what "el reparto no está bien gestionado" describes.
              // Now the content sizes the button: collapse the label and the
              // padding lands 22 + 30 + 22 = 74, a circle, with no width to
              // animate and nothing to drift out of centre.
              height: atTop ? 56 : 74,
              // 24 against 18: the chevron is drawn in a 30px box and shown at
              // 0.6, so it carries 6px of empty box on its right. 18 + 6 = the
              // same 24 the label gets on the left — the optical margins match
              // even though the numbers do not.
              paddingLeft: atTop ? 24 : 22,
              paddingRight: atTop ? 18 : 22,
            }
      }
      transition={{ duration: 0.5, ease: EASE }}
    >
      {/* THE AURA — back in BOTH states (founder 2026-08-22: "no queria que te
          cargaras la animacion de respiracion y el aura… el boton es util y se
          tiene que ver"). I had restricted it to the circle, which was the
          wrong call: what was broken was never the aura, it was two specific
          things about how it was drawn.
          1. It POPPED. The cycle ran 0.55 → 0 opacity, so every loop re-entered
             by appearing out of nowhere at its start position. First and last
             keyframe now match at zero, and the seam has nowhere to happen.
          2. It DETACHED around the pill. A uniform scale on a 160×56 shape
             pushes the ring ~26px out sideways and only ~9px vertically, so it
             stopped being parallel to the button and read as a stray outline.
             box-shadow spread grows the SAME number of pixels on every side and
             follows the border-radius exactly, so one aura now fits a pill and
             a circle without knowing which it is wrapped around. */}
      {!reduced && !hidden && (
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-full"
          animate={{
            // Blur as well as spread: pure spread draws a hard-edged band, which
            // is a ring, not an aura. The blur is what turns it into light.
            boxShadow: [
              `0 0 0px 0px ${light ? 'rgba(20,18,14,0)' : 'hsl(var(--volt) / 0)'}`,
              `0 0 16px 4px ${light ? 'rgba(20,18,14,0.3)' : 'hsl(var(--volt) / 0.5)'}`,
              `0 0 34px 15px ${light ? 'rgba(20,18,14,0)' : 'hsl(var(--volt) / 0)'}`,
            ],
          }}
          transition={{ duration: 2.9, repeat: Infinity, ease: 'easeOut' }}
          aria-hidden
        />
      )}
      <AnimatePresence initial={false}>
        {atTop && (
          <motion.span
            key="cue-label"
            className="overflow-hidden whitespace-nowrap text-[13px] font-medium tracking-tight text-white/85"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            {T('Empieza el tour', 'Start the tour', lang)}
          </motion.span>
        )}
      </AnimatePresence>
      {/* The chevron carries the motion in both states — beside a label it only
          needs to hint, so it shrinks and nudges instead of bobbing. */}
      <motion.span
        className="grid shrink-0 place-items-center"
        animate={{ scale: atTop ? 0.6 : 1 }}
        transition={{ duration: 0.5, ease: EASE }}
        style={{ width: 30, height: 30 }}
      >
        {reduced ? (
          chevrons
        ) : (
          <motion.span
            className="grid place-items-center"
            animate={atTop ? { y: [0, 3, 0] } : { y: [-3, 4, -3] }}
            transition={{ duration: atTop ? 2 : 1.7, repeat: Infinity, ease: 'easeInOut' }}
          >
            {chevrons}
          </motion.span>
        )}
      </motion.span>
    </motion.button>
  );
}

// ─── Page orchestrator ──────────────────────────────────────────────────────────────
export default function LandingPage({ world = 'mandos' }: { world?: LandingWorld } = {}) {
  const [lang, setLang] = useLang();
  const [loginOpen, setLoginOpen] = useState(false);
  // EL MUNDO (2026-09-19). `mandos` es la portada nueva —la que pinta
  // `app/page.tsx` fuera de producción— y los otros cuatro son las páginas de
  // cada gobernador; en todos ellos el conmutador desaparece y el tema lo fija
  // el gobernador, no el estado guardado en localStorage. `home` es la portada
  // de los tres mundos (Personal · Legacy · Institutional) con su conmutador:
  // sigue viva en `/worlds` para seguir puliéndola. Producción no pinta este
  // fichero: pinta `LandingPageProduction`, congelado por hash.
  const mandos = world !== 'home';
  const governor: GovernorId | undefined =
    world === 'self' ? 'self' : world === 'business' ? 'business' : world === 'exchange' ? 'exchange' : world === 'agent' ? 'agent' : undefined;
  // El mundo de los venues no tiene gobernador: viste el bronce de la entidad,
  // porque un protocolo es una entidad, mirada desde el otro lado.
  const venue = world === 'venue';
  const worldProduct = governor ? GOVERNOR_BY_ID[governor].product : venue ? 'institutional' : 'personal';
  const worldStars =
    governor === 'business' || venue ? '186,156,109' : governor === 'exchange' ? '158,181,214' : governor === 'agent' ? '196,201,210' : undefined;
  // Product lives at the page root so the WHOLE landing re-themes with it:
  // data-authority='governed' flips the --volt family (globals.css), and every
  // accent here now reads those tokens — same mechanism as the dashboard.
  // Persisted (like the language) so /early-access opens in the same color.
  const [product, setProductState] = useState<LandingProduct>('personal');
  useEffect(() => {
    if (mandos) return;
    try {
      const s = localStorage.getItem('astryum:product');
      if (isLandingProduct(s)) setProductState(s);
    } catch {
      /* ignore */
    }
  }, [mandos]);
  // A real product change stages the landing crossing (skipped when the same
  // segment is re-clicked, and by LandingCrossing itself under reduced motion).
  const [crossing, setCrossing] = useState<{ to: LandingProduct; n: number } | null>(null);
  const crossN = useRef(0);
  const productRef = useRef(product);
  productRef.current = product;
  const setProduct = useCallback((p: LandingProduct) => {
    if (p !== productRef.current) {
      crossN.current += 1;
      setCrossing({ to: p, n: crossN.current });
    }
    setProductState(p);
    try {
      localStorage.setItem('astryum:product', p);
    } catch {
      /* ignore */
    }
  }, []);

  // The hidden admin door asks for the beta password FIRST (LoginModal); only a
  // correct answer grants the session flag and forwards to the /login console.
  // Never grant access here — that would expose account creation to anyone who
  // finds the 5-click easter egg.
  const openDoor = useCallback(() => {
    setLoginOpen(true);
  }, []);

  // Top scroll-progress bar (gold), eased with a spring.
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });

  // Scroll NATURAL (fundador 2026-07-24): fuera Lenis y fuera el imán del
  // journey — el navegador es el único dueño de la rueda. Todo el scrollytelling
  // (scrub, veil, fases, timeline) lee scrollY nativo, así que funciona igual;
  // lo único que cambia es que el ritmo lo pone la mano del visitante.

  // Hidden admin door: Ctrl+Shift+L
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        openDoor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDoor]);

  // Note: overflowX:'clip' (not 'hidden') contains the auras/marquee WITHOUT
  // creating a scroll container — `hidden` was what broke the sticky rail.
  return (
    <div
      data-authority={!mandos && product === 'legacy' ? 'governed' : undefined}
      data-product={mandos ? worldProduct : product}
      className={`relative min-h-screen text-white lp-root ${crossing ? 'lp-theming' : ''}`}
      style={{ overflowX: 'clip' }}
    >
      {/* page-atmosphere theming: warm-black in Personal, indigo-black in
          Legacy (the accent vars flip via data-authority; these are the two
          hex gradients vars can't reach) */}
      <style>{`
        /* No rubber-band chaining while the landing is mounted: the page ends
           on the cream light-beat, and the bottom bounce flashed the root's
           near-black under it on iOS/Android. (Trades away pull-to-refresh on
           this page only.) */
        html { overscroll-behavior-y: none; }
        .lp-root { background: #080808; transition: background-color 1s ease; }
        [data-authority='governed'].lp-root { background: #070810; }
        /* EL BRONCE DEL MUNDO INSTITUCIONAL, acotado a esta página.
           NO se estampa data-skin en la raíz a propósito: el tema de la
           aplicación trae una regla que apaga con !important TODA sombra
           en línea, y la landing tiene veinticinco. Aquí solo se cambian
           los tokens de acento, que es lo que el mundo necesita. */
        .lp-root[data-product='institutional'] { background: #0d0f12; --volt: 36 36% 58%; --volt-soft: 38 30% 70%; --volt-hi: 40 45% 86%; --volt-deep: 34 30% 20%; }
        /* LOS DOS MUNDOS NUEVOS (2026-09-19), por el mismo camino que el bronce:
           solo cambian los tokens de acento. Platino frío para la estación del
           exchange; plata apagada para la sonda del agente. */
        .lp-root[data-product='exchange'] { background: #080a0e; --volt: 216 41% 73%; --volt-soft: 214 45% 84%; --volt-hi: 214 60% 93%; --volt-deep: 216 30% 24%; }
        .lp-root[data-product='agent'] { background: #08090b; --volt: 216 9% 79%; --volt-soft: 216 14% 87%; --volt-hi: 216 20% 94%; --volt-deep: 216 10% 26%; }
        .lp-base-institutional { background: radial-gradient(130% 90% at 50% -15%, #16181c 0%, #101215 38%, #0b0d10 100%); }
        .lp-horizon-institutional { background: radial-gradient(80% 100% at 50% 0%, rgba(186,156,109,0.10), transparent 70%); }
        .lp-base { background: radial-gradient(130% 90% at 50% -15%, #1a150b 0%, #100d08 38%, #080807 100%); }
        .lp-base-governed { background: radial-gradient(130% 90% at 50% -15%, #131530 0%, #0B0C1E 38%, #070810 100%); }
        .lp-horizon { background: radial-gradient(80% 100% at 50% 0%, rgba(201,162,39,0.16), transparent 70%); }
        /* The closing wordmark: the body fades downward like an emboss, and the
           accent beam is masked to a circle that follows the cursor — opacity 0
           until the pointer is actually over the name, so nothing repaints
           while the page just sits there. */
        /* The dissolve. Morpho's name does not end, it thins out into the page
           — so this starts giving way at 18% and is gone by 88%, well before the
           glyphs' own baseline. Deeper than the first attempt (44% → 100%),
           which still read as a whole word with a fade taped on the bottom. */
        .lp-wordmark-ink {
          -webkit-mask-image: linear-gradient(180deg, #000 0%, rgba(0,0,0,0.85) 18%, rgba(0,0,0,0.3) 58%, transparent 88%);
          mask-image: linear-gradient(180deg, #000 0%, rgba(0,0,0,0.85) 18%, rgba(0,0,0,0.3) 58%, transparent 88%);
        }
        .lp-wordmark-beam {
          opacity: 0;
          transition: opacity 0.45s ease;
          -webkit-mask-image: radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), #000 0%, transparent 72%);
          mask-image: radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), #000 0%, transparent 72%);
        }
        .lp-wordmark:hover .lp-wordmark-beam { opacity: 1; }
        @media (prefers-reduced-motion: reduce) { .lp-wordmark-beam { display: none; } }
        .lp-horizon-governed { background: radial-gradient(80% 100% at 50% 0%, rgba(130,141,248,0.15), transparent 70%); }
        /* gradients can't transition — the governed variants crossfade on top */
        .lp-fade-layer { transition: opacity 1.1s ease; }
        /* During a product crossing every themed property glides instead of
           snapping (opacity/transform deliberately excluded so framer and the
           scroll scrub stay untouched). The class only lives while the
           crossing overlay does. */
        .lp-theming, .lp-theming * { transition-property: color, background-color, border-color, fill, stroke, box-shadow; transition-duration: 0.9s; transition-timing-function: ease; }
      `}</style>
      {/* top scroll-progress bar, with the planet itinerary marked on it */}
      {/* La HUD del itinerario es del VIAJE SOLAR: sus cuatro tramos son sus
          cuatro paradas y sus anclas son `stop-<id>` de SolarJourney. Legacy e
          Institucional tienen sus propios recorridos, con su propia barra de
          paradas dentro (journeyShell/StationRail), así que esta HUD solo
          acompaña a Personal — si se dejara puesta saltaría a anclas que en
          esos dos mundos no existen. */}
      {(mandos ? world === 'self' || world === 'mandos' : product === 'personal') && (
        <JourneyTimeline progress={progress} raw={scrollYProgress} product="personal" lang={lang} legs={mandos ? SOLAR_LEGS : undefined} />
      )}
      {/* page-long "keep scrolling" capsule — the tour lives below the fold */}
      <PersistentScrollCue lang={lang} />
      {/* the access gate's answer, when it turned a gold CTA away */}
      <GateNotice lang={lang} />
      {/* En los mundos «a los mandos» TODO es cielo (fundador 2026-09-19: «debe
          ser temática Astryum del espacio»): el campo de estrellas se queda
          también en Empresa, con las estrellas del color de cada instrumento. */}
      <SpaceBackdrop legacy={!mandos && product === 'legacy'} institutional={!mandos && product === 'institutional'} accent={worldStars} />
      {crossing && <LandingCrossing key={crossing.n} to={crossing.to} onDone={() => setCrossing(null)} />}
      <div className="relative z-10">
        {/* hackathon disclosure — persistent strip; the header sits BANNER_H lower */}
        <HackathonBanner lang={lang} />
        <Header
          lang={lang}
          setLang={setLang}
          onSecretLogin={openDoor}
          product={!mandos && product === 'legacy' ? 'legacy' : 'personal'}
          navItems={mandos ? navMandos(world === 'mandos') : undefined}
        />
        <main>
          {/* LOS MUNDOS «A LOS MANDOS». La portada nueva abre con el sistema
              solar de siempre y el selector; Autocustodia ES el viaje solar,
              con la parada nueva de las cuentas detrás; Empresa, Exchange y
              Agente traen su instrumento y sus láminas. El cierre con luz y el
              pase son los mismos para todos, renombrados por régimen. */}
          {world === 'mandos' ? (
            /* LA PORTADA EXPLICA EL PRODUCTO UNA SOLA VEZ (fundador 2026-09-20):
               el viaje solar de siempre, con el núcleo (tus cuentas) y la
               quinta órbita (Operar) dentro; después, el puente —«el mismo
               sistema, a los mandos de…»— y las cuatro puertas. */
            <>
              <SolarJourney
                lang={lang}
                hero={<HeroContent lang={lang} />}
                finaleCta={<AccessCTA label={lang === 'es' ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong />}
                product="personal"
                onProductChange={() => {}}
              />
              <MandosSection lang={lang} />
              <InstrumentsSection lang={lang} />
            </>
          ) : world === 'self' ? (
            /* «Lo que has visto, aplicado a ti»: el mismo viaje en voz de aplicación. */
            <SolarJourney
              lang={lang}
              hero={<HeroContent lang={lang} />}
              finaleCta={<AccessCTA label={lang === 'es' ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong />}
              product="self"
              onProductChange={() => {}}
            />
          ) : world === 'business' ? (
            <EmpresaJourney lang={lang} finaleCta={<AccessCTA label={lang === 'es' ? 'Hablemos' : 'Talk to us'} href={CONTACT_MAILTO} size="lg" strong />} />
          ) : world === 'exchange' ? (
            <ExchangeJourney lang={lang} finaleCta={<AccessCTA label={lang === 'es' ? 'Hablemos' : 'Talk to us'} href={CONTACT_MAILTO} size="lg" strong />} />
          ) : world === 'agent' ? (
            <AgenteJourney lang={lang} finaleCta={<AccessCTA label={lang === 'es' ? 'Avísame cuando abra' : 'Tell me when it opens'} href={EARLY_ACCESS_URL} size="lg" strong />} />
          ) : world === 'venue' ? (
            /* La quinta página, desde el otro lado: para quien opera un protocolo. */
            <VenueJourney lang={lang} finaleCta={<AccessCTA label={lang === 'es' ? 'Solicitar la verificación' : 'Request verification'} href={VENUE_MAILTO} size="lg" strong />} />
          ) : SHOW_JOURNEY ? (
            // CADA PRODUCTO, SU MUNDO (fundador 2026-09-18). El conmutador lo
            // monta la página y se le pasa a cada viaje: con tres narrativas el
            // botón no puede vivir dentro de una de ellas.
            product === 'institutional' ? (
              <InstitutionalJourney
                lang={lang}
                finaleCta={<AccessCTA label={lang === 'es' ? 'Hablemos' : 'Talk to us'} size="lg" strong />}
                switcher={<ProductSwitch product={product} setProduct={setProduct} lang={lang} />}
              />
            ) : product === 'legacy' ? (
              <LegacyJourney
                lang={lang}
                finaleCta={<AccessCTA label={lang === 'es' ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong />}
                switcher={<ProductSwitch product={product} setProduct={setProduct} lang={lang} />}
              />
            ) : (
            <SolarJourney
              lang={lang}
              hero={<HeroContent lang={lang} />}
              finaleCta={
                <AccessCTA label={lang === 'es' ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong />
              }
              product={product as JourneyProduct}
              // `self` es un copy del viaje, no un producto de esta portada: no
              // puede llegar aquí, y si llegara no habría mundo al que cambiar.
              onProductChange={(p) => {
                if (p !== 'self') setProduct(p);
              }}
              switcher={<ProductSwitch product={product} setProduct={setProduct} lang={lang} />}
            />
            )
          ) : (
            <Hero lang={lang} />
          )}
          {/* The proof band — cut in journey mode (SHOW_PROOF_SECTIONS): the
              journey already tells the product story and the page now ends on
              the light close. */}
          {(!SHOW_JOURNEY || SHOW_PROOF_SECTIONS) && <StatsBand lang={lang} />}
          {/* The journey tells these stories planet by planet — the classic
              sections only render when the flag is off. */}
          {!SHOW_JOURNEY && (
            <>
              <HowItWorks lang={lang} />
              <Pillars lang={lang} />
            </>
          )}
          {(!SHOW_JOURNEY || SHOW_PROOF_SECTIONS) && (
            <>
              <ActBreak
                lang={lang}
                kickerEs="La prueba · Flare mainnet"
                kickerEn="The proof · Flare mainnet"
                lineEs="Nada de promesas: dos estrategias reales, en vivo en Flare mainnet, con las condiciones a la vista antes de firmar."
                lineEn="No promises: two real strategies, live on Flare mainnet, with the conditions in plain sight before you sign."
              />
              <FlareFeatures lang={lang} />
              {/* The XRPL governance act — gated behind SHOW_XRPL_ACT until the
                  Legacy flows are further developed (founder call 2026-07-14). */}
              {SHOW_XRPL_ACT && (
                <>
                  <BridgeProof lang={lang} />
                  <ActBreak
                    lang={lang}
                    kickerEs="La gobernanza · XRPL"
                    kickerEn="Governance · XRPL"
                    lineEs="Producir es la mitad. La otra mitad es quién decide cómo se comporta ese capital — y esa capa vive en XRPL."
                    lineEn="Producing is half the story. The other half is who decides how that capital behaves — and that layer lives on XRPL."
                  />
                  <XrplGovernance lang={lang} />
                </>
              )}
            </>
          )}
          {/* PrincipleBreak UNMOUNTED (founder 2026-07-25): the principle moved
              INTO the journey's finale (SolarJourney FinaleBlock + static twin),
              replacing the repeated hero headline there. Component preserved
              above for re-mount. The page ends on the light beat — signature,
              boarding desk, one door and the footer folded into the cream. */}
          {/* EL CIERRE, UNO POR MUNDO (fundador 2026-09-19: «el destello de
              estrella final no cuadra con la explicación ni el tour del
              institucional»). Tenía razón y la contradicción estaba escrita
              arriba, en SpaceBackdrop: este mundo suprime el campo de estrellas
              a propósito y luego cerraba con un astro, un asteroide y un billete
              de avión. El institucional cierra en la mesa del grabador.

              Se bifurca AQUÍ y no dentro de `SignatureBreak`: esa sección lleva
              seiscientas líneas de ajuste ganado a pulso (el muelle contra el
              flashbang, la caída sin bordes, la simetría de salida) y Personal y
              Legacy están dados por buenos. No tocarla es la única forma de
              garantizar que no se mueven. */}
          {!mandos && product === 'institutional' ? (
            <InstitutionalBreak
              lang={lang}
              cta={<AccessCTA label={lang === 'es' ? 'Hablemos' : 'Talk to us'} size="lg" strong />}
            />
          ) : !mandos && product === 'legacy' ? (
            /* Fundador 2026-09-19: «quita el destello de la estrella y pon un
               artefacto que siga la línea de narrativa del legacy». El astro era
               DORADO —el color de Personal— y llegaba después de seis paradas de
               piedra. Legacy cierra en la cartela de su propio puente. */
            <LegacyBreak
              lang={lang}
              cta={<AccessCTA label={lang === 'es' ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong onLight />}
            />
          ) : (
            <SignatureBreak lang={lang} governor={governor} venue={venue} />
          )}
          {!SHOW_JOURNEY && <Narrative lang={lang} />}
          {/* PartnerMarquee removed for the hackathon build (aspirational logos out). */}
          {/* DocsSection hidden until the GitBook space is published (its links 404) — restore post-E1. */}
          {!SHOW_JOURNEY && <FinalCta lang={lang} />}
        </main>
        {/* The dark band that closes the page, journey or not (founder
            2026-08-22): the light beat hands the page back to the night and
            the footer catches it. */}
        <SiteFooter lang={lang} product={product} onProduct={setProduct} mandos={mandos} />
      </div>
      {loginOpen && <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

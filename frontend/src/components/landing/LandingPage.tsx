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
import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'framer-motion';
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
import SolarJourney, { type JourneyProduct } from './SolarJourney';
import AuthorityCrossing from '../authority/AuthorityCrossing';
import { BANNER_H, HackathonBanner, HackathonFooterNote } from './HackathonNotice';

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
function SpaceBackdrop({ legacy }: { legacy: boolean }) {
  const { x, y, reduce } = usePointerParallax(40, 20);
  const auraAx = useTransform(x, [-0.5, 0.5], [40, -40]);
  const auraAy = useTransform(y, [-0.5, 0.5], [30, -30]);
  const auraBx = useTransform(x, [-0.5, 0.5], [-30, 30]);
  const auraBy = useTransform(y, [-0.5, 0.5], [-24, 24]);

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
      {/* living star / asteroid field — constellation lines follow the theme */}
      <StarfieldCanvas accent={legacy ? '130,141,248' : '201,162,39'} />
      {/* ambient gold auras for depth — drift + pointer parallax. Half-size
          below md: a 680px layer with a 44px blur is ~2× a phone's viewport
          and pure GPU cost over the animating star canvas. */}
      <motion.div
        className="absolute -top-40 -left-32 w-[380px] h-[380px] md:w-[680px] md:h-[680px] rounded-full aurora-drift"
        style={{
          x: reduce ? 0 : auraAx,
          y: reduce ? 0 : auraAy,
          background: 'radial-gradient(circle, hsl(var(--volt) / 0.16), transparent 68%)',
          filter: 'blur(44px)',
        }}
      />
      <motion.div
        className="absolute bottom-[-18%] right-[-10%] w-[340px] h-[340px] md:w-[620px] md:h-[620px] rounded-full aurora-drift"
        style={{
          x: reduce ? 0 : auraBx,
          y: reduce ? 0 : auraBy,
          background: 'radial-gradient(circle, hsl(var(--volt-soft) / 0.09), transparent 70%)',
          filter: 'blur(54px)',
          animationDelay: '-6s',
        }}
      />
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
function AccessCTA({ label, size = 'md', strong = false }: { label: string; size?: 'sm' | 'md' | 'lg'; strong?: boolean }) {
  // lg tightens below sm: at px-9/text-base the Spanish label overran the
  // 272px content column of a 320px phone and wrapped mid-pill.
  const pad = size === 'lg' ? 'px-5 py-3.5 text-sm sm:px-9 sm:py-4 sm:text-base' : size === 'sm' ? 'px-4 py-2 text-sm' : 'px-6 py-3 text-sm';
  const shadow = strong ? '0 10px 34px hsl(var(--volt) / 0.36)' : '0 8px 30px hsl(var(--volt) / 0.28)';
  return (
    // No trailing arrow (founder 2026-08-03: arrows left every landing
    // button — the ONLY arrow on the page is the scroll cue's).
    <Magnetic strength={0.4} className="inline-block">
      <a
        href={BETA_URL}
        className={`inline-flex items-center justify-center max-w-full rounded-xl font-semibold text-black whitespace-nowrap transition-all hover:brightness-105 ${pad}`}
        style={{ background: GOLD, boxShadow: shadow }}
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

function Header({
  lang,
  setLang,
  onSecretLogin,
  product = 'personal',
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  onSecretLogin: () => void;
  /** The landing's product toggle re-tints the page — the brand follows
   *  (founder 2026-08-08): blue lockup while Legacy is on stage. */
  product?: 'personal' | 'legacy';
}) {
  const es = lang === 'es';
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
            {NAV.map((n) =>
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
            <Magnetic strength={0.35} className="hidden sm:inline-block">
              <a
                href={BETA_URL}
                className="inline-flex items-center px-3.5 py-2 rounded-xl text-[13px] font-semibold text-black transition-transform"
                style={{ background: GOLD, boxShadow: '0 6px 22px hsl(var(--volt) / 0.22)' }}
              >
                {es ? 'Entra en la beta' : 'Enter the beta'}
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
                {NAV.map((n) => (
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
                  className="sm:hidden mt-2 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-black"
                  style={{ background: GOLD, boxShadow: '0 6px 22px hsl(var(--volt) / 0.22)' }}
                >
                  {es ? 'Entra en la beta' : 'Enter the beta'}
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
function HeroContent({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
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
          lines={[
            <span key="l1">
              <span className="whitespace-nowrap">{es ? 'Tu capital.' : 'Your capital.'}</span>{' '}
              <span className="whitespace-nowrap">{es ? 'Tu control.' : 'Your control.'}</span>
            </span>,
          ]}
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
          {es ? 'Tu firma.' : 'Your signature.'}
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
        {SHOW_XRPL_ACT
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
            href={DEMO_URL}
            className="inline-flex items-center gap-2 px-6 py-4 rounded-xl text-sm font-semibold transition-colors hover:bg-white/[0.04]"
            style={{ border: `1px solid ${BORDER_STRONG}`, color: 'rgba(255,255,255,0.8)' }}
          >
            {es ? 'Únete a la lista de la demo' : 'Join the demo waitlist'}
          </a>
        </Magnetic>
      </motion.div>
    </>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────────────────
function Hero({ lang }: { lang: Lang }) {
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
          <HeroContent lang={lang} />
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
        onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
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

function SignatureBreak({ lang, product = 'personal' }: { lang: Lang; product?: 'personal' | 'legacy' }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });

  // This is the page's LAST section: progress tops out around ~0.6 (its bottom
  // meets the viewport bottom and the scroll ends), so everything must settle
  // by then and nothing fades out — the light simply IS the end of the page.
  const fieldOpacity = useTransform(scrollYProgress, [0.05, 0.22], [0, 1]);
  const copyOpacity = useTransform(scrollYProgress, [0.12, 0.28], [0, 1]);
  const copyY = useTransform(scrollYProgress, [0.12, 0.28], [26, 0]);
  // The signature is sequenced like a real hand: the name writes itself, the
  // paraph loops over and sweeps back underneath, then the pen lifts to cross
  // the t and finally dots off.
  const strokeName = useTransform(scrollYProgress, [0.2, 0.38], [0, 1]);
  const strokeFlourish = useTransform(scrollYProgress, [0.37, 0.46], [0, 1]);
  const strokeTCross = useTransform(scrollYProgress, [0.46, 0.5], [0, 1]);
  const dotOpacity = useTransform(scrollYProgress, [0.5, 0.53], [0, 1]);

  // With the journey on, the boarding desk lives INSIDE this light beat: one
  // cream fold, one signature, one door — the standalone FinalCta is gone and
  // "you always sign" is said exactly once (founder 2026-07-22). The id is the
  // JourneyTimeline's parking sensor: the flight-plan HUD hides before this
  // light field enters the viewport (founder 2026-07-25).
  return (
    <section ref={ref} id="light-beat" className="relative overflow-hidden">
      <motion.div
        className="absolute inset-0"
        style={{
          opacity: reduce ? 1 : fieldOpacity,
          background: 'radial-gradient(125% 95% at 50% 42%, #FBF6E9 0%, #F1E9D2 55%, #E6DBBE 100%)',
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
      </motion.div>
      {/* svh, not vh — on iOS 100vh is the URL-bar-hidden height and left dead
          scroll at the page close */}
      <div className="relative flex flex-col items-center justify-center px-6 pt-28 md:pt-32 pb-10 md:pb-12" style={{ minHeight: '100svh' }}>
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
              style={{ pathLength: reduce ? 1 : strokeName }}
            />
            <motion.path
              d="M 251 26 C 261 20, 268 28, 262 39 C 251 56, 214 72, 170 80 C 130 87, 88 84, 66 76 C 60 73.5, 58 71, 59.5 68.5"
              stroke="hsl(var(--volt-deep))"
              strokeWidth="1.6"
              strokeLinecap="round"
              opacity="0.8"
              style={{ pathLength: reduce ? 1 : strokeFlourish }}
            />
            <motion.path
              d="M 88 33 C 93 30.5, 99 29.5, 105 30.5"
              stroke="hsl(var(--volt-deep))"
              strokeWidth="1.8"
              strokeLinecap="round"
              style={{ pathLength: reduce ? 1 : strokeTCross }}
            />
            <motion.circle cx="268" cy="18" r="2.3" fill="hsl(var(--volt-deep))" style={{ opacity: reduce ? 1 : dotOpacity }} />
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
            <BoardingPass lang={lang} />
            <div className="mt-9 flex justify-center">
              <AccessCTA label={es ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong />
            </div>
          </motion.div>
        )}

        {/* the page's other two doors, restated at the close (user test
            2026-08-03: after the whole tour, a first-timer had no way into
            what-we-offer/about without scrolling back to the header). The
            proof already has its door under the signature — these are the
            remaining two, ink on cream, quieter than the CTA above. */}
        {SHOW_JOURNEY && (
          <div className="relative w-full mt-12 md:mt-14 flex flex-col items-center gap-4">
            <span className="text-[11px] font-mono uppercase tracking-[0.18em]" style={{ color: 'rgba(20,18,14,0.45)' }}>
              {es ? 'Sigue explorando' : 'Keep exploring'}
            </span>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="/what-we-offer"
                className="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-black/[0.04]"
                style={{ borderColor: 'rgba(20,18,14,0.18)', color: 'rgba(20,18,14,0.75)' }}
              >
                {es ? 'Qué ofrecemos' : 'What we offer'}
              </a>
              <a
                href="/about"
                className="inline-flex items-center gap-2 rounded-xl border px-5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-black/[0.04]"
                style={{ borderColor: 'rgba(20,18,14,0.18)', color: 'rgba(20,18,14,0.75)' }}
              >
                {es ? 'Quiénes somos' : 'About us'}
              </a>
            </div>
          </div>
        )}

        {/* the footer, folded into the cream — ink on light, and no repeated
            claim: the light beat above already says it once */}
        {SHOW_JOURNEY && (
          <footer
            className="relative w-full max-w-6xl mt-16 md:mt-20 pt-6 flex flex-col gap-4"
            style={{ borderTop: '1px solid rgba(20,18,14,0.14)' }}
          >
            {/* the hackathon disclosure — ink variant on the cream field */}
            <HackathonFooterNote lang={lang} tone="ink" />
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                {/* the REAL brand mark, per product (founder 2026-08-08 — the
                    old white PNG vanished on cream; these carry dark bodies
                    and colored trails, so they read on the light field) */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product === 'legacy' ? '/astryum-mark-azul-transparente.png' : '/astryum-mark-gold-glow.png'}
                  alt=""
                  aria-hidden
                  style={{ width: 26, height: 26, display: 'block' }}
                />
                <span className="text-[13px] font-semibold" style={{ color: 'rgba(20,18,14,0.78)' }}>
                  Astryum
                </span>
                <span className="text-xs" style={{ color: 'rgba(20,18,14,0.45)' }}>
                  Financial Control. Total Clarity.
                </span>
              </div>
              <div className="flex items-center gap-4">
                <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="text-xs transition-opacity hover:opacity-70" style={{ color: 'rgba(20,18,14,0.5)' }}>
                  Discord
                </a>
                {/* Legal pages — ink variant on the cream field */}
                <a href="/demo-terms" className="text-xs transition-opacity hover:opacity-70" style={{ color: 'rgba(20,18,14,0.5)' }}>
                  {es ? 'Condiciones' : 'Terms'}
                </a>
                <a href="/privacy" className="text-xs transition-opacity hover:opacity-70" style={{ color: 'rgba(20,18,14,0.5)' }}>
                  {es ? 'Privacidad y aviso legal' : 'Privacy & legal'}
                </a>
                <span className="text-xs" style={{ color: 'rgba(20,18,14,0.4)' }}>Astryum © 2026</span>
              </div>
            </div>
          </footer>
        )}
      </div>
    </section>
  );
}

// ─── Boarding pass — the final-CTA artifact. A ticket for the trip the product ───────
// actually sells: your wallet → the two layers (XRPL governs, Flare produces),
// custody stays yours, and the stub waits for exactly one thing — your signature
// (it draws itself in, on loop).
function BoardingPass({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const routeRef = useRef<HTMLDivElement>(null);
  // Continuous (no `once`) — the sole surviving loop in the Final CTA pauses
  // itself once scrolled out of view instead of running off-screen forever.
  const routeInView = useInView(routeRef, { margin: '-10% 0px -10% 0px' });
  const fields = [
    { k: es ? 'Custodia' : 'Custody', v: es ? 'Tuya' : 'Yours' },
    { k: es ? 'Comisiones' : 'Fees', v: es ? 'Visibles antes' : 'Shown first' },
    // "Claves · Nunca salen" retired (2026-07-29): the light beat two screens
    // up just said it — simulation is the fact the Home never states.
    { k: es ? 'Simulación' : 'Simulation', v: es ? 'Siempre previa' : 'Always first' },
  ];
  const barcode = [2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1, 4, 2, 1, 3, 1, 2, 2, 1];
  return (
    <div
      className="mx-auto max-w-[620px] rounded-2xl overflow-hidden text-left"
      style={{
        border: '1px solid hsl(var(--volt) / 0.32)',
        background: 'rgba(10,10,9,0.62)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 24px 70px rgba(0,0,0,0.45), 0 0 40px hsl(var(--volt) / 0.08)',
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        {/* main leaf — the route and the terms */}
        <div className="flex-1 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: GOLD_SOFT }}>
              <AsteroidGlyph size={14} />
              {es ? 'Astryum · Tarjeta de embarque' : 'Astryum · Boarding pass'}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">
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
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">{es ? 'Origen' : 'From'}</div>
              <div className="mt-1 text-sm font-semibold text-white whitespace-nowrap truncate">{es ? 'Tu wallet' : 'Your wallet'}</div>
            </div>
            <div ref={routeRef} className="relative flex-1 h-8 min-w-[40px]" aria-hidden>
              <svg viewBox="0 0 120 24" preserveAspectRatio="none" className="absolute inset-0 w-full h-full" fill="none">
                <line x1="2" y1="12" x2="110" y2="12" stroke="hsl(var(--volt) / 0.4)" strokeWidth="1.4" strokeDasharray="3 5" />
                <path d="M110 7.5 L118 12 L110 16.5" stroke="hsl(var(--volt) / 0.7)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              {!reduce && (
                <motion.span
                  className="absolute top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full"
                  style={{ background: GOLD, boxShadow: `0 0 8px ${GOLD}, 0 0 18px hsl(var(--volt) / 0.5)` }}
                  animate={routeInView ? { left: ['1%', '92%'], opacity: [0, 1, 1, 0] } : undefined}
                  transition={{ duration: 2.8, times: [0, 0.15, 0.85, 1], repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.6 }}
                />
              )}
            </div>
            <div className="shrink min-w-0 text-right">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/30">{es ? 'Destino' : 'To'}</div>
              <div className="mt-1 text-sm font-semibold whitespace-nowrap truncate" style={{ color: GOLD_SOFT }}>
                {SHOW_XRPL_ACT ? 'XRPL + Flare' : 'Flare mainnet'}
              </div>
            </div>
          </div>

          {/* the terms — the invariants, printed on the ticket. 2 cols below
              sm: three ~76px mono labels don't fit 232px of card, and the
              third field was clipped off entirely at 320px */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4" style={{ borderTop: `1px solid ${BORDER}` }}>
            {fields.map((f) => (
              <div key={f.k} className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.1em] sm:tracking-[0.16em] text-white/30 truncate">{f.k}</div>
                <div className="mt-1 text-[13px] font-semibold text-white/85">{f.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* perforation */}
        <div className="hidden sm:block my-4" style={{ borderLeft: '1px dashed rgba(255,255,255,0.18)' }} aria-hidden />
        <div className="sm:hidden mx-5" style={{ borderTop: '1px dashed rgba(255,255,255,0.18)' }} aria-hidden />

        {/* stub — waiting for the only thing Astryum can't do: your signature.
            Draws in ONCE (whileInView, viewport once) and stays — this is the
            second hand-drawn signature on the page, so it must not loop and
            dilute the SignatureBreak beat further up. */}
        <div className="sm:w-[188px] p-5 sm:p-6 flex flex-col justify-between gap-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: GOLD_SOFT }}>
              {es ? 'Firma aquí' : 'Sign here'}
            </div>
            <svg viewBox="0 0 150 46" className="mt-1 w-full" fill="none" aria-hidden>
              <motion.path
                d="M10 32 C 12 16, 22 8, 25 15 C 27 21, 18 33, 27 32 C 38 30.5, 40 17, 49 19 C 56 20.5, 53 32, 63 30.5 C 74 29, 76 16, 85 18 C 92 19.5, 89 31, 99 29.5 C 111 27.5, 119 23, 132 20"
                stroke={GOLD_SOFT}
                strokeWidth="1.7"
                strokeLinecap="round"
                initial={reduce ? undefined : { pathLength: 0 }}
                whileInView={reduce ? undefined : { pathLength: 1 }}
                viewport={{ once: true, margin: '-10%' }}
                transition={reduce ? undefined : { duration: 1.8, ease: 'easeInOut' }}
              />
              <line x1="8" y1="40" x2="142" y2="40" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
            </svg>
          </div>
          {/* barcode — decorative proof-of-ticket */}
          <div className="flex items-stretch gap-[3px] h-7" aria-hidden>
            {barcode.map((w, i) => (
              <span key={i} className="h-full" style={{ width: w, background: i % 5 === 0 ? 'hsl(var(--volt) / 0.55)' : 'rgba(255,255,255,0.3)' }} />
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

// ─── Footer ─────────────────────────────────────────────────────────────────────────
function Footer({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  return (
    <footer className="border-t px-6 md:px-10 lg:px-16 py-10 relative z-10" style={{ borderColor: BORDER_FAINT }}>
      <div className="max-w-6xl mx-auto flex flex-col gap-5">
        <HackathonFooterNote lang={lang} tone="dark" />
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-white/30">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_MARK} alt="Astryum" style={{ height: 40, width: 'auto' }} />
            <span className="text-white/45">Financial Control. Total Clarity.</span>
          </div>
          <div className="flex items-center gap-6">
            <span>{es ? 'No-custodia · Tú siempre firmas' : 'Non-custodial · You always sign'}</span>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="text-white/30 transition-colors hover:text-white/60">
              Discord
            </a>
            {/* Legal pages — reachable from the landing itself (Llei 20/2014: visible, permanent) */}
            <a href="/demo-terms" className="text-white/30 transition-colors hover:text-white/60">
              {es ? 'Condiciones' : 'Terms'}
            </a>
            <a href="/privacy" className="text-white/30 transition-colors hover:text-white/60">
              {es ? 'Privacidad y aviso legal' : 'Privacy & legal'}
            </a>
            <span className="text-white/20">Astryum © 2026</span>
          </div>
        </div>
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
function LandingCrossing({ to, onDone }: { to: JourneyProduct; onDone: () => void }) {
  return (
    <AuthorityCrossing
      direction={to === 'legacy' ? 'to-legacy' : 'to-personal'}
      label={to === 'legacy' ? 'Astryum Legacy' : undefined}
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
}: {
  progress: MotionValue<number>;
  raw: MotionValue<number>;
  product: JourneyProduct;
  lang: 'es' | 'en';
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
        TIMELINE_CENTERS.map((c, i) => ({
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
  }, [product]);

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
  const [mode, setMode] = useState<'dark' | 'light' | 'hidden'>('dark');

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
      setMode('dark');
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

  const hidden = mode === 'hidden';
  const light = mode === 'light';
  // Symbol only (founder 2026-08-03: "nada de texto"): a big double chevron
  // pointing down — the ONE arrow allowed on the page. The label lives in
  // aria-label for screen readers.
  const chevrons = (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 6.5L12 13L19 6.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />
      <path d="M5 12.5L12 19L19 12.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <motion.button
      onClick={() => window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: 'smooth' })}
      aria-label={T('Sigue bajando para ver más', 'Keep scrolling to see more', lang)}
      tabIndex={hidden ? -1 : 0}
      className={`fixed left-1/2 bottom-6 z-[60] grid place-items-center rounded-full border backdrop-blur-md transition-colors duration-500 ${
        light
          ? 'border-black/15 bg-white/45 hover:bg-white/60'
          : 'border-white/10 bg-black/35 hover:bg-black/50'
      }`}
      style={{ x: '-50%', width: 64, height: 64, color: light ? 'hsl(var(--volt-deep))' : 'hsl(var(--volt))' }}
      initial={{ opacity: 0, y: 10 }}
      animate={
        hidden
          ? { opacity: 0, y: 8, transitionEnd: { visibility: 'hidden' } }
          : { opacity: 1, y: 0, visibility: 'visible' }
      }
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      {reduced ? (
        chevrons
      ) : (
        <motion.span
          className="grid place-items-center"
          animate={{ y: [-3, 5, -3] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          {chevrons}
        </motion.span>
      )}
    </motion.button>
  );
}

// ─── Page orchestrator ──────────────────────────────────────────────────────────────
export default function LandingPage() {
  const [lang, setLang] = useLang();
  const [loginOpen, setLoginOpen] = useState(false);
  // Product lives at the page root so the WHOLE landing re-themes with it:
  // data-authority='governed' flips the --volt family (globals.css), and every
  // accent here now reads those tokens — same mechanism as the dashboard.
  // Persisted (like the language) so /early-access opens in the same color.
  const [product, setProductState] = useState<JourneyProduct>('personal');
  useEffect(() => {
    try {
      const s = localStorage.getItem('astryum:product');
      if (s === 'legacy' || s === 'personal') setProductState(s);
    } catch {
      /* ignore */
    }
  }, []);
  // A real product change stages the landing crossing (skipped when the same
  // segment is re-clicked, and by LandingCrossing itself under reduced motion).
  const [crossing, setCrossing] = useState<{ to: JourneyProduct; n: number } | null>(null);
  const crossN = useRef(0);
  const productRef = useRef(product);
  productRef.current = product;
  const setProduct = useCallback((p: JourneyProduct) => {
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
      data-authority={product === 'legacy' ? 'governed' : undefined}
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
        .lp-base { background: radial-gradient(130% 90% at 50% -15%, #1a150b 0%, #100d08 38%, #080807 100%); }
        .lp-base-governed { background: radial-gradient(130% 90% at 50% -15%, #131530 0%, #0B0C1E 38%, #070810 100%); }
        .lp-horizon { background: radial-gradient(80% 100% at 50% 0%, rgba(201,162,39,0.16), transparent 70%); }
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
      <JourneyTimeline progress={progress} raw={scrollYProgress} product={product} lang={lang} />
      {/* page-long "keep scrolling" capsule — the tour lives below the fold */}
      <PersistentScrollCue lang={lang} />
      {/* the access gate's answer, when it turned a gold CTA away */}
      <GateNotice lang={lang} />
      <SpaceBackdrop legacy={product === 'legacy'} />
      {crossing && <LandingCrossing key={crossing.n} to={crossing.to} onDone={() => setCrossing(null)} />}
      <div className="relative z-10">
        {/* hackathon disclosure — persistent strip; the header sits BANNER_H lower */}
        <HackathonBanner lang={lang} />
        <Header lang={lang} setLang={setLang} onSecretLogin={openDoor} product={product === 'legacy' ? 'legacy' : 'personal'} />
        <main>
          {SHOW_JOURNEY ? (
            <SolarJourney
              lang={lang}
              hero={<HeroContent lang={lang} />}
              finaleCta={
                <AccessCTA label={lang === 'es' ? 'Entra en la beta' : 'Enter the beta'} size="lg" strong />
              }
              product={product}
              onProductChange={setProduct}
            />
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
          <SignatureBreak lang={lang} product={product === 'legacy' ? 'legacy' : 'personal'} />
          {!SHOW_JOURNEY && <Narrative lang={lang} />}
          {/* PartnerMarquee removed for the hackathon build (aspirational logos out). */}
          {/* DocsSection hidden until the GitBook space is published (its links 404) — restore post-E1. */}
          {!SHOW_JOURNEY && <FinalCta lang={lang} />}
        </main>
        {!SHOW_JOURNEY && <Footer lang={lang} />}
      </div>
      {loginOpen && <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

'use client';

/**
 * Astryum — /early-access. The boarding desk.
 *
 * Both public doors on the landing ("Request early access" and "Try the demo")
 * lead here. The page is a deep-space transmission console: the visitor leaves
 * their signal (email) and is entered into the crew manifest. On success the
 * console stamps a personalised boarding artifact — a call-sign and star
 * coordinates derived deterministically from the email — echoing the landing's
 * boarding-pass + signature narrative.
 *
 * Capture goes to POST {API}/waitlist (public, write-only, rate-limited). If
 * the relay doesn't answer, a direct mailto fallback is offered so no signal
 * is ever lost. We store email + door + language, nothing else.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { getApiBase } from '@/lib/env';
import { EASE, GOLD, Magnetic, Reveal } from './interactions';
import TurnstileWidget, { turnstileEnabled } from '../security/TurnstileWidget';
import { HackathonFooterNote } from './HackathonNotice';

const StarfieldCanvas = dynamic(() => import('./StarfieldCanvas'), { ssr: false });

// Rides the dashboard tokens like the landing does: when the visitor chose
// Legacy (stored product, or the ?intent=legacy door) the page mounts
// data-authority='governed' and the whole accent family flips to indigo.
const GOLD_SOFT = 'hsl(var(--volt-soft, 45 75% 62%))';
const LOGO_MARK = '/astryum-asteroid.png';
// Last-resort door if the relay (backend) is down — a signal must never be lost.
const FALLBACK_MAILTO = 'mailto:astryum@astryum.xyz?subject=Astryum%20early%20access';

// ─── Mission channels — the page's social links, edited in ONE place. ───────────────
// Point only at channels that actually exist. X (@Astryum_) is live; the Linktree
// and GitBook are not published yet, so they stay out until they are.
const SOCIALS = [
  { id: 'x', label: 'X', handle: '@Astryum_', href: 'https://x.com/Astryum_' },
] as const;

type Lang = 'es' | 'en';
type Intent = 'early-access' | 'demo' | 'legacy';
type Phase = 'idle' | 'sending' | 'done' | 'error';

// Same persisted language as the landing (astryum:lang). With no saved
// preference, fall back to the browser's configured language so the welcome
// email goes out in the reader's own language (es → Spanish, else English).
function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => {
    try {
      const s = localStorage.getItem('astryum:lang');
      if (s === 'en' || s === 'es') {
        setLang(s);
        return;
      }
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

// ─── The curious artifact: every email maps to a unique, repeatable identity. ────────
// FNV-1a over the normalised email → call-sign + right-ascension/declination.
// Pure play, not a claim: the "coordinates" are the visitor's own spot in the
// Astryum sky, the same every time they come back.
function signalIdentity(email: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < email.length; i++) {
    h ^= email.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const callsign = `AST-${(h % 0x10000).toString(16).toUpperCase().padStart(4, '0')}`;
  const raH = (h >>> 8) % 24;
  const raM = (h >>> 13) % 60;
  const decSign = (h >>> 19) % 2 === 0 ? '+' : '−';
  const decD = (h >>> 20) % 90;
  const decM = (h >>> 3) % 60;
  return {
    callsign,
    coords: `RA ${raH}h ${String(raM).padStart(2, '0')}m · DEC ${decSign}${String(decD).padStart(2, '0')}° ${String(decM).padStart(2, '0')}′`,
  };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const head = user.slice(0, Math.min(2, user.length));
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

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

// ─── Space backdrop — the landing's atmosphere, lighter (no pointer parallax). ───────
function Backdrop() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(130% 90% at 50% -15%, #1a150b 0%, #100d08 38%, #080807 100%)' }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[55vh]"
        style={{ background: 'radial-gradient(70% 100% at 50% 0%, hsl(var(--volt) / 0.14), transparent 70%)' }}
      />
      <StarfieldCanvas />
      <div
        className="absolute -bottom-48 left-1/2 -translate-x-1/2 w-[820px] h-[520px] rounded-full aurora-drift"
        style={{ background: 'radial-gradient(50% 50% at 50% 50%, hsl(var(--volt) / 0.08), transparent 70%)', filter: 'blur(60px)' }}
      />
    </div>
  );
}

// ─── Rotating early-access seal (SVG textPath) — the stamp on the manifest. ─────────
function Seal({ size = 96 }: { size?: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      style={{ width: size, height: size }}
      initial={{ scale: 1.5, opacity: 0, rotate: -14 }}
      animate={{ scale: 1, opacity: 1, rotate: -8 }}
      transition={{ duration: reduce ? 0 : 0.45, ease: EASE, delay: reduce ? 0 : 0.55 }}
      aria-hidden
    >
      <svg viewBox="0 0 100 100" fill="none" className="w-full h-full">
        <defs>
          <path id="ea-seal-ring" d="M50 12 a38 38 0 1 1 -0.01 0" />
        </defs>
        <circle cx="50" cy="50" r="47" stroke="hsl(var(--volt) / 0.55)" strokeWidth="1.6" />
        <circle cx="50" cy="50" r="30" stroke="hsl(var(--volt) / 0.35)" strokeWidth="1" />
        {/* only the text ring spins — the check stays upright */}
        <g>
          <text fontSize="8.6" letterSpacing="2.1" fill={GOLD_SOFT} fontFamily="JetBrains Mono, Monaco, monospace">
            <textPath href="#ea-seal-ring">ASTRYUM · EARLY ACCESS · V1 FLARE ·</textPath>
          </text>
          {!reduce && (
            <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="40s" repeatCount="indefinite" />
          )}
        </g>
        <path d="M40 50.5l7 7 13.5-14" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </motion.div>
  );
}

// ─── Telemetry strip — the console's living readouts. ───────────────────────────────
function Telemetry({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  // Only readings that are true statements (de-AI pass 2026-07-21): the
  // invented "RELAY 14" / "DRIFT 0.003°" numbers looked like live telemetry
  // but measured nothing — cut, not replaced.
  const items = [
    { k: es ? 'CANAL' : 'CHANNEL', v: es ? 'ABIERTO' : 'OPEN', live: true },
    { k: es ? 'CUSTODIA' : 'CUSTODY', v: es ? 'TUYA' : 'YOURS', live: false },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {items.map((it) => (
        <span key={it.k} className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">
          {it.live && (
            <motion.span
              className="w-[6px] h-[6px] rounded-full shrink-0"
              style={{ background: '#4ade80', boxShadow: '0 0 8px rgba(74,222,128,0.7)' }}
              animate={reduce ? undefined : { opacity: [1, 0.35, 1] }}
              transition={reduce ? undefined : { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              aria-hidden
            />
          )}
          {it.k} <span style={{ color: GOLD_SOFT }}>{it.v}</span>
        </span>
      ))}
    </div>
  );
}

// ─── The stamped manifest — success artifact. ────────────────────────────────────────
function ManifestCard({ email, lang }: { email: string; lang: Lang }) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const { callsign, coords } = signalIdentity(email.trim().toLowerCase());
  const fields = [
    { k: 'CALL-SIGN', v: callsign },
    { k: es ? 'COORDENADAS' : 'COORDINATES', v: coords },
    { k: es ? 'CANAL' : 'CHANNEL', v: maskEmail(email) },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
      className="relative overflow-hidden rounded-2xl text-left"
      style={{
        border: '1px solid hsl(var(--volt) / 0.32)',
        background: 'rgba(10,10,9,0.62)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 24px 70px rgba(0,0,0,0.45), 0 0 40px hsl(var(--volt) / 0.08)',
      }}
    >
      <div className="p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
            <AsteroidGlyph size={14} />
            {es ? 'Astryum · Manifiesto de tripulación' : 'Astryum · Crew manifest'}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">V1 · Flare</span>
        </div>

        <h2 className="mt-5 text-2xl sm:text-3xl font-bold text-white" style={{ letterSpacing: '-0.025em' }}>
          {es ? 'Señal recibida.' : 'Signal received.'}
        </h2>
        <p className="mt-2 text-sm text-white/60 max-w-md">
          {es
            ? 'Estás en el manifiesto. Te avisaremos por correo cuando abra tu oleada de embarque.'
            : "You're on the manifest. We'll email you when your boarding wave opens."}
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {fields.map((f) => (
            <div key={f.k} className={f.k === (es ? 'COORDENADAS' : 'COORDINATES') ? 'sm:col-span-2' : ''}>
              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">{f.k}</div>
              <div className="mt-1 font-mono text-[13px] font-semibold" style={{ color: f.k === 'CALL-SIGN' ? GOLD_SOFT : 'rgba(255,255,255,0.85)' }}>
                {f.v}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-end justify-between gap-6">
          <div className="flex-1 max-w-[240px]">
            <div className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD_SOFT }}>
              {es ? 'Firma del sistema' : 'System signature'}
            </div>
            <svg viewBox="0 0 150 40" className="mt-1 w-full" fill="none" aria-hidden>
              <motion.path
                d="M10 28 C 12 14, 22 7, 25 13 C 27 19, 18 29, 27 28 C 38 26.5, 40 15, 49 17 C 56 18.5, 53 28, 63 26.5 C 74 25, 76 14, 85 16 C 92 17.5, 89 27, 99 25.5 C 111 23.5, 119 20, 132 17"
                stroke={GOLD_SOFT}
                strokeWidth="1.7"
                strokeLinecap="round"
                initial={reduce ? undefined : { pathLength: 0 }}
                animate={reduce ? undefined : { pathLength: 1 }}
                transition={reduce ? undefined : { duration: 1.4, ease: 'easeInOut', delay: 0.35 }}
              />
              <line x1="8" y1="35" x2="142" y2="35" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
            </svg>
            <p className="mt-2 text-[11px] text-white/40">
              {es ? 'La única firma que Astryum dará jamás. La tuya, nunca.' : 'The only signature Astryum will ever give. Never yours.'}
            </p>
          </div>
          <Seal />
        </div>
      </div>
    </motion.div>
  );
}

// ─── The transmission console — email capture form. ─────────────────────────────────
function Console({
  lang,
  intent,
  onDone,
}: {
  lang: Lang;
  intent: Intent;
  onDone: (email: string) => void;
}) {
  const es = lang === 'es';
  const reduce = useReducedMotion();
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [step, setStep] = useState(0);
  // Anti-bot pair (2026-07-23 — bots flooded this relay): a Turnstile token
  // when the sitekey is configured, plus a honeypot no human ever sees.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [honeypot, setHoneypot] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const sendingSteps = es
    ? ['Alineando antena…', 'Enlazando relé 14…', 'Transmitiendo señal…']
    : ['Aligning antenna…', 'Linking relay 14…', 'Transmitting signal…'];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase === 'sending') return;
    if (turnstileEnabled() && !captchaToken) return; // button sits disabled until the check clears
    setPhase('sending');
    setStep(0);
    // Pace the console readout so the transmission reads as a sequence even
    // when the POST answers instantly. ~1.5s total, skipped for reduced motion.
    const pacing = reduce
      ? Promise.resolve()
      : (async () => {
          for (let i = 1; i < sendingSteps.length; i++) {
            await new Promise((r) => setTimeout(r, 520));
            if (alive.current) setStep(i);
          }
        })();
    const post = (async () => {
      const res = await fetch(`${getApiBase()}/waitlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          source: intent,
          lang,
          captchaToken: captchaToken ?? undefined,
          website: honeypot, // honeypot — humans never see the field
        }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (!res.ok || !body?.ok) throw new Error('relay_down');
    })();
    try {
      await Promise.all([post, pacing]);
      if (alive.current) onDone(email);
    } catch {
      if (alive.current) {
        setCaptchaReset((n) => n + 1); // the token was consumed — mint a fresh one
        setPhase('error');
      }
    }
  };

  return (
    <motion.form
      onSubmit={submit}
      initial={false}
      className="relative overflow-hidden rounded-2xl text-left"
      style={{
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(10,10,9,0.62)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 24px 70px rgba(0,0,0,0.45)',
      }}
    >
      <div className="p-6 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
            {es ? 'Uplink · astryum.relay' : 'Uplink · astryum.relay'}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">
            {intent === 'demo'
              ? es
                ? 'Puerta · Demo'
                : 'Door · Demo'
              : intent === 'legacy'
                ? es
                  ? 'Puerta · Legacy'
                  : 'Door · Legacy'
                : es
                  ? 'Puerta · Acceso'
                  : 'Door · Access'}
          </span>
        </div>

        <label htmlFor="ea-email" className="mt-6 block font-mono text-[10px] uppercase tracking-[0.18em] text-white/60">
          {es ? 'Tu correo' : 'Your email'}
        </label>
        <div className="mt-2 flex flex-col sm:flex-row gap-3">
          <input
            id="ea-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={es ? 'tu@correo.com' : 'you@email.com'}
            disabled={phase === 'sending'}
            className="flex-1 min-w-0 rounded-xl px-4 py-3.5 text-[15px] text-white outline-none transition-colors placeholder:text-white/55 disabled:opacity-60"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)' }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'hsl(var(--volt) / 0.6)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)')}
          />
          <Magnetic strength={0.3} className="inline-block shrink-0">
            <button
              type="submit"
              disabled={phase === 'sending' || (turnstileEnabled() && !captchaToken)}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 rounded-xl px-6 py-3.5 text-sm font-semibold text-black transition-all hover:brightness-105 disabled:opacity-80"
              style={{ background: GOLD, boxShadow: '0 8px 30px hsl(var(--volt) / 0.28)' }}
            >
              {/* Literal verb, not metaphor (founder rule: concrete copy > metaphor,
                  2026-07-21) — the button says what clicking it does. */}
              {phase === 'sending' ? (es ? 'Pidiendo acceso' : 'Requesting access') : es ? 'Pedir acceso' : 'Request access'}
              {phase === 'sending' ? (
                <motion.span
                  className="w-[7px] h-[7px] rounded-full bg-black/70"
                  animate={reduce ? undefined : { opacity: [1, 0.2, 1] }}
                  transition={reduce ? undefined : { duration: 0.7, repeat: Infinity }}
                  aria-hidden
                />
              ) : (
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </Magnetic>
        </div>

        {/* honeypot — off-screen, never announced; bots that fill it are
            swallowed server-side with a fake success */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="ea-website">Website</label>
          <input
            id="ea-website"
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        {/* anti-bot check — renders only when the sitekey is configured */}
        <TurnstileWidget onToken={setCaptchaToken} resetSignal={captchaReset} theme="dark" className="mt-4" />

        {/* console readout — transmission sequence / error, with a steady height */}
        <div className="mt-4 min-h-[20px]" aria-live="polite">
          {phase === 'sending' && (
            <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: GOLD_SOFT }}>
              {sendingSteps[step]}
            </span>
          )}
          {phase === 'error' && (
            <span className="text-[13px]" style={{ color: '#f87171' }}>
              {es ? 'El relé no responde. Prueba de nuevo o ' : "The relay isn't answering. Try again or "}
              <a href={FALLBACK_MAILTO} className="underline underline-offset-2" style={{ color: GOLD_SOFT }}>
                {es ? 'envía tu señal directa →' : 'send your signal directly →'}
              </a>
            </span>
          )}
          {phase === 'idle' && (
            <span className="text-[12px] text-white/55">
              {es
                ? 'Solo usamos tu correo para el aviso de embarque. Nada más.'
                : 'We only use your email for the boarding call. Nothing else.'}
            </span>
          )}
        </div>

        <div className="mt-6 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <Telemetry lang={lang} />
        </div>
      </div>
    </motion.form>
  );
}

// ─── Social row — follow the mission. ────────────────────────────────────────────────
// X (formerly Twitter) mark.
function SocialIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  );
}

function SocialRow({ lang }: { lang: Lang }) {
  const es = lang === 'es';
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45 text-center">
        {es ? 'Sigue la misión' : 'Follow the mission'}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        {SOCIALS.map((s) => (
          <Magnetic key={s.id} strength={0.25} className="inline-block">
            <a
              href={s.href}
              target={s.href.startsWith('mailto:') ? undefined : '_blank'}
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-white/[0.05]"
              style={{ border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.75)' }}
            >
              <span className="transition-colors group-hover:text-white" style={{ color: GOLD_SOFT }}>
                <SocialIcon />
              </span>
              {s.label}
              <span className="hidden sm:inline font-mono text-[10px] text-white/40">{s.handle}</span>
            </a>
          </Magnetic>
        ))}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────────────
export default function EarlyAccessPage() {
  const [lang, setLang] = useLang();
  const es = lang === 'es';
  const [intent, setIntent] = useState<Intent>('early-access');
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  // Theme follows the product chosen on the landing (persisted) or the
  // Legacy-specific door; SSR/first paint stays gold to match the server HTML.
  const [governed, setGoverned] = useState(false);

  // The demo and Legacy doors arrive with ?intent=demo / ?intent=legacy — read
  // once on mount (no useSearchParams: keeps the page out of a Suspense boundary).
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('intent');
      if (q === 'demo' || q === 'legacy') setIntent(q);
      setGoverned(q === 'legacy' || localStorage.getItem('astryum:product') === 'legacy');
    } catch {
      /* ignore */
    }
  }, []);

  const headline =
    intent === 'demo'
      ? es
        ? 'La demo embarca pronto.'
        : 'The demo boards soon.'
      : intent === 'legacy'
        ? es
          ? 'Los primeros consejos se constituyen pronto.'
          : 'The first councils form soon.'
        : es
          ? 'Deja tu señal.'
          : 'Leave your signal.';
  const sub =
    intent === 'demo'
      ? es
        ? 'Estamos sentando a la tripulación por oleadas. Deja tu correo y serás de los primeros a los mandos.'
        : "We're seating the crew in waves. Leave your email and you'll be among the first at the controls."
      : intent === 'legacy'
        ? es
          ? 'Consejos, constituciones y transferencias programadas sobre XRPL — construidos, abriendo pronto. Deja tu correo y te llamaremos para constituir uno de los primeros consejos.'
          : 'Councils, constitutions and programmed transfers on XRPL — built, opening soon. Leave your email and we’ll call you to constitute one of the first councils.'
        : es
          ? 'Astryum abre por oleadas. Deja tu correo y te llamaremos cuando tu asiento esté listo.'
          : "Astryum opens in waves. Leave your email and we'll call you when your seat is ready.";

  return (
    <div
      data-authority={governed ? 'governed' : undefined}
      className="relative min-h-screen text-white"
      style={{ background: governed ? '#070810' : '#080808', overflowX: 'clip' }}
    >
      <Backdrop />

      <div className="relative z-10 flex flex-col min-h-screen">
        {/* minimal header — the way back + language */}
        <header className="flex items-center justify-between gap-4 px-6 md:px-10 py-5 max-w-5xl w-full mx-auto">
          <Link href="/" className="flex items-center gap-3 group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_MARK} alt="Astryum" style={{ height: 44, width: 'auto', display: 'block' }} />
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/" className="hidden sm:block text-[13px] text-white/55 hover:text-white transition-colors">
              {es ? '← Volver' : '← Back'}
            </Link>
            <div
              className="flex items-center gap-0.5 p-0.5 rounded-full"
              style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
            >
              {(['es', 'en'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium transition-all uppercase"
                  style={{ background: lang === l ? GOLD : 'transparent', color: lang === l ? '#000' : 'rgba(255,255,255,0.4)' }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </header>

        <main className="flex-1 flex items-center px-6 md:px-10 py-12">
          <div className="w-full max-w-[640px] mx-auto">
            <Reveal>
              <div className="text-center">
                <span
                  className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em]"
                  style={{ border: '1px solid hsl(var(--volt) / 0.3)', color: GOLD_SOFT, background: 'hsl(var(--volt) / 0.06)' }}
                >
                  <AsteroidGlyph size={13} />
                  {es ? 'Canal de embarque · Abierto' : 'Boarding channel · Open'}
                </span>
                <h1
                  className="mt-6 font-bold text-white"
                  style={{ fontSize: 'clamp(2.1rem, 5vw, 3.6rem)', lineHeight: 1.08, letterSpacing: '-0.03em', textWrap: 'balance' }}
                >
                  {headline}
                </h1>
                <p className="mt-4 text-white/60 max-w-md mx-auto" style={{ fontSize: 'clamp(14.5px, 1.3vw, 16.5px)' }}>
                  {sub}
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.12}>
              <div className="mt-10">
                <AnimatePresence mode="wait" initial={false}>
                  {sentEmail ? (
                    <ManifestCard key="manifest" email={sentEmail} lang={lang} />
                  ) : (
                    <motion.div key="console" exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25, ease: EASE }}>
                      <Console lang={lang} intent={intent} onDone={setSentEmail} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </Reveal>

            <Reveal delay={0.2}>
              <div className="mt-14">
                <SocialRow lang={lang} />
              </div>
            </Reveal>
          </div>
        </main>

        <footer className="px-6 py-8 text-center flex flex-col items-center gap-3">
          <HackathonFooterNote lang={lang} tone="dark" />
          <span className="text-[11px] text-white/35">
            {es ? 'No-custodial · Siempre tú firmas' : 'Non-custodial · You always sign'} · Astryum © 2026
          </span>
        </footer>
      </div>
    </div>
  );
}

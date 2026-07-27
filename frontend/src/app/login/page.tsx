'use client';

/**
 * Astryum — access console (/login).
 *
 * The command-deck door. Still hidden: you only reach it through the landing's
 * access gate (logo ×5 or Ctrl+Shift+L → access code → signed httpOnly
 * cookie) — middleware.ts bounces direct visits without the cookie back to
 * the landing BEFORE this page is ever served.
 *
 * The form IS the artifact: an access pass you fill in like a transaction card
 * (ticket fields, printed terms, a perforation) and then SIGN — the submit is
 * a "sign here" stub whose stroke inks itself when you commit. On-brand: the
 * only signature in the product is always the user's.
 *
 * Native email accounts (sign in / create) ride the backend via authStore.
 * The old in-bundle "judges' credentials" are GONE (2026-07-23): the door is
 * the server-verified access code (middleware + httpOnly cookie), and this
 * page only renders once that gate has already passed. A Turnstile check
 * rides every credential submit when the sitekey is configured.
 * Google / Apple go live per-provider once their NEXT_PUBLIC_* client id is
 * set; unconfigured providers keep the honest "channel not open" notice.
 *
 * While credentials verify, the card gives way to a crew-manifest readout that
 * decodes itself: scrambled fields resolving, a terminal log line by line, a
 * scanline sweep, a live UTC clock once the timestamp resolves, and — on
 * grant — the session countersigned with the stroke you just drew plus the
 * gold seal. Reduced motion collapses all of it to plain status text.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useAuthStore } from '../../stores/authStore';
import { EASE, GOLD } from '../../components/landing/interactions';
import TurnstileWidget, { turnstileEnabled } from '../../components/security/TurnstileWidget';
import {
  appleOAuthEnabled,
  appleSignIn,
  decodeJwtPayload,
  googleOAuthEnabled,
  renderGoogleButton,
} from '../../lib/oauth';

const StarfieldCanvas = dynamic(() => import('../../components/landing/StarfieldCanvas'), { ssr: false });

const GOLD_SOFT = '#E8C25A';
const LOGO_MARK = '/astryum-asteroid.png';

const EMAIL_AUTH = process.env.NEXT_PUBLIC_EMAIL_AUTH_ENABLED !== 'false';
const PASSKEY_AUTH = process.env.NEXT_PUBLIC_PASSKEY_ENABLED === 'true';

// The user's quick stroke — deliberately NOT the Astryum autograph: on this
// card it's YOU who signs. Drawn in the sign-here stub and countersigned into
// the manifest once the session is granted.
const SIGN_STROKE =
  'M 6 27 C 13 10, 21 7, 23.5 13.5 C 25.5 19, 18.5 26, 25 26 C 33 26, 36.5 13.5, 44 14.5 C 50 15.3, 47.5 24, 55 22.5 C 64 20.7, 68 13, 77 12 C 85 11.2, 92 12.5, 98 10.5';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

// Backend answers with machine codes — translate the ones a person can act on.
function errorToCopy(code: string, lang: Lang): string {
  switch (code) {
    case 'invalid_credentials':
      return T('Credenciales inválidas.', 'Invalid credentials.', lang);
    case 'email_taken':
      return T('Ese email ya tiene cuenta — prueba a entrar.', 'That email already has an account — try signing in.', lang);
    case 'rate_limited':
      return T('Demasiados intentos. Espera unos minutos.', 'Too many attempts. Wait a few minutes.', lang);
    case 'captcha_required':
    case 'captcha_failed':
      return T('La verificación anti-bot falló. Prueba de nuevo.', 'The anti-bot check failed. Try again.', lang);
    case 'captcha_unavailable':
      return T('Verificación anti-bot no disponible ahora mismo.', 'Anti-bot check unavailable right now.', lang);
    case 'account_disabled':
      return T('Esta cuenta está deshabilitada.', 'This account is disabled.', lang);
    case 'oauth_email_unverified':
      return T('Ese proveedor no verifica tu email — usa email y contraseña.', 'That provider does not verify your email — use email + password.', lang);
    default:
      return code;
  }
}

// ─── Persistent language (same key the landing uses) ────────────────────────────────
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

// ─── Identity play — mirrors the early-access manifest (FNV-1a → call-sign) ─────────
function signalIdentity(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `AST-${(h % 0x10000).toString(16).toUpperCase().padStart(4, '0')}`;
}

function maskIdentifier(id: string): string {
  const [user, domain] = id.split('@');
  if (!domain) return id;
  const head = user.slice(0, Math.min(2, user.length));
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

function utcStamp(): string {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10)} · ${iso.slice(11, 19)} UTC`;
}

// ─── DecodeText — resolves left→right out of cipher noise ("hacker letters") ─────────
const CIPHER = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@§Ø◆·';

function DecodeText({
  text,
  delay = 0,
  duration = 900,
  className,
  style,
}: {
  text: string;
  delay?: number;
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const reduce = useReducedMotion();
  const [out, setOut] = useState(() => (reduce ? text : ''));
  useEffect(() => {
    if (reduce) {
      setOut(text);
      return undefined;
    }
    let raf = 0;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const el = t - start - delay;
      if (el < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const p = Math.min(1, el / duration);
      const solved = Math.floor(p * text.length);
      let s = text.slice(0, solved);
      for (let i = solved; i < text.length; i++) {
        s += text[i] === ' ' ? ' ' : CIPHER[(Math.random() * CIPHER.length) | 0];
      }
      setOut(s);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, delay, duration, reduce]);
  // Reserve the final width so the card doesn't breathe while noise resolves.
  return (
    <span className={`relative inline-block ${className ?? ''}`} style={style}>
      <span className="invisible">{text}</span>
      <span className="absolute inset-0">{out}</span>
    </span>
  );
}

// ─── LiveUTC — decodes the submit timestamp, then keeps ticking for real ─────────────
function LiveUTC({ initial }: { initial: string }) {
  const reduce = useReducedMotion();
  const [live, setLive] = useState(false);
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const flip = setTimeout(() => setLive(true), reduce ? 0 : 2000);
    return () => clearTimeout(flip);
  }, [reduce]);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setNow(utcStamp()), 1000);
    return () => clearInterval(id);
  }, [live]);
  return live ? <span>{now}</span> : <DecodeText text={initial} delay={680} duration={1100} />;
}

// ─── Space backdrop (login-weight: gradient + stars + one aura + grain) ──────────────
function DeckBackdrop() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(130% 90% at 50% -15%, #1a150b 0%, #100d08 38%, #080807 100%)' }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[50vh]"
        style={{ background: 'radial-gradient(70% 100% at 50% 0%, rgba(201,162,39,0.14), transparent 70%)' }}
      />
      <StarfieldCanvas />
      <div
        className="absolute -bottom-40 left-1/2 -translate-x-1/2 w-[760px] h-[520px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(201,162,39,0.1), transparent 68%)', filter: 'blur(50px)' }}
      />
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

function AsteroidGlyph({ size = 14 }: { size?: number }) {
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
    </svg>
  );
}

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      <path
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 009 18z"
        fill="#34A853"
      />
      <path d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.96a9 9 0 000 8.1l3-2.33z" fill="#FBBC05" />
      <path
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A8.98 8.98 0 009 0 9 9 0 00.96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 384 512" fill="currentColor" aria-hidden>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

// ─── Google button slot — our shell, Google's click ──────────────────────────────────
// The card keeps ITS OWN button (same skin as Apple's — founder 2026-07-24:
// the stock GIS widget broke the deck's look), but the element that actually
// receives the click is the REAL Google Identity Services button, rendered
// invisible and stretched across the shell. That keeps the official id_token
// popup flow intact — we restyle the shell, never reimplement the auth. If
// the GIS script can't load, the shell dims and stays inert.
function GoogleButtonSlot({ onCredential }: { onCredential: (idToken: string) => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const credentialRef = useRef(onCredential);
  credentialRef.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    renderGoogleButton(el, (token) => credentialRef.current(token)).catch(() => setFailed(true));
  }, []);

  return (
    <div
      className={`relative overflow-hidden rounded-xl transition-colors ${failed ? '' : 'hover:bg-white/[0.06]'}`}
      style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
      title={failed ? 'Google no disponible ahora mismo' : undefined}
    >
      {/* the visible shell — visually identical to the Apple button */}
      <div
        className={`pointer-events-none flex items-center justify-center gap-2.5 py-3 text-[13px] font-semibold ${
          failed ? 'text-white/35' : 'text-white/85'
        }`}
      >
        <GoogleIcon />
        Google
      </div>
      {/* the real GIS button: invisible, scaled up so any click on the shell
          lands on it (the iframe keeps Google's popup + FedCM plumbing).
          brightness(0) renders its content pure black — at 1% opacity over the
          dark card that is truly nothing; opacity alone left the widget's own
          "Continue with Google" ghosting through the shell (founder
          2026-07-25: "letras de fondo"). Clicks are unaffected: filters are
          paint-only. */}
      {!failed && (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-10 flex items-center justify-center"
          style={{
            opacity: 0.01,
            filter: 'brightness(0)',
            transform: 'scale(2.6)',
            transformOrigin: 'center',
            colorScheme: 'light',
          }}
        />
      )}
    </div>
  );
}

// ─── Manifest readout shown while credentials verify ─────────────────────────────────
type DecodePayload = {
  operator: string;
  callsign: string;
  utc: string;
  clearance: string;
  mode: 'signin' | 'create';
};

function DecodingManifest({
  lang,
  payload,
  granted,
  denied,
}: {
  lang: Lang;
  payload: DecodePayload;
  granted: boolean;
  denied: boolean;
}) {
  const reduce = useReducedMotion();

  // Terminal log — one line per beat; the last line stays "working" until the
  // channel answers, then collects its OK / ✗.
  const logLines = useMemo(
    () => [
      T('enlace con relé 14 · flare', 'link to relay 14 · flare', lang),
      T('cifrando canal', 'encrypting channel', lang),
      payload.mode === 'create'
        ? T('registrando operador', 'registering operator', lang)
        : T('verificando credenciales', 'verifying credentials', lang),
    ],
    [lang, payload.mode],
  );
  const [logStep, setLogStep] = useState(0);
  useEffect(() => {
    if (reduce) {
      setLogStep(logLines.length - 1);
      return undefined;
    }
    const id = setInterval(() => setLogStep((s) => Math.min(s + 1, logLines.length - 1)), 760);
    return () => clearInterval(id);
  }, [logLines, reduce]);

  const fields = [
    { k: T('Operador', 'Operator', lang), v: payload.operator, d: 150 },
    { k: 'Call-sign', v: payload.callsign, d: 420, gold: true },
    { k: T('Autorización', 'Clearance', lang), v: payload.clearance, d: 940 },
  ];

  const settled = granted || denied;

  return (
    <motion.div
      key="decode"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.99 }}
      transition={{ duration: 0.4, ease: EASE }}
      role="status"
      aria-live="polite"
    >
      {/* scanline sweep — the reader passing over the card */}
      {!reduce && !settled && (
        <motion.div
          className="absolute inset-x-0 pointer-events-none"
          style={{ height: 52, background: 'linear-gradient(180deg, transparent, rgba(232,194,90,0.08), transparent)' }}
          initial={{ top: '-14%' }}
          animate={{ top: ['-14%', '108%'] }}
          transition={{ duration: 2.3, repeat: Infinity, ease: 'linear' }}
          aria-hidden
        />
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
          <AsteroidGlyph size={14} />
          {T('Astryum · Canal seguro', 'Astryum · Secure channel', lang)}
        </span>
        <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">
          {!denied && (
            <motion.span
              className="w-[6px] h-[6px] rounded-full"
              style={{ background: '#4ade80', boxShadow: '0 0 8px rgba(74,222,128,0.7)' }}
              animate={reduce ? undefined : { opacity: [1, 0.35, 1] }}
              transition={reduce ? undefined : { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              aria-hidden
            />
          )}
          {denied ? T('Rechazado', 'Rejected', lang) : T('En vivo', 'Live', lang)}
        </span>
      </div>

      <h2 className="mt-6 text-2xl font-bold text-white" style={{ letterSpacing: '-0.025em' }}>
        {granted
          ? T('Acceso concedido.', 'Access granted.', lang)
          : denied
            ? T('Señal rechazada.', 'Signal rejected.', lang)
            : T('Descodificando…', 'Decoding…', lang)}
      </h2>

      {/* identity fields — scrambled noise resolving into the manifest */}
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {fields.map((f) => (
          <div key={f.k}>
            <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">{f.k}</div>
            <div className="mt-1.5 font-mono text-[13px] font-semibold" style={{ color: f.gold ? GOLD_SOFT : 'rgba(255,255,255,0.85)' }}>
              <DecodeText text={f.v} delay={f.d} duration={1100} />
            </div>
          </div>
        ))}
        <div>
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">UTC</div>
          <div className="mt-1.5 font-mono text-[13px] font-semibold text-white/85 tabular-nums">
            <LiveUTC initial={payload.utc} />
          </div>
        </div>
      </div>

      {/* terminal log — each beat decodes in, collects its OK, the last one waits
          for the channel's answer */}
      <div className="mt-6 space-y-1.5 font-mono text-[11px] leading-relaxed" aria-hidden={false}>
        {logLines.slice(0, logStep + 1).map((line, i) => {
          const done = i < logStep || granted;
          const failedHere = denied && i === logStep;
          return (
            <div key={line} className="flex items-baseline gap-2 text-white/55">
              <span className="text-white/25 shrink-0">&gt;</span>
              <span className="min-w-0">
                <DecodeText text={line} duration={420} />
                {done && !failedHere && <span style={{ color: GOLD_SOFT }}> ·· OK</span>}
                {failedHere && <span style={{ color: '#f87171' }}> ·· ✗</span>}
                {!done && !failedHere && !reduce && (
                  <motion.span
                    className="inline-block"
                    animate={{ opacity: [1, 0.2, 1] }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {' '}…
                  </motion.span>
                )}
              </span>
            </div>
          );
        })}
        {granted && (
          <div className="flex items-baseline gap-2" style={{ color: GOLD_SOFT }}>
            <span className="shrink-0 text-white/25">&gt;</span>
            <DecodeText text={T('sesión firmada — bienvenido a bordo', 'session signed — welcome aboard', lang)} duration={520} />
          </div>
        )}
        {denied && (
          <div className="flex items-baseline gap-2" style={{ color: '#f87171' }}>
            <span className="shrink-0 text-white/25">&gt;</span>
            <span>{T('firma rechazada — canal cerrado', 'signature rejected — channel closed', lang)}</span>
          </div>
        )}
      </div>

      {/* progress rail */}
      <div className="mt-5 h-px overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <motion.div
          className="h-full origin-left"
          style={{ background: denied ? '#f87171' : `linear-gradient(90deg, ${GOLD}, ${GOLD_SOFT})` }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: settled ? 1 : 0.82 }}
          transition={{ duration: settled ? 0.3 : reduce ? 0 : 2.7, ease: granted ? 'easeOut' : 'linear' }}
        />
      </div>

      {/* on grant: the session countersigned with YOUR stroke + the seal */}
      <AnimatePresence>
        {granted && (
          <motion.div
            className="mt-6 flex items-end justify-between gap-6"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
          >
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD_SOFT }}>
                {T('Sesión firmada', 'Session signed', lang)}
              </div>
              <svg viewBox="0 0 104 40" className="mt-1 w-[180px]" fill="none" aria-hidden>
                <motion.path
                  d={SIGN_STROKE}
                  stroke={GOLD_SOFT}
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  initial={reduce ? undefined : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: reduce ? 0 : 0.7, ease: 'easeInOut', delay: 0.15 }}
                />
                <line x1="4" y1="33" x2="100" y2="33" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
              </svg>
              <p className="mt-1.5 text-[10.5px] text-white/40">
                {T('La única firma aquí es la tuya.', 'The only signature here is yours.', lang)}
              </p>
            </div>
            <motion.div
              initial={reduce ? { opacity: 0 } : { scale: 1.6, opacity: 0, rotate: -16 }}
              animate={{ scale: 1, opacity: 1, rotate: -8 }}
              transition={{ duration: reduce ? 0.1 : 0.4, ease: EASE, delay: 0.3 }}
              aria-hidden
            >
              <svg viewBox="0 0 100 100" fill="none" style={{ width: 72, height: 72 }}>
                <circle cx="50" cy="50" r="47" stroke="rgba(201,162,39,0.55)" strokeWidth="1.6" />
                <circle cx="50" cy="50" r="30" stroke="rgba(201,162,39,0.35)" strokeWidth="1" />
                <path d="M38 51l8 8 16-17" stroke={GOLD} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────────────
type Phase = 'form' | 'decode' | 'granted' | 'denied';
type Mode = 'signin' | 'create';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Cap the theater (de-AI pass 2026-07-21) ─────────────────────────────────────────
// The decode/grant sequence is real artwork, not stalling — but the ~5s of artificial
// waits (sign 560 + minShow 3000 + granted 1500) taxed EVERY login, forever. The full
// cinematic now plays once per device (first login ever); every login after that keeps
// the same beats at a fraction of the wait. prefers-reduced-motion still overrides both
// tiers, unchanged. Auth/credential logic itself is untouched — only these delays.
const LOGIN_SHOW_SEEN_KEY = 'astryum:loginShowSeen';
function hasSeenLoginShow(): boolean {
  try {
    return localStorage.getItem(LOGIN_SHOW_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
function markLoginShowSeen(): void {
  try {
    localStorage.setItem(LOGIN_SHOW_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

export default function LoginPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [lang, setLang] = useLang();
  const { loginWithEmail, registerWithEmail, loginWithPasskey, loginWithOAuth, isAuthenticated, clearError } = useAuthStore();

  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<Mode>('signin');
  const [phase, setPhase] = useState<Phase>('form');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Create-mode crew manifest: who is boarding (saved on the account for the
  // full launch — deliberately light, no phone/2FA yet).
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [payload, setPayload] = useState<DecodePayload | null>(null);
  const [stubHover, setStubHover] = useState(false);
  const [signing, setSigning] = useState(false);
  // Anti-bot: one Turnstile token per submit (single-use — resetSignal mints
  // a fresh one after every failed attempt).
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  // Demo-risk acceptance (founder 2026-07-26, revised same day): NO modal —
  // fear-free signup. The risks live as PUBLIC reviewable documentation
  // (/demo-terms) and the create button carries the standard notice line
  // linking to it; pressing "Crear y firmar" under that notice is the
  // acceptance. The backend still requires and records it (demoTermsAccepted
  // literal + version/timestamp on the user).
  const alive = useRef(true);
  // Whether THIS device has ever seen the full decode cinematic — read once on
  // mount (localStorage is client-only); submit/onPasskey read the ref, never
  // the (possibly stale) render.
  const firstShowRef = useRef(true);

  useEffect(() => {
    alive.current = true;
    firstShowRef.current = !hasSeenLoginShow();
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    setHydrated(true);
    // /register redirects here with ?mode=create — open the card on that run.
    try {
      if (new URLSearchParams(window.location.search).get('mode') === 'create') setMode('create');
    } catch {
      /* ignore */
    }
    // Still a hidden door — but the check moved server-side: middleware.ts
    // already bounced anyone without the signed gate cookie before this page
    // was served, so no client-side flag check remains.
    if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true') {
      router.replace('/app');
      return;
    }
    // Don't yank the page away mid-decode; that path performs its own redirect.
    if (isAuthenticated && phase === 'form') router.replace('/app');
  }, [isAuthenticated, router, phase]);

  const beginDecode = (op: string, m: Mode) => {
    setPayload({
      // On a fresh crew card the manifest shows the chosen call-name; sign-in
      // keeps the masked channel id.
      operator: m === 'create' && username.trim() ? username.trim() : op.includes('@') ? maskIdentifier(op) : op,
      callsign: signalIdentity(op.trim().toLowerCase()),
      utc: utcStamp(),
      clearance: m === 'create' ? 'CREW · NEW' : 'CREW · V1 FLARE',
      mode: m,
    });
    setPhase('decode');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await attemptSubmit();
  };

  const attemptSubmit = async () => {
    if (phase !== 'form' || signing) return;
    setFormError('');
    setNotice('');
    clearError();

    const id = identifier.trim();
    if (mode === 'create') {
      if (username.trim().length < 2) {
        setFormError(T('Elige un alias (2+ caracteres).', 'Pick a username (2+ characters).', lang));
        return;
      }
      if (!firstName.trim() || !lastName.trim()) {
        setFormError(T('Dinos tu nombre y apellidos.', 'Tell us your first and last name.', lang));
        return;
      }
      if (password.length < 8) {
        setFormError(T('La contraseña necesita al menos 8 caracteres.', 'Password needs at least 8 characters.', lang));
        return;
      }
      if (password !== confirm) {
        setFormError(T('Las contraseñas no coinciden.', 'Passwords do not match.', lang));
        return;
      }
    }
    if (turnstileEnabled() && !captchaToken) {
      setFormError(T('Completa la verificación anti-bot.', 'Complete the anti-bot check.', lang));
      return;
    }

    // Ink the signature before the card is submitted — you sign, then it flies.
    // Full cinematic once per device; every login after that keeps the same
    // beats, capped (reduced motion still overrides both tiers).
    const showFull = firstShowRef.current && !reduce;
    if (firstShowRef.current) {
      firstShowRef.current = false;
      markLoginShowSeen();
    }
    setSigning(true);
    await sleep(reduce ? 0 : showFull ? 560 : 200);
    if (!alive.current) return;

    beginDecode(id, mode);
    setSigning(false);
    const minShow = reduce ? sleep(400) : sleep(showFull ? 3000 : 600);

    try {
      // Every entry is a real backend account now — the old in-bundle
      // "judges' credentials" died with the server-side gate (2026-07-23).
      if (mode === 'create')
        await Promise.all([
          registerWithEmail(
            id,
            password,
            {
              username: username.trim(),
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              // Acceptance-by-conduct: the create button sits under the notice
              // line linking /demo-terms — the backend requires this literal
              // and stamps version + timestamp on the account.
              demoTermsAccepted: true,
            },
            captchaToken,
          ),
          minShow,
        ]);
      else await Promise.all([loginWithEmail(id, password, captchaToken), minShow]);
      if (!alive.current) return;
      setPhase('granted');
      await sleep(reduce ? 250 : showFull ? 1500 : 400);
      if (!alive.current) return;
      router.replace('/app');
    } catch (err) {
      // Let the readout reach the "verifying" beat before rejecting.
      await minShow.catch(() => undefined);
      if (!alive.current) return;
      setPhase('denied');
      await sleep(reduce ? 250 : 950);
      if (!alive.current) return;
      setCaptchaReset((n) => n + 1); // token was consumed — mint a fresh one
      setFormError(
        err instanceof Error && err.message && !err.message.startsWith('http_')
          ? errorToCopy(err.message, lang)
          : T('Credenciales inválidas o canal caído. Prueba de nuevo.', 'Invalid credentials or channel down. Try again.', lang),
      );
      setPhase('form');
    }
  };

  const onOAuthNotConfigured = (provider: 'Google' | 'Apple') => {
    setNotice(
      T(
        `Canal ${provider} aún no operativo — entra con email de momento.`,
        `${provider} channel not open yet — use email for now.`,
        lang,
      ),
    );
  };

  // Shared OAuth landing: the provider popup already happened; exchange the
  // id_token at the backend (which verifies it against the provider's JWKS)
  // and ride the same decode/grant readout as every other door.
  const onOAuthToken = async (
    provider: 'google' | 'apple',
    idToken: string,
    profile?: { firstName?: string; lastName?: string },
  ) => {
    if (phase !== 'form' || signing) return;
    setFormError('');
    setNotice('');
    clearError();
    const claims = decodeJwtPayload(idToken);
    const operator = typeof claims.email === 'string' ? claims.email : provider;
    const showFull = firstShowRef.current && !reduce;
    if (firstShowRef.current) {
      firstShowRef.current = false;
      markLoginShowSeen();
    }
    beginDecode(operator, 'signin');
    const minShow = reduce ? sleep(400) : sleep(showFull ? 2400 : 600);
    try {
      await Promise.all([loginWithOAuth(provider, idToken, profile), minShow]);
      if (!alive.current) return;
      setPhase('granted');
      await sleep(reduce ? 250 : showFull ? 1500 : 400);
      if (!alive.current) return;
      router.replace('/app');
    } catch (err) {
      await minShow.catch(() => undefined);
      if (!alive.current) return;
      setPhase('denied');
      await sleep(reduce ? 250 : 950);
      if (!alive.current) return;
      setFormError(
        err instanceof Error && err.message && !err.message.startsWith('http_')
          ? errorToCopy(err.message, lang)
          : T('El canal no respondió. Prueba de nuevo.', 'The channel did not answer. Try again.', lang),
      );
      setPhase('form');
    }
  };

  const onAppleClick = async () => {
    if (!appleOAuthEnabled()) {
      onOAuthNotConfigured('Apple');
      return;
    }
    if (phase !== 'form' || signing) return;
    try {
      const { idToken, profile } = await appleSignIn();
      await onOAuthToken('apple', idToken, profile);
    } catch {
      // Popup dismissed / SDK unavailable — a quiet notice, not a denial.
      setNotice(T('Inicio con Apple cancelado o no disponible.', 'Apple sign-in was cancelled or unavailable.', lang));
    }
  };

  const onPasskey = async () => {
    if (phase !== 'form' || signing) return;
    setFormError('');
    setNotice('');
    clearError();
    const showFull = firstShowRef.current && !reduce;
    if (firstShowRef.current) {
      firstShowRef.current = false;
      markLoginShowSeen();
    }
    beginDecode(identifier.trim() || 'passkey', 'signin');
    const minShow = reduce ? sleep(400) : sleep(showFull ? 2400 : 600);
    try {
      await Promise.all([loginWithPasskey(), minShow]);
      if (!alive.current) return;
      setPhase('granted');
      await sleep(reduce ? 250 : showFull ? 1500 : 400);
      if (!alive.current) return;
      router.replace('/app');
    } catch {
      await minShow.catch(() => undefined);
      if (!alive.current) return;
      setPhase('denied');
      await sleep(reduce ? 250 : 950);
      if (!alive.current) return;
      setFormError(T('La passkey no se pudo verificar.', 'The passkey could not be verified.', lang));
      setPhase('form');
    }
  };

  if (!hydrated) return null;

  const busy = phase !== 'form';
  // Ticket fields: bare mono text over a hairline, like filling a printed card.
  const fieldCls =
    'w-full bg-transparent border-0 border-b border-white/15 rounded-none px-0 py-2 font-mono text-[13.5px] text-white/90 placeholder-white/20 focus:outline-none focus:ring-0 focus:border-[#C9A227] transition-colors';
  const labelCls = 'block font-mono text-[9px] uppercase tracking-[0.18em] text-white/40 mb-1';

  return (
    <div className="relative min-h-screen text-white" style={{ background: '#080808', overflowX: 'clip' }}>
      <DeckBackdrop />

      <div className="relative z-10 min-h-screen flex flex-col px-6">
        {/* top bar */}
        <header className="max-w-6xl mx-auto w-full flex items-center justify-between pt-5">
          <Link href="/" className="flex items-center shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={LOGO_MARK} alt="Astryum" style={{ height: 46, width: 'auto', display: 'block' }} />
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
        </header>

        {/* the access pass */}
        <main className="flex-1 flex items-center justify-center py-10">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE }}
            className="relative w-full max-w-[480px]"
          >
            <div
              className="absolute -inset-px rounded-2xl opacity-60 blur-lg pointer-events-none"
              style={{ background: 'radial-gradient(120% 100% at 50% 0%, rgba(201,162,39,0.28), rgba(201,162,39,0.03) 55%, transparent)' }}
              aria-hidden
            />
            <div
              className="relative rounded-2xl p-7 sm:p-8 overflow-hidden"
              style={{
                border: `1px solid ${phase === 'denied' ? 'rgba(248,113,113,0.5)' : 'rgba(201,162,39,0.32)'}`,
                background: 'rgba(10,10,9,0.72)',
                backdropFilter: 'blur(12px)',
                boxShadow: '0 24px 70px rgba(0,0,0,0.5), 0 0 40px rgba(201,162,39,0.07)',
                transition: 'border-color 0.3s ease',
              }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {busy && payload ? (
                  <DecodingManifest lang={lang} payload={payload} granted={phase === 'granted'} denied={phase === 'denied'} />
                ) : (
                  <motion.div
                    key="form"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                    transition={{ duration: 0.35, ease: EASE }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: GOLD_SOFT }}>
                        <AsteroidGlyph size={14} />
                        {T('Astryum · Pase de acceso', 'Astryum · Access pass', lang)}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">V1 · Flare</span>
                    </div>

                    <h1 className="mt-5 text-[26px] sm:text-3xl font-bold text-white" style={{ letterSpacing: '-0.025em' }}>
                      {T('Firma tu sesión.', 'Sign your session.', lang)}
                    </h1>
                    <p className="mt-2 text-sm text-white/55 leading-relaxed">
                      {T(
                        'Beta privada. Rellena la tarjeta y firma — la cuenta abre la consola; tu wallet se conecta después, dentro.',
                        'Private beta. Fill the card and sign — the account opens the console; your wallet connects later, inside.',
                        lang,
                      )}
                    </p>

                    {/* mode switch — the card's two print runs */}
                    <div
                      role="tablist"
                      aria-label={T('Modo de acceso', 'Access mode', lang)}
                      className="mt-6 grid grid-cols-2 gap-0.5 p-0.5 rounded-xl"
                      style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                    >
                      {(
                        [
                          ['signin', T('Entrar', 'Sign in', lang)],
                          ['create', T('Crear cuenta', 'Create account', lang)],
                        ] as [Mode, string][]
                      ).map(([m, txt]) => (
                        <button
                          key={m}
                          role="tab"
                          aria-selected={mode === m}
                          onClick={() => {
                            setMode(m);
                            setFormError('');
                            setNotice('');
                          }}
                          className="py-2 rounded-[10px] font-mono text-[11px] uppercase tracking-[0.14em] font-semibold transition-all"
                          style={{ background: mode === m ? GOLD : 'transparent', color: mode === m ? '#000' : 'rgba(255,255,255,0.45)' }}
                        >
                          {txt}
                        </button>
                      ))}
                    </div>

                    {(formError || notice) && (
                      <motion.div
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="mt-4 px-3.5 py-2.5 rounded-lg font-mono text-[11.5px] leading-snug"
                        style={
                          formError
                            ? { border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: '#fca5a5' }
                            : { border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.07)', color: '#fcd34d' }
                        }
                        role="alert"
                      >
                        {formError ? `✗ ${formError}` : `◆ ${notice}`}
                      </motion.div>
                    )}

                    {EMAIL_AUTH && (
                      <form onSubmit={submit} className="mt-6">
                        {/* the card's fields — filled in like a printed form */}
                        <div className="space-y-5">
                          {mode === 'create' && (
                            <>
                              <div>
                                <label htmlFor="alias" className={labelCls}>
                                  {T('Alias · nombre en cubierta', 'Username · deck name', lang)}
                                </label>
                                <input
                                  id="alias"
                                  type="text"
                                  autoComplete="nickname"
                                  required
                                  maxLength={32}
                                  value={username}
                                  onChange={(e) => setUsername(e.target.value)}
                                  placeholder="stargazer"
                                  className={fieldCls}
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-5">
                                <div>
                                  <label htmlFor="fn" className={labelCls}>
                                    {T('Nombre', 'First name', lang)}
                                  </label>
                                  <input
                                    id="fn"
                                    type="text"
                                    autoComplete="given-name"
                                    required
                                    maxLength={64}
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    placeholder="Ada"
                                    className={fieldCls}
                                  />
                                </div>
                                <div>
                                  <label htmlFor="ln" className={labelCls}>
                                    {T('Apellidos', 'Last name', lang)}
                                  </label>
                                  <input
                                    id="ln"
                                    type="text"
                                    autoComplete="family-name"
                                    required
                                    maxLength={64}
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    placeholder="Lovelace"
                                    className={fieldCls}
                                  />
                                </div>
                              </div>
                            </>
                          )}
                          <div>
                            <label htmlFor="op" className={labelCls}>
                              {T('Operador · email', 'Operator · email', lang)}
                            </label>
                            <input
                              id="op"
                              type="text"
                              inputMode="email"
                              autoComplete="username"
                              required
                              value={identifier}
                              onChange={(e) => setIdentifier(e.target.value)}
                              placeholder={T('tu@correo.com', 'you@example.com', lang)}
                              className={fieldCls}
                            />
                          </div>
                          <div className={mode === 'create' ? 'grid grid-cols-2 gap-5' : ''}>
                            <div>
                              <label htmlFor="pw" className={labelCls}>
                                {T('Contraseña', 'Password', lang)}
                              </label>
                              <input
                                id="pw"
                                type="password"
                                autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className={fieldCls}
                              />
                            </div>
                            {mode === 'create' && (
                              <div>
                                <label htmlFor="pw2" className={labelCls}>
                                  {T('Confirmar', 'Confirm', lang)}
                                </label>
                                <input
                                  id="pw2"
                                  type="password"
                                  autoComplete="new-password"
                                  required
                                  value={confirm}
                                  onChange={(e) => setConfirm(e.target.value)}
                                  placeholder="••••••••"
                                  className={fieldCls}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* the printed terms — the invariants, on the ticket */}
                        <div className="mt-6 grid grid-cols-3 gap-3 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                          {(
                            [
                              [T('Custodia', 'Custody', lang), T('Tuya', 'Yours', lang)],
                              [T('Claves', 'Keys', lang), T('Nunca salen', 'Never leave', lang)],
                              [T('Red', 'Network', lang), 'Flare · V1'],
                            ] as [string, string][]
                          ).map(([k, v]) => (
                            <div key={k}>
                              <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/30">{k}</div>
                              <div className="mt-1 text-[12px] font-semibold text-white/85">{v}</div>
                            </div>
                          ))}
                        </div>

                        {/* anti-bot check — renders only when the sitekey is configured */}
                        <TurnstileWidget
                          onToken={setCaptchaToken}
                          resetSignal={captchaReset}
                          theme="dark"
                          className="mt-5"
                        />

                        {/* perforation */}
                        <div className="my-5" style={{ borderTop: '1px dashed rgba(255,255,255,0.18)' }} aria-hidden />

                        {/* the stub — sign here. Hover previews the ink; submitting draws it. */}
                        <button
                          type="submit"
                          disabled={busy || signing}
                          onMouseEnter={() => setStubHover(true)}
                          onMouseLeave={() => setStubHover(false)}
                          className="group w-full flex items-center justify-between gap-4 rounded-xl px-5 py-3 text-left transition-colors disabled:opacity-60"
                          style={{
                            border: '1px dashed rgba(201,162,39,0.5)',
                            background: stubHover || signing ? 'rgba(201,162,39,0.1)' : 'rgba(201,162,39,0.05)',
                          }}
                        >
                          <div className="min-w-0">
                            <div className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: GOLD_SOFT }}>
                              {T('Firma aquí', 'Sign here', lang)}
                            </div>
                            <svg viewBox="0 0 104 40" className="mt-0.5 w-[150px]" fill="none" aria-hidden>
                              <motion.path
                                d={SIGN_STROKE}
                                stroke={GOLD_SOFT}
                                strokeWidth="1.7"
                                strokeLinecap="round"
                                initial={false}
                                animate={{ pathLength: reduce ? 1 : signing ? 1 : stubHover ? 0.24 : 0.06 }}
                                transition={{ duration: signing ? 0.5 : 0.35, ease: 'easeInOut' }}
                              />
                              <line x1="4" y1="33" x2="100" y2="33" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                            </svg>
                          </div>
                          <span
                            className="shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-bold text-black"
                            style={{ background: GOLD, boxShadow: '0 6px 22px rgba(201,162,39,0.25)' }}
                          >
                            {signing
                              ? T('Firmando…', 'Signing…', lang)
                              : mode === 'create'
                                ? T('Crear y firmar', 'Create & sign', lang)
                                : T('Firmar y entrar', 'Sign & enter', lang)}
                            {!signing && (
                              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="transition-transform duration-300 group-hover:translate-x-0.5">
                                <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="black" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                        </button>

                        {/* Acceptance-by-conduct notice (founder 2026-07-26):
                            no modal, no fear — the risks are PUBLIC reviewable
                            documentation, and creating the account under this
                            line is the acceptance the backend records. */}
                        {mode === 'create' && (
                          <p className="mt-3 text-center font-mono text-[10px] leading-relaxed text-white/35">
                            {T('Al crear tu cuenta aceptas el ', 'By creating your account you accept the ', lang)}
                            <a
                              href="/demo-terms"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2 transition-colors hover:text-white/70"
                              style={{ color: GOLD_SOFT }}
                            >
                              {T('aviso de riesgos de la demo', 'demo risk notice', lang)}
                            </a>
                            {T(' — demo experimental con XRP real, bajo topes.', ' — an experimental demo with real XRP, under caps.', lang)}
                          </p>
                        )}
                      </form>
                    )}

                    <div className="my-5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.18em] text-white/30">
                      <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      {T('o continúa con', 'or continue with', lang)}
                      <span className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.08)' }} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {googleOAuthEnabled() ? (
                        <GoogleButtonSlot onCredential={(idToken) => void onOAuthToken('google', idToken)} />
                      ) : (
                        <button
                          onClick={() => onOAuthNotConfigured('Google')}
                          className="inline-flex items-center justify-center gap-2.5 py-3 rounded-xl text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/[0.06]"
                          style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
                        >
                          <GoogleIcon />
                          Google
                        </button>
                      )}
                      <button
                        onClick={() => void onAppleClick()}
                        className="inline-flex items-center justify-center gap-2.5 py-3 rounded-xl text-[13px] font-semibold text-white/85 transition-colors hover:bg-white/[0.06]"
                        style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}
                      >
                        <AppleIcon />
                        Apple
                      </button>
                    </div>

                    {PASSKEY_AUTH && (
                      <button
                        onClick={onPasskey}
                        disabled={busy || signing}
                        className="mt-3 w-full py-3 rounded-xl text-[13px] font-semibold text-white/70 transition-colors hover:bg-white/[0.05] disabled:opacity-50"
                        style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        {T('Entrar con passkey', 'Sign in with passkey', lang)}
                      </button>
                    )}

                    <div className="mt-6 flex items-center justify-between font-mono text-[10.5px] text-white/35">
                      <Link href="/forgot-password" className="hover:text-white/70 transition-colors">
                        {T('¿Contraseña olvidada?', 'Forgot password?', lang)}
                      </Link>
                      <Link href="/" className="hover:text-white/70 transition-colors">
                        ← {T('Volver', 'Back', lang)}
                      </Link>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </main>

        {/* the invariant, printed on the door */}
        <footer className="max-w-6xl mx-auto w-full pb-6 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/25">
            {T('Cero claves de usuario en nuestros servidores · Tú siempre firmas', 'Zero user keys on our servers · You always sign', lang)}
          </p>
        </footer>
      </div>
    </div>
  );
}

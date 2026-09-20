'use client';

/**
 * El RITUAL de acceso — la ceremonia de la puerta, extraída de /login para que
 * también pueda jugarse donde ahora ocurre de verdad la verificación.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import dynamic from 'next/dynamic';
import { EASE, GOLD } from '../landing/interactions';

const StarfieldCanvas = dynamic(() => import('../landing/StarfieldCanvas'), { ssr: false });

export const GOLD_SOFT = '#E8C25A';

export type Lang = 'es' | 'en';
export const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

/** El trazo rápido del usuario — deliberadamente NO la firma de Astryum: en
 *  esta tarjeta quien firma eres TÚ. Se dibuja en el talón de «firma aquí» y
 *  se refrenda en el manifiesto cuando la sesión se concede. */
export const SIGN_STROKE =
  'M 6 27 C 13 10, 21 7, 23.5 13.5 C 25.5 19, 18.5 26, 25 26 C 33 26, 36.5 13.5, 44 14.5 C 50 15.3, 47.5 24, 55 22.5 C 64 20.7, 68 13, 77 12 C 85 11.2, 92 12.5, 98 10.5';

/** Lo que el manifiesto descodifica: quién entra, con qué distintivo y cuándo. */
export type DecodePayload = {
  operator: string;
  callsign: string;
  utc: string;
  clearance: string;
  mode: 'signin' | 'create';
};

// ─── Persistent language (same key the landing uses) ────────────────────────────────
export function useLang(): [Lang, (l: Lang) => void] {
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
export function signalIdentity(id: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `AST-${(h % 0x10000).toString(16).toUpperCase().padStart(4, '0')}`;
}

export function maskIdentifier(id: string): string {
  const [user, domain] = id.split('@');
  if (!domain) return id;
  const head = user.slice(0, Math.min(2, user.length));
  return `${head}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export function utcStamp(): string {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 10)} · ${iso.slice(11, 19)} UTC`;
}

// ─── DecodeText — resolves left→right out of cipher noise ("hacker letters") ─────────
const CIPHER = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@§Ø◆·';

export function DecodeText({
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
export function LiveUTC({ initial }: { initial: string }) {
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
export function DeckBackdrop() {
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

export function AsteroidGlyph({ size = 14 }: { size?: number }) {
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

const FINGERPRINT_RIDGES = [
  'M2 12C2 6.5 6.5 2 12 2a9.9 9.9 0 0 1 7.1 3',
  'M5 19.5A9.96 9.96 0 0 1 2 12',
  'M22 12c0 1.2-.2 2.4-.6 3.5',
  'M6 12a6 6 0 0 1 10.7-3.7',
  'M18 12c0 3.3-.6 5.6-1.4 7.4',
  'M8.2 20.5A15.4 15.4 0 0 0 10 12a2 2 0 0 1 4 0c0 3.4-.5 6-1.2 8',
  'M6.6 17A11.8 11.8 0 0 0 8 12',
];

/**
 * La huella de la puerta. En reposo es el icono de siempre; cuando `scanning`
 * se enciende, sus crestas se DIBUJAN una tras otra —de dentro afuera— y un
 * lector barre la yema.
 */
export function FingerprintIcon({ size = 18, scanning = false }: { size?: number; scanning?: boolean }) {
  const reduce = useReducedMotion();
  const animate = scanning && !reduce;
  return (
    <span
      className="relative inline-flex shrink-0 overflow-hidden"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {FINGERPRINT_RIDGES.map((d, i) =>
          animate ? (
            <motion.path
              key={d}
              d={d}
              initial={{ pathLength: 0, opacity: 0.25 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: 'easeInOut', delay: i * 0.07 }}
            />
          ) : (
            <path key={d} d={d} />
          ),
        )}
      </svg>
      {/* El lector pasando por la yema — una sola pasada, no un bucle: esto
          acompaña una salida, no un estado de espera. En píxeles, dentro de la
          caja recortada: en porcentajes el recorrido dependía del alto del
          contenedor y se escapaba por arriba y por abajo. */}
      {animate && (
        <motion.span
          className="pointer-events-none absolute left-0 right-0"
          style={{
            height: Math.max(2, Math.round(size * 0.2)),
            background: `linear-gradient(180deg, transparent, ${GOLD_SOFT}, transparent)`,
            opacity: 0.9,
          }}
          initial={{ top: 0 }}
          animate={{ top: size }}
          transition={{ duration: 0.85, ease: 'linear', delay: 0.15 }}
          aria-hidden
        />
      )}
    </span>
  );
}

export function DecodingManifest({
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

// ─── Cap the theater (de-AI pass) ─────────────────────────────────────────
// The decode/grant sequence is real artwork, not stalling — but the ~5s of artificial
// waits (sign 560 + minShow 3000 + granted 1500) taxed EVERY login, forever. The full
// cinematic now plays once per device (first login ever); every login after that keeps
// the same beats at a fraction of the wait. prefers-reduced-motion still overrides both
// tiers, unchanged. Auth/credential logic itself is untouched — only these delays.
const LOGIN_SHOW_SEEN_KEY = 'astryum:loginShowSeen';
export function hasSeenLoginShow(): boolean {
  try {
    return localStorage.getItem(LOGIN_SHOW_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}
export function markLoginShowSeen(): void {
  try {
    localStorage.setItem(LOGIN_SHOW_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}


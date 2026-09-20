'use client';

/**
 * ¿QUIÉN ESTÁ A LOS MANDOS? — el selector de la portada nueva.
 *
 * Cuatro segmentos (governors.ts) y UNA consola. Al cambiar de gobernador no
 * cambia la página: cambia la consola —su vocabulario, su credencial, sus
 * cuentas, sus asientos— y cambia el material con el que está hecha: el radio
 * de sus esquinas, el trazo y el brillo. Es la tesis («una web, un
 * kernel, N tipos de cuenta») convertida en un gesto: lo que se ve es lo mismo,
 * lo que cambia es quién firma.
 */

import { useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useReducedMotion } from '../../stores/motionStore';
import { BORDER, EASE, Magnetic } from './interactions';
import { GOVERNORS, GOVERNOR_BY_ID, readinessColor, tint, type Governor, type GovernorId } from './governors';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

export function MandosSection({ lang }: { lang: Lang }) {
  const [gov, setGov] = useState<GovernorId>('self');
  const g = GOVERNOR_BY_ID[gov];
  // scroll-mt-36: la entrada «Productos» del header aterriza aquí, y la
  // cabecera fija más la franja del hackathon miden ~124px.
  return (
    <section id="mandos" className="relative px-6 md:px-10 lg:px-16 py-20 md:py-28 scroll-mt-36">
      <div className="max-w-6xl mx-auto flex flex-col items-center gap-7">
        <div className="text-center max-w-3xl">
          <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/50">{T('Después del recorrido', 'After the tour', lang)}</div>
          <h2 className="mt-3 font-bold text-white text-balance" style={{ fontSize: 'clamp(1.9rem, 4.2vw, 3.2rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}>
            {T('El mismo sistema. A los mandos, quien tú decidas.', 'The same system. At the controls, whoever you decide.', lang)}
          </h2>
          <p className="mt-4 text-white/55 text-[15px] md:text-base max-w-xl mx-auto">
            {T(
              'Lo que acabas de ver se aplica igual a una persona, a una entidad, a un exchange o a un agente. Elige quién firma y mira qué cambia.',
              'What you just saw applies the same to a person, an entity, an exchange or an agent. Choose who signs and see what changes.',
              lang,
            )}
          </p>
        </div>

        <GovernorSwitch gov={gov} setGov={setGov} lang={lang} />

        <Console g={g} lang={lang} />

        <ChangeCard g={g} lang={lang} />

        <KnowMore lang={lang} />
      </div>
    </section>
  );
}

/** El conmutador: cuatro segmentos y un pomo que viaja. */
function GovernorSwitch({ gov, setGov, lang }: { gov: GovernorId; setGov: (g: GovernorId) => void; lang: Lang }) {
  const reduce = useReducedMotion();
  const thumbId = useId();
  const btns = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, GOVERNORS.findIndex((o) => o.id === gov));
  const g = GOVERNOR_BY_ID[gov];

  const onKeyDown = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (activeIndex + d + GOVERNORS.length) % GOVERNORS.length;
    setGov(GOVERNORS[next].id);
    btns.current[next]?.focus();
  };

  return (
    <div className="flex flex-col items-center">
      <div
        role="radiogroup"
        aria-label={T('Quién está a los mandos', 'Who is at the controls', lang)}
        onKeyDown={onKeyDown}
        className="relative inline-flex flex-wrap justify-center items-center p-1 rounded-full"
        style={{ border: `1px solid ${BORDER}`, background: 'rgba(8,8,10,0.86)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.045)' }}
      >
        {GOVERNORS.map((o, i) => {
          const on = gov === o.id;
          return (
            <button
              key={o.id}
              ref={(el) => {
                btns.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => setGov(o.id)}
              className="relative px-4 sm:px-5 py-2.5 rounded-full text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-offset-0"
              style={{ color: on ? o.ink : 'rgba(255,255,255,0.5)', transition: 'color 260ms ease' }}
            >
              {on && (
                <motion.span
                  layoutId={`gs-thumb-${thumbId}`}
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: o.accent,
                    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(0,0,0,0.5), 0 0 18px -6px ${tint(o, 0.9)}`,
                  }}
                  transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38, mass: 0.9 }}
                />
              )}
              <span className="relative">{T(o.label.es, o.label.en, lang)}</span>
            </button>
          );
        })}
      </div>
      {/* EL AVISO HONESTO, con su hueco reservado: cambiar de gobernador no
          mueve la consola que hay debajo. */}
      <div className="relative mt-2 h-[22px] flex items-start justify-center overflow-hidden pointer-events-none">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={g.id}
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 6 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.16em]"
            style={{ color: readinessColor(g.readiness) }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: readinessColor(g.readiness) }} />
            {T(g.notice.es, g.notice.en, lang)}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

const MICRO = 'text-[10px] font-mono uppercase tracking-[0.16em] text-white/50';

/** LA CONSOLA: tres columnas que son las mismas para los cuatro. Lo que ves,
 *  cómo está organizado, quién firma. Y abajo, lo que no cambia nunca. */
function Console({ g, lang }: { g: Governor; lang: Lang }) {
  const reduce = useReducedMotion();
  const border = `1px ${g.dashed ? 'dashed' : 'solid'} ${tint(g, 0.42)}`;
  return (
    <motion.div
      aria-hidden
      className="w-full overflow-hidden"
      animate={{ borderRadius: g.radius }}
      transition={{ duration: 0.4, ease: EASE }}
      style={{
        border,
        background: 'rgba(12,11,9,0.7)',
        boxShadow: g.glow
          ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 80px -40px rgba(0,0,0,0.9), 0 0 90px -40px ${tint(g, 0.6)}`
          : 'inset 0 1px 0 rgba(255,255,255,0.05), 0 40px 80px -40px rgba(0,0,0,0.9)',
        transition: 'border-color 400ms ease, box-shadow 400ms ease',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-6 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: g.accent, transition: 'background-color 400ms ease' }} />
          <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/80 truncate">{T(g.console.root.es, g.console.root.en, lang)}</span>
          <span className={`${MICRO} hidden sm:inline`}>{T('Datos de ejemplo', 'Example data', lang)}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className={MICRO}>{T('Credencial', 'Credential', lang)}</span>
          <span
            className="px-2.5 py-1 text-[11px] font-mono font-semibold"
            style={{ border: `1px solid ${tint(g, 0.45)}`, background: tint(g, 0.08), color: g.accent, borderRadius: g.innerRadius }}
          >
            {T(g.console.cred.es, g.console.cred.en, lang)}
          </span>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={g.id}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -6 }}
          transition={{ duration: 0.26, ease: EASE }}
          className="grid md:grid-cols-[300px_1fr_1fr]"
        >
          {/* 01 · lo que ves */}
          <div className="p-5 md:p-6 flex flex-col gap-4 md:border-r" style={{ borderColor: BORDER }}>
            <span className={MICRO}>01 · {T('Lo que ves', 'What you see', lang)}</span>
            <div>
              <div className="text-[12px] text-white/60">{T(g.console.metricLabel.es, g.console.metricLabel.en, lang)}</div>
              <div className="mt-1.5 font-mono text-[26px] leading-none tracking-tight text-white">{g.console.metric}</div>
            </div>
            <div className="space-y-2">
              {g.console.rows.map((r) => (
                <div key={r.label.en} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: r.color }} />
                  <span className="w-[74px] text-[11px] text-white/65 truncate">{T(r.label.es, r.label.en, lang)}</span>
                  <span className="flex-1 h-[4px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <motion.span className="block h-full" initial={{ width: 0 }} animate={{ width: `${r.pct}%` }} transition={{ duration: 0.6, ease: EASE }} style={{ background: r.color, opacity: 0.85 }} />
                  </span>
                  <span className="w-[38px] text-right font-mono text-[10px] text-white/65">{r.pct}%</span>
                </div>
              ))}
            </div>
            <div className="mt-auto flex items-center gap-2 pt-3" style={{ borderTop: `1px solid ${BORDER}` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'hsl(var(--tone-success))' }} />
              <span className="text-[10px] font-mono uppercase tracking-[0.12em]" style={{ color: 'hsl(var(--tone-success))' }}>
                {T(g.console.foot.es, g.console.foot.en, lang)}
              </span>
            </div>
          </div>

          {/* 02 · las cuentas */}
          <div className="p-5 md:p-6 flex flex-col gap-3 md:border-r border-t md:border-t-0" style={{ borderColor: BORDER }}>
            <span className={MICRO}>02 · {T('Las cuentas', 'The accounts', lang)}</span>
            {g.console.accounts.map((ac) => (
              <div
                key={ac.name.en}
                className="flex items-center justify-between gap-3 px-3.5 py-3"
                style={{ border: `1px ${g.dashed ? 'dashed' : 'solid'} rgba(255,255,255,0.09)`, background: 'rgba(255,255,255,0.02)', borderRadius: g.innerRadius }}
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-white">{T(ac.name.es, ac.name.en, lang)}</div>
                  <div className="text-[11.5px] leading-tight text-white/55">{T(ac.sub.es, ac.sub.en, lang)}</div>
                </div>
                <span
                  className="shrink-0 px-2 py-1 text-[9.5px] font-mono font-semibold uppercase tracking-[0.06em] whitespace-nowrap"
                  style={{ border: `1px solid ${tint(g, 0.45)}`, background: tint(g, 0.08), color: g.accent, borderRadius: g.innerRadius }}
                >
                  {T(ac.rule.es, ac.rule.en, lang)}
                </span>
              </div>
            ))}
          </div>

          {/* 03 · quién firma */}
          <div className="p-5 md:p-6 flex flex-col gap-4 border-t md:border-t-0" style={{ borderColor: BORDER }}>
            <span className={MICRO}>03 · {T('Quién firma', 'Who signs', lang)}</span>
            <div className="flex flex-wrap gap-2.5">
              {g.console.seats.map((s, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 w-[58px]">
                  <span
                    className="w-9 h-9 rounded-full"
                    style={s.signed ? { background: g.accent, border: `1.5px solid ${g.accent}` } : { border: '1.5px dashed rgba(255,255,255,0.35)' }}
                  />
                  <span className="text-[10.5px] text-center text-white/70 leading-tight">{T(s.label.es, s.label.en, lang)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-mono text-[20px]" style={{ color: g.accent }}>{T(g.console.quorum.es, g.console.quorum.en, lang)}</div>
              <div className="mt-1 text-[12.5px] leading-snug text-white/65">{T(g.console.signLine.es, g.console.signLine.en, lang)}</div>
            </div>
            <div className="mt-auto flex items-center gap-3 px-3.5 py-3" style={{ border: '1px dashed rgba(255,255,255,0.22)', borderRadius: g.innerRadius }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              <span className="text-[12.5px] text-white/75">
                <strong className="font-semibold text-white">Astryum · 0 {T('asientos', 'seats', lang)}.</strong> {T('No firma, no custodia, no ejecuta.', 'It never signs, never holds, never executes.', lang)}
              </span>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/** QUÉ CAMBIA con este gobernador, en tres frases, y su puerta. */
function ChangeCard({ g, lang }: { g: Governor; lang: Lang }) {
  const reduce = useReducedMotion();
  return (
    <div
      className="w-full grid md:grid-cols-[1fr_1.2fr_auto] gap-6 md:gap-8 items-center px-6 md:px-7 py-6"
      style={{ border: `1px ${g.dashed ? 'dashed' : 'solid'} rgba(255,255,255,0.1)`, background: 'rgba(255,255,255,0.02)', borderRadius: g.radius, transition: 'border-radius 400ms ease' }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={g.id}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: EASE }}
          className="contents"
        >
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: g.accent }}>
              {T('Qué cambia', 'What changes', lang)} · {T(g.scene.es, g.scene.en, lang)}
            </div>
            <h3 className="mt-2.5 font-bold text-white" style={{ fontSize: 'clamp(1.25rem, 1.8vw, 1.6rem)', lineHeight: 1.18, letterSpacing: '-0.02em' }}>
              {T(g.console.title.es, g.console.title.en, lang)}
            </h3>
          </div>
          <ul className="m-0 p-0 list-none space-y-2">
            {g.console.changes.map((c) => (
              <li key={c.en} className="flex items-start gap-2.5 text-[14.5px] leading-snug text-white/85">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={g.accent} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 mt-[3px]">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                {T(c.es, c.en, lang)}
              </li>
            ))}
          </ul>
          <div className="flex flex-col items-start md:items-center gap-2.5">
            <Magnetic strength={0.35} className="inline-block">
              <a
                href={g.console.cta.href}
                className="inline-flex items-center justify-center whitespace-nowrap px-7 py-3.5 text-[15px] font-semibold transition-all hover:brightness-105"
                style={{ background: g.accent, color: g.ink, borderRadius: g.innerRadius + 6 }}
              >
                {T(g.console.cta.label.es, g.console.cta.label.en, lang)}
              </a>
            </Magnetic>
            {/* En palabras, no en un icono.
            { */}
            <span className="text-[11.5px] leading-snug text-white/45 md:text-center md:max-w-[170px]">
              {T('Abre su página: el mismo sistema, contado para ese caso, y cómo empezar.', 'Opens its page: the same system, told for that case, and how to start.', lang)}
            </span>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * LA SEÑAL HACIA LAS PUERTAS. Quien llega aquí desde «Productos» tiene que
 * saber que cada producto tiene su página y que las cuatro están justo
 * debajo; si hay que adivinarlo, está mal.
 */
function KnowMore({ lang }: { lang: Lang }) {
  return (
    <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5 text-center">
      <p className="m-0 text-[14px] text-white/55">
        {T('¿Quieres saber más de un producto? Cada uno tiene su página, con su escena y su recorrido.', 'Want to know more about a product? Each one has its own page, with its own scene and journey.', lang)}
      </p>
      <a
        href="#instrumentos"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-mono uppercase tracking-[0.14em] text-white/80 hover:text-white transition-colors"
        style={{ border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.03)' }}
      >
        {T('Ver las cuatro puertas', 'See the four doors', lang)}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </a>
    </div>
  );
}

export default MandosSection;

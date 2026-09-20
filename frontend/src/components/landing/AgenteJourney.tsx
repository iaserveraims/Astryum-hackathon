'use client';

/**
 * EL VIAJE AGENTE — la sonda.
 *
 * Lo que INVARIANTS #8 exige del copy, contado con un dibujo: un pote, un
 * corredor firmado por el dueño, una sonda que opera dentro y un intento de
 * salirse que el contrato rechaza. Sobre la carcasa compartida (journeyShell),
 * con su escena (art/ProbeScene) y sus tres láminas (art/AgenteArtifacts).
 *
 * Está EN DISEÑO y lo dice en la primera línea: se enseña cómo funcionará, no
 * se vende. Ni «el agente decide», ni «la IA elige»: la IA prepara, el dueño
 * firma los límites una vez, el contrato los impone, y revocar es una firma.
 */

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useMotionLevel, useReducedMotion } from '../../stores/motionStore';
import { BORDER, BORDER_STRONG, EASE } from './interactions';
import { PROBE_BEATS, ProbeScene } from './art/ProbeScene';
import { FlightArtifact, LogArtifact, MandateArtifact } from './art/AgenteArtifacts';
import { Beat, Dock, Finale, Kicker, Line, Notes, ReadingVeil, STILL, StationAnchors, StationRail, useJumpTo, type JourneyStation } from './journeyShell';

type Lang = 'es' | 'en';
const T = (es: string, en: string, lang: Lang) => (lang === 'es' ? es : en);

const COPY = {
  hero: [0.0, PROBE_BEATS.pot[1]] as const,
  corridor: PROBE_BEATS.corridor,
  /** El vuelo y el intento rechazado son UNA parada: la misma lámina cuenta
   *  las dos cosas, y la segunda no se entiende sin la primera. */
  flight: [PROBE_BEATS.flight[0], PROBE_BEATS.rejected[1]] as const,
  log: PROBE_BEATS.log,
  close: PROBE_BEATS.close,
};

const STATIONS: readonly JourneyStation[] = [
  { id: 'pot', es: 'El pote', en: 'The pot', at: 0.04, from: 0.0, to: PROBE_BEATS.pot[1] },
  { id: 'corridor', es: 'Mandato', en: 'Mandate', at: 0.2, from: COPY.corridor[0], to: COPY.corridor[1] },
  { id: 'flight', es: 'El corredor', en: 'The corridor', at: 0.5, from: COPY.flight[0], to: COPY.flight[1] },
  { id: 'log', es: 'Registro', en: 'Record', at: 0.79, from: COPY.log[0], to: COPY.log[1] },
  { id: 'close', es: 'La casa', en: 'The house', at: 0.95, from: COPY.close[0], to: 1.0 },
];

const HERO = {
  badge: { es: 'Aplicado a un agente · en diseño · no disponible', en: 'Applied to an agent · in design · not available' },
  title: { es: 'Lo que has visto, con un agente a los mandos de un solo pote.', en: 'What you have seen, with an agent at the controls of a single pot.' },
  lead: {
    es: 'Quien gobierna una cuenta podrá designar a un agente para un único pote. Firma los límites una vez; el contrato los impone; revocar es otra firma.',
    en: 'Whoever governs an account will be able to appoint an agent for a single pot. They sign the limits once; the contract enforces them; revoking is one more signature.',
  },
};

const STOPS = [
  { id: 'corridor', num: '02', kicker: { es: 'Mandato', en: 'Mandate' }, line: { es: 'El dueño firma los límites. Una vez.', en: 'The owner signs the limits. Once.' }, note: { es: 'Alcance, tope y caducidad. Los impone el contrato, no una política nuestra.', en: 'Scope, cap and expiry. The contract enforces them, not a policy of ours.' } },
  { id: 'flight', num: '03', kicker: { es: 'El corredor', en: 'The corridor' }, line: { es: 'Fuera de lo firmado, el contrato dice que no.', en: 'Outside what was signed, the contract says no.' }, note: { es: 'La IA prepara. Dentro del corredor, el contrato ejecuta; fuera, nada.', en: 'The AI prepares. Inside the corridor, the contract executes; outside, nothing.' } },
  { id: 'log', num: '04', kicker: { es: 'Registro', en: 'Record' }, line: { es: 'Cada acción, con su recibo.', en: 'Every action, with its receipt.' }, note: { es: 'Y revocar es una firma del dueño.', en: 'And revoking is one signature by the owner.' } },
] as const;

const CLOSE = {
  kicker: { es: 'La casa', en: 'The house' },
  line: { es: 'Una persona decide. El código decide lo que no puede.', en: 'A person decides. The code decides what they can’t.' },
  sub: { es: 'Lo podrá designar cualquiera: una persona, una entidad o un exchange.', en: 'Anyone will be able to appoint one: a person, an entity or an exchange.' },
};

export default function AgenteJourney({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
  const reduce = useReducedMotion();
  const level = useMotionLevel();
  const trackRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const jumpTo = useJumpTo(trackRef);
  const heroOpacity = useTransform(scrollYProgress, [COPY.hero[0], COPY.corridor[0] + 0.03], [1, 0], { clamp: true });
  const heroY = useTransform(scrollYProgress, [0, 0.14], [0, -60], { clamp: true });

  if (reduce) return <StaticAgente lang={lang} finaleCta={finaleCta} switcher={switcher} />;

  return (
    <>
      <div className="lg:hidden">
        <StaticAgente lang={lang} finaleCta={finaleCta} switcher={switcher} />
      </div>

      <section ref={trackRef} id="journey" className="relative hidden lg:block h-[700svh]">
        {/* Las anclas del itinerario: el botón de scroll de la página baja de
            parada en parada leyendo `stop-<id>`, y así recorre ESTE mundo. */}
        <StationAnchors stations={STATIONS} />

        <div className="sticky top-0 h-[100svh] overflow-hidden">
          {/* EL TEXTO A LA IZQUIERDA Y EL ARTEFACTO A LA DERECHA DESDE EL SEGUNDO
              CERO: la misma maqueta que la portada — el
              hero ocupa la columna izquierda, la escena la derecha, y las
              paradas entran después por la izquierda mientras la escena se
              queda donde estaba. */}
          <motion.div style={{ opacity: heroOpacity, y: heroY }} className="absolute left-0 top-[22svh] w-[48%] pl-[6vw] pr-6 z-20 pointer-events-none">
            <div>
              <HeroBadge lang={lang} />
              <h1 className="mt-6 font-bold text-white text-balance" style={{ fontSize: 'clamp(1.8rem, 3.3vw, 3rem)', lineHeight: 1.06, letterSpacing: '-0.03em' }}>
                {T(HERO.title.es, HERO.title.en, lang)}
              </h1>
              <p className="mt-5 text-white/55 leading-relaxed max-w-xl" style={{ fontSize: 'clamp(15px, 1.3vw, 17px)' }}>
                {T(HERO.lead.es, HERO.lead.en, lang)}
              </p>
            </div>
          </motion.div>

          <div className="absolute right-[3vw] top-1/2 -translate-y-1/2 w-[52%] z-10">
            <ProbeScene progress={scrollYProgress} lang={lang} level={level} />
          </div>

          <ReadingVeil progress={scrollYProgress} from={COPY.corridor[0]} to={COPY.log[1]} />

          {STOPS.map((s) => (
            <Dock key={s.id} progress={scrollYProgress} range={COPY[s.id]}>
              {(active) => (
                <>
                  <Kicker lang={lang} num={s.num} es={s.kicker.es} en={s.kicker.en} />
                  <Line lang={lang} es={s.line.es} en={s.line.en} />
                  <Notes lang={lang} items={[s.note]} />
                  <div className="mt-7">
                    <Artifact id={s.id} lang={lang} active={active} progress={scrollYProgress} />
                  </div>
                </>
              )}
            </Dock>
          ))}

          <Finale progress={scrollYProgress} range={COPY.close} lang={lang} num="05" kicker={CLOSE.kicker} line={CLOSE.line} sub={CLOSE.sub} />
          <Beat progress={scrollYProgress} range={COPY.close} hold className="left-1/2 -translate-x-1/2 bottom-[15svh] text-center">
            <div className="pointer-events-auto">{finaleCta}</div>
          </Beat>

          <StationRail progress={scrollYProgress} lang={lang} stations={STATIONS} onJump={jumpTo} />
          {switcher && (
            <motion.div className="absolute top-[140px] left-1/2 -translate-x-1/2 z-40" style={{ opacity: heroOpacity }}>
              {switcher}
            </motion.div>
          )}
        </div>
      </section>
    </>
  );
}

function Artifact({ id, lang, active, progress, compact }: { id: (typeof STOPS)[number]['id']; lang: Lang; active?: boolean; progress?: ReturnType<typeof useScroll>['scrollYProgress']; compact?: boolean }) {
  if (id === 'corridor') return <MandateArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  if (id === 'flight') return <FlightArtifact lang={lang} active={active} progress={progress} compact={compact} />;
  return <LogArtifact lang={lang} active={active} progress={progress} compact={compact} />;
}

function HeroBadge({ lang }: { lang: Lang }) {
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono uppercase tracking-[0.2em]"
      style={{ border: '1px dashed hsl(var(--volt) / 0.4)', background: 'hsl(var(--volt) / 0.06)', color: 'hsl(var(--volt-soft))' }}
    >
      {T(HERO.badge.es, HERO.badge.en, lang)}
    </span>
  );
}

function StaticAgente({ lang, finaleCta, switcher }: { lang: Lang; finaleCta: ReactNode; switcher?: ReactNode }) {
  return (
    <section className="relative px-6 md:px-10 lg:px-16 pt-36 pb-24">
      <div className="max-w-4xl mx-auto">
        {switcher && <div className="flex justify-center mb-10">{switcher}</div>}
        <HeroBadge lang={lang} />
        <h1 className="mt-6 font-bold text-white" style={{ fontSize: 'clamp(2rem, 7vw, 3rem)', lineHeight: 1.08, letterSpacing: '-0.03em' }}>
          {T(HERO.title.es, HERO.title.en, lang)}
        </h1>
        <p className="mt-5 text-white/55 leading-relaxed max-w-xl">{T(HERO.lead.es, HERO.lead.en, lang)}</p>

        <div className="mt-12 rounded-2xl p-4 md:p-6" style={{ border: `1px dashed ${BORDER_STRONG}` }}>
          <ProbeScene progress={STILL} lang={lang} level="minimal" still />
        </div>

        <div className="mt-12 space-y-10">
          {STOPS.map((s) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ duration: 0.55, ease: EASE }}
              className="pt-6"
              style={{ borderTop: `1px solid ${BORDER}` }}
            >
              <Kicker lang={lang} num={s.num} es={s.kicker.es} en={s.kicker.en} />
              <Line lang={lang} es={s.line.es} en={s.line.en} />
              <Notes lang={lang} items={[s.note]} />
              <div className="mt-5">
                <Artifact id={s.id} lang={lang} compact />
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: EASE }}
          className="mt-12 pt-8"
          style={{ borderTop: `1px solid ${BORDER}` }}
        >
          <Kicker lang={lang} num="05" es={CLOSE.kicker.es} en={CLOSE.kicker.en} />
          <Line lang={lang} es={CLOSE.line.es} en={CLOSE.line.en} />
          <p className="mt-5 max-w-xl text-[15px] leading-snug text-white/55">{T(CLOSE.sub.es, CLOSE.sub.en, lang)}</p>
          <div className="mt-8">{finaleCta}</div>
        </motion.div>
      </div>
    </section>
  );
}
